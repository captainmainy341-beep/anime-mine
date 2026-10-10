const path = require('node:path');
const kuromoji = require('kuromoji');

const DIC_PATH = path.join(path.dirname(require.resolve('kuromoji/package.json')), 'dict');
const PUNCTUATION_POS = '記号';

let tokenizerPromise = null;

function buildTokenizer() {
  return new Promise((resolve, reject) => {
    kuromoji.builder({ dicPath: DIC_PATH }).build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)));
  });
}

function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = buildTokenizer().catch((err) => {
      tokenizerPromise = null;
      throw err;
    });
  }
  return tokenizerPromise;
}

function toHiragana(text) {
  return text.replace(/[\u30a1-\u30f6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function hasValue(field) {
  return Boolean(field) && field !== '*';
}

function toToken(raw, start, end) {
  const surface = raw.surface_form;
  return {
    surface,
    base: hasValue(raw.basic_form) ? raw.basic_form : surface,
    reading: toHiragana(hasValue(raw.reading) ? raw.reading : surface),
    pos: raw.pos,
    pos2: hasValue(raw.pos_detail_1) ? raw.pos_detail_1 : '',
    start,
    end,
    isWord: raw.pos !== PUNCTUATION_POS && surface.trim() !== '',
  };
}

async function tokenize(text) {
  const tokenizer = await getTokenizer();
  let cursor = 0;
  return tokenizer.tokenize(text).map((raw) => {
    const start = text.indexOf(raw.surface_form, cursor);
    const end = start + raw.surface_form.length;
    cursor = end;
    return toToken(raw, start, end);
  });
}

module.exports = { tokenize };
