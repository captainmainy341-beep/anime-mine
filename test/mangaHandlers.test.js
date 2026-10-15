const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync } = require('fflate');
const { createMangaHandlers } = require('../src/main/mangaHandlers');
const { MangaLibrary } = require('../src/core/manga');

const dirs = [];

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NO_TEXT = 'No text found on this page';

function makeLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-root-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-data-'));
  dirs.push(root, dataDir);
  const volA = path.join(root, 'Series A', 'Vol 1');
  fs.mkdirSync(volA, { recursive: true });
  fs.writeFileSync(path.join(volA, '001.jpg'), JPEG);
  fs.writeFileSync(path.join(volA, '002.jpg'), JPEG);
  fs.mkdirSync(path.join(root, 'Series B'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Series B', 'Vol 2.cbz'), Buffer.from(zipSync({ '001.png': PNG })));
  const library = new MangaLibrary(dataDir);
  library.addFolder(root);
  const series = library.scan();
  const [seriesA, seriesB] = series;
  return {
    root,
    dataDir,
    seriesA: { id: seriesA.id, title: seriesA.title, volId: seriesA.volumes[0].id, volTitle: seriesA.volumes[0].title },
    seriesB: { id: seriesB.id, title: seriesB.title, volId: seriesB.volumes[0].id, volTitle: seriesB.volumes[0].title },
  };
}

function makeEngine(script) {
  return class FakeOcrEngine {
    constructor(options) {
      script.engineOptions.push(options);
    }

    async recognize(input, { cacheKey } = {}) {
      script.recognized.push({ cacheKey, input: typeof input === 'string' ? path.basename(input) : 'bytes' });
      return script.vision(input);
    }

    readCache(key) {
      return script.cache.get(key) ?? null;
    }

    writeCache(key, value) {
      script.written.push(key);
      script.cache.set(key, value);
    }
  };
}

const pageVision = (input) => ({
  width: 100,
  height: 200,
  blocks: [{ text: `ページ${typeof input === 'string' ? path.basename(input, '.jpg') : 'x'}`, box: { x: 0, y: 0, w: 1, h: 1 }, vertical: false, confidence: 1 }],
});

function setup({ aiOcr = false, apiKey = 'sk-test', vision = pageVision, aiRecognize, dialogResult = { canceled: true, filePaths: [] } } = {}) {
  const lib = makeLibrary();
  const settings = { manga: { aiOcr }, ai: { provider: 'anthropic', apiKey, model: 'm' }, ankiDeck: 'Anime Mining' };
  const script = {
    engineOptions: [],
    recognized: [],
    cache: new Map(),
    written: [],
    vision,
    aiCalls: [],
    cards: [],
    works: [],
    notified: [],
    dialogCalls: [],
  };
  const dialog = {
    async showOpenDialog(options) {
      script.dialogCalls.push(options);
      return dialogResult;
    },
  };
  const corpus = {
    saves: 0,
    async addWork(work, sentences) {
      script.works.push({ work, sentences });
    },
    save() {
      this.saves += 1;
    },
  };
  const { handlers, stop } = createMangaHandlers({
    dataDir: lib.dataDir,
    dialog,
    getSettings: async () => settings,
    tokenize: async () => [],
    corpus,
    notify: (channel, payload) => script.notified.push({ channel, payload }),
    mineCard: async (card) => {
      script.cards.push(card);
      return { noteId: 7 };
    },
    deps: {
      OcrEngine: makeEngine(script),
      aiRecognize: aiRecognize ?? (async (...args) => {
        script.aiCalls.push(args);
        throw new Error('unexpected AI call');
      }),
    },
  });
  return { ...lib, script, settings, dialog, handlers, stop, call: (channel, ...args) => handlers[channel](...args) };
}

const page = (ctx, index = 0, which = ctx.seriesA) => ({ seriesId: which.id, volId: which.volId, index });

test('getSeries and getFolders list the configured library', async () => {
  const ctx = setup();
  const series = await ctx.call('manga:getSeries');
  assert.deepEqual(series.map((s) => s.title).sort(), ['Series A', 'Series B']);
  assert.deepEqual(await ctx.call('manga:getFolders'), [ctx.root]);
});

test('addFolder returns the current scan when the dialog is cancelled', async () => {
  const ctx = setup();
  const series = await ctx.call('manga:addFolder');
  assert.equal(series.length, 2);
  assert.deepEqual(ctx.script.dialogCalls, [{ properties: ['openDirectory'] }]);
});

test('addFolder adds the chosen directory and removeFolder drops it', async () => {
  const ctx = setup();
  const extra = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-extra-'));
  dirs.push(extra);
  fs.mkdirSync(path.join(extra, 'Series C', 'Vol 1'), { recursive: true });
  fs.writeFileSync(path.join(extra, 'Series C', 'Vol 1', '001.jpg'), JPEG);
  ctx.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [extra] });
  const added = await ctx.call('manga:addFolder');
  assert.ok(added.some((s) => s.title === 'Series C'));
  const removed = await ctx.call('manga:removeFolder', extra);
  assert.ok(!removed.some((s) => s.title === 'Series C'));
});

test('page returns a base64 data URL for directory and archive pages', async () => {
  const ctx = setup();
  const fromDir = await ctx.call('manga:page', page(ctx, 0));
  assert.equal(fromDir.mime, 'image/jpeg');
  assert.equal(fromDir.dataUrl, `data:image/jpeg;base64,${JPEG.toString('base64')}`);
  const fromArchive = await ctx.call('manga:page', page(ctx, 0, ctx.seriesB));
  assert.equal(fromArchive.dataUrl, `data:image/png;base64,${PNG.toString('base64')}`);
});

test('page rejects out-of-range indices and malformed ids', async () => {
  const ctx = setup();
  await assert.rejects(ctx.call('manga:page', page(ctx, 9)), /page out of range/);
  await assert.rejects(ctx.call('manga:page', { ...page(ctx), index: -1 }), /index must be a non-negative integer/);
  await assert.rejects(ctx.call('manga:page', { ...page(ctx), volId: 5 }), /volId must be a non-empty string/);
});

test('blocks reports vision output and caches it under the page key', async () => {
  const ctx = setup();
  const result = await ctx.call('manga:blocks', page(ctx));
  assert.equal(result.source, 'vision');
  assert.equal(result.width, 100);
  assert.equal(result.height, 200);
  assert.equal(result.blocks[0].text, 'ページ001');
  assert.equal(result.unavailable, undefined);
  assert.equal(ctx.script.recognized[0].input, '001.jpg');
  assert.equal(typeof ctx.script.recognized[0].cacheKey, 'string');
  assert.equal(ctx.script.aiCalls.length, 0);
});

test('blocks returns null dimensions when the engine omits them', async () => {
  const ctx = setup({ vision: () => ({ blocks: [{ text: 'ページ', box: { x: 0, y: 0, w: 1, h: 1 }, vertical: false, confidence: 1 }] }) });
  const result = await ctx.call('manga:blocks', page(ctx));
  assert.equal(result.width, null);
  assert.equal(result.height, null);
});

test('blocks reports unavailable instead of throwing when vision finds nothing and AI is off', async () => {
  const ctx = setup({ vision: () => ({ width: 10, height: 20, blocks: [] }) });
  const result = await ctx.call('manga:blocks', page(ctx));
  assert.deepEqual(result, { width: 10, height: 20, blocks: [], source: 'vision', unavailable: NO_TEXT });
  assert.equal(ctx.script.aiCalls.length, 0);
});

test('blocks reports the Vision reason when OCR is unavailable and AI is off', async () => {
  const ctx = setup({
    vision: () => {
      const error = new Error('live OCR requires macOS (Vision)');
      error.code = 'OCR_UNAVAILABLE';
      throw error;
    },
  });
  const result = await ctx.call('manga:blocks', page(ctx));
  assert.deepEqual(result, { width: null, height: null, blocks: [], source: 'vision', unavailable: 'live OCR requires macOS (Vision)' });
});

test('blocks falls back to AI when Vision fails and AI is enabled, caching under the -ai suffix', async () => {
  const aiBlocks = [{ text: 'AI文字', box: { x: 0, y: 0, w: 1, h: 1 }, vertical: false, confidence: 0.9 }];
  const calls = [];
  const ctx = setup({
    aiOcr: true,
    vision: () => {
      const error = new Error('no vision');
      error.code = 'OCR_UNAVAILABLE';
      throw error;
    },
    aiRecognize: async (ai, image, options) => {
      calls.push({ ai, image, options });
      return { width: 640, height: 480, blocks: aiBlocks };
    },
  });
  const first = await ctx.call('manga:blocks', page(ctx));
  assert.deepEqual(first, { width: 640, height: 480, blocks: aiBlocks, source: 'ai' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ai.apiKey, 'sk-test');
  assert.deepEqual(calls[0].image.bytes, JPEG);
  assert.equal(calls[0].image.mime, 'image/jpeg');
  const key = ctx.script.recognized[0].cacheKey;
  assert.deepEqual(ctx.script.written, [`${key}-ai`]);

  const second = await ctx.call('manga:blocks', page(ctx));
  assert.equal(second.source, 'ai');
  assert.equal(calls.length, 1, 'cached AI result is reused');
});

test('blocks falls back to AI when Vision finds zero blocks', async () => {
  const ctx = setup({
    aiOcr: true,
    vision: () => ({ width: 1, height: 1, blocks: [] }),
    aiRecognize: async () => ({ width: 1, height: 1, blocks: [{ text: '猫', box: { x: 0, y: 0, w: 1, h: 1 }, vertical: false, confidence: 1 }] }),
  });
  const result = await ctx.call('manga:blocks', page(ctx));
  assert.equal(result.source, 'ai');
  assert.equal(result.blocks[0].text, '猫');
});

test('blocks does not call AI without an API key', async () => {
  const ctx = setup({ aiOcr: true, apiKey: '', vision: () => ({ width: 1, height: 1, blocks: [] }) });
  const result = await ctx.call('manga:blocks', page(ctx));
  assert.equal(result.unavailable, NO_TEXT);
  assert.equal(ctx.script.aiCalls.length, 0);
});

test('blocks reports AI failures as unavailable', async () => {
  const ctx = setup({
    aiOcr: true,
    vision: () => ({ width: 1, height: 1, blocks: [] }),
    aiRecognize: async () => {
      throw new Error('rate limited');
    },
  });
  const result = await ctx.call('manga:blocks', page(ctx));
  assert.deepEqual(result, { width: 1, height: 1, blocks: [], source: 'vision', unavailable: 'AI OCR failed: rate limited' });
});

test('getProgress, setProgress and continue use the library progress file', async () => {
  const ctx = setup();
  assert.deepEqual(await ctx.call('manga:getProgress', ctx.seriesA.volId), { page: 0, direction: 'rtl', spread: false });
  assert.deepEqual(await ctx.call('manga:setProgress', { volId: ctx.seriesA.volId, page: 1, direction: 'ltr', spread: true }), { ok: true });
  const { updatedAt, ...saved } = await ctx.call('manga:getProgress', ctx.seriesA.volId);
  assert.ok(Number.isFinite(updatedAt));
  assert.deepEqual(saved, { page: 1, direction: 'ltr', spread: true });
  assert.deepEqual(await ctx.call('manga:continue'), { seriesId: ctx.seriesA.id, volId: ctx.seriesA.volId, page: 1 });
  assert.throws(() => ctx.call('manga:setProgress', { volId: ctx.seriesA.volId, page: 1, spread: 'yes' }), /spread must be a boolean/);
  assert.throws(() => ctx.call('manga:setProgress', { volId: ctx.seriesA.volId, page: -2 }), /page must be a non-negative integer/);
});

test('index OCRs every page in order, reports progress and adds one corpus work', async () => {
  const ctx = setup();
  const result = await ctx.call('manga:index', { seriesId: ctx.seriesA.id, volId: ctx.seriesA.volId });
  assert.deepEqual(result, { pages: 2, sentences: 2 });
  assert.deepEqual(ctx.script.recognized.map((r) => r.input), ['001.jpg', '002.jpg']);
  assert.deepEqual(
    ctx.script.notified.map((n) => n.payload),
    [
      { volId: ctx.seriesA.volId, done: 1, total: 2 },
      { volId: ctx.seriesA.volId, done: 2, total: 2 },
    ],
  );
  assert.ok(ctx.script.notified.every((n) => n.channel === 'manga:indexProgress'));
  assert.equal(ctx.script.works.length, 1);
  const { work, sentences } = ctx.script.works[0];
  assert.deepEqual(work, { id: `manga:${ctx.seriesA.volId}`, kind: 'manga', title: `Series A ${ctx.seriesA.volTitle}` });
  assert.deepEqual(sentences, ['ページ001', 'ページ002']);
});

test('index skips pages whose OCR returns nothing', async () => {
  const ctx = setup({ vision: (input) => ({ width: 1, height: 1, blocks: path.basename(input) === '001.jpg' ? [] : pageVision(input).blocks }) });
  const result = await ctx.call('manga:index', { seriesId: ctx.seriesA.id, volId: ctx.seriesA.volId });
  assert.deepEqual(result, { pages: 2, sentences: 1 });
  assert.deepEqual(ctx.script.works[0].sentences, ['ページ002']);
});

test('index for the same volume while running returns the running promise', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = setup({ vision: async (input) => {
    await gate;
    return pageVision(input);
  } });
  const req = { seriesId: ctx.seriesA.id, volId: ctx.seriesA.volId };
  const first = ctx.call('manga:index', req);
  const second = ctx.call('manga:index', req);
  release();
  assert.deepEqual(await first, await second);
  assert.equal(ctx.script.works.length, 1);
});

test('cancelIndex stops indexing before the corpus is written', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = setup({ vision: async (input) => {
    await gate;
    return pageVision(input);
  } });
  const running = ctx.call('manga:index', { seriesId: ctx.seriesA.id, volId: ctx.seriesA.volId });
  await ctx.call('manga:cancelIndex', ctx.seriesA.volId);
  release();
  assert.deepEqual(await running, { cancelled: true });
  assert.equal(ctx.script.works.length, 0);
});

test('stop aborts running index jobs', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = setup({ vision: async (input) => {
    await gate;
    return pageVision(input);
  } });
  const running = ctx.call('manga:index', { seriesId: ctx.seriesA.id, volId: ctx.seriesA.volId });
  ctx.stop();
  release();
  assert.deepEqual(await running, { cancelled: true });
  assert.equal(ctx.script.works.length, 0);
});

test('mine passes a sentence card with a jpeg picture to mineCard', async () => {
  const ctx = setup();
  const picture = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
  const result = await ctx.call('manga:mine', { ...page(ctx), sentence: 'ページ001', word: null, picture });
  assert.deepEqual(result, { noteId: 7 });
  assert.equal(ctx.script.cards.length, 1);
  const card = ctx.script.cards[0];
  assert.equal(card.mode, 'sentence');
  assert.equal(card.word, null);
  assert.equal(card.sentence, 'ページ001');
  assert.equal(card.sourceTitle, 'Series A');
  assert.equal(card.picture.ext, 'jpg');
  assert.ok(Buffer.isBuffer(card.picture.data));
  assert.deepEqual(card.picture.data, JPEG);
});

test('mine passes word mode and a png picture through', async () => {
  const ctx = setup();
  const picture = `data:image/png;base64,${PNG.toString('base64')}`;
  await ctx.call('manga:mine', {
    ...page(ctx, 0, ctx.seriesB),
    sentence: 'ページ',
    word: { base: '猫', surface: '猫', reading: 'ねこ' },
    meaning: 'cat',
    translation: 'The cat.',
    picture,
  });
  const card = ctx.script.cards[0];
  assert.equal(card.mode, 'word');
  assert.deepEqual(card.word, { base: '猫', surface: '猫', reading: 'ねこ' });
  assert.equal(card.meaning, 'cat');
  assert.equal(card.translation, 'The cat.');
  assert.equal(card.sourceTitle, 'Series B');
  assert.equal(card.picture.ext, 'png');
});

test('mine rejects pictures that are not jpeg or png data URLs, mismatched, or too large', async () => {
  const ctx = setup();
  const base = { ...page(ctx), sentence: 'ページ001' };
  await assert.rejects(ctx.call('manga:mine', { ...base, picture: 'https://example.com/a.jpg' }), /jpeg or png data URL/);
  await assert.rejects(ctx.call('manga:mine', { ...base, picture: `data:image/gif;base64,${JPEG.toString('base64')}` }), /jpeg or png data URL/);
  await assert.rejects(ctx.call('manga:mine', { ...base, picture: `data:image/png;base64,${JPEG.toString('base64')}` }), /does not match its type/);
  const big = Buffer.alloc(6 * 1024 * 1024 + 1, 0xff);
  big[0] = 0xff;
  big[1] = 0xd8;
  big[2] = 0xff;
  await assert.rejects(ctx.call('manga:mine', { ...base, picture: `data:image/jpeg;base64,${big.toString('base64')}` }), /at most 6 MB/);
  assert.equal(ctx.script.cards.length, 0);
});

test('mine validates the sentence and word', async () => {
  const ctx = setup();
  await assert.rejects(ctx.call('manga:mine', { ...page(ctx), sentence: '   ' }), /sentence is required/);
  await assert.rejects(ctx.call('manga:mine', { ...page(ctx), sentence: 'x', word: { base: '', surface: '' } }), /word.base is required/);
  await assert.rejects(ctx.call('manga:mine', { ...page(ctx), sentence: 'x', word: 'cat' }), /word must be an object/);
  assert.equal(ctx.script.cards.length, 0);
});

test('mine without a picture still calls mineCard', async () => {
  const ctx = setup();
  await ctx.call('manga:mine', { ...page(ctx), sentence: 'ページ001' });
  assert.equal(ctx.script.cards[0].picture, null);
});
