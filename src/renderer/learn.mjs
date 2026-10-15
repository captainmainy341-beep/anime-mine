import { mountHome } from './learn/home.mjs';
import { mountLevels } from './learn/browse.mjs';
import { mountItem } from './learn/item.mjs';
import { mountSession } from './learn/session.mjs';
import { mountGrammar, mountPoint } from './learn/grammar.mjs';
import { mountStory } from './learn/story.mjs';
import { mountStats } from './learn/stats.mjs';
import { mountLearnSettings } from './learn/settings.mjs';
import { speak } from './learn/speak.mjs';
import { attempt, h, fill, toast } from './lib/ui.mjs';

const VIEWS = {
  home: mountHome,
  levels: mountLevels,
  item: mountItem,
  session: mountSession,
  grammar: mountGrammar,
  story: mountStory,
  point: mountPoint,
  stats: mountStats,
  settings: mountLearnSettings,
};

const TABS = [
  ['home', 'Home'],
  ['levels', 'Kanji'],
  ['grammar', 'Grammar'],
  ['story', 'Story'],
  ['stats', 'Stats'],
  ['settings', 'Settings'],
];

const TAB_FOR_VIEW = { item: 'levels', point: 'grammar' };

function readPref(key, fallback) {
  const raw = localStorage.getItem(`learn.${key}`);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function mountLearn(container, { onWatch }) {
  const api = window.api;
  const stack = [];
  let disposed = false;
  let unmountView = null;
  let viewSeq = 0;

  const ctx = {
    api,
    go,
    back,
    toast,
    settings: null,
    reloadSettings,
    prefs: {
      get: readPref,
      set: (key, value) => localStorage.setItem(`learn.${key}`, JSON.stringify(value)),
    },
    watch: onWatch,
    speak,
  };

  const tabs = h('nav', { class: 'learn-tabs', role: 'tablist', 'aria-label': 'Learn sections' });
  const body = h('div', { class: 'learn-body' }, h('p', { class: 'learn-sub' }, 'Loading…'));
  const root = h(
    'section',
    { class: 'page learn' },
    h('header', { class:'learn-shell-nav' }, h('div', { class:'learn-head' }, h('span', {}, 'Learn')), tabs),
    body,
  );
  container.append(root);

  api.learn.status().catch(() => {});
  init();

  return () => {
    disposed = true;
    teardownView();
    root.remove();
  };

  async function init() {
    try {
      ctx.settings = await api.learn.settingsGet();
    } catch (err) {
      if (disposed) return;
      fill(body, errorPanel(err, init));
      return;
    }
    if (!disposed) show();
  }

  async function reloadSettings() {
    ctx.settings = await api.learn.settingsGet();
    return ctx.settings;
  }

  function go(view, arg) {
    stack.push({ view, arg });
    show();
  }

  function back() {
    if (stack.length) stack.pop();
    show();
  }

  function current() {
    return stack.at(-1) ?? { view: 'home', arg: undefined };
  }

  function show() {
    if (disposed) return;
    const { view, arg } = current();
    renderTabs(view);
    mountInto(view, arg);
  }

  function renderTabs(view) {
    if (view === 'session') {
      tabs.hidden = true;
      return;
    }
    tabs.hidden = false;
    const active = TAB_FOR_VIEW[view] ?? view;
    fill(
      tabs,
      TABS.map(([key, label], index) =>
        h(
          'button',
          {
            type: 'button',
            class: 'learn-tab',
            role: 'tab',
            'aria-selected': key === active ? 'true' : 'false',
            tabindex: key === active ? 0 : -1,
            onkeydown: (event) => {
              if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
              const nextKey = TABS[next][0]; stack.length = 0;
              if (nextKey !== 'home') stack.push({ view:nextKey });
              show(); tabs.querySelector('[aria-selected="true"]')?.focus();
            },
            onclick: () => {
              stack.length = 0;
              if (key !== 'home') stack.push({ view: key });
              show();
            },
          },
          label,
        ),
      ),
    );
  }

  function mountInto(view, arg) {
    teardownView();
    const seq = ++viewSeq;
    const el = h('div', { class: 'learn-view' });
    fill(body, el);
    try {
      const mount = VIEWS[view];
      if (!mount) throw new Error(`Unknown Learn view: ${view}`);
      const unmount = mount(el, ctx, arg);
      if (seq === viewSeq) unmountView = unmount;
      else unmount?.();
    } catch (err) {
      fill(body, errorPanel(err, () => mountInto(view, arg)));
    }
  }

  function teardownView() {
    const unmount = unmountView;
    unmountView = null;
    viewSeq++;
    try {
      unmount?.();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function errorPanel(err, retry) {
    return h(
      'div',
      { class: 'learn-card learn-error', role: 'alert' },
      h('h2', {}, 'This Learn view failed to load'),
      h('p', { class: 'learn-sub' }, err.message),
      h('button', { type: 'button', class: 'learn-btn primary', onclick: () => attempt(async () => retry()) }, 'Retry'),
    );
  }
}
