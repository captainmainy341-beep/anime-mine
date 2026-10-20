import { clozeParts, clozeToText, formatDue, groupLabel, jlptList } from '../lib/learnView.mjs';
import { lessonNumberLabel, nextLesson } from './exploreModel.mjs';

const SCHEDULE = 'bp';
const STAGE_COUNT = 9;

// Explore batches grammar points by the learner's lesson size (settings.lessonBatch); 3 is the frame default.
export const GRAMMAR_BATCH_SIZE = 3;

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

/* ------------------------------------------------------------------ *
 * Explore Grammar: lessons are consecutive batches of the level's
 * grammar points. These helpers stay pure so the screen only wires data.
 * ------------------------------------------------------------------ */

const LESSON_THEME_RULES = [
  { label: 'Past', key: 'ました', topic: 'Verbs', test: /ました|でした|だった/ },
  { label: 'Wanting', key: 'たい', topic: 'Verbs', test: /たい/ },
  { label: 'Wanting', key: 'ほしい', topic: 'Verbs', test: /ほしい/ },
  { label: 'Suggestions', key: 'ましょうか', topic: 'Verbs', test: /ましょうか/ },
  { label: 'Invite', key: 'ませんか', topic: 'Verbs', test: /ませんか/ },
  { label: 'Suggest', key: 'ましょう', topic: 'Verbs', test: /ましょう/ },
  { label: 'Request', key: 'ください', topic: 'Verbs', test: /ください/ },
  { label: 'Request', key: 'なさい', topic: 'Verbs', test: /なさい/ },
  { label: 'Asking', key: 'か', topic: 'Questions', test: /でしょうか|かどうか|〜か$|？|\?/ },
  { label: 'Negative', key: 'ない', topic: 'Verbs', test: /ない|ません/ },
  { label: 'Te-form', key: 'て', topic: 'Verbs', test: /ています|てください|てから|ておく|てある|てしまう|てみる|ていく|てくる|てあげる|てくれる|てもらう|てたまらない|てしかたがない/ },
  { label: 'Past', key: 'た', topic: 'Verbs', test: /〜た/ },
  { label: 'Topic', key: 'は', topic: 'Particles', test: /〜は/ },
  { label: 'Subject', key: 'が', topic: 'Particles', test: /〜が/ },
  { label: 'Object', key: 'を', topic: 'Particles', test: /〜を/ },
  { label: 'Time', key: 'に', topic: 'Particles', test: /〜に/ },
  { label: 'Place', key: 'で', topic: 'Particles', test: /〜で/ },
  { label: 'Possessive', key: 'の', topic: 'Particles', test: /〜の/ },
  { label: 'Together', key: 'と', topic: 'Particles', test: /〜と/ },
  { label: 'Also', key: 'も', topic: 'Particles', test: /〜も/ },
  { label: 'From', key: 'から', topic: 'Particles', test: /〜から/ },
  { label: 'Until', key: 'まで', topic: 'Particles', test: /〜まで/ },
  { label: 'Limits', key: 'だけ', topic: 'Particles', test: /〜だけ/ },
  { label: 'Compare', key: 'より', topic: 'Particles', test: /〜より/ },
  { label: 'Lists', key: 'や', topic: 'Particles', test: /〜や/ },
  { label: 'Tag', key: 'ね', topic: 'Particles', test: /〜ね/ },
  { label: 'Emphasis', key: 'よ', topic: 'Particles', test: /〜よ/ },
];

// Lesson size from Learn settings; invalid or missing values fall back to the frame's 3.
export function grammarBatchSize(settings) {
  const value = typeof settings === 'number' ? settings : settings?.lessonBatch;
  if (!Number.isInteger(value) || value < 1 || value > 50) return GRAMMAR_BATCH_SIZE;
  return value;
}

// Frame-style pattern tiles: short labels keep their parenthetical disambiguator; long ones drop
// alternatives and notes first (〜は〜です -> AはBです, 〜で（場所） -> Aで（場所）,
// 〜ませんでした / 〜なかった -> Aませんでした). Then the 〜 slots become A, B, C.
export function patternLabel(label) {
  const raw = String(label ?? '').trim();
  const short = raw
    .replace(/[（(][^）)]*[）)]/g, '')
    .split(' / ')[0]
    .split('／')[0]
    .trim();
  let slot = 0;
  return (raw.length <= 8 ? raw : short).replace(/〜/g, () => {
    const letter = String.fromCharCode(65 + Math.min(slot, 25));
    slot += 1;
    return letter;
  });
}

// Topic is read off the first recognisable pattern in the batch ("Past: ました", "Verbs").
export function grammarLessonTheme(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const label = String(row?.label ?? '');
    if (!label) continue;
    const rule = LESSON_THEME_RULES.find((entry) => entry.test.test(label));
    if (rule) return { title: `${rule.label}: ${rule.key}`, topic: rule.topic };
  }
  const fallback = String(list.find((row) => row?.label)?.label ?? 'Patterns');
  return { title: fallback, topic: 'Patterns' };
}

// A lesson is new (nothing started), review (partly started or due) or learned (all started).
export function grammarLessonStatus(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 'new';
  const started = list.filter((row) => Number(row?.stage) > 0).length;
  if (list.some((row) => row?.due === true)) return 'review';
  if (started === 0) return 'new';
  return started === list.length ? 'learned' : 'review';
}

// One lesson's reading time: two minutes per pattern plus two to settle in.
export function grammarLessonMinutes(count) {
  return count > 0 ? count * 2 + 2 : 0;
}

export function grammarLessons(rows, batchSize = GRAMMAR_BATCH_SIZE) {
  const list = Array.isArray(rows) ? rows : [];
  const size = grammarBatchSize(batchSize);
  const lessons = [];
  for (let start = 0; start < list.length; start += size) {
    const batch = list.slice(start, start + size);
    const number = lessons.length + 1;
    const status = grammarLessonStatus(batch);
    const theme = grammarLessonTheme(batch);
    const minutes = grammarLessonMinutes(batch.length);
    const labels = batch.map((row) => String(row?.label ?? '')).filter(Boolean);
    const started = batch.filter((row) => Number(row?.stage) > 0).length;
    lessons.push({
      id: `grammar:lesson:${number}`,
      number,
      jlpt: batch[0]?.jlpt ?? null,
      ids: batch.map((row) => row?.id).filter(Boolean),
      labels,
      patternLabels: labels.map(patternLabel),
      count: batch.length,
      minutes,
      status,
      done: batch.length > 0 && started === batch.length,
      isNew: status === 'new',
      topic: theme.topic,
      rowTitle: theme.title,
      rowSub: `${theme.topic} · ${minutes} min`,
      title: `Lesson ${number}`,
      meta: `${theme.topic} · ${batch.length} patterns · ${minutes} min`,
    });
  }
  return lessons;
}

// Explore props data: the next lesson plus the lessons that follow it (the view applies the filter).
export function grammarExplore(lessons, { cards = [], filter = 'all' } = {}) {
  const list = Array.isArray(lessons) ? lessons : [];
  const total = list.length;
  const done = list.filter((lesson) => lesson.done).length;
  const next = nextLesson(list);
  const nextIndex = next ? list.indexOf(next) : -1;
  const following = nextIndex >= 0 ? list.slice(nextIndex + 1) : [];
  const cardTitles = (Array.isArray(cards) ? cards : [])
    .map((card) => card?.title)
    .filter((title) => typeof title === 'string' && title.trim().length > 0);
  const preview = next
    ? next.labels.map((label, index) => patternLabel(cardTitles[index] ?? label))
    : [];
  return {
    total,
    done,
    filter,
    next: next
      ? {
          id: next.id,
          number: next.number,
          title: next.title,
          meta: next.meta,
          preview,
          previewKind: 'text',
          isNew: next.isNew,
          done: next.done,
          ids: next.ids.slice(),
          firstId: next.ids[0] ?? null,
        }
      : null,
    rows: following.map((lesson) => ({
      id: lesson.id,
      tile: lessonNumberLabel(lesson.number),
      tileKind: 'number',
      title: lesson.rowTitle,
      sub: lesson.rowSub,
      status: lesson.status,
      firstId: lesson.ids[0] ?? null,
    })),
    header: { label: `${done} OF ${total} DONE`, value: done, max: total },
    progress: { label: 'LESSONS DONE', value: done, max: total },
    seeAll: { total, noun: 'lessons' },
    emptyText: total ? 'All caught up' : 'No grammar lessons yet.',
  };
}
