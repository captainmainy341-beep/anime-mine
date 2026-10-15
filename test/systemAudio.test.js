const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createSystemAudio } = require('../src/core/systemAudio');

const SR = 24000;
const sampleAt = i => i % 30000;

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-audio-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const helperSource = path.join(dir, 'mac-audio.swift');
  fs.writeFileSync(helperSource, 'source');
  return { dir, helperSource };
}

function clock(t = 0) {
  const now = () => now.t;
  now.t = t;
  return now;
}

function fakeExec() {
  const exec = async (file, args) => {
    exec.calls.push({ file, args });
    fs.writeFileSync(args[args.indexOf('-o') + 1], 'binary');
  };
  exec.calls = [];
  return exec;
}

function manualExec() {
  const exec = (file, args, options = {}) => {
    const temp = args[args.indexOf('-o') + 1];
    const job = { signal: options.signal };
    exec.calls.push(job);
    return new Promise((resolve, reject) => {
      job.complete = () => {
        fs.writeFileSync(temp, 'binary');
        resolve('');
      };
      job.exit = () => {
        fs.writeFileSync(temp, 'partial');
        reject(new Error('killed'));
      };
    });
  };
  exec.calls = [];
  return exec;
}

async function until(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'condition not reached');
}

function fakeSpawn({ throws = null, emitError = null } = {}) {
  const spawn = (bin, args, options) => {
    spawn.calls.push({ bin, args, options });
    if (throws) throw throws;
    const proc = new EventEmitter();
    proc.stdin = new EventEmitter();
    proc.stdin.end = () => {
      proc.stdin.ended = true;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {
      proc.killed = true;
    };
    spawn.procs.push(proc);
    if (emitError) setImmediate(() => proc.emit('error', emitError));
    return proc;
  };
  spawn.calls = [];
  spawn.procs = [];
  return spawn;
}

function recordingEncode() {
  const encode = async ({ pcm, sampleRate }) => {
    encode.calls.push({ pcm, sampleRate });
    return Buffer.from('mp3');
  };
  encode.calls = [];
  return encode;
}

function emitSamples(proc, from, count) {
  const buf = Buffer.alloc(count * 2);
  for (let j = 0; j < count; j++) buf.writeInt16LE(sampleAt(from + j), j * 2);
  proc.stdout.emit('data', buf);
}

function speech(totalMs, bursts) {
  const values = new Array(totalMs * SR / 1000).fill(0);
  for (const [from, to] of bursts) values.fill(10000, from * SR / 1000, to * SR / 1000);
  return values;
}

function emitValues(proc, values) {
  const buf = Buffer.alloc(values.length * 2);
  values.forEach((v, j) => buf.writeInt16LE(v, j * 2));
  proc.stdout.emit('data', buf);
}

async function started(t, overrides = {}) {
  const { dir, helperSource } = setup(t);
  const spawn = fakeSpawn();
  const encode = recordingEncode();
  const now = clock();
  const sys = createSystemAudio({
    spawn,
    execFile: fakeExec(),
    dataDir: dir,
    helperSource,
    now,
    encode,
    sampleRate: SR,
    platform: 'darwin',
    ...overrides,
  });
  t.after(() => sys.stop());
  await sys.start();
  return { sys, spawn, encode, now, proc: spawn.procs[0] };
}

test('start compiles the helper once and spawns it with piped stdio', async t => {
  const { dir, helperSource } = setup(t);
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const sys = createSystemAudio({ spawn, execFile: exec, dataDir: dir, helperSource, now: clock(), platform: 'darwin' });
  t.after(() => sys.stop());

  await sys.start();
  await sys.start();

  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].file, 'swiftc');
  assert.deepEqual(exec.calls[0].args.slice(0, 2), ['-O', helperSource]);
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].bin, path.join(dir, 'bin', 'mac-audio'));
  assert.deepEqual(spawn.calls[0].options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.deepEqual(sys.status(), { running: true });
});

test('the ring buffer overwrites samples older than bufferSeconds', async t => {
  const { sys, encode, now, proc } = await started(t, { bufferSeconds: 2 });
  for (let s = 0; s < 3; s++) {
    now.t = (s + 1) * 1000;
    emitSamples(proc, s * SR, SR);
  }

  const mp3 = await sys.clip({ fromMs: 0, toMs: 3000 });

  assert.deepEqual(mp3, Buffer.from('mp3'));
  const { pcm, sampleRate } = encode.calls[0];
  assert.equal(sampleRate, SR);
  assert.equal(pcm.length, 2 * SR * 2);
  assert.equal(pcm.readInt16LE(0), sampleAt(SR));
  assert.equal(pcm.readInt16LE(pcm.length - 2), sampleAt(3 * SR - 1));
});

test('clip maps milliseconds to the matching samples', async t => {
  const { sys, encode, now, proc } = await started(t);
  now.t = 1000;
  emitSamples(proc, 0, SR);
  now.t = 2000;
  emitSamples(proc, SR, SR);

  await sys.clip({ fromMs: 1500, toMs: 2000 });

  const { pcm } = encode.calls[0];
  assert.equal(pcm.length, SR);
  assert.equal(pcm.readInt16LE(0), sampleAt(SR + SR / 2));
  assert.equal(pcm.readInt16LE(pcm.length - 2), sampleAt(2 * SR - 1));
});

test('clip inserts silence for a gap between chunks so real time is preserved', async t => {
  const { sys, encode, now, proc } = await started(t);
  now.t = 1000;
  emitSamples(proc, 0, SR);
  now.t = 3000;
  emitSamples(proc, SR, SR);

  await sys.clip({ fromMs: 0, toMs: 3000 });

  const { pcm } = encode.calls[0];
  assert.equal(pcm.length, 3 * SR * 2);
  for (let i = SR; i < 2 * SR; i++) assert.equal(pcm.readInt16LE(i * 2), 0);
  assert.equal(pcm.readInt16LE(2 * SR * 2), sampleAt(SR));
});

test('chunks delivered together keep a continuous timeline instead of overlapping', async t => {
  const { sys, encode, now, proc } = await started(t);
  now.t = 2000;
  emitSamples(proc, 0, SR);
  emitSamples(proc, SR, SR);

  await sys.clip({ fromMs: 1500, toMs: 2000 });

  assert.equal(encode.calls[0].pcm.length, Math.round(0.5 * SR) * 2);
  assert.equal(encode.calls[0].pcm.readInt16LE(0), sampleAt(Math.round(0.5 * SR)));
});

test('clip does not pad gaps of 50 ms or less', async t => {
  const { sys, encode, now, proc } = await started(t);
  now.t = 1000;
  emitSamples(proc, 0, SR);
  now.t = 2040;
  emitSamples(proc, SR, SR);

  await sys.clip({ fromMs: 0, toMs: 2040 });

  assert.equal(encode.calls[0].pcm.length, 2 * SR * 2);
});

test('clip caps the range at 60 seconds and keeps the start', async t => {
  const { sys, encode, now, proc } = await started(t, { bufferSeconds: 90 });
  for (let s = 0; s < 70; s++) {
    now.t = (s + 1) * 1000;
    emitSamples(proc, s * SR, SR);
  }

  await sys.clip({ fromMs: 0, toMs: 70000 });

  const { pcm } = encode.calls[0];
  assert.equal(pcm.length, 60 * SR * 2);
  assert.equal(pcm.readInt16LE(0), sampleAt(0));
  assert.equal(pcm.readInt16LE(pcm.length - 2), sampleAt(60 * SR - 1));
});

test('stop during a compile waits for it to exit before a restarted compile begins', async t => {
  const { dir, helperSource } = setup(t);
  const exec = manualExec();
  const spawn = fakeSpawn();
  const sys = createSystemAudio({ spawn, execFile: exec, dataDir: dir, helperSource, now: clock(), platform: 'darwin' });
  t.after(() => sys.stop());

  const first = sys.start();
  await until(() => exec.calls.length === 1);
  sys.stop();
  assert.equal(exec.calls[0].signal.aborted, true);

  const second = sys.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(exec.calls.length, 1);

  exec.calls[0].exit();
  await first;
  await until(() => exec.calls.length === 2);
  exec.calls[1].complete();
  await second;

  assert.equal(spawn.calls.length, 1);
  assert.deepEqual(sys.status(), { running: true });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'bin')), ['mac-audio']);
});

test('clip returns null when the helper is not running', async t => {
  const { sys, proc, now } = await started(t);
  now.t = 1000;
  emitSamples(proc, 0, SR);
  sys.stop();

  assert.equal(await sys.clip({ fromMs: 0, toMs: 1000 }), null);
});

test('clip returns null when the buffer is empty or the range is under 300 ms', async t => {
  const { sys, encode, now, proc } = await started(t);
  assert.equal(await sys.clip({ fromMs: 0, toMs: 1000 }), null);

  now.t = 1000;
  emitSamples(proc, 0, SR / 5);
  assert.equal(await sys.clip({ fromMs: 800, toMs: 1000 }), null);
  assert.equal(encode.calls.length, 0);
});

test('clip returns null when encoding fails', async t => {
  const failing = async () => {
    throw new Error('ffmpeg failed');
  };
  const { sys, now, proc } = await started(t, { encode: failing });
  now.t = 1000;
  emitSamples(proc, 0, SR);

  assert.equal(await sys.clip({ fromMs: 0, toMs: 1000 }), null);
});

test('idle timeout stops the helper and clears the buffer', async t => {
  const { sys, spawn, now, proc } = await started(t, { idleMs: 30 });
  now.t = 1000;
  emitSamples(proc, 0, SR);

  await new Promise(resolve => setTimeout(resolve, 80));

  assert.equal(proc.stdin.ended, true);
  assert.equal(proc.killed, true);
  assert.deepEqual(sys.status(), { running: false });
  assert.equal(await sys.clip({ fromMs: 0, toMs: 1000 }), null);
  assert.equal(spawn.procs.length, 1);
});

test('start never throws when spawn throws', async t => {
  const spawn = fakeSpawn({ throws: new Error('spawn EACCES') });
  const { dir, helperSource } = setup(t);
  const sys = createSystemAudio({ spawn, execFile: fakeExec(), dataDir: dir, helperSource, now: clock(), platform: 'darwin' });
  t.after(() => sys.stop());

  await assert.doesNotReject(sys.start());
  assert.deepEqual(sys.status(), { running: false, error: 'spawn EACCES' });
});

test('start records an asynchronous spawn error without throwing', async t => {
  const spawn = fakeSpawn({ emitError: new Error('spawn ENOENT') });
  const { dir, helperSource } = setup(t);
  const sys = createSystemAudio({ spawn, execFile: fakeExec(), dataDir: dir, helperSource, now: clock(), platform: 'darwin' });
  t.after(() => sys.stop());

  await assert.doesNotReject(sys.start());
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sys.status(), { running: false, error: 'spawn ENOENT' });
});

test('start does not retry within 60 seconds of a failure', async t => {
  const spawn = fakeSpawn({ throws: new Error('spawn EACCES') });
  const { dir, helperSource } = setup(t);
  const now = clock(0);
  const sys = createSystemAudio({ spawn, execFile: fakeExec(), dataDir: dir, helperSource, now, platform: 'darwin' });
  t.after(() => sys.stop());

  await sys.start();
  now.t = 59000;
  await sys.start();
  assert.equal(spawn.calls.length, 1);

  now.t = 60000;
  await sys.start();
  assert.equal(spawn.calls.length, 2);
});

test('start reports non-darwin platforms without compiling or spawning', async t => {
  const { dir, helperSource } = setup(t);
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const sys = createSystemAudio({ spawn, execFile: exec, dataDir: dir, helperSource, now: clock(), platform: 'linux' });
  t.after(() => sys.stop());

  await sys.start();

  assert.equal(exec.calls.length, 0);
  assert.equal(spawn.calls.length, 0);
  assert.deepEqual(sys.status(), { running: false, error: 'system audio capture requires macOS' });
});

test('clipLastUtterance keeps only the final burst plus pads', async t => {
  const { sys, encode, now, proc } = await started(t);
  now.t = 6000;
  emitValues(proc, speech(6000, [[1000, 1500], [2500, 3000]]));

  assert.deepEqual(await sys.clipLastUtterance(), Buffer.from('mp3'));

  const { pcm, sampleRate } = encode.calls[0];
  assert.equal(sampleRate, SR);
  assert.equal(pcm.length, 800 * SR / 1000 * 2);
  assert.equal(pcm.readInt16LE(0), 0);
  assert.equal(pcm.readInt16LE(150 * SR / 1000 * 2), 10000);
  let loud = 0;
  for (let i = 0; i < pcm.length; i += 2) if (pcm.readInt16LE(i) !== 0) loud++;
  assert.equal(loud, 500 * SR / 1000);
});

test('clipLastUtterance caps a single long burst to maxSeconds counting back from its end', async t => {
  const { sys, encode, now, proc } = await started(t);
  now.t = 30000;
  emitValues(proc, speech(30000, [[2000, 28000]]));

  await sys.clipLastUtterance({ maxSeconds: 20 });

  const { pcm } = encode.calls[0];
  assert.equal(pcm.length, 20 * SR * 2);
  assert.equal(pcm.readInt16LE(0), 10000);
  assert.equal(pcm.readInt16LE(pcm.length - 150 * SR / 1000 * 2 - 2), 10000);
  assert.equal(pcm.readInt16LE(pcm.length - 2), 0);
});

test('clipLastUtterance returns null when all audio is silent', async t => {
  const { sys, encode, now, proc } = await started(t);
  now.t = 3000;
  emitValues(proc, speech(3000, []));

  assert.equal(await sys.clipLastUtterance(), null);
  assert.equal(encode.calls.length, 0);
});

test('clipLastUtterance returns null when the helper is not running', async t => {
  const { sys, now, proc } = await started(t);
  now.t = 1000;
  emitValues(proc, speech(1000, [[0, 1000]]));
  sys.stop();

  assert.equal(await sys.clipLastUtterance(), null);
});
