const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Desubber } = require('../core/desubber');
const { loadColabSidecars, applyColabSidecars } = require('../core/colabSidecar');

const MAX_CUE_SECONDS = 120;
const MAX_PAD_SECONDS = 5;
const MAX_CONTEXT_LINES = 2;
const MAX_COVERAGE_ENTRIES = 500;
const MAX_SUB_OFFSET_SECONDS = 600;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUnset = (value) => value === undefined || value === null;
const hasText = (value) => typeof value === 'string' && value.trim() !== '';
const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');
const emptyLookup = () => ({ span: null, entries: [], dictForm: null, inflection: [], pitch: null });
const isIndex = (value) => Number.isInteger(value) && value >= 0;
const isSeconds = (value) => Number.isFinite(value) && value >= 0;
// The player persists 'off', 'external' or an embedded stream index.
const isSubtitleChoice = (value) =>
  value === null || value === 'off' || value === 'external' || isIndex(value) ||
  (isPlainObject(value) && ['external', 'embedded'].includes(value.kind) && (value.index === null || isIndex(value.index)));
const PROGRESS_VALIDATORS = {
  position: isSeconds,
  duration: isSeconds,
  subOffset: (value) => Number.isFinite(value) && Math.abs(value) <= MAX_SUB_OFFSET_SECONDS,
  audioStreamIndex: (value) => value === null || isIndex(value),
  subtitle: isSubtitleChoice,
};

function assertVideoPath(videoPath) {
  if (!hasText(videoPath)) throw new Error('videoPath must be a non-empty string');
}

function assertMineInput(videoPath, cue) {
  assertVideoPath(videoPath);
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

// Undefined/null means "not given"; anything else must be a non-negative integer.
function optionalIndex(value, name) {
  if (isUnset(value)) return undefined;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function assertContext(context) {
  if (isUnset(context)) return [];
  if (!Array.isArray(context) || context.length > MAX_CONTEXT_LINES || !context.every((line) => typeof line === 'string')) {
    throw new Error(`context must be an array of at most ${MAX_CONTEXT_LINES} strings`);
  }
  return context;
}

function clampPad(value) {
  return Math.min(MAX_PAD_SECONDS, Math.max(0, Number.isFinite(value) ? value : 0));
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value));
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

async function subtitleFingerprint(videoPath, subtitle) {
  if (subtitle.source === 'external') {
    const stat = await fs.stat(subtitle.subtitlePath);
    return `${subtitle.subtitlePath}|${stat.mtimeMs}|${stat.size}`;
  }
  const stat = await fs.stat(videoPath);
  return `${videoPath}|${stat.mtimeMs}|${stat.size}|${subtitle.embeddedIndex}`;
}

// Object keys keep insertion order, so the newest entries are the last ones.
function keepLatest(entries, limit) {
  const keys = Object.keys(entries);
  return Object.fromEntries(keys.slice(Math.max(0, keys.length - limit)).map((key) => [key, entries[key]]));
}

function createFeatureHandlers({ dataDir, getSettings, library, dictionary, tokenize, notify = () => {}, deps = {} }) {
  const probeModule = require('../core/probe');
  const probe = deps.probe || probeModule.probe;
  const extractSubtitles = deps.extractSubtitles || probeModule.extractSubtitles;
  const Converter = deps.Converter || require('../core/converter').Converter;
  const known = require('../core/known');
  const KnownWords = deps.KnownWords || known.KnownWords;
  const lookupAt = deps.lookupAt || require('../core/lookup').lookupAt;
  const pitchModule = require('../core/pitch');
  const PitchAccent = deps.PitchAccent || pitchModule.PitchAccent;
  const progressModule = require('../core/progress');
  const WatchProgress = deps.WatchProgress || progressModule.WatchProgress;
  const translate = deps.translate || require('../core/ai').translate;
  const media = deps.media || require('../core/media');
  const AnkiClient = deps.AnkiClient || require('../core/anki').AnkiClient;
  const parseSubtitleFile = deps.parseSubtitleFile || require('../core/subtitles').parseSubtitleFile;
  const syncCues = deps.syncCues || require('../core/subSync').syncCues;

  const converter = new Converter({ cacheDir: path.join(dataDir, 'converted') });
  const desubber = deps.desubber || new Desubber({ dataDir });
  const watch = new WatchProgress(dataDir);
  const pitchAccent = new PitchAccent(dataDir);
  const coverageFile = path.join(dataDir, 'coverage.json');
  let coverageWrites = Promise.resolve();
  const activePrepares = new Map();
  let knownStore = null;
  const knownWords = () => (knownStore ??= new KnownWords(dataDir).load());
  const ankiClient = async () => new AnkiClient((await getSettings()).ankiUrl);

  // ---- media ----

  async function probeMedia(videoPath) {
    assertVideoPath(videoPath);
    const info = await probe(videoPath);
    const defaults = {
      audioStreamIndex: probeModule.pickDefaultAudio(info.streams)?.index ?? null,
      subtitleStreamIndex: probeModule.pickDefaultSubtitle(info.streams)?.index ?? null,
    };
    const entry = watch.get(videoPath);
    const saved = entry && {
      audioStreamIndex: entry.audioStreamIndex,
      subtitle: entry.subtitle,
      position: entry.position,
      subOffset: entry.subOffset,
    };
    const audioStreamIndex = saved?.audioStreamIndex ?? defaults.audioStreamIndex;
    queueCleanup(videoPath).catch(() => {});
    return {
      duration: info.duration,
      streams: info.streams,
      plan: converter.plan(info, path.extname(videoPath).toLowerCase(), audioStreamIndex),
      defaults,
      saved,
    };
  }

  async function burnedSubsMode() {
    return (await getSettings()).burnedSubsMode === 'ai' ? 'ai' : 'blur';
  }

  async function playbackSource(videoPath) {
    try {
      if ((await getSettings()).removeBurnedSubs !== true) return videoPath;
      return (await desubber.cleanedPath(videoPath, await burnedSubsMode())) ?? videoPath;
    } catch {
      return videoPath;
    }
  }

  // desub.py renumbers audio streams from 1, so find the cleaned file's index for the same track.
  async function cleanedAudioIndex(videoPath, cleanPath, audioStreamIndex) {
    const audioIndexes = (info) => info.streams.filter((stream) => stream.type === 'audio').map((stream) => stream.index);
    const ordinal = audioIndexes(await probe(videoPath)).indexOf(audioStreamIndex);
    return audioIndexes(await probe(cleanPath))[ordinal] ?? audioStreamIndex;
  }

  async function queueCleanup(videoPath) {
    if ((await getSettings()).removeBurnedSubs !== true) return;
    const mode = await burnedSubsMode();
    if (await desubber.cleanedPath(videoPath, mode)) return;
    await desubber.enqueue(videoPath, {
      onProgress: (fraction) => notify('desub:progress', { videoPath, fraction }),
      onDone: () => notify('desub:done', { videoPath }),
      onError: (error) => notify('desub:error', { videoPath, message: error.message }),
    }, mode);
  }

  // One running job per video: a different audio track or mode aborts the previous one; an identical request shares it.
  async function prepareMedia(req) {
    const { videoPath, audioStreamIndex, force } = req ?? {};
    assertVideoPath(videoPath);
    if (!Number.isInteger(audioStreamIndex) || audioStreamIndex < 0) {
      throw new Error('audioStreamIndex must be a non-negative integer');
    }
    if (!isUnset(force) && typeof force !== 'boolean') throw new Error('force must be a boolean');
    const forced = force === true;
    const current = activePrepares.get(videoPath);
    if (current?.audioStreamIndex === audioStreamIndex && current.force === forced) return current.promise;
    current?.controller.abort();
    const controller = new AbortController();
    const job = { audioStreamIndex, force: forced, controller };
    activePrepares.set(videoPath, job);
    job.promise = (async () => {
      const source = await playbackSource(videoPath);
      const sourceAudio = source === videoPath
        ? audioStreamIndex
        : await cleanedAudioIndex(videoPath, source, audioStreamIndex);
      const prepared = await converter.prepare(source, {
        audioStreamIndex: sourceAudio,
        force: forced,
        signal: controller.signal,
        onProgress: (fraction) => notify('media:progress', { videoPath, fraction }),
      });
      return { ...prepared, cleaned: source !== videoPath };
    })();
    try {
      return await job.promise;
    } finally {
      if (activePrepares.get(videoPath) === job) activePrepares.delete(videoPath);
    }
  }

  async function cancelMedia(videoPath) {
    assertVideoPath(videoPath);
    const job = activePrepares.get(videoPath);
    if (job) {
      activePrepares.delete(videoPath);
      job.controller.abort();
    }
    return { ok: true };
  }

  async function previewClip(req) {
    const { videoPath, cue, audioStreamIndex } = req ?? {};
    assertMineInput(videoPath, cue);
    const audioStream = optionalIndex(audioStreamIndex, 'audioStreamIndex');
    const { audioPadStart, audioPadEnd } = await getSettings();
    const audio = await media.extractAudio({
      video: videoPath,
      start: cue.start,
      end: cue.end,
      padStart: clampPad(audioPadStart),
      padEnd: clampPad(audioPadEnd),
      ...(audioStream === undefined ? {} : { audioStream }),
    });
    const source = await playbackSource(videoPath);
    const picture = await media.screenshot({ video: source, time: (cue.start + cue.end) / 2, censorSubs: source === videoPath, cover: source === videoPath ? ((await getSettings()).subtitleCover ?? null) : null, key: source === videoPath ? ((await getSettings()).subtitleKey ?? null) : null });
    return {
      audio: `data:audio/mpeg;base64,${audio.toString('base64')}`,
      picture: `data:image/jpeg;base64,${picture.toString('base64')}`,
    };
  }

  // ---- subtitles ----

  async function embeddedCues(videoPath, streamIndex) {
    const stat = await fs.stat(videoPath);
    const key = sha1(`${videoPath}|${stat.mtimeMs}|${stat.size}|${streamIndex}`);
    const file = path.join(dataDir, 'embedded-subs', `${key}.json`);
    let cues = await readJson(file);
    if (!cues) {
      cues = await extractSubtitles({ video: videoPath, streamIndex });
      await writeJson(file, cues);
    }
    return { source: 'embedded', subtitlePath: null, embeddedIndex: streamIndex, cues };
  }

  // Explicit embedded track > external link > (auto) probe's default Japanese track > none.
  async function resolveSubtitle(videoPath, { embeddedIndex = null, auto = false } = {}) {
    if (embeddedIndex !== null) return embeddedCues(videoPath, embeddedIndex);
    const linked = await library.getSubtitle(videoPath);
    if (linked) {
      return {
        source: 'external',
        subtitlePath: linked,
        embeddedIndex: null,
        cues: await parseSubtitleFile(linked),
      };
    }
    if (auto) {
      const stream = probeModule.pickDefaultSubtitle((await probe(videoPath)).streams);
      if (stream) return embeddedCues(videoPath, stream.index);
    }
    return { source: 'none', subtitlePath: null, embeddedIndex: null, cues: [] };
  }

  async function loadCues(videoPath, opts) {
    assertVideoPath(videoPath);
    const { embeddedIndex, auto } = opts ?? {};
    const subtitle = await resolveSubtitle(videoPath, {
      embeddedIndex: optionalIndex(embeddedIndex, 'embeddedIndex') ?? null,
      auto: auto === true,
    });
    const sidecars = await loadColabSidecars({ videoPath, subtitlePath: subtitle.subtitlePath })
      .catch(() => ({ fix: new Map(), tag: new Map() }));
    // Sidecar numbers refer to the original cue order, so apply them before sync can drop or reorder cues.
    const annotated = applyColabSidecars(subtitle.cues, sidecars);
    const synced = subtitle.source === 'external'
      ? await syncCues({ video: videoPath, cues: annotated, subtitlePath: subtitle.subtitlePath, dataDir })
      : { cues: annotated, applied: false };
    return {
      cues: synced.cues,
      subtitlePath: subtitle.subtitlePath,
      source: subtitle.source,
      embeddedIndex: subtitle.embeddedIndex,
      synced: synced.applied,
    };
  }

  // ---- known words ----

  async function ankiFields(req) {
    const { deck } = req ?? {};
    assertDeck(deck);
    return known.ankiFieldNames(await ankiClient(), deck);
  }

  async function importAnki(req) {
    const { deck, field, matureOnly } = req ?? {};
    assertDeck(deck);
    if (!isUnset(field) && typeof field !== 'string') throw new Error('field must be a string');
    const store = knownWords();
    const result = await store.importFromAnki(await ankiClient(), { deck, field, matureOnly: matureOnly === true });
    if (result.added) store.save();
    return result;
  }

  function importText(text) {
    if (typeof text !== 'string') throw new Error('text must be a string');
    const store = knownWords();
    const result = known.importFromText(store, text);
    if (result.added) store.save();
    return result;
  }

  function markWord(req) {
    const { word, status } = req ?? {};
    if (!hasText(word)) throw new Error('word must be a non-empty string');
    const store = knownWords();
    store.mark(word, status);
    store.save();
    return { ok: true, stats: store.stats() };
  }

  function classifyTokens(tokens) {
    if (!Array.isArray(tokens)) throw new Error('tokens must be an array');
    const store = knownWords();
    const info = store.sentenceInfo(tokens);
    return {
      statuses: store.classifyTokens(tokens),
      info: {
        newWords: info.newWords.map(({ base, surface, reading }) => ({ base, surface, reading })),
        unknownCount: info.unknownCount,
        isIPlusOne: info.isIPlusOne,
      },
    };
  }

  function storeCoverage(key, result) {
    const write = coverageWrites.then(async () => {
      const cache = (await readJson(coverageFile)) ?? {};
      await writeJson(coverageFile, keepLatest({ ...cache, [key]: result }, MAX_COVERAGE_ENTRIES));
    });
    coverageWrites = write.catch(() => {});
    return write;
  }

  // Cached per subtitle fingerprint and vocabulary revision, so any vocabulary change yields a new key.
  async function coverage(req) {
    const { videoPath, embeddedIndex } = req ?? {};
    assertVideoPath(videoPath);
    const subtitle = await resolveSubtitle(videoPath, { embeddedIndex: optionalIndex(embeddedIndex, 'embeddedIndex') ?? null });
    if (subtitle.source === 'none') return null;
    const store = knownWords();
    const key = `${await subtitleFingerprint(videoPath, subtitle)}|${store.revision}`;
    const cache = (await readJson(coverageFile)) ?? {};
    if (Object.hasOwn(cache, key)) return cache[key];
    const result = await known.episodeCoverage(subtitle.cues, tokenize, store);
    await storeCoverage(key, result);
    return result;
  }

  async function episodeCues(req) {
    const { videoPath, embeddedIndex } = req ?? {};
    assertVideoPath(videoPath);
    const subtitle = await resolveSubtitle(videoPath, { embeddedIndex: optionalIndex(embeddedIndex, 'embeddedIndex') ?? null });
    if (subtitle.source === 'none') return null;
    return { cues: subtitle.cues };
  }

  async function glossFor(word) {
    if (!dictionary.isReady()) return { meanings: [], reading: '' };
    await dictionary.load();
    const [entry] = dictionary.lookup(word);
    if (!entry) return { meanings: [], reading: '' };
    const meanings = [...new Set(entry.senses.flatMap((sense) => sense.glosses))].slice(0, 6);
    return { meanings, reading: entry.kana[0] ?? '' };
  }

  // ---- lookup and pitch ----

  async function pitchFor(entries) {
    const first = entries[0];
    if (!first || !pitchAccent.isReady()) return null;
    await pitchAccent.load();
    const reading = first.kana[0] ?? first.kanji[0];
    for (const word of [...first.kanji, ...first.kana]) {
      const found = pitchAccent.lookup(word, reading);
      if (found) {
        return {
          reading: found.reading,
          accents: found.patterns.map((accent) => ({
            accent,
            label: pitchModule.pitchLabel(found.reading, accent),
            mora: pitchModule.pitchPattern(found.reading, accent),
          })),
        };
      }
    }
    return null;
  }

  async function lookupWordAt(req) {
    const { text, index } = req ?? {};
    if (typeof text !== 'string') throw new Error('text must be a string');
    if (!Number.isInteger(index) || index < 0) throw new Error('index must be a non-negative integer');
    if (!dictionary.isReady()) return emptyLookup();
    await dictionary.load();
    const hit = lookupAt(await tokenize(text), index, dictionary);
    if (!hit) return emptyLookup();
    return {
      span: hit.span,
      entries: hit.entries,
      dictForm: hit.dictForm,
      inflection: hit.inflection,
      pitch: await pitchFor(hit.entries),
    };
  }

  async function downloadPitch() {
    await pitchAccent.download((fraction) => notify('pitch:progress', fraction));
    return { ready: true };
  }

  // ---- progress ----

  function updateProgress(req) {
    const { videoPath, patch } = req ?? {};
    assertVideoPath(videoPath);
    if (!isPlainObject(patch)) throw new Error('patch must be an object');
    const unknown = Object.keys(patch).filter((key) => !Object.hasOwn(PROGRESS_VALIDATORS, key));
    if (unknown.length) throw new Error(`Cannot update progress field(s): ${unknown.join(', ')}`);
    for (const [key, value] of Object.entries(patch)) {
      if (!PROGRESS_VALIDATORS[key](value)) throw new Error(`Invalid progress value: ${key}`);
    }
    return watch.update(videoPath, patch);
  }

  // ---- ai and anki preview ----

  async function translateSentence(req) {
    const { sentence, context } = req ?? {};
    if (!hasText(sentence)) throw new Error('sentence must be a non-empty string');
    return translate((await getSettings()).ai, { sentence, context: assertContext(context).join('\n') });
  }

  function assertDeck(deck) {
    if (!hasText(deck)) throw new Error('deck must be a non-empty string');
  }

  function stop() {
    for (const job of activePrepares.values()) job.controller.abort();
    activePrepares.clear();
    desubber.stop();
  }

  // Called after a word mine succeeds; the card is already saved, so a failed vocabulary write is ignored.
  function markMined(word) {
    try {
      const store = knownWords();
      if (store.addMany([word.base], 'learning', 'mined').added) store.save();
    } catch {
      // Vocabulary bookkeeping must not turn a successful mine into an error.
    }
  }

  const handlers = {
    'media:probe': probeMedia,
    'media:prepare': prepareMedia,
    'media:cancel': cancelMedia,
    'media:cacheInfo': async () => ({ bytes: await converter.cacheSize() }),
    'media:clearCache': async () => {
      await converter.clearCache();
      return { ok: true };
    },
    'player:loadCues': loadCues,
    'known:stats': () => knownWords().stats(),
    'known:ankiFields': ankiFields,
    'known:importAnki': importAnki,
    'known:importText': importText,
    'known:mark': markWord,
    'known:classify': classifyTokens,
    'known:coverage': coverage,
    'lookup:at': lookupWordAt,
    'pitch:status': () => ({ ready: pitchAccent.isReady() }),
    'pitch:download': downloadPitch,
    'progress:get': (videoPath) => {
      assertVideoPath(videoPath);
      return watch.get(videoPath);
    },
    'progress:update': updateProgress,
    'progress:continue': async () => watch.continueWatching(await library.scan()),
    'progress:next': async (videoPath) => {
      assertVideoPath(videoPath);
      return progressModule.findNextEpisode(await library.scan(), videoPath);
    },
    'ai:translate': translateSentence,
    'anki:preview': previewClip,
    'desub:status': async () => ({ ...desubber.status(), bytes: await desubber.cacheSize() }),
    'desub:isClean': async (videoPath) => {
      assertVideoPath(videoPath);
      if ((await getSettings()).removeBurnedSubs !== true) return false;
      return (await desubber.cleanedPath(videoPath, await burnedSubsMode())) !== null;
    },
    'desub:clearCache': async () => {
      await desubber.clearCache();
      return { ok: true };
    },
    'desub:install': async () => {
      await desubber.install((step) => notify('desub:install', { step }));
      return { ok: true };
    },
  };

  return { handlers, stop, markMined, knownWords, episodeCues, glossFor, pitchAccent, playbackSource };
}

module.exports = { createFeatureHandlers, assertMineInput, assertContext, clampPad, optionalIndex };
