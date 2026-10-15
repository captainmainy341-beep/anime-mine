import { fill, h, toast } from '../lib/ui.mjs';
import { addableWords, grammarLine, nextFocusIndex, stageNote, wordAddInput } from './prepModel.mjs';

const api = window.api;
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function openPrep({ videoPath, title }) {
  const returnFocus = document.activeElement;
  let closed = false;
  let result = null;
  const added = new Set();
  const buttons = new Map();

  const closeButton = h('button', { class: 'ghost small', onclick: close }, 'Close');
  const body = h('div', { class: 'prep-body' }, h('p', { class: 'muted' }, 'Loading…'));
  const addAllButton = h('button', { class: 'small', onclick: addAll }, 'Add all');
  const overlay = h(
    'div',
    {
      class: 'prep-overlay',
      onclick: (e) => {
        if (e.target === e.currentTarget) close();
      },
    },
    h(
      'div',
      { class: 'prep-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Study prep' },
      h(
        'header',
        { class: 'prep-head' },
        h('div', {}, h('h2', {}, 'Study prep'), h('div', { class: 'muted prep-title' }, title)),
        closeButton,
      ),
      body,
    ),
  );

  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') trapFocus(e);
  }

  function trapFocus(e) {
    const focusable = [...overlay.querySelectorAll(FOCUSABLE)];
    const next = nextFocusIndex(focusable.indexOf(document.activeElement), focusable.length, e.shiftKey);
    if (next < 0) return;
    e.preventDefault();
    focusable[next].focus();
  }

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    returnFocus?.focus();
  }

  async function addWord(w) {
    await api.learn.addWord(wordAddInput(w));
    added.add(w.word);
    const button = buttons.get(w.word);
    if (button) {
      button.disabled = true;
      button.textContent = 'Added';
    }
  }

  async function addOne(w, button) {
    button.disabled = true;
    try {
      await addWord(w);
    } catch (err) {
      button.disabled = false;
      toast(err.message, 'error');
      return;
    }
    toast('Added to Learn', 'success');
  }

  async function addAll() {
    const pending = addableWords(result.words).filter((w) => !added.has(w.word));
    addAllButton.disabled = true;
    let count = 0;
    try {
      for (const w of pending) {
        if (closed) break;
        await addWord(w);
        count += 1;
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    addAllButton.disabled = addableWords(result.words).every((w) => added.has(w.word));
    if (count) toast(`Added ${count} ${count === 1 ? 'word' : 'words'} to Learn`, 'success');
  }

  function wordRow(w) {
    const gloss = w.meanings.find((m) => m.trim());
    const action = gloss
      ? h('button', { class: 'small', onclick: () => addOne(w, action) }, 'Add')
      : h('span', { class: 'muted prep-nogloss' }, 'no gloss');
    if (gloss) buttons.set(w.word, action);
    return h(
      'li',
      { class: 'prep-row' },
      h(
        'div',
        { class: 'prep-main' },
        h('span', { class: 'prep-word' }, w.word),
        w.reading ? h('span', { class: 'muted' }, w.reading) : null,
        w.count != null ? h('span', { class: 'chip' }, `×${w.count}`) : null,
      ),
      gloss ? h('div', { class: 'prep-gloss' }, gloss) : null,
      w.example ? h('div', { class: 'prep-example' }, w.example) : null,
      action,
    );
  }

  function grammarRow(g) {
    return h(
      'li',
      { class: 'prep-row' },
      h(
        'div',
        { class: 'prep-main' },
        h('span', { class: 'prep-word' }, grammarLine(g)),
        h('span', { class: 'chip' }, stageNote(g.stage)),
      ),
      g.meaning ? h('div', { class: 'prep-gloss' }, g.meaning) : null,
      g.example ? h('div', { class: 'prep-example' }, g.example) : null,
    );
  }

  function section(heading, rows, extra) {
    return h(
      'section',
      { class: 'prep-section' },
      h('div', { class: 'prep-section-head' }, h('h3', {}, heading), extra),
      rows.length ? h('ul', { class: 'prep-list' }, rows) : h('p', { class: 'muted' }, 'None found'),
    );
  }

  function render(data) {
    if (!data) {
      fill(body, h('p', { class: 'muted' }, 'No subtitles linked'));
      return;
    }
    result = data;
    const addable = addableWords(data.words);
    addAllButton.disabled = addable.length === 0 || addable.every((w) => added.has(w.word));
    fill(
      body,
      section(
        `Words (${data.words.length})`,
        data.words.map(wordRow),
        addAllButton,
      ),
      section(
        `Grammar (${data.grammar.length})`,
        data.grammar.map(grammarRow),
      ),
    );
  }

  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  closeButton.focus();

  api.learn
    .episodePrep({ videoPath })
    .then((data) => {
      if (!closed) render(data);
    })
    .catch((err) => {
      if (closed) return;
      toast(err.message, 'error');
      close();
    });

  return close;
}
