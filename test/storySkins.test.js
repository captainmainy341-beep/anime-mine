const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const skins = require('../src/core/storySkins');

const dirs = [];
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function dataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-skins-'));
  dirs.push(dir);
  return dir;
}

function writePack(root, name, manifest, files = {}) {
  const dir = path.join(root, 'vn-skins', name);
  fs.mkdirSync(dir, { recursive: true });
  if (manifest !== null) fs.writeFileSync(path.join(dir, 'pack.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  for (const [rel, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), bytes);
  }
  return dir;
}

test('a missing skins folder or pack means "use the default pack"', () => {
  const root = dataDir();
  assert.deepEqual(skins.listPacks(root), []);
  assert.equal(skins.loadManifest(root, 'nope'), null);
  assert.equal(skins.loadManifest(root, '../escape'), null);
  assert.equal(skins.loadManifest(root, null), null);
});

test('a pack manifest keeps only entries whose image exists', () => {
  const root = dataDir();
  writePack(root, 'mine', {
    name: 'Mine',
    author: 'me',
    license: 'CC0',
    characters: { mio: { neutral: 'mio/n.png', smile: 'mio/missing.png', 'Bad Expr': 'mio/n.png' }, ghost: { neutral: 'nope.png' } },
    backgrounds: { 'classroom-morning': 'bg/c.jpg', gone: 'bg/gone.jpg' },
  }, { 'mio/n.png': 'png', 'bg/c.jpg': 'jpg' });
  const manifest = skins.loadManifest(root, 'mine');
  assert.deepEqual(manifest.characters, { mio: { neutral: 'mio/n.png' } });
  assert.deepEqual(manifest.backgrounds, { 'classroom-morning': 'bg/c.jpg' });
  assert.deepEqual([manifest.title, manifest.author, manifest.license], ['Mine', 'me', 'CC0']);
  assert.deepEqual(skins.listPacks(root), [{ pack: 'mine', title: 'Mine', valid: true }]);
});

test('broken packs are listed as invalid and load as null', () => {
  const root = dataDir();
  writePack(root, 'nojson', null);
  writePack(root, 'garbage', '{not json');
  writePack(root, 'array', '[]');
  assert.deepEqual(skins.listPacks(root).map((p) => [p.pack, p.valid]), [['array', false], ['garbage', false], ['nojson', false]]);
  for (const name of ['nojson', 'garbage', 'array']) assert.equal(skins.loadManifest(root, name), null);
});

test('asset paths cannot leave the pack, use odd types or follow symlinks out', () => {
  const root = dataDir();
  const dir = writePack(root, 'evil', {
    characters: { mio: { neutral: '../../secret.png', smile: '/etc/passwd', sad: 'a.txt', tired: 'link.png', surprised: 'ok.png' } },
    backgrounds: {},
  }, { 'a.txt': 'x', 'ok.png': 'png' });
  fs.writeFileSync(path.join(root, 'secret.png'), 'secret');
  fs.symlinkSync(path.join(root, 'secret.png'), path.join(dir, 'link.png'));
  const manifest = skins.loadManifest(root, 'evil');
  assert.deepEqual(manifest.characters, { mio: { surprised: 'ok.png' } });
  assert.throws(() => skins.readAsset(root, 'evil', '../../secret.png'), /not found/);
  assert.throws(() => skins.readAsset(root, 'evil', 'link.png'), /not found/);
  assert.throws(() => skins.readAsset(root, '../evil', 'ok.png'), /invalid skin pack/);
});

test('readAsset returns a data URL with the right type', () => {
  const root = dataDir();
  writePack(root, 'p', { characters: { mio: { neutral: 'a.png' } } }, { 'a.png': Buffer.from([1, 2, 3]), 'b.svg': '<svg/>' });
  assert.equal(skins.readAsset(root, 'p', 'a.png'), `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`);
  assert.match(skins.readAsset(root, 'p', 'b.svg'), /^data:image\/svg\+xml;base64,/);
});
