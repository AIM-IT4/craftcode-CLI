import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';

export const AUTH_DIR = path.join(os.homedir(), '.craftcli');
export const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');

async function readAuth() {
  try {
    const raw = JSON.parse(await fs.readFile(AUTH_FILE, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export async function resolveApiKey() {
  const env = String(process.env.CODECRAFT_API_KEY || '').trim().replace(/^['"]|['"]$/g, '');
  if (env) return { key: env, source: 'environment' };
  const auth = await readAuth();
  const key = String(auth.codecraftApiKey || '').trim();
  return key ? { key, source: 'stored' } : { key: '', source: 'none' };
}

export async function saveApiKey(key) {
  const clean = String(key || '').trim().replace(/^['"]|['"]$/g, '');
  if (!clean) throw new Error('API key is empty.');
  await fs.mkdir(AUTH_DIR, { recursive: true, mode: 0o700 });
  const next = { ...(await readAuth()), codecraftApiKey: clean, updatedAt: new Date().toISOString() };
  await fs.writeFile(AUTH_FILE, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  try { await fs.chmod(AUTH_FILE, 0o600); } catch {}
  return AUTH_FILE;
}

export async function clearApiKey() {
  const auth = await readAuth();
  delete auth.codecraftApiKey;
  if (!Object.keys(auth).filter(k => k !== 'updatedAt').length) {
    try { await fs.unlink(AUTH_FILE); } catch {}
    return;
  }
  auth.updatedAt = new Date().toISOString();
  await fs.writeFile(AUTH_FILE, JSON.stringify(auth, null, 2) + '\n', { mode: 0o600 });
  try { await fs.chmod(AUTH_FILE, 0o600); } catch {}
}

export function maskKey(key) {
  const x = String(key || '');
  if (!x) return 'not configured';
  if (x.length <= 8) return '••••';
  return `${x.slice(0, 3)}${'•'.repeat(Math.min(12, x.length - 7))}${x.slice(-4)}`;
}

export async function promptSecret(label='CodeCraft API key') {
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await rl.question(`${label}: `)).trim(); } finally { rl.close(); }
  }
  return new Promise((resolve, reject) => {
    let value = '';
    const stdin = process.stdin;
    const cleanup = () => {
      stdin.off('data', onData);
      try { stdin.setRawMode(false); } catch {}
      stdin.pause();
    };
    const onData = chunk => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '\u0003') { cleanup(); process.stdout.write('\n'); reject(new Error('Cancelled.')); return; }
        if (ch === '\r' || ch === '\n') { cleanup(); process.stdout.write('\n'); resolve(value.trim()); return; }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        if (ch >= ' ') { value += ch; process.stdout.write('•'); }
      }
    };
    process.stdout.write(`${label}: `);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.setRawMode(true);
    stdin.on('data', onData);
  });
}
