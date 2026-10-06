import test from 'node:test';
import assert from 'node:assert/strict';

import {TerminalTui} from '../src/tui.mjs';
import {AgentSession} from '../src/agent.mjs';
import {classifyMediaIntent} from '../src/media_intent.mjs';

const usage=()=>({snapshot:()=>({plan:1_000_000,total:0,session:0,daily:{},byModel:{}}),planTokens:1_000_000,add:async()=>{}});
const strip=s=>String(s).replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,'');

const baseDeps=()=>({
  skills:{list:()=>[],autoSelect:async()=>({selected:[],estimatedTokens:0,candidates:0})},
  plugins:{list:()=>[],hook:async()=>[]},
  mcp:{list:()=>[]}
});

test('direct image intent is distinct from requests to build image-generation code',()=>{
  assert.equal(classifyMediaIntent('create some test image').directImage,true);
  assert.equal(classifyMediaIntent('generate a simple poster for me').directImage,true);
  assert.equal(classifyMediaIntent('build an image generator in Python').directImage,false);
  assert.equal(classifyMediaIntent('add image generation capability to this app').directImage,false);
});

test('running thinking and assistant stream markers animate with spinner frames',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:usage(),showSplash:false});tui.schedule=()=>{};
  tui.setBusy(true);tui.setActivity('Tracing the issue');
  tui.spinnerIndex=0;const thinking0=strip(tui.transcriptLines(100).join('\n'));
  tui.spinnerIndex=1;const thinking1=strip(tui.transcriptLines(100).join('\n'));
  assert.match(thinking0,/◐ Tracing the issue…/);
  assert.match(thinking1,/◓ Tracing the issue…/);

  tui.stream('Streaming answer');
  const row=tui.transcript.at(-1);assert.equal(row.role,'assistant');assert.equal(row.status,'streaming');
  tui.spinnerIndex=0;const assistant0=strip(tui.transcriptLines(100).at(-1));
  tui.spinnerIndex=2;const assistant2=strip(tui.transcriptLines(100).at(-1));
  assert.match(assistant0,/◐\s+Streaming answer/);
  assert.match(assistant2,/◑\s+Streaming answer/);

  tui.toolStart({name:'read_file',detail:'README.md',args:{path:'README.md'}});
  assert.equal(row.status,'done');
});

test('unsupported direct image request returns without model or repository tool calls',async()=>{
  let streamCalls=0,toolCalls=0,text='',ended=0;
  const client={maxOutputTokens:8192,rateLimits:{},capabilities:()=>({imageGeneration:false,contextWindow:null}),stream:async()=>{streamCalls++;throw new Error('model should not run');}};
  const tools={imageSupported:()=>false,definitions:()=>[],isMutating:()=>false,isVerification:()=>false,execute:async()=>{toolCalls++;}};
  const session=new AgentSession({
    client,model:'text-model',cwd:process.cwd(),mode:'build',effort:'high',
    config:{maxAgentSteps:4,maxTurnSegments:1,autoCompactChars:300000,tokenGuard:{},efficiency:{},agentRuntime:{}},
    usage:usage(),...baseDeps(),tools,
    events:{onText:t=>text+=t,onTurnEnd:()=>ended++}
  });
  session.clear();
  const r=await session.run('create some test image');
  assert.equal(streamCalls,0);
  assert.equal(toolCalls,0);
  assert.equal(ended,1);
  assert.equal(session.running,false);
  assert.match(text,/does not advertise image-generation capability/i);
  assert.match(text,/did not search the repository/i);
  assert.equal(r.completed,false);
});

test('supported direct image request exposes only generate_image to the model',async()=>{
  const seenTools=[],executed=[];let n=0;
  const client={
    maxOutputTokens:8192,rateLimits:{},
    capabilities:()=>({imageGeneration:true,contextWindow:null}),
    stream:async({tools,onText})=>{
      seenTools.push(tools.map(x=>x.function.name));n++;
      if(n===1)return{message:{role:'assistant',content:null,tool_calls:[{id:'img1',type:'function',function:{name:'generate_image',arguments:JSON.stringify({prompt:'small blue test image',path:'artifacts/test.png'})}}]},usage:null,finishReason:'tool_calls'};
      onText?.('Created the test image.');
      return{message:{role:'assistant',content:'Created the test image.'},usage:null,finishReason:'stop'};
    }
  };
  const definitions=[
    {type:'function',function:{name:'generate_image',description:'image',parameters:{type:'object',properties:{}}}},
    {type:'function',function:{name:'write_file',description:'write',parameters:{type:'object',properties:{}}}},
    {type:'function',function:{name:'run_command',description:'shell',parameters:{type:'object',properties:{}}}},
    {type:'function',function:{name:'search_files',description:'search',parameters:{type:'object',properties:{}}}}
  ];
  const tools={
    imageSupported:()=>true,definitions:()=>definitions,
    isMutating:n=>n==='generate_image'||n==='write_file',isVerification:()=>false,
    execute:async(name)=>{executed.push(name);return{name,path:'artifacts/test.png'};}
  };
  const session=new AgentSession({
    client,model:'text-model',cwd:process.cwd(),mode:'build',effort:'high',
    config:{maxAgentSteps:4,maxTurnSegments:1,autoCompactChars:300000,tokenGuard:{},efficiency:{},agentRuntime:{autoVerifyEdits:true}},
    usage:usage(),...baseDeps(),tools
  });
  session.clear();
  const r=await session.run('create some test image');
  assert.deepEqual(seenTools,[['generate_image'],['generate_image']]);
  assert.deepEqual(executed,['generate_image']);
  assert.equal(r.completed,true);
});
