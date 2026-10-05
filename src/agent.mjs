function systemPrompt({cwd,mode,effort='high',skills,plugins,mcp,pluginContext=[],projectInstructions=[]}){const skillList=skills.list().slice(0,40).map(s=>`${s.name}: ${s.description}`).join('\n'),pluginList=plugins.list().map(p=>`${p.name}${p.active?' (active)':''}: ${p.description||''}`).join('\n'),mcpList=mcp.list().map(s=>`${s.name} (${s.type})`).join(', ');return`You are Craft Code, a precise general coding and research agent working in ${cwd}.
Mode: ${mode}. Agent depth: ${effort}. In PLAN mode do not modify files or execute shell commands. In BUILD mode make focused changes and verify them. At low depth, minimize exploration and tool loops. At normal depth, balance speed and verification. At high depth, verify assumptions and important changes carefully without becoming verbose.
For non-trivial work, maintain a short progress list with update_todo. Mark exactly one item in_progress at a time where practical, and complete items as work finishes.
Token discipline is mandatory: for an unfamiliar codebase start with repo_map or search_files, then read only relevant ranges. Use read_many_files when several known files are needed. When independent read-only tool calls are needed, issue them together in one response so Craft Code can execute them in parallel. Never scan the entire repository without need; avoid rereading unchanged files; keep command output and explanations concise. Prefer replace_in_file to whole-file rewrites. In BUILD mode, after edits inspect the diff and run the most focused available verification before finalizing; if verification cannot run, state why. When the user supplies a public URL, use fetch_url instead of guessing. For a public github.com repository URL, start with inspect_repo_url and use read_repo_file only for files relevant to the question. Parallel subagents may independently inspect URLs/repositories when that reduces latency.
Skills are lazy. Use list_skills/load_skill only when relevant. Available skill summaries:\n${skillList||'(none)'}
Plugins are lazy: ${pluginList||'(none)'}. Connectors are lazy: ${mcpList||'(none)'}. Never load every MCP tool schema; inspect only the connector needed for the task. Vercel is a native CLI connector: after /connect vercel, use vercel_api for REST reads/writes or run_command with the Vercel CLI for first-class commands. Do not attempt OAuth directly against mcp.vercel.com from Craft Code because Vercel allowlists approved MCP clients.
${Array.isArray(projectInstructions)&&projectInstructions.length?`\nProject instructions (authoritative for this workspace):\n${projectInstructions.map(x=>`--- ${x.file} ---\n${x.text}`).join('\n')}`:''}${Array.isArray(pluginContext)&&pluginContext.length?`\nActive plugin lifecycle context:\n${pluginContext.join('\n')}`:''}\nWhen finished, summarize files changed, verification performed, and unresolved risks. Never claim a command/test ran unless its tool result confirms it.`;}
const estChars=m=>m.reduce((n,x)=>n+JSON.stringify(x).length,0);
function trimToolOutputs(messages,keepTail=6,maxChars=3500){
  return messages.map((m,i)=>{if(m.role!=='tool'||i>=messages.length-keepTail||String(m.content||'').length<=maxChars)return m;const s=String(m.content||'');return{...m,content:`${s.slice(0,2600)}\n… older tool output compacted …\n${s.slice(-600)}`};});
}
function prune(messages){
  const base=trimToolOutputs(messages);if(base.length<=14)return base;
  const u=[];for(let i=1;i<base.length;i++)if(base[i].role==='user')u.push(i);const cut=u.length>4?u[u.length-4]:1;if(cut<=1)return base;
  const older=base.slice(1,cut).filter(m=>m.role==='user'||m.role==='assistant').slice(-8).map(m=>`${m.role}: ${String(m.content||'').slice(0,700)}`).join('\n');
  return[base[0],{role:'system',content:`Earlier conversation was locally compacted to save tokens. Salient excerpts:\n${older}`},...base.slice(cut)];
}const detail=a=>a?.path||a?.server||a?.command?.slice(0,90)||a?.name||a?.query||'';
export class AgentSession{
 constructor({client,model,cwd,mode='build',effort='high',config,usage,skills,plugins,mcp,tools,checkpoints=null,events={},turnTokenBudget=0,projectInstructions=[]}){Object.assign(this,{client,model,cwd,mode,effort,config,usage,skills,plugins,mcp,tools,checkpoints,events,turnTokenBudget,projectInstructions});this.messages=[];this.pluginContext=[];this.lastUsage=null;this.controller=null;this.running=false;}
 setPluginContext(x=[]){this.pluginContext=(x||[]).filter(Boolean).slice(-12);this.rebuildSystem();} setProjectInstructions(x=[]){this.projectInstructions=x||[];this.rebuildSystem();}
 compactLimit(){const configured=this.config.autoCompactChars||500_000,tpm=this.client.rateLimits?.tpmLimit;if(!tpm)return configured;return Math.min(configured,Math.max(100_000,Math.floor(tpm*0.6)));}
 stepLimit(){const base=this.effort==='low'?Math.min(8,this.config.maxAgentSteps||20):this.effort==='normal'?Math.min(14,this.config.maxAgentSteps||20):(this.config.maxAgentSteps||20),tpm=this.client.rateLimits?.tpmLimit;if(!tpm)return base;const cap=tpm<=250_000?(this.effort==='low'?6:this.effort==='normal'?9:12):tpm<=500_000?(this.effort==='low'?7:this.effort==='normal'?11:16):tpm<=1_000_000?(this.effort==='low'?8:this.effort==='normal'?13:18):base;return Math.min(base,cap);}
 rebuildSystem(){const s={role:'system',content:systemPrompt(this)};if(this.messages[0]?.role==='system')this.messages[0]=s;else this.messages.unshift(s);}clear(){this.messages=[];this.rebuildSystem();this.events.onContext?.(this.contextChars());}compact(){this.messages=prune(this.messages);this.events.onContext?.(this.contextChars());return this.messages.length;}setMode(m){this.mode=m;this.rebuildSystem();this.events.onContext?.(this.contextChars());}setEffort(e){this.effort=e;this.rebuildSystem();this.events.onContext?.(this.contextChars());}contextChars(){return estChars(this.messages)} contextStats(){const system=this.messages.filter(x=>x.role==='system').reduce((n,x)=>n+JSON.stringify(x).length,0),tool=this.messages.filter(x=>x.role==='tool').reduce((n,x)=>n+JSON.stringify(x).length,0),user=this.messages.filter(x=>x.role==='user').reduce((n,x)=>n+JSON.stringify(x).length,0),assistant=this.messages.filter(x=>x.role==='assistant').reduce((n,x)=>n+JSON.stringify(x).length,0);return{chars:this.contextChars(),estimatedTokens:Math.ceil(this.contextChars()/4),systemChars:system,toolChars:tool,userChars:user,assistantChars:assistant,messages:this.messages.length};}restore(m=[]){this.messages=Array.isArray(m)&&m.length?m:[];this.rebuildSystem();this.events.onContext?.(this.contextChars());}cancel(){if(this.controller&&!this.controller.signal.aborted){this.controller.abort();return true;}return false;}

 async run(userText){
  if(this.running)throw new Error('Agent is already running');
  this.running=true;
  this.controller=new AbortController();
  const signal=this.controller.signal;
  if(!this.messages.length)this.rebuildSystem();
  this.messages.push({role:'user',content:userText});
  this.events.onContext?.(this.contextChars());
  if(estChars(this.messages)>this.compactLimit())this.compact();

  let finalText='',totalThisTurn=0;
  let mutated=false,verified=false,verificationPrompted=false,stalled=false;
  let lastBatchFingerprint='',repeatBatchCount=0;
  const runtime=this.config.agentRuntime||{};
  const parallelTools=runtime.parallelTools!==false;
  const loopLimit=Math.max(2,Number(runtime.loopGuardRepeats||3));
  const autoVerify=runtime.autoVerifyEdits!==false;

  this.events.onTurnStart?.();
  if(this.mode==='build'&&this.checkpoints)await this.checkpoints.begin(String(userText).slice(0,80));

  const parseArgs=call=>{try{return JSON.parse(call.function.arguments||'{}');}catch{return{_raw:call.function.arguments};}};
  const runTool=async(call,args)=>{
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    const name=call.function.name,started=Date.now();
    const cardId=this.events.onToolStart?.({name,args,detail:detail(args),callId:call.id});
    let result;
    try{result=await this.tools.execute(name,args,this.mode,{signal});}
    catch(e){if(e.name==='AbortError')throw e;result={error:String(e.message||e)};}
    const content=typeof result==='string'?result:JSON.stringify(result);
    if(this.tools.isMutating?.(name))mutated=true;
    if(this.tools.isVerification?.(name,args))verified=true;
    this.events.onToolEnd?.({cardId,name,args,result:content,durationMs:Date.now()-started,error:typeof result==='object'&&result?.error});
    return{call,content,name,args};
  };

  try{
    const hookContext=await this.plugins.hook('session.beforeTurn',{session:this,userText});
    if(hookContext?.length){this.pluginContext=[...this.pluginContext,...hookContext].slice(-12);this.rebuildSystem();}

    const stepLimit=this.stepLimit(),segmentLimit=Math.max(1,Math.min(6,Number(this.config.maxTurnSegments||3)));
    let completed=false,budgetReached=false,segments=0;

    outer:for(let segment=0;segment<segmentLimit;segment++){
      segments=segment+1;
      if(segment>0)this.events.onWarn?.(`Long turn · continuing automatically (${segments}/${segmentLimit})…`);

      for(let step=0;step<stepLimit;step++){
        if(estChars(this.messages)>this.compactLimit())this.compact();
        if(signal.aborted)throw new DOMException('Aborted','AbortError');
        this.events.onThinking?.({step:segment*stepLimit+step});

        const res=await this.client.stream({
          model:this.model,messages:this.messages,tools:this.tools.definitions(this.mode),signal,
          onText:t=>{finalText+=t;this.events.onText?.(t);}
        });
        this.lastUsage=res.usage;
        if(res.usage){
          totalThisTurn+=res.usage.total_tokens||0;
          await this.usage.add(res.usage,this.model);
          this.events.onUsage?.(res.usage);
        }
        this.messages.push(res.message);
        this.events.onContext?.(this.contextChars());

        const calls=res.message.tool_calls||[];
        if(!calls.length){
          if(res.finishReason==='length'){
            this.events.onWarn?.('Output limit reached · continuing automatically…');
            this.messages.push({role:'user',content:'[Craft Code continuation] Continue exactly where the previous response stopped. Do not repeat completed work.'});
            this.events.onContext?.(this.contextChars());
            continue outer;
          }
          if(this.mode==='build'&&mutated&&autoVerify&&!verificationPrompted&&!verified){
            verificationPrompted=true;
            this.events.onWarn?.('Edits made · requesting focused verification before finalizing…');
            this.messages.push({role:'user',content:'[Craft Code verification gate] You modified the workspace. Before finalizing, inspect the diff and run the most focused relevant test/lint/typecheck/build command available. If no verification can run, inspect the diff and explain the limitation briefly.'});
            this.events.onContext?.(this.contextChars());
            continue outer;
          }
          completed=true;
          break outer;
        }

        const prepared=calls.map(call=>({call,args:parseArgs(call)}));
        const fingerprint=JSON.stringify(prepared.map(x=>[x.call.function.name,x.args]));
        if(fingerprint===lastBatchFingerprint)repeatBatchCount++;
        else{lastBatchFingerprint=fingerprint;repeatBatchCount=1;}
        if(repeatBatchCount===2)this.events.onWarn?.('Repeated identical tool batch detected · asking agent to reassess…');

        const canParallel=parallelTools&&prepared.length>1&&prepared.every(x=>this.tools.isParallelSafe?.(x.call.function.name));
        let results=[];
        if(canParallel)results=await Promise.all(prepared.map(x=>runTool(x.call,x.args)));
        else for(const x of prepared)results.push(await runTool(x.call,x.args));

        for(const x of results)this.messages.push({role:'tool',tool_call_id:x.call.id,content:x.content});
        this.events.onContext?.(this.contextChars());

        if(repeatBatchCount>=loopLimit){
          stalled=true;
          this.events.onWarn?.(`Loop guard stopped ${repeatBatchCount} identical tool batches. Rephrase or continue with a different approach.`);
          this.messages.push({role:'user',content:'[Craft Code loop guard] The same tool batch has repeated without progress. Stop repeating it. Reassess the evidence, choose a different method, or explain the blocker.'});
          break outer;
        }else if(repeatBatchCount===2){
          this.messages.push({role:'user',content:'[Craft Code loop guard] You just repeated the same tool batch. Reassess before calling it again; prefer a different query, file range, or strategy if the result did not advance the task.'});
          this.events.onContext?.(this.contextChars());
        }

        if(this.turnTokenBudget&&totalThisTurn>=this.turnTokenBudget){
          this.events.onWarn?.(`Agent token budget reached (${Math.round(totalThisTurn/1000)}k / ${Math.round(this.turnTokenBudget/1000)}k).`);
          budgetReached=true;
          break outer;
        }
      }
    }

    if(!completed&&!budgetReached&&!stalled)this.events.onWarn?.(`Turn continuation ceiling reached after ${segments*stepLimit} model/tool rounds. The task may be incomplete; send "continue" to resume.`);
    const hard=this.config.tokenGuard?.hardRequestTokens||0;
    if(hard&&totalThisTurn>hard)this.events.onWarn?.(`This turn consumed ${Math.round(totalThisTurn/1000)}k tokens. Consider /compact or a narrower task.`);
    await this.plugins.hook('session.afterTurn',{usage:this.lastUsage,session:this});
    return{text:finalText,usage:this.lastUsage,totalThisTurn,cancelled:false,completed:completed&&!budgetReached&&!stalled,stalled,verified};
  }catch(e){
    if(e?.name==='AbortError'){
      this.messages.push({role:'assistant',content:'[Turn cancelled by user]'});
      this.events.onCancelled?.();
      return{text:finalText,usage:this.lastUsage,totalThisTurn,cancelled:true,completed:false,stalled:false,verified};
    }
    throw e;
  }finally{
    if(this.mode==='build'&&this.checkpoints){
      try{const cp=await this.checkpoints.finish();if(cp)this.events.onCheckpoint?.(cp);}catch{}
    }
    this.running=false;
    this.controller=null;
    this.events.onTurnEnd?.();
  }
 }
}
