const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFeatureHandlers } = require('../src/main/features');

const root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-features-'));
after(() => fsSync.rmSync(root, { recursive: true, force: true }));

const EMBEDDED = [{ start: 1, end: 2, text: '雨 降る' }];
const INFO = {
  duration: 1320,
  streams: [
    { index: 0, type: 'video', codec: 'h264', bitDepth: 8, lang: null, title: null, default: true },
    { index: 1, type: 'audio', codec: 'aac', lang: 'en', title: null, default: false },
    { index: 2, type: 'audio', codec: 'aac', lang: 'ja', title: null, default: true },
    { index: 3, type: 'subtitle', codec: 'subrip', lang: 'ja', title: 'Signs', textBased: true, default: false },
    { index: 4, type: 'subtitle', codec: 'subrip', lang: 'ja', title: null, textBased: true, default: false },
  ],
};

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

async function subtitleFile(dir, name, text) {
  const file = path.join(dir, name);
  await fs.writeFile(file, text);
  return file;
}

// Every dependency is a fake that records what it was asked to do.
function harness() {
  const dir = fsSync.mkdtempSync(path.join(root, 'case-'));
  const notified = [];
  const log = {
    settings: { ankiUrl: 'http://anki.test', ai: { apiKey: 'k', provider: 'anthropic' }, audioPadStart: 0.15, audioPadEnd: 0.25 },
    probes: [],
    planCalls: [],
    converters: [],
    prepares: [],
    held: new Set(),
    cleared: 0,
    progress: {},
    continueCalls: [],
    shows: [],
    subs: {},
    externalCues: [{ start: 0, end: 1, text: '雨 降る' }],
    parsed: [],
    extracts: [],
    words: new Map(),
    saves: 0,
    imports: [],
    addManyCalls: [],
    clients: [],
    invokes: [],
    tokenized: 0,
    lookups: [],
    lookupHit: null,
    dictReady: true,
    dictLoads: 0,
    pitchReady: true,
    pitchLookups: [],
    translateCalls: [],
    media: [],
    revision: 0,
  };

  class FakeConverter {
    constructor(opts) {
      log.converters.push(opts);
    }

    plan(info, ext, audioStreamIndex) {
      log.planCalls.push({ ext, audio: audioStreamIndex });
      return { mode: 'remux', reason: 'r' };
    }

    async cacheSize() {
      return 2048;
    }

    async clearCache() {
      log.cleared += 1;
    }

    prepare(video, { audioStreamIndex, onProgress, signal, force }) {
      log.prepares.push({ video, audioStreamIndex, signal, force });
      onProgress(0.5);
      return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(abortError());
        const abort = () => reject(abortError());
        signal.addEventListener('abort', abort, { once: true });
        if (log.held.has(audioStreamIndex) && !force) return;
        signal.removeEventListener('abort', abort);
        resolve({ path: `/cache/${audioStreamIndex}.mp4`, mode: 'remux' });
      });
    }
  }

  class FakeKnown {
    load() {
      return this;
    }

    save() {
      log.saves += 1;
    }

    stats() {
      const counts = { known: 0, learning: 0 };
      for (const status of log.words.values()) if (status in counts) counts[status] += 1;
      return counts;
    }

    get revision() {
      return log.revision;
    }

    mark(word, status) {
      if (status === 'new') log.words.delete(word);
      else log.words.set(word, status);
      log.revision += 1;
      return true;
    }

    classify(token) {
      if (!token.isWord) return 'skip';
      return log.words.get(token.base) ?? 'new';
    }

    classifyTokens(tokens) {
      return tokens.map((token) => this.classify(token));
    }

    sentenceInfo(tokens) {
      const news = tokens.filter((token) => this.classify(token) === 'new');
      return { newWords: news.map((token) => ({ ...token, extra: true })), unknownCount: news.length, isIPlusOne: news.length === 1 };
    }

    addMany(words, status, source) {
      log.addManyCalls.push({ words, status, source });
      return { added: words.length, skipped: 0 };
    }

    async importFromAnki(client, opts) {
      log.imports.push({ client, opts });
      return { added: 2, skipped: 1, notes: 3 };
    }
  }

  class FakeAnki {
    constructor(url) {
      log.clients.push(url);
    }

    async invoke(action, params) {
      log.invokes.push({ action, params });
      if (action === 'findNotes') return [7];
      if (action === 'notesInfo') {
        return [{ fields: { Expression: { value: 'x', order: 1 }, Word: { value: 'y', order: 0 } } }];
      }
      return null;
    }
  }

  class FakeProgress {
    get(video) {
      return log.progress[video] ?? null;
    }

    update(video, patch) {
      const base = log.progress[video] ?? { position: 0, duration: 0, subOffset: 0, audioStreamIndex: null, subtitle: null };
      log.progress[video] = { ...base, ...patch };
      return log.progress[video];
    }

    async continueWatching(shows, limit) {
      log.continueCalls.push({ shows, limit });
      return ['cw'];
    }
  }

  class FakePitch {
    isReady() {
      return log.pitchReady;
    }

    async load() {}

    lookup(word, reading) {
      log.pitchLookups.push({ word, reading });
      return word === '降る' ? { reading: 'ふる', patterns: [0] } : null;
    }

    async download(onProgress) {
      onProgress(0.5);
      log.pitchReady = true;
    }
  }

  const notify = (channel, payload) => notified.push({ channel, payload });
  const library = {
    scan: async () => log.shows,
    getSubtitle: (videoPath) => log.subs[videoPath] ?? null,
  };
  const dictionary = {
    isReady: () => log.dictReady,
    load: async () => {
      log.dictLoads += 1;
    },
  };
  // Splits on spaces: each piece is a word token.
  const tokenize = async (text) => {
    log.tokenized += 1;
    return text.split(' ').filter(Boolean).map((surface, i) => ({
      surface,
      base: surface,
      reading: surface,
      pos: '名詞',
      pos2: '',
      isWord: true,
      start: i,
      end: i + 1,
    }));
  };
  const media = {
    async extractAudio(args) {
      log.media.push({ kind: 'audio', args });
      return Buffer.from('mp3');
    },
    async screenshot(args) {
      log.media.push({ kind: 'shot', args });
      return Buffer.from('jpg');
    },
  };
  const deps = {
    probe: async (video) => {
      log.probes.push(video);
      return INFO;
    },
    Converter: FakeConverter,
    KnownWords: FakeKnown,
    lookupAt: (tokens, index) => {
      log.lookups.push({ index });
      return log.lookupHit;
    },
    PitchAccent: FakePitch,
    WatchProgress: FakeProgress,
    translate: async (ai, req) => {
      log.translateCalls.push({ ai, req });
      return 'It is raining.';
    },
    extractSubtitles: async (args) => {
      log.extracts.push(args);
      return EMBEDDED;
    },
    AnkiClient: FakeAnki,
    media,
    parseSubtitleFile: async (file) => {
      log.parsed.push(file);
      return log.externalCues;
    },
  };
  const features = createFeatureHandlers({
    dataDir: dir,
    getSettings: async () => log.settings,
    library,
    dictionary,
    tokenize,
    notify,
    deps,
  });
  // Async like the IPC wrapper, so synchronous throws surface as rejections.
  const call = async (channel, ...args) => features.handlers[channel](...args);
  return { dir, log, notified, features, call };
}

const tok = (surface, reading, isWord = true) => ({ surface, base: surface, reading, pos: '名詞', pos2: '', isWord });

test('exposes every feature channel', () => {
  const { features } = harness();
  assert.deepEqual(Object.keys(features.handlers).sort(), [
    'ai:translate',
    'anki:preview',
    'known:ankiFields',
    'known:classify',
    'known:coverage',
    'known:importAnki',
    'known:importText',
    'known:mark',
    'known:stats',
    'lookup:at',
    'media:cacheInfo',
    'media:cancel',
    'media:clearCache',
    'media:prepare',
    'media:probe',
    'pitch:download',
    'pitch:status',
    'player:loadCues',
    'progress:continue',
    'progress:get',
    'progress:next',
    'progress:update',
  ]);
});

test('media:probe reports streams, plan and defaults; saved progress picks the audio used for the plan', async () => {
  const { log, call } = harness();

  assert.deepEqual(await call('media:probe', '/v/a.mkv'), {
    duration: 1320,
    streams: INFO.streams,
    plan: { mode: 'remux', reason: 'r' },
    defaults: { audioStreamIndex: 2, subtitleStreamIndex: 4 },
    saved: null,
  });
  assert.equal(log.planCalls.at(-1).audio, 2);

  await call('progress:update', {
    videoPath: '/v/a.mkv',
    patch: { audioStreamIndex: 1, position: 600, subOffset: 0.3, subtitle: 3 },
  });
  const second = await call('media:probe', '/v/a.mkv');
  assert.deepEqual(second.saved, { audioStreamIndex: 1, subtitle: 3, position: 600, subOffset: 0.3 });
  assert.equal(log.planCalls.at(-1).audio, 1);
  await assert.rejects(call('media:probe', ''), /videoPath must be a non-empty string/);
});

test('media:prepare returns the converted file, emits progress and uses dataDir/converted', async () => {
  const { dir, log, notified, call } = harness();

  assert.deepEqual(await call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 2 }), {
    path: '/cache/2.mp4',
    mode: 'remux',
  });
  assert.deepEqual(log.converters, [{ cacheDir: path.join(dir, 'converted') }]);
  assert.deepEqual(notified, [{ channel: 'media:progress', payload: { videoPath: '/v/a.mkv', fraction: 0.5 } }]);
  await assert.rejects(call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: -1 }), /audioStreamIndex must be a non-negative integer/);
});

test('media:prepare passes force through and rejects a non-boolean force', async () => {
  const { log, call } = harness();

  await call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 1, force: true });
  await call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 1 });

  assert.deepEqual(log.prepares.map((item) => item.force), [true, false]);
  await assert.rejects(call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 1, force: 'yes' }), /force must be a boolean/);
});

test('a forced prepare does not share a running job for the same track', async () => {
  const { log, call } = harness();
  log.held.add(1);

  const plain = call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 1 }).catch((err) => err);
  const forced = await call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 1, force: true });

  assert.deepEqual(forced, { path: '/cache/1.mp4', mode: 'remux' });
  assert.equal((await plain).name, 'AbortError');
});

test('a new prepare for the same video with another audio track aborts the previous job', async () => {
  const { log, call } = harness();
  log.held.add(1);

  const first = call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 1 }).catch((err) => err);
  const second = await call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 2 });

  assert.deepEqual(second, { path: '/cache/2.mp4', mode: 'remux' });
  assert.equal((await first).name, 'AbortError');
  assert.equal(log.prepares[0].signal.aborted, true);
  assert.equal(log.prepares[1].signal.aborted, false);
});

test('repeat prepares for the same audio track share one job, and media:cancel stops it', async () => {
  const { log, call } = harness();
  log.held.add(1);

  const a = call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 1 }).catch((err) => err);
  const b = call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 1 }).catch((err) => err);
  assert.equal(log.prepares.length, 1);

  assert.deepEqual(await call('media:cancel', '/v/a.mkv'), { ok: true });
  assert.equal((await a).name, 'AbortError');
  assert.equal((await b).name, 'AbortError');
  assert.deepEqual(await call('media:cancel', '/v/none.mkv'), { ok: true });
});

test('stop aborts converter jobs that are still running', async () => {
  const { log, call, features } = harness();
  log.held.add(1);

  const job = call('media:prepare', { videoPath: '/v/a.mkv', audioStreamIndex: 1 }).catch((err) => err);
  features.stop();

  assert.equal((await job).name, 'AbortError');
  assert.equal(log.prepares[0].signal.aborted, true);
});

test('media:cacheInfo and media:clearCache delegate to the converter cache', async () => {
  const { log, call } = harness();

  assert.deepEqual(await call('media:cacheInfo'), { bytes: 2048 });
  assert.deepEqual(await call('media:clearCache'), { ok: true });
  assert.equal(log.cleared, 1);
});

test('player:loadCues prefers the linked subtitle and reports source none when nothing is available', async () => {
  const { log, call } = harness();
  log.subs['/v/a.mkv'] = '/subs/a.srt';

  assert.deepEqual(await call('player:loadCues', '/v/a.mkv'), {
    cues: log.externalCues,
    subtitlePath: '/subs/a.srt',
    source: 'external',
    embeddedIndex: null,
  });
  assert.deepEqual(await call('player:loadCues', '/v/b.mkv'), {
    cues: [],
    subtitlePath: null,
    source: 'none',
    embeddedIndex: null,
  });
  assert.equal(log.extracts.length, 0);
});

test('player:loadCues with embeddedIndex extracts once and caches the cues as JSON in embedded-subs', async () => {
  const { dir, log, call } = harness();
  const video = path.join(dir, 'ep.mkv');
  await fs.writeFile(video, 'video');

  const first = await call('player:loadCues', video, { embeddedIndex: 4 });
  const second = await call('player:loadCues', video, { embeddedIndex: 4 });

  assert.deepEqual(first, { cues: EMBEDDED, subtitlePath: null, source: 'embedded', embeddedIndex: 4 });
  assert.deepEqual(second, first);
  assert.deepEqual(log.extracts, [{ video, streamIndex: 4 }]);
  const stat = await fs.stat(video);
  const key = crypto.createHash('sha1').update(`${video}|${stat.mtimeMs}|${stat.size}|4`).digest('hex');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'embedded-subs', `${key}.json`), 'utf8')), EMBEDDED);
  await assert.rejects(call('player:loadCues', video, { embeddedIndex: -1 }), /embeddedIndex must be a non-negative integer/);
});

test('player:loadCues with auto picks the default Japanese subtitle track when nothing is linked', async () => {
  const { dir, log, call } = harness();
  const video = path.join(dir, 'c.mkv');
  await fs.writeFile(video, 'video');

  const result = await call('player:loadCues', video, { auto: true });

  assert.deepEqual(result, { cues: EMBEDDED, subtitlePath: null, source: 'embedded', embeddedIndex: 4 });
  assert.deepEqual(log.extracts, [{ video, streamIndex: 4 }]);
});

test('known:stats and known:mark report word counts and save changes', async () => {
  const { log, call } = harness();
  log.words.set('雨', 'known');

  assert.deepEqual(await call('known:stats'), { known: 1, learning: 0 });
  assert.deepEqual(await call('known:mark', { word: '降る', status: 'learning' }), { ok: true, stats: { known: 1, learning: 1 } });
  assert.equal(log.saves, 1);
  await assert.rejects(call('known:mark', { word: '', status: 'known' }), /word must be a non-empty string/);
});

test('known:importAnki passes deck, field and matureOnly to the store using settings.ankiUrl', async () => {
  const { log, call } = harness();

  assert.deepEqual(await call('known:importAnki', { deck: 'Core', field: 'Expression', matureOnly: true }), {
    added: 2,
    skipped: 1,
    notes: 3,
  });
  assert.deepEqual(log.imports.map((item) => item.opts), [{ deck: 'Core', field: 'Expression', matureOnly: true }]);
  assert.deepEqual(log.clients, ['http://anki.test']);
  assert.equal(log.saves, 1);
  await assert.rejects(call('known:importAnki', { deck: '' }), /deck must be a non-empty string/);
});

test('known:ankiFields lists the note fields of a deck and suggests the word field', async () => {
  const { log, call } = harness();

  assert.deepEqual(await call('known:ankiFields', { deck: 'Core' }), { fields: ['Word', 'Expression'], suggested: 'Word' });
  assert.deepEqual(log.invokes[0], { action: 'findNotes', params: { query: 'deck:"Core"' } });
  await assert.rejects(call('known:ankiFields', {}), /deck must be a non-empty string/);
});

test('known:importText skips comments and keeps the first tab column', async () => {
  const { log, call } = harness();

  assert.deepEqual(await call('known:importText', '雨\n# comment\n降る\tto fall\n\n'), { added: 2, skipped: 0 });
  assert.deepEqual(log.addManyCalls, [{ words: ['雨', '降る'], status: 'known', source: 'text' }]);
  assert.equal(log.saves, 1);
});

test('known:classify returns per-token statuses and the sentence summary with only base, surface and reading', async () => {
  const { log, call } = harness();
  log.words.set('雨', 'known');
  const tokens = [tok('雨', 'あめ'), tok('降る', 'ふる'), tok('。', '', false)];

  assert.deepEqual(await call('known:classify', tokens), {
    statuses: ['known', 'new', 'skip'],
    info: {
      newWords: [{ base: '降る', surface: '降る', reading: 'ふる' }],
      unknownCount: 1,
      isIPlusOne: true,
    },
  });
  await assert.rejects(call('known:classify', 'x'), /tokens must be an array/);
});

test('known:coverage is null without subtitles and caches results until the vocabulary changes', async () => {
  const { dir, log, call } = harness();
  log.subs['/v/ep1.mkv'] = await subtitleFile(dir, 'ep1.srt', 'ep1');
  log.externalCues = [
    { start: 0, end: 1, text: '雨 降る' },
    { start: 1, end: 2, text: '雨 猫 猫' },
  ];
  log.words.set('雨', 'known');

  assert.equal(await call('known:coverage', { videoPath: '/v/none.mkv' }), null);

  const expected = {
    coverage: 0.4,
    totalWords: 5,
    knownWords: 2,
    learningWords: 0,
    newWords: 3,
    uniqueNew: 2,
    topNew: [
      { word: '猫', count: 2 },
      { word: '降る', count: 1 },
    ],
  };
  assert.deepEqual(await call('known:coverage', { videoPath: '/v/ep1.mkv' }), expected);
  assert.equal(log.tokenized, 2);

  assert.deepEqual(await call('known:coverage', { videoPath: '/v/ep1.mkv' }), expected);
  assert.equal(log.tokenized, 2, 'cache hit must not tokenize again');

  await call('known:mark', { word: '降る', status: 'known' });
  const after = await call('known:coverage', { videoPath: '/v/ep1.mkv' });
  assert.equal(log.tokenized, 4, 'changed known counts must recompute');
  assert.equal(after.knownWords, 3);
  assert.deepEqual(after.topNew, [{ word: '猫', count: 2 }]);
});

test('known:coverage recomputes when a vocabulary change keeps the known and learning counts', async () => {
  const { dir, log, call } = harness();
  log.subs['/v/ep2.mkv'] = await subtitleFile(dir, 'ep2.srt', 'two');
  log.externalCues = [{ start: 0, end: 1, text: '雨 雨 猫' }];
  log.words.set('雨', 'known');
  log.words.set('猫', 'learning');

  const before = await call('known:coverage', { videoPath: '/v/ep2.mkv' });
  await call('known:mark', { word: '雨', status: 'learning' });
  await call('known:mark', { word: '猫', status: 'known' });
  const after = await call('known:coverage', { videoPath: '/v/ep2.mkv' });

  assert.deepEqual([before.knownWords, before.learningWords], [2, 1]);
  assert.deepEqual([after.knownWords, after.learningWords], [1, 2]);
});

test('known:coverage recomputes when the linked subtitle file changes', async () => {
  const { dir, log, call } = harness();
  const file = await subtitleFile(dir, 'ep3.srt', 'one');
  log.subs['/v/ep3.mkv'] = file;
  log.externalCues = [{ start: 0, end: 1, text: '雨' }];

  const first = await call('known:coverage', { videoPath: '/v/ep3.mkv' });
  await fs.writeFile(file, 'two two');
  log.externalCues = [{ start: 0, end: 1, text: '雨 猫' }];
  const second = await call('known:coverage', { videoPath: '/v/ep3.mkv' });

  assert.equal(first.totalWords, 1);
  assert.equal(second.totalWords, 2);
});

test('concurrent known:coverage calls persist every entry to coverage.json', async () => {
  const { dir, log, call } = harness();
  log.subs['/v/x.mkv'] = await subtitleFile(dir, 'x.srt', 'x');
  log.subs['/v/y.mkv'] = await subtitleFile(dir, 'y.srt', 'yy');

  await Promise.all([call('known:coverage', { videoPath: '/v/x.mkv' }), call('known:coverage', { videoPath: '/v/y.mkv' })]);

  const cache = JSON.parse(await fs.readFile(path.join(dir, 'coverage.json'), 'utf8'));
  assert.equal(Object.keys(cache).length, 2);
  assert.deepEqual((await fs.readdir(dir)).filter((name) => name.endsWith('.tmp')), []);
});

test('lookup:at without a downloaded dictionary returns the empty shape and never looks up', async () => {
  const { log, call } = harness();
  log.dictReady = false;

  assert.deepEqual(await call('lookup:at', { text: '雨が降る', index: 2 }), {
    span: null,
    entries: [],
    dictForm: null,
    inflection: [],
    pitch: null,
  });
  assert.equal(log.dictLoads, 0);
  assert.deepEqual(log.lookups, []);
});

test('lookup:at returns the match with pitch accents from PitchAccent', async () => {
  const { log, call } = harness();
  const entries = [{ id: 1, kanji: ['降る'], kana: ['ふる'], common: true, senses: [] }];
  log.lookupHit = {
    span: { startToken: 2, endToken: 2, start: 2, end: 4, text: '降る' },
    entries,
    dictForm: '降る',
    inflection: [],
  };

  assert.deepEqual(await call('lookup:at', { text: '雨 降る', index: 1 }), {
    span: log.lookupHit.span,
    entries,
    dictForm: '降る',
    inflection: [],
    pitch: {
      reading: 'ふる',
      accents: [
        {
          accent: 0,
          label: 'heiban',
          mora: [
            { mora: 'ふ', high: false },
            { mora: 'る', high: true },
          ],
        },
      ],
    },
  });
  assert.deepEqual(log.pitchLookups[0], { word: '降る', reading: 'ふる' });
});

test('lookup:at reports pitch null when the accent data is not downloaded', async () => {
  const { log, call } = harness();
  log.pitchReady = false;
  log.lookupHit = { span: null, entries: [{ id: 1, kanji: ['降る'], kana: ['ふる'], senses: [] }], dictForm: '降る', inflection: [] };

  const result = await call('lookup:at', { text: '降る', index: 0 });

  assert.equal(result.pitch, null);
  assert.equal(result.dictForm, '降る');
});

test('pitch:status reports readiness and pitch:download emits pitch:progress', async () => {
  const { log, notified, call } = harness();
  log.pitchReady = false;

  assert.deepEqual(await call('pitch:status'), { ready: false });
  assert.deepEqual(await call('pitch:download'), { ready: true });
  assert.deepEqual(notified, [{ channel: 'pitch:progress', payload: 0.5 }]);
  assert.deepEqual(await call('pitch:status'), { ready: true });
});

test('progress:update merges a whitelisted patch and rejects derived fields', async () => {
  const { call } = harness();

  const entry = await call('progress:update', { videoPath: '/v/a.mkv', patch: { position: 300, subOffset: 0.5 } });

  assert.equal(entry.position, 300);
  assert.equal(entry.subOffset, 0.5);
  assert.deepEqual(await call('progress:get', '/v/a.mkv'), entry);
  await assert.rejects(call('progress:update', { videoPath: '/v/a.mkv', patch: { finished: true } }), /Cannot update progress field\(s\): finished/);
});

test('progress:update rejects out-of-range values and accepts the values the player persists', async () => {
  const { log, call } = harness();
  const invalid = [
    ['position', -1], ['position', NaN], ['duration', Infinity], ['duration', '12'],
    ['subOffset', 601], ['subOffset', -600.5], ['subOffset', NaN],
    ['audioStreamIndex', -1], ['audioStreamIndex', 1.5], ['audioStreamIndex', '1'],
    ['subtitle', 'on'], ['subtitle', -1], ['subtitle', { kind: 'bogus', index: 1 }], ['subtitle', { kind: 'embedded', index: -2 }],
  ];
  for (const [key, value] of invalid) {
    await assert.rejects(call('progress:update', { videoPath: '/v/a.mkv', patch: { [key]: value } }), new RegExp(`Invalid progress value: ${key}$`));
  }
  assert.deepEqual(log.progress, {});

  for (const patch of [
    { position: 0, duration: 1320, subOffset: 600, audioStreamIndex: null, subtitle: null },
    { subtitle: 'off' },
    { subtitle: 4 },
    { subtitle: { kind: 'embedded', index: null } },
    { subtitle: { kind: 'external', index: 0 } },
  ]) {
    await call('progress:update', { videoPath: '/v/a.mkv', patch });
  }
  assert.deepEqual((await call('progress:get', '/v/a.mkv')).subtitle, { kind: 'external', index: 0 });
});

test('progress:continue uses the library scan and progress:next follows episode order', async () => {
  const { log, call } = harness();
  log.shows = [
    {
      title: 'Show',
      episodes: [
        { path: '/v/s1e1.mkv', season: 1, episode: 1 },
        { path: '/v/s1e2.mkv', season: 1, episode: 2 },
      ],
    },
  ];

  assert.deepEqual(await call('progress:continue'), ['cw']);
  assert.deepEqual(log.continueCalls[0].shows, log.shows);
  assert.deepEqual(await call('progress:next', '/v/s1e1.mkv'), log.shows[0].episodes[1]);
  assert.equal(await call('progress:next', '/v/s1e2.mkv'), null);
});

test('ai:translate sends the sentence with the AI settings and up to two context lines', async () => {
  const { log, call } = harness();

  assert.equal(await call('ai:translate', { sentence: '雨が降ってる', context: ['前', '次'] }), 'It is raining.');

  assert.deepEqual(log.translateCalls[0].req, { sentence: '雨が降ってる', context: '前\n次' });
  assert.equal(log.translateCalls[0].ai.apiKey, 'k');
  await assert.rejects(call('ai:translate', { sentence: '  ' }), /sentence must be a non-empty string/);
});

test('anki:preview returns the clip audio and frame as data URLs using clamped padding', async () => {
  const { log, call } = harness();
  log.settings.audioPadStart = 9;
  log.settings.audioPadEnd = 0.4;

  assert.deepEqual(await call('anki:preview', { videoPath: '/v/a.mkv', cue: { start: 10, end: 14 }, audioStreamIndex: 1 }), {
    audio: `data:audio/mpeg;base64,${Buffer.from('mp3').toString('base64')}`,
    picture: `data:image/jpeg;base64,${Buffer.from('jpg').toString('base64')}`,
  });
  assert.deepEqual(log.media.map((item) => item.args), [
    { video: '/v/a.mkv', start: 10, end: 14, padStart: 5, padEnd: 0.4, audioStream: 1 },
    { video: '/v/a.mkv', time: 12 },
  ]);
  await assert.rejects(call('anki:preview', { videoPath: '/v/a.mkv', cue: { start: 5, end: 2 } }), /0 <= start < end/);
  assert.equal(log.media.length, 2);
});

test('markMined adds the base form as learning through addMany and saves', async () => {
  const { log, features } = harness();

  features.markMined({ base: '降る' });

  assert.deepEqual(log.addManyCalls, [{ words: ['降る'], status: 'learning', source: 'mined' }]);
  assert.equal(log.saves, 1);
});
