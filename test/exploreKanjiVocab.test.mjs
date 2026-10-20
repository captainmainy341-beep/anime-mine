import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  batchSize,
  kanjiExplore,
  kanjiLesson,
  kanjiRowCandidates,
  kanjiRowModel,
  kanjiRowPool,
  levelName,
  minutesFor,
  numberTile,
  rowStatus,
  seeAllRoute,
  vocabExplore,
  vocabLesson,
  vocabLessonQueue,
  vocabLessonRows,
  vocabLessonTotals,
} from '../src/renderer/learn/browseModel.mjs';
import { LEARN_TABS, tabArgs, viewTab } from '../src/renderer/learn.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/ink-s3-explore.json', import.meta.url), 'utf8'));
const levels = fixture.levelOverview;
const kanjiRows = fixture.kanjiRows;
const cards = fixture.cards;

// Complete browse rows for the fixture course: words in study order, `passed` first at Guru, then `started`
// words in review, the rest new. Locked levels stay locked. Overrides keyed by id keep a test specific.
function courseRows(source = levels, overrides = {}) {
  const rows = [];
  for (const level of source) {
    const { total, started, passed } = level.vocab;
    for (let i = 1; i <= total; i += 1) {
      const stage = i <= passed ? 5 : i <= started ? 1 : 0;
      const row = {
        id: `v:${level.level}:${i}`,
        kind: 'vocab',
        label: `Level ${level.level} word ${i}`,
        sub: '',
        level: level.level,
        stage,
        groupKey: stage >= 5 ? 'guru' : stage >= 1 ? 'apprentice' : null,
        locked: Boolean(level.locked),
      };
      rows.push({ ...row, ...(overrides[row.id] ?? {}) });
    }
  }
  return rows;
}

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

test('kanji lesson takes the next five unlocked, unstarted kanji of the current level', () => {
  const lesson = kanjiLesson({ levels, rows: kanjiRows, batch: 5 });
  assert.deepEqual(lesson.ids, ['k:生', 'k:友', 'k:家', 'k:年', 'k:時']);
  assert.deepEqual(lesson.preview, ['生', '友', '家', '年', '時']);
  assert.equal(lesson.previewKind, 'kanji');
  assert.equal(lesson.title, 'Lesson 10');
  assert.equal(lesson.number, 10);
  assert.equal(lesson.meta, 'Level 3 · 5 kanji · about 5 min');
  assert.equal(lesson.isNew, true);
  assert.equal(lesson.done, false);
  assert.ok(!lesson.ids.includes('k:先'), 'a started kanji is a review, not a lesson');
  assert.ok(!lesson.ids.includes('k:今'), 'locked kanji cannot be taught');
  assert.ok(!lesson.ids.includes('k:学'), 'learned kanji are not in the lesson');
});

test('kanji lesson follows the batch setting and skips started or locked rows', () => {
  const fresh = kanjiRows.map((row) => ({ ...row, stage: 0 }));
  const lesson = kanjiLesson({ levels, rows: fresh, batch: 8 });
  assert.equal(lesson.isNew, true);
  assert.deepEqual(lesson.ids, ['k:学', 'k:校', 'k:先', 'k:生', 'k:友', 'k:家', 'k:年', 'k:時']);
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
      ['分', 'minute, part', 'フン, ぶん, わ.ける', 'new'],
      ['先', 'previous', '', 'review'],
      ['学', 'study', 'ガク, まな.ぶ', 'learned'],
      ['校', 'school', '', 'learned'],
      ['今', 'now', 'Locked · unlocks after radicals', 'new'],
    ],
  );
  assert.ok(model.rows.every((row) => row.tileKind === 'kanji'));
});

test('kanji up next keeps the whole level pool so Review and New never look empty wrongly', () => {
  const lesson = kanjiLesson({ levels, rows: kanjiRows, batch: 5 });
  assert.deepEqual(kanjiRowCandidates(kanjiRows, lesson.ids), ['k:分', 'k:先', 'k:学', 'k:校']);
  assert.deepEqual(
    kanjiRowPool(kanjiRows, lesson.ids).map((row) => row.id),
    ['k:分', 'k:先', 'k:学', 'k:校', 'k:今'],
    'locked kanji stay in the filterable pool',
  );
  const locked = kanjiRowModel(kanjiRows.find((row) => row.id === 'k:今'));
  assert.equal(locked.status, 'new');
  assert.equal(locked.locked, true);
  assert.match(locked.sub, /^Locked · unlocks after radicals$/);
});

test('kanji explore asks for radicals when the level is still locked', () => {
  const lockedRows = kanjiRows.map((row) => ({ ...row, stage: 0, locked: true }));
  const model = kanjiExplore({ levels, rows: lockedRows, batch: 5 });
  assert.equal(model.lesson, null);
  assert.match(model.emptyText, /radicals/i);
  assert.deepEqual(model.emptyAction, {
    label: 'Learn radicals',
    route: { view: 'levels', arg: { type: 'radical', all: true } },
  });
});

test('kanji explore keeps the caught-up copy when the level has no locked kanji left', () => {
  const learned = kanjiRows.map((row) => ({ ...row, stage: 5, locked: false }));
  const model = kanjiExplore({ levels, rows: learned, batch: 5 });
  assert.equal(model.lesson, null);
  assert.match(model.emptyText, /Nothing new/i);
  assert.equal(model.emptyAction, null);
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

test('vocab lesson is the first teachable batch, including unfinished earlier levels', () => {
  const rows = courseRows();
  const lesson = vocabLesson({ levels, rows, batch: 5 });
  assert.deepEqual(lesson.ids, ['v:2:9', 'v:2:10']);
  assert.deepEqual(lesson.preview, ['Level 2 word 9', 'Level 2 word 10']);
  assert.equal(lesson.previewKind, 'text');
  assert.equal(lesson.number, 8);
  assert.equal(lesson.title, 'Lesson 8');
  assert.equal(lesson.meta, 'Level 2 · 2 words · about 1 min');
  assert.equal(lesson.isNew, true);
  for (const id of lesson.ids) {
    const row = rows.find((r) => r.id === id);
    assert.equal(row.stage, 0, 'a lesson never contains a started word');
    assert.equal(row.locked, false, 'a lesson never contains a locked word');
  }
});

test('vocab lesson leaves every started word to review', () => {
  const rows = courseRows();
  const started = rows.filter((row) => row.stage >= 1 && row.stage < 5).map((row) => row.id);
  const lesson = vocabLesson({ levels, rows, batch: 5 });
  assert.ok(lesson.ids.length > 0);
  assert.ok(!lesson.ids.some((id) => started.includes(id)));
});

test('vocab lesson numbers follow the batch queue', () => {
  const queue = vocabLessonQueue(levels, courseRows(), 5);
  assert.deepEqual(
    queue.slice(0, 4).map((entry) => [entry.level, entry.batch, entry.number]),
    [
      [1, 3, 7],
      [2, 1, 8],
      [3, 0, 9],
      [3, 1, 10],
    ],
    'six batches are done, so the unfinished queue starts at Lesson 7',
  );
});

test('lesson meta uses a real level name when the pack has one', () => {
  const named = levels.map((row) => {
    if (row.level === 2) return { ...row, name: 'Home and school' };
    if (row.level === 3) return { ...row, name: 'Family and school' };
    return row;
  });
  assert.equal(levelName(named[2]), 'Family and school');
  assert.equal(levelName(levels[2]), 'Level 3');
  assert.equal(kanjiLesson({ levels: named, rows: kanjiRows, batch: 5 }).meta, 'Family and school · 5 kanji · about 5 min');
  assert.equal(vocabLesson({ levels: named, rows: courseRows(named), batch: 5 }).meta, 'Home and school · 2 words · about 1 min');
});

test('vocab up next continues the same queue with the current level remaining batches', () => {
  const rows = courseRows();
  const next = vocabLessonRows({ levels, rows, batch: 5 });
  assert.deepEqual(
    next.map((row) => [row.tile, row.title, row.sub, row.status, row.level, row.batch]),
    [
      ['09', 'Level 3', '3 words · 2 min', 'review', 3, 0],
      ['10', 'Level 3', '5 words · 3 min', 'review', 3, 1],
      ['11', 'Level 3', '5 words · 3 min', 'new', 3, 2],
    ],
  );
  assert.deepEqual(next[0].ids, [], 'an in-progress batch has no new words to start');
  assert.deepEqual(next[1].ids, ['v:3:8', 'v:3:9', 'v:3:10']);
  assert.equal(next[2].ids.length, 5);
  assert.ok(next.every((row) => row.tileKind === 'number'));
  assert.equal(vocabLessonRows({ levels, rows, batch: 5, limit: 2 }).length, 2);
  assert.deepEqual(vocabLessonRows({ levels, rows, batch: 5, limit: 0 }), []);
});

test('vocab explore keeps Up next on the current level when nothing is teachable yet', () => {
  const fresh = levels.map((level) => ({ ...level, vocab: { total: level.vocab.total, started: 0, passed: 0 } }));
  const rows = courseRows(fresh).map((row) => ({ ...row, stage: 0, locked: true }));
  const model = vocabExplore({ levels: fresh, rows, batch: 5 });
  assert.equal(model.lesson, null);
  assert.deepEqual(
    model.rows.map((row) => [row.number, row.title, row.status]),
    [
      [1, 'Level 1', 'new'],
      [2, 'Level 1', 'new'],
      [3, 'Level 1', 'new'],
    ],
    'the remaining batches of the current level, not one batch of each later level',
  );
  assert.match(model.emptyText, /kanji/i);
});

test('vocab explore fills the DONE header, progress and See all lessons', () => {
  const model = vocabExplore({ levels, rows: courseRows(), batch: 5 });
  assert.equal(model.title, 'Explore Vocab');
  assert.deepEqual(model.header, { label: '6 OF 17 DONE', value: 6, max: 17 });
  assert.deepEqual(model.progress, { label: 'LESSONS DONE', value: 6, max: 17 });
  assert.deepEqual(model.seeAll, { total: 17, noun: 'lessons' });
  assert.equal(model.lesson.number, 8);
  assert.deepEqual(model.lesson.ids, ['v:2:9', 'v:2:10']);
  assert.equal(model.rows.length, 3);
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
