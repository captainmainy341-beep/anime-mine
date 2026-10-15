const { LearnStore } = require('../core/learnStore');
const studyPack = require('../core/studyPack');
const grammarData = require('../core/grammar');
const { furigana: furiganaText } = require('../core/furigana');
const { parseSubtitleFile } = require('../core/subtitles');
const ai = require('../core/ai');
const srs = require('../core/srs');
const { buildEpisodePrep } = require('../core/episodePrep');

const ID_PATTERN = /^[rkvgc]:.{1,40}$/;
const MAX_TEXT = 1000;
const MAX_FURIGANA = 500;
const MAX_GRAMMAR_HITS = 6;
const MAX_INCORRECT = 50;
const PASS_STAGE = 5;
const MNEMONIC_KINDS = ['kanji', 'vocab', 'custom'];
const EMPTY_GRAMMAR = { points: [], byId: new Map(), byTitle: new Map() };

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertObject(value, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be an object`);
}

function assertId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error(`invalid study id: ${String(id)}`);
}

function assertIds(ids) {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !ID_PATTERN.test(id))) {
    throw new Error('ids must be a list of study ids');
  }
}

function assertText(value, name, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be text of at most ${max} characters`);
}

function optionalText(value, name) {
  if (value !== undefined && value !== null) assertText(value, name);
}

function assertTextList(value, name) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.length > MAX_TEXT)) {
    throw new Error(`${name} must be a list of texts`);
  }
}

function assertNumber(value, name) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
}

function queueOptions(opts = {}) {
  assertObject(opts, 'options');
  if (opts.ids !== undefined) assertIds(opts.ids);
  if (opts.limit !== undefined) assertNumber(opts.limit, 'limit');
  return opts;
}

function mnemonicPrompt(card) {
  const lines = [`Item: ${card.char ?? card.word}`, `Meaning: ${card.meanings.join(', ')}`];
  if (card.readingText) lines.push(`Reading: ${card.readingText}`);
  if (card.components.length) lines.push(`Parts: ${card.components.map((c) => `${c.char} (${c.name})`).join(', ')}`);
  if (card.hint) lines.push(`Hint: ${card.hint}`);
  lines.push(
    'Write a vivid 2-3 sentence mnemonic that links the meanings of the parts to the meaning of the item.',
    'For the reading, add a sound-alike hook that sounds like the reading.',
  );
  return {
    system: 'You write memorable mnemonics for a Japanese learner. Reply with plain text only: 2-3 sentences, no markdown, no lists, no headings.',
    user: lines.join('\n'),
  };
}

function createLearnHandlers({ dataDir, getSettings, library, tokenize, knownWords, episodeCues, glossFor = async () => ({ meanings: [], reading: '' }), notify = () => {}, deps = {} }) {
  const loadPack = deps.loadPack ?? studyPack.loadPack;
  const packStatus = deps.packStatus ?? studyPack.packStatus;
  const downloadPack = deps.downloadPack ?? studyPack.downloadPack;
  const loadGrammar = deps.loadGrammar ?? grammarData.loadGrammar;
  const scanLibrary = deps.scanLibrary ?? grammarData.scanLibrary;
  const parseFile = deps.parseSubtitleFile ?? parseSubtitleFile;
  const furigana = deps.furigana ?? furiganaText;
  const complete = deps.complete ?? ai.complete;

  let store = null;
  let scanning = null;

  function onStage({ id, kind, prevStage, stage }) {
    if (!['vocab', 'custom'].includes(kind) || stage < PASS_STAGE || prevStage >= PASS_STAGE) return;
    try {
      const known = knownWords();
      known.addMany([store.labelOf(id)], 'known', 'learn');
      known.save();
    } catch {
      // Known-word sync is best effort; the SRS transition must still be saved.
    }
  }

  function ensureStore() {
    if (store) return store;
    let grammar;
    try {
      grammar = loadGrammar();
    } catch {
      grammar = EMPTY_GRAMMAR;
    }
    store = new LearnStore({ dataDir, pack: loadPack(dataDir), grammar, onStage });
    return store;
  }

  async function runScan() {
    const s = ensureStore();
    const result = await scanLibrary({
      shows: await library.scan(),
      points: s.grammar.points,
      parseSubtitleFile: parseFile,
      onProgress: (done, total) => notify('learn:scanProgress', { done, total }),
    });
    s.setAnimeSentences(result);
    const lists = Object.values(result);
    return {
      points: lists.filter((list) => list.length > 0).length,
      sentences: lists.reduce((total, list) => total + list.length, 0),
    };
  }

  const handlers = {
    'learn:status': () => {
      const s = ensureStore();
      const count = s.grammar.points.length;
      return {
        pack: packStatus(dataDir),
        grammar: { ready: count > 0, count },
        scanned: Object.keys(s.state.animeSentences).length > 0,
      };
    },
    'learn:downloadPack': async () => {
      const s = ensureStore();
      await downloadPack({ dataDir, onProgress: (f) => notify('learn:progress', f) });
      s.setPack(loadPack(dataDir));
      return packStatus(dataDir);
    },
    'learn:dashboard': () => ensureStore().dashboard(),
    'learn:levels': () => ensureStore().levelOverview(),
    'learn:stats': () => ensureStore().stats(),
    'learn:settingsGet': () => ensureStore().settingsGet(),
    'learn:settingsSet': (patch) => {
      assertObject(patch, 'settings patch');
      return ensureStore().settingsSet(patch);
    },
    'learn:lessons': (opts) => ensureStore().lessonQueue(queueOptions(opts)),
    'learn:completeLessons': (ids) => {
      assertIds(ids);
      return ensureStore().completeLessons(ids);
    },
    'learn:reviews': (opts) => ensureStore().reviewQueue(queueOptions(opts)),
    'learn:submit': (input) => {
      assertObject(input, 'submit');
      assertId(input.id);
      if (!Number.isInteger(input.incorrectCount) || input.incorrectCount < 0 || input.incorrectCount > MAX_INCORRECT) {
        throw new Error(`incorrectCount must be an integer from 0 to ${MAX_INCORRECT}`);
      }
      return ensureStore().submitReview({ id: input.id, incorrectCount: input.incorrectCount });
    },
    'learn:cram': (opts) => {
      assertObject(opts, 'cram options');
      if (opts.limit !== undefined) assertNumber(opts.limit, 'limit');
      return ensureStore().cramQueue(opts);
    },
    'learn:card': (id) => {
      assertId(id);
      return ensureStore().card(id);
    },
    'learn:browse': (query = {}) => {
      assertObject(query, 'browse query');
      if (query.query !== undefined) assertText(query.query, 'query');
      return ensureStore().browse(query);
    },
    'learn:setUserData': (input) => {
      assertObject(input, 'user data');
      assertId(input.id);
      assertObject(input.patch, 'patch');
      for (const key of ['meaning', 'reading', 'mnemonic']) optionalText(input.patch[key], key);
      return ensureStore().setUserData(input.id, input.patch);
    },
    'learn:addWord': (input) => {
      assertObject(input, 'word');
      assertText(input.word, 'word');
      assertTextList(input.kana, 'kana');
      assertTextList(input.meanings, 'meanings');
      if (input.sentence !== undefined && input.sentence !== null) {
        assertObject(input.sentence, 'sentence');
        assertText(input.sentence.ja, 'sentence.ja');
        optionalText(input.sentence.en, 'sentence.en');
      }
      return ensureStore().addCustomWord(input);
    },
    'learn:removeWord': (id) => {
      assertId(id);
      return ensureStore().removeCustomWord(id);
    },
    'learn:resetLevel': (n) => {
      assertNumber(n, 'level');
      return ensureStore().resetToLevel(n);
    },
    'learn:resurrect': (id) => {
      assertId(id);
      return ensureStore().resurrect(id);
    },
    'learn:vacation': (on) => {
      if (typeof on !== 'boolean') throw new Error('on must be true or false');
      return ensureStore().setVacation(on);
    },
    'learn:furigana': (text) => {
      assertText(text, 'text', MAX_FURIGANA);
      return furigana(text, tokenize);
    },
    'learn:grammarIn': (text) => {
      assertText(text, 'text');
      const s = ensureStore();
      return grammarData
        .detectGrammar(text, s.grammar.points)
        .slice(0, MAX_GRAMMAR_HITS)
        .map((hit) => {
          const point = s.entry(hit.id);
          return {
            id: hit.id,
            title: point.title,
            jlpt: point.jlpt,
            meaning: point.meaning,
            start: hit.start,
            end: hit.end,
            text: hit.text,
            stage: s.stageOf(hit.id),
          };
        });
    },
    'learn:episodePrep': async (input) => {
      assertObject(input, 'episode prep input');
      if (!episodeCues) throw new Error('learn:episodePrep requires the episodeCues dependency');
      const subtitle = await episodeCues(input);
      if (!subtitle) return null;
      const s = ensureStore();
      return buildEpisodePrep({
        cues: subtitle.cues,
        tokenize,
        known: knownWords(),
        points: s.grammar.points,
        detectGrammar: grammarData.detectGrammar,
        stageOf: (id) => s.stageOf(id),
        glossFor,
      });
    },
    'learn:scanGrammar': () => {
      scanning ??= runScan().finally(() => {
        scanning = null;
      });
      return scanning;
    },
    'learn:mnemonic': async (id) => {
      assertId(id);
      const s = ensureStore();
      const kind = srs.kindOf(id);
      if (!MNEMONIC_KINDS.includes(kind)) throw new Error('Mnemonics are only for kanji and vocabulary');
      const card = s.card(id);
      const { ai: aiSettings } = await getSettings();
      if (!ai.aiReady(aiSettings)) throw new Error('Add an AI key in Settings first');
      const text = await complete(aiSettings, mnemonicPrompt(card), 300);
      s.setUserData(id, { mnemonic: text });
      return text;
    },
  };

  function markMined(word, extra) {
    try {
      const s = ensureStore();
      if (s.settingsGet().autoAddMined !== true) return;
      const { base, reading } = typeof word === 'string' ? { base: word } : word ?? {};
      const { meaning, sentence } = extra ?? {};
      const text = typeof base === 'string' ? base.trim() : '';
      const gloss = typeof meaning === 'string' ? meaning.trim() : '';
      if (!text || !gloss) return;
      s.addCustomWord({
        word: text,
        kana: reading ? [reading] : [],
        meanings: [gloss],
        sentence: sentence ? { ja: sentence, en: '' } : undefined,
      });
    } catch {
      // Vocabulary bookkeeping must not turn a successful mine into an error.
    }
  }

  return { handlers, markMined, stop: () => {} };
}

module.exports = { createLearnHandlers };
