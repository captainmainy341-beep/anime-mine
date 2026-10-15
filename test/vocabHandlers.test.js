const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVocabHandlers } = require('../src/main/vocabHandlers');
const { KnownWords } = require('../src/core/known');
const { Corpus } = require('../src/core/corpus');

const dirs = [];

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const tokenize = async (text) =>
  text
    .split(/[はが]/)
    .filter(Boolean)
    .map((surface) => ({ surface, base: surface, isWord: true, pos: '名詞', reading: null }));

const CAT = { id: '1', kanji: ['猫'], kana: ['ねこ'], senses: [{ pos: ['n'], glosses: ['cat'] }], common: true };

function fakeResource(name, extra = {}) {
  const resource = {
    name,
    ready: false,
    loads: 0,
    downloads: [],
    isReady() {
      return resource.ready;
    },
    async load() {
      resource.loads += 1;
      resource.index ??= new Map();
    },
    async download(onProgress) {
      resource.downloads.push(name);
      onProgress(0.5);
      resource.ready = true;
    },
    ...extra,
  };
  return resource;
}

function setup({ dictReady = true, kanjidicReady = true, examplesReady = true, pitchReady = true, shows = [], cues = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-handlers-'));
  dirs.push(dataDir);
  const known = new KnownWords(dataDir).load();
  known.mark('猫', 'learning');
  known.mark('犬', 'known');
  const notified = [];
  const episodeCalls = [];
  const dictionary = fakeResource('dict', {
    ready: dictReady,
    lookup: (word) => (word === '猫' ? [CAT] : []),
  });
  const pitchAccent = fakeResource('pitch', {
    ready: pitchReady,
    lookup: () => ({ reading: 'ねこ', patterns: [0] }),
  });
  const examples = fakeResource('examples', {
    ready: examplesReady,
    forWord: () => [{ ja: '猫です。', en: 'It is a cat.' }],
    forKanji: () => [],
  });
  const kanjidic = fakeResource('kanjidic', {
    ready: kanjidicReady,
    get: (char) => (char === '猫' ? { char, keyword: 'cat', meanings: ['cat'], on: ['ビョウ'], kun: [], strokes: 11, grade: 8, jlpt: 2, newspaperRank: null, heisig: null, radical: { number: 94, name: 'animal' }, kanken: null } : null),
  });
  const corpus = new Corpus(dataDir).load();
  const library = {
    async scan() {
      return shows;
    },
  };
  const { handlers, stop, kanjidic: kanjidicInstance, examples: examplesInstance } = createVocabHandlers({
    dataDir,
    library,
    dictionary,
    pitchAccent,
    knownWords: () => known,
    episodeCues: async (req) => {
      episodeCalls.push(req.videoPath);
      return cues[req.videoPath] ?? null;
    },
    tokenize,
    corpus,
    notify: (channel, payload) => notified.push({ channel, payload }),
    deps: { Kanjidic: function Kanjidic() { return kanjidic; }, Examples: function Examples() { return examples; } },
  });
  return {
    dataDir,
    known,
    corpus,
    notified,
    episodeCalls,
    dictionary,
    pitchAccent,
    examples,
    kanjidic,
    handlers,
    stop,
    kanjidicInstance,
    examplesInstance,
    call: (channel, ...args) => handlers[channel](...args),
  };
}

test('status reports which resources are ready', async () => {
  const ctx = setup({ dictReady: true, kanjidicReady: false, examplesReady: true, pitchReady: false });
  assert.deepEqual(await ctx.call('vocab:status'), { dict: true, kanjidic: false, examples: true, pitch: false });
  assert.equal(ctx.kanjidicInstance, ctx.kanjidic);
  assert.equal(ctx.examplesInstance, ctx.examples);
});

test('word loads ready resources, passes the real pitch accent, and attaches the known status', async () => {
  const ctx = setup();
  const detail = await ctx.call('vocab:word', '猫');
  assert.equal(detail.key, '猫');
  assert.equal(detail.status, 'learning');
  assert.equal(detail.entries[0].forms[0].text, '猫');
  assert.deepEqual(detail.pitch, { reading: 'ねこ', patterns: [0] });
  assert.deepEqual(detail.examples, [{ ja: '猫です。', en: 'It is a cat.' }]);
  assert.equal(ctx.dictionary.loads, 1);
  assert.equal(ctx.pitchAccent.loads, 1);
});

test('word degrades to empty sections when dictionary and examples are not downloaded', async () => {
  const ctx = setup({ dictReady: false, examplesReady: false, pitchReady: false, kanjidicReady: false });
  const detail = await ctx.call('vocab:word', '猫');
  assert.deepEqual(detail.entries, []);
  assert.deepEqual(detail.examples, []);
  assert.equal(detail.pitch, null);
  assert.equal(ctx.dictionary.loads, 0);
  assert.equal(detail.status, 'learning');
});

test('kanji returns KANJIDIC detail and rejects anything but one character', async () => {
  const ctx = setup();
  const detail = await ctx.call('vocab:kanji', '猫');
  assert.equal(detail.keyword, 'cat');
  assert.equal(detail.status, 'learning');
  assert.equal(detail.char, '猫');
  await assert.rejects(ctx.call('vocab:kanji', 'ab'), /single character/);
  await assert.rejects(ctx.call('vocab:kanji', ''), /single character/);
});

test('list returns newest first with status, query and paging', async () => {
  const ctx = setup();
  ctx.known.words = {
    一: { status: 'known', source: 'manual', added: 100 },
    二: { status: 'learning', source: 'anki', added: 300 },
    三猫: { status: 'learning', source: 'text', added: 200 },
    四: { status: 'suspended', source: 'manual', added: 400 },
  };
  const all = await ctx.call('vocab:list', {});
  assert.equal(all.total, 4);
  assert.deepEqual(all.rows.map((row) => row.word), ['四', '二', '三猫', '一']);
  assert.deepEqual(all.rows[0], { word: '四', status: 'suspended', source: 'manual', added: 400 });

  const learning = await ctx.call('vocab:list', { status: 'learning' });
  assert.deepEqual(learning.rows.map((row) => row.word), ['二', '三猫']);

  const query = await ctx.call('vocab:list', { query: '猫' });
  assert.deepEqual(query.rows.map((row) => row.word), ['三猫']);

  const page = await ctx.call('vocab:list', { limit: 2, offset: 1 });
  assert.equal(page.total, 4);
  assert.deepEqual(page.rows.map((row) => row.word), ['二', '三猫']);

  assert.throws(() => ctx.call('vocab:list', { status: 'bogus' }), /status must be one of/);
  assert.throws(() => ctx.call('vocab:list', { limit: 0 }), /limit must be an integer/);
  assert.throws(() => ctx.call('vocab:list', { limit: 5000 }), /limit must be an integer/);
  assert.throws(() => ctx.call('vocab:list', { offset: -1 }), /offset must be an integer/);
});

test('counts reports the known-word stats', async () => {
  const ctx = setup();
  const counts = await ctx.call('vocab:counts');
  assert.deepEqual(counts, { known: 1, learning: 1, 'never-forget': 0, suspended: 0, blacklisted: 0 });
});

test('extract returns rows and a word list, optionally only unknown words', async () => {
  const ctx = setup();
  const result = await ctx.call('vocab:extract', { text: '猫は鳥が犬' });
  assert.deepEqual(result.rows.map((row) => [row.word, row.status]), [['猫', 'learning'], ['鳥', 'new'], ['犬', 'known']]);
  assert.equal(result.wordList, '猫\n鳥\n犬');
  const unknown = await ctx.call('vocab:extract', { text: '猫は鳥が犬', onlyUnknown: true });
  assert.equal(unknown.wordList, '鳥');
  await assert.rejects(ctx.call('vocab:extract', { text: 'x'.repeat(200001) }), /at most 200000/);
});

test('corpus works, stats and coverage use the corpus and known words', async () => {
  const ctx = setup();
  await ctx.corpus.addWork({ id: 'anime:Show', kind: 'anime', title: 'Show' }, ['猫は犬', '猫は鳥'], tokenize);
  await ctx.corpus.addWork({ id: 'manga:v1', kind: 'manga', title: 'Manga v1' }, ['鳥'], tokenize);
  assert.deepEqual((await ctx.call('corpus:works')).map((w) => w.id).sort(), ['anime:Show', 'manga:v1']);
  assert.deepEqual((await ctx.call('corpus:works', { kind: 'manga' })).map((w) => w.id), ['manga:v1']);
  assert.throws(() => ctx.call('corpus:works', { kind: 'bogus' }), /kind must be one of/);

  const stats = await ctx.call('corpus:stats', 'anime:Show');
  assert.equal(stats.words, 4);
  assert.equal(await ctx.call('corpus:stats', 'missing'), null);

  const coverage = await ctx.call('corpus:coverage', 'anime:Show');
  assert.equal(coverage.totalWords, 4);
  assert.equal(coverage.knownPct, 75);
  assert.equal(coverage.unknownUnique, 1);
  assert.deepEqual(coverage.topNew, [{ word: '鳥', count: 1 }]);
});

test('removeWork deletes the work from disk and from memory', async () => {
  const ctx = setup();
  await ctx.corpus.addWork({ id: 'anime:Show', kind: 'anime', title: 'Show' }, ['猫は犬'], tokenize);
  assert.deepEqual(await ctx.call('corpus:removeWork', 'anime:Show'), { removed: true });
  assert.deepEqual(ctx.corpus.works(), []);
  assert.deepEqual(new Corpus(ctx.dataDir).load().works(), []);
  assert.deepEqual(await ctx.call('corpus:removeWork', 'anime:Show'), { removed: false });
});

test('indexAnime indexes subtitled episodes once, skips the rest, and honours force', async () => {
  const shows = [
    { title: 'Show A', episodes: [{ path: '/v/a1.mkv', subtitlePath: '/s/a1.srt' }, { path: '/v/a2.mkv', subtitlePath: null }] },
    { title: 'Show B', episodes: [{ path: '/v/b1.mkv', subtitlePath: null }] },
  ];
  const cues = { '/v/a1.mkv': { cues: [{ text: '猫は犬' }, { text: '鳥' }] } };
  const ctx = setup({ shows, cues });

  assert.deepEqual(await ctx.call('corpus:indexAnime', {}), { indexed: 1, skipped: 1 });
  assert.deepEqual(ctx.episodeCalls, ['/v/a1.mkv']);
  assert.deepEqual(ctx.corpus.works().map((w) => [w.id, w.kind, w.sentenceCount]), [['anime:Show A', 'anime', 2]]);
  assert.deepEqual(
    ctx.notified.map((n) => n.payload),
    [
      { done: 1, total: 2, title: 'Show A' },
      { done: 2, total: 2, title: 'Show B' },
    ],
  );
  assert.ok(ctx.notified.every((n) => n.channel === 'corpus:progress'));

  assert.deepEqual(await ctx.call('corpus:indexAnime'), { indexed: 0, skipped: 2 });
  assert.deepEqual(await ctx.call('corpus:indexAnime', { force: true }), { indexed: 1, skipped: 1 });
});

test('kanjidic and examples downloads report progress', async () => {
  const ctx = setup();
  assert.deepEqual(await ctx.call('kanjidic:download'), { ready: true });
  assert.deepEqual(await ctx.call('examples:download'), { ready: true });
  assert.deepEqual(ctx.notified.map((n) => [n.channel, n.payload]), [
    ['kanjidic:progress', 0.5],
    ['examples:progress', 0.5],
  ]);
});
