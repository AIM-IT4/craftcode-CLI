import {compactConversation,estimateTokens,repairConversation} from './context.mjs';
import {ProofTracker,failedResult} from './proof.mjs';
import {FlightRecorder} from './flight_recorder.mjs';
import {ToolEvidenceLedger,optimizeRequestMessages,outputBudgetForTask} from './efficiency.mjs';

function systemPrompt({cwd,mode,effort='high',skills,plugins,mcp,pluginContext=[],projectInstructions=[],autoSkills=[]}){const skillList=skills.list().slice(0,24).map(s=>s.name).join(', '),autoSkillText=(autoSkills||[]).map(s=>`--- ${s.name} [auto-selected · ~${s.promptEstimatedTokens||s.estimatedTokens||0} tokens] ---\n${s.promptContent||s.content}`).join('\n\n'),pluginList=plugins.list().map(p=>`${p.name}${p.active?' (active)':''}: ${p.description||''}`).join('\n'),mcpList=mcp.list().map(s=>`${s.name} (${s.type})`).join(', ');return`You are Craft Code, a precise general coding and research agent working in ${cwd}.
Mode: ${mode}. Agent depth: ${effort}. In PLAN mode do not modify files or execute shell commands. In BUILD mode make focused changes and verify them. At low depth, minimize exploration and tool loops. At normal depth, balance speed and verification. At high depth, verify assumptions and important changes carefully without becoming verbose.
For non-trivial work, maintain a short progress list with update_todo. Mark exactly one item in_progress at a time where practical, and complete items as work finishes.
Token discipline is mandatory: for an unfamiliar codebase start with repo_map; for JavaScript/TypeScript symbol, definition, or reference questions prefer semantic_code before text search. Use search_files for text evidence and read_many_files when several known files are needed. Before guessing test/lint/typecheck/build commands, use discover_project_commands. Use process_start/process_logs/process_status for dev servers or other long-running commands instead of forcing them through run_command timeouts. When genuinely dependent read-only investigations benefit from multiple agents, prefer orchestrate_task so a planner can schedule workers and a reviewer can reconcile their evidence. When independent read-only tool calls are needed, issue them together in one response so Craft Code can execute them in parallel. Never scan the entire repository without need; avoid rereading unchanged files; keep command output and explanations concise. Prefer apply_patch for localized multi-line edits, replace_in_file for tiny exact substitutions, and write_file only for new/small files; do not rewrite a large existing file just to change a small region. In BUILD mode, after edits inspect the diff and run the most focused available verification before finalizing; if verification cannot run, state why. When the user supplies a public URL, use fetch_url instead of guessing. For a public github.com repository URL, start with inspect_repo_url and use read_repo_file only for files relevant to the question. Parallel subagents may independently inspect URLs/repositories when that reduces latency.
Skills are token-routed automatically from the user's task. Do not ask the user to type a skill command. Auto-selected skill content, when relevant, appears below. Use list_skills/load_skill only if the automatic router missed something genuinely necessary. Compact skill catalog: ${skillList||'(none)'}\n${autoSkillText?`\nAuto-selected skills:\n${autoSkillText}`:''}
Plugins are lazy: ${pluginList||'(none)'}. Connectors are lazy: ${mcpList||'(none)'}. Never load every MCP tool schema; inspect only the connector needed for the task. Vercel account authorization is initiated by /connect vercel through the official OAuth device/browser flow using a transient npx invocation, so do not tell the user to install a global Vercel CLI. After connection, use vercel_api for REST reads/writes or run_command with the Vercel CLI bridge for first-class commands.
${Array.isArray(projectInstructions)&&projectInstructions.length?`\nProject instructions (authoritative for this workspace):\n${projectInstructions.map(x=>`--- ${x.file} ---\n${x.text}`).join('\n')}`:''}${Array.isArray(pluginContext)&&pluginContext.length?`\nActive plugin lifecycle context:\n${pluginContext.join('\n')}`:''}\nWhen finished, default to a compact result: changed files, verification, and unresolved risks only. Stay under about 120 words unless the user explicitly asks for detail. Do not restate code already present in the applied diff. Never claim a command/test ran unless its tool result confirms it.`;}
const estChars=m=>m.reduce((n,x)=>n+JSON.stringify(x).length,0);
const fmtContextTokens=n=>n>=1000?`${(n/1000).toFixed(n>=10000?0:1)}k`:String(Math.max(0,Math.round(n)));
const detail=a=>a?.path||a?.server||a?.command?.slice(0,90)||a?.name||a?.query||'';
export class AgentSession{
 constructor({client,model,cwd,mode='build',effort='high',config,usage,skills,plugins,mcp,tools,checkpoints=null,events={},turnTokenBudget=0,projectInstructions=[]}){Object.assign(this,{client,model,cwd,mode,effort,config,usage,skills,plugins,mcp,tools,checkpoints,events,turnTokenBudget,projectInstructions});this.messages=[];this.pluginContext=[];this.autoSkills=[];this.lastUsage=null;this.lastProof=null;this.controller=null;this.running=false;this.traceEpoch=0;}
 trace(type,data={}){this.events.onTrace?.({type,messageCount:this.messages.length,epoch:this.traceEpoch,...data});}
 setPluginContext(x=[]){this.pluginContext=(x||[]).filter(Boolean).slice(-12);this.rebuildSystem();} setProjectInstructions(x=[]){this.projectInstructions=x||[];this.rebuildSystem();}
 async routeSkills(query){const cfg=this.config.skills||{};if(cfg.autoLoad===false||!this.skills?.autoSelect){this.autoSkills=[];this.rebuildSystem();return[];}const r=await this.skills.autoSelect(query,{maxSkills:Math.max(0,Math.min(4,Number(cfg.maxAutoSkills??2))),maxTokens:Math.max(0,Number(cfg.autoLoadMaxTokens??8000)),minScore:Math.max(0,Number(cfg.minAutoScore??2))});this.autoSkills=r.selected||[];this.rebuildSystem();if(this.autoSkills.length)this.events.onAutoSkills?.({names:this.autoSkills.map(x=>x.name),estimatedTokens:r.estimatedTokens||0,candidates:r.candidates||0});return this.autoSkills;}
 contextWindow(){return Number(this.client.capabilities?.(this.model)?.contextWindow)||0;}
 contextBudget(tools=[]){const window=this.contextWindow();if(!window)return null;const toolTokens=estimateTokens(tools||[]),configuredOutput=Number(this.client.maxOutputTokens||this.config.maxOutputTokens||8192),outputReserve=Math.min(configuredOutput,Math.max(1024,Math.floor(window*.25))),safety=Math.max(1024,Math.floor(window*.05)),maxMessageTokens=Math.max(1024,window-toolTokens-outputReserve-safety);return{window,toolTokens,outputReserve,safety,triggerTokens:Math.max(1024,Math.floor(maxMessageTokens*.82)),targetTokens:Math.max(768,Math.floor(maxMessageTokens*.62))};}
 compactLimit(tools=[]){let limit=this.config.autoCompactChars||500_000,tpm=this.client.rateLimits?.tpmLimit;if(tpm)limit=Math.min(limit,Math.max(100_000,Math.floor(tpm*.6)));const budget=this.contextBudget(tools);if(budget)limit=Math.min(limit,budget.triggerTokens*4);return limit;}
 compactTarget(tools=[],aggressive=false){const budget=this.contextBudget(tools);if(budget)return Math.max(8000,Math.floor(budget.targetTokens*4*(aggressive ? 0.72 : 1)));return Math.max(8000,Math.floor(this.contextChars()*(aggressive ? 0.5 : 0.68)));}
 stepLimit(){const base=this.effort==='low'?Math.min(8,this.config.maxAgentSteps||20):this.effort==='normal'?Math.min(14,this.config.maxAgentSteps||20):(this.config.maxAgentSteps||20),tpm=this.client.rateLimits?.tpmLimit;if(!tpm)return base;const cap=tpm<=250_000?(this.effort==='low'?6:this.effort==='normal'?9:12):tpm<=500_000?(this.effort==='low'?7:this.effort==='normal'?11:16):tpm<=1_000_000?(this.effort==='low'?8:this.effort==='normal'?13:18):base;return Math.min(base,cap);}
 emitContext(){this.events.onContext?.(this.contextChars(),this.contextStats());}
 rebuildSystem(){const next={role:'system',content:systemPrompt(this)};if(this.messages[0]?.role==='system')this.messages[0]=next;else this.messages.unshift(next);}
 clear(){this.messages=[];this.rebuildSystem();this.emitContext();}
 compact({targetChars=0,aggressive=false}={}){const before=this.contextChars(),beforeTokens=Math.ceil(before/4),target=targetChars||Math.max(8000,Math.floor(before*.68)),result=compactConversation(this.messages,{targetChars:target,aggressive});this.messages=result.messages;this.lastCompaction={...result,targetChars:target};if(this.contextChars()<before){this.traceEpoch++;this.trace('context.compact',{beforeTokens,afterTokens:Math.ceil(this.contextChars()/4)});}this.emitContext();return this.messages.length;}
 repairContext(){const result=repairConversation(this.messages);if(result.repaired||result.dropped){this.messages=result.messages;this.lastRepair={repaired:result.repaired,dropped:result.dropped};this.trace('context.repair',{repaired:result.repaired,dropped:result.dropped});this.emitContext();}return result.repaired+result.dropped;}
 autoCompact(tools=[],reason='auto',aggressive=false){const before=this.contextChars(),limit=this.compactLimit(tools);if(!aggressive&&before<=limit)return false;this.compact({targetChars:this.compactTarget(tools,aggressive),aggressive});const after=this.contextChars();if(after>=before)return false;const b=fmtContextTokens(Math.ceil(before/4)),a=fmtContextTokens(Math.ceil(after/4));this.events.onWarn?.(reason==='provider'?`Provider rejected accumulated context · compacted ${b} → ${a} tokens · retrying automatically.`:`Context nearing model limit · compacted ${b} → ${a} tokens · continuing.`);return true;}
 setMode(m){this.mode=m;this.rebuildSystem();this.emitContext();}
 setEffort(e){this.effort=e;this.rebuildSystem();this.emitContext();}
 contextChars(){return estChars(this.messages)}
 contextStats(){const system=this.messages.filter(x=>x.role==='system').reduce((n,x)=>n+JSON.stringify(x).length,0),tool=this.messages.filter(x=>x.role==='tool').reduce((n,x)=>n+JSON.stringify(x).length,0),user=this.messages.filter(x=>x.role==='user').reduce((n,x)=>n+JSON.stringify(x).length,0),assistant=this.messages.filter(x=>x.role==='assistant').reduce((n,x)=>n+JSON.stringify(x).length,0),estimatedTokens=Math.ceil(this.contextChars()/4),contextWindow=this.contextWindow();return{chars:this.contextChars(),estimatedTokens,contextWindow,percent:contextWindow?Math.min(999,Math.round(estimatedTokens/contextWindow*100)):null,systemChars:system,toolChars:tool,userChars:user,assistantChars:assistant,messages:this.messages.length};}
 restore(m=[]){const repaired=repairConversation(Array.isArray(m)&&m.length?m:[]);this.messages=repaired.messages;this.lastRestoreRepair=repaired.repaired+repaired.dropped;this.rebuildSystem();this.emitContext();return this.lastRestoreRepair;}
 cancel(){if(this.controller&&!this.controller.signal.aborted){this.controller.abort();return true;}return false;}

 async run(userText){
  if(this.running)throw new Error('Agent is already running');
  this.running=true;
  this.controller=new AbortController();
  const signal=this.controller.signal;
  if(!this.messages.length)this.rebuildSystem();
  await this.routeSkills(userText);
  this.messages.push({role:'user',content:userText});
  this.trace('turn.start',{promptHash:FlightRecorder.hash(userText)});
  this.emitContext();
  if(estChars(this.messages)>this.compactLimit())this.autoCompact([],'auto',false);

  let finalText='',totalThisTurn=0;
  let mutated=false,verified=false,verificationPrompted=false,browserPrompted=false,stalled=false;
  const proof=new ProofTracker({goal:userText,mode:this.mode});
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
    const toolDetail=detail(args);this.trace('tool.start',{name,detail:toolDetail,callId:call.id,argsHash:FlightRecorder.hash(args)});
    const cardId=this.events.onToolStart?.({name,args,detail:toolDetail,callId:call.id});
    let result;
    if(name==='run_command'&&/\bgit\s+push\b/i.test(String(args.command||''))&&proof.browserRequired&&!proof.browserVerified)result={error:'Push blocked: UI/web changes require Playwright browser verification first.'};
    else try{result=await this.tools.execute(name,args,this.mode,{signal});}
    catch(e){if(e.name==='AbortError')throw e;result={error:String(e.message||e)};}
    const content=typeof result==='string'?result:JSON.stringify(result);
    const isMutating=!!this.tools.isMutating?.(name),isVerification=!!this.tools.isVerification?.(name,args),toolError=!!(typeof result==='object'&&result?.error),toolFailed=failedResult(content,toolError);
    if(isMutating&&!toolFailed)mutated=true;
    if(isVerification)verified=true;
    proof.tool({name,args,result:content,error:toolError,mutating:isMutating&&!toolFailed});
    const durationMs=Date.now()-started;this.trace('tool.end',{name,callId:call.id,durationMs,error:toolError,resultHash:FlightRecorder.hash(content),resultChars:content.length});
    this.events.onToolEnd?.({cardId,name,args,result:content,durationMs,error:toolError});
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
        const toolDefs=this.tools.definitions(this.mode);
        this.autoCompact(toolDefs,'auto',false);
        this.repairContext();
        if(signal.aborted)throw new DOMException('Aborted','AbortError');
        this.events.onThinking?.({step:segment*stepLimit+step});
        this.trace('model.request',{step:segment*stepLimit+step,model:this.model});

        let res,contextRetried=false,sequenceRetried=false;
        while(true){
          try{
            res=await this.client.stream({
              model:this.model,messages:this.messages,tools:toolDefs,signal,
              onText:t=>{finalText+=t;this.events.onText?.(t);}
            });
            break;
          }catch(e){
            if(e?.code==='MESSAGE_SEQUENCE'&&!sequenceRetried){
              sequenceRetried=true;const repaired=this.repairContext();
              if(!repaired)throw e;
              this.events.onWarn?.(`Recovered ${repaired} interrupted tool-message ${repaired===1?'entry':'entries'} · retrying automatically.`);
              continue;
            }
            if(e?.code==='CONTEXT_LENGTH'&&!contextRetried){
              contextRetried=true;const before=this.contextChars();
              let changed=this.autoCompact(toolDefs,'provider',true);
              if(!changed){this.compact({targetChars:Math.max(8000,Math.floor(before*.48)),aggressive:true});changed=this.contextChars()<before;}
              if(!changed)throw new Error('The selected model rejected this session context and Craft Code could not shrink it safely. The latest prompt or project instructions may exceed the model window; use /context, shorten the input, or switch to a larger-context model.');
              continue;
            }
            throw e;
          }
        }
        this.lastUsage=res.usage;
        if(res.usage){
          totalThisTurn+=res.usage.total_tokens||0;
          await this.usage.add(res.usage,this.model);
          this.events.onUsage?.(res.usage);
        }
        this.messages.push(res.message);
        this.trace('model.response',{finishReason:res.finishReason||'',usage:res.usage?{prompt_tokens:res.usage.prompt_tokens||0,completion_tokens:res.usage.completion_tokens||0,total_tokens:res.usage.total_tokens||0}:null,responseHash:FlightRecorder.hash(res.message)});
        this.emitContext();

        const calls=res.message.tool_calls||[];
        if(!calls.length){
          if(res.finishReason==='length'){
            this.events.onWarn?.('Output limit reached · continuing automatically…');
            this.messages.push({role:'user',content:'[Craft Code continuation] Continue exactly where the previous response stopped. Do not repeat completed work.'});
            this.emitContext();
            continue outer;
          }
          if(this.mode==='build'&&mutated&&runtime.autoBrowserVerify!==false&&proof.browserRequired&&!proof.browserVerified&&!browserPrompted){
            browserPrompted=true;
            this.events.onWarn?.('UI/web change detected · running browser verification before finalizing…');
            this.messages.push({role:'user',content:'[Craft Code browser verification gate] UI/web files changed. Before finalizing or pushing, verify the changed behavior in a real browser automatically. Do not ask the user to run /browser. If needed, discover and start the project dev server with discover_project_commands + process_start. Then use list_mcp_tools for server "playwright" and call the minimum Playwright tools needed to navigate the relevant page and capture a browser snapshot or screenshot. Inspect the result for the intended behavior and obvious runtime/console/UI regressions. If browser verification cannot run, state the concrete blocker and do not push.'});
            this.emitContext();
            continue outer;
          }
          if(this.mode==='build'&&mutated&&autoVerify&&!verificationPrompted&&!verified){
            verificationPrompted=true;
            this.events.onWarn?.('Edits made · requesting focused verification before finalizing…');
            this.messages.push({role:'user',content:'[Craft Code verification gate] You modified the workspace. Before finalizing, inspect the diff and run the most focused relevant test/lint/typecheck/build command available. If no verification can run, inspect the diff and explain the limitation briefly.'});
            this.emitContext();
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
        this.emitContext();

        if(repeatBatchCount>=loopLimit){
          stalled=true;
          this.events.onWarn?.(`Loop guard stopped ${repeatBatchCount} identical tool batches. Rephrase or continue with a different approach.`);
          this.messages.push({role:'user',content:'[Craft Code loop guard] The same tool batch has repeated without progress. Stop repeating it. Reassess the evidence, choose a different method, or explain the blocker.'});
          break outer;
        }else if(repeatBatchCount===2){
          this.messages.push({role:'user',content:'[Craft Code loop guard] You just repeated the same tool batch. Reassess before calling it again; prefer a different query, file range, or strategy if the result did not advance the task.'});
          this.emitContext();
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
    const proofReport=proof.finish({completed:completed&&!budgetReached&&!stalled,cancelled:false,stalled});this.lastProof=proofReport;this.trace('turn.end',{status:proofReport.completed?'completed':stalled?'stalled':budgetReached?'budget':'incomplete',proof:proofReport});
    return{text:finalText,usage:this.lastUsage,totalThisTurn,cancelled:false,completed:completed&&!budgetReached&&!stalled,stalled,verified,proof:proofReport};
  }catch(e){
    if(e?.name==='AbortError'){
      this.repairContext();
      this.messages.push({role:'assistant',content:'[Turn cancelled by user]'});
      this.events.onCancelled?.();
      const proofReport=proof.finish({completed:false,cancelled:true,stalled:false});this.lastProof=proofReport;this.trace('turn.end',{status:'cancelled',proof:proofReport});
      return{text:finalText,usage:this.lastUsage,totalThisTurn,cancelled:true,completed:false,stalled:false,verified,proof:proofReport};
    }
    const proofReport=proof.finish({completed:false,cancelled:false,stalled});this.lastProof=proofReport;this.trace('turn.error',{error:String(e.message||e),proof:proofReport});
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
