const fsp = require('fs/promises');
const { MangaLibrary } = require('../core/manga');
const { OcrEngine, findMokuroSidecar } = require('../core/ocr');
const mangaText = require('../core/mangaText');

const ID_MAX = 200;
const TEXT_MAX = 2000;
const WORD_MAX = 100;
const MAX_PICTURE_BYTES = 6 * 1024 * 1024;
const PICTURE_PATTERN = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;
const PICTURE_SIGNATURE = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47] };
const PICTURE_EXT = { jpeg: 'jpg', png: 'png' };
const NO_TEXT = 'No text found on this page';

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertObject(value, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be an object`);
}

function assertId(value, name) {
  if (typeof value !== 'string' || value === '' || value.length > ID_MAX) throw new Error(`${name} must be a non-empty string`);
}

function assertIndex(value, name) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
}

function assertText(value, name, max = TEXT_MAX) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be text of at most ${max} characters`);
}

function optionalText(value, name, max = TEXT_MAX) {
  if (value !== undefined && value !== null) assertText(value, name, max);
}

function optionalBoolean(value, name) {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
}

function assertVolume(req) {
  assertObject(req, 'request');
  assertId(req.seriesId, 'seriesId');
  assertId(req.volId, 'volId');
}

function assertPage(req) {
  assertVolume(req);
  assertIndex(req.index, 'index');
}

function assertWord(word) {
  assertObject(word, 'word');
  assertText(word.base, 'word.base', WORD_MAX);
  if (word.base === '') throw new Error('word.base is required');
  assertText(word.surface, 'word.surface', WORD_MAX);
  optionalText(word.reading, 'word.reading', WORD_MAX);
}

function parsePicture(picture) {
  if (picture === undefined || picture === null) return null;
  const match = typeof picture === 'string' ? PICTURE_PATTERN.exec(picture) : null;
  if (!match) throw new Error('picture must be a jpeg or png data URL');
  const type = match[1];
  const data = Buffer.from(match[2], 'base64');
  if (data.length > MAX_PICTURE_BYTES) throw new Error('picture must be at most 6 MB');
  if (PICTURE_SIGNATURE[type].some((byte, i) => data[i] !== byte)) throw new Error('picture data does not match its type');
  return { ext: PICTURE_EXT[type], data };
}

function unavailable(message) {
  const error = new Error(message);
  error.code = 'OCR_UNAVAILABLE';
  return error;
}

function loadAiRecognize() {
  try {
    return require('../core/aiOcr').aiRecognize;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') return null;
    throw err;
  }
}

function createMangaHandlers({ dataDir, dialog, getSettings, tokenize, corpus, notify = () => {}, mineCard, deps = {} }) {
  const library = new (deps.MangaLibrary ?? MangaLibrary)(dataDir);
  const engine = new (deps.OcrEngine ?? OcrEngine)({ dataDir });
  const runs = new Map();

  function locate(seriesId, volId) {
    const series = library.scan().find((item) => item.id === seriesId);
    const volume = series?.volumes.find((item) => item.id === volId);
    if (!volume) throw new Error(`volume not found: ${seriesId}/${volId}`);
    return { series, volume };
  }

  async function pageBytes(page) {
    return page.kind === 'file' ? fsp.readFile(page.path) : page.data;
  }

  async function aiOcr(page, cacheKey, ai, signal) {
    const aiKey = `${cacheKey}-ai`;
    const cached = engine.readCache(aiKey);
    if (cached) return cached;
    const aiRecognize = deps.aiRecognize ?? loadAiRecognize();
    if (!aiRecognize) throw unavailable('AI OCR unavailable');
    const result = await aiRecognize(ai, { bytes: await pageBytes(page), mime: page.mime }, { fetchImpl: deps.fetchImpl, signal });
    engine.writeCache(aiKey, result);
    return result;
  }

  async function recognizePage(seriesId, volId, index, signal) {
    const cacheKey = library.pageKey(seriesId, volId, index);
    const page = library.readPage(seriesId, volId, index);
    const source = page.kind === 'file' && findMokuroSidecar(page.path) !== null ? 'mokuro' : 'vision';
    let vision = null;
    let reason = NO_TEXT;
    try {
      vision = await engine.recognize(page.kind === 'file' ? page.path : page.data, { cacheKey, signal });
    } catch (err) {
      if (err.code !== 'OCR_UNAVAILABLE') throw err;
      reason = err.message;
    }
    if (vision?.blocks.length) return { width: vision.width ?? null, height: vision.height ?? null, blocks: vision.blocks, source };

    const { manga, ai } = await getSettings();
    if (source === 'vision' && manga?.aiOcr === true && ai?.apiKey) {
      try {
        const result = await aiOcr(page, cacheKey, ai, signal);
        if (result.blocks.length) return { width: result.width ?? null, height: result.height ?? null, blocks: result.blocks, source: 'ai' };
      } catch (err) {
        if (signal?.aborted) throw err;
        reason = err.code === 'OCR_UNAVAILABLE' ? err.message : `AI OCR failed: ${err.message}`;
      }
    }
    return { width: vision?.width ?? null, height: vision?.height ?? null, blocks: [], source, unavailable: reason };
  }

  async function pageImage(req) {
    assertPage(req);
    const page = library.readPage(req.seriesId, req.volId, req.index);
    const data = await pageBytes(page);
    return { dataUrl: `data:${page.mime};base64,${data.toString('base64')}`, mime: page.mime };
  }

  async function indexVolume(seriesId, volId, signal) {
    const { series, volume } = locate(seriesId, volId);
    const sentences = [];
    try {
      for (let index = 0; index < volume.pageCount; index++) {
        if (signal.aborted) return { cancelled: true };
        const { blocks } = await recognizePage(seriesId, volId, index, signal);
        sentences.push(...mangaText.pageToSentences(blocks));
        notify('manga:indexProgress', { volId, done: index + 1, total: volume.pageCount });
      }
    } catch (err) {
      if (signal.aborted) return { cancelled: true };
      throw err;
    }
    if (signal.aborted) return { cancelled: true };
    await corpus.addWork({ id: `manga:${volId}`, kind: 'manga', title: `${series.title} ${volume.title}` }, sentences, async (text) => {
      if (signal.aborted) throw new Error('indexing cancelled');
      return tokenize(text);
    }).catch((err) => {
      if (signal.aborted) return { cancelled: true };
      throw err;
    });
    if (signal.aborted) return { cancelled: true };
    return { pages: volume.pageCount, sentences: sentences.length };
  }

  async function runIndex(seriesId, volId, run) {
    try {
      return await indexVolume(seriesId, volId, run.controller.signal);
    } finally {
      if (runs.get(volId) === run) runs.delete(volId);
    }
  }

  function index(req) {
    assertVolume(req);
    const { seriesId, volId } = req;
    if (runs.has(volId)) return runs.get(volId).promise;
    const run = { controller: new AbortController(), promise: null };
    run.promise = runIndex(seriesId, volId, run);
    runs.set(volId, run);
    return run.promise;
  }

  async function mine(req) {
    assertPage(req);
    const { seriesId, volId, index: pageIndex, sentence, word, meaning, translation, picture } = req;
    assertText(sentence, 'sentence');
    if (sentence.trim() === '') throw new Error('sentence is required');
    if (word !== undefined && word !== null) assertWord(word);
    optionalText(meaning, 'meaning');
    optionalText(translation, 'translation');
    const { series } = locate(seriesId, volId);
    library.pageKey(seriesId, volId, pageIndex);
    return mineCard({
      mode: word ? 'word' : 'sentence',
      word: word ?? null,
      meaning,
      translation,
      sentence,
      sourceTitle: series.title,
      picture: parsePicture(picture),
    });
  }

  async function addFolder() {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (!canceled && filePaths.length) library.addFolder(filePaths[0]);
    return library.scan();
  }

  function removeFolder(dir) {
    assertId(dir, 'dir');
    library.removeFolder(dir);
    return library.scan();
  }

  function setProgress(req) {
    assertObject(req, 'progress');
    assertId(req.volId, 'volId');
    assertIndex(req.page, 'page');
    optionalBoolean(req.spread, 'spread');
    library.setProgress(req.volId, { page: req.page, direction: req.direction, spread: req.spread });
    return { ok: true };
  }

  const handlers = {
    'manga:getSeries': () => library.scan(),
    'manga:getFolders': () => library.getFolders(),
    'manga:addFolder': addFolder,
    'manga:removeFolder': removeFolder,
    'manga:page': pageImage,
    'manga:blocks': (req) => {
      assertPage(req);
      return recognizePage(req.seriesId, req.volId, req.index);
    },
    'manga:getProgress': (volId) => {
      assertId(volId, 'volId');
      return library.getProgress(volId);
    },
    'manga:setProgress': setProgress,
    'manga:continue': () => library.continueReading(),
    'manga:index': index,
    'manga:cancelIndex': (volId) => {
      assertId(volId, 'volId');
      runs.get(volId)?.controller.abort();
      return { ok: true };
    },
    'manga:mine': mine,
  };

  function stop() {
    for (const { controller } of runs.values()) controller.abort();
    runs.clear();
  }

  return { handlers, stop };
}

module.exports = { createMangaHandlers };
