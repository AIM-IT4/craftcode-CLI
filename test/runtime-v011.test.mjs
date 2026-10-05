import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

import {SemanticIndex} from '../src/semantic.mjs';
import {ToolRegistry} from '../src/tools.mjs';
import {AgentManager} from '../src/agents.mjs';
import {CommandPolicy} from '../src/policy.mjs';
import {ProcessManager} from '../src/processes.mjs';
import {discoverProjectCommands} from '../src/project_commands.mjs';
import {ToolCache} from '../src/cache.mjs';
import {runRuntimeEvals} from '../src/evals.mjs';

const execFileP=promisify(execFile);

const deps=()=>({
  skills:{list:()=>[],load:async()=>({})},
  plugins:{list:()=>[],toolEntries:()=>[],activate:()=>{}},
  mcp:{list:()=>[],tools:async()=>[],call:async()=>({})}
});

test('semantic index returns AST-backed symbols for TypeScript and TSX',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-semantic-'));
  try{
    await fs.writeFile(path.join(dir,'sample.tsx'),[
      'export interface User { id: string }',
      'export const answer = 42;',
      'export function greet(user: User) { return user.id; }',
      'export class Greeter { run(user: User) { return greet(user); } }'
    ].join('\n'));
    const semantic=new SemanticIndex({cwd:dir});
    const r=await semantic.query({action:'symbols',path:'sample.tsx'});
    assert.equal(r.engine,'typescript-ast');
    const names=new Set(r.items.map(x=>x.name));
    for(const name of ['User','answer','greet','Greeter'])assert.ok(names.has(name),name);
    assert.ok(r.items.every(x=>Number.isInteger(x.line)&&x.line>=1));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('semantic definition resolves declarations across workspace TypeScript files',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-semantic-def-'));
  try{
    await fs.mkdir(path.join(dir,'src'),{recursive:true});
    await fs.writeFile(path.join(dir,'src','a.ts'),'export function priceRisk(x:number){ return x*x; }\n');
    await fs.writeFile(path.join(dir,'src','b.ts'),"import {priceRisk} from './a.js';\nexport const out=priceRisk(3);\n");
    const semantic=new SemanticIndex({cwd:dir});
    const r=await semantic.query({action:'definition',symbol:'priceRisk',path:'src'});
    assert.equal(r.engine,'typescript-ast');
    assert.ok(r.items.some(x=>x.path==='src/a.ts'&&x.name==='priceRisk'&&x.line===1));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('semantic references return bounded identifier occurrences with declaration metadata',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-semantic-ref-'));
  try{
    await fs.writeFile(path.join(dir,'a.ts'),'export const alpha=1;\nexport function f(){ return alpha+alpha; }\n');
    const semantic=new SemanticIndex({cwd:dir});
    const r=await semantic.query({action:'references',symbol:'alpha',path:'.'});
    assert.equal(r.engine,'typescript-ast');
    assert.ok(r.items.length>=3);
    assert.ok(r.items.some(x=>x.declaration===true));
    assert.ok(r.items.every(x=>x.path==='a.ts'));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('semantic lookup rejects workspace escapes and reports unsupported languages without pretending AST coverage',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-semantic-safe-'));
  try{
    await fs.writeFile(path.join(dir,'notes.txt'),'alpha beta');
    const semantic=new SemanticIndex({cwd:dir});
    await assert.rejects(()=>semantic.query({action:'symbols',path:'../outside.ts'}),/escapes workspace/i);
    const r=await semantic.query({action:'symbols',path:'notes.txt'});
    assert.equal(r.engine,'unsupported');
    assert.deepEqual(r.items,[]);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('ToolRegistry exposes semantic_code as a read-only parallel-safe tool',()=>{
  const {skills,plugins,mcp}=deps();
  const registry=new ToolRegistry({cwd:process.cwd(),config:{permissions:{},ignore:[],tokenGuard:{}},skills,plugins,mcp});
  const def=registry.definitions('plan').find(x=>x.function?.name==='semantic_code');
  assert.ok(def);
  assert.equal(registry.isParallelSafe('semantic_code'),true);
});


test('command policy allows inert local commands but asks for project-code and external-impact execution on host',()=>{
  const policy=new CommandPolicy({cwd:process.cwd()});
  assert.equal(policy.evaluate('git status').decision,'allow');
  for(const command of ['npm test','node --test test/basic.test.mjs','git push origin main','npm publish','curl https://example.com','vercel deploy']){
    const r=policy.evaluate(command);
    assert.equal(r.decision,'ask',command);
    assert.ok(r.reason);
  }
  assert.equal(policy.evaluate('git status && npm publish').decision,'ask');

  const sandboxed=new CommandPolicy({cwd:process.cwd(),sandbox:'docker'});
  assert.equal(sandboxed.evaluate('npm test').decision,'allow');
  assert.equal(sandboxed.evaluate('git push origin main').decision,'ask');
});

test('command policy denies catastrophic host commands even when shell permission is otherwise automatic',()=>{
  const policy=new CommandPolicy({cwd:process.cwd()});
  const commands=process.platform==='win32'
    ? ['Remove-Item C:\\\\ -Recurse -Force','git clean -fdx']
    : ['rm -rf /','git clean -fdx','git reset --hard','shutdown -h now'];
  for(const command of commands){
    const r=policy.evaluate(command);
    assert.equal(r.decision,'deny',command);
    assert.equal(r.kind,'dangerous');
  }
});

test('Docker sandbox wrapper disables network and mounts only the workspace',()=>{
  const cwd=path.resolve(process.cwd());
  const policy=new CommandPolicy({cwd,sandbox:'docker',dockerImage:'node:20-bookworm-slim'});
  const r=policy.wrap('npm test');
  assert.equal(r.exe,'docker');
  assert.ok(r.args.includes('--network'));
  assert.ok(r.args.includes('none'));
  assert.ok(r.args.includes('--rm'));
  assert.ok(r.args.includes('-w'));
  assert.ok(r.args.includes('/workspace'));
  assert.ok(r.args.some(x=>String(x).includes(':\/workspace')||String(x).endsWith(':/workspace')));
  assert.equal(r.args.at(-1),'npm test');
});

test('ToolRegistry refuses policy-denied shell commands before execution',async()=>{
  const {skills,plugins,mcp}=deps();
  let approvals=0;
  const registry=new ToolRegistry({
    cwd:process.cwd(),
    config:{permissions:{shell:'allow'},ignore:[],tokenGuard:{},shell:{sandbox:'host'}},
    skills,plugins,mcp,askFn:async()=>{approvals++;return true;}
  });
  const r=await registry.execute('run_command',{command:'git clean -fdx'},'build');
  assert.match(String(r),/denied by policy/i);
  assert.equal(approvals,0);
});

test('ToolRegistry asks for external-impact commands even when shell permission is allow',async()=>{
  const {skills,plugins,mcp}=deps();
  let approvals=0;
  const registry=new ToolRegistry({
    cwd:process.cwd(),
    config:{permissions:{shell:'allow'},ignore:[],tokenGuard:{},shell:{sandbox:'host'}},
    skills,plugins,mcp,askFn:async q=>{approvals++;assert.match(q,/external|network|publish|deploy|push/i);return false;}
  });
  const r=await registry.execute('run_command',{command:'npm publish'},'build');
  assert.match(String(r),/denied by user/i);
  assert.equal(approvals,1);
});


const waitFor=async(fn,{timeout=3000,interval=25}={})=>{
  const end=Date.now()+timeout;
  while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,interval));}
  throw new Error('Timed out waiting for condition');
};

test('ProcessManager starts, tails and stops an owned background process',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-process-'));
  const pm=new ProcessManager({cwd:dir,maxBufferChars:4000});
  try{
    const p=await pm.start({
      command:'node fixture server',
      exe:process.execPath,
      args:['-e',"console.log('CRAFT_READY');setInterval(()=>{},1000)"],
      cwd:dir
    });
    assert.match(p.id,/^proc-/);
    await waitFor(()=>pm.logs(p.id).includes('CRAFT_READY'));
    const live=pm.status(p.id);
    assert.equal(live.running,true);
    assert.ok(live.pid>0);
    const stopped=await pm.stop(p.id);
    assert.equal(stopped.ok,true);
    await waitFor(()=>pm.status(p.id).running===false);
  }finally{await pm.stopAll();await fs.rm(dir,{recursive:true,force:true});}
});

test('ProcessManager bounds retained output',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-process-buffer-'));
  const pm=new ProcessManager({cwd:dir,maxBufferChars:1000});
  try{
    const p=await pm.start({
      command:'node noisy',
      exe:process.execPath,
      args:['-e',"console.log('x'.repeat(5000))"],
      cwd:dir
    });
    await waitFor(()=>pm.status(p.id).running===false);
    const logs=pm.logs(p.id);
    assert.ok(logs.length<=1100,`logs retained ${logs.length} chars`);
    assert.ok(logs.includes('x'));
  }finally{await pm.stopAll();await fs.rm(dir,{recursive:true,force:true});}
});

test('project command discovery uses declared package scripts instead of inventing commands',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-discovery-'));
  try{
    await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({
      scripts:{test:'node test.js',lint:'eslint .',typecheck:'tsc --noEmit',build:'vite build',dev:'vite'}
    }));
    const rows=await discoverProjectCommands(dir);
    const byKind=Object.fromEntries(rows.map(x=>[x.kind,x]));
    assert.equal(byKind.test.command,'npm test');
    assert.equal(byKind.lint.command,'npm run lint');
    assert.equal(byKind.typecheck.command,'npm run typecheck');
    assert.equal(byKind.build.command,'npm run build');
    assert.equal(byKind.dev.command,'npm run dev');
    assert.ok(rows.every(x=>x.source==='package.json'));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('project command discovery recognizes standard Go and Cargo projects',async()=>{
  const go=await fs.mkdtemp(path.join(os.tmpdir(),'craft-go-')),rust=await fs.mkdtemp(path.join(os.tmpdir(),'craft-rust-'));
  try{
    await fs.writeFile(path.join(go,'go.mod'),'module example.test/x\n\ngo 1.22\n');
    await fs.writeFile(path.join(rust,'Cargo.toml'),'[package]\nname="x"\nversion="0.1.0"\n');
    const goRows=await discoverProjectCommands(go),rustRows=await discoverProjectCommands(rust);
    assert.ok(goRows.some(x=>x.kind==='test'&&x.command==='go test ./...'));
    assert.ok(rustRows.some(x=>x.kind==='test'&&x.command==='cargo test'));
  }finally{await fs.rm(go,{recursive:true,force:true});await fs.rm(rust,{recursive:true,force:true});}
});

test('ToolRegistry exposes process handles and command discovery with correct read/write boundaries',()=>{
  const {skills,plugins,mcp}=deps();
  const registry=new ToolRegistry({cwd:process.cwd(),config:{permissions:{},ignore:[],tokenGuard:{},shell:{sandbox:'host'}},skills,plugins,mcp});
  const plan=new Set(registry.definitions('plan').map(x=>x.function.name));
  const build=new Set(registry.definitions('build').map(x=>x.function.name));
  for(const name of ['discover_project_commands','process_status','process_logs','process_list'])assert.ok(plan.has(name),name);
  for(const name of ['process_start','process_stop'])assert.ok(build.has(name),name);
  assert.equal(plan.has('process_start'),false);
});


test('AgentManager orchestration honors dependencies and runs a reviewer after workers',async()=>{
  const manager=new AgentManager({
    client:{rateLimits:{}},model:'m',cwd:process.cwd(),
    config:{agents:{maxParallel:3,defaultBudgetTokens:30000}},usage:{},skills:{},plugins:{},mcp:{}
  });
  const events=[],seenTasks=[];
  manager.run=async({role,task})=>{
    seenTasks.push({role,task});
    if(role==='planner')return{status:'done',result:JSON.stringify({tasks:[
      {id:'scan',role:'explorer',task:'scan code',dependsOn:[]},
      {id:'research',role:'researcher',task:'check docs',dependsOn:[]},
      {id:'tests',role:'tester',task:'inspect tests',dependsOn:['scan']}
    ]})};
    if(role==='reviewer'){events.push('review');return{status:'done',result:'reviewed'};}
    const id=/scan code/.test(task)?'scan':/check docs/.test(task)?'research':'tests';
    events.push('start:'+id);
    if(id==='scan')await new Promise(r=>setTimeout(r,35));
    if(id==='research')await new Promise(r=>setTimeout(r,10));
    events.push('end:'+id);
    return{status:'done',result:'result-'+id,used:10};
  };
  const r=await manager.orchestrate({task:'understand the bug',maxWorkers:2,budgetPerAgent:30000});
  assert.equal(r.workers.length,3);
  assert.equal(r.review.result,'reviewed');
  assert.ok(events.indexOf('start:tests')>events.indexOf('end:scan'),events.join(','));
  assert.equal(events.at(-1),'review');
  assert.ok(seenTasks.find(x=>x.role==='reviewer').task.includes('result-scan'));
  assert.ok(seenTasks.find(x=>x.role==='reviewer').task.includes('result-tests'));
});

test('AgentManager orchestration rejects cyclic dependency graphs before workers run',async()=>{
  const manager=new AgentManager({
    client:{rateLimits:{}},model:'m',cwd:process.cwd(),
    config:{agents:{maxParallel:2}},usage:{},skills:{},plugins:{},mcp:{}
  });
  let workerRuns=0;
  manager.run=async({role})=>{
    if(role==='planner')return{status:'done',result:JSON.stringify({tasks:[
      {id:'a',role:'explorer',task:'a',dependsOn:['b']},
      {id:'b',role:'tester',task:'b',dependsOn:['a']}
    ]})};
    workerRuns++;return{status:'done',result:'unexpected'};
  };
  await assert.rejects(()=>manager.orchestrate({task:'cycle'}),/cycle|dependency/i);
  assert.equal(workerRuns,0);
});

test('AgentManager orchestration rejects writer roles from planner output',async()=>{
  const manager=new AgentManager({
    client:{rateLimits:{}},model:'m',cwd:process.cwd(),
    config:{agents:{maxParallel:2}},usage:{},skills:{},plugins:{},mcp:{}
  });
  manager.run=async({role})=>role==='planner'
    ?{status:'done',result:JSON.stringify({tasks:[{id:'edit',role:'writer',task:'edit files',dependsOn:[]}]})}
    :{status:'done',result:'unexpected'};
  await assert.rejects(()=>manager.orchestrate({task:'unsafe plan'}),/writer|read-only/i);
});

test('ToolRegistry exposes read-only orchestrate_task when delegation is available',()=>{
  const {skills,plugins,mcp}=deps();
  const agents={orchestrate:async()=>({}),team:async()=>[],summary:()=>''};
  const registry=new ToolRegistry({cwd:process.cwd(),config:{permissions:{},ignore:[],tokenGuard:{},shell:{sandbox:'host'}},skills,plugins,mcp,agents});
  const plan=new Set(registry.definitions('plan').map(x=>x.function.name));
  assert.ok(plan.has('orchestrate_task'));
});


test('ToolCache persists safe results across instances and respects version keys',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-cache-'));
  try{
    const one=new ToolCache({cwd:process.cwd(),dir,maxEntries:20});
    await one.set('read_file',{path:'a.txt'},'v1','cached-value',{ttlMs:60000});
    const two=new ToolCache({cwd:process.cwd(),dir,maxEntries:20});
    const hit=await two.get('read_file',{path:'a.txt'},'v1');
    assert.equal(hit.hit,true);
    assert.equal(hit.value,'cached-value');
    const stale=await two.get('read_file',{path:'a.txt'},'v2');
    assert.equal(stale.hit,false);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('ToolRegistry caches identical file reads and invalidates cache after workspace writes',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-cache-tools-'));
  const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-cache-store-'));
  const {skills,plugins,mcp}=deps();
  try{
    await fs.writeFile(path.join(dir,'a.txt'),'one\n');
    const cache=new ToolCache({cwd:dir,dir:cacheDir,maxEntries:50});
    const registry=new ToolRegistry({
      cwd:dir,config:{permissions:{write:'allow',shell:'deny'},ignore:[],tokenGuard:{},shell:{sandbox:'host'}},
      skills,plugins,mcp,cache
    });
    const first=await registry.execute('read_file',{path:'a.txt'},'plan');
    const second=await registry.execute('read_file',{path:'a.txt'},'plan');
    assert.equal(second,first);
    const before=await registry.execute('cache_stats',{},'plan');
    assert.ok(before.hits>=1,before);
    await registry.execute('write_file',{path:'a.txt',content:'two\n'},'build');
    const third=await registry.execute('read_file',{path:'a.txt'},'plan');
    assert.match(third,/two/);
    assert.doesNotMatch(third,/one/);
    const after=await registry.execute('cache_stats',{},'plan');
    assert.ok(after.invalidations>=1,after);
  }finally{await fs.rm(dir,{recursive:true,force:true});await fs.rm(cacheDir,{recursive:true,force:true});}
});

test('ToolCache semantic path version changes when source metadata changes',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-cache-semantic-'));
  const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-cache-semantic-store-'));
  try{
    await fs.writeFile(path.join(dir,'a.ts'),'export const a=1;\n');
    const cache=new ToolCache({cwd:dir,dir:cacheDir});
    const v1=await cache.versionFor('semantic_code',{action:'symbols',path:'.'});
    await fs.writeFile(path.join(dir,'a.ts'),'export const alphabet=100;\n');
    const v2=await cache.versionFor('semantic_code',{action:'symbols',path:'.'});
    assert.notEqual(v1,v2);
  }finally{await fs.rm(dir,{recursive:true,force:true});await fs.rm(cacheDir,{recursive:true,force:true});}
});

test('runtime eval suite is deterministic and credential-free',async()=>{
  const r=await runRuntimeEvals();
  assert.ok(r.total>=5);
  assert.equal(r.failed,0,JSON.stringify(r.cases.filter(x=>!x.ok)));
  assert.equal(r.passed,r.total);
  assert.ok(r.cases.every(x=>typeof x.name==='string'&&typeof x.ok==='boolean'));
});

test('craftcode eval runtime runs before provider authentication',async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const env={...process.env};
  delete env.CODECRAFT_API_KEY;delete env.OPENROUTER_API_KEY;
  const {stdout}=await execFileP(process.execPath,['src/index.mjs','eval','runtime'],{cwd:root,env});
  assert.match(stdout,/Runtime evals/i);
  assert.match(stdout,/passed/i);
});


test('host command policy approval cannot be bypassed through opaque interpreters or project scripts',()=>{
  const host=new CommandPolicy({cwd:process.cwd(),sandbox:'host'});
  for(const command of [
    "node -e \"require('node:child_process').execSync('rm -rf build')\"",
    "python -c \"import os; os.system('rm -rf build')\"",
    "bash -c 'rm -rf build'",
    'npm test',
    'npm run build',
    'node --test test/basic.test.mjs',
    'rm -rf build'
  ]){
    const r=host.evaluate(command);
    assert.equal(r.decision,'ask',command);
    assert.ok(['project-code','opaque','destructive'].includes(r.kind),`${command}: ${r.kind}`);
  }
  assert.equal(host.evaluate('node --version').decision,'allow');
  assert.equal(host.evaluate('git status').decision,'allow');
});

test('Docker shell policy can auto-run project verification but applies hardening flags',()=>{
  const docker=new CommandPolicy({cwd:process.cwd(),sandbox:'docker'});
  assert.equal(docker.evaluate('npm test').decision,'allow');
  const r=docker.wrap('npm test');
  for(const pair of [['--network','none'],['--cap-drop','ALL'],['--security-opt','no-new-privileges'],['--pids-limit','256']]){
    const i=r.args.indexOf(pair[0]);assert.ok(i>=0,pair[0]);assert.equal(r.args[i+1],pair[1]);
  }
  assert.ok(r.args.includes('--memory'));
  assert.ok(r.args.includes('--cpus'));
});

test('ToolRegistry never persists raw local file contents in the disk cache',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-cache-secret-work-'));
  const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-cache-secret-store-'));
  const {skills,plugins,mcp}=deps();
  try{
    const secret='CRAFT_TEST_SECRET_9bb85e';
    await fs.writeFile(path.join(dir,'.env'),`TOKEN=${secret}\n`);
    const registry=new ToolRegistry({
      cwd:dir,config:{permissions:{},ignore:[],tokenGuard:{},shell:{sandbox:'host'}},
      skills,plugins,mcp,cache:new ToolCache({cwd:dir,dir:cacheDir})
    });
    const first=await registry.execute('read_file',{path:'.env'},'plan');
    const second=await registry.execute('read_file',{path:'.env'},'plan');
    assert.equal(first,second);
    assert.ok((await registry.execute('cache_stats',{},'plan')).hits>=1);
    const files=await fs.readdir(cacheDir);
    let persisted='';for(const name of files)persisted+=await fs.readFile(path.join(cacheDir,name),'utf8').catch(()=> '');
    assert.doesNotMatch(persisted,new RegExp(secret));
  }finally{await fs.rm(dir,{recursive:true,force:true});await fs.rm(cacheDir,{recursive:true,force:true});}
});

test('ToolCache persistent files are private on POSIX',async t=>{
  if(process.platform==='win32'){t.skip('POSIX mode bits do not apply on Windows');return;}
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-cache-mode-'));
  try{
    const cache=new ToolCache({cwd:process.cwd(),dir});
    await cache.set('fetch_url',{url:'https://example.test'},'remote-v1','public',{ttlMs:1000});
    const mode=(await fs.stat(cache.file)).mode&0o777;
    assert.equal(mode&0o077,0);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('host policy gates additional interpreter eval forms',()=>{
  const host=new CommandPolicy({cwd:process.cwd(),sandbox:'host'});
  for(const command of [
    "node -p \"require('node:fs').writeFileSync('x','y')\"",
    "ruby -e \"File.write('x','y')\"",
    "perl -e \"open(F,'>x');print F 'y'\"",
    "php -r \"file_put_contents('x','y');\"",
    "bun -e \"Bun.write('x','y')\"",
    "deno eval \"Deno.writeTextFileSync('x','y')\""
  ]){
    const r=host.evaluate(command);
    assert.equal(r.decision,'ask',command);
    assert.equal(r.kind,'opaque',command);
  }
});

test('Docker sandbox mounts workspace read-only when project code is auto-approved',()=>{
  const cwd=path.resolve(process.cwd());
  const docker=new CommandPolicy({cwd,sandbox:'docker'});
  const r=docker.wrap('npm test');
  const i=r.args.indexOf('-v');
  assert.ok(i>=0);
  assert.ok(String(r.args[i+1]).endsWith(':/workspace:ro'),r.args[i+1]);
  assert.ok(r.args.includes('--tmpfs'));
  assert.ok(r.args.some(x=>String(x).startsWith('/tmp:')));
});

test('project command discovery cache stays memory-only to avoid persisting script bodies',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-command-cache-work-'));
  const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-command-cache-store-'));
  const {skills,plugins,mcp}=deps();
  try{
    const marker='PRIVATE_SCRIPT_MARKER_7f21';
    await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({scripts:{test:`echo ${marker}`}}));
    const cache=new ToolCache({cwd:dir,dir:cacheDir});
    const registry=new ToolRegistry({
      cwd:dir,config:{permissions:{},ignore:[],tokenGuard:{},shell:{sandbox:'host'}},
      skills,plugins,mcp,cache
    });
    const a=await registry.execute('discover_project_commands',{},'plan');
    const b=await registry.execute('discover_project_commands',{},'plan');
    assert.deepEqual(a,b);
    assert.ok((await registry.execute('cache_stats',{},'plan')).hits>=1);
    const names=await fs.readdir(cacheDir).catch(()=>[]);
    let persisted='';for(const name of names)persisted+=await fs.readFile(path.join(cacheDir,name),'utf8').catch(()=> '');
    assert.doesNotMatch(persisted,new RegExp(marker));
  }finally{await fs.rm(dir,{recursive:true,force:true});await fs.rm(cacheDir,{recursive:true,force:true});}
});


test('ProcessManager enforces a cap on concurrently running owned processes',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-process-limit-'));
  const pm=new ProcessManager({cwd:dir,maxBufferChars:1000,maxProcesses:1});
  try{
    const first=await pm.start({
      command:'first sleeper',
      exe:process.execPath,
      args:['-e','setInterval(()=>{},1000)'],
      cwd:dir
    });
    await waitFor(()=>pm.status(first.id).running===true);
    await assert.rejects(
      ()=>pm.start({command:'second sleeper',exe:process.execPath,args:['-e','setInterval(()=>{},1000)'],cwd:dir}),
      /process limit|running process/i
    );
  }finally{await pm.stopAll();await fs.rm(dir,{recursive:true,force:true});}
});
