const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStoryHandlers } = require('../src/main/storyHandlers');
const { createLearnHandlers } = require('../src/main/learnHandlers');
const { StoryProgress } = require('../src/core/storyProgress');
const { loadChapters } = require('../src/core/storyContent');
const { KnownWords } = require('../src/core/known');

const dirs = [];
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-h-'));
  dirs.push(dir);
  return dir;
};

const NOW = new Date(2026, 9, 10, 12).getTime();

function grammarPoint(id, title, meaning) {
  return { id, jlpt: 'N5', title, meaning, structure: 's', formality: 'neutral', notes: 'n', similar: [], detect: [], examples: [{ ja: 'ここで{{撮ってもいい}}ですか。', en: 'May I?', hint: 'h' }] };
}
const POINTS = [
  grammarPoint('g:n5-wa-desu', '〜は〜です', 'X is Y'),
  grammarPoint('g:n5-ka', '〜か', 'question marker'),
  grammarPoint('g:n5-no', '〜の', 'of / possessive'),
];
const grammar = { points: POINTS, byId: new Map(POINTS.map((p) => [p.id, p])), byTitle: new Map(POINTS.map((p) => [p.title, p])) };
const PACK = { version: 1, builtAt: 0, levels: 1, radicals: {}, kanji: {}, vocab: {}, levelList: [{ level: 1, radicals: [], kanji: [], vocab: [] }] };

function realLearn(dir, extra = {}) {
  const known = new KnownWords(path.join(dir, 'known.json'));
  return createLearnHandlers({
    dataDir: dir,
    getSettings: async () => ({}),
    library: { scan: async () => [] },
    tokenize: async () => [],
    knownWords: () => known,
    deps: { loadPack: () => structuredClone(PACK), packStatus: () => ({ ready: true }), loadGrammar: () => grammar, ...extra },
  }).handlers;
}

function story({ learn, settings = { ai: { provider: 'openai', apiKey: 'k' } }, deps = {} } = {}) {
  const dir = tmp();
  const handlers = createStoryHandlers({ dataDir: dir, learn: learn ?? realLearn(dir), getSettings: async () => settings, deps: { now: () => NOW, ...deps } });
  return { ...handlers, dir };
}

test('chapter list ships the authored story with progress, hides AI without a provider', async () => {
  const { handlers } = story({ settings: { ai: { provider: 'openai', apiKey: '' } } });
  const list = await handlers['story:list']();
  assert.ok(list.chapters.length >= 4);
  assert.deepEqual(list.chapters.map((c) => c.id).slice(0, 3), ['n5-ch1', 'n5-ch2', 'n5-ch3']);
  assert.deepEqual([list.chapters[0].stars, list.chapters[0].saved], [0, false]);
  assert.equal(list.ai.ready, false);
  assert.deepEqual(list.skins, []);
  const ready = await story({ settings: { ai: { provider: 'claude-cli' } } }).handlers['story:list']();
  assert.equal(ready.ai.ready, true);
});

test('opening a chapter reports each item as new, started or untracked', async () => {
  const dir = tmp();
  const learn = realLearn(dir);
  const { handlers } = createStoryHandlers({ dataDir: dir, learn, getSettings: async () => ({ ai: {} }) });
  learn['learn:completeLessons'](['g:n5-ka']);
  const { scene, items, save } = await handlers['story:open']('n5-ch1');
  assert.equal(scene.id, 'n5-ch1');
  assert.equal(save, false);
  assert.equal(items['g:n5-ka'].state, 'started');
  assert.equal(items['g:n5-wa-desu'].state, 'new');
  assert.equal(items['g:n5-wa-desu'].label, '〜は〜です');
  assert.equal(items['k:日'].state, 'untracked', 'kanji missing from the study pack are practice-only');
  assert.equal(items['k:日'].meaning, 'day, sun', 'the authored glossary backs the intro card');
  await assert.rejects(handlers['story:open']('nope'), /unknown story scene/);
  await assert.rejects(handlers['story:open']('../x'), /invalid scene id/);
});

test('challenge results go through the real SRS path (learn:submit) once the item is started', async () => {
  const dir = tmp();
  const learn = realLearn(dir);
  const { handlers } = createStoryHandlers({ dataDir: dir, learn, getSettings: async () => ({ ai: {} }) });
  const stageOf = () => learn['learn:card']('g:n5-ka').stage;

  assert.deepEqual(await handlers['story:report']({ item: 'g:n5-ka', incorrectCount: 0 }), { tracked: false, applied: false });
  assert.equal(stageOf(), 0, 'unstarted items are never created by a bare report');

  assert.deepEqual(await handlers['story:learn']('g:n5-ka'), { started: true });
  assert.equal(stageOf(), 1);
  const lesson = await handlers['story:report']({ item: 'g:n5-ka', incorrectCount: 0, introducedNow: true });
  assert.deepEqual(lesson, { tracked: true, applied: false, reason: 'lesson' });
  assert.equal(stageOf(), 1, 'the first quiz after an in-story intro is a lesson, not a review');

  const good = await handlers['story:report']({ item: 'g:n5-ka', incorrectCount: 0 });
  assert.equal(good.applied, true);
  assert.deepEqual([good.result.prevStage, good.result.stage], [1, 2]);
  assert.equal(stageOf(), 2);

  const bad = await handlers['story:report']({ item: 'g:n5-ka', incorrectCount: 2 });
  assert.deepEqual([bad.result.prevStage, bad.result.stage], [2, 1]);
  assert.equal(stageOf(), 1);
});

test('reports are forwarded with exactly the id and mistake count the review session sends', async () => {
  const calls = [];
  const learn = {
    'learn:card': (id) => (id === 'k:日' ? { id, stage: 3, kind: 'kanji', char: '日', meanings: ['day'], readingText: 'にち' } : { id, stage: 0, locked: true, kind: 'kanji' }),
    'learn:submit': (input) => {
      calls.push(input);
      return { id: input.id, prevStage: 3, stage: 4, group: { key: 'apprentice', label: 'Apprentice' } };
    },
  };
  const { handlers } = story({ learn });
  const out = await handlers['story:report']({ item: 'k:日', incorrectCount: 1 });
  assert.deepEqual(calls, [{ id: 'k:日', incorrectCount: 1 }]);
  assert.equal(out.result.stage, 4);
  assert.deepEqual(await handlers['story:report']({ item: 'k:火', incorrectCount: 0 }), { tracked: false, applied: false });
  assert.equal(calls.length, 1, 'locked or unknown items are not submitted');
});

test('IPC inputs are validated like learnHandlers does', async () => {
  const { handlers } = story();
  const bad = (name, arg, pattern) => assert.rejects(Promise.resolve().then(() => handlers[name](arg)), pattern, `${name} ${JSON.stringify(arg)}`);
  await bad('story:report', null, /must be an object/);
  await bad('story:report', { item: 'x', incorrectCount: 0 }, /invalid study item/);
  await bad('story:report', { item: 'k:日', incorrectCount: -1 }, /incorrectCount/);
  await bad('story:report', { item: 'k:日', incorrectCount: 51 }, /incorrectCount/);
  await bad('story:report', { item: 'k:日', incorrectCount: 0, introducedNow: 'yes' }, /introducedNow/);
  await bad('story:learn', 'g:' + 'x'.repeat(50), /invalid study item/);
  await bad('story:save', { id: 'n5-ch1', snapshot: { scene: 'other' } }, /does not belong/);
  await bad('story:save', { id: '../etc', snapshot: {} }, /invalid scene id/);
  await bad('story:load', 7, /invalid scene id/);
  await bad('story:complete', { id: 'n5-ch1', stars: 4, accuracy: 1 }, /stars/);
  await bad('story:complete', { id: 'n5-ch1', stars: 3, accuracy: 2 }, /accuracy/);
  await bad('story:complete', { id: 'n5-ch1', stars: 3, accuracy: 1, affection: { 'BAD ID': 1 } }, /affection/);
  await bad('story:complete', { id: 'n5-ch1', stars: 3, accuracy: 1, gallery: new Array(30).fill({ id: 'a' }) }, /gallery/);
  await bad('story:aiGenerate', { items: ['bad'] }, /invalid study item/);
  await bad('story:aiGenerate', { items: [] }, /1 to 6/);
  await bad('story:skinAsset', { pack: '../x', path: 'a.png' }, /invalid skin pack/);
});

test('save slots are per scene; completing a scene records stars once-up and clears the save', async () => {
  const { handlers, dir } = story();
  const snapshot = { v: 1, scene: 'n5-ch1', index: 5 };
  await handlers['story:save']({ id: 'n5-ch1', snapshot });
  assert.equal((await handlers['story:list']()).chapters[0].saved, true);
  assert.equal((await handlers['story:load']('n5-ch1')).index, 5);
  assert.equal(await handlers['story:load']('n5-ch2'), null);
  assert.equal((await handlers['story:open']('n5-ch1')).save, true);

  const first = await handlers['story:complete']({ id: 'n5-ch1', stars: 2, accuracy: 0.7, affection: { mio: 3 }, gallery: [{ id: 'first-day', title: 'The first day' }] });
  assert.deepEqual([first.stars, first.plays], [2, 1]);
  assert.equal(await handlers['story:load']('n5-ch1'), null, 'finishing clears the save slot');
  const second = await handlers['story:complete']({ id: 'n5-ch1', stars: 1, accuracy: 0.5, affection: { mio: 3 }, gallery: [] });
  assert.deepEqual([second.stars, second.plays], [2, 2], 'stars never go down');
  assert.equal(second.overview.affection.mio.value, 3, 'affection is awarded on the first clear only');
  assert.equal(second.overview.affection.mio.name, 'みお');
  assert.deepEqual(second.overview.gallery.map((g) => g.id), ['first-day']);

  const reloaded = new StoryProgress(dir);
  assert.equal(reloaded.overview().chapters['n5-ch1'].plays, 2, 'progress persists across restarts');
});

test('affection is clamped and stored separately from the SRS data', () => {
  const dir = tmp();
  const progress = new StoryProgress(dir, { now: () => NOW });
  progress.complete('a', { stars: 3, accuracy: 1, affection: { mio: 500 } }, { mio: { name: 'みお' } });
  assert.equal(progress.overview().affection.mio.value, 100);
  assert.deepEqual(fs.readdirSync(dir), ['story.json']);
});

test('anime scenes: built from a mined example with the video present, then listed and playable', async () => {
  const learn = {
    'learn:browse': () => [
      { id: 'g:n5-te-mo-ii', stage: 2, sub: 'may / okay to', kind: 'grammar' },
      { id: 'g:n5-ka', stage: 0, sub: 'question', kind: 'grammar' },
      { id: 'g:n5-no', stage: 0, sub: 'of / possessive', kind: 'grammar' },
      { id: 'g:n5-mo', stage: 0, sub: 'also', kind: 'grammar' },
    ],
    'learn:card': (id) => ({ id, stage: 2, kind: 'grammar', title: '〜てもいい', meaning: 'may / okay to', jlpt: 'N5', animeExamples: [{ videoPath: '/v/Show 01.mkv', start: 4, end: 6, text: '写真を撮ってもいいですか。', matchStart: 5, matchEnd: 9 }] }),
  };
  const shots = [];
  const { handlers } = story({ learn, deps: { fileExists: async () => true, screenshot: async (a) => { shots.push(a); return Buffer.from([0xff, 0xd8]); } } });
  const built = await handlers['story:animeBuild']();
  assert.equal(built.built, 1);
  assert.equal(shots.length, 1);
  const list = await handlers['story:list']();
  assert.equal(list.anime.length, 1);
  const open = await handlers['story:open'](list.anime[0].id);
  assert.match(open.scene.bgImage, /^data:image\/jpeg;base64,/);
  assert.equal((await handlers['story:animeBuild']()).built, 0, 'rebuilding does not regrab frames');
  assert.equal(shots.length, 1);
});

test('anime scenes without the source video fall back to the default background; nothing mined gives a hint', async () => {
  const learn = {
    'learn:browse': () => [{ id: 'g:a', stage: 1, sub: 'one' }, { id: 'g:b', stage: 0, sub: 'two' }],
    'learn:card': (id) => ({ id, stage: 1, kind: 'grammar', title: 't', meaning: 'one', jlpt: 'N5', animeExamples: [{ videoPath: '/gone.mkv', start: 1, end: 2, text: 'ここにいます。', matchStart: 2, matchEnd: 5 }] }),
  };
  const { handlers } = story({ learn, deps: { fileExists: async () => false, screenshot: async () => assert.fail('no frame without a file') } });
  assert.equal((await handlers['story:animeBuild']()).built, 1);
  const list = await handlers['story:list']();
  assert.equal((await handlers['story:open'](list.anime[0].id)).scene.bgImage, undefined);

  const empty = story({ learn: { 'learn:browse': () => [], 'learn:card': () => null } });
  assert.equal((await empty.handlers['story:animeBuild']()).withoutExamples, 'none-started');
  const unscanned = story({ learn: { 'learn:browse': () => [{ id: 'g:a', stage: 1, sub: 'x' }], 'learn:card': () => ({ id: 'g:a', stage: 1, animeExamples: [] }) } });
  assert.equal((await unscanned.handlers['story:animeBuild']()).withoutExamples, 'none-scanned');
});

test('AI side quests: refused without a provider, generated once, replayed from cache, scoped to studied items', async () => {
  const learn = {
    'learn:browse': ({ type }) => (type === 'kanji' ? [{ id: 'k:雨', stage: 2 }, { id: 'k:雪', stage: 0 }] : [{ id: 'g:n5-ka', stage: 1 }]),
    'learn:card': (id) => (id === 'k:雨'
      ? { id, stage: 2, kind: 'kanji', char: '雨', meanings: ['rain'], readingText: 'あめ' }
      : { id, stage: 1, kind: 'grammar', title: '〜か', meaning: 'question marker', structure: '', notes: '', jlpt: 'N5' }),
  };
  const reply = JSON.stringify({
    title: 'Rain',
    characters: { rin: { name: 'りん' } },
    beats: [
      { type: 'say', who: 'rin', text: '雨ですね。' },
      { type: 'reading', item: 'k:雨', display: '雨', answers: ['あめ'] },
      { type: 'choice', item: 'g:n5-ka', options: [{ text: '雨ですか。', correct: true }, { text: '雨かです。' }] },
    ],
  });
  const prompts = [];
  const complete = async (s, prompt) => {
    prompts.push(prompt.user);
    return reply;
  };
  const off = story({ learn, settings: { ai: { provider: 'openai', apiKey: '' } }, deps: { complete } });
  await assert.rejects(off.handlers['story:aiGenerate'](), /Add an AI key/);
  assert.equal(prompts.length, 0);

  const { handlers } = story({ learn, deps: { complete } });
  const first = await handlers['story:aiGenerate']();
  assert.equal(first.cached, false);
  assert.match(prompts[0], /k:雨/);
  assert.match(prompts[0], /g:n5-ka/);
  assert.doesNotMatch(prompts[0], /k:雪/, 'unstarted items are not targeted');
  const again = await handlers['story:aiGenerate']();
  assert.equal(again.cached, true);
  assert.equal(prompts.length, 1);
  const list = await handlers['story:list']();
  assert.deepEqual(list.ai.scenes.map((s) => s.id), [first.scene.id]);
  assert.equal((await handlers['story:open'](first.scene.id)).scene.source, 'ai');
});

test('skin packs are discoverable through IPC and fall back when missing', async () => {
  const { handlers, dir } = story();
  assert.equal(await handlers['story:skinManifest']('missing'), null);
  const pack = path.join(dir, 'vn-skins', 'demo');
  fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(path.join(pack, 'a.png'), 'x');
  fs.writeFileSync(path.join(pack, 'pack.json'), JSON.stringify({ name: 'Demo', characters: { mio: { neutral: 'a.png' } } }));
  assert.deepEqual(await handlers['story:skins'](), [{ pack: 'demo', title: 'Demo', valid: true }]);
  assert.deepEqual((await handlers['story:skinManifest']('demo')).characters, { mio: { neutral: 'a.png' } });
  assert.match(await handlers['story:skinAsset']({ pack: 'demo', path: 'a.png' }), /^data:image\/png;base64,/);
});

test('N5 chapter 1 is playable end to end against the real SRS: intro, answers, reports, completion', async () => {
  const { createEngine } = await import('../src/renderer/learn/vn/engine.mjs');
  const dir = tmp();
  const learn = realLearn(dir);
  const { handlers } = createStoryHandlers({ dataDir: dir, learn, getSettings: async () => ({ ai: {} }) });
  const data = await handlers['story:open']('n5-ch1');
  const engine = createEngine(data.scene, { skipIntro: Object.entries(data.items).filter(([, s]) => s.state === 'started').map(([id]) => id) });
  const introducedNow = new Set();
  const lines = [];
  let guard = 0;
  while (!engine.isFinished() && guard++ < 200) {
    const frame = engine.frame();
    if (frame.kind === 'say' || frame.kind === 'awkward') engine.advance();
    else if (frame.kind === 'intro') {
      if (data.items[frame.item].state === 'new' && (await handlers['story:learn'](frame.item)).started) introducedNow.add(frame.item);
      engine.advance();
    } else if (frame.kind === 'choice') {
      if (frame.beat.item === 'g:n5-no' && frame.attempts === 0) engine.answer(frame.beat.options.findIndex((o) => !o.correct));
      else engine.answer(frame.beat.options.findIndex((o) => o.correct));
    } else if (frame.kind === 'reading') engine.answer(frame.beat.answers[0]);
    else engine.answer(frame.beat.correct);
    for (const r of engine.takeReports()) lines.push({ ...r, ...(await handlers['story:report']({ ...r, introducedNow: introducedNow.has(r.item) })) });
  }
  assert.equal(engine.isFinished(), true);
  const summary = engine.summary();
  assert.equal(summary.total, data.scene.beats.filter((b) => ['choice', 'reading', 'meaning'].includes(b.type)).length);
  assert.equal(summary.firstTry, summary.total - 1, 'one deliberate mistake');
  const tracked = lines.filter((l) => l.tracked);
  assert.deepEqual(tracked.map((l) => l.item), ['g:n5-wa-desu', 'g:n5-ka', 'g:n5-no'], 'grammar is tracked; kanji are practice-only without a study pack');
  assert.ok(tracked.every((l) => l.applied === false && l.reason === 'lesson'));
  assert.equal(learn['learn:card']('g:n5-no').stage, 1);
  const done = await handlers['story:complete']({ id: 'n5-ch1', stars: summary.stars, accuracy: summary.accuracy, affection: summary.affection, gallery: summary.gallery });
  assert.equal(done.stars, 2);
  assert.deepEqual(done.overview.gallery.map((g) => g.id), ['first-day']);
  assert.equal(done.overview.affection.mio.value, 3);
});

test('shipped chapters load the same way main does', () => {
  const { chapters, problems } = loadChapters();
  assert.equal(problems.length, 0);
  assert.ok(chapters.length >= 4);
});
