const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require('fflate');

const RELEASE_URL = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const ASSET_PATTERN = /^jmdict-examples-eng-.*\.json\.zip$/;
const USER_AGENT = 'anime-mine';
const MAX_PER_WORD = 50;
const DEFAULT_KANJI_LIMIT = 10;

function pickAsset(release) {
  const asset = release.assets.find(({ name }) => ASSET_PATTERN.test(name));
  if (!asset) throw new Error('No JMdict example sentences asset in latest release');
  return asset;
}

async function fetchJson(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub request failed: HTTP ${res.status}`);
  return res.json();
}

async function fetchBytes(fetchImpl, url, onProgress) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Examples download failed: HTTP ${res.status}`);
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

function toSentence(example) {
  const ja = example.sentences.find((s) => s.lang === 'jpn')?.text;
  const en = example.sentences.find((s) => s.lang === 'eng')?.text;
  if (!ja || !en) return null;
  return { ja, en, tatoebaId: example.source?.value ?? null };
}

class Examples {
  constructor(dataDir, { fetchImpl = (url, options) => fetch(url, options) } = {}) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'examples.json');
    this.fetchImpl = fetchImpl;
    this.byWord = null;
    this.pool = null;
    this.sorted = null;
    this.downloading = null;
  }

  isReady() {
    return fs.existsSync(this.file);
  }

  async load() {
    if (this.byWord) return;
    const json = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
    const byWord = new Map();
    const pool = new Map();
    for (const word of json.words) {
      const sentences = [];
      const seen = new Set();
      for (const sense of word.sense) {
        for (const example of sense.examples ?? []) {
          const sentence = toSentence(example);
          if (!sentence) continue;
          const key = sentence.tatoebaId ?? sentence.ja;
          if (!pool.has(key)) pool.set(key, sentence);
          if (sentences.length < MAX_PER_WORD && !seen.has(sentence.ja)) {
            seen.add(sentence.ja);
            sentences.push(sentence);
          }
        }
      }
      if (sentences.length) byWord.set(String(word.id), sentences);
    }
    this.byWord = byWord;
    this.pool = [...pool.values()];
    this.sorted = null;
  }

  download(onProgress = () => {}) {
    this.downloading ??= this.fetchExamples(onProgress).finally(() => {
      this.downloading = null;
    });
    return this.downloading;
  }

  async fetchExamples(onProgress) {
    const release = await fetchJson(this.fetchImpl, RELEASE_URL);
    const asset = pickAsset(release);
    const files = unzipSync(await fetchBytes(this.fetchImpl, asset.browser_download_url, onProgress));
    const name = Object.keys(files).find((file) => file.endsWith('.json'));
    if (!name) throw new Error('Examples archive contains no JSON file');
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.file}.${crypto.randomUUID()}.tmp`;
    await fs.promises.writeFile(tmp, files[name]);
    await fs.promises.rename(tmp, this.file);
    this.byWord = null;
    this.pool = null;
    this.sorted = null;
  }

  forWord(entryId, limit = MAX_PER_WORD) {
    if (!this.byWord) throw new Error('Examples not loaded');
    return (this.byWord.get(String(entryId)) ?? []).slice(0, limit);
  }

  forKanji(char, limit = DEFAULT_KANJI_LIMIT) {
    if (!this.pool) throw new Error('Examples not loaded');
    this.sorted ??= [...this.pool].sort((a, b) => [...a.ja].length - [...b.ja].length);
    const found = [];
    for (const sentence of this.sorted) {
      if (!sentence.ja.includes(char)) continue;
      found.push(sentence);
      if (found.length >= limit) break;
    }
    return found;
  }
}

module.exports = { Examples };
