import test from 'node:test';
import assert from 'node:assert/strict';
import { furigana, hasKanji, toHiragana } from '../src/renderer/lib/furigana.mjs';

test('hasKanji detects CJK ideographs only', () => {
  assert.equal(hasKanji('日本語'), true);
  assert.equal(hasKanji('ねこ'), false);
  assert.equal(hasKanji('ネコ'), false);
  assert.equal(hasKanji('abc'), false);
});

test('toHiragana converts katakana and leaves other characters', () => {
  assert.equal(toHiragana('ネコー'), 'ねこー');
  assert.equal(toHiragana('ねこabc'), 'ねこabc');
});

test('furigana returns a ruby reading for kanji words', () => {
  assert.deepEqual(furigana({ surface: '日本', reading: 'ニホン' }), { surface: '日本', rt: 'にほん' });
});

test('furigana skips kana-only words and words whose reading equals the surface', () => {
  assert.deepEqual(furigana({ surface: 'ねこ', reading: 'ネコ' }), { surface: 'ねこ', rt: null });
  assert.deepEqual(furigana({ surface: '猫', reading: '' }), { surface: '猫', rt: null });
  assert.deepEqual(furigana({ surface: '猫', reading: '猫' }), { surface: '猫', rt: null });
});

test('furigana handles missing reading and surface', () => {
  assert.deepEqual(furigana({ surface: '山' }), { surface: '山', rt: null });
  assert.deepEqual(furigana({}), { surface: '', rt: null });
});
