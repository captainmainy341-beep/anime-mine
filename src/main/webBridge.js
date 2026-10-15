const crypto = require('crypto');
const fs = require('fs/promises');
const http = require('http');
const path = require('path');
const { parseSubtitles: parseSubtitleText, toSrt } = require('../core/subtitles');

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const PICTURE_EXTS = ['jpg', 'png'];
const MODES = ['word', 'sentence'];
const EXTENSION_ORIGIN = /^(chrome|moz)-extension:\/\//;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isOptionalString = (value) => value === undefined || typeof value === 'string';
const isOptionalIndex = (value, min) => value === undefined || value === null || (Number.isInteger(value) && value >= min);
const badRequest = (message) => new HttpError(400, message);

function requireText(value, name, min, max) {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    throw badRequest(`${name} must be a string of ${min}-${max} characters`);
  }
}

function parseLookup(body) {
  if (!isPlainObject(body)) throw badRequest('body must be a JSON object');
  requireText(body.text, 'text', 1, 500);
  if (!Number.isInteger(body.offset) || body.offset < 0) throw badRequest('offset must be a non-negative integer');
  return { text: body.text, offset: body.offset };
}

const SUBTITLE_ASS = /\.(ass|ssa)$/i;

function decodeSubtitle(data) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    text = new TextDecoder('shift_jis').decode(data);
  }
  return text.replace(/^\uFEFF/, '');
}

function toSrtFile(found) {
  if (!SUBTITLE_ASS.test(found.name)) return found;
  const cues = parseSubtitleText(decodeSubtitle(found.data), path.extname(found.name));
  if (cues.length === 0) return found;
  return { name: found.name.replace(SUBTITLE_ASS, '.srt'), data: Buffer.from(toSrt(cues), 'utf8') };
}

function parseSubtitles(body) {
  if (!isPlainObject(body)) throw badRequest('body must be a JSON object');
  requireText(body.title, 'title', 1, 200);
  if (!isOptionalIndex(body.season, 1)) throw badRequest('season must be a positive integer or null');
  if (!isOptionalIndex(body.episode, 0)) throw badRequest('episode must be a non-negative integer or null');
  return { title: body.title, season: body.season ?? null, episode: body.episode ?? null };
}

function parseMine(body) {
  if (!isPlainObject(body)) throw badRequest('body must be a JSON object');
  if (!MODES.includes(body.mode)) throw badRequest("mode must be 'word' or 'sentence'");
  if (body.mode === 'word') {
    const word = body.word;
    if (!isPlainObject(word) || typeof word.base !== 'string' || typeof word.reading !== 'string' || typeof word.surface !== 'string') {
      throw badRequest('word must be an object with base, reading and surface strings');
    }
  } else if (body.word !== undefined && !isPlainObject(body.word)) {
    throw badRequest('word must be an object');
  }
  if (!isOptionalString(body.meaning)) throw badRequest('meaning must be a string');
  if (!isOptionalString(body.translation)) throw badRequest('translation must be a string');
  requireText(body.sentence, 'sentence', 1, 1000);
  if (body.sourceTitle !== undefined && (typeof body.sourceTitle !== 'string' || body.sourceTitle.length > 200)) {
    throw badRequest('sourceTitle must be a string of at most 200 characters');
  }
  if (body.pictureBase64 !== undefined && typeof body.pictureBase64 !== 'string') {
    throw badRequest('pictureBase64 must be a string');
  }
  if (body.pictureExt !== undefined && !PICTURE_EXTS.includes(body.pictureExt)) {
    throw badRequest("pictureExt must be 'jpg' or 'png'");
  }
  if ((body.pictureBase64 === undefined) !== (body.pictureExt === undefined)) {
    throw badRequest('pictureBase64 and pictureExt must be given together');
  }
  if (body.captionShownAt !== undefined && !(Number.isFinite(body.captionShownAt) && body.captionShownAt > 0)) {
    throw badRequest('captionShownAt must be a positive number');
  }
  if (body.captionEndedAt !== undefined && !(Number.isFinite(body.captionEndedAt) && body.captionEndedAt > 0)) {
    throw badRequest('captionEndedAt must be a positive number');
  }
  return body;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'body must be at most 6 MB'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

async function readJson(req) {
  const text = await readBody(req);
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('body must be valid JSON');
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function createWebBridge({
  dataDir,
  lookup,
  mine,
  status,
  subtitles = async () => null,
  onActivity = () => {},
  port = 8767,
  host = '127.0.0.1',
}) {
  const tokenFile = path.join(dataDir, 'web-bridge-token');
  let token = null;
  let server = null;
  let boundPort = null;

  async function loadToken() {
    try {
      const existing = (await fs.readFile(tokenFile, 'utf8')).trim();
      if (/^[0-9a-f]{64}$/.test(existing)) return existing;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const fresh = crypto.randomBytes(32).toString('hex');
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(tokenFile, fresh, { mode: 0o600 });
    await fs.chmod(tokenFile, 0o600);
    return fresh;
  }

  function authorized(req) {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) return false;
    const given = Buffer.from(header.slice('Bearer '.length));
    const expected = Buffer.from(token);
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  async function route(req, res) {
    const url = new URL(req.url, 'http://bridge.invalid');
    if (req.method === 'GET' && url.pathname === '/ping') {
      onActivity();
      return send(res, 200, { ok: true, ...(await status()) });
    }
    if (req.method === 'POST' && url.pathname === '/lookup') {
      onActivity();
      return send(res, 200, await lookup(parseLookup(await readJson(req))));
    }
    if (req.method === 'POST' && url.pathname === '/mine') {
      onActivity();
      return send(res, 200, await mine(parseMine(await readJson(req))));
    }
    if (req.method === 'POST' && url.pathname === '/subtitles') {
      onActivity();
      const found = await subtitles(parseSubtitles(await readJson(req)));
      if (!found) return send(res, 200, { found: false });
      const file = toSrtFile(found);
      return send(res, 200, { found: true, name: file.name, dataBase64: file.data.toString('base64') });
    }
    throw new HttpError(404, 'not found');
  }

  async function handle(req, res) {
    const hosts = [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`];
    if (!hosts.includes(req.headers.host)) throw new HttpError(403, 'host not allowed');

    const origin = req.headers.origin;
    if (origin) {
      if (!EXTENSION_ORIGIN.test(origin)) throw new HttpError(403, 'origin not allowed');
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (!authorized(req)) throw new HttpError(401, 'unauthorized');
    await route(req, res);
  }

  function onRequest(req, res) {
    handle(req, res).catch((err) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const statusCode = err instanceof HttpError ? err.status : 500;
      if (statusCode === 413) res.setHeader('Connection', 'close');
      send(res, statusCode, { error: err.message });
    });
  }

  return {
    async start() {
      if (server) return;
      token ??= await loadToken();
      const next = http.createServer(onRequest);
      try {
        await new Promise((resolve, reject) => {
          next.once('error', reject);
          next.listen(port, host, () => {
            next.off('error', reject);
            resolve();
          });
        });
      } catch (err) {
        if (err.code === 'EADDRINUSE') return;
        throw err;
      }
      server = next;
      boundPort = server.address().port;
      server.unref();
    },

    async stop() {
      const current = server;
      server = null;
      boundPort = null;
      if (!current) return;
      const closed = new Promise((resolve) => current.close(() => resolve()));
      current.closeAllConnections();
      await closed;
    },

    info() {
      return { port: boundPort, token };
    },
  };
}

module.exports = { createWebBridge };
