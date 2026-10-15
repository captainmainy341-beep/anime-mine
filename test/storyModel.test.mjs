import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBackground, resolveSprite } from '../src/renderer/learn/vn/skin.mjs';
import { backgroundFor, characterSvg, lookFor, BACKGROUND_IDS } from '../src/renderer/learn/vn/defaultSkin.mjs';
import { affectionRows, backlogRows, chapterAction, completionMark, endSummary, introModel, menuSections, pendingLabel, pickSkin, reportLine, translateLabel, translationFor, translationOn } from '../src/renderer/learn/storyModel.mjs';

const manifest = {
  pack: 'mine',
  characters: { mio: { neutral: 'mio/n.png', smile: 'mio/s.png' } },
  backgrounds: { 'classroom-morning': 'bg/c.jpg' },
};

test('sprites fall back: pack expression, pack neutral, then the drawn default', () => {
  assert.deepEqual(resolveSprite(manifest, 'mio', 'smile'), { source: 'pack', pack: 'mine', path: 'mio/s.png', expr: 'smile' });
  assert.deepEqual(resolveSprite(manifest, 'mio', 'angry'), { source: 'pack', pack: 'mine', path: 'mio/n.png', expr: 'neutral' });
  assert.equal(resolveSprite(manifest, 'sora', 'smile').source, 'default');
  assert.equal(resolveSprite(null, 'mio', 'smile').source, 'default');
  assert.equal(resolveSprite({ pack: 'x' }, 'mio').source, 'default');
});

test('backgrounds prefer an episode frame, then the pack, then the drawn default', () => {
  assert.deepEqual(resolveBackground(manifest, 'classroom-morning', 'data:image/jpeg;base64,AAAA'), { source: 'frame', src: 'data:image/jpeg;base64,AAAA' });
  assert.equal(resolveBackground(manifest, 'classroom-morning').source, 'pack');
  assert.deepEqual(resolveBackground(manifest, 'park-day'), { source: 'default', bg: 'park-day' });
  assert.deepEqual(resolveBackground(null, undefined), { source: 'default', bg: 'default' });
});

test('the default pack draws every shipped character, expression and background without assets', () => {
  for (const char of ['mio', 'sora', 'tanaka', 'line', 'someone-new']) {
    for (const expr of ['neutral', 'smile', 'tired', 'surprised', 'sad', 'unknown']) {
      const svg = characterSvg(char, expr);
      assert.match(svg, /^<svg[^>]*>.*<\/svg>$/);
      assert.ok(!/(href|src)=/.test(svg), 'no external references');
    }
  }
  assert.equal(lookFor('x', '#112233').outfit, '#112233');
  assert.doesNotMatch(lookFor('x', '"><script>').outfit, /script/);
  assert.equal(backgroundFor('nope'), backgroundFor('default'));
  for (const id of BACKGROUND_IDS) assert.match(backgroundFor(id).css, /gradient/);
});

test('every background id used by a shipped chapter has a drawn default', async () => {
  const { loadChapters } = await import('node:module').then((m) => m.createRequire(import.meta.url)('../src/core/storyContent.js'));
  for (const chapter of loadChapters().chapters) {
    const ids = [chapter.bg, ...chapter.beats.filter((b) => b.type === 'bg').map((b) => b.bg)];
    for (const id of ids) assert.ok(BACKGROUND_IDS.includes(id), `${chapter.id}: no default background "${id}"`);
  }
});

test('menu helpers', () => {
  assert.equal(completionMark({ completed: true, plays: 1 }), 'Completed');
  assert.equal(completionMark({ completed: false, plays: 0 }), '');
  assert.deepEqual(chapterAction({ saved: true, plays: 1 }), { label: 'Continue', secondary: 'Start over' });
  assert.deepEqual(chapterAction({ saved: false, plays: 1 }), { label: 'Play again', secondary: null });
  assert.equal(chapterAction({ saved: false, plays: 0 }).label, 'Play');
  assert.equal(menuSections({ chapters: [1], ai: { ready: false, scenes: [2] } }).aiVisible, false, 'AI section is hidden without a provider');
  assert.equal(menuSections({ chapters: [], ai: { ready: true, scenes: [] } }).aiVisible, true);
  assert.equal(pickSkin([{ pack: 'a', valid: true }, { pack: 'b', valid: false }], 'a'), 'a');
  assert.equal(pickSkin([{ pack: 'b', valid: false }], 'b'), null);
  assert.equal(pickSkin([], 'gone'), null);
  assert.deepEqual(affectionRows({ affection: { a: { name: 'B', value: 3 }, b: { name: 'A', value: 9 } } }).map((r) => r.name), ['A', 'B']);
});

test('intro cards say whether the item will start in the SRS', () => {
  const fresh = introModel('k:日', { state: 'new', label: '日', reading: 'にち', meaning: 'day' });
  assert.deepEqual([fresh.kind, fresh.action, fresh.tracked], ['kanji', 'Learn it', true]);
  const unknown = introModel('g:n5-ka', { state: 'untracked', label: '〜か', meaning: 'question' });
  assert.deepEqual([unknown.kind, unknown.action, unknown.tracked], ['grammar', 'Continue', false]);
  assert.match(unknown.footnote, /will not change your reviews/);
});

test('report lines describe what happened to the schedule', () => {
  assert.match(reportLine('k:日', { tracked: false }), /Practice only/);
  assert.match(reportLine('k:日', { tracked: true, applied: false }), /Learned in story/);
  assert.equal(reportLine('k:日', { tracked: true, applied: true, result: { prevStage: 1, stage: 2, group: { label: 'Apprentice' } } }), 'Review recorded: stage 1 → 2 (Apprentice)');
  assert.equal(reportLine('k:日', { tracked: true, applied: true, result: { prevStage: 4, stage: 3, group: { label: 'Apprentice' } } }), 'Review recorded: stage 4 → 3');
});

test('end summary shows first-try count and completion, no stars', () => {
  const out = endSummary({ total: 4, firstTry: 3, accuracy: 0.75, affection: { mio: 2, sora: 0 }, gallery: [{ id: 'a', title: 'A' }] });
  assert.equal(out.heading, 'Scene complete');
  assert.equal(out.line, '3 of 4 right first try');
  assert.equal(out.revisited, 1);
  assert.deepEqual(out.affection, [['mio', 2]]);
  assert.ok(!JSON.stringify(out).includes('★'));
  assert.equal('stars' in out, false);
  assert.equal(endSummary({ total: 0, firstTry: 0, accuracy: 1, affection: {}, gallery: [] }).line, 'Story complete');
  assert.deepEqual([pendingLabel(0), pendingLabel(1), pendingLabel(3)], ['', '1 to revisit', '3 to revisit']);
});

test('translation toggle: explicit preference wins, otherwise on for N5/N4', () => {
  assert.equal(translationOn(null, { jlpt: 'N5' }), true);
  assert.equal(translationOn(undefined, { jlpt: 'N4' }), true);
  assert.equal(translationOn(null, { jlpt: 'N3' }), false);
  assert.equal(translationOn(false, { jlpt: 'N5' }), false);
  assert.equal(translationOn(true, { jlpt: 'N1' }), true);
  assert.equal(translationOn('yes', { jlpt: 'N2' }), false, 'garbage in prefs falls back to the default');
  assert.equal(translationFor({ en: 'Hello.' }, true), 'Hello.');
  assert.equal(translationFor({ en: 'Hello.' }, false), '');
  assert.equal(translationFor({ text: 'x' }, true), '');
  assert.deepEqual([translateLabel(true), translateLabel(false)], ['Translation: on', 'Translation: off']);
  const log = [{ name: 'みお', text: 'えっ？', en: 'Huh?' }, { text: '…', en: 'Hmm.', bridge: true }];
  assert.deepEqual(backlogRows(log, true).map((r) => r.en), ['Huh?', 'Hmm.']);
  assert.deepEqual(backlogRows(log, false).map((r) => r.en), ['', '']);
  assert.equal(backlogRows(log, false)[1].bridge, true);
});

test('drawn characters use per-character gradient ids and animation hooks, all self-contained', () => {
  const a = characterSvg('mio', 'smile');
  const b = characterSvg('sora', 'smile');
  const ids = (svg) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids(a).length >= 3);
  assert.equal(ids(a).filter((id) => ids(b).includes(id)).length, 0, 'two characters on stage never share gradient ids');
  for (const svg of [a, characterSvg('tanaka', 'sad')]) {
    for (const [, ref] of svg.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids(svg).includes(ref), `${ref} is defined`);
  }
  assert.match(a, /class="story-breathe"/);
  assert.match(characterSvg('mio', 'neutral'), /class="story-blink"/);
  assert.notEqual(characterSvg('mio', 'sad'), characterSvg('mio', 'neutral'), 'each expression draws a different face');
  assert.doesNotMatch(characterSvg('x"><script>', 'neutral'), /<script/);
});

test('kanji in a line are split out one by one so each can be tapped', async () => {
  const { splitKanji } = await import('../src/renderer/learn/storyModel.mjs');
  assert.deepEqual(splitKanji('ゆうきさんは日本人？'), [
    { text: 'ゆうきさんは', kanji: false }, { text: '日', kanji: true }, { text: '本', kanji: true }, { text: '人', kanji: true }, { text: '？', kanji: false },
  ]);
  assert.deepEqual(splitKanji(''), []);
  assert.deepEqual(splitKanji('ねこ'), [{ text: 'ねこ', kanji: false }]);
});

test('the kanji card shows dictionary data, SRS state, and asks for the dictionary when it is missing', async () => {
  const { kanjiCard } = await import('../src/renderer/learn/storyModel.mjs');
  const full = kanjiCard({ char: '学', dictionaryReady: true, meanings: ['study', 'learning', 'science'], on: ['ガク'], kun: ['まな.ぶ'], strokes: 8, jlpt: 4, words: [{ text: '学生', reading: 'がくせい', gloss: 'student' }, { text: 'がく', reading: 'がく' }], item: { state: 'started', stage: 3 } });
  assert.deepEqual([full.meaning, full.on, full.kun, full.facts, full.status, full.learnable, full.needsDownload], ['study, learning, science', 'ガク', 'まな.ぶ', '8 strokes · JLPT N4', 'In your reviews: stage 3', false, false]);
  assert.deepEqual(full.words[1], { text: 'がく', reading: '', gloss: '' });
  const bare = kanjiCard({ char: '先', dictionaryReady: false, meanings: ['previous'], reading: 'せん', item: { state: 'new', stage: 0 } }, { tested: true });
  assert.deepEqual([bare.reading, bare.learnable, bare.needsDownload, bare.tested, bare.status], ['せん', true, true, true, 'New: not learned yet']);
  assert.match(kanjiCard({ char: '本', meanings: [] }).meaning, /No meaning/);
  assert.match(kanjiCard({ char: '本' }).status, /Not in your study pack/);
});

test('particle helpers and the Genki path list', async () => {
  const { particleParts, guideFocus, genkiRows } = await import('../src/renderer/learn/storyModel.mjs');
  assert.deepEqual(particleParts('学校＿行きます。'), { before: '学校', after: '行きます。' });
  const guide = { confusions: [{ id: 'wa-ga', pair: ['は', 'が'] }, { id: 'ni-de', pair: ['に', 'で'] }] };
  assert.equal(guideFocus(guide, 'で'), 'ni-de');
  assert.equal(guideFocus(guide, 'ね'), null);
  const rows = genkiRows([{ id: 'b', lesson: 2, plays: 0 }, { id: 'a', lesson: 1, completed: true, plays: 1 }, { id: 'c', lesson: 3, plays: 0 }]);
  assert.deepEqual(rows.map((r) => [r.id, r.label, r.upNext]), [['a', 'Lesson 1', false], ['b', 'Lesson 2', true], ['c', 'Lesson 3', false]]);
});
