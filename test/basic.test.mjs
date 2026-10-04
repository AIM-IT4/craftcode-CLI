import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtTokens, pctBar } from '../src/ui.mjs';
import { CodeCraftClient } from '../src/codecraft.mjs';
import { ToolRegistry } from '../src/tools.mjs';

test('token formatting',()=>{assert.equal(fmtTokens(6_000_000),'6.00M');assert.equal(fmtTokens(1200),'1.2k');});
test('progress bar length',()=>assert.equal(pctBar(50,100,10).length,10));
test('base URL normalization',()=>assert.equal(new CodeCraftClient({apiKey:'x',baseUrl:'https://x/v1/'}).baseUrl,'https://x/v1'));

test('stream parser accumulates content, tool calls and usage', async () => {
  const oldFetch = globalThis.fetch;
  const enc = new TextEncoder();
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      const events = [
        {choices:[{delta:{content:'Hi '},finish_reason:null}]},
        {choices:[{delta:{content:'there'},finish_reason:null}]},
        {choices:[{delta:{tool_calls:[{index:0,id:'call_1',function:{name:'read_file',arguments:'{"path":'}}]},finish_reason:null}]},
        {choices:[{delta:{tool_calls:[{index:0,function:{arguments:'"README.md"}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}
      ];
      for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    }
  }), {status:200,headers:{'content-type':'text/event-stream'}});
  try {
    const c = new CodeCraftClient({apiKey:'x',baseUrl:'https://x/v1'});
    let printed='';
    const r = await c.stream({model:'m',messages:[{role:'user',content:'x'}],tools:[],onText:t=>printed+=t});
    assert.equal(printed,'Hi there');
    assert.equal(r.usage.total_tokens,120);
    assert.equal(r.message.tool_calls[0].function.name,'read_file');
    assert.deepEqual(JSON.parse(r.message.tool_calls[0].function.arguments),{path:'README.md'});
  } finally { globalThis.fetch = oldFetch; }
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileReferenceIndex } from '../src/file_refs.mjs';
import { CheckpointManager } from '../src/checkpoints.mjs';

test('file references suggest and expand only selected files', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-ref-'));await fs.mkdir(path.join(dir,'src'),{recursive:true});await fs.writeFile(path.join(dir,'src','hello.js'),'export const hello = "world";\n');
  const refs=new FileReferenceIndex(dir,{maxAttachChars:1000,maxTotalAttachChars:2000});await refs.scan();assert.deepEqual(refs.suggest('src/hel'),['src/hello.js']);const x=await refs.expand('Review @src/hello.js');assert.deepEqual(x.refs,['src/hello.js']);assert.match(x.prompt,/file_reference path="src\/hello\.js"/);await fs.rm(dir,{recursive:true,force:true});
});

test('checkpoint restores directly edited files',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-cp-')),file=path.join(dir,'a.txt');await fs.writeFile(file,'before');const cp=await new CheckpointManager(dir).init();await cp.begin('test');await cp.capture('a.txt');await fs.writeFile(file,'after');await cp.finish();const r=await cp.undoLatest();assert.equal(r.ok,true);assert.equal(await fs.readFile(file,'utf8'),'before');await fs.rm(dir,{recursive:true,force:true});
});

test('CodeCraft stream honors AbortSignal',async()=>{
  const oldFetch=globalThis.fetch;globalThis.fetch=async(_u,{signal})=>new Response(new ReadableStream({start(controller){signal?.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});}}),{status:200});try{const c=new CodeCraftClient({apiKey:'x',baseUrl:'https://x/v1'}),ac=new AbortController(),p=c.stream({model:'m',messages:[],signal:ac.signal});ac.abort();await assert.rejects(p,e=>e.name==='AbortError');}finally{globalThis.fetch=oldFetch;}
});

import { TerminalTui } from '../src/tui.mjs';

const fakeUsage=()=>({snapshot:()=>({plan:100_000_000,total:6_000_000,remaining:94_000_000,session:1_000_000,daily:{[new Date().toISOString().slice(0,10)]:2_000_000},byModel:{}})});

test('slash commands are normalized and never added to chat transcript',async()=>{
  let got='';const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),onCommand:async x=>{got=x;},showSplash:false});
  tui.schedule=()=>{};tui.input='/MODE build';tui.cursor=tui.input.length;await tui.submit();
  assert.equal(got,'/mode build');assert.equal(tui.transcript.length,0);
});

test('thinking is represented inline in transcript',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});tui.schedule=()=>{};
  tui.add('user','hello');tui.setBusy(true);assert.equal(tui.transcript.at(-1).role,'thinking');assert.equal(tui.transcript.at(-1).status,'running');
  tui.setBusy(false);assert.equal(tui.transcript.at(-1).status,'done');
});

test('footer exposes interactive usage mode model and effort regions',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'claude-opus-5',mode:'build',effort:'high',usage:fakeUsage(),resetDay:4,showSplash:false,mouseCapture:true,startupMeta:{mcp:2}});tui.schedule=()=>{};let frame=[];tui.paintFrame=lines=>{frame=lines;};
  tui.renderChat();const actions=new Set(tui.regions.map(r=>r.action));
  for(const a of ['usage','plus','attach','mode','model','effort','connectors'])assert.ok(actions.has(a),`missing ${a}`);
  assert.ok(frame.some(x=>String(x).includes('Ask anything')));
});

test('mouse hit testing activates interactive footer pill',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false,mouseCapture:true,startupMeta:{mcp:0}});tui.schedule=()=>{};tui.regions=[{x1:3,x2:20,y:30,action:'usage'}];
  tui.handleMouse('\x1b[<0;5;30M');assert.equal(tui.modal?.type,'usage');
});

import { resolvePlanTokens } from '../src/config.mjs';

test('CodeCraft RPM plan hint maps Starter to 30M',async()=>{
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:[{id:'m'}]}),{status:200,headers:{'content-type':'application/json','x-ratelimit-limit':'120','x-ratelimit-limit-tokens':'500000'}});
  try{const c=new CodeCraftClient({apiKey:'x',baseUrl:'https://x/v1'});await c.models();assert.deepEqual(c.planHint(),{name:'Starter',tokens:30_000_000,rpm:120});assert.equal(resolvePlanTokens({planTokens:'auto'},c.planHint()).tokens,30_000_000);}finally{globalThis.fetch=oldFetch;}
});

test('permission pill and picker are exposed',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',permissionPreset:'ask',usage:fakeUsage(),showSplash:false,mouseCapture:true,startupMeta:{mcp:0}});tui.schedule=()=>{};tui.paintFrame=()=>{};tui.renderChat();
  assert.ok(tui.regions.some(r=>r.action==='permissions'));
});

test('assistant markdown does not print raw bold markers',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});tui.schedule=()=>{};tui.add('assistant','**Synced** `main`\n- **Before:** old');
  const rendered=tui.transcriptLines(80).join('\n');
  assert.equal(rendered.includes('**'),false);assert.match(rendered,/Synced/);assert.match(rendered,/Before:/);
});

import { PersistentOAuthProvider } from '../src/oauth.mjs';
import { PluginRegistry } from '../src/plugins.mjs';
import { SkillRegistry } from '../src/skills.mjs';
import { AgentManager } from '../src/agents.mjs';
import { McpManager } from '../src/mcp.mjs';

test('OAuth loopback callback captures authorization code', async()=>{
  const name='test-'+Math.random().toString(36).slice(2);const p=await new PersistentOAuthProvider(name).load();
  try{
    await p.startCallback();const state=await p.state(),wait=p.waitForCode(2000);
    await fetch(`${p.callbackUrl}?code=abc123&iss=test&state=${encodeURIComponent(state)}`);
    const r=await wait;assert.equal(r.code,'abc123');assert.equal(r.iss,'test');assert.equal(r.state,state);
  }finally{await p.close();await p.clear();}
});

test('Claude plugin commands and skills are discovered lazily',async()=>{
  const home=os.homedir(),name='craft-test-plugin-'+Math.random().toString(36).slice(2),root=path.join(home,'.craftcli','claude-plugins',name);
  await fs.mkdir(path.join(root,'.claude-plugin'),{recursive:true});await fs.mkdir(path.join(root,'commands'),{recursive:true});await fs.mkdir(path.join(root,'skills','lean'),{recursive:true});
  await fs.writeFile(path.join(root,'.claude-plugin','plugin.json'),JSON.stringify({name,version:'1.0.0',description:'test'}));
  await fs.writeFile(path.join(root,'commands','hello.md'),'Do the hello workflow for $ARGUMENTS');
  await fs.writeFile(path.join(root,'skills','lean','SKILL.md'),'---\nname: lean\ndescription: Stay lean\n---\nFull instructions here.');
  try{const pr=await new PluginRegistry(process.cwd(),[]).scan();assert.ok(pr.commands().some(x=>x.cmd===`/${name}:hello`));assert.match(pr.expandCommand(`${name}:hello`,'world').prompt,/world/);const sr=await new SkillRegistry(process.cwd()).scan();assert.ok(sr.list().some(x=>x.name==='lean'&&x.source===`plugin:${name}`));}finally{await fs.rm(root,{recursive:true,force:true});}
});

test('parallel subagents run with bounded per-agent budgets',async()=>{
  const fakeClient={stream:async({messages,onText})=>{onText?.('bounded result');return{message:{role:'assistant',content:'bounded result'},usage:{prompt_tokens:80,completion_tokens:20,total_tokens:100}};}};
  const fakeUsage={add:async()=>{}};const fakeSkills={list:()=>[],load:async()=>({})};const fakePlugins={list:()=>[],toolEntries:()=>[],hook:async()=>{}};const fakeMcp={list:()=>[],tools:async()=>[],call:async()=>({})};
  const cfg={agents:{defaultBudgetTokens:50000,maxSteps:2},maxAgentSteps:2,permissions:{write:'deny',shell:'deny'},tokenGuard:{},ignore:[]};
  const am=new AgentManager({client:fakeClient,model:'sonnet',cwd:process.cwd(),config:cfg,usage:fakeUsage,skills:fakeSkills,plugins:fakePlugins,mcp:fakeMcp});
  const rs=await am.team({task:'inspect safely',count:2,roles:['explorer','reviewer'],budgetPerAgent:50000});assert.equal(rs.length,2);assert.ok(rs.every(x=>x.status==='done'));assert.ok(rs.every(x=>x.used===100));
});

test('connector catalog exposes OAuth and browser-login connectors without loading tools',()=>{
  const m=new McpManager({}, {supabase:{type:'http',url:'https://mcp.supabase.com/mcp',oauth:true},github:{type:'stdio',command:'docker',browserOAuth:true}});const xs=m.list();assert.equal(xs.length,2);assert.equal(xs.find(x=>x.name==='supabase').oauth,true);assert.equal(xs.find(x=>x.name==='github').browserOAuth,true);
});

test('TUI merges installed plugin slash commands into command palette',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});tui.schedule=()=>{};tui.setExtraCommands([{cmd:'/superpowers:brainstorm',desc:'plugin'}]);tui.input='/super';assert.ok(tui.commandSuggestions().some(x=>x.cmd==='/superpowers:brainstorm'));
});

import { MarketplaceManager } from '../src/marketplace.mjs';
import {execFile as execFileCb} from 'node:child_process';
import {promisify as promisify2} from 'node:util';
const execFileTest=promisify2(execFileCb);

test('Claude marketplace local git source installs plugin',async()=>{
  const repo=await fs.mkdtemp(path.join(os.tmpdir(),'craft-market-')),marketName='market-'+Math.random().toString(36).slice(2),pluginName='plug-'+Math.random().toString(36).slice(2);
  await fs.mkdir(path.join(repo,'.claude-plugin'),{recursive:true});await fs.mkdir(path.join(repo,'commands'),{recursive:true});
  await fs.writeFile(path.join(repo,'.claude-plugin','marketplace.json'),JSON.stringify({name:marketName,plugins:[{name:pluginName,source:'./'}]}));
  await fs.writeFile(path.join(repo,'.claude-plugin','plugin.json'),JSON.stringify({name:pluginName,version:'1.0.0'}));await fs.writeFile(path.join(repo,'commands','ping.md'),'Ping $ARGUMENTS');
  await execFileTest('git',['init'],{cwd:repo});await execFileTest('git',['config','user.email','test@example.com'],{cwd:repo});await execFileTest('git',['config','user.name','Craft Test'],{cwd:repo});await execFileTest('git',['add','.'],{cwd:repo});await execFileTest('git',['commit','-m','init'],{cwd:repo});
  const mm=await new MarketplaceManager().scan();try{const a=await mm.add(repo);assert.equal(a.name,marketName);const p=await mm.install(`${pluginName}@${marketName}`);assert.equal(p.name,pluginName);assert.equal(p.version,'1.0.0');await mm.remove(pluginName);}finally{await fs.rm(repo,{recursive:true,force:true});}
});

import { SessionStore } from '../src/sessions.mjs';
import { loadProjectInstructions, initAgentsFile } from '../src/instructions.mjs';

test('sessions are titled, searchable, resumable, renameable and forkable',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-session-workspace-')),store=await new SessionStore(dir).init();
  try{
    await store.save({messages:[{role:'user',content:'Fix checkout access'}],transcript:[{role:'user',text:'Fix checkout access'},{role:'assistant',text:'Done'}],model:'m',mode:'build',effort:'high'});
    let rows=await store.list();assert.equal(rows[0].title,'Fix checkout access');assert.equal((await store.list({query:'checkout'})).length,1);
    const id=rows[0].id;await store.rename(id,'Checkout repair');assert.equal((await store.load('latest')).title,'Checkout repair');assert.equal((await store.load(id.slice(0,12))).id,id);
    const fork=await store.fork(id);assert.match(fork.title,/fork/);assert.notEqual(fork.id,id);
    const out=path.join(dir,'session.md');await store.exportMarkdown(fork.id,out);assert.match(await fs.readFile(out,'utf8'),/Checkout repair/);
    assert.equal(await store.remove(id),true);
  }finally{await fs.rm(store.dir,{recursive:true,force:true});await fs.rm(dir,{recursive:true,force:true});}
});

test('project instructions load AGENTS.md with a hard budget',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'craft-instructions-'));
  try{const made=await initAgentsFile(dir);assert.equal(made.created,true);await fs.writeFile(path.join(dir,'CLAUDE.md'),'x'.repeat(5000));const xs=await loadProjectInstructions(dir,{instructions:{maxChars:1500,files:['AGENTS.md','CLAUDE.md']}});assert.ok(xs.length>=1);assert.ok(xs.reduce((n,x)=>n+x.text.length,0)<=1700);}
  finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('TPM 429 is retried instead of surfaced immediately',async()=>{
  const oldFetch=globalThis.fetch,enc=new TextEncoder();let calls=0,noticed=0;
  globalThis.fetch=async()=>{calls++;if(calls===1)return new Response('rate limited',{status:429,headers:{'retry-after':'1','x-ratelimit-limit-tokens':'200000','x-ratelimit-remaining-tokens':'0'}});return new Response(new ReadableStream({start(c){c.enqueue(enc.encode('data: '+JSON.stringify({choices:[{delta:{content:'ok'},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\ndata: [DONE]\n\n'));c.close();}}),{status:200});};
  try{const c=new CodeCraftClient({apiKey:'x',baseUrl:'https://x/v1',onRateLimit:()=>noticed++});c._waitGate=async()=>{c.rateGate=0;};const r=await c.stream({model:'m',messages:[]});assert.equal(calls,2);assert.equal(noticed,1);assert.equal(r.message.content,'ok');}finally{globalThis.fetch=oldFetch;}
});

test('bang command routes through shell command handler',async()=>{
  let got='';const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),onCommand:async x=>{got=x;},showSplash:false});tui.schedule=()=>{};tui.input='!git status';tui.cursor=tui.input.length;await tui.submit();assert.equal(got,'/bash git status');assert.equal(tui.transcript.length,0);
});


import { describeMcpError } from '../src/mcp.mjs';

test('MCP errors are actionable instead of leaking transport noise',()=>{
  const missing=Object.assign(new Error('docker is not recognized as an internal or external command'),{code:'ENOENT'});
  assert.match(describeMcpError('github',missing,{command:'docker'}),/needs Docker Desktop/);
  assert.doesNotMatch(describeMcpError('github',missing,{command:'docker'}),/internal or external command/i);
  assert.match(describeMcpError('github',new Error('Connection closed'),{command:'docker'}),/Docker Desktop/);
});

test('TUI suppresses duplicate notice spam within a short window',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});tui.schedule=()=>{};
  tui.add('notice','Connection failed');
  tui.add('notice','Connection failed');
  assert.equal(tui.transcript.filter(x=>x.role==='notice').length,1);
});


test('package exposes both executable CLI bins', async()=>{
  const pkg=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.bin.craftcode,'src/index.mjs');
  assert.equal(pkg.bin.craftcli,'src/index.mjs');
});


test('mouse wheel scrolls internal conversation history when mouse UI is enabled',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false,mouseCapture:true});tui.schedule=()=>{};
  tui.handleMouse('\x1b[<64;10;10M');
  assert.equal(tui.scrollOffset,5);
  tui.handleMouse('\x1b[<65;10;10M');
  assert.equal(tui.scrollOffset,0);
});

test('edit tool cards render an inline red-green diff preview',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});tui.schedule=()=>{};
  const id=tui.toolStart({name:'replace_in_file',detail:'src/a.js',args:{path:'src/a.js',old_text:'const x = 1;',new_text:'const x = 2;'}});
  tui.toolEnd({cardId:id,result:'Updated src/a.js',durationMs:10,error:false});
  const rendered=tui.transcriptLines(100).map(stripAnsiForTest=>String(stripAnsiForTest).replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'')).join('\n');
  assert.match(rendered,/- const x = 1;/);
  assert.match(rendered,/\+ const x = 2;/);
});

test('Select command remains available while native selection is default',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});tui.schedule=()=>{};
  tui.input='/sel';
  assert.ok(tui.commandSuggestions().some(x=>x.cmd==='/select'));
  assert.equal(tui.mouseCapture,false);
});


test('OAuth provider exposes callable state instead of shadowing it with storage', async()=>{
  const name='oauth-state-'+Math.random().toString(36).slice(2),p=await new PersistentOAuthProvider(name).load();
  try{assert.equal(typeof p.state,'function');const s=await p.state();assert.ok(s.length>=20);assert.equal(p.lastState,s);p.validateState(s);assert.equal(p.lastState,'');}finally{await p.close();await p.clear();}
});

test('connector catalog uses hosted GitHub MCP and exposes Playwright browser', async()=>{
  const {loadConfig}=await import('../src/config.mjs');const c=await loadConfig(process.cwd());
  assert.equal(c.connectorCatalog.github.type,'http');
  assert.match(c.connectorCatalog.github.url,/api\.githubcopilot\.com\/mcp/);
  assert.equal(c.connectorCatalog.playwright.command,'npx');
  assert.ok(c.connectorCatalog.playwright.args.includes('@playwright/mcp@latest'));
});

test('public GitHub repo URL parser rejects local/non-GitHub targets', async()=>{
  const {parseGitHubRepoUrl}=await import('../src/web_tools.mjs');
  assert.deepEqual(parseGitHubRepoUrl('https://github.com/AIM-IT4/craftcode-CLI'),{owner:'AIM-IT4',repo:'craftcode-CLI'});
  assert.throws(()=>parseGitHubRepoUrl('http://127.0.0.1:3000/x'),/blocked/i);
  assert.throws(()=>parseGitHubRepoUrl('https://example.com/x/y'),/github\.com/i);
});


test('native terminal selection is the default',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});
  assert.equal(tui.mouseCapture,false);
});

test('frame painter stays one column short to prevent terminal autowrap overlap',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});
  tui.prevLines=[];let out='';const old=process.stdout.write;process.stdout.write=s=>{out+=String(s);return true;};
  try{tui.paintFrame(['x'],10);}finally{process.stdout.write=old;}
  assert.equal(tui.prevLines[0].length,9);
});

test('mouse capture is explicit and reversible',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});tui.running=true;tui.schedule=()=>{};tui.render=()=>{};
  let out='';const old=process.stdout.write;process.stdout.write=s=>{out+=String(s);return true;};
  try{tui.setMouseCapture(true);assert.equal(tui.mouseCapture,true);tui.setMouseCapture(false);assert.equal(tui.mouseCapture,false);}finally{process.stdout.write=old;}
  assert.match(out,/1000h/);assert.match(out,/1000l/);
});


test('Vercel connector uses CLI device auth instead of unapproved MCP OAuth', async()=>{
  const {loadConfig}=await import('../src/config.mjs');const cfg=await loadConfig(process.cwd());
  assert.equal(cfg.connectorCatalog.vercel.type,'cli');
  assert.equal(cfg.connectorCatalog.vercel.oauth,undefined);
  assert.match(cfg.connectorCatalog.vercel.authHint,/approved clients/i);
});

test('vercel_api is exposed as a first-class agent tool',()=>{
  const skills={list:()=>[],load:async()=>({})},plugins={list:()=>[],toolEntries:()=>[],activate:()=>{}},mcp={list:()=>[],tools:async()=>[],call:async()=>({})};
  const registry=new ToolRegistry({cwd:process.cwd(),config:{permissions:{mcp:'ask'},ignore:[],tokenGuard:{}},skills,plugins,mcp,askFn:async()=>true});
  assert.ok(registry.definitions('build').some(x=>x.function?.name==='vercel_api'));
});


test('CodeCraft estimates request tokens and exposes live rate profile',()=>{
  const c=new CodeCraftClient({apiKey:'x',baseUrl:'https://x/v1',maxOutputTokens:8192});
  c.rateLimits={tpmLimit:500000,tpmRemaining:420000,rpmLimit:300,rpmRemaining:299,reset:null};
  assert.ok(c.estimateRequestTokens([{role:'user',content:'hello'}],[])>=4096);
  assert.equal(c.rateProfile().tpmLimit,500000);
});

test('fallback 429 retry no longer hard-waits 60 seconds',async()=>{
  const oldFetch=globalThis.fetch,enc=new TextEncoder();let calls=0,wait=0;
  globalThis.fetch=async()=>{calls++;if(calls===1)return new Response('limited',{status:429,headers:{'x-ratelimit-limit-tokens':'200000','x-ratelimit-remaining-tokens':'0'}});return new Response(new ReadableStream({start(c){c.enqueue(enc.encode('data: '+JSON.stringify({choices:[{delta:{content:'ok'},finish_reason:'stop'}],usage:{total_tokens:2}})+'\n\ndata: [DONE]\n\n'));c.close();}}),{status:200});};
  try{const c=new CodeCraftClient({apiKey:'x',baseUrl:'https://x/v1',onRateLimit:x=>{wait=x.retryMs;}});c._waitGate=async()=>{c.rateGate=0;};await c.stream({model:'m',messages:[],tools:[]});assert.ok(wait>0&&wait<=15000);assert.equal(calls,2);}finally{globalThis.fetch=oldFetch;}
});

test('subagent parallelism adapts to TPM ceiling',()=>{
  const common={model:'m',cwd:process.cwd(),config:{agents:{maxParallel:4}},usage:{},skills:{},plugins:{},mcp:{}};
  assert.equal(new AgentManager({...common,client:{rateLimits:{tpmLimit:200000}}}).parallelLimit(),1);
  assert.equal(new AgentManager({...common,client:{rateLimits:{tpmLimit:500000}}}).parallelLimit(),2);
  assert.equal(new AgentManager({...common,client:{rateLimits:{tpmLimit:1000000}}}).parallelLimit(),3);
  assert.equal(new AgentManager({...common,client:{rateLimits:{tpmLimit:2000000}}}).parallelLimit(),4);
});


test('terminal startup enables alternate-scroll wheel-to-arrow translation in native-selection mode',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});
  const oldInTTY=process.stdin.isTTY,oldOutTTY=process.stdout.isTTY,oldRaw=process.stdin.setRawMode,oldResume=process.stdin.resume,oldOn=process.stdin.on,oldWrite=process.stdout.write,oldOutOn=process.stdout.on;
  let out='';
  Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true});Object.defineProperty(process.stdout,'isTTY',{value:true,configurable:true});
  process.stdin.setRawMode=()=>{};process.stdin.resume=()=>{};process.stdin.on=()=>{};process.stdout.on=()=>{};process.stdout.write=s=>{out+=String(s);return true;};
  tui.render=()=>{};try{tui.start();assert.match(out,/\x1b\[\?1007h/);}finally{clearInterval(tui._tick);tui.running=false;process.stdin.setRawMode=oldRaw;process.stdin.resume=oldResume;process.stdin.on=oldOn;process.stdout.on=oldOutOn;process.stdout.write=oldWrite;Object.defineProperty(process.stdin,'isTTY',{value:oldInTTY,configurable:true});Object.defineProperty(process.stdout,'isTTY',{value:oldOutTTY,configurable:true});}
});

test('plain up/down scroll transcript instead of mutating prompt history',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});tui.running=true;tui.schedule=()=>{};tui.history=['old prompt'];tui.input='current';tui.cursor=tui.input.length;
  tui.handleKey('\x1b[A');assert.equal(tui.input,'current');assert.equal(tui.scrollOffset,4);
  tui.handleKey('\x1b[B');assert.equal(tui.input,'current');assert.equal(tui.scrollOffset,0);
});

test('Ctrl+P and Ctrl+N navigate prompt history explicitly',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});tui.running=true;tui.schedule=()=>{};tui.history=['first','second'];
  tui.handleKey('\x10');assert.equal(tui.input,'second');
  tui.handleKey('\x10');assert.equal(tui.input,'first');
  tui.handleKey('\x0e');assert.equal(tui.input,'second');
});


test('mouse UI toggles between SGR wheel events and alternate-scroll translation',()=>{
  const tui=new TerminalTui({cwd:process.cwd(),model:'m',mode:'build',usage:fakeUsage(),showSplash:false});tui.running=true;tui.schedule=()=>{};tui.render=()=>{};
  let out='';const old=process.stdout.write;process.stdout.write=s=>{out+=String(s);return true;};
  try{
    tui.setMouseCapture(true);
    assert.match(out,/1007l/);assert.match(out,/1000h/);assert.match(out,/1006h/);
    out='';
    tui.setMouseCapture(false);
    assert.match(out,/1006l/);assert.match(out,/1000l/);assert.match(out,/1007h/);
  }finally{process.stdout.write=old;}
});


import { AgentSession } from '../src/agent.mjs';

function reliabilitySession({client,events={}}){
  return new AgentSession({
    client,model:'m',cwd:process.cwd(),mode:'build',effort:'high',
    config:{maxAgentSteps:20,autoCompactChars:300000,tokenGuard:{}},
    usage:{add:async()=>{}},
    skills:{list:()=>[]},plugins:{list:()=>[],hook:async()=>[]},mcp:{list:()=>[]},
    tools:{definitions:()=>[],execute:async()=> 'ok'},events
  });
}

test('agent continues after adaptive step segment instead of silently ending',async()=>{
  let calls=0;
  const client={rateLimits:{tpmLimit:200000},stream:async({onText})=>{
    calls++;
    if(calls<=12)return{message:{role:'assistant',content:null,tool_calls:[{id:'c'+calls,type:'function',function:{name:'read_file',arguments:'{}'}}]},usage:{total_tokens:1},finishReason:'tool_calls'};
    onText?.('completed');
    return{message:{role:'assistant',content:'completed'},usage:{total_tokens:1},finishReason:'stop'};
  }};
  const session=reliabilitySession({client});session.clear();
  const r=await session.run('complete a multi-step change');
  assert.equal(calls,13);
  assert.equal(r.text,'completed');
});

test('agent continues when provider stops a response at output length',async()=>{
  let calls=0;
  const client={rateLimits:{tpmLimit:500000},stream:async({onText})=>{
    calls++;
    const text=calls===1?'partial ':'completed';
    onText?.(text);
    return{message:{role:'assistant',content:text},usage:{total_tokens:1},finishReason:calls===1?'length':'stop'};
  }};
  const session=reliabilitySession({client});session.clear();
  const r=await session.run('finish the response');
  assert.equal(calls,2);
  assert.equal(r.text,'partial completed');
});
