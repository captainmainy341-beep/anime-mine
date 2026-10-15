const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createWebBridge } = require('../src/main/webBridge');
const { mangaDeckName } = require('../src/main/services');

const dirs = [];

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function newDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-bridge-'));
  dirs.push(dir);
  return dir;
}

async function startBridge(t, { dataDir = newDataDir(), ...overrides } = {}) {
  const calls = { lookup: [], mine: [] };
  const bridge = createWebBridge({
    dataDir,
    port: 0,
    lookup: async (req) => {
      calls.lookup.push(req);
      return { span: null, entries: [], tokenCount: 1 };
    },
    mine: async (body) => {
      calls.mine.push(body);
      return { noteId: 42 };
    },
    status: async () => ({ dictReady: true, ankiConnected: false }),
    ...overrides,
  });
  await bridge.start();
  t.after(() => bridge.stop());
  return { bridge, calls, dataDir, ...bridge.info() };
}

function request(port, { method = 'GET', path: urlPath = '/ping', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: urlPath, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, text, json: text ? JSON.parse(text) : undefined });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const auth = (token) => ({ authorization: `Bearer ${token}` });

function postJson(port, urlPath, token, payload) {
  return request(port, {
    method: 'POST',
    path: urlPath,
    headers: { ...auth(token), 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
}

test('rejects requests without the bearer token', async (t) => {
  const { port, token } = await startBridge(t);
  assert.equal((await request(port, { path: '/ping' })).status, 401);
  assert.equal((await request(port, { path: '/ping', headers: auth('0'.repeat(64)) })).status, 401);
  assert.equal((await request(port, { path: '/ping', headers: auth('short') })).status, 401);
  assert.equal((await request(port, { path: '/ping', headers: auth(token) })).status, 200);
});

test('rejects a Host header that is not the bridge address', async (t) => {
  const { port, token } = await startBridge(t);
  const rebound = await request(port, { path: '/ping', headers: { ...auth(token), host: `evil.example:${port}` } });
  assert.equal(rebound.status, 403);
  assert.match(rebound.json.error, /host/);
  const local = await request(port, { path: '/ping', headers: { ...auth(token), host: `localhost:${port}` } });
  assert.equal(local.status, 200);
});

test('rejects a non-extension Origin and reflects an extension Origin', async (t) => {
  const { port, token } = await startBridge(t);
  const web = await request(port, { path: '/ping', headers: { ...auth(token), origin: 'https://example.com' } });
  assert.equal(web.status, 403);
  const ext = await request(port, { path: '/ping', headers: { ...auth(token), origin: 'chrome-extension://abc' } });
  assert.equal(ext.status, 200);
  assert.equal(ext.headers['access-control-allow-origin'], 'chrome-extension://abc');
});

test('answers extension preflight without auth', async (t) => {
  const { port } = await startBridge(t);
  const res = await request(port, {
    method: 'OPTIONS',
    path: '/lookup',
    headers: { origin: 'moz-extension://xyz', 'access-control-request-method': 'POST' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers['access-control-allow-origin'], 'moz-extension://xyz');
  assert.equal(res.headers['access-control-allow-headers'], 'authorization, content-type');
  assert.equal(res.headers['access-control-allow-methods'], 'GET, POST, OPTIONS');
});

test('serves /ping with the status fields', async (t) => {
  const { port, token } = await startBridge(t);
  const res = await request(port, { path: '/ping', headers: auth(token) });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true, dictReady: true, ankiConnected: false });
});

test('validates /lookup and passes valid requests through', async (t) => {
  const { port, token, calls } = await startBridge(t);
  const invalid = [
    { text: '', offset: 0 },
    { text: 'x'.repeat(501), offset: 0 },
    { text: '猫', offset: -1 },
    { text: '猫', offset: 1.5 },
    { offset: 0 },
  ];
  for (const payload of invalid) {
    assert.equal((await postJson(port, '/lookup', token, payload)).status, 400, JSON.stringify(payload));
  }
  assert.equal((await postJson(port, '/lookup', token, '{not json')).status, 400);
  assert.equal(calls.lookup.length, 0);

  const res = await postJson(port, '/lookup', token, { text: '猫が好き', offset: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.lookup, [{ text: '猫が好き', offset: 1 }]);
  assert.deepEqual(res.json, { span: null, entries: [], tokenCount: 1 });
});

test('validates /mine and passes valid requests through', async (t) => {
  const { port, token, calls } = await startBridge(t);
  const sentence = '猫が好き';
  const invalid = [
    { mode: 'word', sentence },
    { mode: 'other', sentence },
    { mode: 'sentence' },
    { mode: 'sentence', sentence, sourceTitle: 'x'.repeat(201) },
    { mode: 'sentence', sentence, pictureBase64: 'AAAA', pictureExt: 'gif' },
    { mode: 'sentence', sentence, pictureBase64: 'AAAA' },
  ];
  for (const payload of invalid) {
    assert.equal((await postJson(port, '/mine', token, payload)).status, 400, JSON.stringify(payload));
  }
  assert.equal(calls.mine.length, 0);

  const body = {
    mode: 'word',
    word: { base: '猫', reading: 'ねこ', surface: '猫' },
    meaning: 'cat',
    sentence,
    sourceTitle: 'Show',
    pictureBase64: 'AAAA',
    pictureExt: 'png',
  };
  const res = await postJson(port, '/mine', token, body);
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { noteId: 42 });
  assert.deepEqual(calls.mine, [body]);
});

test('serves /subtitles with base64 data from the subtitle lookup', async (t) => {
  const calls = [];
  const { port, token } = await startBridge(t, {
    subtitles: async (req) => {
      calls.push(req);
      return { name: 'show-01.ass', data: Buffer.from('subtitle bytes') };
    },
  });
  const res = await postJson(port, '/subtitles', token, { title: 'Show', season: 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, {
    found: true,
    name: 'show-01.ass',
    dataBase64: Buffer.from('subtitle bytes').toString('base64'),
  });
  assert.deepEqual(calls, [{ title: 'Show', season: 1, episode: null }]);
});

test('serves ASS /subtitles as SRT with only the Japanese cues', async (t) => {
  const ass = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Text - JP,,0,0,0,,日本語',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Text - CN,,0,0,0,,中文',
    'Dialogue: 0,0:00:03.00,0:00:04.00,Sign,,0,0,0,,看板',
  ].join('\n');
  const { port, token } = await startBridge(t, {
    subtitles: async () => ({ name: '[SweetSub] Show - 01 [CHS, JPN].ass', data: Buffer.from(ass, 'utf8') }),
  });
  const res = await postJson(port, '/subtitles', token, { title: 'Show' });
  assert.equal(res.status, 200);
  assert.equal(res.json.found, true);
  assert.equal(res.json.name, '[SweetSub] Show - 01 [CHS, JPN].srt');
  assert.equal(Buffer.from(res.json.dataBase64, 'base64').toString('utf8'), '1\n00:00:01,000 --> 00:00:02,000\n日本語\n');
});

test('decodes a Shift_JIS ASS /subtitles file to SRT with the Japanese text', async (t) => {
  const header = Buffer.from('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,', 'ascii');
  const konnichiwa = Buffer.from([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]);
  const { port, token } = await startBridge(t, {
    subtitles: async () => ({ name: 'show-01.ass', data: Buffer.concat([header, konnichiwa]) }),
  });
  const res = await postJson(port, '/subtitles', token, { title: 'Show' });
  assert.equal(res.status, 200);
  assert.equal(res.json.name, 'show-01.srt');
  assert.equal(Buffer.from(res.json.dataBase64, 'base64').toString('utf8'), '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n');
});

test('serves a zero-cue ASS subtitle unchanged', async (t) => {
  const bytes = Buffer.from('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n', 'utf8');
  const { port, token } = await startBridge(t, {
    subtitles: async () => ({ name: 'show.ass', data: bytes }),
  });
  const res = await postJson(port, '/subtitles', token, { title: 'Show' });
  assert.deepEqual(res.json, { found: true, name: 'show.ass', dataBase64: bytes.toString('base64') });
});

test('reports found:false when no subtitle matches', async (t) => {
  const { port, token } = await startBridge(t, { subtitles: async () => null });
  const res = await postJson(port, '/subtitles', token, { title: 'Show' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { found: false });
});

test('validates /subtitles bodies', async (t) => {
  let lookups = 0;
  const { port, token } = await startBridge(t, {
    subtitles: async () => {
      lookups += 1;
      return null;
    },
  });
  const invalid = [{}, { title: '' }, { title: 'x'.repeat(201) }, { title: 'Show', episode: 'x' }, { title: 'Show', season: 0 }, { title: 'Show', episode: -1 }];
  for (const payload of invalid) {
    assert.equal((await postJson(port, '/subtitles', token, payload)).status, 400, JSON.stringify(payload));
  }
  assert.equal((await postJson(port, '/subtitles', token, '{not json')).status, 400);
  assert.equal(lookups, 0);
});

test('rejects /subtitles without the bearer token', async (t) => {
  const { port } = await startBridge(t, { subtitles: async () => null });
  const res = await request(port, {
    method: 'POST',
    path: '/subtitles',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Show' }),
  });
  assert.equal(res.status, 401);
});

test('returns 413 for bodies over 6 MB', async (t) => {
  const { port, token } = await startBridge(t);
  const body = JSON.stringify({ text: 'x'.repeat(6 * 1024 * 1024) });
  const res = await postJson(port, '/lookup', token, body);
  assert.equal(res.status, 413);
});

test('returns 500 with the message when a handler throws', async (t) => {
  const { port, token } = await startBridge(t, {
    lookup: async () => {
      throw new Error('boom');
    },
  });
  const res = await postJson(port, '/lookup', token, { text: '猫', offset: 0 });
  assert.equal(res.status, 500);
  assert.deepEqual(res.json, { error: 'boom' });
});

test('returns 404 for unknown routes', async (t) => {
  const { port, token } = await startBridge(t);
  assert.equal((await request(port, { path: '/nope', headers: auth(token) })).status, 404);
});

test('creates a 0600 token file, reuses it on restart, and stop is idempotent', async (t) => {
  const dataDir = newDataDir();
  const first = await startBridge(t, { dataDir });
  const file = path.join(dataDir, 'web-bridge-token');
  assert.match(first.token, /^[0-9a-f]{64}$/);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), first.token);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  await first.bridge.stop();
  await first.bridge.stop();
  const second = await startBridge(t, { dataDir });
  assert.equal(second.token, first.token);
});

test('leaves port null without throwing when the port is in use', async (t) => {
  const holder = await startBridge(t);
  const bridge = createWebBridge({
    dataDir: holder.dataDir,
    port: holder.port,
    lookup: async () => ({}),
    mine: async () => ({}),
    status: async () => ({}),
  });
  await bridge.start();
  t.after(() => bridge.stop());
  assert.equal(bridge.info().port, null);
  assert.equal(bridge.info().token, holder.token);
});

test('rejects an invalid captionEndedAt', async (t) => {
  const { port, token } = await startBridge(t);
  for (const captionEndedAt of [0, -1, '1700000000000', null]) {
    const res = await postJson(port, '/mine', token, { mode: 'sentence', sentence: '雨', captionEndedAt });
    assert.equal(res.status, 400, JSON.stringify(captionEndedAt));
    assert.equal(res.json.error, 'captionEndedAt must be a positive number');
  }
});

test('validates captionShownAt and passes a valid one through to mine', async (t) => {
  const { port, token, calls } = await startBridge(t);
  const sentence = '猫が好き';
  for (const captionShownAt of [0, -1, '1700000000000', null]) {
    const res = await postJson(port, '/mine', token, { mode: 'sentence', sentence, captionShownAt });
    assert.equal(res.status, 400, JSON.stringify(captionShownAt));
    assert.equal(res.json.error, 'captionShownAt must be a positive number');
  }
  assert.equal(calls.mine.length, 0);

  const res = await postJson(port, '/mine', token, { mode: 'sentence', sentence, captionShownAt: 1700000000000 });
  assert.equal(res.status, 200);
  assert.deepEqual(calls.mine, [{ mode: 'sentence', sentence, captionShownAt: 1700000000000 }]);
});

test('calls onActivity for authorized ping, lookup and mine requests only', async (t) => {
  let activity = 0;
  const { port, token } = await startBridge(t, { onActivity: () => (activity += 1) });
  await request(port, { path: '/ping' });
  assert.equal(activity, 0);
  await request(port, { path: '/ping', headers: auth(token) });
  await postJson(port, '/lookup', token, { text: '猫', offset: 0 });
  await postJson(port, '/mine', token, { mode: 'sentence', sentence: '猫が好き' });
  await postJson(port, '/subtitles', token, { title: 'Show' });
  assert.equal(activity, 4);
  await request(port, { path: '/unknown', headers: auth(token) });
  assert.equal(activity, 4);
});

test('web mining decks sit beside manga decks under the same root', () => {
  assert.equal(mangaDeckName('Anime Mining', 'Title', 'Web'), 'Anime Mining::Web::Title');
  assert.equal(mangaDeckName('Anime Mining', 'Title'), 'Anime Mining::Manga::Title');
});
