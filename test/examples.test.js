const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync } = require('fflate');
const { Examples } = require('../src/core/examples');

const FIXTURE = path.join(__dirname, 'fixtures', 'examples-mini.json');
const RELEASE = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-examples-'));
  tempDirs.push(dir);
  return dir;
}

async function loadedExamples(json = fs.readFileSync(FIXTURE)) {
  const dataDir = tempDataDir();
  fs.writeFileSync(path.join(dataDir, 'examples.json'), json);
  const examples = new Examples(dataDir);
  await examples.load();
  return examples;
}

function manyExamplesWord(count) {
  return {
    words: [
      {
        id: '42',
        kanji: [],
        kana: [],
        sense: [
          {
            examples: Array.from({ length: count }, (_, i) => ({
              source: { type: 'tatoeba', value: String(i) },
              text: 'x',
              sentences: [
                { lang: 'jpn', text: `例文${i}` },
                { lang: 'eng', text: `example ${i}` },
              ],
            })),
          },
        ],
      },
    ],
  };
}

test('forWord returns Japanese and English pairs with tatoeba ids in source order', async () => {
  const examples = await loadedExamples();
  assert.deepEqual(examples.forWord('1358280', 2), [
    { ja: '私は毎日りんごを食べる。', en: 'I eat an apple every day.', tatoebaId: '1001' },
    { ja: '昼ご飯を食べた。', en: 'I ate lunch.', tatoebaId: '1003' },
  ]);
});

test('forWord skips examples without an English sentence and returns [] for unknown or empty words', async () => {
  const examples = await loadedExamples();
  assert.equal(examples.forWord('1358280').length, 2);
  assert.deepEqual(examples.forWord('9999'), []);
  assert.deepEqual(examples.forWord('0'), []);
});

test('forWord caps each word at 50 examples by default', async () => {
  const examples = await loadedExamples(JSON.stringify(manyExamplesWord(60)));
  assert.equal(examples.forWord('42').length, 50);
  assert.equal(examples.forWord('42', 3).length, 3);
});

test('forKanji returns sentences containing the character, shortest first', async () => {
  const examples = await loadedExamples();
  assert.deepEqual(
    examples.forKanji('食', 5).map((s) => s.tatoebaId),
    ['1003', '1001'],
  );
  assert.deepEqual(examples.forKanji('猫'), []);
});

test('forKanji honours its limit', async () => {
  const examples = await loadedExamples();
  assert.deepEqual(examples.forKanji('食', 1).map((s) => s.tatoebaId), ['1003']);
});

test('lookups throw before load', () => {
  const examples = new Examples(tempDataDir());
  assert.throws(() => examples.forWord('1'), /not loaded/);
  assert.throws(() => examples.forKanji('食'), /not loaded/);
});

test('isReady reflects whether examples.json exists', () => {
  const dataDir = tempDataDir();
  const examples = new Examples(dataDir);
  assert.equal(examples.isReady(), false);
  fs.copyFileSync(FIXTURE, path.join(dataDir, 'examples.json'));
  assert.equal(examples.isReady(), true);
});

test('download fetches the examples asset, unzips it and replaces examples.json', async (t) => {
  const dataDir = tempDataDir();
  const json = fs.readFileSync(FIXTURE);
  const zip = zipSync({ 'jmdict-examples-eng-3.6.2.json': json });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    if (url === RELEASE) {
      return Response.json({
        assets: [
          { name: 'jmdict-eng-3.6.2.json.zip', browser_download_url: 'https://example.test/eng.zip' },
          { name: 'jmdict-examples-eng-3.6.2.json.zip', browser_download_url: 'https://example.test/examples.zip' },
        ],
      });
    }
    return new Response(zip);
  });
  const examples = new Examples(dataDir);
  await examples.download();
  assert.deepEqual(calls, [RELEASE, 'https://example.test/examples.zip']);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'examples.json')), json);
  assert.equal(fs.existsSync(path.join(dataDir, 'examples.json.tmp')), false);
  await examples.load();
  assert.equal(examples.forWord('1398020')[0].en, 'I study every day.');
});

test('download rejects on HTTP error and writes nothing', async () => {
  const dataDir = tempDataDir();
  const fetchImpl = async (url) =>
    url === RELEASE
      ? Response.json({ assets: [{ name: 'jmdict-examples-eng-3.6.2.json.zip', browser_download_url: 'https://example.test/x.zip' }] })
      : new Response('nope', { status: 500 });
  await assert.rejects(new Examples(dataDir, { fetchImpl }).download(), /HTTP 500/);
  assert.equal(fs.existsSync(path.join(dataDir, 'examples.json')), false);
});
