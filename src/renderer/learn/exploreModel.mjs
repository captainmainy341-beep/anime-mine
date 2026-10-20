// STUB - owned by slice S2 (see docs/manga-ink-contracts.md). Signatures are frozen.
export const EXPLORE_FILTERS = [['all', 'All'], ['new', 'New'], ['review', 'Review']];
export const UP_NEXT_LIMIT = 3;
export function nextLesson(lessons) { return (lessons ?? []).find((l) => !l.done) ?? null; }
export function filterRows(rows, filter) { return rows ?? []; }
export function upNext(rows, filter, limit = UP_NEXT_LIMIT) { return filterRows(rows, filter).slice(0, limit); }
export function hiddenCount(rows, filter, limit = UP_NEXT_LIMIT) { return Math.max(0, filterRows(rows, filter).length - limit); }
export function seeAllLabel(total, noun) { return `See all ${total} ${noun}`; }
export function lessonNumberLabel(n) { return String(n).padStart(2, '0'); }
