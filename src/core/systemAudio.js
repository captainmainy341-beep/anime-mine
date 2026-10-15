const child_process = require('node:child_process');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const media = require('./media');

const DEFAULT_SOURCE = path.join(__dirname, '..', '..', 'native', 'audio', 'mac-audio.swift');
const RETRY_MS = 60 * 1000;
const COMPILE_TIMEOUT_MS = 180 * 1000;
const MIN_CLIP_MS = 300;
const MAX_RANGE_MS = 60 * 1000;
const GAP_MS = 50;
const FRAME_MS = 20;
const UTTERANCE_PAD_MS = 150;

function defaultExecFile(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    child_process.execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ''}`, { cause: error }));
      else resolve(stdout);
    });
  });
}

function createSystemAudio({
  spawn = child_process.spawn,
  execFile = defaultExecFile,
  dataDir,
  helperSource = DEFAULT_SOURCE,
  now = Date.now,
  encode = media.pcmToMp3,
  bufferSeconds = 180,
  sampleRate = 24000,
  idleMs = 300000,
  platform = process.platform,
} = {}) {
  const binDir = path.join(dataDir, 'bin');
  const bin = path.join(binDir, 'mac-audio');
  const bufferMs = bufferSeconds * 1000;
  const minSamples = Math.ceil((MIN_CLIP_MS / 1000) * sampleRate);
  const msToSamples = ms => Math.round((ms * sampleRate) / 1000);

  let proc = null;
  let error = null;
  let failedAt = null;
  let starting = null;
  let generation = 0;
  let idleTimer = null;
  let chunks;
  let carry;
  let compiling = null;
  let compileAbort = null;

  function resetBuffer() {
    chunks = [];
    carry = null;
  }
  resetBuffer();

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, idleMs);
    idleTimer.unref();
  }

  function stop() {
    generation += 1;
    clearTimeout(idleTimer);
    starting = null;
    error = null;
    compileAbort?.abort();
    compileAbort = null;
    const dying = proc;
    proc = null;
    resetBuffer();
    if (dying) {
      dying.stdin.end();
      dying.kill();
    }
  }

  function status() {
    if (proc) return { running: true };
    return error ? { running: false, error } : { running: false };
  }

  async function compile(temp, signal) {
    try {
      await execFile('swiftc', ['-O', helperSource, '-o', temp], { timeout: COMPILE_TIMEOUT_MS, signal });
    } catch (cause) {
      await fsp.rm(temp, { force: true });
      if (signal.aborted) return;
      if (cause.code === 'ENOENT' || cause.cause?.code === 'ENOENT') throw new Error('swiftc not found; install Xcode command line tools');
      throw new Error(`mac-audio build failed: ${cause.message}`);
    }
    if (signal.aborted) {
      await fsp.rm(temp, { force: true });
      return;
    }
    await fsp.rename(temp, bin);
  }

  async function build(gen) {
    const source = await fsp.stat(helperSource);
    const built = await fsp.stat(bin).catch(() => null);
    if (built && built.mtimeMs >= source.mtimeMs) return;

    await fsp.mkdir(binDir, { recursive: true });
    await compiling?.catch(() => {});
    if (gen !== generation) return;

    const abort = new AbortController();
    compileAbort = abort;
    const temp = `${bin}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    compiling = compile(temp, abort.signal);
    await compiling;
  }

  function evict(newestEndMs) {
    while (chunks.length && chunks[0].endMs <= newestEndMs - bufferMs) chunks.shift();
  }

  function ingest(child, chunk) {
    if (proc !== child) return;
    const data = carry ? Buffer.concat([carry, chunk]) : chunk;
    const usable = data.length - (data.length % 2);
    carry = usable < data.length ? Buffer.from(data.subarray(usable)) : null;
    if (usable === 0) return;
    const durMs = (usable / 2 / sampleRate) * 1000;
    const prevEnd = chunks.length ? chunks[chunks.length - 1].endMs : -Infinity;
    const endMs = Math.max(prevEnd, now() - durMs) + durMs;
    chunks.push({ endMs, samples: data.subarray(0, usable) });
    evict(endMs);
  }

  function exited(child, message) {
    if (proc !== child) return;
    proc = null;
    clearTimeout(idleTimer);
    resetBuffer();
    if (message) {
      error = message;
      failedAt = now();
    }
  }

  async function launch(gen) {
    if (platform !== 'darwin') throw new Error('system audio capture requires macOS');
    await build(gen);
    if (gen !== generation) return;

    const child = spawn(bin, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    proc = child;
    error = null;
    let stderrLine = '';
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => ingest(child, chunk));
    child.stderr.on('data', chunk => {
      stderrLine = chunk.toString().trim() || stderrLine;
    });
    child.on('error', spawnError => exited(child, spawnError.message));
    child.on('close', code => exited(child, code === 0 ? null : `mac-audio exited (${code})${stderrLine ? `: ${stderrLine}` : ''}`));
    touch();
  }

  function start() {
    touch();
    if (proc) return Promise.resolve();
    if (starting) return starting;
    if (failedAt !== null && now() - failedAt < RETRY_MS) return Promise.resolve();

    const gen = generation;
    const attempt = launch(gen)
      .catch(launchError => {
        if (gen !== generation) return;
        error = launchError.message;
        failedAt = now();
      })
      .finally(() => {
        if (starting === attempt) starting = null;
      });
    starting = attempt;
    return attempt;
  }

  function pcmBetween(fromMs, toMs) {
    const parts = [];
    let prevEndMs = null;
    for (const chunk of chunks) {
      const count = chunk.samples.length / 2;
      const startMs = chunk.endMs - (count * 1000) / sampleRate;
      if (startMs >= toMs) break;
      if (chunk.endMs <= fromMs) continue;
      if (prevEndMs !== null && startMs - prevEndMs > GAP_MS) parts.push(Buffer.alloc(msToSamples(startMs - prevEndMs) * 2));
      const from = Math.max(0, msToSamples(fromMs - startMs));
      const to = Math.min(count, msToSamples(toMs - startMs));
      if (to > from) parts.push(chunk.samples.subarray(from * 2, to * 2));
      prevEndMs = chunk.endMs;
    }
    return Buffer.concat(parts);
  }

  async function encodeOrNull(pcm) {
    try {
      const encoded = await encode({ pcm, sampleRate });
      return encoded?.length ? encoded : null;
    } catch {
      return null;
    }
  }

  async function clip({ fromMs, toMs }) {
    touch();
    if (!proc || chunks.length === 0) return null;

    const pcm = pcmBetween(fromMs, Math.min(toMs, fromMs + MAX_RANGE_MS));
    if (pcm.length / 2 < minSamples) return null;
    return encodeOrNull(pcm);
  }

  async function clipLastUtterance({ maxSeconds = 20, silenceMs = 700, thresholdDb = -45 } = {}) {
    touch();
    if (!proc || chunks.length === 0) return null;

    const first = chunks[0];
    const timelineStartMs = first.endMs - (first.samples.length / 2 * 1000) / sampleRate;
    const pcm = pcmBetween(timelineStartMs, chunks.at(-1).endMs);
    const total = pcm.length / 2;
    const frameSamples = msToSamples(FRAME_MS);
    const padSamples = msToSamples(UTTERANCE_PAD_MS);
    const quietFrames = Math.ceil(silenceMs / FRAME_MS);
    const isLoud = frame => {
      const from = frame * frameSamples;
      const to = Math.min(total, from + frameSamples);
      let sum = 0;
      for (let s = from; s < to; s++) {
        const v = pcm.readInt16LE(s * 2);
        sum += v * v;
      }
      return 20 * Math.log10(Math.sqrt(sum / (to - from)) / 32768) > thresholdDb;
    };

    let lastLoud = Math.ceil(total / frameSamples) - 1;
    while (lastLoud >= 0 && !isLoud(lastLoud)) lastLoud--;
    if (lastLoud < 0) return null;

    let burstStart = 0;
    let quiet = 0;
    for (let frame = lastLoud; frame >= 0; frame--) {
      if (isLoud(frame)) {
        quiet = 0;
        continue;
      }
      if (++quiet >= quietFrames) {
        burstStart = frame + quiet;
        break;
      }
    }

    const endSample = Math.min(total, (lastLoud + 1) * frameSamples + padSamples);
    const startSample = Math.max(0, burstStart * frameSamples - padSamples, endSample - msToSamples(maxSeconds * 1000));
    return encodeOrNull(pcm.subarray(startSample * 2, endSample * 2));
  }

  return { start, touch, clip, clipLastUtterance, stop, status };
}

module.exports = { createSystemAudio };
