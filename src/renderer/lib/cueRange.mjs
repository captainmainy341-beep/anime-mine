export function mergeCues(cues, startIndex, endIndex) {
  const from = Math.max(0, Math.min(startIndex, endIndex));
  const to = Math.min(cues.length - 1, Math.max(startIndex, endIndex));
  const slice = cues.slice(from, to + 1);
  return {
    start: slice[0].start,
    end: slice[slice.length - 1].end,
    text: slice.map((cue) => cue.text).join('\n'),
  };
}
