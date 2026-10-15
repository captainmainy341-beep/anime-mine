import { attempt, fill, h, toast } from './lib/ui.mjs';
import { createLimiter } from './lib/libraryView.mjs';
import { mountWordCard } from './lib/wordCard.mjs';
import {
  STATUS_META, STATUS_ORDER, statusChips, difficultyBand, difficultyColor, sortWorks, filterWorks,
  formatPct, formatCount, rowsToCsv, wordRowSummary,
} from './lib/vocabView.mjs';

const PAGE_SIZE = 100;
const SEARCH_DELAY_MS = 250;
const coverageLoad = createLimiter(2);
const TAB_LABELS = { words: 'Words', difficulty: 'Difficulty', extract: 'Extract', data: 'Data' };

const th = (text, props = {}) => h('th', props, text);
const formatDate = (ms) => (ms ? new Date(ms).toLocaleDateString() : '—');

function openInDrawer(drawer, state, mount) {
  state.card?.close();
  drawer.hidden = false;
  state.card = mount(drawer, () => {
    state.card = null;
    drawer.hidden = true;
  });
}

function mountWords(panel) {
  const api = window.api;
  const state = { alive: true, card: null };
  let status = null;
  let query = '';
  let offset = 0;
  let total = 0;
  let counts = {};
  let seq = 0;
  let searchTimer = null;

  const chips = h('div', { class: 'vocab-chips' });
  const tbody = h('tbody');
  const summary = h('span', { class: 'muted' });
  const prev = h('button', { class: 'ghost small', onclick: () => page(-1) }, 'Previous');
  const next = h('button', { class: 'ghost small', onclick: () => page(1) }, 'Next');
  const drawer = h('aside', { class: 'vocab-drawer', hidden: true });
  const search = h('input', {
    type: 'search',
    class: 'vocab-search',
    placeholder: 'Search words',
    'aria-label': 'Search words',
    maxlength: 100,
    oninput: () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        query = search.value.trim();
        offset = 0;
        load();
      }, SEARCH_DELAY_MS);
    },
  });

  fill(
    panel,
    h(
      'div',
      { class: 'vocab-split' },
      h(
        'div',
        { class: 'vocab-main' },
        h('div', { class: 'vocab-toolbar' }, chips, search),
        h(
          'div',
          { class: 'vocab-table-wrap' },
          h('table', { class: 'vocab-table' }, h('thead', {}, h('tr', {}, th('Word'), th('Source'), th('Status'), th('Added'))), tbody),
        ),
        h('div', { class: 'vocab-pager' }, summary, prev, next),
      ),
      drawer,
    ),
  );

  function renderChips() {
    const stored = statusChips(counts);
    const allCount = stored.reduce((sum, chip) => sum + chip.count, 0);
    const chipButton = (key, label, count) =>
      h(
        'button',
        { class: `vocab-chip${status === key ? ' active' : ''}`, onclick: () => setStatus(key) },
        label,
        ' ',
        h('span', { class: 'vocab-count' }, formatCount(count)),
      );
    fill(chips, 
      chipButton(null, 'All', allCount),
      stored.map((chip) => chipButton(chip.status, chip.label, chip.count)),
    );
  }

  function wordRow(row) {
    const select = h(
      'select',
      {
        class: 'vocab-select',
        'aria-label': `Status of ${row.word}`,
        onchange: (event) => changeStatus(row.word, event.target.value),
      },
      STATUS_ORDER.map((s) => h('option', { value: s, selected: s === row.status }, STATUS_META[s].label)),
    );
    return h(
      'tr',
      {},
      h('td', {}, h('button', { class: 'ghost vocab-word', onclick: () => openWord(row.word) }, row.word)),
      h('td', { class: 'muted' }, row.source ?? ''),
      h('td', {}, select),
      h('td', { class: 'muted' }, formatDate(row.added)),
    );
  }

  function renderRows(rows) {
    fill(tbody, 
      rows.length
        ? rows.map(wordRow)
        : h('tr', {}, h('td', { colspan: 4, class: 'muted' }, 'No words here yet. Mark words while watching or reading, or extract them from text.')),
    );
    const from = rows.length ? offset + 1 : 0;
    summary.textContent = `${formatCount(from)}–${formatCount(offset + rows.length)} of ${formatCount(total)}`;
    prev.disabled = offset === 0;
    next.disabled = offset + PAGE_SIZE >= total;
  }

  async function load() {
    const mine = ++seq;
    await attempt(async () => {
      const [nextCounts, list] = await Promise.all([
        api.vocab.counts(),
        api.vocab.list({ status: status ?? undefined, query: query || undefined, limit: PAGE_SIZE, offset }),
      ]);
      if (!state.alive || mine !== seq) return;
      counts = nextCounts;
      total = list.total;
      renderChips();
      renderRows(list.rows);
    });
  }

  function setStatus(next) {
    status = next;
    offset = 0;
    load();
  }

  function page(direction) {
    offset = Math.max(0, offset + direction * PAGE_SIZE);
    load();
  }

  async function changeStatus(word, nextStatus) {
    await attempt(async () => {
      const result = await api.known.mark({ word, status: nextStatus });
      if (result?.stats) counts = result.stats;
      await load();
    });
  }

  function openWord(word) {
    openInDrawer(drawer, state, (host, onClose) => mountWordCard(host, { word, onClose, onChanged: () => load() }));
  }

  load();
  return () => {
    state.alive = false;
    clearTimeout(searchTimer);
    state.card?.close();
  };
}

const DATA_SOURCES = [
  {
    key: 'dict',
    name: 'JMdict',
    text: 'Japanese-English dictionary: readings, meanings and parts of speech.',
    credit: 'JMdict © Electronic Dictionary Research and Development Group (EDRDG), CC BY-SA 4.0.',
    run: (api) => api.dict.download(),
    progress: (api, cb) => api.dict.onProgress(cb),
    ready: (status) => status.dict,
  },
  {
    key: 'kanjidic',
    name: 'KANJIDIC',
    text: 'Kanji meanings, on and kun readings, grade, JLPT level, strokes and radicals.',
    credit: 'KANJIDIC © Electronic Dictionary Research and Development Group (EDRDG), CC BY-SA 4.0.',
    run: (api) => api.vocab.downloadKanjidic(),
    progress: (api, cb) => api.vocab.onKanjidicProgress(cb),
    ready: (status) => status.kanjidic,
  },
  {
    key: 'examples',
    name: 'Example sentences',
    text: 'Japanese sentences with English translations, shown on word and kanji cards.',
    credit: 'Sentences from Tatoeba (CC BY).',
    run: (api) => api.vocab.downloadExamples(),
    progress: (api, cb) => api.vocab.onExamplesProgress(cb),
    ready: (status) => status.examples,
  },
  {
    key: 'pitch',
    name: 'Pitch accents',
    text: 'Accent pattern for each word, shown on word cards.',
    credit: 'Open pitch accent data from the kanjium project (see src/core/pitch.js).',
    run: (api) => api.pitch.download(),
    progress: (api, cb) => api.pitch.onProgress(cb),
    ready: (status) => status.pitch,
  },
];

async function dataStatus(api) {
  const [vocab, dict, pitch] = await Promise.all([api.vocab.status(), api.dict.status(), api.pitch.status()]);
  return { dict: dict.ready, kanjidic: vocab.kanjidic, examples: vocab.examples, pitch: pitch.ready };
}

function mountData(panel) {
  const api = window.api;
  const state = { alive: true, active: null };
  const subs = [];
  const cards = new Map();

  for (const spec of DATA_SOURCES) {
    const fillEl = h('span', { class: 'progress-fill' });
    const bar = h('span', { class: 'progress vocab-progress', hidden: true }, fillEl);
    const chip = h('span', { class: 'vocab-status' }, '…');
    const button = h('button', { class: 'small primary', disabled: true, onclick: () => download(spec) }, 'Download');
    cards.set(spec.key, { chip, button, bar, fillEl });
    subs.push(
      spec.progress(api, (fraction) => {
        if (!state.alive || state.active !== spec.key) return;
        const percent = Number.isFinite(fraction) ? Math.round(Math.min(1, Math.max(0, fraction)) * 100) : 0;
        fillEl.style.width = `${percent}%`;
      }),
    );
  }

  fill(
    panel,
    h(
      'div',
      { class: 'vocab-data' },
      h(
        'p',
        { class: 'vocab-note' },
        'These are open datasets stored on this computer. Each download is needed once; the app keeps the copy locally.',
      ),
      DATA_SOURCES.map((spec) => {
        const card = cards.get(spec.key);
        return h(
          'section',
          { class: 'vocab-data-card' },
          h('div', { class: 'vocab-data-head' }, h('h2', {}, spec.name), card.chip),
          h('p', {}, spec.text),
          h('p', { class: 'muted vocab-credit' }, spec.credit),
          h('div', { class: 'vocab-data-actions' }, card.button, card.bar),
        );
      }),
    ),
  );

  async function refresh() {
    await attempt(async () => {
      const status = await dataStatus(api);
      if (!state.alive) return;
      for (const spec of DATA_SOURCES) {
        const card = cards.get(spec.key);
        const ready = Boolean(spec.ready(status));
        card.chip.textContent = ready ? 'Ready' : 'Not downloaded';
        card.chip.className = `vocab-status ${ready ? 'status-known' : 'status-new'}`;
        card.button.textContent = ready ? 'Downloaded' : 'Download';
        card.button.disabled = ready;
      }
    });
  }

  async function download(spec) {
    const card = cards.get(spec.key);
    state.active = spec.key;
    card.button.disabled = true;
    card.bar.hidden = false;
    card.fillEl.style.width = '0%';
    await attempt(async () => {
      await spec.run(api);
      toast(`${spec.name} ready`, 'success');
    });
    state.active = null;
    card.bar.hidden = true;
    if (state.alive) await refresh();
  }

  refresh();
  return () => {
    state.alive = false;
    for (const off of subs) off();
  };
}

const WORK_COLUMNS = [
  ['title', 'Title'],
  ['difficulty', 'Difficulty'],
  ['words', 'Words'],
  ['uniqueWords', 'Unique words'],
  ['uniqueOncePct', 'Unique once'],
  ['uniqueKanji', 'Unique kanji'],
  ['avgSentenceLength', 'Avg sentence'],
  ['knownPct', 'Your coverage'],
];
const KINDS = ['anime', 'manga'];
const EMPTY_WORKS = {
  anime: 'No anime indexed yet. Use Index my anime above.',
  manga: 'No manga indexed yet. Index a volume from the Manga tab.',
};
const DIFFICULTY_NOTE = "Difficulty is a local estimate from your indexed text, not jpdb's model.";
const BULK_STATUSES = ['learning', 'known', 'blacklisted'];

function difficultyCell(score) {
  const width = Math.min(100, Math.max(0, score));
  return h(
    'span',
    { class: 'vocab-difficulty' },
    h('span', { class: 'vocab-bar' }, h('span', { class: 'vocab-bar-fill', style: `width: ${width}%; background: ${difficultyColor(score)}` })),
    h('span', { class: 'vocab-band' }, `${Math.round(score)} · ${difficultyBand(score)}`),
  );
}

const statRow = (label, value) => [h('dt', {}, label), h('dd', {}, value)];

function mountDifficulty(panel) {
  const api = window.api;
  const state = { alive: true, works: { anime: [], manga: [] }, sort: { key: 'difficulty', dir: 'desc' }, selected: null, card: null };
  const coverages = new Map();
  const queued = new Set();
  const subs = [];
  const bodies = Object.fromEntries(KINDS.map((kind) => [kind, h('tbody')]));
  const sortButtons = new Map(WORK_COLUMNS.map(([key, label]) => [key, h('button', { class: 'ghost vocab-sort', onclick: () => sortBy(key) }, label)]));
  const search = h('input', {
    type: 'search',
    class: 'vocab-search',
    placeholder: 'Filter by title',
    'aria-label': 'Filter by title',
    oninput: () => {
      query = search.value.trim();
      renderTables();
    },
  });
  const progress = h('span', { class: 'muted' });
  const indexBtn = h('button', { class: 'primary', onclick: () => indexAnime() }, 'Index my anime');
  const detail = h('aside', { class: 'vocab-detail', hidden: true });
  const drawer = h('aside', { class: 'vocab-drawer', hidden: true });
  let query = '';
  let worksSeq = 0;
  let detailSeq = 0;

  subs.push(
    api.corpus.onProgress((p) => {
      if (state.alive) progress.textContent = `Indexing ${p.done}/${p.total}: ${p.title}`;
    }),
  );

  fill(
    panel,
    h(
      'div',
      { class: 'vocab-split' },
      h(
        'div',
        { class: 'vocab-main' },
        h('div', { class: 'vocab-toolbar' }, search, indexBtn, progress),
        h('p', { class: 'vocab-note' }, DIFFICULTY_NOTE),
        KINDS.map((kind) =>
          h(
            'section',
            { class: 'vocab-section' },
            h('h2', {}, kind === 'anime' ? 'Anime' : 'Manga'),
            h(
              'div',
              { class: 'vocab-table-wrap' },
              h(
                'table',
                { class: 'vocab-table' },
                h('thead', {}, h('tr', {}, WORK_COLUMNS.map(([key]) => h('th', {}, sortButtons.get(key))))),
                bodies[kind],
              ),
            ),
          ),
        ),
      ),
      detail,
      drawer,
    ),
  );

  function sortBy(key) {
    const dir =
      state.sort.key === key ? (state.sort.dir === 'desc' ? 'asc' : 'desc') : key === 'title' ? 'asc' : 'desc';
    state.sort = { key, dir };
    renderTables();
  }

  function withCoverage(work) {
    return { ...work, knownPct: coverages.get(work.id)?.knownPct };
  }

  function renderTables() {
    for (const [key, button] of sortButtons) {
      const [, label] = WORK_COLUMNS.find(([k]) => k === key);
      const arrow = state.sort.key === key ? (state.sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
      button.textContent = `${label}${arrow}`;
    }
    for (const kind of KINDS) {
      const rows = sortWorks(filterWorks(state.works[kind], query), state.sort.key, state.sort.dir).map(withCoverage);
      fill(bodies[kind], 
        rows.length
          ? rows.map(workRow)
          : h('tr', {}, h('td', { colspan: WORK_COLUMNS.length, class: 'muted' }, EMPTY_WORKS[kind])),
      );
    }
  }

  function workRow(work) {
    const coverage = !coverages.has(work.id) ? '…' : coverages.get(work.id) ? formatPct(coverages.get(work.id).knownPct) : '—';
    return h(
      'tr',
      { class: state.selected?.id === work.id ? 'selected' : null, onclick: () => openDetail(work) },
      h('td', {}, work.title),
      h('td', {}, difficultyCell(work.difficulty)),
      h('td', {}, formatCount(work.words)),
      h('td', {}, formatCount(work.uniqueWords)),
      h('td', {}, formatPct(work.uniqueOncePct)),
      h('td', {}, formatCount(work.uniqueKanji)),
      h('td', {}, String(work.avgSentenceLength)),
      h('td', {}, coverage),
    );
  }

  function queueCoverage(id) {
    if (queued.has(id)) return;
    queued.add(id);
    coverageLoad(async () => {
      if (!state.alive) return;
      const coverage = await api.corpus.coverage(id).catch(() => null);
      if (!state.alive) return;
      coverages.set(id, coverage);
      renderTables();
    });
  }

  async function loadWorks() {
    const mine = ++worksSeq;
    await attempt(async () => {
      const [anime, manga] = await Promise.all([api.corpus.works({ kind: 'anime' }), api.corpus.works({ kind: 'manga' })]);
      if (!state.alive || mine !== worksSeq) return;
      state.works = { anime, manga };
      renderTables();
      for (const work of [...anime, ...manga]) queueCoverage(work.id);
    });
  }

  async function indexAnime() {
    indexBtn.disabled = true;
    progress.textContent = 'Starting…';
    await attempt(async () => {
      const result = await api.corpus.indexAnime();
      toast(`Indexed ${result.indexed} shows, skipped ${result.skipped}`, 'success');
    });
    progress.textContent = '';
    if (!state.alive) return;
    indexBtn.disabled = false;
    coverages.clear();
    queued.clear();
    await loadWorks();
  }

  async function openDetail(work) {
    state.selected = work;
    renderTables();
    const mine = ++detailSeq;
    detail.hidden = false;
    fill(detail, h('p', { class: 'muted' }, 'Loading…'));
    try {
      const [stats, coverage] = await Promise.all([api.corpus.stats(work.id), api.corpus.coverage(work.id)]);
      if (!state.alive || mine !== detailSeq) return;
      coverages.set(work.id, coverage);
      renderTables();
      renderDetail(work, stats, coverage);
    } catch (err) {
      if (state.alive && mine === detailSeq) fill(detail, h('p', { class: 'wordcard-error', role: 'alert' }, err.message));
    }
  }

  function closeDetail() {
    detail.hidden = true;
    state.selected = null;
    renderTables();
  }

  function renderDetail(work, stats, coverage) {
    const topNew = coverage?.topNew ?? [];
    fill(
      detail,
      h(
        'div',
        { class: 'vocab-detail-head' },
        h('h2', {}, work.title),
        h('button', { class: 'ghost small', 'aria-label': 'Close details', onclick: closeDetail }, '×'),
      ),
      h(
        'dl',
        { class: 'vocab-stats' },
        statRow('Difficulty', `${Math.round(stats.difficulty)} · ${difficultyBand(stats.difficulty)}`),
        statRow('Peak difficulty', String(stats.peakDifficulty)),
        statRow('Words', formatCount(stats.words)),
        statRow('Unique words', formatCount(stats.uniqueWords)),
        statRow('Unique once', formatPct(stats.uniqueOncePct)),
        statRow('Unique kanji', formatCount(stats.uniqueKanji)),
        statRow('Kanji seen once', formatCount(stats.kanjiOnce)),
        statRow('Characters', formatCount(stats.characters)),
        statRow('Avg sentence', String(stats.avgSentenceLength)),
      ),
      coverage
        ? h('p', {}, `Known ${formatPct(coverage.knownPct)} of ${formatCount(coverage.totalWords)} words · ${formatCount(coverage.unknownUnique)} unknown unique`)
        : h('p', { class: 'muted' }, 'No indexed words.'),
      topNew.length
        ? h(
            'section',
            { class: 'vocab-top-new' },
            h('h3', {}, 'Top new words'),
            h(
              'ul',
              {},
              topNew.map(({ word, count }) =>
                h('li', {}, h('button', { class: 'ghost vocab-word', onclick: () => openWord(word) }, word), ' ', h('span', { class: 'muted' }, `×${count}`)),
              ),
            ),
            h(
              'div',
              { class: 'vocab-bulk' },
              h('button', { class: 'small', onclick: () => markShown(topNew, 'learning', work) }, 'Mark all as learning'),
              h('button', { class: 'small', onclick: () => markShown(topNew, 'known', work) }, 'Mark all as known'),
            ),
          )
        : null,
      h('div', { class: 'vocab-danger' }, h('button', { class: 'ghost small', onclick: () => removeWork(work) }, 'Remove from list')),
    );
  }

  async function markShown(list, status, work) {
    await attempt(async () => {
      for (const { word } of list) await api.known.mark({ word, status });
      toast(`Marked ${formatCount(list.length)} as ${STATUS_META[status].label.toLowerCase()}`, 'success');
    });
    if (state.alive) openDetail(work);
  }

  async function removeWork(work) {
    if (!window.confirm(`Remove "${work.title}" from the difficulty list? You can index it again later.`)) return;
    await attempt(async () => {
      await api.corpus.removeWork(work.id);
      toast('Removed', 'success');
    });
    if (!state.alive) return;
    coverages.delete(work.id);
    queued.delete(work.id);
    closeDetail();
    await loadWorks();
  }

  function openWord(word) {
    openInDrawer(drawer, state, (host, onClose) =>
      mountWordCard(host, {
        word,
        onClose,
        onChanged: () => {
          if (state.selected) openDetail(state.selected);
        },
      }),
    );
  }

  loadWorks();
  return () => {
    state.alive = false;
    for (const off of subs) off();
    state.card?.close();
  };
}

function mountExtract(panel) {
  const api = window.api;
  const state = { alive: true, rows: [], wordList: '', onlyUnknown: false, selected: new Set(), card: null };
  const textarea = h('textarea', { class: 'vocab-input', rows: 8, placeholder: 'Paste Japanese text here', 'aria-label': 'Text to extract' });
  const onlyUnknown = h('input', { type: 'checkbox' });
  const summary = h('span', { class: 'muted' });
  const copyList = h('button', { class: 'ghost small', disabled: true, onclick: () => copy(state.wordList, 'word list') }, 'Copy word list');
  const copyCsv = h(
    'button',
    { class: 'ghost small', disabled: true, onclick: () => copy(rowsToCsv(visibleRows(), ['word', 'reading', 'count', 'status']), 'CSV') },
    'Copy CSV',
  );
  const tbody = h('tbody');
  const selectAll = h('input', {
    type: 'checkbox',
    'aria-label': 'Select all shown',
    onchange: (event) => {
      for (const row of visibleRows()) {
        if (event.target.checked) state.selected.add(row.word);
        else state.selected.delete(row.word);
      }
      renderRows();
    },
  });
  const drawer = h('aside', { class: 'vocab-drawer', hidden: true });

  const bulkRow = (label, words) =>
    h(
      'div',
      { class: 'vocab-bulk' },
      h('span', { class: 'muted' }, label),
      BULK_STATUSES.map((status) => h('button', { class: 'small', onclick: () => markWords(words(), status) }, STATUS_META[status].label)),
    );

  fill(
    panel,
    h(
      'div',
      { class: 'vocab-split' },
      h(
        'div',
        { class: 'vocab-main' },
        textarea,
        h(
          'div',
          { class: 'vocab-toolbar' },
          h('label', { class: 'vocab-check' }, onlyUnknown, ' Only unknown words'),
          h('button', { class: 'primary', onclick: run }, 'Extract'),
          copyList,
          copyCsv,
          summary,
        ),
        h(
          'div',
          { class: 'vocab-bulk-block' },
          bulkRow('Selected:', () => [...state.selected]),
          bulkRow('All unknown:', () => state.rows.filter((r) => r.status === 'new').map((r) => r.word)),
        ),
        h(
          'div',
          { class: 'vocab-table-wrap' },
          h(
            'table',
            { class: 'vocab-table' },
            h('thead', {}, h('tr', {}, h('th', {}, selectAll), h('th', {}, 'Word'), h('th', {}, 'Reading'), h('th', {}, 'Count'), h('th', {}, 'Status'))),
            tbody,
          ),
        ),
      ),
      drawer,
    ),
  );
  renderRows();

  function visibleRows() {
    return state.onlyUnknown ? state.rows.filter((r) => r.status === 'new') : state.rows;
  }

  async function run() {
    const text = textarea.value;
    if (!text.trim()) {
      toast('Paste some text first', 'error');
      return;
    }
    await attempt(async () => {
      const result = await api.vocab.extract({ text, onlyUnknown: onlyUnknown.checked });
      if (!state.alive) return;
      state.rows = result.rows;
      state.wordList = result.wordList;
      state.onlyUnknown = onlyUnknown.checked;
      state.selected.clear();
      copyList.disabled = !state.rows.length;
      copyCsv.disabled = !state.rows.length;
      renderRows();
    });
  }

  function renderRows() {
    const rows = visibleRows();
    selectAll.checked = rows.length > 0 && rows.every((r) => state.selected.has(r.word));
    summary.textContent = `${formatCount(rows.length)} words · ${formatCount(state.selected.size)} selected`;
    fill(tbody, 
      rows.length
        ? rows.map(extractRow)
        : h('tr', {}, h('td', { colspan: 5, class: 'muted' }, state.rows.length ? 'No unknown words in this text.' : 'Paste text and press Extract.')),
    );
  }

  function extractRow(row) {
    const meta = STATUS_META[row.status] ?? STATUS_META.new;
    return h(
      'tr',
      { title: wordRowSummary(row) },
      h(
        'td',
        {},
        h('input', {
          type: 'checkbox',
          'aria-label': `Select ${row.word}`,
          checked: state.selected.has(row.word),
          onchange: (event) => toggle(row.word, event.target.checked),
        }),
      ),
      h('td', {}, h('button', { class: 'ghost vocab-word', onclick: () => openWord(row.word) }, row.word)),
      h('td', { class: 'muted' }, row.reading ?? ''),
      h('td', {}, String(row.count)),
      h('td', {}, h('span', { class: `vocab-status ${meta.css}` }, meta.label)),
    );
  }

  function toggle(word, on) {
    if (on) state.selected.add(word);
    else state.selected.delete(word);
    renderRows();
  }

  async function markWords(words, status) {
    if (!words.length) {
      toast('No words to mark', 'error');
      return;
    }
    await attempt(async () => {
      for (const word of words) await api.known.mark({ word, status });
      toast(`Marked ${formatCount(words.length)} as ${STATUS_META[status].label.toLowerCase()}`, 'success');
    });
    if (state.alive && state.rows.length) await run();
  }

  async function copy(text, label) {
    await attempt(async () => {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${label}`, 'success');
    });
  }

  function openWord(word) {
    openInDrawer(drawer, state, (host, onClose) => mountWordCard(host, { word, onClose, onChanged: () => run() }));
  }

  return () => {
    state.alive = false;
    state.card?.close();
  };
}

export function mountVocab(container) {
  const panel = h('div', { class: 'vocab-panel' });
  const tabs = new Map();
  let selected = null;
  let disposeTab = null;

  function select(key) {
    if (key === selected) return;
    disposeTab?.();
    selected = key;
    for (const [name, button] of tabs) {
      button.classList.toggle('active', name === key);
      button.setAttribute('aria-selected', String(name === key));
    }
    panel.replaceChildren();
    disposeTab = MOUNTS[key](panel);
  }

  for (const [key, label] of Object.entries(TAB_LABELS)) {
    tabs.set(key, h('button', { class: 'vocab-tab', role: 'tab', onclick: () => select(key) }, label));
  }

  const MOUNTS = { words: mountWords, difficulty: mountDifficulty, extract: mountExtract, data: mountData };

  fill(
    container,
    h(
      'section',
      { class: 'page vocab' },
      h('div', { class: 'page-head' }, h('h1', {}, 'Vocab')),
      h('nav', { class: 'vocab-tabs', role: 'tablist' }, [...tabs.values()]),
      panel,
    ),
  );
  select('words');

  return () => {
    disposeTab?.();
    disposeTab = null;
  };
}
