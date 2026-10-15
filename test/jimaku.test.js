const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJimaku, JimakuError, normalizeTitle } = require('../src/core/jimaku');
const { Library } = require('../src/core/library');

async function setup(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jimaku-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function touch(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(reply) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    return reply(String(url));
  };
  return { fetch, calls };
}

function fakeJimaku(answer) {
  const asked = [];
  return {
    asked,
    findSubtitle: async request => {
      asked.push(request);
      return typeof answer === 'function' ? answer(request) : answer;
    },
  };
}

function hit(name = 'Frieren - 05.srt', text = '1\n') {
  return { name, data: Buffer.from(text) };
}

test('every Jimaku request sends the API key as Authorization', async () => {
  const { fetch, calls } = fakeFetch(url => {
    if (url.includes('/entries/search')) return json([{ id: 7, name: 'Frieren' }]);
    if (url.includes('/files')) return json([{ name: 'Frieren - 05.srt', url: 'https://jimaku.cc/dl/5.srt', size: 10 }]);
    return new Response('1\n');
  });

  const found = await createJimaku({ apiKey: 'secret', fetch }).findSubtitle({ title: 'frieren', season: null, episode: 5 });

  assert.equal(found.name, 'Frieren - 05.srt');
  assert.deepEqual(calls.map(call => call.url), [
    'https://jimaku.cc/api/entries/search?query=frieren&anime=true',
    'https://jimaku.cc/api/entries/7/files?episode=5',
    'https://jimaku.cc/dl/5.srt',
  ]);
  for (const call of calls) assert.equal(call.headers.Authorization, 'secret');
});

test('best entry is chosen by title, skipping movies for episodes', async () => {
  const { fetch, calls } = fakeFetch(url => {
    if (url.includes('/entries/search')) {
      return json([
        { id: 1, name: 'Unrelated Show' },
        { id: 3, name: 'Frieren Movie', flags: { movie: true } },
        { id: 2, name: 'Sousou no Frieren', english_name: "Frieren: Beyond Journey's End" },
      ]);
    }
    return json([{ name: 'Frieren - 01.srt', url: 'https://jimaku.cc/dl/1.srt', size: 10 }]);
  });

  await createJimaku({ apiKey: 'k', fetch }).findSubtitle({ title: 'frieren', season: null, episode: 1 });

  assert.match(calls[1].url, /\/entries\/2\/files/);
});

test('season must match the entry, so a season 1 entry never serves season 2', async () => {
  const season1Only = fakeFetch(() => json([{ id: 5, name: 'Show' }]));
  assert.equal(await createJimaku({ apiKey: 'k', fetch: season1Only.fetch }).findSubtitle({ title: 'show', season: 2, episode: 3 }), null);

  const season2Only = fakeFetch(url => (url.includes('/search') ? json([{ id: 6, name: 'Show 2nd Season' }]) : json([])));
  assert.equal(await createJimaku({ apiKey: 'k', fetch: season2Only.fetch }).findSubtitle({ title: 'show', season: null, episode: 3 }), null);

  const season2 = fakeFetch(url => (url.includes('/search') ? json([{ id: 6, name: 'Show 2nd Season' }]) : json([])));
  await createJimaku({ apiKey: 'k', fetch: season2.fetch }).findSubtitle({ title: 'show', season: 2, episode: 3 });
  assert.match(season2.calls[1].url, /\/entries\/6\/files\?episode=3$/);
});

test('episode filter applies, and only subtitle files are downloaded, preferring plain over CC', async () => {
  const { fetch, calls } = fakeFetch(url => {
    if (url.includes('/entries/search')) return json([{ id: 9, name: 'Frieren' }]);
    if (url.includes('/files')) {
      return json([
        { name: 'Frieren - 05.zip', url: 'https://jimaku.cc/dl/pack.zip', size: 9999 },
        { name: 'Frieren - 05 [CC].srt', url: 'https://jimaku.cc/dl/cc.srt', size: 900 },
        { name: 'Frieren - 05.srt', url: 'https://jimaku.cc/dl/plain.srt', size: 100 },
      ]);
    }
    return new Response('1\n');
  });

  const found = await createJimaku({ apiKey: 'k', fetch }).findSubtitle({ title: 'frieren', season: null, episode: 5 });

  assert.equal(found.name, 'Frieren - 05.srt');
  assert.equal(calls[1].url, 'https://jimaku.cc/api/entries/9/files?episode=5');
  assert.equal(calls.some(call => call.url.endsWith('pack.zip')), false);
});

test('a Japanese-tagged subtitle beats a larger untagged one', async () => {
  const { fetch } = fakeFetch(url => {
    if (url.includes('/entries/search')) return json([{ id: 9, name: 'Frieren' }]);
    if (url.includes('/files')) {
      return json([
        { name: 'Frieren - 05.srt', url: 'https://jimaku.cc/dl/en.srt', size: 500 },
        { name: 'Frieren - 05.ja.ass', url: 'https://jimaku.cc/dl/ja.ass', size: 40 },
      ]);
    }
    return new Response('x');
  });

  const found = await createJimaku({ apiKey: 'k', fetch }).findSubtitle({ title: 'frieren', season: null, episode: 5 });

  assert.equal(found.name, 'Frieren - 05.ja.ass');
});

test('findSubtitle returns null when nothing matches or no subtitle file exists', async () => {
  const none = fakeFetch(() => json([]));
  assert.equal(await createJimaku({ apiKey: 'k', fetch: none.fetch }).findSubtitle({ title: 'frieren', episode: 1 }), null);
  assert.equal(none.calls.length, 1);

  const onlyZip = fakeFetch(url => (url.includes('/search') ? json([{ id: 2, name: 'Frieren' }]) : json([{ name: 'pack.zip', url: 'https://jimaku.cc/dl/p.zip' }])));
  assert.equal(await createJimaku({ apiKey: 'k', fetch: onlyZip.fetch }).findSubtitle({ title: 'frieren', episode: 1 }), null);

  assert.equal(await createJimaku({ apiKey: 'k', fetch: none.fetch }).findSubtitle({ title: '', episode: 1 }), null);
});

test('401 and 429 raise JimakuError with the HTTP status, and network failures have no status', async () => {
  for (const status of [401, 429]) {
    const { fetch } = fakeFetch(() => json({ error: 'nope' }, status));
    await assert.rejects(createJimaku({ apiKey: 'k', fetch }).findSubtitle({ title: 'frieren', episode: 1 }), error => {
      assert.ok(error instanceof JimakuError);
      assert.equal(error.status, status);
      return true;
    });
  }

  const offline = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(createJimaku({ apiKey: 'k', fetch: offline }).findSubtitle({ title: 'frieren', episode: 1 }), error => {
    assert.ok(error instanceof JimakuError);
    assert.equal(error.status, null);
    return true;
  });
});

test('normalizeTitle folds width, case and punctuation', () => {
  assert.equal(normalizeTitle("Frieren: Beyond Journey's End!"), 'frieren beyond journeys end');
  assert.equal(normalizeTitle('ＳＰＹ×ＦＡＭＩＬＹ'), 'spy family');
});

async function libraryWith(t, names) {
  const root = await setup(t);
  const media = path.join(root, 'media');
  const videos = names.map(name => touch(path.join(media, name)));
  const library = new Library(path.join(root, 'data'));
  library.addFolder(media);
  return { root, media, videos, library };
}

test('fetchMissingSubtitles links a hit as an auto jimaku link and reports it', async t => {
  const { library, videos } = await libraryWith(t, ['Frieren - 05.mkv']);
  const jimaku = fakeJimaku(hit());
  const linked = [];

  await library.fetchMissingSubtitles(jimaku, { onLinked: episode => linked.push(episode) });

  assert.deepEqual(jimaku.asked, [{ title: 'frieren', season: null, episode: 5 }]);
  const stored = library.getSubtitle(videos[0]);
  assert.equal(fs.readFileSync(stored, 'utf8'), '1\n');
  assert.equal(path.dirname(stored), path.join(path.dirname(library.file), 'subs'));
  const data = library.load();
  assert.deepEqual(data.auto[videos[0]], { lang: 'ja', origin: 'jimaku', source: 'jimaku' });
  assert.equal(data.manual.includes(videos[0]), false);
  assert.equal(linked.length, 1);
  assert.equal(linked[0].path, videos[0]);
  assert.equal(linked[0].subtitlePath, stored);
});

test('a downloaded file name cannot escape the subs directory', async t => {
  const { library, videos } = await libraryWith(t, ['Frieren - 05.mkv']);

  await library.fetchMissingSubtitles(fakeJimaku(hit('../../escape.srt')));

  const stored = library.getSubtitle(videos[0]);
  assert.equal(path.dirname(stored), path.join(path.dirname(library.file), 'subs'));
  assert.equal(fs.existsSync(path.join(path.dirname(library.file), 'escape.srt')), false);
});

test('fetchMissingSubtitles skips episodes that already have a subtitle', async t => {
  const { library, media, videos } = await libraryWith(t, ['Show - 01.mkv', 'Show - 02.mkv']);
  touch(path.join(media, 'Show - 01.ja.srt'));
  const jimaku = fakeJimaku(null);

  await library.fetchMissingSubtitles(jimaku);

  assert.deepEqual(jimaku.asked.map(request => request.episode), [2]);
  assert.ok(library.getSubtitle(videos[0]));
});

test('a 401 stops the batch without recording the remaining episodes', async t => {
  const { library, videos } = await libraryWith(t, ['Show - 01.mkv', 'Show - 02.mkv', 'Show - 03.mkv']);
  const jimaku = fakeJimaku(request => {
    if (request.episode === 2) throw new JimakuError('Jimaku request failed (HTTP 401)', 401);
    return null;
  });

  await assert.rejects(library.fetchMissingSubtitles(jimaku), error => error.status === 401);

  assert.deepEqual(jimaku.asked.map(request => request.episode), [1, 2]);
  const tried = library.load().jimakuTried;
  assert.ok(tried[videos[0]] !== undefined);
  assert.equal(tried[videos[1]], undefined);
  assert.equal(tried[videos[2]], undefined);
});

test('misses are recorded and not retried before retryAfterMs elapses', async t => {
  const { library, videos } = await libraryWith(t, ['Show - 01.mkv']);
  const jimaku = fakeJimaku(null);
  const t0 = 1_000_000;
  const options = { retryAfterMs: 1000 };

  await library.fetchMissingSubtitles(jimaku, { ...options, now: () => t0 });
  assert.equal(library.load().jimakuTried[videos[0]], t0);

  await library.fetchMissingSubtitles(jimaku, { ...options, now: () => t0 + 999 });
  assert.equal(jimaku.asked.length, 1);

  await library.fetchMissingSubtitles(jimaku, { ...options, now: () => t0 + 1000 });
  assert.equal(jimaku.asked.length, 2);
});

test('a manual link is never overwritten by a jimaku fetch', async t => {
  const { root, library, videos } = await libraryWith(t, ['Show - 04.mkv']);
  const manual = touch(path.join(root, 'manual.srt'), 'manual\n');
  const stored = library.linkSubtitle(videos[0], manual);
  const jimaku = fakeJimaku(hit());

  await library.fetchMissingSubtitles(jimaku);

  assert.equal(jimaku.asked.length, 0);
  assert.equal(library.getSubtitle(videos[0]), stored);
  assert.equal(library.canLink(library.load(), videos[0], { lang: 'ja', origin: 'jimaku' }), false);
});

test('a local ja sidecar link is never overwritten by a jimaku fetch', async t => {
  const { library, media, videos } = await libraryWith(t, ['Show - 03.mkv']);
  const sidecar = touch(path.join(media, 'Show - 03.ja.srt'));
  await library.scan();
  const jimaku = fakeJimaku(hit());

  await library.fetchMissingSubtitles(jimaku);

  assert.equal(jimaku.asked.length, 0);
  assert.equal(library.getSubtitle(videos[0]), sidecar);
  assert.equal(library.canLink(library.load(), videos[0], { lang: 'ja', origin: 'other.ja.srt' }), false);
});

test('a jimaku link is replaced by a later ja or untagged local sidecar', async t => {
  const { library, media, videos } = await libraryWith(t, ['Show - 06.mkv', 'Show - 07.mkv']);
  await library.fetchMissingSubtitles(fakeJimaku(hit('Show - 06.srt')));
  await library.fetchMissingSubtitles(fakeJimaku(hit('Show - 07.srt')));
  assert.equal(library.load().auto[videos[0]].source, 'jimaku');

  const ja = touch(path.join(media, 'Show - 06.ja.srt'));
  const plain = touch(path.join(media, 'Show - 07.srt'));
  const [show] = await library.scan();

  assert.equal(show.episodes[0].subtitlePath, ja);
  assert.equal(library.load().auto[videos[0]].source, 'scan');
  assert.equal(show.episodes[1].subtitlePath, plain);
  assert.equal(library.load().auto[videos[1]].source, 'scan');
});

test('the API key is never sent to a non-Jimaku download host', async () => {
  const { fetch, calls } = fakeFetch(url => {
    if (url.includes('/entries/search')) return json([{ id: 7, name: 'Frieren' }]);
    if (url.includes('/files')) return json([{ name: 'Frieren - 05.srt', url: 'https://cdn.example.net/5.srt', size: 10 }]);
    return new Response('1\n');
  });

  await createJimaku({ apiKey: 'secret', fetch }).findSubtitle({ title: 'frieren', episode: 5 });

  assert.equal(calls[2].url, 'https://cdn.example.net/5.srt');
  assert.deepEqual(calls[2].headers, {});
  assert.equal(calls[0].headers.Authorization, 'secret');
});

test('a 429 carries a retry delay from the rate-limit header, defaulting to a minute', async () => {
  const limited = (headers) => fakeFetch(() => new Response('{}', { status: 429, headers })).fetch;
  const delay = (fetch) => createJimaku({ apiKey: 'k', fetch }).findSubtitle({ title: 'frieren', episode: 1 }).catch(error => error.retryAfterMs);

  assert.equal(await delay(limited({ 'x-ratelimit-reset-after': '12' })), 12000);
  assert.equal(await delay(limited({})), 60000);
});

test('a subtitle linked while the lookup was in flight is not overwritten', async t => {
  const { library, videos } = await libraryWith(t, ['Frieren - 05.mkv']);
  const jimaku = fakeJimaku(() => {
    const data = library.load();
    data.links[videos[0]] = '/local/untagged.srt';
    data.auto[videos[0]] = { lang: null, origin: '/local/untagged.srt', source: 'scan' };
    library.save(data);
    return hit();
  });

  await library.fetchMissingSubtitles(jimaku);

  assert.equal(library.getSubtitle(videos[0]), '/local/untagged.srt');
});
