import { tokenizeCached } from './lib/nlp.mjs';
import { fill, h, toast } from './lib/ui.mjs';
import { grammarChipLabel, learnWordInput } from './lib/learnChips.mjs';
import { renderGrammarGuide } from './lib/grammarGuide.mjs';
import {
  NUDGE_SECONDS,
  buildMineRequest,
  extendRange,
  glossesOf,
  initialRange,
  nudge,
  prefillFields,
  previewRequest,
  rangeCue,
} from './lib/mineForm.mjs';

const api = window.api;
const MEDIA_DEBOUNCE_MS = 300;
const KNOWN_ACTIONS = [
  ['known', 'Know it'],
  ['learning', 'Learning'],
  ['new', 'Reset'],
];
const KNOWN_LABELS = { known: 'Known', learning: 'Learning', new: 'New' };
const FIELD_ROWS = [
  ['SentenceTranslation', 'English translation', true],
  ['Word', 'Word', false],
  ['Reading', 'Reading', false],
  ['Meaning', 'Meaning', true],
  ['Notes', 'Notes', true],
];

let onDictProgress = null;
api.dict.onProgress((fraction) => onDictProgress?.(fraction));

async function lookupTarget({ mode, cues, index, tokenIndex }) {
  const text = cues[index].text;
  if (mode === 'word') return [await api.lookup.at({ text, index: tokenIndex })];
  const tokens = await tokenizeCached(text);
  const hits = await Promise.all(tokens.map((t, i) => (t.isWord ? api.lookup.at({ text, index: i }) : null)));
  const seen = new Set();
  return hits.filter((hit) => {
    if (!hit?.span) return false;
    const key = `${hit.span.start}:${hit.span.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function aiRequest({ mode, cues, index, token }) {
  const req = {
    sentence: cues[index].text,
    context: contextFor(cues, index),
  };
  if (mode === 'word') req.word = token.surface;
  return req;
}

function contextFor(cues, from) {
  return cues.slice(Math.max(0, from - 2), from).map((cue) => cue.text);
}

function wordOf(target, result) {
  const { token } = target;
  return {
    surface: result?.span?.text ?? token.surface,
    base: result?.dictForm ?? token.base ?? token.surface,
    reading: result?.entries?.[0]?.kana?.[0] ?? token.reading ?? '',
  };
}

function draftFor(target, mode, lookups, entryIndex) {
  const range = initialRange(target.cues, target.index);
  const cue = rangeCue(range);
  const result = mode === 'word' ? lookups?.[0] : null;
  const word = mode === 'word' ? wordOf(target, result) : null;
  const entry = result?.entries[entryIndex];
  return {
    mode,
    range,
    word,
    timing: { start: cue.start, end: cue.end },
    fields: prefillFields({ mode, cueText: cue.text, word: word?.base, reading: word?.reading, entry }),
  };
}

function mineRequestFor(draft, audioStreamIndex, videoPath) {
  return buildMineRequest({
    videoPath,
    mode: draft.mode,
    cue: rangeCue(draft.range),
    timing: draft.timing,
    word: draft.word,
    fields: { ...draft.fields },
    context: contextFor(draft.range.cues, draft.range.from),
    audioStreamIndex,
  });
}

function friendlyMineError(message) {
  return /already in your deck/i.test(message) ? 'This note is already in your Anki deck.' : message;
}

function firstGloss(entries) {
  return entries[0]?.senses[0]?.glosses[0] ?? '—';
}

function progressBar(fraction) {
  const bar = h('div', { class: 'progress-fill' });
  bar.style.width = `${Math.round(fraction * 100)}%`;
  return h('div', { class: 'progress' }, bar);
}

export function createPopup(slot, { videoPath, getAudioStreamIndex, onOpenSettings, onMined, onKnownChanged }) {
  let target = null;
  let tab = 'dictionary';
  let lookups = null;
  let selected = 0;
  let knownStatus = 'new';
  let learnAdded = false;
  let ai = { status: 'idle' };
  let grammarState = null;
  let grammarSeq = 0;
  let preview = null;
  let wantPreview = false;
  let mediaSeq = 0;
  let mediaTimer = null;
  const grammarByText = new Map();
  const dict = { ready: true, downloading: false, progress: 0 };
  const pitch = { ready: true, downloading: false, progress: 0 };

  const streamIndex = () => getAudioStreamIndex?.() ?? null;

  onDictProgress = (fraction) => {
    dict.progress = fraction;
    render();
  };

  function open(next, { withPreview = false } = {}) {
    clearTimeout(mediaTimer);
    target = next;
    tab = 'dictionary';
    lookups = null;
    selected = 0;
    knownStatus = 'new';
    learnAdded = false;
    ai = { status: 'idle' };
    grammarState = null;
    preview = null;
    wantPreview = withPreview;
    slot.hidden = false;
    render();
    load();
    loadGrammarGuide(next);
  }

  function close() {
    clearTimeout(mediaTimer);
    target = null;
    preview = null;
    slot.hidden = true;
    slot.replaceChildren();
  }

  async function load() {
    const current = target;
    const grammarText = current.cues[current.index].text;
    if (!grammarByText.has(grammarText)) {
      grammarFor(grammarText).then(() => {
        if (target === current && lookups) render();
      });
    }
    const [dictStatus, pitchStatus] = await Promise.all([api.dict.status(), api.pitch.status()]);
    if (target !== current) return;
    dict.ready = dictStatus.ready;
    pitch.ready = pitchStatus.ready;
    lookups = dict.ready ? await lookupTarget(current) : [];
    if (target !== current) return;
    const base = current.mode === 'word' ? lookups[0]?.dictForm : null;
    if (base) {
      const [status] = (await api.known.classify([{ surface: base, base, isWord: true }])).statuses;
      if (target !== current) return;
      knownStatus = status;
    }
    render();
    if (wantPreview) {
      wantPreview = false;
      openPreview(current.mode);
    }
  }

  async function grammarFor(text) {
    if (!grammarByText.has(text)) {
      try {
        grammarByText.set(text, await api.learn.grammarIn(text));
      } catch {
        return [];
      }
    }
    return grammarByText.get(text);
  }

  async function loadGrammarGuide(current) {
    if (current.mode !== 'sentence') return;
    const seq = ++grammarSeq;
    grammarState = { status: 'loading' };
    render();
    try {
      const analysis = await api.grammar.analyze(current.cues[current.index].text);
      if (target !== current || seq !== grammarSeq) return;
      grammarState = { status: 'ready', analysis };
    } catch (err) {
      if (target !== current || seq !== grammarSeq) return;
      grammarState = { status: 'error', message: err.message };
    }
    render();
  }

  function grammarSection() {
    if (target.mode !== 'sentence') return null;
    const state = grammarState;
    let body;
    if (state?.status === 'ready') body = renderGrammarGuide(state.analysis, { compact: true });
    else if (state?.status === 'error') body = h('p', { class: 'muted grammar-hint' }, `Grammar guide unavailable: ${state.message}`);
    else body = h('p', { class: 'muted grammar-hint' }, 'Analysing grammar…');
    return h('section', { class: 'popup-grammar' }, h('div', { class: 'label muted' }, 'Grammar'), body);
  }

  function render() {
    if (!target) return;
    fill(
      slot,
      head(),
      dict.ready ? null : dictBanner(),
      tabs(),
      h(
        'div',
        { class: 'popup-body' },
        grammarSection(),
        tab === 'dictionary' ? dictionaryPanel() : aiPanel(),
        tab === 'dictionary' ? grammarRow() : null,
      ),
      preview ? previewPanel(preview) : null,
      footer(),
    );
  }

  function head() {
    const { mode, cues, index, token } = target;
    if (mode === 'sentence') {
      return h(
        'div',
        { class: 'popup-head' },
        h(
          'div',
          { class: 'popup-title' },
          h('span', { class: 'label muted' }, 'Sentence'),
          h('p', { class: 'sentence-head' }, cues[index].text),
        ),
        closeButton(),
      );
    }
    const result = lookups?.[0];
    const dictForm = result?.dictForm;
    return h(
      'div',
      { class: 'popup-head' },
      h(
        'div',
        { class: 'popup-title' },
        h('span', { class: 'surface' }, result?.span?.text ?? token.surface),
        token.reading ? h('span', { class: 'reading' }, token.reading) : null,
        dictForm && dictForm !== token.surface ? h('span', { class: 'chip' }, dictForm) : null,
        ...(result?.inflection ?? []).map((label) => h('span', { class: 'chip inflection' }, label)),
      ),
      closeButton(),
    );
  }

  function closeButton() {
    return h('button', { class: 'ghost small', title: 'Close (Esc)', onclick: close }, '×');
  }

  function dictBanner() {
    return h(
      'div',
      { class: 'banner' },
      h('span', {}, 'The dictionary isn’t downloaded yet.'),
      dict.downloading ? progressBar(dict.progress) : null,
      h(
        'button',
        { class: 'primary small', disabled: dict.downloading, onclick: downloadDictionary },
        dict.downloading ? 'Downloading…' : 'Download dictionary',
      ),
    );
  }

  async function downloadDictionary() {
    dict.downloading = true;
    dict.progress = 0;
    render();
    try {
      await api.dict.download();
      toast('Dictionary ready', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      dict.downloading = false;
    }
    load();
  }

  function tabs() {
    return h(
      'div',
      { class: 'tabs', role: 'tablist' },
      tabButton('dictionary', 'Dictionary'),
      tabButton('ai', 'AI lookup'),
    );
  }

  function tabButton(id, label) {
    return h(
      'button',
      {
        class: `tab${tab === id ? ' active' : ''}`,
        role: 'tab',
        'aria-selected': String(tab === id),
        onclick: () => {
          tab = id;
          render();
        },
      },
      label,
    );
  }

  function dictionaryPanel() {
    if (!dict.ready) return h('p', { class: 'muted' }, 'Download the dictionary to look words up.');
    if (!lookups) return h('p', { class: 'muted' }, 'Looking up…');
    return target.mode === 'word' ? wordPanel() : sentenceWords();
  }

  function grammarRow() {
    const hits = grammarByText.get(target.cues[target.index].text) ?? [];
    if (!hits.length) return null;
    return h(
      'div',
      { class: 'grammar-row' },
      hits.map((hit) => h('span', { class: 'chip grammar-chip', title: hit.meaning }, grammarChipLabel(hit))),
    );
  }

  function wordPanel() {
    const result = lookups[0];
    return h(
      'div',
      {},
      pitchBlock(result),
      knownBlock(result),
      result.entries.length
        ? result.entries.map(entryCard)
        : h('p', { class: 'muted' }, `No dictionary entry for “${target.token.surface}”.`),
    );
  }

  function pitchBlock(result) {
    if (result.pitch) {
      return h(
        'div',
        { class: 'pitch' },
        result.pitch.accents.map(({ label, mora }) =>
          h(
            'div',
            { class: 'pitch-row' },
            h('span', { class: 'pitch-label muted' }, label),
            h(
              'span',
              { class: 'pitch-morae' },
              mora.map(({ mora: text, high }) => h('span', { class: high ? 'mora high' : 'mora' }, text)),
            ),
          ),
        ),
      );
    }
    if (pitch.ready) return null;
    return pitch.downloading
      ? h('div', { class: 'pitch-download' }, progressBar(pitch.progress))
      : h('button', { class: 'small pitch-download', onclick: downloadPitch }, 'Download pitch accent data');
  }

  async function downloadPitch() {
    const current = target;
    pitch.downloading = true;
    pitch.progress = 0;
    render();
    const off = api.pitch.onProgress((fraction) => {
      pitch.progress = fraction;
      render();
    });
    try {
      await api.pitch.download();
      toast('Pitch accent data ready', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      off();
      pitch.downloading = false;
    }
    if (target === current) load();
  }

  function knownBlock(result) {
    if (!result.dictForm) return null;
    const base = result.dictForm;
    return h(
      'div',
      { class: 'known-row' },
      h('span', { class: `chip known-${knownStatus}` }, KNOWN_LABELS[knownStatus]),
      ...KNOWN_ACTIONS.map(([status, label]) =>
        h(
          'button',
          { class: 'small', disabled: knownStatus === status, onclick: () => markKnown(base, status) },
          label,
        ),
      ),
      result.entries.length ? learnButton(result) : null,
    );
  }

  function learnButton(result) {
    return h(
      'button',
      { class: 'small', disabled: learnAdded, onclick: () => addToLearn(result) },
      learnAdded ? 'In Learn' : 'Add to Learn',
    );
  }

  async function addToLearn(result) {
    const current = target;
    const input = learnWordInput({
      dictForm: result.dictForm,
      entry: result.entries[selected],
      sentenceText: current.cues[current.index].text,
    });
    try {
      await api.learn.addWord(input);
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    toast('Added to Learn', 'success');
    if (target !== current) return;
    learnAdded = true;
    render();
  }

  async function markKnown(word, status) {
    try {
      await api.known.mark({ word, status });
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    knownStatus = status;
    onKnownChanged?.();
    window.dispatchEvent(new CustomEvent('am:known-changed'));
    render();
  }

  function entryCard(entry, i) {
    return h(
      'div',
      {
        class: `entry${i === selected ? ' selected' : ''}`,
        onclick: () => {
          selected = i;
          if (preview) preview.fields.Meaning = glossesOf(entry);
          render();
        },
      },
      h(
        'div',
        { class: 'entry-forms' },
        entry.kanji.length ? h('span', { class: 'entry-kanji' }, entry.kanji.join(' · ')) : null,
        h('span', { class: 'entry-kana' }, entry.kana.join(' · ')),
        entry.common ? h('span', { class: 'badge' }, 'common') : null,
      ),
      h('ol', { class: 'senses' }, entry.senses.map(senseItem)),
    );
  }

  function senseItem(sense) {
    return h(
      'li',
      {},
      sense.pos.length ? h('span', { class: 'pos' }, sense.pos.join(', ')) : null,
      sense.glosses.join('; '),
    );
  }

  function sentenceWords() {
    if (!lookups.length) return h('p', { class: 'muted' }, 'No dictionary words in this line.');
    return lookups.map(({ span, entries }) =>
      h(
        'div',
        { class: 'word-row' },
        h('span', { class: 'w' }, span.text),
        h('span', { class: 'r' }, entries[0]?.kana[0] ?? ''),
        h('span', { class: 'g' }, firstGloss(entries)),
      ),
    );
  }

  function aiPanel() {
    return h(
      'div',
      { class: 'ai' },
      h(
        'button',
        { class: 'primary', disabled: ai.status === 'loading', onclick: explain },
        ai.status === 'idle' ? 'Explain' : 'Explain again',
      ),
      ai.status === 'loading' ? h('p', { class: 'muted' }, 'Asking the model…') : null,
      ai.status === 'done' ? h('p', { class: 'ai-text' }, ai.text) : null,
      ai.status === 'error' ? aiError(ai.message) : null,
    );
  }

  function aiError(message) {
    if (/api.?key/i.test(message)) {
      return h(
        'div',
        { class: 'banner' },
        'AI lookup needs an API key.',
        h('button', { class: 'small', onclick: onOpenSettings }, 'Open Settings'),
      );
    }
    return h('div', { class: 'banner' }, `Couldn’t get an explanation: ${message}`);
  }

  async function explain() {
    const current = target;
    ai = { status: 'loading' };
    render();
    let next;
    try {
      next = { status: 'done', text: await api.ai.explain(aiRequest(current)) };
    } catch (err) {
      next = { status: 'error', message: err.message };
    }
    if (target !== current) return;
    ai = next;
    render();
  }

  function footer() {
    const busy = !lookups || preview?.mining;
    return h(
      'div',
      { class: 'popup-foot' },
      target.mode === 'word'
        ? h('button', { class: 'primary', disabled: busy, onclick: () => openPreview('word') }, 'Mine word')
        : null,
      h('button', { disabled: busy, onclick: () => openPreview('sentence') }, 'Mine sentence'),
    );
  }

  function openPreview(mode) {
    if (!target) return;
    preview = {
      ...draftFor(target, mode, lookups, selected),
      audio: null,
      picture: null,
      mediaError: null,
      translating: false,
      mining: false,
      error: null,
    };
    render();
    loadMedia();
    translateIfNeeded(preview);
  }

  async function translateIfNeeded(p) {
    const { autoTranslate } = await api.settings.get();
    if (!autoTranslate || preview !== p || p.fields.SentenceTranslation.trim()) return;
    p.translating = true;
    render();
    try {
      const translation = await api.ai.translate({
        sentence: rangeCue(p.range).text,
        context: contextFor(p.range.cues, p.range.from),
      });
      if (preview === p && !p.fields.SentenceTranslation.trim()) p.fields.SentenceTranslation = translation;
    } catch {}
    p.translating = false;
    render();
  }

  async function loadMedia() {
    const p = preview;
    if (!p) return;
    const seq = ++mediaSeq;
    try {
      const { audio, picture } = await api.anki.preview(
        previewRequest({ videoPath, timing: p.timing, audioStreamIndex: streamIndex() }),
      );
      if (seq !== mediaSeq || preview !== p) return;
      Object.assign(p, { audio, picture, mediaError: null });
    } catch (err) {
      if (seq !== mediaSeq || preview !== p) return;
      Object.assign(p, { audio: null, picture: null, mediaError: err.message });
    }
    render();
  }

  function scheduleMedia() {
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(loadMedia, MEDIA_DEBOUNCE_MS);
  }

  function nudgeTiming(edge, delta) {
    if (!preview) return;
    preview.timing = nudge(preview.timing, edge, delta);
    render();
    scheduleMedia();
  }

  function extendPreview(direction) {
    if (!preview) return;
    preview.range = extendRange(preview.range, direction);
    const cue = rangeCue(preview.range);
    preview.timing = { start: cue.start, end: cue.end };
    if (preview.mode === 'sentence') preview.fields.Word = cue.text;
    render();
    scheduleMedia();
  }

  async function confirmMine() {
    const p = preview;
    if (!p || p.mining) return;
    p.mining = true;
    p.error = null;
    render();
    try {
      await api.anki.mine(mineRequestFor(p, streamIndex(), videoPath));
    } catch (err) {
      p.mining = false;
      p.error = friendlyMineError(err.message);
      render();
      return;
    }
    toast('Added to Anki', 'success');
    if (preview === p) preview = null;
    onMined?.();
    render();
  }

  function previewPanel(p) {
    const cue = rangeCue(p.range);
    return h(
      'div',
      {
        class: 'mine-preview',
        onkeydown: (event) => {
          if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
            event.preventDefault();
            confirmMine();
          }
        },
      },
      h(
        'div',
        { class: 'mine-head' },
        h('span', { class: 'mine-title' }, p.mode === 'word' ? 'Word card' : 'Sentence card'),
        h(
          'button',
          {
            class: 'ghost small',
            title: 'Cancel',
            'aria-label': 'Cancel',
            disabled: p.mining,
            onclick: () => {
              preview = null;
              render();
            },
          },
          '×',
        ),
      ),
      mediaBlock(p),
      h('p', { class: 'sentence-head' }, cue.text),
      ...FIELD_ROWS.map(([key, label, multiline]) => fieldRow(p, key, label, multiline)),
      h(
        'details',
        {
          class: 'mine-adjust',
          open: p.adjustOpen === true,
          ontoggle: (event) => {
            p.adjustOpen = event.target.open;
          },
        },
        h('summary', {}, 'Adjust clip'),
        h(
          'div',
          { class: 'mine-timing' },
          nudgeGroup('Start', 'start', p.timing.start),
          nudgeGroup('End', 'end', p.timing.end),
          h('button', { class: 'small ghost', disabled: p.range.from === 0, onclick: () => extendPreview('previous') }, 'Add previous line'),
          h('button', { class: 'small ghost', disabled: p.range.to === p.range.cues.length - 1, onclick: () => extendPreview('next') }, 'Add next line'),
        ),
      ),
      p.error ? h('div', { class: 'banner' }, p.error) : null,
      h(
        'div',
        { class: 'mine-actions' },
        h('button', { class: 'primary', disabled: p.mining, onclick: confirmMine }, p.mining ? 'Adding…' : 'Confirm'),
      ),
    );
  }

  function mediaBlock(p) {
    if (p.mediaError) return h('p', { class: 'muted' }, `No media preview: ${p.mediaError}`);
    if (!p.audio) return h('p', { class: 'muted' }, 'Loading preview…');
    return h(
      'div',
      { class: 'mine-media' },
      h('img', { src: p.picture, alt: 'Screenshot' }),
      h('audio', { controls: true, src: p.audio }),
    );
  }

  function nudgeGroup(label, edge, value) {
    return h(
      'div',
      { class: 'nudge' },
      h('span', { class: 'label muted' }, `${label} ${value.toFixed(2)}s`),
      h('button', { class: 'small ghost', onclick: () => nudgeTiming(edge, -NUDGE_SECONDS) }, '−0.2'),
      h('button', { class: 'small ghost', onclick: () => nudgeTiming(edge, NUDGE_SECONDS) }, '+0.2'),
    );
  }

  function fieldRow(p, key, label, multiline) {
    const onInput = (event) => {
      p.fields[key] = event.target.value;
    };
    const translating = key === 'SentenceTranslation' && p.translating;
    const shared = {
      value: p.fields[key],
      oninput: onInput,
      disabled: p.mining,
      placeholder: translating ? 'Translating…' : null,
    };
    const control = multiline
      ? h('textarea', { rows: key === 'SentenceTranslation' ? 3 : 2, ...shared })
      : h('input', { type: 'text', ...shared });
    return h(
      'label',
      { class: 'mine-field' },
      h('span', { class: 'label muted' }, translating ? 'Translating…' : label),
      control,
    );
  }

  return {
    open: (next) => open(next),
    close,
    index: () => target?.index ?? -1,
    quickMine: async (next, { direct }) => {
      if (!direct) {
        open(next, { withPreview: true });
        return;
      }
      const lookups = next.mode === 'word' ? await lookupTarget(next) : null;
      try {
        await api.anki.mine(mineRequestFor(draftFor(next, next.mode, lookups, 0), streamIndex(), videoPath));
      } catch (err) {
        toast(friendlyMineError(err.message), 'error');
        return;
      }
      toast('Added to Anki', 'success');
      onMined?.();
    },
  };
}
