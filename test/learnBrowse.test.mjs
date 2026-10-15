import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TYPE,
  TYPE_FILTERS,
  addWordPayload,
  levelProgress,
  parseMeanings,
  tileModel,
} from '../src/renderer/learn/browseModel.mjs';

test('type filters offer Kanji by default', () => {
  assert.equal(DEFAULT_TYPE, 'kanji');
  assert.deepEqual(
    TYPE_FILTERS.map(([key]) => key),
    ['radical', 'kanji', 'vocab', 'custom'],
  );
});

test('tileModel colours by stage group and marks locked items', () => {
  const started = tileModel({ id: 'k:好', label: '好', sub: 'like', groupKey: 'guru', locked: false });
  assert.equal(started.className, 'learn-tile learn-tile-guru');
  assert.equal(started.sub, 'like');
  assert.equal(started.locked, false);

  const fresh = tileModel({ id: 'k:水', label: '水', sub: 'water', groupKey: null, locked: false });
  assert.equal(fresh.className, 'learn-tile learn-tile-new');

  const locked = tileModel({ id: 'k:木', label: '木', sub: 'tree', groupKey: null, locked: true });
  assert.equal(locked.className, 'learn-tile learn-tile-new learn-tile-locked');
  assert.equal(locked.locked, true);
});

test('levelProgress reports kanji passed over total', () => {
  const row = { level: 3, kanji: { total: 40, started: 20, passed: 10 }, current: true, locked: false };
  assert.deepEqual(levelProgress(row), { level: 3, passed: 10, total: 40, percent: 25, current: true, locked: false });
  const empty = { level: 9, kanji: { total: 0, started: 0, passed: 0 }, current: false, locked: true };
  assert.equal(levelProgress(empty).percent, 0);
  assert.equal(levelProgress(empty).locked, true);
});

test('parseMeanings splits on commas and semicolons', () => {
  assert.deepEqual(parseMeanings(' liking, fond ;  , '), ['liking', 'fond']);
  assert.deepEqual(parseMeanings(undefined), []);
});

test('addWordPayload builds the addWord request', () => {
  assert.deepEqual(
    addWordPayload({ word: ' 好き ', reading: 'すき', meaning: 'liking, fond', sentence: '' }),
    { word: '好き', kana: ['すき'], meanings: ['liking', 'fond'], sentence: null },
  );
  assert.deepEqual(
    addWordPayload({ word: '好き', reading: 'すき', meaning: 'liking', sentence: '好きです。' }).sentence,
    { ja: '好きです。' },
  );
});

test('addWordPayload rejects missing word, reading, or meaning', () => {
  assert.throws(() => addWordPayload({ word: '', reading: 'すき', meaning: 'x' }), /word/);
  assert.throws(() => addWordPayload({ word: '好き', reading: ' ', meaning: 'x' }), /reading/);
  assert.throws(() => addWordPayload({ word: '好き', reading: 'すき', meaning: ' , ' }), /meaning/);
});
