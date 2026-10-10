const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WatchProgress, findNextEpisode } = require('../src/core/progress');

const tempDirs = [];

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-progress-'));
  tempDirs.push(dir);
  return dir;
}

function episode(title, season, number) {
  const name = `${title} S${season}E${number}.mkv`;
  return { path: `/anime/${title}/${name}`, name, season, episode: number, subtitlePath: null };
}

const SHOWS = [
  {
    title: 'Alpha',
    episodes: [
      episode('Alpha', 1, 1),
      episode('Alpha', 1, 2),
      episode('Alpha', 2, 1),
      episode('Alpha', 2, 2),
    ],
  },
  {
    title: 'Beta',
    episodes: [episode('Beta', 1, 1), episode('Beta', 1, 2)],
  },
];

test('get returns null for an unknown video', () => {
  assert.equal(new WatchProgress(tempDataDir()).get('/a.mkv'), null);
});

test('update creates an entry with defaults and a timestamp', (t) => {
  t.mock.method(Date, 'now', () => 1234);
  const progress = new WatchProgress(tempDataDir());
  const saved = progress.update('/a.mkv', { position: 120, duration: 1400 });
  assert.deepEqual(saved, {
    position: 120,
    duration: 1400,
    updated: 1234,
    subOffset: 0,
    audioStreamIndex: null,
    subtitle: null,
    finished: false,
  });
  assert.deepEqual(progress.get('/a.mkv'), saved);
});

test('update merges the patch into the existing entry', () => {
  const progress = new WatchProgress(tempDataDir());
  progress.update('/a.mkv', {
    position: 100,
    duration: 1400,
    subOffset: 0.5,
    audioStreamIndex: 2,
    subtitle: { kind: 'embedded', index: 3 },
  });
  progress.update('/a.mkv', { position: 200 });
  assert.deepEqual(progress.get('/a.mkv'), {
    position: 200,
    duration: 1400,
    updated: progress.get('/a.mkv').updated,
    subOffset: 0.5,
    audioStreamIndex: 2,
    subtitle: { kind: 'embedded', index: 3 },
    finished: false,
  });
});

test('negative and non-numeric positions are clamped to zero', () => {
  const progress = new WatchProgress(tempDataDir());
  assert.equal(progress.update('/a.mkv', { position: -5, duration: 1400 }).position, 0);
  assert.equal(progress.update('/a.mkv', { position: 'abc' }).position, 0);
});

test('a position within 20 s of the end marks the episode finished', () => {
  const progress = new WatchProgress(tempDataDir());
  const finished = progress.update('/a.mkv', { position: 1395, duration: 1400 });
  assert.equal(finished.finished, true);
  assert.equal(finished.position, 0);
  assert.equal(progress.get('/a.mkv').position, 0);
});

test('the finish threshold is strictly more than 20 s before the end', () => {
  const progress = new WatchProgress(tempDataDir());
  assert.equal(progress.update('/a.mkv', { position: 1380, duration: 1400 }).finished, false);
  assert.equal(progress.update('/b.mkv', { position: 1381, duration: 1400 }).finished, true);
});

test('unknown duration never marks an episode finished', () => {
  const progress = new WatchProgress(tempDataDir());
  const saved = progress.update('/a.mkv', { position: 5000 });
  assert.equal(saved.finished, false);
  assert.equal(saved.position, 5000);
});

test('watching again after finishing clears the finished flag', () => {
  const progress = new WatchProgress(tempDataDir());
  progress.update('/a.mkv', { position: 1400, duration: 1400 });
  const again = progress.update('/a.mkv', { position: 300 });
  assert.equal(again.finished, false);
  assert.equal(again.position, 300);
});

test('a finished episode stays finished when only other fields change', () => {
  const progress = new WatchProgress(tempDataDir());
  progress.update('/a.mkv', { position: 1400, duration: 1400 });
  const updated = progress.update('/a.mkv', { subOffset: 1.5 });
  assert.equal(updated.finished, true);
  assert.equal(updated.position, 0);
  assert.equal(updated.subOffset, 1.5);
});

test('progress persists across instances and is written atomically', () => {
  const dataDir = tempDataDir();
  new WatchProgress(dataDir).update('/a.mkv', { position: 42, duration: 1400 });
  assert.equal(new WatchProgress(dataDir).get('/a.mkv').position, 42);
  assert.equal(fs.existsSync(path.join(dataDir, 'progress.json')), true);
  assert.equal(fs.existsSync(path.join(dataDir, 'progress.json.tmp')), false);
});

test('all returns every stored video keyed by path', () => {
  const progress = new WatchProgress(tempDataDir());
  assert.deepEqual(progress.all(), {});
  progress.update('/a.mkv', { position: 1, duration: 100 });
  progress.update('/b.mkv', { position: 2, duration: 100 });
  assert.deepEqual(Object.keys(progress.all()).sort(), ['/a.mkv', '/b.mkv']);
});

test('continueWatching lists unfinished episodes past 10 s, newest first', async (t) => {
  const progress = new WatchProgress(tempDataDir());
  const shows = [
    {
      title: 'Alpha',
      episodes: [episode('Alpha', 1, 1), episode('Alpha', 1, 2), episode('Alpha', 1, 3), episode('Alpha', 1, 4)],
    },
    { title: 'Beta', episodes: [episode('Beta', 1, 1)] },
  ];
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  now = 100;
  progress.update(shows[0].episodes[0].path, { position: 500, duration: 1400 });
  now = 300;
  progress.update(shows[1].episodes[0].path, { position: 60, duration: 1400 });
  now = 200;
  progress.update(shows[0].episodes[1].path, { position: 10, duration: 1400 });
  progress.update(shows[0].episodes[2].path, { position: 1400, duration: 1400 });
  progress.update('/elsewhere.mkv', { position: 999, duration: 1400 });

  const items = await progress.continueWatching(shows);
  assert.deepEqual(items, [
    {
      episode: shows[1].episodes[0],
      showTitle: 'Beta',
      position: 60,
      duration: 1400,
      updated: 300,
    },
    {
      episode: shows[0].episodes[0],
      showTitle: 'Alpha',
      position: 500,
      duration: 1400,
      updated: 100,
    },
  ]);
});

test('continueWatching honours the limit', async () => {
  const progress = new WatchProgress(tempDataDir());
  const shows = [{ title: 'Alpha', episodes: SHOWS[0].episodes }];
  for (const item of shows[0].episodes) progress.update(item.path, { position: 100, duration: 1400 });
  assert.equal((await progress.continueWatching(shows)).length, 4);
  assert.equal((await progress.continueWatching(shows, 2)).length, 2);
});

test('continueWatching is empty with no progress', async () => {
  assert.deepEqual(await new WatchProgress(tempDataDir()).continueWatching(SHOWS), []);
});

test('findNextEpisode returns the following episode in the same season', () => {
  assert.equal(findNextEpisode(SHOWS, SHOWS[0].episodes[0].path), SHOWS[0].episodes[1]);
});

test('findNextEpisode moves to the first episode of the next season', () => {
  assert.equal(findNextEpisode(SHOWS, SHOWS[0].episodes[1].path), SHOWS[0].episodes[2]);
});

test('findNextEpisode returns null at the end of the show', () => {
  assert.equal(findNextEpisode(SHOWS, SHOWS[0].episodes[3].path), null);
  assert.equal(findNextEpisode(SHOWS, SHOWS[1].episodes[1].path), null);
});

test('findNextEpisode returns null for an unknown video', () => {
  assert.equal(findNextEpisode(SHOWS, '/nowhere.mkv'), null);
  assert.equal(findNextEpisode([], '/nowhere.mkv'), null);
});

test('findNextEpisode orders by season then episode regardless of input order', () => {
  const shuffled = [{
    title: 'Gamma',
    episodes: [episode('Gamma', 2, 1), episode('Gamma', 1, 10), episode('Gamma', 1, 2), episode('Gamma', 1, 1)],
  }];
  assert.equal(findNextEpisode(shuffled, shuffled[0].episodes[3].path), shuffled[0].episodes[2]);
  assert.equal(findNextEpisode(shuffled, shuffled[0].episodes[2].path), shuffled[0].episodes[1]);
  assert.equal(findNextEpisode(shuffled, shuffled[0].episodes[1].path), shuffled[0].episodes[0]);
});

test('findNextEpisode does not cross into another show', () => {
  assert.equal(findNextEpisode(SHOWS, SHOWS[1].episodes[0].path), SHOWS[1].episodes[1]);
});
