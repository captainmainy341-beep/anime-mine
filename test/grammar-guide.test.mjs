import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { chunkClasses, groupParticles, explanationFor } from '../src/renderer/lib/grammarGuide.mjs';

const require = createRequire(import.meta.url);
const { tokenize } = require('../src/core/tokenizer.js');
const { loadGrammar } = require('../src/core/grammar.js');
const { analyzeSentence } = require('../src/core/sentenceGrammar.js');

const grammar = loadGrammar();

test('chunkClasses marks the kind and selection state', () => {
  assert.equal(chunkClasses({ kind: 'content' }), 'chunk chunk-content');
  assert.equal(chunkClasses({ kind: 'particle' }, true), 'chunk chunk-particle selected');
  assert.equal(chunkClasses({ kind: 'aux' }), 'chunk chunk-aux');
});

test('groupParticles merges repeated particle roles and keeps first-seen order', () => {
  const particle = (surface, id, role, explanation) => ({ surface, id, role, explanation, name: 'n', example: { ja: 'x', en: 'y' } });
  const groups = groupParticles([
    particle('に', 'p:ni', 'destination', 'to a place'),
    particle('が', 'p:ga', 'subject', 'doer'),
    particle('に', 'p:ni', 'destination', 'to a place'),
    particle('に', 'p:ni', 'time', 'at a time'),
  ]);
  assert.deepEqual(groups.map((g) => [g.surface, g.role, g.count]), [
    ['に', 'destination', 2],
    ['が', 'subject', 1],
    ['に', 'time', 1],
  ]);
});

test('explanationFor returns the particle explanation for a particle chunk', async () => {
  const a = await analyzeSentence('猫が魚を食べた', { tokenize, grammar });
  const chunk = a.chunks.find((c) => c.text === 'を');
  const card = explanationFor(a, chunk);
  assert.equal(card.title, 'を · object marker');
  assert.match(card.body, /action/);
  assert.ok(card.example.ja && card.example.en);
});

test('explanationFor locates each conjugation step by its offset in the chain', async () => {
  const a = await analyzeSentence('学校に行きたくなかった', { tokenize, grammar });
  const labels = a.chunks
    .map((c) => explanationFor(a, c))
    .filter(Boolean)
    .map((card) => card.title);
  assert.ok(labels.includes('たく · want to'));
  assert.ok(labels.includes('なかっ · negative'));
  assert.ok(labels.includes('た · past'));
});

test('explanationFor returns null for plain content words', async () => {
  const a = await analyzeSentence('学校に行きたくなかった', { tokenize, grammar });
  const school = a.chunks.find((c) => c.text === '学校');
  assert.equal(explanationFor(a, school), null);
});

test('explanationFor falls back to a pattern covering a content chunk', () => {
  const analysis = {
    chunks: [{ text: '行き', kind: 'content', start: 0, end: 2 }],
    particles: [],
    conjugations: [],
    patterns: [{ title: '〜たい', level: 'N5', start: 0, end: 4 }],
  };
  const card = explanationFor(analysis, analysis.chunks[0]);
  assert.equal(card.title, '〜たい');
  assert.equal(card.body, 'Grammar pattern, JLPT N5.');
});
