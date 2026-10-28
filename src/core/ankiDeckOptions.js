const BRIDGE_MESSAGE = 'Enable the Anime Mine bridge add-on in Anki, then restart Anki. Native deck options and studying require this bridge.';

const LIMITS = {
  newPerDay: [0, 9999], reviewsPerDay: [0, 9999], graduatingInterval: [1, 365], easyInterval: [1, 365],
  startingEase: [130, 999], maxInterval: [1, 36500], easyBonus: [100, 1000], intervalModifier: [50, 200],
  hardInterval: [100, 200], lapseNewInterval: [0, 100], lapseMinInterval: [1, 365], leechThreshold: [1, 9999],
  maxAnswerSecs: [0, 3600],
};
const ENUMS = {
  newMix: [0, 1, 2], interdayLearningMix: [0, 1, 2], newGatherOrder: [0, 1, 2, 3, 4, 5],
  newSortOrder: [0, 1, 2, 3, 4], reviewOrder: Array.from({ length: 12 }, (_, i) => i), leechAction: [0, 1],
};
const BOOLS = ['buryNew', 'buryReviews', 'buryLearning', 'disableAutoplay', 'skipQuestionWhenReplayingAnswer', 'showTimer', 'stopTimerOnAnswer', 'fsrs', 'applyToChildren'];
const STEP_KEYS = ['learnSteps', 'relearnSteps'];
const PRESET_KEYS = ['presetId', 'newPreset', 'renamePreset', 'removePreset'];
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nameOk = (value) => typeof value === 'string' && [...value.trim()].length > 0 && [...value.trim()].length <= 80;
const stepsOk = (value) => Array.isArray(value) && value.length <= 10 && value.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1440 * 365);

function validatePatch(patch) {
  if (!isPlainObject(patch)) throw new Error('Deck options must be an object');
  if (!['permanent', 'today'].includes(patch.scope)) throw new Error('Choose permanent or today-only limits');
  const allowed = patch.scope === 'today'
    ? ['scope', 'newPerDay', 'reviewsPerDay', 'clearToday']
    : ['scope', ...Object.keys(LIMITS), ...Object.keys(ENUMS), ...BOOLS, ...STEP_KEYS, 'desiredRetention', ...PRESET_KEYS];
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key)) throw new Error(`Unsupported deck option: ${key}`);
  }
  for (const key of ['clearToday', ...BOOLS]) {
    if (key in patch && typeof patch[key] !== 'boolean') throw new Error(`${key} must be true or false`);
  }
  for (const [key, [low, high]] of Object.entries(LIMITS)) {
    if (key in patch && (!Number.isInteger(patch[key]) || patch[key] < low || patch[key] > high)) throw new Error(['newPerDay', 'reviewsPerDay'].includes(key) ? 'Daily limits must be whole numbers from 0 to 9999' : `${key} must be a whole number from ${low} to ${high}`);
  }
  for (const [key, options] of Object.entries(ENUMS)) {
    if (key in patch && (!Number.isInteger(patch[key]) || !options.includes(patch[key]))) throw new Error(`Invalid value for ${key}`);
  }
  for (const key of STEP_KEYS) {
    if (key in patch && !stepsOk(patch[key])) throw new Error(`${key} must be up to 10 positive step lengths in minutes`);
  }
  if ('desiredRetention' in patch && (typeof patch.desiredRetention !== 'number' || !(patch.desiredRetention >= 0.7 && patch.desiredRetention <= 0.99))) throw new Error('desiredRetention must be from 0.7 to 0.99');
  if ('presetId' in patch && (!Number.isInteger(patch.presetId) || patch.presetId < 1)) throw new Error('presetId must be a preset id');
  if ('newPreset' in patch) {
    const created = patch.newPreset;
    if (!isPlainObject(created) || Object.keys(created).sort().join() !== 'cloneCurrent,name' || typeof created.cloneCurrent !== 'boolean' || !nameOk(created.name)) throw new Error('newPreset needs a name and cloneCurrent');
  }
  if ('renamePreset' in patch) {
    const rename = patch.renamePreset;
    if (!isPlainObject(rename) || Object.keys(rename).sort().join() !== 'id,name' || !Number.isInteger(rename.id) || !nameOk(rename.name)) throw new Error('renamePreset needs an id and name');
  }
  if ('removePreset' in patch && (!Number.isInteger(patch.removePreset) || patch.removePreset < 2)) throw new Error('removePreset must be a preset id other than the default');
  if ('presetId' in patch && 'newPreset' in patch) throw new Error('Choose one preset to assign');
  if (['renamePreset', 'removePreset'].some((key) => key in patch) && Object.keys(patch).filter((key) => key !== 'scope').length > 1) throw new Error('Rename or remove a preset on its own');
  if (patch.clearToday && ('newPerDay' in patch || 'reviewsPerDay' in patch)) throw new Error('Clear today or set limits, not both');
  return { ...patch };
}

class AnkiDeckOptions {
  constructor(client) { this.client = client; }
  async invoke(action, params) {
    try { return await this.client.invoke(action, params); }
    catch (err) {
      if (/unsupported action|unknown action|not found.*action/i.test(err.message)) throw new Error(BRIDGE_MESSAGE);
      throw err;
    }
  }
  get(deck, visibleDecks) { return this.invoke('animeMineDeckOptions', { deck, visibleDecks }); }
  async save({ deck, patch, revision, visibleDecks, authorize }) {
    const changes = validatePatch(patch);
    if (typeof revision !== 'string' || !revision) throw new Error('Reload deck options before saving');
    await authorize?.();
    return this.invoke('animeMineSetDeckOptions', { deck, patch: changes, expectedRevision: revision, visibleDecks });
  }
  queue(deck, visibleDecks) { return this.invoke('animeMineStudyQueue', { deck, visibleDecks }); }
  open(deck) { return this.invoke('animeMineOpenDeckOptions', { deck }); }
}

module.exports = { AnkiDeckOptions, validatePatch, BRIDGE_MESSAGE };
