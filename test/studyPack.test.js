const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync } = require('fflate');
const { buildPack, downloadPack, loadPack, packStatus } = require('../src/core/studyPack');

const FIXTURES = path.join(__dirname, 'fixtures', 'study');
const RELEASE_URL = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-study-'));
  tempDirs.push(dir);
  return dir;
}

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function fixtureInputs() {
  return {
    kanjidic: readFixture('kanjidic.json'),
    kradfile: readFixture('kradfile.json'),
    examples: readFixture('examples.json'),
  };
}

function buildFixturePack(options = {}) {
  return buildPack(fixtureInputs(), { levels: 4, ...options });
}

function sense({ pos = ['n'], misc = [], gloss = 'thing', examples = 1 } = {}) {
  return {
    partOfSpeech: pos,
    misc,
    gloss: [{ lang: 'eng', text: gloss }],
    examples: Array.from({ length: examples }, (_, i) => ({
      text: 'example',
      sentences: [
        { lang: 'jpn', text: `例文${i}。` },
        { lang: 'eng', text: 'An example.' },
      ],
    })),
  };
}

function word(id, text, senses = [sense()]) {
  return {
    id: String(id),
    kanji: [{ common: true, text, tags: [] }],
    kana: [{ common: true, text: 'かな', tags: [], appliesToKanji: ['*'] }],
    sense: senses,
  };
}

function packWithWords(words, options = {}) {
  return buildPack({ ...fixtureInputs(), examples: { words } }, { levels: 4, ...options });
}

function zipOf(name, value) {
  return zipSync({ [name]: new TextEncoder().encode(JSON.stringify(value)) });
}

function fakeResponse({ json, bytes }) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => json,
    body: bytes ? (async function* () { yield bytes; })() : undefined,
  };
}

test('kanji are split into equal frequency-ordered levels, ungraded last, unfrequent excluded', () => {
  const pack = buildFixturePack();
  assert.equal(pack.levelList.length, 4);
  assert.deepEqual(
    pack.levelList.map((l) => l.kanji.map((id) => pack.kanji[id].char)),
    [['日', '月', '木', '女'], ['子', '休', '田', '明'], ['林', '男', '森', '好'], ['蛍']],
  );
  assert.equal(pack.kanji['k:猫'], undefined);
});

test('maxKanji limits the selection before chunking', () => {
  const pack = buildFixturePack({ maxKanji: 5 });
  assert.deepEqual(Object.keys(pack.kanji), ['k:日', 'k:月', 'k:木', 'k:女', 'k:子']);
  assert.deepEqual(pack.levelList[0].kanji, ['k:日', 'k:月']);
  assert.deepEqual(pack.levelList[2].kanji, ['k:子']);
});

test('radical level is the earliest level of any kanji using it', () => {
  const pack = buildFixturePack();
  assert.equal(pack.radicals['r:木'].level, 1);
  assert.equal(pack.radicals['r:子'].level, 2);
  assert.equal(pack.radicals['r:田'].level, 2);
  assert.equal(pack.radicals['r:力'].level, 3);
});

test('kanji hint joins component names and drops unnamed single-use stroke markers', () => {
  const pack = buildFixturePack();
  assert.deepEqual(pack.kanji['k:好'].components, ['k:女', 'k:子']);
  assert.equal(pack.kanji['k:好'].hint, 'woman + child');
  assert.equal(pack.kanji['k:休'].hint, 'person + tree');
  assert.deepEqual(pack.kanji['k:男'].components, ['k:田', 'r:力']);
  assert.equal(pack.kanji['k:男'].hint, 'rice field + power');
  assert.equal(pack.radicals['r:◇'], undefined);
});

test('rejects vocab that is non-common, has unknown kanji, no example, all-uk, no English pair, or no kanji', () => {
  const pack = buildFixturePack();
  for (const id of ['v:1002', 'v:1004', 'v:1005', 'v:1006', 'v:1011', 'v:1012', 'v:1013', 'v:1014']) {
    assert.equal(pack.vocab[id], undefined, id);
  }
});

test('keeps vocab with at least one non-uk sense', () => {
  const pack = buildFixturePack();
  assert.equal(pack.vocab['v:1015'].word, '木');
  assert.deepEqual(
    Object.keys(pack.vocab).sort(),
    ['v:1001', 'v:1003', 'v:1007', 'v:1008', 'v:1009', 'v:1010', 'v:1015'],
  );
});

test('vocab level is the highest level among its kanji', () => {
  const pack = buildFixturePack();
  assert.equal(pack.vocab['v:1003'].level, 2);
  assert.equal(pack.vocab['v:1010'].level, 3);
  assert.equal(pack.vocab['v:1015'].level, 1);
  assert.deepEqual(pack.vocab['v:1003'].kanji, ['k:明', 'k:日']);
});

test('vocab keeps applicable kana and the two shortest example sentences', () => {
  const pack = buildFixturePack();
  assert.deepEqual(pack.vocab['v:1003'].kana, ['あした', 'みょうにち']);
  assert.deepEqual(
    pack.vocab['v:1009'].sentences.map((s) => s.ja),
    ['森林を歩く。', '森林は大切だ。'],
  );
});

test('per-level vocab cap keeps the highest-ranked words first', () => {
  const pack = buildFixturePack({ maxVocabPerLevel: 2 });
  assert.deepEqual(pack.levelList[1].vocab, ['v:1003', 'v:1008']);
  assert.deepEqual(pack.levelList[2].vocab, ['v:1009', 'v:1010']);
  assert.equal(pack.vocab['v:1007'], undefined);
  assert.equal(pack.vocab['v:1001'], undefined);
});

test('vocab filter rejects digits, katakana, latin or punctuation, counter-only senses and day-of-month glosses', () => {
  const pack = packWithWords([
    word(1, '１４日', [sense({ gloss: 'fourteen days' })]),
    word(2, '9日', [sense({ gloss: 'nine days' })]),
    word(3, '日ボ', [sense({ gloss: 'day boy' })]),
    word(4, '日(Sunday)', [sense({ gloss: 'Sunday' })]),
    word(5, '女', [sense({ pos: ['ctr'], gloss: 'counter for people' })]),
    word(6, '男', [sense({ pos: ['num'] }), sense({ pos: ['ctr', 'num'] })]),
    word(7, '田', [sense({ pos: ['ctr'], gloss: 'counter for fields' }), sense({ gloss: 'rice field' })]),
    word(8, '日', [sense({ gloss: 'day of the month' })]),
    word(9, '木', [sense({ gloss: '5 trees' })]),
    word(10, '林', [sense({ gloss: 'grove' })]),
  ]);
  assert.deepEqual(Object.keys(pack.vocab).sort(), ['v:10', 'v:7']);
});

test('vocab ranks by example count, then kanji frequency rank sum, then id', () => {
  const pack = packWithWords([
    word(5, '木女', [sense()]),
    word(30, '月日', [sense()]),
    word(40, '日月', [sense()]),
    word(50, '林森', [sense({ examples: 2 })]),
  ], { levels: 1 });
  assert.deepEqual(pack.levelList[0].vocab, ['v:50', 'v:30', 'v:40', 'v:5']);
});

test('duplicate word text keeps the entry with more examples', () => {
  const pack = packWithWords([
    word(10, '森林', [sense()]),
    word(20, '森林', [sense({ examples: 2 })]),
  ]);
  assert.deepEqual(Object.keys(pack.vocab), ['v:20']);
});

test('one-character vocab is capped at eight per level', () => {
  const chars = ['日', '月', '木', '女', '子', '休', '田', '明', '林', '男', '森', '好', '蛍'];
  const pack = packWithWords(chars.map((ch, i) => word(100 + i, ch)), { levels: 1 });
  assert.deepEqual(pack.levelList[0].vocab, [
    'v:100', 'v:101', 'v:102', 'v:103', 'v:104', 'v:107', 'v:112', 'v:108',
  ]);
});

test('kanji components use k: only for strictly earlier kanji and keep radicals otherwise', () => {
  const inputs = fixtureInputs();
  inputs.kradfile.kanji['日'] = ['田', '木', '月'];
  inputs.kradfile.kanji['月'] = ['日'];
  const pack = buildPack(inputs, { levels: 4 });
  assert.deepEqual(pack.kanji['k:日'].components, ['r:田', 'r:木', 'r:月']);
  assert.equal(pack.kanji['k:日'].hint, 'rice field + tree + moon');
  assert.deepEqual(pack.kanji['k:月'].components, ['k:日']);
  assert.equal(pack.kanji['k:月'].hint, 'day');
  assert.equal(pack.radicals['r:田'].level, 1);
});

test('kanji list the kept vocab that contains them', () => {
  const pack = buildFixturePack();
  assert.ok(pack.kanji['k:日'].vocab.includes('v:1003'));
  assert.ok(pack.kanji['k:日'].vocab.includes('v:1007'));
  assert.deepEqual(pack.kanji['k:好'].vocab, ['v:1001']);
});

test('every referenced id exists and levelList covers every level', () => {
  const pack = buildFixturePack();
  for (const kanji of Object.values(pack.kanji)) {
    for (const id of kanji.components) assert.ok(id.startsWith('k:') ? pack.kanji[id] : pack.radicals[id], id);
    for (const id of kanji.vocab) assert.ok(pack.vocab[id], id);
  }
  for (const vocab of Object.values(pack.vocab)) {
    for (const id of vocab.kanji) assert.ok(pack.kanji[id], id);
  }
  assert.deepEqual(
    pack.levelList.map((l) => l.level),
    [1, 2, 3, 4],
  );
  for (const level of pack.levelList) {
    for (const id of level.radicals) assert.ok(pack.radicals[id], id);
    for (const id of level.kanji) assert.ok(pack.kanji[id], id);
    for (const id of level.vocab) assert.ok(pack.vocab[id], id);
  }
});

test('loadPack and packStatus read the stored pack', () => {
  const dataDir = tempDataDir();
  assert.equal(loadPack(dataDir), null);
  assert.deepEqual(packStatus(dataDir), {
    ready: false,
    builtAt: null,
    counts: { radicals: 0, kanji: 0, vocab: 0 },
  });

  const pack = { ...buildFixturePack(), builtAt: 1234 };
  fs.writeFileSync(path.join(dataDir, 'study-pack.json'), JSON.stringify(pack));
  assert.deepEqual(loadPack(dataDir), pack);
  assert.deepEqual(packStatus(dataDir), {
    ready: true,
    builtAt: 1234,
    counts: { radicals: 10, kanji: 13, vocab: 7 },
  });
});

test('packStatus parses the pack once until the file changes', () => {
  const dataDir = tempDataDir();
  const file = path.join(dataDir, 'study-pack.json');
  fs.writeFileSync(file, JSON.stringify({ ...buildFixturePack(), builtAt: 1 }));
  const readFileSync = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (target, ...args) {
    if (target === file) reads++;
    return readFileSync.call(this, target, ...args);
  };
  try {
    assert.equal(packStatus(dataDir).builtAt, 1);
    assert.equal(packStatus(dataDir).builtAt, 1);
    assert.equal(reads, 1);
    fs.writeFileSync(file, JSON.stringify({ ...buildFixturePack(), builtAt: 22 }));
    assert.equal(packStatus(dataDir).builtAt, 22);
    assert.equal(reads, 2);
  } finally {
    fs.readFileSync = readFileSync;
  }
});

test('downloadPack fetches the three study archives and writes the pack', async () => {
  const dataDir = tempDataDir();
  const base = 'https://downloads.test/';
  const archives = {
    'kanjidic2-en-3.6.2.json.zip': zipOf('kanjidic2-en-3.6.2.json', readFixture('kanjidic.json')),
    'kradfile-3.6.2.json.zip': zipOf('kradfile-3.6.2.json', readFixture('kradfile.json')),
    'jmdict-examples-eng-3.6.2.json.zip': zipOf('jmdict-examples-eng-3.6.2.json', readFixture('examples.json')),
  };
  const release = {
    assets: [
      { name: 'jmdict-examples-eng-common-3.6.2.json.zip', browser_download_url: `${base}jmdict-examples-eng-common-3.6.2.json.zip` },
      { name: 'kradfile-u-3.6.2.json.zip', browser_download_url: `${base}kradfile-u-3.6.2.json.zip` },
      ...Object.keys(archives).map((name) => ({ name, browser_download_url: `${base}${name}` })),
    ],
  };

  const requested = [];
  const fetchImpl = async (url, options) => {
    requested.push(url);
    if (url === RELEASE_URL) return fakeResponse({ json: release });
    const name = url.slice(base.length);
    if (!archives[name]) throw new Error(`unexpected fetch ${url}`);
    assert.equal(options.headers['User-Agent'], 'anime-mine');
    return fakeResponse({ bytes: archives[name] });
  };

  const progress = [];
  await downloadPack({ dataDir, fetchImpl, onProgress: (p) => progress.push(p), now: 5000 });

  assert.deepEqual(requested, [RELEASE_URL, ...Object.keys(archives).map((name) => base + name)]);
  assert.equal(loadPack(dataDir).builtAt, 5000);
  assert.deepEqual(packStatus(dataDir).counts, { radicals: 10, kanji: 13, vocab: 7 });
  assert.equal(fs.existsSync(path.join(dataDir, 'study-pack.json.tmp')), false);
  assert.equal(progress.at(-1), 1);
  assert.ok(progress.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= progress[i - 1])));
});

test('downloadPack rejects when the release lacks a study archive', async () => {
  const fetchImpl = async () => fakeResponse({ json: { assets: [] } });
  await assert.rejects(downloadPack({ dataDir: tempDataDir(), fetchImpl }), /No study data asset/);
});
