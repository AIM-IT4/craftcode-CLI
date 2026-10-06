import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const APP_DIR = path.join(os.homedir(), '.craftcli');
export const GLOBAL_CONFIG = path.join(APP_DIR, 'config.json');

const defaults = {
  configVersion: 21,
  provider: process.env.CRAFTCODE_PROVIDER || 'codecraft',
  baseUrl: 'https://codecraftapi.com/v1',
  model: process.env.CODECRAFT_MODEL || '',
  providers: {
    codecraft: { type: 'codecraft', baseUrl: 'https://codecraftapi.com/v1', apiKeyEnv: 'CODECRAFT_API_KEY' },
    openrouter: { type: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', appUrl: 'https://github.com/AIM-IT4/craftcode-CLI', appName: 'Craft Code' }
  },
  // "auto" infers the CodeCraft tier from X-RateLimit-Limit. Set a number to override.
  planTokens: 'auto',
  resetDay: 4,
  defaultMode: 'build',
  defaultEffort: 'high',
  maxAgentSteps: 20,
  maxTurnSegments: 3,
  maxOutputTokens: 8192,
  autoCompactChars: 'auto',
  agentRuntime: {
    parallelTools: true,
    loopGuardRepeats: 3,
    autoVerifyEdits: true,
    autoBrowserVerify: true
  },
  skills: {
    autoLoad: true,
    maxAutoSkills: 2,
    autoLoadMaxTokens: 8000,
    minAutoScore: 2
  },
  efficiency: {
    enabled: true,
    requestContext: {
      recentToolResults: 6,
      oldToolChars: 2200
    },
    toolResults: {
      runCommandChars: 9000,
      readChars: 28000,
      searchChars: 12000,
      browserChars: 14000,
      genericChars: 14000
    },
    outputBudgets: {
      tiny: 2048,
      normal: 4096,
      deep: 6144,
      plan: 3072,
      low: 2560
    },
    maxPatchChars: 120000,
    maxSubagentResultChars: 7000
  },
  tokenGuard: {
    enabled: true,
    warnRequestTokens: 500_000,
    hardRequestTokens: 1_500_000,
    maxReadChars: 80_000,
    maxSearchChars: 30_000,
    maxCommandChars: 40_000
  },
  permissions: {
    write: 'ask',
    shell: 'ask',
    mcp: 'ask'
  },
  shell: {
    sandbox: 'host',
    dockerImage: 'node:20-bookworm-slim'
  },
  processes: {
    maxBufferChars: 60000,
    maxProcesses: 8
  },
  cache: {
    maxEntries: 250,
    remoteTtlMs: 300000
  },
  ignore: ['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.cache'],
  mcpServers: {},
  activePlugins: [],
  agents: {
    enabled: true,
    maxParallel: 4,
    defaultBudgetTokens: 120000,
    maxSteps: 8,
    maxOrchestrationTasks: 6,
    keepWorktrees: false
  },
  flightRecorder: {
    enabled: true,
    maxRuns: 120
  },
  proof: {
    enabled: true
  },
  arena: {
    defaultCandidates: 2,
    maxCandidates: 4,
    useOtherProvidersByDefault: false
  },
  claudePlugins: {
    enabled: true,
    allowHooks: false
  },
  sessions: {
    autoResume: false,
    autosave: true
  },
  ui: {
    style: 'claude',
    plushie: 'auto'
  },
  instructions: {
    files: ['AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'],
    maxChars: 12000
  },
  connectorCatalog: {
    supabase: { type: 'http', url: 'https://mcp.supabase.com/mcp', oauth: true, authMode: 'browser', requirement: 'browser approval via Supabase dynamic OAuth registration', authHint: 'Supabase hosted MCP uses browser OAuth with dynamic client registration; Craft Code does not require a PAT or manually entered client ID.' },
    vercel: { type: 'cli', command: 'npx', browserOAuth: true, authMode: 'browser', requirement: 'browser approval opens automatically', authHint: 'Craft Code launches Vercel OAuth device approval through npx -y vercel@latest; no global Vercel CLI install is required.' },
    github: {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      tokenEnv: 'GITHUB_TOKEN',
      tokenCommand: ['gh','auth','token'],
      tokenRequired: true,
      authMode: 'token',
      authHint: 'use an existing GitHub credential: run gh auth login once (recommended) or set GITHUB_TOKEN, then retry /connect github.'
    },
    playwright: {
      type: 'stdio',
      command: 'npx',
      args: ['-y','@playwright/mcp@latest'],
      authMode: 'local',
      requirement: 'Chromium downloads automatically on first use'
    }
  }
};

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return {}; }
}
function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}
export function migrateLegacyConfig(x={}) {
  const y={...x};
  // v0.5 wrote 100M as a generated default. It was not account-derived.
  if (!y.configVersion && y.planTokens === 100_000_000) delete y.planTokens;
  // <=0.14.11 generated 300k chars (~75k tokens) as a default, which prematurely compacted large-context models.
  if(Number(y.configVersion||0)<=20&&y.autoCompactChars===300_000)y.autoCompactChars='auto';
  if(y.baseUrl&&!y.providers?.codecraft?.baseUrl)y.providers={...(y.providers||{}),codecraft:{...(y.providers?.codecraft||{}),type:'codecraft',baseUrl:y.baseUrl}};
  return y;
}
export async function loadConfig(cwd) {
  await fs.mkdir(APP_DIR, { recursive: true });
  const projectPath = path.join(cwd, '.craftcli', 'config.json');
  const global = migrateLegacyConfig(await readJson(GLOBAL_CONFIG));
  const project = migrateLegacyConfig(await readJson(projectPath));
  return deepMerge(deepMerge(defaults, global), project);
}
export async function writeStarterConfig() {
  await fs.mkdir(APP_DIR, { recursive: true });
  try { await fs.access(GLOBAL_CONFIG); return GLOBAL_CONFIG; } catch {}
  await fs.writeFile(GLOBAL_CONFIG, JSON.stringify(defaults, null, 2) + '\n');
  return GLOBAL_CONFIG;
}
export async function persistPermissionDecision(cwd,config,kind,decision){
  if(!['write','shell','mcp'].includes(kind))throw new Error(`Unsupported permission kind: ${kind}`);
  if(!['allow','ask','deny'].includes(decision))throw new Error(`Unsupported permission decision: ${decision}`);
  config.permissions=config.permissions||{};
  config.permissions[kind]=decision;
  await updateProjectConfig(cwd,{permissions:{[kind]:decision}});
  return decision;
}

export async function updateGlobalConfig(patch={}) {
  await fs.mkdir(APP_DIR,{recursive:true});
  const current=await readJson(GLOBAL_CONFIG);
  const next=deepMerge(current,patch);
  await fs.writeFile(GLOBAL_CONFIG,JSON.stringify(next,null,2)+'\n');
  return next;
}
export async function updateProjectConfig(cwd,patch={}) {
  const dir=path.join(cwd,'.craftcli'),file=path.join(dir,'config.json');
  await fs.mkdir(dir,{recursive:true});
  const current=await readJson(file),next=deepMerge(current,patch);
  await fs.writeFile(file,JSON.stringify(next,null,2)+'\n');
  return file;
}

export function expandEnv(value) {
  if (typeof value === 'string') return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, n) => process.env[n] ?? '');
  if (Array.isArray(value)) return value.map(expandEnv);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, expandEnv(v)]));
  return value;
}

export function parseTokenAmount(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.round(v));
  const s=String(v??'').trim().toLowerCase();
  const m=s.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmb])?$/);
  if(!m)return null;
  const mult=m[2]==='b'?1e9:m[2]==='m'?1e6:m[2]==='k'?1e3:1;
  return Math.max(0,Math.round(Number(m[1])*mult));
}

export function resolvePlanTokens(config, planHint) {
  const env=parseTokenAmount(process.env.CODECRAFT_PLAN_TOKENS);
  if(env)return {tokens:env,source:'env'};
  const explicit=parseTokenAmount(config.planTokens);
  if(config.planTokens!=='auto'&&explicit)return {tokens:explicit,source:'config'};
  if(planHint?.tokens===Infinity)return {tokens:Infinity,source:'rate-limit'};
  if(planHint?.tokens)return {tokens:planHint.tokens,source:'rate-limit'};
  // Safer than overstating remaining allowance. Starter is CodeCraft's first paid tier.
  return {tokens:30_000_000,source:'fallback'};
}


export function normalizeProviderConfig(config={}){
  const provider=String(config.provider||process.env.CRAFTCODE_PROVIDER||'codecraft').trim()||'codecraft';
  const providers={
    codecraft:{type:'codecraft',baseUrl:'https://codecraftapi.com/v1',apiKeyEnv:'CODECRAFT_API_KEY'},
    openrouter:{type:'openrouter',baseUrl:'https://openrouter.ai/api/v1',apiKeyEnv:'OPENROUTER_API_KEY',appUrl:'https://github.com/AIM-IT4/craftcode-CLI',appName:'Craft Code'},
    ...(config.providers||{})
  };
  if(config.baseUrl&&!config.providers?.codecraft?.baseUrl)providers.codecraft={...providers.codecraft,baseUrl:config.baseUrl};
  return{...config,provider,providers,model:config.model||''};
}


export function providerLoginPatch(providerArg,providerId){
  return String(providerArg||'').trim()?{provider:String(providerId||'').trim()}:null;
}
