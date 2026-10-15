const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const { OcrEngine, importMokuro, findMokuroSidecar } = require('../src/core/ocr');

const FIXTURE = path.join(__dirname, 'fixtures', 'ocr-sample.png');
const hasSwiftc = process.platform === 'darwin' && spawnSync('which', ['swiftc']).status === 0;

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function setPlatform(t, value) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value });
  t.after(() => Object.defineProperty(process, 'platform', original));
}

function fakeSpawn(stdout, { code = 0, stderr = '' } = {}) {
  const spawn = (bin, args) => {
    spawn.calls.push({ bin, args });
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    setImmediate(() => {
      proc.stdout.emit('data', Buffer.from(stdout));
      proc.stderr.emit('data', Buffer.from(stderr));
      proc.emit('close', code);
    });
    return proc;
  };
  spawn.calls = [];
  return spawn;
}

function fakeExec(behavior = (file, args) => fs.writeFileSync(args.at(-1), 'binary')) {
  const exec = async (file, args) => {
    exec.calls.push({ file, args });
    return behavior(file, args);
  };
  exec.calls = [];
  return exec;
}

const helperJson = JSON.stringify({
  width: 100,
  height: 200,
  blocks: [
    { text: '右', box: { x: 0.7, y: 0.1, w: 0.1, h: 0.4 }, vertical: true, confidence: 0.9 },
    { text: '左', box: { x: 0.2, y: 0.1, w: 0.1, h: 0.4 }, vertical: true, confidence: 0.8 },
  ],
});

test('live Vision OCR reads Japanese text from the fixture', { skip: !hasSwiftc && 'requires macOS with swiftc' }, async t => {
  const engine = new OcrEngine({ dataDir: setup(t) });
  const result = await engine.recognize(FIXTURE);
  const text = result.blocks.map(block => block.text).join('');
  assert.ok(text.includes('日本語'), `recognized: ${text}`);
  assert.equal(result.width, 1200);
  assert.equal(result.height, 300);
  for (const block of result.blocks) {
    for (const value of Object.values(block.box)) assert.ok(value >= 0 && value <= 1);
  }
});

test('live OCR accepts image bytes as well as a path', { skip: !hasSwiftc && 'requires macOS with swiftc' }, async t => {
  const engine = new OcrEngine({ dataDir: setup(t) });
  const result = await engine.recognize(fs.readFileSync(FIXTURE));
  assert.ok(result.blocks.map(block => block.text).join('').includes('日本語'));
});

test('recognize throws OCR_UNAVAILABLE off macOS', async t => {
  setPlatform(t, 'linux');
  const spawn = fakeSpawn(helperJson);
  const engine = new OcrEngine({ dataDir: setup(t), spawn, exec: fakeExec() });
  await assert.rejects(engine.recognize(FIXTURE), error => error.code === 'OCR_UNAVAILABLE');
  assert.equal(spawn.calls.length, 0);
});

test('recognize throws OCR_UNAVAILABLE when swiftc is missing', async t => {
  setPlatform(t, 'darwin');
  const missing = Object.assign(new Error('spawn swiftc ENOENT'), { code: 'ENOENT' });
  const engine = new OcrEngine({ dataDir: setup(t), spawn: fakeSpawn(helperJson), exec: fakeExec(() => Promise.reject(missing)) });
  await assert.rejects(engine.recognize(FIXTURE), error => error.code === 'OCR_UNAVAILABLE' && /swiftc/.test(error.message));
});

test('the helper is compiled once and reused until the source changes', async t => {
  setPlatform(t, 'darwin');
  const dataDir = setup(t);
  const exec = fakeExec();
  const spawn = fakeSpawn(helperJson);
  const engine = new OcrEngine({ dataDir, spawn, exec });
  await engine.recognize(FIXTURE);
  await engine.recognize(FIXTURE);

  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].file, 'swiftc');
  assert.ok(exec.calls[0].args.includes('-O'));
  assert.equal(spawn.calls.length, 2);
  assert.equal(spawn.calls[0].bin, path.join(dataDir, 'bin', 'mac-ocr'));
  assert.equal(spawn.calls[0].args[0], FIXTURE);
  assert.ok(fs.existsSync(path.join(dataDir, 'bin', 'mac-ocr.sha1')));
});

test('live results are reordered into manga reading order and cached by cacheKey', async t => {
  setPlatform(t, 'darwin');
  const dataDir = setup(t);
  const spawn = fakeSpawn(helperJson);
  const engine = new OcrEngine({ dataDir, spawn, exec: fakeExec() });

  const first = await engine.recognize(FIXTURE, { cacheKey: 'page-a' });
  assert.deepEqual(first.blocks.map(block => block.text), ['右', '左']);
  assert.ok(fs.existsSync(path.join(dataDir, 'manga-ocr-v2', 'page-a.json')));

  const second = await engine.recognize(FIXTURE, { cacheKey: 'page-a' });
  assert.deepEqual(second, first);
  assert.equal(spawn.calls.length, 1);
});

test('recognize rejects a cacheKey that is not a plain file name', async t => {
  const engine = new OcrEngine({ dataDir: setup(t) });
  await assert.rejects(engine.recognize(FIXTURE, { cacheKey: '../escape' }), /invalid cacheKey/);
});

test('importMokuro converts pixel boxes to fractions and joins lines', () => {
  const result = importMokuro({
    img_width: 200,
    img_height: 400,
    blocks: [
      { box: [20, 40, 60, 240], vertical: true, font_size: 12, lines: ['猫', 'が'] },
      { box: [120, 40, 180, 80], vertical: false, font_size: 12, lines: ['犬'] },
    ],
  });
  assert.equal(result.width, 200);
  assert.equal(result.height, 400);
  assert.deepEqual(result.blocks.map(block => block.text), ['猫が', '犬']);
  assert.deepEqual(result.blocks[0].box, { x: 0.1, y: 0.1, w: 0.2, h: 0.5 });
  assert.equal(result.blocks[0].vertical, true);
  assert.equal(result.blocks[1].vertical, false);
});

test('findMokuroSidecar checks the page next to the image and the mokuro _ocr layout', async t => {
  const root = setup(t);
  const series = path.join(root, 'Series');
  const volume = path.join(series, 'Vol 1');
  fs.mkdirSync(volume, { recursive: true });
  const image = path.join(volume, '001.jpg');
  fs.writeFileSync(image, 'x');
  assert.equal(findMokuroSidecar(image), null);

  const above = path.join(series, '_ocr', 'Vol 1', '001.json');
  fs.mkdirSync(path.dirname(above), { recursive: true });
  fs.writeFileSync(above, '{}');
  assert.equal(findMokuroSidecar(image), above);

  const beside = path.join(volume, '001.json');
  fs.writeFileSync(beside, '{}');
  assert.equal(findMokuroSidecar(image), beside);
});

test('a mokuro sidecar wins over live OCR and skips the helper entirely', async t => {
  setPlatform(t, 'darwin');
  const root = setup(t);
  const image = path.join(root, 'page.jpg');
  fs.writeFileSync(image, 'x');
  fs.writeFileSync(path.join(root, 'page.json'), JSON.stringify({
    img_width: 10,
    img_height: 10,
    blocks: [{ box: [1, 1, 5, 5], vertical: false, font_size: 4, lines: ['sidecar'] }],
  }));
  const spawn = fakeSpawn(helperJson);
  const engine = new OcrEngine({ dataDir: path.join(root, 'data'), spawn, exec: fakeExec() });

  const result = await engine.recognize(image, { cacheKey: 'sidecar-page' });
  assert.deepEqual(result.blocks.map(block => block.text), ['sidecar']);
  assert.equal(spawn.calls.length, 0);
});
