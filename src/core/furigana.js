const { toHiragana } = require('./kana');

const KANJI_CLASS = '\u3005\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff';
const KANJI = new RegExp(`[${KANJI_CLASS}]`);
const RUNS = new RegExp(`[${KANJI_CLASS}]+|[^${KANJI_CLASS}]+`, 'g');

function alignRuns(runs, reading) {
  const anchors = [];
  let pos = 0;
  for (const run of runs) {
    if (KANJI.test(run)) {
      anchors.push(null);
      continue;
    }
    const at = reading.indexOf(toHiragana(run), pos);
    if (at < 0) return null;
    anchors.push(at);
    pos = at + run.length;
  }
  if (!KANJI.test(runs[runs.length - 1]) && pos !== reading.length) return null;

  const segments = runs.map((run, i) => {
    if (anchors[i] !== null) return { text: run };
    const from = i === 0 ? 0 : anchors[i - 1] + runs[i - 1].length;
    const to = i + 1 < runs.length ? anchors[i + 1] : reading.length;
    return { text: run, ruby: reading.slice(from, to) };
  });
  return segments.some(segment => segment.ruby === '') ? null : segments;
}

function tokenSegments({ surface, reading }) {
  const runs = surface.match(RUNS) ?? [];
  if (!runs.some(run => KANJI.test(run))) return [{ text: surface }];
  const hiragana = toHiragana(reading);
  return alignRuns(runs, hiragana) ?? [{ text: surface, ruby: hiragana }];
}

function furiganaSegments(text, tokens) {
  const segments = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start > cursor) segments.push({ text: text.slice(cursor, token.start) });
    segments.push(...tokenSegments(token));
    cursor = token.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

async function furigana(text, tokenize) {
  return furiganaSegments(text, await tokenize(text));
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
}

function hasKanji(text) {
  return KANJI.test(text);
}

const escapeBrackets = text => text.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');

function toAnkiFurigana(segments, { highlight } = {}) {
  let out = '';
  let offset = 0;
  for (const segment of segments) {
    const start = offset;
    const end = offset + segment.text.length;
    offset = end;
    const overlaps = highlight !== undefined && start < highlight.end && end > highlight.start;
    let piece = escapeBrackets(escapeHtml(segment.text));
    let lead = '';
    if (segment.ruby) {
      if (out && !out.endsWith(' ')) lead = ' ';
      piece = `${piece}[${escapeBrackets(escapeHtml(segment.ruby))}]`;
    }
    out += lead + (overlaps ? `<b>${piece}</b>` : piece);
  }
  return out;
}

module.exports = { furiganaSegments, furigana, toAnkiFurigana, hasKanji };
