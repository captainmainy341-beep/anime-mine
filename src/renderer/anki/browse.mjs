import { attempt, fill, h, toast } from '../lib/ui.mjs';
import { doodle, withIcon } from '../lib/doodleIcons.mjs';
import { renderGrammarGuide } from '../lib/grammarGuide.mjs';
import { stateBadge } from '../lib/ankiView.mjs';
import {
  ACTION_CARD_LIMIT,
  COLUMNS,
  COLUMNS_KEY,
  DEFAULT_SORT,
  FLAG_NAMES,
  PAGE_SIZE,
  SEARCH_HISTORY_KEY,
  SYNTAX_HELP,
  addChip,
  appendTerm,
  buildDeckTree,
  buryAction,
  changedFields,
  columnById,
  composeQuery,
  deckSubtree,
  draftDirty,
  emptySelection,
  flagTarget,
  flattenTree,
  hasMore,
  isFieldEditable,
  markAction,
  neighbourId,
  noteTypeChip,
  nextSort,
  pageLabel,
  parseColumns,
  parseHistory,
  pruneSelection,
  pushHistory,
  removeChip,
  rowStatus,
  savedChip,
  selectAll,
  selectOnly,
  selectRange,
  selectionDropsDraft,
  serializeColumns,
  suspendAction,
  tagChip,
  toggleColumn,
  toggleSelected,
  validateDueDate,
} from '../lib/ankiBrowseModel.mjs';

const SEARCH_DEBOUNCE_MS = 250;
const LOCATE_MAX_PAGES = 5;
const MAY_REMOVE_ROWS = ['deleteNotes', 'changeDeck'];

const dateText = (ms) => (ms ? new Date(ms).toLocaleDateString() : '—');
const dayText = (days) => (days > 0 ? `${days}d` : '—');
const secondsText = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function mountBrowse(container, ctx) {
  const api = window.api;
  const visible = ctx.decks ?? [];
  const readOnly = !!ctx.readOnly;
  const initial = ctx.initial ?? {};
  const storage = window.localStorage;

  let disposed = false;
  let seq = 0;
  let timer = null;
  let pop = null;
  let busy = false;
  let saving = false;
  let grammarSeq = 0;
  let infoSeq = 0;
  let pendingCardId = initial.cardId ?? null;
  const mediaCache = new Map();

  const s = {
    text: '',
    chips: [],
    deckPath: initial.deck ?? null,
    sort: { ...DEFAULT_SORT },
    columns: parseColumns(storage.getItem(COLUMNS_KEY)),
    history: parseHistory(storage.getItem(SEARCH_HISTORY_KEY)),
    cards: [],
    total: 0,
    loading: false,
    error: null,
    selection: emptySelection(),
    focusId: null,
    facets: null,
    collapsed: new Set(),
    sideOpen: false,
    tab: 'card',
    grammarOpen: false,
    draft: null,
    grammar: null,
    info: null,
  };

  const historyList = h('div', { class: 'bw-pop-list' });
  const historyPop = h('div', { class: 'bw-pop bw-history', role: 'listbox', 'aria-label': 'Recent searches', hidden: true }, historyList);
  const searchInput = h('input', {
    type: 'search',
    class: 'bw-search',
    placeholder: 'Search — try tag:leech  is:due  prop:ivl>21  "exact phrase"',
    'aria-label': 'Search cards',
    oninput: (e) => onSearchInput(e.target.value),
    onkeydown: onSearchKey,
    onfocus: () => openHistory(),
    onchange: () => commitHistory(),
  });
  const sideList = h('div', { class: 'bw-side-body' });
  const chipsBox = h('div', { class: 'bw-chips' });
  const headTitle = h('h2', { class: 'bw-title' });
  const banner = h('div', { class: 'bw-banner-slot' });
  const toolbarBox = h('div', { class: 'bw-toolbar-slot' });
  const tableWrap = h('div', { class: 'bw-table-wrap' });
  const footer = h('div', { class: 'bw-footer' });
  const detailBox = h('div', { class: 'bw-detail-body' });
  const side = h('aside', { class: 'bw-side', 'aria-label': 'Filters' }, sideList);
  const detail = h('aside', { class: 'bw-detail', 'aria-label': 'Card details' }, h('button', { type: 'button', class: 'bw-close', onclick: () => clearSelection() }, 'Close'), detailBox);
  const sideToggle = h('button', {
    type: 'button',
    class: 'bw-side-toggle',
    'aria-expanded': 'false',
    onclick: () => {
      s.sideOpen = !s.sideOpen;
      root.classList.toggle('side-open', s.sideOpen);
      sideToggle.setAttribute('aria-expanded', String(s.sideOpen));
    },
  }, 'Filters');
  const root = h(
    'div',
    { class: 'bw' },
    side,
    h(
      'div',
      { class: 'bw-main' },
      h(
        'div',
        { class: 'bw-head' },
        sideToggle,
        headTitle,
        h('div', { class: 'bw-search-row' }, searchInput, cheatButton(), historyBox()),
        chipsBox,
      ),
      banner,
      toolbarBox,
      tableWrap,
      footer,
    ),
    detail,
  );
  container.append(root);
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointer);
  refreshFacets();
  load();
  renderSide();
  renderChips();
  renderDetail();

  const dispose = () => {
    disposed = true;
    clearTimeout(timer);
    closePop();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onPointer);
  };
  dispose.isDirty = isDirty;
  return dispose;

  function cheatButton() {
    return h('button', {
      type: 'button',
      class: 'bw-cheat-btn',
      'aria-label': 'Search syntax help',
      'aria-haspopup': 'dialog',
      onclick: (e) => openPop('cheat', e.currentTarget, cheatSheet),
    }, '?');
  }

  function historyBox() {
    return h('div', { class: 'bw-history-anchor' }, historyPop);
  }

  function scopeNames() {
    return s.deckPath ? deckSubtree(visible, s.deckPath) : visible;
  }

  function query() {
    return composeQuery(s.text, s.chips);
  }

  function order() {
    return s.cards.map((card) => card.id);
  }

  function selectedCards() {
    const byId = new Map(s.cards.map((card) => [card.id, card]));
    return s.selection.ids.map((id) => byId.get(id)).filter(Boolean);
  }

  function focusedCard() {
    return s.cards.find((card) => card.id === s.focusId) ?? selectedCards()[0] ?? null;
  }

  function onSearchInput(value) {
    if (!confirmDiscard()) {
      searchInput.value = s.text;
      return;
    }
    s.text = value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!disposed) load();
    }, SEARCH_DEBOUNCE_MS);
  }

  function onSearchKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (pop) return closePop();
      if (historyPop.hidden === false) return closeHistory();
      if (!s.text) return;
      searchInput.value = '';
      onSearchInput('');
    } else if (e.key === 'Enter') {
      commitHistory();
      clearTimeout(timer);
      load();
    }
  }

  function commitHistory() {
    s.history = pushHistory(s.history, query());
    storage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(s.history));
  }

  function openHistory() {
    if (!s.history.length) return;
    fill(
      historyList,
      s.history.map((q) =>
        h('button', {
          type: 'button',
          class: 'bw-pop-item',
          role: 'option',
          onmousedown: (e) => e.preventDefault(),
          onclick: () => {
            closeHistory();
            if (!confirmDiscard()) return;
            s.text = q;
            searchInput.value = q;
            clearTimeout(timer);
            load();
          },
        }, q),
      ),
    );
    historyPop.hidden = false;
  }

  function closeHistory() {
    historyPop.hidden = true;
  }

  function onPointer(e) {
    if (pop && !pop.el.contains(e.target) && !pop.anchor?.contains(e.target)) closePop();
    if (!historyPop.hidden && !historyPop.parentElement.contains(e.target)) closeHistory();
  }

  function openPop(name, anchor, build) {
    if (pop?.name === name) return closePop();
    closePop();
    const el = h('div', { class: 'bw-pop', role: 'dialog', 'aria-label': name }, build());
    root.append(el);
    const box = root.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    el.style.top = `${at.bottom - box.top + 6}px`;
    el.style.left = `${Math.max(8, Math.min(at.left - box.left, box.width - el.offsetWidth - 8))}px`;
    pop = { name, el, anchor };
    el.querySelector('input, button, select')?.focus();
    return pop;
  }

  function closePop() {
    pop?.el.remove();
    pop = null;
  }

  function cheatSheet() {
    return h(
      'div',
      { class: 'bw-cheat' },
      h('p', { class: 'bw-muted' }, 'Click a term to add it to the search.'),
      h(
        'ul',
        { class: 'bw-cheat-list' },
        SYNTAX_HELP.map((entry) =>
          h(
            'li',
            {},
            h('button', {
              type: 'button',
              class: 'bw-cheat-term',
              onclick: () => {
                const next = appendTerm(s.text, entry.insert ?? entry.syntax);
                closePop();
                searchInput.focus();
                searchInput.value = next;
                onSearchInput(next);
              },
            }, h('code', {}, entry.syntax)),
            h('span', { class: 'bw-muted' }, entry.text),
          ),
        ),
      ),
    );
  }

  async function refreshFacets() {
    try {
      const facets = await api.anki.facets({ decks: visible });
      if (disposed) return;
      s.facets = facets;
      renderSide();
    } catch (err) {
      if (disposed) return;
      toast(err.message, 'error');
    }
  }

  function browsePage(offset) {
    return api.anki.browse({
      decks: scopeNames(),
      query: query() || undefined,
      limit: PAGE_SIZE,
      offset,
      sort: s.sort.sort,
      desc: s.sort.desc,
    });
  }

  async function locateInitialCard(mine) {
    const cardId = pendingCardId;
    const info = await api.anki.cardInfo({ cardId, decks: visible }).catch((err) => {
      toast(err.message, 'error');
      return null;
    });
    if (disposed || mine !== seq) return;
    if (!info?.card.deck) {
      pendingCardId = null;
      return;
    }
    s.deckPath = info.card.deck;
    renderSide();
    let cards = [];
    let total = 0;
    for (let page = 0; page < LOCATE_MAX_PAGES; page++) {
      const res = await browsePage(cards.length);
      if (disposed || mine !== seq) return;
      cards = [...cards, ...res.cards];
      total = res.total;
      if (cards.some((card) => card.id === cardId) || !hasMore(cards.length, total)) break;
    }
    s.cards = cards;
    s.total = total;
  }

  async function load({ append = false } = {}) {
    const mine = ++seq;
    if (!append) s.error = null;
    s.loading = true;
    renderHeader();
    renderBanner();
    renderTable();
    renderFooter();
    try {
      const res = await browsePage(append ? s.cards.length : 0);
      if (disposed || mine !== seq) return;
      s.cards = append ? [...s.cards, ...res.cards] : res.cards;
      s.total = res.total;
      if (!append && pendingCardId != null && !s.cards.some((card) => card.id === pendingCardId) && hasMore(s.cards.length, s.total)) {
        await locateInitialCard(mine);
        if (disposed || mine !== seq) return;
      }
      if (pendingCardId != null) {
        const found = s.cards.find((card) => card.id === pendingCardId);
        if (found) s.selection = selectOnly(found.id);
        s.focusId = pendingCardId;
        pendingCardId = null;
      }
      s.selection = pruneSelection(s.selection, order());
      if (!s.focusId || !s.cards.some((card) => card.id === s.focusId)) s.focusId = s.selection.ids[0] ?? s.cards[0]?.id ?? null;
    } catch (err) {
      if (disposed || mine !== seq) return;
      s.error = err.message;
    }
    s.loading = false;
    renderAll();
  }

  function renderAll() {
    renderHeader();
    renderBanner();
    renderChips();
    renderToolbar();
    renderTable();
    renderFooter();
    renderDetail();
    root.classList.toggle('has-selection', s.selection.ids.length > 0);
  }

  function renderHeader() {
    const scope = s.deckPath ?? 'All decks';
    const count = s.loading && !s.cards.length ? 'Searching…' : `${pageLabel(s.cards.length, s.total)} cards`;
    fill(headTitle, `${scope} · ${count}`);
    tableWrap.setAttribute('aria-busy', String(s.loading));
  }

  function renderBanner() {
    fill(
      banner,
      s.error
        ? h(
            'div',
            { class: 'bw-banner', role: 'alert' },
            h('span', {}, `Couldn’t load cards: ${s.error}`),
            h('button', { type: 'button', class: 'bw-btn', onclick: () => { if (confirmDiscard()) load(); } }, 'Retry'),
          )
        : null,
    );
  }

  function renderChips() {
    fill(
      chipsBox,
      s.chips.map((chip) =>
        h(
          'span',
          { class: 'bw-chip' },
          chip.label,
          h('button', {
            type: 'button',
            class: 'bw-chip-x',
            'aria-label': `Remove ${chip.label}`,
            onclick: () => {
              if (!confirmDiscard()) return;
              s.chips = removeChip(s.chips, chip.id);
              renderChips();
              load();
            },
          }, '×'),
        ),
      ),
      s.deckPath
        ? h('span', { class: 'bw-chip' }, `Deck: ${s.deckPath}`, h('button', {
            type: 'button',
            class: 'bw-chip-x',
            'aria-label': 'Show all decks',
            onclick: () => {
              if (!confirmDiscard()) return;
              s.deckPath = null;
              renderChips();
              load();
            },
          }, '×'))
        : null,
    );
  }

  function addFilter(chip) {
    if (!confirmDiscard()) return;
    s.chips = addChip(s.chips, chip);
    renderChips();
    load();
  }

  function renderSide() {
    const facets = s.facets;
    const item = (active, label, count, onclick, extra = null) =>
      h(
        'li',
        {},
        h('button', { type: 'button', class: active ? 'bw-side-item active' : 'bw-side-item', 'aria-pressed': String(active), onclick },
          h('span', { class: 'bw-side-label' }, label),
          extra,
          count == null ? null : h('span', { class: 'bw-count' }, String(count)),
        ),
      );
    if (!facets) {
      fill(sideList, h('p', { class: 'bw-muted' }, 'Loading filters…'));
      return;
    }
    const tree = flattenTree(buildDeckTree(facets.decks), s.collapsed);
    const allTotal = facets.decks.reduce((n, d) => n + d.total, 0);
    fill(
      sideList,
      h('h3', { class: 'bw-lab' }, 'Saved filters'),
      h('ul', { class: 'bw-side-list' }, facets.saved.map((saved) => item(false, saved.label, saved.count, () => addFilter(savedChip(saved))))),
      h('h3', { class: 'bw-lab' }, 'Decks'),
      h(
        'ul',
        { class: 'bw-side-list bw-tree' },
        item(s.deckPath == null, 'All decks', allTotal, () => setDeck(null)),
        tree.map(({ node, depth }) => {
          const open = !s.collapsed.has(node.path);
          const arrow = node.children.length
            ? h('button', {
                type: 'button',
                class: 'bw-arrow',
                'aria-expanded': String(open),
                'aria-label': `${open ? 'Collapse' : 'Expand'} ${node.name}`,
                onclick: (e) => {
                  e.stopPropagation();
                  if (open) s.collapsed.add(node.path);
                  else s.collapsed.delete(node.path);
                  renderSide();
                },
              }, doodle(open ? 'down' : 'right'))
            : h('span', { class: 'bw-arrow-gap' });
          return h(
            'li',
            { class: 'bw-tree-row', style: `--depth:${depth}` },
            arrow,
            h('button', {
              type: 'button',
              class: s.deckPath === node.path ? 'bw-side-item active' : 'bw-side-item',
              'aria-pressed': String(s.deckPath === node.path),
              onclick: () => setDeck(node.path),
            },
              h('span', { class: 'bw-side-label' }, node.name),
              h('span', { class: 'bw-count due', title: 'Due' }, String(node.due)),
              h('span', { class: 'bw-count new', title: 'New' }, String(node.new)),
            ),
          );
        }),
      ),
      h('h3', { class: 'bw-lab' }, 'Tags'),
      h('ul', { class: 'bw-side-list' }, facets.tags.map((tag) => item(false, `#${tag.name}`, tag.count, () => addFilter(tagChip(tag.name))))),
      h('h3', { class: 'bw-lab' }, 'Note types'),
      h('ul', { class: 'bw-side-list' }, facets.noteTypes.map((type) => item(false, type.name, type.count, () => addFilter(noteTypeChip(type.name))))),
    );
  }

  function setDeck(path) {
    if (!confirmDiscard()) return;
    s.deckPath = path;
    s.sideOpen = false;
    root.classList.remove('side-open');
    sideToggle.setAttribute('aria-expanded', 'false');
    renderSide();
    renderChips();
    load();
  }

  function renderToolbar() {
    const picked = selectedCards();
    if (!picked.length) {
      fill(toolbarBox, h('div', { class: 'bw-hint' }, 'Click a row to select it · Ctrl/⌘-click adds · Shift-click selects a range · ⌘A selects all loaded'));
      return;
    }
    const disabled = busy || readOnly;
    const title = readOnly ? 'Sample data is read-only' : null;
    const btn = (label, onclick, cls = 'bw-btn') =>
      h('button', { type: 'button', class: cls, disabled, title, onclick }, label);
    fill(
      toolbarBox,
      h(
        'div',
        { class: 'bw-toolbar', role: 'toolbar', 'aria-label': 'Bulk actions' },
        h('span', { class: 'bw-sel-count' }, `${picked.length} selected`),
        btn(suspendAction(picked) === 'suspend' ? 'Suspend' : 'Unsuspend', () => act(suspendAction(picked), {}, 'Updated suspension')),
        h('button', { type: 'button', class: 'bw-btn', disabled, title, 'aria-haspopup': 'dialog', onclick: (e) => openPop('flag', e.currentTarget, flagMenu) }, 'Flag…'),
        btn(markAction(picked) === 'mark' ? 'Mark' : 'Unmark', () => act(markAction(picked), {}, 'Updated marks')),
        h('button', { type: 'button', class: 'bw-btn', disabled, title, 'aria-haspopup': 'dialog', onclick: (e) => openPop('tags', e.currentTarget, tagsMenu) }, 'Tags…'),
        h('button', { type: 'button', class: 'bw-btn', disabled, title, 'aria-haspopup': 'dialog', onclick: (e) => openPop('deck', e.currentTarget, deckMenu) }, 'Change deck…'),
        h('button', { type: 'button', class: 'bw-btn', disabled, title, 'aria-haspopup': 'dialog', onclick: (e) => openPop('due', e.currentTarget, dueMenu) }, 'Due date…'),
        btn('Reset', () => confirmAct('forget', {}, `Reset ${plural(picked.length, 'card')} to new? Their scheduling is forgotten.`, 'Reset')),
        btn(buryAction(picked) === 'bury' ? 'Bury' : 'Unbury', () => act(buryAction(picked), {}, 'Updated burying')),
        btn('Delete', () => confirmAct('deleteNotes', { confirm: true }, `Delete ${plural(picked.length, 'note')} from Anki? This cannot be undone.`, 'Delete'), 'bw-btn danger'),
      ),
    );
  }

  function flagMenu() {
    return h(
      'div',
      { class: 'bw-menu' },
      FLAG_NAMES.map((name, flag) =>
        h('button', {
          type: 'button',
          class: 'bw-menu-item',
          onclick: () => {
            closePop();
            act('flag', { flag }, flag ? `Flag set to ${name}` : 'Flag cleared');
          },
        }, h('span', { class: `bw-swatch flag-${name}` }), flag ? `${flag} · ${name}` : '0 · none'),
      ),
    );
  }

  function tagsMenu() {
    const input = h('input', { type: 'text', class: 'bw-input', list: 'bw-tag-list', 'aria-label': 'Tags', placeholder: 'tag1 tag2' });
    const apply = (action) => {
      const tags = input.value.split(/[\s,]+/).filter(Boolean);
      if (!tags.length) return toast('Type at least one tag', 'error');
      closePop();
      act(action, { tags }, action === 'addTags' ? 'Tags added' : 'Tags removed');
    };
    return h(
      'div',
      { class: 'bw-form' },
      input,
      h('datalist', { id: 'bw-tag-list' }, (s.facets?.tags ?? []).map((t) => h('option', { value: t.name }))),
      h('div', { class: 'bw-form-actions' },
        h('button', { type: 'button', class: 'bw-btn primary', onclick: () => apply('addTags') }, 'Add'),
        h('button', { type: 'button', class: 'bw-btn', onclick: () => apply('removeTags') }, 'Remove'),
      ),
    );
  }

  function deckMenu() {
    const select = h('select', { class: 'bw-input', 'aria-label': 'Target deck' }, visible.map((name) => h('option', { value: name }, name)));
    return h(
      'div',
      { class: 'bw-form' },
      select,
      h('div', { class: 'bw-form-actions' },
        h('button', {
          type: 'button',
          class: 'bw-btn primary',
          onclick: () => {
            const deck = select.value;
            closePop();
            act('changeDeck', { deck }, `Moved to ${deck}`);
          },
        }, 'Move'),
      ),
    );
  }

  function dueMenu() {
    const input = h('input', { type: 'text', class: 'bw-input', 'aria-label': 'Days', placeholder: '0, 3-7, 2!' });
    const message = h('p', { class: 'bw-muted', role: 'status' }, '0 = today · 3-7 = random in range · ! = reset interval');
    return h(
      'div',
      { class: 'bw-form' },
      input,
      message,
      h('div', { class: 'bw-form-actions' },
        h('button', {
          type: 'button',
          class: 'bw-btn primary',
          onclick: () => {
            const check = validateDueDate(input.value);
            if (!check.ok) {
              message.textContent = check.error;
              message.classList.add('bw-error');
              return;
            }
            closePop();
            act('setDueDate', { days: check.value }, 'Due date set');
          },
        }, 'Apply'),
      ),
    );
  }

  function confirmAct(action, args, question, label) {
    if (!window.confirm(question)) return;
    act(action, args, `${label} done`);
  }

  async function act(action, args, label) {
    const cards = selectedCards();
    if (!cards.length || busy || readOnly) return;
    const ids = cards.map((card) => card.id);
    if (ids.length > ACTION_CARD_LIMIT) return toast(`Choose at most ${ACTION_CARD_LIMIT} cards`, 'error');
    if (MAY_REMOVE_ROWS.includes(action) && !confirmDiscard()) return;
    busy = true;
    renderToolbar();
    let ok = false;
    try {
      await api.anki.cardAction({ action, cardIds: ids, args, decks: visible });
      ok = true;
      toast(`${label} · ${plural(ids.length, 'card')}`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    busy = false;
    if (disposed) return;
    if (ok) refreshFacets();
    await load();
  }

  function renderTable() {
    if (s.loading && !s.cards.length) {
      fill(tableWrap, h('table', { class: 'bw-table' }, h('tbody', {}, Array.from({ length: 6 }, () => h('tr', { class: 'bw-skel' }, h('td', { colspan: String(s.columns.length) }, h('span', {}))))))); 
      return;
    }
    if (!s.cards.length) {
      const hasFilter = !!query() || s.chips.length > 0 || s.deckPath;
      fill(
        tableWrap,
        h(
          'div',
          { class: 'bw-empty' },
          h('h3', {}, query() ? `No cards match “${query()}”` : 'No cards here'),
          h('p', { class: 'bw-muted' }, 'Try another deck, or clear the search.'),
          hasFilter ? h('button', { type: 'button', class: 'bw-btn primary', onclick: clearFilters }, 'Clear search') : null,
        ),
      );
      return;
    }
    const focus = s.focusId ?? s.cards[0].id;
    const cols = s.columns.map((id) => columnById(id)).filter(Boolean);
    fill(
      tableWrap,
      h(
        'table',
        { class: 'bw-table', role: 'grid', 'aria-multiselectable': 'true', 'aria-label': 'Cards', onkeydown: onTableKey },
        h(
          'thead',
          {},
          h('tr', { role: 'row' }, cols.map((col) => headerCell(col))),
        ),
        h(
          'tbody',
          {},
          s.cards.map((card) => rowFor(card, cols, focus)),
        ),
      ),
    );
  }

  function headerCell(col) {
    if (!col.sort) return h('th', { role: 'columnheader', scope: 'col' }, col.label);
    const active = s.sort.sort === col.sort;
    const aria = active ? (s.sort.desc ? 'descending' : 'ascending') : 'none';
    return h(
      'th',
      { role: 'columnheader', scope: 'col', 'aria-sort': aria, class: active ? 'bw-sorted' : null },
      h(
        'button',
        { type: 'button', class: 'bw-sort', onclick: () => sortBy(col.sort) },
        col.label,
        h('span', { class: 'bw-arrow-sort', 'aria-hidden': 'true' }, active ? doodle(s.sort.desc ? 'down' : 'up') : ''),
      ),
    );
  }

  function sortBy(sort) {
    if (!confirmDiscard()) return;
    s.sort = nextSort(s.sort, sort);
    load();
  }

  function rowFor(card, cols, focus) {
    const status = rowStatus(card);
    const picked = s.selection.ids.includes(card.id);
    return h(
      'tr',
      {
        role: 'row',
        'data-id': String(card.id),
        class: ['bw-row', `flag-${status.flag}`, status.suspended ? 'is-suspended' : '', status.buried ? 'is-buried' : ''].filter(Boolean).join(' '),
        'aria-selected': String(picked),
        tabindex: card.id === focus ? '0' : '-1',
        onmousedown: (e) => { if (e.shiftKey) e.preventDefault(); },
        onclick: (e) => onRowClick(e, card.id),
        onfocus: () => { s.focusId = card.id; },
      },
      cols.map((col, i) => h('td', { role: 'gridcell', class: `bw-col-${col.id}` }, i === 0 && status.marked ? h('span', { class: 'bw-mark', title: 'Marked', 'aria-label': 'Marked' }) : null, cellText(card, col.id))),
    );
  }

  function cellText(card, id) {
    switch (id) {
      case 'word': return h('span', { class: 'bw-word' }, card.word || '—');
      case 'state': { const badge = stateBadge(card); return h('span', { class: `anki-badge tone-${badge.tone}` }, badge.label); }
      case 'due': return card.dueText ?? '';
      case 'interval': return dayText(card.interval);
      case 'ease': return card.easePct != null ? `${card.easePct}%` : '—';
      case 'reviews': return String(card.reps ?? 0);
      case 'created': return dateText(card.createdTs);
      case 'modified': return dateText(card.modifiedTs);
      case 'tags': return (card.tags ?? []).join(' ');
      case 'noteType': return card.noteType ?? '';
      default: return String(card[id] ?? '');
    }
  }

  function clearFilters() {
    if (!confirmDiscard()) return;
    s.text = '';
    s.chips = [];
    s.deckPath = null;
    searchInput.value = '';
    renderSide();
    renderChips();
    load();
  }

  function renderFooter() {
    const shown = s.cards.length;
    fill(
      footer,
      h('span', { class: 'bw-muted' }, s.total ? `Showing ${pageLabel(shown, s.total)}` : ''),
      hasMore(shown, s.total) && !s.loading
        ? h('button', { type: 'button', class: 'bw-btn', onclick: () => load({ append: true }) }, 'Load more')
        : null,
      h('button', { type: 'button', class: 'bw-btn ghost', 'aria-haspopup': 'dialog', onclick: (e) => openPop('columns', e.currentTarget, columnMenu) }, 'Columns…'),
    );
  }

  function columnMenu() {
    return h(
      'div',
      { class: 'bw-menu' },
      COLUMNS.map((col) =>
        h('label', { class: 'bw-menu-item' },
          h('input', {
            type: 'checkbox',
            checked: s.columns.includes(col.id),
            onchange: (e) => {
              s.columns = toggleColumn(s.columns, col.id);
              e.target.checked = s.columns.includes(col.id);
              storage.setItem(COLUMNS_KEY, serializeColumns(s.columns));
              renderTable();
            },
          }),
          col.label,
        ),
      ),
    );
  }

  function onRowClick(e, id) {
    let next = selectOnly(id);
    if (e.metaKey || e.ctrlKey) next = toggleSelected(s.selection, id);
    else if (e.shiftKey) next = selectRange(s.selection, order(), id);
    if (!canSelect(next)) return;
    s.selection = next;
    select(id);
  }

  function select(id) {
    s.focusId = id;
    renderToolbar();
    renderTable();
    renderDetail();
    root.classList.toggle('has-selection', s.selection.ids.length > 0);
    tableWrap.querySelector(`tr[data-id="${id}"]`)?.focus({ preventScroll: false });
  }

  function clearSelection() {
    if (!confirmDiscard()) return;
    s.selection = emptySelection();
    select(s.focusId);
  }

  function selectAllRows() {
    const next = selectAll(order());
    if (!canSelect(next)) return;
    s.selection = next;
    select(s.cards[0]?.id ?? null);
  }

  function onTableKey(e) {
    const row = e.target.closest('tr[data-id]');
    if (!row) return;
    const id = Number(row.dataset.id);
    const keys = { ArrowDown: 1, ArrowUp: -1, Home: 'start', End: 'end' };
    if (e.key in keys) {
      e.preventDefault();
      const target = neighbourId(order(), id, keys[e.key]);
      if (target == null) return;
      const next = e.shiftKey ? selectRange(s.selection, order(), target) : selectOnly(target);
      if (!canSelect(next)) return;
      s.selection = next;
      select(target);
    } else if (e.key === ' ') {
      e.preventDefault();
      const next = toggleSelected(s.selection, id);
      if (!canSelect(next)) return;
      s.selection = next;
      select(id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      detail.querySelector('.bw-tab[aria-selected="true"]')?.focus();
    }
  }

  function canSelect(selection) {
    return !selectionDropsDraft(s.draft, selection) || confirmDiscard();
  }

  function confirmDiscard() {
    if (!isDirty()) return true;
    if (!window.confirm('Discard unsaved edits to this card?')) return false;
    s.draft = null;
    return true;
  }

  function isDirty() {
    return draftDirty(s.draft);
  }

  function renderDetail() {
    const picked = selectedCards();
    if (!picked.length) {
      s.draft = null;
      fill(detailBox, h('p', { class: 'bw-muted bw-detail-empty' }, 'Select a card to see its details.'));
      return;
    }
    if (picked.length > 1) {
      fill(detailBox, h('h3', {}, `${picked.length} cards selected`), h('p', { class: 'bw-muted' }, 'Use the toolbar above to act on them together.'));
      return;
    }
    const card = picked[0];
    if (s.draft?.id !== card.id) {
      s.draft = { id: card.id, noteId: card.noteId, original: { ...card.fields }, values: { ...card.fields } };
    }
    const tabs = [['card', 'Card'], ['info', 'Info']].map(([id, label]) =>
      h('button', {
        type: 'button',
        role: 'tab',
        class: 'bw-tab',
        'aria-selected': String(s.tab === id),
        onclick: () => {
          s.tab = id;
          renderDetail();
        },
      }, label),
    );
    const body = s.tab === 'info' ? infoPane(card) : cardPane(card);
    fill(
      detailBox,
      h('div', { class: 'bw-detail-head' },
        h('div', { class: 'bw-detail-word' }, card.word || '—'),
        h('div', { class: 'bw-muted' }, [card.reading, card.meaning].filter(Boolean).join(' · ')),
      ),
      h('div', { class: 'bw-tabs', role: 'tablist' }, tabs),
      body,
    );
  }

  function cardPane(card) {
    const dirty = isDirty();
    const fieldRows = Object.keys(card.fields).map((name) => fieldRow(name, card.fieldsTruncated ?? []));
    const grammarBody = h('div', { class: 'bw-grammar-body', 'data-id': String(card.id) });
    const grammar = h(
      'details',
      { class: 'bw-grammar', open: s.grammarOpen, ontoggle: (e) => { s.grammarOpen = e.currentTarget.open; if (s.grammarOpen) fetchGrammar(card, grammarBody); } },
      h('summary', {}, 'Particle & grammar guide'),
      grammarBody,
    );
    if (s.grammarOpen) fetchGrammar(card, grammarBody);
    return h(
      'div',
      { class: 'bw-card-pane' },
      shotBox(card.picture),
      h('div', { class: 'bw-row-actions' },
        h('button', { type: 'button', class: 'bw-btn', disabled: !card.audio, onclick: () => playAudio(card.audio) }, withIcon('play', 'Play audio')),
        h('button', { type: 'button', class: 'bw-btn', disabled: readOnly, title: readOnly ? 'Sample data is read-only' : null, onclick: () => openInAnki(card) }, 'Open in Anki'),
      ),
      fieldRows,
      h('div', { class: 'bw-save-row' },
        h('button', { type: 'button', class: 'bw-btn primary', disabled: !dirty || readOnly || saving, onclick: saveDraft }, saving ? 'Saving…' : 'Save'),
        h('span', { class: 'bw-muted', role: 'status' }, dirty ? 'Unsaved changes · ⌘/Ctrl+Enter saves' : ''),
      ),
      grammar,
    );
  }

  function fieldRow(name, truncated) {
    const editable = isFieldEditable(name, { readOnly, truncated });
    const note = truncated.includes(name) ? ' · Long field — edit in Anki' : ' · read-only';
    const label = h('label', { class: 'bw-field-label', for: `bw-f-${name}` }, name, editable ? null : h('span', { class: 'bw-muted' }, note));
    if (!editable) {
      const text = s.draft.values[name] ?? '';
      return h('div', { class: 'bw-field' }, label, h('div', { class: 'bw-field-ro', id: `bw-f-${name}` }, text || '—'));
    }
    return h('div', { class: 'bw-field' }, label, h('textarea', {
      id: `bw-f-${name}`,
      class: 'bw-field-input',
      rows: '2',
      value: s.draft.values[name] ?? '',
      oninput: (e) => {
        s.draft.values[name] = e.target.value;
        const dirty = isDirty();
        const save = detailBox.querySelector('.bw-save-row .primary');
        if (save) save.disabled = !dirty || saving;
        const note = detailBox.querySelector('.bw-save-row .bw-muted');
        if (note) note.textContent = dirty ? 'Unsaved changes · ⌘/Ctrl+Enter saves' : '';
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          saveDraft();
        }
      },
    }));
  }

  async function saveDraft() {
    const draft = s.draft;
    if (!draft || saving || readOnly) return;
    const changed = changedFields(draft.original, draft.values);
    if (!Object.keys(changed).length) return;
    saving = true;
    renderDetail();
    try {
      await api.anki.updateNote({ noteId: draft.noteId, fields: changed });
      if (s.draft === draft) draft.original = { ...draft.original, ...changed };
      toast('Saved to Anki', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
    saving = false;
    if (disposed) return;
    renderDetail();
    await load();
  }

  function openInAnki(card) {
    return attempt(() => api.anki.openInAnki(card.noteId));
  }

  function mediaUrl(name) {
    if (!mediaCache.has(name)) {
      const pending = api.anki.media(name).then((url) => url ?? null);
      pending.catch(() => mediaCache.delete(name));
      mediaCache.set(name, pending);
    }
    return mediaCache.get(name);
  }

  function shotBox(picture) {
    const box = h('div', { class: 'bw-shot' });
    if (!picture) return box;
    mediaUrl(picture).then((url) => {
      if (!disposed && url && box.isConnected) box.replaceChildren(h('img', { src: url, alt: '' }));
    }, () => {});
    return box;
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

  function fetchGrammar(card, body) {
    body.dataset.id = String(card.id);
    const sentence = card.sentence ?? '';
    if (!sentence) {
      fill(body, h('p', { class: 'bw-muted' }, 'No sentence on this card.'));
      return;
    }
    if (s.grammar?.id === card.id && (s.grammar.analysis || s.grammar.error || s.grammar.pending)) {
      showGrammar(body);
      return;
    }
    const mine = ++grammarSeq;
    s.grammar = { id: card.id, pending: true, analysis: null, error: null };
    fill(body, h('p', { class: 'bw-muted' }, 'Analysing…'));
    const paint = () => {
      const live = detailBox.querySelector('.bw-grammar-body');
      if (live?.dataset.id === String(card.id)) showGrammar(live);
    };
    window.api.grammar.analyze(sentence).then(
      (analysis) => {
        if (disposed || mine !== grammarSeq) return;
        s.grammar = { id: card.id, pending: false, analysis, error: null };
        paint();
      },
      (err) => {
        if (disposed || mine !== grammarSeq) return;
        s.grammar = { id: card.id, pending: false, analysis: null, error: err.message };
        paint();
      },
    );
  }

  function showGrammar(body) {
    if (s.grammar.analysis) fill(body, renderGrammarGuide(s.grammar.analysis));
    else if (s.grammar.error) fill(body, h('p', { class: 'bw-muted' }, `Couldn’t analyse this sentence: ${s.grammar.error}`));
    else fill(body, h('p', { class: 'bw-muted' }, 'Analysing…'));
  }

  function infoPane(card) {
    const box = h('div', { class: 'bw-info' }, h('p', { class: 'bw-muted' }, 'Loading…'));
    loadInfo(card, box);
    return box;
  }

  async function loadInfo(card, box) {
    if (s.info?.id === card.id && s.info.data) {
      fill(box, infoContent(s.info.data));
      return;
    }
    const mine = ++infoSeq;
    try {
      const data = await api.anki.cardInfo({ cardId: card.id, decks: visible });
      if (disposed || mine !== infoSeq) return;
      s.info = { id: card.id, data, error: null };
    } catch (err) {
      if (disposed || mine !== infoSeq) return;
      s.info = { id: card.id, data: null, error: err.message };
    }
    if (!box.isConnected) return;
    fill(box, s.info.data ? infoContent(s.info.data) : h('p', { class: 'bw-banner', role: 'alert' }, `Couldn’t load card info: ${s.info.error}`));
  }

  function infoContent(data) {
    const c = data.card;
    const stats = [
      ['Interval', dayText(c.interval)],
      ['Ease', c.easePct != null ? `${c.easePct}%` : '—'],
      ['Reviews', String(c.reps)],
      ['Lapses', String(c.lapses)],
      ['Due', c.dueText],
      ['Created', dateText(data.created)],
      ['First review', data.firstReview ? new Date(data.firstReview).toLocaleString() : '—'],
      ['Last review', data.lastReview ? new Date(data.lastReview).toLocaleString() : '—'],
      ['Average time', secondsText(data.averageTimeMs)],
      ['Total time', secondsText(data.totalTimeMs)],
    ];
    const ratings = ['—', 'Again', 'Hard', 'Good', 'Easy'];
    return h(
      'div',
      {},
      h('dl', { class: 'bw-stats' }, stats.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, v)))),
      h('h3', { class: 'bw-lab' }, 'Review history'),
      data.history.length
        ? h(
            'table',
            { class: 'bw-table bw-review-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Date'), h('th', {}, 'Rating'), h('th', {}, 'Interval'), h('th', {}, 'Time'))),
            h('tbody', {}, data.history.map((r) => h('tr', {}, h('td', {}, new Date(r.ts).toLocaleString()), h('td', {}, ratings[r.ease] ?? '—'), h('td', {}, dayText(r.interval)), h('td', {}, secondsText(r.timeMs))))),
          )
        : h('p', { class: 'bw-muted' }, 'No reviews yet.'),
    );
  }

  function onKey(e) {
    if (disposed || !root.isConnected) return;
    const active = document.activeElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '');
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === '/' && !typing && !mod) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    if (typing || (active && active !== document.body && !root.contains(active))) return;
    if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      selectAllRows();
      return;
    }
    const picked = selectedCards();
    if (mod && /^[1-7]$/.test(e.key) && picked.length) {
      e.preventDefault();
      const flag = Number(e.key);
      const card = focusedCard();
      act('flag', { flag: flagTarget(card?.flag ?? 0, flag) }, 'Flag updated');
    } else if (mod && (e.key === 'k' || e.key === 'K') && picked.length) {
      e.preventDefault();
      act(markAction(picked), {}, 'Updated marks');
    } else if ((e.key === 'Delete' || (mod && e.key === 'Backspace')) && picked.length) {
      e.preventDefault();
      confirmAct('deleteNotes', { confirm: true }, `Delete ${plural(picked.length, 'note')} from Anki? This cannot be undone.`, 'Delete');
    }
  }
}
