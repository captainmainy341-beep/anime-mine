import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  forecastBars,
  formatHistory,
  formatRetention,
  formatStreak,
  highlightParts,
  modeSummary,
  stateBadge,
} from '../src/renderer/lib/ankiView.mjs';

test('forecastBars returns an empty list for no forecast', () => {
  assert.deepEqual(forecastBars([]), []);
  assert.deepEqual(forecastBars(undefined), []);
});

test('forecastBars gives zero height and count for an all-zero forecast', () => {
  const bars = forecastBars([
    { day: 0, count: 0 },
    { day: 1, count: 0 },
  ]);
  assert.deepEqual(bars.map((b) => [b.count, b.height]), [
    [0, 0],
    [0, 0],
  ]);
});

test('forecastBars normalises heights to the busiest day', () => {
  const bars = forecastBars([
    { day: 0, count: 10 },
    { day: 1, count: 5 },
    { day: 7, count: 20 },
  ]);
  assert.deepEqual(bars.map((b) => b.height), [50, 25, 100]);
  assert.deepEqual(bars.map((b) => b.day), [0, 1, 7]);
  assert.deepEqual(bars.map((b) => b.count), [10, 5, 20]);
});

test('forecastBars gives any non-zero day at least height 4 and zero days no height', () => {
  const bars = forecastBars([
    { day: 0, count: 1 },
    { day: 1, count: 0 },
    { day: 2, count: 1000 },
  ]);
  assert.deepEqual(bars.map((b) => b.height), [4, 0, 100]);
});

test('forecastBars labels only today and every seventh day', () => {
  const forecast = Array.from({ length: 22 }, (_, day) => ({ day, count: 1 }));
  const labels = forecastBars(forecast).map((b) => b.label);
  assert.equal(labels[0], 'Today');
  assert.equal(labels[7], '+7d');
  assert.equal(labels[14], '+14d');
  assert.equal(labels[21], '+21d');
  assert.equal(labels[3], '');
  assert.equal(labels.filter(Boolean).length, 4);
});

test('stateBadge maps each state to a label and tone', () => {
  assert.deepEqual(stateBadge({ state: 'new', due: false }), { label: 'new', tone: 'blue' });
  assert.deepEqual(stateBadge({ state: 'learn', due: false }), { label: 'learn', tone: 'warn' });
  assert.deepEqual(stateBadge({ state: 'review', due: true }), { label: 'due', tone: 'accent' });
  assert.deepEqual(stateBadge({ state: 'review', due: false }), { label: 'review', tone: 'muted' });
  assert.deepEqual(stateBadge({ state: 'suspended', due: false }), { label: 'suspended', tone: 'muted' });
});

test('stateBadge lets suspended and new win over the due flag', () => {
  assert.deepEqual(stateBadge({ state: 'suspended', due: true }), { label: 'suspended', tone: 'muted' });
  assert.deepEqual(stateBadge({ state: 'new', due: true }), { label: 'new', tone: 'blue' });
});

test('formatRetention formats a percentage and falls back for null', () => {
  assert.equal(formatRetention(91), '91%');
  assert.equal(formatRetention(91.6), '92%');
  assert.equal(formatRetention(0), '0%');
  assert.equal(formatRetention(null), '—');
  assert.equal(formatRetention(undefined), '—');
  assert.equal(formatRetention(Number.NaN), '—');
});

test('formatStreak uses singular and plural day and falls back for null', () => {
  assert.equal(formatStreak(12), '12 days');
  assert.equal(formatStreak(1), '1 day');
  assert.equal(formatStreak(0), '0 days');
  assert.equal(formatStreak(null), '—');
  assert.equal(formatStreak(undefined), '—');
});

test('formatHistory describes interval, ease, reviews and lapses', () => {
  assert.equal(
    formatHistory({ interval: 21, ease: 2500, reps: 4, lapses: 0 }),
    'Interval 21d · Ease 250% · 4 reviews · 0 lapses',
  );
  assert.equal(
    formatHistory({ interval: 1, ease: 2.5, reps: 1, lapses: 1 }),
    'Interval 1d · Ease 250% · 1 review · 1 lapse',
  );
});

test('formatHistory shows dashes for a new card', () => {
  assert.equal(
    formatHistory({ interval: 0, ease: 0, reps: 0, lapses: 0 }),
    'Interval — · Ease — · 0 reviews · 0 lapses',
  );
});

test('highlightParts splits around the word in the middle', () => {
  assert.deepEqual(highlightParts('ご飯を食べる前に', '食べる'), [
    { text: 'ご飯を', hit: false },
    { text: '食べる', hit: true },
    { text: '前に', hit: false },
  ]);
});

test('highlightParts omits empty side segments when the word is at the start or end', () => {
  assert.deepEqual(highlightParts('食べる前', '食べる'), [
    { text: '食べる', hit: true },
    { text: '前', hit: false },
  ]);
  assert.deepEqual(highlightParts('ご飯を食べる', '食べる'), [
    { text: 'ご飯を', hit: false },
    { text: '食べる', hit: true },
  ]);
});

test('highlightParts returns one hit when the word is the whole sentence', () => {
  assert.deepEqual(highlightParts('食べる', '食べる'), [{ text: '食べる', hit: true }]);
});

test('highlightParts only highlights the first occurrence', () => {
  assert.deepEqual(highlightParts('食べて食べる', '食べ'), [
    { text: '食べ', hit: true },
    { text: 'て食べる', hit: false },
  ]);
});

test('highlightParts returns the sentence unhighlighted when the word is absent or empty', () => {
  assert.deepEqual(highlightParts('猫が好き', '犬'), [{ text: '猫が好き', hit: false }]);
  assert.deepEqual(highlightParts('猫が好き', ''), [{ text: '猫が好き', hit: false }]);
  assert.deepEqual(highlightParts('猫が好き', null), [{ text: '猫が好き', hit: false }]);
});

test('highlightParts returns no parts for an empty or missing sentence', () => {
  assert.deepEqual(highlightParts('', '食べる'), []);
  assert.deepEqual(highlightParts(null, '食べる'), []);
});

test('modeSummary treats missing or hidden views as hidden', () => {
  assert.equal(modeSummary(null), 'hidden');
  assert.equal(modeSummary(undefined), 'hidden');
  assert.equal(modeSummary({ mode: 'hidden', connected: true, visibleDecks: ['A'] }), 'hidden');
  assert.equal(modeSummary({ mode: 'unknown' }), 'hidden');
});

test('modeSummary returns sample for sample mode whatever the connection', () => {
  assert.equal(modeSummary({ mode: 'sample', connected: false, visibleDecks: [] }), 'sample');
  assert.equal(modeSummary({ mode: 'sample', connected: true, visibleDecks: ['A'] }), 'sample');
});

test('modeSummary returns connect for live mode when Anki is unreachable', () => {
  assert.equal(modeSummary({ mode: 'live', connected: false, visibleDecks: ['A'] }), 'connect');
  assert.equal(modeSummary({ mode: 'live', connected: false, visibleDecks: [] }), 'connect');
});

test('modeSummary returns pick for live mode with no visible decks', () => {
  assert.equal(modeSummary({ mode: 'live', connected: true, visibleDecks: [] }), 'pick');
  assert.equal(modeSummary({ mode: 'live', connected: true }), 'pick');
});

test('modeSummary returns ready for live, connected, with visible decks', () => {
  assert.equal(modeSummary({ mode: 'live', connected: true, visibleDecks: ['Core'] }), 'ready');
});
