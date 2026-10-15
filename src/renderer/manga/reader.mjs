import { mountWordCard } from '../lib/wordCard.mjs';
import { LruCache } from '../lib/lru.mjs';
import { tokenizeCached } from '../lib/nlp.mjs';
import { fill, h, toast } from '../lib/ui.mjs';
import {
  createPager,
  cropRect,
  fitScale,
  fitViewport,
  hitTestBlock,
  nextVolume,
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
      fill(
        overlay,
        result.blocks.map((block, i) => {
          const selected = selectedBlock?.pageIndex === index && selectedBlock.blockIndex === i;
          const { x, y, w, h: bh } = block.box;
          return h('div', {
            class: selected ? 'manga-block selected' : 'manga-block',
            style: `left:${pct(x)}%;top:${pct(y)}%;width:${pct(w)}%;height:${pct(bh)}%`,
          });
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
    render();
  }

  function toggleText() {
    showText = !showText;
    root.classList.toggle('manga-hide-text', !showText);
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

  function currentBlock() {
    return resolvedBlocks.get(pageKey(currentVolume.id, selectedBlock.pageIndex))?.blocks[selectedBlock.blockIndex];
  }

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

  function cropDataUrl(box) {
    const entry = pageCache.get(pageKey(currentVolume.id, selectedBlock.pageIndex));
    if (!entry) throw new Error('Page image is not loaded');
    const rect = cropRect(box, entry.width, entry.height, CROP_PAD);
    if (rect.w === 0 || rect.h === 0) throw new Error('Nothing to crop');
    const canvas = document.createElement('canvas');
    canvas.width = rect.w;
    canvas.height = rect.h;
    canvas.getContext('2d').drawImage(entry.img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  }

  async function mine(kind) {
    const state = panelState;
    const block = currentBlock();
    const lookup = state.lookup;
    const word =
      kind === 'word'
        ? {
            base: lookup.dictForm,
            surface: lookup.span?.text ?? lookup.dictForm,
            reading: lookup.entries[0]?.kana?.[0] ?? '',
          }
        : null;
    state.busy = 'Adding to Anki…';
    renderPanel();
    try {
      await api.manga.mine({
        seriesId: currentSeries.id,
        volId: currentVolume.id,
        index: selectedBlock.pageIndex,
        sentence: state.text,
        word,
        meaning: word ? firstGloss(lookup.entries) : undefined,
        translation: state.translation ?? undefined,
        picture: cropDataUrl(block.box),
      });
      toast('Added to Anki', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      state.busy = null;
      renderPanel();
    }
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

  function tokenNode(token, i, state) {
    if (!token.isWord) return token.surface;
    const status = state.statuses[i] ?? 'new';
    const selected = state.wordIndex === i ? ' selected' : '';
    return h('button', { class: `manga-word known-${status}${selected}`, onclick: () => lookupToken(i) }, token.surface);
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
      h('p', { class: 'manga-sentence' }, tokens ? tokens.map((token, i) => tokenNode(token, i, state)) : state.text),
      h(
        'div',
        { class: 'manga-panel-actions' },
        h('button', { class: 'small', disabled: Boolean(state.busy), onclick: translate }, 'Translate'),
        h('button', { class: 'small', disabled: Boolean(state.busy), onclick: () => mine('sentence') }, 'Mine sentence'),
        state.lookup?.dictForm
          ? h('button', { class: 'small', disabled: Boolean(state.busy), onclick: () => mine('word') }, 'Mine word')
          : null,
      ),
      state.wordIndex < 0 ? h('p', { class: 'muted' }, 'Select a word above to look it up.') : null,
      state.busy ? h('p', { class: 'muted' }, state.busy) : null,
      state.translation ? h('p', { class: 'manga-translation' }, state.translation) : null,
      state.wordIndex >= 0 ? wordSection(state) : null,
    );
  }

  function openVolume(volume) {
    if (!volume) return;
    flushSave();
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
      if (drawerHost.childElementCount) drawerHost.replaceChildren();
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
        openBlock(index, hit);
        return;
      }
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
  listen(window, 'resize', () => render());
  listen(root, 'pointermove', wake);
  listen(stage, 'pointerdown', onPanStart);
  listen(window, 'pointermove', onPanMove);
  listen(window, 'pointerup', onPanEnd);
  listen(window, 'pointercancel', onPanEnd);
  listen(stage, 'click', onStageClick);
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
