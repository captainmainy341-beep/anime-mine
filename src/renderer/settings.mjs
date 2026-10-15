import { attempt, fill, h, toast } from './lib/ui.mjs';
import { formatBytes, importSummary, knownStatsLabel, progressFraction } from './lib/libraryView.mjs';

const api = window.api;

function input(type, value, attrs = {}) {
  return h('input', { type, value: value ?? '', ...attrs });
}

function select(options, value, labels = {}) {
  const el = h('select', {}, options.map((option) => h('option', { value: option }, labels[option] ?? option)));
  el.value = value;
  return el;
}

function checkbox(checked) {
  return h('input', { type: 'checkbox', checked: checked ? true : null });
}

function createInputs(settings) {
  return {
    downloadsDir: input('text', settings.downloadsDir),
    ankiUrl: input('text', settings.ankiUrl),
    ankiDeck: input('text', settings.ankiDeck),
    ankiModel: input('text', settings.ankiModel),
    audioPadStart: input('number', settings.audioPadStart, { step: '0.05', min: '0' }),
    audioPadEnd: input('number', settings.audioPadEnd, { step: '0.05', min: '0' }),
    provider: select(['claude-cli', 'anthropic', 'openai'], settings.ai.provider),
    apiKey: input('password', settings.ai.apiKey, { autocomplete: 'off' }),
    model: input('text', settings.ai.model),
    baseUrl: input('text', settings.ai.baseUrl, { placeholder: 'Empty for the provider default' }),
    autoTranslate: checkbox(settings.autoTranslate),
    highlightUnknown: checkbox(settings.highlightUnknown),
    showFurigana: checkbox(settings.showFurigana),
    autoPause: checkbox(settings.autoPause),
    quickMine: checkbox(settings.quickMine),
    removeBurnedSubs: checkbox(settings.removeBurnedSubs),
    burnedSubsMode: select(['blur', 'ai'], settings.burnedSubsMode === 'ai' ? 'ai' : 'blur', {
      blur: 'Fast blur, about 12 min per episode, no install',
      ai: 'AI fill, about 1 hour per episode, installs ~1 GB',
    }),
    knownDeck: input('text', settings.knownDeck, { list: 'known-decks', placeholder: 'Deck name in Anki' }),
    knownField: select(settings.knownField ? [settings.knownField] : [], settings.knownField),
    knownMatureOnly: checkbox(settings.knownMatureOnly),
    jimakuEnabled: checkbox(settings.jimaku.enabled),
    jimakuApiKey: input('password', settings.jimaku.apiKey, { autocomplete: 'off' }),
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
    autoTranslate: f.autoTranslate.checked,
    highlightUnknown: f.highlightUnknown.checked,
    showFurigana: f.showFurigana.checked,
    autoPause: f.autoPause.checked,
    quickMine: f.quickMine.checked,
    removeBurnedSubs: f.removeBurnedSubs.checked,
    burnedSubsMode: f.burnedSubsMode.value,
    knownDeck: f.knownDeck.value.trim(),
    knownField: f.knownField.value,
    knownMatureOnly: f.knownMatureOnly.checked,
    jimaku: { enabled: f.jimakuEnabled.checked, apiKey: f.jimakuApiKey.value.trim() },
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

function toggle(control, text) {
  return h('label', { class: 'toggle' }, control, h('span', {}, text));
}

function fieldset(legend, ...fields) {
  return h('fieldset', {}, h('legend', {}, legend), ...fields);
}

function sections(f) {
  return [
    fieldset(
      'Library',
      field('Downloads folder', f.downloadsDir, 'Subtitle downloads in this folder are linked automatically.', true),
      toggle(f.jimakuEnabled, 'Jimaku auto-subtitles'),
      field('Jimaku API key', f.jimakuApiKey, 'Free key from jimaku.cc → Account. Missing subtitles for new episodes are fetched automatically.', true),
    ),
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
      field('API key', f.apiKey, 'Stored locally in plain text in settings.json. Not needed for claude-cli, which uses your Claude Code login.'),
      field('Model', f.model),
      field('Base URL', f.baseUrl, 'Optional. Leave empty for the provider default.', true),
    ),
    fieldset(
      'Watching',
      toggle(f.autoTranslate, 'Translate sentences with AI when mining'),
      toggle(f.highlightUnknown, 'Highlight unknown words'),
      toggle(f.showFurigana, 'Show furigana'),
      toggle(f.autoPause, 'Pause automatically'),
      toggle(f.quickMine, 'M mines immediately without preview'),
    ),
  ];
}

function knownSection(f) {
  const stats = h('p', { class: 'hint full' }, 'Loading…');
  const decks = h('datalist', { id: 'known-decks' });
  const words = h('textarea', { rows: 5, placeholder: 'One word per line' });

  f.knownDeck.addEventListener('change', () => attempt(() => loadFields(f.knownDeck.value.trim(), null)));

  async function refreshStats() {
    stats.textContent = knownStatsLabel(await api.known.stats());
  }

  async function loadDecks() {
    fill(decks, ((await api.anki.listDecks()) ?? []).map((name) => h('option', { value: name })));
  }

  async function loadFields(deck, preferred) {
    if (!deck) {
      fill(f.knownField);
      return;
    }
    const { fields, suggested } = await api.known.ankiFields({ deck });
    if (f.knownDeck.value.trim() !== deck) return;
    fill(
      f.knownField,
      fields.map((name) => h('option', { value: name }, name)),
    );
    f.knownField.value = fields.includes(preferred) ? preferred : (suggested ?? fields[0] ?? '');
  }

  async function importFromAnki() {
    const deck = f.knownDeck.value.trim();
    if (!deck) throw new Error('Choose a deck to import from.');
    const result = await api.known.importAnki({
      deck,
      field: f.knownField.value,
      matureOnly: f.knownMatureOnly.checked,
    });
    toast(importSummary(result), 'success');
    await refreshStats();
  }

  async function importFromText() {
    if (!words.value.trim()) throw new Error('Paste a word list first.');
    toast(importSummary(await api.known.importText(words.value)), 'success');
    await refreshStats();
  }

  return {
    el: fieldset(
      'Known words',
      stats,
      decks,
      field('Deck to import from', f.knownDeck, 'Imports words from cards you have already reviewed.'),
      field('Word field', f.knownField, 'Leave as the default to use the usual word fields.'),
      toggle(f.knownMatureOnly, 'Mature cards only'),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => attempt(importFromAnki) }, 'Import from Anki')),
      field('Paste a word list', words, 'One word per line. Lines starting with # are ignored.', true),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'ghost', onclick: () => attempt(importFromText) }, 'Import words')),
    ),
    load() {
      const preferred = f.knownField.value;
      attempt(refreshStats);
      loadDecks().catch(() => {});
      loadFields(f.knownDeck.value.trim(), preferred).catch(() => {});
    },
  };
}

function desubLabel({ installed, installing, current, bytes }, mode) {
  if (installing) return 'Installing tools…';
  if (!installed && mode === 'ai') return 'Tools not installed';
  if (current) return `Cleaning: ${Math.round(current.fraction * 100)}%`;
  return `Idle, ${formatBytes(bytes)} cached`;
}

function subtitlesSection(f) {
  const hint = h('p', { class: 'hint full' }, 'Checking…');

  async function refresh() {
    hint.textContent = desubLabel(await api.desub.status(), f.burnedSubsMode.value);
  }

  f.burnedSubsMode.addEventListener('change', () => attempt(refresh));
  const onEvent = () => attempt(refresh);
  const stops = [api.desub.onProgress(onEvent), api.desub.onDone(onEvent), api.desub.onError(onEvent)];

  return {
    el: fieldset(
      'Subtitles',
      toggle(f.removeBurnedSubs, 'Remove burned-in subtitles (runs in the background)'),
      field('Method', f.burnedSubsMode),
      hint,
    ),
    load: () => attempt(refresh),
    stop: () => stops.forEach((stop) => stop()),
  };
}

function pitchSection() {
  const status = h('span', { class: 'hint' }, 'Checking…');
  const download = h('button', { type: 'button', class: 'ghost', onclick: () => attempt(downloadPitch) }, 'Download');
  const bar = h('span', { class: 'progress', hidden: true }, h('span', { class: 'progress-fill' }));

  const stop = api.pitch.onProgress((fraction) => {
    bar.hidden = false;
    bar.firstElementChild.style.width = `${Math.round(progressFraction(fraction, 1) * 100)}%`;
  });

  async function refresh() {
    const { ready } = await api.pitch.status();
    status.textContent = ready ? 'Installed' : 'Not downloaded';
    download.disabled = ready;
  }

  async function downloadPitch() {
    download.disabled = true;
    try {
      await api.pitch.download();
      toast('Pitch accent data downloaded', 'success');
    } finally {
      bar.hidden = true;
      await refresh();
    }
  }

  return {
    el: fieldset('Pitch accent', h('div', { class: 'row-actions' }, status, download), h('div', { class: 'full' }, bar)),
    load: () => attempt(refresh),
    stop,
  };
}

function mediaSection() {
  const size = h('span', { class: 'hint' }, 'Calculating…');

  async function refresh() {
    size.textContent = `Converted video cache: ${formatBytes((await api.media.cacheInfo()).bytes)}`;
  }

  async function clearCache() {
    if (!window.confirm('Delete all converted video files? They are rebuilt the next time you play them.')) return;
    await api.media.clearCache();
    toast('Video cache cleared', 'success');
    await refresh();
  }

  return {
    el: fieldset(
      'Video playback',
      h(
        'div',
        { class: 'row-actions' },
        size,
        h('button', { type: 'button', class: 'ghost', onclick: () => attempt(clearCache) }, 'Clear cache'),
      ),
    ),
    load: () => attempt(refresh),
  };
}

function webSection() {
  const port = input('text', '', { readonly: true, placeholder: 'Starting…' });
  const token = input('text', '', { readonly: true, placeholder: 'Starting…' });
  const copy = h('button', { type: 'button', class: 'ghost', onclick: () => attempt(copyToken) }, 'Copy token');

  async function refresh() {
    const info = await api.web.info();
    port.value = info.port ?? 'Unavailable';
    token.value = info.token ?? '';
  }

  async function copyToken() {
    await navigator.clipboard.writeText((await api.web.info()).token ?? '');
    toast('Token copied', 'success');
  }

  return {
    el: fieldset(
      'Browser extension',
      field('Port', port),
      field('Token', token, '', true),
      h(
        'div',
        { class: 'row-actions' },
        h('span', { class: 'hint' }, 'Paste the port and token into the Anime Mine browser extension.'),
        copy,
      ),
    ),
    load: () => attempt(refresh),
  };
}

export function mountSettings(container) {
  const form = h('form', { class: 'settings-form', onsubmit: save });
  container.append(h('section', { class: 'page' }, h('h1', {}, 'Settings'), form));
  let inputs = null;
  let disposed = false;
  let stopPitch = null;
  let stopSubtitles = null;

  attempt(async () => {
    const settings = await api.settings.get();
    if (disposed) return;
    inputs = createInputs(settings);
    const subtitles = subtitlesSection(inputs);
    const known = knownSection(inputs);
    const pitch = pitchSection();
    const media = mediaSection();
    const web = webSection();
    stopSubtitles = subtitles.stop;
    stopPitch = pitch.stop;
    fill(
      form,
      ...sections(inputs),
      subtitles.el,
      known.el,
      pitch.el,
      media.el,
      web.el,
      h('div', { class: 'form-foot' }, h('button', { class: 'primary', type: 'submit' }, 'Save settings')),
    );
    subtitles.load();
    known.load();
    pitch.load();
    media.load();
    web.load();
  });

  function save(e) {
    e.preventDefault();
    attempt(async () => {
      await api.settings.set(readPatch(inputs));
      toast('Settings saved', 'success');
    });
  }

  return () => {
    disposed = true;
    stopSubtitles?.();
    stopPitch?.();
  };
}
