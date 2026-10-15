import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, starsFor } from '../src/renderer/learn/vn/engine.mjs';
import { gradeAttempt, revealAnswer, typedKana } from '../src/renderer/learn/vn/challenge.mjs';
import { autoDelay, isComplete, sliceText, visibleCount } from '../src/renderer/learn/vn/typewriter.mjs';

const choice = {
  type: 'choice',
  item: 'g:n5-ka',
  who: 'mio',
  prompt: 'Ask',
  options: [
    { text: 'ですか。', correct: true },
    { text: 'ですか を。', awkward: { who: 'mio', text: 'えっ？' } },
    { text: 'か です。' },
  ],
};

const scene = {
  schema: 1,
  id: 'demo',
  title: 'Demo',
  jlpt: 'N5',
  source: 'authored',
  bg: 'park-day',
  characters: { mio: { name: 'みお' }, sora: { name: 'そら' } },
  beats: [
    { type: 'bg', bg: 'classroom-morning' },
    { type: 'show', char: 'mio', expr: 'smile', pos: 'left' },
    { type: 'say', who: 'mio', text: 'はじめまして。', en: 'Hello.', expr: 'neutral' },
    { type: 'intro', item: 'g:n5-ka' },
    choice,
    { type: 'affection', char: 'mio', delta: 2 },
    { type: 'reading', item: 'k:日', display: '日本', target: '日', answers: ['にほん', 'にっぽん'] },
    { type: 'jump', to: 'skip' },
    { type: 'say', who: 'sora', text: 'ここは とばされる。' },
    { type: 'cg', id: 'pic', title: 'Picture', label: 'skip' },
    { type: 'meaning', item: 'k:本', prompt: 'p', options: ['book', 'water'], correct: 0 },
    { type: 'say', who: null, text: 'おわり。' },
  ],
};

test('stepping applies stage effects and stops on the first displayed beat', () => {
  const e = createEngine(scene);
  assert.deepEqual(e.stage(), { bg: 'classroom-morning', cast: { mio: { expr: 'neutral', pos: 'left' } } });
  const frame = e.frame();
  assert.equal(frame.kind, 'say');
  assert.equal(frame.name, 'みお');
  assert.equal(frame.en, 'Hello.');
  assert.equal(e.advance(), true);
  assert.equal(e.frame().kind, 'intro');
  assert.equal(e.frame().item, 'g:n5-ka');
});

test('intro cards are skipped for items the learner already studies', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  assert.equal(e.frame().kind, 'choice');
});

test('challenges cannot be skipped with advance()', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  assert.equal(e.advance(), false);
  assert.equal(e.frame().kind, 'choice');
});

test('a wrong grammar choice branches to an awkward reaction, then retries the same challenge', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  assert.equal(e.answer(1).result, 'incorrect');
  assert.deepEqual(
    { kind: e.frame().kind, text: e.frame().text, name: e.frame().name },
    { kind: 'awkward', text: 'えっ？', name: 'みお' },
  );
  assert.deepEqual(e.takeReports(), []);
  e.advance();
  assert.equal(e.frame().kind, 'choice');
  assert.equal(e.frame().attempts, 1);
  assert.equal(e.answer(2).result, 'incorrect');
  assert.match(e.frame().text, /へんな/, 'options without a custom reaction use the generic one');
  e.advance();
  assert.equal(e.answer(0).result, 'correct');
  assert.equal(e.frame().kind, 'reading');
  assert.deepEqual(e.takeReports(), [{ item: 'g:n5-ka', incorrectCount: 2 }]);
  assert.deepEqual(e.takeReports(), [], 'reports are drained once');
});

test('kana input is graded from romaji and katakana, with no penalty for invalid input', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  e.answer(0);
  assert.equal(e.answer('').result, 'invalid');
  assert.equal(e.answer('日本').result, 'invalid');
  assert.equal(e.frame().kind, 'reading', 'invalid input does not trigger the awkward branch');
  assert.equal(e.answer('ひのもと').result, 'incorrect');
  e.advance();
  assert.equal(e.answer('nippon').result, 'correct', 'romaji is converted: nippon -> にっぽん');
  assert.deepEqual(e.takeReports().map((r) => r.incorrectCount), [0, 1]);
});

test('jumps skip beats forward, effects on the way are still applied', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  e.answer(0);
  e.answer('にほん');
  assert.equal(e.frame().kind, 'meaning', 'the sora line between jump and label is skipped');
  assert.deepEqual(e.summary().gallery, [{ id: 'pic', title: 'Picture' }]);
  assert.equal(e.summary().affection.mio, 2);
});

test('finishing reports accuracy, stars and the unlocked gallery', () => {
  const perfect = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  perfect.advance();
  perfect.answer(0);
  perfect.answer('にほん');
  perfect.answer(0);
  perfect.advance();
  assert.equal(perfect.frame().kind, 'end');
  assert.equal(perfect.isFinished(), true);
  const summary = perfect.frame().summary;
  assert.deepEqual({ total: summary.total, firstTry: summary.firstTry, stars: summary.stars }, { total: 3, firstTry: 3, stars: 3 });

  const sloppy = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  sloppy.advance();
  sloppy.answer(2);
  sloppy.advance();
  sloppy.answer(0);
  sloppy.answer('ひ');
  sloppy.advance();
  sloppy.answer('にほん');
  sloppy.answer(1);
  sloppy.advance();
  sloppy.answer(0);
  sloppy.advance();
  assert.equal(sloppy.summary().firstTry, 0);
  assert.equal(sloppy.summary().stars, 1);
});

test('stars thresholds', () => {
  assert.deepEqual([1, 0.9, 0.89, 0.6, 0.59, 0].map(starsFor), [3, 3, 2, 2, 1, 1]);
});

test('the backlog records dialogue and awkward reactions once each', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  e.answer(1);
  e.advance();
  assert.deepEqual(e.backlog().map((b) => b.text), ['はじめまして。', 'えっ？']);
});

test('save and load restore the exact position, stage, results and mistakes', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  e.answer(2);
  e.advance();
  e.answer(0);
  const snap = JSON.parse(JSON.stringify(e.snapshot()));
  assert.equal(snap.scene, 'demo');
  const restored = createEngine(scene, { restore: snap, skipIntro: ['g:n5-ka'] });
  assert.equal(restored.frame().kind, 'reading');
  assert.deepEqual(restored.stage(), e.stage());
  assert.deepEqual(restored.backlog(), e.backlog());
  assert.equal(restored.takeReports().length, 0, 'restoring never replays reports');
  restored.answer('にほん');
  restored.answer(0);
  restored.advance();
  assert.deepEqual(restored.summary(), { total: 3, firstTry: 2, accuracy: 2 / 3, stars: 2, affection: { mio: 2 }, gallery: [{ id: 'pic', title: 'Picture' }] });
});

test('a mid-retry save keeps the mistake count', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  e.answer(2);
  const restored = createEngine(scene, { restore: e.snapshot(), skipIntro: ['g:n5-ka'] });
  assert.equal(restored.frame().kind, 'choice');
  restored.answer(0);
  assert.deepEqual(restored.takeReports(), [{ item: 'g:n5-ka', incorrectCount: 1 }]);
});

test('saves from another scene or damaged saves are refused', () => {
  const snap = createEngine(scene).snapshot();
  assert.throws(() => createEngine(scene, { restore: { ...snap, scene: 'other' } }), /different scene/);
  assert.throws(() => createEngine(scene, { restore: { ...snap, index: 999 } }), /damaged/);
  assert.throws(() => createEngine(scene, { restore: { ...snap, v: 9 } }), /different scene/);
});

test('challenge grading: grammar choices, meanings and kana', () => {
  assert.deepEqual(gradeAttempt(choice, 0), { result: 'correct' });
  assert.equal(gradeAttempt(choice, 1).awkward.text, 'えっ？');
  assert.equal(gradeAttempt(choice, 2).awkward, null);
  assert.equal(gradeAttempt(choice, 7).result, 'invalid');
  const meaning = scene.beats[10];
  assert.equal(gradeAttempt(meaning, 0).result, 'correct');
  assert.equal(gradeAttempt(meaning, 1).result, 'incorrect');
  const reading = scene.beats[6];
  assert.equal(gradeAttempt(reading, 'nihon').result, 'correct');
  assert.equal(gradeAttempt(reading, 'ニホン').result, 'correct');
  assert.equal(gradeAttempt(reading, 'にほん ').result, 'correct');
  assert.equal(gradeAttempt(reading, 'ni').result, 'incorrect');
  assert.equal(gradeAttempt(reading, 42).result, 'invalid');
  assert.equal(revealAnswer(reading), 'にほん');
  assert.equal(revealAnswer(choice), 'ですか。');
  assert.equal(revealAnswer(meaning), 'book');
});

test('typedKana converts romaji live and keeps trailing n until final', () => {
  assert.equal(typedKana('kyou'), 'きょう');
  assert.equal(typedKana('hon'), 'ほn');
  assert.equal(typedKana('hon', { final: true }), 'ほん');
  assert.equal(typedKana('かんじ'), 'かんじ');
});

test('typewriter reveals by code point and respects skip and auto timing', () => {
  assert.equal(visibleCount('こんにちは', 0), 0);
  assert.equal(visibleCount('こんにちは', 100, 20), 2);
  assert.equal(visibleCount('こんにちは', 99999), 5);
  assert.equal(visibleCount('こんにちは', 10, 0), 5);
  assert.equal(sliceText('😀あい', 2), '😀あ');
  assert.equal(isComplete('ab', 2), true);
  assert.equal(isComplete('ab', 1), false);
  assert.ok(autoDelay('あ'.repeat(10)) < autoDelay('あ'.repeat(40)));
  assert.equal(autoDelay('あ'.repeat(1000)), 6000);
});
