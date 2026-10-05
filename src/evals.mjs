import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SemanticIndex} from './semantic.mjs';
import {CommandPolicy} from './policy.mjs';
import {ProcessManager} from './processes.mjs';
import {discoverProjectCommands} from './project_commands.mjs';
import {ToolCache} from './cache.mjs';

const waitFor=async(fn,timeout=2500)=>{
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await fn())return true;await new Promise(r=>setTimeout(r,25));}
  return false;
};
export async function runRuntimeEvals(){
  const cases=[],record=async(name,fn)=>{
    try{const detail=await fn();cases.push({name,ok:true,detail:detail??''});}
    catch(e){cases.push({name,ok:false,error:String(e?.message||e)});}
  };
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'craftcode-eval-')),cacheDir=path.join(root,'.cache'),pm=new ProcessManager({cwd:root,maxBufferChars:2000});
  try{
    await record('policy-dangerous-deny',async()=>{
      const r=new CommandPolicy({cwd:root}).evaluate('git clean -fdx');if(r.decision!=='deny')throw new Error(`expected deny, got ${r.decision}`);return r.kind;
    });
    await record('policy-external-ask',async()=>{
      const r=new CommandPolicy({cwd:root}).evaluate('npm publish');if(r.decision!=='ask')throw new Error(`expected ask, got ${r.decision}`);return r.kind;
    });
    await fs.writeFile(path.join(root,'fixture.ts'),'export function alpha(x:number){ return x+1; }\n');
    await record('semantic-symbols',async()=>{
      const r=await new SemanticIndex({cwd:root}).query({action:'symbols',path:'fixture.ts'});
      if(!r.items.some(x=>x.name==='alpha'))throw new Error('alpha symbol not found');return r.engine;
    });
    await fs.writeFile(path.join(root,'package.json'),JSON.stringify({scripts:{test:'node --test'}}));
    await record('project-command-discovery',async()=>{
      const rows=await discoverProjectCommands(root);if(!rows.some(x=>x.kind==='test'&&x.command==='npm test'))throw new Error('npm test not discovered');return rows.length;
    });
    await record('cache-persistence',async()=>{
      const one=new ToolCache({cwd:root,dir:cacheDir});await one.set('read_file',{path:'fixture.ts'},'v1','ok',{ttlMs:60000});
      const two=new ToolCache({cwd:root,dir:cacheDir}),r=await two.get('read_file',{path:'fixture.ts'},'v1');if(!r.hit||r.value!=='ok')throw new Error('persistent cache miss');return'hit';
    });
    await record('process-lifecycle',async()=>{
      const p=await pm.start({command:'runtime eval process',exe:process.execPath,args:['-e',"console.log('eval-process-ok')"],cwd:root});
      if(!await waitFor(()=>pm.status(p.id).running===false))throw new Error('process did not exit');
      if(!pm.logs(p.id).includes('eval-process-ok'))throw new Error('process output missing');return pm.status(p.id).exitCode;
    });
  }finally{await pm.stopAll();await fs.rm(root,{recursive:true,force:true});}
  const passed=cases.filter(x=>x.ok).length,total=cases.length;
  return{passed,failed:total-passed,total,cases};
}
