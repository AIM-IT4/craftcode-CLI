import path from 'node:path';
import {fmtTokens} from './ui.mjs';

const CSI='\x1b[';
const C={
  reset:`${CSI}0m`,bold:`${CSI}1m`,dim:`${CSI}2m`,italic:`${CSI}3m`,underline:`${CSI}4m`,
  black:`${CSI}30m`,white:`${CSI}97m`,slate:`${CSI}38;5;245m`,slate2:`${CSI}38;5;239m`,
  orange:`${CSI}38;5;209m`,orange2:`${CSI}38;5;173m`,green:`${CSI}38;5;42m`,yellow:`${CSI}38;5;220m`,
  red:`${CSI}38;5;203m`,blue:`${CSI}38;5;75m`,cyan:`${CSI}38;5;80m`,violet:`${CSI}38;5;141m`,
  bgPanel:`${CSI}48;5;235m`,bgPill:`${CSI}48;5;237m`,bgFocus:`${CSI}48;5;239m`,
};
const paint=(name,s)=>`${C[name]||''}${s}${C.reset}`;
const strip=s=>String(s??'').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g,'');
const width=s=>strip(s).length;
const crop=(s,n)=>{s=String(s??'');return width(s)<=n?s:strip(s).slice(0,Math.max(0,n-1))+'…';};
const padRight=(s,n)=>s+' '.repeat(Math.max(0,n-width(s)));
const fit=(s,n)=>padRight(crop(s,n),n);
const wrap=(text,w)=>{
  const out=[];
  for(const raw of String(text??'').split(/\r?\n/)){
    if(raw===''){out.push('');continue;}
    let s=raw;
    while(strip(s).length>w){
      let i=Math.min(w,s.length),sp=s.slice(0,i).lastIndexOf(' ');
      if(sp>w*.45)i=sp;
      out.push(s.slice(0,i));s=s.slice(i).replace(/^ /,'');
    }
    out.push(s);
  }
  return out;
};
const dayKey=()=>{const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const spinner=['◐','◓','◑','◒'];
const glyph=n=>/read|list|search/.test(n)?'⌕':/write|replace/.test(n)?'✎':/command/.test(n)?'›_':/git/.test(n)?'◆':/mcp/.test(n)?'↗':/todo/.test(n)?'☷':'◇';
const COMMANDS=[
  {cmd:'/mode',desc:'Switch Plan / Build mode'},
  {cmd:'/model',desc:'Choose CodeCraft model'},
  {cmd:'/effort',desc:'Set agent depth: Low / Normal / High'},
  {cmd:'/usage',desc:'Open token usage dashboard'},
  {cmd:'/permissions',desc:'Command/file permissions: Ask / Edit / Auto / Read-only'},
  {cmd:'/skills',desc:'Show discovered skills'},
  {cmd:'/plugins',desc:'Show plugins'},
  {cmd:'/mcp',desc:'Show connectors'},
  {cmd:'/connect',desc:'OAuth-connect GitHub / Vercel / Supabase'},
  {cmd:'/agents',desc:'Show parallel subagents'},
  {cmd:'/agent',desc:'Spawn a bounded subagent'},
  {cmd:'/team',desc:'Run multiple agents in parallel'},
  {cmd:'/plugin',desc:'Claude plugin marketplace/install/update'},
  {cmd:'/diff',desc:'Show Git diff'},
  {cmd:'/undo',desc:'Restore latest Craft checkpoint'},
  {cmd:'/compact',desc:'Compact conversation context'},
  {cmd:'/sessions',desc:'Browse and resume saved sessions'},
  {cmd:'/session',desc:'Name, fork, export or delete current/saved session'},
  {cmd:'/resume',desc:'Resume latest or named session'},
  {cmd:'/status',desc:'Workspace, Git, model, extensions and usage'},
  {cmd:'/context',desc:'Inspect current context size and composition'},
  {cmd:'/instructions',desc:'Show/reload AGENTS.md and project instructions'},
  {cmd:'/init',desc:'Create a starter AGENTS.md'},
  {cmd:'/settings',desc:'Persistent workspace settings'},
  {cmd:'/bash',desc:'Run a shell command (or prefix input with !)'},
  {cmd:'/new',desc:'Start fresh session'},
  {cmd:'/help',desc:'Keyboard shortcuts'},
  {cmd:'/exit',desc:'Quit Craft Code'},
];

function daysUntilReset(resetDay){
  const now=new Date(),y=now.getFullYear(),m=now.getMonth();
  let t=new Date(y,m,Math.max(1,Math.min(28,resetDay||1)),0,0,0);
  if(t<=now)t=new Date(y,m+1,Math.max(1,Math.min(28,resetDay||1)),0,0,0);
  const ms=t-now,days=Math.floor(ms/86400000),hrs=Math.floor((ms%86400000)/3600000);
  return days>0?`${days}d ${hrs}h`:`${hrs}h`;
}
function pill(label,{tone='slate',focused=false}={}){
  const fg=tone==='green'?'green':tone==='yellow'?'yellow':tone==='red'?'red':tone==='orange'?'orange':tone==='blue'?'blue':tone==='violet'?'violet':'white';
  const bg=focused?'bgFocus':'bgPill';
  return `${C[bg]}${C[fg]} ${label} ${C.reset}`;
}

function inlineMd(s){
  let x=String(s??'');
  x=x.replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,label,url)=>`${C.underline}${label}${C.reset}${C.dim} (${url})${C.reset}`);
  x=x.replace(/\*\*([^*]+)\*\*/g,(_,v)=>`${C.bold}${v}${C.reset}`);
  x=x.replace(/__([^_]+)__/g,(_,v)=>`${C.bold}${v}${C.reset}`);
  x=x.replace(/`([^`]+)`/g,(_,v)=>`${C.cyan}${v}${C.reset}`);
  x=x.replace(/(^|[^*])\*([^*]+)\*/g,(_,a,v)=>`${a}${C.italic}${v}${C.reset}`);
  return x;
}
function markdownLines(text,w){
  const out=[];let code=false;
  for(const raw0 of String(text??'').split(/\r?\n/)){
    let raw=raw0;
    if(/^\s*```/.test(raw)){code=!code;const lang=raw.replace(/^\s*```/,'').trim();if(lang)out.push(`${paint('dim','┌')} ${paint('slate',lang)}`);continue;}
    if(code){for(const part of wrap(raw,Math.max(12,w-4)))out.push(`${paint('dim','│')} ${paint('cyan',part)}`);continue;}
    const h=raw.match(/^\s*(#{1,4})\s+(.*)$/);if(h){for(const part of wrap(h[2],w))out.push(`${C.bold}${inlineMd(part)}${C.reset}`);continue;}
    const b=raw.match(/^\s*[-*+]\s+(.*)$/);if(b){const chunks=wrap(b[1],Math.max(12,w-3));chunks.forEach((part,i)=>out.push(`${i?'  ':'• '}${inlineMd(part)}`));continue;}
    const q=raw.match(/^\s*>\s?(.*)$/);if(q){for(const part of wrap(q[1],Math.max(12,w-3)))out.push(`${paint('dim','│')} ${inlineMd(part)}`);continue;}
    for(const part of wrap(raw,w))out.push(inlineMd(part));
  }
  return out;
}
const fmtPlan=n=>n===Infinity?'Unlimited':fmtTokens(n);

export class TerminalTui{
  constructor(o){
    Object.assign(this,o);
    this.mode=o.mode||'build';this.effort=o.effort||'high';this.permissionPreset=o.permissionPreset||'ask';this.planSource=o.planSource||'auto';this.resetDay=o.resetDay||4;
    this.transcript=[];this.input='';this.cursor=0;this.history=[];this.hist=-1;
    this.busy=false;this.notice='';this.requestUsage=null;this.contextChars=0;
    this.approval=null;this.planApproval=null;this.modal=null;this.queue=[];this.todos=[];
    this.fileSuggestionIndex=0;this.commandSelection=0;this.toolSelection=null;this.spinnerIndex=0;
    this.lastCheckpoint='';this.scrollOffset=0;this.running=false;this.renderQueued=false;
    this.screen=o.showSplash?'welcome':'chat';this.prevLines=[];this.regions=[];this.turnStartedAt=0;this.activeThinkingId=null;this.extraCommands=[];this.agents=[];
    this._data=b=>this.handleData(String(b));this._resize=()=>{this.prevLines=[];this.render();};
  }
  start(){
    if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Craft Code requires an interactive terminal.');
    this.running=true;
    process.stdout.write(`${CSI}?1049h${CSI}?25l${CSI}?2004h${CSI}?1000h${CSI}?1006h${CSI}2J${CSI}H`);
    process.stdin.setEncoding('utf8');process.stdin.setRawMode(true);process.stdin.resume();
    process.stdin.on('data',this._data);process.stdout.on('resize',this._resize);
    this._tick=setInterval(()=>{if(this.busy){this.spinnerIndex=(this.spinnerIndex+1)%spinner.length;this.schedule();}},120);
    this.render();
  }
  stop(){
    if(!this.running)return;this.running=false;clearInterval(this._tick);
    process.stdin.off('data',this._data);process.stdout.off('resize',this._resize);
    try{process.stdin.setRawMode(false);}catch{}
    process.stdout.write(`${CSI}?1006l${CSI}?1000l${CSI}?2004l${CSI}?25h${CSI}?1049l`);
  }
  schedule(){if(this.renderQueued)return;this.renderQueued=true;setTimeout(()=>{this.renderQueued=false;this.render();},16);}
  setMeta(x={}){if(x.model)this.model=x.model;if(x.mode)this.mode=x.mode;if(x.effort)this.effort=x.effort;if(x.permissionPreset)this.permissionPreset=x.permissionPreset;if(x.planTokens!==undefined)this.usage.planTokens=x.planTokens;if(x.planSource)this.planSource=x.planSource;if(x.requestUsage!==undefined)this.requestUsage=x.requestUsage;if(x.contextChars!==undefined)this.contextChars=x.contextChars;this.schedule();}
  setBusy(v){
    if(v&&!this.busy){this.turnStartedAt=Date.now();const id=`thinking-${Date.now()}`;this.activeThinkingId=id;this.transcript.push({role:'thinking',id,status:'running',detail:'Thinking',startedAt:this.turnStartedAt});}
    if(!v&&this.busy){const t=this.transcript.findLast?.(m=>m.id===this.activeThinkingId)||[...this.transcript].reverse().find(m=>m.id===this.activeThinkingId);if(t){t.status='done';t.durationMs=Date.now()-(t.startedAt||Date.now());t.detail='Thought';}}
    this.busy=v;this.schedule();
  }
  setActivity(s){const t=[...this.transcript].reverse().find(m=>m.role==='thinking'&&m.status==='running');if(t&&s&&!/^(read_|write_|replace_|run_|git_|list_|search_|call_|update_)/.test(String(s)))t.detail=String(s).replace(/…$/,'');this.schedule();}
  setNotice(s,ms=3000){this.notice=s;this.schedule();if(ms)setTimeout(()=>{if(this.notice===s){this.notice='';this.schedule();}},ms);}
  setTodos(x=[]){this.todos=x.slice(0,12);this.schedule();}
  setAgents(x=[]){this.agents=(x||[]).slice(-8);this.schedule();}
  setExtraCommands(x=[]){this.extraCommands=(x||[]).map(c=>({cmd:c.cmd,desc:c.desc||'Plugin command'}));this.schedule();}
  setCheckpoint(x){this.lastCheckpoint=x||'';this.schedule();}
  add(role,text,meta={}){this.transcript.push({role,text:String(text??''),...meta});if(this.transcript.length>450)this.transcript=this.transcript.slice(-450);this.scrollOffset=0;this.schedule();}
  beginAssistant(){/* streaming creates its own assistant block on first text */}
  stream(t){let x=this.transcript.at(-1);if(!x||x.role!=='assistant'){x={role:'assistant',text:''};this.transcript.push(x);}x.text+=t;this.schedule();}
  replaceTranscript(x=[]){this.transcript=x.map(m=>({...m,text:String(m.text??'')}));this.schedule();}
  getTranscript(){return this.transcript.filter(m=>m.role!=='thinking');}
  toolStart({name,detail}){const id=`tool-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;this.transcript.push({role:'toolcard',id,name,detail:String(detail||''),status:'running',result:'',durationMs:0,expanded:false});this.schedule();return id;}
  toolEnd({cardId,result,durationMs,error}){const x=[...this.transcript].reverse().find(m=>m.id===cardId);if(x){x.status=error?'error':'done';x.result=String(result??'').slice(0,18000);x.durationMs=durationMs||0;}this.schedule();}
  askApproval(kind,detail){return new Promise(resolve=>{this.approval={kind,detail:String(detail),resolve};this.schedule();});}
  resolveApproval(v){const a=this.approval;if(!a)return;this.approval=null;a.resolve(v);this.schedule();}
  askPlanApproval(){return new Promise(resolve=>{this.planApproval={resolve};this.schedule();});}
  resolvePlan(v){const p=this.planApproval;if(!p)return;this.planApproval=null;p.resolve(v);this.schedule();}
  pickModel(models,current){return this.openPicker('model','Select model',models.map(m=>({id:m.id||m.name,label:m.id||m.name,meta:m.context_window||m.context_length?`${fmtTokens(m.context_window||m.context_length)} ctx`:''})).filter(x=>x.id),current);}
  pickMode(current=this.mode){return this.openPicker('mode','Agent mode',[{id:'build',label:'Build',meta:'edit files · run commands'},{id:'plan',label:'Plan',meta:'read-only planning'}],current);}
  pickEffort(current=this.effort){return this.openPicker('effort','Agent depth',[{id:'low',label:'Low',meta:'fast · fewer tool loops'},{id:'normal',label:'Normal',meta:'balanced'},{id:'high',label:'High',meta:'deeper verification'}],current);}
  pickPermissions(current=this.permissionPreset){return this.openPicker('permissions','Permissions',[{id:'ask',label:'Ask',meta:'ask before edits · commands · MCP actions'},{id:'edit',label:'Edit',meta:'allow edits · ask commands/MCP'},{id:'auto',label:'Auto',meta:'allow edits · commands · MCP actions'},{id:'locked',label:'Read only',meta:'deny edits · commands · MCP actions'}],current);}
  pickSession(rows=[]){return this.openPicker('session','Resume session',rows.map(x=>({id:x.id,label:x.title||x.id,meta:`${x.turns} turns · ${x.mode} · ${String(x.updatedAt||'').slice(0,16).replace('T',' ')}`})),rows[0]?.id||'');}
  pickConnector(items=[]){return this.openPicker('connector','Connect service',(items||[]).map(x=>({id:x.name,label:x.name,meta:`${x.connected?'connected':'not connected'} · ${x.oauth?'browser OAuth':x.type}`})));}
  openQuickActions(){return this.openPicker('quick','Add to prompt',[{id:'attach',label:'Attach file',meta:'insert @ and search workspace'},{id:'connectors',label:'Connectors',meta:'OAuth / MCP servers'},{id:'agents',label:'Agents',meta:'parallel bounded workers'},{id:'skills',label:'Skills',meta:'reusable workflows'},{id:'plugins',label:'Plugins',meta:'extensions'},{id:'compact',label:'Compact context',meta:'save tokens'},{id:'new',label:'New session',meta:'clear current conversation'}]);}
  openPicker(type,title,items,current){return new Promise(resolve=>{this.modal={type,title,items,index:Math.max(0,items.findIndex(x=>x.id===current)),filter:'',resolve};this.schedule();});}
  openUsage(){this.modal={type:'usage',title:'Usage',resolve:()=>{}};this.schedule();}
  modalItems(){if(!this.modal?.items)return[];const q=(this.modal.filter||'').toLowerCase();return q?this.modal.items.filter(x=>`${x.label} ${x.meta||''}`.toLowerCase().includes(q)):this.modal.items;}
  closeModal(v=null){const m=this.modal;if(!m)return;this.modal=null;m.resolve?.(v);this.schedule();}
  commandSuggestions(){if(!this.input.startsWith('/'))return[];const q=this.input.toLowerCase(),all=[...COMMANDS,...this.extraCommands];return all.filter((x,i,a)=>a.findIndex(y=>y.cmd===x.cmd)===i).filter(x=>x.cmd.toLowerCase().startsWith(q)||x.cmd.toLowerCase().includes(q.slice(1))).slice(0,10);}
  fileToken(){const m=this.input.slice(0,this.cursor).match(/(?:^|\s)@([^\s]*)$/);return m?m[1]:null;}
  fileSuggestions(){const q=this.fileToken();return q===null||!this.fileRefs?[]:this.fileRefs.suggest(q,8);}
  insertFile(){const list=this.fileSuggestions();if(!list.length)return false;const f=list[Math.min(this.fileSuggestionIndex,list.length-1)],before=this.input.slice(0,this.cursor),m=before.match(/(?:^|\s)@([^\s]*)$/);if(!m)return false;const start=this.cursor-m[1].length;this.input=this.input.slice(0,start)+f+' '+this.input.slice(this.cursor);this.cursor=start+f.length+1;this.fileSuggestionIndex=0;this.schedule();return true;}
  enqueue(v){this.queue.push(v);this.setNotice(`Queued · ${this.queue.length}`,1600);}
  hasQueue(){return!!this.queue.length;}
  dequeue(){return this.queue.shift()||null;}
  async submit(){
    let v=this.input.trim();if(!v)return;
    this.history.push(v);this.hist=-1;this.input='';this.cursor=0;this.commandSelection=0;
    if(v.startsWith('/')){
      v=v.replace(/^\/([^\s]+)/,(_,c)=>'/'+c.toLowerCase());
      if(this.busy){this.input=v;this.cursor=v.length;this.setNotice('Esc cancels the active turn first.',1800);return;}
      await this.onCommand?.(v);return;
    }
    if(v.startsWith('!')){
      if(this.busy){this.input=v;this.cursor=v.length;this.setNotice('Esc cancels the active turn first.',1800);return;}
      await this.onCommand?.('/bash '+v.slice(1).trim());return;
    }
    if(this.busy){this.enqueue(v);return;}
    this.add('user',v);await this.onSubmit?.(v);
  }
  selectTool(delta=0,toggle=false){const idxs=this.transcript.map((m,i)=>m.role==='toolcard'?i:-1).filter(i=>i>=0);if(!idxs.length){this.setNotice('No tool cards yet.');return;}let p=this.toolSelection==null?idxs.length-1:idxs.indexOf(this.toolSelection);if(p<0)p=idxs.length-1;p=Math.max(0,Math.min(idxs.length-1,p+delta));this.toolSelection=idxs[p];if(toggle)this.transcript[this.toolSelection].expanded=!this.transcript[this.toolSelection].expanded;this.schedule();}
  handleMouse(seq){
    const m=seq.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);if(!m||m[4]!=='M')return;
    const button=Number(m[1]),x=Number(m[2]),y=Number(m[3]);if((button&3)!==0)return;
    const r=this.regions.find(r=>y===r.y&&x>=r.x1&&x<=r.x2);if(!r)return;
    this.activateRegion(r.action);
  }
  async activateRegion(action){
    if(action==='usage')return this.openUsage();
    if(action==='attach'){this.input=this.input.slice(0,this.cursor)+'@'+this.input.slice(this.cursor);this.cursor++;return this.schedule();}
    if(action==='plus'){const a=await this.openQuickActions();return this.onQuickAction?.(a);}
    if(action==='mode'){const m=await this.pickMode();if(m)this.onModePick?.(m);return;}
    if(action==='model'){const models=await this.onModelsRequest?.();if(models){const m=await this.pickModel(models,this.model);if(m)this.onModelPick?.(m);}return;}
    if(action==='effort'){const e=await this.pickEffort();if(e)this.onEffortPick?.(e);return;}
    if(action==='permissions'){const p=await this.pickPermissions();if(p)this.onPermissionPick?.(p);return;}
    if(action==='undo')return this.onCommand?.('/undo');
    if(action==='connectors')return this.onCommand?.('/connect');
    if(action==='agents')return this.onCommand?.('/agents');
  }
  handleData(data){
    while(data.length){
      const mm=data.match(/^\x1b\[<\d+;\d+;\d+[Mm]/);if(mm){this.handleMouse(mm[0]);data=data.slice(mm[0].length);continue;}
      if(data.startsWith('\r\n')){this.handleKey('\r');data=data.slice(2);continue;}
      if(data.startsWith('\x1b[200~')){const e=data.indexOf('\x1b[201~',6);if(e>=0){const p=data.slice(6,e).replace(/\r\n?/g,'\n');this.input=this.input.slice(0,this.cursor)+p+this.input.slice(this.cursor);this.cursor+=p.length;this.schedule();data=data.slice(e+6);continue;}}
      const seq=['\x1b[Z','\x1b[1;3A','\x1b[1;3B','\x1b[5~','\x1b[6~','\x1b[A','\x1b[B','\x1b[C','\x1b[D'].find(x=>data.startsWith(x));
      if(seq){this.handleKey(seq);data=data.slice(seq.length);continue;}
      const ch=String.fromCodePoint(data.codePointAt(0));this.handleKey(ch);data=data.slice(ch.length);
    }
  }
  handleKey(s){
    if(!this.running)return;
    if(this.screen==='welcome'){
      if(s==='\x03')return this.onExit?.();if(s==='\r'||s==='\n'||s===' '){this.screen='chat';this.prevLines=[];return this.schedule();}if(s==='q'||s==='Q'||s==='\x1b')return this.onExit?.();return;
    }
    if(this.modal){
      if(this.modal.type==='usage'){if(s==='\x1b'||s==='\r'||s==='q'||s==='Q')return this.closeModal();return;}
      const a=this.modalItems();if(s==='\x1b')return this.closeModal();if(s==='\r')return this.closeModal(a[this.modal.index]?.id||null);
      if(s==='\x1b[A'){this.modal.index=Math.max(0,this.modal.index-1);return this.schedule();}
      if(s==='\x1b[B'){this.modal.index=Math.min(Math.max(0,a.length-1),this.modal.index+1);return this.schedule();}
      if(s==='\x7f'||s==='\b'){this.modal.filter=this.modal.filter.slice(0,-1);this.modal.index=0;return this.schedule();}
      if(s>=' '&&!s.startsWith('\x1b')){this.modal.filter+=s;this.modal.index=0;return this.schedule();}return;
    }
    if(this.approval){if(s==='a'||s==='A'){this.onPermissionDecision?.(this.approval.kind,'allow');return this.resolveApproval(true);}if(s==='d'||s==='D'){this.onPermissionDecision?.(this.approval.kind,'deny');return this.resolveApproval(false);}if(s==='y'||s==='Y'||s==='\r')return this.resolveApproval(true);if(s==='n'||s==='N'||s==='\x1b')return this.resolveApproval(false);return;}
    if(this.planApproval){if(s==='\r'||s==='y'||s==='Y')return this.resolvePlan('implement');if(s==='n'||s==='N')return this.resolvePlan('stay');if(s==='\x1b')return this.resolvePlan('dismiss');return;}
    if(s==='\x1b[Z'){this.onPermissionCycle?.();return;}
    if(s==='\x03')return this.onExit?.();if(s==='\x0f')return this.selectTool(0,true);if(s==='\x1b[1;3A')return this.selectTool(-1);if(s==='\x1b[1;3B')return this.selectTool(1);
    if(s==='\x1b[5~'){this.scrollOffset+=10;return this.schedule();}if(s==='\x1b[6~'){this.scrollOffset=Math.max(0,this.scrollOffset-10);return this.schedule();}
    if(this.busy&&s==='\x1b'){this.setNotice('Cancelling…',1200);return this.onCancel?.();}
    if(s==='\r'){
      const fs=this.fileSuggestions();if(fs.length&&this.input.endsWith(this.fileToken()||''))return this.insertFile();
      const cs=this.commandSuggestions();if(this.input.startsWith('/')&&cs.length&&this.input.trim().toLowerCase()!==cs[this.commandSelection]?.cmd.toLowerCase()&& !this.input.trim().includes(' ')){
        this.input=cs[this.commandSelection].cmd;this.cursor=this.input.length;
      }
      return this.submit();
    }
    if(s==='\n'){this.input=this.input.slice(0,this.cursor)+'\n'+this.input.slice(this.cursor);this.cursor++;return this.schedule();}
    if(s==='\x7f'||s==='\b'){if(this.cursor>0){this.input=this.input.slice(0,this.cursor-1)+this.input.slice(this.cursor);this.cursor--;this.commandSelection=0;}return this.schedule();}
    if(s==='\x1b[D'){this.cursor=Math.max(0,this.cursor-1);return this.schedule();}if(s==='\x1b[C'){this.cursor=Math.min(this.input.length,this.cursor+1);return this.schedule();}
    const fs=this.fileSuggestions(),cs=this.commandSuggestions();
    if(fs.length&&(s==='\x1b[A'||s==='\x1b[B')){this.fileSuggestionIndex=(this.fileSuggestionIndex+(s==='\x1b[A'?-1:1)+fs.length)%fs.length;return this.schedule();}
    if(this.input.startsWith('/')&&cs.length&&(s==='\x1b[A'||s==='\x1b[B')){this.commandSelection=(this.commandSelection+(s==='\x1b[A'?-1:1)+cs.length)%cs.length;return this.schedule();}
    if(s==='\x1b[A'&&!this.input.includes('\n')){if(this.history.length){this.hist=Math.min(this.history.length-1,this.hist+1);this.input=this.history[this.history.length-1-this.hist]||'';this.cursor=this.input.length;}return this.schedule();}
    if(s==='\x1b[B'&&!this.input.includes('\n')){if(this.hist>=0){this.hist--;this.input=this.hist<0?'':this.history[this.history.length-1-this.hist]||'';this.cursor=this.input.length;}return this.schedule();}
    if(s==='\t'){if(this.insertFile())return;const c=this.commandSuggestions();if(c.length){this.input=c[this.commandSelection].cmd;this.cursor=this.input.length;return this.schedule();}}
    if(s>=' '&&!s.startsWith('\x1b')){this.input=this.input.slice(0,this.cursor)+s+this.input.slice(this.cursor);this.cursor+=s.length;this.fileSuggestionIndex=0;this.commandSelection=0;this.schedule();}
  }
  transcriptLines(w){
    const out=[];
    for(let i=0;i<this.transcript.length;i++){
      const m=this.transcript[i];
      if(m.role==='user'){
        out.push('');wrap(m.text,w-6).forEach((x,j)=>out.push(`${j?'  ':paint('orange','❯ ')}${paint(j?'white':'bold',x)}`));continue;
      }
      if(m.role==='notice'){out.push(`  ${paint('yellow','!')} ${paint('slate',crop(m.text,w-5))}`);continue;}
      if(m.role==='thinking'){
        const d=m.status==='running'?`${spinner[this.spinnerIndex]} ${m.detail||'Thinking'}…`:`✦ ${m.detail||'Thought'} ${m.durationMs?paint('dim',`${(m.durationMs/1000).toFixed(1)}s`):''}`;
        out.push(`  ${paint(m.status==='running'?'orange':'slate',d)}`);continue;
      }
      if(m.role==='toolcard'){
        const sel=i===this.toolSelection,st=m.status==='running'?paint('orange',spinner[this.spinnerIndex]):m.status==='error'?paint('red','×'):paint('green','✓'),dur=m.durationMs?paint('dim',`${Math.max(.1,m.durationMs/1000).toFixed(1)}s`):'';
        const label=`${glyph(m.name)} ${m.name}${m.detail?` · ${m.detail}`:''}`;
        out.push(`  ${sel?paint('orange','›'):paint('dim','│')} ${st} ${paint(sel?'white':'slate',crop(label,w-16))} ${dur}`);
        if(m.expanded){const all=wrap(m.result||'(no output)',Math.max(20,w-10));for(const x of all.slice(0,14))out.push(`      ${paint('dim','│')} ${paint('slate',x)}`);if(all.length>14)out.push(`      ${paint('dim','│ … output clipped')}`);}continue;
      }
      if(m.role==='assistant'){markdownLines(m.text,w-5).forEach((x,j)=>out.push(`${j?'    ':paint('orange','●   ')}${x}`));continue;}
    }
    return out;
  }
  renderWelcome(){
    const cols=Math.max(70,process.stdout.columns||110),rows=Math.max(24,process.stdout.rows||32),w=Math.min(82,cols-8),left=Math.max(2,Math.floor((cols-w)/2)),pad=s=>' '.repeat(left)+s,u=this.usage.snapshot(),rem=Math.max(0,u.plan-u.total);
    const title='CRAFT CODE';const lines=['','',pad(`${paint('orange','✦')} ${paint('bold',title)} ${paint('dim','· CodeCraft-native coding agent')}`),'',pad(paint('orange','╭'+'─'.repeat(w-2)+'╮')),pad(paint('orange','│')+` ${paint('bold','Workspace')}  ${crop(this.cwd,w-16)}`+' '.repeat(Math.max(0,w-4-width(`Workspace  ${crop(this.cwd,w-16)}`)))+paint('orange','│')),pad(paint('orange','│')+` ${paint('bold','Model')}      ${paint('orange2',crop(this.model,w-16))}`+' '.repeat(Math.max(0,w-4-width(`Model      ${crop(this.model,w-16)}`)))+paint('orange','│')),pad(paint('orange','│')+` ${paint('bold','Plan')}       ${fmtPlan(rem)} remaining / ${fmtPlan(u.plan)}`+' '.repeat(Math.max(0,w-4-width(`Plan       ${fmtPlan(rem)} remaining / ${fmtPlan(u.plan)}`)))+paint('orange','│')),pad(paint('orange','╰'+'─'.repeat(w-2)+'╯')),'',pad(`${paint('dim','Skills')} ${this.startupMeta?.skills||0}   ${paint('dim','Plugins')} ${this.startupMeta?.plugins||0}   ${paint('dim','MCP')} ${this.startupMeta?.mcp||0}`),'',pad(paint('dim','Review file edits and shell approvals. Use trusted repos, skills, plugins and connectors.')),'',pad(`${paint('blue',paint('bold','Enter'))} ${paint('dim','continue')}   ${paint('dim','·')}   ${paint('dim','Q quit')}`)];
    while(lines.length<rows)lines.push('');this.paintFrame(lines.slice(0,rows),cols);
  }
  overlay(w){
    if(this.modal?.type==='usage'){
      const u=this.usage.snapshot(),usedPct=u.plan?Math.round(u.total/u.plan*100):0,rem=Math.max(0,u.plan-u.total),today=u.daily?.[dayKey()]||0;
      return[
        paint('orange','╭─ Usage '+ '─'.repeat(Math.max(1,w-10))+'╮'),
        ` ${paint('bold',`${usedPct}% used`)}   ${fmtPlan(rem)} left / ${fmtPlan(u.plan)}   ${paint('dim',`reset in ${daysUntilReset(this.resetDay)}`)}`,
        ` Today ${paint('blue',fmtTokens(today))}   Session ${paint('cyan',fmtTokens(u.session))}   Context ~${paint('violet',fmtTokens(Math.ceil(this.contextChars/4)))}`,
        ` Tier ${paint('green',this.startupMeta?.planName||fmtPlan(u.plan))}${this.startupMeta?.rpm?paint('dim',` · ${this.startupMeta.rpm} RPM detected`):paint('dim',` · ${this.planSource}`)}   ${paint('dim','usage counter is local to Craft Code')}`, 
        ` Request ${this.requestUsage?`↑ ${fmtTokens(this.requestUsage.prompt_tokens||0)}   ↓ ${fmtTokens(this.requestUsage.completion_tokens||0)}`:'—'}`,
        ` ${paint('dim','Enter / Esc close · /usage set <tokens> used · /usage plan 30m overrides tier')}`,
        paint('orange','╰'+'─'.repeat(w-2)+'╯')
      ];
    }
    if(this.modal){
      const a=this.modalItems(),o=[paint('orange',`╭─ ${this.modal.title||'Select'} `+'─'.repeat(Math.max(1,w-(this.modal.title||'Select').length-5))+'╮')];
      if(this.modal.items?.length>5)o.push(` ${paint('dim','Search')} ${this.modal.filter||'…'}`);
      const start=Math.max(0,Math.min(this.modal.index-4,Math.max(0,a.length-8)));
      for(let i=start;i<Math.min(a.length,start+8);i++)o.push(` ${i===this.modal.index?paint('orange','❯'):paint('dim',' ')} ${paint(i===this.modal.index?'white':'slate',crop(a[i].label,w-26))}${a[i].meta?`  ${paint('dim',crop(a[i].meta,22))}`:''}`);
      o.push(`${paint('orange','╰')} ${paint('dim','↑/↓ choose · Enter · Esc')} ${paint('orange','─'.repeat(Math.max(1,w-27))+'╯')}`);return o;
    }
    if(this.planApproval)return[paint('yellow','╭─ Plan ready '+ '─'.repeat(Math.max(1,w-14))+'╮'),` ${paint('green','Enter')} approve & build   ${paint('yellow','N')} keep planning   ${paint('dim','Esc dismiss')}`,paint('yellow','╰'+'─'.repeat(w-2)+'╯')];
    if(this.approval)return[paint('yellow','╭─ Permission '+ '─'.repeat(Math.max(1,w-15))+'╮'),` ${paint('bold',this.approval.kind.toUpperCase())}  ${crop(this.approval.detail,w-14)}`,` ${paint('green','Y / Enter')} once   ${paint('green','A')} always   ${paint('red','N / Esc')} deny   ${paint('red','D')} always deny`,paint('yellow','╰'+'─'.repeat(w-2)+'╯')];
    return[];
  }
  renderComposer(w,startY){
    const fs=this.fileSuggestions(),cs=fs.length?[]:this.commandSuggestions(),suggestions=[];
    if(fs.length){suggestions.push(` ${paint('dim','Files')}`);fs.slice(0,7).forEach((x,i)=>suggestions.push(` ${i===this.fileSuggestionIndex?paint('orange','❯'):paint('dim',' ')} ${paint(i===this.fileSuggestionIndex?'white':'slate','@'+crop(x,w-8))}`));}
    else if(cs.length){suggestions.push(` ${paint('dim','Commands')}`);cs.slice(0,7).forEach((x,i)=>suggestions.push(` ${i===this.commandSelection?paint('orange','❯'):paint('dim',' ')} ${paint(i===this.commandSelection?'white':'slate',x.cmd.padEnd(13))} ${paint('dim',crop(x.desc,w-22))}`));}
    const caret='▌',raw=this.input?this.input.slice(0,this.cursor)+caret+this.input.slice(this.cursor):`${paint('slate','Ask anything…')} ${paint('dim','(@ files · / commands)')} ${caret}`;
    const inputLines=wrap(raw,w-6).slice(-3),box=[];
    box.push(` ${paint('slate2','╭'+'─'.repeat(w-4)+'╮')}`);
    for(let i=0;i<Math.max(2,inputLines.length);i++)box.push(` ${paint('slate2','│')}  ${padRight(inputLines[i]||'',w-8)}${paint('slate2','│')}`);
    box.push(` ${paint('slate2','╰'+'─'.repeat(w-4)+'╯')}`);
    return{suggestions,box,startY};
  }
  toolbarLine(w,y){
    const u=this.usage.snapshot(),rem=Math.max(0,u.plan-u.total),pct=u.plan?Math.round(u.total/u.plan*100):0,today=u.daily?.[dayKey()]||0;
    const permLabel=this.permissionPreset==='auto'?'Auto':this.permissionPreset==='edit'?'Edit':this.permissionPreset==='locked'?'Read only':'Ask';
    const left=[{label:'＋',action:'plus',tone:'orange'},{label:'@',action:'attach'},{label:this.mode.toUpperCase(),action:'mode',tone:this.mode==='build'?'green':'yellow'},{label:permLabel,action:'permissions',tone:this.permissionPreset==='auto'?'green':this.permissionPreset==='locked'?'red':'yellow'},{label:`MCP ${this.startupMeta?.mcp||0}`,action:'connectors',tone:'blue'},...(this.agents.length?[{label:`Agents ${this.agents.filter(a=>a.status==='running'||a.status==='starting').length||this.agents.length}`,action:'agents',tone:'violet'}]:[])];
    const right=[{label:crop(this.model,22),action:'model',tone:'orange'},{label:this.effort[0].toUpperCase()+this.effort.slice(1),action:'effort',tone:'violet'},...(this.lastCheckpoint?[{label:'Undo',action:'undo',tone:'yellow'}]:[])];
    let line='  ',x=3;for(const item of left){const txt=pill(item.label,{tone:item.tone});const n=width(txt);this.regions.push({x1:x,x2:x+n-1,y,action:item.action});line+=txt+' ';x+=n+1;}
    const rightText=right.map(i=>pill(i.label,{tone:i.tone})).join(' '),space=Math.max(1,w-width(line)-width(rightText)-1);let rx=width(line)+space+1;line+=' '.repeat(space);for(let i=0;i<right.length;i++){const txt=pill(right[i].label,{tone:right[i].tone}),n=width(txt);this.regions.push({x1:rx,x2:rx+n-1,y,action:right[i].action});line+=txt+(i===right.length-1?'':' ');rx+=n+1;}
    return fit(line,w);
  }
  usageLine(w,y){
    const u=this.usage.snapshot(),rem=Math.max(0,u.plan-u.total),pct=u.plan?Math.round(u.total/u.plan*100):0,today=u.daily?.[dayKey()]||0,ctx=fmtTokens(Math.ceil(this.contextChars/4));
    const planLabel=u.plan===Infinity?'◔ Unlimited':`◔ ${pct}% · ${fmtPlan(rem)} left · resets ${daysUntilReset(this.resetDay)}`;
    const a=pill(planLabel,{tone:pct>=90?'red':pct>=70?'yellow':'green'}),b=pill(`◔ Today ${fmtTokens(today)}`,{tone:'blue'}),c=pill(`Context ${ctx}`,{tone:'violet'});
    let line='  ',x=3;for(const [txt,action] of [[a,'usage'],[b,'usage'],[c,'usage']]){const n=width(txt);this.regions.push({x1:x,x2:x+n-1,y,action});line+=txt+' ';x+=n+1;}return fit(line,w);
  }
  renderChat(){
    const cols=Math.max(72,process.stdout.columns||110),rows=Math.max(26,process.stdout.rows||34),w=cols-2;
    this.regions=[];
    const workspace=crop(path.basename(this.cwd),32),header=`  ${paint('orange','✦')} ${paint('bold','Craft Code')} ${paint('dim','·')} ${paint('slate',workspace)}`;
    const right=this.notice?paint('yellow',crop(this.notice,42)):paint('dim','CodeCraft');
    const headSpace=Math.max(1,w-width(header)-width(right));
    const top=fit(header+' '.repeat(headSpace)+right,w);
    let body=this.transcriptLines(w-4);
    const progress=[];
    if(this.todos.length){progress.push(`  ${paint('dim','Progress')}`);for(const t of this.todos.slice(0,5))progress.push(`  ${t.status==='completed'?paint('green','✓'):t.status==='in_progress'?paint('orange',spinner[this.spinnerIndex]):paint('dim','○')} ${paint(t.status==='in_progress'?'white':'slate',crop(t.text,w-8))}`);}
    if(this.queue.length)progress.push(`  ${paint('blue','↳')} ${paint('dim',`${this.queue.length} queued`)}`);
    const runningAgents=this.agents.filter(a=>a.status==='running'||a.status==='starting');if(runningAgents.length){progress.push(`  ${paint('dim','Agents')}`);for(const a of runningAgents.slice(0,4))progress.push(`  ${paint('violet',spinner[this.spinnerIndex])} ${paint('white',a.role)} ${paint('dim',`${fmtTokens(a.used||0)}/${fmtTokens(a.budget||0)} · ${crop(a.task,w-28)}`)}`);}
    const ov=this.overlay(w),composer=this.renderComposer(w,0),fixed=1+1+progress.length+ov.length+composer.suggestions.length+composer.box.length+1+1+1;
    const bodyH=Math.max(4,rows-fixed);
    if(this.scrollOffset){const e=Math.max(0,body.length-this.scrollOffset);body=body.slice(Math.max(0,e-bodyH),e);}else body=body.slice(-bodyH);
    const out=[top,paint('slate2','─'.repeat(w))];
    for(let i=0;i<bodyH;i++)out.push(body[i]||'');
    out.push(...progress,...ov,...composer.suggestions);
    const composerStart=out.length+1;out.push(...composer.box);
    const usageY=out.length+1;out.push(this.usageLine(w,usageY));
    const toolbarY=out.length+1;out.push(this.toolbarLine(w,toolbarY));
    while(out.length<rows)out.push('');
    this.paintFrame(out.slice(0,rows),cols);
  }
  paintFrame(lines,cols){
    const normalized=lines.map(x=>fit(x,cols));
    let buf=`${CSI}?25l`;
    if(!this.prevLines.length){buf+=`${CSI}2J`;}
    const max=Math.max(this.prevLines.length,normalized.length);
    for(let i=0;i<max;i++){
      const next=normalized[i]||'',prev=this.prevLines[i]||'';
      if(next!==prev)buf+=`${CSI}${i+1};1H${CSI}2K${next}`;
    }
    process.stdout.write(buf);this.prevLines=normalized;
  }
  render(){if(!this.running)return;this.screen==='welcome'?this.renderWelcome():this.renderChat();}
}
