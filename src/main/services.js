const fs = require('fs/promises');
const { randomUUID } = require('node:crypto');
const os = require('os');
const path = require('path');
const ankiBrowse = require('../core/ankiBrowse');
const { SampleBrowser } = require('../core/ankiSample');
const { AnkiStudy } = require('../core/ankiStudy');
const { createFeatureHandlers, assertMineInput, assertContext, clampPad, optionalIndex } = require('./features');
const { createLearnHandlers } = require('./learnHandlers');
const { createMangaHandlers } = require('./mangaHandlers');
const { createVocabHandlers } = require('./vocabHandlers');
const { createGrammarHandlers } = require('./grammarHandlers');
const { createWebBridge } = require('./webBridge');
const { Corpus } = require('../core/corpus');
const { normalizeCover } = require('../core/cover');
const { normalizeKey } = require('../core/subKey');
const { createJimaku, JimakuError } = require('../core/jimaku');
const { parseMediaName } = require('../core/matcher');
const { furigana, toAnkiFurigana, hasKanji } = require('../core/furigana');

const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt'];
const SETTINGS_MODE = 0o600;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ANKI_MODES = ['hidden', 'sample', 'live'];
const ANKI_NEEDS_LIVE = 'Switch to Live mode and connect Anki first.';

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
    removeBurnedSubs: false,
    burnedSubsMode: 'blur',
    subtitleCover: null,
    subtitleKey: null,
    manga: { aiOcr: false },
    jimaku: { enabled: true, apiKey: '' },
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

function buildFields({ mode, word, meaning, translation, cue, videoPath, sentence, source }) {
  const text = cue?.text ?? sentence;
  const shared = {
    SentenceTranslation: toBreaks(escapeHtml(translation)),
    Notes: '',
    Source: escapeHtml(source ?? path.basename(videoPath, path.extname(videoPath))),
  };
  if (mode !== 'word') {
    return {
      ...shared,
      Word: escapeHtml(text),
      Reading: '',
      Meaning: '',
      Sentence: toBreaks(escapeHtml(text)),
    };
  }
  return {
    ...shared,
    Word: escapeHtml(word.base),
    Reading: escapeHtml(word.reading || word.base),
    Meaning: toBreaks(escapeHtml(meaning)),
    Sentence: toBreaks(highlight(escapeHtml(text), escapeHtml(word.surface))),
  };
}

function deckSegment(title) {
  return title
    .replace(/::/g, ':')
    .replace(/["\\\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function animeDeckName(root, videoPath) {
  const title = deckSegment(parseMediaName(videoPath).title);
  return title ? `${root}::${title}` : root;
}

function mangaDeckName(root, seriesTitle, deckKind = 'Manga') {
  const base = `${root}::${deckKind}`;
  const title = deckSegment(seriesTitle);
  return title ? `${base}::${title}` : base;
}

const { AnkiDeckOptions, validatePatch } = require('../core/ankiDeckOptions');

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
  let settingsLoad = null;
  let settingsSaveChain = Promise.resolve();
  let unwatch = null;

  const tokenize = (text) => (deps.tokenize || require('../core/tokenizer').tokenize)(text);
  const explain = (ai, req) => (deps.explain || require('../core/ai').explain)(ai, req);
  const translate = (ai, req) => (deps.translate || require('../core/ai').translate)(ai, req);
  const media = () => deps.media || require('../core/media');
  let systemAudio = null;
  const getSystemAudio = () =>
    (systemAudio ??= deps.systemAudio ?? require('../core/systemAudio').createSystemAudio({ dataDir }));
  const features = createFeatureHandlers({
    dataDir,
    getSettings,
    library,
    dictionary,
    tokenize,
    notify,
    deps,
  });
  const learn = createLearnHandlers({
    dataDir,
    getSettings: () => getSettings(),
    library,
    tokenize,
    knownWords: features.knownWords,
    episodeCues: features.episodeCues,
    glossFor: features.glossFor,
    notify,
    deps: deps.learn,
  });
  const corpus = new Corpus(dataDir).load();
  const manga = createMangaHandlers({
    dataDir,
    dialog,
    getSettings: () => getSettings(),
    tokenize,
    corpus,
    notify,
    mineCard: (card) => mineMangaCard(card),
    deps: deps.manga,
  });
  const vocab = createVocabHandlers({
    dataDir,
    library,
    dictionary,
    pitchAccent: features.pitchAccent,
    knownWords: features.knownWords,
    episodeCues: features.episodeCues,
    tokenize,
    corpus,
    notify,
    deps: deps.vocab,
  });
  const grammar = createGrammarHandlers({ tokenize });
  const webBridge = createWebBridge({
    dataDir,
    port: deps.webPort ?? 8767,
    lookup: lookupAtText,
    status: webStatus,
    onActivity: () => {
      try {
        const sa = getSystemAudio();
        sa.start();
        sa.touch();
      } catch {}
    },
    mine: async ({ mode, word, meaning, translation, sentence, sourceTitle, pictureBase64, pictureExt, captionShownAt, captionEndedAt }) => {
      const audio = await webAudio(captionShownAt, captionEndedAt);
      return mineMangaCard({
        mode,
        word,
        meaning,
        translation,
        sentence,
        sourceTitle: sourceTitle ?? '',
        picture: pictureBase64 ? { ext: pictureExt, data: Buffer.from(pictureBase64, 'base64') } : undefined,
        audio,
        deckKind: 'Web',
      });
    },
    subtitles: webSubtitles,
  });

  async function lookupAtText({ text, offset }) {
    const tokens = await tokenize(text);
    const index = tokens.findIndex((token) => token.start <= offset && offset < token.end);
    const result =
      index < 0
        ? { span: null, entries: [], dictForm: null, inflection: [], pitch: null }
        : await features.handlers['lookup:at']({ text, index });
    return { ...result, tokenCount: tokens.length };
  }

  async function webAudio(captionShownAt, captionEndedAt) {
    try {
      const sa = getSystemAudio();
      const clip = captionShownAt === undefined
        ? await sa.clipLastUtterance()
        : await sa.clip({ fromMs: captionShownAt - 300, toMs: Math.min(Date.now(), captionEndedAt === undefined ? Date.now() : captionEndedAt + 200) });
      return clip ?? undefined;
    } catch {
      return undefined;
    }
  }

  async function webStatus() {
    const { mode } = await ankiSettings();
    const connected = mode === 'live' && (await ankiStatus().catch(() => ({ connected: false }))).connected;
    return { dictReady: dictionary.isReady(), ankiConnected: connected === true };
  }

  let webJimaku = null;

  function webJimakuFor(apiKey) {
    if (webJimaku?.apiKey !== apiKey) webJimaku = { apiKey, client: createJimaku({ apiKey, fetch: deps.fetch }) };
    return webJimaku.client;
  }

  async function webSubtitles({ title, season, episode }) {
    const { jimaku } = await getSettings();
    if (!jimaku.enabled || !jimaku.apiKey) throw new Error('Add your Jimaku API key in Anime Mine settings');
    return webJimakuFor(jimaku.apiKey).findSubtitle({ title, season: season ?? null, episode: episode ?? null });
  }

  async function getSettings() {
    if (settings) return settings;
    settingsLoad ??= readSettings(settingsFile)
      .then((loaded) => (settings ??= loaded))
      .finally(() => { settingsLoad = null; });
    return settingsLoad;
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
    await webBridge.start();
    runJimaku();
  }

  let jimakuRun = null;

  let jimakuCooldownUntil = 0;

  function runJimaku() {
    if (Date.now() < jimakuCooldownUntil) return Promise.resolve();
    jimakuRun ??= fetchJimakuSubtitles().finally(() => {
      jimakuRun = null;
    });
    return jimakuRun;
  }

  async function fetchJimakuSubtitles() {
    try {
      const { jimaku } = await getSettings();
      if (!jimaku.enabled || !jimaku.apiKey) return;
      await library.fetchMissingSubtitles(createJimaku({ apiKey: jimaku.apiKey, fetch: deps.fetch }), {
        onLinked: (episode) =>
          notify('library:updated', { message: `Jimaku subtitle linked to ${episode.name}`, videoPath: episode.path }),
      });
    } catch (err) {
      if (err instanceof JimakuError && err.status === 401) {
        notify('library:updated', { message: 'Jimaku API key rejected. Check Settings.' });
      } else {
        if (err instanceof JimakuError && err.status === 429) jimakuCooldownUntil = Date.now() + err.retryAfterMs;
        console.warn(`Jimaku subtitle fetch stopped: ${err.message}`);
      }
    }
  }

  async function addFolder() {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (!canceled && filePaths.length) await library.addFolder(filePaths[0]);
    const shows = await library.scan();
    runJimaku();
    return shows;
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
  let settingsGeneration = 0;
  const ANKI_SCOPE_KEYS = ['ankiView', 'ankiVisibleDecks', 'ankiUrl'];
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

  // Deck creation, package import and sync only ever write to a live Anki; hidden and sample refuse before any side effect.
  async function liveAnkiUrl() {
    const { mode, ankiUrl } = await ankiSettings();
    if (mode !== 'live') throw new Error(ANKI_NEEDS_LIVE);
    return ankiUrl;
  }

  async function createAnkiDeck(req) {
    const ankiUrl = await liveAnkiUrl();
    const { name } = req ?? {};
    if (typeof name !== 'string' || name.trim() === '') throw new Error('name must be a non-empty string');
    return new AnkiBrowser(new AnkiClient(ankiUrl)).createDeck({ name });
  }

  async function importAnkiPackage() {
    const ankiUrl = await liveAnkiUrl();
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Anki packages', extensions: ['apkg', 'colpkg'] }],
    });
    if (canceled || !filePaths.length) return { imported: false, path: null };
    return new AnkiBrowser(new AnkiClient(ankiUrl)).importPackage({ path: filePaths[0] });
  }

  async function syncAnki() {
    const ankiUrl = await liveAnkiUrl();
    return new AnkiBrowser(new AnkiClient(ankiUrl)).sync();
  }

  // Live requests may only name visible decks; no names means all visible decks.
  function liveDecks(visibleDecks, names) {
    if (names === undefined) return visibleDecks;
    if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) throw new Error('decks must be an array of strings');
    if (!names.every((name) => visibleDecks.includes(name))) throw new Error('Deck is hidden');
    return names;
  }

  async function browseAnki(req) {
    const { mode, ankiUrl, visibleDecks } = await ankiSettings();
    if (mode === 'hidden') return { cards: [], total: 0 };
    const { deck, decks, query, state, limit, sort, desc, offset } = req ?? {};
    const scope = mode === 'live' ? { decks: liveDecks(visibleDecks, deck !== undefined ? [deck] : decks) } : { deck, decks };
    const result = await ankiSource(mode, ankiUrl).browse({ ...scope, query, state, limit, sort, desc, offset });
    rememberMedia(result.cards);
    return result;
  }

  async function facetsAnki(req) {
    const { mode, ankiUrl, visibleDecks } = await ankiSettings();
    if (mode === 'hidden') return { decks: [], tags: [], noteTypes: [], saved: [] };
    const decks = mode === 'live' ? liveDecks(visibleDecks, req?.decks) : req?.decks ?? (await sampleBrowser.listDecks());
    return ankiSource(mode, ankiUrl).facets({ decks });
  }

  async function cardInfoAnki(req) {
    const { mode, ankiUrl, visibleDecks } = await ankiSettings();
    if (mode === 'hidden') return null;
    const cardId = req?.cardId;
    if (!Number.isInteger(cardId) || cardId < 1) throw new Error('cardId must be a positive integer');
    const result = await ankiSource(mode, ankiUrl).cardInfo({ cardId, decks: mode === 'live' ? visibleDecks : undefined });
    rememberMedia([result.card]);
    return result;
  }

  async function cardActionAnki(req) {
    const { mode, ankiUrl, visibleDecks } = await ankiSettings();
    if (mode === 'sample') throw new Error('Sample data is read-only');
    if (mode !== 'live') throw new Error('Card actions need Live mode');
    const generation = settingsGeneration;
    const guard = async () => {
      const current = await ankiSettings();
      if (current.mode !== 'live' || generation !== settingsGeneration || current.ankiUrl !== ankiUrl) {
        throw new Error('Anki connection or visible decks changed. Start a new session.');
      }
    };
    const { action, cardIds, args } = req ?? {};
    await new AnkiBrowser(new AnkiClient(ankiUrl)).cardAction({ action, cardIds, args, decks: visibleDecks, guard });
    return { ok: true };
  }

  async function studyQueue(req) {
    const { mode, ankiUrl, visibleDecks } = await ankiSettings();
    if (mode !== 'live') return { cards: [] };
    const { deck } = req ?? {};
    if (!visibleDecks.includes(deck)) throw new Error('Deck is hidden');
    const generation = settingsGeneration;
    const client = new AnkiClient(ankiUrl);
    const native = await new AnkiDeckOptions(client).queue(deck);
    if (generation !== settingsGeneration) return { cards: [] };
    const { cards } = await new AnkiStudy(client).queue({ deck, allowedDecks: visibleDecks, native });
    if (generation !== settingsGeneration) return { cards: [] };
    rememberMedia(cards);
    return { cards, token: native.token, remaining: native.remaining, native: true };
  }

  async function studyAnswer(req) {
    const { mode, ankiUrl } = await ankiSettings();
    if (mode !== 'live') throw new Error('Studying needs Live mode');
    const generation = settingsGeneration;
    const { cardId, ease, deck, token } = req ?? {};
    if (typeof token !== 'string' || !token) throw new Error('Start a new native Anki study session');
    // Scope is re-read after the card lookup so a mode or deck change mid-request still blocks the write.
    const allowedDecks = async () => {
      const current = await ankiSettings();
      if (current.mode !== 'live') throw new Error('Studying needs Live mode');
      if (generation !== settingsGeneration || current.ankiUrl !== ankiUrl) throw new Error('Anki connection or visible decks changed. Start a new session.');
      return current.visibleDecks;
    };
    await new AnkiStudy(new AnkiClient(ankiUrl)).answer({ cardId, ease, allowedDecks, deck, token });
    return { ok: true };
  }

  async function authorizeDeck(deck, generation, url) {
    const current = await ankiSettings();
    if (current.mode !== 'live') throw new Error('Deck options need Live mode');
    if (!current.visibleDecks.includes(deck)) throw new Error('Deck is hidden');
    if (generation !== undefined && (generation !== settingsGeneration || current.ankiUrl !== url)) throw new Error('Anki connection or visible decks changed. Reload first.');
    return current;
  }

  async function getDeckOptions({ deck } = {}) {
    const current = await ankiSettings();
    if (current.mode === 'hidden') return null;
    if (current.mode === 'sample') {
      if (!(await sampleBrowser.listDecks()).includes(deck)) throw new Error('Choose a sample deck');
      return { deck, native: false, sample: true, preset: 'Sample preset', presetId: 2, sharedPreset: true, revision: 'sample',
        presets: [{ id: 1, name: 'Default', useCount: 1 }, { id: 2, name: 'Sample preset', useCount: 2 }, { id: 3, name: 'Sample grammar', useCount: 1 }],
        permanent: { newPerDay: 20, reviewsPerDay: 200, newMix: 1, interdayLearningMix: 0, newGatherOrder: 0, newSortOrder: 0, reviewOrder: 0,
          buryNew: true, buryReviews: true, buryLearning: true, learnSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4,
          startingEase: 250, maxInterval: 36500, easyBonus: 130, intervalModifier: 100, hardInterval: 120, lapseNewInterval: 0, lapseMinInterval: 1,
          leechThreshold: 8, leechAction: 0, disableAutoplay: false, skipQuestionWhenReplayingAnswer: false, maxAnswerSecs: 60, showTimer: false,
          stopTimerOnAnswer: false, fsrs: false, desiredRetention: 0.9 },
        today: { newPerDay: null, reviewsPerDay: null }, completed: { new: 0, reviews: 0, learning: 0 }, remaining: { new: 0, reviews: 0, learning: 0 } };
    }
    const generation = settingsGeneration;
    await authorizeDeck(deck, generation, current.ankiUrl);
    const result = await new AnkiDeckOptions(new AnkiClient(current.ankiUrl)).get(deck, current.visibleDecks);
    await authorizeDeck(deck, generation, current.ankiUrl);
    return result;
  }

  let deckSaveChain = Promise.resolve();
  async function setDeckOptions(req = {}) {
    // Validate even in non-live modes, but never contact Anki there.
    validatePatch(req.patch);
    const task = deckSaveChain.catch(() => {}).then(async () => {
      const { ankiUrl, visibleDecks } = await authorizeDeck(req.deck);
      const generation = settingsGeneration;
      return new AnkiDeckOptions(new AnkiClient(ankiUrl)).save({ deck: req.deck, patch: req.patch, revision: req.revision, visibleDecks,
        authorize: () => authorizeDeck(req.deck, generation, ankiUrl) });
    });
    deckSaveChain = task;
    return task;
  }

  async function openDeckOptions({ deck } = {}) {
    const { ankiUrl } = await authorizeDeck(deck);
    return new AnkiDeckOptions(new AnkiClient(ankiUrl)).open(deck);
  }

  async function getAnkiMedia(filename) {
    ankiBrowse.assertMediaName(filename);
    const { mode, ankiUrl } = await ankiSettings();
    if (mode !== 'live' || !servedMedia.has(filename)) return null;
    return ankiSource(mode, ankiUrl).media(filename);
  }

  // Use the same queue as manual settings saves; compute the deck list inside it.
  // A settings failure must not fail a card that was already saved to Anki.
  function revealMinedDeck(deck) {
    return writeSettings((previous) => {
      const visibleDecks = Array.isArray(previous.ankiVisibleDecks)
        ? previous.ankiVisibleDecks.filter((name) => typeof name === 'string')
        : [];
      return visibleDecks.includes(deck) ? null : { ankiVisibleDecks: [...visibleDecks, deck] };
    }).catch(() => {});
  }

  async function buildFurigana({ mode, word, sentence }) {
    try {
      const at = mode === 'word' && word.surface ? sentence.indexOf(word.surface) : -1;
      const highlight = at < 0 ? undefined : { start: at, end: at + word.surface.length };
      const fields = { SentenceFurigana: toBreaks(toAnkiFurigana(await furigana(sentence, tokenize), { highlight })) };
      if (mode !== 'word') return fields;
      let WordFurigana = toAnkiFurigana(await furigana(word.base, tokenize));
      if (!WordFurigana.includes('[') && hasKanji(word.base) && word.reading && word.reading !== word.base) {
        WordFurigana = `${word.base}[${word.reading}]`;
      }
      return { WordFurigana, ...fields };
    } catch {
      return mode === 'word' ? { WordFurigana: '', SentenceFurigana: '' } : { SentenceFurigana: '' };
    }
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
    if (wantsMachine && autoTranslate && require('../core/ai').aiReady(ai)) {
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
    const pictureSource = await features.playbackSource(videoPath);
    const picture = await media().screenshot({ video: pictureSource, time: (cue.start + cue.end) / 2, censorSubs: pictureSource === videoPath, cover: pictureSource === videoPath ? ((await getSettings()).subtitleCover ?? null) : null, key: pictureSource === videoPath ? ((await getSettings()).subtitleKey ?? null) : null });
    const deck = animeDeckName(ankiDeck, videoPath);
    const anki = new AnkiClient(ankiUrl);
    await anki.ensureSetup(deck, ankiModel);
    const generated = buildFields({ mode, word, meaning, translation: translation || machineTranslation, cue, videoPath });
    const furiganaFields = await buildFurigana({ mode, word, sentence: cue.text });
    let noteId;
    try {
      noteId = await anki.addCard({
        deck,
        duplicateRoot: ankiDeck,
        model: ankiModel,
        fields: { ...generated, ...furiganaFields, ...overrides },
        audio: { filename: `am_${stamp}.mp3`, data: audio },
        picture: { filename: `am_${stamp}.jpg`, data: picture },
      });
    } catch (err) {
      if (/duplicate/i.test(err?.message ?? '')) throw new Error('Already in your deck');
      throw err;
    }
    await revealMinedDeck(deck);
    if (mode === 'word') {
      features.markMined(word);
      learn.markMined(word, { meaning, sentence: cue.text });
    }
    return { noteId };
  }

  async function mineMangaCard({ mode, word, meaning, translation, sentence, sourceTitle, picture, audio, deckKind = 'Manga' }) {
    const { ankiUrl, ankiDeck, ankiModel, ai, autoTranslate } = await getSettings();
    let machineTranslation;
    if (!hasText(translation) && autoTranslate && require('../core/ai').aiReady(ai)) {
      try {
        machineTranslation = await translate(ai, { sentence });
      } catch {
        // Best-effort: a failed translation must never block the card.
      }
    }
    const stamp = Date.now();
    const deck = mangaDeckName(ankiDeck, sourceTitle, deckKind);
    const anki = new AnkiClient(ankiUrl);
    await anki.ensureSetup(deck, ankiModel);
    const fields = {
      ...buildFields({ mode, word, meaning, translation: hasText(translation) ? translation : machineTranslation, sentence, source: sourceTitle }),
      ...(await buildFurigana({ mode, word, sentence })),
    };
    let noteId;
    try {
      noteId = await anki.addCard({
        deck,
        duplicateRoot: ankiDeck,
        model: ankiModel,
        fields,
        audio: audio ? { filename: `am_${stamp}.mp3`, data: audio } : undefined,
        picture: picture ? { filename: `am_${stamp}.${picture.ext}`, data: picture.data } : undefined,
      });
    } catch (err) {
      if (/duplicate/i.test(err?.message ?? '')) throw new Error('Already in your deck');
      throw err;
    }
    await revealMinedDeck(deck);
    if (mode === 'word') {
      features.markMined(word);
      learn.markMined(word, { meaning, sentence });
    }
    return { noteId };
  }

  function writeSettings(input, { invalidateScope = false } = {}) {
    const task = settingsSaveChain.catch(() => {}).then(async () => {
      const previous = await getSettings();
      const patch = typeof input === 'function' ? input(previous) : input;
      if (patch === null) return { previous, next: previous };
      const next = deepMerge(previous, patch);
      const temp = `${settingsFile}.${process.pid}.${randomUUID()}.tmp`;
      await fs.mkdir(dataDir, { recursive: true });
      try {
        await fs.writeFile(temp, JSON.stringify(next, null, 2), { mode: SETTINGS_MODE });
        await fs.chmod(temp, SETTINGS_MODE);
        await fs.rename(temp, settingsFile);
      } catch (err) {
        await fs.rm(temp, { force: true }).catch(() => {});
        throw err;
      }
      settings = next;
      if (invalidateScope && ANKI_SCOPE_KEYS.some((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))) settingsGeneration++;
      if (next.downloadsDir !== previous.downloadsDir) await start();
      return { previous, next };
    });
    settingsSaveChain = task;
    return task;
  }

  // Only explicit scope changes invalidate in-flight study and options requests.
  async function setSettings(input) {
    let patch = input;
    if (input && Object.hasOwn(input, 'subtitleCover')) patch = { ...patch, subtitleCover: normalizeCover(input.subtitleCover) };
    if (input && Object.hasOwn(input, 'subtitleKey')) patch = { ...patch, subtitleKey: normalizeKey(input.subtitleKey) };
    const { next } = await writeSettings(patch, { invalidateScope: true });
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
    const { mode, ankiUrl, ankiModel, visibleDecks } = await ankiSettings();
    if (mode !== 'live') throw new Error('Editing needs Live mode');
    const anki = new AnkiClient(ankiUrl);
    if ((await anki.noteModel(noteId)) !== ankiModel) throw new Error('Not an anime-mine note');
    const cardIds = (await anki.invoke('findCards', { query: `nid:${noteId}` })) ?? [];
    const infos = cardIds.length ? ((await anki.invoke('cardsInfo', { cards: cardIds })) ?? []) : [];
    if (infos.some((info) => !visibleDecks.includes(info.deckName))) throw new Error('Deck is hidden');
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
    'anki:createDeck': createAnkiDeck,
    'anki:importPackage': importAnkiPackage,
    'anki:sync': syncAnki,
    'anki:browse': browseAnki,
    'anki:facets': facetsAnki,
    'anki:cardInfo': cardInfoAnki,
    'anki:cardAction': cardActionAnki,
    'anki:studyQueue': studyQueue,
    'anki:studyAnswer': studyAnswer,
    'anki:deckOptions': getDeckOptions,
    'anki:setDeckOptions': setDeckOptions,
    'anki:openDeckOptions': openDeckOptions,
    'anki:media': getAnkiMedia,
    'anki:setup': ankiSetup,
    'anki:recent': recentAnkiCards,
    'anki:updateNote': updateAnkiNote,
    'anki:deleteNote': deleteAnkiNote,
    'anki:openInAnki': openAnkiNote,
    'settings:get': getSettings,
    'settings:set': setSettings,
    'web:info': () => webBridge.info(),
    ...features.handlers,
    ...learn.handlers,
    ...manga.handlers,
    ...vocab.handlers,
    ...grammar.handlers,
  };

  function shutdown() {
    stop();
    features.stop();
    learn.stop();
    manga.stop();
    vocab.stop();
    webBridge.stop();
    systemAudio?.stop();
  }

  return { handlers, start, stop: shutdown };
}

module.exports = { createServices, mangaDeckName };
