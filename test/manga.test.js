const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const { MangaLibrary } = require('../src/core/manga');

async function setup(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'manga-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function touch(file, content = 'img') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function makeCbz(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const files = Object.fromEntries(Object.entries(entries).map(([name, text]) => [name, strToU8(text)]));
  fs.writeFileSync(file, Buffer.from(zipSync(files)));
  return file;
}

function seed(root) {
  const series = path.join(root, 'Series A');
  touch(path.join(series, 'Vol 10', '10.png'));
  touch(path.join(series, 'Vol 10', '2.jpg'));
  touch(path.join(series, 'Vol 10', '.hidden.png'));
  touch(path.join(series, 'Vol 10', 'notes.txt'));
  touch(path.join(series, 'Vol 2', '1.png'));
  makeCbz(path.join(series, 'Vol 3.cbz'), { 'p2.webp': 'b', 'p1.webp': 'a', 'readme.txt': 'x' });
  touch(path.join(series, '__MACOSX', 'junk.png'));
  touch(path.join(series, 'Thumbs.db'));
  return series;
}

test('scan treats each child folder as a series with natural-sorted volumes', async t => {
  const root = await setup(t);
  seed(root);
  touch(path.join(root, 'Series B', '01.png'));

  const library = new MangaLibrary(path.join(root, 'data'));
  library.addFolder(root);
  const series = library.scan();

  assert.deepEqual(series.map(s => s.title), ['Series A', 'Series B']);
  const volumes = series[0].volumes.map(v => [v.title, v.kind, v.pageCount]);
  assert.deepEqual(volumes, [['Vol 2', 'dir', 1], ['Vol 3.cbz', 'cbz', 2], ['Vol 10', 'dir', 2]]);
  assert.equal(series[1].volumes[0].kind, 'dir');
});

test('a folder directly holding images is one series with itself as its volume', async t => {
  const root = await setup(t);
  const dir = path.join(root, 'Solo');
  touch(path.join(dir, '1.png'));
  touch(path.join(dir, '2.png'));

  const library = new MangaLibrary(path.join(root, 'data'));
  library.addFolder(dir);
  const [series] = library.scan();

  assert.equal(series.volumes.length, 1);
  assert.equal(series.volumes[0].path, dir);
  assert.equal(series.volumes[0].pageCount, 2);
});

test('ids are stable 12-hex hashes that survive rescans', async t => {
  const root = await setup(t);
  seed(root);
  const library = new MangaLibrary(path.join(root, 'data'));
  library.addFolder(root);
  const first = library.scan();
  const second = new MangaLibrary(path.join(root, 'data')).scan();

  assert.match(first[0].id, /^[0-9a-f]{12}$/);
  assert.match(first[0].volumes[0].id, /^[0-9a-f]{12}$/);
  assert.deepEqual(second, first);
});

test('pages lists directory images in natural order and archive images without extracting others', async t => {
  const root = await setup(t);
  const series = seed(root);
  const library = new MangaLibrary(path.join(root, 'data'));
  library.addFolder(root);
  const [seriesRecord] = library.scan();
  const vol10 = seriesRecord.volumes.find(v => v.title === 'Vol 10');
  const cbz = seriesRecord.volumes.find(v => v.kind === 'cbz');

  assert.deepEqual(library.pages(seriesRecord.id, vol10.id), [
    { index: 0, name: '2.jpg' },
    { index: 1, name: '10.png' },
  ]);
  assert.deepEqual(library.pages(seriesRecord.id, cbz.id), [
    { index: 0, name: 'p1.webp' },
    { index: 1, name: 'p2.webp' },
  ]);
  assert.ok(series);
});

test('readPage returns a file path for folders and bytes for archives', async t => {
  const root = await setup(t);
  seed(root);
  const library = new MangaLibrary(path.join(root, 'data'));
  library.addFolder(root);
  const [seriesRecord] = library.scan();
  const vol10 = seriesRecord.volumes.find(v => v.title === 'Vol 10');
  const cbz = seriesRecord.volumes.find(v => v.kind === 'cbz');

  const file = library.readPage(seriesRecord.id, vol10.id, 1);
  assert.deepEqual(file, { kind: 'file', path: path.join(vol10.path, '10.png'), mime: 'image/png' });

  const bytes = library.readPage(seriesRecord.id, cbz.id, 1);
  assert.equal(bytes.kind, 'bytes');
  assert.equal(bytes.mime, 'image/webp');
  assert.equal(Buffer.isBuffer(bytes.data), true);
  assert.equal(bytes.data.toString(), 'b');

  assert.throws(() => library.readPage(seriesRecord.id, cbz.id, 5), /out of range/);
});

test('archive entries with traversal or absolute names are never listed or read', async t => {
  const root = await setup(t);
  const series = path.join(root, 'Evil');
  makeCbz(path.join(series, 'bad.cbz'), {
    '../escape.png': 'x',
    '/abs/root.png': 'y',
    'ok.png': 'z',
  });
  const library = new MangaLibrary(path.join(root, 'data'));
  library.addFolder(root);
  const [seriesRecord] = library.scan();
  const [volume] = seriesRecord.volumes;

  assert.deepEqual(library.pages(seriesRecord.id, volume.id), [{ index: 0, name: 'ok.png' }]);
  assert.throws(() => library.readPage(seriesRecord.id, volume.id, 1), /out of range/);
});

test('pageKey is stable for the same page and differs between pages', async t => {
  const root = await setup(t);
  seed(root);
  const library = new MangaLibrary(path.join(root, 'data'));
  library.addFolder(root);
  const [seriesRecord] = library.scan();
  const vol10 = seriesRecord.volumes.find(v => v.title === 'Vol 10');

  const key = library.pageKey(seriesRecord.id, vol10.id, 0);
  assert.match(key, /^[0-9a-f]{40}$/);
  assert.equal(library.pageKey(seriesRecord.id, vol10.id, 0), key);
  assert.notEqual(library.pageKey(seriesRecord.id, vol10.id, 1), key);
});

test('progress defaults to rtl and persists; continueReading returns the most recent volume', async t => {
  const root = await setup(t);
  seed(root);
  const dataDir = path.join(root, 'data');
  const library = new MangaLibrary(dataDir);
  library.addFolder(root);
  const [seriesRecord] = library.scan();
  const vol10 = seriesRecord.volumes.find(v => v.title === 'Vol 10');
  const cbz = seriesRecord.volumes.find(v => v.kind === 'cbz');

  assert.deepEqual(library.getProgress(vol10.id), { page: 0, direction: 'rtl', spread: false });
  assert.equal(library.continueReading(), null);

  library.setProgress(vol10.id, { page: 1, direction: 'ltr', spread: true });
  library.setProgress(cbz.id, { page: 1, direction: 'rtl', spread: false });
  assert.deepEqual(new MangaLibrary(dataDir).getProgress(vol10.id), { page: 1, direction: 'ltr', spread: true, updatedAt: library.getProgress(vol10.id).updatedAt });
  assert.deepEqual(new MangaLibrary(dataDir).continueReading(), { seriesId: seriesRecord.id, volId: cbz.id, page: 1 });
});

test('setProgress rejects an unknown direction', async t => {
  const root = await setup(t);
  const library = new MangaLibrary(path.join(root, 'data'));
  assert.throws(() => library.setProgress('abc', { page: 0, direction: 'up', spread: false }), /direction/);
});
