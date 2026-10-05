import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import path from 'node:path';
const execFileP=promisify(execFile);
const makeId=()=>`proc-${crypto.randomBytes(4).toString('hex')}`;

export class ProcessManager{
  constructor({cwd=process.cwd(),maxBufferChars=60000,maxProcesses=8}={}){this.cwd=path.resolve(cwd);this.maxBufferChars=Math.max(1000,maxBufferChars);this.maxProcesses=Math.max(1,Math.min(32,Number(maxProcesses||8)));this.jobs=new Map();}
  _append(job,chunk){job.output=(job.output+String(chunk||'')).slice(-this.maxBufferChars);}
  _public(job){return{id:job.id,pid:job.pid||0,command:job.command,running:job.running,exitCode:job.exitCode,signal:job.signal,startedAt:job.startedAt,endedAt:job.endedAt||null};}
  async start({command,exe,args=[],cwd=this.cwd,env={}}={}){
    if(!exe)throw new Error('Process executable is required');
    const running=[...this.jobs.values()].filter(x=>x.running).length;if(running>=this.maxProcesses)throw new Error(`Background process limit reached (${this.maxProcesses} running process${this.maxProcesses===1?'':'es'})`);
    const id=makeId(),job={id,command:String(command||exe),exe,args:[...args],cwd:path.resolve(cwd),output:'',running:true,exitCode:null,signal:null,startedAt:new Date().toISOString(),endedAt:null,child:null,pid:0};
    const child=spawn(exe,args,{cwd:job.cwd,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
    job.child=child;job.pid=child.pid||0;this.jobs.set(id,job);
    child.stdout?.on('data',x=>this._append(job,x));child.stderr?.on('data',x=>this._append(job,x));
    child.once('error',e=>{this._append(job,`\n[process error] ${e.message}\n`);job.running=false;job.endedAt=new Date().toISOString();});
    child.once('exit',(code,signal)=>{job.running=false;job.exitCode=code;job.signal=signal||null;job.endedAt=new Date().toISOString();});
    return this._public(job);
  }
  _get(id){const job=this.jobs.get(id);if(!job)throw new Error(`Unknown process handle: ${id}`);return job;}
  status(id){return this._public(this._get(id));}
  list(){return[...this.jobs.values()].map(x=>this._public(x));}
  logs(id,{tailChars=this.maxBufferChars}={}){const out=this._get(id).output;return out.slice(-Math.max(100,Math.min(this.maxBufferChars,tailChars)));}
  async stop(id){
    const job=this._get(id);if(!job.running)return{ok:true,id,alreadyStopped:true};
    try{
      if(process.platform==='win32'&&job.pid)await execFileP('taskkill',['/PID',String(job.pid),'/T','/F'],{windowsHide:true});
      else job.child.kill('SIGTERM');
    }catch(e){if(job.running){try{job.child.kill('SIGKILL');}catch{}this._append(job,`\n[stop warning] ${e.message}\n`);}}
    return{ok:true,id};
  }
  async stopAll(){await Promise.all([...this.jobs.values()].filter(x=>x.running).map(x=>this.stop(x.id).catch(()=>({ok:false}))));}
}
