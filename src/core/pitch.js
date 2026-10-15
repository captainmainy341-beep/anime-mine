const fs = require('node:fs');
const path = require('node:path');
const { toHiragana } = require('./kana');

const ACCENTS_URL = 'https://raw.githubusercontent.com/mifunetoshiro/kanjium/master/data/source_files/raw/accents.txt';
const USER_AGENT = 'anime-mine';
const SMALL_KANA = new Set('ゃゅょぁぃぅぇぉャュョァィゥェォ');

function parseAccent(text) {
  const parts = text.replace(/[[\]\s]/g, '').split(',');
  if (!parts.every((part) => /^\d+$/.test(part))) return null;
  return parts.map(Number);
}

function parseEntries(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const fields = line.split('\t');
    const hasReading = fields.length >= 3;
    const expression = fields[0].trim();
    const reading = (hasReading ? fields[1].trim() : '') || expression;
    const patterns = parseAccent(fields[hasReading ? 2 : 1] ?? '');
    if (!expression || !patterns) continue;
    entries.push({ expression, reading, patterns });
  }
  return entries;
}

function buildIndex(entries) {
  const index = new Map();
  for (const entry of entries) {
    for (const key of new Set([entry.expression, entry.reading])) {
      index.set(key, [...(index.get(key) ?? []), entry]);
    }
  }
  return index;
}

function moraSplit(reading) {
  const morae = [];
  for (const char of reading) {
    if (SMALL_KANA.has(char) && morae.length) morae[morae.length - 1] += char;
    else morae.push(char);
  }
  return morae;
}

function isHigh(index, accent) {
  if (accent === 0) return index > 0;
  if (accent === 1) return index === 0;
  return index > 0 && index < accent;
}

function pitchPattern(reading, accent) {
  return moraSplit(reading).map((mora, index) => ({ mora, high: isHigh(index, accent) }));
}

function pitchLabel(reading, accent) {
  if (accent === 0) return 'heiban';
  if (accent === 1) return 'atamadaka';
  if (accent >= moraSplit(reading).length) return 'odaka';
  return 'nakadaka';
}

class PitchAccent {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'accents.txt');
    this.index = null;
  }

  isReady() {
    return fs.existsSync(this.file);
  }

  async load() {
    if (this.index) return;
    this.index = buildIndex(parseEntries(await fs.promises.readFile(this.file, 'utf8')));
  }

  async download(onProgress = () => {}) {
    const res = await fetch(ACCENTS_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Accent download failed: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const chunks = [];
    let received = 0;
    for await (const chunk of res.body) {
      chunks.push(chunk);
      received += chunk.length;
      if (total) onProgress(received / total);
    }
    await fs.promises.mkdir(this.dataDir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.promises.writeFile(tmp, Buffer.concat(chunks));
    await fs.promises.rename(tmp, this.file);
    this.index = null;
  }

  lookup(word, reading) {
    if (!this.index) throw new Error('Pitch accents not loaded');
    const entries = this.index.get(word) ?? [];
    const target = reading ? toHiragana(reading) : null;
    const entry = entries.find((item) => target && toHiragana(item.reading) === target) ?? entries[0];
    if (!entry) return null;
    return { reading: entry.reading, patterns: [...entry.patterns] };
  }
}

module.exports = { PitchAccent, ACCENTS_URL, moraSplit, pitchPattern, pitchLabel };
