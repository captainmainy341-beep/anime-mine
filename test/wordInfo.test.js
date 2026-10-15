const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Dictionary } = require('../src/core/dictionary');
const { Kanjidic } = require('../src/core/kanjidic');
const { Corpus } = require('../src/core/corpus');
const { KnownWords } = require('../src/core/known');
const { wordDetail, kanjiDetail } = require('../src/core/wordInfo');

const KANJIDIC_FIXTURE = path.join(__dirname, 'fixtures', 'kanjidic-mini.json');
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-wordinfo-'));
  tempDirs.push(dir);
  return dir;
}

function word(id, kanji, kana, pos, gloss, common) {
  return {
    id,
    kanji: [{ common, text: kanji, tags: [] }],
    kana: [{ common, text: kana, tags: [], appliesToKanji: ['*'] }],
    sense: [{ partOfSpeech: pos, gloss: [{ lang: 'eng', text: gloss }] }],
  };
}

const JMDICT = {
  words: [
    word('1', '食べる', 'たべる', ['v1', 'vt'], 'to eat', true),
    word('2', '食べ物', 'たべもの', ['n'], 'food', true),
    word('3', '食堂', 'しょくどう', ['n'], 'cafeteria', false),
    word('4', '猫', 'ねこ', ['n'], 'cat', true),
    word('5', '食', 'しょく', ['n'], 'eating', true),
  ],
};

function tokenize(text) {
  return text.split(' ').map((surface) => ({ surface, base: surface, reading: surface, pos: '名詞', isWord: true }));
}

async function deps() {
  const dataDir = tempDir();
  fs.writeFileSync(path.join(dataDir, 'jmdict.json'), JSON.stringify(JMDICT));
  const dict = new Dictionary(dataDir);
  await dict.load();

  fs.copyFileSync(KANJIDIC_FIXTURE, path.join(dataDir, 'kanjidic.json'));
  const kanjidic = new Kanjidic(dataDir);
  await kanjidic.load();

  const corpus = new Corpus(tempDir()).load();
  await corpus.addWork({ id: 'w', kind: 'anime', title: 'T' }, ['食べる 猫 食べる', '食 食堂'], tokenize);

  const known = new KnownWords(tempDir()).load();
  known.mark('猫', 'known');

  const pitch = {
    calls: [],
    lookup(text, reading) {
      this.calls.push([text, reading]);
      return { reading: 'たべる', patterns: [0] };
    },
  };
  const examples = {
    forWord: (id, limit) => [{ ja: 'x', en: 'y', tatoebaId: id }].slice(0, limit),
    forKanji: (char) => [{ ja: char, en: 'z', tatoebaId: '9' }],
  };
  return { dictionary: dict, kanjidic, corpus, known, pitch, examples };
}

test('wordDetail gives forms with corpus usage, grouped senses, kanji keywords, pitch and frequency', async () => {
  const d = await deps();
  const detail = wordDetail(d, '食べる');
  assert.equal(detail.key, '食べる');
  assert.deepEqual(detail.entries, [
    {
      id: '1',
      forms: [{ text: '食べる', reading: 'たべる', usagePct: 100 }],
      senses: [{ pos: 'v1, vt', glosses: ['to eat'] }],
      common: true,
    },
  ]);
  assert.deepEqual(detail.kanji, [{ char: '食', keyword: 'eat' }]);
  assert.deepEqual(d.pitch.calls, [['食べる', 'たべる']]);
  assert.deepEqual(detail.pitch, { reading: 'たべる', patterns: [0] });
  assert.deepEqual(detail.frequency, { rank: 1, bucket: 'Top 200' });
  assert.equal(detail.usedInCount, 0);
  assert.deepEqual(detail.usedInWords, []);
  assert.deepEqual(detail.examples, [{ ja: 'x', en: 'y', tatoebaId: '1' }]);
  assert.equal(detail.status, 'new');
  assert.equal(wordDetail(d, '猫').status, 'known');
});

test('wordDetail lists other JMdict words containing the primary kanji form', async () => {
  const detail = wordDetail(await deps(), '食');
  assert.equal(detail.usedInCount, 3);
  assert.deepEqual(detail.usedInWords.map((w) => w.text).sort(), ['食べる', '食べ物', '食堂']);
  assert.deepEqual(detail.usedInWords.find((w) => w.text === '食べる'), { text: '食べる', reading: 'たべる', gloss: 'to eat' });
});

test('wordDetail degrades to empty results without its dependencies', () => {
  const detail = wordDetail({ dictionary: null, kanjidic: null, pitch: null, corpus: null, known: null, examples: null }, '猫');
  assert.deepEqual(detail, {
    key: '猫',
    entries: [],
    kanji: [],
    pitch: null,
    frequency: { rank: null, bucket: null },
    usedInWords: [],
    usedInCount: 0,
    examples: [],
    status: null,
  });
});

test('kanjiDetail combines KANJIDIC, corpus kanji frequency, vocabulary and status', async () => {
  const detail = kanjiDetail(await deps(), '食');
  assert.equal(detail.char, '食');
  assert.equal(detail.keyword, 'eat');
  assert.equal(detail.grade, 2);
  assert.deepEqual(detail.frequency, { rank: 1, bucket: 'Top 200' });
  assert.equal(detail.usedInCount, 4);
  assert.deepEqual(detail.usedInVocab[0], { text: '食べる', reading: 'たべる', gloss: 'to eat' });
  assert.deepEqual(detail.usedInKanji, []);
  assert.deepEqual(detail.examples, [{ ja: '食', en: 'z', tatoebaId: '9' }]);
  assert.equal(detail.status, 'new');
});

test('kanjiDetail falls back to common JMdict words without corpus data', async () => {
  const d = await deps();
  const detail = kanjiDetail({ dictionary: d.dictionary, kanjidic: d.kanjidic }, '食');
  assert.deepEqual(detail.usedInVocab.map((row) => row.text).sort(), ['食', '食べる', '食べ物']);
  assert.deepEqual(detail.frequency, { rank: null, bucket: null });
});

test('kanjiDetail keeps the shape for characters missing from KANJIDIC', async () => {
  const detail = kanjiDetail({ kanjidic: (await deps()).kanjidic }, '猫');
  assert.equal(detail.char, '猫');
  assert.equal(detail.keyword, null);
  assert.deepEqual(detail.radical, { number: null, name: null });
  assert.equal(detail.usedInCount, 0);
});
