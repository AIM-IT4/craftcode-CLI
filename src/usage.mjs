import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_DIR } from './config.mjs';

const FILE = path.join(APP_DIR, 'usage.json');
const todayKey = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const monthKeyFor = (resetDay) => {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  const anchor = day >= resetDay ? new Date(y, m, resetDay) : new Date(y, m - 1, resetDay);
  return `${anchor.getFullYear()}-${String(anchor.getMonth()+1).padStart(2,'0')}-${String(resetDay).padStart(2,'0')}`;
};

export class UsageTracker {
  constructor(planTokens, resetDay) { this.planTokens = planTokens; this.resetDay = resetDay; this.state = null; this.session = 0; this.detail = { requests: 0, prompt: 0, completion: 0, cached: 0, ttfbMs: 0, totalMs: 0, timed: 0 }; }
  async load() {
    await fs.mkdir(APP_DIR, { recursive: true });
    let s = {};
    try { s = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch {}
    const period = monthKeyFor(this.resetDay);
    if (s.period !== period) s = { period, total: 0, daily: {}, byModel: {} };
    s.daily ||= {}; s.byModel ||= {}; s.total ||= 0;
    this.state = s;
    return this;
  }
  async add(usage = {}, model = 'unknown', timing = null) {
    const n = Number(usage.total_tokens || 0);
    const d = this.detail; d.requests += 1; d.prompt += Number(usage.prompt_tokens || 0); d.completion += Number(usage.completion_tokens || 0);
    d.cached += Number(usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0);
    if (timing?.totalMs) { d.timed += 1; d.ttfbMs += Number(timing.firstTokenMs ?? timing.ttfbMs ?? 0); d.totalMs += Number(timing.totalMs || 0); }
    if (!n) return;
    this.state.total += n; this.session += n;
    const day = todayKey(); this.state.daily[day] = (this.state.daily[day] || 0) + n;
    this.state.byModel[model] = (this.state.byModel[model] || 0) + n;
    await this.save();
  }
  async seed(n) { this.state.total += Number(n || 0); await this.save(); }
  async set(n) { this.state.total = Math.max(0, Number(n || 0)); await this.save(); }
  async save() { await fs.writeFile(FILE, JSON.stringify(this.state, null, 2) + '\n'); }
  snapshot() { return { ...this.state, session: this.session, plan: this.planTokens, remaining: Math.max(0, this.planTokens - this.state.total), detail: { ...this.detail } }; }
}
