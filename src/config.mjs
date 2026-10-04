import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const APP_DIR = path.join(os.homedir(), '.craftcli');
export const GLOBAL_CONFIG = path.join(APP_DIR, 'config.json');

const defaults = {
  configVersion: 11,
  baseUrl: 'https://codecraftapi.com/v1',
  model: process.env.CODECRAFT_MODEL || '',
  // "auto" infers the CodeCraft tier from X-RateLimit-Limit. Set a number to override.
  planTokens: 'auto',
  resetDay: 4,
  defaultMode: 'build',
  defaultEffort: 'high',
  maxAgentSteps: 20,
  maxOutputTokens: 8192,
  autoCompactChars: 500_000,
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
  ignore: ['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.cache'],
  mcpServers: {},
  activePlugins: [],
  agents: {
    enabled: true,
    maxParallel: 4,
    defaultBudgetTokens: 250000,
    maxSteps: 10,
    keepWorktrees: false
  },
  claudePlugins: {
    enabled: true,
    allowHooks: false
  },
  sessions: {
    autoResume: false,
    autosave: true
  },
  instructions: {
    files: ['AGENTS.md','CLAUDE.md','.github/copilot-instructions.md'],
    maxChars: 12000
  },
  connectorCatalog: {
    supabase: { type: 'http', url: 'https://mcp.supabase.com/mcp', oauth: true },
    vercel: { type: 'cli', command: 'vercel', requirement: 'Vercel CLI device login', authHint: 'Craft Code uses Vercel CLI authentication because Vercel MCP OAuth only accepts approved clients.' },
    github: {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      tokenEnv: 'GITHUB_TOKEN',
      tokenCommand: ['gh','auth','token'],
      tokenRequired: true,
      authHint: 'use an existing GitHub credential: run gh auth login once (recommended) or set GITHUB_TOKEN, then retry /connect github.'
    },
    playwright: {
      type: 'stdio',
      command: 'npx',
      args: ['-y','@playwright/mcp@latest'],
      requirement: 'Node.js; Chromium downloads automatically on first use'
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
function migrateLegacyConfig(x={}) {
  const y={...x};
  // v0.5 wrote 100M as a generated default. It was not account-derived.
  if (!y.configVersion && y.planTokens === 100_000_000) delete y.planTokens;
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
