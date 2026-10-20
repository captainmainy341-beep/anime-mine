import { attempt, fill, h, toast } from './lib/ui.mjs';
import { withIcon } from './lib/doodleIcons.mjs';
import { mountDeckOptions } from './lib/ankiDeckOptions.mjs';
import { currentPreset } from './lib/ankiOptionsModel.mjs';
import { grammarPanel } from './lib/grammarPanel.mjs';
import { forecastBars, formatRetention, formatStreak, modeSummary } from './lib/ankiView.mjs';
import { mountBrowse } from './anki/browse.mjs';
import { createCardDocumentCache, deckLabel, easeForKey, gradeButtons, plainSentence, sessionSummary } from './lib/study.mjs';
import { studyDocument } from './lib/studyPresentation.mjs';

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
  ['study', 'Study'],
  ['options', 'Deck options'],
];
const GRAMMAR_PREF = 'animeMine.anki.studyGrammar';

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
  let browseDispose = null;
  let requestedMode = null;
  let setViewChain = Promise.resolve();
  let optionsDispose = null;
  let optionRows = new Map();
  const state = {
    view: null,
    summary: 'loading',
    overview: null,
    tab: 'overview',
    optionsDeck: null,
    deckPlans: new Map(),
    initial: null,
    study: { deck: null, cards: [], index: 0, side: 'question', phase: 'pick', busy: false, reviewed: 0, again: 0, reloaded: false, seq: 0 },
  };
  let studyAudio = null;
  let studyUI = null;
  let studyGrammarOpen = localStorage.getItem(GRAMMAR_PREF) === 'open';
  const studyDoc = createCardDocumentCache(studyDocument);
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
    disposeTabs();
    stopStudyAudio();
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
    state.overview = null;
    disposeTabs();
    state.optionsDeck = null;
    state.deckPlans.clear();
    optionRows.clear();
    mediaCache.clear();
    Object.assign(state.study, { deck: null, cards: [], index: 0, side: 'question', phase: 'pick', busy: false, reviewed: 0, again: 0, reloaded: false });
    state.study.seq++;
  }

  function setMode(mode) {
    if ((requestedMode ?? state.view?.mode) === mode) return;
    if (!leaveAllowed()) return;
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
    disposeTabs();
    stopStudyAudio();
    state.study.seq++;
    Object.assign(state.study, { phase: 'pick', cards: [], index: 0, side: 'question', busy: false });
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
    disposeTabs();
    optionRows = new Map();
    studyUI = null;
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
        ? button('Choose decks', () => { if (leaveAllowed()) renderPicker({ back: true }); }, 'ghost small anki-choose')
        : null,
    );
    const content = h('div', { class: state.tab === 'browse' ? 'anki-tab-body is-browse' : state.tab === 'options' ? 'anki-tab-body is-options' : 'anki-tab-body' });
    fill(body, state.summary === 'sample' ? sampleBanner() : null, tabs, content);

    if (state.tab === 'mined') fill(content, renderMined());
    else if (state.tab === 'browse') browseDispose = mountBrowse(content, browseCtx());
    else if (state.tab === 'study') renderStudy(content);
    else if (state.tab === 'options') fill(content, renderOptionsTab());
    else fill(content, renderOverview());
  }

  function switchTab(id) {
    if (!leaveAllowed()) return;
    goTab(id);
  }

  function goTab(id) {
    if (id !== 'study') stopStudyAudio();
    state.tab = id;
    renderSection();
  }

  function leaveAllowed() {
    return !(optionsDispose?.isDirty() || browseDispose?.isDirty()) || window.confirm('Discard unsaved changes?');
  }

  function disposeTabs() {
    optionsDispose?.();
    optionsDispose = null;
    browseDispose?.();
    browseDispose = null;
  }

  function sampleBanner() {
    return h('div', { class: 'anki-banner' }, h('strong', {}, 'Sample data. '), 'Your real decks are hidden.');
  }

  function openDeck(name) {
    state.initial = { deck: name };
    switchTab('browse');
  }

  function openCard(card) {
    state.initial = { deck: card.deck ?? null, cardId: card.id };
    switchTab('browse');
  }

  function browseCtx() {
    const initial = state.initial ?? {};
    state.initial = null;
    return {
      decks: (state.overview?.decks ?? []).map((d) => d.name),
      readOnly: state.summary === 'sample',
      initial,
    };
  }

  // Overview

  function renderOverview() {
    const o = state.overview;
    const decks = o.decks ?? [];
    syncOptionsDeck(decks);
    const table = deckCard(decks);
    return h('div', { class: 'anki-overview' },
      h('div', { class: 'anki-collection-summary' },
        h('span', {}, `Retention 30d: ${formatRetention(o.retention30)}`),
        h('span', {}, `Streak: ${formatStreak(o.streak)}`),
        h('span', {}, `${o.minedThisWeek ?? 0} mined this week`)),
      table, mountOptionsEditor(),
      h('details', { class: 'anki-forecast-details' }, h('summary', {}, 'Review forecast and mining activity'),
        h('div', { class: 'overview-grid' }, forecastCard(o.forecast), minedWeekCard(o))));
  }

  function renderOptionsTab() {
    const decks = state.overview.decks ?? [];
    if (!decks.length) return emptyBox('No decks to show', 'None of the decks you chose are in Anki right now.');
    syncOptionsDeck(decks);
    const pane = deckPane(decks);
    return h('div', { class: 'anki-options-split' }, pane, h('div', { class: 'anki-options-editor' }, mountOptionsEditor()));
  }

  function syncOptionsDeck(decks) {
    if (!decks.some(d => d.name === state.optionsDeck)) state.optionsDeck = decks[0]?.name ?? null;
  }

  function mountOptionsEditor() {
    const editor = h('div', { class: 'deck-options-host' });
    if (state.optionsDeck) {
      const deck = state.optionsDeck;
      optionsDispose = mountDeckOptions(editor, { api: api.anki, deck, sample: state.summary === 'sample',
        onLoaded: (plan) => {
          state.deckPlans.set(deck, plan);
          updateOptionRow(deck, plan);
        },
        onSaved: () => toast('Deck options saved in Anki'),
      });
    }
    return editor;
  }

  function deckPane(decks) {
    const rows = decks.map((d) => {
      const { name, parent } = deckLabel(d.name);
      const selected = d.name === state.optionsDeck;
      const row = {
        new: h('b', { class: 'n-new' }, String(d.new ?? 0)),
        learn: h('b', { class: 'n-learn' }, String(d.learn ?? 0)),
        due: h('b', { class: 'n-due' }, String(d.due ?? 0)),
        limits: h('small', { class: 'anki-options-deck-limits' }),
        counts: h('small', { class: 'anki-options-deck-source' }),
        preset: h('small', { class: 'anki-options-deck-preset' }),
      };
      optionRows.set(d.name, row);
      const cached = state.deckPlans.get(d.name);
      if (cached) updateOptionRow(d.name, cached);
      return h('li', {},
        h('button', { type: 'button', class: selected ? 'anki-options-deck selected' : 'anki-options-deck', 'aria-current': selected ? 'true' : null,
          onclick: () => chooseOptionsDeck(d.name) },
        h('span', { class: 'anki-options-deck-name' }, name),
        parent ? h('span', { class: 'anki-options-deck-parent' }, parent) : null,
        h('span', { class: 'anki-options-deck-stats' }, row.new, ' new · ', row.learn, ' learning · ', row.due, ' due'),
        row.limits, row.preset, row.counts));
    });
    return h('aside', { class: 'anki-options-decks' },
      h('div', { class: 'anki-options-decks-head' },
        h('span', { class: 'anki-lab' }, 'Decks'),
        h('div', { class: 'anki-options-deck-actions' },
          button('Study', () => {
            if (!leaveAllowed()) return;
            state.study.deck = state.optionsDeck;
            goTab('study');
          }, 'primary small'),
          button('Browse', () => openDeck(state.optionsDeck), 'ghost small'))),
      h('select', { class: 'anki-options-select', 'aria-label': 'Deck',
        onchange: (e) => { if (!chooseOptionsDeck(e.currentTarget.value)) e.currentTarget.value = state.optionsDeck; } },
        decks.map((d) => h('option', { value: d.name, selected: d.name === state.optionsDeck }, d.name))),
      h('ul', { class: 'anki-options-deck-list' }, rows));
  }

  function chooseOptionsDeck(deck) {
    if (!leaveAllowed()) return false;
    state.optionsDeck = deck;
    state.tab = 'options';
    renderSection();
    return true;
  }

  function updateOptionRow(deck, plan) {
    const row = optionRows.get(deck);
    if (!row) return;
    row.new.textContent = String(plan.remaining.new);
    row.learn.textContent = String(plan.remaining.learning);
    row.due.textContent = String(plan.remaining.reviews);
    const n = plan.today.newPerDay ?? plan.permanent.newPerDay;
    const r = plan.today.reviewsPerDay ?? plan.permanent.reviewsPerDay;
    row.limits.textContent = `${n} new / ${r} reviews${plan.today.newPerDay != null || plan.today.reviewsPerDay != null ? ' · Today only' : ''}`;
    row.counts.textContent = plan.sample ? 'Sample' : 'Anki remaining';
    if (row.preset) row.preset.textContent = currentPreset(plan)?.name ?? '';
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
      h('div', { class: 'card-foot' }, button(withIcon('right', 'See all mined').reverse(), () => switchTab('mined'), 'ghost small')),
    );
  }

  function deckCard(decks) {
    if (!decks.length) {
      return emptyBox('No decks to show', 'None of the decks you chose are in Anki right now.');
    }
    return h(
      'section',
      { class: 'anki-card deck-card' },
      h('div', { class: 'deck-table-head' }, h('h2', {}, 'Decks'),
        button('Study selected deck', () => { state.study.deck = state.optionsDeck; switchTab('study'); }, 'primary')),
      h('div', { class: 'anki-sub deck-table-help' }, 'Native remaining counts load when you select a deck. Other rows show raw card counts, not a daily allowance.'),
      h(
        'table',
        { class: 'anki-table' },
        h(
          'thead',
          {},
          h('tr', {}, h('th', {}, 'Deck'), h('th', { class: 'num-col' }, 'New'), h('th', { class: 'num-col' }, 'Learn'), h('th', { class: 'num-col' }, 'Reviews'), h('th', {}, 'Daily limits'), h('th', {}, '')),
        ),
        h(
          'tbody',
          {},
          decks.map((d) => {
            const row = {
              new: h('td', { class: 'num-col n-new' }, String(d.new ?? 0)),
              learn: h('td', { class: 'num-col n-learn' }, String(d.learn ?? 0)),
              due: h('td', { class: 'num-col n-due' }, String(d.due ?? 0)),
              limits: h('td', { class: 'deck-limit-summary' }, 'Select to read Anki'),
              counts: h('small', { class: 'deck-count-source' }, 'Raw counts'),
            };
            optionRows.set(d.name, row);
            const cached = state.deckPlans.get(d.name);
            if (cached) updateOptionRow(d.name, cached);
            return h('tr', { class: d.name === state.optionsDeck ? 'selected' : '' },
              h('td', {}, button(d.name, () => chooseOptionsDeck(d.name), 'ghost deck-name-button'), row.counts),
              row.new, row.learn, row.due, row.limits,
              h('td', { class: 'act' }, button('Options', () => chooseOptionsDeck(d.name), 'small'), button('Browse', () => openDeck(d.name), 'ghost small')));
          }),
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
          grammarDisclosure(card.sentence),
        );
      }),
    );
  }

  function grammarDisclosure(sentence) {
    const text = plainSentence(sentence);
    if (!text) return null;
    const stop = (e) => e.stopPropagation();
    const body = h('div', { class: 'grammar-disclosure-body' });
    let loaded = false;
    return h(
      'details',
      {
        class: 'grammar-disclosure',
        onclick: stop,
        onkeydown: stop,
        ontoggle: (e) => {
          if (!e.currentTarget.open || loaded) return;
          loaded = true;
          fill(body, grammarPanel({ api, text, compact: true }));
        },
      },
      h('summary', {}, 'Grammar guide'),
      body,
    );
  }

  // Study

  function renderStudy(content) {
    const s = state.study;
    if (state.summary !== 'ready') {
      fill(content, emptyBox('Study needs Live mode', 'Switch to Live mode and connect Anki to review cards here.'));
      return;
    }
    if (s.phase === 'pick') renderStudyStart(content);
    else if (s.phase === 'loading') fill(content, h('p', { class: 'anki-sub anki-loading' }, 'Loading cards…'));
    else if (s.phase === 'done') {
      fill(
        content,
        h(
          'section',
          { class: 'anki-panel study-start' },
          h('h2', {}, 'No cards ready now'),
          h('p', { class: 'anki-sub' }, sessionSummary(s)),
          h('p', { class: 'anki-sub' }, 'Anki’s daily limits, sibling burying and learning timings decide what is ready. You may still have cards scheduled for later.'),
          h(
            'div',
            { class: 'panel-actions' },
            button('Study again', () => startStudy(s.deck), 'primary'),
            button('Change deck', endStudy, 'ghost'),
          ),
        ),
      );
    }
    else renderStudyCard(content);
  }

  function renderStudyStart(content) {
    const s = state.study;
    const decks = state.view.visibleDecks;
    const selected = decks.includes(s.deck) ? s.deck : decks[0];
    const select = h(
      'select',
      { 'aria-label': 'Deck' },
      decks.map((d) => h('option', { value: d, selected: d === selected }, d)),
    );
    fill(
      content,
      h(
        'section',
        { class: 'anki-panel study-start' },
        h('h2', {}, 'Study'),
        h('p', { class: 'anki-sub' }, 'Review due, learning and new cards from one deck without leaving the app.'),
        h('label', { class: 'study-deck-pick' }, select),
        h('div', { class: 'panel-actions' }, button('Start', () => startStudy(select.value), 'primary')),
      ),
    );
  }

  function renderStudyCard(content) {
    const s = state.study;
    const deck = deckLabel(s.deck);
    studyUI = {
      frame: h('iframe', { class: 'study-card', sandbox: '', title: 'Study card', tabindex: '-1' }),
      remaining: h('span', { class: 'anki-sub study-remaining' }),
      replay: button(withIcon('play', 'Replay'), () => {
        const audio = state.study.cards[state.study.index]?.audio;
        if (audio) playStudyAudio(audio);
      }, 'ghost small'),
      flip: button('Hide answer', hideAnswer, 'ghost small'),
      grammar: button('Grammar', toggleStudyGrammar, 'ghost small'),
      grammarSlot: h('div', { class: 'study-grammar', hidden: true }),
      style: button('Original style', toggleStudyStyle, 'ghost small'),
      controls: h('div', { class: 'study-controls' }),
      status: h('span', { role: 'status', 'aria-live': 'polite' }),
      reviewed: h('span'),
    };
    fill(content, h('section', { class: 'study' },
      h('div', { class: 'study-head' },
        h('div', { class: 'study-deck-path', title: s.deck },
          deck.parent ? h('div', { class: 'study-parent' }, deck.parent) : null,
          h('div', { class: 'study-deck' }, deck.name)),
        studyUI.remaining,
        h('div', { class: 'study-head-actions' }, studyUI.replay, studyUI.flip, studyUI.grammar, studyUI.style,
          button('Deck options', () => { const deck = s.deck; endStudy(); chooseOptionsDeck(deck); }, 'ghost small'),
          button('End session', endStudy, 'ghost small'))),
      h('div', { class: 'study-workspace' }, studyUI.frame),
      studyUI.grammarSlot,
      studyUI.controls,
      h('div', { class: 'study-hints' }, studyUI.status, studyUI.reviewed)));
    updateStudyCard();
  }

  function updateStudyCard() {
    if (!studyUI?.frame.isConnected || state.study.phase !== 'card') return;
    const s = state.study;
    const card = s.cards[s.index];
    const theme = s.style ?? 'app';
    const doc = studyDoc(card, s.side, theme);
    if (studyUI.document !== doc) {
      studyUI.document = doc;
      studyUI.frame.srcdoc = doc;
    }
    studyUI.frame.classList.toggle('is-original', theme === 'original');
    studyUI.remaining.textContent = s.remaining ? `${s.remaining.new} new · ${s.remaining.reviews} reviews · ${s.remaining.learning} learning` : `${s.cards.length - s.index} left`;
    studyUI.replay.hidden = !card.audio;
    studyUI.flip.hidden = s.side !== 'answer';
    studyUI.grammar.hidden = s.side !== 'answer' || !plainSentence(card.sentence);
    studyUI.style.textContent = theme === 'app' ? 'Original style' : 'App style';
    studyUI.reviewed.textContent = `${s.reviewed} reviewed this session`;
    const controls = s.side === 'answer'
      ? h('div', { class: 'study-grades' }, gradeButtons(card).map(g => h('button',
          { type: 'button', class: `grade grade-${g.label.toLowerCase()}`, 'aria-label': `${g.label} (${g.ease}), ${g.interval}`, onclick: () => grade(g.ease) },
          h('span', {}, h('span', { class: 'grade-label' }, g.label), h('small', { class: 'grade-interval' }, g.interval)),
          h('kbd', {}, String(g.ease)))))
      : h('div', { class: 'panel-actions' }, button('Show answer', showAnswer, 'primary study-reveal'));
    fill(studyUI.controls, controls);
    syncStudyGrammar(card);
    updateStudyBusy();
  }

  function updateStudyBusy() {
    if (!studyUI?.frame.isConnected) return;
    const s = state.study;
    studyUI.controls.setAttribute('aria-busy', String(s.busy));
    studyUI.controls.querySelectorAll('button').forEach(b => b.disabled = s.busy);
    studyUI.flip.disabled = s.busy;
    studyUI.style.disabled = s.busy;
    studyUI.status.textContent = s.busy ? 'Saving review…' : s.side === 'answer' ? '1–4 to rate' : 'Space or Enter to show answer';
  }

  function syncStudyGrammar(card) {
    const slot = studyUI.grammarSlot;
    const text = plainSentence(card.sentence);
    studyUI.grammar.setAttribute('aria-pressed', String(studyGrammarOpen));
    const show = state.study.side === 'answer' && text && studyGrammarOpen;
    if (!show) {
      slot.hidden = true;
      slot.dataset.card = '';
      fill(slot);
      return;
    }
    if (slot.dataset.card !== String(card.id)) {
      slot.dataset.card = String(card.id);
      fill(slot, grammarPanel({ api, text, compact: true }));
    }
    slot.hidden = false;
  }

  function toggleStudyGrammar() {
    if (!studyUI?.grammar || studyUI.grammar.hidden) return;
    studyGrammarOpen = !studyGrammarOpen;
    localStorage.setItem(GRAMMAR_PREF, studyGrammarOpen ? 'open' : 'closed');
    syncStudyGrammar(state.study.cards[state.study.index]);
  }

  function hideAnswer() {
    const s = state.study;
    if (s.phase !== 'card' || s.busy) return;
    s.side = 'question';
    updateStudyCard();
  }

  function toggleStudyStyle() {
    if (state.study.busy) return;
    state.study.style = (state.study.style ?? 'app') === 'app' ? 'original' : 'app';
    updateStudyCard();
  }

  function startStudy(deck) {
    Object.assign(state.study, { deck, reviewed: 0, again: 0, reloaded: false });
    loadStudyQueue();
  }

  function renderStudyIfActive(seq) {
    if (state.tab === 'study' && seq === state.study.seq) renderSection();
  }

  async function loadStudyQueue() {
    const s = state.study;
    const seq = ++s.seq;
    Object.assign(s, { phase: 'loading', cards: [], index: 0, side: 'question', busy: false });
    renderStudyIfActive(seq);
    try {
      const res = await api.anki.studyQueue({ deck: s.deck });
      if (disposed || seq !== s.seq) return;
      s.cards = res?.cards ?? [];
      s.token = res?.token;
      s.remaining = res?.remaining;
    } catch (err) {
      if (disposed || seq !== s.seq) return;
      toast(err.message, 'error');
      s.phase = 'pick';
      renderStudyIfActive(seq);
      return;
    }
    s.phase = s.cards.length ? 'card' : 'done';
    renderStudyIfActive(seq);
    playCurrentAudio();
  }

  function endStudy() {
    const s = state.study;
    stopStudyAudio();
    s.seq++;
    Object.assign(s, { phase: 'pick', cards: [], index: 0, side: 'question', busy: false });
    renderSection();
  }

  function endStudyQueue() {
    // Fetch the next native queue item after every answer. Never cap a day at two batches.
    loadStudyQueue();
  }

  function showAnswer() {
    const s = state.study;
    if (s.phase !== 'card' || s.side === 'answer' || s.busy) return;
    s.side = 'answer';
    updateStudyCard();
  }

  function grade(ease) {
    const s = state.study;
    if (s.phase !== 'card' || s.side !== 'answer' || s.busy) return;
    const seq = s.seq;
    const card = s.cards[s.index];
    s.busy = true;
    updateStudyBusy();
    api.anki.studyAnswer({ cardId: card.id, ease, deck: s.deck, token: s.token }).then(
      () => {
        if (disposed || seq !== s.seq) return;
        s.reviewed++;
        if (ease === 1) s.again++;
        stopStudyAudio();
        s.index++;
        s.side = 'question';
        s.busy = false;
        if (s.index < s.cards.length) {
          updateStudyCard();
          playCurrentAudio();
        } else {
          endStudyQueue();
        }
      },
      (err) => {
        if (disposed || seq !== s.seq) return;
        s.busy = false;
        toast(err.message, 'error');
        updateStudyBusy();
      },
    );
  }

  function playCurrentAudio() {
    const s = state.study;
    const card = s.cards[s.index];
    if (state.tab === 'study' && s.side === 'question' && card?.audio) playStudyAudio(card.audio);
  }

  function stopStudyAudio() {
    studyAudio?.pause();
    studyAudio = null;
  }

  function playStudyAudio(name) {
    const s = state.study;
    const seq = s.seq;
    const card = s.cards[s.index];
    return attempt(async () => {
      const url = await mediaUrl(name);
      const current = s.cards[s.index];
      if (!url || disposed || seq !== s.seq || state.tab !== 'study' || s.phase !== 'card' || current !== card) return;
      stopStudyAudio();
      studyAudio = new Audio(url);
      await studyAudio.play();
    });
  }

  function onStudyKey(e) {
    const s = state.study;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey || s.phase !== 'card') return;
    const confirm = e.key === ' ' || e.key === 'Enter';
    if (confirm && e.target?.tagName === 'BUTTON') return;
    if (e.key.toLowerCase() === 'g' && s.side === 'answer') {
      e.preventDefault();
      toggleStudyGrammar();
      return;
    }
    if (s.side === 'question' && confirm) {
      e.preventDefault();
      showAnswer();
      return;
    }
    const ease = easeForKey(e.key);
    if (s.side === 'answer' && ease) {
      e.preventDefault();
      grade(ease);
    }
  }

  // Browse

  function onKeydown(e) {
    if (state.tab === 'study') return onStudyKey(e);
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
