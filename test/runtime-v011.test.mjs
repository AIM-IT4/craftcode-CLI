import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {SemanticIndex} from '../src/semantic.mjs';
import {ToolRegistry} from '../src/tools.mjs';
import {CommandPolicy} from '../src/policy.mjs';

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


test('command policy allows local verification but asks for external-impact commands',()=>{
  const policy=new CommandPolicy({cwd:process.cwd()});
  assert.equal(policy.evaluate('git status').decision,'allow');
  assert.equal(policy.evaluate('npm test').decision,'allow');
  assert.equal(policy.evaluate('node --test test/basic.test.mjs').decision,'allow');
  for(const command of ['git push origin main','npm publish','curl https://example.com','vercel deploy']){
    const r=policy.evaluate(command);
    assert.equal(r.decision,'ask',command);
    assert.ok(r.reason);
  }
  assert.equal(policy.evaluate('git status && npm publish').decision,'ask');
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
