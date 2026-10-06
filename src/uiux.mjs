// Pure UI/UX helpers for the terminal UI. Kept free of terminal I/O so they are easy to unit test.

export const SLOW_FIRST_TOKEN_SECONDS = 5;

/** Describe what the agent is waiting on, so a long pause is never anonymous. */
export function phaseLabel(phase = {}, now = Date.now()) {
  const secs = Math.max(0, (now - (phase.since || now)) / 1000);
  const s = Math.floor(secs);
  if (phase.kind === 'tool') return `running ${phase.tool || 'tool'} · ${s}s`;
  if (phase.kind === 'streaming') return 'writing the answer';
  let out = `waiting for model · ${s}s`;
  if (secs >= SLOW_FIRST_TOKEN_SECONDS) out += ' · slow? try /effort low or /compact';
  else if (secs >= 3) out += ' · Esc to stop';
  return out;
}

/** Decide whether to ring the terminal bell when a turn finishes. */
export function shouldNotify({ mode = 'auto', focused = true, focusKnown = false, seconds = 0, minSeconds = 10, unknownFocusMinSeconds = 30 } = {}) {
  if (mode === 'off') return false;
  if (mode === 'always') return seconds >= minSeconds;
  if (focusKnown) return !focused && seconds >= minSeconds;
  // The terminal never reported focus changes, so be conservative and only ping for long turns.
  return seconds >= unknownFocusMinSeconds;
}

export function titleFor({ workspace = '', state = 'idle' } = {}) {
  const base = workspace ? `Craft Code · ${workspace}` : 'Craft Code';
  if (state === 'working') return `⏳ ${base}`;
  if (state === 'done') return `✓ ${base}`;
  return base;
}

const fmtN = n => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.max(0, Math.round(n))));

/** One dim line summarising a finished turn, from usage-detail snapshots taken before and after it. */
export function turnSummary({ before = {}, after = {}, seconds = 0, tools = 0 } = {}) {
  const d = k => Math.max(0, Number(after[k] || 0) - Number(before[k] || 0));
  const requests = d('requests');
  if (!requests && !tools) return '';
  const parts = [`${requests} request${requests === 1 ? '' : 's'}`];
  const input = d('prompt'), output = d('completion'), cached = d('cached');
  if (input || output) parts.push(`${fmtN(input)} in${cached ? ` (${Math.round(100 * cached / Math.max(1, input))}% cached)` : ''} · ${fmtN(output)} out`);
  if (tools) parts.push(`${tools} tool${tools === 1 ? '' : 's'}`);
  parts.push(seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`);
  return parts.join(' · ');
}

/**
 * Collapse runs of settled, successful, same-name tool cards into one summary row.
 * Returns an array of {start, end, name, count, durationMs} for runs of at least `minRun`.
 * The newest `keepRecent` transcript entries are never grouped so live activity stays visible.
 */
export function groupToolRuns(transcript = [], { minRun = 3, keepRecent = 4, skipNames = ['replace_in_file', 'write_file', 'apply_patch'] } = {}) {
  const runs = [];
  const limit = Math.max(0, transcript.length - keepRecent);
  let i = 0;
  while (i < limit) {
    const m = transcript[i];
    const ok = x => x && x.role === 'toolcard' && x.status === 'done' && !x.expanded && !skipNames.includes(x.name);
    if (!ok(m)) { i++; continue; }
    let j = i, total = 0;
    while (j < limit && ok(transcript[j]) && transcript[j].name === m.name) { total += Number(transcript[j].durationMs || 0); j++; }
    if (j - i >= minRun) runs.push({ start: i, end: j - 1, name: m.name, count: j - i, durationMs: total });
    i = Math.max(j, i + 1);
  }
  return runs;
}

/** Truncate in the middle so both ends of an identifier (provider and model version) stay visible. */
export function cropMiddle(s, max, measure = x => [...x].length) {
  s = String(s ?? '');
  if (measure(s) <= max) return s;
  if (max <= 1) return '…';
  const chars = [...s], keepTail = Math.ceil((max - 1) * 0.45), keepHead = max - 1 - keepTail;
  let head = '', tail = '';
  for (const c of chars) { if (measure(head + c) > keepHead) break; head += c; }
  for (let k = chars.length - 1; k >= 0; k--) { if (measure(chars[k] + tail) > keepTail) break; tail = chars[k] + tail; }
  return `${head}…${tail}`;
}

/** Encode text for an OSC 52 clipboard write, which Windows Terminal, iTerm2, kitty and others accept. */
export function osc52(text) {
  return `\x1b]52;c;${Buffer.from(String(text), 'utf8').toString('base64')}\x07`;
}
