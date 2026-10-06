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
function openBrowser(url){const u=String(url);if(process.platform==='win32')execFile('cmd',['/c','start','',u],{windowsHide:true});else if(process.platform==='darwin')execFile('open',[u]);else execFile('xdg-open',[u]);}
export class PersistentOAuthProvider{
  constructor(name){this.name=name;this.file=path.join(AUTH_DIR,`${safe(name)}.json`);this.data={};this.server=null;this.callbackUrl='';this._wait=null;this._pending=null;this.lastState='';}
  async load(){await fs.mkdir(AUTH_DIR,{recursive:true});try{this.data=JSON.parse(await fs.readFile(this.file,'utf8'));}catch{this.data={};}const before=JSON.stringify(this.data);this.data=sanitizeOAuthData(this.data);if(JSON.stringify(this.data)!==before)await this.save();this.lastState=this.data.oauthState||'';return this;}
  async save(){await fs.mkdir(AUTH_DIR,{recursive:true});await fs.writeFile(this.file,JSON.stringify(this.data,null,2)+'\n',{mode:0o600});}
  async startCallback(){if(this.server)return;await new Promise((resolve,reject)=>{const srv=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');if(u.pathname!=='/oauth/callback'){res.writeHead(404);res.end('Not found');return;}const code=u.searchParams.get('code'),err=u.searchParams.get('error'),iss=u.searchParams.get('iss'),state=u.searchParams.get('state');res.writeHead(code?200:400,{'content-type':'text/html'});res.end(`<html><body style="font-family:system-ui;background:#111;color:#eee;padding:40px"><h2>${code?'Craft Code connected':'Authorization failed'}</h2><p>${code?'You can close this browser tab and return to Craft Code.':(err||'No authorization code returned.')}</p></body></html>`);const payload=code?{code,iss,state,params:new URLSearchParams(u.searchParams)}:{error:err||'OAuth failed',state,params:new URLSearchParams(u.searchParams)};if(this._wait){const w=this._wait;this._wait=null;payload.error?w.reject(new Error(payload.error)):w.resolve(payload);}else this._pending=payload;});srv.on('error',reject);srv.listen(0,'127.0.0.1',()=>{this.server=srv;const a=srv.address();this.callbackUrl=`http://127.0.0.1:${a.port}/oauth/callback`;resolve();});});}
  async waitForCode(timeoutMs=300000){if(this._pending){const p=this._pending;this._pending=null;if(p.error)throw new Error(p.error);this.validateState(p.state);return p;}return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this._wait=null;reject(new Error('OAuth login timed out.'));},timeoutMs);this._wait={resolve:x=>{clearTimeout(timer);try{this.validateState(x.state);resolve(x);}catch(e){reject(e);}},reject:e=>{clearTimeout(timer);reject(e);}};});}
  validateState(received){if(!this.lastState||!received||received!==this.lastState)throw new Error('OAuth state mismatch. Authorization was cancelled for safety; retry /connect.');this.data.oauthState='';this.lastState='';}
  async close(){if(this.server)await new Promise(r=>this.server.close(()=>r()));this.server=null;}
  get redirectUrl(){return this.callbackUrl;}
  get clientMetadata(){return{redirect_uris:[this.callbackUrl],application_type:'native',token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],client_name:'Craft Code',client_uri:'https://github.com/AIM-IT4/craftcode-CLI'};}
  async state(){const value=crypto.randomBytes(24).toString('base64url');this.lastState=value;this.data.oauthState=value;await this.save();return value;}
  async clientInformation(ctx){if(ctx?.issuer)return validClientInfo(this.data.clients?.[ctx.issuer]);return validClientInfo(this.data.client);}
  async saveClientInformation(info,ctx){if(!validClientInfo(info))throw new Error('OAuth client registration returned no client_id.');const k=ctx?.issuer||info.issuer||'_default';this.data.clients||={};this.data.clients[k]=info;this.data.client=info;await this.save();}
  async tokens(ctx){if(ctx?.issuer)return validTokens(this.data.tokens?.[ctx.issuer]);return validTokens(this.data.lastTokens);}
  async saveTokens(tokens,ctx){if(!validTokens(tokens))throw new Error('OAuth token response returned no access_token.');const k=ctx?.issuer||tokens.issuer||'_default';this.data.tokens||={};this.data.tokens[k]=tokens;this.data.lastTokens=tokens;if(ctx?.issuer)this.data.lastIssuer=ctx.issuer;await this.save();}
  async redirectToAuthorization(url){openBrowser(url);}
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
