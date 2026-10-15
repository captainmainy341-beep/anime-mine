const fs = require('node:fs');
const path = require('node:path');

const SKIP_POS = ['助詞', '助動詞', '記号', 'フィラー', '接頭詞'];
const KANJI_RE = /\p{Script=Han}/u;
const KINDS = ['anime', 'manga'];
const TOP_NEW_LIMIT = 15;
const PEAK_PERCENTILE = 0.9;
const FREQUENCY_BUCKETS = [
  [200, 'Top 200'],
  [1000, 'Top 1000'],
  [5000, 'Top 5000'],
];
// Local heuristic, not jpdb's ML difficulty model: rarer vocabulary, kanji per word and sentence length, scaled 0-100.
const VOCAB_WEIGHT = 0.6;
const KANJI_WEIGHT = 0.2;
const LENGTH_WEIGHT = 0.2;
const KANJI_PER_WORD_CAP = 3;
const LENGTH_CAP = 80;

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (values) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);

function isWordToken(token) {
  const pos = token.pos ?? '';
  return Boolean(token.isWord) && !SKIP_POS.some((prefix) => pos.startsWith(prefix));
}

function countBy(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

function rankOf(counts) {
  const ordered = [...counts].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
  return new Map(ordered.map(([key], i) => [key, i + 1]));
}

function bucketOf(rank) {
  if (rank === null) return null;
  return FREQUENCY_BUCKETS.find(([limit]) => rank <= limit)?.[1] ?? null;
}

function buildGlobal(works) {
  const sentences = works.flatMap((work) => work.sentences);
  const counts = countBy(sentences.flatMap((s) => s.words));
  return {
    counts,
    ranks: rankOf(counts),
    distinct: counts.size,
    kanjiRanks: rankOf(countBy(sentences.flatMap((s) => s.kanji))),
  };
}

function vocabScore(global, word) {
  return Math.log(global.ranks.get(word)) / Math.log(Math.max(global.distinct, 2));
}

function blend(vocab, kanjiPerWord, length) {
  return (
    100 *
    (VOCAB_WEIGHT * vocab +
      KANJI_WEIGHT * Math.min(1, kanjiPerWord / KANJI_PER_WORD_CAP) +
      LENGTH_WEIGHT * Math.min(1, length / LENGTH_CAP))
  );
}

function sentenceDifficulty(global, sentence) {
  const vocab = mean(sentence.words.map((word) => vocabScore(global, word)));
  return blend(vocab, sentence.kanji.length / Math.max(1, sentence.words.length), sentence.chars);
}

function topNewWords(unknown) {
  return unknown
    .filter((entry) => entry.status === 'new')
    .sort((a, b) => b.count - a.count || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0))
    .slice(0, TOP_NEW_LIMIT)
    .map(({ word, count }) => ({ word, count }));
}

class Corpus {
  #works = new Map();
  #revision = 0;
  #global = null;

  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'corpus.json');
  }

  get revision() {
    return this.#revision;
  }

  load() {
    this.#global = null;
    if (!fs.existsSync(this.file)) {
      this.#works = new Map();
      this.#revision = 0;
      return this;
    }
    const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    this.#works = new Map(Object.entries(parsed.works ?? {}));
    this.#revision = Number.isSafeInteger(parsed.revision) ? parsed.revision : 0;
    return this;
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ works: Object.fromEntries(this.#works), revision: this.#revision }));
    try {
      fs.renameSync(tmp, this.file);
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }

  async addWork({ id, kind, title }, sentences, tokenize) {
    if (typeof id !== 'string' || !id || !KINDS.includes(kind)) throw new Error('work needs a string id and kind anime|manga');
    const parsed = [];
    for (const raw of sentences) {
      const text = raw.trim();
      if (!text) continue;
      const words = [];
      const kanji = [];
      for (const token of await tokenize(text)) {
        for (const ch of token.surface ?? '') if (KANJI_RE.test(ch)) kanji.push(ch);
        if (isWordToken(token)) words.push(token.base || token.surface);
      }
      parsed.push({ chars: [...text].length, words, kanji });
    }
    this.#works.set(id, { id, kind, title: title ?? '', sentences: parsed });
    this.#global = null;
    this.#revision += 1;
    this.save();
  }

  removeWork(id) {
    if (!this.#works.delete(id)) return false;
    this.#global = null;
    this.#revision += 1;
    this.save();
    return true;
  }

  works() {
    return [...this.#works.values()].map(({ id, kind, title, sentences }) => ({
      id,
      kind,
      title,
      sentenceCount: sentences.length,
    }));
  }

  #globalIndex() {
    this.#global ??= buildGlobal([...this.#works.values()]);
    return this.#global;
  }

  globalRank(word) {
    return this.#globalIndex().ranks.get(word) ?? null;
  }

  frequencyBucket(word) {
    return bucketOf(this.globalRank(word));
  }

  wordCount(word) {
    return this.#globalIndex().counts.get(word) ?? 0;
  }

  kanjiRank(char) {
    return this.#globalIndex().kanjiRanks.get(char) ?? null;
  }

  kanjiFrequencyBucket(char) {
    return bucketOf(this.kanjiRank(char));
  }

  wordsWith(char, limit) {
    return [...this.#globalIndex().counts]
      .filter(([word]) => word.includes(char))
      .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, limit)
      .map(([word, count]) => ({ word, count }));
  }

  workStats(id) {
    const work = this.#works.get(id);
    if (!work) return null;
    const global = this.#globalIndex();
    const { sentences } = work;
    const wordCounts = countBy(sentences.flatMap((s) => s.words));
    const kanjiCounts = countBy(sentences.flatMap((s) => s.kanji));
    const words = sentences.reduce((sum, s) => sum + s.words.length, 0);
    const kanjiTotal = sentences.reduce((sum, s) => sum + s.kanji.length, 0);
    const characters = sentences.reduce((sum, s) => sum + s.chars, 0);
    const avgSentenceLength = sentences.length ? characters / sentences.length : 0;
    const vocab = mean(sentences.flatMap((s) => s.words.map((word) => vocabScore(global, word))));
    const difficulty = words ? blend(vocab, kanjiTotal / words, avgSentenceLength) : 0;
    const scores = sentences.map((s) => sentenceDifficulty(global, s)).sort((a, b) => a - b);
    const peak = scores.length ? scores[Math.min(scores.length - 1, Math.ceil(PEAK_PERCENTILE * scores.length) - 1)] : 0;
    const uniqueOnce = [...wordCounts.values()].filter((count) => count === 1).length;
    const kanjiOnce = [...kanjiCounts.values()].filter((count) => count === 1).length;
    return {
      id: work.id,
      kind: work.kind,
      title: work.title,
      words,
      uniqueWords: wordCounts.size,
      uniqueOnce,
      uniqueOncePct: wordCounts.size ? round1((100 * uniqueOnce) / wordCounts.size) : 0,
      uniqueKanji: kanjiCounts.size,
      kanjiOnce,
      characters,
      avgSentenceLength: round1(avgSentenceLength),
      difficulty: round1(difficulty),
      peakDifficulty: round1(peak),
    };
  }

  difficultyList(kind) {
    return [...this.#works.keys()]
      .map((id) => this.workStats(id))
      .filter((stats) => kind === undefined || stats.kind === kind)
      .sort((a, b) => a.difficulty - b.difficulty || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  coverage(id, statusOf) {
    const work = this.#works.get(id);
    if (!work) return null;
    let totalWords = 0;
    let knownWords = 0;
    const unknown = [];
    for (const [word, count] of countBy(work.sentences.flatMap((s) => s.words))) {
      const status = statusOf(word);
      if (status === 'skip') continue;
      totalWords += count;
      if (status === 'known' || status === 'learning') {
        knownWords += count;
      } else {
        unknown.push({ word, count, status });
      }
    }
    return {
      totalWords,
      knownPct: totalWords ? round1((100 * knownWords) / totalWords) : 0,
      unknownUnique: unknown.length,
      topNew: topNewWords(unknown),
    };
  }
}

module.exports = { Corpus };
