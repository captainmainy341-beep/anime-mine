import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  levelGap,
  levelSentence,
  lessonsDisabledReason,
  reviewsDisabledReason,
  PACK_HINT,
  vacationBanner,
  scanSummary,
  scanProgressText,
  groupHue,
} from '../src/renderer/learn/homeModel.mjs';

test('levelGap never goes below zero', () => {
  assert.equal(levelGap({ needed: 38, kanjiPassed: 0 }), 38);
  assert.equal(levelGap({ needed: 38, kanjiPassed: 30 }), 8);
  assert.equal(levelGap({ needed: 38, kanjiPassed: 50 }), 0);
});

test('levelSentence names the next level and remaining kanji', () => {
  assert.equal(
    levelSentence({ current: 1, needed: 38, kanjiPassed: 0 }),
    '38 kanji must reach Guru to unlock level 2',
  );
  assert.equal(levelSentence({ current: 1, needed: 38, kanjiPassed: 40 }), 'Ready to unlock level 2');
});

test('disabled reasons explain empty buckets', () => {
  assert.equal(lessonsDisabledReason(0), 'Nothing to learn right now');
  assert.equal(lessonsDisabledReason(3), null);
  assert.match(PACK_HINT, /Download/);
  assert.equal(reviewsDisabledReason(0), 'No reviews due');
  assert.equal(reviewsDisabledReason(2), null);
});

test('vacation banner only when on', () => {
  assert.equal(vacationBanner(true), 'Vacation mode: reviews paused');
  assert.equal(vacationBanner(false), null);
});

test('scan summary and progress text', () => {
  assert.equal(scanSummary({ points: 1, sentences: 1 }), 'Found examples for 1 grammar point (1 sentence)');
  assert.equal(scanSummary({ points: 4, sentences: 12 }), 'Found examples for 4 grammar points (12 sentences)');
  assert.equal(scanProgressText({ done: 3, total: 12 }), 'Scanning 3/12 episodes…');
});

test('group hues are distinct per WK and BP group', () => {
  const wk = ['apprentice', 'guru', 'master', 'enlightened'].map(groupHue);
  assert.equal(new Set(wk).size, wk.length);
  const bp = ['beginner', 'adept', 'seasoned', 'expert', 'completed'].map(groupHue);
  assert.equal(new Set(bp).size, bp.length);
});
