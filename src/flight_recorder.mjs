import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {APP_DIR} from './config.mjs';

const safeStamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const workspaceId=cwd=>crypto.createHash('sha1').update(path.resolve(cwd)).digest('hex').slice(0,10);
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x??null)).digest('hex').slice(0,16);
const clip=(s,n=240)=>{s=String(s??'');return s.length>n?s.slice(0,n)+'…':s;};
const redact=(value,key='')=>{
  if(/token|secret|password|authorization|cookie|api[-_]?key/i.test(key))return'[redacted]';
  if(Array.isArray(value))return value.slice(0,30).map(x=>redact(x));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,50).map(([k,v])=>[k,redact(v,k)]));
  if(typeof value==='string')return clip(value,500);
  return value;
};

export class FlightRecorder{
  constructor(cwd,{maxRuns=120}={}){this.cwd=path.resolve(cwd);this.dir=path.join(APP_DIR,'flight',workspaceId(cwd));this.maxRuns=Math.max(10,Number(maxRuns)||120);this.active=null;this.pending=Promise.resolve();}
  async init(){await fs.mkdir(this.dir,{recursive:true});return this;}
  file(id){if(!/^[A-Za-z0-9._-]+$/.test(String(id)))throw new Error('Invalid flight run id');return path.join(this.dir,`${id}.jsonl`);}
  async begin(meta={}){
    await this.init();
    if(this.active)await this.finish({status:'interrupted'});
    const id=`run-${safeStamp()}-${crypto.randomBytes(2).toString('hex')}`;
    this.active={id,seq:0,startedAt:new Date().toISOString(),file:this.file(id),meta:{...redact(meta),runId:id}};
    await fs.writeFile(this.active.file,JSON.stringify({seq:0,type:'run.start',at:this.active.startedAt,...this.active.meta})+'\n',{mode:0o600});
    return id;
  }
  record(type,data={}){
    if(!this.active)return 0;
    const event={seq:++this.active.seq,type:String(type||'event'),at:new Date().toISOString(),...redact(data)};
    const file=this.active.file;
    this.pending=this.pending.then(()=>fs.appendFile(file,JSON.stringify(event)+'\n',{mode:0o600})).catch(()=>{});
    return event.seq;
  }
  async finish(data={}){
    if(!this.active)return null;
    const a=this.active;this.record('run.end',{durationMs:Date.now()-Date.parse(a.startedAt),...data});
    await this.pending;this.active=null;await this.prune();return a.id;
  }
  async prune(){const rows=await this.list(this.maxRuns+50);for(const r of rows.slice(this.maxRuns))await fs.rm(this.file(r.id),{force:true}).catch(()=>{});}
  async _files(){await this.init();return(await fs.readdir(this.dir)).filter(x=>x.endsWith('.jsonl')).sort().reverse();}
  async load(ref='latest'){
    const files=await this._files();let file='';
    if(!ref||ref==='latest')file=files[0]||'';
    else{const exact=`${ref}.jsonl`;if(files.includes(exact))file=exact;else{const hits=files.filter(x=>x.startsWith(String(ref)));if(hits.length===1)file=hits[0];}}
    if(!file)return null;
    const events=(await fs.readFile(path.join(this.dir,file),'utf8')).split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));
    const start=events[0]||{},end=[...events].reverse().find(x=>x.type==='run.end')||events.at(-1)||{};
    return{id:file.slice(0,-6),start,end,events};
  }
  async list(limit=20){
    const out=[];for(const file of (await this._files()).slice(0,Math.max(1,limit))){try{const lines=(await fs.readFile(path.join(this.dir,file),'utf8')).split(/\r?\n/).filter(Boolean);const start=JSON.parse(lines[0]||'{}'),end=JSON.parse(lines.at(-1)||'{}');out.push({id:file.slice(0,-6),startedAt:start.at,sessionId:start.sessionId||'',provider:start.provider||'',model:start.model||'',goal:start.goal||'',status:end.status||'recorded',score:end.proof?.score??null,events:Math.max(0,lines.length-2),durationMs:end.durationMs||0,finalEpoch:end.contextEpoch??0,finalMessageCount:end.messageCount??0});}catch{}}
    return out;
  }
  static hash(value){return hash(value);}
}

export const summarizeFlightEvent=e=>{
  if(!e)return'';
  if(e.type==='model.response')return `#${e.seq} model · ${e.finishReason||'response'} · ${e.usage?.total_tokens||0} tokens · ctx ${e.messageCount??'?'}`;
  if(e.type==='tool.start')return `#${e.seq} tool · ${e.name||'?'}${e.detail?` · ${e.detail}`:''}`;
  if(e.type==='tool.end')return `#${e.seq} ${e.error?'✗':'✓'} ${e.name||'tool'} · ${e.durationMs||0}ms · result ${e.resultHash||'?'}`;
  if(e.type==='context.compact')return `#${e.seq} compact · epoch ${e.epoch??'?'} · ${e.beforeTokens||'?'} → ${e.afterTokens||'?'} tokens`;
  if(e.type==='run.end')return `#${e.seq} end · ${e.status||'done'}${e.proof?.score!=null?` · proof ${e.proof.score}/100`:''}`;
  return `#${e.seq} ${e.type}`;
};
