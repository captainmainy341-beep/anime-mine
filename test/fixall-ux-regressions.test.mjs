import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exploreProps } from '../src/renderer/learn/browse.mjs';
import { deckDue } from '../src/renderer/anki.mjs';
import { pluralLabel } from '../src/renderer/learn/stats.mjs';
import { sortWorks } from '../src/renderer/lib/vocabView.mjs';
import { isTabRoot, loadLearnSettings } from '../src/renderer/learn.mjs';

test('Learn settings use the app furigana value and fall back on failure', async () => {
  let showFurigana = false;
  const api = { learn: { settingsGet: async () => ({ showFurigana: true, lessonBatch: 5 }) },
    settings: { get: async () => ({ showFurigana }) } };
  assert.deepEqual(await loadLearnSettings(api), { showFurigana: false, lessonBatch: 5 });
  showFurigana = true;
  assert.equal((await loadLearnSettings(api)).showFurigana, true);
  api.settings.get = async () => { throw new Error('offline'); };
  assert.equal((await loadLearnSettings(api)).showFurigana, true);
  delete api.settings;
  assert.equal((await loadLearnSettings(api)).showFurigana, true);
});

test('active tab is only a no-op at its root', () => {
  assert.equal(isTabRoot([], 'home'), true);
  assert.equal(isTabRoot([{ view: 'levels' }], 'levels'), true);
  assert.equal(isTabRoot([{ view: 'item', tab: 'levels' }], 'levels'), false);
  assert.equal(isTabRoot([{ view: 'levels' }, { view: 'item', tab: 'levels' }], 'levels'), false);
  assert.equal(isTabRoot([{ view: 'grammar' }, { view: 'grammar' }], 'grammar'), false);
});

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
