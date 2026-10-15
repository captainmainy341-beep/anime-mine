import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from '../src/renderer/lib/lru.mjs';

test('LruCache evicts the least recently used key past its limit', () => {
  const cache = new LruCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1);
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.size, 2);
});

test('LruCache re-setting an existing key refreshes it without growing', () => {
  const cache = new LruCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 10);
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 10);
  assert.equal(cache.size, 2);
});

test('LruCache delete removes a key', () => {
  const cache = new LruCache(2);
  cache.set('a', 1);
  assert.equal(cache.delete('a'), true);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size, 0);
});
