const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require('fflate');

const RELEASE_URL = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const ASSET_PATTERN = /^kanjidic2-en-.*\.json\.zip$/;
const USER_AGENT = 'anime-mine';
const KANJI_RE = /\p{Script=Han}/u;

function pickAsset(release) {
  const asset = release.assets.find(({ name }) => ASSET_PATTERN.test(name));
  if (!asset) throw new Error('No KANJIDIC2 English asset in latest release');
  return asset;
}

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub request failed: HTTP ${res.status}`);
  return res.json();
}

async function fetchBytes(fetchImpl, url, onProgress) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`KANJIDIC download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (total) onProgress(received / total);
  }
  return Buffer.concat(chunks);
}

function readings(kanji, type) {
  return kanji.readingMeaning.groups.flatMap((group) => group.readings.filter((r) => r.type === type).map((r) => r.value));
}

function radicalNameMap(characters) {
  const names = new Map();
  for (const kanji of characters) {
    const number = kanji.radicals.find((r) => r.type === 'classical')?.value;
    const name = kanji.misc.radicalNames[0];
    if (number !== undefined && name !== undefined && !names.has(number)) names.set(number, name);
  }
  return names;
}

function toEntry(kanji, radicalNames) {
  const meanings = kanji.readingMeaning.groups.flatMap((group) =>
    group.meanings.filter((m) => m.lang === 'en').map((m) => m.value),
  );
  const heisigRef = kanji.dictionaryReferences.find((d) => d.type === 'heisig6')
    ?? kanji.dictionaryReferences.find((d) => d.type === 'heisig');
  const radical = kanji.radicals.find((r) => r.type === 'classical');
  return {
    char: kanji.literal,
    keyword: meanings[0] ?? null,
    meanings,
    on: readings(kanji, 'ja_on'),
    kun: readings(kanji, 'ja_kun'),
    strokes: kanji.misc.strokeCounts[0] ?? null,
    grade: kanji.misc.grade ?? null,
    jlpt: kanji.misc.jlptLevel ?? null,
    newspaperRank: kanji.misc.frequency ?? null,
    heisig: heisigRef ? Number(heisigRef.value) : null,
    radical: { number: radical.value, name: radicalNames.get(radical.value) ?? null },
    kanken: null,
  };
}

class Kanjidic {
  constructor(dataDir, { fetchImpl = (url, options) => fetch(url, options) } = {}) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'kanjidic.json');
    this.fetchImpl = fetchImpl;
    this.chars = null;
    this.downloading = null;
  }

  isReady() {
    return fs.existsSync(this.file);
  }

  async load() {
    if (this.chars) return;
    const json = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
    const radicalNames = radicalNameMap(json.characters);
    this.chars = new Map(json.characters.map((kanji) => [kanji.literal, toEntry(kanji, radicalNames)]));
  }

  download(onProgress = () => {}) {
    this.downloading ??= this.fetchKanjidic(onProgress).finally(() => {
      this.downloading = null;
    });
    return this.downloading;
  }

  async fetchKanjidic(onProgress) {
    const release = await fetchJson(this.fetchImpl, RELEASE_URL);
    const asset = pickAsset(release);
    const files = unzipSync(await fetchBytes(this.fetchImpl, asset.browser_download_url, onProgress));
    const name = Object.keys(files).find((file) => file.endsWith('.json'));
    if (!name) throw new Error('KANJIDIC2 archive contains no JSON file');
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.file}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(tmp, files[name]);
    await fs.promises.rename(tmp, this.file);
    this.chars = null;
  }

  get(char) {
    if (!this.chars) throw new Error('KANJIDIC not loaded');
    return this.chars.get(char) ?? null;
  }

  kanjiIn(text) {
    return [...new Set([...text].filter((ch) => KANJI_RE.test(ch)))];
  }
}

module.exports = { Kanjidic };
