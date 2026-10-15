const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  validatePoint,
  parseCloze,
  loadGrammar,
  detectGrammar,
  buildAnimeCloze,
  scanLibrary,
} = require('../src/core/grammar');

const SAMPLE = path.join(__dirname, 'fixtures', 'study', 'grammar-sample.json');

function validPoint(overrides = {}) {
  return {
    id: 'g:n5-test',
    jlpt: 'N5',
    title: '〜てtest',
    meaning: 'test meaning',
    structure: 'Verb て-form + test',
    formality: 'neutral',
    notes: 'Plain notes.',
    similar: [],
    detect: ['て(test)'],
    examples: [
      { ja: '{{撮って}}ください。', en: 'Please take.', hint: '撮る + て' },
      { ja: '{{帰って}}いい？', en: 'Can I go home?', hint: '帰る + て' },
    ],
    ...overrides,
  };
}

function tempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grammar-test-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

async function sampleDir() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'grammar-sample-'));
  await fsp.copyFile(SAMPLE, path.join(dir, 'grammar-sample.json'));
  return dir;
}

test('sample fixture points are all valid', () => {
  const points = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
  assert.equal(points.length, 3);
  for (const point of points) assert.deepEqual(validatePoint(point), []);
});

test('validatePoint accepts a well-formed point', () => {
  assert.deepEqual(validatePoint(validPoint()), []);
});

test('validatePoint reports bad scalar fields', () => {
  assert.match(validatePoint(validPoint({ id: 'k:bad' })).join('\n'), /id must match/);
  assert.match(validatePoint(validPoint({ id: 'g:Upper' })).join('\n'), /id must match/);
  assert.match(validatePoint(validPoint({ jlpt: 'N6' })).join('\n'), /jlpt must be one of/);
  assert.match(validatePoint(validPoint({ formality: 'rude' })).join('\n'), /formality must be one of/);
  assert.match(validatePoint(validPoint({ title: '' })).join('\n'), /title must be a non-empty string/);
  assert.match(validatePoint(validPoint({ notes: null })).join('\n'), /notes must be a string/);
  assert.match(validatePoint(validPoint({ similar: 'x' })).join('\n'), /similar must be an array of strings/);
  assert.deepEqual(validatePoint(null), ['point must be an object']);
});

test('validatePoint rejects invalid detect regexes and empty-matching ones', () => {
  assert.match(validatePoint(validPoint({ detect: ['(unclosed'] })).join('\n'), /not a valid regex/);
  assert.match(validatePoint(validPoint({ detect: ['\\p{Nope}'] })).join('\n'), /not a valid regex/);
  assert.match(validatePoint(validPoint({ detect: ['x*'] })).join('\n'), /matches the empty string/);
  assert.match(validatePoint(validPoint({ detect: [42] })).join('\n'), /detect must be an array of strings/);
  assert.deepEqual(validatePoint(validPoint({ detect: [] })), []);
});

test('validatePoint checks example count, markers, alternatives and fields', () => {
  const one = [validPoint().examples[0]];
  assert.match(validatePoint(validPoint({ examples: one })).join('\n'), /at least 2/);

  const noMarker = { ja: '撮ってください。', en: 'x', hint: 'y' };
  assert.match(validatePoint(validPoint({ examples: [noMarker, noMarker] })).join('\n'), /exactly one \{\{\.\.\.\}\} marker, found 0/);

  const twoMarkers = { ja: '{{撮って}}と{{帰って}}', en: 'x', hint: 'y' };
  assert.match(validatePoint(validPoint({ examples: [twoMarkers, twoMarkers] })).join('\n'), /found 2/);

  const emptyAlt = { ja: '{{撮って|}}', en: 'x', hint: 'y' };
  assert.match(validatePoint(validPoint({ examples: [emptyAlt, emptyAlt] })).join('\n'), /empty cloze alternative/);

  const noEn = { ja: '{{撮って}}', en: '', hint: 'y' };
  assert.match(validatePoint(validPoint({ examples: [noEn, noEn] })).join('\n'), /examples\[0\]\.en must be a non-empty string/);

  const noHint = { ja: '{{撮って}}', en: 'x' };
  assert.match(validatePoint(validPoint({ examples: [noHint, noHint] })).join('\n'), /examples\[1\]\.hint must be a string/);
});

test('parseCloze returns the surrounding text and a single answer', () => {
  assert.deepEqual(parseCloze('今日は{{帰ってもいい}}よ。'), {
    before: '今日は',
    after: 'よ。',
    answers: ['帰ってもいい'],
    text: '今日は帰ってもいいよ。',
  });
});

test('parseCloze keeps every alternative and uses the first as text', () => {
  assert.deepEqual(parseCloze('写真を{{撮ってもいい|撮ってもよい}}ですか。'), {
    before: '写真を',
    after: 'ですか。',
    answers: ['撮ってもいい', '撮ってもよい'],
    text: '写真を撮ってもいいですか。',
  });
});

test('parseCloze throws on zero or multiple markers', () => {
  assert.throws(() => parseCloze('marker missing'), /found 0/);
  assert.throws(() => parseCloze('{{a}} and {{b}}'), /found 2/);
});

test('loadGrammar loads the sample, indexes by id and title, and drops unresolved similar titles', async () => {
  const dir = await sampleDir();
  const { points, byId, byTitle } = loadGrammar(dir);
  assert.equal(points.length, 3);
  assert.equal(byId.get('g:n5-te-mo-ii').title, '〜てもいい');
  assert.equal(byTitle.get('〜たい').id, 'g:n5-tai');
  assert.deepEqual(byId.get('g:n5-te-mo-ii').similar, ['〜てはいけない']);
  assert.deepEqual(byId.get('g:n5-tai').similar, []);

  const dropped = tempDir({ 'a.json': [validPoint({ similar: ['〜存在しない', '〜てもいい'] })] });
  const loaded = loadGrammar(dropped);
  assert.deepEqual(loaded.points[0].similar, []);
});

test('loadGrammar reads files in name order and concatenates them', () => {
  const dir = tempDir({
    'b.json': [validPoint({ id: 'g:second', title: 'B' })],
    'a.json': [validPoint({ id: 'g:first', title: 'A' })],
    'notes.txt': 'ignored',
  });
  assert.deepEqual(loadGrammar(dir).points.map(p => p.id), ['g:first', 'g:second']);
});

test('loadGrammar throws listing ids and errors for invalid points', () => {
  const dir = tempDir({ 'bad.json': [validPoint({ id: 'g:broken', jlpt: 'N9' })] });
  assert.throws(() => loadGrammar(dir), (err) => {
    assert.match(err.message, /g:broken: jlpt must be one of/);
    return true;
  });
});

test('loadGrammar throws on duplicate ids across files', () => {
  const dir = tempDir({
    'a.json': [validPoint({ id: 'g:same', title: 'A' })],
    'b.json': [validPoint({ id: 'g:same', title: 'B' })],
  });
  assert.throws(() => loadGrammar(dir), /g:same: duplicate id/);
});

test('loadGrammar returns an empty result for an empty or missing directory', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'grammar-empty-'));
  for (const dir of [empty, path.join(empty, 'missing')]) {
    const result = loadGrammar(dir);
    assert.deepEqual(result.points, []);
    assert.equal(result.byId.size, 0);
    assert.equal(result.byTitle.size, 0);
  }
});

test('detectGrammar returns one match per point, sorted by start', () => {
  const points = [
    { id: 'g:late', detect: ['いい'] },
    { id: 'g:early', detect: ['ては', 'てもいい'] },
    { id: 'g:none', detect: ['存在しない'] },
  ];
  const found = detectGrammar('今日はてもいい、そしていい', points);
  assert.deepEqual(found, [
    { id: 'g:early', start: 3, end: 7, text: 'てもいい' },
    { id: 'g:late', start: 5, end: 7, text: 'いい' },
  ]);
  assert.deepEqual(detectGrammar('何もない', points), []);
});

test('detectGrammar uses the earliest match when several detect regexes apply', () => {
  const found = detectGrammar('ABCD', [{ id: 'g:x', detect: ['CD', 'B'] }]);
  assert.deepEqual(found, [{ id: 'g:x', start: 1, end: 2, text: 'B' }]);
});

test('buildAnimeCloze wraps the matched span and records the source', () => {
  const point = { id: 'g:n5-te-mo-ii', title: '〜てもいい' };
  const cue = { start: 12.5, end: 14, text: 'ここで写真を撮ってもいいよ' };
  const match = { id: point.id, start: 6, end: 12, text: '撮ってもいい' };

  assert.deepEqual(buildAnimeCloze(point, cue, match), {
    ja: 'ここで写真を{{撮ってもいい}}よ',
    en: null,
    hint: '〜てもいい',
    answers: ['撮ってもいい'],
    source: { start: 12.5, end: 14 },
  });
  assert.deepEqual(buildAnimeCloze(point, cue, match, { videoPath: '/v/ep1.mkv' }).source, {
    videoPath: '/v/ep1.mkv',
    start: 12.5,
    end: 14,
  });
});

function episode(name, subtitlePath = `${name}.ass`) {
  return { path: `/video/${name}.mkv`, name: `${name}.mkv`, season: 1, episode: 1, subtitlePath };
}

const POINTS = [{ id: 'g:te-iru', detect: ['ている'] }];

test('scanLibrary deduplicates identical text across the whole scan', async () => {
  const subs = {
    'a.ass': [{ start: 1, end: 2, text: '同じ文章を言っているよ' }],
    'b.ass': [{ start: 3, end: 4, text: '同じ文章を言っているよ' }],
  };
  const result = await scanLibrary({
    shows: [{ title: 'S', episodes: [episode('a'), episode('b')] }],
    points: POINTS,
    parseSubtitleFile: async file => subs[file],
  });
  assert.equal(result['g:te-iru'].length, 1);
  assert.equal(result['g:te-iru'][0].videoPath, '/video/a.mkv');
});

test('scanLibrary keeps only cues of 6 to 40 characters and reports match offsets', async () => {
  const subs = {
    'a.ass': [
      { start: 1, end: 2, text: 'ている' },
      { start: 2, end: 3, text: 'これは食べているよ' },
      { start: 3, end: 4, text: 'x'.repeat(30) + 'ている' + 'x'.repeat(8) },
    ],
  };
  const result = await scanLibrary({
    shows: [{ title: 'S', episodes: [episode('a')] }],
    points: POINTS,
    parseSubtitleFile: async file => subs[file],
  });
  assert.deepEqual(result['g:te-iru'], [
    { videoPath: '/video/a.mkv', start: 2, end: 3, text: 'これは食べているよ', matchStart: 5, matchEnd: 8 },
  ]);
});

test('scanLibrary stops at perPoint and spreads picks across episodes round-robin', async () => {
  const cues = (prefix) => [1, 2, 3, 4, 5].map(i => ({ start: i, end: i + 1, text: `${prefix}${i}ている文` }));
  const subs = { 'a.ass': cues('A'), 'b.ass': cues('B').slice(0, 2) };
  const result = await scanLibrary({
    shows: [{ title: 'S', episodes: [episode('a'), episode('b')] }],
    points: POINTS,
    parseSubtitleFile: async file => subs[file],
    perPoint: 3,
  });
  assert.deepEqual(result['g:te-iru'].map(item => item.text), ['A1ている文', 'B1ている文', 'A2ている文']);
});

test('scanLibrary skips episodes whose subtitles fail to parse and reports progress', async () => {
  const progress = [];
  const result = await scanLibrary({
    shows: [{ title: 'S', episodes: [episode('bad'), episode('good'), episode('none', null)] }],
    points: POINTS,
    parseSubtitleFile: async (file) => {
      if (file === 'bad.ass') throw new Error('unreadable');
      return [{ start: 1, end: 2, text: '食べている最中だよ' }];
    },
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal(result['g:te-iru'].length, 1);
  assert.equal(result['g:te-iru'][0].videoPath, '/video/good.mkv');
  assert.deepEqual(progress, [[1, 2], [2, 2]]);
});
