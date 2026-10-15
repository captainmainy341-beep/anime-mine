const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

const GROUPS = {
  wk: ['apprentice', 'guru', 'master', 'enlightened', 'burned'],
  bp: ['beginner', 'adept', 'seasoned', 'expert', 'completed'],
};
const GROUP_LABELS = {
  apprentice: 'Apprentice',
  guru: 'Guru',
  master: 'Master',
  enlightened: 'Enlightened',
  burned: 'Burned',
  beginner: 'Beginner',
  adept: 'Adept',
  seasoned: 'Seasoned',
  expert: 'Expert',
  completed: 'Completed',
};

const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];

const KIND_LABELS = {
  radical: 'Radical',
  kanji: 'Kanji',
  vocab: 'Vocabulary',
  grammar: 'Grammar',
  custom: 'Mined word',
};

function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

export function formatDue(ms, now) {
  if (ms == null) return 'never';
  const diff = ms - now;
  if (diff <= 0) return 'now';
  if (diff < HOUR) return `in ${plural(Math.max(1, Math.round(diff / MINUTE)), 'minute')}`;
  if (diff < DAY) return `in ${plural(Math.round(diff / HOUR), 'hour')}`;
  if (diff < WEEK) return `in ${plural(Math.round(diff / DAY), 'day')}`;
  if (diff < 2 * MONTH) return `in ${plural(Math.round(diff / WEEK), 'week')}`;
  return `in ${plural(Math.round(diff / MONTH), 'month')}`;
}

export function groupLabel(kind, group) {
  const groupKey = group?.key ?? group;
  const label = GROUP_LABELS[groupKey];
  if (!label) throw new Error(`Unknown group: ${groupKey}`);
  return label;
}

export function groupOrder(schedule) {
  return [...GROUPS[schedule]];
}

export function jlptList() {
  return [...JLPT];
}

function jlptRank(level) {
  const index = JLPT.indexOf(level);
  return index === -1 ? Infinity : index;
}

export function compareJlpt(a, b) {
  const ra = jlptRank(a);
  const rb = jlptRank(b);
  return ra === rb ? 0 : ra - rb;
}

export function percent(part, total) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((part * 100) / total)));
}

export function forecastBars(buckets, maxHeight) {
  const max = Math.max(0, ...buckets.map((b) => b.count));
  return buckets.map(({ label, count }) => {
    if (count === 0 || max === 0) return { label, count, height: 0 };
    return { label, count, height: Math.max(2, Math.round((count / max) * maxHeight)) };
  });
}

const CLOZE = /\{\{([^{}]*)\}\}/;

export function clozeParts(ja) {
  const match = CLOZE.exec(ja);
  if (!match) return { before: ja, after: '', answers: [] };
  return {
    before: ja.slice(0, match.index),
    after: ja.slice(match.index + match[0].length),
    answers: match[1].split('|'),
  };
}

export function clozeToText(ja) {
  const { before, after, answers } = clozeParts(ja);
  return before + (answers[0] ?? '') + after;
}

export function streakLabel(days) {
  if (!days) return 'No streak yet';
  return `${days} day streak`;
}

export function dailyHeat(daily) {
  const totals = daily.map((d) => d.reviews + d.lessons);
  const nonZero = totals.filter((t) => t > 0).sort((a, b) => a - b);
  return daily.map((d, i) => {
    const total = totals[i];
    if (total === 0) return { date: d.date, level: 0 };
    const atOrBelow = nonZero.filter((t) => t <= total).length;
    const level = Math.min(4, Math.max(1, Math.ceil((atOrBelow / nonZero.length) * 4)));
    return { date: d.date, level };
  });
}

function stripAffixMarkers(s) {
  return s.replace(/^-|-$/g, '');
}

export function readingParts(reading) {
  const dot = reading.indexOf('.');
  if (dot !== -1) {
    return {
      stem: stripAffixMarkers(reading.slice(0, dot)),
      okurigana: stripAffixMarkers(reading.slice(dot + 1)),
    };
  }
  if (reading.startsWith('-')) return { stem: '', okurigana: stripAffixMarkers(reading) };
  return { stem: stripAffixMarkers(reading), okurigana: '' };
}

export function kindLabel(kind) {
  const label = KIND_LABELS[kind];
  if (!label) throw new Error(`Unknown kind: ${kind}`);
  return label;
}
