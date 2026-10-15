const MINUTES_PER_DAY = 1440;
const MAX_STEP_MINUTES = MINUTES_PER_DAY * 365;
const MAX_STEPS = 10;
const STEP_UNITS = { s: 1 / 60, m: 1, h: 60, d: MINUTES_PER_DAY };

const int = (min, max) => ({ kind: 'int', min, max });
const enumOf = (...values) => ({ kind: 'enum', values });
const BOOL = { kind: 'bool' };
const STEPS = { kind: 'steps' };

export const FIELD_RULES = {
  newPerDay: int(0, 9999),
  reviewsPerDay: int(0, 9999),
  newMix: enumOf(0, 1, 2),
  interdayLearningMix: enumOf(0, 1, 2),
  newGatherOrder: enumOf(0, 1, 2, 3, 4, 5),
  newSortOrder: enumOf(0, 1, 2, 3, 4),
  reviewOrder: enumOf(...Array.from({ length: 12 }, (_, i) => i)),
  buryNew: BOOL,
  buryReviews: BOOL,
  buryLearning: BOOL,
  learnSteps: STEPS,
  relearnSteps: STEPS,
  graduatingInterval: int(1, 365),
  easyInterval: int(1, 365),
  startingEase: int(130, 999),
  maxInterval: int(1, 36500),
  easyBonus: int(100, 1000),
  intervalModifier: int(50, 200),
  hardInterval: int(100, 200),
  lapseNewInterval: int(0, 100),
  lapseMinInterval: int(1, 365),
  leechThreshold: int(1, 9999),
  leechAction: enumOf(0, 1),
  disableAutoplay: BOOL,
  skipQuestionWhenReplayingAnswer: BOOL,
  maxAnswerSecs: int(0, 3600),
  showTimer: BOOL,
  stopTimerOnAnswer: BOOL,
  desiredRetention: { kind: 'float', min: 0.7, max: 0.99 },
  fsrs: BOOL,
};

export const PRESET_NAME_MAX = 80;

export function parseSteps(text) {
  const tokens = String(text ?? '').split(/[\s,]+/).filter(Boolean);
  if (tokens.length > MAX_STEPS) return { error: `Use at most ${MAX_STEPS} steps.` };
  const minutes = [];
  for (const token of tokens) {
    const match = /^(\d+(?:\.\d+)?)([smhd]?)$/i.exec(token);
    if (!match) return { error: `"${token}" is not a step. Use numbers with s, m, h or d, like 1m 10m 1d.` };
    const value = Number(match[1]) * (STEP_UNITS[match[2].toLowerCase() || 'm']);
    const rounded = Math.round(value * 10000) / 10000;
    if (!(rounded > 0 && rounded <= MAX_STEP_MINUTES)) return { error: `"${token}" must be longer than 0 and at most 365 days.` };
    minutes.push(rounded);
  }
  return { value: minutes };
}

export function formatSteps(minutes) {
  return (minutes ?? []).map((m) => {
    if (m >= MINUTES_PER_DAY && m % MINUTES_PER_DAY === 0) return `${m / MINUTES_PER_DAY}d`;
    if (m >= 60 && m % 60 === 0) return `${m / 60}h`;
    if (m < 1 && Math.round(m * 60) === m * 60) return `${Math.round(m * 60)}s`;
    return `${m}m`;
  }).join(' ');
}

function normalizeNumber(raw, rule) {
  const text = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim();
  const pattern = rule.kind === 'int' ? /^-?\d+$/ : /^(\d+\.?\d*|\.\d+)$/;
  const value = pattern.test(text) ? Number(text) : NaN;
  const message = rule.kind === 'int'
    ? `Enter a whole number from ${rule.min} to ${rule.max}.`
    : `Enter a number from ${rule.min} to ${rule.max}.`;
  if (!Number.isFinite(value) || value < rule.min || value > rule.max) return { error: message };
  return { value: rule.kind === 'int' ? value : Math.round(value * 10000) / 10000 };
}

export function normalizeField(key, raw) {
  const rule = FIELD_RULES[key];
  if (!rule) return { error: 'Unknown option.' };
  if (rule.kind === 'bool') return { value: raw === true || raw === 'true' };
  if (rule.kind === 'steps') return parseSteps(raw);
  if (rule.kind === 'enum') {
    const value = Number(raw);
    return rule.values.includes(value) ? { value } : { error: 'Choose one of the listed options.' };
  }
  return normalizeNumber(raw, rule);
}

export function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function baselineValue(model, scope, key) {
  if (scope === 'today' && (key === 'newPerDay' || key === 'reviewsPerDay')) return model.today?.[key] ?? model.permanent[key];
  return model.permanent[key];
}

export function draftFromModel(model, scope = 'permanent') {
  const draft = {};
  for (const key of Object.keys(FIELD_RULES)) {
    const value = baselineValue(model, scope, key);
    const rule = FIELD_RULES[key];
    draft[key] = rule.kind === 'steps' ? formatSteps(value) : value;
  }
  return draft;
}

export function currentPreset(model) {
  return (model.presets ?? []).find((preset) => preset.id === model.presetId) ?? null;
}

export function willCloneOnSave(model, patch) {
  const preset = currentPreset(model);
  if (!preset || preset.useCount <= 1) return false;
  const keys = Object.keys(patch).filter((key) => key !== 'scope');
  const management = ['presetId', 'newPreset', 'renamePreset', 'removePreset'];
  return keys.length > 0 && !keys.some((key) => management.includes(key));
}

export function buildPatch({ model, draft, scope }) {
  const errors = {};
  const changes = {};
  const keys = scope === 'today' ? ['newPerDay', 'reviewsPerDay'] : Object.keys(FIELD_RULES);
  for (const key of keys) {
    const result = normalizeField(key, draft[key]);
    if (result.error) errors[key] = result.error;
    else if (!sameValue(result.value, baselineValue(model, scope, key))) changes[key] = result.value;
  }
  if (changes.desiredRetention !== undefined && !(changes.fsrs ?? model.permanent.fsrs)) {
    errors.desiredRetention = 'Turn on FSRS to change desired retention.';
  }
  if (Object.keys(errors).length || !Object.keys(changes).length) return { patch: null, errors };
  return { patch: { scope, ...changes }, errors };
}

export function clearTodayPatch() {
  return { scope: 'today', clearToday: true };
}

export function sharedPresetNotice(model) {
  const preset = currentPreset(model);
  if (!preset || preset.useCount <= 1) return '';
  return `Shared by ${preset.useCount} decks. Editing clones it as "Anime Mine: <deck>" so the other decks keep their settings.`;
}

export function fsrsConfirmMessage(enable) {
  return enable
    ? 'Turn FSRS on for the whole collection? This changes how every deck schedules reviews, not only this deck.'
    : 'Turn FSRS off for the whole collection? Every deck returns to Anki’s classic scheduler.';
}

export function removePresetConfirmMessage(preset) {
  const decks = preset.useCount === 1 ? '1 deck' : `${preset.useCount} decks`;
  return `Delete preset "${preset.name}"? ${decks} using it will move to the Default preset.`;
}

export function presetLabel(preset) {
  return `${preset.name} · ${preset.useCount} ${preset.useCount === 1 ? 'deck' : 'decks'}`;
}

export function validatePresetName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return 'Enter a preset name.';
  if ([...trimmed].length > PRESET_NAME_MAX) return `Keep the name to ${PRESET_NAME_MAX} characters.`;
  return null;
}
