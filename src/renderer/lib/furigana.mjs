const KANJI_CLASS = '\u3005\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff';
const KANJI_RE = new RegExp(`[${KANJI_CLASS}]`);
const RUNS = new RegExp(`[${KANJI_CLASS}]+|[^${KANJI_CLASS}]+`, 'g');
const KATAKANA_RE = /[\u30a1-\u30f6]/g;

export const hasKanji = (text) => KANJI_RE.test(text);

export function toHiragana(text) {
  return text.replace(KATAKANA_RE, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

// Mirrors the core aligner: kana runs anchor the reading, leaving ruby on kanji runs.
export function furiganaSegments(token) {
  const surface = token.surface ?? '';
  const reading = toHiragana(token.reading ?? '').trim();
  if (!hasKanji(surface) || !reading || reading === toHiragana(surface)) return [{ text: surface }];
  const runs = surface.match(RUNS) ?? [];
  const anchors = [];
  let pos = 0;
  for (const run of runs) {
    if (hasKanji(run)) { anchors.push(null); continue; }
    const at = reading.indexOf(toHiragana(run), pos);
    if (at < 0) return [{ text: surface, ruby: reading }];
    anchors.push(at);
    pos = at + run.length;
  }
  if (!hasKanji(runs.at(-1)) && pos !== reading.length) return [{ text: surface, ruby: reading }];
  const segments = runs.map((run, i) => {
    if (anchors[i] !== null) return { text: run };
    const from = i === 0 ? 0 : anchors[i - 1] + runs[i - 1].length;
    const to = i + 1 < runs.length ? anchors[i + 1] : reading.length;
    return { text: run, ruby: reading.slice(from, to) };
  });
  return segments.some((segment) => segment.ruby === '') ? [{ text: surface, ruby: reading }] : segments;
}

// Preserve the existing API for consumers that need a single ruby.
export function furigana(token) {
  const surface = token.surface ?? '';
  if (!hasKanji(surface)) return { surface, rt: null };
  const reading = toHiragana(token.reading ?? '').trim();
  if (!reading || reading === toHiragana(surface)) return { surface, rt: null };
  return { surface, rt: reading };
}
