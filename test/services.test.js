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
      parseSubtitleFile: parseSrtFile,
    },
  });
  return { dir, log, services, call: (channel, ...args) => services.handlers[channel](...args) };
}

test('exposes every IPC channel from the contract', async () => {
  const { services } = await setup();
  assert.deepEqual(Object.keys(services.handlers).sort(), [
    'ai:explain',
    'anki:mine',
    'anki:status',
    'dict:download',
    'dict:lookup',
    'dict:status',
    'library:addFolder',
    'library:getFolders',
    'library:getShows',
    'library:linkSubtitle',
    'library:removeFolder',
    'nlp:tokenize',
    'player:loadCues',
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
    audioPadStart: 0.15,
    audioPadEnd: 0.25,
    ai: { provider: 'anthropic', apiKey: '', model: 'claude-haiku-4-5-20251001', baseUrl: '' },
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
  });
});

test('player:loadCues without a linked subtitle returns no cues', async () => {
  const { call } = await setup();
  assert.deepEqual(await call('player:loadCues', '/videos/unlinked.mkv'), {
    cues: [],
    subtitlePath: null,
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
