// STUB - owned by slice S6 (see docs/manga-ink-contracts.md). Signatures are frozen.
export const TIMELINE_SIZE = 8;
export function currentLineIndex(cues, time) { return -1; }
export function timelineWindow(length, current, size = TIMELINE_SIZE) { return { start: 0, end: Math.min(length, size) }; }
export function pipState(index, current) { return index < current ? 'past' : index === current ? 'current' : 'future'; }
export function formatCueTime(seconds) { return String(seconds); }
export function formatOffset(seconds) { return `${seconds >= 0 ? '+' : ''}${Number(seconds).toFixed(1)}s`; }
