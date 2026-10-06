// Read-only Supabase access driven by credentials in a local .env file.
// The model never sees the key: it is read here, used for GET requests only, and scrubbed from any output.
import fs from 'node:fs/promises';
import path from 'node:path';
import { safePath } from './paths.mjs';

const URL_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_URL', 'REACT_APP_SUPABASE_URL'];
const SERVICE_KEYS = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SERVICE_ROLE_KEY'];
const ANON_KEYS = ['SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'PUBLIC_SUPABASE_ANON_KEY', 'REACT_APP_SUPABASE_ANON_KEY'];
const ENV_FILES = ['.env.local', '.env', '.env.development.local', '.env.development'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const FILTER_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in']);
const MAX_ROWS = 200;
const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|JWT|DATABASE_URL|DB_URL|CONNECTION)/i;

export function parseDotenv(text = '') {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

/** Show a .env file with secret-looking values masked so the model can see names, not keys. */
export function maskDotenv(text = '') {
  return String(text).split(/\r?\n/).map(line => {
    const m = line.match(/^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/);
    if (!m || !m[4].trim()) return line;
    if (!SECRET_NAME.test(m[2]) && !/^(eyJ|sb_secret_|sk-|ghp_)/.test(m[4].trim().replace(/^["']/, ''))) return line;
    const v = m[4].trim().replace(/^["']|["']$/g, '');
    return `${m[1]}${m[2]}${m[3]}${v.slice(0, 4)}…(${v.length} chars, hidden)`;
  }).join('\n');
}

export const isEnvFile = file => /^\.env(\..+)?$/.test(path.basename(String(file || ''))) && !/\.(example|sample|template)$/.test(String(file));

export function jwtRole(token = '') {
  try {
    const part = String(token).split('.')[1];
    if (!part) return '';
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role || '';
  } catch { return ''; }
}

export const keyRole = key => (/^sb_secret_/.test(key) ? 'service_role' : /^sb_publishable_/.test(key) ? 'anon' : jwtRole(key) || 'unknown');

export function allowedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return /^[a-z0-9-]+\.supabase\.(co|in|net)$/.test(h) || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

const pick = (env, names) => { for (const n of names) if (env[n]) return { name: n, value: env[n] }; return null; };

export async function loadSupabaseEnv(cwd, envFile = '') {
  const files = envFile ? [envFile] : ENV_FILES;
  const merged = {}, used = [];
  for (const rel of files.slice().reverse()) {
    let full;
    try { full = safePath(cwd, rel); } catch (e) { if (envFile) throw e; continue; }
    let text;
    try { text = await fs.readFile(full, 'utf8'); } catch { if (envFile) throw new Error(`Cannot read ${rel}`); continue; }
    Object.assign(merged, parseDotenv(text)); used.push(rel);
  }
  for (const [k, v] of Object.entries(process.env)) if (!(k in merged) && v && /SUPABASE/i.test(k)) merged[k] = v;
  const url = pick(merged, URL_KEYS), service = pick(merged, SERVICE_KEYS), anon = pick(merged, ANON_KEYS);
  return { url, service, anon, files: used.reverse() };
}

function scrub(text, secrets) {
  let out = String(text);
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join('[redacted]');
  return out;
}

const q = v => encodeURIComponent(String(v));

export function buildSelectQuery({ table, columns = '*', filters = [], order, limit = 20, offset = 0 } = {}) {
  if (!IDENT.test(String(table || ''))) throw new Error('Invalid table name.');
  const cols = String(columns || '*');
  if (cols !== '*' && !cols.split(',').every(c => IDENT.test(c.trim()))) throw new Error('columns must be * or a comma list of plain column names.');
  const params = [`select=${q(cols === '*' ? '*' : cols.split(',').map(c => c.trim()).join(','))}`];
  for (const f of filters || []) {
    if (!f || !IDENT.test(String(f.column || '')) || !FILTER_OPS.has(String(f.op))) throw new Error(`Invalid filter: ${JSON.stringify(f)}`);
    params.push(`${f.column}=${f.op}.${q(f.op === 'in' ? `(${[].concat(f.value).join(',')})` : f.value)}`);
  }
  if (order) {
    const m = String(order).match(/^([A-Za-z_][A-Za-z0-9_]{0,62})(?:\.(asc|desc))?$/);
    if (!m) throw new Error('order must look like "created_at.desc".');
    params.push(`order=${m[1]}.${m[2] || 'asc'}`);
  }
  params.push(`limit=${Math.min(MAX_ROWS, Math.max(1, Number(limit) || 20))}`, `offset=${Math.max(0, Number(offset) || 0)}`);
  return `/rest/v1/${table}?${params.join('&').replace(/%2C/gi, ',').replace(/%28/g, '(').replace(/%29/g, ')')}`;
}

/**
 * Run one read-only Supabase action. `permit` is asked before a service-role (RLS-bypassing) key is used.
 * actions: status | tables | select | count
 */
export async function supabaseQuery(cwd, args = {}, { permit = async () => true, fetchImpl = fetch, signal } = {}) {
  const action = String(args.action || 'status');
  const env = await loadSupabaseEnv(cwd, args.env_file);
  const secrets = [env.service?.value, env.anon?.value];
  if (action === 'status') {
    return JSON.stringify({
      env_files: env.files,
      url: env.url?.value || null, url_var: env.url?.name || null,
      service_key: env.service ? { var: env.service.name, role: keyRole(env.service.value) } : null,
      anon_key: env.anon ? { var: env.anon.name, role: keyRole(env.anon.value) } : null,
      note: 'Key values are never shown. Use access:"service" to bypass RLS (asks first) or access:"anon" to see what a client sees.'
    }, null, 2);
  }
  if (!env.url) throw new Error(`No Supabase URL found in ${env.files.join(', ') || '.env files'} (looked for ${URL_KEYS.slice(0, 3).join(', ')}…).`);
  let base;
  try { base = new URL(env.url.value); } catch { throw new Error('Supabase URL in .env is not a valid URL.'); }
  if (!allowedHost(base.hostname)) throw new Error(`Refusing to send credentials to ${base.hostname}; only *.supabase.co and localhost are allowed.`);
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(base.hostname)) throw new Error('Supabase URL must use https.');
  const access = args.access === 'anon' ? 'anon' : 'service';
  const chosen = access === 'service' ? (env.service || null) : (env.anon || null);
  if (!chosen) throw new Error(access === 'service' ? 'No service-role key found in .env (SUPABASE_SERVICE_ROLE_KEY). Try access:"anon".' : 'No anon/publishable key found in .env.');
  if (access === 'service' && !await permit(`Use the service-role key from ${env.files.join(', ')} to READ ${args.table ? `table "${args.table}"` : 'your Supabase tables'}, bypassing RLS`)) return 'Denied by user';

  const headers = { apikey: chosen.value, Accept: 'application/json' };
  // New-format keys (sb_*) are not JWTs and must not be sent as a bearer token.
  if (!/^sb_/.test(chosen.value)) headers.Authorization = `Bearer ${chosen.value}`;
  const root = base.origin;
  const get = async (p, extra = {}) => {
    const res = await fetchImpl(root + p, { method: 'GET', headers: { ...headers, ...extra }, signal, redirect: 'error' });
    const text = await res.text();
    if (!res.ok) throw new Error(scrub(`Supabase ${res.status}: ${text.slice(0, 600)}`, secrets));
    return { res, text };
  };

  if (action === 'tables') {
    const { text } = await get('/rest/v1/');
    let spec; try { spec = JSON.parse(text); } catch { throw new Error('Unexpected response listing tables.'); }
    const tables = Object.entries(spec.definitions || {}).map(([name, d]) => `${name}(${Object.keys(d.properties || {}).join(', ')})`);
    return scrub(`${tables.length} exposed table(s)/view(s):\n${tables.join('\n')}`.slice(0, 20000), secrets);
  }
  if (action === 'count') {
    const p = buildSelectQuery({ table: args.table, filters: args.filters, limit: 1 });
    const { res } = await get(p, { Prefer: 'count=exact', Range: '0-0' });
    return `${args.table}: ${(res.headers.get('content-range') || '').split('/')[1] || 'unknown'} rows (as ${access === 'service' ? 'service_role, RLS bypassed' : 'anon, RLS applied'})`;
  }
  if (action === 'select') {
    const p = buildSelectQuery(args);
    const { text } = await get(p);
    let rows; try { rows = JSON.parse(text); } catch { rows = null; }
    const shown = Array.isArray(rows) ? `${rows.length} row(s) from ${args.table} (as ${access === 'service' ? 'service_role, RLS bypassed' : 'anon, RLS applied'}):\n${JSON.stringify(rows, null, 1)}` : text;
    return scrub(shown.length > 40000 ? `${shown.slice(0, 40000)}\n… clipped` : shown, secrets);
  }
  throw new Error(`Unknown action "${action}". Use status, tables, select or count.`);
}
