const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createServices } = require('../src/main/services');

let root;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'anime-mine-services-'));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function newLog() {
  return {
    folders: [],
    linked: [],
    subtitles: {},
    watched: [],
    watchStops: 0,
    notified: [],
    dialogOptions: [],
    dialogResult: { canceled: true, filePaths: [] },
    ankiUrls: [],
    setup: [],
    cards: [],
    audioCalls: [],
    screenshotCalls: [],
    explainCalls: [],
    dictReady: false,
    translateCalls: [],
    translateFails: false,
    addCardError: null,
  };
}

function fakeLibrary(log) {
  return class FakeLibrary {
    getFolders() {
      return [...log.folders];
    }

    addFolder(dir) {
      log.folders.push(dir);
    }

    removeFolder(dir) {
      log.folders = log.folders.filter((folder) => folder !== dir);
    }

    async scan() {
      return log.folders.map((folder) => ({ title: path.basename(folder), episodes: [] }));
    }

    async linkSubtitle(videoPath, subtitlePath) {
      log.linked.push([videoPath, subtitlePath]);
      return `/stored/${path.basename(subtitlePath)}`;
    }

    getSubtitle(videoPath) {
      return log.subtitles[videoPath] ?? null;
    }

    watchDownloads(dir, onLinked) {
      log.watched.push({ dir, onLinked });
      return () => {
        log.watchStops += 1;
      };
    }
  };
}

function fakeAnkiClient(log) {
  return class FakeAnkiClient {
    constructor(url) {
      log.ankiUrls.push(url);
    }

    async ping() {
      return true;
    }

    async ensureSetup(deck, model) {
      log.setup.push({ deck, model });
    }

    async addCard(card) {
      if (log.addCardError) throw new Error(log.addCardError);
      log.cards.push(card);
      return 42;
    }
  };
}

function fakeDictionary(log) {
  return class FakeDictionary {
    isReady() {
      return log.dictReady;
    }

    async download(onProgress) {
      onProgress(0.5);
      log.dictReady = true;
    }
  };
}

function fakeMedia(log) {
  return {
    async extractAudio(args) {
      log.audioCalls.push(args);
      return Buffer.from('mp3');
    },
    async screenshot(args) {
      log.screenshotCalls.push(args);
      return Buffer.from('jpg');
    },
  };
}

function fakeExplain(log) {
  return async (ai, req) => {
    log.explainCalls.push({ ai, req });
    return 'explanation';
  };
}

function fakeTranslate(log) {
  return async (ai, req) => {
    log.translateCalls.push({ ai, req });
    if (log.translateFails) throw new Error('AI offline');
    return 'It is raining.';
  };
}

async function parseSrtFile(file) {
  const text = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
  const toSeconds = (stamp) => {
    const [h, m, rest] = stamp.split(':');
    const [s, ms] = rest.split(',');
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  };
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.split(/\r?\n/))
    .filter((lines) => lines.some((line) => line.includes('-->')))
    .map((lines) => {
      const [start, end] = lines.find((line) => line.includes('-->')).split(' --> ');
      const textLines = lines.slice(lines.findIndex((line) => line.includes('-->')) + 1);
      return {
        start: toSeconds(start.trim()),
        end: toSeconds(end.trim()),
        text: textLines.join('\n').replace(/<[^>]+>/g, '').trim(),
      };
    });
}

async function setup({ dataDir } = {}) {
  const dir = dataDir ?? (await fs.mkdtemp(path.join(root, 'case-')));
  const log = newLog();
  const dialog = {
    async showOpenDialog(options) {
      log.dialogOptions.push(options);
      return log.dialogResult;
    },
  };
  const services = createServices({
    dataDir: dir,
    dialog,
    notify: (channel, payload) => log.notified.push({ channel, payload }),
    deps: {
      Library: fakeLibrary(log),
      Dictionary: fakeDictionary(log),
      AnkiClient: fakeAnkiClient(log),
      media: fakeMedia(log),
      explain: fakeExplain(log),
      translate: fakeTranslate(log),
      parseSubtitleFile: parseSrtFile,
    },
  });
  return { dir, log, services, call: (channel, ...args) => services.handlers[channel](...args) };
}

test('exposes every IPC channel from the contract', async () => {
  const { services } = await setup();
  assert.deepEqual(Object.keys(services.handlers).sort(), [
    'ai:explain',
    'ai:translate',
    'anki:browse',
    'anki:deleteNote',
    'anki:getView',
    'anki:listDecks',
    'anki:media',
    'anki:mine',
    'anki:openInAnki',
    'anki:overview',
    'anki:preview',
    'anki:recent',
    'anki:setView',
    'anki:setup',
    'anki:status',
    'anki:updateNote',
    'dict:download',
    'dict:lookup',
    'dict:status',
    'known:ankiFields',
    'known:classify',
    'known:coverage',
    'known:importAnki',
    'known:importText',
    'known:mark',
    'known:stats',
    'library:addFolder',
    'library:getFolders',
    'library:getShows',
    'library:linkSubtitle',
    'library:removeFolder',
    'lookup:at',
    'media:cacheInfo',
    'media:cancel',
    'media:clearCache',
    'media:prepare',
    'media:probe',
    'nlp:tokenize',
    'pitch:download',
    'pitch:status',
    'player:loadCues',
    'progress:continue',
    'progress:get',
    'progress:next',
    'progress:update',
    'settings:get',
    'settings:set',
  ]);
});

test('settings:get returns defaults when no settings file exists', async () => {
  const { call } = await setup();
  assert.deepEqual(await call('settings:get'), {
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
  });
});

test('settings:set persists to settings.json and deep-merges ai', async () => {
  const { dir, call } = await setup();
  const result = await call('settings:set', { audioPadStart: 0.3, ai: { model: 'other-model' } });

  assert.equal(result.audioPadStart, 0.3);
  assert.equal(result.audioPadEnd, 0.25);
  assert.deepEqual(result.ai, {
    provider: 'anthropic',
    apiKey: '',
    model: 'other-model',
    baseUrl: '',
  });
  const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'settings.json'), 'utf8'));
  assert.deepEqual(onDisk, result);

  const reloaded = await setup({ dataDir: dir });
  assert.deepEqual(await reloaded.call('settings:get'), result);
});

test('library:addFolder adds the chosen directory and returns shows', async () => {
  const { log, call } = await setup();
  log.dialogResult = { canceled: false, filePaths: ['/videos/anime'] };

  const shows = await call('library:addFolder');

  assert.deepEqual(log.dialogOptions[0].properties, ['openDirectory']);
  assert.deepEqual(log.folders, ['/videos/anime']);
  assert.deepEqual(shows, [{ title: 'anime', episodes: [] }]);
});

test('library:addFolder cancelled dialog adds nothing', async () => {
  const { log, call } = await setup();
  log.folders.push('/videos/existing');

  const shows = await call('library:addFolder');

  assert.deepEqual(log.folders, ['/videos/existing']);
  assert.deepEqual(shows, [{ title: 'existing', episodes: [] }]);
});

test('library:linkSubtitle returns the stored path of the chosen file', async () => {
  const { log, call } = await setup();
  log.dialogResult = { canceled: false, filePaths: ['/downloads/ep05.ass'] };

  const stored = await call('library:linkSubtitle', '/videos/ep05.mkv');

  assert.equal(stored, '/stored/ep05.ass');
  assert.deepEqual(log.linked, [['/videos/ep05.mkv', '/downloads/ep05.ass']]);
  assert.deepEqual(log.dialogOptions[0].filters[0].extensions, ['srt', 'ass', 'ssa', 'vtt']);
});

test('anki:mine in word mode maps fields and sends media with cue times and padding', async () => {
  const { log, call } = await setup();

  const result = await call('anki:mine', {
    videoPath: '/videos/Show S01E05.mkv',
    cue: { start: 10, end: 14, text: '雨が降ってる' },
    mode: 'word',
    word: { surface: '降ってる', base: '降る', reading: 'ふる' },
    meaning: 'to fall (of rain)',
    translation: 'It is raining.',
  });

  assert.deepEqual(result, { noteId: 42 });
  assert.deepEqual(log.audioCalls, [
    { video: '/videos/Show S01E05.mkv', start: 10, end: 14, padStart: 0.15, padEnd: 0.25 },
  ]);
  assert.deepEqual(log.screenshotCalls, [{ video: '/videos/Show S01E05.mkv', time: 12 }]);
  assert.deepEqual(log.setup, [{ deck: 'Anime Mining', model: 'AnimeMine' }]);
  assert.equal(log.cards.length, 1);
  const card = log.cards[0];
  assert.equal(card.deck, 'Anime Mining');
  assert.equal(card.model, 'AnimeMine');
  assert.deepEqual(card.fields, {
    Word: '降る',
    Reading: 'ふる',
    Meaning: 'to fall (of rain)',
    Sentence: '雨が<b>降ってる</b>',
    SentenceTranslation: 'It is raining.',
    Notes: '',
    Source: 'Show S01E05',
  });
  assert.match(card.audio.filename, /^am_\d+\.mp3$/);
  assert.equal(card.audio.data.toString(), 'mp3');
  assert.match(card.picture.filename, /^am_\d+\.jpg$/);
  assert.equal(card.picture.data.toString(), 'jpg');
});

test('anki:mine in sentence mode leaves Word empty and uses padding from settings', async () => {
  const { log, call } = await setup();
  await call('settings:set', { audioPadStart: 0.3, audioPadEnd: 0.4 });

  await call('anki:mine', {
    videoPath: '/videos/Show S01E05.mkv',
    cue: { start: 2, end: 4, text: 'おはよう' },
    mode: 'sentence',
    translation: 'Good morning.',
  });

  assert.deepEqual(log.audioCalls, [
    { video: '/videos/Show S01E05.mkv', start: 2, end: 4, padStart: 0.3, padEnd: 0.4 },
  ]);
  assert.deepEqual(log.cards[0].fields, {
    Word: 'おはよう',
    Reading: '',
    Meaning: '',
    Sentence: 'おはよう',
    SentenceTranslation: 'Good morning.',
    Notes: '',
    Source: 'Show S01E05',
  });
});

test('player:loadCues parses the linked srt file', async () => {
  const { dir, log, call } = await setup();
  const srtPath = path.join(dir, 'Show - 01.srt');
  await fs.writeFile(
    srtPath,
    '\uFEFF1\n00:00:01,000 --> 00:00:03,500\n<i>こんにちは</i>\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond line\n',
  );
  log.subtitles['/videos/Show - 01.mkv'] = srtPath;

  const result = await call('player:loadCues', '/videos/Show - 01.mkv');

  assert.deepEqual(result, {
    cues: [
      { start: 1, end: 3.5, text: 'こんにちは' },
      { start: 4, end: 6, text: 'Second line' },
    ],
    subtitlePath: srtPath,
    source: 'external',
    embeddedIndex: null,
  });
});

test('player:loadCues without a linked subtitle returns no cues', async () => {
  const { call } = await setup();
  assert.deepEqual(await call('player:loadCues', '/videos/unlinked.mkv'), {
    cues: [],
    subtitlePath: null,
    source: 'none',
    embeddedIndex: null,
  });
});

test('settings:set downloadsDir restarts the downloads watcher', async () => {
  const { log, services, call } = await setup();
  await services.start();
  assert.equal(log.watched[0].dir, path.join(os.homedir(), 'Downloads'));

  await call('settings:set', { downloadsDir: '/new/downloads' });

  assert.equal(log.watchStops, 1);
  assert.equal(log.watched.length, 2);
  assert.equal(log.watched[1].dir, '/new/downloads');

  services.stop();
  assert.equal(log.watchStops, 2);
});

test('watcher linking a subtitle notifies library:updated', async () => {
  const { log, services } = await setup();
  await services.start();

  log.watched[0].onLinked({ name: 'Show - 05.mkv', path: '/videos/Show - 05.mkv' }, '/downloads/Show - 05.srt');

  assert.deepEqual(log.notified, [
    {
      channel: 'library:updated',
      payload: { message: 'Linked Show - 05.srt to Show - 05.mkv', videoPath: '/videos/Show - 05.mkv' },
    },
  ]);
});

test('dict:download reports progress and dict:status reflects readiness', async () => {
  const { log, call } = await setup();
  assert.deepEqual(await call('dict:status'), { ready: false });

  assert.deepEqual(await call('dict:download'), { ready: true });

  assert.deepEqual(log.notified, [{ channel: 'dict:progress', payload: 0.5 }]);
  assert.deepEqual(await call('dict:status'), { ready: true });
});

test('ai:explain passes settings.ai to explain', async () => {
  const { log, call } = await setup();
  await call('settings:set', { ai: { apiKey: 'secret' } });

  const text = await call('ai:explain', { sentence: '雨が降ってる' });

  assert.equal(text, 'explanation');
  assert.equal(log.explainCalls[0].ai.apiKey, 'secret');
  assert.deepEqual(log.explainCalls[0].req, { sentence: '雨が降ってる' });
});

test('anki:mine escapes every plain-text field and highlights the escaped surface', async () => {
  const { log, call } = await setup();

  await call('anki:mine', {
    videoPath: '/videos/<img src=x onerror=alert(1)>.mkv',
    cue: { start: 1, end: 3, text: '<img src=x onerror=alert(1)>降ってる\n"A & B"' },
    mode: 'word',
    word: { surface: '降ってる', base: '<img src=x onerror=alert(1)>', reading: "ふ'る" },
    meaning: '<script>x</script>\nline two',
    translation: "it's <b>raining</b> & more",
  });

  assert.deepEqual(log.cards[0].fields, {
    Word: '&lt;img src=x onerror=alert(1)&gt;',
    Reading: 'ふ&#39;る',
    Meaning: '&lt;script&gt;x&lt;/script&gt;<br>line two',
    Sentence: '&lt;img src=x onerror=alert(1)&gt;<b>降ってる</b><br>&quot;A &amp; B&quot;',
    SentenceTranslation: 'it&#39;s &lt;b&gt;raining&lt;/b&gt; &amp; more',
    Notes: '',
    Source: '&lt;img src=x onerror=alert(1)&gt;',
  });
});

test('anki:mine in sentence mode escapes the cue text used as Word', async () => {
  const { log, call } = await setup();

  await call('anki:mine', {
    videoPath: '/videos/Show.mkv',
    cue: { start: 2, end: 4, text: 'A<B>\nC' },
    mode: 'sentence',
  });

  assert.equal(log.cards[0].fields.Word, 'A&lt;B&gt;\nC');
  assert.equal(log.cards[0].fields.Sentence, 'A&lt;B&gt;<br>C');
});

test('anki:mine word mode falls back to the base form when reading is empty', async () => {
  const { log, call } = await setup();

  await call('anki:mine', {
    videoPath: '/videos/Show.mkv',
    cue: { start: 1, end: 2, text: '走った' },
    mode: 'word',
    word: { surface: '走った', base: '走る', reading: '' },
  });

  assert.equal(log.cards[0].fields.Word, '走る');
  assert.equal(log.cards[0].fields.Reading, '走る');
});

test('anki:mine rejects invalid input before extracting media or adding a card', async () => {
  const { log, call } = await setup();
  const base = { videoPath: '/videos/Show.mkv', cue: { start: 1, end: 3, text: 'x' }, mode: 'sentence' };
  const cases = [
    [{ ...base, videoPath: '' }, /videoPath must be a non-empty string/],
    [{ ...base, videoPath: 42 }, /videoPath must be a non-empty string/],
    [{ ...base, cue: undefined }, /finite numbers/],
    [{ ...base, cue: { start: 0, end: NaN, text: 'x' } }, /finite numbers/],
    [{ ...base, cue: { start: '1', end: 2, text: 'x' } }, /finite numbers/],
    [{ ...base, cue: { start: 3, end: 3, text: 'x' } }, /0 <= start < end/],
    [{ ...base, cue: { start: 5, end: 2, text: 'x' } }, /0 <= start < end/],
    [{ ...base, cue: { start: -1, end: 2, text: 'x' } }, /0 <= start < end/],
    [{ ...base, cue: { start: 0, end: 121, text: 'x' } }, /at most 120 seconds/],
  ];
  for (const [req, pattern] of cases) await assert.rejects(call('anki:mine', req), pattern);
  assert.deepEqual(log.audioCalls, []);
  assert.deepEqual(log.cards, []);
});

test('anki:mine accepts a cue exactly 120 seconds long', async () => {
  const { log, call } = await setup();
  await call('anki:mine', { videoPath: '/videos/Show.mkv', cue: { start: 0, end: 120, text: 'x' }, mode: 'sentence' });
  assert.equal(log.cards.length, 1);
});

test('anki:mine clamps padding settings to 0..5 seconds', async () => {
  const { log, call } = await setup();
  await call('settings:set', { audioPadStart: 99, audioPadEnd: -2 });

  await call('anki:mine', { videoPath: '/videos/Show.mkv', cue: { start: 2, end: 4, text: 'x' }, mode: 'sentence' });

  assert.deepEqual(log.audioCalls, [{ video: '/videos/Show.mkv', start: 2, end: 4, padStart: 5, padEnd: 0 }]);
});

test('settings:set writes settings.json readable only by the owner', async () => {
  const { dir, call } = await setup();
  const file = path.join(dir, 'settings.json');
  await fs.writeFile(file, '{}', { mode: 0o644 });
  await fs.chmod(file, 0o644);

  await call('settings:set', { audioPadStart: 0.2 });

  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

// Anki view: services built with a recording AnkiClient so every AnkiConnect touch is visible.
async function ankiHarness({ responses = {}, ping = true } = {}) {
  const log = newLog();
  const calls = [];
  class RecordingAnki {
    constructor(url) {
      calls.push({ type: 'client', url });
    }

    async ping() {
      calls.push({ type: 'ping' });
      return ping;
    }

    async invoke(action, params = {}) {
      calls.push({ type: 'invoke', action, params });
      const reply = responses[action];
      if (reply === undefined) throw new Error(`unexpected AnkiConnect action ${action}`);
      return typeof reply === 'function' ? reply(params) : reply;
    }
  }
  const dir = await fs.mkdtemp(path.join(root, 'anki-'));
  const services = createServices({
    dataDir: dir,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    deps: {
      Library: fakeLibrary(log),
      Dictionary: fakeDictionary(log),
      AnkiClient: RecordingAnki,
      media: fakeMedia(log),
      explain: fakeExplain(log),
      parseSubtitleFile: parseSrtFile,
    },
  });
  return { calls, call: (channel, ...args) => services.handlers[channel](...args), dir };
}

const invokes = (calls) => calls.filter((c) => c.type !== 'client' && c.type !== 'ping');

test('hidden anki view makes zero AnkiConnect requests for every anki channel', async () => {
  const { calls, call } = await ankiHarness({ responses: { deckNames: () => ['Real Deck'] } });
  await call('anki:setView', { visibleDecks: ['Visible Deck'] });

  assert.deepEqual(await call('anki:getView'), { mode: 'hidden', connected: false, visibleDecks: ['Visible Deck'] });
  assert.deepEqual(await call('anki:listDecks'), []);
  assert.deepEqual(await call('anki:overview'), { mode: 'hidden' });
  assert.deepEqual(await call('anki:browse', { deck: 'Visible Deck', query: 'x', state: 'all', limit: 5 }), { cards: [] });
  assert.equal(await call('anki:media', 'clip.mp3'), null);
  assert.deepEqual(calls, []);
});

test('sample anki view returns sample data without any AnkiConnect request', async () => {
  const { calls, call } = await ankiHarness();
  await call('anki:setView', { mode: 'sample' });

  assert.deepEqual(await call('anki:getView'), { mode: 'sample', connected: false, visibleDecks: [] });
  const decks = await call('anki:listDecks');
  assert.equal(decks.length, 4);
  assert.ok(decks.every((name) => name.startsWith('Sample')));
  const overview = await call('anki:overview');
  assert.equal(overview.mode, 'sample');
  assert.equal(overview.decks.length, 4);
  assert.equal(overview.forecast.length, 22);
  assert.ok(overview.mined.length > 0);
  const { cards } = await call('anki:browse', { deck: decks[0], state: 'all', limit: 5 });
  assert.ok(cards.length > 0);
  assert.equal(await call('anki:media', 'clip.mp3'), null);
  assert.deepEqual(calls, []);
});

test('live anki view reports connected only after a successful ping', async () => {
  const live = await ankiHarness();
  await live.call('anki:setView', { mode: 'live', visibleDecks: ['Visible Deck'] });
  assert.deepEqual(await live.call('anki:getView'), { mode: 'live', connected: true, visibleDecks: ['Visible Deck'] });
  assert.deepEqual(await live.call('settings:get').then((s) => [s.ankiView, s.ankiVisibleDecks]), [
    'live',
    ['Visible Deck'],
  ]);

  const down = await ankiHarness({ ping: false });
  await down.call('anki:setView', { mode: 'live' });
  assert.equal((await down.call('anki:getView')).connected, false);
});

test('live overview only queries decks on the allow-list', async () => {
  const { calls, call } = await ankiHarness({
    responses: { multi: ({ actions }) => actions.map(() => []), findCards: () => [], findNotes: () => [] },
  });
  await call('anki:setView', { mode: 'live', visibleDecks: ['Visible Deck'] });

  const overview = await call('anki:overview');

  assert.equal(overview.mode, 'live');
  assert.deepEqual(overview.decks.map((deck) => deck.name), ['Visible Deck']);
  const queries = invokes(calls).flatMap((c) => (c.action === 'multi' ? c.params.actions : [c.params]))
    .map((a) => a.params?.query ?? a.query);
  assert.ok(queries.length > 0);
  assert.ok(queries.every((q) => !q.includes('Hidden Deck')));
});

test('live overview with an empty allow-list returns no decks, zero totals and no cards', async () => {
  const { calls, call } = await ankiHarness({ responses: { multi: () => [], findCards: () => [], findNotes: () => [] } });
  await call('anki:setView', { mode: 'live', visibleDecks: [] });

  const overview = await call('anki:overview');

  assert.deepEqual(overview.decks, []);
  assert.deepEqual(overview.today, { studied: 0, due: 0, learning: 0, new: 0 });
  assert.equal(overview.forecast.length, 22);
  assert.equal(overview.minedThisWeek, 0);
  assert.deepEqual(overview.mined, []);
  assert.deepEqual(invokes(calls), []);
});

test('live browse of a deck outside the allow-list throws Deck is hidden', async () => {
  const { calls, call } = await ankiHarness({ responses: { multi: () => [[], []], cardsInfo: () => [] } });
  await call('anki:setView', { mode: 'live', visibleDecks: ['Visible Deck'] });

  await assert.rejects(call('anki:browse', { deck: 'Hidden Deck', query: '', state: 'all' }), /Deck is hidden/);
  await assert.rejects(call('anki:browse', {}), /Deck is hidden/);
  assert.deepEqual(invokes(calls), []);
});

test('live browse keeps free text inside the visible deck scope', async () => {
  const { calls, call } = await ankiHarness({ responses: { multi: ({ actions }) => actions.map(() => []) } });
  await call('anki:setView', { mode: 'live', visibleDecks: ['Visible Deck'] });

  const { cards } = await call('anki:browse', { deck: 'Visible Deck', query: 'x" OR deck:"Hidden Deck', state: 'all' });

  assert.deepEqual(cards, []);
  const [multi] = invokes(calls);
  assert.equal(
    multi.params.actions[0].params.query,
    '(deck:"Visible Deck" -deck:"Visible Deck::*") "x\\" OR deck\\:\\"Hidden Deck"',
  );
});

test('setView rejects an invalid mode or non-string decks and persists nothing', async () => {
  const { dir, call } = await ankiHarness();
  await assert.rejects(call('anki:setView', { mode: 'public' }), /mode must be one of hidden, sample, live/);
  await assert.rejects(call('anki:setView', { mode: 'LIVE' }), /mode must be one of/);
  await assert.rejects(call('anki:setView', { visibleDecks: 'Deck' }), /visibleDecks must be an array of strings/);
  await assert.rejects(call('anki:setView', { visibleDecks: ['ok', 3] }), /visibleDecks must be an array of strings/);

  assert.equal((await call('settings:get')).ankiView, 'hidden');
  await assert.rejects(fs.access(path.join(dir, 'settings.json')), { code: 'ENOENT' });
});

test('setView replaces the allow-list and keeps the mode when only decks change', async () => {
  const { call } = await ankiHarness();
  await call('anki:setView', { mode: 'live', visibleDecks: ['A', 'B'] });
  const view = await call('anki:setView', { visibleDecks: ['C'] });

  assert.deepEqual(view, { mode: 'live', connected: true, visibleDecks: ['C'] });
});

test('anki:media rejects path-like filenames in every mode and fetches live media as a data URL', async () => {
  const { calls, call } = await ankiHarness({ responses: { retrieveMediaFile: () => 'AAEC' } });
  const bad = ['../secret.mp3', 'sub/clip.mp3', 'sub\\clip.mp3', 'a..b.mp3', '..'];
  for (const mode of ['hidden', 'sample', 'live']) {
    await call('anki:setView', { mode });
    for (const name of bad) await assert.rejects(call('anki:media', name), /Invalid media filename/, name);
  }
  assert.deepEqual(invokes(calls), []);

  await call('anki:setView', { mode: 'live', visibleDecks: ['Visible Deck'] });
  assert.equal(await call('anki:media', 'clip.mp3'), null);
  assert.deepEqual(invokes(calls), []);
});

test('anki:media only serves files a visible card exposed, and forgets them when the view changes', async () => {
  const card = { cardId: 1, deckName: 'Visible Deck', note: 1, ord: 0, queue: 2, type: 2, fields: { Word: { value: 'a', order: 0 }, Audio: { value: '[sound:clip.mp3]', order: 1 } } };
  const { calls, call } = await ankiHarness({
    responses: { multi: ({ actions }) => actions.map(() => [1]), cardsInfo: () => [card], retrieveMediaFile: () => 'AAEC' },
  });
  await call('anki:setView', { mode: 'live', visibleDecks: ['Visible Deck'] });
  assert.equal(await call('anki:media', 'clip.mp3'), null);

  await call('anki:browse', { deck: 'Visible Deck', query: '', state: 'all' });
  assert.equal(await call('anki:media', 'clip.mp3'), 'data:audio/mpeg;base64,AAEC');
  assert.equal(await call('anki:media', 'other.mp3'), null);
  assert.ok(invokes(calls).some((c) => c.action === 'retrieveMediaFile'));

  await call('anki:setView', { visibleDecks: [] });
  assert.equal(await call('anki:media', 'clip.mp3'), null);
});

// Note channels (setup, recent, updateNote, deleteNote, openInAnki): a fake AnkiClient records each call.
async function noteHarness({ notes = {}, ping = true, recent = [] } = {}) {
  const calls = [];
  class FakeNoteAnki {
    constructor(url) {
      calls.push({ method: 'constructor', args: [url] });
    }

    async ping() {
      calls.push({ method: 'ping', args: [] });
      return ping;
    }

    async ensureSetup(deck, model) {
      calls.push({ method: 'ensureSetup', args: [deck, model] });
    }

    async recentNotes(deck, model, limit) {
      calls.push({ method: 'recentNotes', args: [deck, model, limit] });
      return recent;
    }

    async noteModel(noteId) {
      calls.push({ method: 'noteModel', args: [noteId] });
      return notes[noteId] ?? null;
    }

    async updateNoteFields(noteId, fields) {
      calls.push({ method: 'updateNoteFields', args: [noteId, fields] });
    }

    async deleteNotes(ids) {
      calls.push({ method: 'deleteNotes', args: [ids] });
    }

    async guiBrowse(query) {
      calls.push({ method: 'guiBrowse', args: [query] });
    }
  }
  const log = newLog();
  const dir = await fs.mkdtemp(path.join(root, 'notes-'));
  const services = createServices({
    dataDir: dir,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    deps: {
      Library: fakeLibrary(log),
      Dictionary: fakeDictionary(log),
      AnkiClient: FakeNoteAnki,
      media: fakeMedia(log),
      explain: fakeExplain(log),
      parseSubtitleFile: parseSrtFile,
    },
  });
  return { calls, call: (channel, ...args) => services.handlers[channel](...args) };
}

const methodsOf = (calls) => calls.map((c) => c.method);
const WRITE_METHODS = ['updateNoteFields', 'deleteNotes', 'guiBrowse'];
const writesOf = (calls) => calls.filter((c) => WRITE_METHODS.includes(c.method));
const noteRow = (noteId, values) => ({
  noteId,
  modelName: 'AnimeMine',
  fields: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, order: 0 }])),
});

test('anki:setup creates the configured deck and model when AnkiConnect is reachable', async () => {
  const { calls, call } = await noteHarness();

  assert.deepEqual(await call('anki:setup'), { ok: true });
  assert.deepEqual(calls.filter((c) => c.method === 'ensureSetup'), [
    { method: 'ensureSetup', args: ['Anime Mining', 'AnimeMine'] },
  ]);
});

test('anki:setup throws a readable error when Anki is offline', async () => {
  const { calls, call } = await noteHarness({ ping: false });

  await assert.rejects(call('anki:setup'), /Cannot reach AnkiConnect at http:\/\/127\.0\.0\.1:8765/);
  assert.deepEqual(methodsOf(calls), ['constructor', 'ping']);
});

test('anki:recent maps notes to cards, parsing audio and picture filenames', async () => {
  const { calls, call } = await noteHarness({
    recent: [
      noteRow(1700000000002, {
        Word: '降る',
        Reading: 'ふる',
        Meaning: 'to fall',
        Sentence: '<b>降って</b>る',
        SentenceTranslation: 'It rains',
        Notes: 'n',
        Source: 'Show',
        Audio: '[sound:am_2.mp3]',
        Picture: '<img src="am_2.jpg">',
      }),
      noteRow(1700000000001, {
        Word: '',
        Reading: '  ',
        Sentence: 'おはよう',
        SentenceTranslation: 'Morning',
        Audio: '',
        Picture: '<img src=am_1.jpg>',
      }),
    ],
  });

  assert.deepEqual(await call('anki:recent'), [
    {
      noteId: 1700000000002,
      created: 1700000000002,
      word: '降る',
      reading: 'ふる',
      meaning: 'to fall',
      sentence: '<b>降って</b>る',
      translation: 'It rains',
      notes: 'n',
      source: 'Show',
      audio: 'am_2.mp3',
      picture: 'am_2.jpg',
      isSentenceCard: false,
    },
    {
      noteId: 1700000000001,
      created: 1700000000001,
      word: '',
      reading: '  ',
      meaning: '',
      sentence: 'おはよう',
      translation: 'Morning',
      notes: '',
      source: '',
      audio: null,
      picture: 'am_1.jpg',
      isSentenceCard: true,
    },
  ]);
  assert.deepEqual(calls.filter((c) => c.method === 'recentNotes'), [
    { method: 'recentNotes', args: ['Anime Mining', 'AnimeMine', 30] },
  ]);
});

test('anki:recent clamps the limit to 1..100 and defaults to 30', async () => {
  const { calls, call } = await noteHarness();

  for (const limit of [undefined, 0, -5, 500, 12.9, 'abc']) await call('anki:recent', limit);

  assert.deepEqual(
    calls.filter((c) => c.method === 'recentNotes').map((c) => c.args[2]),
    [30, 1, 1, 100, 12, 30],
  );
});

test('update, delete and open refuse notes that are not of the configured model', async () => {
  const { calls, call } = await noteHarness({ notes: { 7: 'Basic', 8: null } });

  await assert.rejects(call('anki:updateNote', { noteId: 7, fields: { Meaning: 'x' } }), /Not an anime-mine note/);
  await assert.rejects(call('anki:deleteNote', 7), /Not an anime-mine note/);
  await assert.rejects(call('anki:openInAnki', 8), /Not an anime-mine note/);
  assert.deepEqual(writesOf(calls), []);
});

test('update, delete and open reject non-integer or non-positive note ids before contacting Anki', async () => {
  const { calls, call } = await noteHarness({ notes: { 7: 'AnimeMine' } });

  for (const noteId of [0, -1, 1.5, '7', NaN, Infinity, null, undefined]) {
    await assert.rejects(call('anki:updateNote', { noteId, fields: { Meaning: 'x' } }), /noteId must be a positive integer/);
    await assert.rejects(call('anki:deleteNote', noteId), /noteId must be a positive integer/);
    await assert.rejects(call('anki:openInAnki', noteId), /noteId must be a positive integer/);
  }
  assert.deepEqual(calls, []);
});

test('updateNote rejects field keys outside Meaning, SentenceTranslation and Notes', async () => {
  const { calls, call } = await noteHarness({ notes: { 7: 'AnimeMine' } });
  const badFields = [{ Word: 'x' }, { Sentence: 'x' }, { Audio: '[sound:x.mp3]' }, { Meaning: 'ok', Reading: 'x' }, { ['__proto__']: 'x' }];

  for (const fields of badFields) {
    await assert.rejects(call('anki:updateNote', { noteId: 7, fields }), /Cannot edit field\(s\)/);
  }
  await assert.rejects(call('anki:updateNote', { noteId: 7, fields: 'Meaning' }), /fields must be an object/);
  await assert.rejects(call('anki:updateNote', { noteId: 7, fields: { Meaning: 5 } }), /Meaning must be a string/);
  assert.deepEqual(calls, []);
});

test('updateNote HTML-escapes plain text and turns newlines into <br>', async () => {
  const { calls, call } = await noteHarness({ notes: { 7: 'AnimeMine' } });

  const result = await call('anki:updateNote', {
    noteId: 7,
    fields: { Meaning: `<b>"x"</b> & 'y'\nline`, SentenceTranslation: 'a\r\nb', Notes: '' },
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(writesOf(calls), [
    {
      method: 'updateNoteFields',
      args: [
        7,
        {
          Meaning: '&lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; &#39;y&#39;<br>line',
          SentenceTranslation: 'a<br>b',
          Notes: '',
        },
      ],
    },
  ]);
});

test('deleteNote and openInAnki act on the validated note only', async () => {
  const { calls, call } = await noteHarness({ notes: { 7: 'AnimeMine' } });

  assert.deepEqual(await call('anki:deleteNote', 7), { ok: true });
  assert.deepEqual(await call('anki:openInAnki', 7), { ok: true });
  assert.deepEqual(writesOf(calls), [
    { method: 'deleteNotes', args: [[7]] },
    { method: 'guiBrowse', args: ['nid:7'] },
  ]);
});

// Mining extras: audio stream, field overrides, context, timing, auto-translate, learning mark, duplicates.
const MINE_BASE = { videoPath: '/videos/Show.mkv', cue: { start: 10, end: 14, text: '雨が降ってる' }, mode: 'sentence' };

test('anki:mine passes audioStreamIndex through as audioStream and rejects bad indexes', async () => {
  const { log, call } = await setup();

  await call('anki:mine', { ...MINE_BASE, audioStreamIndex: 1 });

  assert.deepEqual(log.audioCalls, [
    { video: '/videos/Show.mkv', start: 10, end: 14, padStart: 0.15, padEnd: 0.25, audioStream: 1 },
  ]);
  for (const audioStreamIndex of [-1, 1.5, '1']) {
    await assert.rejects(call('anki:mine', { ...MINE_BASE, audioStreamIndex }), /audioStreamIndex must be a non-negative integer/);
  }
  assert.equal(log.audioCalls.length, 1);
});

test('anki:mine field overrides are escaped like generated fields and keep the highlighted sentence', async () => {
  const { log, call } = await setup();

  await call('anki:mine', {
    ...MINE_BASE,
    mode: 'word',
    word: { surface: '降ってる', base: '降る', reading: 'ふる' },
    fields: {
      Word: 'a&b',
      Reading: "ふ'る",
      Meaning: '<b>x</b>\nline',
      SentenceTranslation: 't & u',
      Notes: 'n <i>1</i>\r\n2',
    },
  });

  assert.deepEqual(log.cards[0].fields, {
    Word: 'a&amp;b',
    Reading: 'ふ&#39;る',
    Meaning: '&lt;b&gt;x&lt;/b&gt;<br>line',
    Sentence: '雨が<b>降ってる</b>',
    SentenceTranslation: 't &amp; u',
    Notes: 'n &lt;i&gt;1&lt;/i&gt;<br>2',
    Source: 'Show',
  });
});

test('anki:mine rejects unknown or non-string field overrides before extracting anything', async () => {
  const { log, call } = await setup();

  await assert.rejects(call('anki:mine', { ...MINE_BASE, fields: { Sentence: 'x' } }), /Cannot set field\(s\): Sentence/);
  await assert.rejects(call('anki:mine', { ...MINE_BASE, fields: { Source: 'x', Audio: 'y' } }), /Cannot set field\(s\): Source, Audio/);
  await assert.rejects(call('anki:mine', { ...MINE_BASE, fields: { Notes: 3 } }), /Notes must be a string/);
  await assert.rejects(call('anki:mine', { ...MINE_BASE, fields: ['Notes'] }), /fields must be an object/);
  assert.deepEqual(log.audioCalls, []);
  assert.deepEqual(log.cards, []);
});

test('anki:mine accepts at most two context lines', async () => {
  const { log, call } = await setup();

  await assert.rejects(call('anki:mine', { ...MINE_BASE, context: ['a', 'b', 'c'] }), /context must be an array of at most 2 strings/);
  await assert.rejects(call('anki:mine', { ...MINE_BASE, context: 'a' }), /context must be an array/);
  assert.deepEqual(log.audioCalls, []);
});

test('anki:mine timing replaces the audio span, is validated, and keeps the screenshot at the cue midpoint', async () => {
  const { log, call } = await setup();

  await call('anki:mine', { ...MINE_BASE, timing: { start: 11, end: 12.5 } });

  assert.deepEqual(log.audioCalls, [
    { video: '/videos/Show.mkv', start: 11, end: 12.5, padStart: 0.15, padEnd: 0.25 },
  ]);
  assert.deepEqual(log.screenshotCalls, [{ video: '/videos/Show.mkv', time: 12 }]);
  await assert.rejects(call('anki:mine', { ...MINE_BASE, timing: { start: 6, end: 5 } }), /0 <= start < end/);
  await assert.rejects(call('anki:mine', { ...MINE_BASE, timing: { start: 0, end: 200 } }), /at most 120 seconds/);
  assert.equal(log.audioCalls.length, 1);
});

test('anki:mine auto-translates when enabled, a key is set and no translation was given', async () => {
  const { log, call } = await setup();
  await call('settings:set', { ai: { apiKey: 'secret' } });

  await call('anki:mine', { ...MINE_BASE, context: ['前の行', '次の行'] });

  assert.equal(log.translateCalls.length, 1);
  assert.equal(log.translateCalls[0].ai.apiKey, 'secret');
  assert.deepEqual(log.translateCalls[0].req, { sentence: '雨が降ってる', context: '前の行\n次の行' });
  assert.equal(log.cards[0].fields.SentenceTranslation, 'It is raining.');
});

test('anki:mine skips auto-translation when disabled, without a key, or when a translation is supplied', async () => {
  const { log, call } = await setup();

  await call('settings:set', { ai: { apiKey: 'secret' }, autoTranslate: false });
  await call('anki:mine', { ...MINE_BASE });
  await call('settings:set', { autoTranslate: true, ai: { apiKey: '' } });
  await call('anki:mine', { ...MINE_BASE });
  await call('settings:set', { ai: { apiKey: 'secret' } });
  await call('anki:mine', { ...MINE_BASE, translation: 'Mine.' });
  await call('anki:mine', { ...MINE_BASE, fields: { SentenceTranslation: 'Field.' } });

  assert.deepEqual(log.translateCalls, []);
  assert.deepEqual(log.cards.map((card) => card.fields.SentenceTranslation), ['', '', 'Mine.', 'Field.']);
});

test('a failed auto-translation still creates the card without a translation', async () => {
  const { log, call } = await setup();
  await call('settings:set', { ai: { apiKey: 'secret' } });
  log.translateFails = true;

  await call('anki:mine', { ...MINE_BASE });

  assert.equal(log.translateCalls.length, 1);
  assert.equal(log.cards.length, 1);
  assert.equal(log.cards[0].fields.SentenceTranslation, '');
});

test('mining a word marks its base form as learning without demoting a known word', async () => {
  const { dir, call } = await setup();
  await fs.writeFile(
    path.join(dir, 'known.json'),
    JSON.stringify({ words: { 走る: { status: 'known', source: 'anki', added: 1 } } }),
  );

  await call('anki:mine', { ...MINE_BASE, mode: 'word', word: { surface: '降ってる', base: '降る', reading: 'ふる' } });
  await call('anki:mine', { ...MINE_BASE, mode: 'word', word: { surface: '走った', base: '走る', reading: 'はしる' } });
  await call('anki:mine', { ...MINE_BASE });

  const { words } = JSON.parse(await fs.readFile(path.join(dir, 'known.json'), 'utf8'));
  assert.deepEqual(words['降る'].status, 'learning');
  assert.equal(words['降る'].source, 'mined');
  assert.equal(words['走る'].status, 'known');
  assert.deepEqual(Object.keys(words).sort(), ['降る', '走る'].sort());
});

test('a duplicate note reads as Already in your deck; other AnkiConnect errors pass through', async () => {
  const { log, call } = await setup();

  log.addCardError = 'cannot create note because it is a DUPLICATE';
  await assert.rejects(call('anki:mine', { ...MINE_BASE }), { message: 'Already in your deck' });

  log.addCardError = 'boom';
  await assert.rejects(call('anki:mine', { ...MINE_BASE }), /boom/);
});
