const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const { MangaLibrary } = require('../src/core/manga');

async function setup(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'manga-harden-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function touch(file, content = 'img') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function libraryFor(root, dataDir) {
  const library = new MangaLibrary(dataDir);
  library.addFolder(root);
  return library;
}

const CENTRAL_HEADER = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

test('an archive with more than 5000 entries is refused while listing', async t => {
  const root = await setup(t);
  const entries = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`${i}.png`, new Uint8Array(1)]));
  fs.mkdirSync(path.join(root, 'Series'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Series', 'Big.cbz'), Buffer.from(zipSync(entries, { level: 0 })));
  const library = libraryFor(root, await setup(t));
  assert.throws(() => library.scan(), /more than 5000 entries/);
});

test('an archive larger than 2 GiB is refused before it is read', async t => {
  const root = await setup(t);
  const cbz = touch(path.join(root, 'Series', 'Huge.cbz'), '');
  fs.truncateSync(cbz, 2 * 1024 ** 3 + 1);
  const library = libraryFor(root, await setup(t));
  assert.throws(() => library.scan(), /larger than 2 GiB/);
});

test('readPage refuses an entry whose declared size exceeds 64 MiB before inflating it', async t => {
  const root = await setup(t);
  const cbz = path.join(root, 'Series', 'Vol 1.cbz');
  const data = Buffer.from(zipSync({ '001.png': strToU8('x'.repeat(1000)) }));
  data.writeUInt32LE(100 * 1024 * 1024, data.indexOf(CENTRAL_HEADER) + 24);
  touch(cbz, data);
  const library = libraryFor(root, await setup(t));
  const [series] = library.scan();
  assert.equal(series.volumes[0].pageCount, 1);
  assert.throws(
    () => library.readPage(series.id, series.volumes[0].id, 0),
    /page is too large to extract: 001\.png declares 104857600 bytes/,
  );
});

test('identical layouts in two roots produce different series and volume ids', async t => {
  const rootA = await setup(t);
  const rootB = await setup(t);
  for (const root of [rootA, rootB]) touch(path.join(root, 'Series A', 'Vol 1', '001.jpg'));
  const [seriesA] = libraryFor(rootA, await setup(t)).scan();
  const [seriesB] = libraryFor(rootB, await setup(t)).scan();
  assert.notEqual(seriesA.id, seriesB.id);
  assert.notEqual(seriesA.volumes[0].id, seriesB.volumes[0].id);
});

test('two standalone image folders at the root level get different series ids', async t => {
  const rootA = await setup(t);
  const rootB = await setup(t);
  touch(path.join(rootA, '1.png'));
  touch(path.join(rootB, '1.png'));
  const [seriesA] = libraryFor(rootA, await setup(t)).scan();
  const [seriesB] = libraryFor(rootB, await setup(t)).scan();
  assert.notEqual(seriesA.id, seriesB.id);
});

test('the same root yields the same ids across library instances', async t => {
  const root = await setup(t);
  touch(path.join(root, 'Series A', 'Vol 1', '001.jpg'));
  fs.writeFileSync(path.join(root, 'Series A', 'Vol 2.cbz'), Buffer.from(zipSync({ '001.png': strToU8('a') })));
  const ids = series => series.flatMap(s => [s.id, ...s.volumes.map(v => v.id)]);
  const first = ids(libraryFor(root, await setup(t)).scan());
  const second = ids(libraryFor(root, await setup(t)).scan());
  assert.deepEqual(first, second);
  assert.ok(first.every(id => /^[0-9a-f]{12}$/.test(id)));
});

test('repeated readPage calls reuse the memoised scan and do not list the archive again', async t => {
  const root = await setup(t);
  touch(path.join(root, 'Series', 'Vol 1', '001.jpg'));
  fs.writeFileSync(path.join(root, 'Series', 'Vol 2.cbz'), Buffer.from(zipSync({ '001.png': strToU8('a') })));
  const library = libraryFor(root, await setup(t));
  const [series] = library.scan();
  const cbz = series.volumes.find(volume => volume.kind === 'cbz');
  library.readPage(series.id, cbz.id, 0);

  const reads = t.mock.method(fs, 'readFileSync');
  const listings = t.mock.method(fs, 'readdirSync');
  for (let i = 0; i < 3; i++) library.readPage(series.id, cbz.id, 0);

  assert.equal(reads.mock.calls.filter(call => call.arguments[0] === cbz.path).length, 3);
  assert.equal(listings.mock.callCount(), 0);
});

test('the memoised scan sees a volume added to an existing series', async t => {
  const root = await setup(t);
  touch(path.join(root, 'Series', 'Vol 1', '001.jpg'));
  const library = libraryFor(root, await setup(t));
  assert.equal(library.scan()[0].volumes.length, 1);
  touch(path.join(root, 'Series', 'Vol 2', '001.jpg'));
  assert.equal(library.scan()[0].volumes.length, 2);
});

test('pageKey differs between same-size pages and changes when a same-size file is replaced', async t => {
  const root = await setup(t);
  const vol1 = path.join(root, 'Series', 'Vol 1');
  const vol2 = path.join(root, 'Series', 'Vol 2');
  touch(path.join(vol1, '001.jpg'), 'aaaa');
  touch(path.join(vol1, '002.jpg'), 'bbbb');
  touch(path.join(vol2, '001.jpg'), 'aaaa');
  const library = libraryFor(root, await setup(t));
  const [series] = library.scan();
  const [first, second] = series.volumes;

  const firstKey = library.pageKey(series.id, first.id, 0);
  assert.notEqual(firstKey, library.pageKey(series.id, first.id, 1));
  assert.notEqual(firstKey, library.pageKey(series.id, second.id, 0));

  fs.writeFileSync(path.join(vol1, '001.jpg'), 'cccc');
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(vol1, '001.jpg'), later, later);
  assert.notEqual(library.pageKey(series.id, first.id, 0), firstKey);
});

test('readPage refuses a stored entry whose size field exceeds 64 MiB even if originalSize is forged small', async t => {
  const root = await setup(t);
  const data = Buffer.from(zipSync({ '001.png': strToU8('x'.repeat(1000)) }, { level: 0 }));
  data.writeUInt32LE(100 * 1024 * 1024, data.indexOf(CENTRAL_HEADER) + 20);
  touch(path.join(root, 'Series', 'Vol 1.cbz'), data);
  const library = libraryFor(root, await setup(t));
  const [series] = library.scan();
  assert.throws(() => library.readPage(series.id, series.volumes[0].id, 0), /page is too large to extract/);
});
