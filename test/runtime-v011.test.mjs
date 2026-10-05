import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {SemanticIndex} from '../src/semantic.mjs';
import {ToolRegistry} from '../src/tools.mjs';

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
