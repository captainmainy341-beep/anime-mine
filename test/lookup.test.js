const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tokenize } = require('../src/core/tokenizer');
const { Dictionary } = require('../src/core/dictionary');
const { lookupAt, groupTokens } = require('../src/core/lookup');

const FIXTURE = path.join(__dirname, 'fixtures', 'jmdict-lookup.json');
const TEXT = '私は日本語を勉強しています。';
let dataDir;
let dict;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-lookup-'));
  fs.copyFileSync(FIXTURE, path.join(dataDir, 'jmdict.json'));
  dict = new Dictionary(dataDir);
  await dict.load();
});

after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function indexOf(tokens, surface) {
  const index = tokens.findIndex((t) => t.surface === surface);
  assert.notEqual(index, -1, `token "${surface}" not found`);
  return index;
}

test('chain of an inflected verb resolves to the noun stem with labels', async () => {
  const tokens = await tokenize(TEXT);
  const result = lookupAt(tokens, indexOf(tokens, '勉強'), dict);
  assert.equal(result.dictForm, '勉強する');
  assert.equal(result.span.text, '勉強しています');
  assert.deepEqual(result.inflection, ['te-form', 'continuing', 'polite']);
  assert.equal(result.entries[0].kanji[0], '勉強');
});

test('every token of a サ変 chain resolves to the same result', async () => {
  const tokens = await tokenize(TEXT);
  const fromStem = lookupAt(tokens, indexOf(tokens, '勉強'), dict);
  for (const surface of ['し', 'て', 'い', 'ます']) {
    assert.deepEqual(lookupAt(tokens, indexOf(tokens, surface), dict), fromStem, surface);
  }
});

test('polite negative past span covers the whole chain', async () => {
  const tokens = await tokenize('食べませんでした');
  const result = lookupAt(tokens, 0, dict);
  assert.equal(result.dictForm, '食べる');
  assert.equal(result.span.text, '食べませんでした');
  assert.deepEqual(result.inflection, ['polite', 'negative', 'past']);
});

test('want to and negative labels for a verb chain', async () => {
  const tokens = await tokenize('見たくない');
  const result = lookupAt(tokens, 0, dict);
  assert.equal(result.dictForm, '見る');
  assert.equal(result.span.text, '見たくない');
  assert.deepEqual(result.inflection, ['want to', 'negative']);
});

test('past tense adjective resolves to its dictionary form', async () => {
  const tokens = await tokenize('高かった');
  const result = lookupAt(tokens, 0, dict);
  assert.equal(result.dictForm, '高い');
  assert.equal(result.span.text, '高かった');
  assert.deepEqual(result.inflection, ['past']);
});

test('span stops before the following particle', async () => {
  const tokens = await tokenize(TEXT);
  const result = lookupAt(tokens, indexOf(tokens, '日本語'), dict);
  assert.equal(result.span.text, '日本語');
  assert.equal(result.span.startToken, result.span.endToken);
  assert.equal(TEXT.slice(result.span.start, result.span.end), '日本語');
  assert.deepEqual(result.inflection, []);
});

test('span offsets slice back to the matched text', async () => {
  const tokens = await tokenize(TEXT);
  const result = lookupAt(tokens, indexOf(tokens, '勉強'), dict);
  assert.equal(TEXT.slice(result.span.start, result.span.end), '勉強しています');
});

test('groups cover every word token exactly once', async () => {
  const tokens = await tokenize(TEXT);
  const groups = groupTokens(tokens);
  const covered = groups.flatMap((g) => g.tokens.map((t) => t.surface));
  assert.deepEqual(covered, tokens.filter((t) => t.isWord).map((t) => t.surface));
  assert.equal(groups.find((g) => g.tokens[0].surface === '勉強').end, indexOf(tokens, 'ます'));
});

test('groupTokens is cached by tokens array identity', async () => {
  const tokens = await tokenize(TEXT);
  assert.equal(groupTokens(tokens), groupTokens(tokens));
});

test('particle resolves to the particle entry, not a homophone noun', async () => {
  const tokens = await tokenize(TEXT);
  const result = lookupAt(tokens, indexOf(tokens, 'は'), dict);
  assert.equal(result.span.text, 'は');
  assert.deepEqual(result.entries[0].senses[0].pos, ['prt']);
});

test('non-word token returns null', async () => {
  const tokens = await tokenize(TEXT);
  assert.equal(lookupAt(tokens, indexOf(tokens, '。'), dict), null);
});

test('unknown word returns null', async () => {
  const tokens = await tokenize('存在しない');
  assert.equal(lookupAt(tokens, 0, dict), null);
});

test('out of range index returns null', async () => {
  const tokens = await tokenize(TEXT);
  assert.equal(lookupAt(tokens, tokens.length, dict), null);
});

test('conjugated surface resolves to the dictionary form, never a homophone', async () => {
  const tokens = await tokenize('雨が降っているので出かけません');
  for (const surface of ['降っ', 'いる']) {
    const result = lookupAt(tokens, indexOf(tokens, surface), dict);
    assert.equal(result.span.text, '降っている');
    assert.equal(result.dictForm, '降る');
    assert.deepEqual(result.inflection, ['te-form', 'continuing']);
  }
  assert.equal(lookupAt(tokens, indexOf(tokens, 'ので'), dict).span.text, 'ので');
  const polite = lookupAt(tokens, indexOf(tokens, '出かけ'), dict);
  assert.equal(polite.span.text, '出かけません');
  assert.deepEqual(polite.inflection, ['polite', 'negative']);
});

test('causative passive want to chain resolves from every token', async () => {
  const tokens = await tokenize('もっと食べさせられたくなかった');
  const fromStem = lookupAt(tokens, indexOf(tokens, '食べ'), dict);
  assert.equal(fromStem.span.text, '食べさせられたくなかった');
  assert.equal(fromStem.dictForm, '食べる');
  for (const surface of ['させ', 'られ', 'たく', 'なかっ', 'た']) {
    assert.deepEqual(lookupAt(tokens, indexOf(tokens, surface), dict), fromStem, surface);
  }
  for (const label of ['causative', 'passive/potential', 'want to', 'negative', 'past']) {
    assert.ok(fromStem.inflection.includes(label), label);
  }
});

test('obligation chain resolves from the verb and keeps the noun separate', async () => {
  const tokens = await tokenize('宿題をしなければなりません');
  assert.equal(lookupAt(tokens, indexOf(tokens, '宿題'), dict).span.text, '宿題');
  const result = lookupAt(tokens, indexOf(tokens, 'し'), dict);
  assert.equal(result.span.text, 'しなければなりません');
  assert.equal(result.dictForm, 'する');
  assert.deepEqual(result.inflection, ['must (obligation)', 'polite']);
});

test('ni particle is not the homophone noun and a masu chain follows the verb', async () => {
  const tokens = await tokenize('昨日、友達と映画を見に行きました。');
  const particle = lookupAt(tokens, indexOf(tokens, 'に'), dict);
  assert.deepEqual(particle.entries[0].senses[0].pos, ['prt']);
  const result = lookupAt(tokens, indexOf(tokens, '行き'), dict);
  assert.equal(result.span.text, '行きました');
  assert.equal(result.dictForm, '行く');
  assert.deepEqual(result.inflection, ['polite', 'past']);
});

test('adjective chain in order and the attributive この and 本', async () => {
  const tokens = await tokenize('この本は面白くなかったです');
  const demonstrative = lookupAt(tokens, indexOf(tokens, 'この'), dict);
  assert.deepEqual(demonstrative.entries[0].senses[0].pos, ['adj-pn']);
  const book = lookupAt(tokens, indexOf(tokens, '本'), dict);
  assert.equal(book.entries[0].kanji[0], '本');
  assert.equal(book.entries[0].senses[0].glosses[0], 'book');
  const adj = lookupAt(tokens, indexOf(tokens, '面白く'), dict);
  assert.equal(adj.span.text, '面白くなかったです');
  assert.equal(adj.dictForm, '面白い');
  assert.deepEqual(adj.inflection, ['negative', 'past', 'polite']);
});
