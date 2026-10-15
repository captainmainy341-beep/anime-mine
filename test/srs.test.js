const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  scheduleFor,
  kindOf,
  STAGE_GROUPS,
  groupOf,
  intervalHours,
  nextReviewAt,
  startState,
  applyResult,
  isDue,
  resurrect,
  forecast,
  forecastDays,
  shiftReviews,
  countByGroup,
} = require('../src/core/srs');

const HOUR = 3600000;
const NOW = Date.UTC(2026, 9, 10, 12, 34, 56, 789);

function at(stage, overrides = {}) {
  return { ...startState('kanji', NOW), stage, ...overrides };
}

test('interval tables match the wk and bp schedules', () => {
  const stages = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(stages.map((s) => intervalHours('wk', s)), [4, 8, 24, 48, 168, 336, 720, 2880]);
  assert.deepEqual(stages.map((s) => intervalHours('bp', s)), [4, 8, 24, 48, 96, 192, 552, 1128]);
  assert.equal(intervalHours('wk', 9), null);
  assert.equal(intervalHours('bp', 9), null);
});

test('kinds map to schedules', () => {
  assert.equal(scheduleFor('grammar'), 'bp');
  assert.equal(scheduleFor('kanji'), 'wk');
  assert.equal(kindOf('r:女'), 'radical');
  assert.equal(kindOf('k:好'), 'kanji');
  assert.equal(kindOf('v:1234'), 'vocab');
  assert.equal(kindOf('g:n5-te-mo-ii'), 'grammar');
  assert.equal(kindOf('c:食べる'), 'custom');
});

test('stage groups cover stages 1-9 exactly once per schedule', () => {
  for (const groups of Object.values(STAGE_GROUPS)) {
    const stages = groups.flatMap((g) => g.stages).sort((a, b) => a - b);
    assert.deepEqual(stages, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  }
});

test('groupOf returns key and label for a stage', () => {
  assert.deepEqual(groupOf('wk', 4), { key: 'apprentice', label: 'Apprentice' });
  assert.deepEqual(groupOf('wk', 6), { key: 'guru', label: 'Guru' });
  assert.deepEqual(groupOf('wk', 9), { key: 'burned', label: 'Burned' });
  assert.deepEqual(groupOf('bp', 1), { key: 'beginner', label: 'Beginner' });
  assert.deepEqual(groupOf('bp', 9), { key: 'completed', label: 'Completed' });
});

test('nextReviewAt floors to the hour', () => {
  assert.equal(nextReviewAt('wk', 1, NOW), Date.UTC(2026, 9, 10, 16));
  assert.equal(nextReviewAt('wk', 2, NOW), Date.UTC(2026, 9, 10, 20));
  assert.equal(nextReviewAt('wk', 9, NOW), null);
});

test('startState begins at stage 1 with zeroed counters', () => {
  assert.deepEqual(startState('kanji', NOW), {
    stage: 1,
    startedAt: NOW,
    nextReview: Date.UTC(2026, 9, 10, 16),
    passedAt: null,
    burnedAt: null,
    correct: 0,
    incorrect: 0,
    streak: 0,
    lastReview: null,
  });
});

test('a correct answer advances one stage and extends the streak', () => {
  const next = applyResult('kanji', startState('kanji', NOW), { incorrectCount: 0, now: NOW });
  assert.equal(next.stage, 2);
  assert.equal(next.nextReview, Date.UTC(2026, 9, 10, 20));
  assert.equal(next.correct, 1);
  assert.equal(next.incorrect, 0);
  assert.equal(next.streak, 1);
  assert.equal(next.lastReview, NOW);
  assert.equal(next.startedAt, NOW);
});

test('a correct answer on the bp schedule uses bp intervals', () => {
  const next = applyResult('grammar', at(4), { incorrectCount: 0, now: NOW });
  assert.equal(next.stage, 5);
  assert.equal(next.nextReview, Date.UTC(2026, 9, 14, 12));
});

const WRONG_CASES = [
  [1, 1, 1], [1, 2, 1], [1, 3, 1],
  [3, 1, 2], [3, 2, 2], [3, 3, 1],
  [4, 1, 3], [4, 2, 3], [4, 3, 2],
  [5, 1, 3], [5, 2, 3], [5, 3, 1],
  [7, 1, 5], [7, 2, 5], [7, 3, 3],
];

for (const [stage, incorrectCount, expected] of WRONG_CASES) {
  test(`stage ${stage} with ${incorrectCount} wrong answer(s) drops to stage ${expected}`, () => {
    const next = applyResult('kanji', at(stage, { streak: 3, correct: 2 }), { incorrectCount, now: NOW });
    assert.equal(next.stage, expected);
    assert.equal(next.nextReview, nextReviewAt('wk', expected, NOW));
    assert.equal(next.incorrect, incorrectCount);
    assert.equal(next.correct, 2);
    assert.equal(next.streak, 0);
  });
}

test('reaching stage 9 burns the item and clears nextReview', () => {
  const next = applyResult('kanji', at(8), { incorrectCount: 0, now: NOW });
  assert.equal(next.stage, 9);
  assert.equal(next.nextReview, null);
  assert.equal(next.burnedAt, NOW);
  assert.equal(next.passedAt, NOW);
});

test('passedAt is set when stage first reaches 5 and kept afterwards', () => {
  const crossed = applyResult('kanji', at(4), { incorrectCount: 0, now: NOW });
  assert.equal(crossed.passedAt, NOW);
  const later = NOW + 24 * HOUR;
  const kept = applyResult('kanji', at(5, { passedAt: NOW }), { incorrectCount: 0, now: later });
  assert.equal(kept.stage, 6);
  assert.equal(kept.passedAt, NOW);
});

test('isDue compares nextReview with now and ignores burned items', () => {
  assert.equal(isDue(at(2, { nextReview: NOW }), NOW), true);
  assert.equal(isDue(at(2, { nextReview: NOW + 1 }), NOW), false);
  assert.equal(isDue(at(9, { nextReview: null }), NOW + 1000 * HOUR), false);
});

test('resurrect returns a burned item to stage 1 and leaves others alone', () => {
  const burned = applyResult('kanji', at(8), { incorrectCount: 0, now: NOW });
  const later = NOW + 24 * HOUR;
  const revived = resurrect('kanji', burned, later);
  assert.equal(revived.stage, 1);
  assert.equal(revived.burnedAt, null);
  assert.equal(revived.nextReview, nextReviewAt('wk', 1, later));
  assert.equal(revived.correct, burned.correct);
  assert.equal(revived.passedAt, NOW);

  const active = at(3);
  assert.deepEqual(resurrect('kanji', active, later), active);
});

test('forecast buckets by hour and counts overdue items in hour 0', () => {
  const states = {
    'k:a': at(2, { nextReview: NOW - 5 * HOUR }),
    'k:b': at(2, { nextReview: NOW + HOUR / 2 }),
    'k:c': at(2, { nextReview: NOW + 2.5 * HOUR }),
    'k:d': at(2, { nextReview: NOW + 47 * HOUR }),
    'k:e': at(2, { nextReview: NOW + 48 * HOUR }),
    'k:f': at(9, { nextReview: null }),
  };
  const result = forecast(states, NOW);
  assert.equal(result.length, 48);
  assert.deepEqual(result[0], { hourOffset: 0, count: 2 });
  assert.deepEqual(result[1], { hourOffset: 1, count: 0 });
  assert.deepEqual(result[2], { hourOffset: 2, count: 1 });
  assert.deepEqual(result[47], { hourOffset: 47, count: 1 });
  assert.equal(result.reduce((sum, b) => sum + b.count, 0), 4);

  assert.deepEqual(forecast(states, NOW, { hours: 3 }).map((b) => b.count), [2, 0, 1]);
});

test('forecastDays buckets by 24h and counts overdue items in day 0', () => {
  const states = {
    'k:a': at(2, { nextReview: NOW - HOUR }),
    'k:b': at(2, { nextReview: NOW + 10 * HOUR }),
    'k:c': at(2, { nextReview: NOW + 30 * HOUR }),
    'k:d': at(2, { nextReview: NOW + 6 * 24 * HOUR + 1 }),
    'k:e': at(2, { nextReview: NOW + 7 * 24 * HOUR }),
  };
  const result = forecastDays(states, NOW);
  assert.deepEqual(result.map((b) => b.count), [2, 1, 0, 0, 0, 0, 1]);
  assert.deepEqual(result[0], { dayOffset: 0, count: 2 });
  assert.equal(result.length, 7);
});

test('shiftReviews moves non-null nextReview values into a new map', () => {
  const map = {
    'k:a': at(2, { nextReview: NOW }),
    'k:b': at(9, { nextReview: null }),
  };
  const shifted = shiftReviews(map, 3 * HOUR);
  assert.notEqual(shifted, map);
  assert.equal(shifted['k:a'].nextReview, NOW + 3 * HOUR);
  assert.equal(shifted['k:a'].stage, 2);
  assert.equal(shifted['k:b'].nextReview, null);
  assert.equal(map['k:a'].nextReview, NOW);
});

test('countByGroup sums states per group across both schedules', () => {
  const states = {
    'k:好': at(1),
    'v:1234': at(5),
    'r:女': at(9),
    'g:n5-te': at(2),
    'g:n5-old': at(9),
  };
  assert.deepEqual(countByGroup(states), {
    apprentice: 1,
    guru: 1,
    master: 0,
    enlightened: 0,
    burned: 1,
    beginner: 1,
    adept: 0,
    seasoned: 0,
    expert: 0,
    completed: 1,
  });
});
