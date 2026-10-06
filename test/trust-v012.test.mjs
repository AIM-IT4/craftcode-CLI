import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {ProofTracker,formatProof} from '../src/proof.mjs';
import {FlightRecorder,summarizeFlightEvent} from '../src/flight_recorder.mjs';
import {SessionStore} from '../src/sessions.mjs';
import {AgentManager} from '../src/agents.mjs';

test('Proof of Change scores observed evidence instead of model confidence',()=>{
  const p=new ProofTracker({goal:'fix auth',mode:'build'});
  p.tool({name:'write_file',args:{path:'src/auth.mjs'},result:'Wrote src/auth.mjs',mutating:true});
  p.tool({name:'discover_project_commands',result:[{kind:'test',command:'npm test'}]});
  p.tool({name:'git_diff',result:'diff --git a/src/auth.mjs b/src/auth.mjs'});
  p.tool({name:'run_command',args:{command:'npm test'},result:'12 tests passed'});
  const r=p.finish({completed:true});
  assert.equal(r.applicable,true);
  assert.equal(r.score,100);
  assert.equal(r.passed,1);
  assert.match(formatProof(r),/100\/100/);
});

test('Proof of Change does not count denied writes or failed verification as evidence',()=>{
  const p=new ProofTracker({goal:'unsafe edit',mode:'build'});
  p.tool({name:'write_file',args:{path:'x'},result:'Denied by user',mutating:true});
  let r=p.finish({completed:false});
  assert.equal(r.applicable,false);
  const q=new ProofTracker({goal:'edit',mode:'build'});
  q.tool({name:'write_file',args:{path:'x'},result:'Wrote x',mutating:true});
  q.tool({name:'run_command',args:{command:'npm test'},result:'boom\n(exit 1)'});
  r=q.finish({completed:true});
  assert.equal(r.failed,1);
  assert.ok(r.score<65,r.score);
});

test('Flight Recorder persists private redacted event metadata and timeline hashes',async()=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'craft-flight-work-')),rec=await new FlightRecorder(cwd,{maxRuns:10}).init();
  try{
    const id=await rec.begin({sessionId:'s-1',provider:'codecraft',model:'craft-model',goal:'fix bug',apiKey:'should-not-persist'});
    rec.record('tool.start',{name:'run_command',detail:'npm test',authorization:'secret'});
    rec.record('tool.end',{name:'run_command',durationMs:42,resultHash:FlightRecorder.hash('ok'),resultChars:2,messageCount:4,epoch:0});
    await rec.finish({status:'completed',messageCount:5,contextEpoch:0,proof:{score:90}});
    const run=await rec.load(id);
    assert.equal(run.start.provider,'codecraft');
    assert.equal(run.start.apiKey,'[redacted]');
    assert.equal(run.events[1].authorization,'[redacted]');
    assert.match(summarizeFlightEvent(run.events[2]),/result/);
    const mode=(await fs.stat(rec.file(id))).mode&0o777;
    if(process.platform!=='win32')assert.equal(mode&0o077,0);
  }finally{await fs.rm(cwd,{recursive:true,force:true});await fs.rm(rec.dir,{recursive:true,force:true});}
});

test('SessionStore can fork an exact saved message prefix for safe replay',async()=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'craft-replay-work-')),store=await new SessionStore(cwd).init();
  try{
    const messages=[
      {role:'system',content:'sys'},
      {role:'user',content:'change x'},
      {role:'assistant',content:'checking'},
      {role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'read_file',arguments:'{}'}}]},
      {role:'tool',tool_call_id:'c1',content:'result'},
      {role:'assistant',content:'done'}
    ];
    await store.save({provider:'codecraft',messages,transcript:[{role:'user',text:'change x'},{role:'assistant',text:'done'}],model:'m',mode:'build',effort:'high'});
    const source=store.currentId,fork=await store.forkPrefix(source,3,{title:'Replay test'});
    assert.ok(fork);
    assert.notEqual(fork.id,source);
    assert.equal(fork.messages.length,3);
    assert.equal(fork.forkedFrom,source);
    assert.equal(fork.transcript.at(-1).text,'checking');
  }finally{await fs.rm(store.dir,{recursive:true,force:true});await fs.rm(cwd,{recursive:true,force:true});}
});

test('Arena works with only the current CodeCraft client and ranks deterministic evidence',async()=>{
  const currentClient={rateLimits:{tpmLimit:500000}},config={agents:{maxParallel:2,defaultBudgetTokens:25000}};
  const manager=new AgentManager({client:currentClient,model:'craft-model',cwd:process.cwd(),config,usage:{},skills:{},plugins:{},mcp:{}});
  const seen=[];let i=0;
  manager.run=async opts=>{seen.push(opts);i++;return{id:'writer-'+i,status:'done',provider:opts.provider,model:opts.model,patchBytes:i===1?1200:900,proof:{score:i===1?80:95},result:'candidate'};};
  const a=await manager.arena({task:'fix bug',count:2,candidates:[{provider:'codecraft',client:currentClient,model:'craft-model'}],allowShell:false});
  assert.equal(a.candidates.length,2);
  assert.equal(a.winnerId,'c2');
  assert.ok(seen.every(x=>x.client===currentClient));
  assert.ok(seen.every(x=>x.provider==='codecraft'));
  assert.match(manager.arenaSummary(a),/codecraft/);
});
