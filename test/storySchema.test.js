const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadChapters } = require('../src/core/storyContent');
const { validateScene, assertScene, parseAiScene, extractJson } = require('../src/core/storySchema');
const { loadGrammar } = require('../src/core/grammar');

const DISPLAYED = new Set(['say', 'intro', 'choice', 'reading', 'meaning', 'particle']);
const CHALLENGE_TYPES = ['choice', 'reading', 'meaning', 'particle'];

function scene(overrides = {}) {
  return {
    schema: 1,
    id: 'test-scene',
    title: 'Test',
    jlpt: 'N5',
    source: 'authored',
    characters: { mio: { name: 'みお' } },
    beats: [
      { type: 'say', who: 'mio', text: 'こんにちは。' },
      {
        type: 'choice',
        item: 'g:n5-ka',
        prompt: 'Ask a question',
        options: [{ text: 'ですか。', correct: true }, { text: 'ですが。' }],
      },
    ],
    ...overrides,
  };
}

test('every shipped chapter is valid: 3+ N5 chapters of 10-15+ beats and an N4 chapter', () => {
  const { chapters, problems } = loadChapters();
  assert.deepEqual(problems, []);
  const n5 = chapters.filter((c) => c.jlpt === 'N5');
  assert.ok(n5.length >= 3, 'needs three N5 chapters');
  assert.ok(chapters.some((c) => c.jlpt === 'N4'), 'needs an N4 chapter');
  for (const chapter of chapters) {
    const shown = chapter.beats.filter((b) => DISPLAYED.has(b.type)).length;
    assert.ok(shown >= 10 && shown <= 40, `${chapter.id} has ${shown} displayed beats`);
    assert.equal(chapter.source, 'authored');
    assert.ok(chapter.items.some((i) => i.startsWith('g:')), `${chapter.id} should test grammar`);
  }
});

test('shipped chapters only reference grammar points that exist, and cover every item with a challenge', () => {
  const grammar = loadGrammar();
  for (const chapter of loadChapters().chapters) {
    const tested = new Set(chapter.beats.filter((b) => CHALLENGE_TYPES.includes(b.type)).map((b) => b.item));
    for (const item of chapter.items) {
      // Genki-path points that are not in the grammar deck use a g:genki-* id and are practice only.
      const genkiOnly = chapter.track === 'genki' && item.startsWith('g:genki-');
      if (item.startsWith('g:') && !genkiOnly) assert.ok(grammar.byId.has(item), `${chapter.id}: unknown grammar ${item}`);
      assert.ok(tested.has(item), `${chapter.id}: ${item} is introduced but never tested`);
      assert.ok(chapter.glossary?.[item], `${chapter.id}: ${item} has no glossary fallback`);
    }
  }
});

test('a good scene validates and derives its item list', () => {
  const result = validateScene(scene());
  assert.equal(result.ok, true);
  assert.deepEqual(result.scene.items, ['g:n5-ka']);
});

test('malformed scenes are rejected with a reason', () => {
  const bad = (patch, pattern) => {
    const result = validateScene(scene(patch));
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.match(result.errors.join(' | '), pattern);
  };
  bad({ schema: 2 }, /schema/);
  bad({ jlpt: 'N9' }, /jlpt/);
  bad({ id: 'Bad Id' }, /id/);
  bad({ beats: [] }, /beats/);
  bad({ characters: {} }, /characters/);
  bad({ bgImage: 'https://example.com/x.jpg' }, /bgImage/);
  bad({ beats: [{ type: 'say', who: 'nobody', text: 'x' }] }, /unknown speaker/);
  bad({ beats: [{ type: 'explode' }] }, /unknown beat type/);
  bad({ beats: [{ type: 'say', who: 'mio', text: 'x'.repeat(300) }] }, /longer than/);
  bad({ beats: [{ type: 'say', who: 'mio', text: 'a' }, { type: 'choice', item: 'g:x', options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] }] }, /exactly one correct/);
  bad({ beats: [{ type: 'say', who: 'mio', text: 'a' }, { type: 'choice', item: 'oops', options: [{ text: 'a', correct: true }, { text: 'b' }] }] }, /invalid study item/);
  bad({ beats: [{ type: 'say', who: 'mio', text: 'a' }, { type: 'reading', item: 'k:日', display: '日', answers: ['nihon'] }] }, /not kana/);
  bad({ beats: [{ type: 'say', who: 'mio', text: 'a' }, { type: 'reading', item: 'g:n5-ka', display: 'x', answers: ['か'] }] }, /kanji or vocabulary/);
  bad({ beats: [{ type: 'say', who: 'mio', text: 'a' }, { type: 'meaning', item: 'k:日', prompt: 'p', options: ['a', 'b'], correct: 5 }] }, /correct must index/);
  bad({ beats: [{ type: 'say', who: 'mio', text: 'a', label: 'x' }, { type: 'jump', to: 'x' }, { type: 'say', who: 'mio', text: 'b' }] }, /forward/);
  bad({ beats: [{ type: 'say', who: 'mio', text: 'a' }, { type: 'jump', to: 'nowhere' }] }, /unknown label/);
  bad({ beats: [{ type: 'say', who: 'mio', text: 'a' }, { type: 'intro', item: 'k:日' }] }, /no challenge/);
  assert.throws(() => assertScene(scene({ jlpt: 'N9' })), /Invalid story scene/);
});

test('reading answers are normalised to hiragana', () => {
  const result = validateScene(scene({
    beats: [{ type: 'say', who: 'mio', text: 'a' }, { type: 'reading', item: 'k:日', display: '日', answers: ['ニチ', 'にち'] }],
  }));
  assert.deepEqual(result.scene.beats[1].answers, ['にち']);
});

const goodAi = {
  title: 'Rainy day',
  summary: 'A short scene',
  characters: { rin: { name: 'りん' } },
  glossary: { 'k:雨': { label: '雨', reading: 'あめ', meaning: 'rain' } },
  beats: [
    { type: 'say', who: 'rin', text: '雨ですね。', en: "It's raining." },
    { type: 'reading', item: 'k:雨', display: '雨', answers: ['あめ'] },
    { type: 'choice', item: 'g:n5-ka', who: 'rin', options: [{ text: '雨ですか。', correct: true }, { text: '雨かです。' }] },
  ],
};

test('AI JSON is extracted from fences and surrounding prose', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":{"b":"}"}}\n```\nEnjoy'), { a: { b: '}' } });
  assert.deepEqual(extractJson('here {"x":1} done'), { x: 1 });
  assert.equal(extractJson('no json'), null);
  assert.equal(extractJson('{"broken": '), null);
});

test('a well-formed AI scene is accepted and stamped as ai', () => {
  const { scene: out, repairs } = parseAiScene(`\`\`\`json\n${JSON.stringify(goodAi)}\n\`\`\``, { allowedItems: ['k:雨', 'g:n5-ka'], id: 'ai-0123456789ab', jlpt: 'N5' });
  assert.equal(out.source, 'ai');
  assert.equal(out.id, 'ai-0123456789ab');
  assert.deepEqual(repairs, []);
  assert.deepEqual(out.items, ['k:雨', 'g:n5-ka']);
});

test('fixable AI mistakes are repaired and reported', () => {
  const messy = structuredClone(goodAi);
  messy.beats[0].text = 'あ'.repeat(400);
  messy.beats[1].answers = ['あめ', 'ame'];
  messy.beats.push({ type: 'explode' });
  messy.beats.push({ type: 'choice', item: 'g:n5-ka', options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] });
  messy.beats.push({ type: 'say', who: 'rin', text: '終わり。', label: 'Not Valid!' });
  const { scene: out, repairs } = parseAiScene(JSON.stringify(messy), { allowedItems: ['k:雨', 'g:n5-ka'], id: 'ai-0123456789ab' });
  assert.equal(out.beats[0].text.length, 240);
  assert.deepEqual(out.beats[1].answers, ['あめ']);
  assert.equal(out.beats.length, 4);
  assert.ok(repairs.some((r) => /truncated/.test(r)));
  assert.ok(repairs.some((r) => /non-kana/.test(r)));
  assert.ok(repairs.some((r) => /unknown beat type/.test(r)));
  assert.ok(repairs.some((r) => /exactly one correct/.test(r)));
});

test('beats about items the prompt did not ask for are dropped', () => {
  const stray = structuredClone(goodAi);
  stray.beats.push({ type: 'reading', item: 'k:火', display: '火', answers: ['ひ'] });
  const { scene: out } = parseAiScene(JSON.stringify(stray), { allowedItems: ['k:雨', 'g:n5-ka'], id: 'ai-0123456789ab' });
  assert.ok(!out.items.includes('k:火'));
});

test('unusable AI output is rejected', () => {
  const opts = { allowedItems: ['k:雨'], id: 'ai-0123456789ab' };
  assert.throws(() => parseAiScene('I cannot do that.', opts), /did not contain a JSON scene/);
  assert.throws(() => parseAiScene('["not","an","object"]', opts), /did not contain a JSON scene/);
  assert.throws(() => parseAiScene(JSON.stringify({ ...goodAi, beats: [] }), opts), /rejected/);
  assert.throws(() => parseAiScene(JSON.stringify({ ...goodAi, beats: [{ type: 'say', who: 'rin', text: 'はい' }] }), opts), /rejected/);
  assert.throws(() => parseAiScene(JSON.stringify({ ...goodAi, characters: {} }), opts), /characters/);
  const onlyForeign = { ...goodAi, beats: [goodAi.beats[0], { type: 'reading', item: 'k:火', display: '火', answers: ['ひ'] }] };
  assert.throws(() => parseAiScene(JSON.stringify(onlyForeign), opts), /rejected/);
});

test('an AI reply cannot smuggle its own background image', () => {
  const sneaky = { ...goodAi, bgImage: 'data:image/jpeg;base64,AAAA' };
  const { scene: out } = parseAiScene(JSON.stringify(sneaky), { allowedItems: ['k:雨', 'g:n5-ka'], id: 'ai-0123456789ab' });
  assert.equal(out.bgImage, undefined);
});

test('the Genki path ships lessons 1-12 in order, each drilling particles', () => {
  const genki = loadChapters().chapters.filter((c) => c.track === 'genki');
  assert.deepEqual(genki.map((c) => c.lesson), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (const chapter of genki) {
    assert.match(chapter.id, /^genki-l\d\d$/);
    assert.ok(chapter.covers, `${chapter.id} lists what it covers`);
    assert.ok(chapter.beats.some((b) => b.type === 'particle'), `${chapter.id} has a particle challenge`);
    for (const beat of chapter.beats.filter((b) => b.type === 'particle')) {
      assert.ok(beat.en, `${chapter.id}: particle sentences carry a translation`);
      assert.ok(beat.options.some((o) => !beat.answers.includes(o)));
    }
  }
});

test('particle beats: one gap, answers among the options, at least one wrong option; track and lesson are checked', () => {
  const particle = (patch) => scene({ beats: [{ type: 'say', who: 'mio', text: 'はい。' }, { type: 'particle', item: 'g:n5-ni', text: '学校＿行きます。', options: ['に', 'へ', 'で'], answers: ['に', 'へ'], role: 'p:ni/destination', en: 'I go to school.', ...patch }] });
  const good = validateScene(particle({}));
  assert.equal(good.ok, true, good.errors.join());
  assert.deepEqual(good.scene.beats[1], { type: 'particle', item: 'g:n5-ni', who: null, text: '学校＿行きます。', options: ['に', 'へ', 'で'], answers: ['に', 'へ'], en: 'I go to school.', role: 'p:ni/destination' });
  const bad = (patch, pattern) => assert.match(validateScene(particle(patch)).errors.join(' | '), pattern);
  bad({ text: '学校に行きます。' }, /one ＿ gap/);
  bad({ text: '学校＿行き＿ます。' }, /one ＿ gap/);
  bad({ answers: ['を'] }, /among the options/);
  bad({ answers: ['に', 'へ', 'で'] }, /wrong option/);
  bad({ options: ['に', 'に', 'で'] }, /different/);
  bad({ options: ['ni', 'で'] }, /short kana/);
  bad({ options: ['に'] }, /2 to 4/);
  assert.equal(validateScene(particle({ role: 'nonsense' })).scene.beats[1].role, undefined, 'a bad role is dropped, not fatal');
  assert.match(validateScene(scene({ track: 'other' })).errors.join(), /track/);
  assert.match(validateScene(scene({ lesson: 0 })).errors.join(), /lesson/);
  assert.deepEqual(['track', 'lesson'].map((k) => validateScene(scene({ track: 'genki', lesson: 3 })).scene[k]), ['genki', 3]);
});
