const RESUME_MIN_SECONDS = 5;
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export const roundOffset = (seconds) => Math.round(seconds * 10) / 10;

export function nextOffset(current, delta) {
  return roundOffset((current ?? 0) + delta);
}

export function formatOffset(seconds) {
  const sign = seconds > 0 ? '+' : '';
  return `sub ${sign}${roundOffset(seconds).toFixed(1)}s`;
}

export function videoTimeForCue(cue, subOffset) {
  return cue.start + subOffset;
}

export function shiftCues(cues, offset) {
  if (!offset) return cues;
  return cues.map((cue) => ({ ...cue, start: cue.start + offset, end: cue.end + offset }));
}

export function resumeTarget(saved, duration) {
  if (!saved || saved.finished) return null;
  const position = Number(saved.position) || 0;
  if (position <= RESUME_MIN_SECONDS) return null;
  if (duration > 0 && position >= duration) return null;
  return position;
}

export function audioLabel(stream) {
  const parts = [stream.lang ?? 'und', stream.codec || 'unknown'];
  if (stream.channels) parts.push(`${stream.channels}ch`);
  if (stream.title) parts.push(stream.title);
  return parts.join(' · ');
}

export function subtitleLabel(stream) {
  const parts = [stream.lang ?? 'und', stream.codec || 'unknown'];
  if (stream.title) parts.push(stream.title);
  if (!stream.textBased) parts.push('(image, unsupported)');
  return parts.join(' · ');
}

export function cueEndReached(time, cue, subOffset) {
  return Boolean(cue) && time >= cue.end + subOffset;
}

export function shouldAutoPause({ autoPause, cue, time, subOffset }) {
  return autoPause === true && cueEndReached(time, cue, subOffset);
}

export function loopSeekTarget({ loopLine, cue, time, subOffset }) {
  if (loopLine !== true || !cueEndReached(time, cue, subOffset)) return null;
  return videoTimeForCue(cue, subOffset);
}

export function isTypingTarget(el) {
  return Boolean(el) && (TEXT_ENTRY_TAGS.has(el.tagName) || el.isContentEditable === true);
}

export function createGeneration() {
  let latest = 0;
  return {
    begin() {
      latest += 1;
      return latest;
    },
    isCurrent(token) {
      return token === latest;
    },
  };
}
