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
