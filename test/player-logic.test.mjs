import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioLabel,
  createGeneration,
  cueEndReached,
  formatOffset,
  isTypingTarget,
  loopSeekTarget,
  nextOffset,
  resumeTarget,
  shouldAutoPause,
  subtitleLabel,
  videoTimeForCue,
} from '../src/renderer/lib/playerLogic.mjs';

test('nextOffset steps in 0.1 s without float drift', () => {
  assert.equal(nextOffset(0, 0.1), 0.1);
  assert.equal(nextOffset(0.2, 0.1), 0.3);
  assert.equal(nextOffset(0.1, -0.1), 0);
  assert.equal(nextOffset(undefined, 0.1), 0.1);
});

test('formatOffset shows a signed chip label', () => {
  assert.equal(formatOffset(0.3), 'sub +0.3s');
  assert.equal(formatOffset(-0.1), 'sub -0.1s');
  assert.equal(formatOffset(0), 'sub 0.0s');
});

test('videoTimeForCue applies the subtitle offset', () => {
  assert.equal(videoTimeForCue({ start: 10, end: 12 }, 0.5), 10.5);
});

test('resumeTarget resumes only past 5 s and when not finished', () => {
  assert.equal(resumeTarget({ position: 120, finished: false }, 1400), 120);
  assert.equal(resumeTarget({ position: 5, finished: false }, 1400), null);
  assert.equal(resumeTarget({ position: 300, finished: true }, 1400), null);
  assert.equal(resumeTarget({ position: 1500, finished: false }, 1400), null);
  assert.equal(resumeTarget(null, 1400), null);
});

test('audioLabel combines language, codec, channels and title', () => {
  assert.equal(
    audioLabel({ lang: 'ja', codec: 'aac', channels: 2, title: 'Stereo' }),
    'ja · aac · 2ch · Stereo',
  );
  assert.equal(audioLabel({ lang: null, codec: '', channels: null, title: null }), 'und · unknown');
});

test('subtitleLabel marks bitmap streams as unsupported', () => {
  assert.equal(subtitleLabel({ lang: 'en', codec: 'subrip', title: null, textBased: true }), 'en · subrip');
  assert.equal(
    subtitleLabel({ lang: 'ja', codec: 'hdmv_pgs_subtitle', title: null, textBased: false }),
    'ja · hdmv_pgs_subtitle · (image, unsupported)',
  );
});

test('cueEndReached compares against the offset-shifted cue end', () => {
  const cue = { start: 10, end: 12 };
  assert.equal(cueEndReached(12, cue, 0), true);
  assert.equal(cueEndReached(11.9, cue, 0), false);
  assert.equal(cueEndReached(12.4, cue, 0.5), false);
  assert.equal(cueEndReached(12.5, cue, 0.5), true);
  assert.equal(cueEndReached(12, null, 0), false);
});

test('shouldAutoPause requires the setting and a reached cue end', () => {
  const cue = { start: 10, end: 12 };
  assert.equal(shouldAutoPause({ autoPause: true, cue, time: 12, subOffset: 0 }), true);
  assert.equal(shouldAutoPause({ autoPause: false, cue, time: 12, subOffset: 0 }), false);
  assert.equal(shouldAutoPause({ autoPause: true, cue, time: 11, subOffset: 0 }), false);
});

test('isTypingTarget flags text-entry elements so hotkeys stay out of them', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'VIDEO', isContentEditable: false }), false);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget(null), false);
});

test('createGeneration keeps only the most recently begun token current', () => {
  const generation = createGeneration();
  const first = generation.begin();
  assert.equal(generation.isCurrent(first), true);
  const second = generation.begin();
  assert.equal(generation.isCurrent(first), false);
  assert.equal(generation.isCurrent(second), true);
});

test('loopSeekTarget returns the shifted cue start only when looping and past the end', () => {
  const cue = { start: 10, end: 12 };
  assert.equal(loopSeekTarget({ loopLine: true, cue, time: 12.5, subOffset: 0.5 }), 10.5);
  assert.equal(loopSeekTarget({ loopLine: false, cue, time: 12, subOffset: 0 }), null);
  assert.equal(loopSeekTarget({ loopLine: true, cue, time: 11, subOffset: 0 }), null);
});
