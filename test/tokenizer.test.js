const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize } = require('../src/core/tokenizer');

const TEXT = '私は日本語を勉強しています。';

function find(tokens, surface) {
  const token = tokens.find((t) => t.surface === surface);
  assert.ok(token, `token "${surface}" not found`);
  return token;
}

test('tokens cover the text and offsets slice back to surface', async () => {
  const tokens = await tokenize(TEXT);
  assert.equal(tokens.map((t) => t.surface).join(''), TEXT);
  for (const token of tokens) {
    assert.equal(TEXT.slice(token.start, token.end), token.surface);
  }
});

test('gives base forms for inflected words', async () => {
  const tokens = await tokenize(TEXT);
  assert.equal(find(tokens, '勉強').base, '勉強');
  assert.equal(find(tokens, 'し').base, 'する');
  assert.equal(find(tokens, 'ます').base, 'ます');
});

test('converts readings to hiragana', async () => {
  const tokens = await tokenize(TEXT);
  assert.equal(find(tokens, '勉強').reading, 'べんきょう');
  assert.equal(find(tokens, '日本語').reading, 'にほんご');
});

test('exposes the second part-of-speech field', async () => {
  const tokens = await tokenize(TEXT);
  assert.equal(find(tokens, '勉強').pos2, 'サ変接続');
  assert.equal(find(tokens, 'い').pos2, '非自立');
  assert.equal(find(tokens, 'て').pos2, '接続助詞');
});

test('exposes conjugation type and form, empty for uninflected words', async () => {
  const tokens = await tokenize('食べた');
  assert.equal(find(tokens, 'た').conjugatedType, '特殊・タ');
  assert.equal(find(tokens, 'た').conjugatedForm, '基本形');
  assert.equal(find(tokens, '食べ').conjugatedForm, '連用形');
  assert.equal(find(tokens, '食べ').conjugatedType, '一段');
  assert.equal(find(tokens, '食べ').base, '食べる');
});

test('marks punctuation as non-words', async () => {
  const tokens = await tokenize(TEXT);
  const punctuation = find(tokens, '。');
  assert.equal(punctuation.isWord, false);
  assert.equal(punctuation.pos, '記号');
  assert.equal(find(tokens, '勉強').isWord, true);
});
