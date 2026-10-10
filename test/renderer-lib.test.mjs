import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCueIndex, neighborIndex } from '../src/renderer/lib/cues.mjs';
import { toSegments } from '../src/renderer/lib/segments.mjs';

const cues = [
  { start: 1, end: 2, text: 'a' },
  { start: 3, end: 4.5, text: 'b' },
  { start: 6, end: 7, text: 'c' },
];

test('findCueIndex returns the cue active at t (start inclusive, end exclusive)', () => {
  assert.equal(findCueIndex(cues, 1), 0);
  assert.equal(findCueIndex(cues, 1.99), 0);
  assert.equal(findCueIndex(cues, 2), -1);
  assert.equal(findCueIndex(cues, 4), 1);
  assert.equal(findCueIndex(cues, 6.5), 2);
});

test('findCueIndex returns -1 before, after, in gaps and for no cues', () => {
  assert.equal(findCueIndex(cues, 0), -1);
  assert.equal(findCueIndex(cues, 2.5), -1);
  assert.equal(findCueIndex(cues, 5), -1);
  assert.equal(findCueIndex(cues, 9), -1);
  assert.equal(findCueIndex([], 1), -1);
});

test('findCueIndex prefers the latest-starting active cue for overlapping and nested cues', () => {
  const nested = [
    { start: 0, end: 10, text: 'outer' },
    { start: 1, end: 2, text: 'inner' },
    { start: 3, end: 4, text: 'later' },
  ];
  assert.equal(findCueIndex(nested, 5), 0);
  assert.equal(findCueIndex(nested, 1.5), 1);
  assert.equal(findCueIndex(nested, 2.5), 0);
  assert.equal(findCueIndex(nested, 3.5), 2);
  assert.equal(findCueIndex(nested, 10), -1);
});

test('neighborIndex from inside a cue returns the adjacent cues', () => {
  assert.equal(neighborIndex(cues, 3.5, -1), 0);
  assert.equal(neighborIndex(cues, 3.5, 1), 2);
  assert.equal(neighborIndex(cues, 1.5, -1), -1);
  assert.equal(neighborIndex(cues, 6.5, 1), -1);
});

test('neighborIndex from a gap returns the cues around the gap', () => {
  assert.equal(neighborIndex(cues, 2.5, 1), 1);
  assert.equal(neighborIndex(cues, 2.5, -1), 0);
  assert.equal(neighborIndex(cues, 5, -1), 1);
  assert.equal(neighborIndex(cues, 0, 1), 0);
  assert.equal(neighborIndex(cues, 0, -1), -1);
  assert.equal(neighborIndex(cues, 10, -1), 2);
  assert.equal(neighborIndex(cues, 10, 1), -1);
});

test('toSegments returns one plain segment when there are no tokens', () => {
  assert.deepEqual(toSegments('猫が好き', []), [{ text: '猫が好き', token: null }]);
});

test('toSegments covers the full text in order and marks word tokens', () => {
  const text = '猫が好き。';
  const tokens = [
    { surface: '猫', start: 0, end: 1, isWord: true },
    { surface: 'が', start: 1, end: 2, isWord: true },
    { surface: '好き', start: 2, end: 4, isWord: true },
    { surface: '。', start: 4, end: 5, isWord: false },
  ];
  assert.deepEqual(toSegments(text, tokens), [
    { text: '猫', token: tokens[0] },
    { text: 'が', token: tokens[1] },
    { text: '好き', token: tokens[2] },
    { text: '。', token: null },
  ]);
});

test('toSegments keeps uncovered gaps as plain segments', () => {
  const tokens = [{ surface: 'def', start: 4, end: 7, isWord: true }];
  const segments = toSegments('abc def', tokens);
  assert.equal(segments.map((s) => s.text).join(''), 'abc def');
  assert.deepEqual(segments, [
    { text: 'abc ', token: null },
    { text: 'def', token: tokens[0] },
  ]);
});
