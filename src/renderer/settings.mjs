import { attempt, fill, h, toast } from './lib/ui.mjs';

const api = window.api;

function input(type, value, attrs = {}) {
  return h('input', { type, value: value ?? '', ...attrs });
}

function select(options, value) {
  const el = h('select', {}, options.map((option) => h('option', { value: option }, option)));
  el.value = value;
  return el;
}

function createInputs(settings) {
  return {
    downloadsDir: input('text', settings.downloadsDir),
    ankiUrl: input('text', settings.ankiUrl),
    ankiDeck: input('text', settings.ankiDeck),
    ankiModel: input('text', settings.ankiModel),
    audioPadStart: input('number', settings.audioPadStart, { step: '0.05', min: '0' }),
    audioPadEnd: input('number', settings.audioPadEnd, { step: '0.05', min: '0' }),
    provider: select(['anthropic', 'openai'], settings.ai.provider),
    apiKey: input('password', settings.ai.apiKey, { autocomplete: 'off' }),
    model: input('text', settings.ai.model),
    baseUrl: input('text', settings.ai.baseUrl, { placeholder: 'Empty for the provider default' }),
  };
}

function readPatch(f) {
  const padStart = Number(f.audioPadStart.value);
  const padEnd = Number(f.audioPadEnd.value);
  if (![padStart, padEnd].every((n) => Number.isFinite(n) && n >= 0)) {
    throw new Error('Audio padding must be 0 or more seconds.');
  }
  return {
    downloadsDir: f.downloadsDir.value.trim(),
    ankiUrl: f.ankiUrl.value.trim(),
    ankiDeck: f.ankiDeck.value.trim(),
    ankiModel: f.ankiModel.value.trim(),
    audioPadStart: padStart,
    audioPadEnd: padEnd,
    ai: {
      provider: f.provider.value,
      apiKey: f.apiKey.value.trim(),
      model: f.model.value.trim(),
      baseUrl: f.baseUrl.value.trim(),
    },
  };
}

function field(label, control, hint = '', wide = false) {
  return h(
    'label',
    { class: wide ? 'field wide' : 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'hint' }, hint) : null,
  );
}

function fieldset(legend, ...fields) {
  return h('fieldset', {}, h('legend', {}, legend), ...fields);
}

function sections(f) {
  return [
    fieldset('Library', field('Downloads folder', f.downloadsDir, 'Subtitle downloads in this folder are linked automatically.', true)),
    fieldset(
      'Anki',
      field('AnkiConnect URL', f.ankiUrl),
      field('Deck', f.ankiDeck),
      field('Note type', f.ankiModel),
      field('Audio padding before (s)', f.audioPadStart),
      field('Audio padding after (s)', f.audioPadEnd),
    ),
    fieldset(
      'AI lookup',
      field('Provider', f.provider),
      field('API key', f.apiKey, 'Stored locally in plain text in settings.json.'),
      field('Model', f.model),
      field('Base URL', f.baseUrl, 'Optional. Leave empty for the provider default.', true),
    ),
  ];
}

export function mountSettings(container) {
  const form = h('form', { class: 'settings-form', onsubmit: save });
  container.append(h('section', { class: 'page' }, h('h1', {}, 'Settings'), form));
  let inputs = null;

  attempt(async () => {
    inputs = createInputs(await api.settings.get());
    fill(form, ...sections(inputs), h('div', { class: 'form-foot' }, h('button', { class: 'primary', type: 'submit' }, 'Save settings')));
  });

  function save(e) {
    e.preventDefault();
    attempt(async () => {
      await api.settings.set(readPatch(inputs));
      toast('Settings saved', 'success');
    });
  }
}
