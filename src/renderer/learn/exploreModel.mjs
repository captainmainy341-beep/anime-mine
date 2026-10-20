// Explore model, shared by Explore Kanji / Vocab / Grammar (slice S2).
// Pure helpers only: no DOM, no IPC. Signatures are frozen in docs/manga-ink-contracts.md.

export const EXPLORE_FILTERS = [['all', 'All'], ['new', 'New'], ['review', 'Review']];
export const UP_NEXT_LIMIT = 3;

// First lesson that is not done yet; null when the whole set is finished (or empty).
export function nextLesson(lessons) {
  if (!Array.isArray(lessons)) return null;
  return lessons.find((lesson) => lesson && !lesson.done) ?? null;
}

// 'all' (and any unknown filter) keeps every row; 'new' / 'review' keep that status only.
export function filterRows(rows, filter) {
  const list = Array.isArray(rows) ? rows : [];
  if (filter === 'new') return list.filter((row) => row?.status === 'new');
  if (filter === 'review') return list.filter((row) => row?.status === 'review');
  return list.slice();
}

export function upNext(rows, filter, limit = UP_NEXT_LIMIT) {
  return filterRows(rows, filter).slice(0, normaliseLimit(limit));
}

export function hiddenCount(rows, filter, limit = UP_NEXT_LIMIT) {
  return Math.max(0, filterRows(rows, filter).length - normaliseLimit(limit));
}

export function seeAllLabel(total, noun) {
  const count = Number.isFinite(Number(total)) ? Number(total) : 0;
  const label = noun == null ? '' : String(noun).trim();
  return `See all ${count}${label ? ` ${label}` : ''}`;
}

// 6 -> '06', 12 -> '12'. Empty/invalid input stays empty rather than printing 'NaN'.
export function lessonNumberLabel(n) {
  if (n == null || n === '') return '';
  const value = Number(n);
  if (!Number.isFinite(value)) return '';
  const whole = Math.trunc(value);
  return String(whole).padStart(2, '0');
}

function normaliseLimit(limit) {
  const value = Number(limit);
  if (!Number.isFinite(value)) return UP_NEXT_LIMIT;
  return Math.max(0, Math.trunc(value));
}
