import { mergeCues } from './cueRange.mjs';

export const NUDGE_SECONDS = 0.2;
export const MAX_CLIP_SECONDS = 120;

export function glossesOf(entry) {
  return entry ? entry.senses.flatMap((sense) => sense.glosses).join('; ') : '';
}

export function prefillFields({ mode, cueText, word, reading, entry }) {
  return {
    Word: mode === 'word' ? word : cueText,
    Reading: reading ?? '',
    Meaning: glossesOf(entry),
    SentenceTranslation: '',
    Notes: '',
  };
}

export function clampTiming(start, end, { minStart = 0 } = {}) {
  const s = Math.max(minStart, Number.isFinite(start) ? start : minStart);
  let e = Number.isFinite(end) ? end : s;
  if (e - s > MAX_CLIP_SECONDS) e = s + MAX_CLIP_SECONDS;
  if (e <= s) e = s + 0.05;
  return { start: round(s), end: round(e) };
}

export function nudge(timing, edge, delta) {
  const next = { ...timing, [edge]: timing[edge] + delta };
  return clampTiming(next.start, next.end);
}

export function initialRange(cues, index) {
  return { from: index, to: index, cues };
}

export function extendRange(range, direction) {
  const from = direction === 'previous' ? Math.max(0, range.from - 1) : range.from;
  const to = direction === 'next' ? Math.min(range.cues.length - 1, range.to + 1) : range.to;
  return { ...range, from, to };
}

export function rangeCue(range) {
  return mergeCues(range.cues, range.from, range.to);
}

export function buildMineRequest({ videoPath, mode, cue, timing, word, fields, context, audioStreamIndex }) {
  const req = {
    videoPath,
    cue: { start: cue.start, end: cue.end, text: cue.text },
    mode,
    timing: { start: timing.start, end: timing.end },
    fields,
    context,
  };
  if (mode === 'word') req.word = { surface: word.surface, base: word.base, reading: word.reading };
  if (audioStreamIndex != null) req.audioStreamIndex = audioStreamIndex;
  return req;
}

export function previewRequest({ videoPath, timing, audioStreamIndex }) {
  const req = { videoPath, cue: { start: timing.start, end: timing.end } };
  if (audioStreamIndex != null) req.audioStreamIndex = audioStreamIndex;
  return req;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
