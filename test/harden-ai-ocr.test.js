const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aiRecognize } = require('../src/core/aiOcr');

const KEY = 'sk-ant-api03-SECRETVALUE1234';
const settings = { provider: 'anthropic', apiKey: KEY, model: 'm' };
const image = { bytes: Buffer.from('jpeg'), mime: 'image/jpeg' };

function fetchReturning(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}

test('an error body that echoes the key is redacted and a 307 is never followed', async () => {
  const echoed = { error: { message: `invalid key ${KEY}, retry with Bearer abc.def.ghi` } };
  const { fetchImpl, calls } = fetchReturning(307, echoed);
  const error = await aiRecognize(settings, image, { fetchImpl }).then(() => null, err => err);
  assert.match(error.message, /AI request failed \(307\)/);
  assert.equal(error.message.includes(KEY), false);
  assert.equal(error.message.includes('abc.def.ghi'), false);
  assert.equal(calls[0].init.redirect, 'error');
});

test('a network error that echoes the key is redacted', async () => {
  const fetchImpl = async () => {
    throw new TypeError(`redirect blocked for https://evil.example/?k=${KEY}`);
  };
  const error = await aiRecognize(settings, image, { fetchImpl }).then(() => null, err => err);
  assert.match(error.message, /^AI request failed: /);
  assert.equal(error.message.includes(KEY), false);
});

test('a non-JSON success body that echoes the key does not leak it through the parse error', async () => {
  const { fetchImpl } = fetchReturning(200, `not json ${KEY}`);
  const error = await aiRecognize(settings, image, { fetchImpl }).then(() => null, err => err);
  assert.equal(error.message.includes(KEY), false);
});

test('openai bearer tokens echoed in an error are redacted', async () => {
  const { fetchImpl } = fetchReturning(401, 'Authorization: Bearer sk-openai-LIVEKEY99 rejected');
  const error = await aiRecognize({ provider: 'openai', apiKey: 'sk-openai-LIVEKEY99', model: 'm' }, image, { fetchImpl }).then(() => null, err => err);
  assert.equal(error.message.includes('LIVEKEY99'), false);
  assert.match(error.message, /\[redacted\]/);
});

test('the request is cancelled by the caller signal', async () => {
  const fetchImpl = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  const controller = new AbortController();
  const pending = aiRecognize(settings, image, { fetchImpl, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, /AI request failed: /);
});
