const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadChapters } = require('../src/core/storyContent');

const main = () => loadChapters().chapters.filter((c) => (c.track ?? 'main') === 'main');

test('the main story runs from N5 to N1 in six chapters per level, numbered 1 to 30 in order', () => {
  const chapters = main();
  assert.equal(chapters.length, 30);
  assert.deepEqual(chapters.map((c) => c.order), Array.from({ length: 30 }, (_, i) => i + 1));
  for (const level of ['N5', 'N4', 'N3', 'N2', 'N1']) assert.equal(chapters.filter((c) => c.jlpt === level).length, 6, `${level} needs six chapters`);
  const levels = chapters.map((c) => c.jlpt);
  assert.deepEqual(levels, [...levels].sort((a, b) => b.localeCompare(a)), 'levels never go backwards');
  chapters.forEach((c) => assert.match(c.title, new RegExp(`^Chapter ${c.order}: `), `${c.id} title carries its chapter number`));
  assert.equal(new Set(chapters.map((c) => c.id)).size, 30);
});

test('each chapter teaches enough: grammar of its own level, kanji practice, and a picture to unlock', () => {
  for (const chapter of main()) {
    const grammar = chapter.items.filter((i) => i.startsWith('g:'));
    const kanji = chapter.items.filter((i) => i.startsWith('k:'));
    assert.ok(grammar.length >= 3, `${chapter.id} should test at least 3 grammar points`);
    assert.ok(kanji.length >= 2, `${chapter.id} should practise at least 2 kanji`);
    const level = chapter.jlpt.toLowerCase();
    const own = grammar.filter((g) => g.startsWith(`g:${level}-`));
    assert.ok(own.length >= Math.min(3, grammar.length), `${chapter.id}: most grammar should be ${chapter.jlpt}`);
    assert.ok(chapter.beats.some((b) => b.type === 'cg'), `${chapter.id} should unlock a picture`);
    assert.ok(chapter.beats.some((b) => b.type === 'affection'), `${chapter.id} should move a bond`);
  }
});

test('no grammar point is used twice within a level, so every chapter adds something new', () => {
  const seen = new Map();
  for (const chapter of main()) {
    for (const item of chapter.items.filter((i) => i.startsWith('g:'))) {
      const key = `${chapter.jlpt}:${item}`;
      assert.ok(!seen.has(key), `${item} appears in both ${seen.get(key)} and ${chapter.id}`);
      seen.set(key, chapter.id);
    }
  }
});

test('characters introduced later in the story only speak after they are on stage', () => {
  for (const chapter of main()) {
    const shown = new Set();
    for (const beat of chapter.beats) {
      if (beat.type === 'show') shown.add(beat.char);
      else if (beat.type === 'hide') shown.delete(beat.char);
      else if (beat.type === 'say' && beat.who) assert.ok(shown.has(beat.who), `${chapter.id}: ${beat.who} speaks before appearing`);
    }
  }
});
