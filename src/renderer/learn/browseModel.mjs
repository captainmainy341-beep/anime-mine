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
export const ROW_LIMIT = 9;
export const UP_NEXT_ROWS = 3;

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

// Unlocked, not yet at Guru: the items a lesson can actually teach.
export function notLearned(rows) {
  return (rows ?? []).filter((row) => Number(row?.stage ?? 0) < PASS_STAGE);
}

export function nextBatch(rows, batch = DEFAULT_BATCH) {
  const size = batchSize(batch);
  return notLearned(rows)
    .filter((row) => !row.locked)
    .slice(0, size);
}

// The words a vocab lesson can teach right now: unlocked and not yet at Guru.
export function vocabLessonItems(rows, batch = DEFAULT_BATCH) {
  return nextBatch(rows, batch);
}

// The words of one numbered batch inside a level. Lesson numbers count batches from the start of the level, so
// batch 0 is the level's first five words even when some of them are already started.
export function vocabLessonBatch(rows, batchIndex, batch = DEFAULT_BATCH) {
  const size = batchSize(batch);
  const index = Math.max(0, Math.trunc(Number(batchIndex)) || 0);
  return (rows ?? [])
    .slice(index * size, (index + 1) * size)
    .filter((row) => !row.locked && Number(row.stage ?? 0) < PASS_STAGE);
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
  return {
    id: item.id,
    tile: item.label ?? '',
    tileKind: 'kanji',
    title: item.sub || item.label || '',
    sub: [readingsLine(card), strokes > 0 ? `${strokes} strokes` : ''].filter(Boolean).join(' · '),
    status: rowStatus(item),
  };
}

// Up next starts after the lesson batch: upcoming kanji first, then items in review, then already learned ones.
export function kanjiRowPool(rows, lessonIds = []) {
  const skip = new Set(lessonIds ?? []);
  const rest = (rows ?? []).filter((row) => !skip.has(row.id) && !row.locked);
  const buckets = { new: [], review: [], learned: [] };
  for (const row of rest) buckets[rowStatus(row)].push(row);
  return [...buckets.new, ...buckets.review, ...buckets.learned];
}

export function kanjiRowCandidates(rows, lessonIds = [], limit = ROW_LIMIT) {
  return kanjiRowPool(rows, lessonIds)
    .slice(0, limit)
    .map((row) => row.id);
}

export function kanjiExplore({ levels = [], rows = [], cards = {}, batch = DEFAULT_BATCH } = {}) {
  const totals = kanjiTotals(levels);
  const lesson = kanjiLesson({ levels, rows, batch });
  const pool = kanjiRowPool(rows, lesson?.ids ?? []).slice(0, ROW_LIMIT);
  return {
    type: 'kanji',
    title: 'Explore Kanji',
    header: { label: `${totals.passed} OF ${totals.total} LEARNED`, value: totals.passed, max: totals.total },
    progress: { label: 'KANJI LEARNED', value: totals.passed, max: totals.total },
    lesson,
    rows: pool.map((item) => kanjiRowModel(item, cards?.[item.id])),
    seeAll: { total: totals.total, noun: 'kanji' },
    emptyText: 'Nothing new to learn in this level right now. Reviews keep the rest moving.',
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
    total += Math.ceil(words / size);
    done += Math.floor(started / size);
  }
  return { total, done };
}

export function lessonsBeforeLevel(levels, levelNumber, batch = DEFAULT_BATCH) {
  const size = batchSize(batch);
  return vocabLevelRows(levels)
    .filter((row) => row.level < levelNumber)
    .reduce((n, row) => n + Math.ceil(Number(row.vocab.total ?? 0) / size), 0);
}

export function vocabLessonNumber(levels, levelNumber, batch = DEFAULT_BATCH) {
  const size = batchSize(batch);
  const row = (levels ?? []).find((r) => r.level === levelNumber);
  const started = Number(row?.vocab?.started ?? 0);
  return lessonsBeforeLevel(levels, levelNumber, size) + Math.floor(started / size) + 1;
}

export function vocabLesson({ levels = [], rows = [], batch = DEFAULT_BATCH } = {}) {
  const level = currentVocabLevel(levels);
  if (!level) return null;
  const items = nextBatch(rows, batch);
  if (!items.length) return null;
  const number = vocabLessonNumber(levels, level.level, batch);
  const levelLabel = levelName(level);
  return {
    id: `vocab:lesson:${level.level}:${number}`,
    number,
    title: `Lesson ${number}`,
    meta: lessonMeta({ levelLabel, count: items.length, type: 'vocab' }),
    preview: items.map((row) => row.label ?? row.id).slice(0, UP_NEXT_ROWS),
    previewKind: 'text',
    isNew: items.every((row) => Number(row.stage ?? 0) === 0),
    done: false,
    ids: items.map((row) => row.id),
  };
}

// Up next lists the following lessons: the next unlearned batch of each following level that still has words.
// There are no topic names in the study pack, so a lesson is named after its level. Lessons are numbered on from
// the current one, the way the frames show 04 / 05 / 06 after Lesson 3. The batch index lets a row start exactly
// the lesson it shows, not just the first words of its level.
export function vocabLessonRows(levels, batch = DEFAULT_BATCH, limit = UP_NEXT_ROWS) {
  const size = batchSize(batch);
  const max = Math.max(0, Math.trunc(Number(limit)) || 0);
  if (!max) return [];
  const current = currentVocabLevel(levels);
  if (!current) return [];
  const start = vocabLessonNumber(levels, current.level, size);
  const rows = [];
  for (const level of vocabLevelRows(levels)) {
    if (level.level <= current.level) continue;
    const words = Number(level.vocab.total ?? 0);
    const started = Math.min(Number(level.vocab.started ?? 0), words);
    const batchIndex = Math.floor(started / size);
    if (batchIndex >= Math.ceil(words / size)) continue;
    const count = Math.min(size, words - batchIndex * size);
    const number = start + rows.length + 1;
    rows.push({
      id: `vocab:lesson:${level.level}:${number}`,
      tile: numberTile(number),
      tileKind: 'number',
      title: levelName(level),
      sub: `${wordsLabel(count)} · ${minutesFor('vocab', count)} min`,
      // The level's next batch is in progress when some of its words are started, otherwise it is still new.
      status: started % size > 0 ? 'review' : 'new',
      level: level.level,
      batch: batchIndex,
      number,
    });
    if (rows.length >= max) break;
  }
  return rows;
}

export function vocabExplore({ levels = [], rows = [], batch = DEFAULT_BATCH } = {}) {
  const totals = vocabTotals(levels);
  const counts = vocabLessonTotals(levels, batch);
  return {
    type: 'vocab',
    title: 'Explore Vocab',
    header: { label: `${counts.done} OF ${counts.total} DONE`, value: counts.done, max: counts.total },
    progress: { label: 'LESSONS DONE', value: counts.done, max: counts.total },
    lesson: vocabLesson({ levels, rows, batch }),
    rows: vocabLessonRows(levels, batch),
    seeAll: { total: counts.total, noun: 'lessons' },
    emptyText: 'Pass the kanji in this level to unlock its words.',
    level: currentVocabLevel(levels)?.level ?? null,
    totals,
  };
}
