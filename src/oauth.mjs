import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {APP_DIR} from './config.mjs';
const AUTH_DIR=path.join(APP_DIR,'oauth');
const safe=s=>String(s||'server').replace(/[^a-zA-Z0-9._-]+/g,'-');
const validClientInfo=x=>x&&typeof x==='object'&&typeof x.client_id==='string'&&x.client_id.trim()?x:undefined;
const validTokens=x=>x&&typeof x==='object'&&typeof x.access_token==='string'&&x.access_token.trim()?x:undefined;
export function sanitizeOAuthData(input={}){
  const data=input&&typeof input==='object'?{...input}:{};
  if(data.clients&&typeof data.clients==='object'){
    data.clients=Object.fromEntries(Object.entries(data.clients).filter(([,v])=>validClientInfo(v)));
    if(!Object.keys(data.clients).length)delete data.clients;
  }else delete data.clients;
  if(!validClientInfo(data.client))delete data.client;
  if(data.tokens&&typeof data.tokens==='object'){
    data.tokens=Object.fromEntries(Object.entries(data.tokens).filter(([,v])=>validTokens(v)));
    if(!Object.keys(data.tokens).length)delete data.tokens;
  }else delete data.tokens;
  if(!validTokens(data.lastTokens)){delete data.lastTokens;delete data.lastIssuer;}
  return data;
}
export const DEFAULT_OAUTH_CALLBACK_PORT=47831;
// A stable loopback port keeps the redirect_uri identical across /connect runs, so cached
// dynamic-client registrations (which pin redirect_uris) stay valid. CRAFTCODE_OAUTH_PORT=0 forces an ephemeral port.
export function preferredCallbackPort(env=process.env){
  const raw=env.CRAFTCODE_OAUTH_PORT;
  if(raw===undefined||raw==='')return DEFAULT_OAUTH_CALLBACK_PORT;
  const n=Number(raw);
  return Number.isInteger(n)&&n>=1&&n<=65535?n:0;
}
export function browserOpenCommand(url,platform=process.platform){
  const u=String(url);
  if(platform==='win32')return{command:'rundll32.exe',args:['url.dll,FileProtocolHandler',u]};
  if(platform==='darwin')return{command:'open',args:[u]};
  return{command:'xdg-open',args:[u]};
}
function openBrowser(url){const x=browserOpenCommand(url),child=execFile(x.command,x.args,{windowsHide:true});child?.on?.('error',()=>{});}
export class PersistentOAuthProvider{
  constructor(name){this.name=name;this.file=path.join(AUTH_DIR,`${safe(name)}.json`);this.data={};this.server=null;this.callbackUrl='';this._wait=null;this._pending=null;this.lastState='';}
  async load(){await fs.mkdir(AUTH_DIR,{recursive:true});try{this.data=JSON.parse(await fs.readFile(this.file,'utf8'));}catch{this.data={};}const before=JSON.stringify(this.data);this.data=sanitizeOAuthData(this.data);if(JSON.stringify(this.data)!==before)await this.save();this.lastState=this.data.oauthState||'';return this;}
  async save(){await fs.mkdir(AUTH_DIR,{recursive:true});await fs.writeFile(this.file,JSON.stringify(this.data,null,2)+'\n',{mode:0o600});}
  async startCallback(){if(this.server)return;await new Promise((resolve,reject)=>{const srv=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');if(u.pathname!=='/oauth/callback'){res.writeHead(404);res.end('Not found');return;}const code=u.searchParams.get('code'),err=u.searchParams.get('error'),iss=u.searchParams.get('iss'),state=u.searchParams.get('state');res.writeHead(code?200:400,{'content-type':'text/html'});res.end(`<html><body style="font-family:system-ui;background:#111;color:#eee;padding:40px"><h2>${code?'Craft Code connected':'Authorization failed'}</h2><p>${code?'You can close this browser tab and return to Craft Code.':(err||'No authorization code returned.')}</p></body></html>`);const payload=code?{code,iss,state,params:new URLSearchParams(u.searchParams)}:{error:err||'OAuth failed',state,params:new URLSearchParams(u.searchParams)};if(this._wait){const w=this._wait;this._wait=null;payload.error?w.reject(new Error(payload.error)):w.resolve(payload);}else this._pending=payload;});const listenOn=port=>new Promise((ok,fail)=>{const onErr=e=>{srv.off('listening',onOk);fail(e);},onOk=()=>{srv.off('error',onErr);ok();};srv.once('error',onErr);srv.once('listening',onOk);srv.listen(port,'127.0.0.1');});(async()=>{const preferred=preferredCallbackPort();try{if(preferred)await listenOn(preferred);else await listenOn(0);}catch(e){if(!preferred||e?.code!=='EADDRINUSE'&&e?.code!=='EACCES')throw e;await listenOn(0);}srv.on('error',()=>{});this.server=srv;const a=srv.address();this.callbackUrl=`http://127.0.0.1:${a.port}/oauth/callback`;resolve();})().catch(reject);});}
  async waitForCode(timeoutMs=300000){if(this._pending){const p=this._pending;this._pending=null;if(p.error)throw new Error(p.error);this.validateState(p.state);return p;}return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this._wait=null;reject(new Error('OAuth login timed out.'));},timeoutMs);this._wait={resolve:x=>{clearTimeout(timer);try{this.validateState(x.state);resolve(x);}catch(e){reject(e);}},reject:e=>{clearTimeout(timer);reject(e);}};});}
  validateState(received){if(!this.lastState||!received||received!==this.lastState)throw new Error('OAuth state mismatch. Authorization was cancelled for safety; retry /connect.');this.data.oauthState='';this.lastState='';}
  async close(){if(this.server)await new Promise(r=>this.server.close(()=>r()));this.server=null;}
  get redirectUrl(){return this.callbackUrl;}
  get clientMetadata(){return{redirect_uris:[this.callbackUrl],application_type:'native',token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],client_name:'Craft Code',client_uri:'https://github.com/AIM-IT4/craftcode-CLI'};}
  async state(){const value=crypto.randomBytes(24).toString('base64url');this.lastState=value;this.data.oauthState=value;await this.save();return value;}
  registeredForCallback(info){const x=validClientInfo(info);if(!x)return undefined;if(Array.isArray(x.redirect_uris)&&this.callbackUrl&&!x.redirect_uris.includes(this.callbackUrl))return undefined;return x;}
  async clientInformation(ctx){if(ctx?.issuer)return this.registeredForCallback(this.data.clients?.[ctx.issuer]);return this.registeredForCallback(this.data.client);}
  async saveClientInformation(info,ctx){if(!validClientInfo(info))throw new Error('OAuth client registration returned no client_id.');const k=ctx?.issuer||info.issuer||'_default';this.data.clients||={};this.data.clients[k]=info;this.data.client=info;await this.save();}
  async tokens(ctx){if(ctx?.issuer)return validTokens(this.data.tokens?.[ctx.issuer]);return validTokens(this.data.lastTokens);}
  async saveTokens(tokens,ctx){if(!validTokens(tokens))throw new Error('OAuth token response returned no access_token.');const k=ctx?.issuer||tokens.issuer||'_default';this.data.tokens||={};this.data.tokens[k]=tokens;this.data.lastTokens=tokens;if(ctx?.issuer)this.data.lastIssuer=ctx.issuer;await this.save();}
  async redirectToAuthorization(url){this.lastAuthUrl=String(url);try{this.onAuthUrl?.(this.lastAuthUrl);}catch{}openBrowser(url);}
  async saveCodeVerifier(v){this.data.codeVerifier=v;await this.save();}
  async codeVerifier(){return this.data.codeVerifier||'';}
  async saveDiscoveryState(v){this.data.discoveryState=v;await this.save();}
  async discoveryState(){return this.data.discoveryState||undefined;}
  async invalidateCredentials(scope='all'){
    if(scope==='all'||scope==='client'){delete this.data.clients;delete this.data.client;}
    if(scope==='all'||scope==='tokens'){delete this.data.tokens;delete this.data.lastTokens;delete this.data.lastIssuer;}
    if(scope==='all'||scope==='verifier')delete this.data.codeVerifier;
    if(scope==='all'||scope==='discovery')delete this.data.discoveryState;
    await this.save();
  }
  async clear(){this.data={};this.lastState='';try{await fs.rm(this.file,{force:true});}catch{}}
}
