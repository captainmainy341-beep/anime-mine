const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LearnStore } = require('../src/core/learnStore');
const srs = require('../src/core/srs');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 9, 10, 12, 0, 0).getTime();
const L1_RADICALS = ['r:女', 'r:子', 'r:木', 'r:力'];
const L1_KANJI = ['k:好', 'k:林', 'k:力'];
const L1_VOCAB = ['v:1', 'v:2', 'v:3'];

function kanji(char, level, components, vocab, meanings, onyomi, kunyomi) {
  return { id: `k:${char}`, char, meanings, onyomi, kunyomi, nanori: [], strokes: 6, grade: null, jlptOld: null, freq: null, level, components, hint: null, vocab };
}

function vocabEntry(id, word, kana, meanings, level, kanjiIds) {
  return { id, word, kana, meanings, pos: ['n'], kanji: kanjiIds, level, sentences: [{ ja: `${word}です。`, en: 'It is.' }] };
}

const PACK = {
  version: 1,
  builtAt: 0,
  levels: 2,
  radicals: {
    'r:女': { id: 'r:女', char: '女', name: 'woman', level: 1 },
    'r:子': { id: 'r:子', char: '子', name: 'child', level: 1 },
    'r:木': { id: 'r:木', char: '木', name: 'tree', level: 1 },
    'r:力': { id: 'r:力', char: '力', name: 'power', level: 1 },
    'r:水': { id: 'r:水', char: '水', name: 'water', level: 2 },
  },
  kanji: {
    'k:好': kanji('好', 1, ['r:女', 'r:子'], ['v:1'], ['like', 'fond'], ['コウ'], ['この.む', 'す.く']),
    'k:林': kanji('林', 1, ['r:木'], ['v:2'], ['grove'], ['リン'], ['はやし']),
    'k:力': kanji('力', 1, ['r:力'], ['v:3'], ['power'], ['リョク', 'リキ'], []),
    'k:水': kanji('水', 2, ['r:水'], ['v:4'], ['water'], ['スイ'], ['みず']),
  },
  vocab: {
    'v:1': vocabEntry('v:1', '好き', ['すき'], ['liking'], 1, ['k:好']),
    'v:2': vocabEntry('v:2', '林', ['はやし'], ['grove'], 1, ['k:林']),
    'v:3': vocabEntry('v:3', '力', ['ちから'], ['strength'], 1, ['k:力']),
    'v:4': vocabEntry('v:4', '水', ['みず'], ['water'], 2, ['k:水']),
  },
  levelList: [
    { level: 1, radicals: L1_RADICALS, kanji: L1_KANJI, vocab: L1_VOCAB },
    { level: 2, radicals: ['r:水'], kanji: ['k:水'], vocab: ['v:4'] },
  ],
};

function point(id, jlpt, title, examples, similar = []) {
  return { id, jlpt, title, meaning: `meaning of ${title}`, structure: 'structure', formality: 'neutral', notes: 'notes', similar, detect: [], examples };
}

const POINTS = [
  point('g:n5-a', 'N5', '〜A', [{ ja: 'ここで{{撮ってもいい}}ですか。', en: 'May I take photos here?', hint: '撮る + てもいい' }], ['〜B']),
  point('g:n5-b', 'N5', '〜B', [{ ja: 'これは{{食べてもいい|食べてもよい}}。', en: 'May I eat this?', hint: '食べる + てもいい' }]),
  point('g:n4-c', 'N4', '〜C', [{ ja: '明日{{行く}}つもりだ。', en: 'I plan to go tomorrow.', hint: '行く + つもり' }]),
];

const GRAMMAR = { points: POINTS, byId: new Map(POINTS.map((p) => [p.id, p])) };

let clock = NOW;
const now = () => clock;
const dirs = [];

beforeEach(() => {
  clock = NOW;
});

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

function freshDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-store-test-'));
  dirs.push(dir);
  return dir;
}

function makeStore(dataDir = freshDir(), extra = {}) {
  return new LearnStore({ dataDir, pack: PACK, grammar: GRAMMAR, now, ...extra });
}

function promote(store, id, stage) {
  let result = null;
  while (store.stageOf(id) < stage) result = store.submitReview({ id, incorrectCount: 0 });
  return result;
}

function passRadicals(store) {
  store.completeLessons(L1_RADICALS);
  for (const id of L1_RADICALS) promote(store, id, 5);
}

function passLevelOne(store) {
  passRadicals(store);
  store.completeLessons(L1_KANJI);
  for (const id of L1_KANJI) promote(store, id, 5);
  store.completeLessons(L1_VOCAB);
  for (const id of L1_VOCAB) promote(store, id, 5);
}

test('availability gates radicals, then kanji, then vocab', () => {
  const store = makeStore();
  const queued = () => store.lessonQueue({ scope: 'kanji', limit: 50 }).map((c) => c.id);
  assert.deepEqual(queued(), L1_RADICALS);
  assert.equal(store.card('k:好').locked, true);

  store.completeLessons(['r:女', 'r:子']);
  promote(store, 'r:女', 5);
  assert.equal(store.card('k:好').locked, true);
  promote(store, 'r:子', 5);
  assert.equal(store.card('k:好').locked, false);
  assert.ok(queued().includes('k:好'));
  assert.ok(!queued().includes('k:林'));
  assert.deepEqual(store.completeLessons(['k:林']).started, []);

  store.completeLessons(['k:好']);
  assert.ok(!queued().includes('v:1'));
  promote(store, 'k:好', 5);
  assert.ok(queued().includes('v:1'));
});

test('level advances once 90% of the level kanji reach stage 5', () => {
  const store = makeStore();
  passRadicals(store);
  store.completeLessons(['k:好', 'k:林']);
  promote(store, 'k:好', 5);
  promote(store, 'k:林', 5);
  assert.equal(store.dashboard().level.current, 1);
  assert.equal(store.dashboard().level.needed, 3);

  store.completeLessons(['k:力']);
  const result = promote(store, 'k:力', 5);
  assert.equal(result.levelUp, true);
  const { level } = store.dashboard();
  assert.equal(level.current, 2);
  assert.equal(level.kanjiTotal, 1);
  assert.equal(store.state.level.history.length, 1);
  assert.equal(store.state.level.history[0].level, 1);
});

test('lessons come due on the wanikani interval', () => {
  const store = makeStore();
  store.completeLessons(['r:女', 'r:子']);
  const first = srs.nextReviewAt('wk', 1, NOW);
  clock = first - 1;
  assert.deepEqual(store.reviewQueue(), []);
  assert.equal(store.dashboard().reviews.due, 0);
  clock = first;
  assert.equal(store.dashboard().reviews.due, 2);
  assert.deepEqual(store.reviewQueue().map((c) => c.id).sort(), ['r:女', 'r:子']);
});

test('reviewOrder lowestStageFirst sorts due items by stage', () => {
  const store = makeStore();
  store.settingsSet({ reviewOrder: 'lowestStageFirst' });
  store.completeLessons(['r:女', 'r:子']);
  store.submitReview({ id: 'r:女', incorrectCount: 0 });
  clock = srs.nextReviewAt('wk', 2, NOW);
  assert.deepEqual(store.reviewQueue().map((c) => c.id), ['r:子', 'r:女']);
});

test('wrong answers demote the item and ghost it until a clean answer', () => {
  const store = makeStore();
  store.completeLessons(['r:女']);
  promote(store, 'r:女', 5);
  const result = store.submitReview({ id: 'r:女', incorrectCount: 2 });
  assert.equal(result.prevStage, 5);
  assert.equal(result.stage, 3);
  assert.equal(result.passedNow, false);
  assert.deepEqual(store.cramQueue({ source: 'ghosts' }).map((c) => c.id), ['r:女']);
  assert.equal(store.state.lastWrong['r:女'], NOW);
  store.submitReview({ id: 'r:女', incorrectCount: 0 });
  assert.deepEqual(store.cramQueue({ source: 'ghosts' }), []);
});

test('reaching stage 9 burns the item and resurrect restarts it at stage 1', () => {
  const store = makeStore();
  store.completeLessons(['r:女']);
  const result = promote(store, 'r:女', 9);
  assert.equal(result.burned, true);
  assert.equal(result.group.key, 'burned');
  assert.equal(store.card('r:女').nextReview, null);
  clock = NOW + 10 * 365 * DAY;
  assert.deepEqual(store.reviewQueue(), []);
  assert.deepEqual(store.cramQueue({ source: 'burned' }).map((c) => c.id), ['r:女']);
  const card = store.resurrect('r:女');
  assert.equal(card.stage, 1);
  assert.equal(card.nextReview, srs.nextReviewAt('wk', 1, clock));
});

test('cram returns practice cards without changing state or the file', () => {
  const dir = freshDir();
  const store = makeStore(dir);
  store.completeLessons(['r:女', 'g:n5-a']);
  store.submitReview({ id: 'r:女', incorrectCount: 1 });
  const file = path.join(dir, 'learn.json');
  const fileBefore = fs.readFileSync(file, 'utf8');
  const stateBefore = JSON.stringify(store.state);
  const results = [
    { source: 'recentMistakes' },
    { source: 'recentLessons' },
    { source: 'burned' },
    { source: 'level', value: 1 },
    { source: 'jlpt', value: 'N5' },
    { source: 'ghosts' },
  ].map((query) => store.cramQueue(query));
  assert.deepEqual(results.map((r) => r.length), [1, 2, 0, 1, 1, 1]);
  assert.equal(JSON.stringify(store.state), stateBefore);
  assert.equal(fs.readFileSync(file, 'utf8'), fileBefore);
});

test('vacation pauses reviews and shifts schedules when it ends', () => {
  const store = makeStore();
  store.completeLessons(['r:女']);
  const original = store.card('r:女').nextReview;
  clock = NOW + HOUR;
  store.setVacation(true);
  clock = NOW + 2 * HOUR;
  store.setVacation(true);
  assert.equal(store.dashboard().vacation, true);
  clock = original + 5 * HOUR;
  assert.equal(store.dashboard().reviews.due, 0);
  assert.deepEqual(store.reviewQueue(), []);
  const delta = clock - (NOW + HOUR);
  store.setVacation(false);
  assert.equal(store.dashboard().vacation, false);
  assert.equal(store.card('r:女').nextReview, original + delta);
});

test('resetToLevel drops later-level SRS state but keeps grammar and custom words', () => {
  const store = makeStore();
  passLevelOne(store);
  assert.equal(store.dashboard().level.current, 2);
  store.completeLessons(['r:水', 'g:n5-a']);
  store.addCustomWord({ word: '推し', meanings: ['favorite'] });
  store.resetToLevel(1);
  assert.equal(store.dashboard().level.current, 1);
  assert.equal(store.card('r:水').stage, 0);
  assert.equal(store.card('k:好').stage, 5);
  assert.equal(store.card('g:n5-a').stage, 1);
  assert.equal(store.card('c:推し').word, '推し');
  assert.deepEqual(store.state.level.history, []);
});

test('custom words dedupe, validate, and can be removed', () => {
  const store = makeStore();
  const card = store.addCustomWord({
    word: '推し',
    kana: ['おし'],
    meanings: ['favorite'],
    sentence: { ja: '推しです。', en: 'She is my favorite.' },
  });
  assert.equal(card.id, 'c:推し');
  assert.equal(card.kind, 'custom');
  assert.equal(card.readingText, 'おし');
  assert.deepEqual(card.meanings, ['favorite']);
  assert.equal(store.addCustomWord({ word: '推し', meanings: ['other'] }).id, 'c:推し');
  assert.deepEqual(store.card('c:推し').meanings, ['favorite']);
  assert.throws(() => store.addCustomWord({ word: ' ', meanings: ['x'] }));
  assert.throws(() => store.addCustomWord({ word: '猫', meanings: [] }));
  assert.ok(store.lessonQueue({ scope: 'all' }).some((c) => c.id === 'c:推し'));
  assert.equal(store.removeCustomWord('c:推し'), true);
  assert.equal(store.removeCustomWord('c:推し'), false);
});

test('userData merges into cards with normalised synonyms and blacklist', () => {
  const store = makeStore();
  store.setUserData('k:好', { meaning: ' love ', synonyms: [' Adore ', 'adore', ''], blacklist: ['Bad'] });
  let card = store.card('k:好');
  assert.equal(card.notes.meaning, 'love');
  assert.deepEqual(card.synonyms, ['adore']);
  assert.deepEqual(card.blacklist, ['bad']);
  store.setUserData('k:好', { mnemonic: 'heart' });
  card = store.card('k:好');
  assert.equal(card.notes.meaning, 'love');
  assert.equal(card.notes.mnemonic, 'heart');
  assert.deepEqual(card.meanings, ['like', 'fond']);
});

test('state survives a reload from disk', () => {
  const dir = freshDir();
  const first = makeStore(dir);
  first.completeLessons(['r:女']);
  promote(first, 'r:女', 3);
  first.setUserData('r:女', { meaning: 'woman' });
  first.settingsSet({ lessonBatch: 7 });
  first.addCustomWord({ word: '推し', meanings: ['favorite'] });
  const second = makeStore(dir);
  assert.deepEqual(second.state, first.state);
  assert.equal(second.settingsGet().lessonBatch, 7);
  assert.equal(second.card('r:女').stage, 3);
  assert.equal(second.card('r:女').notes.meaning, 'woman');
});

test('missing or corrupt learn.json falls back to defaults', () => {
  const dir = freshDir();
  assert.equal(makeStore(dir).settingsGet().lessonBatch, 5);
  fs.writeFileSync(path.join(dir, 'learn.json'), '{not json');
  const store = makeStore(dir);
  assert.equal(store.settingsGet().dailyLessonLimit, 20);
  assert.equal(store.dashboard().level.current, 1);
  store.completeLessons(['r:女']);
  assert.equal(makeStore(dir).card('r:女').stage, 1);
});

test('dashboard counts levels, lessons, groups and forecast', () => {
  const store = makeStore();
  store.completeLessons(['r:女', 'r:子']);
  const d = store.dashboard();
  assert.equal(d.packReady, true);
  assert.equal(d.grammarReady, true);
  assert.deepEqual(d.level, { current: 1, total: 2, kanjiPassed: 0, kanjiTotal: 3, needed: 3, percent: 0 });
  assert.equal(d.lessons.kanji, 2);
  assert.equal(d.lessons.grammar, 3);
  assert.equal(d.lessons.remainingToday, 18);
  assert.equal(d.reviews.due, 0);
  assert.equal(d.reviews.nextAt, srs.nextReviewAt('wk', 1, NOW));
  assert.deepEqual(d.groups.wk, { apprentice: 2, guru: 0, master: 0, enlightened: 0, burned: 0 });
  assert.deepEqual(d.groups.bp, { beginner: 0, adept: 0, seasoned: 0, expert: 0, completed: 0 });
  assert.equal(d.forecastHours.length, 24);
  assert.equal(d.forecastHours.reduce((sum, b) => sum + b.count, 0), 2);
  assert.equal(d.forecastDays.length, 7);
  assert.equal(d.vacation, false);
  assert.equal(d.streakDays, 1);
});

test('daily lesson limit caps the queue and resets on a new day', () => {
  const store = makeStore();
  store.settingsSet({ dailyLessonLimit: 2, lessonBatch: 5 });
  assert.equal(store.lessonQueue({ scope: 'kanji' }).length, 2);
  store.completeLessons(['r:女', 'r:子']);
  assert.equal(store.dashboard().lessons.remainingToday, 0);
  assert.deepEqual(store.lessonQueue({ scope: 'kanji' }), []);
  clock = NOW + DAY;
  assert.equal(store.dashboard().lessons.remainingToday, 2);
  assert.throws(() => store.settingsSet({ lessonBatch: 0 }));
});

test('streakDays counts consecutive active local days ending today or yesterday', () => {
  const store = makeStore();
  clock = NOW - 2 * DAY;
  store.completeLessons(['r:女']);
  clock = NOW - DAY;
  store.completeLessons(['r:子']);
  clock = NOW;
  assert.equal(store.dashboard().streakDays, 2);
  store.completeLessons(['r:木']);
  assert.equal(store.dashboard().streakDays, 3);
  clock = NOW + 2 * DAY;
  assert.equal(store.dashboard().streakDays, 0);
});

test('onStage fires when lessons start and reviews change stage', () => {
  const calls = [];
  const store = makeStore(freshDir(), { onStage: (e) => calls.push(e) });
  store.completeLessons(['r:女']);
  store.submitReview({ id: 'r:女', incorrectCount: 0 });
  assert.deepEqual(calls, [
    { id: 'r:女', kind: 'radical', prevStage: 0, stage: 1 },
    { id: 'r:女', kind: 'radical', prevStage: 1, stage: 2 },
  ]);
});

test('grammar lessons run N5 first and filter by jlpt', () => {
  const store = makeStore();
  assert.deepEqual(store.lessonQueue({ scope: 'grammar', limit: 10 }).map((c) => c.id), ['g:n5-a', 'g:n5-b', 'g:n4-c']);
  assert.deepEqual(store.lessonQueue({ scope: 'grammar', jlpt: 'N4', limit: 10 }).map((c) => c.id), ['g:n4-c']);
  assert.deepEqual(store.lessonQueue({ ids: ['k:林'] }), []);
});

test('example choice alternates between point examples and anime sentences', () => {
  const store = makeStore();
  store.setAnimeSentences({
    'g:n5-a': [{ videoPath: '/anime/Show S1E1.mkv', start: 0, end: 3, text: 'ここで写真を撮ってもいいですか', matchStart: 6, matchEnd: 12 }],
  });
  store.completeLessons(['g:n5-a']);
  assert.deepEqual(store.card('g:n5-a').cloze.answers, ['撮ってもいい']);
  store.submitReview({ id: 'g:n5-a', incorrectCount: 0 });
  const cloze = store.card('g:n5-a').cloze;
  assert.equal(cloze.ja, 'ここで写真を{{撮ってもいい}}ですか');
  assert.deepEqual(cloze.answers, ['撮ってもいい']);
  assert.equal(cloze.en, null);
  assert.equal(cloze.hint, 'Show S1E1');
});

test('an invalid settings patch does not partially mutate study settings', () => {
  const store = makeStore();
  store.save();
  const before = store.settingsGet();
  const fileBefore = fs.readFileSync(store.file, 'utf8');
  assert.throws(() => store.settingsSet({ lessonBatch: 9, reviewOrder: 'invalid' }), /reviewOrder/);
  assert.deepEqual(store.settingsGet(), before);
  assert.equal(fs.readFileSync(store.file, 'utf8'), fileBefore);
  store.settingsSet({ showEnglish: false });
  assert.equal(makeStore(store.dataDir).settingsGet().lessonBatch, before.lessonBatch);
});

test('review and cram queues skip unavailable pack entries without losing progress', () => {
  const dir = freshDir();
  const store = makeStore(dir);
  store.completeLessons(['r:女', 'g:n5-a']);
  store.submitReview({ id: 'r:女', incorrectCount: 1 });
  clock += DAY;
  const withoutPack = makeStore(dir, { pack: null });
  const before = fs.readFileSync(store.file, 'utf8');
  assert.deepEqual(withoutPack.reviewQueue().map(card => card.id), ['g:n5-a']);
  assert.deepEqual(withoutPack.cramQueue({ source: 'recentLessons' }).map(card => card.id), ['g:n5-a']);
  assert.deepEqual(withoutPack.cramQueue({ source: 'ghosts' }), []);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  withoutPack.setPack(PACK);
  assert.deepEqual(withoutPack.reviewQueue().map(card => card.id).sort(), ['g:n5-a', 'r:女']);
  assert.equal(withoutPack.card('r:女').stage, store.card('r:女').stage);
});

test('level reset preserves saved entries absent from the current study pack', () => {
  const store = makeStore();
  store.state.items['v:removed'] = srs.startState('vocab', clock);
  store.state.ghosts['v:removed'] = true;
  store.state.lastWrong['v:removed'] = clock;
  store.save();
  store.resetToLevel(1);
  const reloaded = makeStore(store.dataDir);
  assert.deepEqual(reloaded.state.items['v:removed'], store.state.items['v:removed']);
  assert.equal(reloaded.state.ghosts['v:removed'], true);
  assert.equal(reloaded.state.lastWrong['v:removed'], clock);
});
