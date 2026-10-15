const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVocabHandlers } = require('../src/main/vocabHandlers');
const { KnownWords } = require('../src/core/known');
const { Corpus } = require('../src/core/corpus');
const { extractVocabulary, toWordList } = require('../src/core/vocabText');

const dirs = [];

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const tokenize = async (text) =>
  [...text].map((surface) => ({ surface, base: surface, isWord: true, pos: '名詞', reading: null }));

const notReady = { isReady: () => false, load: async () => {}, download: async () => {} };

function setup() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-harden-'));
  dirs.push(dataDir);
  const known = new KnownWords(dataDir).load();
  const corpus = new Corpus(dataDir).load();
  const { handlers } = createVocabHandlers({
    dataDir,
    library: { scan: async () => [] },
    dictionary: notReady,
    pitchAccent: notReady,
    knownWords: () => known,
    episodeCues: async () => null,
    tokenize,
    corpus,
    deps: { Kanjidic: function Kanjidic() { return notReady; }, Examples: function Examples() { return notReady; } },
  });
  return { known, corpus, call: (channel, ...args) => handlers[channel](...args) };
}

test('suspended words are unknown in extract but never offered as the word list', async () => {
  const ctx = setup();
  ctx.known.mark('鳥', 'suspended');
  ctx.known.mark('魚', 'never-forget');
  ctx.known.mark('犬', 'blacklisted');
  const result = await ctx.call('vocab:extract', { text: '鳥魚犬猫' });
  assert.deepEqual(result.rows.map((row) => [row.word, row.status]), [['鳥', 'suspended'], ['魚', 'known'], ['猫', 'new']]);
  const unknownOnly = await ctx.call('vocab:extract', { text: '鳥魚犬猫', onlyUnknown: true });
  assert.equal(unknownOnly.wordList, '猫');
});

test('suspended words count as unknown in coverage but are excluded from topNew', async () => {
  const ctx = setup();
  await ctx.corpus.addWork({ id: 'anime:S', kind: 'anime', title: 'S' }, ['鳥猫', '鳥魚犬'], tokenize);
  ctx.known.mark('鳥', 'suspended');
  ctx.known.mark('魚', 'never-forget');
  ctx.known.mark('犬', 'blacklisted');
  const coverage = await ctx.call('corpus:coverage', 'anime:S');
  assert.equal(coverage.totalWords, 4);
  assert.equal(coverage.knownPct, 25);
  assert.equal(coverage.unknownUnique, 2);
  assert.deepEqual(coverage.topNew, [{ word: '猫', count: 1 }]);
});

test('vocabText keeps suspended rows out of the unknown word list', async () => {
  const tokens = ['鳥', '猫'].map((surface) => ({ surface, base: surface, reading: null, isWord: true }));
  const statuses = { 鳥: 'suspended', 猫: 'new' };
  const rows = await extractVocabulary('鳥猫', async () => tokens, (word) => statuses[word]);
  assert.equal(toWordList(rows, { onlyUnknown: true }), '猫');
  assert.equal(toWordList(rows), '鳥\n猫');
});
