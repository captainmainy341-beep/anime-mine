import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDue, groupLabel, groupOrder, jlptList, compareJlpt, percent, forecastBars,
  clozeParts, clozeToText, streakLabel, dailyHeat, readingParts, kindLabel,
} from '../src/renderer/lib/learnView.mjs';

const H = 3600000;
const D = 24 * H;

test('formatDue: never, now, and largest sensible unit', () => {
  const now = 1_000_000_000_000;
  assert.equal(formatDue(null, now), 'never');
  assert.equal(formatDue(now, now), 'now');
  assert.equal(formatDue(now - H, now), 'now');
  assert.equal(formatDue(now + 30 * 60000, now), 'in 30 minutes');
  assert.equal(formatDue(now + H, now), 'in 1 hour');
  assert.equal(formatDue(now + 4 * H, now), 'in 4 hours');
  assert.equal(formatDue(now + D, now), 'in 1 day');
  assert.equal(formatDue(now + 3 * D, now), 'in 3 days');
  assert.equal(formatDue(now + 14 * D, now), 'in 2 weeks');
  assert.equal(formatDue(now + 7 * D, now), 'in 1 week');
  assert.equal(formatDue(now + 30 * D, now), 'in 4 weeks');
  assert.equal(formatDue(now + 120 * D, now), 'in 4 months');
});

test('groupLabel and groupOrder', () => {
  assert.equal(groupLabel('wk', 'apprentice'), 'Apprentice');
  assert.equal(groupLabel('bp', 'seasoned'), 'Seasoned');
  assert.equal(groupLabel('wk', { key: 'apprentice', label: 'Apprentice' }), 'Apprentice');
  assert.equal(groupLabel('bp', { key: 'completed', label: 'Completed' }), 'Completed');
  assert.throws(() => groupLabel('wk', 'nope'));
  assert.deepEqual(groupOrder('wk'), ['apprentice', 'guru', 'master', 'enlightened', 'burned']);
  assert.deepEqual(groupOrder('bp'), ['beginner', 'adept', 'seasoned', 'expert', 'completed']);
});

test('jlptList and compareJlpt sort easiest first', () => {
  assert.deepEqual(jlptList(), ['N5', 'N4', 'N3', 'N2', 'N1']);
  assert.deepEqual(['N1', 'N3', 'N5'].sort(compareJlpt), ['N5', 'N3', 'N1']);
  assert.equal(compareJlpt('N2', 'N2'), 0);
  assert.ok(compareJlpt('N5', 'N1') < 0);
});

test('percent is integer and clamped', () => {
  assert.equal(percent(1, 3), 33);
  assert.equal(percent(2, 3), 67);
  assert.equal(percent(5, 0), 0);
  assert.equal(percent(9, 3), 100);
});

test('forecastBars scales to max with minimum height 2 for non-zero', () => {
  const bars = forecastBars([
    { label: 'Mon', count: 0 },
    { label: 'Tue', count: 1 },
    { label: 'Wed', count: 10 },
    { label: 'Thu', count: 5 },
  ], 10);
  assert.deepEqual(bars, [
    { label: 'Mon', count: 0, height: 0 },
    { label: 'Tue', count: 1, height: 2 },
    { label: 'Wed', count: 10, height: 10 },
    { label: 'Thu', count: 5, height: 5 },
  ]);
  assert.deepEqual(forecastBars([{ label: 'a', count: 0 }], 50), [{ label: 'a', count: 0, height: 0 }]);
});

test('clozeParts and clozeToText use the single marker', () => {
  const ja = 'ここで写真を{{撮ってもいい|撮ってもよい}}ですか。';
  assert.deepEqual(clozeParts(ja), {
    before: 'ここで写真を',
    after: 'ですか。',
    answers: ['撮ってもいい', '撮ってもよい'],
  });
  assert.equal(clozeToText(ja), 'ここで写真を撮ってもいいですか。');
});

test('streakLabel', () => {
  assert.equal(streakLabel(0), 'No streak yet');
  assert.equal(streakLabel(1), '1 day streak');
  assert.equal(streakLabel(12), '12 day streak');
});

test('dailyHeat quartiles among non-zero days', () => {
  const daily = [
    { date: '2026-10-01', reviews: 0, lessons: 0 },
    { date: '2026-10-02', reviews: 1, lessons: 0 },
    { date: '2026-10-03', reviews: 2, lessons: 0 },
    { date: '2026-10-04', reviews: 3, lessons: 1 },
    { date: '2026-10-05', reviews: 10, lessons: 10 },
  ];
  assert.deepEqual(dailyHeat(daily).map((d) => d.level), [0, 1, 2, 3, 4]);
  assert.deepEqual(dailyHeat(daily)[0], { date: '2026-10-01', level: 0 });
});

test('readingParts splits okurigana and affixes', () => {
  assert.deepEqual(readingParts('この.む'), { stem: 'この', okurigana: 'む' });
  assert.deepEqual(readingParts('-ず'), { stem: '', okurigana: 'ず' });
  assert.deepEqual(readingParts('こう'), { stem: 'こう', okurigana: '' });
  assert.deepEqual(readingParts('おお-'), { stem: 'おお', okurigana: '' });
});

test('kindLabel', () => {
  assert.equal(kindLabel('radical'), 'Radical');
  assert.equal(kindLabel('kanji'), 'Kanji');
  assert.equal(kindLabel('vocab'), 'Vocabulary');
  assert.equal(kindLabel('grammar'), 'Grammar');
  assert.equal(kindLabel('custom'), 'Mined word');
  assert.throws(() => kindLabel('nope'));
});
