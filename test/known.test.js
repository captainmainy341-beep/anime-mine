const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { KnownWords, ankiFieldNames, importFromText, episodeCoverage } = require('../src/core/known');

function token(surface, overrides = {}) {
  return {
    surface,
    base: surface,
    reading: surface,
    pos: '名詞',
    start: 0,
    end: surface.length,
    isWord: true,
    ...overrides,
  };
}

function particle(surface) {
  return token(surface, { pos: '助詞', reading: surface });
}

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'known-test-'));
  return { dir, store: new KnownWords(dir).load() };
}

function note(fields) {
  return {
    fields: Object.fromEntries(Object.entries(fields).map(([name, value], order) => [name, { value, order }])),
  };
}

function fakeAnki(notes) {
  const calls = [];
  return {
    calls,
    async invoke(action, params) {
      calls.push({ action, params });
      if (action === 'findNotes') return notes.map((_, index) => index + 1);
      if (action === 'notesInfo') return params.notes.map((id) => notes[id - 1]);
      throw new Error(`unexpected action ${action}`);
    },
  };
}

async function importWords(fields, options = {}) {
  const { store } = tempStore();
  const client = fakeAnki([note(fields)]);
  await store.importFromAnki(client, { deck: 'D', ...options });
  return store;
}

test('store round-trips through known.json and tolerates a missing file', () => {
  const { dir, store } = tempStore();
  assert.deepEqual(store.stats(), { known: 0, learning: 0 });
  store.mark('食べる', 'known', 'anki');
  store.mark('飲む', 'learning');
  store.addMany(['走る', '走る', '歩く'], 'known', 'text');
  store.save();

  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'known.json'), 'utf8'));
  assert.equal(raw.words['食べる'].status, 'known');
  assert.equal(raw.words['食べる'].source, 'anki');
  assert.equal(typeof raw.words['食べる'].added, 'number');
  assert.deepEqual(fs.readdirSync(dir), ['known.json']);

  const reloaded = new KnownWords(dir).load();
  assert.equal(reloaded.status('食べる'), 'known');
  assert.equal(reloaded.status('飲む'), 'learning');
  assert.equal(reloaded.has('歩く'), true);
  assert.equal(reloaded.has('見る'), false);
  assert.deepEqual(reloaded.stats(), { known: 3, learning: 1 });
});

test('revision counts vocabulary changes, persists them and loads old files as 0', () => {
  const { dir, store } = tempStore();
  store.mark('猫', 'known');
  store.mark('猫', 'known');
  assert.equal(store.revision, 1);
  store.mark('猫', 'learning');
  store.addMany(['犬', '犬', '鳥'], 'known', 'text');
  assert.equal(store.revision, 4);
  store.mark('鳥', 'new');
  assert.equal(store.revision, 5);
  store.save();

  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'known.json'), 'utf8')).revision, 5);
  assert.equal(new KnownWords(dir).load().revision, 5);
  fs.writeFileSync(path.join(dir, 'known.json'), JSON.stringify({ words: { 猫: { status: 'known', source: 'manual', added: 1 } } }));
  assert.equal(new KnownWords(dir).load().revision, 0);
});

test('mark with new removes the word and invalid statuses throw', () => {
  const { store } = tempStore();
  store.mark('猫', 'known');
  store.mark('猫', 'new');
  assert.equal(store.status('猫'), 'new');
  assert.equal(store.has('猫'), false);
  assert.throws(() => store.mark('犬', 'bogus'));
  assert.throws(() => store.addMany(['犬'], 'new'));
});

test('addMany never downgrades known to learning', () => {
  const { store } = tempStore();
  store.mark('猫', 'known');
  store.mark('犬', 'learning');
  assert.deepEqual(store.addMany(['猫', '犬', '鳥'], 'learning', 'mined'), { added: 1, skipped: 2 });
  assert.equal(store.status('猫'), 'known');
  assert.equal(store.status('犬'), 'learning');
  assert.equal(store.status('鳥'), 'learning');
  assert.deepEqual(store.addMany(['犬'], 'known', 'manual'), { added: 1, skipped: 0 });
});

test('classify skips particles, numbers and punctuation', () => {
  const { store } = tempStore();
  store.mark('は', 'known');
  store.mark('１２', 'known');
  assert.equal(store.classify(particle('は')), 'skip');
  assert.equal(store.classify(token('12', { pos: '名詞' })), 'skip');
  assert.equal(store.classify(token('１２', { pos: '名詞' })), 'skip');
  assert.equal(store.classify(token('。', { pos: '記号', isWord: false })), 'skip');
  assert.equal(store.classify(token('えっと', { pos: 'フィラー' })), 'skip');
  assert.equal(store.classify(token('お', { pos: '接頭詞' })), 'skip');
  assert.equal(store.classify(token('です', { pos: '助動詞' })), 'skip');
});

test('classify skips verbs and adjectives that are non-independent or suffixes', () => {
  const { store } = tempStore();
  const dependent = [
    token('い', { base: 'いる', pos: '動詞', pos2: '非自立' }),
    token('させ', { base: 'させる', pos: '動詞', pos2: '接尾' }),
    token('られ', { base: 'られる', pos: '動詞', pos2: '接尾' }),
    token('ない', { base: 'ない', pos: '形容詞', pos2: '非自立' }),
    token('たく', { base: 'たい', pos: '形容詞', pos2: '接尾' }),
  ];
  for (const t of dependent) assert.equal(store.classify(t), 'skip', t.surface);

  // Without pos2 the verb/adjective rule does not apply.
  assert.equal(store.classify(token('い', { base: 'いる', pos: '動詞' })), 'new');
  assert.equal(store.classify(token('走', { base: '走る', pos: '動詞', pos2: '自立' })), 'new');
  assert.equal(store.classify(token('高', { base: '高い', pos: '形容詞', pos2: '自立' })), 'new');
  // Non-verb/adjective tokens with a dependent pos2 are not skipped by this rule.
  assert.equal(store.classify(token('猫', { base: '猫', pos: '名詞', pos2: '接尾' })), 'new');
});

test('classify skips する/いる/ある/なる only when non-independent or suffix', () => {
  const { store } = tempStore();
  for (const base of ['する', 'いる', 'ある', 'なる']) {
    assert.equal(store.classify(token('x', { base, pos: '動詞', pos2: '非自立' })), 'skip', base);
    assert.equal(store.classify(token('x', { base, pos: '動詞', pos2: '接尾' })), 'skip', base);
    assert.equal(store.classify(token('x', { base, pos: '動詞', pos2: '自立' })), 'new', base);
    assert.equal(store.classify(token('x', { base, pos: '動詞' })), 'new', base);
  }
  store.mark('する', 'known');
  assert.equal(store.classify(token('する', { base: 'する', pos: '動詞', pos2: '自立' })), 'known');
  assert.equal(store.classify(token('し', { base: 'する', pos: '動詞', pos2: '非自立' })), 'skip');
});

test('sentenceInfo and episodeCoverage do not count skipped auxiliaries as new words', async () => {
  const { store } = tempStore();
  store.mark('猫', 'known');
  const sentence = [
    token('猫'),
    particle('が'),
    token('い', { base: 'いる', pos: '動詞', pos2: '非自立', reading: 'い' }),
    token('ます', { base: 'ます', pos: '助動詞', reading: 'ます' }),
    token('さ', { base: 'する', pos: '動詞', pos2: '自立', reading: 'さ' }),
    token('せ', { base: 'させる', pos: '動詞', pos2: '接尾', reading: 'せ' }),
    token('られ', { base: 'られる', pos: '動詞', pos2: '接尾', reading: 'られ' }),
    token('ない', { base: 'ない', pos: '形容詞', pos2: '非自立', reading: 'ない' }),
  ];
  const info = store.sentenceInfo(sentence);
  assert.deepEqual(info.newWords.map((t) => t.base), ['する']);
  assert.equal(info.unknownCount, 1);
  assert.equal(info.isIPlusOne, false);

  const tokenize = async () => sentence;
  const coverage = await episodeCoverage([{ text: 'x' }], tokenize, store);
  assert.equal(coverage.totalWords, 2);
  assert.equal(coverage.knownWords, 1);
  assert.equal(coverage.newWords, 1);
  assert.deepEqual(coverage.topNew, [{ word: 'する', count: 1 }]);
});

test('classify matches base form, then surface, then kana reading', () => {
  const { store } = tempStore();
  store.mark('食べる', 'known');
  store.mark('勉強', 'learning');
  store.mark('べんきょう', 'known');
  store.mark('ねこ', 'learning');

  assert.equal(store.classify(token('食べ', { base: '食べる', reading: 'たべ' })), 'known');
  assert.equal(store.classify(token('勉強', { reading: 'べんきょう' })), 'learning');
  assert.equal(store.classify(token('勉強し', { base: '勉強する', reading: 'べんきょうし' })), 'new');
  assert.equal(store.classify(token('猫', { base: '猫', reading: 'ねこ' })), 'learning');
  assert.equal(store.classify(token('犬', { base: '犬', reading: 'いぬ' })), 'new');
  store.mark('漢字', 'known');
  assert.equal(store.classify(token('y', { reading: '漢字' })), 'new');
  assert.deepEqual(
    store.classifyTokens([token('食べ', { base: '食べる' }), particle('を'), token('猫')]),
    ['known', 'skip', 'new'],
  );
});

test('sentenceInfo detects i+1 sentences', () => {
  const { store } = tempStore();
  ['私', '日本語', 'を', '勉強', 'する'].forEach((word) => store.mark(word, 'known'));

  const iPlusOne = [token('私'), token('猫', { reading: 'ねこ' }), particle('が'), token('日本語'), token('好き')];
  const info = store.sentenceInfo(iPlusOne);
  assert.deepEqual(info.newWords.map((t) => t.base), ['猫', '好き']);
  assert.equal(info.unknownCount, 2);
  assert.equal(info.isIPlusOne, false);

  store.mark('好き', 'known');
  const single = store.sentenceInfo(iPlusOne);
  assert.deepEqual(single.newWords.map((t) => t.surface), ['猫']);
  assert.equal(single.unknownCount, 1);
  assert.equal(single.isIPlusOne, true);

  const short = store.sentenceInfo([token('私'), token('猫')]);
  assert.equal(short.newWords.length, 1);
  assert.equal(short.isIPlusOne, false);

  const repeated = store.sentenceInfo([token('私'), token('猫'), token('日本語'), token('猫')]);
  assert.equal(repeated.newWords.length, 1);
  assert.equal(repeated.newWords[0].surface, '猫');
  assert.equal(repeated.unknownCount, 2);
  assert.equal(repeated.isIPlusOne, true);
});

test('importFromAnki builds a mature deck query with escaped deck name', async () => {
  const { store } = tempStore();
  const client = fakeAnki([note({ Word: '猫' })]);
  await store.importFromAnki(client, { deck: 'JP::N4', matureOnly: true });
  assert.equal(client.calls[0].action, 'findNotes');
  assert.equal(client.calls[0].params.query, 'deck:"JP::N4" -is:new prop:ivl>=21');

  const plain = fakeAnki([]);
  await store.importFromAnki(plain, { deck: 'a"b*c_d\\e.f' });
  assert.equal(plain.calls[0].params.query, 'deck:"a\\"b\\*c\\_d\\\\e\\.f" -is:new');
});

test('importFromAnki cleans HTML, ruby, furigana, sound tags and entities', async () => {
  const cases = [
    ['<ruby>漢<rt>かん</rt></ruby>字', '漢字'],
    ['<ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>字', '漢字'],
    ['漢字[かんじ]', '漢字'],
    ['勉強 [べんきょう]', '勉強'],
    ['[sound:abc.mp3]猫', '猫'],
    ['&nbsp;犬&nbsp;', '犬'],
    ['<b>家</b>', '家'],
  ];
  for (const [raw, expected] of cases) {
    const store = await importWords({ Word: raw });
    assert.equal(store.status(expected), 'known', raw);
    assert.deepEqual(store.stats(), { known: 1, learning: 0 }, raw);
  }
});

test('importFromAnki splits multi-word fields and skips empty or long entries', async () => {
  const store = await importWords({ Word: '食べる、飲む・話す/書く' });
  assert.deepEqual(store.stats(), { known: 4, learning: 0 });
  for (const word of ['食べる', '飲む', '話す', '書く']) assert.equal(store.status(word), 'known');

  const long = 'あ'.repeat(21);
  const filtered = await importWords({ Word: '<br>', Expression: long, Vocab: '猫' });
  assert.deepEqual(filtered.stats(), { known: 1, learning: 0 });
  assert.equal(filtered.status('猫'), 'known');
  assert.equal(filtered.status(long), 'new');
});

test('importFromAnki uses the named field first and falls back when it is empty', async () => {
  const store = await importWords({ Word: '猫', Meaning: '', Sentence: '犬' }, { field: 'Sentence' });
  assert.equal(store.status('犬'), 'known');
  assert.equal(store.status('猫'), 'new');

  const fallback = await importWords({ Word: '猫', Expression: '', Vocab: '鳥' }, { field: 'Expression' });
  assert.equal(fallback.status('猫'), 'known');
  assert.equal(fallback.status('鳥'), 'new');

  const caseSensitive = await importWords({ Word: '猫', word: '犬' }, { field: 'word' });
  assert.equal(caseSensitive.status('犬'), 'known');
  assert.equal(caseSensitive.status('猫'), 'new');
});

test('importFromAnki reports added, skipped and notes', async () => {
  const { store } = tempStore();
  store.mark('猫', 'known');
  store.mark('犬', 'learning');
  const client = fakeAnki([note({ Word: '猫' }), note({ Word: '犬' }), note({ Word: '鳥' }), note({ Word: '猫' })]);
  const result = await store.importFromAnki(client, { deck: 'D' });
  assert.deepEqual(result, { added: 2, skipped: 2, notes: 4 });
  assert.equal(store.status('犬'), 'known');
});

test('importFromAnki fetches notesInfo in chunks of 200', async () => {
  const { store } = tempStore();
  const notes = Array.from({ length: 450 }, (_, index) => note({ Word: `単語${index}` }));
  const client = fakeAnki(notes);
  const result = await store.importFromAnki(client, { deck: 'D', field: 'Word' });

  const infoCalls = client.calls.filter((call) => call.action === 'notesInfo');
  assert.deepEqual(infoCalls.map((call) => call.params.notes.length), [200, 200, 50]);
  assert.deepEqual(result, { added: 450, skipped: 0, notes: 450 });
  assert.deepEqual(store.stats(), { known: 450, learning: 0 });
});

test('ankiFieldNames lists fields and suggests a word field', async () => {
  const client = fakeAnki([note({ Meaning: 'm', Expression: 'e', Sentence: 's' })]);
  assert.deepEqual(await ankiFieldNames(client, 'D'), {
    fields: ['Meaning', 'Expression', 'Sentence'],
    suggested: 'Expression',
  });
  assert.deepEqual(await ankiFieldNames(fakeAnki([]), 'D'), { fields: [], suggested: null });
  assert.deepEqual(await ankiFieldNames(fakeAnki([note({ Meaning: 'm' })]), 'D'), {
    fields: ['Meaning'],
    suggested: null,
  });
});

test('importFromText ignores comments and blank lines and takes the first tab column', () => {
  const { store } = tempStore();
  const text = '# N4 list\n食べる\n\n飲む\tdrink\n  # indented comment\n\t\n話す\r\n';
  assert.deepEqual(importFromText(store, text), { added: 3, skipped: 0 });
  assert.equal(store.status('食べる'), 'known');
  assert.equal(store.status('飲む'), 'known');
  assert.equal(store.status('話す'), 'known');
  assert.equal(store.status('drink'), 'new');
  assert.equal(store.status('# N4 list'), 'new');
  assert.deepEqual(importFromText(store, '食べる\n'), { added: 0, skipped: 1 });
});

test('episodeCoverage computes coverage and top new words', async () => {
  const { store } = tempStore();
  store.mark('犬', 'known');
  store.mark('鳥', 'learning');
  const tokenize = async (text) => text.split(' ').filter(Boolean).map((surface) => (
    surface === 'は' ? particle(surface) : token(surface)
  ));
  const cues = [{ text: '猫 犬 猫' }, { text: '鳥 は' }, { text: '' }, { text: 'ア' }];
  const result = await episodeCoverage(cues, tokenize, store);
  assert.deepEqual(result, {
    totalWords: 5,
    knownWords: 1,
    learningWords: 1,
    newWords: 3,
    coverage: 2 / 5,
    uniqueNew: 2,
    topNew: [{ word: '猫', count: 2 }, { word: 'ア', count: 1 }],
  });
});

test('episodeCoverage is zero for empty input and caps topNew at 15 with stable ties', async () => {
  const { store } = tempStore();
  const tokenize = async (text) => text.split(' ').filter(Boolean).map((surface) => token(surface));
  assert.deepEqual(await episodeCoverage([], tokenize, store), {
    totalWords: 0,
    knownWords: 0,
    learningWords: 0,
    newWords: 0,
    coverage: 0,
    uniqueNew: 0,
    topNew: [],
  });

  const words = Array.from({ length: 20 }, (_, index) => `語${String.fromCharCode(0x41 + index)}`);
  const cues = [{ text: words.join(' ') }, { text: words[19] + ' ' + words[19] }];
  const result = await episodeCoverage(cues, tokenize, store);
  assert.equal(result.uniqueNew, 20);
  assert.equal(result.topNew.length, 15);
  assert.deepEqual(result.topNew[0], { word: words[19], count: 3 });
  assert.deepEqual(result.topNew.slice(1).map((entry) => entry.word), words.slice(0, 14));
});
