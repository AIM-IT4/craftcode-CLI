import test from 'node:test';
import assert from 'node:assert/strict';
import {ToolEvidenceLedger,optimizeRequestMessages,outputBudgetForTask,compactSkillText} from '../src/efficiency.mjs';

test('adaptive output budget is bounded',()=>{
  const r=outputBudgetForTask({text:'small typo fix',mode:'build',effort:'high',maxOutputTokens:8192});
  assert.equal(r.tokens,2048);
});

test('tool evidence ledger compresses and deduplicates repeated results',()=>{
  const ledger=new ToolEvidenceLedger({runCommandChars:1800});
  const big=Array.from({length:500},(_,i)=>i===420?'FAIL test_checkout expected 200 actual 500':`log line ${i}`).join('\n');
  const a=ledger.reduce('run_command',{command:'npm test'},big);
  const b=ledger.reduce('run_command',{command:'npm test'},big);
  assert.ok(a.content.length<big.length);
  assert.match(a.content,/FAIL test_checkout/);
  assert.match(b.content,/duplicate omitted/);
  assert.ok(ledger.stats().savedTokens>0);
});

test('lean request view keeps recent tools and compresses older tool output',()=>{
  const messages=[{role:'system',content:'sys'}];
  for(let i=0;i<8;i++){messages.push({role:'assistant',content:null,tool_calls:[{id:'c'+i,type:'function',function:{name:'read_file',arguments:'{}'}}]});messages.push({role:'tool',tool_call_id:'c'+i,content:'x'.repeat(5000)+i});}
  const r=optimizeRequestMessages(messages,{recentTools:2,oldToolChars:500});
  assert.ok(r.stats.savedTokens>3000);
  const xs=r.messages.filter(x=>x.role==='tool');
  assert.equal(xs.at(-1).content.length,5001);
  assert.ok(xs[0].content.length<1000);
});

test('skill prompt compaction removes metadata but preserves instructions',()=>{
  const raw='---\nname: browser\ndescription: Browser testing\n---\n\n# Browser\n\n\nUse snapshots.\n\n<!-- internal -->\nCheck console.\n';
  const compact=compactSkillText(raw);
  assert.doesNotMatch(compact,/description:/);
  assert.doesNotMatch(compact,/internal/);
  assert.match(compact,/Use snapshots/);
  assert.match(compact,/Check console/);
});
