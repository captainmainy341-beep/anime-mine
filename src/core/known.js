const fs = require('node:fs');
const path = require('node:path');

const STATUSES = ['known', 'learning'];
const SKIP_POS = ['助詞', '助動詞', '記号', 'フィラー', '接頭詞'];
const VERB_ADJ_POS = ['動詞', '形容詞'];
const DEPENDENT_POS2 = ['非自立', '接尾'];
const AUXILIARY_BASES = new Set(['する', 'いる', 'ある', 'なる']);
const WORD_FIELDS = ['Word', 'Expression', 'Vocab', 'Vocabulary', 'Front', 'Kanji'];
const CHUNK_SIZE = 200;
const MAX_WORD_LENGTH = 20;
const TOP_NEW_LIMIT = 15;
const NUMBER_RE = /^[0-9０-９][0-9０-９.,]*$/;
const KANA_RE = /^[\u3041-\u309f\u30a0-\u30ffー]+$/;

function normalize(word) {
  return typeof word === 'string' ? word.trim() : '';
}

function escapeSearch(value) {
  return String(value).replace(/[\\"*_.]/g, '\\$&');
}

function deckQuery(deck) {
  return `deck:"${escapeSearch(deck)}"`;
}

function contentKey(token) {
  return token.base || token.surface;
}

function isDependentToken(token) {
  const pos2 = token.pos2 ?? '';
  return DEPENDENT_POS2.some((prefix) => pos2.startsWith(prefix));
}

function isSkippedToken(token) {
  const pos = token.pos ?? '';
  if (SKIP_POS.some((prefix) => pos.startsWith(prefix)) || NUMBER_RE.test(token.surface ?? '')) return true;
  if (!isDependentToken(token)) return false;
  return VERB_ADJ_POS.some((prefix) => pos.startsWith(prefix)) || AUXILIARY_BASES.has(token.base);
}

function assertStatus(status) {
  if (!STATUSES.includes(status)) throw new Error(`invalid status: ${status}`);
}

function cleanField(value) {
  return value
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
    .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s*\[[^[\]]*\]/g, '');
}

function splitWords(text) {
  return text
    .split(/[、・/]/)
    .map((part) => part.trim())
    .filter((part) => part && [...part].length <= MAX_WORD_LENGTH);
}

function wordsFromNote(fields, field) {
  for (const name of [field, ...WORD_FIELDS]) {
    if (!name || !Object.hasOwn(fields, name)) continue;
    const words = splitWords(cleanField(fields[name]?.value ?? ''));
    if (words.length) return words;
  }
  return [];
}

class KnownWords {
  #revision = 0;

  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'known.json');
    this.words = {};
  }

  get revision() {
    return this.#revision;
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.words = {};
      this.#revision = 0;
      return this;
    }
    const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.words = parsed && typeof parsed.words === 'object' && parsed.words !== null ? parsed.words : {};
    this.#revision = Number.isSafeInteger(parsed?.revision) ? parsed.revision : 0;
    return this;
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ words: this.words, revision: this.#revision }, null, 2));
    try {
      fs.renameSync(tmp, this.file);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }

  entry(word) {
    const key = normalize(word);
    return key && Object.hasOwn(this.words, key) ? this.words[key] : null;
  }

  has(word) {
    return this.entry(word) !== null;
  }

  status(word) {
    return this.entry(word)?.status ?? 'new';
  }

  mark(word, status, source = 'manual') {
    const key = normalize(word);
    if (!key) return false;
    if (status === 'new') {
      if (!this.has(key)) return false;
      delete this.words[key];
      this.#revision += 1;
      return true;
    }
    assertStatus(status);
    const existing = this.entry(key);
    if (existing?.status === status) return false;
    this.words[key] = { status, source, added: existing ? existing.added : Date.now() };
    this.#revision += 1;
    return true;
  }

  addMany(words, status, source = 'manual') {
    assertStatus(status);
    let added = 0;
    let skipped = 0;
    for (const word of words) {
      if (status === 'learning' && this.status(word) === 'known') {
        skipped++;
      } else if (this.mark(word, status, source)) {
        added++;
      } else {
        skipped++;
      }
    }
    return { added, skipped };
  }

  stats() {
    const counts = { known: 0, learning: 0 };
    for (const entry of Object.values(this.words)) {
      if (entry.status in counts) counts[entry.status]++;
    }
    return counts;
  }

  classify(token) {
    if (!token || !token.isWord || isSkippedToken(token)) return 'skip';
    const candidates = [token.base, token.surface];
    if (KANA_RE.test(token.reading ?? '')) candidates.push(token.reading);
    for (const candidate of candidates) {
      const entry = this.entry(candidate);
      if (entry) return entry.status;
    }
    return 'new';
  }

  classifyTokens(tokens) {
    return tokens.map((token) => this.classify(token));
  }

  sentenceInfo(tokens) {
    const newByKey = new Map();
    let contentCount = 0;
    let unknownCount = 0;
    for (const token of tokens) {
      const status = this.classify(token);
      if (status === 'skip') continue;
      contentCount++;
      if (status !== 'new') continue;
      unknownCount++;
      const key = contentKey(token);
      if (!newByKey.has(key)) newByKey.set(key, token);
    }
    const newWords = [...newByKey.values()];
    return {
      newWords,
      unknownCount,
      isIPlusOne: newWords.length === 1 && contentCount >= 3,
    };
  }

  async importFromAnki(client, { deck, field, matureOnly = false, extraQuery = '' } = {}) {
    let query = `${deckQuery(deck)} -is:new`;
    if (matureOnly) query += ' prop:ivl>=21';
    if (extraQuery) query += ` ${extraQuery}`;
    const ids = (await client.invoke('findNotes', { query })) ?? [];
    const words = [];
    let notes = 0;
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const infos = (await client.invoke('notesInfo', { notes: ids.slice(i, i + CHUNK_SIZE) })) ?? [];
      for (const info of infos) {
        notes++;
        words.push(...wordsFromNote(info.fields ?? {}, field));
      }
    }
    return { ...this.addMany(words, 'known', 'anki'), notes };
  }
}

async function ankiFieldNames(client, deck) {
  const ids = (await client.invoke('findNotes', { query: deckQuery(deck) })) ?? [];
  if (!ids.length) return { fields: [], suggested: null };
  const [info] = (await client.invoke('notesInfo', { notes: [ids[0]] })) ?? [];
  const fields = Object.entries(info?.fields ?? {})
    .sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0))
    .map(([name]) => name);
  return { fields, suggested: WORD_FIELDS.find((name) => fields.includes(name)) ?? null };
}

function importFromText(store, text) {
  const words = [];
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.trimStart().startsWith('#')) continue;
    const word = raw.split('\t')[0].trim();
    if (word) words.push(word);
  }
  return store.addMany(words, 'known', 'text');
}

async function episodeCoverage(cues, tokenize, known) {
  let totalWords = 0;
  let knownWords = 0;
  let learningWords = 0;
  let newWords = 0;
  const newCounts = new Map();
  for (const cue of cues) {
    const text = typeof cue === 'string' ? cue : (cue.text ?? '');
    if (!text.trim()) continue;
    for (const token of await tokenize(text)) {
      const status = known.classify(token);
      if (status === 'skip') continue;
      totalWords++;
      if (status === 'known') {
        knownWords++;
      } else if (status === 'learning') {
        learningWords++;
      } else {
        newWords++;
        const key = contentKey(token);
        newCounts.set(key, (newCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const topNew = [...newCounts]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_NEW_LIMIT);
  return {
    totalWords,
    knownWords,
    learningWords,
    newWords,
    coverage: totalWords ? (knownWords + learningWords) / totalWords : 0,
    uniqueNew: newCounts.size,
    topNew,
  };
}

module.exports = { KnownWords, ankiFieldNames, importFromText, episodeCoverage };
