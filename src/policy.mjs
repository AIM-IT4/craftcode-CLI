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


const DESTRUCTIVE_ASK=[
  {re:/\brm\s+-[^\s]*(?:r[^\s]*f|f[^\s]*r)[^\s]*/i,kind:'destructive',reason:'recursive forced deletion requires explicit approval'},
  {re:/\bRemove-Item\b(?=[^\n;&|]*-Recurse)(?=[^\n;&|]*-Force)/i,kind:'destructive',reason:'recursive forced deletion requires explicit approval'},
  {re:/\bfind\b[^\n;&|]*\s-delete\b/i,kind:'destructive',reason:'bulk deletion requires explicit approval'},
  {re:/\b(?:shred|truncate)\b/i,kind:'destructive',reason:'destructive file mutation requires explicit approval'}
];

const OPAQUE_EXECUTION=[
  {re:/\bnode(?:\.exe)?\s+(?:-e|--eval|-p|--print|--test\b|[^\s]+\.(?:js|mjs|cjs)\b)/i,kind:'opaque',reason:'Node can execute arbitrary project or inline code'},
  {re:/\b(?:python|python3|py)(?:\.exe)?\s+(?:-c|-m\s+|[^\s]+\.py\b)/i,kind:'opaque',reason:'Python can execute arbitrary project or inline code'},
  {re:/\b(?:ruby)(?:\.exe)?\s+(?:-e\b|[^\s]+\.rb\b)/i,kind:'opaque',reason:'Ruby can execute arbitrary project or inline code'},
  {re:/\b(?:perl)(?:\.exe)?\s+(?:-e\b|[^\s]+\.pl\b)/i,kind:'opaque',reason:'Perl can execute arbitrary project or inline code'},
  {re:/\b(?:php)(?:\.exe)?\s+(?:-r\b|[^\s]+\.php\b)/i,kind:'opaque',reason:'PHP can execute arbitrary project or inline code'},
  {re:/\bbun(?:\.exe)?\s+(?:-e|--eval)\b/i,kind:'opaque',reason:'Bun can execute arbitrary inline code'},
  {re:/\bdeno(?:\.exe)?\s+eval\b/i,kind:'opaque',reason:'Deno can execute arbitrary inline code'},
  {re:/\b(?:bash|sh|zsh)\s+-[^\s]*c\b/i,kind:'opaque',reason:'nested shell execution requires explicit approval'},
  {re:/\b(?:powershell|pwsh)(?:\.exe)?\b[^\n;&|]*(?:-Command|-EncodedCommand)\b/i,kind:'opaque',reason:'PowerShell command execution requires explicit approval'},
  {re:/\bcmd(?:\.exe)?\s+\/(?:c|k)\b/i,kind:'opaque',reason:'nested cmd execution requires explicit approval'}
];

const PROJECT_EXECUTION=[
  {re:/\bnpm\s+(?:test|start|run)\b/i,kind:'project-code',reason:'npm scripts execute repository-controlled code'},
  {re:/\bpnpm\s+(?:test|start|run|exec)\b/i,kind:'project-code',reason:'pnpm scripts execute repository-controlled code'},
  {re:/\byarn\s+(?:test|start|run)\b/i,kind:'project-code',reason:'yarn scripts execute repository-controlled code'},
  {re:/\b(?:npx|bunx)\b/i,kind:'project-code',reason:'package runners can execute repository or downloaded code'},
  {re:/\bbun\s+(?:run|test)\b/i,kind:'project-code',reason:'Bun can execute repository-controlled code'},
  {re:/\bdeno\s+(?:run|test)\b/i,kind:'project-code',reason:'Deno can execute repository-controlled code'},
  {re:/\b(?:cargo\s+(?:test|run|build)|go\s+(?:test|run)|pytest\b|jest\b|vitest\b|mocha\b)/i,kind:'project-code',reason:'verification commands execute repository-controlled code'}
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
    for(const x of DESTRUCTIVE_ASK)if(x.re.test(c))return{decision:'ask',kind:x.kind,reason:x.reason};
    for(const x of OPAQUE_EXECUTION)if(x.re.test(c))return{decision:'ask',kind:x.kind,reason:x.reason};
    if(this.sandbox!=='docker')for(const x of PROJECT_EXECUTION)if(x.re.test(c))return{decision:'ask',kind:x.kind,reason:x.reason};
    return{decision:'allow',kind:'local',reason:'local command within the configured shell permission'};
  }
  wrap(command){
    const c=String(command||'');
    if(this.sandbox==='docker'){
      const mount=`${this.cwd}:/workspace:ro`;
      return{exe:'docker',args:['run','--rm','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=256m','-v',mount,'-w','/workspace',this.dockerImage,'sh','-lc',c],cwd:this.cwd,sandbox:'docker'};
    }
    if(process.platform==='win32')return{exe:'cmd',args:['/d','/s','/c',c],cwd:this.cwd,sandbox:'host'};
    return{exe:'bash',args:['-lc',c],cwd:this.cwd,sandbox:'host'};
  }
}
