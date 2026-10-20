import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  batchSize,
  kanjiExplore,
  kanjiLesson,
  kanjiRowCandidates,
  kanjiRowModel,
  levelName,
  lessonsBeforeLevel,
  minutesFor,
  numberTile,
  rowStatus,
  seeAllRoute,
  vocabExplore,
  vocabLesson,
  vocabLessonBatch,
  vocabLessonNumber,
  vocabLessonRows,
  vocabLessonTotals,
  vocabLessonItems,
} from '../src/renderer/learn/browseModel.mjs';
import { LEARN_TABS, tabArgs, viewTab } from '../src/renderer/learn.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ink-s3-explore.json', import.meta.url), 'utf8'));
const levels = fixture.levelOverview;
const kanjiRows = fixture.kanjiRows;
const vocabRows = fixture.vocabRows;
const cards = fixture.cards;

test('batch size follows the lesson setting and falls back to five', () => {
  assert.equal(batchSize(8), 8);
  assert.equal(batchSize(1), 1);
  assert.equal(batchSize(undefined), 5);
  assert.equal(batchSize(0), 5);
  assert.equal(batchSize(51), 5);
  assert.equal(batchSize('7'), 5);
});

test('rowStatus maps SRS stages to new, review and learned', () => {
  assert.equal(rowStatus({ stage: 0 }), 'new');
  assert.equal(rowStatus({}), 'new');
  assert.equal(rowStatus(null), 'new');
  assert.equal(rowStatus({ stage: 1 }), 'review');
  assert.equal(rowStatus({ stage: 4 }), 'review');
  assert.equal(rowStatus({ stage: 5 }), 'learned');
  assert.equal(rowStatus({ stage: 9 }), 'learned');
});

test('kanji lesson takes the next five unlocked, not-yet-learned kanji of the current level', () => {
  const lesson = kanjiLesson({ levels, rows: kanjiRows, batch: 5 });
  assert.deepEqual(lesson.ids, ['k:先', 'k:生', 'k:友', 'k:家', 'k:年']);
  assert.deepEqual(lesson.preview, ['先', '生', '友', '家', '年']);
  assert.equal(lesson.previewKind, 'kanji');
  assert.equal(lesson.title, 'Lesson 10');
  assert.equal(lesson.number, 10);
  assert.equal(lesson.meta, 'Level 3 · 5 kanji · about 5 min');
  assert.equal(lesson.isNew, false, 'a started kanji in the batch means the lesson is not new');
  assert.equal(lesson.done, false);
  assert.ok(!lesson.ids.includes('k:今'), 'locked kanji cannot be taught');
  assert.ok(!lesson.ids.includes('k:学'), 'learned kanji are not in the lesson');
});

test('kanji lesson is new when nothing in it has been started, and follows the batch setting', () => {
  const fresh = kanjiRows.map((row) => ({ ...row, stage: 0 }));
  const lesson = kanjiLesson({ levels, rows: fresh, batch: 8 });
  assert.equal(lesson.isNew, true);
  assert.equal(lesson.ids.length, 8, 'only the eight unlocked kanji in the fixture are available');
  assert.equal(lesson.meta, 'Level 3 · 8 kanji · about 8 min');
});

test('kanji lesson is null when the level has nothing left to learn', () => {
  const learned = kanjiRows.map((row) => ({ ...row, stage: 5 }));
  assert.equal(kanjiLesson({ levels, rows: learned, batch: 5 }), null);
  assert.equal(kanjiLesson({ levels: [], rows: [], batch: 5 }), null);
});

test('kanji explore fills header, progress, rows and See all from real shapes', () => {
  const model = kanjiExplore({ levels, rows: kanjiRows, cards, batch: 5 });
  assert.equal(model.title, 'Explore Kanji');
  assert.deepEqual(model.header, { label: '39 OF 120 LEARNED', value: 39, max: 120 });
  assert.deepEqual(model.progress, { label: 'KANJI LEARNED', value: 39, max: 120 });
  assert.deepEqual(model.seeAll, { total: 120, noun: 'kanji' });
  assert.deepEqual(
    model.rows.map((row) => [row.tile, row.title, row.sub, row.status]),
    [
      ['時', 'time', 'ジ, とき', 'new'],
      ['分', 'minute, part', 'フン, ぶん, わ.ける', 'new'],
      ['学', 'study', 'ガク, まな.ぶ', 'learned'],
      ['校', 'school', '', 'learned'],
    ],
  );
  assert.ok(model.rows.every((row) => row.tileKind === 'kanji'));
});

test('kanji up next starts after the lesson batch and lists new kanji first', () => {
  const lesson = kanjiLesson({ levels, rows: kanjiRows, batch: 5 });
  assert.deepEqual(kanjiRowCandidates(kanjiRows, lesson.ids), ['k:時', 'k:分', 'k:学', 'k:校']);
  const limited = kanjiRowModel(kanjiRows[3], cards['k:生']);
  assert.equal(limited.status, 'new');
  assert.equal(limited.tileKind, 'kanji');
});

test('kanji row sub lists readings, and strokes when the card carries them', () => {
  const row = kanjiRowModel(kanjiRows[7], { readingText: 'ジ / とき', strokes: 10 });
  assert.equal(row.sub, 'ジ, とき · 10 strokes');
  const noReadings = kanjiRowModel(kanjiRows[7], null);
  assert.equal(noReadings.sub, '');
});

test('vocab lessons count batches per level from real progress', () => {
  assert.deepEqual(vocabLessonTotals(levels, 5), { total: 17, done: 6 });
  assert.deepEqual(vocabLessonTotals(levels, 8), {
    total: Math.ceil(20 / 8) + Math.ceil(10 / 8) + Math.ceil(30 / 8) + Math.ceil(12 / 8) + Math.ceil(3 / 8) + Math.ceil(5 / 8),
    done: Math.floor(20 / 8) + Math.floor(8 / 8) + Math.floor(7 / 8) + 0 + Math.floor(2 / 8) + 0,
  });
});

test('vocab lesson takes the next batch of unlocked words in the current level', () => {
  const lesson = vocabLesson({ levels, rows: vocabRows, batch: 5 });
  assert.deepEqual(lesson.ids, ['v:2', 'v:3', 'v:4', 'v:5', 'v:6']);
  assert.deepEqual(lesson.preview, ['飲む', 'お水', 'お茶']);
  assert.equal(lesson.previewKind, 'text');
  assert.equal(lesson.number, 8);
  assert.equal(lesson.title, 'Lesson 8');
  assert.equal(lesson.meta, 'Level 3 · 5 words · about 3 min');
  assert.equal(lesson.isNew, false, '飲む has already started');
  assert.equal(vocabLessonItems(vocabRows, 5).length, 5);
  assert.equal(vocabLessonItems(vocabRows, 1)[0].id, 'v:2');
});

test('lesson meta uses a real level name when the pack has one', () => {
  const named = levels.map((row) => (row.level === 3 ? { ...row, name: 'Family and school' } : row));
  assert.equal(levelName(named[2]), 'Family and school');
  assert.equal(levelName(levels[2]), 'Level 3');
  assert.equal(kanjiLesson({ levels: named, rows: kanjiRows, batch: 5 }).meta, 'Family and school · 5 kanji · about 5 min');
  assert.equal(vocabLesson({ levels: named, rows: vocabRows, batch: 5 }).meta, 'Family and school · 5 words · about 3 min');
});

test('vocab lesson numbers count batches from the start of the course', () => {
  assert.equal(lessonsBeforeLevel(levels, 3, 5), 6);
  assert.equal(vocabLessonNumber(levels, 3, 5), 8);
  assert.equal(vocabLessonNumber(levels, 4, 5), 13);
});

test('vocab up next lists the following levels with number tiles and real counts', () => {
  const rows = vocabLessonRows(levels, 5);
  assert.deepEqual(
    rows.map((row) => [row.tile, row.title, row.sub, row.status, row.level, row.batch]),
    [
      ['09', 'Level 4', '5 words · 3 min', 'new', 4, 0],
      ['10', 'Level 5', '3 words · 2 min', 'review', 5, 0],
      ['11', 'Level 6', '5 words · 3 min', 'new', 6, 0],
    ],
  );
  assert.ok(rows.every((row) => row.tileKind === 'number'));
  assert.equal(vocabLessonRows(levels, 5, 2).length, 2);
  assert.equal(vocabLessonRows(levels, 5, 0).length, 0);
});

test('vocab rows mark a fresh batch new even when earlier words in the level are done', () => {
  const changed = levels.map((row) => {
    if (row.level === 4) return { ...row, vocab: { total: 10, started: 5, passed: 5 } };
    if (row.level === 5) return { ...row, vocab: { total: 12, started: 7, passed: 2 } };
    return row;
  });
  const rows = vocabLessonRows(changed, 5);
  assert.deepEqual(
    rows.map((row) => [row.level, row.batch, row.sub, row.status]),
    [
      [4, 1, '5 words · 3 min', 'new'],
      [5, 1, '5 words · 3 min', 'review'],
      [6, 0, '5 words · 3 min', 'new'],
    ],
  );
});

test('a following vocab lesson starts its own batch, not the first words of the level', () => {
  assert.deepEqual(vocabLessonBatch(vocabRows, 0, 5).map((row) => row.id), ['v:2', 'v:3', 'v:4', 'v:5']);
  assert.deepEqual(vocabLessonBatch(vocabRows, 1, 5).map((row) => row.id), ['v:6', 'v:7']);
  assert.deepEqual(vocabLessonBatch(vocabRows, 2, 5), []);
  assert.deepEqual(vocabLessonBatch(vocabRows, undefined, 5).map((row) => row.id), ['v:2', 'v:3', 'v:4', 'v:5']);
});

test('vocab explore fills the DONE header, progress and See all lessons', () => {
  const model = vocabExplore({ levels, rows: vocabRows, batch: 5 });
  assert.equal(model.title, 'Explore Vocab');
  assert.deepEqual(model.header, { label: '6 OF 17 DONE', value: 6, max: 17 });
  assert.deepEqual(model.progress, { label: 'LESSONS DONE', value: 6, max: 17 });
  assert.deepEqual(model.seeAll, { total: 17, noun: 'lessons' });
  assert.equal(model.lesson.number, 8);
  assert.equal(model.rows.length, 3);
});

test('vocab explore has no lesson until the level words unlock', () => {
  const locked = vocabRows.map((row) => ({ ...row, locked: true }));
  const model = vocabExplore({ levels, rows: locked, batch: 5 });
  assert.equal(model.lesson, null);
  assert.equal(model.rows.length, 3, 'following lessons still show');
  assert.match(model.emptyText, /kanji/i);
});

test('See all routes to the levels browser for kanji and to Vocab for vocab', () => {
  assert.deepEqual(seeAllRoute('kanji'), { view: 'levels', arg: { type: 'kanji', all: true } });
  assert.deepEqual(seeAllRoute(undefined), { view: 'levels', arg: { type: 'kanji', all: true } });
  assert.deepEqual(seeAllRoute('vocab'), { view: 'vocab', arg: { all: true } });
});

test('the explore minutes round like the frames', () => {
  assert.equal(minutesFor('kanji', 5), 5);
  assert.equal(minutesFor('kanji', 8), 8);
  assert.equal(minutesFor('vocab', 8), 5);
  assert.equal(minutesFor('vocab', 7), 5);
  assert.equal(minutesFor('vocab', 6), 4);
  assert.equal(minutesFor('vocab', 0), 0);
});

test('lesson number tiles are two digits', () => {
  assert.equal(numberTile(4), '04');
  assert.equal(numberTile(12), '12');
  assert.equal(numberTile(0), '01');
});

test('Learn tabs are Home, Kanji, Vocab, Grammar, Story, Stats, Settings', () => {
  assert.deepEqual(LEARN_TABS.map(([key]) => key), ['home', 'levels', 'vocab', 'grammar', 'story', 'stats', 'settings']);
  assert.deepEqual(LEARN_TABS.map(([, label]) => label), ['Home', 'Kanji', 'Vocab', 'Grammar', 'Story', 'Stats', 'Settings']);
});

test('the Vocab tab mounts the levels browser with type vocab', () => {
  assert.deepEqual(tabArgs('vocab', undefined), { type: 'vocab' });
  assert.deepEqual(tabArgs('vocab', { all: true }), { type: 'vocab', all: true });
  assert.equal(tabArgs('vocab', { all: true, type: 'kanji' }).type, 'vocab');
  assert.deepEqual(tabArgs('levels', { all: true }), { all: true, type: 'kanji' });
  assert.deepEqual(tabArgs('grammar', { all: true }), { all: true });
});

test('the tab for a view follows drill-downs back to where they started', () => {
  assert.equal(viewTab('levels'), 'levels');
  assert.equal(viewTab('vocab'), 'vocab');
  assert.equal(viewTab('grammar'), 'grammar');
  assert.equal(viewTab('item', 'vocab'), 'vocab');
  assert.equal(viewTab('item', 'levels'), 'levels');
  assert.equal(viewTab('item'), 'levels');
  assert.equal(viewTab('point'), 'grammar');
  assert.equal(viewTab('home'), 'home');
});
