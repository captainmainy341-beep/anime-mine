import test from 'node:test';
import assert from 'node:assert/strict';
import { addKeyColor, dilateMask, keyMask, maskToRgba, setKeyTolerance } from '../src/renderer/lib/subKey.mjs';

test('addKeyColor appends, ignores repeats, caps at eight and keeps tolerance', () => {
  let key = addKeyColor(null, [1, 2, 3]);
  assert.deepEqual(key, { colors: [[1, 2, 3]], tolerance: 40 });
  key = setKeyTolerance(key, 20);
  key = addKeyColor(addKeyColor(key, [9, 9, 9]), [1, 2, 3]);
  assert.deepEqual(key.colors, [[9, 9, 9], [1, 2, 3]]);
  assert.equal(key.tolerance, 20);
  for (let i = 0; i < 10; i++) key = addKeyColor(key, [i, i, i]);
  assert.equal(key.colors.length, 8);
});

test('setKeyTolerance clamps to 4..96', () => {
  const key = { colors: [[0, 0, 0]], tolerance: 40 };
  assert.equal(setKeyTolerance(key, 1000).tolerance, 96);
  assert.equal(setKeyTolerance(key, -3).tolerance, 4);
});

test('keyMask marks pixels within tolerance of any key colour on every channel', () => {
  const rgba = new Uint8ClampedArray([
    255, 255, 255, 255,
    240, 250, 255, 255,
    200, 255, 255, 255,
    0, 0, 60, 255,
    0, 0, 200, 255,
  ]);
  const mask = keyMask(rgba, 5, 1, { colors: [[255, 255, 255], [0, 0, 64]], tolerance: 20 });
  assert.deepEqual([...mask], [1, 1, 0, 1, 0]);
});

test('dilateMask grows set pixels by the radius without wrapping across rows', () => {
  const mask = new Uint8Array(25);
  mask[2 * 5 + 2] = 1;
  const grown = dilateMask(mask, 5, 5, 1);
  assert.equal(grown.reduce((a, b) => a + b, 0), 9);
  assert.equal(grown[1 * 5 + 1], 1);
  assert.equal(grown[3 * 5 + 3], 1);
  const edge = new Uint8Array(10);
  edge[4] = 1;
  assert.deepEqual([...dilateMask(edge, 5, 2, 1)].slice(0, 5), [0, 0, 0, 1, 1]);
  assert.equal(dilateMask(mask, 5, 5, 0), mask);
});

test('maskToRgba paints set pixels opaque and the rest transparent', () => {
  const out = maskToRgba(new Uint8Array([1, 0]), [10, 20, 30], new Uint8ClampedArray(8));
  assert.deepEqual([...out], [10, 20, 30, 255, 10, 20, 30, 0]);
});
