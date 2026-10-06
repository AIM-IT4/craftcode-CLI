import test from 'node:test';
import assert from 'node:assert/strict';

import {optimizeRequestMessages} from '../src/efficiency.mjs';
import {mutationPaths,docsOnlyMutation} from '../src/agent.mjs';
import {OpenAICompatibleClient} from '../src/providers/openai-compatible.mjs';
import {UsageTracker} from '../src/usage.mjs';
import {TerminalTui} from '../src/tui.mjs';

const sse=chunks=>new Response(new ReadableStream({start(c){const enc=new TextEncoder();for(const x of chunks)c.enqueue(enc.encode(`data: ${typeof x==='string'?x:JSON.stringify(x)}\n\n`));c.close();}}),{status:200,headers:{'content-type':'text/event-stream'}});
const reply=(text='hi',usage={prompt_tokens:100,completion_tokens:5,total_tokens:105,prompt_tokens_details:{cached_tokens:80}})=>sse([{choices:[{delta:{content:text}}]},{choices:[{delta:{},finish_reason:'stop'}],usage},'[DONE]']);

test('request view keeps earlier messages byte-identical between window steps so provider prompt caches stay warm',()=>{
  const msgs=[{role:'system',content:'S'.repeat(4000)},{role:'user',content:'task'}];
  let prev=null,breaks=0;const steps=40;
  for(let i=1;i<=steps;i++){
    msgs.push({role:'assistant',content:null,tool_calls:[{id:'c'+i,type:'function',function:{name:'read_file',arguments:'{}'}}]});
    msgs.push({role:'tool',tool_call_id:'c'+i,content:'y'.repeat(6000)+i});
    const view=optimizeRequestMessages(msgs).messages;
    if(prev){const prefixIntact=prev.every((m,j)=>JSON.stringify(m)===JSON.stringify(view[j]));if(!prefixIntact)breaks++;}
    prev=view;
  }
  assert.ok(breaks<=Math.ceil(steps/4)+1,`prefix changed on ${breaks}/${steps} steps`);
});

test('window still keeps the newest tool results full-size and clips older ones',()=>{
  const msgs=[{role:'system',content:'s'}];
  for(let i=0;i<20;i++){msgs.push({role:'assistant',content:null,tool_calls:[{id:'c'+i,type:'function',function:{name:'read_file',arguments:'{}'}}]});msgs.push({role:'tool',tool_call_id:'c'+i,content:'z'.repeat(5000)+i});}
  const tools=optimizeRequestMessages(msgs,{recentTools:6,oldToolChars:500,cacheChunk:4}).messages.filter(m=>m.role==='tool');
  for(const m of tools.slice(-6))assert.ok(m.content.length>=5000,'newest 6 stay full');
  assert.ok(tools[0].content.length<1000,'oldest is clipped');
  assert.equal(optimizeRequestMessages(msgs,{recentTools:0,oldToolChars:500}).messages.filter(m=>m.role==='tool').every(m=>m.content.length<1000),true);
});

test('docs-only edits are recognised so they skip the forced verification round-trip',()=>{
  assert.deepEqual(mutationPaths('write_file',{path:'README.md'}),['README.md']);
  assert.equal(docsOnlyMutation('write_file',{path:'docs/guide.md'}),true);
  assert.equal(docsOnlyMutation('replace_in_file',{path:'CHANGELOG.md'}),true);
  assert.equal(docsOnlyMutation('write_file',{path:'src/index.mjs'}),false);
  assert.equal(docsOnlyMutation('write_file',{path:'package.json'}),false);
  assert.equal(docsOnlyMutation('write_file',{}),false,'unknown path counts as code');
  assert.equal(docsOnlyMutation('apply_patch',{patch:'--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-a\n+b\n'}),true);
  assert.equal(docsOnlyMutation('apply_patch',{patch:'--- a/README.md\n+++ b/README.md\n@@\n-a\n+b\n--- a/src/x.mjs\n+++ b/src/x.mjs\n@@\n-a\n+b\n'}),false);
  assert.equal(docsOnlyMutation('move_file',{from:'a.md',to:'b.mjs'}),false);
  assert.equal(docsOnlyMutation('run_command',{command:'rm x'}),false);
});

test('streaming requests ask for usage and report timing',async()=>{
  const old=globalThis.fetch;let body;
  try{
    globalThis.fetch=async(u,o)=>{body=JSON.parse(o.body);return reply();};
    const c=new OpenAICompatibleClient({baseUrl:'http://x/v1',apiKey:'k'});
    const r=await c.stream({model:'m',messages:[{role:'user',content:'hi'}],tools:[],onText(){}});
    assert.deepEqual(body.stream_options,{include_usage:true});
    assert.equal(r.usage.total_tokens,105);
    assert.ok(r.timing.totalMs>=0&&r.timing.firstTokenMs!==null&&r.timing.ttfbMs!==null);
    assert.equal(c.lastTiming,r.timing);
  }finally{globalThis.fetch=old;}
});

test('providers that reject stream_options are retried once without it and remembered',async()=>{
  const old=globalThis.fetch;const bodies=[];
  try{
    globalThis.fetch=async(u,o)=>{const b=JSON.parse(o.body);bodies.push(b);if(b.stream_options)return new Response('{"error":{"message":"Unknown parameter: stream_options"}}',{status:400});return reply('ok',null);};
    const c=new OpenAICompatibleClient({baseUrl:'http://x/v1',apiKey:'k'});
    const r=await c.stream({model:'m',messages:[{role:'user',content:'hi'}],tools:[],onText(){}});
    assert.equal(r.message.content,'ok');assert.equal(bodies.length,2);
    assert.ok(bodies[0].stream_options);assert.equal(bodies[1].stream_options,undefined);
    assert.equal(c.supportsStreamUsage,false);
    await c.stream({model:'m',messages:[{role:'user',content:'again'}],tools:[],onText(){}});
    assert.equal(bodies.length,3);assert.equal(bodies[2].stream_options,undefined,'remembered for later requests');
    // unrelated 400s are still surfaced, not swallowed
    globalThis.fetch=async()=>new Response('{"error":{"message":"bad messages"}}',{status:400});
    const d=new OpenAICompatibleClient({baseUrl:'http://x/v1',apiKey:'k'});
    await assert.rejects(()=>d.stream({model:'m',messages:[{role:'user',content:'hi'}],tools:[],onText(){}}),/400/);
  }finally{globalThis.fetch=old;}
});

test('usage tracker records input/output/cached tokens and timing per session',async()=>{
  const u=new UsageTracker(1_000_000,1);u.state={total:0,daily:{},byModel:{}};u.save=async()=>{};
  await u.add({prompt_tokens:1000,completion_tokens:50,total_tokens:1050,prompt_tokens_details:{cached_tokens:800}},'m',{ttfbMs:200,firstTokenMs:400,totalMs:1500});
  await u.add({prompt_tokens:500,completion_tokens:20,total_tokens:520,prompt_cache_hit_tokens:100},'m',{ttfbMs:100,firstTokenMs:200,totalMs:900});
  const d=u.snapshot().detail;
  assert.deepEqual([d.requests,d.prompt,d.completion,d.cached],[2,1500,70,900]);
  assert.equal(d.timed,2);assert.equal(d.totalMs,2400);assert.equal(u.snapshot().session,1570);
});

test('command palette lists /usage detail next to /usage so it is discoverable',()=>{
  const u={snapshot:()=>({plan:1e6,total:0,session:0,daily:{},byModel:{}}),planTokens:1e6};
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:u,showSplash:false});tui.schedule=()=>{};
  tui.input='/usa';tui.cursor=4;
  const cmds=tui.commandSuggestions().map(x=>x.cmd);
  assert.deepEqual(cmds.slice(0,2),['/usage','/usage detail']);
});
