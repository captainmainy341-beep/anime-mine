import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/renderer/lib/session.mjs';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepFreeze(o) {
  Object.values(o).forEach((v) => typeof v === 'object' && v !== null && deepFreeze(v));
  return Object.freeze(o);
}

const kanji = (id, reading = { accepted: ['こう'], alsoKnown: [], askType: 'on' }) => ({
  id, kind: 'kanji', char: id, meanings: ['m'], reading,
});
const radical = (id) => ({ id, kind: 'radical', char: id, meanings: ['m'], reading: null });
const grammar = (id) => ({ id, kind: 'grammar', title: id, cloze: { ja: '{{a}}', answers: ['a'] } });

test('only the first batchSize items are in play until one finishes', () => {
  const cards = [kanji('a'), kanji('b'), kanji('c'), kanji('d')];
  const s = createSession({ cards, batchSize: 2, rng: mulberry32(7) });
  const seen = new Set();
  while (s.progress().itemsDone === 0) {
    seen.add(s.current().card.id);
    s.answer('correct');
  }
  assert.ok([...seen].every((id) => id === 'a' || id === 'b'));
  while (!s.isFinished()) {
    seen.add(s.current().card.id);
    s.answer('correct');
  }
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c', 'd']);
});

test('a wrong answer re-queues the same question and it is not asked immediately', () => {
  const s = createSession({ cards: [kanji('k')], rng: mulberry32(1) });
  const first = s.current();
  s.answer('incorrect');
  const second = s.current();
  assert.notEqual(second.question, first.question);
  s.answer('correct');
  const third = s.current();
  assert.equal(third.question, first.question);
  assert.equal(third.wrongForItem, 1);
});

test('item completes when all its questions are correct, with total incorrectCount', () => {
  const s = createSession({ cards: [kanji('k')], rng: mulberry32(3) });
  assert.equal(s.answer('incorrect').incorrectCount, null);
  assert.equal(s.answer('incorrect').itemDone, false);
  assert.equal(s.answer('correct').itemDone, false);
  const done = s.answer('correct');
  assert.deepEqual(done, { itemId: 'k', itemDone: true, incorrectCount: 2, finished: true });
  assert.deepEqual(s.results(), [{ id: 'k', incorrectCount: 2 }]);
});

test('overrideLast turns the most recent incorrect answer into a correct one', () => {
  const s = createSession({ cards: [kanji('k')], rng: mulberry32(5) });
  s.answer('incorrect');
  const r = s.overrideLast();
  assert.equal(r.itemDone, false);
  assert.equal(s.progress().incorrect, 0);
  assert.equal(s.progress().correct, 1);
  assert.equal(s.progress().questionsAnswered, 1);
  assert.equal(s.current().wrongForItem, 0);
  const done = s.answer('correct');
  assert.deepEqual(done, { itemId: 'k', itemDone: true, incorrectCount: 0, finished: true });
});

test('overrideLast can complete a single-question item', () => {
  const s = createSession({ cards: [radical('r')], rng: mulberry32(2) });
  s.answer('incorrect');
  assert.deepEqual(s.overrideLast(), { itemId: 'r', itemDone: true, incorrectCount: 0, finished: true });
  assert.equal(s.current(), null);
});

test('overrideLast is valid once, only directly after an incorrect answer', () => {
  const s = createSession({ cards: [kanji('k')], rng: mulberry32(4) });
  assert.throws(() => s.overrideLast());
  s.answer('incorrect');
  s.overrideLast();
  assert.throws(() => s.overrideLast());
  s.answer('correct');
  assert.throws(() => s.overrideLast());
  const t = createSession({ cards: [kanji('k')], rng: mulberry32(4) });
  t.answer('correct');
  assert.throws(() => t.overrideLast());
});

test('radical and card without reading get a single meaning question', () => {
  const s = createSession({ cards: [radical('r'), kanji('k', null)], batchSize: 2, rng: mulberry32(9) });
  const asked = [];
  while (!s.isFinished()) {
    asked.push(s.current().question);
    s.answer('correct');
  }
  assert.deepEqual(asked, ['meaning', 'meaning']);
});

test('grammar item gets a single cloze question', () => {
  const s = createSession({ cards: [grammar('g')], rng: mulberry32(1) });
  assert.equal(s.current().question, 'cloze');
  assert.equal(s.answer('correct').itemDone, true);
});

test('kanji with reading asks meaning and reading, not forced adjacent', () => {
  let sawSeparated = false;
  for (let seed = 1; seed <= 20 && !sawSeparated; seed++) {
    const s = createSession({ cards: [kanji('a'), kanji('b'), kanji('c')], batchSize: 3, rng: mulberry32(seed) });
    const seq = [];
    while (!s.isFinished()) {
      const c = s.current();
      seq.push(`${c.card.id}:${c.question}`);
      s.answer('correct');
    }
    assert.equal(seq.length, 6);
    for (const id of ['a', 'b', 'c']) {
      assert.deepEqual(seq.filter((x) => x.startsWith(id + ':')).map((x) => x.split(':')[1]).sort(), ['meaning', 'reading']);
    }
    const i = seq.findIndex((x) => x.startsWith('a:'));
    const j = seq.findIndex((x, k) => k !== i && x.startsWith('a:'));
    if (Math.abs(i - j) > 1) sawSeparated = true;
  }
  assert.equal(sawSeparated, true);
});

test('finishing: current is null, answer throws, progress is complete', () => {
  const s = createSession({ cards: [radical('a'), radical('b')], rng: mulberry32(11) });
  s.answer('correct');
  const last = s.answer('correct');
  assert.equal(last.finished, true);
  assert.equal(s.isFinished(), true);
  assert.equal(s.current(), null);
  assert.throws(() => s.answer('correct'));
  assert.deepEqual(s.progress(), {
    itemsDone: 2, itemsTotal: 2, questionsAnswered: 2, correct: 2, incorrect: 0, accuracy: 1,
  });
});

test('empty deck is finished immediately', () => {
  const s = createSession({ cards: [] });
  assert.equal(s.isFinished(), true);
  assert.equal(s.current(), null);
  assert.deepEqual(s.results(), []);
});

test('progress accuracy reflects attempts', () => {
  const s = createSession({ cards: [kanji('k')], rng: mulberry32(6) });
  assert.equal(s.progress().accuracy, null);
  s.answer('correct');
  s.answer('incorrect');
  assert.equal(s.progress().accuracy, 0.5);
  assert.equal(s.progress().itemsDone, 0);
});

test('results are in completion order with per-item incorrectCount', () => {
  const cards = [kanji('a'), radical('b'), grammar('c')];
  const s = createSession({ cards, batchSize: 1, rng: mulberry32(8) });
  s.answer('incorrect');
  s.overrideLast();
  const order = [];
  while (!s.isFinished()) {
    const r = s.answer('correct');
    if (r.itemDone) order.push(r.itemId);
  }
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.deepEqual(s.results(), [
    { id: 'a', incorrectCount: 0 },
    { id: 'b', incorrectCount: 0 },
    { id: 'c', incorrectCount: 0 },
  ]);
});

test('results follow the order items finish when batch holds several items', () => {
  const cards = [radical('a'), radical('b'), radical('c'), radical('d')];
  const s = createSession({ cards, batchSize: 3, rng: mulberry32(21) });
  const order = [];
  while (!s.isFinished()) {
    const r = s.answer('correct');
    if (r.itemDone) order.push(r.itemId);
  }
  assert.deepEqual(s.results().map((r) => r.id), order);
  assert.deepEqual(order.slice().sort(), ['a', 'b', 'c', 'd']);
});

test('same seed gives the same question sequence', () => {
  const run = () => {
    const s = createSession({ cards: [kanji('a'), kanji('b')], batchSize: 2, rng: mulberry32(42) });
    const seq = [];
    while (!s.isFinished()) {
      const c = s.current();
      seq.push(`${c.card.id}:${c.question}`);
      s.answer('correct');
    }
    return seq;
  };
  assert.deepEqual(run(), run());
});

test('does not mutate input cards', () => {
  const cards = deepFreeze([kanji('a'), radical('b'), grammar('c')]);
  const snapshot = structuredClone(cards);
  const s = createSession({ cards, batchSize: 2, rng: mulberry32(13) });
  s.answer('incorrect');
  s.overrideLast();
  while (!s.isFinished()) {
    s.current();
    s.answer('incorrect');
    s.answer('correct');
  }
  s.results();
  assert.deepEqual(cards, snapshot);
});
