import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { expandEnv } from './config.mjs';
import { PersistentOAuthProvider } from './oauth.mjs';
import { createRequire } from 'node:module';

const APP_VERSION=(()=>{try{return createRequire(import.meta.url)('../package.json').version;}catch{return '0.0.0';}})();

const execFileP=promisify(execFile);

async function commandAvailable(command){
  const cmd=String(command||'').trim();
  if(!cmd)return false;
  try{
    if(/[\\/]/.test(cmd)){await fs.access(cmd);return true;}
    const probe=process.platform==='win32'?['where.exe',[cmd]]:['which',[cmd]];
    await execFileP(probe[0],probe[1],{windowsHide:true,timeout:5000,maxBuffer:200000});
    return true;
  }catch{return false;}
}

export function describeMcpError(name,error,config={}){
  const label=String(name||'MCP');
  const message=String(error?.message||error||'Unknown connection error').replace(/\s+/g,' ').trim();
  const missing=error?.code==='ENOENT'||/not recognized as an internal or external command|command not found|no such file or directory/i.test(message);
  if(missing&&config.command==='docker')return `${label} connector needs Docker Desktop, but \`docker\` is not available on PATH. Install/start Docker Desktop, reopen the terminal, then run \`/connect ${label}\` again.`;
  if(missing&&config.command)return `${label} connector cannot start because \`${config.command}\` is not installed or is not on PATH.`;
  if(/connection closed|econnreset|socket hang up|closed before|transport.*closed/i.test(message)){
    if(config.command==='docker')return `${label} connector stopped during startup. Make sure Docker Desktop is installed and running, then retry \`/connect ${label}\`.`;
    return `${label} connector closed the connection during startup. Retry \`/connect ${label}\`; if it persists, check the server URL and authentication.`;
  }
  if(/client_id.*undefined|redirect_uri.*undefined|client registration returned no client_id/i.test(message))return `${label} connector OAuth registration is incomplete. Craft Code discards invalid cached OAuth client data automatically; retry \`/connect ${label}\`.`;
  if(config.authHint&&/requires a token|authentication|unauthor|forbidden|401|403/i.test(message))return `${label} connector: ${config.authHint}`;
  if(/unauthor|forbidden|401|403/i.test(message))return `${label} connector authentication was rejected. Run \`/disconnect ${label}\` and then \`/connect ${label}\` to authorize again.`;
  return `${label} connector failed: ${message}`;
}

async function resolveBearer(c){
  if(c.bearerToken)return c.bearerToken;
  if(c.tokenEnv&&process.env[c.tokenEnv])return process.env[c.tokenEnv];
  if(c.tokenCommand){
    const [command,...args]=Array.isArray(c.tokenCommand)?c.tokenCommand:String(c.tokenCommand).split(/\s+/);
    if(await commandAvailable(command)){try{return (await execFileP(command,args,{windowsHide:true,timeout:10000,maxBuffer:200000})).stdout.trim();}catch{}}
  }
  return '';
}

export class McpManager {
  constructor(serverConfigs = {}, catalog = {}) { this.baseConfigs={...catalog,...serverConfigs};this.configs = {...this.baseConfigs}; this.clients = new Map(); this.catalog = catalog; this.pluginNames=new Set(); }
  list() { return Object.entries(this.configs).map(([name,c]) => ({name, type:c.type||'http', connected:this.clients.has(name), url:c.url, oauth:!!c.oauth, browserOAuth:!!c.browserOAuth, authMode:c.authMode||(c.oauth||c.browserOAuth?'browser':c.tokenRequired?'token':(c.type==='stdio'||c.type==='cli')?'local':'direct'), requirement:c.requirement||'', authHint:c.authHint||''})); }
  add(name,config){this.configs[name]=config;return this.configs[name];}
  setPluginConfigs(configs={}){for(const n of this.pluginNames){delete this.configs[n];}this.pluginNames.clear();for(const [n,c] of Object.entries(configs||{})){this.configs[n]=c;this.pluginNames.add(n);}return this;}
  remove(name){delete this.configs[name];const x=this.clients.get(name);if(x){try{x.client.close();}catch{}this.clients.delete(name);} }
  async _sdk() {
    try {
      const root = await import('@modelcontextprotocol/client');
      const stdio = await import('@modelcontextprotocol/client/stdio');
      return {...root,...stdio};
    } catch (e) { throw new Error('MCP client dependency missing. Run: npm install @modelcontextprotocol/client zod'); }
  }
  async connect(name,{interactive=true,onAuthUrl}={}) {
    if (this.clients.has(name)) return this.clients.get(name);
    const raw=this.configs[name]; if (!raw) throw new Error(`Unknown MCP server: ${name}`);
    const c=expandEnv(raw); const sdk=await this._sdk(); const {Client,StreamableHTTPClientTransport,StdioClientTransport}=sdk;
    const makeClient=()=>new Client({name:'craft-code',version:APP_VERSION});
    let client=makeClient(),transport,oauthProvider=null;
    try{
      if ((c.type||'http') === 'stdio') {
        if(!await commandAvailable(c.command)){const e=new Error(`${c.command||'connector command'} not found`);e.code='ENOENT';throw e;}
        transport=new StdioClientTransport({command:c.command,args:c.args||[],env:{...process.env,...(c.env||{})},cwd:c.cwd,stderr:'ignore'});
        await client.connect(transport);
      } else {
        const headers={...(c.headers||{})};
        const bearer=await resolveBearer(c);
        if(bearer)headers.Authorization=`Bearer ${bearer}`;
        if(c.tokenRequired&&!bearer)throw new Error(c.authHint||`${name} requires a token. Configure ${c.tokenEnv||'a bearer token'} first.`);
        const opts={requestInit:{headers}};
        if(c.oauth){
          oauthProvider=await new PersistentOAuthProvider(name).load();oauthProvider.onAuthUrl=onAuthUrl;
          await oauthProvider.startCallback();
          opts.authProvider=oauthProvider;
        }
        const url=new URL(c.url);
        transport=new StreamableHTTPClientTransport(url,opts);
        try{await client.connect(transport);}catch(e){
          const unauthorized=(sdk.UnauthorizedError&&e instanceof sdk.UnauthorizedError)||e?.name==='UnauthorizedError'||/unauthor/i.test(String(e?.message||''));
          if(!unauthorized||!oauthProvider||!interactive)throw e;
          const callback=await oauthProvider.waitForCode();
          await transport.finishAuth(callback.params);
          try{await client.close();}catch{}
          client=makeClient();
          transport=new StreamableHTTPClientTransport(url,opts);
          await client.connect(transport);
        }
      }
      this.clients.set(name,{client,transport,oauthProvider}); return this.clients.get(name);
    }catch(e){
      try{await client.close();}catch{}
      throw new Error(describeMcpError(name,e,c),{cause:e});
    }finally { if(oauthProvider)await oauthProvider.close(); }
  }
  async authenticate(name,opts={}){const x=await this.connect(name,{interactive:true,onAuthUrl:opts.onAuthUrl});return {connected:!!x,name};}
  async logout(name){const x=this.clients.get(name);if(x){try{await x.client.close();}catch{}this.clients.delete(name);}const p=await new PersistentOAuthProvider(name).load();await p.clear();return true;}
  async tools(name) { const c=expandEnv(this.configs[name]||{});if(c.type==='cli')return[];try{const {client}=await this.connect(name);const r=await client.listTools();return r.tools||[];}catch(e){throw new Error(describeMcpError(name,e,c),{cause:e});} }
  async call(name, toolName, args) { const c=expandEnv(this.configs[name]||{});if(c.type==='cli')throw new Error(`${name} uses a native CLI bridge, not MCP tools.`);try{const {client}=await this.connect(name);return await client.callTool({name:toolName,arguments:args||{}});}catch(e){this.clients.delete(name);throw new Error(describeMcpError(name,e,c),{cause:e});} }
  async closeAll() { for (const {client,oauthProvider} of this.clients.values()) { try { await client.close(); } catch {} try{await oauthProvider?.close();}catch{} } this.clients.clear(); }
}
