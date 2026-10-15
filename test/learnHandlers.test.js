const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLearnHandlers } = require('../src/main/learnHandlers');
const { KnownWords } = require('../src/core/known');

const HOUR = 3600000;
const NOW = new Date(2026, 9, 10, 12, 0, 0).getTime();
const dirs = [];

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const PACK = {
  version: 1,
  builtAt: 0,
  levels: 1,
  radicals: {
    'r:木': { id: 'r:木', char: '木', name: 'tree', level: 1 },
    'r:力': { id: 'r:力', char: '力', name: 'power', level: 1 },
  },
  kanji: {
    'k:林': { id: 'k:林', char: '林', meanings: ['grove'], onyomi: ['リン'], kunyomi: ['はやし'], nanori: [], strokes: 8, grade: 2, jlptOld: null, freq: null, level: 1, components: ['r:木'], hint: 'two trees', vocab: ['v:2'] },
  },
  vocab: {
    'v:2': { id: 'v:2', word: '林', kana: ['はやし'], meanings: ['grove'], pos: ['n'], kanji: ['k:林'], level: 1, sentences: [{ ja: '林です。', en: 'It is a grove.' }] },
  },
  levelList: [{ level: 1, radicals: ['r:木', 'r:力'], kanji: ['k:林'], vocab: ['v:2'] }],
};

function point(id, title, detect, jlpt = 'N5') {
  return {
    id,
    jlpt,
    title,
    meaning: `meaning of ${title}`,
    structure: 'structure',
    formality: 'neutral',
    notes: 'notes',
    similar: [],
    detect,
    examples: [{ ja: 'ここで{{撮ってもいい}}ですか。', en: 'May I?', hint: 'hint' }],
  };
}

const grammarOf = (points) => ({ points, byId: new Map(points.map((p) => [p.id, p])), byTitle: new Map(points.map((p) => [p.title, p])) });

const GRAMMAR_POINTS = [point('g:n5-a', '〜A', ['撮ってもいい']), point('g:n4-b', '〜B', ['つもり'], 'N4')];

function harness({ settings = { ai: { provider: 'anthropic', apiKey: 'sk-test', model: 'm' } }, deps = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-handlers-'));
  dirs.push(dataDir);
  const known = new KnownWords(dataDir).load();
  const notes = [];
  const calls = { loadPack: 0 };
  const h = createLearnHandlers({
    dataDir,
    getSettings: async () => settings,
    library: { scan: async () => [] },
    tokenize: async () => [],
    knownWords: () => known,
    notify: (channel, payload) => notes.push({ channel, payload }),
    deps: {
      loadPack: () => {
        calls.loadPack += 1;
        return structuredClone(PACK);
      },
      packStatus: () => ({ ready: true, builtAt: 0, counts: { radicals: 2, kanji: 1, vocab: 1 } }),
      loadGrammar: () => grammarOf(GRAMMAR_POINTS),
      ...deps,
    },
  });
  return { ...h, dataDir, known, notes, calls, settings };
}

test('the store is created lazily on the first handler call and reused after', () => {
  const h = harness();
  assert.equal(h.calls.loadPack, 0);
  h.handlers['learn:levels']();
  h.handlers['learn:status']();
  assert.equal(h.calls.loadPack, 1);
  assert.equal(typeof h.stop, 'function');
  h.stop();
});

test('a grammar load failure falls back to an empty grammar', () => {
  const h = harness({ deps: { loadGrammar: () => { throw new Error('bad data'); } } });
  assert.deepEqual(h.handlers['learn:grammarIn']('撮ってもいい'), []);
  assert.deepEqual(h.handlers['learn:status']().grammar, { ready: false, count: 0 });
});

test('status reports pack, grammar and scan state', () => {
  const h = harness();
  assert.deepEqual(h.handlers['learn:status'](), {
    pack: { ready: true, builtAt: 0, counts: { radicals: 2, kanji: 1, vocab: 1 } },
    grammar: { ready: true, count: 2 },
    scanned: false,
  });
});

test('malformed arguments are rejected with clear errors', () => {
  const h = harness();
  const { handlers } = h;
  assert.throws(() => handlers['learn:card']('x'), /invalid study id/);
  assert.throws(() => handlers['learn:card'](`k:${'x'.repeat(41)}`), /invalid study id/);
  assert.throws(() => handlers['learn:completeLessons']('k:林'), /list of study ids/);
  assert.throws(() => handlers['learn:submit']({ id: 'v:2', incorrectCount: 51 }), /incorrectCount/);
  assert.throws(() => handlers['learn:submit']({ id: 'v:2', incorrectCount: 1.5 }), /incorrectCount/);
  assert.throws(() => handlers['learn:settingsSet'](null), /must be an object/);
  assert.throws(() => handlers['learn:vacation']('yes'), /true or false/);
  assert.throws(() => handlers['learn:resetLevel'](Infinity), /finite number/);
  assert.throws(() => handlers['learn:furigana']('あ'.repeat(501)), /at most 500/);
  assert.throws(() => handlers['learn:grammarIn'](5), /must be text/);
  assert.throws(() => handlers['learn:addWord']({ word: 'x'.repeat(1001) }), /must be text/);
});

test('lessons, completeLessons, reviews and submit move a radical through its first stage', (t) => {
  let clock = NOW;
  t.mock.method(Date, 'now', () => clock);
  const h = harness();
  const { handlers } = h;

  assert.deepEqual(handlers['learn:lessons']({ scope: 'kanji' }).map((c) => c.id), ['r:木', 'r:力']);
  assert.deepEqual(handlers['learn:completeLessons'](['r:木', 'r:力']).started, ['r:木', 'r:力']);
  assert.deepEqual(handlers['learn:reviews'](), []);

  clock += 5 * HOUR;
  // Default review order is random: assert membership, not a particular shuffle.
  assert.deepEqual(handlers['learn:reviews']().map((c) => c.id).sort(), ['r:木', 'r:力'].sort());

  const pass = handlers['learn:submit']({ id: 'r:木', incorrectCount: 0 });
  assert.equal(pass.prevStage, 1);
  assert.equal(pass.stage, 2);
  const miss = handlers['learn:submit']({ id: 'r:力', incorrectCount: 2 });
  assert.equal(miss.stage, 1);
});

test('a custom word reaching stage 5 is added to the known words', () => {
  const h = harness();
  const { handlers } = h;
  handlers['learn:addWord']({ word: '猫', meanings: ['cat'] });
  handlers['learn:completeLessons'](['c:猫']);
  for (let i = 0; i < 3; i += 1) handlers['learn:submit']({ id: 'c:猫', incorrectCount: 0 });
  assert.equal(h.known.status('猫'), 'new');

  handlers['learn:submit']({ id: 'c:猫', incorrectCount: 0 });
  assert.equal(handlers['learn:card']('c:猫').stage, 5);
  assert.equal(h.known.status('猫'), 'known');
  assert.equal(new KnownWords(h.dataDir).load().status('猫'), 'known');
});

test('grammarIn enriches hits with point details and the store stage, in text order', () => {
  const h = harness();
  const text = 'ここで撮ってもいい。明日行くつもり。';
  const start = text.indexOf('撮ってもいい');
  const second = text.indexOf('つもり');
  assert.deepEqual(h.handlers['learn:grammarIn'](text), [
    { id: 'g:n5-a', title: '〜A', jlpt: 'N5', meaning: 'meaning of 〜A', start, end: start + 6, text: '撮ってもいい', stage: 0 },
    { id: 'g:n4-b', title: '〜B', jlpt: 'N4', meaning: 'meaning of 〜B', start: second, end: second + 3, text: 'つもり', stage: 0 },
  ]);

  h.handlers['learn:completeLessons'](['g:n5-a']);
  assert.equal(h.handlers['learn:grammarIn'](text)[0].stage, 1);
});

test('grammarIn returns at most six hits', () => {
  const points = Array.from({ length: 7 }, (_, i) => point(`g:n5-x${i}`, `〜x${i}`, ['は']));
  const h = harness({ deps: { loadGrammar: () => grammarOf(points) } });
  assert.equal(h.handlers['learn:grammarIn']('はは').length, 6);
});

test('scanGrammar shares one in-flight scan and reports progress', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let scans = 0;
  const h = harness({
    deps: {
      scanLibrary: async ({ onProgress }) => {
        scans += 1;
        onProgress(1, 2);
        await gate;
        return { 'g:n5-a': [{ ja: 'a', en: 'b' }], 'g:n4-b': [] };
      },
    },
  });

  const first = h.handlers['learn:scanGrammar']();
  const second = h.handlers['learn:scanGrammar']();
  assert.equal(first, second);
  release();
  assert.deepEqual(await first, { points: 1, sentences: 1 });
  assert.equal(scans, 1);
  assert.deepEqual(h.notes.find((n) => n.channel === 'learn:scanProgress').payload, { done: 1, total: 2 });
  assert.equal(h.handlers['learn:status']().scanned, true);

  await h.handlers['learn:scanGrammar']();
  assert.equal(scans, 2);
});

test('mnemonic is refused without an AI key and nothing is sent', async () => {
  const sent = [];
  const h = harness({
    settings: { ai: { provider: 'anthropic', apiKey: '', model: 'm' } },
    deps: { complete: async (...args) => { sent.push(args); return 'x'; } },
  });
  await assert.rejects(h.handlers['learn:mnemonic']('k:林'), /Add an AI key in Settings first/);
  assert.equal(sent.length, 0);
});

test('mnemonic is built from the card, saved and returned', async () => {
  const sent = [];
  const text = 'A grove where two trees stand.';
  const h = harness({
    deps: { complete: async (settings, prompt, maxTokens) => { sent.push({ settings, prompt, maxTokens }); return text; } },
  });

  assert.equal(await h.handlers['learn:mnemonic']('k:林'), text);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].settings, h.settings.ai);
  assert.equal(sent[0].maxTokens, 300);
  assert.match(sent[0].prompt.user, /Item: 林/);
  assert.match(sent[0].prompt.user, /Meaning: grove/);
  assert.match(sent[0].prompt.user, /Parts: 木 \(tree\)/);
  assert.equal(h.handlers['learn:card']('k:林').notes.mnemonic, text);
  const saved = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'learn.json'), 'utf8'));
  assert.equal(saved.userData['k:林'].mnemonic, text);
});

test('mnemonic is refused for radicals', async () => {
  const h = harness({ deps: { complete: async () => 'x' } });
  await assert.rejects(h.handlers['learn:mnemonic']('r:木'), /only for kanji and vocabulary/);
});

test('markMined adds the word as a custom card when auto-add is on', (t) => {
  t.mock.method(Date, 'now', () => NOW);
  const h = harness();
  h.markMined({ base: '食べる', reading: 'たべる' }, { meaning: 'to eat', sentence: '朝ご飯を食べた。' });
  const card = h.handlers['learn:card']('c:食べる');
  assert.equal(card.word, '食べる');
  assert.deepEqual(card.meanings, ['to eat']);
  assert.deepEqual(card.reading.accepted, ['たべる']);
  assert.deepEqual(card.sentences, [{ ja: '朝ご飯を食べた。', en: '' }]);
});

test('markMined does nothing when auto-add is off', () => {
  const h = harness();
  h.handlers['learn:settingsSet']({ autoAddMined: false });
  h.markMined('猫', { meaning: 'cat' });
  assert.throws(() => h.handlers['learn:card']('c:猫'), /unknown id/);
});

test('markMined skips words without a meaning and never throws', () => {
  const h = harness();
  assert.doesNotThrow(() => h.markMined('猫', {}));
  assert.doesNotThrow(() => h.markMined(undefined));
  assert.doesNotThrow(() => h.markMined({ base: '  ' }, { meaning: 'x' }));
  assert.throws(() => h.handlers['learn:card']('c:猫'), /unknown id/);
});

test('downloadPack reports progress and reloads the pack into the store', async () => {
  let loaded = null;
  const h = harness({
    deps: {
      loadPack: () => loaded,
      downloadPack: async ({ onProgress }) => {
        onProgress(0.5);
        loaded = structuredClone(PACK);
      },
    },
  });
  assert.deepEqual(h.handlers['learn:levels'](), []);
  await h.handlers['learn:downloadPack']();
  assert.equal(h.handlers['learn:levels']().length, 1);
  assert.deepEqual(h.notes.filter((n) => n.channel === 'learn:progress').map((n) => n.payload), [0.5]);
});

test('furigana is computed with the injected tokenizer', async () => {
  const seen = [];
  const h = harness({
    deps: { furigana: async (text, tok) => { seen.push([text, tok]); return [{ text }]; } },
  });
  assert.deepEqual(await h.handlers['learn:furigana']('日本'), [{ text: '日本' }]);
  assert.equal(seen[0][0], '日本');
  assert.equal(typeof seen[0][1], 'function');
});
