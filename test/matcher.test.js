const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseMediaName, findBestVideo } = require('../src/core/matcher');

test('parses SubsPlease-style release names', () => {
  assert.deepEqual(parseMediaName('[SubsPlease] Frieren - 05 (1080p) [ABCD1234].mkv'), {
    title: 'frieren',
    season: null,
    episode: 5,
    lang: null,
  });
});

test('parses SxxExx names and drops language suffixes', () => {
  assert.deepEqual(parseMediaName('Sousou no Frieren S01E05 Jimaku.srt'), {
    title: 'sousou no frieren',
    season: 1,
    episode: 5,
    lang: null,
  });
  assert.deepEqual(parseMediaName('Frieren S02E10.ja.srt'), { title: 'frieren', season: 2, episode: 10, lang: 'ja' });
});

test('parses dotted names with EP markers and release tags', () => {
  assert.deepEqual(parseMediaName('Frieren.EP05.WEBRip.ja.srt'), { title: 'frieren', season: null, episode: 5, lang: 'ja' });
  assert.deepEqual(parseMediaName('Frieren.Beyond.EP12.1080p.x264.jpn.vtt'), {
    title: 'frieren beyond',
    season: null,
    episode: 12,
    lang: 'ja',
  });
});

test('parses Japanese episode markers, including full-width digits', () => {
  assert.deepEqual(parseMediaName('葬送のフリーレン 第5話.mkv'), { title: '葬送のフリーレン', season: null, episode: 5, lang: null });
  assert.deepEqual(parseMediaName('Frieren 第５話.srt'), { title: 'frieren', season: null, episode: 5, lang: null });
});

test('keeps numbers that belong to the title', () => {
  assert.deepEqual(parseMediaName('Mob.Psycho.100.S02E03.1080p.mkv'), {
    title: 'mob psycho 100',
    season: 2,
    episode: 3,
    lang: null,
  });
});

test('ignores release versions and codec tags when reading episodes', () => {
  assert.deepEqual(parseMediaName('Frieren - 05v2 [x264].mkv'), { title: 'frieren', season: null, episode: 5, lang: null });
  assert.deepEqual(parseMediaName('Show.H.264.5.1.mkv'), { title: 'show', season: null, episode: null, lang: null });
});

test('reports the language of a trailing tag as an ISO 639-1 code', () => {
  for (const name of ['Frieren - 05.ja.srt', 'Frieren - 05.jp.srt', 'Frieren - 05.jpn.srt', 'Frieren - 05.jpn-JP.srt', 'Frieren - 05.ja-JP.ass', 'Frieren - 05.Japanese.srt']) {
    assert.deepEqual(parseMediaName(name), { title: 'frieren', season: null, episode: 5, lang: 'ja' }, name);
  }
  const codes = [['en', 'eng'], ['en', 'english'], ['es', 'spa'], ['fr', 'fre'], ['de', 'ger'], ['pt', 'por'], ['ru', 'rus'], ['zh', 'chi'], ['ko', 'kor'], ['id', 'ind'], ['ar', 'ara']];
  for (const [code, tag] of codes) {
    assert.equal(parseMediaName(`Frieren - 05.${tag}.srt`).lang, code, tag);
    assert.equal(parseMediaName(`Frieren - 05.${tag}.srt`).title, 'frieren', tag);
  }
  assert.equal(parseMediaName('Frieren - 05.chs.ass').lang, 'zh');
});

test('und and untagged files have no language, and language tags never leak into titles', () => {
  assert.deepEqual(parseMediaName('Frieren - 05.und.srt'), { title: 'frieren', season: null, episode: 5, lang: null });
  assert.deepEqual(parseMediaName('Frieren - 05.srt'), { title: 'frieren', season: null, episode: 5, lang: null });
  assert.deepEqual(parseMediaName('Show.Sub.05.srt'), { title: 'show', season: null, episode: 5, lang: null });
});

test('matches the same episode across the SubsPlease video, plain .ja.srt and Jimaku names', () => {
  const videos = [{ path: '/lib/a.mkv', name: '[SubsPlease] Frieren - 05 (1080p) [ABCD1234].mkv' }];
  const plain = findBestVideo('Frieren - 05.ja.srt', videos);
  const jimaku = findBestVideo('Sousou no Frieren S01E05 Jimaku.srt', videos);
  assert.equal(plain.video, videos[0]);
  assert.equal(jimaku.video, videos[0]);
  assert.ok(plain.score >= 0.6 && jimaku.score >= 0.6);
});

test('a "Frieren" subtitle matches "Sousou no Frieren" through containment', () => {
  const videos = [{ path: '/lib/s1e5.mkv', name: 'Sousou no Frieren S01E05.mkv' }];
  assert.equal(findBestVideo('Frieren - 05.srt', videos).video, videos[0]);
});

test('Show - 05 does not match Show - 06', () => {
  assert.equal(findBestVideo('Show - 05.srt', [{ path: '/lib/6.mkv', name: 'Show - 06.mkv' }]), null);
});

test('Show - 05 does not match a different show', () => {
  assert.equal(findBestVideo('Show - 05.srt', [{ path: '/lib/o.mkv', name: 'Other - 05.mkv' }]), null);
  assert.equal(findBestVideo('Frieren - 05.srt', [{ path: '/lib/o.mkv', name: 'Spy Family - 05.mkv' }]), null);
});

test('season mismatch rejects a match, but a missing season on either side does not', () => {
  const videos = [{ path: '/lib/s2.mkv', name: 'Show S02E05.mkv' }];
  assert.equal(findBestVideo('Show S01E05.srt', videos), null);
  assert.equal(findBestVideo('Show - 05.srt', videos).video, videos[0]);
});

test('subtitle without an episode number matches nothing', () => {
  assert.equal(findBestVideo('Show.srt', [{ path: '/lib/a.mkv', name: 'Show - 05.mkv' }]), null);
});

test('returns the highest scoring video among candidates', () => {
  const videos = [
    { path: '/lib/long.mkv', name: 'Sousou no Frieren - 05.mkv' },
    { path: '/lib/exact.mkv', name: 'Frieren - 05.mkv' },
  ];
  const match = findBestVideo('Frieren - 05.srt', videos);
  assert.equal(match.video, videos[1]);
  assert.equal(match.score, 1);
});

test('returns null when titles are dissimilar', () => {
  assert.equal(findBestVideo('Dungeon Meshi - 05.srt', [{ path: '/lib/a.mkv', name: 'Frieren - 05.mkv' }]), null);
});
