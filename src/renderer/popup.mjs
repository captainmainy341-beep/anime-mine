import { tokenizeCached } from './lib/nlp.mjs';
import { fill, h, toast } from './lib/ui.mjs';

const api = window.api;
let onDictProgress = null;
api.dict.onProgress((fraction) => onDictProgress?.(fraction));

async function lookupWords({ mode, cues, index, token }) {
  const tokens =
    mode === 'word' ? [token] : (await tokenizeCached(cues[index].text)).filter((t) => t.isWord);
  return Promise.all(tokens.map(async (t) => ({ token: t, entries: await api.dict.lookup(t) })));
}

function aiRequest({ mode, cues, index, token }) {
  const req = {
    sentence: cues[index].text,
    context: cues.slice(Math.max(0, index - 2), index).map((cue) => cue.text),
  };
  if (mode === 'word') req.word = token.surface;
  return req;
}

function glossesOf(entry) {
  return entry ? entry.senses.flatMap((sense) => sense.glosses).join('; ') : '';
}

function firstGloss(entries) {
  return entries[0]?.senses[0]?.glosses[0] ?? '—';
}

function progressBar(fraction) {
  const bar = h('div', { class: 'progress-fill' });
  bar.style.width = `${Math.round(fraction * 100)}%`;
  return h('div', { class: 'progress' }, bar);
}

export function createPopup(slot, { videoPath, onOpenSettings, onMined }) {
  let target = null;
  let tab = 'dictionary';
  let lookups = null;
  let selected = 0;
  let mining = false;
  let ai = { status: 'idle' };
  const dict = { ready: true, downloading: false, progress: 0 };

  onDictProgress = (fraction) => {
    dict.progress = fraction;
    render();
  };

  function open(next) {
    target = next;
    tab = 'dictionary';
    lookups = null;
    selected = 0;
    ai = { status: 'idle' };
    slot.hidden = false;
    render();
    load();
  }

  function close() {
    target = null;
    slot.hidden = true;
    slot.replaceChildren();
  }

  async function load() {
    const current = target;
    const { ready } = await api.dict.status();
    if (target !== current) return;
    dict.ready = ready;
    lookups = ready ? await lookupWords(current) : [];
    if (target !== current) return;
    render();
  }

  function render() {
    if (!target) return;
    fill(
      slot,
      head(),
      dict.ready ? null : dictBanner(),
      tabs(),
      h('div', { class: 'popup-body' }, tab === 'dictionary' ? dictionaryPanel() : aiPanel()),
      footer(),
    );
  }

  function head() {
    const { mode, cues, index, token } = target;
    const title =
      mode === 'word'
        ? h(
            'div',
            { class: 'popup-title' },
            h('span', { class: 'surface' }, token.surface),
            token.reading ? h('span', { class: 'reading' }, token.reading) : null,
          )
        : h(
            'div',
            { class: 'popup-title' },
            h('span', { class: 'label muted' }, 'Sentence'),
            h('p', { class: 'sentence-head' }, cues[index].text),
          );
    return h(
      'div',
      { class: 'popup-head' },
      title,
      h('button', { class: 'ghost small', title: 'Close (Esc)', onclick: close }, '×'),
    );
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
    return target.mode === 'word' ? wordEntries() : sentenceWords();
  }

  function wordEntries() {
    const entries = lookups[0].entries;
    if (!entries.length) {
      return h('p', { class: 'muted' }, `No dictionary entry for “${target.token.surface}”.`);
    }
    return entries.map(entryCard);
  }

  function entryCard(entry, i) {
    return h(
      'div',
      {
        class: `entry${i === selected ? ' selected' : ''}`,
        onclick: () => {
          selected = i;
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
    return lookups.map(({ token, entries }) =>
      h(
        'div',
        { class: 'word-row' },
        h('span', { class: 'w' }, token.surface),
        h('span', { class: 'r' }, token.reading),
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
    return h(
      'div',
      { class: 'popup-foot' },
      target.mode === 'word' ? h('button', { class: 'primary', disabled: mining, onclick: () => mine('word') }, 'Mine word') : null,
      h('button', { disabled: mining, onclick: () => mine('sentence') }, 'Mine sentence'),
    );
  }

  function selectedEntry() {
    return lookups?.[0]?.entries[selected];
  }

  function mineRequest(mode) {
    const { cues, index, token } = target;
    const cue = cues[index];
    const req = { videoPath, cue: { start: cue.start, end: cue.end, text: cue.text }, mode };
    if (mode === 'word') {
      req.word = { surface: token.surface, base: token.base, reading: token.reading };
      const meaning = glossesOf(selectedEntry());
      if (meaning) req.meaning = meaning;
    }
    if (ai.status === 'done') req.translation = ai.text;
    return req;
  }

  async function mine(mode) {
    mining = true;
    render();
    try {
      await api.anki.mine(mineRequest(mode));
      toast('Added to Anki', 'success');
      onMined?.();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      mining = false;
      render();
    }
  }

  return {
    open,
    close,
    index: () => target?.index ?? -1,
  };
}
