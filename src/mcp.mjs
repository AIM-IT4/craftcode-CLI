import { expandEnv } from './config.mjs';
import { PersistentOAuthProvider } from './oauth.mjs';

export class McpManager {
  constructor(serverConfigs = {}, catalog = {}) { this.baseConfigs={...catalog,...serverConfigs};this.configs = {...this.baseConfigs}; this.clients = new Map(); this.catalog = catalog; this.pluginNames=new Set(); }
  list() { return Object.entries(this.configs).map(([name,c]) => ({name, type:c.type||'http', connected:this.clients.has(name), url:c.url, oauth:!!c.oauth, browserOAuth:!!c.browserOAuth})); }
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
  async connect(name,{interactive=true}={}) {
    if (this.clients.has(name)) return this.clients.get(name);
    const raw=this.configs[name]; if (!raw) throw new Error(`Unknown MCP server: ${name}`);
    const c=expandEnv(raw); const sdk=await this._sdk(); const {Client,StreamableHTTPClientTransport,StdioClientTransport}=sdk;
    const client=new Client({name:'craft-code',version:'0.8.0'});
    let transport,oauthProvider=null;
    if ((c.type||'http') === 'stdio') {
      transport=new StdioClientTransport({command:c.command,args:c.args||[],env:{...process.env,...(c.env||{})},cwd:c.cwd});
      await client.connect(transport);
    } else {
      const opts={requestInit:{headers:c.headers||{}}};
      if(c.oauth){
        oauthProvider=await new PersistentOAuthProvider(name).load();
        await oauthProvider.startCallback();
        opts.authProvider=oauthProvider;
      } else if(c.bearerToken){
        opts.authProvider={token:async()=>c.bearerToken};
      }
      transport=new StreamableHTTPClientTransport(new URL(c.url),opts);
      try{await client.connect(transport);}catch(e){
        const unauthorized=(sdk.UnauthorizedError&&e instanceof sdk.UnauthorizedError)||e?.name==='UnauthorizedError'||/unauthor/i.test(String(e?.message||''));
        if(!unauthorized||!oauthProvider||!interactive)throw e;
        const {code}=await oauthProvider.waitForCode();
        if(typeof transport.finishAuth!=='function')throw new Error('Installed MCP client SDK does not expose finishAuth(); update @modelcontextprotocol/client.');
        await transport.finishAuth(code);
        await client.connect(transport);
      } finally { if(oauthProvider)await oauthProvider.close(); }
    }
    this.clients.set(name,{client,transport,oauthProvider}); return this.clients.get(name);
  }
  async authenticate(name){const x=await this.connect(name,{interactive:true});return {connected:!!x,name};}
  async logout(name){const x=this.clients.get(name);if(x){try{await x.client.close();}catch{}this.clients.delete(name);}const p=await new PersistentOAuthProvider(name).load();await p.clear();return true;}
  async tools(name) { const {client}=await this.connect(name); const r=await client.listTools(); return r.tools||[]; }
  async call(name, toolName, args) { const {client}=await this.connect(name); return client.callTool({name:toolName,arguments:args||{}}); }
  async closeAll() { for (const {client,oauthProvider} of this.clients.values()) { try { await client.close(); } catch {} try{await oauthProvider?.close();}catch{} } this.clients.clear(); }
}
