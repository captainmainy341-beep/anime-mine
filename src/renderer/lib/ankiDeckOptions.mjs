import { h, fill } from './ui.mjs';
import { withIcon } from './doodleIcons.mjs';
import {
  FIELD_RULES,
  baselineValue,
  buildPatch,
  clearTodayPatch,
  draftFromModel,
  fsrsConfirmMessage,
  normalizeField,
  presetLabel,
  removePresetConfirmMessage,
  sharedPresetNotice,
  validatePresetName,
  willCloneOnSave,
} from './ankiOptionsModel.mjs';

const orderOptions = [[1, 'Reviews before new cards'], [0, 'Mix with reviews'], [2, 'New cards before reviews']];
const reviewOrderOptions = [[0, 'Due date'], [1, 'Due date, then deck'], [2, 'Deck, then due date'], [3, 'Interval ascending'],
  [4, 'Interval descending'], [5, 'Ease ascending'], [6, 'Ease descending'], [7, 'Retrievability ascending'],
  [11, 'Retrievability descending'], [8, 'Random'], [9, 'Added date'], [10, 'Reverse added date']];
const gatherOptions = [[0, 'Deck'], [5, 'Deck, then random notes'], [1, 'Lowest position'], [2, 'Highest position'],
  [3, 'Random notes'], [4, 'Random cards']];
const sortOptions = [[0, 'Card template'], [1, 'No sort'], [2, 'Template, then random'], [3, 'Random note, then template'], [4, 'Random card']];
const interdayOptions = [[0, 'Mix with reviews'], [1, 'After reviews'], [2, 'Before reviews']];
const leechOptions = [[0, 'Suspend card'], [1, 'Tag only']];
const SECTIONS = [
  ['limits', 'Daily limits'], ['newCards', 'New cards'], ['lapses', 'Lapses'], ['display', 'Display order'],
  ['burying', 'Burying'], ['audio', 'Audio'], ['timers', 'Timers'], ['advanced', 'Advanced'], ['fsrs', 'FSRS'],
];
const btn = (label, click, cls = '') => h('button', { type: 'button', class: cls, onclick: click }, label);

export function mountDeckOptions(container, { api, deck, sample = false, onLoaded = () => {}, onSaved = () => {}, onError = () => {} }) {
  let disposed = false;
  let seq = 0;
  let model = null;
  let scope = 'permanent';
  let busy = false;
  let dirty = false;
  let draft = null;
  let errors = {};
  let slots = {};
  let status = '';
  let presetForm = null;
  const openSections = { limits: true };
  const dispose = () => { disposed = true; seq++; };
  dispose.isDirty = () => dirty;

  const locked = (section) => busy || sample || (scope === 'today' && section !== 'limits');

  function resetDraft() {
    draft = draftFromModel(model, scope);
    errors = {};
    dirty = false;
  }

  function confirmDiscard() {
    if (!dirty) return true;
    if (!window.confirm('Discard unsaved deck option changes?')) return false;
    resetDraft();
    return true;
  }

  function refreshDirty() {
    const base = draftFromModel(model, scope);
    dirty = Object.keys(base).some((key) => String(draft[key]) !== String(base[key]));
  }

  function setDraft(key, value) {
    draft[key] = value;
    refreshDirty();
    const result = normalizeField(key, value);
    if (result.error) errors[key] = result.error; else delete errors[key];
    if (slots[key]) { slots[key].textContent = errors[key] ?? ''; slots[key].hidden = !errors[key]; }
    if (footer) footer.refresh();
  }

  function field(key, label, { section, type = 'number', step, hint, options } = {}) {
    const isCheck = type === 'checkbox';
    const disabled = locked(section) || (key === 'desiredRetention' && !draft.fsrs);
    const change = key === 'fsrs' ? fsrsToggleGuard : (event) => setDraft(key, isCheck ? event.currentTarget.checked
      : options ? Number(event.currentTarget.value) : event.currentTarget.value);
    const input = isCheck ? h('input', { type: 'checkbox', 'aria-label': label, disabled, onchange: change })
      : options ? h('select', { 'aria-label': label, disabled, onchange: change }, options.map(([value, text]) => h('option', { value }, text)))
        : h('input', { type, 'aria-label': label, step, disabled, min: type === 'number' ? FIELD_RULES[key]?.min : null,
          max: type === 'number' ? FIELD_RULES[key]?.max : null, oninput: change });
    if (isCheck) input.checked = !!draft[key];
    else if (options) input.value = String(draft[key]);
    else input.value = draft[key] ?? '';
    const slot = h('p', { class: 'deck-option-error', role: 'alert', hidden: !errors[key] }, errors[key] ?? '');
    slots[key] = slot;
    return h('div', { class: isCheck ? 'deck-option-check' : 'deck-option-field' },
      isCheck ? null : h('span', {}, label), isCheck ? input : null, isCheck ? h('span', {}, label) : null,
      isCheck ? null : input, hint ? h('small', { class: 'anki-sub' }, hint) : null, slot);
  }

  function section(id, title, children) {
    return h('details', { class: 'deck-option-section', open: openSections[id] || null,
      ontoggle: (event) => { openSections[id] = event.currentTarget.open; } },
    h('summary', {}, title), h('div', { class: 'deck-option-fields' }, children));
  }

  function presetBar() {
    const current = model.presets.find((preset) => preset.id === model.presetId);
    const select = h('select', { 'aria-label': 'Preset', disabled: busy || sample,
      onchange: () => choosePreset(Number(select.value)) },
    model.presets.map((preset) => h('option', { value: preset.id }, presetLabel(preset))));
    select.value = String(model.presetId);
    const menu = h('div', { class: 'deck-option-preset-menu' },
      btn('Add', () => openPresetForm('add'), 'ghost small'),
      btn('Clone', () => openPresetForm('clone'), 'ghost small'),
      btn('Rename', () => openPresetForm('rename'), 'ghost small'),
      btn('Delete', () => removePreset(current), 'ghost small'));
    menu.querySelectorAll('button').forEach((b) => { b.disabled = busy || sample; });
    if (current?.id === 1) menu.querySelectorAll('button')[3].disabled = true;
    return h('div', { class: 'deck-option-presets' },
      h('label', { class: 'deck-option-field' }, h('span', {}, 'Preset'), select),
      h('span', { class: 'anki-sub' }, `Used by ${current?.useCount ?? 0} ${current?.useCount === 1 ? 'deck' : 'decks'}`),
      menu);
  }

  function presetFormView() {
    const title = presetForm.mode === 'rename' ? 'Rename preset' : presetForm.mode === 'clone' ? 'Clone preset' : 'Add preset';
    const input = h('input', { type: 'text', 'aria-label': 'Preset name', value: presetForm.name, maxlength: 120, oninput: () => { presetForm.name = input.value; } });
    return h('div', { class: 'deck-option-preset-form' }, h('strong', {}, title), input,
      btn(presetForm.mode === 'rename' ? 'Rename' : 'Create', () => submitPresetForm(), 'primary small'),
      btn('Cancel', () => { presetForm = null; render(); }, 'ghost small'));
  }

  function openPresetForm(mode) {
    if (!confirmDiscard()) return;
    presetForm = { mode, name: mode === 'rename' ? presetLabelName() : '' };
    render();
  }

  function presetLabelName() {
    return model.presets.find((preset) => preset.id === model.presetId)?.name ?? '';
  }

  async function submitPresetForm() {
    const problem = validatePresetName(presetForm.name);
    if (problem) { status = problem; render(); return; }
    const name = presetForm.name.trim();
    const patch = presetForm.mode === 'rename'
      ? { scope: 'permanent', renamePreset: { id: model.presetId, name } }
      : { scope: 'permanent', newPreset: { name, cloneCurrent: presetForm.mode === 'clone' } };
    if (await write(patch, presetForm.mode === 'rename' ? 'Preset renamed.' : 'Preset created.')) presetForm = null;
    if (!disposed) render();
  }

  async function choosePreset(id) {
    if (id === model.presetId) return;
    if (!confirmDiscard()) { render(); return; }
    await write({ scope: 'permanent', presetId: id }, 'Preset assigned to this deck.');
  }

  function removePreset(preset) {
    if (!preset || preset.id === 1 || busy || sample) return;
    if (!confirmDiscard()) return;
    if (!window.confirm(removePresetConfirmMessage(preset))) return;
    write({ scope: 'permanent', removePreset: preset.id }, 'Preset deleted.');
  }

  function dailyLimitsSection() {
    const override = model.today ?? {};
    return section('limits', scope === 'today' ? 'Daily limits · today only' : 'Daily limits · every day', [
      h('div', { class: 'deck-option-scopes seg', role: 'group', 'aria-label': 'Daily limit scope' },
        ...[['permanent', 'Permanent'], ['today', 'Today only']].map(([id, label]) => btn(label, () => {
          if (id === scope || !confirmDiscard()) return;
          scope = id; resetDraft(); status = ''; render();
        }, scope === id ? 'active' : ''))),
      field('newPerDay', 'New cards / day', { section: 'limits' }),
      field('reviewsPerDay', 'Reviews / day', { section: 'limits' }),
      h('p', { class: 'anki-sub deck-option-wide' }, scope === 'today'
        ? 'Temporary Anki limits expire at Anki’s next day rollover. Permanent limits stay unchanged.'
        : 'Saved as this deck’s native Anki overrides. Shared preset limits are not changed.'),
      model.rollover ? h('p', { class: 'anki-sub deck-option-wide' }, `Anki day resets ${new Date(model.rollover * 1000).toLocaleString()}. Parent limits apply as configured in Anki.`) : null,
      scope === 'permanent' && (override.newPerDay != null || override.reviewsPerDay != null)
        ? h('p', { class: 'deck-option-notice deck-option-wide' }, `Today-only override active: ${override.newPerDay ?? model.permanent.newPerDay} new / ${override.reviewsPerDay ?? model.permanent.reviewsPerDay} reviews. Permanent changes take effect when this override expires or is cleared.`) : null,
      scope === 'today' ? h('p', { class: 'deck-option-notice deck-option-wide' }, 'Switch to Permanent to edit the other sections.') : null,
    ]);
  }

  function sections() {
    const burying = ['buryNew', 'buryReviews', 'buryLearning'];
    return [
      dailyLimitsSection(),
      section('newCards', 'New cards', [
        field('learnSteps', 'Learning steps', { section: 'newCards', type: 'text', hint: 'Anki format, e.g. 1m 10m 1d' }),
        field('graduatingInterval', 'Graduating interval (days)', { section: 'newCards' }),
        field('easyInterval', 'Easy interval (days)', { section: 'newCards' }),
        field('startingEase', 'Starting ease (%)', { section: 'newCards', step: '1' }),
        field('newGatherOrder', 'New card gather order', { section: 'newCards', options: gatherOptions }),
        field('newSortOrder', 'New card sort order', { section: 'newCards', options: sortOptions }),
      ]),
      section('lapses', 'Lapses', [
        field('relearnSteps', 'Relearning steps', { section: 'lapses', type: 'text', hint: 'Anki format, e.g. 10m' }),
        field('lapseNewInterval', 'New interval after lapse (%)', { section: 'lapses' }),
        field('lapseMinInterval', 'Minimum interval after lapse (days)', { section: 'lapses' }),
        field('leechThreshold', 'Leech threshold (lapses)', { section: 'lapses' }),
        field('leechAction', 'Leech action', { section: 'lapses', options: leechOptions }),
      ]),
      section('display', 'Display order', [
        field('newMix', 'New and review order', { section: 'display', options: orderOptions }),
        field('reviewOrder', 'Review card order', { section: 'display', options: reviewOrderOptions }),
        field('interdayLearningMix', 'Interday learning order', { section: 'display', options: interdayOptions }),
      ]),
      section('burying', 'Burying', [
        ...burying.map((key) => field(key, { buryNew: 'Bury new siblings', buryReviews: 'Bury review siblings', buryLearning: 'Bury interday learning siblings' }[key], { section: 'burying', type: 'checkbox' })),
      ]),
      section('audio', 'Audio', [
        field('disableAutoplay', 'Disable audio autoplay', { section: 'audio', type: 'checkbox' }),
        field('skipQuestionWhenReplayingAnswer', 'Skip question when replaying answer', { section: 'audio', type: 'checkbox' }),
      ]),
      section('timers', 'Timers', [
        field('maxAnswerSecs', 'Maximum answer seconds', { section: 'timers' }),
        field('showTimer', 'Show timer', { section: 'timers', type: 'checkbox' }),
        field('stopTimerOnAnswer', 'Stop timer on answer', { section: 'timers', type: 'checkbox' }),
      ]),
      section('advanced', 'Advanced', [
        field('maxInterval', 'Maximum interval (days)', { section: 'advanced' }),
        field('easyBonus', 'Easy bonus (%)', { section: 'advanced' }),
        field('intervalModifier', 'Interval modifier (%)', { section: 'advanced' }),
        field('hardInterval', 'Hard interval (%)', { section: 'advanced' }),
        h('div', { class: 'deck-option-wide' }, btn('Open deck options in Anki', () => open(), 'ghost'),
          h('p', { class: 'anki-sub' }, 'Anki’s own editor for card templates and anything not listed here.')),
      ]),
      section('fsrs', 'FSRS', [
        field('fsrs', 'Use FSRS (applies to every deck in this collection)', { section: 'fsrs', type: 'checkbox' }),
        field('desiredRetention', 'Desired retention', { section: 'fsrs', step: '0.01', hint: 'Needs FSRS on. Range 0.70–0.99.' }),
      ]),
    ];
  }

  let footer = null;

  function footerView() {
    const saveButton = btn(sample ? 'Sample — saving disabled' : 'Save to Anki', () => saveChanges(), 'primary');
    const discardButton = btn('Discard', () => { if (confirmDiscard()) { status = ''; render(); } }, 'ghost');
    const clearButton = scope === 'today' ? btn('Clear today override', () => write(clearTodayPatch(), 'Today override cleared in Anki.'), 'ghost') : null;
    const marker = h('span', { class: 'deck-option-dirty', hidden: !dirty }, 'Unsaved changes');
    const statusLine = h('p', { class: 'deck-option-status', role: 'status', 'aria-live': 'polite' }, busy ? 'Saving to Anki…' : status);
    const refresh = () => {
      saveButton.disabled = busy || sample || !dirty;
      discardButton.disabled = busy || !dirty;
      marker.hidden = !dirty;
    };
    footer = { refresh };
    refresh();
    if (clearButton) clearButton.disabled = busy || sample;
    return h('footer', { class: 'deck-option-footer' },
      h('div', { class: 'deck-option-footer-row' }, marker, statusLine),
      h('div', { class: 'panel-actions' }, saveButton, discardButton, clearButton));
  }

  function render() {
    if (disposed) return;
    footer = null;
    slots = {};
    if (!model) {
      fill(container, h('section', { class: 'anki-card deck-options' }, h('h2', {}, 'Deck options'),
        h('p', { class: 'anki-sub', role: 'status' }, status || 'Reading deck options from Anki…'),
        status ? btn('Try again', load, 'primary') : null));
      return;
    }
    const reload = btn(withIcon('replay', 'Read Anki'), () => { if (confirmDiscard()) load(); }, 'ghost small');
    reload.disabled = busy;
    const head = h('div', { class: 'deck-options-head' },
      h('div', {}, h('h2', {}, 'Deck options'), h('p', { class: 'anki-sub', title: deck }, deck)),
      reload);
    const notice = sample ? 'Sample data only. No connection or writes to Anki.'
      : 'Only this deck changes. Preset edits clone a shared preset when needed. Reading options selects this deck in Anki; leave Anki’s review screen before using Anime Mine.';
    const progress = h('p', { class: 'deck-option-progress-line anki-sub' },
      `Today in Anki: ${model.completed.new} new introduced, ${model.completed.reviews} review answers · ${model.remaining.new} new, ${model.remaining.reviews} reviews, ${model.remaining.learning} learning remaining`);
    const shared = sharedPresetNotice(model);
    const body = h('div', { class: 'deck-option-sections' }, ...sections());
    const formView = presetForm ? presetFormView() : null;
    fill(container, h('section', { class: 'anki-card deck-options' }, head, presetBar(), formView,
      shared ? h('p', { class: 'deck-option-notice' }, shared) : null, progress, h('p', { class: 'deck-option-notice' }, notice),
      body, footerView()));
  }

  async function load() {
    const mine = ++seq;
    model = null; status = ''; dirty = false; render();
    try {
      const response = await api.deckOptions({ deck });
      if (disposed || mine !== seq) return;
      if (!response) throw Error('Deck options are hidden');
      model = response; resetDraft(); onLoaded(response); render();
    } catch (err) {
      if (disposed || mine !== seq) return;
      status = err.message; onError(err); render();
    }
  }

  async function write(patch, okStatus) {
    if (busy || sample || !model) return false;
    const mine = ++seq;
    busy = true; render();
    let ok = false;
    try {
      const result = await api.setDeckOptions({ deck, patch, revision: model.revision });
      if (disposed || mine !== seq) return false;
      model = result; resetDraft(); status = okStatus; ok = true;
      onLoaded(result); onSaved(result);
    } catch (err) {
      if (disposed || mine !== seq) return false;
      status = err.message;
    } finally {
      if (!disposed) { busy = false; render(); }
    }
    return ok;
  }

  async function saveChanges() {
    if (busy || sample || !model) return;
    const { patch, errors: problems } = buildPatch({ model, draft, scope });
    errors = problems;
    if (Object.keys(problems).length) { status = 'Fix the highlighted fields before saving.'; render(); return; }
    if (!patch) { status = 'No changes to save.'; render(); return; }
    await write(patch, 'Saved to Anki.');
  }

  function fsrsToggleGuard(event) {
    const input = event.currentTarget;
    if (!window.confirm(fsrsConfirmMessage(input.checked))) { input.checked = !!draft.fsrs; return; }
    setDraft('fsrs', input.checked);
    render();
  }

  async function open() {
    if (sample) return;
    try { await api.openDeckOptions({ deck }); }
    catch (err) { if (!disposed) { status = err.message; render(); } }
  }

  load();
  return dispose;
}
