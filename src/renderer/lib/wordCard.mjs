// Shared word/kanji detail drawer. Self-contained: it injects its own <section class="wordcard">.
import { attempt, fill, h, toast } from './ui.mjs';
import {
  STATUS_META, STATUS_ORDER, formatPct, frequencyLabel, kanjiFacts, missingDownloads,
  pitchLabelFromPattern, rubyParts, splitAround,
} from './vocabView.mjs';

const DOWNLOADS = {
  kanjidic: {
    label: 'KANJIDIC',
    text: 'Kanji meanings, readings, grade and radical data.',
    credit: 'KANJIDIC © Electronic Dictionary Research and Development Group (EDRDG), CC BY-SA 4.0.',
    run: (api) => api.vocab.downloadKanjidic(),
    subscribe: (api, cb) => api.vocab.onKanjidicProgress(cb),
  },
  examples: {
    label: 'Example sentences',
    text: 'Example sentences that show words in use.',
    credit: 'Sentences from Tatoeba (CC BY).',
    run: (api) => api.vocab.downloadExamples(),
    subscribe: (api, cb) => api.vocab.onExamplesProgress(cb),
  },
};

export function mountWordCard(container, { word, onClose, onChanged }) {
  return mountCard(container, { kind: 'word', key: word }, { onClose, onChanged });
}

export function mountKanjiCard(container, { char, onClose, onChanged }) {
  return mountCard(container, { kind: 'kanji', key: char }, { onClose, onChanged });
}

function mountCard(container, start, { onClose, onChanged }) {
  const api = window.api;
  const section = h('section', { class: 'wordcard', role: 'dialog', 'aria-label': 'Word details' });
  const head = h('div', { class: 'wordcard-head' });
  const body = h('div', { class: 'wordcard-body' });
  section.append(head, body);
  container.append(section);

  const stack = [start];
  const disposers = [];
  let detail = null;
  let statusSlot = null;
  let loadSeq = 0;
  let closed = false;

  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    for (const dispose of disposers) dispose();
    section.remove();
    onClose?.();
  }

  function open(entry) {
    stack.push(entry);
    return load();
  }

  function back() {
    if (stack.length < 2) return;
    stack.pop();
    load();
  }

  function renderHead() {
    const current = stack.at(-1);
    fill(head, 
      stack.length > 1 ? h('button', { class: 'ghost small', onclick: back }, '← Back') : null,
      h('span', { class: 'wordcard-head-title' }, current.kind === 'word' ? 'Word' : 'Kanji'),
      h('button', { class: 'ghost small wordcard-close', 'aria-label': 'Close', onclick: close }, '×'),
    );
  }

  async function load() {
    const seq = ++loadSeq;
    const current = stack.at(-1);
    renderHead();
    fill(body, h('p', { class: 'muted' }, 'Loading…'));
    try {
      const [next, vocabStatus] = await Promise.all([
        current.kind === 'word' ? api.vocab.word(current.key) : api.vocab.kanji(current.key),
        api.vocab.status(),
      ]);
      if (closed || seq !== loadSeq) return;
      detail = next;
      render(current.kind, next, vocabStatus);
    } catch (err) {
      if (!closed && seq === loadSeq) fill(body, h('p', { class: 'wordcard-error', role: 'alert' }, err.message));
    }
  }

  function render(kind, d, vocabStatus) {
    statusSlot = h('div', { class: 'wordcard-status' });
    renderStatus();
    const content = kind === 'word' ? wordBody(d) : kanjiBody(d);
    fill(body, downloadPrompt(vocabStatus), content);
    section.scrollTop = 0;
  }

  function renderStatus() {
    const current = detail.status ?? 'new';
    fill(statusSlot, 
      h(
        'div',
        { class: 'wordcard-seg', role: 'group', 'aria-label': 'Status' },
        STATUS_ORDER.map((status) =>
          h(
            'button',
            {
              class: `wordcard-seg-btn ${STATUS_META[status].css}${status === current ? ' active' : ''}`,
              'aria-pressed': String(status === current),
              title: STATUS_META[status].hint,
              onclick: () => setStatus(status),
            },
            STATUS_META[status].label,
          ),
        ),
      ),
    );
  }

  async function setStatus(status) {
    const current = detail.status ?? 'new';
    if (status === current) return;
    const key = stack.at(-1).key;
    await attempt(async () => {
      const result = await api.known.mark({ word: key, status });
      if (closed) return;
      detail.status = status;
      renderStatus();
      onChanged?.({ key, status, stats: result?.stats });
    });
  }

  function downloadPrompt(vocabStatus) {
    const missing = missingDownloads(vocabStatus);
    if (!missing.length) return null;
    return h(
      'div',
      { class: 'wordcard-download' },
      h('p', {}, 'Some details need open data that is not downloaded yet.'),
      missing.map((key) => downloadRow(key)),
    );
  }

  function downloadRow(key) {
    const spec = DOWNLOADS[key];
    const fillEl = h('span', { class: 'progress-fill' });
    const bar = h('span', { class: 'progress wordcard-progress', hidden: true }, fillEl);
    const button = h('button', { class: 'small primary' }, `Download ${spec.label}`);
    const row = h('div', { class: 'wordcard-download-row' }, h('div', {}, h('strong', {}, spec.label), ' ', spec.text), h('small', { class: 'muted' }, spec.credit), button, bar);
    button.onclick = async () => {
      button.disabled = true;
      bar.hidden = false;
      const unsubscribe = spec.subscribe(api, (fraction) => {
        fillEl.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
      });
      disposers.push(unsubscribe);
      await attempt(async () => {
        await spec.run(api);
        toast(`${spec.label} downloaded`, 'success');
        if (!closed) await load();
      });
      unsubscribe();
      if (!closed) button.disabled = false;
    };
    return row;
  }

  function openTo(kind, key) {
    return () => open({ kind, key });
  }

  function wordBody(d) {
    const primary = d.entries[0];
    const headForm = primary?.forms[0];
    const headText = headForm?.text ?? d.key;
    const label = frequencyLabel(d.frequency);
    return [
      h('h2', { class: 'wordcard-title' }, rubyNode(rubyParts(headText, headForm?.reading))),
      statusSlot,
      h(
        'div',
        { class: 'wordcard-meta' },
        d.pitch ? pitchNode(d.pitch) : null,
        label ? h('span', { class: 'wordcard-badge' }, label) : null,
      ),
      d.entries.length
        ? [
            entrySection(primary),
            d.entries.length > 1
              ? h(
                  'details',
                  { class: 'wordcard-more' },
                  h('summary', {}, `Other entries (${d.entries.length - 1})`),
                  d.entries.slice(1).map(entrySection),
                )
              : null,
          ]
        : h('p', { class: 'muted' }, 'Not in the dictionary yet. Download JMdict from the Data tab.'),
      kanjiChips(d.kanji),
      usedInSection(d.usedInWords, d.usedInCount),
      examplesSection(d.examples, [d.key, ...(primary?.forms ?? []).map((f) => f.text)]),
    ];
  }

  function kanjiBody(d) {
    const facts = kanjiFacts(d);
    return [
      h('h2', { class: 'wordcard-title' }, d.char, d.keyword ? h('span', { class: 'wordcard-keyword' }, d.keyword) : null),
      statusSlot,
      h(
        'dl',
        { class: 'wordcard-facts' },
        h('dt', {}, 'Meanings'),
        h('dd', {}, d.meanings.length ? d.meanings.join(', ') : '—'),
        h('dt', {}, 'On'),
        h('dd', {}, d.on.length ? d.on.join('、') : '—'),
        h('dt', {}, 'Kun'),
        h('dd', {}, d.kun.length ? d.kun.join('、') : '—'),
      ),
      facts.length
        ? h(
            'ul',
            { class: 'wordcard-chips' },
            facts.map((fact) => h('li', { class: 'wordcard-fact' }, h('span', { class: 'muted' }, fact.label), ' ', fact.value)),
          )
        : null,
      usedInSection(d.usedInVocab, d.usedInCount),
      examplesSection(d.examples, [d.char]),
    ];
  }

  function rubyNode(parts) {
    return h(
      'span',
      { class: 'wordcard-ruby' },
      parts.map((part) => (part.rt ? h('ruby', {}, part.text, h('rt', {}, part.rt)) : part.text)),
    );
  }

  function pitchNode(pitch) {
    const label = pitchLabelFromPattern(pitch.patterns);
    return h(
      'span',
      { class: 'wordcard-pitch' },
      h('span', { class: 'muted' }, 'Pitch'),
      pitch.patterns.map((p) => h('span', { class: p.high ? 'mora high' : 'mora' }, p.mora)),
      label ? h('span', { class: 'muted' }, label) : null,
    );
  }

  function entrySection(entry) {
    return h(
      'section',
      { class: 'wordcard-entry' },
      h(
        'div',
        { class: 'wordcard-forms' },
        entry.forms.map((form) =>
          h(
            'span',
            { class: 'wordcard-form' },
            rubyNode(rubyParts(form.text, form.reading)),
            form.usagePct != null ? h('span', { class: 'wordcard-pct', title: 'Share of your indexed text' }, formatPct(form.usagePct)) : null,
          ),
        ),
      ),
      entry.senses.map((sense) =>
        h(
          'div',
          { class: 'wordcard-sense' },
          h('div', { class: 'wordcard-pos' }, sense.pos),
          h('ol', {}, sense.glosses.map((gloss) => h('li', {}, gloss))),
        ),
      ),
    );
  }

  function kanjiChips(kanji) {
    if (!kanji.length) return null;
    return h(
      'section',
      { class: 'wordcard-section' },
      h('h3', {}, 'Kanji used'),
      h(
        'div',
        { class: 'wordcard-chips' },
        kanji.map((item) =>
          h(
            'button',
            { class: 'wordcard-kanji-chip', onclick: openTo('kanji', item.char) },
            h('span', { class: 'wordcard-kanji-char' }, item.char),
            h('span', { class: 'wordcard-kanji-kw' }, item.keyword ?? '—'),
          ),
        ),
      ),
    );
  }

  function usedInSection(rows, total) {
    if (!rows.length) return null;
    return h(
      'section',
      { class: 'wordcard-section' },
      h('h3', {}, `Used in (${total})`),
      h(
        'ul',
        { class: 'wordcard-usedin' },
        rows.map((row) =>
          h(
            'li',
            {},
            h('button', { class: 'ghost wordcard-usedin-row', onclick: openTo('word', row.text) }, rubyNode(rubyParts(row.text, row.reading)), h('span', { class: 'muted' }, row.gloss ?? '')),
          ),
        ),
      ),
      total > rows.length ? h('p', { class: 'muted' }, `and ${total - rows.length} more`) : null,
    );
  }

  function examplesSection(examples, candidates) {
    if (!examples.length) return null;
    return h(
      'section',
      { class: 'wordcard-section' },
      h('h3', {}, 'Examples'),
      examples.map((example) => {
        const needle = candidates.find((text) => text && example.ja.includes(text)) ?? '';
        return h(
          'figure',
          { class: 'wordcard-example' },
          h(
            'p',
            { class: 'wordcard-ja' },
            splitAround(example.ja, needle).map((part) => (part.hit ? h('mark', {}, part.text) : part.text)),
          ),
          h('p', { class: 'wordcard-en' }, example.en),
        );
      }),
    );
  }

  load();
  section.tabIndex = -1;
  section.focus({ preventScroll: true });
  return { close };
}
