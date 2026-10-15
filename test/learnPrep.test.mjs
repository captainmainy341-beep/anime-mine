import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addableWords, grammarLine, nextFocusIndex, stageNote, wordAddInput } from '../src/renderer/learn/prepModel.mjs';

test('wordAddInput maps reading and example into the addWord shape', () => {
  assert.deepEqual(
    wordAddInput({ word: '食べる', reading: 'たべる', meanings: ['to eat'], example: 'ご飯を食べる' }),
    { word: '食べる', kana: ['たべる'], meanings: ['to eat'], sentence: { ja: 'ご飯を食べる' } },
  );
});

test('wordAddInput omits sentence and gives empty kana without a reading or example', () => {
  const input = wordAddInput({ word: '猫', reading: '', meanings: ['cat'], example: '' });
  assert.deepEqual(input, { word: '猫', kana: [], meanings: ['cat'] });
  assert.equal('sentence' in input, false);
});

test('addableWords keeps only words with a non-blank meaning', () => {
  const words = [
    { word: 'a', meanings: ['x'] },
    { word: 'b', meanings: [] },
    { word: 'c', meanings: ['  ', ''] },
    { word: 'd', meanings: ['', 'y'] },
  ];
  assert.deepEqual(addableWords(words).map(w => w.word), ['a', 'd']);
  assert.deepEqual(addableWords([]), []);
});

test('grammarLine joins title and JLPT level and adds a count only above one', () => {
  assert.equal(grammarLine({ title: '〜ばかり', jlpt: 'N4', count: 1 }), '〜ばかり · N4');
  assert.equal(grammarLine({ title: '〜ばかり', jlpt: 'N4', count: 3 }), '〜ばかり · N4 ×3');
  assert.equal(grammarLine({ title: '〜ため', count: 2 }), '〜ため ×2');
  assert.equal(grammarLine({ title: '〜ため' }), '〜ため');
  assert.equal(grammarLine({ title: '〜ため', jlpt: '', count: 0 }), '〜ため');
});

test('nextFocusIndex cycles forward and backward through focusables', () => {
  assert.equal(nextFocusIndex(0, 3, false), 1);
  assert.equal(nextFocusIndex(2, 3, false), 0);
  assert.equal(nextFocusIndex(0, 3, true), 2);
  assert.equal(nextFocusIndex(2, 3, true), 1);
});

test('nextFocusIndex enters from outside the list and handles empty lists', () => {
  assert.equal(nextFocusIndex(-1, 3, false), 0);
  assert.equal(nextFocusIndex(-1, 3, true), 2);
  assert.equal(nextFocusIndex(0, 0, false), -1);
});

test('stageNote maps stage bands to labels', () => {
  assert.equal(stageNote(0), 'New');
  assert.equal(stageNote(1), 'Learning');
  assert.equal(stageNote(4), 'Learning');
  assert.equal(stageNote(5), 'Mastered');
  assert.equal(stageNote(9), 'Mastered');
  assert.equal(stageNote(undefined), 'New');
});
