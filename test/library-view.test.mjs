import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coverageLabel,
  createLimiter,
  formatBytes,
  formatNumber,
  importSummary,
  knownStatsLabel,
  progressFraction,
} from '../src/renderer/lib/libraryView.mjs';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

test('formatBytes uses MB below a gigabyte and GB from there', () => {
  assert.equal(formatBytes(0), '0.0 MB');
  assert.equal(formatBytes(5 * MB), '5.0 MB');
  assert.equal(formatBytes(GB - 1), '1024.0 MB');
  assert.equal(formatBytes(1.5 * GB), '1.50 GB');
});

test('formatBytes treats invalid sizes as zero', () => {
  assert.equal(formatBytes(-10), '0.0 MB');
  assert.equal(formatBytes(NaN), '0.0 MB');
  assert.equal(formatBytes(undefined), '0.0 MB');
});

test('formatNumber groups thousands', () => {
  assert.equal(formatNumber(0), '0');
  assert.equal(formatNumber(37), '37');
  assert.equal(formatNumber(1482), '1,482');
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatNumber(-1234), '-1,234');
  assert.equal(formatNumber(NaN), '0');
});

test('progressFraction is position over duration, clamped to 0..1', () => {
  assert.equal(progressFraction(30, 120), 0.25);
  assert.equal(progressFraction(150, 120), 1);
  assert.equal(progressFraction(-5, 120), 0);
  assert.equal(progressFraction(10, 0), 0);
  assert.equal(progressFraction(10, undefined), 0);
  assert.equal(progressFraction(NaN, 120), 0);
});

test('coverageLabel formats known percentage and unique new words', () => {
  const coverage = { totalWords: 200, knownWords: 150, learningWords: 20, newWords: 30, coverage: 0.85, uniqueNew: 37, topNew: [] };
  assert.equal(coverageLabel(coverage), '85% known · 37 new words');
});

test('coverageLabel uses the singular for one new word', () => {
  assert.equal(coverageLabel({ totalWords: 10, coverage: 0.9, uniqueNew: 1 }), '90% known · 1 new word');
});

test('coverageLabel is null when there is no coverage or no words', () => {
  assert.equal(coverageLabel(null), null);
  assert.equal(coverageLabel(undefined), null);
  assert.equal(coverageLabel({ totalWords: 0, coverage: 0, uniqueNew: 0 }), null);
});

test('knownStatsLabel formats both counts', () => {
  assert.equal(knownStatsLabel({ known: 1482, learning: 37 }), '1,482 known · 37 learning');
  assert.equal(knownStatsLabel({}), '0 known · 0 learning');
});

test('importSummary reports added and skipped words', () => {
  assert.equal(importSummary({ added: 12, skipped: 3 }), 'Imported 12 words (3 skipped)');
  assert.equal(importSummary({ added: 0, skipped: 0 }), 'Imported 0 words (0 skipped)');
});

test('createLimiter never runs more tasks than its concurrency', async () => {
  const limit = createLimiter(2);
  let active = 0;
  let peak = 0;
  const task = async (value) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return value;
  };
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limit(() => task(n))));
  assert.deepEqual(results, [1, 2, 3, 4, 5]);
  assert.equal(peak, 2);
});

test('createLimiter starts tasks asynchronously and propagates rejections', async () => {
  const limit = createLimiter(1);
  let started = false;
  const pending = limit(() => {
    started = true;
    return 'ok';
  });
  assert.equal(started, false);
  assert.equal(await pending, 'ok');
  await assert.rejects(limit(() => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(await limit(() => 'after'), 'after');
});
