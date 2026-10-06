#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadConfig,writeStarterConfig,GLOBAL_CONFIG,resolvePlanTokens,parseTokenAmount,updateProjectConfig,updateGlobalConfig,normalizeProviderConfig,providerLoginPatch} from './config.mjs';
import {ProviderRegistry} from './providers/index.mjs';
import {UsageTracker} from './usage.mjs';
import {SkillRegistry} from './skills.mjs';
import {PluginRegistry} from './plugins.mjs';
import {McpManager} from './mcp.mjs';
import {ToolRegistry} from './tools.mjs';
import {AgentSession} from './agent.mjs';
import {TerminalTui} from './tui.mjs';
import {SessionStore} from './sessions.mjs';
import {FileReferenceIndex} from './file_refs.mjs';
import {CheckpointManager} from './checkpoints.mjs';
import {fmtTokens,providerStatusSummary} from './ui.mjs';
import {MarketplaceManager} from './marketplace.mjs';
import {AgentManager} from './agents.mjs';
import {resolveProviderApiKey,saveProviderApiKey,clearProviderApiKey,maskKey,promptSecret,AUTH_FILE} from './auth.mjs';
import {spawn} from 'node:child_process';
import {loadProjectInstructions,initAgentsFile} from './instructions.mjs';
import {runRuntimeEvals} from './evals.mjs';
import {FlightRecorder,summarizeFlightEvent} from './flight_recorder.mjs';
import {formatProof} from './proof.mjs';

function parseArgs(){
  const a=process.argv.slice(2);let yes=false,cwd=process.cwd(),resume=false,showSplash=true,doctor=false,version=false;
  let action='',actionArg='',actionProvider='',resumeRef='latest';
  if(a[0]==='auth'){action='auth';actionArg=(a[1]||'status').toLowerCase();actionProvider=(a[2]||'').toLowerCase();a.splice(0,3);}
  else if((a[0]||'').toLowerCase()==='eval'){action='eval';actionArg=(a[1]||'runtime').toLowerCase();a.splice(0,2);}
  else if(['update','upgrade'].includes(a[0])){action='update';a.splice(0,1);}
  else if(['resume','continue'].includes((a[0]||'').toLowerCase())){resume=true;a.splice(0,1);}
  for(let i=0;i<a.length;i++){
    if(a[i]==='--yes'||a[i]==='-y')yes=true;
    else if(a[i]==='--resume'||a[i]==='--continue'||a[i]==='-c')resume=true;
    else if(a[i]==='--no-splash')showSplash=false;
    else if(a[i]==='--doctor')doctor=true;
    else if(a[i]==='--version'||a[i]==='-v')version=true;
    else if(a[i].startsWith('--session=')){resume=true;resumeRef=a[i].slice(10)||'latest';}
    else if(!a[i].startsWith('-'))cwd=path.resolve(a[i]);
  }
  return{yes,cwd,resume,resumeRef,showSplash,doctor,version,action,actionArg,actionProvider};
}

async function runUpdate(){
  console.log('Updating Craft Code from npm…');
  const exe=process.platform==='win32'?'npm.cmd':'npm';
  await new Promise((resolve,reject)=>{
    const p=spawn(exe,['install','-g','craftcode-codecraft@latest'],{stdio:'inherit',shell:false});
    p.on('error',reject);p.on('exit',c=>c===0?resolve():reject(new Error(`npm exited with code ${c}`)));
  });
  console.log('Craft Code updated. Run: craftcode --version');
}

async function handleAuth(actionArg,providerArg,cwd){
  await writeStarterConfig();const config=normalizeProviderConfig(await loadConfig(cwd)),registry=new ProviderRegistry(config),providerId=providerArg||registry.activeId(),p=registry.get(providerId);
  if(actionArg==='login'){
    if(p.auth===false){const patch=providerLoginPatch(providerArg,providerId);if(patch)await updateGlobalConfig(patch);console.log(`${p.label} does not require an API key.${patch?' Set as active provider.':''}`);return;}
    const key=await promptSecret(`${p.label} API key`);if(!key)throw new Error('No API key entered.');
    process.stdout.write(`Validating with ${p.label}… `);const probe=registry.create(providerId,{apiKey:key,maxOutputTokens:8});
    try{await probe.models();}catch(e){console.log('failed');throw new Error(`${p.label} rejected the key: ${e.message}`);}
    const file=await saveProviderApiKey(providerId,key),patch=providerLoginPatch(providerArg,providerId);if(patch)await updateGlobalConfig(patch);console.log('ok');console.log(`Saved ${p.label} credential: ${file}${patch?' · active provider set to '+providerId:''}`);return;
  }
  if(actionArg==='logout'){await clearProviderApiKey(providerId);console.log(`Stored ${p.label} API key removed.`);return;}
  const a=await resolveProviderApiKey(providerId,p);console.log(`${p.label} auth: ${p.auth===false?'not required':a.key?'configured':'not configured'}`);console.log(`Source: ${p.auth===false?'none required':a.source}`);if(a.key)console.log(`Key: ${maskKey(a.key)}`);console.log(`Credential file: ${AUTH_FILE}`);
}
const toolCapable=m=>!Array.isArray(m?.supported_parameters)||m.supported_parameters.includes('tools');
function pickDefaultModel(ms,x){const rows=(ms||[]).filter(toolCapable),ids=rows.map(m=>m.id||m.name).filter(Boolean);if(x&&ids.includes(x))return x;return ids.find(x=>/opus/i.test(x))||ids[0]||'';}
function pickSubagentModel(ms,main){const ids=(ms||[]).filter(toolCapable).map(m=>m.id||m.name).filter(Boolean);return ids.find(x=>/sonnet/i.test(x))||ids.find(x=>x!==main)||main;}
function resolveUsagePlan(config,client,providerId){if(providerId==='codecraft')return resolvePlanTokens(config,client.planHint?.());const explicit=parseTokenAmount(config.planTokens);if(config.planTokens!=='auto'&&explicit)return{tokens:explicit,source:'config'};return{tokens:Infinity,source:'observed'};}
const PERMISSION_PRESETS={ask:{label:'Ask',write:'ask',shell:'ask',mcp:'ask'},edit:{label:'Edit',write:'allow',shell:'ask',mcp:'ask'},auto:{label:'Auto',write:'allow',shell:'allow',mcp:'allow'},locked:{label:'Read only',write:'deny',shell:'deny',mcp:'deny'}};
function permissionPresetOf(p={}){return Object.entries(PERMISSION_PRESETS).find(([,v])=>v.write===p.write&&v.shell===p.shell&&(p.mcp??'ask')===v.mcp)?.[0]||'ask';}
function activityForTool(x={}){const n=String(x.name||''),d=String(x.detail||'');if(n==='semantic_code')return 'Tracing symbols';if(n==='repo_map')return 'Mapping the codebase';if(n==='search_files')return 'Searching';if(n==='read_many_files')return 'Reading files';if(n==='read_file'||n==='list_files')return 'Reading';if(n==='replace_in_file'||n==='write_file')return 'Editing';if(n==='discover_project_commands')return 'Finding project checks';if(n==='run_command'){if(/(?:^|\s)(test|pytest|jest|vitest|mocha|cargo test|go test|npm test|pnpm test|yarn test)(?:\s|$)/i.test(d))return 'Running tests';if(/lint|eslint|ruff/i.test(d))return 'Linting';if(/typecheck|type-check|tsc/i.test(d))return 'Type checking';if(/build|compile|vite build|next build/i.test(d))return 'Building';return 'Running a command';}if(n==='git_diff')return 'Reviewing the diff';if(n.startsWith('git_'))return 'Checking Git';if(n.startsWith('process_'))return 'Watching the process';if(n==='orchestrate_task')return 'Coordinating agents';if(n==='load_skill')return 'Loading guidance';if(n.includes('mcp'))return 'Connecting';if(n==='update_todo')return 'Planning';return 'Working';}
const table=(rows,cols)=>rows.map(r=>cols.map(([k,w])=>String(r[k]??'').slice(0,w).padEnd(w)).join('  ')).join('\n');
const day=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const vercelExe=()=>process.platform==='win32'?'npx.cmd':'npx';
async function vercelCapture(args,cwd){
  return new Promise((resolve)=>{
    const p=spawn(vercelExe(),['-y','vercel@latest',...args],{cwd,stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
    let stdout='',stderr='';p.stdout?.on('data',b=>stdout+=b);p.stderr?.on('data',b=>stderr+=b);
    p.on('error',e=>resolve({code:-1,stdout,stderr:String(e.message||e)}));
    p.on('exit',code=>resolve({code:code??-1,stdout,stderr}));
  });
}
async function vercelBrowserLogin(cwd,tui){
  let who=await vercelCapture(['whoami'],cwd);
  if(who.code===0&&who.stdout.trim())return who.stdout.trim();
  tui.stop();
  try{
    console.log('\nCraft Code → Vercel browser approval');
    console.log('Opening Vercel OAuth device approval. No global Vercel CLI install is required.\n');
    await new Promise((resolve,reject)=>{
      const p=spawn(vercelExe(),['-y','vercel@latest','login'],{cwd,stdio:'inherit',shell:false});
      p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error('Vercel login exited with code '+code)));
    });
  }finally{tui.start();}
  who=await vercelCapture(['whoami'],cwd);
  if(who.code!==0||!who.stdout.trim())throw new Error('Vercel login completed but vercel whoami could not verify the account.');
  return who.stdout.trim();
}


async function main(){
  const{yes,cwd,resume,resumeRef,showSplash,doctor,version,action,actionArg,actionProvider}=parseArgs();
  if(version){console.log('Craft Code 0.11.3');return;}
  if(action==='eval'){
    if(actionArg!=='runtime')throw new Error('Only credential-free runtime evals are available: craftcode eval runtime');
    const r=await runRuntimeEvals();
    console.log(`Runtime evals: ${r.passed}/${r.total} passed`);
    for(const x of r.cases)console.log(`${x.ok?'✓':'✗'} ${x.name}${x.ok?'':': '+x.error}`);
    if(r.failed)process.exitCode=1;
    return;
  }
  if(action==='auth'){await handleAuth(actionArg,actionProvider,cwd);return;}
  if(action==='update'){await runUpdate();return;}
  if(doctor){
    await writeStarterConfig();const dc=normalizeProviderConfig(await loadConfig(cwd)),dr=new ProviderRegistry(dc),pid=dr.activeId(),pc=dr.get(pid),credential=await resolveProviderApiKey(pid,pc);
    console.log('Craft Code 0.11.3');console.log(`Entrypoint: ${new URL(import.meta.url).pathname}`);console.log(`Node: ${process.version}`);console.log(`CWD: ${process.cwd()}`);console.log(`Provider: ${pc.label} (${pid})`);console.log(`Provider auth: ${pc.auth===false?'not required':credential.key?'configured':'missing'} (${pc.auth===false?'none required':credential.source})`);return;
  }
  try{await fs.access(cwd);}catch{console.error(`Workspace not found: ${cwd}`);return;}
  await writeStarterConfig();
  const config=normalizeProviderConfig(await loadConfig(cwd)),providers=new ProviderRegistry(config);
  let providerId=providers.activeId(),providerConfig=providers.get(providerId),auth=await resolveProviderApiKey(providerId,providerConfig);
  if(providerConfig.auth!==false&&!auth.key){console.error(`No ${providerConfig.label} API key configured. Run: craftcode auth login ${providerId}`);return;}
  let client=providers.create(providerId,{apiKey:auth.key,maxOutputTokens:config.maxOutputTokens});
  let availableModels=[];try{availableModels=await client.models();}catch(e){console.error(`${providerConfig.label}: ${e.message}`);return;}
  let model=pickDefaultModel(availableModels,config.model);
  if(!model)return console.error(`No tool-capable model available from ${providerConfig.label}.`);
  let planResolved=resolveUsagePlan(config,client,providerId);
  const usage=await new UsageTracker(planResolved.tokens,config.resetDay).load();
  const marketplace=await new MarketplaceManager().scan();
  const skills=await new SkillRegistry(cwd).scan();
  const plugins=await new PluginRegistry(cwd,config.activePlugins,{allowClaudeHooks:config.claudePlugins?.allowHooks}).scan();
  const mcp=new McpManager(config.mcpServers,config.connectorCatalog||{});
  mcp.setPluginConfigs(await plugins.mcpServers());
  const store=await new SessionStore(cwd).init();
  const recorder=config.flightRecorder?.enabled===false?null:await new FlightRecorder(cwd,{maxRuns:config.flightRecorder?.maxRuns||120}).init();
  const refs=new FileReferenceIndex(cwd,{ignore:config.ignore||[]});
  const checkpoints=await new CheckpointManager(cwd).init();
  try{await refs.scan();}catch{}
  let projectInstructions=await loadProjectInstructions(cwd,config);

  let mode=config.defaultMode||'build',effort=config.defaultEffort||'high',permissionPreset=permissionPresetOf(config.permissions),session,tui,stopping=false,processing=false,lastRunId='';
  const askFn=async q=>{const m=String(q).match(/^([^:]+):\s*(.*)$/s);return tui.askApproval((m?.[1]||'action').toLowerCase(),m?.[2]||q);};
  const agents=new AgentManager({client,model:pickSubagentModel(availableModels,model),cwd,config,usage,skills,plugins,mcp,projectInstructions,events:{onChange:x=>tui?.setAgents(x)}});
  const tools=new ToolRegistry({cwd,config,skills,plugins,mcp,agents,checkpoints,yes,onNotice:()=>{},onTodo:x=>tui?.setTodos(x),askFn});
  const thinkingWords=['Thinking','Analyzing','Tracing the issue','Checking assumptions','Planning the next step','Looking closer','Connecting the dots','Reviewing the approach','Verifying details','Refining the answer'];
  const events={
    onTurnStart:()=>tui?.setBusy(true),
    onThinking:x=>tui?.setActivity(thinkingWords[(x?.step||0)%thinkingWords.length]),
    onText:t=>tui?.stream(t),
    onUsage:u=>tui?.setMeta({requestUsage:u}),
    onContext:(n,stats)=>tui?.setMeta({contextChars:n,contextWindowTokens:stats?.contextWindow||0}),
    onWarn:s=>tui?.add('notice',s),
    onToolStart:x=>{tui?.setActivity(activityForTool(x));return tui?.toolStart(x);},
    onToolEnd:x=>{tui?.toolEnd(x);tui?.setActivity('Reviewing results');},
    onCancelled:()=>tui?.add('notice','Turn cancelled. Completed edits remain available through /undo.'),
    onCheckpoint:cp=>{tui?.setCheckpoint(cp.id);tui?.setNotice('Checkpoint ready · Undo available',1800);},
    onTrace:x=>recorder?.record(x.type,x),
    onTurnEnd:()=>tui?.setBusy(false)
  };
  client.onRateLimit=({retryMs,tpmLimit,tpmRemaining,proactive})=>{const secs=Math.max(1,Math.ceil(retryMs/1000));tui?.setActivity(proactive?'Pacing requests':'Rate limit');tui?.setNotice(`${proactive?'TPM pacing':'TPM limit'} · ${proactive?'waiting':'retrying'} ${secs}s${tpmLimit?` · ${fmtTokens(tpmRemaining||0)}/${fmtTokens(tpmLimit)} remaining`:''}`,Math.min(Math.max(retryMs,1800),30000));};
  session=new AgentSession({client,model,cwd,mode,effort,config,usage,skills,plugins,mcp,tools,checkpoints,events,projectInstructions});
  session.clear();
  const startupHookContext=await plugins.hook('session.start',{cwd});if(startupHookContext?.length)session.setPluginContext(startupHookContext);

  const save=async()=>store.save({provider:providerId,messages:session.messages,transcript:tui.getTranscript(),model:session.model,mode:session.mode,effort:session.effort,proof:session.lastProof,lastRunId});
  const exit=async()=>{if(stopping)return;stopping=true;try{await save();}catch{}try{await tools.close?.();}catch{}try{await mcp.closeAll();}catch{}tui.stop();process.exit(0);};
  const setMode=x=>{mode=x;session.setMode(x);tui.setMeta({mode:x});};
  const setEffort=x=>{effort=x;session.setEffort(x);tui.setMeta({effort:x});};
  const setModel=x=>{const caps=client.capabilities?.(x);if(mode==='build'&&caps?.tools===false){tui?.add('notice',`Model ${x} does not advertise tool calling on ${providerConfig.label}.`);return false;}model=x;session.model=x;session.emitContext?.();tui.setMeta({model:x,contextWindowTokens:session.contextWindow?.()||0});return true;};
  const setProvider=async id=>{
    const p=providers.get(id),credential=await resolveProviderApiKey(id,p);if(p.auth!==false&&!credential.key)throw new Error(`${p.label} is not authenticated. Run: craftcode auth login ${id}`);
    const next=providers.create(id,{apiKey:credential.key,maxOutputTokens:config.maxOutputTokens,onRateLimit:client.onRateLimit}),ms=await next.models(),nextModel=pickDefaultModel(ms,id===providerId?model:'');
    if(!nextModel)throw new Error(`No tool-capable model available from ${p.label}.`);
    providerId=id;providerConfig=p;client=next;availableModels=ms;model=nextModel;session.client=client;session.model=model;session.emitContext?.();agents.client=client;agents.model=pickSubagentModel(ms,model);
    planResolved=resolveUsagePlan(config,client,providerId);usage.planTokens=planResolved.tokens;config.provider=id;config.model=model;await updateProjectConfig(cwd,{provider:id,model});
    tui.setMeta({provider:id,model,planTokens:planResolved.tokens,planSource:planResolved.source});tui.setNotice(`Provider · ${p.label} · ${model}`,2200);return true;
  };
  const setPermissions=preset=>{const p=PERMISSION_PRESETS[preset]||PERMISSION_PRESETS.ask;permissionPreset=preset in PERMISSION_PRESETS?preset:'ask';config.permissions.write=p.write;config.permissions.shell=p.shell;config.permissions.mcp=p.mcp;tui?.setMeta({permissionPreset});tui?.setNotice(`Permissions · ${p.label}`,1400);};
  const cyclePermissions=()=>{const order=['ask','edit','auto','locked'],i=order.indexOf(permissionPreset);setPermissions(order[(i+1)%order.length]);};
  const persistApproval=(kind,decision)=>{if(kind==='shell')config.permissions.shell=decision;if(kind==='write')config.permissions.write=decision;if(kind==='mcp')config.permissions.mcp=decision;permissionPreset=permissionPresetOf(config.permissions);tui?.setMeta({permissionPreset});};
  const resumeSession=async(ref='latest')=>{
    const s=await store.load(ref||'latest');if(!s){tui.add('notice','No matching saved session found.');return false;}
    const savedProvider=s.provider||'codecraft';if(savedProvider!==providerId)await setProvider(savedProvider);
    if(s.model){const exists=availableModels.some(m=>(m.id||m.name)===s.model);if(exists)setModel(s.model);else tui.add('notice',`Saved model ${s.model} is not available from ${providerConfig.label}; using ${model}.`);}
    session.setMode(s.mode||'build');session.setEffort(s.effort||effort);const repaired=session.restore(s.messages||[]);
    session.lastProof=s.proof||null;lastRunId=s.lastRunId||'';mode=session.mode;effort=session.effort;tui.replaceTranscript(s.transcript||[]);tui.setMeta({provider:providerId,model,mode,effort,contextChars:session.contextChars(),contextWindowTokens:session.contextWindow?.()||0});if(repaired)tui.add('notice',`Recovered ${repaired} interrupted session message ${repaired===1?'entry':'entries'} while resuming.`);tui.setNotice(`Resumed · ${s.title||s.id}`,2200);return true;
  };
  const currentStatus=async()=>{
    let git='not a Git repository';try{const x=await tools.execute('git_status',{},'plan');git=String(x||'clean').split('\n').slice(0,4).join('\n');}catch{}
    const u=usage.snapshot(),ctx=session.contextStats(),connected=mcp.list().filter(x=>x.connected).map(x=>x.name),title=store.currentTitle||'Untitled session',rate=client.rateProfile();
    const providerSummary=providerStatusSummary({providerLabel:providerConfig.label,providerId,model:session.model,usage:u,planSource:planResolved.source});
    return `# Craft Code status\n\n- **Session:** ${title} (\`${store.currentId}\`)\n- **Workspace:** \`${cwd}\`\n${providerSummary}\n- **Mode / effort:** ${mode} / ${effort}\n- **Permissions:** ${permissionPreset}\n- **Context:** ~${fmtTokens(ctx.estimatedTokens)}${ctx.contextWindow?` / ${fmtTokens(ctx.contextWindow)} (${ctx.percent}%)`:''} · ${ctx.messages} messages\n- **API rate:** ${rate.tpmLimit?fmtTokens(rate.tpmLimit)+' TPM · '+fmtTokens(rate.tpmRemaining??0)+' remaining':'not reported yet'}${rate.rpmLimit?' · '+rate.rpmLimit+' RPM':''}\n- **Project instructions:** ${projectInstructions.length?projectInstructions.map(x=>x.file).join(', '):'none'}\n- **Skills / plugins:** ${skills.list().length} / ${plugins.list().length}\n- **Connected MCP:** ${connected.length?connected.join(', '):'none'}\n- **Last proof:** ${session.lastProof?.applicable?`${session.lastProof.score}/100 (${session.lastProof.label})`:'n/a'}\n- **Last flight:** ${lastRunId?`\`${lastRunId}\``:'none'}\n\n## Git\n\n\`\`\`\n${git}\n\`\`\``;
  };

  const runOne=async(raw,{implementing=false}={})=>{
    if(processing)return;processing=true;let runId='';
    try{
      const ex=await refs.expand(raw);
      if(ex.refs.length)tui.setNotice(`Attached ${ex.refs.map(x=>'@'+x).join(', ')}`,1600);
      for(const w of ex.warnings)tui.add('notice',w);
      if(recorder)runId=await recorder.begin({sessionId:store.currentId,provider:providerId,model:session.model,goal:String(raw).replace(/\s+/g,' ').trim().slice(0,180),messageStart:session.messages.length});
      const r=await session.run(ex.prompt);
      if(runId){await recorder.finish({status:r.cancelled?'cancelled':r.completed?'completed':r.stalled?'stalled':'incomplete',proof:r.proof||null,messageCount:session.messages.length,contextEpoch:session.traceEpoch});lastRunId=runId;}
      await save();
      if(r.proof?.applicable)tui.setNotice(`Proof ${r.proof.score}/100 · ${r.proof.label}`,2200);
      if(!r.cancelled&&mode==='plan'&&!implementing){
        const a=await tui.askPlanApproval();
        if(a==='implement'){
          setMode('build');tui.setNotice('Plan approved · Build mode',1500);tui.add('user','Implement the approved plan.');processing=false;
          await runOne('Implement the approved plan above. Make focused changes and verify them.',{implementing:true});return;
        }
        if(a==='stay')tui.setNotice('Staying in Plan mode.');
      }
    }catch(e){if(runId&&recorder?.active?.id===runId){await recorder.finish({status:'error',error:String(e.message||e),messageCount:session.messages.length,contextEpoch:session.traceEpoch});lastRunId=runId;}tui.add('notice',e.message||String(e));tui.setBusy(false);}finally{processing=false;}
    while(!processing&&tui.hasQueue()){const n=tui.dequeue();if(!n)break;tui.add('user',n);await runOne(n);}
  };

  const buildArenaCandidates=async(useAll=false)=>{
    const current={provider:providerId,client,model:pickSubagentModel(availableModels,model)};
    if(!useAll)return[current];
    const out=[current],seen=new Set([providerId]);
    for(const p of providers.list()){
      if(seen.has(p.id))continue;seen.add(p.id);
      try{
        const credential=await resolveProviderApiKey(p.id,p);if(p.auth!==false&&!credential.key)continue;
        const candidateClient=providers.create(p.id,{apiKey:credential.key,maxOutputTokens:config.maxOutputTokens}),models=await candidateClient.models(),candidateModel=pickSubagentModel(models,pickDefaultModel(models,''));
        if(candidateModel)out.push({provider:p.id,client:candidateClient,model:candidateModel});
      }catch{}
    }
    return out;
  };

  const command=async line=>{
    const parts=line.trim().split(/\s+/),cmd=(parts[0]||'').toLowerCase(),rest=parts.slice(1),arg=rest.join(' ');
    try{
      if(cmd==='/exit'||cmd==='/quit')return await exit();
      if(cmd==='/select'){tui.enterSelectionMode();return;}
      if(cmd==='/mouse'){const v=(rest[0]||'').toLowerCase();if(!['on','off'].includes(v))return tui.add('notice','Use /mouse on|off. Native terminal selection is the default.');tui.setMouseCapture(v==='on');return;}
      if(cmd==='/help'){
        tui.add('assistant','Enter sends · Ctrl+J inserts a new line · Esc cancels the active turn\n↑/↓ selects command/file suggestions · Tab completes\nWheel/↑↓/PgUp/PgDn scroll transcript · Ctrl+P/Ctrl+N recall prompt history · drag-select + Ctrl+C works by default\nAlt+↑/↓ selects tool cards · Ctrl+O expands a tool card\n\nSessions: /sessions opens an interactive resume picker; /resume resumes latest; /session name <title>, /session fork, /session export and /session delete manage history. From CMD use `craftcode continue <project>` or `craftcode -c <project>`.\n\nUse /status, /context, /proof, /flight, /replay, /instructions, /provider, /model, /mode, /effort, /permissions, /style and /usage for controls. /arena compares isolated candidate patches; /arena uses the current provider by default, so CodeCraft alone is sufficient. /agents and /team launch bounded subagents. /plugin supports Claude marketplaces. /connect manages integrations and opens browser approval automatically when the connector supports it. Vercel uses its official OAuth device flow through a transient `npx vercel@latest` invocation, so no global Vercel CLI install is required. /browser starts the Playwright Chromium connector; public URLs and GitHub repository links can also be inspected directly without a browser. Shift+Tab cycles permission presets. Footer controls are keyboard-first; enable clickable mouse controls explicitly with `/mouse on`.');return;
      }
      if(cmd==='/mode'){
        if(rest[0]&&['plan','build'].includes(rest[0].toLowerCase())){setMode(rest[0].toLowerCase());return tui.setNotice(`Mode · ${rest[0].toUpperCase()}`);}
        const chosen=await tui.pickMode(mode);if(chosen){setMode(chosen);tui.setNotice(`Mode · ${chosen.toUpperCase()}`);}return;
      }
      if(cmd==='/effort'){
        if(rest[0]&&['low','normal','high'].includes(rest[0].toLowerCase())){setEffort(rest[0].toLowerCase());return tui.setNotice(`Agent depth · ${rest[0]}`);}
        const chosen=await tui.pickEffort(effort);if(chosen){setEffort(chosen);tui.setNotice(`Agent depth · ${chosen}`);}return;
      }
      if(cmd==='/providers'){
        const rows=[];for(const p of providers.list()){const a=await resolveProviderApiKey(p.id,p);rows.push(`${p.id===providerId?'●':'○'} ${p.label} [${p.id}] · ${p.auth===false?'no key required':a.key?'authenticated':'not authenticated'} · ${p.baseUrl}`);}tui.add('assistant',rows.join('\n'));return;
      }
      if(cmd==='/provider'){
        let id=(rest[0]||'').toLowerCase();if(!id){const items=[];for(const p of providers.list()){const a=await resolveProviderApiKey(p.id,p);items.push({id:p.id,label:p.label,meta:p.auth===false?'no key':a.key?'connected':'needs API key'});}id=await tui.pickProvider(items,providerId);if(!id)return;}
        await setProvider(id);return;
      }
      if(cmd==='/models'||cmd==='/model'){
        if(arg&&cmd==='/model'){if(setModel(arg))tui.setNotice(`Model · ${arg}`);return;}
        const ms=await client.models();availableModels=ms;const chosen=await tui.pickModel(ms,model);if(chosen&&setModel(chosen))tui.setNotice(`Model · ${chosen}`);return;
      }
      if(cmd==='/permissions'||cmd==='/permission'||cmd==='/perm'){
        const aliases={ask:'ask',safe:'ask',edit:'edit',auto:'auto',allow:'auto',locked:'locked',readonly:'locked','read-only':'locked'};
        if(rest[0]&&aliases[rest[0].toLowerCase()]){setPermissions(aliases[rest[0].toLowerCase()]);return;}
        const chosen=await tui.pickPermissions(permissionPreset);if(chosen)setPermissions(chosen);return;
      }
      if(cmd==='/usage'){
        if(rest[0]==='add'){await usage.seed(Number(rest[1]));return tui.setNotice('Usage seeded.');}
        if(rest[0]==='set'){await usage.set(Number(rest[1]));return tui.setNotice('Usage reconciled.');}
        if(rest[0]==='plan'){const n=parseTokenAmount(rest[1]);if(!n)return tui.add('notice','Use /usage plan 30m (or another token amount).');usage.planTokens=n;tui.setMeta({planTokens:n,planSource:'manual'});return tui.setNotice(`Plan display · ${fmtTokens(n)}`);}
        tui.openUsage();return;
      }
      if(cmd==='/skills'){
        await skills.scan();
        if(rest[0]==='savings'){const x=skills.estimateSavings();tui.add('assistant',`Lazy skills: ${x.skills} discovered. Loading all of them would add roughly ${fmtTokens(x.fullLoadEstimatedTokens)} tokens; Craft Code sends only names/descriptions until load_skill is called.`);return;}
        tui.add('assistant',skills.list().map(s=>`${s.name}${s.source?` [${s.source}]`:''} — ${s.description}`).join('\n')||'No skills found.');return;
      }
      if(cmd==='/plugins'){tui.add('assistant',plugins.list().map(p=>`${p.active?'●':'○'} ${p.name}${p.version?` ${p.version}`:''} [${p.type}] — ${p.description||''}`).join('\n')||'No plugins found.');return;}
      if(cmd==='/plugin'){
        const sub=(rest[0]||'').toLowerCase();
        if(sub==='marketplace'&&rest[1]==='add'&&rest[2]){const r=await marketplace.add(rest.slice(2).join(' '));await marketplace.scan();return tui.add('assistant',`Marketplace ${r.name} added · ${r.plugins} plugin(s).`);}
        if(sub==='marketplace'){const xs=marketplace.listMarketplaces();return tui.add('assistant',xs.map(x=>`${x.name} — ${x.plugins} plugins`).join('\n')||'No marketplaces configured.');}
        if(sub==='install'&&rest[1]){const r=await marketplace.install(rest[1]);await skills.scan();await plugins.scan();mcp.setPluginConfigs(await plugins.mcpServers());tui.setExtraCommands(plugins.commands());return tui.add('assistant',`Installed ${r.name}${r.version?` ${r.version}`:''}. Skills and slash commands are available now.`);}
        if(sub==='update'&&rest[1]){const r=await marketplace.update(rest[1]);await skills.scan();await plugins.scan();mcp.setPluginConfigs(await plugins.mcpServers());tui.setExtraCommands(plugins.commands());return tui.add('assistant',`Updated ${r.name}${r.version?` ${r.version}`:''}.`);}
        if((sub==='remove'||sub==='uninstall')&&rest[1]){await marketplace.remove(rest[1]);await skills.scan();await plugins.scan();mcp.setPluginConfigs(await plugins.mcpServers());tui.setExtraCommands(plugins.commands());return tui.add('assistant',`Removed ${rest[1]}.`);}
        if(sub==='available'){return tui.add('assistant',marketplace.available().map(x=>`${x.name}@${x.marketplace}${x.version?` ${x.version}`:''} — ${x.description}`).join('\n')||'No marketplace plugins discovered.');}
        if(sub==='hooks'){const on=(rest[1]||'').toLowerCase()==='on';if(on&&!await tui.askApproval('shell','Enable installed Claude-plugin lifecycle hooks? Hooks can execute local commands.'))return tui.setNotice('Plugin hooks remain off.');plugins.setClaudeHooks(on);config.claudePlugins.allowHooks=on;if(on){const x=await plugins.hook('session.start',{cwd});if(x?.length)session.setPluginContext(x);}return tui.setNotice(`Claude plugin hooks · ${on?'ON (trusted plugins only)':'OFF'}`);}
        if(arg){plugins.activate(arg);return tui.setNotice(`Activated plugin ${arg}`);}return command('/plugins');
      }
      if(cmd==='/browser'){
        const sub=(rest[0]||'').toLowerCase();
        if(sub==='connect'||sub==='start'||!sub){tui.setNotice('Starting Playwright Chromium connector…',0);try{await mcp.authenticate('playwright');tui.setNotice('Playwright browser connected',2200);const ts=await mcp.tools('playwright');return tui.add('assistant',`Playwright Chromium is connected with ${ts.length} browser tools. Ask Craft Code to open or navigate a URL; browser tool schemas stay lazy until needed.\n\nPublic GitHub repository links do not need a browser: paste the link and Craft Code can inspect the README/tree directly.`);}catch(e){return tui.add('notice',e.message||String(e));}}
        if(/^https?:\/\//i.test(arg)){tui.add('user',arg);await runOne(`Inspect this URL carefully and summarize what is relevant: ${arg}`);return;}
        return tui.add('assistant','Use /browser to start Playwright Chromium, or paste a public URL directly. Public GitHub repo URLs work without a browser through inspect_repo_url.');
      }
      if(cmd==='/mcp'){
        if(rest[0]==='tools'&&rest[1]){const ts=await mcp.tools(rest[1]);tui.add('assistant',ts.map(t=>`${t.name} — ${t.description||''}`).join('\n')||'No tools.');}
        else tui.add('assistant',mcp.list().map(x=>{const auth=x.authMode==='browser'?'Browser approval':x.authMode==='token'?'Token / existing login':x.authMode==='local'?'Local':'Direct';return`${x.connected?'●':'○'} ${x.name} [${x.type} · ${auth}]`;}).join('\n')||'No MCP servers configured.');return;
      }
      if(cmd==='/connect'){
        let name=rest[0];if(!name){name=await tui.pickConnector(mcp.list());if(!name)return;}
        name=String(name).toLowerCase();
        if(name==='vercel'){
          tui.setNotice('Opening Vercel browser approval…',0);
          try{
            const user=await vercelBrowserLogin(cwd,tui);
            tui.setNotice('Vercel connected',2200);
            tui.add('assistant','Vercel connected as `'+user+'` through browser/device approval. No global Vercel CLI installation is required; Craft Code invokes the official client transiently with `npx`. You can now ask for projects, deployments, logs, domains, environment configuration, or REST API operations.');
          }catch(e){tui.setNotice('Vercel not connected',2200);tui.add('notice',e.message||String(e));}
          return;
        }
        tui.setNotice(`Connecting ${name}…`,0);try{await mcp.authenticate(name);tui.setNotice(`${name} connected`,2200);}catch(e){tui.setNotice(`${name} not connected`,2200);tui.add('notice',e.message||String(e));}return;
      }
      if(cmd==='/disconnect'){if(!rest[0])return tui.add('notice','Use /disconnect <connector>.');if(rest[0].toLowerCase()==='vercel')return tui.add('assistant','To revoke Vercel browser/device authorization, run `npx -y vercel@latest logout`. Craft Code does not store your Vercel password or OAuth authorization code.');await mcp.logout(rest[0]);tui.setNotice(`${rest[0]} disconnected`);return;}
      if(cmd==='/agents'){const xs=agents.list();tui.add('assistant',xs.length?xs.map(a=>`${a.status==='running'?'●':a.status==='done'?'✓':'○'} ${a.id} · ${a.role} · ${fmtTokens(a.used||0)}/${fmtTokens(a.budget)} · ${a.task}`).join('\n'):'No subagents launched yet.');return;}
      if(cmd==='/agent'){
        const sub=(rest[0]||'').toLowerCase();if(sub==='spawn'){const role=(rest[1]||'explorer').toLowerCase(),task=rest.slice(2).join(' ');if(!task)return tui.add('notice','Use /agent spawn <explorer|tester|reviewer|researcher|writer> <task>.');let allowShell=false;if(role==='writer')allowShell=await tui.askApproval('shell','Allow this writer subagent to run shell commands inside its isolated Git worktree for tests/verification?');const j=await agents.spawn({role,task,worktree:role==='writer',allowShell});tui.setNotice(`Spawned ${j.id}${role==='writer'&&!allowShell?' · shell verification disabled':''}`);return;}if(sub==='show'&&rest[1]){const j=agents.list().find(x=>x.id===rest[1]);if(!j)return tui.add('notice','Unknown agent id.');const meta=[j.id,j.role,j.status,`${fmtTokens(j.used||0)}/${fmtTokens(j.budget)}`,j.activity||'',j.patchBytes?`patch ${Math.round(j.patchBytes/1024)} KB`:'',j.role==='writer'?`shell ${j.shellAllowed?'allowed':'blocked'}`:''].filter(Boolean).join(' · ');return tui.add('assistant',`${meta}\n\n${j.result||j.error||'Still working…'}`);}if(sub==='apply'&&rest[1]){if(!await tui.askApproval('write',`Apply patch from ${rest[1]} to main workspace?`))return;const r=await agents.apply(rest[1]);tui.add(r.ok?'assistant':'notice',r.message);return;}return command('/agents');
      }
      if(cmd==='/team'){
        const n=/^\d+$/.test(rest[0]||'')?Math.max(1,Math.min(6,Number(rest.shift()))):Math.min(3,config.agents?.maxParallel||3),task=rest.join(' ');if(!task)return tui.add('notice','Use /team [1-6] <task>.');const parallel=agents.parallelLimit();tui.setNotice(`Launching ${n} agents · up to ${Math.min(n,parallel)} concurrent for current TPM…`,0);const rs=await agents.team({task,count:n});tui.add('assistant',`Parallel agent results\n\n${agents.summary(rs)}`);tui.setNotice(`${n} agents completed`,1800);return;
      }
      if(cmd==='/orchestrate'){const task=rest.join(' ');if(!task)return tui.add('notice','Use /orchestrate <task>.');tui.setNotice('Planning dependency-aware agent graph…',0);const r=await agents.orchestrate({task,maxWorkers:config.agents?.maxParallel||3});tui.add('assistant',`Orchestrated review\n\n${r.review?.result||r.review?.error||'No reviewer result.'}`);tui.setNotice(`${r.workers.length} worker task(s) reviewed`,1800);return;}
      if(cmd==='/proof'){tui.add('assistant',formatProof(session.lastProof));return;}
      if(cmd==='/flight'){
        if(!recorder)return tui.add('notice','Flight Recorder is disabled in workspace config.');
        if((rest[0]||'').toLowerCase()==='show'&&rest[1]){const r=await recorder.load(rest[1]);if(!r)return tui.add('notice','Flight run not found.');const timeline=r.events.slice(0,80).map(summarizeFlightEvent).filter(Boolean).join('\n');return tui.add('assistant',`Flight ${r.id}\n\nSession: ${r.start.sessionId||'?'}\nProvider/model: ${r.start.provider||'?'} / ${r.start.model||'?'}\nStarted: ${r.start.at||'?'}\n\nTimeline\n${timeline}${r.events.length>80?'\n… timeline clipped':''}`);}
        const rows=await recorder.list(12);return tui.add('assistant',rows.length?rows.map(x=>`${x.id} · ${x.status} · ${x.provider}/${x.model} · ${x.score==null?'proof n/a':`proof ${x.score}/100`} · ${x.events} events · ${x.goal||''}`).join('\n'):'No recorded runs yet.');
      }
      if(cmd==='/replay'){
        if(!recorder)return tui.add('notice','Flight Recorder is disabled in workspace config.');
        const ref=rest[0]||'latest',r=await recorder.load(ref);if(!r)return tui.add('notice','Flight run not found.');
        const requested=/^\d+$/.test(rest[1]||'')?Number(rest[1]):null,target=requested!=null?r.events.find(x=>x.seq===requested):[...r.events].reverse().find(x=>x.type==='turn.end'||x.type==='model.response'||x.type==='tool.end');
        if(!target)return tui.add('notice','No replayable step found in that run.');
        const finalEpoch=Number(r.end.contextEpoch??target.epoch??0),targetEpoch=Number(target.epoch??finalEpoch);
        if(targetEpoch!==finalEpoch)return tui.add('notice',`Exact replay of step #${target.seq} is unavailable because the conversation was compacted afterward (epoch ${targetEpoch} → ${finalEpoch}). Use /flight show ${r.id} and choose a step after the latest compact event.`);
        const count=Number(target.messageCount||r.end.messageCount||0);if(!count)return tui.add('notice','That run does not contain a replayable message boundary.');
        const fork=await store.forkPrefix(r.start.sessionId,count,{title:`Replay ${r.id} #${target.seq}`});if(!fork)return tui.add('notice','Source session for this run is no longer available.');
        await resumeSession(fork.id);tui.setNotice(`Time travel · ${r.id} #${target.seq} · forked safely`,2600);return;
      }
      if(cmd==='/arena'){
        const sub=(rest[0]||'').toLowerCase();
        if(sub==='apply'){const arenaId=rest[1],candidate=rest[2]||'winner';if(!arenaId)return tui.add('notice','Use /arena apply <arena-id> [candidate].');if(!await tui.askApproval('write',`Apply ${candidate} from ${arenaId} to the main workspace?`))return;const applied=await agents.applyArena(arenaId,candidate);tui.add(applied.ok?'assistant':'notice',applied.message);return;}
        if(sub==='list'){const xs=agents.arenaList();return tui.add('assistant',xs.length?xs.map(x=>`${x.id} · ${x.candidates} candidates · winner ${x.winnerId} · ${x.task}`).join('\n'):'No arena runs in this process yet.');}
        let useAll=false;if((rest[0]||'').toLowerCase()==='all'){useAll=true;rest.shift();}
        const max=Math.max(2,Math.min(6,config.arena?.maxCandidates||4)),count=/^\d+$/.test(rest[0]||'')?Math.max(2,Math.min(max,Number(rest.shift()))):Math.max(2,Math.min(max,config.arena?.defaultCandidates||2)),task=rest.join(' ');
        if(!task)return tui.add('assistant','Use /arena [2-6] <task> for CodeCraft-only candidate competition, or /arena all [2-6] <task> to include any other providers that are already authenticated.');
        const allowShell=await tui.askApproval('shell',`Allow ${count} isolated arena candidates to run focused test/lint/typecheck/build commands? Each candidate edits only its temporary Git worktree.`);
        const candidates=await buildArenaCandidates(useAll);tui.setNotice(`Arena · ${count} candidates · ${useAll?candidates.map(x=>x.provider).join(', '):providerId}`,0);
        const a=await agents.arena({task,count,candidates,allowShell,budgetPerAgent:config.agents?.defaultBudgetTokens});tui.add('assistant',agents.arenaSummary(a));tui.setNotice(`Arena complete · winner ${a.winnerId||'none'}`,2400);return;
      }
      if(cmd==='/bash'){if(!arg)return tui.add('notice','Use !<command> or /bash <command>.');const r=await tools.execute('run_command',{command:arg},mode);tui.add('assistant','```text\n'+String(r||'')+'\n```');return;}
      if(cmd==='/diff'){const r=await tools.execute('git_diff',{staged:false},'plan');tui.add('assistant',r||'No diff.');return;}
      if(cmd==='/checkpoints'){const cp=await checkpoints.latest();tui.add('assistant',cp?`Latest checkpoint\n${cp.id}\n${cp.createdAt}\n${Object.keys(cp.files||{}).length} direct file snapshot(s)${cp.shellTouched?'\nShell activity also tracked where Git can detect it.':''}`:'No checkpoint available.');return;}
      if(cmd==='/undo'){
        const cp=await checkpoints.latest();if(!cp)return tui.add('notice','No checkpoint available.');
        if(!await tui.askApproval('undo',`Restore latest checkpoint ${cp.id}?`))return tui.setNotice('Undo cancelled.');
        const r=await checkpoints.undoLatest();tui.add(r.ok?'assistant':'notice',r.message);if(r.ok)tui.setCheckpoint('');return;
      }
      if(cmd==='/compact'){const before=session.contextStats().estimatedTokens,count=session.compact(),after=session.contextStats().estimatedTokens;return tui.setNotice(`Context compacted · ${fmtTokens(before)} → ${fmtTokens(after)} · ${count} messages retained`,2600);}
      if(cmd==='/clear'){session.clear();tui.replaceTranscript([]);tui.setTodos([]);return tui.setNotice('Conversation cleared.');}
      if(cmd==='/sessions'){
        const sub=(rest[0]||'').toLowerCase();
        if(sub==='search'){const rows=await store.list({query:rest.slice(1).join(' ')});if(!rows.length)return tui.add('notice','No matching sessions.');const chosen=await tui.pickSession(rows);if(chosen)await resumeSession(chosen);return;}
        if(sub==='delete'&&rest[1]){const id=await store.resolve(rest[1]);if(!id)return tui.add('notice','Session not found.');if(!await tui.askApproval('delete',`Delete saved session ${id}?`))return;await store.remove(id);return tui.setNotice('Session deleted.');}
        const rows=await store.list();if(!rows.length)return tui.add('notice','No saved sessions yet.');const chosen=await tui.pickSession(rows);if(chosen)await resumeSession(chosen);return;
      }
      if(cmd==='/resume'){await resumeSession(arg||'latest');return;}
      if(cmd==='/session'){
        const sub=(rest[0]||'').toLowerCase();
        if(sub==='name'||sub==='rename'){const title=rest.slice(1).join(' ');if(!title)return tui.add('notice','Use /session name <title>.');const x=await store.rename(store.currentId,title);return tui.setNotice(`Session named · ${x.title}`);}
        if(sub==='fork'){await save();const x=await store.fork(rest[1]||store.currentId);if(!x)return tui.add('notice','Session not found.');await resumeSession(x.id);return tui.setNotice(`Forked · ${x.title}`);}
        if(sub==='export'){await save();const file=await store.exportMarkdown(rest[1]||store.currentId,rest.slice(2).join(' ')||'');return tui.add('assistant',file?`Session exported to \`${file}\``:'Session not found.');}
        if(sub==='delete'){const ref=rest[1]||store.currentId,id=await store.resolve(ref);if(!id)return tui.add('notice','Session not found.');if(!await tui.askApproval('delete',`Delete saved session ${id}?`))return;await store.remove(id);session.clear();tui.replaceTranscript([]);return tui.setNotice('Session deleted · started fresh.');}
        return tui.add('assistant',`Current session: **${store.currentTitle||'Untitled session'}**\n\`${store.currentId}\`\n\nCommands: /session name <title> · /session fork · /session export · /session delete`);
      }
      if(cmd==='/new'){await save();store.fresh();session.clear();tui.replaceTranscript([]);tui.setTodos([]);tui.setCheckpoint('');return tui.setNotice('Fresh session.');}
      if(cmd==='/status'){tui.add('assistant',await currentStatus());return;}
      if(cmd==='/context'){const x=session.contextStats(),defs=tools.definitions(mode),budget=session.contextBudget(defs);tui.add('assistant',`# Context\n\n- Estimated messages: **${fmtTokens(x.estimatedTokens)}**${x.contextWindow?` / **${fmtTokens(x.contextWindow)}** model window (${x.percent}%)`:''}\n- Messages: ${x.messages}\n- System/instructions: ~${fmtTokens(Math.ceil(x.systemChars/4))}\n- User: ~${fmtTokens(Math.ceil(x.userChars/4))}\n- Assistant: ~${fmtTokens(Math.ceil(x.assistantChars/4))}\n- Tool results: ~${fmtTokens(Math.ceil(x.toolChars/4))}${budget?`\n- Tool schemas: ~${fmtTokens(budget.toolTokens)}\n- Auto-compact trigger: ~${fmtTokens(budget.triggerTokens)} message tokens\n- Reserved output: ~${fmtTokens(budget.outputReserve)}`:''}\n\nCraft Code compacts proactively near the selected model window and retries automatically if a provider rejects accumulated context.`);return;}
      if(cmd==='/doctor'){const repaired=session.repairContext(),x=session.contextStats(),budget=session.contextBudget(tools.definitions(mode)),health=x.contextWindow?(x.percent>=88?'high pressure':x.percent>=70?'watch':'healthy'):'unknown window';tui.add('assistant',`# Session doctor\n\n- Provider: **${providerConfig.label}** (${providerId})\n- Model: **${session.model}**\n- Context health: **${health}**${x.contextWindow?` · ${fmtTokens(x.estimatedTokens)}/${fmtTokens(x.contextWindow)} (${x.percent}%)`:''}\n- Message protocol: **${repaired?`repaired ${repaired} entr${repaired===1?'y':'ies'}`:'healthy'}**${budget?`\n- Auto-compact at: ~${fmtTokens(budget.triggerTokens)} message tokens\n- Recovery target: ~${fmtTokens(budget.targetTokens)} message tokens`:''}\n\nContext-length and interrupted tool-sequence errors are repaired/compacted once and retried automatically before Craft Code surfaces the provider error.`);return;}
      if(cmd==='/instructions'){
        if((rest[0]||'').toLowerCase()==='reload'){projectInstructions=await loadProjectInstructions(cwd,config);session.setProjectInstructions(projectInstructions);agents.projectInstructions=projectInstructions;return tui.setNotice(`Reloaded ${projectInstructions.length} instruction file(s).`);}
        tui.add('assistant',projectInstructions.length?projectInstructions.map(x=>`## ${x.file}\n\n${x.text}`).join('\n\n'):'No AGENTS.md / CLAUDE.md project instructions found. Use /init to create AGENTS.md.');return;
      }
      if(cmd==='/init'){
        if(!await tui.askApproval('write','Create a starter AGENTS.md in this workspace?'))return;
        const r=await initAgentsFile(cwd);if(!r.created)return tui.add('notice','AGENTS.md already exists; left unchanged.');projectInstructions=await loadProjectInstructions(cwd,config);session.setProjectInstructions(projectInstructions);agents.projectInstructions=projectInstructions;return tui.add('assistant',`Created \`${r.file}\`. Edit it with your project commands and conventions; Craft Code now loads it automatically.`);
      }
      if(cmd==='/settings'){
        const key=(rest[0]||'').toLowerCase();if(key==='autoresume'||key==='auto-resume'){const v=(rest[1]||'').toLowerCase();if(!['on','off'].includes(v))return tui.add('notice','Use /settings autoresume on|off.');config.sessions=config.sessions||{};config.sessions.autoResume=v==='on';const f=await updateProjectConfig(cwd,{sessions:{autoResume:v==='on'}});return tui.setNotice(`Auto-resume ${v} · ${f}`,2200);}return tui.add('assistant',`Workspace settings\n\n- Auto-resume: **${config.sessions?.autoResume?'on':'off'}**\n- Autosave: **${config.sessions?.autosave!==false?'on':'off'}**\n- Project config: \`${path.join(cwd,'.craftcli','config.json')}\``);
      }
      if(cmd==='/style'){const v=(rest[0]||'').toLowerCase();if(!v)return tui.add('assistant',`Visual style: **${config.ui?.style||'claude'}**\n\nUse /style claude, /style classic, or /style minimal. Craft Code can change glyphs, ANSI emphasis, spacing, and colors; the actual font family is controlled by your terminal application.`);if(!['claude','classic','minimal'].includes(v))return tui.add('notice','Use /style claude|classic|minimal.');config.ui={...(config.ui||{}),style:v};await updateProjectConfig(cwd,{ui:{style:v}});tui.setMeta({uiStyle:v});return tui.setNotice(`Visual style · ${v}`,1800);}
      if(cmd==='/config')return tui.add('assistant',GLOBAL_CONFIG);
      const pluginCmd=plugins.expandCommand(cmd.slice(1),arg);if(pluginCmd){tui.add('user',cmd+(arg?` ${arg}`:''));await runOne(pluginCmd.prompt);return;}
      tui.add('notice',`Unknown command · ${cmd}`);
    }catch(e){tui.add('notice',e.message||String(e));}finally{tui.setBusy(false);}
  };

  const quickAction=async action=>{
    if(!action)return;
    if(action==='attach'){tui.input=tui.input.slice(0,tui.cursor)+'@'+tui.input.slice(tui.cursor);tui.cursor++;tui.schedule();return;}
    if(action==='connectors')return command('/connect');
    if(action==='agents')return command('/agents');
    if(action==='skills')return command('/skills');
    if(action==='plugins')return command('/plugins');
    if(action==='compact')return command('/compact');
    if(action==='new')return command('/new');
  };

  tui=new TerminalTui({
    cwd,provider:providerId,model,mode,effort,permissionPreset,usage,planTokens:planResolved.tokens,planSource:planResolved.source,resetDay:config.resetDay,contextWindowTokens:session.contextWindow?.()||0,uiStyle:config.ui?.style||'claude',
    onSubmit:runOne,onCommand:command,onCancel:()=>session.cancel(),onExit:exit,fileRefs:refs,showSplash,
    onModelsRequest:()=>client.models(),onModelPick:setModel,onModePick:setMode,onEffortPick:setEffort,onPermissionPick:setPermissions,onPermissionCycle:cyclePermissions,onPermissionDecision:persistApproval,onQuickAction:quickAction,
    startupMeta:{skills:skills.list().length,plugins:plugins.list().length,mcp:mcp.list().length,planName:client.planHint()?.name||'',rpm:client.rateLimits.rpmLimit||0}
  });
  tui.setExtraCommands(plugins.commands());tui.setAgents(agents.list());
  process.on('SIGINT',exit);process.on('SIGTERM',exit);process.on('uncaughtException',e=>{try{tui?.stop();}catch{}console.error(e);process.exit(1);});
  tui.start();
  if(resume||config.sessions?.autoResume){await resumeSession(resumeRef||'latest');}
}
main().catch(e=>{console.error(e?.stack||e);process.exitCode=1;});
