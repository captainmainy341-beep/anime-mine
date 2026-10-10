import { attempt, fill, h, toast } from './lib/ui.mjs';
import {
  forecastBars,
  formatHistory,
  formatRetention,
  formatStreak,
  highlightParts,
  modeSummary,
  stateBadge,
} from './lib/ankiView.mjs';

const api = window.api;

const MODES = [
  ['hidden', 'Hidden'],
  ['sample', 'Sample'],
  ['live', 'Live'],
];
const TABS = [
  ['overview', 'Overview'],
  ['mined', 'Mined'],
  ['browse', 'Browse'],
];
const FILTERS = [
  ['all', 'All'],
  ['due', 'Due'],
  ['new', 'New'],
  ['learn', 'Learning'],
  ['suspended', 'Suspended'],
];
const SEARCH_DELAY_MS = 250;
const BROWSE_LIMIT = 300;

const button = (label, onclick, cls) => h('button', { type: 'button', class: cls, onclick }, label);

const panel = (title, text, ...actions) =>
  h(
    'section',
    { class: 'anki-panel' },
    h('h2', {}, title),
    h('p', { class: 'anki-sub' }, text),
    actions.length ? h('div', { class: 'panel-actions' }, actions) : null,
  );

const emptyBox = (title, text) => h('div', { class: 'empty' }, h('h2', {}, title), h('p', { class: 'anki-sub' }, text));

export function mountAnki(container) {
  let disposed = false;
  let loadSeq = 0;
  let searchTimer = null;
  let requestedMode = null;
  let setViewChain = Promise.resolve();
  let refs = null; // DOM handles for the Browse tab, rebuilt each time it opens
  const state = {
    view: null,
    summary: 'loading',
    overview: null,
    tab: 'overview',
    browse: { deck: null, filter: 'all', query: '', cards: [], selectedId: null, loading: false, seq: 0 },
  };
  const mediaCache = new Map();
  const lazyLoads = new WeakMap();
  const observer =
    'IntersectionObserver' in window ? new IntersectionObserver(onVisible, { rootMargin: '200px' }) : null;

  const modeSwitch = h('div', { class: 'seg', role: 'group', 'aria-label': 'Data mode' });
  const body = h('div', { class: 'anki-body' });
  const root = h(
    'section',
    { class: 'page anki' },
    h(
      'div',
      { class: 'anki-head' },
      h('div', {}, h('h1', {}, 'Anki'), h('div', { class: 'sub' }, 'Your decks and mined cards, read from Anki on demand')),
      modeSwitch,
    ),
    body,
  );
  container.append(root);
  document.addEventListener('keydown', onKeydown);
  load();

  return () => {
    disposed = true;
    clearTimeout(searchTimer);
    document.removeEventListener('keydown', onKeydown);
    observer?.disconnect();
  };

  // Data loading and mode

  async function load() {
    const seq = ++loadSeq;
    try {
      const view = await api.anki.getView();
      const summary = modeSummary(view);
      const overview = summary === 'sample' || summary === 'ready' ? await api.anki.overview() : null;
      if (disposed || seq !== loadSeq) return;
      Object.assign(state, { view, summary, overview });
    } catch (err) {
      if (disposed || seq !== loadSeq) return;
      toast(err.message, 'error');
      state.summary = 'failed';
    }
    renderModeSwitch();
    renderBody();
  }

  // Everything tied to the current mode / deck allow-list; stale pending loads are dropped via the seq counters.
  function resetScope() {
    loadSeq++;
    clearTimeout(searchTimer);
    Object.assign(state.browse, { deck: null, filter: 'all', query: '', cards: [], selectedId: null, loading: false });
    state.browse.seq++;
    state.overview = null;
    mediaCache.clear();
  }

  function setMode(mode) {
    if ((requestedMode ?? state.view?.mode) === mode) return;
    requestedMode = mode;
    resetScope();
    setViewChain = setViewChain.catch(() => {}).then(() => api.anki.setView({ mode }));
    const mine = setViewChain;
    return attempt(async () => {
      try {
        await mine;
      } finally {
        if (requestedMode === mode && mine === setViewChain) requestedMode = null;
      }
      if (!disposed && mine === setViewChain) await load();
    });
  }

  function renderModeSwitch() {
    const current = state.view?.mode ?? null;
    fill(
      modeSwitch,
      MODES.map(([mode, label]) =>
        h(
          'button',
          { type: 'button', 'aria-pressed': String(mode === current), onclick: () => setMode(mode) },
          label,
        ),
      ),
    );
  }

  function renderBody() {
    switch (state.summary) {
      case 'hidden':
        fill(body, hiddenPanel());
        break;
      case 'connect':
        fill(body, panel('Can’t reach Anki', 'Open Anki with the AnkiConnect add-on, then press Retry.', button('Retry', () => load(), 'primary')));
        break;
      case 'pick':
        renderPicker();
        break;
      case 'sample':
      case 'ready':
        renderSection();
        break;
      case 'failed':
        fill(body, panel('Couldn’t read the Anki section', 'Check that Anki is open with AnkiConnect, then try again.', button('Retry', () => load(), 'primary')));
        break;
      default:
        fill(body, h('p', { class: 'anki-sub anki-loading' }, 'Loading…'));
    }
  }

  function hiddenPanel() {
    return panel(
      'Your Anki decks are hidden',
      'Nothing is loaded from Anki until you connect. You can preview the section with sample data first.',
      button('Preview with sample data', () => setMode('sample')),
      button('Connect my Anki', () => setMode('live'), 'primary'),
    );
  }

  // Deck picker (live mode, no visible decks yet, or reopened via "Choose decks")

  async function renderPicker({ back = false } = {}) {
    const pickerSeq = loadSeq;
    const checked = new Set(back ? state.view?.visibleDecks ?? [] : []);
    fill(body, h('p', { class: 'anki-sub anki-loading' }, 'Loading decks…'));
    let names;
    try {
      names = (await api.anki.listDecks()) ?? [];
    } catch (err) {
      if (disposed || pickerSeq !== loadSeq) return;
      toast(err.message, 'error');
      fill(body, panel('Couldn’t load your decks', 'Check that Anki is open with AnkiConnect, then try again.', button('Retry', () => renderPicker({ back }), 'primary')));
      return;
    }
    if (disposed || pickerSeq !== loadSeq) return;

    const submit = button('Show selected decks', () => showSelected(), 'primary');
    const sync = () => {
      submit.disabled = checked.size === 0;
    };
    const list = names.length
      ? h(
          'ul',
          { class: 'deck-check' },
          names.map((name) => {
            const box = h('input', {
              type: 'checkbox',
              onchange: (e) => {
                if (e.target.checked) checked.add(name);
                else checked.delete(name);
                sync();
              },
            });
            box.checked = checked.has(name);
            return h('li', {}, h('label', {}, box, h('span', {}, name)));
          }),
        )
      : h('p', { class: 'anki-sub' }, 'Anki has no decks yet.');
    sync();

    fill(
      body,
      h(
        'section',
        { class: 'anki-panel picker' },
        h('h2', {}, 'Choose the decks to show'),
        h('p', { class: 'anki-sub' }, 'Only the decks you tick are read from Anki.'),
        list,
        h(
          'div',
          { class: 'panel-actions' },
          back ? button('Cancel', () => renderBody(), 'ghost') : null,
          submit,
        ),
      ),
    );

    function showSelected() {
      return attempt(async () => {
        resetScope();
        await api.anki.setView({ visibleDecks: [...checked] });
        await load();
      });
    }
  }

  // Tabs

  function renderSection() {
    if (!state.overview) {
      fill(body, h('p', { class: 'anki-sub anki-loading' }, 'Loading…'));
      return;
    }
    const tabs = h(
      'div',
      { class: 'anki-tabs', role: 'tablist' },
      TABS.map(([id, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: id === state.tab ? 'anki-tab active' : 'anki-tab',
            'aria-selected': String(id === state.tab),
            onclick: () => switchTab(id),
          },
          label,
        ),
      ),
      state.summary === 'ready'
        ? button('Choose decks', () => renderPicker({ back: true }), 'ghost small anki-choose')
        : null,
    );
    const content = h('div', { class: state.tab === 'browse' ? 'anki-tab-body is-browse' : 'anki-tab-body' });
    fill(body, state.summary === 'sample' ? sampleBanner() : null, tabs, content);

    if (state.tab === 'mined') fill(content, renderMined());
    else if (state.tab === 'browse') renderBrowse(content);
    else fill(content, renderOverview());
  }

  function switchTab(id) {
    state.tab = id;
    renderSection();
  }

  function sampleBanner() {
    return h('div', { class: 'anki-banner' }, h('strong', {}, 'Sample data. '), 'Your real decks are hidden.');
  }

  function openDeck(name) {
    Object.assign(state.browse, { deck: name, filter: 'all', query: '', selectedId: null });
    switchTab('browse');
  }

  function openCard(card) {
    Object.assign(state.browse, { deck: card.deck ?? null, filter: 'all', query: '', selectedId: card.id });
    switchTab('browse');
  }

  // Overview

  function renderOverview() {
    const o = state.overview;
    const today = o.today ?? {};
    return h(
      'div',
      { class: 'anki-overview' },
      h(
        'div',
        { class: 'stats' },
        stat('Due today', today.due ?? 0, 'n-due'),
        stat('Learning', today.learning ?? 0, 'n-learn'),
        stat('New', today.new ?? 0, 'n-new'),
        stat('Retention 30d', formatRetention(o.retention30)),
        stat('Streak', formatStreak(o.streak)),
      ),
      h('div', { class: 'overview-grid' }, forecastCard(o.forecast), minedWeekCard(o)),
      deckCard(o.decks ?? []),
    );
  }

  function stat(label, value, tone) {
    return h(
      'div',
      { class: 'anki-card stat' },
      h('div', { class: 'anki-lab' }, label),
      h('div', { class: tone ? `stat-num ${tone}` : 'stat-num' }, String(value)),
    );
  }

  function forecastCard(forecast) {
    const bars = forecastBars(forecast);
    const total = bars.reduce((n, b) => n + b.count, 0);
    return h(
      'section',
      { class: 'anki-card' },
      h('div', { class: 'card-head' }, h('span', { class: 'anki-lab' }, 'Review forecast · next 22 days'), h('span', { class: 'anki-pill' }, 'reviews')),
      total === 0
        ? h('p', { class: 'anki-sub' }, 'No reviews scheduled in the next 22 days.')
        : h(
            'div',
            { class: 'fc' },
            h(
              'div',
              { class: 'fc-plot' },
              bars.map((b) =>
                h(
                  'div',
                  { class: 'fc-col', title: `${b.count} reviews on ${b.day === 0 ? 'today' : `day +${b.day}`}` },
                  h('i', { class: 'fc-bar', style: `height:${b.height}%` }),
                ),
              ),
            ),
            h('div', { class: 'fc-ticks' }, bars.map((b) => h('span', {}, b.label))),
          ),
    );
  }

  function minedWeekCard(o) {
    const recent = (o.mined ?? []).slice(0, 3).map((c) => c.word).join(' · ');
    return h(
      'section',
      { class: 'anki-card' },
      h('div', { class: 'anki-lab' }, 'Mined this week'),
      h('div', { class: 'big-num' }, String(o.minedThisWeek ?? 0), h('small', {}, ' cards')),
      h('div', { class: 'anki-sub' }, recent || 'Cards you mine from the player appear here.'),
      h('div', { class: 'card-foot' }, button('See all mined ▸', () => switchTab('mined'), 'ghost small')),
    );
  }

  function deckCard(decks) {
    if (!decks.length) {
      return emptyBox('No decks to show', 'None of the decks you chose are in Anki right now.');
    }
    return h(
      'section',
      { class: 'anki-card deck-card' },
      h(
        'table',
        { class: 'anki-table' },
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, 'Deck'), h('th', { class: 'num-col' }, 'New'), h('th', { class: 'num-col' }, 'Learn'), h('th', { class: 'num-col' }, 'Due'), h('th', {}, '')),
        ),
        h(
          'tbody',
          {},
          decks.map((d) =>
            h(
              'tr',
              {},
              h('td', {}, d.name),
              h('td', { class: 'num-col n-new' }, String(d.new ?? 0)),
              h('td', { class: 'num-col n-learn' }, d.learn ? String(d.learn) : '–'),
              h('td', { class: 'num-col n-due' }, String(d.due ?? 0)),
              h('td', { class: 'act' }, button('details ▸', () => openDeck(d.name), 'ghost small')),
            ),
          ),
        ),
      ),
    );
  }

  // Mined gallery

  function renderMined() {
    const mined = state.overview.mined ?? [];
    if (!mined.length) return emptyBox('No mined cards yet', 'Cards you mine from the player will show up here.');
    return h(
      'div',
      { class: 'mined-grid' },
      mined.map((card) => {
        const open = () => openCard(card);
        return h(
          'div',
          {
            class: 'mined-card',
            role: 'button',
            tabindex: '0',
            title: 'Open in Browse',
            onclick: open,
            onkeydown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
              }
            },
          },
          shot(card.picture, true),
          h('div', { class: 'mined-word' }, card.word),
          h('div', { class: 'mined-reading' }, card.reading ?? ''),
          h('div', { class: 'mined-meaning' }, card.meaning ?? ''),
          h('div', { class: 'mined-deck' }, card.deck ?? ''),
        );
      }),
    );
  }

  // Browse

  function renderBrowse(content) {
    clearTimeout(searchTimer);
    const b = state.browse;
    refs = {
      side: h('aside', { class: 'browse-side' }),
      title: h('h2', { class: 'browse-title' }),
      table: h('div', { class: 'table-wrap', tabindex: '0' }),
      detail: h('aside', { class: 'browse-detail' }),
      rows: new Map(),
    };
    fill(
      content,
      h(
        'div',
        { class: 'browse' },
        refs.side,
        h(
          'div',
          { class: 'browse-main' },
          h(
            'div',
            { class: 'browse-head' },
            refs.title,
            h('input', {
              type: 'search',
              class: 'browse-search',
              placeholder: 'Search cards…',
              'aria-label': 'Search cards',
              value: b.query,
              oninput: (e) => onSearch(e.target.value),
            }),
          ),
          refs.table,
        ),
        refs.detail,
      ),
    );
    renderSide();
    renderTable();
    renderDetail();
    loadBrowse();
  }

  function onSearch(value) {
    state.browse.query = value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (!disposed && state.tab === 'browse') loadBrowse();
    }, SEARCH_DELAY_MS);
  }

  async function loadBrowse() {
    const b = state.browse;
    const seq = ++b.seq;
    b.loading = true;
    renderTable();
    try {
      const request = (deck) =>
        api.anki.browse({
          deck,
          query: b.query || undefined,
          state: b.filter === 'all' ? undefined : b.filter,
          limit: BROWSE_LIMIT,
        });
      // The backend browses one deck at a time, so "All decks" merges every visible deck.
      const names = b.deck != null ? [b.deck] : (state.overview?.decks ?? []).map((d) => d.name);
      const results = await Promise.all(names.map(request));
      if (disposed || seq !== b.seq) return;
      b.cards = results.flatMap((res, i) => (res?.cards ?? []).map((c) => ({ deck: names[i], ...c }))).slice(0, BROWSE_LIMIT);
    } catch (err) {
      if (disposed || seq !== b.seq) return;
      b.cards = [];
      toast(err.message, 'error');
    }
    b.loading = false;
    if (!b.cards.some((c) => c.id === b.selectedId)) b.selectedId = b.cards[0]?.id ?? null;
    renderSide();
    renderTable();
    renderDetail();
  }

  function setDeck(name) {
    state.browse.deck = name;
    renderSide();
    loadBrowse();
  }

  function setFilter(id) {
    state.browse.filter = id;
    renderSide();
    loadBrowse();
  }

  function renderSide() {
    const b = state.browse;
    const decks = state.overview?.decks ?? [];
    const totalDue = decks.reduce((n, d) => n + (d.due ?? 0), 0);
    const item = (active, label, count, onclick) =>
      h(
        'li',
        {},
        h(
          'button',
          { type: 'button', class: active ? 'side-item active' : 'side-item', 'aria-pressed': String(active), onclick },
          h('span', {}, label),
          count == null ? null : h('span', { class: 'n-due' }, String(count)),
        ),
      );
    fill(
      refs.side,
      h('div', { class: 'anki-lab side-label' }, 'Decks'),
      h(
        'ul',
        { class: 'side-list' },
        item(b.deck == null, 'All decks', totalDue, () => setDeck(null)),
        decks.map((d) => item(b.deck === d.name, d.name, d.due ?? 0, () => setDeck(d.name))),
      ),
      h('div', { class: 'anki-lab side-label' }, 'Filters'),
      h(
        'ul',
        { class: 'side-list' },
        FILTERS.map(([id, label]) => item(b.filter === id, label, null, () => setFilter(id))),
      ),
    );
  }

  function renderTable() {
    const b = state.browse;
    const count = `${b.cards.length} ${b.cards.length === 1 ? 'card' : 'cards'}`;
    const deckName = b.deck ?? 'All decks';
    fill(refs.title, b.loading ? deckName : `${deckName} · ${count}`);
    refs.rows = new Map();

    if (b.loading && !b.cards.length) {
      fill(refs.table, h('p', { class: 'anki-sub anki-loading' }, 'Searching…'));
      return;
    }
    if (!b.cards.length) {
      fill(
        refs.table,
        emptyBox(b.query ? `No cards match “${b.query}”` : 'No cards here', 'Try another deck or filter.'),
      );
      return;
    }
    fill(
      refs.table,
      h(
        'table',
        { class: 'anki-table browse-table' },
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, 'Word'), h('th', { class: 'col-reading' }, 'Reading'), h('th', {}, 'Meaning'), h('th', { class: 'col-source' }, 'Source'), h('th', {}, 'State')),
        ),
        h(
          'tbody',
          {},
          b.cards.map((card) => {
            const badge = stateBadge(card);
            const row = h(
              'tr',
              { class: card.id === b.selectedId ? 'selected' : null, onclick: () => selectCard(card.id) },
              h('td', { class: 'anki-word' }, card.word),
              h('td', { class: 'col-reading' }, card.reading ?? ''),
              h('td', {}, card.meaning ?? ''),
              h('td', { class: 'col-source muted' }, card.source ?? ''),
              h('td', {}, h('span', { class: `anki-badge tone-${badge.tone}` }, badge.label)),
            );
            refs.rows.set(card.id, row);
            return row;
          }),
        ),
      ),
    );
  }

  function selectCard(id) {
    const b = state.browse;
    if (id === b.selectedId) return;
    refs.rows.get(b.selectedId)?.classList.remove('selected');
    b.selectedId = id;
    const row = refs.rows.get(id);
    row?.classList.add('selected');
    row?.scrollIntoView({ block: 'nearest' });
    renderDetail();
  }

  function renderDetail() {
    const card = state.browse.cards.find((c) => c.id === state.browse.selectedId);
    if (!card) {
      fill(refs.detail, h('div', { class: 'anki-lab' }, 'Card info'), h('p', { class: 'anki-sub detail-empty' }, 'Select a card to see its details.'));
      return;
    }
    const parts = highlightParts(card.sentence, card.word);
    fill(
      refs.detail,
      h('div', { class: 'anki-lab' }, 'Card info'),
      shot(card.picture, false, 'shot detail-shot'),
      h('div', { class: 'detail-word' }, card.word),
      h('div', { class: 'anki-sub' }, [card.reading, card.meaning].filter(Boolean).join(' · ')),
      h('p', { class: 'sentence' }, parts.length ? parts.map((p) => (p.hit ? h('mark', {}, p.text) : p.text)) : h('span', { class: 'anki-sub' }, 'No sentence saved.')),
      h('div', { class: 'anki-sub' }, card.source ?? ''),
      h('div', { class: 'detail-actions' }, h('button', { type: 'button', disabled: !card.audio, onclick: () => playAudio(card.audio) }, '▶ Audio')),
      h('div', { class: 'anki-card history' }, h('div', { class: 'anki-lab' }, 'History'), h('div', { class: 'anki-sub' }, formatHistory(card))),
    );
  }

  function playAudio(name) {
    return attempt(async () => {
      const url = await mediaUrl(name);
      if (!url) {
        toast('No audio file for this card');
        return;
      }
      await new Audio(url).play();
    });
  }

  function onKeydown(e) {
    const b = state.browse;
    if (state.tab !== 'browse' || !refs?.table.isConnected) return;
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
    if (!b.cards.length) return;
    e.preventDefault();
    const index = b.cards.findIndex((c) => c.id === b.selectedId);
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = index < 0 ? 0 : Math.min(b.cards.length - 1, Math.max(0, index + step));
    selectCard(b.cards[next].id);
  }

  // Media: screenshots and audio arrive as data URLs, cached per mount

  function mediaUrl(name) {
    if (!mediaCache.has(name)) {
      const pending = api.anki.media(name).then((url) => url ?? null);
      pending.catch(() => mediaCache.delete(name));
      mediaCache.set(name, pending);
    }
    return mediaCache.get(name);
  }

  function shot(picture, lazy, cls = 'shot') {
    const box = h('div', { class: cls });
    if (picture) {
      if (lazy && observer) {
        lazyLoads.set(box, () => showShot(box, picture));
        observer.observe(box);
      } else {
        showShot(box, picture);
      }
    }
    return box;
  }

  function showShot(box, picture) {
    mediaUrl(picture).then((url) => {
      if (url) box.replaceChildren(h('img', { src: url, alt: '' }));
    }, () => {});
  }

  function onVisible(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      lazyLoads.get(entry.target)?.();
    }
  }
}
