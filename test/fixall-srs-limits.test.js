const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LearnStore } = require('../src/core/learnStore');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fixall-srs-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const points = ['a', 'b', 'c', 'd'].map(name => ({ id: `g:${name}`, jlpt: 'N5', title: name, examples: [] }));
  return new LearnStore({ dataDir, grammar: { points, byId: new Map(points.map(p => [p.id, p])) }, now: () => new Date(2026, 1, 1, 12).getTime() });
}

test('zero daily limit is unlimited and summary is JSON-safe', t => {
  const store = fixture(t);
  store.settingsSet({ dailyLessonLimit: 0, lessonBatch: 2 });
  store.completeLessons(['g:a']);
  assert.equal(store.remainingToday(), Infinity);
  assert.equal(store.dashboard().lessons.remainingToday, null);
  assert.equal(JSON.parse(JSON.stringify(store.dashboard())).lessons.remainingToday, null);
  assert.equal(store.lessonQueue({ scope: 'grammar', limit: 10 }).length, 3);
  assert.equal(store.lessonQueue({ ids: ['g:b', 'g:c', 'g:d'] }).length, 3);
});

test('explicit ids respect remaining daily allowance after filtering unavailable entries', t => {
  const store = fixture(t);
  store.settingsSet({ dailyLessonLimit: 2 });
  store.completeLessons(['g:a']);
  assert.equal(store.dashboard().lessons.remainingToday, 1);
  assert.deepEqual(store.lessonQueue({ ids: ['g:a', 'g:b', 'g:c'] }).map(c => c.id), ['g:b']);
  store.completeLessons(['g:b']);
  assert.equal(store.remainingToday(), 0);
  assert.equal(store.dashboard().lessons.remainingToday, 0);
  assert.deepEqual(store.lessonQueue({ ids: ['g:c', 'g:d'] }), []);
});
