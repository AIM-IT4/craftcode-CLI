import net from 'node:net';
import dns from 'node:dns/promises';
import {createRequire} from 'node:module';
const clip=(s,n)=>String(s??'').length>n?String(s).slice(0,n)+`\n… clipped ${String(s).length-n} chars`:String(s??'');
const UA='CraftCode/'+(()=>{try{return createRequire(import.meta.url)('../package.json').version;}catch{return '0';}})();
const v4=ip=>ip.split('.').map(Number);
export function isPrivateAddress(input){
  let ip=String(input).toLowerCase().replace(/^\[|\]$/g,'').split('%')[0];
  const mapped=ip.match(/^::ffff:(.+)$/);
  if(mapped){const rest=mapped[1];if(net.isIPv4(rest))ip=rest;else{const h=rest.split(':');if(h.length===2&&h.every(x=>/^[0-9a-f]{1,4}$/.test(x))){const a=parseInt(h[0],16),b=parseInt(h[1],16);ip=`${a>>8}.${a&255}.${b>>8}.${b&255}`;}}}
  if(net.isIPv4(ip)){
    const [a,b,c]=v4(ip);
    return a===0||a===10||a===127||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===192&&b===0&&c===0)||(a===198&&(b===18||b===19))||a>=224;
  }
  if(net.isIPv6(ip)){
    if(ip==='::'||ip==='::1')return true;
    const first=parseInt(ip.split(':')[0]||'0',16);
    return (first&0xfe00)===0xfc00||(first&0xffc0)===0xfe80||(first&0xff00)===0xff00;
  }
  return false;
}
function blockedName(h){return h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h==='metadata.google.internal';}
function safeUrl(input){
  const u=new URL(String(input));
  if(!['http:','https:'].includes(u.protocol))throw new Error('Only http/https URLs are allowed.');
  const h=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if(blockedName(h)||isPrivateAddress(h))throw new Error('Local/private network URLs are blocked.');
  return u;
}
async function assertPublicHost(u){
  const h=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if(net.isIP(h))return;
  let addrs;try{addrs=await dns.lookup(h,{all:true});}catch{return;}
  if(addrs.some(a=>isPrivateAddress(a.address)))throw new Error('Local/private network URLs are blocked.');
}
function htmlText(html){
  return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#39;/g,"'").replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim();
}
async function get(url,{maxChars=40000,accept='text/html, text/plain, application/json'}={}){
  let u=safeUrl(url),r;
  for(let hops=0;;hops++){
    await assertPublicHost(u);
    r=await fetch(u,{redirect:'manual',headers:{'user-agent':UA,'accept':accept}});
    const loc=r.status>=300&&r.status<400?r.headers.get('location'):null;
    if(!loc)break;
    if(hops>=5)throw new Error(`Too many redirects for ${url}`);
    u=safeUrl(new URL(loc,u));
  }
  if(!r.ok)throw new Error(`HTTP ${r.status} for ${u}`);
  const type=r.headers.get('content-type')||'',text=await r.text();
  return {url:r.url||u.href,contentType:type,text:clip(type.includes('html')?htmlText(text):text,maxChars)};
}
export async function fetchUrl(url,{maxChars=40000}={}){return get(url,{maxChars});}
export function parseGitHubRepoUrl(input){
  const u=safeUrl(input);if(u.hostname.toLowerCase()!=='github.com')throw new Error('inspect_repo_url currently supports public github.com repositories.');
  const parts=u.pathname.split('/').filter(Boolean);if(parts.length<2)throw new Error('Expected a GitHub repository URL like https://github.com/owner/repo');
  return {owner:parts[0],repo:parts[1].replace(/\.git$/,'')};
}
export async function inspectRepoUrl(input,{maxFiles=260,maxReadmeChars=30000}={}){
  const {owner,repo}=parseGitHubRepoUrl(input),headers={'user-agent':UA,'accept':'application/vnd.github+json'};
  const metaR=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,{headers});
  if(!metaR.ok)throw new Error(`GitHub repo lookup failed: HTTP ${metaR.status}`);
  const meta=await metaR.json(),branch=meta.default_branch||'main';
  const treeR=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,{headers});
  const tree=treeR.ok?await treeR.json():{tree:[]};
  let readme='';for(const name of ['README.md','readme.md','README.MD']){const r=await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${name}`,{headers:{'user-agent':UA}});if(r.ok){readme=clip(await r.text(),maxReadmeChars);break;}}
  return {repository:`${owner}/${repo}`,url:meta.html_url,description:meta.description||'',defaultBranch:branch,language:meta.language||'',stars:meta.stargazers_count||0,license:meta.license?.spdx_id||'',files:(tree.tree||[]).filter(x=>x.type==='blob').slice(0,maxFiles).map(x=>x.path),truncated:!!tree.truncated||(tree.tree||[]).length>maxFiles,readme};
}
export async function readRepoFile(input,filePath,{maxChars=60000}={}){
  const {owner,repo}=parseGitHubRepoUrl(input),headers={'user-agent':UA,'accept':'application/vnd.github+json'};
  const metaR=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,{headers});if(!metaR.ok)throw new Error(`GitHub repo lookup failed: HTTP ${metaR.status}`);
  const meta=await metaR.json(),branch=meta.default_branch||'main',u=`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${String(filePath).replace(/^\/+/, '')}`;
  return get(u,{maxChars,accept:'text/plain, application/json'});
}
