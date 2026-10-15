const fs = require('fs/promises');
const { Kanjidic } = require('../core/kanjidic');
const { Examples } = require('../core/examples');
const { wordDetail, kanjiDetail } = require('../core/wordInfo');
const { extractVocabulary, toWordList } = require('../core/vocabText');

const STATUSES = ['known', 'learning', 'never-forget', 'suspended', 'blacklisted'];
const KINDS = ['anime', 'manga'];
const ID_MAX = 200;
const WORD_MAX = 100;
const QUERY_MAX = 100;
const EXTRACT_MAX = 200000;
const LIST_DEFAULT = 200;
const LIST_MAX = 1000;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertObject(value, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be an object`);
}

function assertText(value, name, max) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be text of at most ${max} characters`);
}

function assertKey(value, name, max) {
  assertText(value, name, max);
  if (value === '') throw new Error(`${name} is required`);
}

function assertCount(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
}

function assertId(value) {
  assertKey(value, 'id', ID_MAX);
}

function optionalKind(kind) {
  if (kind === undefined || kind === null) return undefined;
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
  return kind;
}

function createVocabHandlers({ dataDir, library, dictionary, pitchAccent, knownWords, episodeCues, tokenize, corpus, notify = () => {}, deps = {} }) {
  const kanjidic = new (deps.Kanjidic ?? Kanjidic)(dataDir);
  const examples = new (deps.Examples ?? Examples)(dataDir);
  const statusOf = (word) => {
    const known = knownWords();
    const token = { isWord: true, base: word, surface: word };
    const status = known.classify(token);
    return status === 'new' && known.isSuspended(token) ? 'suspended' : status;
  };

  async function ready(resource) {
    if (!resource.isReady()) return null;
    await resource.load();
    return resource;
  }

  async function removeWork(id) {
    assertId(id);
    return { removed: corpus.removeWork(id) };
  }

  async function subtitleSentences(show) {
    const sentences = [];
    for (const episode of show.episodes) {
      if (!episode.subtitlePath) continue;
      const result = await episodeCues({ videoPath: episode.path });
      for (const cue of result?.cues ?? []) sentences.push(cue.text);
    }
    return sentences;
  }

  async function indexAnime(req) {
    const force = req?.force === true;
    const shows = await library.scan();
    const indexedIds = new Set(corpus.works().map((work) => work.id));
    let indexed = 0;
    let skipped = 0;
    for (const [i, show] of shows.entries()) {
      const id = `anime:${show.title}`;
      if (!force && indexedIds.has(id)) {
        skipped += 1;
      } else {
        const sentences = await subtitleSentences(show);
        if (sentences.length) {
          await corpus.addWork({ id, kind: 'anime', title: show.title }, sentences, tokenize);
          indexed += 1;
        } else {
          skipped += 1;
        }
      }
      notify('corpus:progress', { done: i + 1, total: shows.length, title: show.title });
    }
    return { indexed, skipped };
  }

  function listWords(req = {}) {
    assertObject(req, 'list options');
    const { status, query, limit = LIST_DEFAULT, offset = 0 } = req;
    if (status !== undefined && status !== null && !STATUSES.includes(status)) {
      throw new Error(`status must be one of ${STATUSES.join(', ')}`);
    }
    if (query !== undefined && query !== null) assertText(query, 'query', QUERY_MAX);
    assertCount(limit, 'limit', 1, LIST_MAX);
    assertCount(offset, 'offset', 0, Number.MAX_SAFE_INTEGER);
    const needle = query ?? '';
    const matches = Object.entries(knownWords().words)
      .filter(([word, entry]) => (!status || entry.status === status) && word.includes(needle))
      .sort(([, a], [, b]) => b.added - a.added);
    const rows = matches.slice(offset, offset + limit).map(([word, entry]) => ({
      word,
      status: entry.status,
      source: entry.source,
      added: entry.added,
    }));
    return { total: matches.length, rows };
  }

  async function extract(req) {
    assertObject(req, 'extract options');
    assertText(req.text, 'text', EXTRACT_MAX);
    const rows = await extractVocabulary(req.text, tokenize, statusOf);
    return { rows, wordList: toWordList(rows, { onlyUnknown: req.onlyUnknown === true }) };
  }

  const handlers = {
    'vocab:status': () => ({
      dict: dictionary.isReady(),
      kanjidic: kanjidic.isReady(),
      examples: examples.isReady(),
      pitch: pitchAccent.isReady(),
    }),
    'vocab:word': async (key) => {
      assertKey(key, 'word', WORD_MAX);
      return wordDetail({
        dictionary: await ready(dictionary),
        kanjidic: await ready(kanjidic),
        examples: await ready(examples),
        pitch: await ready(pitchAccent),
        corpus,
        known: knownWords(),
      }, key);
    },
    'vocab:kanji': async (char) => {
      if (typeof char !== 'string' || [...char].length !== 1) throw new Error('kanji must be a single character');
      return kanjiDetail({
        dictionary: await ready(dictionary),
        kanjidic: await ready(kanjidic),
        examples: await ready(examples),
        corpus,
        known: knownWords(),
      }, char);
    },
    'vocab:list': listWords,
    'vocab:counts': () => knownWords().stats(),
    'vocab:extract': extract,
    'kanjidic:download': async () => {
      await kanjidic.download((fraction) => notify('kanjidic:progress', fraction));
      return { ready: true };
    },
    'examples:download': async () => {
      await examples.download((fraction) => notify('examples:progress', fraction));
      return { ready: true };
    },
    'corpus:works': (req) => corpus.difficultyList(optionalKind(req?.kind)),
    'corpus:stats': (id) => {
      assertId(id);
      return corpus.workStats(id);
    },
    'corpus:coverage': (id) => {
      assertId(id);
      return corpus.coverage(id, statusOf);
    },
    'corpus:removeWork': removeWork,
    'corpus:indexAnime': indexAnime,
  };

  return { handlers, stop: () => {}, kanjidic, examples };
}

module.exports = { createVocabHandlers };
