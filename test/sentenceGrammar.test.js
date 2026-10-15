const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tokenize } = require('../src/core/tokenizer');
const { loadGrammar } = require('../src/core/grammar');
const { analyzeSentence, MAX_TEXT } = require('../src/core/sentenceGrammar');

const grammar = loadGrammar();

const analyze = (text, opts = { tokenize, grammar }) => analyzeSentence(text, opts);

const particleRoles = (a) => a.particles.map((p) => `${p.surface}:${p.id}:${p.role}`);
const stepLabels = (c) => c.steps.map((s) => s.label);

test('私は学生です: topic は and polite copula chunk', async () => {
  const a = await analyze('私は学生です');
  assert.deepEqual(particleRoles(a), ['は:p:wa:topic']);
  assert.equal(a.particles[0].name, 'topic marker');
  assert.equal(a.particles[0].level, 'N5');
  assert.equal(a.chunks.find((c) => c.text === 'です').kind, 'aux');
  assert.deepEqual(a.conjugations, []);
});

test('猫が魚を食べた: subject, object, past', async () => {
  const a = await analyze('猫が魚を食べた');
  assert.deepEqual(particleRoles(a), ['が:p:ga:subject', 'を:p:wo:object']);
  assert.equal(a.conjugations.length, 1);
  assert.equal(a.conjugations[0].base, '食べる');
  assert.equal(a.conjugations[0].surface, '食べた');
  assert.deepEqual(stepLabels(a.conjugations[0]), ['past']);
});

test('学校に行きたくなかった: に destination, want to / negative / past chain', async () => {
  const a = await analyze('学校に行きたくなかった');
  assert.deepEqual(particleRoles(a), ['に:p:ni:destination']);
  const chain = a.conjugations[0];
  assert.equal(chain.base, '行く');
  assert.deepEqual(stepLabels(chain), ['want to', 'negative', 'past']);
  assert.ok(a.patterns.some((p) => p.title.includes('なかった')));
});

test('彼に本を読ませられた: に agent, causative then passive then past', async () => {
  const a = await analyze('彼に本を読ませられた');
  assert.deepEqual(particleRoles(a), ['に:p:ni:agent', 'を:p:wo:object']);
  const chain = a.conjugations[0];
  assert.equal(chain.base, '読む');
  assert.equal(chain.surface, '読ませられた');
  assert.deepEqual(stepLabels(chain), ['causative', 'passive or potential', 'past']);
  assert.deepEqual(chain.steps.map((s) => s.form), ['せ', 'られ', 'た']);
  assert.equal(a.patterns[0].title, '〜させられる (causative-passive)');
});

test('友達と公園で遊んでいる: ambiguous と noted, で location; te-form stays in the conjugation', async () => {
  const a = await analyze('友達と公園で遊んでいる');
  assert.deepEqual(particleRoles(a), ['と:p:to:with', 'で:p:de:location']);
  assert.deepEqual(stepLabels(a.conjugations[0]), ['te-form', 'continuing']);
  assert.ok(a.notes.some((n) => n.includes('と')));
});

test('雨が降っているので家にいる: reason ので and に location', async () => {
  const a = await analyze('雨が降っているので家にいる');
  assert.deepEqual(particleRoles(a), ['が:p:ga:subject', 'ので:p:node:reason', 'に:p:ni:location']);
  assert.deepEqual(stepLabels(a.conjugations[0]), ['te-form', 'continuing']);
  assert.equal(a.conjugations[0].base, '降る');
});

test('五時まで働く: まで after a time noun is the until endpoint, not even', async () => {
  const a = await analyze('五時まで働く');
  assert.deepEqual(particleRoles(a), ['まで:p:made:until']);
  assert.deepEqual(a.notes, []);
});

test('彼まで来た: まで after a pronoun is emphatic even', async () => {
  const a = await analyze('彼まで来た');
  assert.deepEqual(particleRoles(a), ['まで:p:made:even']);
  assert.deepEqual(a.notes, []);
});

test('春になると花が咲く: と after a plain verb is conditional', async () => {
  const a = await analyze('春になると花が咲く');
  assert.equal(a.chunks.find((c) => c.text === 'と').role, 'conditional');
});

test('押すと開く: と after a plain verb is conditional even when tagged 格助詞', async () => {
  const a = await analyze('押すと開く');
  assert.deepEqual(particleRoles(a), ['と:p:to:conditional']);
  assert.deepEqual(a.notes, []);
});

test('と after nouns and before 言う keeps with, and, quotation roles', async () => {
  assert.deepEqual(particleRoles(await analyze('友達と公園で遊んでいる')), ['と:p:to:with', 'で:p:de:location']);
  assert.deepEqual(particleRoles(await analyze('りんごとバナナ')), ['と:p:to:and']);
  assert.deepEqual(particleRoles(await analyze('明日行くと言った')), ['と:p:to:quotation']);
});

test('chunks cover the sentence with kinds and offsets', async () => {
  const text = '猫が魚を食べた。';
  const a = await analyze(text);
  assert.equal(a.chunks.map((c) => c.text).join(''), text);
  for (const c of a.chunks) assert.equal(text.slice(c.start, c.end), c.text);
  assert.equal(a.chunks.at(-1).kind, 'punct');
  assert.equal(a.chunks.find((c) => c.text === 'が').role, 'subject');
});

test('particle lookups carry explanation and example from data', async () => {
  const a = await analyze('猫が魚を食べた');
  const ga = a.particles[0];
  assert.match(ga.explanation, /subject|doer/i);
  assert.ok(ga.example.ja && ga.example.en);
});

test('ambiguous particles add notes naming alternatives', async () => {
  const sure = await analyze('図書館で日本語で話す');
  assert.deepEqual(particleRoles(sure), ['で:p:de:location', 'で:p:de:means']);
  assert.deepEqual(sure.notes, []);
  const ambiguous = await analyze('友達と公園で遊んでいる');
  assert.match(ambiguous.notes[0], /could also be/);
});

test('without grammar data patterns are empty but particles still work', async () => {
  const a = await analyze('学校に行きたくなかった', { tokenize, grammar: null });
  assert.deepEqual(a.patterns, []);
  assert.deepEqual(particleRoles(a), ['に:p:ni:destination']);
});

test('empty and whitespace input return an empty valid analysis', async () => {
  for (const text of ['', '   ']) {
    const a = await analyze(text);
    assert.equal(a.text, '');
    assert.deepEqual(a.chunks, []);
    assert.deepEqual(a.particles, []);
    assert.deepEqual(a.conjugations, []);
    assert.deepEqual(a.patterns, []);
    assert.deepEqual(a.notes, []);
  }
});

test('over-long input is not analyzed and says so', async () => {
  const long = '猫が魚を食べた。'.repeat(80);
  assert.ok(long.length > MAX_TEXT);
  const a = await analyze(long);
  assert.equal(a.chunks.length, 0);
  assert.equal(a.particles.length, 0);
  assert.match(a.notes[0], /400/);
});

test('exactly 400 characters is analyzed', async () => {
  const text = '猫が魚を食べた。'.repeat(50);
  assert.equal(text.length, MAX_TEXT);
  const a = await analyze(text);
  assert.ok(a.chunks.length > 0);
});

test('1000-character input returns an empty analysis without throwing', async () => {
  const a = await analyze('あ'.repeat(1000));
  assert.deepEqual(a.chunks, []);
});

test('HTML-looking input is kept as plain text', async () => {
  const text = '<script>alert(1)</script><b>猫が</b>';
  const a = await analyze(text);
  assert.equal(a.text, text);
  assert.equal(a.chunks.map((c) => c.text).join(''), text);
  assert.ok(a.chunks.some((c) => c.text === '<'));
  assert.equal(a.particles.some((p) => p.surface === 'が'), true);
});

test('tokenizer failure yields an empty analysis with a note', async () => {
  const a = await analyze('猫が', { tokenize: async () => { throw new Error('boom'); }, grammar });
  assert.deepEqual(a.chunks, []);
  assert.deepEqual(a.notes, ['Could not analyze this sentence.']);
});

test('non-string input is treated as empty', async () => {
  const a = await analyzeSentence(undefined, { tokenize, grammar });
  assert.deepEqual(a.chunks, []);
});
