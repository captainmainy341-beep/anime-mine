const test = require('node:test')
const assert = require('node:assert/strict')
const {keyMaskFilter, normalizeKey} = require('../src/core/subKey')

test('normalizeKey rejects anything without at least one valid colour', () => {
  for (const value of [null, undefined, 3, 'x', [], {}, {colors: []}, {colors: 'red'}, {colors: [[1, 2]]}, {colors: [[1, 2, NaN]]}, {colors: [['a', 'b', 'c']]}]) {
    assert.equal(normalizeKey(value), null, JSON.stringify(value))
  }
  assert.equal(normalizeKey(new Map()), null)
})

test('normalizeKey clamps and rounds colours, drops repeats, keeps the newest eight, and clamps tolerance', () => {
  const key = normalizeKey({colors: [[300, -5, 10.6], [300, -5, 11], [1, 2, 3]], tolerance: 500})
  assert.deepEqual(key, {colors: [[255, 0, 11], [1, 2, 3]], tolerance: 96})
  const many = normalizeKey({colors: Array.from({length: 12}, (_, i) => [i, 0, 0])})
  assert.deepEqual(many.colors.map(c => c[0]), [4, 5, 6, 7, 8, 9, 10, 11])
  assert.equal(normalizeKey({colors: [[0, 0, 0]], tolerance: 0}).tolerance, 4)
  assert.equal(normalizeKey({colors: [[0, 0, 0]]}).tolerance, 40)
})

test('keyMaskFilter builds one per-channel distance test per colour', () => {
  const filter = keyMaskFilter({colors: [[255, 255, 255], [10, 20, 30]], tolerance: 12})
  assert.match(filter, /^geq=r='if\(gt\(.+,0\),255,0\)':g='0':b='0'$/)
  assert.equal(filter.match(/lt\(max/g).length, 2)
  assert.match(filter, /abs\(r\(X,Y\)-10\)/)
  assert.match(filter, /,13\)/)
})
