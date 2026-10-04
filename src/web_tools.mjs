const clip=(s,n)=>String(s??'').length>n?String(s).slice(0,n)+`\n… clipped ${String(s).length-n} chars`:String(s??'');
function safeUrl(input){
  const u=new URL(String(input));
  if(!['http:','https:'].includes(u.protocol))throw new Error('Only http/https URLs are allowed.');
  const h=u.hostname.toLowerCase();
  if(h==='localhost'||h==='::1'||h==='0.0.0.0'||h.startsWith('127.')||h.startsWith('10.')||h.startsWith('192.168.')||/^172\.(1[6-9]|2\d|3[01])\./.test(h))throw new Error('Local/private network URLs are blocked.');
  return u;
}
function htmlText(html){
  return String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#39;/g,"'").replace(/&quot;/gi,'"').replace(/\s+/g,' ').trim();
}
async function get(url,{maxChars=40000,accept='text/html, text/plain, application/json'}={}){
  const u=safeUrl(url),r=await fetch(u,{redirect:'follow',headers:{'user-agent':'CraftCode/0.9.3','accept':accept}});
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
  const {owner,repo}=parseGitHubRepoUrl(input),headers={'user-agent':'CraftCode/0.9.3','accept':'application/vnd.github+json'};
  const metaR=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,{headers});
  if(!metaR.ok)throw new Error(`GitHub repo lookup failed: HTTP ${metaR.status}`);
  const meta=await metaR.json(),branch=meta.default_branch||'main';
  const treeR=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,{headers});
  const tree=treeR.ok?await treeR.json():{tree:[]};
  let readme='';for(const name of ['README.md','readme.md','README.MD']){const r=await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${name}`,{headers:{'user-agent':'CraftCode/0.9.3'}});if(r.ok){readme=clip(await r.text(),maxReadmeChars);break;}}
  return {repository:`${owner}/${repo}`,url:meta.html_url,description:meta.description||'',defaultBranch:branch,language:meta.language||'',stars:meta.stargazers_count||0,license:meta.license?.spdx_id||'',files:(tree.tree||[]).filter(x=>x.type==='blob').slice(0,maxFiles).map(x=>x.path),truncated:!!tree.truncated||(tree.tree||[]).length>maxFiles,readme};
}
export async function readRepoFile(input,filePath,{maxChars=60000}={}){
  const {owner,repo}=parseGitHubRepoUrl(input),headers={'user-agent':'CraftCode/0.9.3','accept':'application/vnd.github+json'};
  const metaR=await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,{headers});if(!metaR.ok)throw new Error(`GitHub repo lookup failed: HTTP ${metaR.status}`);
  const meta=await metaR.json(),branch=meta.default_branch||'main',u=`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${String(filePath).replace(/^\/+/, '')}`;
  return get(u,{maxChars,accept:'text/plain, application/json'});
}
