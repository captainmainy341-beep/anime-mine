import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, requeueGap } from '../src/renderer/learn/vn/engine.mjs';
import { bridgeLine, gradeAttempt, reorder, reorderedBeat, revealAnswer, typedKana } from '../src/renderer/learn/vn/challenge.mjs';
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

test('a wrong grammar choice shows the awkward reaction, then the story moves on instead of retrying in place', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  const out = e.answer(1);
  assert.equal(out.result, 'incorrect');
  assert.equal(out.requeuedIn, 3);
  assert.deepEqual(
    { kind: e.frame().kind, text: e.frame().text, name: e.frame().name },
    { kind: 'awkward', text: 'えっ？', name: 'みお' },
  );
  assert.deepEqual(e.takeReports(), [], 'nothing is reported for a miss');
  assert.equal(e.stage().cast.mio.expr, 'surprised', 'the speaker reacts on screen');
  assert.equal(e.answer(0).result, 'invalid', 'the awkward beat has to be read first');
  e.advance();
  assert.equal(e.frame().kind, 'reading', 'the story continues with the next beat');
  assert.equal(e.stage().cast.mio.expr, 'neutral', 'and the expression goes back');
  assert.equal(e.progress().pending, 1);
});

test('kana input is graded from romaji and katakana, with no penalty for invalid input', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  e.answer(0);
  assert.equal(e.answer('').result, 'invalid');
  assert.equal(e.answer('日本').result, 'invalid');
  assert.equal(e.frame().kind, 'reading', 'invalid input does not trigger the awkward branch');
  assert.equal(e.progress().pending, 0);
  assert.equal(e.answer('nippon').result, 'correct', 'romaji is converted: nippon -> にっぽん');
  assert.deepEqual(e.takeReports().map((r) => r.incorrectCount), [0, 0]);
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

test('finishing reports first-try count, accuracy and the unlocked gallery, with no stars', () => {
  const perfect = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  perfect.advance();
  perfect.answer(0);
  perfect.answer('にほん');
  perfect.answer(0);
  perfect.advance();
  assert.equal(perfect.frame().kind, 'end');
  assert.equal(perfect.isFinished(), true);
  const summary = perfect.frame().summary;
  assert.deepEqual(summary, { total: 3, firstTry: 3, accuracy: 1, affection: { mio: 2 }, gallery: [{ id: 'pic', title: 'Picture' }] });
  assert.equal('stars' in summary, false);
});

test('the backlog records dialogue, awkward reactions and bridge lines once each', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  e.answer(1);
  e.advance();
  assert.deepEqual(e.backlog().map((b) => b.text), ['はじめまして。', 'えっ？']);
});

// A longer scene for requeue timing: c1 early, then ten lines, then c2 as the very last beat.
const long = {
  schema: 1,
  id: 'long',
  title: 'Long',
  jlpt: 'N5',
  source: 'authored',
  characters: { mio: { name: 'みお' } },
  beats: [
    { type: 'show', char: 'mio', expr: 'neutral', pos: 'center' },
    { type: 'say', who: 'mio', text: 'これは 本 です。', en: 'This is a book.' },
    { ...choice, item: 'g:c1' },
    ...Array.from({ length: 10 }, (_, i) => ({ type: 'say', who: 'mio', text: `せりふ${i + 1}`, en: `line ${i + 1}` })),
    { type: 'meaning', item: 'k:c2', prompt: 'p', options: ['book', 'water', 'fire'], correct: 0 },
  ],
};

// Plays forward, answering every challenge with `pick(frame)`; returns the visible frames in order.
function playOut(e, pick, limit = 100) {
  const seen = [];
  for (let i = 0; i < limit && !e.isFinished(); i += 1) {
    const f = e.frame();
    seen.push(f.kind === 'say' ? (f.bridge ? 'bridge' : f.text) : f.kind === 'awkward' ? 'awkward' : `${f.kind}${f.requeued ? '*' : ''}:${f.beat.item}`);
    if (f.kind === 'say' || f.kind === 'awkward' || f.kind === 'intro') e.advance();
    else e.answer(pick(f));
  }
  return seen;
}

const right = (f) => (f.beat.type === 'choice' ? f.beat.options.findIndex((o) => o.correct) : f.beat.correct);
const wrong = (f) => (f.beat.type === 'choice' ? f.beat.options.findIndex((o) => !o.correct) : (f.beat.correct + 1) % f.beat.options.length);

test('a missed challenge comes back three beats later behind a bridge line, then gaps grow to 6', () => {
  const e = createEngine(long);
  let misses = 0;
  const seen = playOut(e, (f) => (f.beat.item === 'g:c1' && misses++ < 2 ? wrong(f) : right(f)));
  assert.deepEqual(seen.slice(0, 9), [
    'これは 本 です。', 'choice:g:c1', 'awkward', 'せりふ1', 'せりふ2', 'せりふ3', 'bridge', 'choice*:g:c1', 'awkward',
  ]);
  // Second miss: six more beats before it is asked again.
  assert.deepEqual(seen.slice(9, 17), ['せりふ4', 'せりふ5', 'せりふ6', 'せりふ7', 'せりふ8', 'せりふ9', 'bridge', 'choice*:g:c1']);
  assert.deepEqual(seen.slice(17), ['せりふ10', 'meaning:k:c2']);
  assert.equal(e.isFinished(), true);
  assert.deepEqual(e.takeReports(), [{ item: 'g:c1', incorrectCount: 2 }, { item: 'k:c2', incorrectCount: 0 }]);
});

test('gap growth is capped', () => {
  assert.deepEqual([1, 2, 3, 4, 9].map(requeueGap), [3, 6, 10, 10, 10]);
});

test('a scene whose last beat is a challenge drains the requeue before it can end', () => {
  const e = createEngine(long);
  let missed = 0;
  const seen = playOut(e, (f) => (f.beat.item === 'k:c2' && missed++ < 3 ? wrong(f) : right(f)));
  assert.deepEqual(seen.slice(-11), [
    'せりふ10', 'meaning:k:c2', 'awkward',
    'bridge', 'meaning*:k:c2', 'awkward',
    'bridge', 'meaning*:k:c2', 'awkward',
    'bridge', 'meaning*:k:c2',
  ]);
  assert.equal(e.isFinished(), true);
  assert.equal(e.frame().kind, 'end');
  assert.deepEqual(e.takeReports(), [{ item: 'g:c1', incorrectCount: 0 }, { item: 'k:c2', incorrectCount: 3 }]);
  const bridge = e.backlog().filter((b) => b.bridge);
  assert.equal(bridge.length, 3);
  assert.equal(bridge[0].text, bridgeLine('meaning', { atEnd: true }).text, 'end-of-scene re-asks use the closing bridge');
});

test('the scene is not finished while anything is still queued, and every challenge is reported exactly once', () => {
  const e = createEngine(long);
  const misses = new Map();
  playOut(e, (f) => {
    const n = misses.get(f.beat.item) ?? 0;
    misses.set(f.beat.item, n + 1);
    return n < 2 ? wrong(f) : right(f);
  });
  assert.equal(e.isFinished(), true);
  const reports = e.takeReports();
  assert.deepEqual(reports.map((r) => r.item).sort(), ['g:c1', 'k:c2']);
  assert.ok(reports.every((r) => r.incorrectCount === 2));
  assert.deepEqual(e.summary(), { total: 2, firstTry: 0, accuracy: 0, affection: {}, gallery: [] });
});

test('re-asked choices shuffle their options and recap the line that led to them', () => {
  const e = createEngine(long);
  e.advance();
  e.answer(1);
  e.advance();
  for (let i = 0; i < 3; i += 1) e.advance();
  const bridge = e.frame();
  assert.equal(bridge.kind, 'say');
  assert.equal(bridge.bridge, true);
  assert.equal(bridge.who, 'mio', 'the asker says the bridge line when on stage');
  assert.ok(bridge.en, 'bridge lines carry a translation');
  assert.equal(e.answer(0).result, 'invalid', 'the bridge line has to be read first');
  e.advance();
  const ask = e.frame();
  assert.equal(ask.requeued, true);
  assert.equal(ask.attempts, 1);
  assert.deepEqual(ask.recap, { who: 'mio', name: 'みお', text: 'これは 本 です。', en: 'This is a book.' });
  assert.deepEqual(ask.beat.options.map((o) => o.text), ['ですか を。', 'か です。', 'ですか。']);
  assert.equal(e.answer(2).result, 'correct', 'answers index into the shown order');
  assert.deepEqual(e.takeReports(), [{ item: 'g:c1', incorrectCount: 1 }]);
});

test('reorder moves every option and remaps meaning answers', () => {
  assert.deepEqual(reorder(3, 1), [1, 2, 0]);
  assert.deepEqual(reorder(3, 2), [2, 0, 1]);
  assert.deepEqual(reorder(3, 3), [1, 2, 0]);
  assert.deepEqual(reorder(1, 1), [0]);
  const meaning = { type: 'meaning', options: ['a', 'b', 'c'], correct: 0 };
  const moved = reorderedBeat(meaning, reorder(3, 1));
  assert.deepEqual(moved.options, ['b', 'c', 'a']);
  assert.equal(moved.correct, 2);
  assert.equal(reorderedBeat({ type: 'reading', answers: ['a'] }, [0]).answers[0], 'a');
});

test('save and load restore the exact position, stage, results and backlog', () => {
  const e = createEngine(scene, { skipIntro: ['g:n5-ka'] });
  e.advance();
  e.answer(0);
  const snap = JSON.parse(JSON.stringify(e.snapshot()));
  assert.equal(snap.scene, 'demo');
  assert.equal(snap.v, 2);
  const restored = createEngine(scene, { restore: snap, skipIntro: ['g:n5-ka'] });
  assert.equal(restored.frame().kind, 'reading');
  assert.deepEqual(restored.stage(), e.stage());
  assert.deepEqual(restored.backlog(), e.backlog());
  assert.equal(restored.takeReports().length, 0, 'restoring never replays reports');
  restored.answer('にほん');
  restored.answer(0);
  restored.advance();
  assert.deepEqual(restored.summary(), { total: 3, firstTry: 3, accuracy: 1, affection: { mio: 2 }, gallery: [{ id: 'pic', title: 'Picture' }] });
});

test('requeued challenges survive save and load, at every point of a re-ask', () => {
  // Restore during the awkward reaction (2), the queue wait (4), the bridge (6), the re-ask (7), the second wait (10).
  for (const at of [2, 4, 6, 7, 10]) {
    const reports = [];
    let e = createEngine(long);
    let misses = 0;
    for (let steps = 0; !e.isFinished() && steps < 100; steps += 1) {
      if (steps === at) e = createEngine(long, { restore: JSON.parse(JSON.stringify(e.snapshot())) });
      const f = e.frame();
      if (f.kind === 'say' || f.kind === 'awkward') e.advance();
      else e.answer(f.beat.item === 'g:c1' && misses++ < 2 ? wrong(f) : right(f));
      reports.push(...e.takeReports());
    }
    assert.equal(e.isFinished(), true, `restored at ${at}`);
    assert.deepEqual(reports, [{ item: 'g:c1', incorrectCount: 2 }, { item: 'k:c2', incorrectCount: 0 }], `restored at ${at}`);
  }
});

test('version 1 saves still load and keep the mistakes made on the challenge they stopped at', () => {
  const snap = { v: 1, scene: 'demo', index: 4, bg: 'classroom-morning', cast: { mio: { expr: 'neutral', pos: 'left' } }, attempts: 2, results: [], backlog: [] };
  const restored = createEngine(scene, { restore: snap, skipIntro: ['g:n5-ka'] });
  assert.equal(restored.frame().kind, 'choice');
  assert.equal(restored.frame().attempts, 2);
  restored.answer(0);
  assert.deepEqual(restored.takeReports(), [{ item: 'g:n5-ka', incorrectCount: 2 }]);
});

test('saves from another scene or damaged saves are refused; bad queue entries are dropped', () => {
  const snap = createEngine(scene).snapshot();
  assert.throws(() => createEngine(scene, { restore: { ...snap, scene: 'other' } }), /different scene/);
  assert.throws(() => createEngine(scene, { restore: { ...snap, index: 999 } }), /damaged/);
  assert.throws(() => createEngine(scene, { restore: { ...snap, v: 9 } }), /different scene/);
  const odd = createEngine(scene, { restore: { ...snap, queue: [{ at: 2 }, { at: 999 }, 'x', { at: 4, misses: 1, wrong: 1, due: 0 }] } });
  assert.equal(odd.progress().pending, 1, 'only the entry pointing at a challenge survives');
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
