import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grammarChipLabel, learnWordInput } from '../src/renderer/lib/learnChips.mjs';

test('learnWordInput builds the addWord argument from the selected entry', () => {
  const entry = {
    kanji: ['猫'],
    kana: ['ねこ'],
    common: true,
    senses: [
      { pos: ['noun'], glosses: ['cat', 'feline'] },
      { pos: ['noun'], glosses: ['pet'] },
    ],
  };
  assert.deepEqual(learnWordInput({ dictForm: '猫', entry, sentenceText: 'そこに猫がいる。' }), {
    word: '猫',
    kana: ['ねこ'],
    meanings: ['cat; feline', 'pet'],
    sentence: { ja: 'そこに猫がいる。' },
  });
});

test('learnWordInput skips senses with no glosses', () => {
  const entry = {
    kanji: [],
    kana: ['あう'],
    senses: [
      { pos: [], glosses: [] },
      { pos: [], glosses: ['to meet'] },
    ],
  };
  const input = learnWordInput({ dictForm: '会う', entry, sentenceText: '友達に会う。' });
  assert.deepEqual(input.meanings, ['to meet']);
});

test('grammarChipLabel appends the JLPT level when present', () => {
  assert.equal(grammarChipLabel({ title: '〜ている', jlpt: 'N5', meaning: 'ongoing action' }), '〜ている · N5');
});

test('grammarChipLabel omits the JLPT level when missing', () => {
  assert.equal(grammarChipLabel({ title: '〜ている', jlpt: null, meaning: 'ongoing action' }), '〜ている');
  assert.equal(grammarChipLabel({ title: '〜ている', meaning: 'ongoing action' }), '〜ている');
});
