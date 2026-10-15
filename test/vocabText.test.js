const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractVocabulary, toWordList } = require('../src/core/vocabText');

function tok(surface, overrides = {}) {
  return { surface, base: surface, reading: surface, pos: '名詞', isWord: true, ...overrides };
}

const STATUSES = { 猫: 'known', 犬: 'new', 鳥: 'skip' };
const statusOf = (word) => STATUSES[word] ?? 'new';

test('extractVocabulary lists words by first appearance with counts and status', async () => {
  const tokens = [tok('犬'), tok('猫'), tok('犬'), tok('。', { pos: '記号', isWord: false }), tok('猫')];
  const rows = await extractVocabulary('犬猫犬。猫', async () => tokens, statusOf);
  assert.deepEqual(rows, [
    { word: '犬', reading: '犬', count: 2, firstIndex: 0, status: 'new' },
    { word: '猫', reading: '猫', count: 2, firstIndex: 1, status: 'known' },
  ]);
});

test('extractVocabulary drops non-words and blacklisted words', async () => {
  const tokens = [tok('鳥'), tok('鳥'), tok('ね', { isWord: false }), tok('ね', { isWord: false })];
  const rows = await extractVocabulary('x', async () => tokens, statusOf);
  assert.deepEqual(rows, []);
});

test('extractVocabulary uses base forms and the first reading', async () => {
  const tokens = [
    tok('食べ', { base: '食べる', reading: 'たべ' }),
    tok('食べ', { base: '食べる', reading: 'た' }),
  ];
  const rows = await extractVocabulary('x', async () => tokens, () => 'new');
  assert.deepEqual(rows, [{ word: '食べる', reading: 'たべ', count: 2, firstIndex: 0, status: 'new' }]);
});

test('toWordList joins words with newlines and can keep only new words', async () => {
  const rows = await extractVocabulary('x', async () => [tok('猫'), tok('犬')], statusOf);
  assert.equal(toWordList(rows), '猫\n犬');
  assert.equal(toWordList(rows, { onlyUnknown: true }), '犬');
  assert.equal(toWordList([]), '');
});
