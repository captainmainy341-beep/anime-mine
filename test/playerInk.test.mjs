import assert from 'node:assert/strict';
import test from 'node:test';

// player.mjs is a renderer module: it reads window.api at import time (and the popup subscribes to dict progress).
// The helpers under test are pure, so a tiny window shim is all the import needs. There is no DOM in these tests.
globalThis.window = { api: { dict: { onProgress() {} } } };
const {
  chipTokens,
  episodePlateLabel,
  formatTime,
  languageTag,
  lineStripText,
  plateLabel,
  scrubFraction,
  scrubTime,
  selectedChipIndex,
  trackChipLabel,
} = await import('../src/renderer/player.mjs');

const TOKENS = [
  { surface: '本当に' },
  { surface: '大丈夫' },
  { surface: 'な' },
  { surface: 'の' },
  { surface: '？' },
];

test('formatTime renders mm:ss and h:mm:ss like the frames', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(59.9), '00:59');
  assert.equal(formatTime(754), '12:34');
  assert.equal(formatTime(1420), '23:40');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(-5), '00:00');
  assert.equal(formatTime(NaN), '00:00');
  assert.equal(formatTime(Infinity), '00:00');
  assert.equal(formatTime('754'), '12:34');
});

test('plateLabel builds the Player header label', () => {
  assert.equal(
    plateLabel({ episode: 4, total: 12, time: 754, duration: 1420 }),
    'EPISODE 4 OF 12  ·  12:34 / 23:40',
  );
  assert.equal(plateLabel({ episode: 4, total: 12 }), 'EPISODE 4 OF 12');
  assert.equal(plateLabel({ episode: 4, time: 754, duration: 1420 }), 'EPISODE 4  ·  12:34 / 23:40');
  assert.equal(plateLabel({ time: 754, duration: 1420 }), '12:34 / 23:40');
  assert.equal(plateLabel({ episode: 4, total: 12, time: 0, duration: 0 }), 'EPISODE 4 OF 12');
  assert.equal(plateLabel({ episode: null, time: 0, duration: 0 }), '');
  assert.equal(plateLabel(), '');
  assert.equal(plateLabel({ episode: 0, total: 0 }), '');
  assert.equal(plateLabel({ episode: 4, total: 0 }), 'EPISODE 4');
});

test('episodePlateLabel shows the show and the episode tag', () => {
  assert.equal(episodePlateLabel({ show: 'Kono Subarashii S3', episode: 4 }), 'Kono Subarashii S3  ·  E04');
  assert.equal(episodePlateLabel({ show: '', episode: 12 }), 'E12');
  assert.equal(episodePlateLabel({ show: 'Frieren' }), 'Frieren');
  assert.equal(episodePlateLabel({ show: '  Frieren  ', episode: 7 }), 'Frieren  ·  E07');
  assert.equal(episodePlateLabel({ show: 'Frieren', episode: 7.9 }), 'Frieren');
  assert.equal(episodePlateLabel(), '');
});

test('scrubFraction maps time onto the 0..1 track', () => {
  assert.equal(scrubFraction(710, 1420), 0.5);
  assert.equal(scrubFraction(0, 1420), 0);
  assert.equal(scrubFraction(1420, 1420), 1);
  assert.equal(scrubFraction(2000, 1420), 1);
  assert.equal(scrubFraction(-5, 1420), 0);
  assert.equal(scrubFraction(30, 0), 0);
  assert.equal(scrubFraction(30, -1), 0);
  assert.equal(scrubFraction(NaN, 1420), 0);
  assert.equal(scrubFraction(30, 'nope'), 0);
});

test('scrubTime maps a track position back to seconds', () => {
  assert.equal(scrubTime(0.5, 1420), 710);
  assert.equal(scrubTime(0, 1420), 0);
  assert.equal(scrubTime(1, 1420), 1420);
  assert.equal(scrubTime(2, 100), 100);
  assert.equal(scrubTime(-1, 100), 0);
  assert.equal(scrubTime(0.25, 0), 0);
  assert.equal(scrubTime(0.25, Infinity), 0);
  assert.equal(scrubTime(NaN, 100), 0);
});

test('chipTokens keeps real words and their token index', () => {
  assert.deepEqual(chipTokens(TOKENS).map(({ index }) => index), [0, 1, 2, 3]);
  assert.deepEqual(chipTokens(TOKENS).map(({ token }) => token.surface), ['本当に', '大丈夫', 'な', 'の']);
  assert.deepEqual(chipTokens([{ surface: ' ' }, { surface: '。' }, { surface: '猫' }]).map(({ index }) => index), [2]);
  assert.deepEqual(chipTokens([{ surface: '' }, {}]), []);
  assert.deepEqual(chipTokens(null), []);
});

test('selectedChipIndex only marks the open word on its own line', () => {
  assert.equal(selectedChipIndex(TOKENS, { index: 2, tokenIndex: 1 }, 2), 1);
  assert.equal(selectedChipIndex(TOKENS, { index: 2, tokenIndex: 0 }), 0);
  assert.equal(selectedChipIndex(TOKENS, { index: 2, tokenIndex: 1 }, 3), -1);
  assert.equal(selectedChipIndex(TOKENS, { index: 2, tokenIndex: 9 }, 2), -1);
  assert.equal(selectedChipIndex(TOKENS, { index: 2, tokenIndex: -1 }, 2), -1);
  assert.equal(selectedChipIndex(TOKENS, { index: 2 }, 2), -1);
  assert.equal(selectedChipIndex(TOKENS, null, 2), -1);
  assert.equal(selectedChipIndex([], { index: 0, tokenIndex: 0 }, 0), -1);
});

test('lineStripText prefers a translation and falls back to the Japanese line', () => {
  assert.equal(lineStripText({ text: '本当に大丈夫なの？', translation: 'Are you really okay?' }), 'Are you really okay?');
  assert.equal(lineStripText({ text: '本当に大丈夫なの？', english: 'Really okay?' }), 'Really okay?');
  assert.equal(lineStripText({ text: '本当に大丈夫なの？', en: 'Really?' }), 'Really?');
  assert.equal(lineStripText({ text: '本当に大丈夫なの？', translation: '   ' }), '本当に大丈夫なの？');
  assert.equal(lineStripText({ text: ' どうしたの？ ' }), 'どうしたの？');
  assert.equal(lineStripText(null), '');
  assert.equal(lineStripText({}), '');
});

test('languageTag gives the short control-bar tags', () => {
  assert.equal(languageTag('ja', 'audio'), 'JP');
  assert.equal(languageTag('ja', 'subs'), 'JA');
  assert.equal(languageTag('ja-JP'), 'JA');
  assert.equal(languageTag('EN'), 'EN');
  assert.equal(languageTag('ko', 'audio'), 'KR');
  assert.equal(languageTag('zh-Hans'), 'ZH');
  assert.equal(languageTag('de'), 'DE');
  assert.equal(languageTag('fil'), 'FIL');
  assert.equal(languageTag(null), '');
  assert.equal(languageTag(''), '');
});

test('trackChipLabel describes the selected subtitle and audio tracks', () => {
  const streams = [
    { index: 0, type: 'audio', lang: 'ja' },
    { index: 3, type: 'subtitle', lang: 'ja' },
    { index: 4, type: 'subtitle', lang: 'en' },
  ];
  assert.equal(trackChipLabel('subs', { choice: 'off' }), 'SUBS OFF');
  assert.equal(trackChipLabel('subs', { choice: 'external', linkedLang: 'ja' }), 'SUBS JA');
  assert.equal(trackChipLabel('subs', { choice: 3, streams }), 'SUBS JA');
  assert.equal(trackChipLabel('subs', { choice: 4, streams }), 'SUBS EN');
  assert.equal(trackChipLabel('subs', { choice: 9, streams }), 'SUBS');
  assert.equal(trackChipLabel('audio', { choice: 0, streams }), 'AUDIO JP');
  assert.equal(trackChipLabel('audio', { choice: null, streams }), 'AUDIO');
});
