const HOUR_MS = 3600000;
const BURNED = 9;
const PASSED = 5;

const HOURS = {
  wk: [4, 8, 24, 48, 168, 336, 720, 2880],
  bp: [4, 8, 24, 48, 96, 192, 552, 1128],
};

const STAGE_GROUPS = {
  wk: [
    { key: 'apprentice', label: 'Apprentice', stages: [1, 2, 3, 4] },
    { key: 'guru', label: 'Guru', stages: [5, 6] },
    { key: 'master', label: 'Master', stages: [7] },
    { key: 'enlightened', label: 'Enlightened', stages: [8] },
    { key: 'burned', label: 'Burned', stages: [9] },
  ],
  bp: [
    { key: 'beginner', label: 'Beginner', stages: [1, 2, 3, 4] },
    { key: 'adept', label: 'Adept', stages: [5, 6] },
    { key: 'seasoned', label: 'Seasoned', stages: [7] },
    { key: 'expert', label: 'Expert', stages: [8] },
    { key: 'completed', label: 'Completed', stages: [9] },
  ],
};

const KIND_BY_PREFIX = { r: 'radical', k: 'kanji', v: 'vocab', g: 'grammar', c: 'custom' };

function scheduleFor(kind) {
  return kind === 'grammar' ? 'bp' : 'wk';
}

function kindOf(id) {
  return KIND_BY_PREFIX[id.slice(0, id.indexOf(':'))];
}

function groupOf(schedule, stage) {
  const { key, label } = STAGE_GROUPS[schedule].find((group) => group.stages.includes(stage));
  return { key, label };
}

function intervalHours(schedule, stage) {
  return HOURS[schedule][stage - 1] ?? null;
}

function nextReviewAt(schedule, stage, now) {
  const hours = intervalHours(schedule, stage);
  if (hours === null) return null;
  return Math.floor((now + hours * HOUR_MS) / HOUR_MS) * HOUR_MS;
}

function startState(kind, now) {
  return {
    stage: 1,
    startedAt: now,
    nextReview: nextReviewAt(scheduleFor(kind), 1, now),
    passedAt: null,
    burnedAt: null,
    correct: 0,
    incorrect: 0,
    streak: 0,
    lastReview: null,
  };
}

function stageAfter(stage, incorrectCount) {
  if (incorrectCount === 0) return Math.min(stage + 1, BURNED);
  const penalty = Math.ceil(incorrectCount / 2) * (stage >= PASSED ? 2 : 1);
  return Math.max(1, stage - penalty);
}

function applyResult(kind, state, { incorrectCount, now }) {
  const stage = stageAfter(state.stage, incorrectCount);
  return {
    ...state,
    stage,
    nextReview: nextReviewAt(scheduleFor(kind), stage, now),
    passedAt: state.passedAt ?? (stage >= PASSED ? now : null),
    burnedAt: state.burnedAt ?? (stage === BURNED ? now : null),
    correct: state.correct + (incorrectCount === 0 ? 1 : 0),
    incorrect: state.incorrect + incorrectCount,
    streak: incorrectCount === 0 ? state.streak + 1 : 0,
    lastReview: now,
  };
}

function isDue(state, now) {
  return state.nextReview !== null && state.nextReview <= now;
}

function resurrect(kind, state, now) {
  if (state.stage !== BURNED) return state;
  return {
    ...state,
    stage: 1,
    burnedAt: null,
    nextReview: nextReviewAt(scheduleFor(kind), 1, now),
  };
}

function bucketDue(states, now, bucketMs, count) {
  const counts = new Array(count).fill(0);
  for (const state of Object.values(states)) {
    if (state.nextReview === null) continue;
    const offset = Math.max(0, Math.floor((state.nextReview - now) / bucketMs));
    if (offset < count) counts[offset] += 1;
  }
  return counts;
}

function forecast(states, now, { hours = 48 } = {}) {
  return bucketDue(states, now, HOUR_MS, hours).map((count, hourOffset) => ({ hourOffset, count }));
}

function forecastDays(states, now, days = 7) {
  return bucketDue(states, now, 24 * HOUR_MS, days).map((count, dayOffset) => ({ dayOffset, count }));
}

function shiftReviews(states, deltaMs) {
  return Object.fromEntries(
    Object.entries(states).map(([id, state]) => [
      id,
      { ...state, nextReview: state.nextReview === null ? null : state.nextReview + deltaMs },
    ]),
  );
}

function countByGroup(states, scheduleOf = (id) => scheduleFor(kindOf(id))) {
  const counts = {};
  for (const groups of Object.values(STAGE_GROUPS)) {
    for (const { key } of groups) counts[key] = 0;
  }
  for (const [id, state] of Object.entries(states)) {
    counts[groupOf(scheduleOf(id), state.stage).key] += 1;
  }
  return counts;
}

module.exports = {
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
};
