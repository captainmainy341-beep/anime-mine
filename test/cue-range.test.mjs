import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCues } from '../src/renderer/lib/cueRange.mjs';

const cues = [
  { start: 1, end: 2, text: 'a' },
  { start: 3, end: 4, text: 'b' },
  { start: 5, end: 6, text: 'c' },
];

test('mergeCues joins a range in either order', () => {
  assert.deepEqual(mergeCues(cues, 0, 1), { start: 1, end: 4, text: 'a\nb' });
  assert.deepEqual(mergeCues(cues, 2, 1), { start: 3, end: 6, text: 'b\nc' });
});

test('mergeCues clamps the range and handles a single cue', () => {
  assert.deepEqual(mergeCues(cues, 2, 9), { start: 5, end: 6, text: 'c' });
  assert.deepEqual(mergeCues(cues, 1, 1), { start: 3, end: 4, text: 'b' });
});
