import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  FIELD_RULES,
  buildPatch,
  draftFromModel,
  formatSteps,
  normalizeField,
  parseSteps,
  validatePresetName,
  willCloneOnSave,
} from '../src/renderer/lib/ankiOptionsModel.mjs';

const require = createRequire(import.meta.url);
const { validatePatch } = require('../src/core/ankiDeckOptions.js');

const model = {
  permanent: {
    newPerDay: 20, reviewsPerDay: 200, newMix: 1, buryNew: true, buryReviews: true, buryLearning: true,
    learnSteps: [1, 10], relearnSteps: [10], graduatingInterval: 1, easyInterval: 4, startingEase: 250,
    newGatherOrder: 0, newSortOrder: 0, reviewOrder: 0, interdayLearningMix: 0, maxInterval: 36500,
    easyBonus: 130, intervalModifier: 100, hardInterval: 120, lapseNewInterval: 0, lapseMinInterval: 1,
    leechThreshold: 8, leechAction: 0, disableAutoplay: false, skipQuestionWhenReplayingAnswer: false,
    maxAnswerSecs: 60, showTimer: false, stopTimerOnAnswer: false, desiredRetention: 0.9, fsrs: false,
  },
  today: { newPerDay: null, reviewsPerDay: null },
  presetId: 2,
  presets: [{ id: 1, name: 'Default', useCount: 3 }, { id: 2, name: 'Shared', useCount: 2 }],
};

test('steps parse Anki format into minutes and reject garbage without NaN', () => {
  assert.deepEqual(parseSteps('1m 10m 1d').value, [1, 10, 1440]);
  assert.deepEqual(parseSteps('30s, 1h 1.5m').value, [0.5, 60, 1.5]);
  assert.deepEqual(parseSteps('').value, []);
  assert.deepEqual(parseSteps('5').value, [5]);
  for (const text of ['abc', '1x', '0m', '-1m', 'NaN', '1m 2m 3m 4m 5m 6m 7m 8m 9m 10m 11m', '366d']) {
    const result = parseSteps(text);
    assert.equal(result.value, undefined, text);
    assert.match(result.error, /./, text);
  }
});

test('formatted steps parse back to the same minutes', () => {
  const minutes = [0.5, 1, 1.5, 60, 1440, 525600];
  assert.equal(formatSteps(minutes), '30s 1m 1.5m 1h 1d 365d');
  assert.deepEqual(parseSteps(formatSteps(minutes)).value, minutes);
});

test('field normalization rejects non-numeric and out-of-range values', () => {
  assert.equal(normalizeField('newPerDay', '20').value, 20);
  for (const raw of ['', '2.5', 'abc', '-1', '10000', 'NaN', 'Infinity']) assert.ok(normalizeField('newPerDay', raw).error, raw);
  assert.ok(normalizeField('newMix', 3).error);
  assert.equal(normalizeField('desiredRetention', '0.85').value, 0.85);
  assert.ok(normalizeField('desiredRetention', '0.69').error);
});

test('draft values are the baseline so only changed keys are sent', () => {
  const draft = draftFromModel(model);
  assert.equal(buildPatch({ model, draft, scope: 'permanent' }).patch, null);
  draft.newPerDay = '25';
  draft.learnSteps = '1m 15m';
  assert.deepEqual(buildPatch({ model, draft, scope: 'permanent' }).patch, { scope: 'permanent', newPerDay: 25, learnSteps: [1, 15] });
});

test('invalid draft fields produce per-field errors and no patch', () => {
  const draft = draftFromModel(model);
  draft.learnSteps = 'soon';
  draft.reviewsPerDay = '';
  const { patch, errors } = buildPatch({ model, draft, scope: 'permanent' });
  assert.equal(patch, null);
  assert.ok(errors.learnSteps);
  assert.ok(errors.reviewsPerDay);
});

test('desired retention only goes out with FSRS on', () => {
  const draft = draftFromModel(model);
  draft.desiredRetention = '0.85';
  assert.ok(buildPatch({ model, draft, scope: 'permanent' }).errors.desiredRetention);
  draft.fsrs = true;
  assert.deepEqual(buildPatch({ model, draft, scope: 'permanent' }).patch, { scope: 'permanent', desiredRetention: 0.85, fsrs: true });
});

test('today scope only diffs daily limits against the today baseline', () => {
  const todayModel = { ...model, today: { newPerDay: 30, reviewsPerDay: null } };
  const draft = draftFromModel(todayModel, 'today');
  assert.equal(draft.newPerDay, 30);
  assert.equal(buildPatch({ model: todayModel, draft, scope: 'today' }).patch, null);
  draft.reviewsPerDay = '250';
  assert.deepEqual(buildPatch({ model: todayModel, draft, scope: 'today' }).patch, { scope: 'today', reviewsPerDay: 250 });
});

test('edits to a shared preset clone it unless preset management keys are used', () => {
  assert.equal(willCloneOnSave(model, { scope: 'permanent', newMix: 2 }), true);
  assert.equal(willCloneOnSave(model, { scope: 'permanent', presetId: 1, newMix: 2 }), false);
  assert.equal(willCloneOnSave({ ...model, presetId: 3, presets: [{ id: 3, name: 'Solo', useCount: 1 }] }, { scope: 'permanent', newMix: 2 }), false);
});

test('preset names are required and capped', () => {
  assert.ok(validatePresetName('   '));
  assert.ok(validatePresetName('x'.repeat(81)));
  assert.equal(validatePresetName('Kanji'), null);
});

test('renderer limits match the core validator at each boundary', () => {
  for (const [key, rule] of Object.entries(FIELD_RULES)) {
    if (rule.kind !== 'int' && rule.kind !== 'float') continue;
    const probes = rule.kind === 'int' ? [rule.min, rule.max, rule.min - 1, rule.max + 1] : [rule.min, rule.max, rule.min - 0.01, rule.max + 0.01];
    for (const value of probes) {
      const inRange = value >= rule.min && value <= rule.max;
      const core = (() => { try { validatePatch({ scope: 'permanent', [key]: value }); return true; } catch { return false; } })();
      const renderer = !normalizeField(key, String(value)).error;
      assert.equal(renderer, inRange, `${key}=${value} renderer`);
      assert.equal(core, inRange, `${key}=${value} core`);
    }
  }
});
