import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAMMAR_BATCH_SIZE,
  grammarBatchSize,
  grammarExplore,
  grammarLessonTheme,
  grammarLessons,
  patternLabel,
} from '../src/renderer/learn/grammarModel.mjs';
import { seeAllLabel } from '../src/renderer/learn/exploreModel.mjs';

// Browse row shape returned by learn:browse for grammar points.
function point(n, { stage = 0, due = false, jlpt = 'N5', label } = {}) {
  return {
    id: `g:p${n}`,
    kind: 'grammar',
    label: label ?? `〜p${n}`,
    sub: `meaning ${n}`,
    jlpt,
    stage,
    groupKey: stage > 0 ? 'beginner' : null,
    locked: false,
    due,
  };
}

const batch = (from, count, options = {}) =>
  Array.from({ length: count }, (_, index) => point(from + index, options));

test('grammarBatchSize uses the Learn setting, capped, and falls back to 3', () => {
  assert.equal(GRAMMAR_BATCH_SIZE, 3);
  assert.equal(grammarBatchSize({ lessonBatch: 5 }), 5);
  assert.equal(grammarBatchSize(4), 4);
  assert.equal(grammarBatchSize({}), 3);
  assert.equal(grammarBatchSize(undefined), 3);
  assert.equal(grammarBatchSize({ lessonBatch: 0 }), 3);
  assert.equal(grammarBatchSize({ lessonBatch: 51 }), 3);
  assert.equal(grammarBatchSize({ lessonBatch: 2.5 }), 3);
});

test('patternLabel turns the 〜 slots into A, B, C', () => {
  assert.equal(patternLabel('〜は〜です'), 'AはBです');
  assert.equal(patternLabel('〜が ある'), 'Aが ある');
  assert.equal(patternLabel('〜を 食べる'), 'Aを 食べる');
  assert.equal(patternLabel('〜と（〜と一緒に）'), 'Aと');
  assert.equal(patternLabel('〜で（場所）'), 'Aで（場所）');
  assert.equal(patternLabel('〜で（手段）'), 'Aで（手段）');
  assert.equal(patternLabel('〜ませんでした / 〜なかった'), 'Aませんでした');
  assert.equal(patternLabel('〜くらい / 〜ぐらい（程度）'), 'Aくらい');
  assert.equal(patternLabel('〜が好き／上手／下手'), 'Aが好き');
  assert.equal(patternLabel('〜という (called / named)'), 'Aという');
  assert.equal(patternLabel('ています'), 'ています');
  assert.equal(patternLabel(null), '');
});

test('grammarLessons batches points in course order', () => {
  const rows = batch(1, 7);
  const lessons = grammarLessons(rows, 3);
  assert.equal(lessons.length, 3);
  assert.deepEqual(lessons.map((lesson) => lesson.count), [3, 3, 1]);
  assert.deepEqual(lessons.map((lesson) => lesson.number), [1, 2, 3]);
  assert.deepEqual(lessons[0].ids, ['g:p1', 'g:p2', 'g:p3']);
  assert.deepEqual(lessons[1].ids, ['g:p4', 'g:p5', 'g:p6']);
  assert.deepEqual(lessons[2].ids, ['g:p7']);
  assert.equal(lessons[0].title, 'Lesson 1');
  assert.equal(lessons[0].meta, 'Patterns · 3 patterns · 8 min');
  assert.equal(lessons[2].rowSub, 'Patterns · 4 min');
  assert.deepEqual(grammarLessons(rows, 2).map((lesson) => lesson.count), [2, 2, 2, 1]);
});

test('grammarLessonTheme names a batch from its first recognisable pattern', () => {
  assert.deepEqual(grammarLessonTheme([point(1, { label: '〜ませんでした / 〜なかった' })]), {
    title: 'Past: ました',
    topic: 'Verbs',
  });
  assert.deepEqual(grammarLessonTheme([point(1, { label: '〜たい' })]), {
    title: 'Wanting: たい',
    topic: 'Verbs',
  });
  assert.deepEqual(grammarLessonTheme([point(1, { label: '〜か' })]), {
    title: 'Asking: か',
    topic: 'Questions',
  });
  assert.deepEqual(grammarLessonTheme([point(1, { label: '〜は〜です' })]), {
    title: 'Topic: は',
    topic: 'Particles',
  });
  assert.deepEqual(grammarLessonTheme([point(1, { label: '〜ことになっている' })]), {
    title: '〜ことになっている',
    topic: 'Patterns',
  });
});

test('grammarLessons marks lessons new, review or learned and done only when every point started', () => {
  const rows = [
    ...batch(1, 3, { stage: 1 }), // learned, done
    ...batch(4, 1, { stage: 1 }), point(5), point(6), // partly started -> review, not done
    ...batch(7, 3, { stage: 1 }), // learned, done
    ...batch(10, 3, { stage: 1 }), // due below -> review, still done
    ...batch(13, 3), // new
  ];
  rows[9] = { ...rows[9], due: true };
  const lessons = grammarLessons(rows, 3);
  assert.deepEqual(lessons.map((lesson) => lesson.status), ['learned', 'review', 'learned', 'review', 'new']);
  assert.deepEqual(lessons.map((lesson) => lesson.done), [true, false, true, true, false]);
  assert.deepEqual(lessons.map((lesson) => lesson.isNew), [false, false, false, false, true]);
});

test('grammarExplore picks the first unfinished lesson and lists the ones after it', () => {
  const rows = [
    ...batch(1, 3, { stage: 1 }), // done
    ...batch(4, 1, { stage: 1 }), point(5), point(6), // next: review
    ...batch(7, 3, { stage: 1 }), // learned row
    ...batch(10, 3, { stage: 1 }), // due row -> review
    ...batch(13, 3), // new row
  ];
  rows[9] = { ...rows[9], due: true };
  const explore = grammarExplore(grammarLessons(rows, 3));

  assert.equal(explore.next.number, 2);
  assert.equal(explore.next.title, 'Lesson 2');
  assert.equal(explore.next.isNew, false);
  assert.equal(explore.next.done, false);
  assert.equal(explore.next.firstId, 'g:p4');
  assert.deepEqual(explore.next.ids, ['g:p4', 'g:p5', 'g:p6']);

  assert.deepEqual(explore.rows.map((row) => row.status), ['learned', 'review', 'new']);
  assert.deepEqual(explore.rows.map((row) => row.tile), ['03', '04', '05']);
  assert.deepEqual(explore.rows.map((row) => row.tileKind), ['number', 'number', 'number']);
  assert.deepEqual(explore.rows.map((row) => row.firstId), ['g:p7', 'g:p10', 'g:p13']);
  assert.equal(explore.header.label, '3 OF 5 DONE');
  assert.deepEqual(explore.header, { label: '3 OF 5 DONE', value: 3, max: 5 });
  assert.deepEqual(explore.progress, { label: 'LESSONS DONE', value: 3, max: 5 });
});

test('grammarExplore previews the next batch and keeps the frame pattern tiles', () => {
  const rows = [
    point(1, { label: '〜は〜です' }),
    point(2, { label: '〜か' }),
    point(3, { label: '〜も' }),
    point(4, { label: '〜を' }),
  ];
  const lessons = grammarLessons(rows, 3);
  const withoutCards = grammarExplore(lessons);
  assert.deepEqual(withoutCards.next.preview, ['AはBです', 'Aか', 'Aも']);
  assert.equal(withoutCards.next.previewKind, 'text');
  assert.equal(withoutCards.next.meta, 'Particles · 3 patterns · 8 min');
  assert.equal(withoutCards.next.title, 'Lesson 1');

  const withCards = grammarExplore(lessons, {
    cards: [
      { title: '〜は〜です' },
      { title: '〜が ある' },
      { title: '〜を 食べる' },
    ],
  });
  assert.deepEqual(withCards.next.preview, ['AはBです', 'Aが ある', 'Aを 食べる']);
  assert.equal(withCards.rows.length, 1);
  assert.equal(withCards.rows[0].tile, '02');
});

test('grammarExplore counts every lesson for See all', () => {
  const rows = batch(1, 90);
  const lessons = grammarLessons(rows, 3);
  assert.equal(lessons.length, 30);
  const explore = grammarExplore(lessons);
  assert.deepEqual(explore.seeAll, { total: 30, noun: 'lessons' });
  assert.equal(seeAllLabel(explore.seeAll.total, explore.seeAll.noun), 'See all 30 lessons');
  assert.equal(explore.rows.length, 29);
});

test('grammarExplore keeps the header and progress honest when nothing is left', () => {
  const done = grammarExplore(grammarLessons(batch(1, 3, { stage: 1 }), 3));
  assert.equal(done.next, null);
  assert.deepEqual(done.rows, []);
  assert.equal(done.emptyText, 'All caught up');
  assert.equal(done.header.label, '1 OF 1 DONE');
  assert.deepEqual(done.progress, { label: 'LESSONS DONE', value: 1, max: 1 });
  assert.equal(seeAllLabel(done.seeAll.total, done.seeAll.noun), 'See all 1 lessons');

  const empty = grammarExplore([]);
  assert.equal(empty.next, null);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.emptyText, 'No grammar lessons yet.');
  assert.equal(empty.header.label, '0 OF 0 DONE');
  assert.deepEqual(empty.progress, { label: 'LESSONS DONE', value: 0, max: 0 });
  assert.deepEqual(empty.seeAll, { total: 0, noun: 'lessons' });
});
