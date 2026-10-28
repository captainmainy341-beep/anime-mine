import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exploreProps } from '../src/renderer/learn/browse.mjs';
import { deckDue } from '../src/renderer/anki.mjs';
import { pluralLabel } from '../src/renderer/learn/stats.mjs';
import { sortWorks } from '../src/renderer/lib/vocabView.mjs';

test('unloaded gated vocab is not called complete', () => {
  const model = { type: 'vocab', lesson: null, rows: [], progress: { value: 0, max: 7 } };
  assert.equal(exploreProps(model).emptyTitle, 'Words locked behind kanji');
  assert.equal(exploreProps({ ...model, progress: { value: 7, max: 7 } }).emptyTitle, undefined);
});
test('due today sums the three distinct queues', () => {
  assert.equal(deckDue({ new: 1, learn: 2, due: 3 }), 6);
  assert.equal(deckDue({ new: -1, learn: null, due: 2 }), 2);
});
test('lesson count uses singular and plural', () => {
  assert.equal(pluralLabel('lesson', 1), 'lesson');
  assert.equal(pluralLabel('lesson', 0), 'lessons');
  assert.equal(pluralLabel('lesson', 2), 'lessons');
});
test('coverage sorting uses attached coverage', () => {
  const rows = [{ title: 'A', knownPct: 20 }, { title: 'B', knownPct: 80 }];
  assert.deepEqual(sortWorks(rows, 'knownPct', 'desc').map((x) => x.title), ['B', 'A']);
});
