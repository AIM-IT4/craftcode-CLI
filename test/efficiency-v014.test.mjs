import test from 'node:test';
import assert from 'node:assert/strict';
import {ToolEvidenceLedger,optimizeRequestMessages,outputBudgetForTask,compactSkillText} from '../src/efficiency.mjs';
import {compactConversation} from '../src/context.mjs';
import {OpenAICompatibleClient} from '../src/providers/openai-compatible.mjs';

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

test('evidence-pinned compaction keeps requirements changes and failed checks',()=>{
  const messages=[
    {role:'system',content:'sys'},
    {role:'user',content:'Keep backward compatibility and fix checkout.'},
    {role:'assistant',content:null,tool_calls:[{id:'w1',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'src/checkout.ts',content:'x'})}}]},
    {role:'tool',tool_call_id:'w1',content:'Wrote src/checkout.ts'},
    {role:'assistant',content:null,tool_calls:[{id:'t1',type:'function',function:{name:'run_command',arguments:JSON.stringify({command:'npm test'})}}]},
    {role:'tool',tool_call_id:'t1',content:'checkout failed\n(exit 1)'},
    {role:'user',content:'Now also handle guest users.'},
    {role:'assistant',content:'working'},
    {role:'user',content:'continue'},
    {role:'assistant',content:'working again'},
    {role:'user',content:'finish'},
    {role:'assistant',content:'done'}
  ];
  const r=compactConversation(messages,{targetChars:900,aggressive:true}),text=JSON.stringify(r.messages);
  assert.match(text,/Keep backward compatibility|guest users/);
  assert.match(text,/src\/checkout\.ts/);
  assert.match(text,/Verification failed: npm test/);
});

test('provider honors per-request output ceiling',async()=>{
  const old=globalThis.fetch,enc=new TextEncoder();let sent;
  globalThis.fetch=async(_url,opts)=>{sent=JSON.parse(opts.body);return new Response(new ReadableStream({start(c){c.enqueue(enc.encode('data: '+JSON.stringify({choices:[{delta:{content:'ok'},finish_reason:'stop'}],usage:{total_tokens:2}})+'\n\ndata: [DONE]\n\n'));c.close();}}),{status:200});};
  try{
    const client=new OpenAICompatibleClient({baseUrl:'https://example.invalid/v1',maxOutputTokens:8192});
    await client.stream({model:'m',messages:[{role:'user',content:'hi'}],tools:[],maxOutputTokens:2048});
    assert.equal(sent.max_tokens,2048);
  }finally{globalThis.fetch=old;}
});
