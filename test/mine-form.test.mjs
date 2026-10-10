import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  prefillFields,
  clampTiming,
  nudge,
  initialRange,
  extendRange,
  rangeCue,
  buildMineRequest,
  previewRequest,
  glossesOf,
} from '../src/renderer/lib/mineForm.mjs';

const cues = [
  { start: 1, end: 2, text: 'a' },
  { start: 2.5, end: 4, text: 'b' },
  { start: 5, end: 6, text: 'c' },
];

const entry = {
  senses: [
    { glosses: ['to eat', 'to devour'] },
    { glosses: ['to consume'] },
  ],
};

test('glossesOf joins every sense gloss and tolerates a missing entry', () => {
  assert.equal(glossesOf(entry), 'to eat; to devour; to consume');
  assert.equal(glossesOf(undefined), '');
});

test('prefillFields uses dictForm for word mode and cue text for sentence mode', () => {
  const word = prefillFields({ mode: 'word', cueText: 'line', word: '食べる', reading: 'たべる', entry });
  assert.deepEqual(word, {
    Word: '食べる',
    Reading: 'たべる',
    Meaning: 'to eat; to devour; to consume',
    SentenceTranslation: '',
    Notes: '',
  });
  const sentence = prefillFields({ mode: 'sentence', cueText: 'line', word: null, reading: null, entry: null });
  assert.equal(sentence.Word, 'line');
  assert.equal(sentence.Reading, '');
  assert.equal(sentence.Meaning, '');
});

test('clampTiming keeps start non-negative and end after start', () => {
  assert.deepEqual(clampTiming(-1, 3), { start: 0, end: 3 });
  assert.ok(clampTiming(4, 4).end > 4);
  assert.ok(clampTiming(4, 3).end > 4);
});

test('clampTiming caps clip length at 120 seconds', () => {
  assert.deepEqual(clampTiming(10, 500), { start: 10, end: 130 });
});

test('clampTiming rounds to milliseconds and survives NaN', () => {
  assert.deepEqual(clampTiming(1.23456, 2.5), { start: 1.235, end: 2.5 });
  const fallback = clampTiming(NaN, 2);
  assert.equal(fallback.start, 0);
  assert.equal(fallback.end, 2);
});

test('nudge moves one edge by 0.2s and keeps the timing valid', () => {
  assert.deepEqual(nudge({ start: 2, end: 4 }, 'start', -0.2), { start: 1.8, end: 4 });
  assert.deepEqual(nudge({ start: 2, end: 4 }, 'end', 0.2), { start: 2, end: 4.2 });
  assert.deepEqual(nudge({ start: 0, end: 4 }, 'start', -0.2), { start: 0, end: 4 });
  assert.ok(nudge({ start: 2, end: 2.1 }, 'end', -0.2).end > 2);
});

test('extendRange grows by one cue at a time and clamps at the edges', () => {
  let range = initialRange(cues, 1);
  range = extendRange(range, 'previous');
  assert.deepEqual(rangeCue(range), { start: 1, end: 4, text: 'a\nb' });
  range = extendRange(range, 'next');
  assert.deepEqual(rangeCue(range), { start: 1, end: 6, text: 'a\nb\nc' });
  range = extendRange(range, 'next');
  assert.equal(range.to, 2);
  range = extendRange(initialRange(cues, 0), 'previous');
  assert.equal(range.from, 0);
});

test('buildMineRequest produces the keys anki:mine accepts for word mode', () => {
  const req = buildMineRequest({
    videoPath: '/v.mkv',
    mode: 'word',
    cue: { start: 1, end: 2, text: 'a' },
    timing: { start: 0.8, end: 2.2 },
    word: { surface: '食べ', base: '食べる', reading: 'たべ' },
    fields: { Word: '食べる', Meaning: 'to eat' },
    context: ['x'],
    audioStreamIndex: 1,
  });
  assert.deepEqual(req, {
    videoPath: '/v.mkv',
    cue: { start: 1, end: 2, text: 'a' },
    mode: 'word',
    timing: { start: 0.8, end: 2.2 },
    fields: { Word: '食べる', Meaning: 'to eat' },
    context: ['x'],
    word: { surface: '食べ', base: '食べる', reading: 'たべ' },
    audioStreamIndex: 1,
  });
});

test('buildMineRequest omits word and audioStreamIndex for sentence mode without a stream', () => {
  const req = buildMineRequest({
    videoPath: '/v.mkv',
    mode: 'sentence',
    cue: { start: 1, end: 2, text: 'a' },
    timing: { start: 1, end: 2 },
    fields: {},
    context: [],
    audioStreamIndex: null,
  });
  assert.equal('word' in req, false);
  assert.equal('audioStreamIndex' in req, false);
});

test('previewRequest sends only the cue window the preview endpoint reads', () => {
  assert.deepEqual(previewRequest({ videoPath: '/v.mkv', timing: { start: 1, end: 2 }, audioStreamIndex: 0 }), {
    videoPath: '/v.mkv',
    cue: { start: 1, end: 2 },
    audioStreamIndex: 0,
  });
});
