const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { energyFromPcm, speechMask, cueMask, estimateShifts, applyShifts, syncCues } = require('../src/core/subSync');

const STEP = 0.1;
const SAMPLES_PER_STEP = 800;

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function makeCues(seconds, seed = 7) {
  const rnd = lcg(seed);
  const cues = [];
  let t = 1;
  while (t < seconds) {
    const duration = 1.5 + rnd() * 2;
    cues.push({ start: Math.round(t * 10) / 10, end: Math.round((t + duration) * 10) / 10, text: 'line' });
    t += duration + 0.5 + rnd() * 3;
  }
  return cues;
}

function speechFromCues(cues, shiftAt, length) {
  const speech = new Int8Array(length).fill(-1);
  for (const cue of cues) {
    const shift = shiftAt(cue.start);
    const from = Math.max(0, Math.round((cue.start + shift) / STEP));
    const to = Math.min(length, Math.round((cue.end + shift) / STEP));
    speech.fill(1, from, to);
  }
  return speech;
}

function randomSpeech(length, seed) {
  const rnd = lcg(seed);
  return Int8Array.from({ length }, () => (rnd() < 0.55 ? 1 : -1));
}

function pcmFromSpeech(speech, seed = 11) {
  const rnd = lcg(seed);
  const samples = new Int16Array(speech.length * SAMPLES_PER_STEP);
  for (let b = 0; b < speech.length; b++) {
    if (speech[b] !== 1) continue;
    const amplitude = 500 + rnd() * 2500;
    for (let i = b * SAMPLES_PER_STEP; i < (b + 1) * SAMPLES_PER_STEP; i++) {
      samples[i] = i % 2 === 0 ? amplitude : -amplitude;
    }
  }
  return samples;
}

async function fixture(speech) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subsync-'));
  const video = path.join(dir, 'ep.mkv');
  const subtitlePath = path.join(dir, 'ep.ass');
  await fs.writeFile(video, 'video');
  await fs.writeFile(subtitlePath, 'subs');
  let calls = 0;
  const extractPcm = async () => {
    calls += 1;
    return pcmFromSpeech(speech);
  };
  return { dir, video, subtitlePath, extractPcm, calls: () => calls };
}

const offsetAt = (segments, t) => segments.filter((segment) => segment.from <= t).at(-1).offset;

test('energyFromPcm and speechMask separate loud blocks from silence', () => {
  const samples = new Int16Array(SAMPLES_PER_STEP * 4);
  samples.fill(2000, SAMPLES_PER_STEP * 2);
  const energy = energyFromPcm(samples, 8000, STEP);
  assert.equal(energy.length, 4);
  assert.deepEqual(Array.from(speechMask(energy)), [-1, -1, 1, 1]);
});

test('cueMask ignores long credit cues and bracketed sound effects', () => {
  const cues = [
    { start: 0, end: 10, text: 'banner' },
    { start: 2, end: 3, text: '（笑い声）' },
    { start: 4, end: 5, text: 'speech' },
  ];
  assert.deepEqual(Array.from(cueMask(cues, 60, STEP)).slice(0, 60), Array.from({ length: 60 }, (_, i) => (i >= 40 && i < 50 ? 1 : -1)));
});

test('estimateShifts and applyShifts recover +1.0s then -9.0s within 0.2s', () => {
  const cues = makeCues(600);
  const speech = speechFromCues(cues, (t) => (t < 90 ? 1 : -9), 6000);
  const { segments, gain } = estimateShifts({ speech, cues });
  assert.ok(gain > 0.05, `gain ${gain}`);
  assert.ok(Math.abs(offsetAt(segments, 30) - 1) <= 0.2, `early offset ${offsetAt(segments, 30)}`);
  assert.ok(Math.abs(offsetAt(segments, 300) + 9) <= 0.2, `late offset ${offsetAt(segments, 300)}`);

  const synced = applyShifts(cues, segments);
  assert.equal(synced.length, cues.length);
  cues.forEach((cue, i) => {
    const expected = cue.start < 80 ? cue.start + 1 : cue.start >= 200 && cue.start < 500 ? cue.start - 9 : null;
    if (expected !== null) assert.ok(Math.abs(synced[i].start - expected) <= 0.2, `cue ${cue.start} -> ${synced[i].start}`);
    assert.equal(synced[i].text, cue.text);
  });
});

test('syncCues applies the piecewise correction and caches the analysis', async () => {
  const cues = makeCues(600);
  const speech = speechFromCues(cues, (t) => (t < 90 ? 1 : -9), 6000);
  const fx = await fixture(speech);
  const dataDir = path.join(fx.dir, 'data');
  const first = await syncCues({ video: fx.video, cues, subtitlePath: fx.subtitlePath, dataDir, extractPcm: fx.extractPcm });
  const second = await syncCues({ video: fx.video, cues, subtitlePath: fx.subtitlePath, dataDir, extractPcm: fx.extractPcm });
  assert.equal(first.applied, true);
  assert.deepEqual(second, first);
  assert.equal(fx.calls(), 1);
  assert.equal((await fs.readdir(path.join(dataDir, 'subsync'))).length, 1);
});

test('syncCues leaves already aligned cues untouched', async () => {
  const cues = makeCues(600);
  const speech = speechFromCues(cues, () => 0, 6000);
  const fx = await fixture(speech);
  const result = await syncCues({ video: fx.video, cues, subtitlePath: fx.subtitlePath, dataDir: path.join(fx.dir, 'data'), extractPcm: fx.extractPcm });
  assert.equal(result.applied, false);
  assert.deepEqual(result.cues, cues);
});

test('syncCues does not apply a correction to uncorrelated noise', async () => {
  const cues = makeCues(600);
  const fx = await fixture(randomSpeech(6000, 3));
  const result = await syncCues({ video: fx.video, cues, subtitlePath: fx.subtitlePath, dataDir: path.join(fx.dir, 'data'), extractPcm: fx.extractPcm });
  assert.equal(result.applied, false);
  assert.deepEqual(result.cues, cues);
});

test('syncCues returns the original cues when analysis fails', async () => {
  const cues = [{ start: 1, end: 2, text: 'a' }];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subsync-missing-'));
  const result = await syncCues({
    video: path.join(dir, 'missing.mkv'),
    cues,
    subtitlePath: path.join(dir, 'missing.ass'),
    dataDir: dir,
    extractPcm: async () => {
      throw new Error('no audio');
    },
  });
  assert.deepEqual(result, { cues, applied: false, segments: [] });
});
