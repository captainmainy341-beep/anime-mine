const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt'];
const SETTINGS_MODE = 0o600;
const MAX_CUE_SECONDS = 120;
const MAX_PAD_SECONDS = 5;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function defaultSettings() {
  return {
    downloadsDir: path.join(os.homedir(), 'Downloads'),
    ankiUrl: 'http://127.0.0.1:8765',
    ankiDeck: 'Anime Mining',
    ankiModel: 'AnimeMine',
    audioPadStart: 0.15,
    audioPadEnd: 0.25,
    ai: { provider: 'anthropic', apiKey: '', model: 'claude-haiku-4-5-20251001', baseUrl: '' },
  };
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

async function readSettings(file) {
  try {
    return deepMerge(defaultSettings(), JSON.parse(await fs.readFile(file, 'utf8')));
  } catch (err) {
    if (err.code === 'ENOENT') return defaultSettings();
    throw err;
  }
}

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

const toBreaks = (html) => html.replace(/\r?\n/g, '<br>');

const clampPad = (value) => Math.min(MAX_PAD_SECONDS, Math.max(0, Number.isFinite(value) ? value : 0));

function highlight(html, surface) {
  const index = surface ? html.indexOf(surface) : -1;
  if (index < 0) return html;
  return `${html.slice(0, index)}<b>${surface}</b>${html.slice(index + surface.length)}`;
}

function buildFields({ mode, word, meaning, translation, cue, videoPath }) {
  const shared = {
    SentenceTranslation: toBreaks(escapeHtml(translation)),
    Notes: '',
    Source: escapeHtml(path.basename(videoPath, path.extname(videoPath))),
  };
  if (mode !== 'word') {
    return {
      ...shared,
      Word: escapeHtml(cue.text),
      Reading: '',
      Meaning: '',
      Sentence: toBreaks(escapeHtml(cue.text)),
    };
  }
  return {
    ...shared,
    Word: escapeHtml(word.base),
    Reading: escapeHtml(word.reading || word.base),
    Meaning: toBreaks(escapeHtml(meaning)),
    Sentence: toBreaks(highlight(escapeHtml(cue.text), escapeHtml(word.surface))),
  };
}

function assertMineInput(videoPath, cue) {
  if (typeof videoPath !== 'string' || videoPath.trim() === '') {
    throw new Error('videoPath must be a non-empty string');
  }
  if (!cue || !Number.isFinite(cue.start) || !Number.isFinite(cue.end)) {
    throw new Error('cue.start and cue.end must be finite numbers');
  }
  if (cue.start < 0 || cue.end <= cue.start) {
    throw new Error('cue must satisfy 0 <= start < end');
  }
  if (cue.end - cue.start > MAX_CUE_SECONDS) {
    throw new Error(`cue must be at most ${MAX_CUE_SECONDS} seconds long`);
  }
}

function createServices({ dataDir, dialog, deps = {}, notify = () => {} }) {
  const Library = deps.Library || require('../core/library').Library;
  const Dictionary = deps.Dictionary || require('../core/dictionary').Dictionary;
  const AnkiClient = deps.AnkiClient || require('../core/anki').AnkiClient;
  const library = new Library(dataDir);
  const dictionary = new Dictionary(dataDir);
  const settingsFile = path.join(dataDir, 'settings.json');
  let settings = null;
  let unwatch = null;

  const tokenize = (text) => (deps.tokenize || require('../core/tokenizer').tokenize)(text);
  const explain = (ai, req) => (deps.explain || require('../core/ai').explain)(ai, req);
  const parseSubtitleFile = (file) => (deps.parseSubtitleFile || require('../core/subtitles').parseSubtitleFile)(file);
  const media = () => deps.media || require('../core/media');

  async function getSettings() {
    settings ??= await readSettings(settingsFile);
    return settings;
  }

  function stop() {
    unwatch?.();
    unwatch = null;
  }

  async function start() {
    stop();
    const { downloadsDir } = await getSettings();
    unwatch = library.watchDownloads(downloadsDir, (episode, subtitlePath) =>
      notify('library:updated', {
        message: `Linked ${path.basename(subtitlePath)} to ${episode.name}`,
        videoPath: episode.path,
      }),
    );
  }

  async function addFolder() {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (!canceled && filePaths.length) await library.addFolder(filePaths[0]);
    return library.scan();
  }

  async function removeFolder(dir) {
    await library.removeFolder(dir);
    return library.scan();
  }

  async function linkSubtitle(videoPath) {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: SUBTITLE_EXTENSIONS }],
    });
    if (canceled || !filePaths.length) return null;
    return library.linkSubtitle(videoPath, filePaths[0]);
  }

  async function loadCues(videoPath) {
    const subtitlePath = await library.getSubtitle(videoPath);
    if (!subtitlePath) return { cues: [], subtitlePath: null };
    return { cues: await parseSubtitleFile(subtitlePath), subtitlePath };
  }

  async function downloadDictionary() {
    await dictionary.download((fraction) => notify('dict:progress', fraction));
    return { ready: true };
  }

  async function lookup(token) {
    if (!dictionary.isReady()) return [];
    await dictionary.load();
    return dictionary.lookup(token);
  }

  async function ankiStatus() {
    const { ankiUrl, ankiDeck, ankiModel } = await getSettings();
    const connected = await new AnkiClient(ankiUrl).ping().catch(() => false);
    return { connected, deck: ankiDeck, model: ankiModel };
  }

  async function mine({ videoPath, cue, mode, word, meaning, translation }) {
    assertMineInput(videoPath, cue);
    if (mode === 'word' && !word) throw new Error('Word mining needs a word');
    const { ankiUrl, ankiDeck, ankiModel, audioPadStart, audioPadEnd } = await getSettings();
    const stamp = Date.now();
    const audio = await media().extractAudio({
      video: videoPath,
      start: cue.start,
      end: cue.end,
      padStart: clampPad(audioPadStart),
      padEnd: clampPad(audioPadEnd),
    });
    const picture = await media().screenshot({ video: videoPath, time: (cue.start + cue.end) / 2 });
    const anki = new AnkiClient(ankiUrl);
    await anki.ensureSetup(ankiDeck, ankiModel);
    const noteId = await anki.addCard({
      deck: ankiDeck,
      model: ankiModel,
      fields: buildFields({ mode, word, meaning, translation, cue, videoPath }),
      audio: { filename: `am_${stamp}.mp3`, data: audio },
      picture: { filename: `am_${stamp}.jpg`, data: picture },
    });
    return { noteId };
  }

  async function setSettings(patch) {
    const previous = await getSettings();
    const next = deepMerge(previous, patch);
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(settingsFile, JSON.stringify(next, null, 2), { mode: SETTINGS_MODE });
    await fs.chmod(settingsFile, SETTINGS_MODE);
    settings = next;
    if (next.downloadsDir !== previous.downloadsDir) await start();
    return next;
  }

  const handlers = {
    'library:getShows': () => library.scan(),
    'library:getFolders': () => library.getFolders(),
    'library:addFolder': addFolder,
    'library:removeFolder': removeFolder,
    'library:linkSubtitle': linkSubtitle,
    'player:loadCues': loadCues,
    'nlp:tokenize': tokenize,
    'dict:status': () => ({ ready: dictionary.isReady() }),
    'dict:download': downloadDictionary,
    'dict:lookup': lookup,
    'ai:explain': async (req) => explain((await getSettings()).ai, req),
    'anki:status': ankiStatus,
    'anki:mine': mine,
    'settings:get': getSettings,
    'settings:set': setSettings,
  };

  return { handlers, start, stop };
}

module.exports = { createServices };
