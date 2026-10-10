const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require('fflate');

const RELEASE_URL = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const ASSET_PATTERN = /^jmdict-eng-\d[\d.]*\+?[\w.]*\.json\.zip$/;
const USER_AGENT = 'anime-mine';
const MAX_RESULTS = 8;

function pickAsset(release) {
  const asset = release.assets.find(({ name }) => ASSET_PATTERN.test(name) && !name.includes('common'));
  if (!asset) throw new Error('No JMdict English asset in latest release');
  return asset;
}

function toEntry(word) {
  return {
    id: word.id,
    kanji: word.kanji.map((form) => form.text),
    kana: word.kana.map((form) => form.text),
    common: [...word.kanji, ...word.kana].some((form) => form.common),
    senses: word.sense.map((sense) => ({
      pos: sense.partOfSpeech,
      glosses: sense.gloss.map((gloss) => gloss.text),
    })),
  };
}

function buildIndex(json) {
  const index = new Map();
  for (const word of json.words) {
    const entry = toEntry(word);
    for (const form of new Set([...entry.kanji, ...entry.kana])) {
      index.set(form, [...(index.get(form) ?? []), entry]);
    }
  }
  return index;
}

function rank(entry, query) {
  return (entry.common ? 0 : 2) + (entry.kanji.includes(query) ? 0 : 1);
}

function queryCandidates(query) {
  return typeof query === 'string' ? [query] : [query.base, query.surface, query.reading];
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub request failed: HTTP ${res.status}`);
  return res.json();
}

async function fetchBytes(url, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Dictionary download failed: HTTP ${res.status}`);
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

class Dictionary {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'jmdict.json');
    this.index = null;
  }

  isReady() {
    return fs.existsSync(this.file);
  }

  async load() {
    if (this.index) return;
    const json = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
    this.index = buildIndex(json);
  }

  async download(onProgress = () => {}) {
    const release = await fetchJson(RELEASE_URL);
    const asset = pickAsset(release);
    const files = unzipSync(await fetchBytes(asset.browser_download_url, onProgress));
    const name = Object.keys(files).find((file) => file.endsWith('.json'));
    if (!name) throw new Error('JMdict archive contains no JSON file');
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.promises.writeFile(tmp, files[name]);
    await fs.promises.rename(tmp, this.file);
    this.index = null;
  }

  lookup(query) {
    if (!this.index) throw new Error('Dictionary not loaded');
    for (const candidate of queryCandidates(query)) {
      const entries = candidate ? this.index.get(candidate) : undefined;
      if (entries) {
        return [...entries].sort((a, b) => rank(a, candidate) - rank(b, candidate)).slice(0, MAX_RESULTS);
      }
    }
    return [];
  }
}

module.exports = { Dictionary, buildIndex, pickAsset };
