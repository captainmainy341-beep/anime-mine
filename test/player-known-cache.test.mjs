import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = { api: { dict: { onProgress() {} } } };
const { createPlayerKnownCache } = await import('../src/renderer/player.mjs');

test('player classification cache clears on vocabulary invalidation and is isolated per mount', async () => {
  let status = 'new';
  let calls = 0;
  const classify = async () => { calls++; return status; };
  const first = createPlayerKnownCache(classify);
  assert.equal(await first.classify('食べる', []), 'new');
  status = 'known';
  assert.equal(await first.classify('食べる', []), 'new');
  first.clear(); // same invalidation used by unmount and the known-word callback
  assert.equal(await first.classify('食べる', []), 'known');
  status = 'learning';
  const remount = createPlayerKnownCache(classify);
  assert.equal(await remount.classify('食べる', []), 'learning');
  assert.equal(calls, 3);
});

test('a rejected old request cannot evict a newer classification', async () => {
  let reject;
  const old = new Promise((_, r) => { reject = r; });
  let calls = 0;
  const cache = createPlayerKnownCache(() => ++calls === 1 ? old : Promise.resolve('known'));
  const originalError = console.error;
  console.error = () => {};
  try {
    const pending = cache.classify('word', []);
    cache.clear();
    assert.equal(await cache.classify('word', []), 'known');
    reject(new Error('late failure'));
    assert.equal(await pending, null);
    assert.equal(await cache.classify('word', []), 'known');
    assert.equal(calls, 2);
  } finally { console.error = originalError; }
});
