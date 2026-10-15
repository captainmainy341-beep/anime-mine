const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSubtitles, findCue, decodeSubtitleBytes } = require('../extension/lib/subs');

test('parses SRT with comma milliseconds and multi-line text', () => {
  const srt = '1\n00:00:01,000 --> 00:00:02,500\nこんにちは\n2nd line\n\n2\n00:01:00,000 --> 00:01:03,250\nさようなら\n';
  assert.deepEqual(parseSubtitles(srt), [
    { start: 1, end: 2.5, text: 'こんにちは\n2nd line' },
    { start: 60, end: 63.25, text: 'さようなら' },
  ]);
});

test('parses VTT with short timestamps and skips NOTE, cue ids and settings', () => {
  const vtt = [
    'WEBVTT',
    '',
    'NOTE this is a comment',
    '',
    'intro',
    '00:01.000 --> 00:02.000 align:start position:10%',
    'first',
    '',
    'STYLE',
    '::cue { color: red }',
    '',
    '00:03.500 --> 00:04.000',
    'second',
  ].join('\n');
  assert.deepEqual(parseSubtitles(vtt), [
    { start: 1, end: 2, text: 'first' },
    { start: 3.5, end: 4, text: 'second' },
  ]);
});

test('parses ASS using the Format line, keeps commas and converts overrides', () => {
  const ass = [
    '[Script Info]',
    'Title: test',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\an8}今日は、いい天気\\Nです\\hね',
    'Comment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,ignored',
  ].join('\n');
  assert.deepEqual(parseSubtitles(ass), [{ start: 1, end: 3.5, text: '今日は、いい天気\nです ね' }]);
});

test('strips tags, drops ruby readings and decodes entities', () => {
  const srt = '1\n00:00:00,000 --> 00:00:01,000\n<i>a &amp; b</i> <ruby>漢<rt>かん</rt>字</ruby> &lt;x&gt;&nbsp;y\n';
  assert.deepEqual(parseSubtitles(srt), [{ start: 0, end: 1, text: 'a & b 漢字 <x> y' }]);
});

test('handles BOM and CRLF line endings', () => {
  const srt = '\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nhello\r\n';
  assert.deepEqual(parseSubtitles(srt), [{ start: 1, end: 2, text: 'hello' }]);
});

test('drops empty cues and sorts by start', () => {
  const srt = '1\n00:00:05,000 --> 00:00:06,000\nlate\n\n2\n00:00:01,000 --> 00:00:02,000\n<i></i>\n\n3\n00:00:02,000 --> 00:00:03,000\nmid\n';
  assert.deepEqual(parseSubtitles(srt), [
    { start: 2, end: 3, text: 'mid' },
    { start: 5, end: 6, text: 'late' },
  ]);
});

test('findCue respects gaps and the end boundary', () => {
  const cues = [
    { start: 1, end: 2, text: 'a' },
    { start: 3, end: 4, text: 'b' },
  ];
  assert.equal(findCue(cues, 0.5), null);
  assert.equal(findCue(cues, 1), cues[0]);
  assert.equal(findCue(cues, 2), null);
  assert.equal(findCue(cues, 2.5), null);
  assert.equal(findCue(cues, 3.999), cues[1]);
  assert.equal(findCue(cues, 4), null);
  assert.equal(findCue([], 1), null);
});

test('findCue returns the latest-starting active cue on overlap', () => {
  const cues = [
    { start: 1, end: 10, text: 'long' },
    { start: 2, end: 3, text: 'short' },
    { start: 5, end: 6, text: 'other' },
  ];
  assert.equal(findCue(cues, 2.5).text, 'short');
  assert.equal(findCue(cues, 4).text, 'long');
  assert.equal(findCue(cues, 5.5).text, 'other');
});

test('decodeSubtitleBytes reads UTF-8', () => {
  const bytes = new TextEncoder().encode('こんにちは');
  assert.equal(decodeSubtitleBytes(bytes.buffer), 'こんにちは');
});

test('decodeSubtitleBytes falls back to Shift_JIS', () => {
  const bytes = new Uint8Array([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]);
  assert.equal(decodeSubtitleBytes(bytes.buffer), 'こんにちは');
});

test('ASS keeps ASCII commas and \\pos(x,y) overrides in the Text field', () => {
  const ass = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\pos(10,20)}Hello, world',
  ].join('\n');
  assert.equal(parseSubtitles(ass)[0].text, 'Hello, world');
});
