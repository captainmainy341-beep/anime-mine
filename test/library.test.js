const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../src/core/library');

async function setup(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'library-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function touch(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test('scan groups videos into shows sorted by season and episode, recursively', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  touch(path.join(media, '[SubsPlease] Frieren - 02 (1080p) [ABCD1234].mkv'));
  touch(path.join(media, '[SubsPlease] Frieren - 01 (1080p).mkv'));
  touch(path.join(media, 'Show', 'Season 1', 'Show S01E06.mp4'));
  touch(path.join(media, 'Show', 'Season 1', 'Show S01E05.mkv'));
  touch(path.join(media, 'notes.txt'));

  const library = new Library(path.join(root, 'data'));
  library.addFolder(media);
  const shows = await library.scan();

  assert.deepEqual(shows.map(show => show.title), ['frieren', 'show']);
  assert.deepEqual(shows[0].episodes.map(ep => ep.episode), [1, 2]);
  assert.deepEqual(shows[1].episodes.map(ep => ep.episode), [5, 6]);
  assert.equal(shows[1].episodes[0].season, 1);
  assert.equal(shows[1].episodes[0].name, 'Show S01E05.mkv');
  assert.equal(shows[1].episodes[0].path, path.join(media, 'Show', 'Season 1', 'Show S01E05.mkv'));
  assert.equal(shows[1].episodes[0].subtitlePath, null);
});

test('scan auto-links sidecar subtitles and persists them', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  const video = touch(path.join(media, 'Frieren - 01.mkv'));
  const sub = touch(path.join(media, 'Frieren - 01.ja.srt'));
  const data = path.join(root, 'data');

  const library = new Library(data);
  library.addFolder(media);
  const [show] = await library.scan();

  assert.equal(show.episodes[0].subtitlePath, sub);
  assert.equal(library.getSubtitle(video), sub);
  assert.equal(new Library(data).getSubtitle(video), sub);
});

test('scan never overwrites an existing link', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  const video = touch(path.join(media, 'Show - 03.mkv'));
  touch(path.join(media, 'Show - 03.srt'));
  const manual = touch(path.join(root, 'manual.srt'), '1\n');

  const library = new Library(path.join(root, 'data'));
  library.addFolder(media);
  const stored = library.linkSubtitle(video, manual);
  const [show] = await library.scan();

  assert.equal(show.episodes[0].subtitlePath, stored);
  assert.equal(library.getSubtitle(video), stored);
});

test('linkSubtitle copies the file into dataDir/subs and stores the copy', async t => {
  const root = await setup(t);
  const video = path.join(root, 'media', 'Show - 04.mkv');
  const sub = touch(path.join(root, 'downloads', 'Show - 04.srt'), 'payload');
  const dataDir = path.join(root, 'data');

  const library = new Library(dataDir);
  const stored = library.linkSubtitle(video, sub);

  assert.equal(path.dirname(stored), path.join(dataDir, 'subs'));
  assert.equal(path.extname(stored), '.srt');
  assert.equal(fs.readFileSync(stored, 'utf8'), 'payload');
  assert.equal(library.getSubtitle(video), stored);
  assert.equal(library.getSubtitle(path.join(root, 'other.mkv')), null);
});

test('folders are deduplicated, persisted in library.json and removable', async t => {
  const root = await setup(t);
  const dataDir = path.join(root, 'data');
  const folder = path.join(root, 'media');

  const library = new Library(dataDir);
  library.addFolder(folder);
  library.addFolder(folder);
  assert.deepEqual(library.getFolders(), [folder]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir, 'library.json'), 'utf8')).folders, [folder]);

  library.removeFolder(folder);
  assert.deepEqual(new Library(dataDir).getFolders(), []);
});

test('scan of an empty library returns no shows', async t => {
  const root = await setup(t);
  assert.deepEqual(await new Library(path.join(root, 'data')).scan(), []);
});

test('autoLinkSubtitle links a subtitle from outside the library and returns the episode', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  const video = touch(path.join(media, 'Show - 06.mkv'));
  const downloads = path.join(root, 'downloads');
  const sub = touch(path.join(downloads, 'Show - 06.srt'), 'cues');
  const dataDir = path.join(root, 'data');

  const library = new Library(dataDir);
  library.addFolder(media);
  const episode = await library.autoLinkSubtitle(sub);

  assert.equal(episode.path, video);
  assert.equal(episode.episode, 6);
  assert.equal(episode.subtitlePath, library.getSubtitle(video));
  assert.equal(path.dirname(episode.subtitlePath), path.join(dataDir, 'subs'));
  assert.equal(fs.readFileSync(episode.subtitlePath, 'utf8'), 'cues');
});

test('autoLinkSubtitle returns null for no match or an already linked episode', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  touch(path.join(media, 'Show - 06.mkv'));
  const downloads = path.join(root, 'downloads');
  const other = touch(path.join(downloads, 'Other - 06.srt'));
  const sub = touch(path.join(downloads, 'Show - 06.srt'));

  const library = new Library(path.join(root, 'data'));
  library.addFolder(media);
  assert.equal(await library.autoLinkSubtitle(other), null);
  assert.notEqual(await library.autoLinkSubtitle(sub), null);
  assert.equal(await library.autoLinkSubtitle(sub), null);
});

test('watchDownloads ignores partial downloads and links a settled subtitle', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  const video = touch(path.join(media, 'Show - 07.mkv'));
  const downloads = path.join(root, 'downloads');
  fs.mkdirSync(downloads);

  const library = new Library(path.join(root, 'data'));
  library.addFolder(media);

  const linked = new Promise(resolve => {
    const stop = library.watchDownloads(downloads, (episode, subtitlePath) => {
      stop();
      resolve({ episode, subtitlePath });
    });
    t.after(stop);
    touch(path.join(downloads, 'Show - 07.srt.crdownload'), 'partial');
    touch(path.join(downloads, 'Show - 07.srt.part'), 'partial');
    setTimeout(() => touch(path.join(downloads, 'Show - 07.srt'), 'final'), 50);
  });

  const { episode, subtitlePath } = await linked;
  assert.equal(episode.path, video);
  assert.equal(subtitlePath, library.getSubtitle(video));
  assert.equal(fs.readFileSync(subtitlePath, 'utf8'), 'final');
});

test('scan links only Japanese or untagged sidecars and prefers the Japanese one', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  const video = touch(path.join(media, 'Show - 08.mkv'));
  const english = touch(path.join(media, 'Show - 08.en.srt'));
  touch(path.join(media, 'Show - 08.srt'));
  const ja = touch(path.join(media, 'Show - 08.ja.srt'));
  const onlyEnglish = touch(path.join(media, 'Show - 09.mkv'));
  touch(path.join(media, 'Show - 09.eng.srt'));
  const library = new Library(path.join(root, 'data'));
  library.addFolder(media);
  const shows = await library.scan();

  assert.equal(library.getSubtitle(video), ja);
  assert.notEqual(library.getSubtitle(video), english);
  assert.equal(library.getSubtitle(onlyEnglish), null);
  assert.equal(shows[0].episodes[0].subtitlePath, ja);
  assert.equal(shows[0].episodes[1].subtitlePath, null);
});

test('a later Japanese sidecar replaces an untagged scan link but never a manual one', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  const auto = touch(path.join(media, 'Show - 10.mkv'));
  touch(path.join(media, 'Show - 10.srt'));
  const manual = touch(path.join(media, 'Show - 11.mkv'));
  touch(path.join(media, 'Show - 11.srt'));
  const library = new Library(path.join(root, 'data'));
  library.addFolder(media);
  const manualCopy = library.linkSubtitle(manual, touch(path.join(root, 'pick.srt'), 'picked'));

  await library.scan();
  assert.equal(library.getSubtitle(auto), path.join(media, 'Show - 10.srt'));

  const ja = touch(path.join(media, 'Show - 10.ja.srt'));
  touch(path.join(media, 'Show - 11.ja.srt'));
  await library.scan();
  assert.equal(library.getSubtitle(auto), ja);
  assert.equal(library.getSubtitle(manual), manualCopy);
});

test('autoLinkSubtitle ignores non-Japanese subtitles and accepts Japanese ones', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  const video = touch(path.join(media, 'Show - 12.mkv'));
  const downloads = path.join(root, 'downloads');
  const english = touch(path.join(downloads, 'Show - 12.en.srt'), 'en');
  const ja = touch(path.join(downloads, 'Show - 12.ja.srt'), 'ja');
  const library = new Library(path.join(root, 'data'));
  library.addFolder(media);

  assert.equal(await library.autoLinkSubtitle(english), null);
  assert.equal(library.getSubtitle(video), null);
  const episode = await library.autoLinkSubtitle(ja);
  assert.equal(episode.path, video);
  assert.equal(fs.readFileSync(library.getSubtitle(video), 'utf8'), 'ja');
});

test('library.json written before manual/auto tracking loads, and its links stay protected', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  const video = touch(path.join(media, 'Show - 13.mkv'));
  touch(path.join(media, 'Show - 13.ja.srt'));
  const legacy = touch(path.join(root, 'data', 'subs', 'legacy.srt'), 'legacy');
  const dataDir = path.join(root, 'data');
  fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({ folders: [media], links: { [video]: legacy } }));

  const library = new Library(dataDir);
  assert.deepEqual(library.getFolders(), [media]);
  await library.scan();
  assert.equal(library.getSubtitle(video), legacy);
});

test('watchDownloads returns a no-op stop when the downloads folder does not exist', async t => {
  const root = await setup(t);
  const warn = t.mock.method(console, 'warn', () => {});
  const library = new Library(path.join(root, 'data'));

  const stop = library.watchDownloads(path.join(root, 'missing'), () => assert.fail('nothing should link'));
  assert.equal(typeof stop, 'function');
  assert.doesNotThrow(() => stop());
  assert.equal(warn.mock.callCount(), 1);
});

test('watchDownloads refreshes the stored copy when a linked subtitle is modified again', async t => {
  const root = await setup(t);
  const media = path.join(root, 'media');
  const video = touch(path.join(media, 'Show - 14.mkv'));
  const downloads = path.join(root, 'downloads');
  fs.mkdirSync(downloads);
  const file = path.join(downloads, 'Show - 14.ja.srt');

  const library = new Library(path.join(root, 'data'));
  library.addFolder(media);
  const seen = [];
  await new Promise(resolve => {
    const stop = library.watchDownloads(downloads, (episode, subtitlePath) => {
      seen.push(fs.readFileSync(subtitlePath, 'utf8'));
      if (seen.length === 1) fs.writeFileSync(file, 'second');
      else {
        stop();
        resolve();
      }
    });
    t.after(stop);
    touch(file, 'first');
  });

  assert.deepEqual(seen, ['first', 'second']);
  assert.equal(fs.readFileSync(library.getSubtitle(video), 'utf8'), 'second');
});
