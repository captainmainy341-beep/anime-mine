// Manga Ink Explore screen (slice S2): shared by Explore Kanji / Vocab / Grammar.
// Contract: docs/manga-ink-contracts.md ("Explore"). Signature is frozen:
//   mountExplore(el, props) -> { update(patch), destroy() }
import { h } from '../lib/ui.mjs';
import { doodle } from '../lib/doodleIcons.mjs';
import { inkHeader, inkPercent, setInkHeader } from '../lib/inkHeader.mjs';
import { EXPLORE_FILTERS, UP_NEXT_LIMIT, seeAllLabel, upNext } from './exploreModel.mjs';

// Empty state: a short heading in the lesson-number face, the caller's emptyText as normal copy,
// and an optional paper action. "All caught up" must not be set in the 64px lesson size.
const CAUGHT_UP_TITLE = 'All caught up';
const EMPTY_LESSON_TEXT = 'Every lesson in this set is done.';
const EMPTY_ROWS_TEXT = 'Nothing here yet.';

function progressNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normaliseEmptyAction(action) {
  if (!action) return null;
  const label = String(action.label ?? '').trim();
  if (!label) return null;
  return { label, onClick: typeof action.onClick === 'function' ? action.onClick : () => {} };
}

export function mountExplore(el, props = {}) {
  let state = {
    title: props.title ?? '',
    header: { label: '', value: 0, max: 0, ...(props.header ?? {}) },
    lesson: props.lesson ?? null,
    progress: { label: '', value: 0, max: 0, ...(props.progress ?? {}) },
    rows: Array.isArray(props.rows) ? props.rows : [],
    filter: props.filter ?? 'all',
    onFilter: typeof props.onFilter === 'function' ? props.onFilter : () => {},
    seeAll: props.seeAll ?? null,
    emptyText: props.emptyText ?? EMPTY_LESSON_TEXT,
    emptyAction: normaliseEmptyAction(props.emptyAction),
  };

  const header = inkHeader({
    title: state.title,
    label: state.header.label,
    value: state.header.value,
    max: state.header.max,
  });

  const lessonCard = h('div', { class: 'ink-lesson-card ink-card' });
  const lessonPanel = h('div', { class: 'ink-explore-lesson ink-panel ink-hatch' }, lessonCard);

  const filters = h('div', { class: 'ink-explore-filters', role: 'group', 'aria-label': 'Filter up next' });
  const filterButtons = new Map();
  for (const [key, label] of EXPLORE_FILTERS) {
    const button = h('button', {
      class: 'ink-toggle',
      type: 'button',
      'data-filter': key,
      'aria-pressed': key === state.filter ? 'true' : 'false',
      onclick: () => selectFilter(key),
    }, label);
    filterButtons.set(key, button);
    filters.append(button);
  }

  const list = h('div', { class: 'ink-upnext-list' });
  const seeAllLink = h('span', { class: 'ink-link' });
  const seeAllArrow = doodle('arrow');
  seeAllArrow.classList.add('ink-seeall-arrow');
  const seeAllButton = h('button', {
    class: 'ink-seeall',
    type: 'button',
    onclick: () => state.seeAll?.onOpen?.(),
  }, seeAllLink, seeAllArrow);

  const upnextCard = h('div', { class: 'ink-upnext-card ink-card' },
    filters,
    h('span', { class: 'ink-tag ink-tag-caps' }, 'UP NEXT'),
    list,
    seeAllButton,
  );
  const upnextPanel = h('div', { class: 'ink-explore-upnext ink-panel ink-hatch' }, upnextCard);

  const root = h('section', { class: 'ink-screen ink-explore' },
    header,
    h('div', { class: 'ink-explore-grid' }, lessonPanel, upnextPanel),
  );
  el.append(root);

  renderLesson();
  renderList();
  renderSeeAll();

  let destroyed = false;

  return { update, destroy };

  function update(patch = {}) {
    if (destroyed || !patch) return;
    const previous = state;
    const next = { ...state, ...patch };
    if (patch.header !== undefined) next.header = { ...previous.header, ...(patch.header ?? {}) };
    if (patch.progress !== undefined) next.progress = { ...previous.progress, ...(patch.progress ?? {}) };
    if (patch.seeAll !== undefined) next.seeAll = patch.seeAll ? { ...(previous.seeAll ?? {}), ...patch.seeAll } : null;
    if (patch.rows !== undefined && !Array.isArray(patch.rows)) next.rows = [];
    state = next;

    if (patch.title !== undefined || patch.header !== undefined) {
      setInkHeader(header, {
        title: state.title,
        label: state.header.label,
        value: state.header.value,
        max: state.header.max,
      });
    }
    if (patch.lesson !== undefined || patch.progress !== undefined
      || patch.emptyText !== undefined || patch.emptyAction !== undefined) {
      renderLesson();
    }
    if (patch.rows !== undefined || patch.filter !== undefined) {
      paintFilters();
      renderList();
    }
    if (patch.seeAll !== undefined) renderSeeAll();
  }

  function destroy() {
    destroyed = true;
    root.remove();
  }

  function selectFilter(filter) {
    if (destroyed) return;
    state.filter = filter;
    paintFilters();
    renderList();
    state.onFilter(filter);
  }

  function paintFilters() {
    for (const [key, button] of filterButtons) {
      button.setAttribute('aria-pressed', key === state.filter ? 'true' : 'false');
    }
  }

  function renderLesson() {
    const lesson = state.lesson;
    const children = [];
    const tags = h('div', { class: 'ink-lesson-tags' },
      h('span', { class: 'ink-tag ink-tag-caps' }, 'YOUR NEXT LESSON'),
      lesson?.isNew ? h('span', { class: 'ink-stamp' }, 'NEW!') : null,
    );
    children.push(tags);

    if (!lesson) {
      lessonCard.classList.add('is-empty');
      const copy = String(state.emptyText ?? '').trim();
      children.push(h('h2', { class: 'ink-lesson-number' }, CAUGHT_UP_TITLE));
      children.push(h('span', { class: 'ink-underline' }));
      if (copy) children.push(h('p', { class: 'ink-lesson-empty-text' }, copy));
      children.push(progressEl());
      if (state.emptyAction) children.push(emptyActionButton(state.emptyAction));
      lessonCard.replaceChildren(...children);
      return;
    }

    lessonCard.classList.remove('is-empty');
    const heading = lesson.number != null && lesson.number !== ''
      ? `Lesson ${lesson.number}`
      : String(lesson.title ?? '');
    const previews = Array.isArray(lesson.preview) ? lesson.preview.map((value) => String(value ?? '')) : [];
    const isKanji = lesson.previewKind === 'kanji';
    const longest = previews.reduce((max, value) => Math.max(max, value.length), 0);
    const previewClass = [
      'ink-lesson-preview',
      isKanji ? 'is-kanji' : 'is-text',
      !isKanji && longest > 4 ? 'is-long' : '',
    ].filter(Boolean).join(' ');

    children.push(h('h2', { class: 'ink-lesson-number' }, heading));
    children.push(h('span', { class: 'ink-underline' }));
    children.push(h('p', { class: 'ink-lesson-meta' }, String(lesson.meta ?? '')));
    children.push(h('div', { class: previewClass }, ...previews.map((value) => h(
      'span',
      { class: `ink-preview-tile ${isKanji ? 'is-kanji' : 'is-text'}` },
      h('span', { class: 'ink-preview-glyph' }, value),
    ))));
    children.push(progressEl());
    children.push(startButton(lesson));
    lessonCard.replaceChildren(...children);
  }

  function progressEl() {
    const value = progressNumber(state.progress?.value);
    const max = progressNumber(state.progress?.max);
    const label = String(state.progress?.label ?? '');
    const fill = h('i', { class: 'ink-track-fill' });
    fill.style.width = `${inkPercent(value, max)}%`;
    const track = h('span', {
      class: 'ink-track',
      role: 'progressbar',
      'aria-label': label,
      'aria-valuemin': '0',
      'aria-valuenow': String(value),
      'aria-valuemax': String(max),
    }, fill);
    return h('div', { class: 'ink-lesson-progress' },
      h('div', { class: 'ink-lesson-progress-row' },
        h('span', { class: 'ink-lesson-progress-label' }, label),
        h('span', { class: 'ink-lesson-progress-count' }, `${value} / ${max}`),
      ),
      track,
    );
  }

  function startButton(lesson) {
    return h('button', {
      class: 'ink-bigbtn ink-explore-start',
      type: 'button',
      onclick: () => lesson.start?.(),
    },
    h('span', { class: 'ink-bigbtn-label' }, 'START LESSON'),
    doodle('arrow'),
    );
  }

  // Paper outlined action for the empty state; deliberately not .ink-bigbtn and not a second Start.
  function emptyActionButton(action) {
    return h('button', {
      class: 'ink-empty-action',
      type: 'button',
      onclick: () => action.onClick?.(),
    }, action.label);
  }

  function renderList() {
    const visible = upNext(state.rows, state.filter);
    upnextCard.classList.toggle('is-sparse', visible.length < UP_NEXT_LIMIT);
    if (!visible.length) {
      list.replaceChildren(h('p', { class: 'ink-upnext-empty' }, EMPTY_ROWS_TEXT));
      return;
    }
    list.replaceChildren(...visible.map(rowEl));
  }

  function rowEl(row) {
    const isNumber = row?.tileKind === 'number';
    const chevron = doodle('right');
    chevron.classList.add('ink-row-chevron');
    return h('button', {
      class: 'ink-row',
      type: 'button',
      'data-row': String(row?.id ?? ''),
      onclick: () => row?.open?.(),
    },
    h('span', { class: `ink-row-tile ${isNumber ? 'is-number' : 'is-kanji'}` },
      h('span', { class: 'ink-row-glyph' }, String(row?.tile ?? '')),
    ),
    h('span', { class: 'ink-row-body' },
      h('span', { class: 'ink-row-title' }, String(row?.title ?? '')),
      h('span', { class: 'ink-row-sub' }, String(row?.sub ?? '')),
    ),
    chevron,
    );
  }

  function renderSeeAll() {
    const seeAll = state.seeAll;
    seeAllButton.hidden = !seeAll;
    if (!seeAll) return;
    seeAllLink.textContent = seeAllLabel(seeAll.total, seeAll.noun);
  }
}
