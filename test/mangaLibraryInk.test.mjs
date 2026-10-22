import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { libraryRows, filterLibrary, libraryStats, volumeProgress, volumeLabel, LIBRARY_SORTS } from '../src/renderer/manga/libraryModel.mjs';
const series = [
  { id: 'a', title: 'Zebra', volumes: [{ id: 'a1', pageCount: 10 }, { id: 'a2', pageCount: 20 }] },
  { id: 'b', title: '青の箱', volumes: [{ id: 'b1', pageCount: 10 }] },
  { id: 'c', title: 'Alpha', volumes: [{ id: 'c1', pageCount: 5 }] },
];
const progress = { a1: { page: 3, updatedAt: 10 }, c1: { page: 4, updatedAt: 20 } };
const rows = libraryRows(series, progress);
test('real covers fill their ink frame without fallback title overlays', async () => {
  const css = await readFile(new URL('../src/renderer/css/manga.css', import.meta.url), 'utf8');
  assert.match(css, /\.manga-cover-img\s*\{[^}]*width: 100%;[^}]*height: 100%;[^}]*object-fit: cover;/);
  assert.match(css, /\.manga-view \.manga-cover-img\s*\{[^}]*position: absolute; inset: 0;/);
  assert.match(css, /\.has-cover > :is\(\.manga-cover-pattern, \.manga-cover-letter, \.manga-cover-caption\) \{ visibility: hidden;/);
  assert.match(css, /\.manga-vol-tag\s*\{[^}]*z-index: 1;/);
  assert.match(css, /\.manga-cover-frame \.ink-stamp\s*\{[^}]*z-index: 1;/);
});
test('compact manga hero overrides desktop height only at the shared breakpoint', async () => {
  const css = await readFile(new URL('../src/renderer/css/manga.css', import.meta.url), 'utf8');
  assert.match(css, /\.manga-view > \.ink-hero \{ height: 104px; min-height: 104px;/);
  assert.match(css, /@media \(max-width: 1300px\) \{\s*\.manga-view > \.ink-hero \{ height: 84px; min-height: 84px;/);
});
test('new means no persisted reading timestamp, not default page zero', () => {
  assert.equal(rows[1].isNew, true);
  assert.equal(rows[0].isNew, false);
  assert.equal(volumeProgress({ pageCount: 10 }, { page: 0 }).started, false);
  assert.equal(volumeProgress({ pageCount: 10 }, { page: 0, updatedAt: 1 }).started, true);
});
test('filters distinguish reading, finished and unread', () => {
  for (const [filter, expected] of [['Reading', ['a']], ['Finished', ['c']], ['Unread', ['b']], ['New', ['b']]]) {
    assert.deepEqual(filterLibrary(rows, { filter }).map(r => r.series.id), expected);
  }
  assert.equal(filterLibrary(rows).length, 3);
});
test('search trims, ignores case and supports Japanese', () => {
  assert.deepEqual(filterLibrary(rows, { search: ' ZEB ' }).map(r => r.series.id), ['a']);
  assert.equal(filterLibrary(rows, { search: '青' })[0].series.id, 'b');
  assert.equal(filterLibrary(rows, { search: 'missing' }).length, 0);
});
test('sort by persisted recent reading or title without mutating source', () => {
  assert.deepEqual(filterLibrary(rows).map(r => r.series.id), ['c', 'a', 'b']);
  assert.deepEqual(filterLibrary(rows, { sort: 'Title' }).map(r => r.series.id), ['c', 'a', 'b']);
  assert.deepEqual(rows.map(r => r.series.id), ['a', 'b', 'c']);
  assert.deepEqual(LIBRARY_SORTS, ['Recently read', 'Title']);
  const different = libraryRows(series, { a1: { page: 0, updatedAt: 30 }, c1: { page: 0, updatedAt: 1 } });
  assert.deepEqual(filterLibrary(different).map(r => r.series.id), ['a', 'c', 'b']);
  assert.deepEqual(filterLibrary(different, { sort: 'Title' }).map(r => r.series.id), ['c', 'a', 'b']);
});
test('stats count titles, volumes and unread titles', () => {
  assert.deepEqual(libraryStats(rows), { titles: 3, volumes: 4, new: 1 });
  assert.deepEqual(libraryStats([]), { titles: 0, volumes: 0, new: 0 });
});
test('series percentage aggregates volumes; representative cover follows most recent volume', () => {
  assert.equal(rows[0].percent, 4 / 30 * 100);
  assert.equal(rows[0].volume.id, 'a1');
  assert.equal(libraryRows(series, { a2: { page: 2, updatedAt: 99 } })[0].volume.id, 'a2');
});
test('volume labels use explicit numbers when present, otherwise scan order', () => {
  assert.equal(volumeLabel(series[0], series[0].volumes[1]), 'Vol 2');
  assert.equal(volumeLabel(series[0], { id: 'a1', title: 'Volume 12' }), 'Vol 12');
  assert.equal(volumeLabel(series[0], { id: 'a1', title: '004巻' }), 'Vol 4');
});
test('progress is zero for unread and unknown lengths, clamps invalid pages', () => {
  assert.equal(volumeProgress({ pageCount: 0 }, { page: 30, updatedAt: 1 }).percent, 0);
  assert.equal(volumeProgress({ pageCount: 10 }, { page: 500, updatedAt: 1 }).percent, 100);
  assert.equal(volumeProgress({ pageCount: 10 }).percent, 0);
});
