// Cues are sorted by start but may overlap or nest. Returns the active cue (start <= t < end)
// that starts latest; scanning stops at the first cue starting after t.
export function findCueIndex(cues, t) {
  let found = -1;
  for (let i = 0; i < cues.length && cues[i].start <= t; i++) {
    if (t < cues[i].end) found = i;
  }
  return found;
}

function firstStartingAfter(cues, t) {
  let lo = 0;
  let hi = cues.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function neighborIndex(cues, t, dir) {
  const step = dir > 0 ? 1 : -1;
  const current = findCueIndex(cues, t);
  const gap = firstStartingAfter(cues, t);
  let target;
  if (current >= 0) target = current + step;
  else target = step > 0 ? gap : gap - 1;
  return target >= 0 && target < cues.length ? target : -1;
}
