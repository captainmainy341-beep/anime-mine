import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCached } from '../src/renderer/lib/grammarPanel.mjs';

test('analyzeCached requests each sentence once', async () => {
  let calls = 0;
  const api = { grammar: { analyze: async (text) => { calls++; return { text }; } } };
  const a = await analyzeCached(api, 'cache me once');
  const b = await analyzeCached(api, 'cache me once');
  assert.equal(calls, 1);
  assert.equal(a, b);
});

test('analyzeCached retries after a failed analysis', async () => {
  let calls = 0;
  const api = { grammar: { analyze: async () => { calls++; if (calls === 1) throw new Error('offline'); return { ok: true }; } } };
  await assert.rejects(analyzeCached(api, 'retry me'), /offline/);
  assert.deepEqual(await analyzeCached(api, 'retry me'), { ok: true });
  assert.equal(calls, 2);
});
