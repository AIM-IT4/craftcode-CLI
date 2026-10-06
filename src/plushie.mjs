// Spark — the Craft Code terminal mascot.
//
// Pure, time-driven frame generator: the same (mood, now, idleMs) always yields
// the same frame, so rendering is deterministic and trivially testable. Every
// glyph is a single terminal cell wide and no image assets or special fonts are
// required. The TUI is responsible for colouring and right-aligning the rows.

export const SPARK_HEIGHT = 5;
export const SPARK_WIDTH = 13;
export const SPARK_SLEEP_AFTER_MS = 45_000;

const CORE = 11; // sprite core width; SPARK_WIDTH leaves 1 cell of shake margin per side
const FRAME_MS = { working: 120, success: 130, error: 90, idle: 400, sleepy: 700 };

const pad = (s, w) => s + ' '.repeat(Math.max(0, w - [...s].length));
const center = (s, w) => {
  const n = [...s].length;
  const left = Math.max(0, Math.floor((w - n) / 2));
  return ' '.repeat(left) + s + ' '.repeat(Math.max(0, w - n - left));
};
const place = (s, dx) => {
  // Put a CORE-wide row inside the SPARK_WIDTH canvas, offset by dx (-1..1).
  const margin = (SPARK_WIDTH - CORE) / 2;
  return pad(' '.repeat(Math.max(0, margin + dx)) + s, SPARK_WIDTH);
};

export function sparkMood({ busy = false, mood = 'idle', moodUntil = 0, idleMs = 0, now = Date.now() } = {}) {
  if (busy) return 'working';
  if (now < moodUntil && (mood === 'success' || mood === 'error')) return mood;
  return idleMs >= SPARK_SLEEP_AFTER_MS ? 'sleepy' : 'idle';
}

/** Identifier that changes exactly when the visible frame changes (drives idle redraws). */
export function sparkKey(mood, now = Date.now()) {
  return `${mood}:${Math.floor(now / (FRAME_MS[mood] || FRAME_MS.idle))}`;
}

function effects(mood, f) {
  const row = Array(SPARK_WIDTH).fill(' ');
  const put = (i, ch) => { if (i >= 0 && i < SPARK_WIDTH) row[i] = ch; };
  if (mood === 'working') {
    // A spark orbiting back and forth above the head, with a fading trail.
    const span = 9, step = f % (span * 2 - 2), p = step < span ? step : span * 2 - 2 - step;
    const dir = step < span ? -1 : 1;
    put(2 + p, f % 2 ? '✧' : '✦');
    put(2 + p + dir, '·');
    return { text: row.join(''), tone: 'orange' };
  }
  if (mood === 'success') {
    const marks = ['✦', '✧', '·', '✦', '✧'];
    for (let i = 0; i < 5; i += 1) put(1 + i * 2 + (f % 2), marks[(i + f) % marks.length]);
    return { text: row.join(''), tone: 'yellow' };
  }
  if (mood === 'error') {
    put(7, f % 2 ? '!' : ' ');
    put(9, f % 3 === 0 ? "'" : ' ');
    return { text: row.join(''), tone: 'red' };
  }
  if (mood === 'sleepy') {
    const z = ['z', 'z ', 'z Z', 'z Z Z'][f % 4];
    [...z].forEach((ch, i) => put(8 + i, ch));
    return { text: row.join(''), tone: 'slate' };
  }
  // idle: the antenna spark twinkles
  put(6, ['✦', '✦', '✧', '·', '✧'][f % 5]);
  return { text: row.join(''), tone: 'orange' };
}

/**
 * @returns {{tone:string, fx:{text:string,tone:string}, rows:string[], label:string, key:string}}
 *   rows are 4 plain-text lines (SPARK_WIDTH cells each); the TUI paints them with `tone`.
 */
export function sparkFrame({ mood = 'idle', now = Date.now() } = {}) {
  const frame = Math.floor(now / (FRAME_MS[mood] || FRAME_MS.idle));
  let face = '• ᴗ •', arms = [' ', ' '], dx = 0, feet = ' ╰╯   ╰╯ ', tone = 'orange', body = '╰─┬───┬─╯';

  if (mood === 'idle') {
    // Slow blink every ~3s, a quick glance every ~7s.
    const beat = frame % 18;
    if (beat === 16) face = '- ᴗ -';
    else if (beat === 8) face = '• ᴗ ◦';
    else if (beat === 9) face = '◦ ᴗ •';
    if (frame % 6 === 3) feet = '  ╰╯ ╰╯  ';
  } else if (mood === 'sleepy') {
    face = '- ᴗ -';
    feet = '  ╰╯ ╰╯  ';
    tone = 'slate';
  } else if (mood === 'working') {
    const a = frame % 2;
    face = a ? '◓ ᴗ ◐' : '◐ ᴗ ◓';
    arms = a ? ['_', '/'] : ['\\', '_']; // typing
    feet = a ? ' ╰╯   ╰╯ ' : '  ╰╯ ╰╯  ';
    body = a ? '╰─┬───┬─╯' : '╰─┴───┴─╯';
  } else if (mood === 'success') {
    face = '^ ᴗ ^';
    arms = ['\\', '/']; // cheering
    tone = 'green';
    // Bounce: sprite hops by swapping feet/body between frames.
    const up = frame % 2 === 0;
    feet = up ? '  ╰╯ ╰╯  ' : ' ╰╯   ╰╯ ';
    body = up ? '╰─┴───┴─╯' : '╰─┬───┬─╯';
  } else if (mood === 'error') {
    face = '• ⌒ •';
    tone = 'red';
    dx = [-1, 1, -1, 0][frame % 4]; // shake
    feet = ' ╰╯   ╰╯ ';
  }

  const rows = [
    place(center('╭───────╮', CORE), dx),
    place(`${arms[0]}( ${face} )${arms[1]}`, dx),
    place(center(body, CORE), dx),
    place(center(feet, CORE), dx),
  ];
  return { tone, fx: effects(mood, frame), rows, label: 'Spark', key: sparkKey(mood, now) };
}
