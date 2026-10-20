import { mountWordCard } from '../lib/wordCard.mjs';
import { LruCache } from '../lib/lru.mjs';
import { tokenizeCached } from '../lib/nlp.mjs';
import { fill, h, toast } from '../lib/ui.mjs';
import {
  blockFontSize,
  createPager,
  cropRect,
  fitScale,
  fitViewport,
  hitTestBlock,
  nextVolume,
  placeBubble,
  preloadWindow,
  previousVolume,
  progressLabel,
  shouldSuppressClick,
  spaceStep,
  zoomScroll,
  zoomStep,
} from '../lib/mangaReader.mjs';

const api = window.api;
const PAGE_CACHE = 12;
const PRELOAD_RADIUS = 2;
const SAVE_DEBOUNCE_MS = 500;
const IDLE_MS = 2500;
const CROP_PAD = 0.06;
const JPEG_QUALITY = 0.85;
const ZONE = 0.3;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ARROW_SCROLL_PX = 80;
const KNOWN_ACTIONS = [
  ['known', 'Know it'],
  ['learning', 'Learning'],
  ['new', 'Reset'],
];
const BUBBLE_MODE_KEY = 'animeMine.mangaBubbleMode';
const KNOWN_LABELS = { known: 'Known', learning: 'Learning', new: 'New' };

export function openReader(container, { series, volume, startPage = 0, onClose }) {
  const root = h('div', { class: 'manga-reader' });
  const stage = h('div', { class: 'manga-stage' });
  const bar = h('div', { class: 'manga-ocr-bar', hidden: true });
  const topbar = h('header', { class: 'manga-topbar' });
  const banner = h('div', { class: 'manga-banner', hidden: true });
  const panel = h('aside', { class: 'manga-panel', hidden: true });
  const drawerHost = h('div', { class: 'manga-drawer-host' });
  const body = h('div', { class: 'manga-reader-body' }, stage, panel);
  root.append(topbar, bar, banner, body, drawerHost);
  container.append(root);

  const cleanups = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  let currentSeries = series;
  let currentVolume = volume;
  let direction = 'rtl';
  let spread = false;
  let fit = 'width';
  let zoom = 1;
  let showText = true;
  let dismissedBanner = false;
  let alive = true;
  let viewSeq = 0;
  let idleTimer = null;
  let saveTimer = null;
  let pendingSave = null;
  let selectedBlock = null;
  let anchor = startPage;
  let pager = null;

  const pageCache = new LruCache(PAGE_CACHE);
  const inflight = new Map();
  const blockCache = new Map();

  const pageKey = (volId, index) => `${volId}:${index}`;

  function loadPage(index) {
    const volId = currentVolume.id;
    const key = pageKey(volId, index);
    if (pageCache.get(key)) return Promise.resolve(pageCache.get(key));
    if (inflight.has(key)) return inflight.get(key);
    const task = api.manga
      .page({ seriesId: currentSeries.id, volId, index })
      .then(
        ({ dataUrl }) =>
          new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              const entry = { img, width: img.naturalWidth, height: img.naturalHeight };
              pageCache.set(key, entry);
              resolve(entry);
            };
            img.onerror = () => reject(new Error(`page ${index + 1} failed to decode`));
            img.src = dataUrl;
          }),
      )
      .finally(() => inflight.delete(key));
    inflight.set(key, task);
    return task;
  }

  function loadBlocks(index) {
    const volId = currentVolume.id;
    const key = pageKey(volId, index);
    if (!blockCache.has(key)) {
      blockCache.set(
        key,
        api.manga.blocks({ seriesId: currentSeries.id, volId, index }).catch((err) => {
          blockCache.delete(key);
          throw err;
        }),
      );
    }
    return blockCache.get(key);
  }

  function landscape(index) {
    const entry = pageCache.get(pageKey(currentVolume.id, index));
    return Boolean(entry && entry.width > entry.height);
  }

  function makePager(page = anchor) {
    pager = createPager({ pageCount: currentVolume.pageCount, direction, spread, landscape });
    pager.goto(page);
  }

  function visible() {
    return pager ? pager.current() : [];
  }

  function scheduleSave() {
    pendingSave = { volId: currentVolume.id, page: Math.min(...visible()), direction, spread };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!pendingSave) return;
    const payload = pendingSave;
    pendingSave = null;
    api.manga.setProgress(payload).catch((err) => toast(err.message, 'error'));
  }

  function prefetch(pages) {
    for (const index of preloadWindow(pages, currentVolume.pageCount, PRELOAD_RADIUS)) {
      loadPage(index).catch(() => {});
    }
  }

  function go(action) {
    if (!pager) return;
    const before = visible().join();
    closeBubble();
    if (action === 'next') pager.next();
    else if (action === 'prev') pager.prev();
    anchor = Math.min(...visible());
    scheduleSave();
    render({ resetScroll: visible().join() !== before });
  }

  let renderSeq = 0;
  let pendingBlocks = 0;
  const resolvedBlocks = new Map();
  const pct = (value) => (Math.min(1, Math.max(0, Number(value) || 0)) * 100).toFixed(3);

  function render({ resetScroll = false } = {}) {
    if (!alive || !pager) return;
    root.classList.toggle('has-panel', !panel.hidden);
    const seq = ++renderSeq;
    const pages = visible();
    const style = getComputedStyle(stage);
    const { perW, viewH } = fitViewport({
      width: stage.clientWidth,
      height: stage.clientHeight,
      padX: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
      padY: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
      gap: parseFloat(style.columnGap) || 0,
      count: pages.length,
    });
    fill(stage, pages.map((index) => pageNode(index, perW, viewH)));
    if (resetScroll) {
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
    }
    stage.classList.toggle('can-pan', stage.scrollWidth > stage.clientWidth || stage.scrollHeight > stage.clientHeight);
    renderTopbar();
    paintBlocks();
    reanchorBubble();
    const missing = pages.filter((index) => !pageCache.get(pageKey(currentVolume.id, index)));
    if (missing.length) {
      Promise.all(missing.map(loadPage))
        .then(() => {
          if (alive && seq === renderSeq) render();
        })
        .catch((err) => toast(err.message, 'error'));
    }
    for (const index of pages) readBlocks(index);
    prefetch(pages);
  }

  function pageNode(index, perW, viewH) {
    const wrap = h('div', { class: 'manga-page', 'data-index': index });
    const entry = pageCache.get(pageKey(currentVolume.id, index));
    if (!entry) {
      wrap.append(h('div', { class: 'manga-page-loading' }, `Page ${index + 1}…`));
      return wrap;
    }
    const scale = fitScale(fit, entry.width, entry.height, perW, viewH) * zoom;
    const width = Math.max(1, Math.round(entry.width * scale));
    const height = Math.max(1, Math.round(entry.height * scale));
    entry.img.className = 'manga-img';
    entry.img.alt = `Page ${index + 1}`;
    entry.img.style.width = `${width}px`;
    entry.img.style.height = `${height}px`;
    wrap.style.width = `${width}px`;
    wrap.style.height = `${height}px`;
    wrap.append(entry.img, h('div', { class: 'manga-overlay' }));
    return wrap;
  }

  function readBlocks(index) {
    const key = pageKey(currentVolume.id, index);
    if (resolvedBlocks.has(key)) return;
    pendingBlocks++;
    paintBar();
    loadBlocks(index)
      .then((result) => {
        if (!alive) return;
        resolvedBlocks.set(key, result);
        if (result.unavailable && !dismissedBanner) showBanner(result.unavailable);
        paintBlocks();
      })
      .catch((err) => toast(err.message, 'error'))
      .finally(() => {
        pendingBlocks--;
        if (alive) paintBar();
      });
  }

  function paintBar() {
    bar.hidden = pendingBlocks === 0;
  }

  function paintBlocks() {
    for (const wrap of stage.querySelectorAll('.manga-page')) {
      const index = Number(wrap.dataset.index);
      const result = resolvedBlocks.get(pageKey(currentVolume.id, index));
      const overlay = wrap.querySelector('.manga-overlay');
      if (!overlay || !result) continue;
      const pageW = wrap.offsetWidth;
      const pageH = wrap.offsetHeight;
      const selectedAt = selectedBlock?.pageIndex === index ? selectedBlock.blockIndex : -1;
      const signature = `${pageW}x${pageH}|${selectedAt}`;
      if (overlay._result === result && overlay._signature === signature) continue;
      overlay._result = result;
      overlay._signature = signature;
      fill(
        overlay,
        result.blocks.map((block, i) => {
          const { x, y, w, h: bh } = block.box;
          const fontSize = blockFontSize({
            boxW: pageW * w,
            boxH: pageH * bh,
            chars: [...block.text].length,
            vertical: block.vertical,
          });
          const classes = ['manga-block', block.vertical ? 'vertical' : '', selectedAt === i ? 'selected' : ''];
          return h(
            'div',
            {
              class: classes.filter(Boolean).join(' '),
              'data-block': i,
              style: `left:${pct(x)}%;top:${pct(y)}%;width:${pct(w)}%;height:${pct(bh)}%;font-size:${fontSize}px`,
            },
            block.text,
          );
        }),
      );
    }
  }

  function showBanner(reason) {
    fill(
      banner,
      h(
        'span',
        {},
        'No text found. Live OCR needs macOS 26 for vertical text; otherwise use mokuro sidecars or enable “AI OCR” in the Manga tab options.',
      ),
      h('span', { class: 'muted' }, reason),
      h('button', { class: 'ghost small', onclick: dismissBanner }, 'Dismiss'),
    );
    banner.hidden = false;
  }

  function dismissBanner() {
    dismissedBanner = true;
    banner.hidden = true;
  }

  function renderTopbar() {
    const control = (label, onclick, on = false) => h('button', { class: on ? 'small on' : 'small', onclick }, label);
    fill(
      topbar,
      h('button', { class: 'ghost small', onclick: () => openVolume(previousVolume(currentSeries, currentVolume.id)) }, 'Prev volume ['),
      h(
        'div',
        { class: 'manga-title' },
        h('strong', {}, currentSeries.title),
        ' ',
        h('span', { class: 'muted' }, currentVolume.title),
      ),
      h('span', { class: 'manga-progress' }, progressLabel(visible(), currentVolume.pageCount)),
      h('div', { class: 'manga-seg' }, control(direction === 'rtl' ? 'RTL' : 'LTR', toggleDirection)),
      h('div', { class: 'manga-seg' }, control(spread ? '2 pages' : '1 page', toggleSpread, spread)),
      h(
        'div',
        { class: 'manga-seg' },
        ...[
          ['width', 'Fit width'],
          ['height', 'Fit height'],
          ['original', 'Original'],
        ].map(([mode, label]) => control(label, () => setFit(mode), fit === mode)),
        zoom === 1 ? null : h('button', { class: 'small on', title: 'Reset zoom', onclick: resetZoom }, `${Math.round(zoom * 100)}%`),
      ),
      control('Text (T)', toggleText, showText),
      h('button', { class: 'ghost small', onclick: () => openVolume(nextVolume(currentSeries, currentVolume.id)) }, 'Next volume ]'),
      h('button', { class: 'ghost small', onclick: close }, 'Close'),
    );
  }

  function reflow(page) {
    closeBubble();
    makePager(page);
    anchor = page;
    scheduleSave();
    render({ resetScroll: true });
  }

  function toggleDirection() {
    direction = direction === 'rtl' ? 'ltr' : 'rtl';
    reflow(Math.min(...visible()));
  }

  function toggleSpread() {
    spread = !spread;
    reflow(Math.min(...visible()));
  }

  function setFit(mode) {
    fit = mode;
    zoom = 1;
    closeBubble();
    render();
  }

  function toggleText() {
    showText = !showText;
    root.classList.toggle('manga-hide-text', !showText);
    if (!showText) closeBubble();
    renderTopbar();
  }

  function pageOrigin() {
    const first = stage.querySelector('.manga-page');
    if (!first) return null;
    const box = stage.getBoundingClientRect();
    const page = first.getBoundingClientRect();
    return { x: page.left - box.left, y: page.top - box.top };
  }

  function zoomTo(next, x, y) {
    if (next === zoom) return;
    const ratio = next / zoom;
    closeBubble();
    const before = pageOrigin();
    zoom = next;
    render();
    const after = pageOrigin();
    if (!before || !after) return;
    stage.scrollLeft = zoomScroll(stage.scrollLeft, x, before.x, after.x, ratio);
    stage.scrollTop = zoomScroll(stage.scrollTop, y, before.y, after.y, ratio);
  }

  function resetZoom() {
    zoomTo(1, stage.clientWidth / 2, stage.clientHeight / 2);
  }

  let panelState = null;
  const firstGloss = (entries) => entries[0]?.senses[0]?.glosses[0] ?? '';

  async function openBlock(pageIndex, blockIndex) {
    const result = resolvedBlocks.get(pageKey(currentVolume.id, pageIndex));
    const text = result?.blocks[blockIndex]?.text;
    if (!text) return;
    selectedBlock = { pageIndex, blockIndex };
    panelState = { text, tokens: null, statuses: [], wordIndex: -1, lookup: null, status: null, translation: null, busy: null };
    panel.hidden = false;
    render();
    renderPanel();
    const tokens = await tokenizeCached(text);
    if (panelState?.text !== text) return;
    panelState.tokens = tokens;
    await refreshStatuses();
  }

  async function refreshStatuses() {
    const state = panelState;
    if (!state?.tokens) return;
    const { statuses } = await api.known.classify(state.tokens);
    if (panelState !== state) return;
    state.statuses = statuses;
    renderPanel();
  }

  function closePanel() {
    selectedBlock = null;
    panelState = null;
    panel.hidden = true;
    render();
  }

  async function lookupToken(index) {
    const state = panelState;
    if (window.getSelection()?.toString().trim()) return;
    state.wordIndex = index;
    state.lookup = null;
    renderPanel();
    const lookup = await api.lookup.at({ text: state.text, index });
    if (panelState !== state || state.wordIndex !== index) return;
    if (lookup.dictForm) {
      const { statuses } = await api.known.classify([{ surface: lookup.dictForm, base: lookup.dictForm, isWord: true }]);
      state.status = statuses[0];
    }
    state.lookup = lookup;
    renderPanel();
  }

  async function markStatus(status) {
    const state = panelState;
    try {
      await api.known.mark({ word: state.lookup.dictForm, status });
    } catch (err) {
      toast(err.message, 'error');
      return;
    }
    state.status = status;
    await refreshStatuses();
  }

  function openDetails() {
    const word = panelState.lookup.dictForm;
    drawerHost.replaceChildren();
    mountWordCard(drawerHost, {
      word,
      onClose: () => drawerHost.replaceChildren(),
      onChanged: refreshStatuses,
    });
  }

  function cropDataUrl(pageIndex, box) {
    const entry = pageCache.get(pageKey(currentVolume.id, pageIndex));
    if (!entry) throw new Error('Page image is not loaded');
    const rect = cropRect(box, entry.width, entry.height, CROP_PAD);
    if (rect.w === 0 || rect.h === 0) throw new Error('Nothing to crop');
    const canvas = document.createElement('canvas');
    canvas.width = rect.w;
    canvas.height = rect.h;
    canvas.getContext('2d').drawImage(entry.img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  async function mine({ kind, text, lookup, translation, pageIndex, blockIndex }) {
    try {
      const block = resolvedBlocks.get(pageKey(currentVolume.id, pageIndex))?.blocks[blockIndex];
      if (!block) throw new Error('Text block is no longer available');
      const word =
        kind === 'word'
          ? {
              base: lookup.dictForm,
              surface: lookup.span?.text ?? lookup.dictForm,
              reading: lookup.entries[0]?.kana?.[0] ?? '',
            }
          : null;
      await api.manga.mine({
        seriesId: currentSeries.id,
        volId: currentVolume.id,
        index: pageIndex,
        sentence: text,
        word,
        meaning: word ? firstGloss(lookup.entries) : undefined,
        translation: translation ?? undefined,
        picture: cropDataUrl(pageIndex, block.box),
      });
      toast('Added to Anki', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function minePanel(kind) {
    const state = panelState;
    state.busy = 'Adding to Anki…';
    renderPanel();
    await mine({
      kind,
      text: state.text,
      lookup: state.lookup,
      translation: state.translation,
      pageIndex: selectedBlock.pageIndex,
      blockIndex: selectedBlock.blockIndex,
    });
    state.busy = null;
    renderPanel();
  }

  async function translate() {
    const state = panelState;
    state.busy = 'Translating…';
    renderPanel();
    try {
      state.translation = await api.ai.translate({ sentence: state.text, context: [] });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      state.busy = null;
      renderPanel();
    }
  }

  function tokenNode(token, i, state, pick) {
    if (!token.isWord) return token.surface;
    const status = state.statuses[i] ?? 'new';
    const selected = state.wordIndex === i ? ' selected' : '';
    return h('button', { class: `manga-word known-${status}${selected}`, onclick: () => pick(i) }, token.surface);
  }

  function wordSection(state) {
    const { lookup } = state;
    if (!lookup) return h('p', { class: 'muted' }, 'Loading…');
    if (!lookup.dictForm) return h('p', { class: 'muted' }, 'No dictionary word here.');
    return h(
      'div',
      { class: 'manga-word-card' },
      h(
        'div',
        { class: 'manga-word-head' },
        h('strong', {}, lookup.span?.text ?? lookup.dictForm),
        h('span', { class: 'muted' }, lookup.entries[0]?.kana?.[0] ?? ''),
        h('span', { class: `chip known-${state.status}` }, KNOWN_LABELS[state.status] ?? ''),
      ),
      h(
        'div',
        { class: 'manga-known-row' },
        ...KNOWN_ACTIONS.map(([status, label]) =>
          h('button', { class: 'small', disabled: state.status === status, onclick: () => markStatus(status) }, label),
        ),
        h('button', { class: 'small', onclick: openDetails }, 'Details'),
      ),
      lookup.entries.length
        ? lookup.entries.slice(0, 3).map((entry) =>
            h(
              'ul',
              { class: 'manga-entry' },
              entry.senses.slice(0, 4).map((sense) =>
                h(
                  'li',
                  {},
                  sense.pos.length ? h('span', { class: 'pos' }, sense.pos.join(', ')) : null,
                  sense.glosses.join('; '),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'No dictionary entry.'),
    );
  }

  function renderPanel() {
    const state = panelState;
    if (!state) return;
    const tokens = state.tokens;
    fill(
      panel,
      h(
        'div',
        { class: 'manga-panel-head' },
        h('strong', {}, 'Sentence'),
        h('button', { class: 'ghost small', onclick: closePanel }, 'Close'),
      ),
      h('p', { class: 'manga-sentence' }, tokens ? tokens.map((token, i) => tokenNode(token, i, state, lookupToken)) : state.text),
      h(
        'div',
        { class: 'manga-panel-actions' },
        h('button', { class: 'small', disabled: Boolean(state.busy), onclick: translate }, 'Translate'),
        h('button', { class: 'small', disabled: Boolean(state.busy), onclick: () => minePanel('sentence') }, 'Mine sentence'),
        state.lookup?.dictForm
          ? h('button', { class: 'small', disabled: Boolean(state.busy), onclick: () => minePanel('word') }, 'Mine word')
          : null,
      ),
      state.wordIndex < 0 ? h('p', { class: 'muted' }, 'Select a word above to look it up.') : null,
      state.busy ? h('p', { class: 'muted' }, state.busy) : null,
      state.translation ? h('p', { class: 'manga-translation' }, state.translation) : null,
      state.wordIndex >= 0 ? wordSection(state) : null,
    );
  }

  let bubble = null;
  let bubbleSeq = 0;
  const compact = (text) => text.replace(/\s+/g, '');

  function readBubbleMode() {
    try {
      return localStorage.getItem(BUBBLE_MODE_KEY) === 'ai' ? 'ai' : 'dict';
    } catch {
      return 'dict';
    }
  }

  function saveBubbleMode(mode) {
    try {
      localStorage.setItem(BUBBLE_MODE_KEY, mode);
    } catch {
      // storage unavailable: the mode just isn't remembered
    }
  }

  function selectionInStage() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;
    return stage.contains(sel.anchorNode) ? sel : null;
  }

  const selectionKey = (sel) =>
    sel && sel.rangeCount && !sel.isCollapsed ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset, sel.toString()] : null;
  const sameSelection = (a, b) => Boolean(a && b && a.every((part, i) => part === b[i]));

  let gesture = null;
  let selectionClickPending = false;

  function onGestureStart(event) {
    if (event.button !== 0) return;
    selectionClickPending = false;
    const inBlock = Boolean(event.target.closest?.('.manga-block'));
    gesture = { inBlock, before: selectionKey(window.getSelection()) };
    if (!inBlock) window.getSelection()?.removeAllRanges();
  }

  function dropBubble() {
    bubble?.el.remove();
    bubble = null;
  }

  function closeBubble() {
    if (!bubble) return;
    const sel = window.getSelection();
    const inside = sel && (stage.contains(sel.anchorNode) || bubble.el.contains(sel.anchorNode));
    dropBubble();
    if (inside) sel.removeAllRanges();
  }

  function onSelectEnd() {
    const started = gesture;
    gesture = null;
    const sel = selectionInStage();
    if (!started?.inBlock || !sel || sameSelection(started.before, selectionKey(sel))) return;
    const text = compact(sel.toString());
    const node = sel.anchorNode;
    const blockEl = (node.nodeType === 1 ? node : node.parentElement)?.closest('.manga-block');
    const wrap = blockEl?.closest('.manga-page');
    if (!wrap) return;
    selectionClickPending = true;
    openBubble({
      pageIndex: Number(wrap.dataset.index),
      blockIndex: Number(blockEl.dataset.block),
      text,
      whole: false,
      rect: sel.getRangeAt(0).getBoundingClientRect(),
    });
  }

  function reanchorBubble() {
    if (!bubble) return;
    const blockEl = stage.querySelector(`.manga-page[data-index="${bubble.pageIndex}"] .manga-block[data-block="${bubble.blockIndex}"]`);
    if (!blockEl) {
      closeBubble();
      return;
    }
    const { left, top, right, bottom } = blockEl.getBoundingClientRect();
    bubble.anchor = { left, top, right, bottom };
    positionBubble(bubble);
  }

  function openBubble({ pageIndex, blockIndex, text, whole, rect }) {
    const blockText = resolvedBlocks.get(pageKey(currentVolume.id, pageIndex))?.blocks[blockIndex]?.text;
    if (!blockText) return;
    dropBubble();
    const selection = whole ? blockText : text;
    const state = {
      id: ++bubbleSeq,
      pageIndex,
      blockIndex,
      blockText,
      text: selection,
      whole,
      covers: whole || selection === compact(blockText),
      mode: readBubbleMode(),
      anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      dict: { started: false, tokens: null, statuses: [], wordIndex: -1, lookup: null, status: null, error: null },
      ai: { status: 'idle', text: '', error: '' },
      busy: false,
      el: h('div', { class: 'manga-bubble', role: 'dialog', 'aria-label': 'Selection' }),
    };
    bubble = state;
    root.append(state.el);
    renderBubble(state);
    loadBubbleMode(state);
  }

  function positionBubble(state) {
    const el = state.el;
    el.style.left = '0px';
    el.style.top = '0px';
    const { left, top, side } = placeBubble(
      state.anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      root.getBoundingClientRect(),
    );
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.dataset.side = side;
  }

  function setBubbleMode(state, mode) {
    if (bubble !== state || state.mode === mode) return;
    state.mode = mode;
    saveBubbleMode(mode);
    renderBubble(state);
    loadBubbleMode(state);
  }

  function loadBubbleMode(state) {
    if (state.mode === 'ai') loadAi(state);
    else loadDict(state);
  }

  async function loadDict(state) {
    const dict = state.dict;
    if (dict.started) return;
    dict.started = true;
    try {
      if (state.whole) {
        const tokens = await tokenizeCached(state.blockText);
        if (bubble !== state) return;
        dict.tokens = tokens;
        renderBubble(state);
        const { statuses } = await api.known.classify(tokens);
        if (bubble !== state) return;
        dict.statuses = statuses;
      } else {
        await bubbleLookup(state, state.text, 0);
        return;
      }
    } catch (err) {
      if (bubble !== state) return;
      dict.error = err.message;
    }
    renderBubble(state);
  }

  async function bubbleLookup(state, text, index) {
    const dict = state.dict;
    dict.wordIndex = index;
    dict.lookup = null;
    dict.status = null;
    dict.error = null;
    renderBubble(state);
    try {
      const lookup = await api.lookup.at({ text, index });
      if (bubble !== state || dict.wordIndex !== index) return;
      if (lookup.dictForm) {
        const { statuses } = await api.known.classify([{ surface: lookup.dictForm, base: lookup.dictForm, isWord: true }]);
        if (bubble !== state || dict.wordIndex !== index) return;
        dict.status = statuses[0];
      }
      dict.lookup = lookup;
    } catch (err) {
      if (bubble !== state || dict.wordIndex !== index) return;
      dict.error = err.message;
    }
    renderBubble(state);
  }

  async function loadAi(state) {
    const ai = state.ai;
    if (ai.status === 'loading' || ai.status === 'done') return;
    ai.status = 'loading';
    renderBubble(state);
    try {
      const result = await api.ai.translate({ sentence: state.text, context: state.covers ? [] : [state.blockText] });
      if (bubble !== state) return;
      ai.text = result;
      ai.status = 'done';
    } catch (err) {
      if (bubble !== state) return;
      ai.error = err.message;
      ai.status = 'error';
    }
    renderBubble(state);
  }

  async function mineBubble(state, kind) {
    state.busy = true;
    renderBubble(state);
    await mine({
      kind,
      text: state.blockText,
      lookup: state.dict.lookup,
      translation: state.covers && state.ai.status === 'done' ? state.ai.text : null,
      pageIndex: state.pageIndex,
      blockIndex: state.blockIndex,
    });
    if (bubble !== state) return;
    state.busy = false;
    renderBubble(state);
  }

  function bubbleMore(state) {
    const { pageIndex, blockIndex } = state;
    closeBubble();
    openBlock(pageIndex, blockIndex);
  }

  function bubbleLookupCard(state) {
    const { dict } = state;
    if (dict.error) return h('p', { class: 'manga-bubble-error' }, dict.error);
    const { lookup } = dict;
    if (!lookup) return h('p', { class: 'muted' }, 'Loading…');
    if (!lookup.dictForm) return h('p', { class: 'muted' }, 'No dictionary word here.');
    return h(
      'div',
      { class: 'manga-bubble-card' },
      h(
        'div',
        { class: 'manga-word-head' },
        h('strong', {}, lookup.span?.text ?? lookup.dictForm),
        h('span', { class: 'muted' }, lookup.entries[0]?.kana?.[0] ?? ''),
        h('span', { class: `chip known-${dict.status}` }, KNOWN_LABELS[dict.status] ?? ''),
      ),
      lookup.entries.length
        ? lookup.entries.slice(0, 2).map((entry) =>
            h(
              'ul',
              { class: 'manga-entry' },
              entry.senses.slice(0, 3).map((sense) =>
                h(
                  'li',
                  {},
                  sense.pos.length ? h('span', { class: 'pos' }, sense.pos.join(', ')) : null,
                  sense.glosses.join('; '),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'No dictionary entry.'),
    );
  }

  function bubbleBody(state) {
    if (state.mode === 'ai') {
      const { ai } = state;
      if (ai.status === 'error') return h('p', { class: 'manga-bubble-error' }, ai.error);
      if (ai.status === 'done') return h('p', { class: 'manga-translation' }, ai.text);
      return h('p', { class: 'muted' }, 'Translating…');
    }
    if (!state.whole) return bubbleLookupCard(state);
    const { dict } = state;
    return [
      dict.tokens
        ? h(
            'p',
            { class: 'manga-bubble-sentence' },
            dict.tokens.map((token, i) => tokenNode(token, i, dict, (index) => bubbleLookup(state, state.blockText, index))),
          )
        : h('p', { class: 'muted' }, 'Loading…'),
      dict.wordIndex >= 0 ? bubbleLookupCard(state) : dict.error ? h('p', { class: 'manga-bubble-error' }, dict.error) : null,
    ];
  }

  function renderBubble(state) {
    if (bubble !== state) return;
    const modeButton = (mode, label) =>
      h('button', { class: state.mode === mode ? 'on' : '', 'aria-pressed': state.mode === mode, onclick: () => setBubbleMode(state, mode) }, label);
    const canMineWord = state.mode === 'dict' && Boolean(state.dict.lookup?.dictForm);
    fill(
      state.el,
      h(
        'div',
        { class: 'manga-bubble-head' },
        h('strong', { title: state.text }, state.text),
        h('button', { class: 'ghost small', 'aria-label': 'Close', onclick: () => closeBubble() }, '×'),
      ),
      h('div', { class: 'manga-bubble-modes' }, modeButton('dict', 'Dictionary'), modeButton('ai', 'AI translate')),
      h('div', { class: 'manga-bubble-body' }, bubbleBody(state)),
      h(
        'div',
        { class: 'manga-bubble-actions' },
        canMineWord ? h('button', { class: 'small', disabled: state.busy, onclick: () => mineBubble(state, 'word') }, 'Mine word') : null,
        h('button', { class: 'small', disabled: state.busy, onclick: () => mineBubble(state, 'sentence') }, 'Mine sentence'),
        h('button', { class: 'small', onclick: () => bubbleMore(state) }, 'More…'),
      ),
    );
    positionBubble(state);
  }

  function openVolume(volume) {
    if (!volume) return;
    flushSave();
    closeBubble();
    closePanel();
    currentVolume = volume;
    api.manga
      .getProgress(volume.id)
      .catch(() => ({}))
      .then((saved) => {
        if (!alive || currentVolume !== volume) return;
        anchor = saved.page ?? 0;
        makePager(anchor);
        render({ resetScroll: true });
      });
  }

  function close() {
    if (!alive) return;
    alive = false;
    dropBubble();
    flushSave();
    clearTimeout(idleTimer);
    for (const cleanup of cleanups.splice(0)) cleanup();
    root.remove();
    onClose?.();
  }

  function wake() {
    root.classList.remove('manga-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add('manga-idle'), IDLE_MS);
  }

  function onKey(event) {
    if (!alive || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? '')) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      if (bubble) closeBubble();
      else if (drawerHost.childElementCount) drawerHost.replaceChildren();
      else if (selectedBlock) closePanel();
      else close();
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      event.preventDefault();
      const leftIsNext = direction === 'rtl';
      go((key === 'ArrowLeft') === leftIsNext ? 'next' : 'prev');
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      event.preventDefault();
      stage.scrollTop += key === 'ArrowUp' ? -ARROW_SCROLL_PX : ARROW_SCROLL_PX;
    } else if (key === ' ') {
      event.preventDefault();
      const step = spaceStep({
        scrollTop: stage.scrollTop,
        viewHeight: stage.clientHeight,
        contentHeight: stage.scrollHeight,
        backward: event.shiftKey,
      });
      if (step.turn) go(step.turn);
      else stage.scrollTop += step.scrollBy;
    } else if (key.toLowerCase() === 't') {
      toggleText();
    } else if (key === '[') {
      openVolume(previousVolume(currentSeries, currentVolume.id));
    } else if (key === ']') {
      openVolume(nextVolume(currentSeries, currentVolume.id));
    }
  }

  function onStageClick(event) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (selectionClickPending) {
      selectionClickPending = false;
      return;
    }
    if (!pager) return;
    const wrap = event.target.closest?.('.manga-page');
    if (wrap) {
      const rect = wrap.getBoundingClientRect();
      const index = Number(wrap.dataset.index);
      const result = resolvedBlocks.get(pageKey(currentVolume.id, index));
      const hit = result
        ? hitTestBlock(result.blocks, (event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height)
        : -1;
      if (hit >= 0) {
        const blockEl = wrap.querySelector(`.manga-block[data-block="${hit}"]`);
        const box = blockEl?.getBoundingClientRect() ?? { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY };
        openBubble({ pageIndex: index, blockIndex: hit, whole: true, rect: box });
        return;
      }
    }
    if (bubble) {
      closeBubble();
      return;
    }
    const rect = stage.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    if (fx < ZONE) go(direction === 'rtl' ? 'next' : 'prev');
    else if (fx > 1 - ZONE) go(direction === 'rtl' ? 'prev' : 'next');
  }

  let wheelDelta = 0;
  let wheelPoint = null;
  let wheelFrame = 0;

  function applyWheel() {
    wheelFrame = 0;
    const delta = wheelDelta;
    wheelDelta = 0;
    zoomTo(zoomStep(zoom, delta, ZOOM_MIN, ZOOM_MAX), wheelPoint.x, wheelPoint.y);
  }

  function onWheel(event) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    const box = stage.getBoundingClientRect();
    wheelPoint = { x: event.clientX - box.left, y: event.clientY - box.top };
    wheelDelta += event.deltaY;
    if (!wheelFrame) wheelFrame = requestAnimationFrame(applyWheel);
  }

  let pan = null;
  let suppressClick = false;

  function onPanStart(event) {
    if (event.button !== 0) return;
    suppressClick = false;
    if (event.target.closest?.('.manga-block')) return;
    pan = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
  }

  function onPanMove(event) {
    if (!pan || !stage.classList.contains('can-pan')) return;
    stage.classList.add('panning');
    if (shouldSuppressClick(event.clientX - pan.x, event.clientY - pan.y)) pan.moved = true;
    stage.scrollLeft = pan.left - (event.clientX - pan.x);
    stage.scrollTop = pan.top - (event.clientY - pan.y);
  }

  function onPanEnd(event) {
    if (!pan) return;
    suppressClick = pan.moved === true || shouldSuppressClick(event.clientX - pan.x, event.clientY - pan.y);
    pan = null;
    stage.classList.remove('panning');
  }

  listen(window, 'keydown', onKey);
  listen(window, 'resize', () => {
    closeBubble();
    render();
  });
  listen(root, 'pointermove', wake);
  listen(stage, 'pointerdown', onGestureStart);
  listen(stage, 'pointerdown', onPanStart);
  listen(window, 'pointermove', onPanMove);
  listen(window, 'pointerup', onPanEnd);
  listen(window, 'pointercancel', onPanEnd);
  listen(stage, 'click', onStageClick);
  listen(stage, 'mouseup', onSelectEnd);
  listen(stage, 'scroll', () => closeBubble());
  listen(stage, 'wheel', onWheel, { passive: false });
  cleanups.push(() => clearTimeout(saveTimer));
  cleanups.push(() => cancelAnimationFrame(wheelFrame));

  wake();
  fill(stage, h('div', { class: 'manga-page-loading' }, 'Opening…'));
  api.manga
    .getProgress(currentVolume.id)
    .catch(() => ({}))
    .then((saved) => {
      if (!alive) return;
      direction = saved.direction ?? direction;
      spread = saved.spread ?? spread;
      makePager(startPage);
      render({ resetScroll: true });
    });

  return { close };
}
