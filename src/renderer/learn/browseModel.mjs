import { percent } from '../lib/learnView.mjs';

export const TYPE_FILTERS = [
  ['radical', 'Radicals'],
  ['kanji', 'Kanji'],
  ['vocab', 'Vocabulary'],
  ['custom', 'Mined words'],
];
export const DEFAULT_TYPE = 'kanji';

// Explore (Manga Ink) data shaping. Everything in this section is pure so the Kanji / Vocab screens can be
// tested without a DOM: the caller passes real learn:levels / learn:browse / learn:card shapes in.
export const EXPLORE_TYPES = ['kanji', 'vocab'];
export const DEFAULT_BATCH = 5;
export const PASS_STAGE = 5;
export const UP_NEXT_ROWS = 3;
export const LOCKED_KANJI_TEXT = 'Locked · unlocks after radicals';
export const NOTHING_TO_START_TITLE = 'Nothing to start yet';

export function tileModel(item) {
  const classes = ['learn-tile', item.groupKey ? `learn-tile-${item.groupKey}` : 'learn-tile-new'];
  if (item.locked) classes.push('learn-tile-locked');
  return {
    id: item.id,
    label: item.label,
    sub: item.sub ?? '',
    locked: Boolean(item.locked),
    className: classes.join(' '),
  };
}

export function levelProgress(row) {
  const { passed, total } = row.kanji;
  return {
    level: row.level,
    passed,
    total,
    percent: percent(passed, total),
    current: Boolean(row.current),
    locked: Boolean(row.locked),
  };
}

export function parseMeanings(text) {
  return String(text ?? '')
    .split(/[,;，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function addWordPayload({ word, reading, meaning, sentence }) {
  const text = String(word ?? '').trim();
  const kana = String(reading ?? '').trim();
  const meanings = parseMeanings(meaning);
  if (!text) throw new Error('Enter the word.');
  if (!kana) throw new Error('Enter the reading.');
  if (!meanings.length) throw new Error('Enter at least one meaning.');
  const ja = String(sentence ?? '').trim();
  return { word: text, kana: [kana], meanings, sentence: ja ? { ja } : null };
}

// ---------------------------------------------------------------- Explore: shared helpers

export function exploreType(type) {
  return type === 'vocab' ? 'vocab' : 'kanji';
}

// learn.settingsGet().lessonBatch is 5 by default and 1..50 in the store; anything else falls back to 5.
export function batchSize(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 50 ? value : DEFAULT_BATCH;
}

// A browse row is 'new' until it has an SRS stage, 'review' below Guru and 'learned' from Guru on (PASS_STAGE).
export function rowStatus(row) {
  const stage = Number(row?.stage ?? 0);
  if (stage >= PASS_STAGE) return 'learned';
  if (stage >= 1) return 'review';
  return 'new';
}

function isPassed(row) {
  return Number(row?.stage ?? 0) >= PASS_STAGE;
}

// learnStore.isAvailable starts items it has never seen before: unlocked, not started. Anything with a stage of
// 1..4 is already in review and belongs to the review queue, not to a new lesson.
function isTeachable(row) {
  return !row?.locked && Number(row?.stage ?? 0) === 0;
}

// Everything the Explore model was built from is "in scope": the current kanji level's rows, or the unfinished
// vocab levels' rows. A locked row has never been started, so it counts as pending too.
export function hasPendingItems(rows) {
  return (rows ?? []).some((row) => row?.locked || Number(row?.stage ?? 0) === 0);
}

// Explore's empty-state heading is the view's default ("All caught up") only when everything in scope is started
// or learned. A level that still holds locked or unstarted items has nothing to start *yet*, so say that instead.
export function emptyTitleFor(rows) {
  return hasPendingItems(rows) ? NOTHING_TO_START_TITLE : undefined;
}

// emptyTitle is only meaningful when there is no lesson; leave it unset (view default) otherwise and when caught up.
function emptyTitlePatch(lesson, rows) {
  if (lesson) return {};
  const title = emptyTitleFor(rows);
  return title ? { emptyTitle: title } : {};
}

export function numberTile(n) {
  const value = Math.max(1, Math.trunc(Number(n)) || 1);
  return String(value).padStart(2, '0');
}

// About one minute per kanji. Words come in a little faster than one a minute, matching the frames (8 words ≈ 5 min).
export function minutesFor(type, count) {
  const n = Math.max(0, Math.trunc(Number(count)) || 0);
  if (!n) return 0;
  return exploreType(type) === 'vocab' ? Math.max(1, Math.round(n * 0.65)) : Math.max(1, Math.round(n));
}

export function wordsLabel(count) {
  const n = Math.max(0, Math.trunc(Number(count)) || 0);
  return `${n} ${n === 1 ? 'word' : 'words'}`;
}

export function kanjiLabel(count) {
  const n = Math.max(0, Math.trunc(Number(count)) || 0);
  return `${n} kanji`;
}

export function lessonMeta({ levelLabel, count, type }) {
  const noun = exploreType(type) === 'vocab' ? wordsLabel(count) : kanjiLabel(count);
  return `${levelLabel} · ${noun} · about ${minutesFor(type, count)} min`;
}

export function seeAllRoute(type) {
  return exploreType(type) === 'vocab'
    ? { view: 'vocab', arg: { all: true } }
    : { view: 'levels', arg: { type: 'kanji', all: true } };
}

// Level rows carry no topic names today; if the study pack ever adds one, the lesson meta uses it.
export function levelName(row) {
  const name = row?.name ?? row?.title;
  if (typeof name === 'string' && name.trim()) return name.trim();
  return `Level ${row?.level ?? 1}`;
}

export function tally(rows, key) {
  return (rows ?? []).reduce(
    (acc, row) => {
      const t = row?.[key] ?? {};
      return {
        total: acc.total + Number(t.total ?? 0),
        started: acc.started + Number(t.started ?? 0),
        passed: acc.passed + Number(t.passed ?? 0),
      };
    },
    { total: 0, started: 0, passed: 0 },
  );
}

export function kanjiTotals(levels) {
  return tally(levels, 'kanji');
}

export function vocabTotals(levels) {
  return tally(levels, 'vocab');
}

export function currentLevelRow(levels) {
  const rows = levels ?? [];
  return rows.find((row) => row.current) ?? [...rows].reverse().find((row) => !row.locked) ?? rows[0] ?? null;
}

export function vocabLevelRows(levels) {
  return (levels ?? []).filter((row) => Number(row?.vocab?.total ?? 0) > 0);
}

export function currentVocabLevel(levels) {
  const withVocab = vocabLevelRows(levels);
  if (!withVocab.length) return null;
  const from = currentLevelRow(levels)?.level ?? 1;
  return withVocab.find((row) => row.level >= from) ?? withVocab[withVocab.length - 1];
}

export function exploreLevel(levels, type) {
  return exploreType(type) === 'vocab' ? currentVocabLevel(levels) : currentLevelRow(levels);
}

// Exactly the items learnStore.lessonQueue can start for these ids: unlocked and unstarted.
export function nextBatch(rows, batch = DEFAULT_BATCH) {
  const size = batchSize(batch);
  return (rows ?? []).filter(isTeachable).slice(0, size);
}

// ---------------------------------------------------------------- Explore Kanji

export function kanjiLesson({ levels = [], rows = [], batch = DEFAULT_BATCH } = {}) {
  const size = batchSize(batch);
  const level = currentLevelRow(levels);
  const levelLabel = level ? levelName(level) : 'Kanji';
  const items = nextBatch(rows, size);
  if (!items.length) return null;
  const number = Math.floor(kanjiTotals(levels).started / size) + 1;
  return {
    id: `kanji:lesson:${level?.level ?? 0}:${number}`,
    number,
    title: `Lesson ${number}`,
    meta: lessonMeta({ levelLabel, count: items.length, type: 'kanji' }),
    preview: items.map((row) => row.label ?? row.id).slice(0, size),
    previewKind: 'kanji',
    isNew: items.every((row) => Number(row.stage ?? 0) === 0),
    done: false,
    ids: items.map((row) => row.id),
  };
}

// learn:card readingText joins the accepted readings with ' / ' ("カ / いえ"); the frames list them with commas.
export function readingsLine(card) {
  const text = String(card?.readingText ?? '').trim();
  if (!text) return '';
  return text
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
}

export function kanjiRowModel(item, card) {
  const strokes = Number(card?.strokes ?? item?.strokes ?? 0);
  if (item?.locked) {
    return {
      id: item.id,
      tile: item.label ?? '',
      tileKind: 'kanji',
      title: item.sub || item.label || '',
      sub: LOCKED_KANJI_TEXT,
      status: 'new',
      locked: true,
    };
  }
  return {
    id: item.id,
    tile: item.label ?? '',
    tileKind: 'kanji',
    title: item.sub || item.label || '',
    sub: [readingsLine(card), strokes > 0 ? `${strokes} strokes` : ''].filter(Boolean).join(' · '),
    status: rowStatus(item),
    locked: false,
  };
}

// Up next keeps every kanji of the level so the Explore filters can decide what is visible: new (including the
// locked ones), then review, then learned. Locked kanji stay in the pool with a 'new' status and are shown as
// locked; dropping them made Review look empty whenever the first nine rows were new.
export function kanjiRowPool(rows, lessonIds = []) {
  const skip = new Set(lessonIds ?? []);
  const rest = (rows ?? []).filter((row) => !skip.has(row.id));
  const buckets = { new: [], review: [], learned: [], locked: [] };
  for (const row of rest) {
    if (row.locked) buckets.locked.push(row);
    else buckets[rowStatus(row)].push(row);
  }
  return [...buckets.new, ...buckets.review, ...buckets.learned, ...buckets.locked];
}

// Locked rows need no card lookups: their sub is the lock hint until they unlock.
export function kanjiRowCandidates(rows, lessonIds = []) {
  return kanjiRowPool(rows, lessonIds)
    .filter((row) => !row.locked)
    .map((row) => row.id);
}

function kanjiEmpty(rows) {
  if ((rows ?? []).some((row) => row.locked)) {
    return {
      emptyText: 'Kanji in this level unlock once you learn their radicals.',
      emptyAction: {
        label: 'Learn radicals',
        route: { view: 'levels', arg: { type: 'radical', all: true } },
      },
    };
  }
  return {
    emptyText: 'Nothing new to learn in this level right now. Reviews keep the rest moving.',
    emptyAction: null,
  };
}

export function kanjiExplore({ levels = [], rows = [], cards = {}, batch = DEFAULT_BATCH } = {}) {
  const totals = kanjiTotals(levels);
  const lesson = kanjiLesson({ levels, rows, batch });
  const pool = kanjiRowPool(rows, lesson?.ids ?? []);
  return {
    type: 'kanji',
    title: 'Explore Kanji',
    header: { label: `${totals.passed} OF ${totals.total} LEARNED`, value: totals.passed, max: totals.total },
    progress: { label: 'KANJI LEARNED', value: totals.passed, max: totals.total },
    lesson,
    rows: pool.map((item) => kanjiRowModel(item, cards?.[item.id])),
    seeAll: { total: totals.total, noun: 'kanji' },
    ...kanjiEmpty(rows),
    ...emptyTitlePatch(lesson, rows),
    level: currentLevelRow(levels)?.level ?? null,
    totals,
  };
}

// ---------------------------------------------------------------- Explore Vocab

// One lesson = one batch of words. A level contributes ceil(words / batch) lessons; batches already started count
// as done, so the numbers and the header both come from real progress.
export function vocabLessonTotals(levels, batch = DEFAULT_BATCH) {
  const size = batchSize(batch);
  let total = 0;
  let done = 0;
  for (const row of vocabLevelRows(levels)) {
    const words = Number(row.vocab.total ?? 0);
    const started = Math.min(Number(row.vocab.started ?? 0), words);
    const passed = Math.min(Number(row.vocab.passed ?? 0), words);
    total += Math.ceil(words / size);
    // A finished level is done even when its last batch is smaller than the lesson size.
    done += passed >= words ? Math.ceil(words / size) : Math.floor(started / size);
  }
  return { total, done };
}

function vocabLevelMeta(levels, levelNumber) {
  return (levels ?? []).find((row) => Number(row?.level) === Number(levelNumber)) ?? null;
}

// One ordered batch queue for the whole Vocab course. Rows arrive in level order then item order (browse returns
// the pack order), so each level's words are chunked into course batches in that order. A batch leaves the queue
// once every word in it has passed Guru; batches with started words stay (those words are review), and the lesson
// only takes the batch's unlocked, unstarted words, exactly like learnStore.lessonQueue. Lessons are numbered by
// their position in this queue after the batches already done, so the numbers stay consecutive across levels.
export function vocabLessonQueue(levels = [], rows = [], batch = DEFAULT_BATCH) {
  const size = batchSize(batch);
  const done = vocabLessonTotals(levels, size).done;
  const byLevel = new Map();
  for (const row of rows ?? []) {
    const level = Number(row?.level);
    if (!Number.isFinite(level)) continue;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(row);
  }
  const queue = [];
  for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
    const items = byLevel.get(level);
    for (let start = 0; start < items.length; start += size) {
      const batchItems = items.slice(start, start + size);
      const remaining = batchItems.filter((row) => !isPassed(row));
      if (!remaining.length) continue;
      queue.push({
        level,
        batch: Math.floor(start / size),
        number: done + queue.length + 1,
        items: batchItems,
        remaining,
        teachable: remaining.filter(isTeachable),
      });
    }
  }
  return queue;
}

function vocabLessonFrom(entry, levels) {
  if (!entry?.teachable?.length) return null;
  const meta = vocabLevelMeta(levels, entry.level);
  const levelLabel = meta ? levelName(meta) : `Level ${entry.level}`;
  const items = entry.teachable;
  return {
    id: `vocab:lesson:${entry.level}:${entry.number}`,
    number: entry.number,
    title: `Lesson ${entry.number}`,
    meta: lessonMeta({ levelLabel, count: items.length, type: 'vocab' }),
    preview: items.map((row) => row.label ?? row.id).slice(0, UP_NEXT_ROWS),
    previewKind: 'text',
    isNew: items.every((row) => Number(row.stage ?? 0) === 0),
    done: false,
    ids: items.map((row) => row.id),
    level: entry.level,
    batch: entry.batch,
  };
}

export function vocabLesson({ levels = [], rows = [], batch = DEFAULT_BATCH } = {}) {
  const queue = vocabLessonQueue(levels, rows, batch);
  return vocabLessonFrom(queue.find((entry) => entry.teachable.length > 0) ?? null, levels);
}

// Up next is the next three batches of the same queue, so a level's remaining batches come before later levels.
// When nothing is teachable yet, it starts at the top of the queue instead of showing unrelated later levels.
// There are no topic names in the study pack, so a lesson is named after its level.
export function vocabLessonRows({ levels = [], rows = [], batch = DEFAULT_BATCH, limit = UP_NEXT_ROWS } = {}) {
  const max = Math.max(0, Math.trunc(Number(limit)) || 0);
  if (!max) return [];
  const queue = vocabLessonQueue(levels, rows, batch);
  const next = queue.findIndex((entry) => entry.teachable.length > 0);
  const start = next >= 0 ? next + 1 : 0;
  return queue.slice(start, start + max).map((entry) => {
    const meta = vocabLevelMeta(levels, entry.level);
    const count = entry.remaining.length;
    return {
      id: `vocab:lesson:${entry.level}:${entry.number}`,
      tile: numberTile(entry.number),
      tileKind: 'number',
      title: meta ? levelName(meta) : `Level ${entry.level}`,
      sub: `${wordsLabel(count)} · ${minutesFor('vocab', count)} min`,
      // A batch is in progress when any of its words has been started; otherwise it is still new.
      status: entry.remaining.some((row) => Number(row?.stage ?? 0) >= 1) ? 'review' : 'new',
      level: entry.level,
      batch: entry.batch,
      number: entry.number,
      ids: entry.teachable.map((row) => row.id),
    };
  });
}

export function vocabExplore({ levels = [], rows = [], batch = DEFAULT_BATCH } = {}) {
  const totals = vocabTotals(levels);
  const counts = vocabLessonTotals(levels, batch);
  const queue = vocabLessonQueue(levels, rows, batch);
  const lesson = vocabLessonFrom(queue.find((entry) => entry.teachable.length > 0) ?? null, levels);
  return {
    type: 'vocab',
    title: 'Explore Vocab',
    header: { label: `${counts.done} OF ${counts.total} DONE`, value: counts.done, max: counts.total },
    progress: { label: 'LESSONS DONE', value: counts.done, max: counts.total },
    lesson,
    rows: vocabLessonRows({ levels, rows, batch }),
    seeAll: { total: counts.total, noun: 'lessons' },
    emptyText: 'Pass the kanji in this level to unlock its words.',
    ...emptyTitlePatch(lesson, rows),
    level: currentVocabLevel(levels)?.level ?? null,
    totals,
  };
}
