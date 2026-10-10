const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const ankiBrowse = require('../core/ankiBrowse');
const { SampleBrowser } = require('../core/ankiSample');
const { createFeatureHandlers, assertMineInput, assertContext, clampPad, optionalIndex } = require('./features');

const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt'];
const SETTINGS_MODE = 0o600;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ANKI_MODES = ['hidden', 'sample', 'live'];

function defaultSettings() {
  return {
    downloadsDir: path.join(os.homedir(), 'Downloads'),
    ankiUrl: 'http://127.0.0.1:8765',
    ankiDeck: 'Anime Mining',
    ankiModel: 'AnimeMine',
    ankiView: 'hidden',
    ankiVisibleDecks: [],
    audioPadStart: 0.15,
    audioPadEnd: 0.25,
    ai: { provider: 'anthropic', apiKey: '', model: 'claude-haiku-4-5-20251001', baseUrl: '' },
    autoTranslate: true,
    highlightUnknown: true,
    showFurigana: false,
    autoPause: false,
    quickMine: false,
    knownDeck: '',
    knownField: '',
    knownMatureOnly: false,
    loopLine: false,
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

const hasText = (value) => typeof value === 'string' && value.trim() !== '';

const MINE_FIELD_ESCAPES = {
  Word: escapeHtml,
  Reading: escapeHtml,
  Meaning: (text) => toBreaks(escapeHtml(text)),
  SentenceTranslation: (text) => toBreaks(escapeHtml(text)),
  Notes: (text) => toBreaks(escapeHtml(text)),
};

// Optional field overrides from the mining form: plain text in, field HTML out, same as generated fields.
function mineFields(fields) {
  if (fields === undefined || fields === null) return {};
  if (!isPlainObject(fields)) throw new Error('fields must be an object');
  const unknown = Object.keys(fields).filter((key) => !Object.hasOwn(MINE_FIELD_ESCAPES, key));
  if (unknown.length) throw new Error(`Cannot set field(s): ${unknown.join(', ')}`);
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (typeof value !== 'string') throw new Error(`${key} must be a string`);
      return [key, MINE_FIELD_ESCAPES[key](value)];
    }),
  );
}

const RECENT_LIMIT = 30;
const MAX_RECENT_LIMIT = 100;
const EDITABLE_NOTE_FIELDS = ['Meaning', 'SentenceTranslation', 'Notes'];

const clampRecentLimit = (limit) => {
  const n = Number.isFinite(limit) ? Math.floor(limit) : RECENT_LIMIT;
  return Math.min(MAX_RECENT_LIMIT, Math.max(1, n));
};

const assertNoteId = (noteId) => {
  if (!Number.isInteger(noteId) || noteId <= 0) throw new Error('noteId must be a positive integer');
};

// Plain-text values from the UI become safe field HTML; only the editable fields are accepted.
function editableFields(fields) {
  if (!isPlainObject(fields)) throw new Error('fields must be an object');
  const unknown = Object.keys(fields).filter((key) => !EDITABLE_NOTE_FIELDS.includes(key));
  if (unknown.length) throw new Error(`Cannot edit field(s): ${unknown.join(', ')}`);
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (typeof value !== 'string') throw new Error(`${key} must be a string`);
      return [key, toBreaks(escapeHtml(value))];
    }),
  );
}

const soundFile = (text) => /\[sound:([^\]]+)\]/.exec(text)?.[1] ?? null;
const imageFile = (text) => /<img[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(text)?.[1] ?? null;

// Raw field values as stored; the renderer decides how to display them.
function toRecentCard(note) {
  const fields = note.fields ?? {};
  const value = (name) => fields[name]?.value ?? '';
  return {
    noteId: note.noteId,
    created: note.noteId,
    word: value('Word'),
    reading: value('Reading'),
    meaning: value('Meaning'),
    sentence: value('Sentence'),
    translation: value('SentenceTranslation'),
    notes: value('Notes'),
    source: value('Source'),
    audio: soundFile(value('Audio')),
    picture: imageFile(value('Picture')),
    isSentenceCard: value('Reading').trim() === '',
  };
}

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

function createServices({ dataDir, dialog, deps = {}, notify = () => {} }) {
  const Library = deps.Library || require('../core/library').Library;
  const Dictionary = deps.Dictionary || require('../core/dictionary').Dictionary;
  const AnkiClient = deps.AnkiClient || require('../core/anki').AnkiClient;
  const AnkiBrowser = deps.AnkiBrowser || ankiBrowse.AnkiBrowser;
  const sampleBrowser = new SampleBrowser();
  const library = new Library(dataDir);
  const dictionary = new Dictionary(dataDir);
  const settingsFile = path.join(dataDir, 'settings.json');
  let settings = null;
  let unwatch = null;

  const tokenize = (text) => (deps.tokenize || require('../core/tokenizer').tokenize)(text);
  const explain = (ai, req) => (deps.explain || require('../core/ai').explain)(ai, req);
  const translate = (ai, req) => (deps.translate || require('../core/ai').translate)(ai, req);
  const media = () => deps.media || require('../core/media');
  const features = createFeatureHandlers({
    dataDir,
    getSettings,
    library,
    dictionary,
    tokenize,
    notify,
    deps,
  });

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

  // Normalised Anki view settings; anything unrecognised falls back to hidden / no decks.
  async function ankiSettings() {
    const { ankiView, ankiUrl, ankiModel, ankiVisibleDecks } = await getSettings();
    const visibleDecks = Array.isArray(ankiVisibleDecks)
      ? ankiVisibleDecks.filter((name) => typeof name === 'string')
      : [];
    return { mode: ANKI_MODES.includes(ankiView) ? ankiView : 'hidden', ankiUrl, ankiModel, visibleDecks };
  }

  // Only called for 'live' or 'sample'; hidden never reaches AnkiConnect.
  const ankiSource = (mode, ankiUrl) =>
    mode === 'live' ? new AnkiBrowser(new AnkiClient(ankiUrl)) : sampleBrowser;

  async function getAnkiView() {
    const { mode, ankiUrl, visibleDecks } = await ankiSettings();
    const connected = mode === 'live' && (await new AnkiClient(ankiUrl).ping().catch(() => false));
    return { mode, connected, visibleDecks };
  }

  async function setAnkiView(req) {
    const { mode, visibleDecks } = req ?? {};
    if (mode !== undefined && !ANKI_MODES.includes(mode)) {
      throw new Error(`mode must be one of ${ANKI_MODES.join(', ')}`);
    }
    if (visibleDecks !== undefined && !(Array.isArray(visibleDecks) && visibleDecks.every((name) => typeof name === 'string'))) {
      throw new Error('visibleDecks must be an array of strings');
    }
    const patch = {};
    if (mode !== undefined) patch.ankiView = mode;
    if (visibleDecks !== undefined) patch.ankiVisibleDecks = visibleDecks;
    await setSettings(patch);
    servedMedia = new Set();
    return getAnkiView();
  }

  async function listAnkiDecks() {
    const { mode, ankiUrl } = await ankiSettings();
    if (mode === 'hidden') return [];
    return ankiSource(mode, ankiUrl).listDecks();
  }

  // Media is only served for filenames a visible card already exposed to the renderer.
  let servedMedia = new Set();
  const rememberMedia = (cards) => {
    for (const card of cards ?? []) for (const name of [card.audio, card.picture]) if (name) servedMedia.add(name);
  };

  async function getAnkiOverview() {
    const { mode, ankiUrl, ankiModel, visibleDecks } = await ankiSettings();
    if (mode === 'hidden') return { mode };
    const overview = await ankiSource(mode, ankiUrl).overview({ decks: visibleDecks, model: ankiModel });
    rememberMedia(overview.mined);
    return { mode, ...overview };
  }

  async function browseAnki(req) {
    const { mode, ankiUrl, visibleDecks } = await ankiSettings();
    if (mode === 'hidden') return { cards: [] };
    const { deck, query, state, limit } = req ?? {};
    if (mode === 'live' && !visibleDecks.includes(deck)) throw new Error('Deck is hidden');
    const result = await ankiSource(mode, ankiUrl).browse({ deck, query, state, limit });
    rememberMedia(result.cards);
    return result;
  }

  async function getAnkiMedia(filename) {
    ankiBrowse.assertMediaName(filename);
    const { mode, ankiUrl } = await ankiSettings();
    if (mode !== 'live' || !servedMedia.has(filename)) return null;
    return ankiSource(mode, ankiUrl).media(filename);
  }

  async function mine({ videoPath, cue, mode, word, meaning, translation, audioStreamIndex, context, fields, timing }) {
    assertMineInput(videoPath, cue);
    if (timing !== undefined) assertMineInput(videoPath, timing);
    if (mode === 'word' && !word) throw new Error('Word mining needs a word');
    const audioStream = optionalIndex(audioStreamIndex, 'audioStreamIndex');
    const sentenceContext = assertContext(context);
    const overrides = mineFields(fields);
    const clip = timing ?? cue;
    const { ankiUrl, ankiDeck, ankiModel, audioPadStart, audioPadEnd, ai, autoTranslate } = await getSettings();
    const wantsMachine = !hasText(translation) && !hasText(overrides.SentenceTranslation);
    let machineTranslation;
    if (wantsMachine && autoTranslate && ai?.apiKey) {
      try {
        machineTranslation = await translate(ai, { sentence: cue.text, context: sentenceContext.join('\n') });
      } catch {
        machineTranslation = undefined;
      }
    }
    const stamp = Date.now();
    const audio = await media().extractAudio({
      video: videoPath,
      start: clip.start,
      end: clip.end,
      padStart: clampPad(audioPadStart),
      padEnd: clampPad(audioPadEnd),
      ...(audioStream === undefined ? {} : { audioStream }),
    });
    const picture = await media().screenshot({ video: videoPath, time: (cue.start + cue.end) / 2 });
    const anki = new AnkiClient(ankiUrl);
    await anki.ensureSetup(ankiDeck, ankiModel);
    const generated = buildFields({ mode, word, meaning, translation: translation || machineTranslation, cue, videoPath });
    let noteId;
    try {
      noteId = await anki.addCard({
        deck: ankiDeck,
        model: ankiModel,
        fields: { ...generated, ...overrides },
        audio: { filename: `am_${stamp}.mp3`, data: audio },
        picture: { filename: `am_${stamp}.jpg`, data: picture },
      });
    } catch (err) {
      if (/duplicate/i.test(err?.message ?? '')) throw new Error('Already in your deck');
      throw err;
    }
    if (mode === 'word') features.markMined(word);
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

  async function ankiSetup() {
    const { ankiUrl, ankiDeck, ankiModel } = await getSettings();
    const anki = new AnkiClient(ankiUrl);
    if (!(await anki.ping())) {
      throw new Error(`Cannot reach AnkiConnect at ${ankiUrl}. Is Anki running with AnkiConnect installed?`);
    }
    await anki.ensureSetup(ankiDeck, ankiModel);
    return { ok: true };
  }

  async function recentAnkiCards(limit) {
    const { ankiUrl, ankiDeck, ankiModel } = await getSettings();
    const notes = await new AnkiClient(ankiUrl).recentNotes(ankiDeck, ankiModel, clampRecentLimit(limit));
    return (notes ?? []).map(toRecentCard);
  }

  // Only notes of the configured model are touched; anything else is refused before any write.
  async function ownedAnkiNote(noteId) {
    assertNoteId(noteId);
    const { ankiUrl, ankiModel } = await getSettings();
    const anki = new AnkiClient(ankiUrl);
    if ((await anki.noteModel(noteId)) !== ankiModel) throw new Error('Not an anime-mine note');
    return anki;
  }

  async function updateAnkiNote(req) {
    const { noteId, fields } = req ?? {};
    assertNoteId(noteId);
    const updates = editableFields(fields);
    const anki = await ownedAnkiNote(noteId);
    await anki.updateNoteFields(noteId, updates);
    return { ok: true };
  }

  async function deleteAnkiNote(noteId) {
    const anki = await ownedAnkiNote(noteId);
    await anki.deleteNotes([noteId]);
    return { ok: true };
  }

  async function openAnkiNote(noteId) {
    const anki = await ownedAnkiNote(noteId);
    await anki.guiBrowse(`nid:${noteId}`);
    return { ok: true };
  }

  const handlers = {
    'library:getShows': () => library.scan(),
    'library:getFolders': () => library.getFolders(),
    'library:addFolder': addFolder,
    'library:removeFolder': removeFolder,
    'library:linkSubtitle': linkSubtitle,
    'nlp:tokenize': tokenize,
    'dict:status': () => ({ ready: dictionary.isReady() }),
    'dict:download': downloadDictionary,
    'dict:lookup': lookup,
    'ai:explain': async (req) => explain((await getSettings()).ai, req),
    'anki:status': ankiStatus,
    'anki:mine': mine,
    'anki:getView': getAnkiView,
    'anki:setView': setAnkiView,
    'anki:listDecks': listAnkiDecks,
    'anki:overview': getAnkiOverview,
    'anki:browse': browseAnki,
    'anki:media': getAnkiMedia,
    'anki:setup': ankiSetup,
    'anki:recent': recentAnkiCards,
    'anki:updateNote': updateAnkiNote,
    'anki:deleteNote': deleteAnkiNote,
    'anki:openInAnki': openAnkiNote,
    'settings:get': getSettings,
    'settings:set': setSettings,
    ...features.handlers,
  };

  function shutdown() {
    stop();
    features.stop();
  }

  return { handlers, start, stop: shutdown };
}

module.exports = { createServices };
