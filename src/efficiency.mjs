import crypto from 'node:crypto';

const chars=v=>{try{return JSON.stringify(v??'').length;}catch{return String(v??'').length;}};
const hash=v=>crypto.createHash('sha1').update(String(v??'')).digest('hex').slice(0,12);
const clip=(value,max)=>{
  const s=String(value??'');if(s.length<=max)return s;
  const head=Math.max(120,Math.floor(max*.66)),tail=Math.max(80,max-head-48);
  return s.slice(0,head)+'\n… evidence compacted …\n'+s.slice(-tail);
};
const critical=/\b(error|errors|fail|failed|failure|exception|warning|warn|assert|not ok|passed|pass|summary|exit|timeout|traceback|panic|fatal|regression|expected|actual)\b|^[✓✗×!]/i;

function commandEvidence(s,max){
  const lines=String(s??'').split(/\r?\n/);if(String(s??'').length<=max)return String(s??'');
  const keep=new Set();
  for(let i=0;i<Math.min(12,lines.length);i++)keep.add(i);
  for(let i=0;i<lines.length;i++)if(critical.test(lines[i])&&keep.size<100)keep.add(i);
  for(let i=Math.max(0,lines.length-36);i<lines.length;i++)keep.add(i);
  const selected=[...keep].sort((a,b)=>a-b).map(i=>lines[i]);
  const out=selected.join('\n');
  return clip('[compressed command evidence; full output omitted from model context]\n'+out,max);
}

function lineEvidence(s,max,prefix){
  const text=String(s??'');if(text.length<=max)return text;
  const lines=text.split(/\r?\n/),head=lines.slice(0,70),tail=lines.slice(-35),middle=lines.filter(x=>critical.test(x)).slice(0,50);
  const out=[prefix,...head,'…',...middle,...tail].join('\n');
  return clip(out,max);
}

export function reduceToolResult(name,args,content,config={}){
  const raw=String(content??''),limits={
    runCommand:Number(config.runCommandChars||9000),
    read:Number(config.readChars||28000),
    search:Number(config.searchChars||12000),
    browser:Number(config.browserChars||14000),
    generic:Number(config.genericChars||14000)
  };
  let max=limits.generic,reduced=raw;
  if(name==='run_command'||name==='process_logs')max=limits.runCommand;
  else if(name==='read_file'||name==='read_many_files'||name==='read_repo_file')max=limits.read;
  else if(name==='search_files'||name==='repo_map'||name==='inspect_repo_url')max=limits.search;
  else if(name==='call_mcp_tool'&&String(args?.server||'').toLowerCase()==='playwright')max=limits.browser;
  if(raw.length>max){
    if(name==='run_command'||name==='process_logs')reduced=commandEvidence(raw,max);
    else if(name==='search_files'||name==='repo_map')reduced=lineEvidence(raw,max,'[compressed search/map evidence; full output omitted from model context]');
    else if(name==='call_mcp_tool')reduced=lineEvidence(raw,max,'[compressed connector evidence; full output omitted from model context]');
    else reduced=clip(raw,max);
  }
  return{content:reduced,rawChars:raw.length,sentChars:reduced.length,compressed:reduced.length<raw.length,hash:hash(raw)};
}

export class ToolEvidenceLedger{
  constructor(config={}){this.config=config;this.seen=new Map();this.rawChars=0;this.sentChars=0;this.duplicates=0;this.compressed=0;}
  reduce(name,args,content){
    const x=reduceToolResult(name,args,content,this.config);this.rawChars+=x.rawChars;
    const prior=this.seen.get(x.hash);
    if(prior&&x.rawChars>160){
      const compact='[unchanged evidence '+x.hash+' · identical to earlier '+prior.name+' result; duplicate omitted]';
      this.sentChars+=compact.length;this.duplicates++;
      return{...x,content:compact,sentChars:compact.length,duplicate:true};
    }
    this.seen.set(x.hash,{name,at:Date.now()});this.sentChars+=x.sentChars;if(x.compressed)this.compressed++;
    return x;
  }
  stats(){return{rawChars:this.rawChars,sentChars:this.sentChars,savedChars:Math.max(0,this.rawChars-this.sentChars),savedTokens:Math.max(0,Math.ceil((this.rawChars-this.sentChars)/4)),duplicateResults:this.duplicates,compressedResults:this.compressed};}
}

function requestClipTool(content,max){
  const s=String(content??'');return s.length<=max?s:clip(s,max);
}

export function optimizeRequestMessages(messages,{recentTools=6,oldToolChars=2200}={}){
  const src=Array.isArray(messages)?messages:[],toolIndexes=[];for(let i=0;i<src.length;i++)if(src[i]?.role==='tool')toolIndexes.push(i);
  const recent=new Set(toolIndexes.slice(-Math.max(0,recentTools))),seen=new Map();let rawChars=0,sentChars=0,duplicates=0,compressed=0;
  const out=src.map((m,i)=>{
    if(m?.role!=='tool')return m;
    const s=String(m.content??''),h=hash(s);rawChars+=s.length;
    if(recent.has(i)){sentChars+=s.length;if(!seen.has(h))seen.set(h,i);return m;}
    if(seen.has(h)&&s.length>160){const c='[older duplicate evidence '+h+' omitted; unchanged from prior tool result]';sentChars+=c.length;duplicates++;return{...m,content:c};}
    if(!seen.has(h))seen.set(h,i);
    const c=requestClipTool(s,oldToolChars);sentChars+=c.length;if(c.length<s.length)compressed++;return c===s?m:{...m,content:c};
  });
  const rawTotal=chars(src),sentTotal=chars(out);
  return{messages:out,stats:{rawChars:rawTotal,sentChars:sentTotal,savedChars:Math.max(0,rawTotal-sentTotal),savedTokens:Math.max(0,Math.ceil((rawTotal-sentTotal)/4)),duplicateResults:duplicates,compressedResults:compressed}};
}

export function outputBudgetForTask({text='',mode='build',effort='normal',maxOutputTokens=8192,config={}}={}){
  const s=String(text||''),lower=s.toLowerCase(),max=Math.max(512,Number(maxOutputTokens)||8192);
  const deep=/\b(architecture|architect|migration|migrate|refactor|rewrite|comprehensive|deep|research|across (?:the )?repo|multiple files|full implementation|end[- ]to[- ]end|security audit)\b/.test(lower)||s.length>900;
  const tiny=s.length<180&&/\b(rename|typo|version|status|small|one[- ]line|single line|quick fix|text change)\b/.test(lower);
  const cfg=config.outputBudgets||{};
  let tokens=deep?(Number(cfg.deep)||6144):tiny?(Number(cfg.tiny)||2048):(Number(cfg.normal)||4096);
  if(mode==='plan'&&!deep)tokens=Math.min(tokens,Number(cfg.plan)||3072);
  if(effort==='low')tokens=Math.min(tokens,Number(cfg.low)||2560);
  tokens=Math.max(mode==='build'?2048:1024,Math.min(max,tokens));
  return{tokens,class:deep?'deep':tiny?'tiny':'normal'};
}

export function compactSkillText(text=''){
  let s=String(text||'');
  if(s.startsWith('---')){const end=s.indexOf('\n---',3);if(end>=0)s=s.slice(end+4);}
  return s.replace(/<!--[^]*?-->/g,'').split(/\r?\n/).map(x=>x.replace(/[ \t]+$/,'')).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
