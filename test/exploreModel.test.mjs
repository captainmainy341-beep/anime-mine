import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPLORE_FILTERS,
  UP_NEXT_LIMIT,
  filterRows,
  hiddenCount,
  lessonNumberLabel,
  nextLesson,
  seeAllLabel,
  upNext,
} from '../src/renderer/learn/exploreModel.mjs';

const lessons = [
  { id: 'a', number: 1, done: true },
  { id: 'b', number: 2, done: true },
  { id: 'c', number: 3, done: false },
  { id: 'd', number: 4, done: false },
];

const rows = [
  { id: 'a', status: 'new' },
  { id: 'b', status: 'review' },
  { id: 'c', status: 'new' },
  { id: 'd', status: 'learned' },
  { id: 'e', status: 'review' },
];

test('EXPLORE_FILTERS exposes All / New / Review in that order', () => {
  assert.deepEqual(EXPLORE_FILTERS, [['all', 'All'], ['new', 'New'], ['review', 'Review']]);
  assert.equal(UP_NEXT_LIMIT, 3);
});

test('nextLesson skips finished lessons and returns the first open one', () => {
  assert.equal(nextLesson(lessons)?.id, 'c');
  assert.equal(nextLesson([{ id: 'x', done: false }])?.id, 'x');
});

test('nextLesson is null when every lesson is done, empty, or missing', () => {
  assert.equal(nextLesson(lessons.map((lesson) => ({ ...lesson, done: true }))), null);
  assert.equal(nextLesson([]), null);
  assert.equal(nextLesson(null), null);
  assert.equal(nextLesson(undefined), null);
});

test('filterRows keeps everything for all and unknown filters', () => {
  assert.deepEqual(filterRows(rows, 'all').map((row) => row.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(filterRows(rows, 'mine').map((row) => row.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(filterRows(rows, undefined).map((row) => row.id), ['a', 'b', 'c', 'd', 'e']);
});

test('filterRows narrows to new or review status', () => {
  assert.deepEqual(filterRows(rows, 'new').map((row) => row.id), ['a', 'c']);
  assert.deepEqual(filterRows(rows, 'review').map((row) => row.id), ['b', 'e']);
});

test('filterRows tolerates missing rows and statusless entries', () => {
  assert.deepEqual(filterRows(null, 'all'), []);
  assert.deepEqual(filterRows(undefined, 'new'), []);
  assert.deepEqual(filterRows([{ id: 'a' }], 'new'), []);
});

test('upNext caps the filtered list at three by default', () => {
  assert.deepEqual(upNext(rows, 'all').map((row) => row.id), ['a', 'b', 'c']);
  assert.equal(upNext(rows, 'all').length, UP_NEXT_LIMIT);
});

test('upNext filters before it limits', () => {
  assert.deepEqual(upNext(rows, 'review').map((row) => row.id), ['b', 'e']);
  assert.deepEqual(upNext(rows, 'new').map((row) => row.id), ['a', 'c']);
  assert.deepEqual(upNext(rows, 'new', 1).map((row) => row.id), ['a']);
  assert.deepEqual(upNext(rows, 'review', 1).map((row) => row.id), ['b']);
});

test('upNext treats a zero or negative limit as no rows', () => {
  assert.deepEqual(upNext(rows, 'all', 0), []);
  assert.deepEqual(upNext(rows, 'all', -2), []);
});

test('hiddenCount counts the filtered rows beyond the first three', () => {
  assert.equal(hiddenCount(rows, 'all'), 2);
  assert.equal(hiddenCount(rows, 'new'), 0);
  assert.equal(hiddenCount(rows, 'review'), 0);
  assert.equal(hiddenCount([...rows, { id: 'f', status: 'new' }], 'new'), 0);
  assert.equal(hiddenCount([...rows, { id: 'f', status: 'new' }, { id: 'g', status: 'new' }], 'new'), 1);
  assert.equal(hiddenCount(rows, 'new', 1), 1);
  assert.equal(hiddenCount([], 'all'), 0);
});

test('seeAllLabel matches the frame wording', () => {
  assert.equal(seeAllLabel(74, 'kanji'), 'See all 74 kanji');
  assert.equal(seeAllLabel(24, 'lessons'), 'See all 24 lessons');
  assert.equal(seeAllLabel(30, 'lessons'), 'See all 30 lessons');
  assert.equal(seeAllLabel(0, 'kanji'), 'See all 0 kanji');
});

test('lessonNumberLabel zero-pads to two digits', () => {
  assert.equal(lessonNumberLabel(3), '03');
  assert.equal(lessonNumberLabel(4), '04');
  assert.equal(lessonNumberLabel(12), '12');
  assert.equal(lessonNumberLabel(0), '00');
  assert.equal(lessonNumberLabel(null), '');
  assert.equal(lessonNumberLabel(''), '');
  assert.equal(lessonNumberLabel('7'), '07');
});
