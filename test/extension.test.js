const { test } = require('node:test');
const assert = require('node:assert/strict');
const captions = require('../extension/lib/captions');
const { originPatterns } = require('../extension/lib/sites');

const {
  normalizeCaption,
  hasJapanese,
  charSpans,
  pickWordRange,
  extractSurface,
  buildMinePayload,
  cleanTitle,
} = captions;

test('normalizeCaption trims and returns empty for nullish input', () => {
  assert.equal(normalizeCaption('  hello  '), 'hello');
  assert.equal(normalizeCaption(null), '');
  assert.equal(normalizeCaption(undefined), '');
  assert.equal(normalizeCaption(''), '');
});

test('normalizeCaption joins CJK lines without a separator', () => {
  assert.equal(normalizeCaption('私は\n学生です'), '私は学生です');
});

test('normalizeCaption joins non-CJK lines with a single space', () => {
  assert.equal(normalizeCaption('hello\nworld'), 'hello world');
  assert.equal(normalizeCaption('今日は\nhello'), '今日は hello');
});

test('normalizeCaption collapses runs of whitespace', () => {
  assert.equal(normalizeCaption('a   \t b'), 'a b');
});

test('hasJapanese detects hiragana, katakana and kanji', () => {
  assert.equal(hasJapanese('こんにちは'), true);
  assert.equal(hasJapanese('カタカナ'), true);
  assert.equal(hasJapanese('漢字'), true);
});

test('hasJapanese rejects latin, digits and empty input', () => {
  assert.equal(hasJapanese('hello 123'), false);
  assert.equal(hasJapanese(''), false);
  assert.equal(hasJapanese(null), false);
});

test('charSpans returns each character with its index', () => {
  assert.deepEqual(charSpans('日本'), [
    { char: '日', index: 0 },
    { char: '本', index: 1 },
  ]);
});

test('charSpans handles empty and nullish text', () => {
  assert.deepEqual(charSpans(''), []);
  assert.deepEqual(charSpans(null), []);
});

test('charSpans keeps surrogate pairs as one character with UTF-16 indices', () => {
  assert.deepEqual(charSpans('a😀b'), [
    { char: 'a', index: 0 },
    { char: '😀', index: 1 },
    { char: 'b', index: 3 },
  ]);
});

test('pickWordRange returns the span unchanged when in bounds', () => {
  assert.deepEqual(pickWordRange('日本語', { start: 1, end: 3 }), { start: 1, end: 3 });
});

test('pickWordRange clamps out-of-range spans', () => {
  assert.deepEqual(pickWordRange('日本', { start: -5, end: 99 }), { start: 0, end: 2 });
  assert.deepEqual(pickWordRange('日本', { start: 5, end: 9 }), { start: 2, end: 2 });
});

test('pickWordRange returns an empty range for a null span', () => {
  assert.deepEqual(pickWordRange('日本', null), { start: 0, end: 0 });
});

test('extractSurface slices the clamped span', () => {
  assert.equal(extractSurface('私は学生です', { start: 2, end: 4 }), '学生');
  assert.equal(extractSurface('私は学生です', null), '');
  assert.equal(extractSurface('', { start: 0, end: 3 }), '');
});

test('cleanTitle strips known site suffixes', () => {
  assert.equal(cleanTitle('Some Show - Netflix'), 'Some Show');
  assert.equal(cleanTitle('Some Video - YouTube'), 'Some Video');
  assert.equal(cleanTitle('Naruto | Crunchyroll'), 'Naruto');
  assert.equal(cleanTitle('Naruto – Crunchyroll'), 'Naruto');
});

test('cleanTitle leaves other titles alone and handles empty input', () => {
  assert.equal(cleanTitle('Plain title'), 'Plain title');
  assert.equal(cleanTitle(''), '');
  assert.equal(cleanTitle(null), '');
});

test('cleanTitle caps length at 200 characters', () => {
  assert.equal(cleanTitle('a'.repeat(500)).length, 200);
});

test('parseEpisodeLabel reads season and episode from S/E labels', () => {
  assert.deepEqual(captions.parseEpisodeLabel('S1 E1 You, My Polar Opposite'), { season: 1, episode: 1 });
  assert.deepEqual(captions.parseEpisodeLabel('S01E05'), { season: 1, episode: 5 });
  assert.deepEqual(captions.parseEpisodeLabel('Season 2 Episode 3'), { season: 2, episode: 3 });
});

test('parseEpisodeLabel reads episode-only labels with season null', () => {
  assert.deepEqual(captions.parseEpisodeLabel('Episode 5'), { season: null, episode: 5 });
  assert.deepEqual(captions.parseEpisodeLabel('EP5'), { season: null, episode: 5 });
  assert.deepEqual(captions.parseEpisodeLabel('Ep. 5'), { season: null, episode: 5 });
  assert.deepEqual(captions.parseEpisodeLabel('E5'), { season: null, episode: 5 });
  assert.deepEqual(captions.parseEpisodeLabel('第5話'), { season: null, episode: 5 });
});

test('parseEpisodeLabel returns nulls when nothing matches', () => {
  assert.deepEqual(captions.parseEpisodeLabel('You, My Polar Opposite'), { season: null, episode: null });
  assert.deepEqual(captions.parseEpisodeLabel(''), { season: null, episode: null });
  assert.deepEqual(captions.parseEpisodeLabel(null), { season: null, episode: null });
});

const LOOKUP = {
  span: { start: 0, end: 2, text: '学生' },
  dictForm: '学生',
  entries: [
    {
      kanji: ['学生'],
      kana: ['がくせい'],
      senses: [
        { pos: ['n'], glosses: ['student', 'pupil'] },
        { pos: ['n'], glosses: ['student', 'learner'] },
      ],
    },
  ],
  inflection: [],
  pitch: null,
  tokenCount: 1,
};

test('buildMinePayload word mode uses dictForm, reading, surface and deduped meaning', () => {
  const payload = buildMinePayload({
    mode: 'word',
    text: '学生です',
    lookupResult: LOOKUP,
    translation: 'I am a student',
    title: 'Show - Netflix',
    pictureBase64: 'abc',
  });
  assert.deepEqual(payload, {
    mode: 'word',
    sentence: '学生です',
    word: { base: '学生', reading: 'がくせい', surface: '学生' },
    meaning: 'student; pupil; learner',
    translation: 'I am a student',
    sourceTitle: 'Show',
    pictureBase64: 'abc',
    pictureExt: 'jpg',
  });
});

test('buildMinePayload falls back to span text when dictForm is missing', () => {
  const payload = buildMinePayload({
    mode: 'word',
    text: '走った',
    lookupResult: { ...LOOKUP, dictForm: null, span: { start: 0, end: 2, text: '走っ' } },
  });
  assert.equal(payload.word.base, '走っ');
});

test('buildMinePayload caps meaning at six glosses', () => {
  const many = {
    ...LOOKUP,
    entries: [{ ...LOOKUP.entries[0], senses: [{ pos: ['n'], glosses: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] }] }],
  };
  const payload = buildMinePayload({ mode: 'word', text: 'x', lookupResult: many });
  assert.equal(payload.meaning, 'a; b; c; d; e; f');
});

test('buildMinePayload sentence mode has no word and no meaning', () => {
  const payload = buildMinePayload({ mode: 'sentence', text: '学生です', lookupResult: LOOKUP });
  assert.equal('word' in payload, false);
  assert.equal('meaning' in payload, false);
  assert.equal(payload.sentence, '学生です');
});

test('buildMinePayload with a null span and no entries yields empty word fields', () => {
  const payload = buildMinePayload({
    mode: 'word',
    text: '？',
    lookupResult: { span: null, entries: [], dictForm: null },
  });
  assert.deepEqual(payload.word, { base: '', reading: '', surface: '' });
  assert.equal('meaning' in payload, false);
});

test('buildMinePayload omits optional fields when absent', () => {
  const payload = buildMinePayload({ mode: 'sentence', text: '学生です' });
  assert.deepEqual(payload, { mode: 'sentence', sentence: '学生です' });
});

test('buildMinePayload includes captionEndedAt only when it is a finite positive number', () => {
  const base = { mode: 'sentence', text: '猫' };
  assert.equal(buildMinePayload({ ...base, captionEndedAt: 1700000000000 }).captionEndedAt, 1700000000000);
  for (const captionEndedAt of [0, -1, NaN, null, undefined]) {
    assert.equal('captionEndedAt' in buildMinePayload({ ...base, captionEndedAt }), false);
  }
});

test('buildMinePayload includes captionShownAt only when it is a finite positive number', () => {
  const base = { mode: 'sentence', text: '学生です' };
  assert.equal(buildMinePayload({ ...base, captionShownAt: 1700000000000 }).captionShownAt, 1700000000000);
  for (const captionShownAt of [0, -1, NaN, Infinity, '1700000000000', null, undefined]) {
    assert.equal('captionShownAt' in buildMinePayload({ ...base, captionShownAt }), false, String(captionShownAt));
  }
});

test('originPatterns dedupes and sorts match patterns per origin', () => {
  assert.deepEqual(
    originPatterns(['https://b.com/x', 'https://a.com/', 'https://b.com/y?q=1', 'https://a.com/z']),
    ['https://a.com/*', 'https://b.com/*'],
  );
});

test('originPatterns keeps scheme separate and sorts http before https', () => {
  assert.deepEqual(originPatterns(['https://a.com/', 'http://a.com/']), ['http://a.com/*', 'https://a.com/*']);
});

test('originPatterns strips ports', () => {
  assert.deepEqual(originPatterns(['http://localhost:8767/api']), ['http://localhost/*']);
});

test('originPatterns lowercases the host', () => {
  assert.deepEqual(originPatterns(['https://WWW.Example.COM/Path']), ['https://www.example.com/*']);
});

test('originPatterns ignores non-http(s) urls', () => {
  assert.deepEqual(
    originPatterns([
      'about:blank',
      'file:///C:/x.html',
      'chrome-extension://abc/popup.html',
      'chrome://extensions',
      'moz-extension://abc/popup.html',
      'javascript:alert(1)',
      'data:text/html,hi',
    ]),
    [],
  );
});

test('originPatterns ignores junk and non-string entries', () => {
  assert.deepEqual(originPatterns(['', 'not a url', 'https://', null, undefined, 42, {}]), []);
  assert.deepEqual(originPatterns([]), []);
});
