const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Corpus } = require('../src/core/corpus');

const PARTICLES = new Set(['は', 'が', 'を']);

// Tokens are space-separated surfaces; the fake tokenizer stands in for the real one.
async function tokenize(text) {
  return text
    .split(' ')
    .filter(Boolean)
    .map((surface) => ({
      surface,
      base: surface,
      reading: surface,
      pos: PARTICLES.has(surface) ? '助詞' : surface === '。' ? '記号' : '名詞',
      isWord: surface !== '。',
    }));
}

function tempCorpus() {
  return new Corpus(fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-corpus-'))).load();
}

test('addWork counts words without particles or symbols, plus kanji and characters', async () => {
  const corpus = tempCorpus();
  await corpus.addWork({ id: 'a1', kind: 'anime', title: 'A' }, ['猫 は 猫 を 食べる 。', 'ねこ が 走る'], tokenize);
  const stats = corpus.workStats('a1');
  assert.equal(stats.id, 'a1');
  assert.equal(stats.kind, 'anime');
  assert.equal(stats.title, 'A');
  assert.equal(stats.words, 5);
  assert.equal(stats.uniqueWords, 4);
  assert.equal(stats.uniqueOnce, 3);
  assert.equal(stats.uniqueOncePct, 75);
  assert.equal(stats.uniqueKanji, 3);
  assert.equal(stats.kanjiOnce, 2);
  assert.equal(stats.characters, [...'猫 は 猫 を 食べる 。'].length + [...'ねこ が 走る'].length);
  assert.equal(stats.avgSentenceLength, 10);
  assert.equal(corpus.workStats('missing'), null);
});

test('re-adding a work id replaces it and bumps the revision', async () => {
  const corpus = tempCorpus();
  await corpus.addWork({ id: 'a1', kind: 'anime', title: 'A' }, ['猫 猫'], tokenize);
  assert.equal(corpus.revision, 1);
  await corpus.addWork({ id: 'a1', kind: 'anime', title: 'A2' }, ['犬'], tokenize);
  assert.equal(corpus.revision, 2);
  assert.equal(corpus.works().length, 1);
  assert.equal(corpus.workStats('a1').title, 'A2');
  assert.equal(corpus.workStats('a1').words, 1);
});

test('corpus persists to corpus.json with its revision and reloads equal stats', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-corpus-'));
  const corpus = new Corpus(dir).load();
  await corpus.addWork({ id: 'm1', kind: 'manga', title: 'M' }, ['猫 が 犬'], tokenize);
  assert.ok(fs.existsSync(path.join(dir, 'corpus.json')));
  assert.equal(fs.readdirSync(dir).some((f) => f.endsWith('.tmp')), false);
  const reloaded = new Corpus(dir).load();
  assert.equal(reloaded.revision, 1);
  assert.deepEqual(reloaded.workStats('m1'), corpus.workStats('m1'));
  assert.deepEqual(new Corpus(fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-corpus-'))).load().works(), []);
});

test('addWork rejects an unknown kind or non-string id', async () => {
  const corpus = tempCorpus();
  await assert.rejects(corpus.addWork({ id: 'x', kind: 'novel', title: '' }, ['猫'], tokenize));
  await assert.rejects(corpus.addWork({ id: 5, kind: 'anime', title: '' }, ['猫'], tokenize));
});

test('globalRank counts across works and frequencyBucket maps rank bands', async () => {
  const corpus = tempCorpus();
  const common = Array.from({ length: 10 }, () => 'いぬ').join(' ');
  await corpus.addWork({ id: 'a', kind: 'anime', title: '' }, [common, 'ねこ'], tokenize);
  await corpus.addWork({ id: 'b', kind: 'anime', title: '' }, ['ねこ ねこ'], tokenize);
  assert.equal(corpus.globalRank('いぬ'), 1);
  assert.equal(corpus.globalRank('ねこ'), 2);
  assert.equal(corpus.globalRank('とり'), null);
  assert.equal(corpus.frequencyBucket('いぬ'), 'Top 200');
  assert.equal(corpus.frequencyBucket('とり'), null);
});

test('frequencyBucket boundaries follow Top 200, Top 1000, Top 5000', async () => {
  const corpus = tempCorpus();
  const words = Array.from({ length: 5100 }, (_, i) => `w${String(i).padStart(4, '0')}`);
  await corpus.addWork({ id: 'big', kind: 'anime', title: '' }, [words.join(' ')], tokenize);
  assert.equal(corpus.frequencyBucket('w0199'), 'Top 200');
  assert.equal(corpus.frequencyBucket('w0200'), 'Top 1000');
  assert.equal(corpus.frequencyBucket('w0999'), 'Top 1000');
  assert.equal(corpus.frequencyBucket('w1000'), 'Top 5000');
  assert.equal(corpus.frequencyBucket('w5099'), null);
});

test('difficulty rises when vocabulary is rarer at the same length and kanji density', async () => {
  const corpus = tempCorpus();
  const common = Array.from({ length: 20 }, () => 'ねこ は いぬ 。').join(' ');
  await corpus.addWork({ id: 'common', kind: 'anime', title: '' }, [common], tokenize);
  await corpus.addWork({ id: 'rare', kind: 'anime', title: '' }, ['うなぎ は たこ 。', 'なまず は くらげ 。'], tokenize);
  const common_ = corpus.workStats('common');
  const rare = corpus.workStats('rare');
  assert.ok(rare.difficulty > common_.difficulty, `${rare.difficulty} > ${common_.difficulty}`);
  assert.ok(rare.peakDifficulty > common_.peakDifficulty);
  for (const stats of [common_, rare]) {
    assert.ok(stats.difficulty >= 0 && stats.difficulty <= 100);
    assert.ok(stats.peakDifficulty >= 0 && stats.peakDifficulty <= 100);
  }
});

test('difficulty rises with kanji density at the same vocabulary rank', async () => {
  const corpus = tempCorpus();
  await corpus.addWork({ id: 'kana', kind: 'anime', title: '' }, ['ねこ は いぬ', 'ねこ は いぬ'], tokenize);
  await corpus.addWork({ id: 'kanji', kind: 'anime', title: '' }, ['猫 は 犬', '猫 は 犬'], tokenize);
  assert.ok(corpus.workStats('kanji').difficulty > corpus.workStats('kana').difficulty);
});

test('difficultyList sorts ascending and filters by kind', async () => {
  const corpus = tempCorpus();
  await corpus.addWork({ id: 'hard', kind: 'manga', title: '' }, ['うなぎ たこ'], tokenize);
  await corpus.addWork({ id: 'easy', kind: 'anime', title: '' }, ['ねこ ねこ ねこ'], tokenize);
  await corpus.addWork({ id: 'mid', kind: 'anime', title: '' }, ['ねこ うなぎ'], tokenize);
  assert.deepEqual(
    corpus.difficultyList().map((s) => s.id),
    corpus.difficultyList().map((s) => s.id).slice().sort((a, b) => corpus.workStats(a).difficulty - corpus.workStats(b).difficulty),
  );
  assert.deepEqual(corpus.difficultyList('anime').map((s) => s.id), ['easy', 'mid']);
  assert.deepEqual(corpus.difficultyList('manga').map((s) => s.id), ['hard']);
});

test('coverage reports known share, unknown uniques and top new words without suspended ones', async () => {
  const corpus = tempCorpus();
  await corpus.addWork(
    { id: 'c', kind: 'anime', title: '' },
    ['ねこ いぬ いぬ うさぎ うさぎ うさぎ たこ たこ うなぎ を ねこ'],
    tokenize,
  );
  const statuses = { ねこ: 'known', いぬ: 'new', うさぎ: 'new', たこ: 'suspended', うなぎ: 'learning', 'を': 'skip' };
  const result = corpus.coverage('c', (word) => statuses[word] ?? 'new');
  assert.deepEqual(result, {
    totalWords: 10,
    knownPct: 30,
    unknownUnique: 3,
    topNew: [
      { word: 'うさぎ', count: 3 },
      { word: 'いぬ', count: 2 },
    ],
  });
  assert.equal(corpus.coverage('missing', () => 'new'), null);
});
