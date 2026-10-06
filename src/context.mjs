const jsonChars=value=>{try{return JSON.stringify(value??'').length;}catch{return String(value??'').length;}};
export const estimateTokens=value=>Math.max(1,Math.ceil(jsonChars(value)/4));

const clip=(value,max=700)=>{
  const s=String(value??'');
  if(s.length<=max)return s;
  const head=Math.max(80,Math.floor(max*.72)),tail=Math.max(40,max-head-36);
  return `${s.slice(0,head)}\n… compacted …\n${s.slice(-tail)}`;
};

function normalizedCall(call,index,messageIndex){
  const id=String(call?.id||'').trim()||`craft-recovered-${messageIndex}-${index}`;
  return {
    ...call,
    id,
    type:call?.type||'function',
    function:{
      name:String(call?.function?.name||'unknown_tool'),
      arguments:String(call?.function?.arguments||'{}')
    }
  };
}

export function repairConversation(messages=[]){
  const input=Array.isArray(messages)?messages:[],out=[];let repaired=0,dropped=0;
  for(let i=0;i<input.length;i++){
    const m=input[i];
    if(!m||typeof m!=='object'){dropped++;continue;}
    if(m.role==='tool'){dropped++;continue;}
    if(m.role==='assistant'&&Array.isArray(m.tool_calls)&&m.tool_calls.length){
      const calls=m.tool_calls.map((call,j)=>{
        const next=normalizedCall(call,j,i);
        if(next.id!==call?.id||next.function.name!==call?.function?.name)repaired++;
        return next;
      });
      let j=i+1;const following=[];
      while(j<input.length&&input[j]?.role==='tool'){following.push(input[j]);j++;}
      const byId=new Map();
      for(const t of following){
        const id=String(t.tool_call_id||'');
        if(id&&!byId.has(id))byId.set(id,t);else dropped++;
      }
      out.push({...m,tool_calls:calls});
      for(const call of calls){
        const existing=byId.get(call.id);
        if(existing)out.push(existing);
        else{
          out.push({role:'tool',tool_call_id:call.id,content:'{"error":"Tool call was interrupted before a result was recorded."}'});
          repaired++;
        }
      }
      for(const id of byId.keys())if(!calls.some(c=>c.id===id))dropped++;
      i=j-1;continue;
    }
    out.push(m);
  }
  return{messages:out,repaired,dropped};
}

function trimToolOutputs(messages,keepTail=6,maxChars=3500){
  return messages.map((m,i)=>{
    if(m.role!=='tool'||i>=messages.length-keepTail)return m;
    const s=String(m.content??'');
    if(s.length<=maxChars)return m;
    return{...m,content:clip(s,maxChars)};
  });
}

const PIN_MUTATIONS=new Set(['apply_patch','replace_in_file','write_file','delete_file','move_file','make_directory','generate_image']);
const VERIFY_CMD=/(?:^|\s)(?:test|tests|lint|typecheck|check|build|pytest|vitest|jest|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test)(?:\s|$)/i;
function callArgs(call){try{return JSON.parse(call?.function?.arguments||'{}');}catch{return{};}}
function patchTargets(p=''){return[...String(p||'').matchAll(/^\+\+\+\s+(?:b\/)?([^\t\r\n]+)/gm)].map(m=>m[1]).filter(x=>x&&x!=='/dev/null').slice(0,8);}
function extractPinnedEvidence(messages,maxChars=4600){
  const rows=[],seen=new Set(),calls=new Map(),push=x=>{x=String(x||'').replace(/\s+/g,' ').trim();if(!x||seen.has(x))return;seen.add(x);rows.push(x);};
  const genuineUsers=(messages||[]).filter(m=>m?.role==='user'&&typeof m.content==='string'&&!/^\[Craft Code /.test(m.content.trim())).slice(-4);
  for(const m of genuineUsers)push('Requirement: '+clip(m.content,620));
  for(const m of messages||[]){
    if(m?.role==='assistant'&&Array.isArray(m.tool_calls))for(const c of m.tool_calls||[]){calls.set(String(c.id||''),c);const n=String(c?.function?.name||''),a=callArgs(c);if(PIN_MUTATIONS.has(n)){const targets=n==='apply_patch'?patchTargets(a.patch):[a.path||a.from||a.to].filter(Boolean);if(targets.length)push('Changed: '+targets.join(', '));}}
    if(m?.role==='tool'){
      const c=calls.get(String(m.tool_call_id||'')),n=String(c?.function?.name||''),a=callArgs(c),body=String(m.content||''),failed=/\(exit\s+[1-9]\d*\)|\b(error|failed|failure|exception|fatal|not ok)\b/i.test(body);
      if(n==='run_command'&&VERIFY_CMD.test(String(a.command||'')))push((failed?'Verification failed: ':'Verification passed: ')+clip(a.command,300)+(failed?' · '+clip(body,500):''));
      if(n==='call_mcp_tool'&&String(a.server||'').toLowerCase()==='playwright'&&/(snapshot|screenshot)/i.test(String(a.tool||''))&&!failed)push('Browser verification captured: '+String(a.tool||'snapshot'));
      if(failed&&n!=='run_command')push('Tool failure: '+n+' · '+clip(body,420));
    }
  }
  return clip(rows.join('\n'),maxChars);
}

function compactCandidate(base,keepTurns,pinnedEvidence=''){
  const firstSystem=base[0]?.role==='system'?base[0]:null;
  const start=firstSystem?1:0,userIndexes=[];
  for(let i=start;i<base.length;i++)if(base[i]?.role==='user')userIndexes.push(i);
  if(userIndexes.length<=keepTurns)return base;
  const cut=userIndexes[userIndexes.length-keepTurns];
  const older=base.slice(start,cut)
    .filter(m=>m?.role==='user'||m?.role==='assistant')
    .map(m=>`${m.role}: ${clip(m.content,520)}`)
    .filter(Boolean)
    .slice(-10)
    .join('\n');
  const pinned=pinnedEvidence||extractPinnedEvidence(base),parts=[];if(pinned)parts.push('Pinned evidence (preserve exactly in subsequent reasoning):\n'+pinned);if(older)parts.push('Salient older excerpts:\n'+older);
  const summary=parts.length?{role:'system',content:'Earlier conversation was locally compacted to preserve session continuity.\n'+parts.join('\n\n')}:null;
  return[...(firstSystem?[firstSystem]:[]),...(summary?[summary]:[]),...base.slice(cut)];
}

function trimAssistantText(messages,maxChars=2600){
  let latest=-1;
  for(let i=messages.length-1;i>=0;i--)if(messages[i]?.role==='assistant'){latest=i;break;}
  return messages.map((m,i)=>{
    if(m?.role!=='assistant'||i===latest||typeof m.content!=='string'||m.content.length<=maxChars)return m;
    return{...m,content:clip(m.content,maxChars)};
  });
}

export function compactConversation(messages,{targetChars=Infinity,aggressive=false}={}){
  const repaired=repairConversation(messages);
  let current=trimToolOutputs(repaired.messages,aggressive?2:6,aggressive?2200:3500);
  const target=Number.isFinite(targetChars)&&targetChars>0?targetChars:Infinity;
  if(jsonChars(current)<=target)return{messages:current,repaired:repaired.repaired,dropped:repaired.dropped,beforeChars:jsonChars(messages),afterChars:jsonChars(current)};

  const pinnedEvidence=extractPinnedEvidence(current);
  for(const keepTurns of [4,3,2,1]){
    const candidate=compactCandidate(current,keepTurns,pinnedEvidence);
    if(jsonChars(candidate)<jsonChars(current))current=candidate;
    if(jsonChars(current)<=target)break;
  }
  if(jsonChars(current)>target)current=trimToolOutputs(current,0,aggressive?1200:1800);
  if(jsonChars(current)>target)current=trimAssistantText(current,aggressive?1400:2200);

  const finalRepair=repairConversation(current);
  return{
    messages:finalRepair.messages,
    repaired:repaired.repaired+finalRepair.repaired,
    dropped:repaired.dropped+finalRepair.dropped,
    beforeChars:jsonChars(messages),
    afterChars:jsonChars(finalRepair.messages)
  };
}

export function classifyProviderError(status,body=''){
  const text=String(body||'').toLowerCase();
  if([400,413,422].includes(Number(status))&&/(context[_ -]?length|context window|maximum context|max(?:imum)? context|too many tokens|token limit|prompt.{0,40}too long|input.{0,40}too long|request.{0,20}too large|reduce.{0,40}(?:prompt|messages|tokens)|maximum.{0,30}tokens.{0,30}(?:exceeded|allowed))/i.test(text))return'CONTEXT_LENGTH';
  if(Number(status)===400&&/(tool[_ -]?call|tool_call_id|messages? with role.{0,20}tool|tool message|must be followed by.{0,30}tool|invalid.{0,30}message|message.{0,30}sequence)/i.test(text))return'MESSAGE_SEQUENCE';
  return`HTTP_${Number(status)||0}`;
}

export function providerErrorSummary(body='',max=700){
  const raw=String(body||'').trim();
  if(!raw)return'Unknown provider error';
  try{
    const j=JSON.parse(raw),msg=j?.error?.message||j?.error?.detail||j?.message||j?.detail;
    if(msg)return clip(msg,max);
  }catch{}
  return clip(raw,max);
}
