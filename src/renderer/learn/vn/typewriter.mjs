export const CHARS_PER_SECOND = 38;

// How many characters of `text` are visible `elapsedMs` after a line starts. Counts code points so
// kanji and kana (and the odd emoji) are never cut in half.
export function visibleCount(text, elapsedMs, cps = CHARS_PER_SECOND) {
  const total = [...text].length;
  if (!(cps > 0)) return total;
  return Math.min(total, Math.max(0, Math.floor((elapsedMs / 1000) * cps)));
}

export function sliceText(text, count) {
  return [...text].slice(0, count).join('');
}

export function isComplete(text, count) {
  return count >= [...text].length;
}

// Auto-advance waits longer for longer lines so the learner can read.
export function autoDelay(text, { base = 1400, perChar = 70, max = 6000 } = {}) {
  return Math.min(max, base + [...text].length * perChar);
}
