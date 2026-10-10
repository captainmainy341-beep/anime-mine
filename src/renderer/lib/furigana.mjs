const KANJI_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const KATAKANA_RE = /[\u30a1-\u30f6]/g;

export const hasKanji = (text) => KANJI_RE.test(text);

export function toHiragana(text) {
  return text.replace(KATAKANA_RE, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export function furigana(token) {
  const surface = token.surface ?? '';
  if (!hasKanji(surface)) return { surface, rt: null };
  const reading = toHiragana(token.reading ?? '').trim();
  if (!reading || reading === toHiragana(surface)) return { surface, rt: null };
  return { surface, rt: reading };
}
