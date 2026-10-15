const test = require('node:test')
const assert = require('node:assert/strict')
const {normalizeCover} = require('../src/core/cover')

test('normalizeCover rejects anything that is not a plain object with finite x, y, w, h', () => {
  for (const value of [null, undefined, 'x', 1, [], [0, 0, 0.5, 0.5], {x: 0, y: 0, w: 0.5}, {x: '0.1', y: 0, w: 0.5, h: 0.5}, {x: NaN, y: 0, w: 0.5, h: 0.5}, {x: 0, y: 0, w: Infinity, h: 0.5}, Object.assign(Object.create({x: 0}), {y: 0, w: 0.5, h: 0.5})]) {
    assert.equal(normalizeCover(value), null, JSON.stringify(value))
  }
})

test('normalizeCover clamps the origin to 0..1 and the size so the box stays inside the frame', () => {
  assert.deepEqual(normalizeCover({x: 0.75, y: -0.5, w: 0.5, h: 0.8}), {x: 0.75, y: 0, w: 0.25, h: 0.8})
  assert.deepEqual(normalizeCover({x: -1, y: 0.25, w: 2, h: 3}), {x: 0, y: 0.25, w: 1, h: 0.75})
  const clamped = normalizeCover({x: 0.3, y: 0.7, w: 0.9, h: 0.9})
  assert.ok(clamped.x + clamped.w <= 1)
  assert.ok(clamped.y + clamped.h <= 1)
})

test('normalizeCover returns null for a box smaller than 2% of the frame on either side', () => {
  assert.equal(normalizeCover({x: 0.1, y: 0.1, w: 0.019, h: 0.5}), null)
  assert.equal(normalizeCover({x: 0.1, y: 0.1, w: 0.5, h: 0.019}), null)
  assert.equal(normalizeCover({x: 1, y: 0.1, w: 0.5, h: 0.5}), null)
  assert.deepEqual(normalizeCover({x: 0.1, y: 0.1, w: 0.02, h: 0.02}), {x: 0.1, y: 0.1, w: 0.02, h: 0.02})
})

test('normalizeCover returns a fresh object with exactly x, y, w, h and leaves the input alone', () => {
  const input = {x: 0.1, y: 0.2, w: 0.3, h: 0.4, extra: 'kept out'}
  const out = normalizeCover(input)
  assert.deepEqual(Object.keys(out).sort(), ['h', 'w', 'x', 'y'])
  assert.notEqual(out, input)
  assert.deepEqual(input, {x: 0.1, y: 0.2, w: 0.3, h: 0.4, extra: 'kept out'})
})
