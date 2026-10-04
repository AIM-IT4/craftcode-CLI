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
 explorer:'Inspect the repository narrowly, identify relevant files and likely implementation path. Do not modify files.',
 researcher:'Research the requested technical question using available local skills/connectors. Return concise evidence and recommendations. Do not modify files.',
 tester:'Inspect tests, failure modes, and verification strategy. You may run read-only test discovery but do not modify files.',
 reviewer:'Review the relevant implementation/diff for correctness, regressions, security, and missing tests. Do not modify files.',
 writer:'Implement the assigned change in an isolated Git worktree, run focused verification, and return the patch summary.'
};
const id=()=>crypto.randomBytes(3).toString('hex');
const clip=(s,n=12000)=>String(s||'').length>n?String(s).slice(0,n)+'\n… clipped':String(s||'');
export class AgentManager{
 constructor({client,model,cwd,config,usage,skills,plugins,mcp,events={},projectInstructions=[]}){Object.assign(this,{client,model,cwd,config,usage,skills,plugins,mcp,events,projectInstructions});this.jobs=new Map();}
 list(){return[...this.jobs.values()].map(x=>({id:x.id,role:x.role,status:x.status,model:x.model,budget:x.budget,used:x.used||0,task:x.task,error:x.error||'',result:x.result||'',worktree:x.worktree||''}));}
 _emit(){this.events.onChange?.(this.list());}
 async _worktree(job){try{await execFileP('git',['rev-parse','--is-inside-work-tree'],{cwd:this.cwd});}catch{return null;}const root=path.join(APP_DIR,'worktrees',crypto.createHash('sha1').update(this.cwd).digest('hex').slice(0,10)),dir=path.join(root,job.id);await fs.mkdir(root,{recursive:true});await execFileP('git',['worktree','add','--detach',dir,'HEAD'],{cwd:this.cwd,maxBuffer:5_000_000});job.worktree=dir;return dir;}
 async _cleanup(job){if(!job.worktree)return;try{await execFileP('git',['worktree','remove','--force',job.worktree],{cwd:this.cwd,maxBuffer:5_000_000});}catch{} }
 async run({role='explorer',task,model,budget,worktree=false}){if(!task)throw new Error('Agent task is required');role=ROLES[role]?role:'explorer';const job={id:`${role}-${id()}`,role,task,status:'starting',model:model||this.model,budget:Math.max(25_000,Number(budget||this.config.agents?.defaultBudgetTokens||250_000)),used:0,startedAt:Date.now()};this.jobs.set(job.id,job);this._emit();let agentCwd=this.cwd;
   try{if(worktree||role==='writer')agentCwd=await this._worktree(job)||this.cwd;job.status='running';this._emit();const subHook=await this.plugins.hook('subagent.start',{role,task,cwd:agentCwd});const childConfig=structuredClone(this.config);childConfig.permissions={write:role==='writer'?'allow':'deny',shell:'deny',mcp:'deny'};childConfig.maxAgentSteps=Math.min(childConfig.maxAgentSteps||20,this.config.agents?.maxSteps||10);const checkpoints=role==='writer'?await new CheckpointManager(agentCwd).init():null;let lastText='';const tools=new ToolRegistry({cwd:agentCwd,config:childConfig,skills:this.skills,plugins:this.plugins,mcp:this.mcp,checkpoints,yes:role==='writer',askFn:async()=>false,allowDelegation:false});const events={onText:t=>{lastText+=t;},onUsage:u=>{job.used+=(u?.total_tokens||0);this._emit();},onToolStart:x=>{job.activity=x.name;this._emit();},onToolEnd:()=>{job.activity='';this._emit();}};const session=new AgentSession({client:this.client,model:job.model,cwd:agentCwd,mode:role==='writer'?'build':'plan',effort:'normal',config:childConfig,usage:this.usage,skills:this.skills,plugins:this.plugins,mcp:this.mcp,tools,checkpoints,events,turnTokenBudget:job.budget,projectInstructions:this.projectInstructions});session.clear();if(subHook?.length)session.setPluginContext(subHook);const prompt=`You are a ${role} subagent. ${ROLES[role]}\n\nParent task:\n${task}\n\nStay within roughly ${job.budget} tokens and return only useful findings/results for the supervisor.`;const r=await session.run(prompt);job.used=Math.max(job.used,r.totalThisTurn||0);let patch='';if(job.worktree){try{await execFileP('git',['add','-N','.'],{cwd:agentCwd,maxBuffer:8_000_000});}catch{}try{patch=(await execFileP('git',['diff','--binary','HEAD'],{cwd:agentCwd,maxBuffer:8_000_000})).stdout;}catch{}}job.status='done';job.result=clip(lastText||r.text||'No textual result.');job.patch=clip(patch,20000);job.durationMs=Date.now()-job.startedAt;this._emit();return{...job};}catch(e){job.status='error';job.error=e.message||String(e);job.durationMs=Date.now()-job.startedAt;this._emit();return{...job};}finally{if(job.worktree&&this.config.agents?.keepWorktrees!==true)await this._cleanup(job);}}
 async team({task,count=3,roles,budgetPerAgent,model}){const n=Math.max(1,Math.min(6,count)),base=roles?.length?roles:['explorer','tester','reviewer','researcher'],roleList=Array.from({length:n},(_,i)=>base[i%base.length]);const jobs=roleList.map(role=>this.run({role,task,model,budget:budgetPerAgent}));return Promise.all(jobs);}
 async spawn(opts){const p=this.run(opts);p.catch(()=>{});return [...this.jobs.values()].at(-1);}

 async apply(id){const job=this.jobs.get(id);if(!job)throw new Error(`Unknown agent ${id}`);if(!job.patch)throw new Error(`Agent ${id} has no patch to apply`);const dir=path.join(APP_DIR,'patches');await fs.mkdir(dir,{recursive:true});const file=path.join(dir,`${job.id}.patch`);await fs.writeFile(file,job.patch);try{await execFileP('git',['apply','--3way',file],{cwd:this.cwd,maxBuffer:8_000_000});return{ok:true,message:`Applied ${job.id} patch to main workspace.`};}catch(e){return{ok:false,message:`Could not apply ${job.id} automatically: ${e.stderr||e.message}`};}}
 summary(results){return results.map(r=>`[${r.role} · ${r.status} · ${Math.round((r.used||0)/1000)}k tokens]\n${r.result||r.error||''}${r.patch?`\nPatch preview:\n${r.patch}`:''}`).join('\n\n');}
}
