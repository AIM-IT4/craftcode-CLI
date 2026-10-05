import path from 'node:path';

const DANGEROUS=[
  {re:/\bgit\s+clean\b[^\n;&|]*\s-(?=[^\s]*f)(?=[^\s]*d)[^\s]*/i,reason:'git clean with force+directory flags can delete untracked workspace data'},
  {re:/\bgit\s+reset\s+--hard\b/i,reason:'git reset --hard can destroy uncommitted changes'},
  {re:/\b(?:shutdown|reboot|halt|poweroff)\b/i,reason:'system power commands are not allowed'},
  {re:/\b(?:mkfs(?:\.[a-z0-9]+)?|fdisk|parted)\b/i,reason:'disk formatting/partitioning commands are not allowed'},
  {re:/\bdd\b[^\n;&|]*\bof=\s*\/dev\//i,reason:'raw device writes are not allowed'},
  {re:/\brm\s+-[^\s]*(?:r[^\s]*f|f[^\s]*r)[^\s]*\s+(?:\/|~(?:\/|\s|$)|\.\.?\/?(?:\s|$)|\*\s*$)/i,reason:'recursive forced deletion of a broad/root path is not allowed'},
  {re:/\bRemove-Item\b(?=[^\n;&|]*-Recurse)(?=[^\n;&|]*-Force)[^\n;&|]*(?:[A-Za-z]:\\(?:\s|$)|[A-Za-z]:\\\\(?:\s|$))/i,reason:'recursive forced deletion of a drive root is not allowed'},
  {re:/\bformat(?:\.com)?\s+[A-Za-z]:/i,reason:'drive formatting is not allowed'}
];

const EXTERNAL=[
  {re:/\bgit\s+push\b/i,kind:'push',reason:'git push changes a remote repository'},
  {re:/\bnpm\s+(?:publish|unpublish|deprecate)\b/i,kind:'publish',reason:'npm publication changes a public/remote package registry'},
  {re:/\b(?:npm\s+(?:install|i)(?:\s|$)|pnpm\s+(?:add|install)\b|yarn\s+(?:add|install)\b)/i,kind:'network',reason:'dependency installation may contact the network and modify the workspace'},
  {re:/\b(?:curl|wget)\b/i,kind:'network',reason:'network transfer requires explicit approval'},
  {re:/\b(?:ssh|scp|sftp|rsync)\b/i,kind:'network',reason:'remote host access requires explicit approval'},
  {re:/\b(?:vercel|railway|flyctl|heroku)\b/i,kind:'deploy',reason:'deployment commands may change remote infrastructure'},
  {re:/\bdocker\s+(?:push|login)\b/i,kind:'publish',reason:'Docker registry mutation/authentication requires explicit approval'},
  {re:/\bkubectl\s+(?:apply|delete|patch|replace|scale|rollout)\b/i,kind:'deploy',reason:'cluster mutation requires explicit approval'},
  {re:/\bterraform\s+(?:apply|destroy|import)\b/i,kind:'deploy',reason:'infrastructure mutation requires explicit approval'},
  {re:/\bgh\s+(?:release\s+create|pr\s+merge|repo\s+delete)\b/i,kind:'publish',reason:'GitHub mutation requires explicit approval'}
];

export class CommandPolicy{
  constructor({cwd=process.cwd(),sandbox='host',dockerImage='node:20-bookworm-slim'}={}){
    this.cwd=path.resolve(cwd);this.sandbox=sandbox||'host';this.dockerImage=dockerImage||'node:20-bookworm-slim';
  }
  evaluate(command){
    const c=String(command||'').trim();
    if(!c)return{decision:'deny',kind:'invalid',reason:'empty command'};
    for(const x of DANGEROUS)if(x.re.test(c))return{decision:'deny',kind:'dangerous',reason:x.reason};
    for(const x of EXTERNAL)if(x.re.test(c))return{decision:'ask',kind:x.kind,reason:x.reason};
    return{decision:'allow',kind:'local',reason:'local command within the configured shell permission'};
  }
  wrap(command){
    const c=String(command||'');
    if(this.sandbox==='docker'){
      const mount=`${this.cwd}:/workspace`;
      return{exe:'docker',args:['run','--rm','--network','none','-v',mount,'-w','/workspace',this.dockerImage,'sh','-lc',c],cwd:this.cwd,sandbox:'docker'};
    }
    if(process.platform==='win32')return{exe:'cmd',args:['/d','/s','/c',c],cwd:this.cwd,sandbox:'host'};
    return{exe:'bash',args:['-lc',c],cwd:this.cwd,sandbox:'host'};
  }
}
