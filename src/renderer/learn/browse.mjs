import { attempt, fill, h, toast } from '../lib/ui.mjs';
import { doodle } from '../lib/doodleIcons.mjs';
import { mountExplore } from './exploreView.mjs';
import {
  DEFAULT_TYPE,
  TYPE_FILTERS,
  addWordPayload,
  batchSize,
  exploreLevel,
  exploreType,
  kanjiExplore,
  kanjiLesson,
  kanjiRowCandidates,
  levelProgress,
  seeAllRoute,
  tileModel,
  vocabExplore,
  vocabLessonBatch,
} from './browseModel.mjs';

const SEARCH_DELAY_MS = 200;

// Kanji and Vocab tabs: the Explore screen by default, the full browse (type chips, level grid, tiles, search,
// mined words) for "See all" / arg.all === true. Both share the same frozen mountLevels entry point.
export function mountLevels(el, ctx, arg = {}) {
  const type = exploreType(arg.type);
  if (arg.all === true) return mountBrowseAll(el, ctx, { ...arg, type });
  return mountExploreLevels(el, ctx, { ...arg, type });
}

function loadCards(api, ids) {
  const cards = {};
  return Promise.all(
    (ids ?? []).map(async (id) => {
      try {
        cards[id] = await api.card(id);
      } catch {
        cards[id] = null;
      }
    }),
  ).then(() => cards);
}

function mountExploreLevels(el, ctx, arg) {
  const api = ctx.api.learn;
  const type = exploreType(arg.type);
  const host = h('div', { class: 'learn-explore-host' }, h('p', { class: 'learn-browse-loading' }, 'Loading…'));
  el.append(host);

  let disposed = false;
  let seq = 0;
  let view = null;
  let model = null;
  let filter = 'all';
  let batch = batchSize(arg.batch);

  load();

  return () => {
    disposed = true;
    seq += 1;
    view?.destroy?.();
    view = null;
    host.remove();
  };

  async function load() {
    const current = ++seq;
    try {
      const [levels, settings] = await Promise.all([
        api.levels(),
        Promise.resolve()
          .then(() => api.settingsGet?.())
          .catch(() => null),
      ]);
      if (disposed || current !== seq) return;
      batch = batchSize(arg.batch ?? settings?.lessonBatch);
      const level = exploreLevel(levels ?? [], type);
      const rows = level ? await api.browse({ type, level: level.level }) : [];
      if (disposed || current !== seq) return;
      if (type === 'kanji') {
        const lesson = kanjiLesson({ levels, rows, batch });
        const cards = await loadCards(api, kanjiRowCandidates(rows, lesson?.ids ?? []));
        if (disposed || current !== seq) return;
        model = kanjiExplore({ levels, rows, cards, batch });
      } else {
        model = vocabExplore({ levels, rows, batch });
      }
      render();
    } catch (err) {
      if (disposed || current !== seq) return;
      view?.destroy?.();
      view = null;
      fill(host, h('p', { class: 'learn-browse-error', role: 'alert' }, err.message));
    }
  }

  function render() {
    view?.destroy?.();
    view = null;
    fill(host);
    try {
      view = mountExplore(host, props());
    } catch (err) {
      fill(host, h('p', { class: 'learn-browse-error', role: 'alert' }, err.message));
    }
  }

  function props() {
    const lesson = model.lesson
      ? {
          ...model.lesson,
          start: () => startLesson(model.lesson.ids),
        }
      : null;
    const rows = (model.rows ?? []).map((row) => ({ ...row, open: () => openRow(row) }));
    return {
      title: model.title,
      header: model.header,
      lesson,
      progress: model.progress,
      rows,
      filter,
      onFilter: setFilter,
      seeAll: { ...model.seeAll, onOpen: openSeeAll },
      emptyText: model.emptyText,
    };
  }

  function setFilter(next) {
    if (next === filter) return;
    filter = next;
    const patch = props();
    view?.update?.(patch);
  }

  function startLesson(ids) {
    if (!ids?.length) {
      toast('Nothing new to learn right now.', 'info');
      return;
    }
    ctx.go('session', { mode: 'lesson', scope: type, ids });
  }

  function openRow(row) {
    if (type === 'kanji') {
      ctx.go('item', row.id);
      return;
    }
    attempt(async () => {
      const levelRows = await api.browse({ type: 'vocab', level: row.level });
      const items = vocabLessonBatch(levelRows, row.batch, batch);
      if (!items.length) {
        toast('Pass the kanji in that level to unlock its words.', 'info');
        return;
      }
      startLesson(items.map((item) => item.id));
    });
  }

  function openSeeAll() {
    const target = seeAllRoute(type);
    ctx.go(target.view, target.arg);
  }
}

function mountBrowseAll(el, ctx, arg) {
  const api = ctx.api.learn;
  const state = {
    type: arg.type ?? DEFAULT_TYPE,
    level: arg.level ?? null,
    query: '',
  };
  let disposed = false;
  let seq = 0;
  let searchTimer = null;

  const chips = h('div', { class: 'learn-browse-types', role: 'group', 'aria-label': 'Item type' });
  const search = h('input', {
    type: 'search',
    class: 'learn-browse-search',
    placeholder: 'Search by character, word, reading or meaning',
    'aria-label': 'Search',
    oninput: (event) => {
      clearTimeout(searchTimer);
      const value = event.target.value.trim();
      searchTimer = setTimeout(() => {
        state.query = value;
        refresh();
      }, SEARCH_DELAY_MS);
    },
  });
  const content = h('div', { class: 'learn-browse-content' });
  const back = h(
    'button',
    {
      type: 'button',
      class: 'learn-browse-explore',
      onclick: () => {
        if (ctx.canBack?.()) ctx.back();
        else if (state.type === 'vocab') ctx.go('vocab');
        else ctx.go('levels', { type: state.type });
      },
    },
    doodle('back'),
    h('span', {}, 'Back to Explore'),
  );

  el.append(
    h(
      'section',
      { class: 'learn-browse learn-browse-all' },
      back,
      h('div', { class: 'learn-browse-top' }, chips, search),
      content,
    ),
  );
  renderChips();
  refresh();

  return () => {
    disposed = true;
    clearTimeout(searchTimer);
  };

  function renderChips() {
    fill(
      chips,
      TYPE_FILTERS.map(([key, label]) =>
        h(
          'button',
          {
            type: 'button',
            class: 'learn-browse-type',
            'aria-pressed': String(state.type === key),
            onclick: () => {
              state.type = key;
              state.level = null;
              renderChips();
              refresh();
            },
          },
          label,
        ),
      ),
    );
  }

  function refresh() {
    const current = ++seq;
    const run = async () => {
      if (state.type === 'custom') return renderMined(current);
      if (state.query) {
        const rows = await api.browse({ type: state.type, query: state.query });
        if (disposed || current !== seq) return;
        return renderTiles(rows, 'Search results');
      }
      if (state.level == null) return renderLevelGrid(current);
      const rows = await api.browse({ type: state.type, level: state.level });
      if (disposed || current !== seq) return;
      renderTiles(rows, `Level ${state.level}`, () => {
        state.level = null;
        refresh();
      });
    };
    run().catch((err) => {
      if (disposed || current !== seq) return;
      fill(content, h('p', { class: 'learn-browse-error' }, err.message));
    });
  }

  async function renderLevelGrid(current) {
    const levels = await api.levels();
    if (disposed || current !== seq) return;
    const cards = levels.map((row) => {
      const p = levelProgress(row);
      const fillBar = h('div', { class: 'learn-level-fill' });
      fillBar.style.width = `${p.percent}%`;
      const cls = ['learn-level'];
      if (p.current) cls.push('learn-level-current');
      if (p.locked) cls.push('learn-level-locked');
      return h(
        'button',
        {
          type: 'button',
          class: cls.join(' '),
          onclick: () => {
            state.level = p.level;
            refresh();
          },
        },
        h('span', { class: 'learn-level-name' }, `Level ${p.level}`),
        h('span', { class: 'learn-level-count' }, `${p.passed} / ${p.total} kanji passed`),
        h('span', { class: 'learn-level-bar' }, fillBar),
      );
    });
    fill(content, h('div', { class: 'learn-level-grid' }, cards));
  }

  function renderTiles(rows, title, onBack) {
    const tiles = rows.map((item) => {
      const model = tileModel(item);
      return h(
        'button',
        {
          type: 'button',
          class: model.className,
          title: model.sub || undefined,
          'aria-label': model.locked ? `${model.label}, locked` : model.label,
          onclick: () => ctx.go('item', model.id),
        },
        h('span', { class: 'learn-tile-label' }, model.label),
        h('span', { class: 'learn-tile-sub' }, model.sub),
        model.locked ? h('span', { class: 'learn-tile-lock' }, 'Locked') : null,
      );
    });
    fill(
      content,
      h(
        'div',
        { class: 'learn-browse-head' },
        onBack ? h('button', { type: 'button', class: 'learn-browse-back', onclick: onBack }, 'All levels') : null,
        h('h2', {}, title),
        h('span', { class: 'learn-browse-count' }, `${rows.length} items`),
      ),
      rows.length
        ? h('div', { class: 'learn-tile-grid' }, tiles)
        : h('p', { class: 'learn-browse-empty' }, 'Nothing here yet.'),
    );
  }

  async function renderMined(current) {
    const rows = await api.browse({ type: 'custom', query: state.query || undefined });
    if (disposed || current !== seq) return;
    const list = h(
      'ul',
      { class: 'learn-mined-list' },
      rows.map((item) =>
        h(
          'li',
          { class: 'learn-mined-row' },
          h('button', { type: 'button', class: 'learn-mined-word', onclick: () => ctx.go('item', item.id) }, item.label),
          h('span', { class: 'learn-mined-sub' }, item.sub),
          h('button', {
            type: 'button',
            class: 'learn-mined-remove',
            onclick: () =>
              attempt(async () => {
                await api.removeWord(item.id);
                toast('Removed', 'info');
                refresh();
              }),
          }, 'Remove'),
        ),
      ),
    );
    fill(content, h('div', { class: 'learn-mined' }, list, addForm()));
  }

  function addForm() {
    const word = h('input', { type: 'text', placeholder: 'Word', 'aria-label': 'Word' });
    const reading = h('input', { type: 'text', placeholder: 'Reading (kana)', 'aria-label': 'Reading' });
    const meaning = h('input', { type: 'text', placeholder: 'Meaning', 'aria-label': 'Meaning' });
    const sentence = h('input', { type: 'text', placeholder: 'Sentence (optional)', 'aria-label': 'Sentence' });
    return h(
      'form',
      {
        class: 'learn-mined-form',
        onsubmit: (event) => {
          event.preventDefault();
          attempt(async () => {
            const payload = addWordPayload({
              word: word.value,
              reading: reading.value,
              meaning: meaning.value,
              sentence: sentence.value,
            });
            await api.addWord(payload);
            toast('Word added', 'info');
            refresh();
          });
        },
      },
      h('h2', {}, 'Add word'),
      word,
      reading,
      meaning,
      sentence,
      h('button', { type: 'submit', class: 'learn-mined-add' }, 'Add word'),
    );
  }
}
