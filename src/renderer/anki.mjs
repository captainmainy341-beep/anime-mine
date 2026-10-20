import { attempt, fill, h, toast } from './lib/ui.mjs';
import { doodle, withIcon } from './lib/doodleIcons.mjs';
import { inkHeader, inkPercent, setInkHeader } from './lib/inkHeader.mjs';
import { mountDeckOptions } from './lib/ankiDeckOptions.mjs';
import { currentPreset } from './lib/ankiOptionsModel.mjs';
import { grammarPanel } from './lib/grammarPanel.mjs';
import { activityStats, forecastBars, formatRetention, formatStreak, heatmapModel, modeSummary } from './lib/ankiView.mjs';
import { mountBrowse } from './anki/browse.mjs';
import { createCardDocumentCache, deckLabel, easeForKey, gradeButtons, plainSentence, sessionSummary } from './lib/study.mjs';
import { studyDocument } from './lib/studyPresentation.mjs';
import { createStudyCardView } from './anki/studyCard.mjs';

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
// Heatmap pitch: a 17px cell and its 4px gap from the frame. Month labels line up on the same grid.
const HEAT_PITCH = 21;

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

const countOf = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const deckDue = (deck) => countOf(deck?.new) + countOf(deck?.learn) + countOf(deck?.due);
const deckTotal = (deck) => countOf(deck?.total) || deckDue(deck);
const cardsLabel = (n) => `${n} ${n === 1 ? 'card' : 'cards'}`;
const isMissing = (fn) => typeof fn !== 'function';

export function mountAnki(container) {
  let disposed = false;
  let loadSeq = 0;
  let browseDispose = null;
  let requestedMode = null;
  let setViewChain = Promise.resolve();
  let optionsDispose = null;
  let optionRows = new Map();
  let deckMenu = null;
  const state = {
    view: null,
    summary: 'loading',
    overview: null,
    tab: 'overview',
    optionsDeck: null,
    deckPlans: new Map(),
    initial: null,
    deckForm: false,
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

  const modeSwitch = h('div', { class: 'seg ink-anki-mode', role: 'group', 'aria-label': 'Data mode' });
  const tabStrip = h('div', { class: 'ink-anki-tabs', role: 'tablist', 'aria-label': 'Anki sections' });
  const sampleChip = h('span', { class: 'ink-anki-sample' }, 'Sample data');
  const chooseDecks = button('Choose decks', () => { if (leaveAllowed()) renderPicker({ back: true }); }, 'ink-anki-strip-btn');
  const strip = h(
    'div',
    { class: 'ink-anki-strip' },
    tabStrip,
    h('div', { class: 'ink-anki-strip-actions' }, sampleChip, chooseDecks, modeSwitch),
  );
  const header = inkHeader({ title: 'Anki' });
  header.style.setProperty('--ink-hero-title', '50px');
  const body = h('div', { class: 'anki-body ink-anki-body' });
  const root = h('section', { class: 'page anki ink-screen ink-clean' }, strip, header, body);
  container.append(root);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onDocumentClick);
  window.addEventListener('resize', closeDeckMenu);
  load();

  return () => {
    disposed = true;
    closeDeckMenu();
    disposeTabs();
    stopStudyAudio();
    studyUI?.view?.destroy?.();
    studyUI = null;
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('click', onDocumentClick);
    window.removeEventListener('resize', closeDeckMenu);
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
    state.deckForm = false;
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
    renderStrip();
    syncHeader();
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
    studyUI?.view?.destroy?.();
    studyUI = null;
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

  // The frame has no tab strip: a slim row above the header keeps every Anki tab (and the data mode) reachable
  // without taking space away from the overview panels.
  function renderStrip() {
    const section = state.summary === 'sample' || state.summary === 'ready';
    fill(
      tabStrip,
      section
        ? TABS.map(([id, label]) =>
            h(
              'button',
              {
                type: 'button',
                role: 'tab',
                class: 'anki-tab ink-anki-tab',
                'aria-selected': String(id === state.tab),
                onclick: () => switchTab(id),
              },
              label,
            ),
          )
        : null,
    );
    sampleChip.hidden = state.summary !== 'sample';
    chooseDecks.hidden = state.summary !== 'ready';
    modeSwitch.hidden = state.summary === 'loading';
  }

  function selectedDeck(decks) {
    return decks.find((deck) => deck.name === state.optionsDeck) ?? decks[0] ?? null;
  }

  function syncHeader() {
    const s = state.study;
    if (state.tab === 'study' && state.summary === 'ready') {
      const deck = deckLabel(s.deck ?? state.view?.visibleDecks?.[0] ?? '').name;
      if (s.phase === 'card' && s.cards.length) {
        const number = Math.min(s.index + 1, s.cards.length);
        setInkHeader(header, { title: 'Review', label: `Card ${number} of ${s.cards.length} · ${deck}`, value: number, max: s.cards.length });
      } else {
        setInkHeader(header, { title: 'Review', label: deck ? `Study · ${deck}` : 'Study', value: 0, max: 0 });
      }
      return;
    }
    if ((state.summary === 'sample' || state.summary === 'ready') && state.overview?.decks?.length) {
      const deck = selectedDeck(state.overview.decks);
      const due = deckDue(deck);
      const total = deckTotal(deck);
      setInkHeader(header, { title: 'Anki', label: `${due} due today of ${total} cards`, value: due, max: total });
      return;
    }
    const labels = {
      hidden: 'Anki is hidden',
      connect: 'Anki is not connected',
      pick: 'Choose the decks to read',
      failed: 'Couldn’t read Anki',
    };
    setInkHeader(header, { title: 'Anki', label: labels[state.summary] ?? 'Reading Anki', value: 0, max: 0 });
  }

  function renderSection() {
    disposeTabs();
    optionRows = new Map();
    studyUI?.view?.destroy?.();
    studyUI = null;
    renderStrip();
    syncHeader();
    if (!state.overview) {
      fill(body, h('p', { class: 'anki-sub anki-loading' }, 'Loading…'));
      return;
    }
    const content = h('div', {
      class: state.tab === 'browse' ? 'anki-tab-body is-browse ink-anki-tab-body' : state.tab === 'options' ? 'anki-tab-body is-options ink-anki-tab-body' : 'anki-tab-body ink-anki-tab-body',
    });
    fill(body, content);

    if (state.tab === 'mined') fill(content, renderMined());
    else if (state.tab === 'browse') browseDispose = mountBrowse(content, browseCtx());
    else if (state.tab === 'study') renderStudy(content);
    else if (state.tab === 'options') fill(content, renderOptionsTab());
    else fill(content, renderOverview());
    renderStrip();
    syncHeader();
  }

  function switchTab(id) {
    if (!leaveAllowed()) return;
    goTab(id);
  }

  function goTab(id) {
    if (id !== 'study') stopStudyAudio();
    state.tab = id;
    state.deckForm = false;
    closeDeckMenu();
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

  // Deck actions menu (kebab). Rendered on document.body so the table can scroll without clipping it.
  function openDeckActions(buttonEl, deck) {
    if (deckMenu?.button === buttonEl) {
      closeDeckMenu();
      return;
    }
    closeDeckMenu();
    const item = (icon, label, action) =>
      h('button', {
        type: 'button',
        role: 'menuitem',
        class: 'ink-deck-menu-item',
        onclick: (event) => {
          event.stopPropagation();
          closeDeckMenu();
          action();
        },
      }, doodle(icon), h('span', {}, label));
    const menu = h(
      'div',
      { class: 'ink-deck-menu', role: 'menu', 'aria-label': `${deck.name} actions` },
      item('play', 'Study', () => studyDeck(deck.name)),
      item('bulb', 'Options', () => chooseOptionsDeck(deck.name)),
      item('book', 'Browse', () => openDeck(deck.name)),
    );
    document.body.append(menu);
    const rect = buttonEl.getBoundingClientRect();
    const width = 176;
    menu.style.left = `${Math.round(Math.max(8, Math.min(rect.left + rect.width - width, window.innerWidth - width - 8)))}px`;
    menu.style.top = `${Math.round(Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8))}px`;
    buttonEl.setAttribute('aria-expanded', 'true');
    deckMenu = { menu, button: buttonEl };
  }

  function closeDeckMenu() {
    if (!deckMenu) return;
    deckMenu.menu.remove();
    deckMenu.button.setAttribute('aria-expanded', 'false');
    deckMenu = null;
  }

  function onDocumentClick(event) {
    if (deckMenu && !deckMenu.menu.contains(event.target)) closeDeckMenu();
  }

  function studyDeck(name) {
    if (!leaveAllowed()) return;
    state.tab = 'study';
    state.deckForm = false;
    closeDeckMenu();
    stopStudyAudio();
    if (state.summary === 'ready') startStudy(name);
    else renderSection();
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
    if (!decks.length) return emptyBox('No decks to show', 'None of the decks you chose are in Anki right now.');
    syncOptionsDeck(decks);
    const deck = selectedDeck(decks);
    const reviews = Array.isArray(o.reviewsByDay) ? o.reviewsByDay : [];
    const model = heatmapModel(reviews);
    const stats = activityStats(reviews);
    return h('div', { class: 'ink-anki-overview' },
      h('div', { class: 'ink-anki-top' }, decksPanel(decks, deck), deckGlance(deck, o)),
      heatPanel(model, stats, reviews.length > 0),
      h('details', { class: 'ink-anki-more ink-panel' },
        h('summary', {}, h('span', {}, 'Collection summary, forecast and deck options'), doodle('down')),
        h('div', { class: 'ink-anki-more-body' },
          h('div', { class: 'anki-collection-summary' },
            h('span', {}, `Retention 30d: ${formatRetention(o.retention30)}`),
            h('span', {}, `Streak: ${formatStreak(o.streak)}`),
            h('span', {}, `${o.minedThisWeek ?? 0} mined this week`)),
          h('div', { class: 'overview-grid' }, forecastCard(o.forecast), minedWeekCard(o)),
          mountOptionsEditor())));
  }

  function decksPanel(decks, selected) {
    return h('section', { class: 'ink-panel ink-anki-decks' },
      h('span', { class: 'ink-tag' }, 'Decks'),
      h('div', { class: 'ink-deck-table', role: 'table', 'aria-label': 'Decks' },
        h('div', { class: 'ink-deck-head', role: 'row' },
          h('span', { class: 'ink-deck-head-cell is-deck', role: 'columnheader' }, 'Deck'),
          h('span', { class: 'ink-deck-head-cell', role: 'columnheader' }, 'New'),
          h('span', { class: 'ink-deck-head-cell', role: 'columnheader' }, 'Learn'),
          h('span', { class: 'ink-deck-head-cell', role: 'columnheader' }, 'Due'),
          h('span', { class: 'ink-deck-head-cell', role: 'columnheader' })),
        h('div', { class: 'ink-deck-body', role: 'rowgroup' }, decks.map((deck) => deckRow(deck, deck.name === selected?.name)))),
      state.deckForm ? createDeckForm() : deckActions());
  }

  function deckRow(deck, isSelected) {
    const { name: shortName } = deckLabel(deck.name);
    const pick = h('button', {
      type: 'button',
      class: 'ink-deck-pick',
      title: deck.name,
      onclick: () => selectDeck(deck.name),
      'aria-pressed': String(isSelected),
    },
    h('span', { class: 'ink-deck-name' }, shortName),
    h('span', { class: 'ink-deck-sub' }, cardsLabel(deckTotal(deck))));
    const more = h('button', {
      type: 'button',
      class: 'ink-deck-more',
      'aria-label': `Actions for ${shortName}`,
      'aria-haspopup': 'menu',
      'aria-expanded': 'false',
      onclick: (event) => {
        event.stopPropagation();
        openDeckActions(more, deck);
      },
    }, doodle('more'));
    const count = (value) => {
      const n = countOf(value);
      return h('span', { class: n ? 'ink-deck-count' : 'ink-deck-count is-zero', role: 'cell' }, String(n));
    };
    return h('div', { class: isSelected ? 'ink-deck-row is-selected' : 'ink-deck-row', role: 'row' },
      h('span', { class: 'ink-deck-pip', 'aria-hidden': 'true' }),
      pick, count(deck.new), count(deck.learn), count(deck.due), more);
  }

  function selectDeck(name) {
    if (name === state.optionsDeck) return;
    if (!leaveAllowed()) return;
    closeDeckMenu();
    state.optionsDeck = name;
    renderSection();
  }

  function deckActions() {
    return h('div', { class: 'ink-anki-actions' },
      actionButton('plus', 'Create deck', openCreateDeck),
      actionButton('download', 'Import', importPackage),
      actionButton('sync', 'Sync', syncNow));
  }

  function actionButton(icon, label, onclick, extra = '') {
    return h('button', { type: 'button', class: `ink-anki-btn ${extra}`.trim(), onclick },
      doodle(icon), h('span', {}, label));
  }

  function openCreateDeck() {
    state.deckForm = true;
    renderSection();
  }

  function closeCreateDeck() {
    state.deckForm = false;
    renderSection();
  }

  function createDeckForm() {
    const input = h('input', {
      type: 'text',
      class: 'ink-anki-deck-input',
      placeholder: 'New deck name',
      'aria-label': 'New deck name',
      maxlength: '120',
    });
    requestAnimationFrame(() => input.focus());
    return h('form', {
      class: 'ink-anki-actions is-form',
      onsubmit: (event) => {
        event.preventDefault();
        submitDeck(input.value);
      },
    },
    input,
    h('button', { type: 'submit', class: 'ink-anki-btn is-primary' }, 'Create'),
    h('button', { type: 'button', class: 'ink-anki-btn', onclick: closeCreateDeck }, 'Cancel'));
  }

  function missingAction(action) {
    toast(`${action} needs the updated Anki service. Restart the app and try again.`, 'error');
  }

  function submitDeck(value) {
    const name = String(value ?? '').trim();
    if (!name) {
      toast('Enter a deck name first.', 'error');
      return;
    }
    if (isMissing(api.anki?.createDeck)) {
      missingAction('Creating a deck');
      return;
    }
    return attempt(async () => {
      const result = await api.anki.createDeck({ name });
      state.deckForm = false;
      toast(`Created ${result?.name ?? name}`);
      await load();
    });
  }

  function importPackage() {
    if (isMissing(api.anki?.importPackage)) {
      missingAction('Importing a package');
      return;
    }
    return attempt(async () => {
      const result = await api.anki.importPackage();
      if (!result?.imported) return;
      const file = String(result.path ?? '').split(/[\\/]/).pop();
      toast(file ? `Imported ${file}` : 'Package imported');
      await load();
    });
  }

  function syncNow() {
    if (isMissing(api.anki?.sync)) {
      missingAction('Syncing with Anki');
      return;
    }
    return attempt(async () => {
      await api.anki.sync();
      toast('Synced with Anki');
      await load();
    });
  }

  function deckGlance(deck, o) {
    const { name } = deckLabel(deck.name);
    const due = deckDue(deck);
    const studied = countOf(o.today?.studied);
    return h('section', { class: 'ink-panel ink-anki-glance' },
      h('h2', { class: 'ink-anki-glance-title' }, name),
      h('span', { class: 'ink-underline ink-anki-glance-underline', 'aria-hidden': 'true' }),
      h('p', { class: 'ink-anki-glance-sub' }, `${cardsLabel(deckTotal(deck))} · ${due} due today`),
      h('div', { class: 'ink-anki-stats' },
        statBox('New', deck.new), statBox('Learning', deck.learn), statBox('To review', deck.due)),
      h('div', { class: 'ink-anki-done' },
        h('span', { class: 'ink-anki-done-label' }, 'Done today'),
        h('span', { class: 'ink-anki-done-value' }, `${studied} / ${due}`)),
      h('span', { class: 'ink-track ink-anki-done-track' },
        h('i', { class: 'ink-track-fill', style: `width:${inkPercent(studied, due)}%` })),
      h('button', { type: 'button', class: 'ink-bigbtn ink-anki-studynow', onclick: () => studyDeck(deck.name) },
        h('span', {}, 'Study now'), doodle('arrow')));
  }

  function statBox(label, value) {
    return h('div', { class: 'ink-anki-stat' },
      h('b', {}, String(countOf(value))),
      h('span', {}, label));
  }

  function heatPanel(model, stats, hasReviews) {
    const months = h('div', { class: 'ink-heat-months', 'aria-hidden': 'true' },
      model.months.map((month) => h('span', { class: 'ink-heat-month', style: `left:${month.column * HEAT_PITCH}px` }, month.label)));
    const grid = h('div', { class: 'ink-heat-grid', role: 'grid', 'aria-label': 'Review activity, last 12 months' },
      model.weeks.flatMap((week, column) => week.map((cell, row) => heatCell(cell, column, row))));
    const scroller = h('div', { class: 'ink-heat-scroll' }, h('div', { class: 'ink-heat-canvas' }, months, grid));
    requestAnimationFrame(() => {
      if (scroller.isConnected) scroller.scrollLeft = scroller.scrollWidth;
    });
    const dayLabels = h('div', { class: 'ink-heat-days', 'aria-hidden': 'true' },
      ['M', 'W', 'F'].map((label) => h('span', {}, label)));
    const legend = h('div', { class: 'ink-heat-legend' },
      h('span', { class: 'ink-heat-less' }, 'Less'),
      [0, 1, 2, 3].map((level) => h('span', { class: `ink-heat-swatch is-level-${level}` })),
      h('span', { class: 'ink-heat-more' }, 'More'));
    return h('section', { class: 'ink-panel ink-anki-heat' },
      h('div', { class: 'ink-anki-heat-head' },
        h('span', { class: 'ink-tag' }, 'Review activity'),
        h('span', { class: 'ink-anki-heat-range' }, 'Last 12 months')),
      h('div', { class: 'ink-heat-body' },
        h('div', { class: 'ink-heat-map' },
          h('div', { class: 'ink-heat-main' }, dayLabels, scroller),
          legend),
        heatSummary(stats, hasReviews)));
  }

  function heatCell(cell, column, row) {
    const classes = ['ink-heat-cell', `is-level-${cell.level}`];
    if (cell.future) classes.push('is-future');
    if (cell.isToday) classes.push('is-today');
    const label = `${cell.date}: ${cell.count} ${cell.count === 1 ? 'review' : 'reviews'}`;
    return h('span', {
      class: classes.join(' '),
      role: 'gridcell',
      title: label,
      'aria-label': label,
      'data-date': cell.date,
      'data-count': String(cell.count),
      style: `grid-column:${column + 1};grid-row:${row + 1}`,
    });
  }

  function heatSummary(stats, hasReviews) {
    const days = stats.streak === 1 ? 'day' : 'days';
    const note = stats.streak > 0
      ? `You have reviewed on ${stats.streak} ${days} in a row. Keep it going today.`
      : hasReviews
        ? 'You have no streak running. One review today starts a new one.'
        : 'No reviews yet. Study a deck to start your streak.';
    const stat = (label, value) => h('div', { class: 'ink-heat-stat' },
      h('span', { class: 'ink-heat-stat-label' }, label),
      h('b', { class: 'ink-heat-stat-value' }, value));
    return h('div', { class: 'ink-heat-stats' },
      stat('Streak', `${stats.streak} ${days}`),
      stat('Days learned', `${stats.daysLearnedPct}%`),
      stat('Daily average', `${stats.dailyAverage} ${stats.dailyAverage === 1 ? 'card' : 'cards'}`),
      h('p', { class: 'ink-heat-note' }, note));
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
    const view = createStudyCardView({ onReveal: showAnswer, onGrade: grade, onReplay: replayCurrentAudio });
    const grammarBtn = h('button', { type: 'button', class: 'ink-anki-chip', onclick: toggleStudyGrammar }, 'Grammar');
    const styleBtn = h('button', { type: 'button', class: 'ink-anki-chip', onclick: toggleStudyStyle }, 'Original style');
    const remaining = h('span', { class: 'ink-anki-remaining' });
    const reviewed = h('span', { class: 'ink-anki-reviewed' });
    const status = h('span', { class: 'ink-anki-study-status', role: 'status', 'aria-live': 'polite' });
    const grammarSlot = h('div', { class: 'study-grammar ink-anki-grammar', hidden: true });
    studyUI = { view, grammarBtn, styleBtn, remaining, reviewed, status, grammarSlot };
    // One slim 36px row: deck + remaining counts on the left, the small outlined actions right-aligned.
    // The keyboard hint lives in the S9 rating panel, so no second status line is passed to the card.
    fill(content, h('section', { class: 'ink-anki-study' },
      h('div', { class: 'ink-anki-study-bar' },
        h('div', { class: 'ink-anki-study-deck' },
          h('span', { class: 'ink-anki-study-path', title: s.deck ?? '' },
            deck.parent ? `${deck.parent} / ${deck.name}` : deck.name),
          h('span', { class: 'ink-anki-study-meta' }, remaining, reviewed)),
        status,
        h('div', { class: 'ink-anki-study-actions' },
          grammarBtn, styleBtn,
          h('button', { type: 'button', class: 'ink-anki-chip', onclick: openDeckOptionsFromStudy }, 'Deck options'),
          h('button', { type: 'button', class: 'ink-anki-chip', onclick: endStudy }, 'End session'))),
      h('div', { class: 'ink-anki-study-view' }, view.el),
      grammarSlot));
    updateStudyCard();
  }

  function openDeckOptionsFromStudy() {
    const deck = state.study.deck;
    endStudy();
    chooseOptionsDeck(deck);
  }

  function updateStudyCard() {
    const s = state.study;
    if (!studyUI?.view || s.phase !== 'card') return;
    const card = s.cards[s.index];
    if (!card) return;
    const theme = s.style ?? 'app';
    studyUI.view.update({
      frontDoc: studyDoc(card, 'question', theme),
      backDoc: studyDoc(card, 'answer', theme),
      side: s.side,
      buttons: gradeButtons(card),
      busy: s.busy,
      hasAudio: Boolean(card.audio),
      // The 172px rating panel is the frame's; its hint already carries the keyboard help, so the
      // card view gets no extra status line (the slim bar below owns the busy announcement).
      status: '',
      tags: Array.isArray(card.tags) ? card.tags : [],
    });
    const left = Math.max(0, s.cards.length - s.index);
    studyUI.remaining.textContent = s.remaining
      ? `${s.remaining.new} new · ${s.remaining.reviews} reviews · ${s.remaining.learning} learning`
      : `${left} ${left === 1 ? 'card' : 'cards'} left`;
    studyUI.reviewed.textContent = `${s.reviewed} reviewed this session`;
    studyUI.styleBtn.textContent = theme === 'app' ? 'Original style' : 'App style';
    studyUI.grammarBtn.hidden = s.side !== 'answer' || !plainSentence(card.sentence);
    studyUI.grammarBtn.disabled = s.busy;
    studyUI.styleBtn.disabled = s.busy;
    studyUI.status.textContent = s.busy ? 'Saving review…' : '';
    syncStudyGrammar(card);
    syncHeader();
  }

  function updateStudyBusy() {
    updateStudyCard();
  }

  function syncStudyGrammar(card) {
    const slot = studyUI.grammarSlot;
    const text = plainSentence(card.sentence);
    studyUI.grammarBtn.setAttribute('aria-pressed', String(studyGrammarOpen && state.study.side === 'answer'));
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
    const s = state.study;
    if (!studyUI || s.phase !== 'card' || s.busy) return;
    const card = s.cards[s.index];
    if (!card || s.side !== 'answer' || !plainSentence(card.sentence)) return;
    studyGrammarOpen = !studyGrammarOpen;
    localStorage.setItem(GRAMMAR_PREF, studyGrammarOpen ? 'open' : 'closed');
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

  function replayCurrentAudio() {
    const card = state.study.cards[state.study.index];
    if (card?.audio) playStudyAudio(card.audio);
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
    if (e.key === 'Escape' && deckMenu) {
      closeDeckMenu();
      return;
    }
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
