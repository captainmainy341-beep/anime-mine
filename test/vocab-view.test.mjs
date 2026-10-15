import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_ORDER, STATUS_META, statusChips, difficultyBand, difficultyColor, sortWorks, filterWorks,
  formatPct, rowsToCsv, wordRowSummary, kanjiOnly, frequencyLabel, pitchLabelFromPattern,
  kanjiFacts, missingDownloads, splitAround, rubyParts,
} from '../src/renderer/lib/vocabView.mjs';

const works = [
  { id: 'a', title: 'Banana', difficulty: 40, words: 100, uniqueWords: 30, uniqueOncePct: 20, uniqueKanji: 10, avgSentenceLength: 12, knownPct: 50 },
  { id: 'b', title: 'apple', difficulty: 70, words: 50, uniqueWords: 60, uniqueOncePct: 5, uniqueKanji: 4, avgSentenceLength: 30, knownPct: undefined },
  { id: 'c', title: 'Cherry', difficulty: 10, words: 75, uniqueWords: 45, uniqueOncePct: 40, uniqueKanji: 22, avgSentenceLength: 8, knownPct: 90 },
];

test('STATUS_META covers all six states in order', () => {
  assert.deepEqual(STATUS_ORDER, ['new', 'learning', 'known', 'never-forget', 'suspended', 'blacklisted']);
  for (const status of STATUS_ORDER) {
    assert.ok(STATUS_META[status].label);
    assert.ok(STATUS_META[status].css.startsWith('status-'));
    assert.ok(STATUS_META[status].hint);
  }
});

test('statusChips lists stored states with counts, defaulting to zero', () => {
  const chips = statusChips({ known: 4, learning: 2 });
  assert.deepEqual(chips.map((c) => c.status), ['learning', 'known', 'never-forget', 'suspended', 'blacklisted']);
  assert.equal(chips.find((c) => c.status === 'known').count, 4);
  assert.equal(chips.find((c) => c.status === 'suspended').count, 0);
});

test('difficultyBand maps scores to bands and clamps', () => {
  assert.equal(difficultyBand(0), 'Beginner');
  assert.equal(difficultyBand(19.9), 'Beginner');
  assert.equal(difficultyBand(20), 'Easy');
  assert.equal(difficultyBand(59), 'Intermediate');
  assert.equal(difficultyBand(79.9), 'Advanced');
  assert.equal(difficultyBand(80), 'Expert');
  assert.equal(difficultyBand(100), 'Expert');
  assert.equal(difficultyBand(250), 'Expert');
  assert.equal(difficultyBand(-5), 'Beginner');
  assert.equal(difficultyBand(NaN), 'Unknown');
});

test('difficultyColor runs green to red and tolerates bad input', () => {
  assert.equal(difficultyColor(0), 'hsl(120 65% 62%)');
  assert.equal(difficultyColor(100), 'hsl(0 65% 62%)');
  assert.equal(difficultyColor(undefined), difficultyColor(0));
});

test('sortWorks sorts numerically and by title, both directions, without mutating input', () => {
  const before = works.map((w) => w.id);
  assert.deepEqual(sortWorks(works, 'difficulty', 'desc').map((w) => w.id), ['b', 'a', 'c']);
  assert.deepEqual(sortWorks(works, 'difficulty', 'asc').map((w) => w.id), ['c', 'a', 'b']);
  assert.deepEqual(sortWorks(works, 'title', 'asc').map((w) => w.id), ['b', 'a', 'c']);
  assert.deepEqual(sortWorks(works, 'uniqueKanji', 'desc').map((w) => w.id), ['c', 'a', 'b']);
  assert.deepEqual(works.map((w) => w.id), before);
});

test('sortWorks puts unloaded coverage last in both directions', () => {
  assert.equal(sortWorks(works, 'knownPct', 'desc').at(-1).id, 'b');
  assert.equal(sortWorks(works, 'knownPct', 'asc').at(-1).id, 'b');
});

test('sortWorks rejects unknown keys', () => {
  assert.throws(() => sortWorks(works, 'nope', 'asc'), /unknown sort key/);
});

test('filterWorks matches titles case-insensitively and ignores blank queries', () => {
  assert.deepEqual(filterWorks(works, '  ').map((w) => w.id), ['a', 'b', 'c']);
  assert.deepEqual(filterWorks(works, 'APP').map((w) => w.id), ['b']);
  assert.deepEqual(filterWorks(works, 'zzz'), []);
});

test('formatPct rounds to one decimal and shows a dash for missing values', () => {
  assert.equal(formatPct(12.345), '12.3%');
  assert.equal(formatPct(100), '100%');
  assert.equal(formatPct(null), '—');
  assert.equal(formatPct(NaN), '—');
});

test('rowsToCsv escapes commas, quotes and newlines', () => {
  const csv = rowsToCsv(
    [{ word: '食べる', reading: 'たべる', count: 3 }, { word: 'a,"b"', reading: null, count: 1 }],
    ['word', 'reading', 'count'],
  );
  assert.equal(csv, 'word,reading,count\n食べる,たべる,3\n"a,""b""",,1');
  assert.equal(rowsToCsv([{ word: 'x\ny' }], ['word']), 'word\n"x\ny"');
});

test('wordRowSummary joins word, reading, count and state label', () => {
  assert.equal(
    wordRowSummary({ word: '食べる', reading: 'たべる', count: 3, status: 'learning' }),
    '食べる (たべる) · ×3 · Learning',
  );
  assert.equal(wordRowSummary({ word: 'ね', reading: null, count: 0, status: 'new' }), 'ね · New');
});

test('kanjiOnly keeps unique kanji in first-appearance order', () => {
  assert.deepEqual(kanjiOnly('食べ物を食べる、日本語'), ['食', '物', '日', '本', '語']);
  assert.deepEqual(kanjiOnly('ひらがなonly'), []);
  assert.deepEqual(kanjiOnly(''), []);
});

test('frequencyLabel prefers the bucket, then the rank', () => {
  assert.equal(frequencyLabel({ rank: 412, bucket: 'Top 1000' }), 'Top 1000');
  assert.equal(frequencyLabel({ rank: 12345, bucket: null }), 'Rank 12,345');
  assert.equal(frequencyLabel({ rank: null, bucket: null }), null);
  assert.equal(frequencyLabel(null), null);
});

test('pitchLabelFromPattern reads drop position from high/low morae', () => {
  const p = (...highs) => highs.map((high) => ({ mora: 'x', high }));
  assert.equal(pitchLabelFromPattern(p(true, false, false)), 'atamadaka');
  assert.equal(pitchLabelFromPattern(p(false, true, false)), 'nakadaka');
  assert.equal(pitchLabelFromPattern(p(false, true, true)), 'heiban / odaka');
  assert.equal(pitchLabelFromPattern([]), null);
});

test('kanjiFacts lists only known fields in a stable order', () => {
  const facts = kanjiFacts({
    grade: 1, jlpt: 5, strokes: 4, heisig: 12, radical: { number: 9, name: 'person' }, frequency: { rank: 300, bucket: 'Top 1000' }, kanken: null,
  });
  assert.deepEqual(facts.map((f) => f.label), ['Grade', 'JLPT', 'Strokes', 'Heisig', 'Radical', 'Frequency']);
  assert.equal(facts[1].value, 'N5');
  assert.deepEqual(kanjiFacts({ radical: { number: null } }), []);
});

test('missingDownloads reports absent KANJIDIC and example data', () => {
  assert.deepEqual(missingDownloads({ kanjidic: true, examples: false }), ['examples']);
  assert.deepEqual(missingDownloads({ kanjidic: false, examples: false }), ['kanjidic', 'examples']);
  assert.deepEqual(missingDownloads({ kanjidic: true, examples: true }), []);
});

test('splitAround highlights every occurrence of the needle', () => {
  assert.deepEqual(splitAround('猫が猫を見る', '猫'), [
    { text: '猫', hit: true },
    { text: 'が', hit: false },
    { text: '猫', hit: true },
    { text: 'を見る', hit: false },
  ]);
  assert.deepEqual(splitAround('abc', ''), [{ text: 'abc', hit: false }]);
  assert.deepEqual(splitAround('abc', 'z'), [{ text: 'abc', hit: false }]);
});

test('rubyParts keeps shared kana bare and reads the kanji stem', () => {
  assert.deepEqual(rubyParts('食べる', 'たべる'), [
    { text: '食', rt: 'た' },
    { text: 'べる', rt: null },
  ]);
  assert.deepEqual(rubyParts('日本', 'にほん'), [{ text: '日本', rt: 'にほん' }]);
  assert.deepEqual(rubyParts('ひらがな', 'ひらがな'), [{ text: 'ひらがな', rt: null }]);
  assert.deepEqual(rubyParts('食べる', null), [{ text: '食べる', rt: null }]);
});
