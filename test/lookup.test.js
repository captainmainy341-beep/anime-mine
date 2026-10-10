const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tokenize } = require('../src/core/tokenizer');
const { Dictionary } = require('../src/core/dictionary');
const { lookupAt } = require('../src/core/lookup');

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

test('chain of an inflected verb resolves to the dictionary form with labels', async () => {
  const tokens = await tokenize(TEXT);
  const result = lookupAt(tokens, indexOf(tokens, '勉強'), dict);
  assert.equal(result.dictForm, '勉強する');
  assert.equal(result.span.text, '勉強しています');
  assert.deepEqual(result.inflection, ['te-form', 'continuing', 'polite']);
  assert.equal(result.entries[0].kanji[0], '勉強する');
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

test('clicking inside an inflection chain resolves from the chain lead', async () => {
  const tokens = await tokenize(TEXT);
  const fromStem = lookupAt(tokens, indexOf(tokens, '勉強'), dict);
  assert.deepEqual(lookupAt(tokens, indexOf(tokens, 'い'), dict), fromStem);
  assert.deepEqual(lookupAt(tokens, indexOf(tokens, 'ます'), dict), fromStem);
});

test('clicking the lead verb resolves the compound from its noun stem', async () => {
  const tokens = await tokenize(TEXT);
  const fromStem = lookupAt(tokens, indexOf(tokens, '勉強'), dict);
  assert.deepEqual(lookupAt(tokens, indexOf(tokens, 'し'), dict), fromStem);
});

test('particle token returns null', async () => {
  const tokens = await tokenize(TEXT);
  assert.equal(lookupAt(tokens, indexOf(tokens, 'は'), dict), null);
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
