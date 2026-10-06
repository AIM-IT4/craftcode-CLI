import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
function parseMeta(text,fallback){const meta={name:fallback,description:''};if(text.startsWith('---')){const end=text.indexOf('\n---',3);if(end>0){for(const line of text.slice(3,end).split(/\r?\n/)){const m=line.match(/^([\w-]+):\s*(.*)$/);if(!m)continue;const v=m[2].trim().replace(/^['"]|['"]$/g,'');if(m[1]==='name')meta.name=v;if(m[1]==='description')meta.description=v;}}}if(!meta.description){const first=text.split(/\r?\n/).find(l=>l.trim()&&!l.startsWith('#')&&l.trim()!=='---');meta.description=first?.trim().slice(0,180)||'Reusable skill';}return meta;}
const STOP=new Set(['the','and','for','with','from','this','that','into','your','you','are','can','use','using','task','work','code','project','agent','skill']);
const words=s=>[...new Set(String(s||'').toLowerCase().match(/[a-z0-9][a-z0-9_.-]{2,}/g)||[])].filter(x=>!STOP.has(x));
function relevance(query,skill){const q=words(query),hay=(skill.name+' '+skill.description).toLowerCase(),name=String(skill.name||'').toLowerCase();let score=0;if(name&&String(query||'').toLowerCase().includes(name))score+=12;for(const w of q){if(name.includes(w))score+=4;else if(hay.includes(w))score+=2;}return score;}
async function addRoot(map,root,source='skill'){let ents=[];try{ents=await fs.readdir(root,{withFileTypes:true});}catch{return;}for(const e of ents.filter(e=>e.isDirectory())){const file=path.join(root,e.name,'SKILL.md');try{const text=await fs.readFile(file,'utf8'),meta=parseMeta(text,e.name);map.set(meta.name,{...meta,file,root:path.dirname(file),source,estimatedTokens:Math.ceil(text.length/4)});}catch{}}}
export class SkillRegistry{
 constructor(cwd){this.cwd=cwd;this.skills=new Map();}
 async scan(){this.skills.clear();const roots=[path.join(this.cwd,'.craftcli','skills'),path.join(this.cwd,'.claude','skills'),path.join(this.cwd,'.agents','skills'),path.join(os.homedir(),'.craftcli','skills'),path.join(os.homedir(),'.claude','skills'),path.join(os.homedir(),'.agents','skills')];for(const r of roots)await addRoot(this.skills,r);
   const pr=path.join(os.homedir(),'.craftcli','claude-plugins');let ps=[];try{ps=await fs.readdir(pr,{withFileTypes:true});}catch{}for(const p of ps.filter(x=>x.isDirectory()))await addRoot(this.skills,path.join(pr,p.name,'skills'),`plugin:${p.name}`);return this;}
 list(){return[...this.skills.values()].map(({name,description,file,source})=>({name,description,file,source}));}
 async load(name){const s=this.skills.get(name);if(!s)throw new Error(`Unknown skill: ${name}`);const content=await fs.readFile(s.file,'utf8');return{...s,content,estimatedTokens:Math.ceil(content.length/4)};}
 async autoSelect(query,{maxSkills=2,maxTokens=8000,minScore=2}={}){
   const ranked=[...this.skills.values()].map(skill=>({skill,score:relevance(query,skill)})).filter(x=>x.score>=minScore).sort((a,b)=>b.score-a.score||(a.skill.estimatedTokens||0)-(b.skill.estimatedTokens||0)||a.skill.name.localeCompare(b.skill.name));
   const selected=[];let used=0;
   for(const x of ranked){if(selected.length>=Math.max(0,maxSkills))break;const cost=x.skill.estimatedTokens||0;if(cost>maxTokens-used)continue;const loaded=await this.load(x.skill.name);selected.push({...loaded,score:x.score});used+=loaded.estimatedTokens||cost;}
   return{selected,estimatedTokens:used,candidates:ranked.length};
 }
 estimateSavings(){return{skills:this.skills.size,fullLoadEstimatedTokens:[...this.skills.values()].reduce((n,s)=>n+(s.estimatedTokens||0),0)};}
}
