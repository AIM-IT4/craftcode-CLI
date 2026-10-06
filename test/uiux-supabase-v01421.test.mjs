import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {phaseLabel,shouldNotify,titleFor,turnSummary,groupToolRuns,cropMiddle,osc52} from '../src/uiux.mjs';
import {parseDotenv,maskDotenv,isEnvFile,keyRole,allowedHost,buildSelectQuery,supabaseQuery} from '../src/supabase_local.mjs';
import {TerminalTui,terminalCellWidth} from '../src/tui.mjs';

test('phaseLabel adds hints as the wait grows',()=>{
  const since=1000;
  assert.match(phaseLabel({kind:'waiting',since},1500),/waiting for model · 0s$/);
  assert.match(phaseLabel({kind:'waiting',since},4500),/Esc to stop/);
  assert.match(phaseLabel({kind:'waiting',since},7000),/\/effort low/);
  assert.match(phaseLabel({kind:'tool',tool:'run_command',since},3000),/running run_command · 2s/);
  assert.equal(phaseLabel({kind:'streaming'}),'writing the answer');
});

test('shouldNotify respects mode, focus and duration',()=>{
  assert.equal(shouldNotify({mode:'off',seconds:99}),false);
  assert.equal(shouldNotify({mode:'always',seconds:12}),true);
  assert.equal(shouldNotify({mode:'auto',focusKnown:true,focused:true,seconds:60}),false);
  assert.equal(shouldNotify({mode:'auto',focusKnown:true,focused:false,seconds:11}),true);
  assert.equal(shouldNotify({mode:'auto',focusKnown:false,seconds:20}),false);
  assert.equal(shouldNotify({mode:'auto',focusKnown:false,seconds:31}),true);
});

test('titleFor, turnSummary, cropMiddle and osc52',()=>{
  assert.equal(titleFor({workspace:'app',state:'working'}),'⏳ Craft Code · app');
  assert.equal(titleFor({state:'done'}),'✓ Craft Code');
  assert.equal(turnSummary({before:{},after:{}}),'');
  const s=turnSummary({before:{requests:1,prompt:1000},after:{requests:3,prompt:21000,completion:1500,cached:10000},seconds:12.4,tools:4});
  assert.match(s,/2 requests · 20k in \(50% cached\) · 1\.5k out · 4 tools · 12s/);
  const c=cropMiddle('provider/very-long-model-name-v2.5-preview',16);
  assert.equal([...c].length,16);assert.ok(c.includes('…')&&c.endsWith('review'));
  assert.equal(cropMiddle('short',16),'short');
  assert.equal(osc52('hi'),'\x1b]52;c;aGk=\x07');
});

test('groupToolRuns collapses settled same-name runs but keeps recent and edits visible',()=>{
  const card=(name,status='done')=>({role:'toolcard',name,status,durationMs:100});
  const t=[card('read_file'),card('read_file'),card('read_file'),card('write_file'),card('write_file'),card('write_file'),card('read_file'),card('read_file'),card('read_file'),card('read_file')];
  const runs=groupToolRuns(t);
  assert.deepEqual(runs.map(r=>[r.start,r.end,r.name,r.count,r.durationMs]),[[0,2,'read_file',3,300]]);
  assert.equal(groupToolRuns([card('read_file'),card('read_file')],{keepRecent:0}).length,0);
});

test('TUI renders turn summary, wraps long notices, shows cache chip and respects /tools state',()=>{
  const snap={plan:1e6,total:0,session:0,daily:{},byModel:{},detail:{requests:2,prompt:1000,completion:50,cached:500,written:0}};
  const usage={snapshot:()=>snap,planTokens:1e6};
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage,showSplash:false,plushie:'off'});tui.schedule=()=>{};
  tui.add('notice','x '.repeat(200));
  tui.add('summary','2 requests · 1k in · 50 out · 1.0s');
  let frame=[],cols=0;tui.paintFrame=(l,c)=>{frame=l;cols=c;};tui.renderChat();
  const plain=frame.map(x=>String(x).replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,''));
  assert.ok(plain.some(l=>l.includes('└ 2 requests')),'summary line');
  assert.ok(plain.filter(l=>l.includes('x x x')).length>1,'long notice wraps');
  for(const l of frame)assert.ok(terminalCellWidth(l)<=cols);
});

test('dotenv parsing and masking never expose secrets',()=>{
  const env=parseDotenv('# c\nSUPABASE_URL="https://abc.supabase.co"\nexport SUPABASE_SERVICE_ROLE_KEY=sb_secret_abcdefghijkl # note\nPLAIN=1\n');
  assert.equal(env.SUPABASE_URL,'https://abc.supabase.co');
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY,'sb_secret_abcdefghijkl');
  const masked=maskDotenv('SUPABASE_URL=https://abc.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_abcdefghijkl\nPLAIN=1');
  assert.ok(!masked.includes('abcdefghijkl'));assert.ok(masked.includes('https://abc.supabase.co')&&masked.includes('PLAIN=1'));
  assert.ok(isEnvFile('app/.env.local'));assert.ok(!isEnvFile('.env.example'));assert.ok(!isEnvFile('src/env.mjs'));
});

test('key roles, host allowlist and query building are strict',()=>{
  const jwt=`x.${Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')}.y`;
  assert.equal(keyRole(jwt),'service_role');assert.equal(keyRole('sb_publishable_x'),'anon');
  assert.ok(allowedHost('abc.supabase.co'));assert.ok(allowedHost('localhost'));
  assert.ok(!allowedHost('evil.com'));assert.ok(!allowedHost('abc.supabase.co.evil.com'));
  const p=buildSelectQuery({table:'users',columns:'id, email',filters:[{column:'age',op:'gt',value:5},{column:'id',op:'in',value:[1,2]}],order:'created_at.desc',limit:9999});
  assert.match(p,/^\/rest\/v1\/users\?select=id,email&age=gt\.5&id=in\.\(1,2\)&order=created_at\.desc&limit=200&offset=0$/);
  assert.throws(()=>buildSelectQuery({table:'users;drop'}));
  assert.throws(()=>buildSelectQuery({table:'u',columns:'a(b)'}));
  assert.throws(()=>buildSelectQuery({table:'u',filters:[{column:'a',op:'sql',value:1}]}));
});

test('supabaseQuery reads with the local key, asks before service role, and scrubs output',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sb-'));
  await fs.writeFile(path.join(dir,'.env'),'NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_abcdefghijkl\nNEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_zzzzzzzzzz\n');
  const calls=[];
  const fetchImpl=async(url,init)=>{calls.push({url,init});return{ok:true,status:200,headers:new Map([['content-range','0-0/42']]),text:async()=>JSON.stringify([{id:1,note:'sb_secret_abcdefghijkl'}])};};
  const status=await supabaseQuery(dir,{action:'status'});
  assert.ok(!status.includes('abcdefghijkl'));assert.match(status,/service_role/);
  const asked=[];
  const out=await supabaseQuery(dir,{action:'select',table:'orders',limit:5},{permit:async m=>{asked.push(m);return true;},fetchImpl});
  assert.equal(asked.length,1);assert.ok(!out.includes('abcdefghijkl'));assert.match(out,/RLS bypassed/);
  assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].init.headers.apikey,'sb_secret_abcdefghijkl');assert.equal(calls[0].init.headers.Authorization,undefined);
  assert.match(calls[0].url,/^https:\/\/abc\.supabase\.co\/rest\/v1\/orders\?select=\*/);
  assert.equal(await supabaseQuery(dir,{action:'select',table:'orders'},{permit:async()=>false,fetchImpl}),'Denied by user');
  const anon=await supabaseQuery(dir,{action:'count',table:'orders',access:'anon'},{fetchImpl});
  assert.match(anon,/42 rows .*anon, RLS applied/);
  await fs.writeFile(path.join(dir,'.env'),'SUPABASE_URL=https://evil.example.com\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_abcdefghijkl\n');
  await assert.rejects(supabaseQuery(dir,{action:'tables'},{permit:async()=>true,fetchImpl}),/Refusing to send credentials/);
  await assert.rejects(supabaseQuery(dir,{action:'status',env_file:'../outside.env'}),/./);
});

import {AgentSession} from '../src/agent.mjs';

const mkSession=(stream,{tools={},config={}}={})=>{
  const client={maxOutputTokens:4096,rateLimits:{},capabilities:()=>({contextWindow:128000}),stream};
  const warns=[];
  const session=new AgentSession({client,model:'m',cwd:process.cwd(),mode:'build',effort:'normal',
    config:{autoCompactChars:'auto',maxOutputTokens:4096,maxAgentSteps:20,maxTurnSegments:3,tokenGuard:{},efficiency:{},agentRuntime:{autoVerifyEdits:true},...config},
    usage:{add:async()=>{}},skills:{list:()=>[],autoSelect:async()=>({selected:[],estimatedTokens:0,candidates:0})},
    plugins:{list:()=>[],hook:async()=>[]},mcp:{list:()=>[]},checkpoints:{begin:async()=>{},finish:async()=>null},
    tools:{definitions:()=>[],imageSupported:()=>false,isMutating:n=>n==='write_file',isVerification:()=>false,isParallelSafe:()=>false,execute:async()=>'ok',...tools},
    events:{onWarn:m=>warns.push(m)}});
  session.events={onWarn:m=>warns.push(m)};
  session.clear();
  return {session,warns};
};

test('empty model replies are dropped from history, retried once, and reported',async()=>{
  let calls=0;
  const {session,warns}=mkSession(async()=>{calls++;return{message:{role:'assistant',content:''},usage:{total_tokens:1},finishReason:'stop'};});
  const r=await session.run('?');
  assert.equal(calls,2,'one automatic retry');
  assert.ok(warns.some(w=>/empty reply again/.test(w)));
  assert.ok(!session.messages.some(m=>m.role==='assistant'&&!m.content&&!m.tool_calls),'no empty assistant turns kept');
  assert.equal(r.completed,true);
});

test('empty reply followed by a real answer recovers silently apart from one warning',async()=>{
  let calls=0;
  const {session,warns}=mkSession(async({onText})=>{calls++;if(calls===1)return{message:{role:'assistant',content:''},usage:{total_tokens:1},finishReason:'stop'};onText?.('hello');return{message:{role:'assistant',content:'hello'},usage:{total_tokens:1},finishReason:'stop'};});
  const r=await session.run('hi');
  assert.equal(r.text,'hello');assert.equal(warns.filter(w=>/empty reply/.test(w)).length,1);
});

test('verification gates do not consume turn segments or inflate the round count',async()=>{
  let call=0;
  const {session,warns}=mkSession(async({onText})=>{
    call++;
    if(call===1)return{message:{role:'assistant',content:null,tool_calls:[{id:'c1',type:'function',function:{name:'write_file',arguments:'{"path":"src/a.js","content":"x"}'}}]},usage:{total_tokens:1},finishReason:'tool_calls'};
    onText?.('done');return{message:{role:'assistant',content:'done'},usage:{total_tokens:1},finishReason:'stop'};
  });
  const r=await session.run('write a file');
  assert.ok(!warns.some(w=>/Long turn/.test(w)),'gate must not look like a long-turn continuation');
  assert.ok(!warns.some(w=>/ceiling/.test(w)));
  assert.ok(r.completed);
});

test('ceiling message reports real rounds, not segments x step limit',async()=>{
  let call=0;
  const {session,warns}=mkSession(async()=>{call++;return{message:{role:'assistant',content:null,tool_calls:[{id:`c${call}`,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:`f${call}.txt`})}}]},usage:{total_tokens:1},finishReason:'tool_calls'};},{config:{maxAgentSteps:2,maxTurnSegments:2}});
  await session.run('loop');
  const w=warns.find(x=>/ceiling/.test(x));
  assert.ok(w,'ceiling warning expected');
  assert.match(w,new RegExp(`after ${call} model/tool rounds`));
});

test('failed tool cards show the first line of the error without expanding',()=>{
  const usage={snapshot:()=>({plan:1e6,total:0,session:0,daily:{},byModel:{}}),planTokens:1e6};
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage,showSplash:false,plushie:'off'});tui.schedule=()=>{};
  const id=tui.toolStart({name:'write_file',detail:'a.html',args:{}});
  tui.toolEnd({cardId:id,result:'\nEACCES: permission denied, open a.html\nstack…',durationMs:100,error:true});
  let frame=[];tui.paintFrame=l=>{frame=l;};tui.renderChat();
  assert.ok(frame.map(x=>String(x).replace(/\x1b\[[0-9;?]*[ -\\/]*[@-~]/g,'')).some(l=>l.includes('EACCES: permission denied')));
});
