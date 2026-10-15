const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadLessons, validateLesson, lessonSummary } = require('../src/core/storyLessons');
const { loadChapters } = require('../src/core/storyContent');
const { loadGrammar } = require('../src/core/grammar');

function good(overrides = {}) {
  return {
    schema: 1,
    id: 'genki-l99',
    lesson: 1,
    title: 'T',
    tagline: 'tag',
    hook: 'hook',
    goals: ['a', 'b'],
    minutes: 5,
    vocab: Array.from({ length: 8 }, (_, i) => [`語${i}`, 'ごい', `word ${i}`]),
    points: [
      { id: 'g:n5-ka', title: '〜か', formula: 'A か', gist: 'q', explain: ['x'], examples: [{ ja: 'A|ですか。', gloss: 'a|q', en: 'Is it A?' }, { ja: 'B|ですか。', en: 'Is it B?' }] },
      { id: 'g:n5-no', title: '〜の', formula: 'A の B', gist: 'of', explain: ['x'], examples: [{ ja: 'A|の|B', en: 'AB' }, { ja: 'C|の|D', en: 'CD' }] },
    ],
    drills: [
      { type: 'gap', ja: 'わたし＿です。', options: ['は', 'を'], answer: 'は', en: 'I am' },
      { type: 'pick', q: 'q', options: ['a', 'b'], answer: 1 },
      { type: 'order', en: 'x', chunks: ['a', 'b'], alts: [['b', 'a']] },
      { type: 'type', prompt: 'p', answers: ['ネコ'] },
      { type: 'gap', ja: 'あ＿い', options: ['う', 'え'], answer: 'え', en: 'x' },
      { type: 'pick', q: 'q', options: ['a', 'b', 'c'], answer: 0 },
    ],
    ...overrides,
  };
}

test('a good lesson validates and normalises typed answers to hiragana', () => {
  const result = validateLesson(good());
  assert.equal(result.ok, true);
  assert.deepEqual(result.lesson.drills[3].answers, ['ねこ']);
  assert.deepEqual(lessonSummary(result.lesson), { id: 'genki-l99', lesson: 1, title: 'T', tagline: 'tag', minutes: 5, words: 8, patterns: 2, drills: 6 });
});

test('malformed lessons are rejected with a reason', () => {
  const bad = (patch, pattern) => {
    const result = validateLesson(good(patch));
    assert.equal(result.ok, false, JSON.stringify(patch).slice(0, 80));
    assert.match(result.errors.join(' | '), pattern);
  };
  bad({ schema: 2 }, /schema/);
  bad({ id: 'Bad Id' }, /id/);
  bad({ lesson: 0 }, /lesson/);
  bad({ goals: ['one'] }, /goals/);
  bad({ vocab: [['a', 'a', 'b']] }, /vocab/);
  bad({ vocab: Array.from({ length: 8 }, () => ['語', 'ごい', 'same']) }, /different/);
  bad({ points: [good().points[0]] }, /points/);
  bad({ drills: good().drills.slice(0, 3) }, /drills/);
  bad({ drills: [{ type: 'gap', ja: 'no gap', options: ['a', 'b'], answer: 'a', en: 'x' }, ...good().drills.slice(1)] }, /gap/);
  bad({ drills: [{ type: 'gap', ja: 'わ＿', options: ['a', 'b'], answer: 'z', en: 'x' }, ...good().drills.slice(1)] }, /answer/);
  bad({ drills: [{ type: 'pick', q: 'q', options: ['a', 'b'], answer: 5 }, ...good().drills.slice(1)] }, /answer/);
  bad({ drills: [{ type: 'order', en: 'x', chunks: ['a', 'b'], alts: [['a', 'c']] }, ...good().drills.slice(1)] }, /alts/);
  bad({ drills: [{ type: 'type', prompt: 'p', answers: ['latin'] }, ...good().drills.slice(1)] }, /kana/);
  bad({ drills: [{ type: 'dance' }, ...good().drills.slice(1)] }, /unknown type/);
  bad({ points: [{ ...good().points[0], examples: [{ ja: 'a|b', gloss: 'one', en: 'x' }, good().points[0].examples[1]] }, good().points[1]] }, /gloss/);
});

test('every shipped lesson is valid and has a matching Genki story scene', () => {
  const { lessons, problems } = loadLessons();
  assert.deepEqual(problems, []);
  assert.deepEqual(lessons.map((l) => l.lesson), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const scenes = new Map(loadChapters().chapters.map((c) => [c.id, c]));
  for (const lesson of lessons) {
    const scene = scenes.get(lesson.id);
    assert.ok(scene && scene.track === 'genki' && scene.lesson === lesson.lesson, `${lesson.id} needs a story scene`);
    assert.ok(lesson.vocab.length >= 15, `${lesson.id} should teach at least 15 words`);
    assert.ok(lesson.drills.length >= 10, `${lesson.id} should have at least 10 exercises`);
    assert.ok(lesson.drills.filter((d) => d.type === 'type').length >= 1, `${lesson.id} needs a typing exercise`);
  }
});

test('lesson points cover the grammar their story scene tests, and deck grammar ids exist', () => {
  const grammar = loadGrammar();
  const scenes = new Map(loadChapters().chapters.map((c) => [c.id, c]));
  for (const lesson of loadLessons().lessons) {
    const taught = new Set(lesson.points.map((p) => p.id));
    for (const point of lesson.points) {
      if (!point.id.startsWith('g:genki-')) assert.ok(grammar.byId.has(point.id), `${lesson.id}: unknown grammar ${point.id}`);
    }
    // Every story grammar point with a g:genki-* id (not in the deck) must be taught before the scene.
    const scene = scenes.get(lesson.id);
    for (const item of scene.items.filter((i) => i.startsWith('g:genki-'))) {
      assert.ok(taught.has(item), `${lesson.id}: story tests ${item} but the primer never teaches it`);
    }
  }
});
