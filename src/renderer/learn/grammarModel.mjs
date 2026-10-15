import { clozeParts, clozeToText, formatDue, groupLabel, jlptList } from '../lib/learnView.mjs';

const SCHEDULE = 'bp';
const STAGE_COUNT = 9;

export function defaultJlpt(jlptStats = {}) {
  const level = jlptList().find((name) => {
    const { total = 0, started = 0 } = jlptStats[name] ?? {};
    return started < total;
  });
  return level ?? jlptList()[0];
}

export function levelSummary(levelStats = {}, dueCount = 0) {
  const { total = 0, started = 0, completed = 0 } = levelStats;
  return { total, learned: started, completed, unstarted: Math.max(0, total - started), due: dueCount };
}

export function lessonBatch(batchSize, unstarted) {
  return Math.max(0, Math.min(batchSize, unstarted));
}

export function dueInLevel(cards, jlpt) {
  return cards.filter((card) => card.jlpt === jlpt).length;
}

export function groupByJlpt(rows) {
  const groups = Object.fromEntries(jlptList().map((name) => [name, []]));
  for (const row of rows) {
    if (groups[row.jlpt]) groups[row.jlpt].push(row);
  }
  return groups;
}

export function stageDots(stage) {
  return Array.from({ length: STAGE_COUNT }, (_, index) => index < stage);
}

export function rowModel(row) {
  const started = Boolean(row.groupKey);
  return {
    id: row.id,
    title: row.label,
    meaning: row.sub ?? '',
    stateLabel: started ? groupLabel(SCHEDULE, row.groupKey) : 'New',
    groupKey: started ? row.groupKey : null,
    dots: stageDots(row.stage),
  };
}

export function pointStatus(card, now) {
  if (!card.stage) return null;
  const next = card.nextReview == null ? 'No further reviews' : `Next review ${formatDue(card.nextReview, now)}`;
  return { line: `${groupLabel(SCHEDULE, card.group)} (stage ${card.stage})`, next };
}

export function videoTitle(videoPath) {
  const name = String(videoPath ?? '').split(/[\\/]/).pop();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function timecode(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

export function highlightSegments(text, start, end) {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  if (from === to) return text ? [{ text, hit: false }] : [];
  return [
    { text: text.slice(0, from), hit: false },
    { text: text.slice(from, to), hit: true },
    { text: text.slice(to), hit: false },
  ].filter((part) => part.text.length > 0);
}

export function exampleHit(cloze, ja) {
  if (!cloze?.ja) return null;
  const { before, answers } = clozeParts(cloze.ja);
  const answer = answers[0] ?? '';
  if (!answer || clozeToText(cloze.ja) !== ja) return null;
  return { start: before.length, end: before.length + answer.length };
}
