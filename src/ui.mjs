const esc = '\x1b[';
export const ansi = {
  reset: `${esc}0m`, bold: `${esc}1m`, dim: `${esc}2m`,
  cyan: `${esc}36m`, green: `${esc}32m`, yellow: `${esc}33m`, red: `${esc}31m`, magenta: `${esc}35m`,
  clearLine: `${esc}2K`,
};

export const color = (c, s) => `${ansi[c] ?? ''}${s}${ansi.reset}`;
export const fmtTokens = (n = 0) => {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(n >= 10_000_000_000 ? 0 : 1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
};
export const pctBar = (used, total, width = 12) => {
  const ratio = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0;
  const on = Math.round(ratio * width);
  return `${'█'.repeat(on)}${'░'.repeat(width - on)}`;
};
export function banner() {
  console.log(color('bold', 'CraftCLI') + color('dim', '  provider-agnostic agent • skills • plugins • MCP • token guard'));
}
export function statusLine({ model, mode, request, session, used, plan }) {
  const remaining = Math.max(0, plan - used);
  const ratio = plan ? used / plan : 0;
  const c = ratio >= .9 ? 'red' : ratio >= .7 ? 'yellow' : 'green';
  const req = request ? `↑${fmtTokens(request.prompt_tokens ?? 0)} ↓${fmtTokens(request.completion_tokens ?? 0)}` : '↑– ↓–';
  console.log(color('dim', '─'.repeat(Math.min(110, process.stdout.columns || 80))));
  console.log(
    `${color('magenta', model || 'model?')}  ${color(mode === 'build' ? 'green' : 'yellow', mode.toUpperCase())}  ` +
    `${req}  SESSION ${fmtTokens(session)}  ` +
    `${color(c, pctBar(used, plan))} ${fmtTokens(remaining)} / ${fmtTokens(plan)} left`
  );
}
export function toolNotice(name, detail = '') {
  console.log(`${color('cyan', '↳')} ${color('dim', name)}${detail ? color('dim', ` · ${detail}`) : ''}`);
}
export function warn(s) { console.log(color('yellow', `! ${s}`)); }
export function error(s) { console.error(color('red', `✗ ${s}`)); }
