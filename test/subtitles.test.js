const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseSubtitles, parseSubtitleFile, toSrt } = require('../src/core/subtitles');

const FIXTURES = path.join(__dirname, 'fixtures');

test('parses SRT with comma and dot milliseconds, strips tags, drops empty cues', async () => {
  const cues = await parseSubtitleFile(path.join(FIXTURES, 'sample.srt'));
  assert.deepEqual(cues, [
    { start: 1, end: 2.5, text: 'Hello there' },
    { start: 3, end: 4.25, text: 'Second\nline two' },
  ]);
});

test('parses VTT with header, short timestamps and cue settings', () => {
  const vtt = 'WEBVTT\n\nNOTE ignore me\n\n00:02.000 --> 00:03.500 align:start\n<c.yellow>Hi</c>\n\n01:00:00.000 --> 01:00:01.000\nLater\n';
  assert.deepEqual(parseSubtitles(vtt, '.vtt'), [
    { start: 2, end: 3.5, text: 'Hi' },
    { start: 3600, end: 3601, text: 'Later' },
  ]);
});

test('sorts SRT cues by start time', () => {
  const srt = '1\n00:00:05,000 --> 00:00:06,000\nB\n\n2\n00:00:01,000 --> 00:00:02,000\nA\n';
  assert.deepEqual(parseSubtitles(srt, '.srt').map(cue => cue.text), ['A', 'B']);
});

test('ASS uses only Dialogue lines in the Events section, honouring Format order', async () => {
  const cues = await parseSubtitleFile(path.join(FIXTURES, 'sample.ass'));
  assert.deepEqual(cues, [
    { start: 1, end: 2, text: 'Early' },
    { start: 4.5, end: 6, text: 'Later, with comma\nNext line' },
  ]);
});

test('ASS honours a custom Format order', () => {
  const ass = '[Events]\nFormat: Text, Start, End\nDialogue: Reordered, 0:00:01.00, 0:00:02.00\n';
  assert.deepEqual(parseSubtitles(ass, '.ass'), [{ start: 1, end: 2, text: 'Reordered' }]);
});

test('ssa is parsed like ass', () => {
  const ssa = '[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: Marked=0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Old\n';
  assert.deepEqual(parseSubtitles(ssa, '.ssa'), [{ start: 1, end: 2, text: 'Old' }]);
});

test('ASS skips malformed Dialogue lines instead of throwing', () => {
  const ass = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Good',
    'Dialogue: 0,0:00:03.00,Default',
    'Dialogue: 0,garbage,0:00:04.00,Default,,0,0,0,,Not a time',
    'Dialogue: 0,0:00:06.00,0:00:05.00,Default,,0,0,0,,Reversed',
    'Dialogue: 0,0:00:07.00,0:00:07.00,Default,,0,0,0,,Empty span',
    'Dialogue: 0,0:00:08.00,0:00:09.00,Default,,0,0,0,,Also good',
  ].join('\n');
  assert.deepEqual(parseSubtitles(ass, '.ass'), [
    { start: 1, end: 2, text: 'Good' },
    { start: 8, end: 9, text: 'Also good' },
  ]);
});

test('SRT and VTT skip cues whose end is not after start', () => {
  const srt = '1\n00:00:05,000 --> 00:00:04,000\nBackwards\n\n2\n00:00:01,000 --> 00:00:02,000\nOK\n';
  assert.deepEqual(parseSubtitles(srt, '.srt'), [{ start: 1, end: 2, text: 'OK' }]);
  const vtt = 'WEBVTT\n\n00:03.000 --> 00:03.000\nSame\n\n00:04.000 --> 00:05.000\nFine\n';
  assert.deepEqual(parseSubtitles(vtt, '.vtt'), [{ start: 4, end: 5, text: 'Fine' }]);
});

test('parseSubtitleFile strips a UTF-8 BOM', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'subs-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'bom.srt');
  await fs.writeFile(file, '\uFEFF1\n00:00:01,000 --> 00:00:02,000\nBOM line\n', 'utf8');
  assert.deepEqual(await parseSubtitleFile(file), [{ start: 1, end: 2, text: 'BOM line' }]);
});

test('drops a leading credit banner that starts early and lasts 8s or more', () => {
  const ass = [
    '[Script Info]',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:00.00,0:00:10.00,Default,,0,0,0,,編集・同期：IG/@arekitofun　修正：AT-X字幕版少々',
    'Dialogue: 0,0:00:10.50,0:00:12.00,Default,,0,0,0,,こんにちは',
  ].join('\n');
  assert.deepEqual(parseSubtitles(ass, '.ass'), [{ start: 10.5, end: 12, text: 'こんにちは' }]);
});

test('ASS keeps only Japanese-styled cues when a JP style is present', () => {
  const ass = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Text - JP,,0,0,0,,日本語',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Text - CN,,0,0,0,,中文',
    'Dialogue: 0,0:00:03.00,0:00:04.00,Text - JP - top,,0,0,0,,上の日本語',
    'Dialogue: 0,0:00:03.00,0:00:04.00,Text - CN - top,,0,0,0,,上の中文',
    'Dialogue: 0,0:00:05.00,0:00:06.00,Sign,,0,0,0,,看板',
    'Dialogue: 0,0:00:05.00,0:00:06.00,Ruby,,0,0,0,,るび',
  ].join('\n');
  assert.deepEqual(parseSubtitles(ass, '.ass'), [
    { start: 1, end: 2, text: '日本語' },
    { start: 3, end: 4, text: '上の日本語' },
  ]);
});

test('ASS keeps all cues when no style is Japanese-named', () => {
  const ass = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,One',
    'Dialogue: 0,0:00:03.00,0:00:04.00,Sign,,0,0,0,,Two',
  ].join('\n');
  assert.deepEqual(parseSubtitles(ass, '.ass'), [
    { start: 1, end: 2, text: 'One' },
    { start: 3, end: 4, text: 'Two' },
  ]);
});

test('toSrt writes numbered cues with rounded SRT timestamps', () => {
  const cues = [
    { start: 59.999999, end: 3600, text: 'First\nline' },
    { start: 3723.0044, end: 3725.9996, text: 'Second' },
  ];
  assert.equal(toSrt(cues), '1\n00:01:00,000 --> 01:00:00,000\nFirst\nline\n\n2\n01:02:03,004 --> 01:02:06,000\nSecond\n');
});

test('keeps a credit-like line that is not an early long banner', () => {
  const srt = '1\n00:00:00,500 --> 00:00:03,000\n字幕\n\n2\n00:00:20,000 --> 00:00:30,000\n制作会社\n';
  assert.deepEqual(parseSubtitles(srt, '.srt').map(cue => cue.text), ['字幕', '制作会社']);
});

test('an empty Japanese-styled cue does not discard valid non-Japanese cues', () => {
  const ass = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Text - JP,,0,0,0,,{\\an8}',
    'Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,Hello',
  ].join('\n');
  assert.deepEqual(parseSubtitles(ass, '.ass'), [{ start: 3, end: 4, text: 'Hello' }]);
});

test('ASS \\h hard spaces become spaces', () => {
  const ass = [
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello\\hthere',
  ].join('\n');
  assert.deepEqual(parseSubtitles(ass, '.ass'), [{ start: 1, end: 2, text: 'Hello there' }]);
});
