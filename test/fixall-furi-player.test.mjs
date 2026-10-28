import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { furiganaSegments } from '../src/renderer/lib/furigana.mjs';

const require = createRequire(import.meta.url);
const core = require('../src/core/furigana.js');
globalThis.window = { api: { dict: { onProgress() {} } } };
const { cleanPlayerTitle } = await import('../src/renderer/player.mjs');

test('renderer aligns okurigana and multiple kanji runs like the core', () => {
  for (const [surface, reading] of [['食べる', 'タベル'], ['取り戻す', 'トリモドス'], ['日本語', 'ニホンゴ'], ['申し込む', 'モウシコム'], ['食べる', 'タベルヨ']]) {
    const token = { surface, reading, start: 0, end: surface.length };
    assert.deepEqual(furiganaSegments(token), core.furiganaSegments(surface, [token]));
  }
  assert.deepEqual(furiganaSegments({ surface: '食べる', reading: 'タベル' }), [{ text: '食', ruby: 'た' }, { text: 'べる' }]);
});

test('player title removes path, video extension and release brackets', () => {
  assert.equal(cleanPlayerTitle('C:\\anime\\[Group] My.Show - 01 [1080p].mkv'), 'My Show - 01');
  assert.equal(cleanPlayerTitle('Frieren: Beyond Journey’s End'), 'Frieren: Beyond Journey’s End');
});
