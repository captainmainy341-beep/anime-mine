const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseSubtitles, parseSubtitleFile } = require('../src/core/subtitles');

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
