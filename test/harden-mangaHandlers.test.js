const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMangaHandlers } = require('../src/main/mangaHandlers');
const { MangaLibrary } = require('../src/core/manga');

const dirs = [];

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function until(condition) {
  return (async () => {
    while (!condition()) await new Promise((resolve) => setImmediate(resolve));
  })();
}

function neverUntilAborted(signal) {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function setup({ aiOcr = false, hangAi = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-index-root-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-index-data-'));
  dirs.push(root, dataDir);
  fs.mkdirSync(path.join(root, 'Series', 'Vol 1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Series', 'Vol 1', '001.jpg'), JPEG);
  fs.writeFileSync(path.join(root, 'Series', 'Vol 1', '002.jpg'), JPEG);
  const library = new MangaLibrary(dataDir);
  library.addFolder(root);
  const [series] = library.scan();
  const volume = series.volumes[0];

  const script = { recognizeSignals: [], aiSignals: [], works: [], cache: new Map() };

  class HangingEngine {
    recognize(input, { signal } = {}) {
      script.recognizeSignals.push(signal);
      return neverUntilAborted(signal);
    }

    readCache(key) {
      return script.cache.get(key) ?? null;
    }

    writeCache(key, value) {
      script.cache.set(key, value);
    }
  }

  class EmptyVisionEngine extends HangingEngine {
    recognize(input, { signal } = {}) {
      script.recognizeSignals.push(signal);
      return Promise.resolve({ width: 1, height: 1, blocks: [] });
    }
  }

  const aiRecognize = async (settings, image, { signal }) => {
    script.aiSignals.push(signal);
    return neverUntilAborted(signal);
  };

  const { handlers, stop } = createMangaHandlers({
    dataDir,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getSettings: async () => ({ manga: { aiOcr }, ai: { provider: 'anthropic', apiKey: 'sk-test-KEY12345', model: 'm' } }),
    tokenize: async () => [],
    corpus: { addWork: async (work, sentences) => script.works.push({ work, sentences }) },
    notify: () => {},
    mineCard: async () => ({ noteId: 1 }),
    deps: {
      OcrEngine: aiOcr && hangAi ? EmptyVisionEngine : HangingEngine,
      aiRecognize: hangAi ? aiRecognize : undefined,
    },
  });
  return { handlers, stop, script, req: { seriesId: series.id, volId: volume.id } };
}

test('cancelIndex aborts a volume whose OCR never returns and writes no corpus work', async () => {
  const ctx = setup();
  const pending = ctx.handlers['manga:index'](ctx.req);
  await until(() => ctx.script.recognizeSignals.length === 1);
  await ctx.handlers['manga:cancelIndex'](ctx.req.volId);
  assert.deepEqual(await pending, { cancelled: true });
  assert.equal(ctx.script.recognizeSignals[0].aborted, true);
  assert.equal(ctx.script.works.length, 0);
});

test('stop aborts running index jobs and frees the run so the volume can be indexed again', async () => {
  const ctx = setup();
  const first = ctx.handlers['manga:index'](ctx.req);
  await until(() => ctx.script.recognizeSignals.length === 1);
  ctx.stop();
  assert.deepEqual(await first, { cancelled: true });

  const second = ctx.handlers['manga:index'](ctx.req);
  await until(() => ctx.script.recognizeSignals.length === 2);
  assert.equal(ctx.script.recognizeSignals[1].aborted, false);
  ctx.stop();
  assert.deepEqual(await second, { cancelled: true });
});

test('cancelIndex also aborts an AI request that never returns', async () => {
  const ctx = setup({ aiOcr: true, hangAi: true });
  const pending = ctx.handlers['manga:index'](ctx.req);
  await until(() => ctx.script.aiSignals.length === 1);
  await ctx.handlers['manga:cancelIndex'](ctx.req.volId);
  assert.deepEqual(await pending, { cancelled: true });
  assert.equal(ctx.script.aiSignals[0].aborted, true);
  assert.equal(ctx.script.works.length, 0);
});

test('cancelling while the corpus tokenizes stops the job and commits nothing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-tok-root-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-tok-data-'));
  dirs.push(root, dataDir);
  fs.mkdirSync(path.join(root, 'S', 'V'), { recursive: true });
  fs.writeFileSync(path.join(root, 'S', 'V', '001.jpg'), JPEG);
  const library = new MangaLibrary(dataDir);
  library.addFolder(root);
  const [series] = library.scan();
  const volId = series.volumes[0].id;
  let committed = false;
  let enteredTokenize;
  const tokenizing = new Promise((resolve) => { enteredTokenize = resolve; });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  class Engine {
    recognize() {
      return Promise.resolve({ width: 1, height: 1, blocks: [{ text: '日本語のテスト', box: { x: 0, y: 0, w: 1, h: 1 }, vertical: false, confidence: 1 }, { text: 'もうひとつ', box: { x: 0, y: 0, w: 1, h: 1 }, vertical: false, confidence: 1 }] });
    }
    readCache() { return null; }
    writeCache() {}
  }
  const { handlers } = createMangaHandlers({
    dataDir,
    dialog: {},
    getSettings: async () => ({ manga: { aiOcr: false }, ai: {} }),
    tokenize: async () => { enteredTokenize(); await gate; return []; },
    corpus: {
      addWork: async (work, sentences, tokenize) => {
        for (const text of sentences) await tokenize(text);
        committed = true;
      },
    },
    notify: () => {},
    mineCard: async () => ({ noteId: 1 }),
    deps: { OcrEngine: Engine },
  });
  const pending = handlers['manga:index']({ seriesId: series.id, volId });
  await tokenizing;
  await handlers['manga:cancelIndex'](volId);
  release();
  assert.deepEqual(await pending, { cancelled: true });
  assert.equal(committed, false);
});
