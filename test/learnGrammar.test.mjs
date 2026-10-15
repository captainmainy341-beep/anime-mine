import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultJlpt,
  dueInLevel,
  exampleHit,
  groupByJlpt,
  highlightSegments,
  levelSummary,
  lessonBatch,
  pointStatus,
  rowModel,
  stageDots,
  timecode,
  videoTitle,
} from '../src/renderer/learn/grammarModel.mjs';

const H = 3600000;

test('defaultJlpt picks the lowest level with unstarted points', () => {
  const stats = {
    N5: { total: 3, started: 3, completed: 1 },
    N4: { total: 3, started: 1, completed: 0 },
    N3: { total: 3, started: 0, completed: 0 },
  };
  assert.equal(defaultJlpt(stats), 'N4');
  assert.equal(defaultJlpt({ N5: { total: 2, started: 2 } }), 'N5');
  assert.equal(defaultJlpt(undefined), 'N5');
});

test('levelSummary reports learned, completed, unstarted and due', () => {
  assert.deepEqual(levelSummary({ total: 10, started: 4, completed: 1 }, 2), {
    total: 10,
    learned: 4,
    completed: 1,
    unstarted: 6,
    due: 2,
  });
  assert.equal(levelSummary({ total: 2, started: 5 }).unstarted, 0);
  assert.equal(levelSummary(undefined).total, 0);
});

test('lessonBatch is capped by the remaining unstarted points', () => {
  assert.equal(lessonBatch(5, 2), 2);
  assert.equal(lessonBatch(5, 40), 5);
  assert.equal(lessonBatch(5, 0), 0);
});

test('dueInLevel counts only cards in the given level', () => {
  const cards = [{ jlpt: 'N5' }, { jlpt: 'N4' }, { jlpt: 'N5' }];
  assert.equal(dueInLevel(cards, 'N5'), 2);
  assert.equal(dueInLevel([], 'N3'), 0);
});

test('groupByJlpt keeps path order within each level and ignores unknown levels', () => {
  const rows = [
    { id: 'g:a', jlpt: 'N4' },
    { id: 'g:b', jlpt: 'N5' },
    { id: 'g:c', jlpt: 'N4' },
    { id: 'g:x', jlpt: 'Z9' },
  ];
  const groups = groupByJlpt(rows);
  assert.deepEqual(groups.N4.map((r) => r.id), ['g:a', 'g:c']);
  assert.deepEqual(groups.N5.map((r) => r.id), ['g:b']);
  assert.deepEqual(groups.N3, []);
  assert.equal(groups.Z9, undefined);
});

test('stageDots marks stages up to the current one out of nine', () => {
  assert.deepEqual(stageDots(0), Array(9).fill(false));
  assert.deepEqual(stageDots(3), [true, true, true, false, false, false, false, false, false]);
  assert.deepEqual(stageDots(9), Array(9).fill(true));
});

test('rowModel labels unstarted points as New and started ones by group', () => {
  assert.deepEqual(
    rowModel({ id: 'g:a', label: '〜てもいい', sub: 'may', jlpt: 'N5', stage: 0, groupKey: null }),
    {
      id: 'g:a',
      title: '〜てもいい',
      meaning: 'may',
      stateLabel: 'New',
      groupKey: null,
      dots: Array(9).fill(false),
    },
  );
  const started = rowModel({ id: 'g:b', label: 'T', sub: 'M', stage: 5, groupKey: 'adept' });
  assert.equal(started.stateLabel, 'Adept');
  assert.equal(started.groupKey, 'adept');
  assert.equal(rowModel({ id: 'g:c', label: 'T', sub: 'M', stage: 9, groupKey: 'completed' }).stateLabel, 'Completed');
});

test('pointStatus is null for unstarted points and describes the next review otherwise', () => {
  const now = 1_000_000_000_000;
  assert.equal(pointStatus({ stage: 0 }, now), null);
  assert.deepEqual(pointStatus({ stage: 3, group: 'beginner', nextReview: now + 4 * H }, now), {
    line: 'Beginner (stage 3)',
    next: 'Next review in 4 hours',
  });
  assert.deepEqual(pointStatus({ stage: 9, group: 'completed', nextReview: null }, now), {
    line: 'Completed (stage 9)',
    next: 'No further reviews',
  });
});

test('videoTitle strips directories and the extension', () => {
  assert.equal(videoTitle('/Users/me/Anime/Show - 01.mkv'), 'Show - 01');
  assert.equal(videoTitle('C:\\Anime\\Show - 02.final.mp4'), 'Show - 02.final');
  assert.equal(videoTitle('no-extension'), 'no-extension');
  assert.equal(videoTitle('.hidden'), '.hidden');
  assert.equal(videoTitle(undefined), '');
});

test('timecode formats seconds as mm:ss', () => {
  assert.equal(timecode(0), '00:00');
  assert.equal(timecode(65.9), '01:05');
  assert.equal(timecode(3725), '62:05');
  assert.equal(timecode(-3), '00:00');
});

test('highlightSegments splits text into before, hit and after', () => {
  assert.deepEqual(highlightSegments('ここで撮ってもいい', 3, 9), [
    { text: 'ここで', hit: false },
    { text: '撮ってもいい', hit: true },
  ]);
  assert.deepEqual(highlightSegments('abcdef', 1, 3), [
    { text: 'a', hit: false },
    { text: 'bc', hit: true },
    { text: 'def', hit: false },
  ]);
});

test('highlightSegments clamps out-of-range and empty ranges', () => {
  assert.deepEqual(highlightSegments('abc', 2, 99), [
    { text: 'ab', hit: false },
    { text: 'c', hit: true },
  ]);
  assert.deepEqual(highlightSegments('abc', 1, 1), [{ text: 'abc', hit: false }]);
  assert.deepEqual(highlightSegments('abc', -5, 0), [{ text: 'abc', hit: false }]);
});

test('exampleHit locates the cloze answer only for the matching sentence', () => {
  const cloze = { ja: 'ここで写真を{{撮ってもいい|撮ってもよい}}ですか。' };
  assert.deepEqual(exampleHit(cloze, 'ここで写真を撮ってもいいですか。'), { start: 6, end: 12 });
  assert.equal(exampleHit(cloze, '別の文です。'), null);
  assert.equal(exampleHit(null, 'x'), null);
  assert.equal(exampleHit({ ja: '文だけ' }, '文だけ'), null);
});
