const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const SAMPLE_RATE = 8000;
const ANALYSIS_SECONDS = 1800;
const MAX_CUE_SECONDS = 9;
const SOUND_EFFECT = /^\s*[（(][^）)]*[）)]\s*$/;
// Normalised cross-correlation units, averaged per window.
const MIN_GAIN = 0.1;
const MIN_SHIFT = 0.1;
const SWITCH_PENALTY = 0.5;
const MIN_RUN_MARGIN = 0.15;

function energyFromPcm(int16Samples, sampleRate, step = 0.1) {
  const block = Math.max(1, Math.round(sampleRate * step));
  const count = Math.ceil(int16Samples.length / block);
  const energy = new Float64Array(count);
  for (let b = 0; b < count; b++) {
    const from = b * block;
    const to = Math.min(int16Samples.length, from + block);
    let sum = 0;
    for (let i = from; i < to; i++) sum += int16Samples[i] * int16Samples[i];
    energy[b] = Math.log10(sum / (to - from) + 1);
  }
  return energy;
}

function speechMask(energy) {
  const sorted = Float64Array.from(energy).sort();
  const threshold = sorted[Math.floor(0.45 * (sorted.length - 1))] ?? 0;
  return Int8Array.from(energy, (value) => (value > threshold ? 1 : -1));
}

function cueMask(cues, length, step = 0.1) {
  const mask = new Float64Array(length).fill(-1);
  for (const cue of cues) {
    if (cue.end - cue.start > MAX_CUE_SECONDS || SOUND_EFFECT.test(cue.text)) continue;
    const from = Math.max(0, Math.floor(cue.start / step));
    const to = Math.min(length, Math.ceil(cue.end / step));
    mask.fill(1, from, to);
  }
  return mask;
}

function estimateShifts({ speech, cues, step = 0.1, windowSec = 60, hopSec = 30, maxShiftSec = 30 }) {
  const cue = cueMask(cues, speech.length, step);
  const win = Math.round(windowSec / step);
  const hop = Math.round(hopSec / step);
  const maxK = Math.round(maxShiftSec / step);
  const starts = [];
  for (let a = 0; a + win <= speech.length; a += hop) starts.push(a);
  if (starts.length === 0) return { segments: [], gain: 0 };

  const states = 2 * maxK + 1;
  const scores = starts.map((a) => {
    const row = new Float64Array(states);
    // Wall-to-wall music or silence says nothing about alignment, so such windows are down-weighted.
    let speaking = 0;
    for (let i = a; i < a + win; i++) if (speech[i] > 0) speaking++;
    const informative = 1 - Math.abs((2 * speaking) / win - 1) ** 2;
    for (let si = 0; si < states; si++) {
      const k = si - maxK;
      let sum = 0;
      for (let i = a; i < a + win; i++) {
        const j = i - k;
        sum += j >= 0 && j < cue.length ? speech[i] * cue[j] : -speech[i];
      }
      row[si] = Math.abs(k) > maxK - 80 ? -1 : (sum / win) * informative; // a best match on the search edge means no real match
    }
    return row;
  });

  const W = scores.length;
  const best = Float64Array.from(scores[0]);
  const backpointers = [];
  for (let w = 1; w < W; w++) {
    let top = 0;
    for (let si = 1; si < states; si++) if (best[si] > best[top]) top = si;
    const switched = best[top] - SWITCH_PENALTY;
    const next = new Float64Array(states);
    const from = new Int32Array(states);
    for (let si = 0; si < states; si++) {
      const stay = best[si] >= switched;
      next[si] = (stay ? best[si] : switched) + scores[w][si];
      from[si] = stay ? si : top;
    }
    backpointers.push(from);
    best.set(next);
  }

  const path = new Int32Array(W);
  for (let si = 1; si < states; si++) if (best[si] > best[path[W - 1]]) path[W - 1] = si;
  for (let w = W - 1; w > 0; w--) path[w - 1] = backpointers[w - 1][path[w]];

  // A run of windows must beat the previous run's offset by a clear margin, otherwise it is noise (e.g. the sparse tail).
  for (let changed = true; changed;) {
    changed = false;
    let start = 0;
    for (let w = 1; w <= W; w++) {
      if (w < W && path[w] === path[start]) continue;
      if (start > 0) {
        const previous = path[start - 1];
        let margin = 0;
        for (let i = start; i < w; i++) margin += scores[i][path[start]] - scores[i][previous];
        if (margin / (w - start) < MIN_RUN_MARGIN) {
          for (let i = start; i < w; i++) path[i] = previous;
          changed = true;
          break;
        }
      }
      start = w;
    }
  }

  let total = 0;
  for (let w = 0; w < W; w++) total += scores[w][path[w]] - scores[w][maxK];
  const gain = total / Math.max(1, W);

  const cueAt = (i, k) => {
    const j = i - k;
    return j >= 0 && j < cue.length ? cue[j] : -1;
  };
  const segments = [{ from: 0, k: path[0] - maxK }];
  for (let w = 1; w < W; w++) {
    const k = path[w] - maxK;
    if (k === segments[segments.length - 1].k) continue;
    const previous = segments[segments.length - 1].k;
    const boundary = starts[w - 1] + (win + hop) / 2;
    let refined = boundary;
    let bestDistance = Infinity;
    for (let i = Math.max(0, boundary - win / 2); i <= Math.min(speech.length - 1, boundary + win / 2); i++) {
      const distance = Math.abs(i - boundary);
      if (distance < bestDistance && cueAt(i, previous) < 0 && cueAt(i, k) < 0) {
        bestDistance = distance;
        refined = i;
      }
    }
    segments.push({ from: refined * step, k });
  }

  return {
    segments: segments.map(({ from, k }) => ({ from: Number(from.toFixed(3)), offset: Number((k * step).toFixed(1)) })),
    gain,
  };
}

function applyShifts(cues, segments) {
  if (segments.length === 0) return cues.slice();
  return cues
    .map((cue) => {
      let segment = segments[0];
      for (const candidate of segments) {
        if (candidate.from <= cue.start + candidate.offset) segment = candidate;
      }
      return { ...cue, start: cue.start + segment.offset, end: cue.end + segment.offset };
    })
    .filter((cue) => cue.end > 0)
    .sort((a, b) => a.start - b.start);
}

function defaultExtractPcm(video) {
  const ffmpeg = require('./probe').ffmpegPath();
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-i', video, '-map', '0:a:0', '-t', String(ANALYSIS_SECONDS), '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', '-'];
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks = [];
    proc.stdout.on('data', (chunk) => chunks.push(chunk));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed (${code})`));
      const buffer = Buffer.concat(chunks);
      const samples = new Int16Array(Math.floor(buffer.length / 2));
      for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2);
      resolve(samples);
    });
  });
}

async function analyze(video, cues, extractPcm) {
  const samples = await extractPcm(video);
  const speech = speechMask(energyFromPcm(samples, SAMPLE_RATE));
  const { segments, gain } = estimateShifts({ speech, cues });
  const applied = gain > MIN_GAIN && segments.some((segment) => Math.abs(segment.offset) >= MIN_SHIFT);
  return { applied, gain, segments: applied ? segments : [] };
}

async function cacheKey(video, subtitlePath) {
  const videoStat = await fs.stat(video);
  const subtitleStat = await fs.stat(subtitlePath);
  const raw = `${video}|${videoStat.mtimeMs}|${videoStat.size}|${subtitlePath}|${subtitleStat.mtimeMs}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function syncCues({ video, cues, subtitlePath, dataDir, extractPcm = defaultExtractPcm }) {
  const unchanged = { cues, applied: false, segments: [] };
  try {
    const file = path.join(dataDir, 'subsync', `${await cacheKey(video, subtitlePath)}.json`);
    let result = await readJson(file);
    if (!result) {
      result = await analyze(video, cues, extractPcm);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(result));
    }
    if (!result.applied) return unchanged;
    return { cues: applyShifts(cues, result.segments), applied: true, segments: result.segments };
  } catch {
    return unchanged;
  }
}

module.exports = { energyFromPcm, speechMask, cueMask, estimateShifts, applyShifts, syncCues };
