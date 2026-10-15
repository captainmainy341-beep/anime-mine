export function wordAddInput(w) {
  const input = { word: w.word, kana: w.reading ? [w.reading] : [], meanings: w.meanings };
  if (w.example) input.sentence = { ja: w.example };
  return input;
}

export function addableWords(words) {
  return words.filter((w) => w.meanings.some((m) => m.trim()));
}

export function nextFocusIndex(current, count, shift) {
  if (count === 0) return -1;
  if (current < 0) return shift ? count - 1 : 0;
  return (current + (shift ? -1 : 1) + count) % count;
}

export function grammarLine(g) {
  const base = g.jlpt ? `${g.title} · ${g.jlpt}` : g.title;
  return g.count > 1 ? `${base} ×${g.count}` : base;
}

export function stageNote(stage) {
  if (stage >= 5) return 'Mastered';
  if (stage >= 1) return 'Learning';
  return 'New';
}
