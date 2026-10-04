import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { pathToFileURL } from 'node:url';
const execFileP=promisify(execFile);
const CLAUDE_ROOT=path.join(os.homedir(),'.craftcli','claude-plugins');
async function readJson(f){try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return null;}}
async function filesIn(dir,re){let es=[];try{es=await fs.readdir(dir,{withFileTypes:true});}catch{return[];}return es.filter(e=>e.isFile()&&re.test(e.name)).map(e=>path.join(dir,e.name));}
function hookCommands(raw,event){const x=raw?.hooks?.[event]||raw?.[event]||[];const out=[];const walk=v=>{if(Array.isArray(v))return v.forEach(walk);if(v&&typeof v==='object'){if(v.type==='command'&&v.command)out.push(v.command);Object.values(v).forEach(walk);}};walk(x);return [...new Set(out)];}
export class PluginRegistry {
  constructor(cwd, active = [], opts={}) { this.cwd = cwd; this.requestedActive = new Set(active); this.plugins = new Map(); this.active = new Set(); this.allowClaudeHooks=!!opts.allowClaudeHooks; this.commandMap=new Map(); }
  async scan() {
    this.plugins.clear();this.commandMap.clear();
    const dirs = [path.join(this.cwd, '.craftcli', 'plugins'), path.join(os.homedir(), '.craftcli', 'plugins')];
    for (const dir of dirs) {
      let ents=[]; try { ents = await fs.readdir(dir, {withFileTypes:true}); } catch { continue; }
      for (const e of ents.filter(e => e.isFile() && /\.(mjs|js)$/.test(e.name))) {
        const file=path.join(dir,e.name);
        try { const mod=await import(pathToFileURL(file).href + `?t=${Date.now()}`); const p=mod.default || mod.plugin || mod; const name=p.name || path.basename(e.name,path.extname(e.name)); this.plugins.set(name,{...p,name,file,type:'js'}); if(this.requestedActive.has(name))this.active.add(name); }
        catch(err){this.plugins.set(e.name,{name:e.name,file,error:String(err),type:'js'});}
      }
    }
    let installed=[];try{installed=await fs.readdir(CLAUDE_ROOT,{withFileTypes:true});}catch{}
    for(const e of installed.filter(x=>x.isDirectory())){
      const root=path.join(CLAUDE_ROOT,e.name),manifest=await readJson(path.join(root,'.claude-plugin','plugin.json'))||{},name=manifest.name||e.name,hookFile=typeof manifest.hooks==='string'?path.resolve(root,manifest.hooks):path.join(root,'hooks','hooks.json'),hooks=await readJson(hookFile)||{};
      const p={name,description:manifest.description||'',version:manifest.version||'',root,type:'claude',manifest,hooks};this.plugins.set(name,p);this.active.add(name);
      for(const file of await filesIn(path.join(root,'commands'),/\.md$/i)){const base=path.basename(file,'.md'),content=await fs.readFile(file,'utf8'),entry={plugin:name,name:base,file,content};this.commandMap.set(`${name}:${base}`,entry);if(!this.commandMap.has(base))this.commandMap.set(base,entry);}
    }
    return this;
  }
  list(){return[...this.plugins.values()].map(p=>({name:p.name,description:p.description||'',version:p.version||'',type:p.type||'js',active:this.active.has(p.name),error:p.error,root:p.root}));}
  activate(name){if(!this.plugins.has(name))throw new Error(`Unknown plugin ${name}`);this.active.add(name);}
  deactivate(name){this.active.delete(name);}
  commands(){const seen=new Set(),out=[];for(const [key,v] of this.commandMap){if(key.includes(':')){seen.add(key);out.push({cmd:`/${key}`,desc:`${v.plugin} command`});}}return out;}
  expandCommand(token,args=''){const key=String(token||'').replace(/^\//,'');const c=this.commandMap.get(key);if(!c)return null;const body=c.content.replace(/\$ARGUMENTS\b/g,String(args||'')).replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g,path.dirname(path.dirname(c.file)));return{...c,prompt:`Follow this installed Claude-plugin command exactly where compatible with Craft Code.\n\n${body}\n\nUser arguments: ${args||'(none)'}`};}
  toolEntries(context){const out=[];for(const name of this.active){const p=this.plugins.get(name);if(p?.type==='claude'||!p?.tools)continue;const tools=typeof p.tools==='function'?p.tools(context):p.tools;for(const t of tools||[])out.push({...t,plugin:name});}return out;}
  async hook(event,payload){
    for(const name of this.active){const p=this.plugins.get(name);const fn=p?.hooks?.[event];if(p?.type!=='claude'&&typeof fn==='function')await fn(payload);}
    if(!this.allowClaudeHooks)return[];
    const map={'session.start':'SessionStart','subagent.start':'SubagentStart','session.beforeTurn':'UserPromptSubmit','session.afterTurn':'Stop','tool.before':'PreToolUse','tool.after':'PostToolUse'},ce=map[event];if(!ce)return[];const output=[];
    for(const name of this.active){const p=this.plugins.get(name);if(p?.type!=='claude')continue;for(let cmd of hookCommands(p.hooks,ce)){cmd=cmd.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g,p.root);try{const shell=process.platform==='win32'?['cmd',['/c',cmd]]:['bash',['-lc',cmd]];const r=await execFileP(shell[0],shell[1],{cwd:this.cwd,env:{...process.env,CLAUDE_PLUGIN_ROOT:p.root},timeout:30000,maxBuffer:2_000_000});if(r.stdout?.trim())output.push(r.stdout.trim());}catch(e){output.push(`[${name} hook ${ce} failed] ${e.message}`);}}
    }
    return output;
  }

  async mcpServers(){const out={};for(const name of this.active){const p=this.plugins.get(name);if(p?.type!=='claude')continue;let cfg=p.manifest?.mcpServers||{};const extra=await readJson(path.join(p.root,'.mcp.json'));if(extra?.mcpServers)cfg={...cfg,...extra.mcpServers};for(const [n,c0] of Object.entries(cfg||{})){const rep=v=>typeof v==='string'?v.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g,p.root):Array.isArray(v)?v.map(rep):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rep(x)])):v;out[`${name}:${n}`]=rep(c0);}}return out;}
  setClaudeHooks(v){this.allowClaudeHooks=!!v;}
}
