import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessonLabel, lessonsForPoint, nextAction, pathProgress } from '../src/renderer/learn/genkiModel.mjs';

const row = (lesson, over = {}) => ({ id: `genki-l${lesson}`, lesson, title: `T${lesson}`, tagline: '', minutes: 8, words: 20, patterns: 3, learned: false, hasStory: true, storyDone: false, ...over });

test('pathProgress finds the first unfinished lesson and counts finished ones', () => {
  const p = pathProgress({ lessons: [row(2), row(1, { learned: true, storyDone: true }), row(3)] });
  assert.deepEqual([p.done, p.total, p.next.lesson, p.complete], [1, 3, 2, false]);
  assert.equal(pathProgress({ lessons: [row(1, { learned: true, storyDone: true })] }).complete, true);
  assert.equal(pathProgress(null).total, 0);
});

test('a lesson without a story is finished once learned', () => {
  assert.equal(pathProgress({ lessons: [row(1, { learned: true, hasStory: false })] }).complete, true);
});

test('nextAction starts the lesson first, then the story', () => {
  assert.deepEqual(nextAction(row(4)).target, { lesson: 'genki-l4' });
  assert.deepEqual(nextAction(row(4, { learned: true })).target, { play: 'genki-l4' });
  assert.equal(nextAction(null), null);
});

test('lessonsForPoint lists lessons in order and labels them', () => {
  const data = { points: { 'g:n5-o': [{ id: 'b', lesson: 5, title: 'B' }, { id: 'a', lesson: 3, title: 'A' }] } };
  assert.deepEqual(lessonsForPoint(data, 'g:n5-o').map((e) => e.lesson), [3, 5]);
  assert.deepEqual(lessonsForPoint(data, 'g:x'), []);
  assert.equal(lessonLabel({ lesson: 3, title: 'A' }), 'Genki Lesson 3 · A');
});
