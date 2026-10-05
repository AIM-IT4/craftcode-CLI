import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const SOURCE_EXT=new Set(['.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.go','.rs','.java','.kt','.kts','.c','.cc','.cpp','.h','.hpp','.cs','.rb','.php','.swift','.scala','.sql','.vue','.svelte']);
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const stable=value=>{
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
};
const safePath=(cwd,p='.')=>{
  const root=path.resolve(cwd),full=path.resolve(root,p);
  if(full!==root&&!full.startsWith(root+path.sep))throw new Error('Path escapes workspace');
  return full;
};

async function statVersion(file){
  try{const s=await fs.stat(file);return `${s.size}:${Math.floor(s.mtimeMs*1000)}`;}catch(e){if(e.code==='ENOENT')return'missing';throw e;}
}
async function treeVersion(cwd,input='.'){
  const root=safePath(cwd,input),rows=[];let rootStat;
  try{rootStat=await fs.stat(root);}catch(e){if(e.code==='ENOENT')return'missing';throw e;}
  if(rootStat.isFile())return statVersion(root);
  const walk=async dir=>{
    if(rows.length>=500)return;
    let entries=[];try{entries=await fs.readdir(dir,{withFileTypes:true});}catch{return;}
    for(const e of entries){
      if(rows.length>=500)break;
      if(e.name==='.git'||e.name==='node_modules'||e.name==='dist'||e.name==='build'||e.name==='coverage'||e.name==='.cache')continue;
      const full=path.join(dir,e.name);
      if(e.isDirectory())await walk(full);
      else if(e.isFile()&&SOURCE_EXT.has(path.extname(e.name).toLowerCase())){
        const st=await fs.stat(full).catch(()=>null);if(st)rows.push(`${path.relative(cwd,full)}:${st.size}:${Math.floor(st.mtimeMs*1000)}`);
      }
    }
  };
  await walk(root);rows.sort();return hash(rows.join('\n'));
}
async function manifestVersion(cwd){
  const names=['package.json','package-lock.json','pnpm-lock.yaml','yarn.lock','go.mod','Cargo.toml','pyproject.toml','pytest.ini'];
  const rows=[];for(const n of names)rows.push(`${n}:${await statVersion(path.join(cwd,n))}`);
  return hash(rows.join('|'));
}

export class ToolCache{
  constructor({cwd=process.cwd(),dir=path.join(os.homedir(),'.craftcli','cache'),maxEntries=250}={}){
    this.cwd=path.resolve(cwd);this.dir=path.resolve(dir);this.maxEntries=Math.max(10,maxEntries);
    this.file=path.join(this.dir,`${hash(this.cwd).slice(0,20)}.json`);
    this.data=null;this.metrics={hits:0,misses:0,sets:0,invalidations:0};
  }
  async _load(){
    if(this.data)return this.data;
    try{const x=JSON.parse(await fs.readFile(this.file,'utf8'));this.data=x&&x.entries?x:{entries:{}};}
    catch{this.data={entries:{}};}
    return this.data;
  }
  async _save(){
    await fs.mkdir(this.dir,{recursive:true});
    const entries=Object.entries(this.data.entries||{}).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,this.maxEntries);
    this.data.entries=Object.fromEntries(entries);
    await fs.writeFile(this.file,JSON.stringify(this.data));
  }
  _key(name,args,version){return hash(JSON.stringify(stable({name,args,version})));}
  async get(name,args,version){
    const data=await this._load(),entry=data.entries[this._key(name,args,version)];
    if(!entry){this.metrics.misses++;return{hit:false,value:null};}
    if(entry.expiresAt&&entry.expiresAt<=Date.now()){delete data.entries[this._key(name,args,version)];this.metrics.misses++;await this._save();return{hit:false,value:null};}
    this.metrics.hits++;return{hit:true,value:entry.value};
  }
  async set(name,args,version,value,{ttlMs=0}={}){
    const data=await this._load(),key=this._key(name,args,version),now=Date.now();
    data.entries[key]={at:now,expiresAt:ttlMs?now+Math.max(1,ttlMs):0,value};this.metrics.sets++;await this._save();return value;
  }
  async invalidateWorkspace(){this.data={entries:{}};this.metrics.invalidations++;await this._save();}
  stats(){return{...this.metrics,entries:Object.keys(this.data?.entries||{}).length,file:this.file};}
  async versionFor(name,args={}){
    if(name==='read_file')return statVersion(safePath(this.cwd,args.path));
    if(name==='read_many_files'){
      const rows=[];for(const x of args.files||[])rows.push(`${x.path}:${await statVersion(safePath(this.cwd,x.path))}`);
      return hash(rows.join('|'));
    }
    if(name==='semantic_code'||name==='repo_map')return treeVersion(this.cwd,args.path||'.');
    if(name==='discover_project_commands')return manifestVersion(this.cwd);
    if(name==='git_status'||name==='git_diff'||name==='git_log')return'no-cache';
    return'remote-v1';
  }
}
