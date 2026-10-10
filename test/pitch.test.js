const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PitchAccent, ACCENTS_URL, moraSplit, pitchPattern, pitchLabel } = require('../src/core/pitch');

const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-pitch-'));
  tempDirs.push(dir);
  return dir;
}

const FIXTURE = [
  '# expression\treading\taccent',
  '学校\tがっこう\t[0]',
  '今日\tきょう\t[1]',
  '猫\tねこ\t[ 0 ]',
  '橋\tはし\t[1,2]',
  '生\tいき\t[0]',
  '生\tなま\t[1]',
  '見る\t\t[1]',
  '行く\t[0]',
  '# 犬\tいぬ\t0',
  'broken line without tabs',
  '\tはし\t[1]',
  '鳥\tとり\tabc',
  '犬\tいぬ\t',
  '魚\tさかな\t[1,x]',
  '',
].join('\r\n');

async function loadedAccents(text = FIXTURE) {
  const dataDir = tempDataDir();
  fs.writeFileSync(path.join(dataDir, 'accents.txt'), text);
  const accents = new PitchAccent(dataDir);
  await accents.load();
  return accents;
}

test('isReady reflects whether accents.txt exists', () => {
  const dataDir = tempDataDir();
  const accents = new PitchAccent(dataDir);
  assert.equal(accents.isReady(), false);
  fs.writeFileSync(path.join(dataDir, 'accents.txt'), FIXTURE);
  assert.equal(accents.isReady(), true);
});

test('lookup throws before load', () => {
  assert.throws(() => new PitchAccent(tempDataDir()).lookup('学校'), /not loaded/);
});

test('lookup returns patterns for a word', async () => {
  const accents = await loadedAccents();
  assert.deepEqual(accents.lookup('学校', 'がっこう'), { reading: 'がっこう', patterns: [0] });
});

test('lookup returns null for unknown or malformed-only words', async () => {
  const accents = await loadedAccents();
  assert.equal(accents.lookup('存在しない'), null);
  assert.equal(accents.lookup('鳥'), null);
  assert.equal(accents.lookup('魚'), null);
  assert.equal(accents.lookup('犬'), null);
  assert.equal(accents.lookup('broken line without tabs'), null);
});

test('lookup skips commented and empty-expression lines', async () => {
  const accents = await loadedAccents();
  assert.equal(accents.lookup('いぬ'), null);
  assert.deepEqual(accents.lookup('はし'), { reading: 'はし', patterns: [1, 2] });
});

test('lookup prefers the entry whose reading matches, converting katakana', async () => {
  const accents = await loadedAccents();
  assert.deepEqual(accents.lookup('生', 'なま'), { reading: 'なま', patterns: [1] });
  assert.deepEqual(accents.lookup('生', 'ナマ'), { reading: 'なま', patterns: [1] });
  assert.deepEqual(accents.lookup('生', 'いき'), { reading: 'いき', patterns: [0] });
});

test('lookup falls back to the first entry for the word when no reading matches', async () => {
  const accents = await loadedAccents();
  assert.deepEqual(accents.lookup('生', 'ほか'), { reading: 'いき', patterns: [0] });
  assert.deepEqual(accents.lookup('生'), { reading: 'いき', patterns: [0] });
});

test('lookup finds entries by their reading key', async () => {
  const accents = await loadedAccents();
  assert.deepEqual(accents.lookup('きょう', 'きょう'), { reading: 'きょう', patterns: [1] });
});

test('lookup accepts bracketed, spaced and multiple accents', async () => {
  const accents = await loadedAccents();
  assert.deepEqual(accents.lookup('猫'), { reading: 'ねこ', patterns: [0] });
  assert.deepEqual(accents.lookup('橋'), { reading: 'はし', patterns: [1, 2] });
});

test('lines without a reading column use the expression as reading', async () => {
  const accents = await loadedAccents();
  assert.deepEqual(accents.lookup('見る', '見る'), { reading: '見る', patterns: [1] });
  assert.deepEqual(accents.lookup('行く'), { reading: '行く', patterns: [0] });
});

test('lookup returns a copy of the patterns', async () => {
  const accents = await loadedAccents();
  accents.lookup('橋').patterns.push(9);
  assert.deepEqual(accents.lookup('橋').patterns, [1, 2]);
});

test('load is a no-op once loaded', async () => {
  const dataDir = tempDataDir();
  const file = path.join(dataDir, 'accents.txt');
  fs.writeFileSync(file, FIXTURE);
  const accents = new PitchAccent(dataDir);
  await accents.load();
  fs.writeFileSync(file, '猫\tねこ\t[2]\n');
  await accents.load();
  assert.deepEqual(accents.lookup('猫'), { reading: 'ねこ', patterns: [0] });
});

test('download streams the file with progress and replaces it atomically', async (t) => {
  const dataDir = tempDataDir();
  const calls = [];
  const chunks = ['猫\tねこ\t', '[2]\n'].map((text) => new TextEncoder().encode(text));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }), { headers: { 'content-length': String(total) } });
  });
  const accents = new PitchAccent(dataDir);
  const progress = [];
  await accents.download((fraction) => progress.push(fraction));
  assert.equal(calls[0].url, ACCENTS_URL);
  assert.deepEqual(progress, [chunks[0].length / total, 1]);
  assert.equal(fs.readFileSync(path.join(dataDir, 'accents.txt'), 'utf8'), '猫\tねこ\t[2]\n');
  assert.equal(fs.existsSync(path.join(dataDir, 'accents.txt.tmp')), false);
  await accents.load();
  assert.deepEqual(accents.lookup('猫'), { reading: 'ねこ', patterns: [2] });
});

test('download without content-length reports no progress', async (t) => {
  const dataDir = tempDataDir();
  t.mock.method(globalThis, 'fetch', async () => new Response('猫\tねこ\t0\n'));
  const progress = [];
  await new PitchAccent(dataDir).download((fraction) => progress.push(fraction));
  assert.deepEqual(progress, []);
  assert.equal(fs.existsSync(path.join(dataDir, 'accents.txt')), true);
});

test('download rejects on HTTP error and writes nothing', async (t) => {
  const dataDir = tempDataDir();
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }));
  await assert.rejects(new PitchAccent(dataDir).download(), /HTTP 404/);
  assert.equal(fs.existsSync(path.join(dataDir, 'accents.txt')), false);
});

test('moraSplit splits kana into morae', () => {
  assert.deepEqual(moraSplit('きょう'), ['きょ', 'う']);
  assert.deepEqual(moraSplit('がっこう'), ['が', 'っ', 'こ', 'う']);
  assert.deepEqual(moraSplit('ラーメン'), ['ラ', 'ー', 'メ', 'ン']);
  assert.deepEqual(moraSplit('しゃしん'), ['しゃ', 'し', 'ん']);
  assert.deepEqual(moraSplit('きょうしゅ'), ['きょ', 'う', 'しゅ']);
  assert.deepEqual(moraSplit('ファイル'), ['ファ', 'イ', 'ル']);
  assert.deepEqual(moraSplit('ぁ'), ['ぁ']);
  assert.deepEqual(moraSplit('てぃー'), ['てぃ', 'ー']);
  assert.deepEqual(moraSplit(''), []);
});

test('pitchPattern for heiban is low then high', () => {
  assert.deepEqual(pitchPattern('がっこう', 0), [
    { mora: 'が', high: false },
    { mora: 'っ', high: true },
    { mora: 'こ', high: true },
    { mora: 'う', high: true },
  ]);
});

test('pitchPattern for atamadaka is high then low', () => {
  assert.deepEqual(pitchPattern('ラーメン', 1), [
    { mora: 'ラ', high: true },
    { mora: 'ー', high: false },
    { mora: 'メ', high: false },
    { mora: 'ン', high: false },
  ]);
});

test('pitchPattern for nakadaka is high from mora 2 through the accent mora', () => {
  assert.deepEqual(pitchPattern('がっこう', 3), [
    { mora: 'が', high: false },
    { mora: 'っ', high: true },
    { mora: 'こ', high: true },
    { mora: 'う', high: false },
  ]);
  assert.deepEqual(pitchPattern('はし', 2), [
    { mora: 'は', high: false },
    { mora: 'し', high: true },
  ]);
});

test('pitchPattern for odaka keeps the last mora high', () => {
  assert.deepEqual(pitchPattern('はし', 2).map((item) => item.high), [false, true]);
  assert.deepEqual(pitchPattern('ラーメン', 4).map((item) => item.high), [false, true, true, true]);
});

test('pitchPattern of an empty reading is empty', () => {
  assert.deepEqual(pitchPattern('', 0), []);
});

test('pitchLabel names each pitch class', () => {
  assert.equal(pitchLabel('がっこう', 0), 'heiban');
  assert.equal(pitchLabel('ラーメン', 1), 'atamadaka');
  assert.equal(pitchLabel('がっこう', 3), 'nakadaka');
  assert.equal(pitchLabel('はし', 2), 'odaka');
  assert.equal(pitchLabel('ラーメン', 4), 'odaka');
});
