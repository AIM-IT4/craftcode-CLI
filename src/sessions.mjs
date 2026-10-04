import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_DIR } from './config.mjs';

const ROOT = path.join(APP_DIR, 'sessions');
const idFor = cwd => crypto.createHash('sha1').update(path.resolve(cwd)).digest('hex').slice(0, 10);
const safeStamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const cleanTitle = s => String(s||'').replace(/\s+/g,' ').trim().slice(0,72);
const titleFromTranscript = t => cleanTitle((t||[]).find(x=>x.role==='user')?.text)||'Untitled session';

export class SessionStore {
  constructor(cwd){this.cwd=path.resolve(cwd);this.workspaceId=idFor(cwd);this.dir=path.join(ROOT,this.workspaceId);this.currentId=`s-${safeStamp()}`;this.currentTitle='';}
  async init(){await fs.mkdir(this.dir,{recursive:true});return this;}
  file(id){return path.join(this.dir,`${id}.json`);}
  async save({provider='codecraft',messages,transcript,model,mode,effort,title}){
    await this.init();
    let old={};try{old=JSON.parse(await fs.readFile(this.file(this.currentId),'utf8'));}catch{}
    const now=new Date().toISOString(),derived=cleanTitle(title||this.currentTitle)||titleFromTranscript(transcript);
    const payload={version:3,id:this.currentId,title:derived,cwd:this.cwd,createdAt:old.createdAt||now,updatedAt:now,provider:provider||'codecraft',model,mode,effort,messages,transcript};
    await fs.writeFile(this.file(this.currentId),JSON.stringify(payload,null,2));
    await fs.writeFile(path.join(this.dir,'latest'),this.currentId,'utf8');
    this.currentTitle=derived;return this.currentId;
  }
  async list({query=''}={}){
    await this.init();const files=(await fs.readdir(this.dir)).filter(x=>x.endsWith('.json')),rows=[];const q=String(query).toLowerCase().trim();
    for(const file of files){try{const s=JSON.parse(await fs.readFile(path.join(this.dir,file),'utf8'));const row={id:s.id,title:s.title||titleFromTranscript(s.transcript),createdAt:s.createdAt||s.updatedAt,updatedAt:s.updatedAt,provider:s.provider||'codecraft',model:s.model,mode:s.mode,effort:s.effort||'high',turns:(s.transcript||[]).filter(x=>x.role==='user').length};if(!q||`${row.id} ${row.title} ${row.model}`.toLowerCase().includes(q))rows.push(row);}catch{}}
    return rows.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  async latestId(){try{return(await fs.readFile(path.join(this.dir,'latest'),'utf8')).trim();}catch{return'';}}
  async resolve(ref='latest'){
    await this.init();if(!ref||ref==='latest')return await this.latestId();
    const rows=await this.list();const exact=rows.find(x=>x.id===ref);if(exact)return exact.id;
    const pref=rows.filter(x=>x.id.startsWith(ref));if(pref.length===1)return pref[0].id;
    const q=String(ref).toLowerCase();const titled=rows.filter(x=>x.title.toLowerCase().includes(q));if(titled.length===1)return titled[0].id;
    return '';
  }
  async load(ref='latest'){
    await this.init();const id=await this.resolve(ref);if(!id)return null;if(!/^[A-Za-z0-9._-]+$/.test(id))throw new Error('Invalid session id');
    try{const s=JSON.parse(await fs.readFile(this.file(id),'utf8'));if(!s.provider)s.provider='codecraft';this.currentId=s.id;this.currentTitle=s.title||titleFromTranscript(s.transcript);return s;}catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  async rename(ref,title){let id=await this.resolve(ref);if(!id&&ref===this.currentId){this.currentTitle=cleanTitle(title)||'Untitled session';return{id:this.currentId,title:this.currentTitle};}if(!id)throw new Error('Session not found.');const s=JSON.parse(await fs.readFile(this.file(id),'utf8'));s.title=cleanTitle(title)||'Untitled session';s.updatedAt=new Date().toISOString();await fs.writeFile(this.file(id),JSON.stringify(s,null,2));if(this.currentId===id)this.currentTitle=s.title;return s;}
  async remove(ref){const id=await this.resolve(ref);if(!id)return false;await fs.rm(this.file(id),{force:true});const latest=await this.latestId();if(latest===id){const rows=await this.list();if(rows[0])await fs.writeFile(path.join(this.dir,'latest'),rows[0].id,'utf8');else await fs.rm(path.join(this.dir,'latest'),{force:true});}if(this.currentId===id)this.fresh();return true;}
  async fork(ref='latest'){
    const s=await this.load(ref);if(!s)return null;const source=s.id;this.fresh();this.currentTitle=`${s.title||titleFromTranscript(s.transcript)} (fork)`;await this.save({...s,title:this.currentTitle});const out=await this.load(this.currentId);out.forkedFrom=source;await fs.writeFile(this.file(out.id),JSON.stringify(out,null,2));return out;
  }
  async exportMarkdown(ref='latest',dest=''){
    const s=await this.load(ref);if(!s)return null;const file=dest||path.join(this.cwd,`.craft-session-${s.id}.md`);const lines=[`# ${s.title||'Craft Code session'}`,'',`- Session: \`${s.id}\``,`- Workspace: \`${s.cwd}\``,`- Provider: \`${s.provider||'codecraft'}\``,`- Model: \`${s.model||''}\``,`- Updated: ${s.updatedAt}`,''];for(const m of s.transcript||[]){if(!['user','assistant','notice'].includes(m.role))continue;lines.push(`## ${m.role==='user'?'You':m.role==='assistant'?'Craft Code':'Notice'}`,'',String(m.text||''),'');}await fs.writeFile(file,lines.join('\n'),'utf8');return file;
  }
  fresh(){this.currentId=`s-${safeStamp()}`;this.currentTitle='';return this.currentId;}
}
