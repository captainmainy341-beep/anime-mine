import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityStats, heatmapLevel, heatmapModel } from '../src/renderer/lib/ankiView.mjs';

// Wednesday 20 May 2026, local midnight. May 2026 starts on a Friday, so the grid's
// last column starts Monday 18 May and today sits in row 2 (Wednesday).
const TODAY = new Date(2026, 4, 20);

const day = (year, month, date) => new Date(year, month - 1, date);
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const review = (date, count) => ({ date: iso(date), count });
const reviewsOn = (...dates) => dates.map((date) => review(date, 3));

test('heatmapLevel is 0 for no reviews or no maximum', () => {
  assert.equal(heatmapLevel(0, 10), 0);
  assert.equal(heatmapLevel(-2, 10), 0);
  assert.equal(heatmapLevel(4, 0), 0);
  assert.equal(heatmapLevel(4, -1), 0);
  assert.equal(heatmapLevel(null, 10), 0);
  assert.equal(heatmapLevel(Number.NaN, 10), 0);
});

test('heatmapLevel splits the maximum into thirds', () => {
  assert.equal(heatmapLevel(1, 30), 1);
  assert.equal(heatmapLevel(10, 30), 1);
  assert.equal(heatmapLevel(11, 30), 2);
  assert.equal(heatmapLevel(20, 30), 2);
  assert.equal(heatmapLevel(21, 30), 3);
  assert.equal(heatmapLevel(30, 30), 3);
  assert.equal(heatmapLevel(1, 1), 3);
  assert.equal(heatmapLevel(1, 2), 2);
});

test('heatmapModel returns 53 Monday-first weeks of seven cells', () => {
  const model = heatmapModel([], TODAY);
  assert.equal(model.weeks.length, 53);
  assert.ok(model.weeks.every((week) => week.length === 7));
  for (const week of model.weeks) {
    assert.equal(new Date(`${week[0].date}T12:00:00`).getDay(), 1, 'row 0 is a Monday');
  }
  assert.equal(new Date(`${model.weeks[0][6].date}T12:00:00`).getDay(), 0, 'row 6 is a Sunday');
  assert.equal(model.max, 0);
  assert.ok(model.weeks.flat().every((cell) => cell.level === 0 && cell.count === 0));
});

test('heatmapModel flags today, future cells and fills the grid with the real dates', () => {
  const model = heatmapModel([], TODAY);
  const cells = model.weeks.flat();
  const today = cells.find((cell) => cell.isToday);
  assert.ok(today, 'today is in the grid');
  assert.equal(today.date, '2026-05-20');
  assert.equal(today.future, false);
  assert.equal(cells.filter((cell) => cell.isToday).length, 1);

  const future = cells.filter((cell) => cell.future);
  assert.deepEqual(future.map((cell) => cell.date), ['2026-05-21', '2026-05-22', '2026-05-23', '2026-05-24']);
  assert.ok(future.every((cell) => cell.count === 0 && cell.level === 0));
  assert.equal(cells.filter((cell) => !cell.future).length, cells.length - 4);

  const last = model.weeks[52];
  assert.deepEqual(last.map((cell) => cell.date), [
    '2026-05-18',
    '2026-05-19',
    '2026-05-20',
    '2026-05-21',
    '2026-05-22',
    '2026-05-23',
    '2026-05-24',
  ]);
  assert.equal(model.weeks[0][0].date, '2025-05-19');
});

test('heatmapModel maps review counts to cells, scales levels and ignores future days', () => {
  const model = heatmapModel(
    [
      review(day(2026, 5, 20), 9),
      review(day(2026, 5, 19), 4),
      review(day(2026, 5, 18), 1),
      review(day(2026, 5, 21), 100),
    ],
    TODAY,
  );
  assert.equal(model.max, 9, 'future counts never widen the scale');
  const cells = new Map(model.weeks.flat().map((cell) => [cell.date, cell]));
  assert.equal(cells.get('2026-05-20').count, 9);
  assert.equal(cells.get('2026-05-20').level, 3);
  assert.equal(cells.get('2026-05-19').level, 2);
  assert.equal(cells.get('2026-05-18').level, 1);
  assert.equal(cells.get('2026-05-21').count, 0, 'a future day drops its count');
  assert.equal(cells.get('2026-05-17').level, 0);
});

test('heatmapModel labels each month once, in column order', () => {
  const { months } = heatmapModel([], TODAY);
  assert.ok(months.length >= 11, 'a year of weeks names every month');
  assert.ok(months.every((month) => /^[A-Z][a-z]{2}$/.test(month.label)));
  const columns = months.map((month) => month.column);
  assert.deepEqual(columns, [...columns].sort((a, b) => a - b));
  assert.equal(new Set(columns).size, columns.length);
  assert.ok(columns.every((column) => column >= 0 && column < 53));
  // 53 weeks spans 13 month changes at most; the first partial month may be skipped.
  assert.ok(months.length <= 13);
  assert.equal(months.at(-1).label, 'May');
});

test('heatmapModel tolerates malformed rows and duplicate dates', () => {
  const model = heatmapModel(
    [
      null,
      { date: 'nope', count: 4 },
      { date: '2026-02-31', count: 4 },
      { date: '2026-05-20', count: 2 },
      { date: '2026-05-20', count: 5 },
      { date: '2026-05-19', count: -3 },
    ],
    TODAY,
  );
  const cells = new Map(model.weeks.flat().map((cell) => [cell.date, cell]));
  assert.equal(cells.get('2026-05-20').count, 5);
  assert.equal(cells.get('2026-05-19').count, 0);
  assert.equal(model.max, 5);
});

test('activityStats counts a streak ending today', () => {
  const stats = activityStats(reviewsOn(day(2026, 5, 20), day(2026, 5, 19), day(2026, 5, 18)), TODAY);
  assert.equal(stats.streak, 3);
});

test('activityStats keeps the streak when today has no review yet', () => {
  const stats = activityStats(reviewsOn(day(2026, 5, 19), day(2026, 5, 18)), TODAY);
  assert.equal(stats.streak, 2);
});

test('activityStats breaks the streak on a missing day and reports 0 when neither day has reviews', () => {
  assert.equal(activityStats(reviewsOn(day(2026, 5, 20), day(2026, 5, 18)), TODAY).streak, 1);
  assert.equal(activityStats(reviewsOn(day(2026, 5, 17)), TODAY).streak, 0);
  assert.equal(activityStats([], TODAY).streak, 0);
});

test('activityStats computes daysLearnedPct and dailyAverage from the first review in the window', () => {
  const reviews = [
    review(day(2026, 5, 20), 10),
    review(day(2026, 5, 18), 20),
    review(day(2026, 5, 14), 30),
  ];
  const stats = activityStats(reviews, TODAY);
  // 14 May .. 20 May inclusive = 7 days, 3 with reviews, 60 reviews total.
  assert.equal(stats.streak, 1);
  assert.equal(stats.daysLearnedPct, 43);
  assert.equal(stats.dailyAverage, 9);
});

test('activityStats counts a single day as 100% learned', () => {
  const stats = activityStats([review(day(2026, 5, 20), 41)], TODAY);
  assert.deepEqual(stats, { streak: 1, daysLearnedPct: 100, dailyAverage: 41 });
});

test('activityStats ignores reviews older than a year and future reviews', () => {
  const stats = activityStats(
    [
      review(day(2025, 5, 20), 50), // 365 days before today: still outside the 365-day window
      review(day(2026, 5, 15), 4),
      review(day(2026, 5, 21), 99), // tomorrow: not counted
    ],
    TODAY,
  );
  // Window starts 2025-05-21, so 15 May 2026 is the first counted day: 6 days, 1 with reviews.
  assert.equal(stats.daysLearnedPct, 17);
  assert.equal(stats.dailyAverage, 1);
  assert.equal(stats.streak, 0);
});

test('activityStats returns zeros for empty or missing input', () => {
  assert.deepEqual(activityStats([], TODAY), { streak: 0, daysLearnedPct: 0, dailyAverage: 0 });
  assert.deepEqual(activityStats(undefined, TODAY), { streak: 0, daysLearnedPct: 0, dailyAverage: 0 });
  assert.deepEqual(activityStats(null, TODAY), { streak: 0, daysLearnedPct: 0, dailyAverage: 0 });
});

test('activityStats and heatmapModel both accept a date string as today', () => {
  const model = heatmapModel([], '2026-05-20');
  assert.equal(model.weeks.flat().find((cell) => cell.isToday).date, '2026-05-20');
  assert.equal(activityStats([review(day(2026, 5, 20), 4)], '2026-05-20').streak, 1);
});
