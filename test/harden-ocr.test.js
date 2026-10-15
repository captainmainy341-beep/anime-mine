const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { OcrEngine } = require('../src/core/ocr');

const FIXTURE = path.join(__dirname, 'fixtures', 'ocr-sample.png');
const helperJson = JSON.stringify({ width: 100, height: 200, blocks: [{ text: 'a', box: { x: 0, y: 0, w: 0.5, h: 0.5 }, vertical: false, confidence: 1 }] });

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-harden-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setPlatform(t, value) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value });
  t.after(() => Object.defineProperty(process, 'platform', original));
}

function fakeExec() {
  const exec = async (file, args, options) => {
    exec.calls.push({ file, args, options });
    fs.writeFileSync(args.at(-1), 'binary');
  };
  exec.calls = [];
  return exec;
}

function hangingSpawn() {
  const spawn = (bin, args) => {
    spawn.calls.push({ bin, args });
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {
      spawn.killed += 1;
    };
    return proc;
  };
  spawn.calls = [];
  spawn.killed = 0;
  return spawn;
}

function succeedingSpawn(stdout) {
  const spawn = (bin, args) => {
    spawn.calls.push({ bin, args });
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from(stdout));
      proc.emit('close', 0);
    });
    return proc;
  };
  spawn.calls = [];
  return spawn;
}

async function until(condition) {
  while (!condition()) await new Promise((resolve) => setImmediate(resolve));
}

test('aborting recognize kills the helper and rejects with the abort reason', async (t) => {
  setPlatform(t, 'darwin');
  const spawn = hangingSpawn();
  const engine = new OcrEngine({ dataDir: setup(t), spawn, exec: fakeExec() });
  const controller = new AbortController();
  const pending = engine.recognize(FIXTURE, { signal: controller.signal });
  await until(() => spawn.calls.length === 1);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(spawn.killed, 1);
});

test('a helper still running after 60 s is killed and the call fails', async (t) => {
  setPlatform(t, 'darwin');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spawn = hangingSpawn();
  const engine = new OcrEngine({ dataDir: setup(t), spawn, exec: fakeExec() });
  const pending = engine.recognize(FIXTURE);
  await until(() => spawn.calls.length === 1);
  t.mock.timers.tick(60 * 1000);
  await assert.rejects(pending, /timed out after 60 s/);
  assert.equal(spawn.killed, 1);
});

test('swiftc is compiled with a 180 s timeout', async (t) => {
  setPlatform(t, 'darwin');
  const exec = fakeExec();
  const engine = new OcrEngine({ dataDir: setup(t), spawn: succeedingSpawn(helperJson), exec });
  await engine.recognize(FIXTURE);
  assert.equal(exec.calls[0].options.timeout, 180 * 1000);
});

test('two concurrent recognize calls compile the helper once and leave no temp file', async (t) => {
  setPlatform(t, 'darwin');
  const dataDir = setup(t);
  const exec = fakeExec();
  const engine = new OcrEngine({ dataDir, spawn: succeedingSpawn(helperJson), exec });
  const [first, second] = await Promise.all([engine.recognize(FIXTURE), engine.recognize(FIXTURE)]);
  assert.equal(exec.calls.length, 1);
  assert.deepEqual(first, second);
  const leftovers = fs.readdirSync(path.join(dataDir, 'bin')).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});
