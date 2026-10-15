const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize } = require('../src/core/tokenizer');
const { loadGrammar } = require('../src/core/grammar');
const { createGrammarHandlers } = require('../src/main/grammarHandlers');

test('grammar:analyze returns a full analysis for a sentence', async () => {
  const { handlers, stop } = createGrammarHandlers({ tokenize });
  const a = await handlers['grammar:analyze']('猫が魚を食べた');
  assert.deepEqual(a.particles.map((p) => p.id), ['p:ga', 'p:wo']);
  assert.deepEqual(a.conjugations[0].steps.map((s) => s.label), ['past']);
  assert.equal(typeof stop, 'function');
  stop();
});

test('grammar:analyze rejects non-strings and text over 400 characters', async () => {
  const { handlers } = createGrammarHandlers({ tokenize });
  await assert.rejects(handlers['grammar:analyze'](42), /text must be a string of at most 400 characters/);
  await assert.rejects(handlers['grammar:analyze']('あ'.repeat(401)), /at most 400/);
  await assert.rejects(handlers['grammar:analyze'](null), /at most 400/);
});

test('grammar:analyze accepts empty text and 400 characters', async () => {
  const { handlers } = createGrammarHandlers({ tokenize });
  const empty = await handlers['grammar:analyze']('');
  assert.deepEqual(empty.chunks, []);
  const exact = await handlers['grammar:analyze']('猫が魚を食べた。'.repeat(50));
  assert.ok(exact.chunks.length > 0);
});

test('grammar data loads lazily and only once', async () => {
  let loads = 0;
  const { handlers } = createGrammarHandlers({
    tokenize,
    loadGrammar: (dir) => {
      loads += 1;
      return loadGrammar(dir);
    },
  });
  assert.equal(loads, 0);
  await handlers['grammar:analyze']('学校に行きたくなかった');
  await handlers['grammar:analyze']('雨が降っているので家にいる');
  assert.equal(loads, 1);
});

test('a failed grammar load is retried on the next call', async () => {
  let attempts = 0;
  const { handlers } = createGrammarHandlers({
    tokenize,
    loadGrammar: (dir) => {
      attempts += 1;
      if (attempts === 1) throw new Error('disk gone');
      return loadGrammar(dir);
    },
  });
  await assert.rejects(handlers['grammar:analyze']('猫が'), /disk gone/);
  const a = await handlers['grammar:analyze']('猫が');
  assert.equal(attempts, 2);
  assert.equal(a.particles[0].id, 'p:ga');
});

test('grammar:analyze surfaces patterns from the real grammar data', async () => {
  const { handlers } = createGrammarHandlers({ tokenize });
  const a = await handlers['grammar:analyze']('彼に本を読ませられた');
  assert.ok(a.patterns.some((p) => p.title.includes('させられる')));
});
