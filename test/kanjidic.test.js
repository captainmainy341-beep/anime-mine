const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync } = require('fflate');
const { Kanjidic } = require('../src/core/kanjidic');

const FIXTURE = path.join(__dirname, 'fixtures', 'kanjidic-mini.json');
const RELEASE = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-kanjidic-'));
  tempDirs.push(dir);
  return dir;
}

async function loadedKanjidic() {
  const dataDir = tempDataDir();
  fs.copyFileSync(FIXTURE, path.join(dataDir, 'kanjidic.json'));
  const kanjidic = new Kanjidic(dataDir);
  await kanjidic.load();
  return kanjidic;
}

function releaseFetch(bytes, { status = 200 } = {}) {
  const release = {
    assets: [
      { name: 'kanjidic2-all-3.6.2.json.zip', browser_download_url: 'https://example.test/all.zip' },
      { name: 'kanjidic2-en-3.6.2.json.zip', browser_download_url: 'https://example.test/en.zip' },
      { name: 'jmdict-eng-3.6.2.json.zip', browser_download_url: 'https://example.test/jmdict.zip' },
    ],
  };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === RELEASE) return Response.json(release);
    if (url === 'https://example.test/en.zip') {
      return new Response(bytes, { status, headers: { 'content-length': String(bytes.length) } });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, calls };
}

test('get returns the full entry with keyword, readings, counts, heisig and radical', async () => {
  const kanjidic = await loadedKanjidic();
  assert.deepEqual(kanjidic.get('日'), {
    char: '日',
    keyword: 'day',
    meanings: ['day', 'sun', 'Japan'],
    on: ['ニチ', 'ジツ'],
    kun: ['ひ', '-び'],
    strokes: 4,
    grade: 1,
    jlpt: 4,
    newspaperRank: 1,
    heisig: 12,
    radical: { number: 72, name: null },
    kanken: null,
  });
});

test('heisig prefers heisig6, falls back to heisig and is null without either', async () => {
  const kanjidic = await loadedKanjidic();
  assert.equal(kanjidic.get('食').heisig, 1582);
  assert.equal(kanjidic.get('海').heisig, 1046);
  assert.equal(kanjidic.get('亜').heisig, null);
});

test('radical names come from radical kanji and are null when unnamed', async () => {
  const kanjidic = await loadedKanjidic();
  assert.deepEqual(kanjidic.get('海').radical, { number: 85, name: 'みず' });
  assert.deepEqual(kanjidic.get('亜').radical, { number: 7, name: null });
});

test('missing optional fields become null or empty', async () => {
  const kanjidic = await loadedKanjidic();
  const radical = kanjidic.get('氵');
  assert.equal(radical.keyword, null);
  assert.equal(radical.grade, null);
  assert.equal(radical.jlpt, null);
  assert.equal(radical.newspaperRank, null);
  assert.deepEqual(radical.on, []);
  assert.deepEqual(radical.meanings, []);
});

test('get returns null for unknown characters and throws before load', async () => {
  const kanjidic = await loadedKanjidic();
  assert.equal(kanjidic.get('猫'), null);
  assert.throws(() => new Kanjidic(tempDataDir()).get('日'), /not loaded/);
});

test('kanjiIn returns unique kanji in order and ignores kana and latin', () => {
  const kanjidic = new Kanjidic(tempDataDir());
  assert.deepEqual(kanjidic.kanjiIn('ねこ日本語日、食べる！ abc 海'), ['日', '本', '語', '食', '海']);
  assert.deepEqual(kanjidic.kanjiIn('かな'), []);
});

test('isReady reflects whether kanjidic.json exists', () => {
  const dataDir = tempDataDir();
  const kanjidic = new Kanjidic(dataDir);
  assert.equal(kanjidic.isReady(), false);
  fs.copyFileSync(FIXTURE, path.join(dataDir, 'kanjidic.json'));
  assert.equal(kanjidic.isReady(), true);
});

test('download fetches the English asset, unzips it and replaces kanjidic.json', async () => {
  const dataDir = tempDataDir();
  const json = fs.readFileSync(FIXTURE);
  const { fetchImpl, calls } = releaseFetch(zipSync({ 'kanjidic2-en-3.6.2.json': json }));
  const progress = [];
  const kanjidic = new Kanjidic(dataDir, { fetchImpl });
  await kanjidic.download((fraction) => progress.push(fraction));
  assert.deepEqual(calls, [RELEASE, 'https://example.test/en.zip']);
  assert.equal(progress.at(-1), 1);
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'kanjidic.json')), json);
  assert.equal(fs.existsSync(path.join(dataDir, 'kanjidic.json.tmp')), false);
  assert.equal(kanjidic.isReady(), true);
  await kanjidic.load();
  assert.equal(kanjidic.get('日').keyword, 'day');
});

test('download rejects on HTTP error and writes nothing', async () => {
  const dataDir = tempDataDir();
  const { fetchImpl } = releaseFetch(Buffer.from('nope'), { status: 404 });
  await assert.rejects(new Kanjidic(dataDir, { fetchImpl }).download(), /HTTP 404/);
  assert.equal(fs.existsSync(path.join(dataDir, 'kanjidic.json')), false);
});
