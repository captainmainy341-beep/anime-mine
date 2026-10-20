// Subtitle timeline model: pure helpers used by player/timeline.mjs.
// Cues are [{ start, end, text }] in seconds, sorted by start. `time` is already offset-adjusted.

export const TIMELINE_SIZE = 8;

const LEAD = 3; // the current line sits 4th in the window when there is room

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Index of the cue with start <= time < end. Between cues we keep the last line that already
// started (subtitles linger until the next line); -1 before the first cue or when there are none.
export function currentLineIndex(cues, time) {
  if (!Array.isArray(cues) || cues.length === 0) return -1;
  const at = Number(time);
  if (!Number.isFinite(at)) return -1;
  if (at < cues[0].start) return -1;

  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= at) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// Window of up to `size` lines around `current`: { start, end } with end exclusive.
// The current line is kept 4th (3 lines before it) when possible, then clamped to [0, length].
export function timelineWindow(length, current, size = TIMELINE_SIZE) {
  const total = Math.max(0, Math.floor(Number(length) || 0));
  const span = Math.max(0, Math.min(total, Math.floor(Number(size) || 0)));
  if (span === 0) return { start: 0, end: 0 };

  const maxStart = Math.max(0, total - span);
  const index = Number.isFinite(Number(current)) ? Math.floor(Number(current)) : -1;
  let start = clamp(index < 0 ? 0 : index - LEAD, 0, maxStart);
  if (index >= 0 && index >= start + span) start = Math.min(maxStart, Math.max(0, index - span + 1));
  return { start, end: Math.min(total, start + span) };
}

export function pipState(index, current) {
  if (index < current) return 'past';
  if (index === current) return 'current';
  return 'future';
}

const pad2 = (n) => String(n).padStart(2, '0');

// 742 -> '12:22'; 3661 -> '1:01:01'.
export function formatCueTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(rest)}` : `${pad2(minutes)}:${pad2(rest)}`;
}

// 0 -> '+0.0s', -0.3 -> '-0.3s', -0.04 -> '+0.0s' (never '-0.0s').
export function formatOffset(seconds) {
  const value = Number(seconds);
  const rounded = Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
  const sign = rounded < 0 ? '-' : '+';
  return `${sign}${Math.abs(rounded).toFixed(1)}s`;
}
