import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {APP_DIR} from './config.mjs';
const execFileP=promisify(execFile);
const MARKET_DIR=path.join(APP_DIR,'marketplaces');
const PLUGIN_DIR=path.join(APP_DIR,'claude-plugins');
const safe=(s)=>String(s||'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'plugin';
async function json(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}}
async function git(args,cwd){return (await execFileP('git',args,{cwd,maxBuffer:20_000_000})).stdout;}
function repoUrl(spec){const s=String(spec||'').trim();if(/^https?:\/\//.test(s)||/^git@/.test(s))return s;if(/^[\w.-]+\/[\w.-]+$/.test(s))return `https://github.com/${s.replace(/\.git$/,'')}.git`;return s;}
function sourceName(spec){const s=String(spec||'').replace(/\.git$/,'').replace(/\/$/,'');return safe(s.split(/[\\/]/).pop());}
async function copyTree(src,dst){await fs.rm(dst,{recursive:true,force:true});await fs.mkdir(path.dirname(dst),{recursive:true});await fs.cp(src,dst,{recursive:true,filter:x=>!x.includes(`${path.sep}.git${path.sep}`)&&!x.endsWith(`${path.sep}.git`)});}
export class MarketplaceManager{
  constructor(){this.marketplaces=new Map();this.installed=new Map();}
  async scan(){await fs.mkdir(MARKET_DIR,{recursive:true});await fs.mkdir(PLUGIN_DIR,{recursive:true});this.marketplaces.clear();this.installed.clear();
    let ents=[];try{ents=await fs.readdir(MARKET_DIR,{withFileTypes:true});}catch{}
    for(const e of ents.filter(x=>x.isDirectory())){const root=path.join(MARKET_DIR,e.name),m=await json(path.join(root,'.claude-plugin','marketplace.json'));if(m)this.marketplaces.set(m.name||e.name,{name:m.name||e.name,root,meta:m,source:e.name});}
    ents=[];try{ents=await fs.readdir(PLUGIN_DIR,{withFileTypes:true});}catch{}
    for(const e of ents.filter(x=>x.isDirectory())){const root=path.join(PLUGIN_DIR,e.name),p=await json(path.join(root,'.claude-plugin','plugin.json'))||{};this.installed.set(p.name||e.name,{name:p.name||e.name,root,meta:p,version:p.version||'',description:p.description||''});}
    return this;
  }
  listMarketplaces(){return[...this.marketplaces.values()].map(x=>({name:x.name,source:x.source,plugins:(x.meta.plugins||[]).length}));}
  listInstalled(){return[...this.installed.values()].map(x=>({name:x.name,version:x.version,description:x.description,root:x.root}));}
  available(){const out=[];for(const m of this.marketplaces.values())for(const p of m.meta.plugins||[])out.push({marketplace:m.name,name:p.name,version:p.version||'',description:p.description||'',source:p.source});return out;}
  async add(spec){await fs.mkdir(MARKET_DIR,{recursive:true});const url=repoUrl(spec),name=sourceName(spec),dst=path.join(MARKET_DIR,name);try{await fs.access(path.join(dst,'.git'));await git(['pull','--ff-only'],dst);}catch{await fs.rm(dst,{recursive:true,force:true});await git(['clone','--depth','1',url,dst],process.cwd());}
    const meta=await json(path.join(dst,'.claude-plugin','marketplace.json'));if(!meta)throw new Error('No .claude-plugin/marketplace.json found in marketplace repository.');await this.scan();return{name:meta.name||name,plugins:(meta.plugins||[]).length};}
  _find(ref){const [name,market]=String(ref||'').split('@');if(market){const m=this.marketplaces.get(market);const p=m?.meta?.plugins?.find(x=>x.name===name);return p?{p,m}:null;}for(const m of this.marketplaces.values()){const p=m.meta?.plugins?.find(x=>x.name===name);if(p)return{p,m};}return null;}
  async _resolveSource(hit){const {p,m}=hit;const s=p.source;if(typeof s==='string'){const src=path.resolve(m.root,s);return{kind:'local',src};}if(s&&typeof s==='object'&&s.source==='url'&&s.url){const cache=path.join(APP_DIR,'plugin-cache',`${safe(p.name)}-${crypto.createHash('sha1').update(s.url+(s.ref||'')+(s.sha||'')).digest('hex').slice(0,8)}`);await fs.mkdir(path.dirname(cache),{recursive:true});try{await fs.access(path.join(cache,'.git'));await git(['fetch','--depth','1','origin',s.ref||'HEAD'],cache);}catch{await fs.rm(cache,{recursive:true,force:true});await git(['clone','--depth','1',...(s.ref?['--branch',s.ref]:[]),s.url,cache],process.cwd());}
      if(s.sha){try{await git(['checkout',s.sha],cache);}catch{}}
      return{kind:'git',src:cache};}
    throw new Error(`Unsupported plugin source for ${p.name}`);
  }
  async install(ref){const hit=this._find(ref);if(!hit)throw new Error(`Plugin not found in configured marketplaces: ${ref}`);const {p,m}=hit,{src}=await this._resolveSource(hit),dst=path.join(PLUGIN_DIR,safe(p.name));await copyTree(src,dst);const manifest=await json(path.join(dst,'.claude-plugin','plugin.json'))||{};const stamp={...manifest,name:manifest.name||p.name,description:manifest.description||p.description||'',version:manifest.version||p.version||'',_craft:{marketplace:m.name,installedAt:new Date().toISOString()}};await fs.mkdir(path.join(dst,'.claude-plugin'),{recursive:true});await fs.writeFile(path.join(dst,'.claude-plugin','plugin.json'),JSON.stringify(stamp,null,2)+'\n');await this.scan();return this.installed.get(stamp.name);}
  async remove(name){const p=this.installed.get(name);if(!p)throw new Error(`Plugin not installed: ${name}`);await fs.rm(p.root,{recursive:true,force:true});await this.scan();return true;}
  async update(name){const p=this.installed.get(name);if(!p)throw new Error(`Plugin not installed: ${name}`);const market=p.meta?._craft?.marketplace;if(!market)throw new Error('Plugin has no marketplace provenance; reinstall it.');return this.install(`${name}@${market}`);}
}
export const CLAUDE_PLUGIN_DIR=PLUGIN_DIR;
