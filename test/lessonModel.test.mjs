import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildSteps, createLessonRun, createMatchGame, exampleChunks, formulaChips, gradeDrill, mulberry32, orderTiles, sectionSpans, shuffled, shuffledPick, startablePoints } from '../src/renderer/learn/lessonModel.mjs';

const require = createRequire(import.meta.url);
const { loadLessons } = require('../src/core/storyLessons');
const { lessons } = loadLessons();
const lesson = lessons.find((l) => l.id === 'genki-l01');

test('a lesson is built as words, then each pattern with its exercises, then mixed practice', () => {
  const steps = buildSteps(lesson);
  assert.equal(steps[0].kind, 'intro');
  assert.equal(steps.at(-1).kind, 'done');
  const kinds = steps.map((s) => s.kind);
  assert.equal(kinds.filter((k) => k === 'cards').length, Math.ceil(lesson.vocab.length / 5));
  assert.equal(kinds.filter((k) => k === 'concept').length, lesson.points.length);
  const firstConcept = kinds.indexOf('concept');
  assert.ok(kinds.slice(0, firstConcept).every((k) => ['intro', 'cards', 'match'].includes(k)), 'words come first');
  assert.equal(steps.filter((s) => s.kind === 'drill').length, lesson.drills.length, 'every exercise appears exactly once');
  assert.equal(new Set(steps.filter((s) => s.kind === 'drill').map((s) => s.key)).size, lesson.drills.length);
  // a drill belonging to a pattern never runs before that pattern is taught
  steps.forEach((s, i) => {
    if (s.kind === 'drill' && s.drill.point !== undefined && s.section === 1) {
      const concept = steps.findIndex((c) => c.kind === 'concept' && c.point === s.drill.point);
      assert.ok(concept >= 0 && concept < i);
    }
  });
  const spans = sectionSpans(steps);
  assert.deepEqual(spans.map((s) => s.label), ['Words', 'Patterns', 'Practice']);
  assert.ok(spans[0].to <= spans[1].from + 0 || spans[0].to === spans[1].from);
});

test('drills are graded for every type, with order alternatives and kana normalisation', () => {
  assert.equal(gradeDrill({ type: 'gap', answer: 'は', options: ['は', 'を'] }, 'は').ok, true);
  assert.equal(gradeDrill({ type: 'gap', answer: 'は', options: ['は', 'を'] }, 'を').ok, false);
  assert.deepEqual(gradeDrill({ type: 'pick', options: ['a', 'b'], answer: 1 }, 0), { ok: false, expected: 'b' });
  const order = { type: 'order', chunks: ['あ', 'い', 'う'], alts: [['い', 'あ', 'う']] };
  assert.equal(gradeDrill(order, ['あ', 'い', 'う']).ok, true);
  assert.equal(gradeDrill(order, ['い', 'あ', 'う']).ok, true);
  assert.equal(gradeDrill(order, ['う', 'い', 'あ']).ok, false);
  assert.equal(gradeDrill(order, ['あ', 'い']).ok, false);
  const type = { type: 'type', answers: ['せんせい'] };
  assert.equal(gradeDrill(type, 'せんせい').ok, true);
  assert.equal(gradeDrill(type, 'センセイ').ok, true, 'katakana is accepted');
  assert.equal(gradeDrill(type, ' せん せい ').ok, true);
  assert.equal(gradeDrill(type, '').ok, false);
  assert.equal(gradeDrill(type, 'せんせ').ok, false);
});

test('shuffles are seeded, keep every item and never hand over a solved order puzzle', () => {
  const a = shuffled([1, 2, 3, 4, 5, 6], mulberry32(7));
  const b = shuffled([1, 2, 3, 4, 5, 6], mulberry32(7));
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6]);
  const pick = { options: ['x', 'y', 'z', 'w'], answer: 2 };
  for (let seed = 1; seed < 30; seed += 1) {
    const out = shuffledPick(pick, mulberry32(seed));
    assert.equal(out.options[out.answer], 'z');
  }
  const drill = { chunks: ['a', 'b', 'c'], extra: ['d'] };
  for (let seed = 1; seed < 30; seed += 1) {
    const tiles = orderTiles(drill, mulberry32(seed));
    assert.deepEqual([...tiles].sort(), ['a', 'b', 'c', 'd']);
    assert.notEqual(tiles.slice(0, 3).join(''), 'abc');
  }
});

test('the match game pairs Japanese with English, counts misses and finishes when all are matched', () => {
  const words = [{ ja: '先生', reading: 'せんせい', en: 'teacher' }, { ja: '学生', reading: 'がくせい', en: 'student' }, { ja: '大学', reading: 'だいがく', en: 'university' }];
  const game = createMatchGame(words, mulberry32(3));
  const find = (side, id) => (side === 'left' ? game.left : game.right).findIndex((x) => x.id === id);
  assert.deepEqual(game.pick('left', find('left', 0)).type, 'pending');
  assert.equal(game.pick('right', find('right', 1)).type, 'miss');
  assert.equal(game.misses, 1);
  game.pick('left', find('left', 0));
  assert.equal(game.pick('right', find('right', 0)).type, 'match');
  assert.equal(game.isMatched(0), true);
  assert.equal(game.pick('left', find('left', 0)).type, 'ignored', 'a matched word cannot be picked again');
  game.pick('left', find('left', 1));
  game.pick('right', find('right', 1));
  game.pick('right', find('right', 2));
  const last = game.pick('left', find('left', 2));
  assert.deepEqual([last.type, last.done], ['match', true]);
  assert.equal(game.done, true);
  const again = createMatchGame(words, mulberry32(3));
  again.pick('left', 0);
  assert.equal(again.pick('left', 1).type, 'pending', 'picking the same side again just moves the selection');
  assert.equal(again.pending.index, 1);
});

test('a run tracks XP and streaks, and a missed exercise comes back once at the end', () => {
  const run = createLessonRun(lesson);
  const total = run.steps.length;
  const drills = run.steps.filter((s) => s.kind === 'drill');
  const first = drills[0];
  const right = (d) => (d.type === 'gap' ? d.answer : d.type === 'pick' ? d.answer : d.type === 'order' ? d.chunks : d.answers[0]);
  assert.equal(run.answerDrill(first, right(first.drill)).ok, true);
  assert.deepEqual([run.stats.xp, run.stats.streak, run.stats.firstTry], [10, 1, 1]);
  const second = drills[1];
  const wrong = second.drill.type === 'order' ? [...second.drill.chunks].reverse() : second.drill.type === 'type' ? 'ぬぬぬ' : second.drill.type === 'pick' ? (second.drill.answer + 1) % second.drill.options.length : second.drill.options.find((o) => o !== second.drill.answer);
  assert.equal(run.answerDrill(second, wrong).ok, false);
  assert.equal(run.stats.streak, 0);
  assert.equal(run.steps.length, total + 1, 'one retry queued');
  assert.equal(run.steps.at(-2).retry, true);
  assert.equal(run.steps.at(-1).kind, 'done');
  const retry = run.steps.at(-2);
  assert.equal(run.answerDrill(retry, wrong).ok, false);
  assert.equal(run.steps.length, total + 1, 'a retry is not queued again');
  assert.equal(run.stats.scored, 2, 'only first attempts are scored');
  assert.equal(run.accuracy(), 0.5);
  run.finishMatch(0);
  assert.equal(run.stats.scored, 3);
});

test('streaks earn bonus XP and accuracy starts at 100% with nothing scored', () => {
  const run = createLessonRun(lesson);
  assert.equal(run.accuracy(), 1);
  const drills = run.steps.filter((s) => s.kind === 'drill' && s.drill.type === 'gap').slice(0, 4);
  const xp = drills.map((s) => {
    run.answerDrill(s, s.drill.answer);
    return run.stats.xp;
  });
  assert.deepEqual(xp, [10, 20, 31, 42], 'a +1 bonus every third answer in a row, growing with the streak');
  assert.equal(run.stats.bestStreak, 4);
});

test('example chunks line up with their gloss and formulas become chips', () => {
  assert.deepEqual(exampleChunks({ ja: 'わたしは|ノアです。', gloss: 'topic|name', en: '' }), [{ text: 'わたしは', gloss: 'topic' }, { text: 'ノアです。', gloss: 'name' }]);
  assert.deepEqual(exampleChunks({ ja: 'ひとつ', en: '' }), [{ text: 'ひとつ', gloss: '' }]);
  assert.deepEqual(formulaChips('A は B です').map((c) => c.kind), ['slot', 'particle', 'slot', 'word']);
});

test('only grammar points that are new to the learner can be started from the lesson', () => {
  const items = { 'g:n5-wa-desu': { state: 'new' }, 'g:n5-ka': { state: 'started' }, 'g:n5-no': { state: 'untracked' } };
  assert.deepEqual(startablePoints(lesson, items).map((p) => p.id), ['g:n5-wa-desu']);
});

test('every shipped lesson builds a run that can be played to the end', () => {
  for (const l of lessons) {
    const run = createLessonRun(l);
    for (let guard = 0; guard < 400 && !run.finished; guard += 1) {
      const step = run.step;
      if (step.kind === 'drill') {
        const d = step.drill;
        run.answerDrill(step, d.type === 'gap' ? d.answer : d.type === 'pick' ? d.answer : d.type === 'order' ? d.chunks : d.answers[0]);
      } else if (step.kind === 'match') run.finishMatch(0);
      run.advance();
    }
    assert.equal(run.finished, true, `${l.id} finishes`);
    assert.equal(run.accuracy(), 1);
  }
});
