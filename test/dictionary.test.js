const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Dictionary, buildIndex, pickAsset } = require('../src/core/dictionary');

const FIXTURE = path.join(__dirname, 'fixtures', 'jmdict-mini.json');
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-dict-'));
  tempDirs.push(dir);
  return dir;
}

async function loadedDictionary(json = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))) {
  const dataDir = tempDataDir();
  fs.writeFileSync(path.join(dataDir, 'jmdict.json'), JSON.stringify(json));
  const dict = new Dictionary(dataDir);
  await dict.load();
  return dict;
}

function wordsWithKana(kana, count) {
  return Array.from({ length: count }, (_, i) => ({
    id: String(i),
    kanji: [{ common: false, text: `語${i}`, tags: [] }],
    kana: [{ common: false, text: kana, tags: [] }],
    sense: [{ partOfSpeech: ['noun'], gloss: [{ lang: 'eng', text: `word ${i}` }] }],
  }));
}

test('isReady reflects whether jmdict.json exists', () => {
  const dataDir = tempDataDir();
  const dict = new Dictionary(dataDir);
  assert.equal(dict.isReady(), false);
  fs.copyFileSync(FIXTURE, path.join(dataDir, 'jmdict.json'));
  assert.equal(dict.isReady(), true);
});

test('lookup throws before load', () => {
  assert.throws(() => new Dictionary(tempDataDir()).lookup('食べる'), /not loaded/);
});

test('lookup by token base form', async () => {
  const dict = await loadedDictionary();
  const [first] = dict.lookup({ surface: '食べて', base: '食べる', reading: 'たべて' });
  assert.equal(first.id, '1358280');
  assert.deepEqual(first.kanji, ['食べる']);
});

test('lookup by kana reading', async () => {
  const dict = await loadedDictionary();
  const hits = dict.lookup('がっこう');
  assert.deepEqual(hits.map((e) => e.kanji[0]), ['学校']);
});

test('lookup by kanji string returns senses', async () => {
  const dict = await loadedDictionary();
  const [entry] = dict.lookup('勉強');
  assert.deepEqual(entry, {
    id: '1398020',
    kanji: ['勉強'],
    kana: ['べんきょう'],
    common: true,
    senses: [
      {
        pos: ['noun or participle which takes the aux. verb suru'],
        glosses: ['study', 'diligence'],
      },
    ],
  });
});

test('common entries sort before uncommon ones', async () => {
  const dict = await loadedDictionary();
  const hits = dict.lookup('いく');
  assert.deepEqual(hits.map((e) => [e.kanji[0], e.common]), [
    ['行く', true],
    ['逝く', false],
  ]);
});

test('falls back to surface then reading when base has no match', async () => {
  const dict = await loadedDictionary();
  assert.equal(dict.lookup({ surface: '学校', base: '学校の', reading: 'がっこう' })[0].id, '1557930');
  assert.equal(dict.lookup({ surface: 'xx', base: 'xx', reading: 'べんきょう' })[0].id, '1398020');
});

test('unknown query returns empty list', async () => {
  const dict = await loadedDictionary();
  assert.deepEqual(dict.lookup('存在しない'), []);
});

test('lookup returns at most 8 entries', async () => {
  const dict = await loadedDictionary({ words: wordsWithKana('あいう', 10) });
  assert.equal(dict.lookup('あいう').length, 8);
});

test('buildIndex maps every kanji and kana form to its entry', () => {
  const index = buildIndex(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
  assert.equal(index.get('がっこう')[0].kanji[0], '学校');
  assert.equal(index.get('食べる')[0].id, '1358280');
  assert.equal(index.get('存在しない'), undefined);
});

test('pickAsset chooses the English non-common archive', () => {
  const release = {
    tag_name: '3.5.0',
    assets: [
      { name: 'jmdict-eng-common-3.5.0.json.zip', browser_download_url: 'https://example.test/common.zip' },
      { name: 'jmdict-spa-3.5.0.json.zip', browser_download_url: 'https://example.test/spa.zip' },
      { name: 'jmdict-eng-3.5.0.json.zip', browser_download_url: 'https://example.test/eng.zip' },
      { name: 'source.tar.gz', browser_download_url: 'https://example.test/source.tar.gz' },
    ],
  };
  const asset = pickAsset(release);
  assert.equal(asset.name, 'jmdict-eng-3.5.0.json.zip');
  assert.equal(asset.browser_download_url, 'https://example.test/eng.zip');
});

test('pickAsset accepts versions with a build suffix', () => {
  const release = {
    assets: [{ name: 'jmdict-eng-3.6.1+20250101.json.zip', browser_download_url: 'x' }],
  };
  assert.equal(pickAsset(release).name, 'jmdict-eng-3.6.1+20250101.json.zip');
});

test('pickAsset throws when only common archives exist', () => {
  const release = {
    assets: [{ name: 'jmdict-eng-common-3.5.0.json.zip', browser_download_url: 'x' }],
  };
  assert.throws(() => pickAsset(release), /No JMdict English asset/);
});
