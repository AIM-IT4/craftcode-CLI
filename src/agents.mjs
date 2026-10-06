import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {APP_DIR} from './config.mjs';
import {AgentSession} from './agent.mjs';
import {ToolRegistry} from './tools.mjs';
import {CheckpointManager} from './checkpoints.mjs';
const execFileP=promisify(execFile);
const ROLES={
 planner:'Decompose the parent task into a small read-only dependency graph. Return strict JSON only, with a top-level tasks array; each task has id, role, task, and dependsOn.',
 explorer:'Inspect the repository narrowly, identify relevant files and likely implementation path. Do not modify files.',
 researcher:'Research the requested technical question using available local skills/connectors. Return concise evidence and recommendations. Do not modify files.',
 tester:'Inspect tests, failure modes, and verification strategy. You may run read-only test discovery but do not modify files.',
 reviewer:'Review the relevant implementation/diff for correctness, regressions, security, and missing tests. Do not modify files.',
 writer:'Implement the assigned change in an isolated Git worktree. Run focused verification only when shell execution was explicitly authorized, and return the patch summary.'
};
const READ_ONLY_ORCHESTRATION_ROLES=new Set(['explorer','tester','reviewer','researcher']);
function parseOrchestrationPlan(text,maxTasks=6){
  const raw=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
  if(start<0||end<=start)throw new Error('Planner did not return a JSON task graph');
  let data;try{data=JSON.parse(raw.slice(start,end+1));}catch(e){throw new Error(`Planner returned invalid JSON: ${e.message}`);}
  if(!Array.isArray(data.tasks)||!data.tasks.length)throw new Error('Planner task graph requires a non-empty tasks array');
  if(data.tasks.length>maxTasks)throw new Error(`Planner task graph exceeds ${maxTasks} tasks`);
  const ids=new Set(),tasks=data.tasks.map((x,idx)=>{
    const id=String(x?.id||'').trim(),role=String(x?.role||'').trim(),task=String(x?.task||'').trim(),dependsOn=Array.isArray(x?.dependsOn)?x.dependsOn.map(String):[];
    if(!id||ids.has(id))throw new Error(`Planner task id is missing or duplicated at index ${idx}`);
    if(!READ_ONLY_ORCHESTRATION_ROLES.has(role))throw new Error(`Orchestration workers are read-only; role ${role||'(missing)'} is not allowed`);
    if(!task)throw new Error(`Planner task ${id} is missing task text`);
    ids.add(id);return{id,role,task,dependsOn};
  });
  for(const x of tasks)for(const dep of x.dependsOn)if(!ids.has(dep)||dep===x.id)throw new Error(`Invalid dependency ${dep} for task ${x.id}`);
  const indegree=new Map(tasks.map(x=>[x.id,x.dependsOn.length])),next=new Map(tasks.map(x=>[x.id,[]]));
  for(const x of tasks)for(const dep of x.dependsOn)next.get(dep).push(x.id);
  const q=tasks.filter(x=>indegree.get(x.id)===0).map(x=>x.id);let seen=0;
  while(q.length){const id=q.shift();seen++;for(const n of next.get(id)){indegree.set(n,indegree.get(n)-1);if(indegree.get(n)===0)q.push(n);}}
  if(seen!==tasks.length)throw new Error('Planner dependency graph contains a cycle');
  return{tasks};
}

const id=()=>crypto.randomBytes(3).toString('hex');
const clip=(s,n=12000)=>String(s||'').length>n?String(s).slice(0,n)+'\n… clipped':String(s||'');
export class AgentManager{
 constructor({client,model,cwd,config,usage,skills,plugins,mcp,events={},projectInstructions=[]}){Object.assign(this,{client,model,cwd,config,usage,skills,plugins,mcp,events,projectInstructions});this.jobs=new Map();this.arenas=new Map();}
 list(){return[...this.jobs.values()].map(x=>({id:x.id,role:x.role,status:x.status,provider:x.provider||'',model:x.model,budget:x.budget,used:x.used||0,task:x.task,error:x.error||'',result:x.result||'',worktree:x.worktree||'',activity:x.activity||'',shellAllowed:!!x.shellAllowed,patchBytes:x.patchBytes||0,proofScore:x.proof?.score??null}));}
 _emit(){this.events.onChange?.(this.list());}
 async _worktree(job){try{await execFileP('git',['rev-parse','--is-inside-work-tree'],{cwd:this.cwd});}catch{return null;}const root=path.join(APP_DIR,'worktrees',crypto.createHash('sha1').update(this.cwd).digest('hex').slice(0,10)),dir=path.join(root,job.id);await fs.mkdir(root,{recursive:true});await execFileP('git',['worktree','add','--detach',dir,'HEAD'],{cwd:this.cwd,maxBuffer:5_000_000});job.worktree=dir;return dir;}
 async _cleanup(job){if(!job.worktree)return;try{await execFileP('git',['worktree','remove','--force',job.worktree],{cwd:this.cwd,maxBuffer:5_000_000});}catch{} }
 async run({role='explorer',task,model,budget,worktree=false,allowShell=false,client=null,provider=''}){if(!task)throw new Error('Agent task is required');role=ROLES[role]?role:'explorer';const runClient=client||this.client;const job={id:`${role}-${id()}`,role,task,status:'starting',provider:String(provider||''),model:model||this.model,budget:Math.max(25_000,Number(budget||this.config.agents?.defaultBudgetTokens||120_000)),used:0,startedAt:Date.now(),shellAllowed:role==='writer'&&!!allowShell};this.jobs.set(job.id,job);this._emit();let agentCwd=this.cwd;
   try{if(worktree||role==='writer'){const isolated=await this._worktree(job);if(!isolated)throw new Error('Writer agents require a Git repository because edits must run in an isolated worktree.');agentCwd=isolated;}job.status='running';this._emit();const subHook=await this.plugins.hook('subagent.start',{role,task,cwd:agentCwd});const childConfig=structuredClone(this.config);childConfig.permissions={write:role==='writer'?'allow':'deny',shell:role==='writer'&&allowShell?'allow':'deny',mcp:'deny'};childConfig.maxAgentSteps=Math.min(childConfig.maxAgentSteps||20,this.config.agents?.maxSteps||10);const checkpoints=role==='writer'?await new CheckpointManager(agentCwd).init():null;let lastText='';const tools=new ToolRegistry({cwd:agentCwd,config:childConfig,skills:this.skills,plugins:this.plugins,mcp:this.mcp,checkpoints,yes:false,askFn:async()=>false,allowDelegation:false});const events={onText:t=>{lastText+=t;},onUsage:u=>{job.used+=(u?.total_tokens||0);this._emit();},onToolStart:x=>{job.activity=x.name;this._emit();},onToolEnd:()=>{job.activity='';this._emit();}};const session=new AgentSession({client:runClient,model:job.model,cwd:agentCwd,mode:role==='writer'?'build':'plan',effort:'normal',config:childConfig,usage:this.usage,skills:this.skills,plugins:this.plugins,mcp:this.mcp,tools,checkpoints,events,turnTokenBudget:job.budget,projectInstructions:this.projectInstructions});session.clear();if(subHook?.length)session.setPluginContext(subHook);const shellNote=role==='writer'?(allowShell?'Shell verification is authorized for this isolated worktree.':'Shell execution is not authorized; make the code change but do not claim tests ran.'):'Read-only role: do not modify files.';const prompt=`You are a ${role} subagent. ${ROLES[role]}\n${shellNote}\n\nParent task:\n${task}\n\nStay within roughly ${job.budget} tokens and return only useful findings/results for the supervisor.`;const rr=await session.run(prompt);job.used=Math.max(job.used,rr.totalThisTurn||0);let patch='';if(job.worktree){try{await execFileP('git',['add','-N','.'],{cwd:agentCwd,maxBuffer:8_000_000});}catch{}try{patch=(await execFileP('git',['diff','--binary','HEAD'],{cwd:agentCwd,maxBuffer:30_000_000})).stdout;}catch{}}job.status='done';job.result=clip(lastText||rr.text||'No textual result.');job.patch=patch;job.patchBytes=Buffer.byteLength(patch||'');job.proof=rr.proof||null;job.durationMs=Date.now()-job.startedAt;this._emit();return{...job};}catch(e){job.status='error';job.error=e.message||String(e);job.durationMs=Date.now()-job.startedAt;this._emit();return{...job};}finally{if(job.worktree&&this.config.agents?.keepWorktrees!==true)await this._cleanup(job);}}
 async orchestrate({task,maxWorkers=3,budgetPerAgent,model}={}){
   if(!task)throw new Error('Orchestration task is required');
   const maxTasks=Math.max(1,Math.min(8,this.config.agents?.maxOrchestrationTasks||6));
   const budget=Math.max(25_000,Number(budgetPerAgent||this.config.agents?.defaultBudgetTokens||120_000));
   const planner=await this.run({role:'planner',task:`Plan this task as at most ${maxTasks} read-only work items. Allowed roles: explorer, tester, researcher, reviewer. Use dependsOn only for real prerequisites. Return JSON only: {"tasks":[{"id":"short-id","role":"explorer","task":"specific work","dependsOn":[]}]}\n\nTask:\n${task}`,model,budget:Math.min(budget,80_000)});
   if(planner.status!=='done')throw new Error(`Planner failed: ${planner.error||planner.result||planner.status}`);
   const plan=parseOrchestrationPlan(planner.result,maxTasks),pending=new Map(plan.tasks.map(x=>[x.id,x])),done=new Map(),workers=[];
   const limit=Math.max(1,Math.min(Number(maxWorkers||3),this.parallelLimit(),6));
   while(pending.size){
     const ready=[...pending.values()].filter(x=>x.dependsOn.every(d=>done.has(d)));
     if(!ready.length)throw new Error('Planner dependency graph cannot make progress');
     for(let off=0;off<ready.length;off+=limit){
       const batch=ready.slice(off,off+limit);
       const rs=await Promise.all(batch.map(x=>{
         const deps=x.dependsOn.map(d=>`[${d}] ${done.get(d)?.result||done.get(d)?.error||'no result'}`).join('\n');
         const workerTask=`${x.task}${deps?`\n\nDependency evidence:\n${deps}`:''}\n\nParent objective:\n${task}`;
         return this.run({role:x.role,task:workerTask,model,budget});
       }));
       rs.forEach((r,idx)=>{const spec=batch[idx],entry={...r,id:spec.id,plannedRole:spec.role,dependsOn:spec.dependsOn};workers.push(entry);done.set(spec.id,entry);pending.delete(spec.id);});
     }
   }
   const evidence=workers.map(x=>`[${x.id} · ${x.plannedRole} · ${x.status}]\n${clip(x.result||x.error||'',5000)}`).join('\n\n');
   const review=await this.run({role:'reviewer',task:`Review the worker evidence against the parent objective. Reconcile conflicts, call out missing verification, and give the supervisor a concise final synthesis.\n\nParent objective:\n${task}\n\nWorker evidence:\n${evidence}`,model,budget:Math.min(budget,100_000)});
   return{plan,planner,workers,review};
 }
 parallelLimit(){const configured=Math.max(1,Math.min(6,this.config.agents?.maxParallel||4)),tpm=this.client.rateLimits?.tpmLimit;if(!tpm)return Math.min(2,configured);if(tpm<=250_000)return 1;if(tpm<=500_000)return Math.min(2,configured);if(tpm<=1_000_000)return Math.min(3,configured);return configured;}
 async team({task,count=3,roles,budgetPerAgent,model}){const n=Math.max(1,Math.min(6,count)),base=roles?.length?roles:['explorer','tester','reviewer','researcher'],roleList=Array.from({length:n},(_,i)=>base[i%base.length]),results=new Array(n),limit=Math.min(n,this.parallelLimit());let next=0;const worker=async()=>{while(true){const i=next++;if(i>=n)return;results[i]=await this.run({role:roleList[i],task,model,budget:budgetPerAgent});}};await Promise.all(Array.from({length:limit},()=>worker()));return results;}
 async spawn(opts){const p=this.run(opts);p.catch(()=>{});return [...this.jobs.values()].at(-1);}

 async arena({task,count=2,candidates=[],allowShell=false,budgetPerAgent}={}){
   if(!task)throw new Error('Arena task is required');
   const n=Math.max(2,Math.min(6,Number(count)||2)),base=candidates.length?candidates:[{client:this.client,model:this.model,provider:'current'}],specs=[];
   for(let i=0;i<n;i++)specs.push(base[i%base.length]);
   const arenaId=`arena-${id()}`,results=new Array(n),limit=Math.max(1,Math.min(n,this.parallelLimit(),this.config.agents?.maxParallel||4));let next=0;
   const worker=async()=>{while(true){const i=next++;if(i>=n)return;const spec=specs[i];results[i]=await this.run({role:'writer',task:`Independent arena candidate ${i+1}/${n}. Solve the task directly in the isolated worktree. Do not imitate other candidates; optimize for correctness, minimal scope, and verifiable evidence.\n\nTask:\n${task}`,model:spec.model||this.model,client:spec.client||this.client,provider:spec.provider||'current',budget:budgetPerAgent||this.config.agents?.defaultBudgetTokens,worktree:true,allowShell});}};
   await Promise.all(Array.from({length:limit},()=>worker()));
   const scored=results.map((r,i)=>{const proofScore=Number.isFinite(r?.proof?.score)?r.proof.score:0,eligible=r?.status==='done'&&r?.patchBytes>0;return{candidateId:`c${i+1}`,jobId:r?.id||'',provider:r?.provider||specs[i]?.provider||'current',model:r?.model||specs[i]?.model||this.model,status:r?.status||'error',patchBytes:r?.patchBytes||0,proof:r?.proof||null,proofScore,eligible,result:r?.result||r?.error||''};});
   const ranked=[...scored].sort((a,b)=>(Number(b.eligible)-Number(a.eligible))||(b.proofScore-a.proofScore)||(a.patchBytes-b.patchBytes)||a.candidateId.localeCompare(b.candidateId));
   const winner=ranked.find(x=>x.eligible)||ranked[0],record={id:arenaId,task,createdAt:new Date().toISOString(),candidates:scored,winnerId:winner?.candidateId||'',winnerJobId:winner?.jobId||''};this.arenas.set(arenaId,record);return record;
 }
 arenaList(){return[...this.arenas.values()].map(x=>({id:x.id,task:x.task,createdAt:x.createdAt,winnerId:x.winnerId,candidates:x.candidates.length}));}
 arenaSummary(a){if(!a)return'No arena result.';const rows=a.candidates.map(x=>`${x.candidateId===a.winnerId?'★':' '} ${x.candidateId} · ${x.provider||'current'} / ${x.model} · ${x.status} · proof ${x.proofScore}/100 · patch ${Math.round((x.patchBytes||0)/1024)} KB`);return`Arena ${a.id}\n\n${rows.join('\n')}\n\nWinner: ${a.winnerId||'none'} (deterministic ranking: valid patch → proof score → smaller patch). Use /arena apply ${a.id} [candidate] to apply after review.`;}
 async applyArena(arenaId,candidate='winner'){const a=this.arenas.get(arenaId);if(!a)throw new Error(`Unknown arena ${arenaId}`);const c=candidate==='winner'||!candidate?a.candidates.find(x=>x.candidateId===a.winnerId):a.candidates.find(x=>x.candidateId===candidate||x.jobId===candidate);if(!c)throw new Error(`Unknown arena candidate ${candidate}`);return this.apply(c.jobId);}
 async apply(id){const job=this.jobs.get(id);if(!job)throw new Error(`Unknown agent ${id}`);if(!job.patch)throw new Error(`Agent ${id} has no patch to apply`);const dir=path.join(APP_DIR,'patches');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,`${job.id}.patch`);await fs.writeFile(file,job.patch);try{await execFileP('git',['apply','--3way',file],{cwd:this.cwd,maxBuffer:8_000_000});return{ok:true,message:`Applied ${job.id} patch to main workspace.`};}catch(e){return{ok:false,message:`Could not apply ${job.id} automatically: ${e.stderr||e.message}`};}}
 summary(results){return results.map(r=>`[${r.role} · ${r.status} · ${Math.round((r.used||0)/1000)}k tokens]\n${r.result||r.error||''}${r.patch?`\nPatch preview (${r.patchBytes||Buffer.byteLength(r.patch)} bytes):\n${clip(r.patch,6000)}`:''}`).join('\n\n');}
}
