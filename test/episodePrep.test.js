const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildEpisodePrep } = require('../src/core/episodePrep');

const word = (surface, { base = surface, reading = '', status = 'new' } = {}) => ({ surface, base, reading, status });
const known = { classify: (token) => token.status };
const tokenizer = (table, calls = []) => async (text) => {
  calls.push(text);
  return table[text] ?? [];
};
const noGloss = async () => ({ meanings: [], reading: '' });
const stages = (table) => (id) => table[id] ?? 0;

const POINTS = [
  { id: 'g:a', title: 'A', jlpt: 'N4', meaning: 'meaning a', pattern: 'AAA' },
  { id: 'g:b', title: 'B', jlpt: 'N3', meaning: 'meaning b', pattern: 'BBB' },
  { id: 'g:c', title: 'C', jlpt: 'N5', meaning: 'meaning c', pattern: 'CCC' },
];
const detectGrammar = (text, points) =>
  points.flatMap((point) =>
    text.split(point.pattern).slice(1).map(() => ({ id: point.id, start: 0, end: point.pattern.length, text: point.pattern })));

test('keeps only new tokens and aggregates by base form', async () => {
  const table = {
    'line one': [
      word('食べ', { base: '食べる', reading: 'タベ' }),
      word('猫', { status: 'known' }),
      word('は', { status: 'skip' }),
      word('走', { status: 'learning' }),
    ],
    'line two': [word('食べ', { base: '食べる', reading: 'タベ' }), word('川', { reading: 'カワ' })],
  };
  const result = await buildEpisodePrep({
    cues: ['line one', 'line two'],
    tokenize: tokenizer(table),
    known,
    points: [],
    detectGrammar,
    stageOf: stages({}),
    glossFor: async (w) => ({ meanings: [`${w} gloss`], reading: w === '食べる' ? 'たべる' : '' }),
  });
  assert.deepEqual(result.words, [
    { word: '食べる', reading: 'たべる', count: 2, example: 'line one', meanings: ['食べる gloss'] },
    { word: '川', reading: 'カワ', count: 1, example: 'line two', meanings: ['川 gloss'] },
  ]);
});

test('reads conjugated words from the dictionary base form, never the surface token', async () => {
  const table = { cue: [word('食べた', { base: '食べる', reading: 'タベタ' })] };
  const glossFor = (readingOf) => async (w) => ({ meanings: ['to eat'], reading: readingOf[w] ?? '' });
  const prep = (readingOf) =>
    buildEpisodePrep({
      cues: ['cue'],
      tokenize: tokenizer(table),
      known,
      points: [],
      detectGrammar,
      stageOf: stages({}),
      glossFor: glossFor(readingOf),
    });
  assert.equal((await prep({ 食べる: 'たべる' })).words[0].reading, 'たべる');
  assert.equal((await prep({})).words[0].reading, '');
});

test('orders words by count then first appearance', async () => {
  const table = {
    'cue one': [word('b'), word('a')],
    'cue two': [word('c'), word('c')],
  };
  const result = await buildEpisodePrep({
    cues: ['cue one', 'cue two'],
    tokenize: tokenizer(table),
    known,
    points: [],
    detectGrammar,
    stageOf: stages({}),
    glossFor: noGloss,
  });
  assert.deepEqual(result.words.map((w) => w.word), ['c', 'b', 'a']);
});

test('treats missing gloss as no meanings', async () => {
  const table = { 'cue': [word('猫')] };
  const result = await buildEpisodePrep({
    cues: ['cue'],
    tokenize: tokenizer(table),
    known,
    points: [],
    detectGrammar,
    stageOf: stages({}),
    glossFor: async () => null,
  });
  assert.deepEqual(result.words[0].meanings, []);
});

test('orders grammar by unlearned stage first, then count, counting once per cue', async () => {
  const cues = ['AAA BBB', 'BBB BBB CCC', 'AAA'];
  const result = await buildEpisodePrep({
    cues,
    tokenize: tokenizer({}),
    known,
    points: POINTS,
    detectGrammar,
    stageOf: stages({ 'g:a': 5, 'g:b': 2, 'g:c': 0 }),
    glossFor: noGloss,
  });
  assert.deepEqual(result.grammar, [
    { id: 'g:b', title: 'B', jlpt: 'N3', meaning: 'meaning b', count: 2, example: 'AAA BBB', stage: 2 },
    { id: 'g:c', title: 'C', jlpt: 'N5', meaning: 'meaning c', count: 1, example: 'BBB BBB CCC', stage: 0 },
    { id: 'g:a', title: 'A', jlpt: 'N4', meaning: 'meaning a', count: 2, example: 'AAA BBB', stage: 5 },
  ]);
});

test('skips blank cues and accepts string or object cues', async () => {
  const calls = [];
  const table = { line: [word('猫')], x: [word('犬')] };
  const result = await buildEpisodePrep({
    cues: ['  ', { text: '' }, 'line', { text: 'x' }, {}],
    tokenize: tokenizer(table, calls),
    known,
    points: [],
    detectGrammar,
    stageOf: stages({}),
    glossFor: noGloss,
  });
  assert.equal(result.cueCount, 2);
  assert.deepEqual(calls, ['line', 'x']);
  assert.deepEqual(result.words.map((w) => w.word), ['猫', '犬']);
});

test('limits words and grammar, glossing only kept words', async () => {
  const glossed = [];
  const table = { cue: [word('a'), word('b'), word('c'), word('b')] };
  const result = await buildEpisodePrep({
    cues: ['cue'],
    tokenize: tokenizer(table),
    known,
    points: POINTS,
    detectGrammar: (text, points) => [...detectGrammar(text, points), ...detectGrammar('AAA', points)],
    stageOf: stages({}),
    glossFor: async (w) => {
      glossed.push(w);
      return { meanings: [], reading: '' };
    },
    wordLimit: 2,
    grammarLimit: 1,
  });
  assert.deepEqual(result.words.map((w) => w.word), ['b', 'a']);
  assert.deepEqual(glossed, ['b', 'a']);
  assert.deepEqual(result.grammar.map((g) => g.id), ['g:a']);
});
