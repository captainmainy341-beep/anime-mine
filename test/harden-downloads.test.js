const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync } = require('fflate');
const { Examples } = require('../src/core/examples');
const { Kanjidic } = require('../src/core/kanjidic');

const RELEASE = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-harden-'));
  tempDirs.push(dir);
  return dir;
}

function slowFetch({ release, assetUrl, zip }) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === RELEASE) return Response.json(release);
    await new Promise((resolve) => setImmediate(resolve));
    if (url === assetUrl) return new Response(zip);
    throw new Error(`unexpected ${url}`);
  };
  return { fetchImpl, calls };
}

const examplesRelease = {
  assets: [{ name: 'jmdict-examples-eng-3.6.2.json.zip', browser_download_url: 'https://example.test/examples.zip' }],
};
const kanjidicRelease = {
  assets: [{ name: 'kanjidic2-en-3.6.2.json.zip', browser_download_url: 'https://example.test/en.zip' }],
};

test('concurrent examples downloads share one in-flight request', async () => {
  const zip = Buffer.from(zipSync({ 'examples.json': Buffer.from('{"words":[]}') }));
  const { fetchImpl, calls } = slowFetch({ release: examplesRelease, assetUrl: 'https://example.test/examples.zip', zip });
  const examples = new Examples(tempDataDir(), { fetchImpl });
  await Promise.all([examples.download(), examples.download()]);
  assert.deepEqual(calls, [RELEASE, 'https://example.test/examples.zip']);
});

test('concurrent kanjidic downloads share one in-flight request', async () => {
  const zip = Buffer.from(zipSync({ 'kanjidic2.json': Buffer.from('{"characters":[]}') }));
  const { fetchImpl, calls } = slowFetch({ release: kanjidicRelease, assetUrl: 'https://example.test/en.zip', zip });
  const kanjidic = new Kanjidic(tempDataDir(), { fetchImpl });
  await Promise.all([kanjidic.download(), kanjidic.download()]);
  assert.deepEqual(calls, [RELEASE, 'https://example.test/en.zip']);
});

test('examples and kanjidic write through a unique temp file each time', async (t) => {
  const zip = Buffer.from(zipSync({ 'x.json': Buffer.from('{}') }));
  for (const [Resource, release, assetUrl] of [
    [Examples, examplesRelease, 'https://example.test/examples.zip'],
    [Kanjidic, kanjidicRelease, 'https://example.test/en.zip'],
  ]) {
    const dataDir = tempDataDir();
    const { fetchImpl } = slowFetch({ release, assetUrl, zip });
    const writes = t.mock.method(fs.promises, 'writeFile');
    const resource = new Resource(dataDir, { fetchImpl });
    await resource.download();
    await resource.download();
    const tmps = writes.mock.calls.map((call) => call.arguments[0]);
    writes.mock.restore();
    assert.equal(tmps.length, 2);
    assert.equal(new Set(tmps).size, 2);
    assert.ok(tmps.every((file) => file !== `${resource.file}.tmp`));
  }
});
