import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trailWindow, practiceVerdict, acceptedPracticeAnswers } from '../src/renderer/learn/courseModel.mjs';

test('trail shows real catalogue neighbours and clamps at both ends', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `g:${i}`, label: String(i) }));
  assert.deepEqual(trailWindow(rows, 'g:0').map(r => r.ordinal), [1,2,3,4,5]);
  assert.deepEqual(trailWindow(rows, 'g:6').map(r => r.ordinal), [5,6,7,8,9]);
  assert.deepEqual(trailWindow(rows, 'g:11').map(r => r.ordinal), [8,9,10,11,12]);
  assert.equal(trailWindow(rows, 'g:6').filter(r => r.selected).length, 1);
  assert.deepEqual(trailWindow([], 'missing'), []);
  assert.equal(trailWindow(rows.slice(0, 2), 'g:1').length, 2);
});
test('practice has honest blank, incorrect, close, and correct feedback', () => {
  assert.equal(practiceVerdict('', ['食べた']).result, 'invalid');
  assert.equal(practiceVerdict('違う', ['食べた']).result, 'incorrect');
  assert.equal(practiceVerdict('食べた', ['食べた']).result, 'correct');
  assert.equal(practiceVerdict('tabeta', ['たべた']).result, 'correct');
  assert.equal(practiceVerdict('食べました', ['食べました']).result, 'correct');
});
test('practice accepts the original forms and locally derived kana; tokenisation failure is recoverable', async () => {
  const answers = await acceptedPracticeAnswers(['見たことがある'], async () => [{ text:'見',ruby:'み' },{ text:'たことがある' }]);
  assert.deepEqual(answers, ['見たことがある','みたことがある']);
  assert.equal(practiceVerdict('mitakotogaaru', answers).result, 'correct');
  assert.deepEqual(await acceptedPracticeAnswers(['です'], async () => {throw Error('offline')}), ['です']);
});
