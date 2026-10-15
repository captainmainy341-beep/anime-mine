const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pageToSentences, sentenceAtPoint } = require('../src/core/mangaText');

const block = (text, x, y, w = 0.1, h = 0.4) => ({ text, box: { x, y, w, h }, vertical: true, confidence: 0.9 });

test('pageToSentences returns one collapsed string per block', () => {
  const sentences = pageToSentences([
    block('今日は\n  良い天気ですね', 0.5, 0.1),
    block('  はい  ', 0.2, 0.1),
  ]);
  assert.deepEqual(sentences, ['今日は 良い天気ですね', 'はい']);
});

test('pageToSentences drops tiny noise blocks but keeps single kana or kanji', () => {
  const sentences = pageToSentences([
    block('-', 0.1, 0.1),
    block('。', 0.2, 0.1),
    block('あ', 0.3, 0.1),
    block('猫', 0.4, 0.1),
    block('ab', 0.5, 0.1),
  ]);
  assert.deepEqual(sentences, ['あ', '猫', 'ab']);
});

test('pageToSentences normalises repeated fullwidth punctuation', () => {
  assert.deepEqual(pageToSentences([block('えっ！！！', 0.1, 0.1)]), ['えっ！']);
  assert.deepEqual(pageToSentences([block('まさか？？', 0.1, 0.1)]), ['まさか？']);
  assert.deepEqual(pageToSentences([block('うーん…………', 0.1, 0.1)]), ['うーん……']);
});

test('pageToSentences drops blocks that are empty after normalisation', () => {
  assert.deepEqual(pageToSentences([block('  \n ', 0.1, 0.1)]), []);
});

test('sentenceAtPoint returns the block containing the point', () => {
  const blocks = [block('右の列', 0.6, 0.1, 0.2, 0.5), block('左の列', 0.2, 0.1, 0.2, 0.5)];
  assert.equal(sentenceAtPoint(blocks, 0.25, 0.3), '左の列');
  assert.equal(sentenceAtPoint(blocks, 0.7, 0.3), '右の列');
});

test('sentenceAtPoint accepts a point within the 2% tolerance outside a block', () => {
  const blocks = [block('猫です', 0.2, 0.2, 0.1, 0.1)];
  assert.equal(sentenceAtPoint(blocks, 0.31, 0.25), '猫です');
  assert.equal(sentenceAtPoint(blocks, 0.335, 0.25), null);
});

test('sentenceAtPoint returns null when nothing is near the point', () => {
  assert.equal(sentenceAtPoint([block('猫です', 0.2, 0.2, 0.1, 0.1)], 0.9, 0.9), null);
  assert.equal(sentenceAtPoint([], 0.5, 0.5), null);
});

test('sentenceAtPoint ignores noise blocks', () => {
  assert.equal(sentenceAtPoint([block('-', 0.2, 0.2, 0.1, 0.1)], 0.25, 0.25), null);
});
