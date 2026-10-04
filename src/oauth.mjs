import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {APP_DIR} from './config.mjs';
const AUTH_DIR=path.join(APP_DIR,'oauth');
const safe=s=>String(s||'server').replace(/[^a-zA-Z0-9._-]+/g,'-');
function openBrowser(url){const u=String(url);if(process.platform==='win32')execFile('cmd',['/c','start','',u],{windowsHide:true});else if(process.platform==='darwin')execFile('open',[u]);else execFile('xdg-open',[u]);}
export class PersistentOAuthProvider{
  constructor(name){this.name=name;this.file=path.join(AUTH_DIR,`${safe(name)}.json`);this.data={};this.server=null;this.callbackUrl='';this._wait=null;this._pending=null;this.lastState='';}
  async load(){await fs.mkdir(AUTH_DIR,{recursive:true});try{this.data=JSON.parse(await fs.readFile(this.file,'utf8'));}catch{this.data={};}this.lastState=this.data.oauthState||'';return this;}
  async save(){await fs.mkdir(AUTH_DIR,{recursive:true});await fs.writeFile(this.file,JSON.stringify(this.data,null,2)+'\n',{mode:0o600});}
  async startCallback(){if(this.server)return;await new Promise((resolve,reject)=>{const srv=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');if(u.pathname!=='/oauth/callback'){res.writeHead(404);res.end('Not found');return;}const code=u.searchParams.get('code'),err=u.searchParams.get('error'),iss=u.searchParams.get('iss'),state=u.searchParams.get('state');res.writeHead(code?200:400,{'content-type':'text/html'});res.end(`<html><body style="font-family:system-ui;background:#111;color:#eee;padding:40px"><h2>${code?'Craft Code connected':'Authorization failed'}</h2><p>${code?'You can close this browser tab and return to Craft Code.':(err||'No authorization code returned.')}</p></body></html>`);const payload=code?{code,iss,state,params:new URLSearchParams(u.searchParams)}:{error:err||'OAuth failed',state,params:new URLSearchParams(u.searchParams)};if(this._wait){const w=this._wait;this._wait=null;payload.error?w.reject(new Error(payload.error)):w.resolve(payload);}else this._pending=payload;});srv.on('error',reject);srv.listen(0,'127.0.0.1',()=>{this.server=srv;const a=srv.address();this.callbackUrl=`http://127.0.0.1:${a.port}/oauth/callback`;resolve();});});}
  async waitForCode(timeoutMs=300000){if(this._pending){const p=this._pending;this._pending=null;if(p.error)throw new Error(p.error);this.validateState(p.state);return p;}return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this._wait=null;reject(new Error('OAuth login timed out.'));},timeoutMs);this._wait={resolve:x=>{clearTimeout(timer);try{this.validateState(x.state);resolve(x);}catch(e){reject(e);}},reject:e=>{clearTimeout(timer);reject(e);}};});}
  validateState(received){if(!this.lastState||!received||received!==this.lastState)throw new Error('OAuth state mismatch. Authorization was cancelled for safety; retry /connect.');this.data.oauthState='';this.lastState='';}
  async close(){if(this.server)await new Promise(r=>this.server.close(()=>r()));this.server=null;}
  get redirectUrl(){return this.callbackUrl;}
  get clientMetadata(){return{redirect_uris:[this.callbackUrl],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],client_name:'Craft Code',client_uri:'https://github.com/AIM-IT4/craftcode-CLI'};}
  async state(){const value=crypto.randomBytes(24).toString('base64url');this.lastState=value;this.data.oauthState=value;await this.save();return value;}
  async clientInformation(ctx){const k=ctx?.issuer||'_default';return this.data.clients?.[k]||this.data.client||undefined;}
  async saveClientInformation(info,ctx){this.data.clients||={};this.data.clients[ctx?.issuer||'_default']=info;this.data.client=info;await this.save();}
  async tokens(ctx){const k=ctx?.issuer||this.data.lastIssuer||'_default';return this.data.tokens?.[k]||this.data.lastTokens||undefined;}
  async saveTokens(tokens,ctx){const k=ctx?.issuer||'_default';this.data.tokens||={};this.data.tokens[k]=tokens;this.data.lastTokens=tokens;if(ctx?.issuer)this.data.lastIssuer=ctx.issuer;await this.save();}
  async redirectToAuthorization(url){openBrowser(url);}
  async saveCodeVerifier(v){this.data.codeVerifier=v;await this.save();}
  async codeVerifier(){return this.data.codeVerifier||'';}
  async saveDiscoveryState(v){this.data.discoveryState=v;await this.save();}
  async discoveryState(){return this.data.discoveryState||undefined;}
  async clear(){this.data={};this.lastState='';try{await fs.rm(this.file,{force:true});}catch{}}
}
