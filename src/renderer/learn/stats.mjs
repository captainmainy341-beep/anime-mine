import { fill, h } from '../lib/ui.mjs';
import { dailyHeat, forecastBars, jlptList, percent } from '../lib/learnView.mjs';
import { progressBar } from './home.mjs';

const STAGES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ITEM_KINDS = [
  ['radicals', 'Radicals'],
  ['kanji', 'Kanji'],
  ['vocab', 'Vocabulary'],
];

export const pluralLabel = (singular, count) => `${singular}${count === 1 ? '' : 's'}`;

const stat = (label, value) => h('div', { class: 'learn-stat' }, h('strong', {}, value), h('span', {}, label));

function section(title, ...children) {
  return h('section', { class: 'learn-card' }, h('h2', {}, title), ...children);
}

export function mountStats(el, ctx) {
  const { api } = ctx;
  const body = h('div', { class: 'learn-stats' });
  el.append(body);
  let disposed = false;

  load();

  return () => {
    disposed = true;
  };

  async function load() {
    try {
      const stats = await api.learn.stats();
      if (disposed) return;
      render(stats);
    } catch (err) {
      if (disposed) return;
      fill(body, h('p', { class: 'learn-error', role: 'alert' }, `Could not load stats: ${err.message}`));
    }
  }

  function render(s) {
    const accuracy = s.accuracy30 == null ? '—' : `${Math.round(s.accuracy30 * 100)}%`;
    fill(
      body,
      section(
        'Accuracy · last 30 days',
        h('div', { class: 'learn-big' }, accuracy),
        h(
          'div',
          { class: 'learn-stat-row' },
          stat(pluralLabel('review', s.totals.reviews), s.totals.reviews),
          stat(pluralLabel('lesson', s.totals.lessons), s.totals.lessons),
          stat('correct', s.totals.correct),
        ),
      ),
      section('Reviews per day · last 30 days', reviewChart(s.daily)),
      section('Activity', heatStrip(s.daily)),
      section(
        'Stage distribution',
        stageBars('Kanji & vocab', s.stageCounts.wk),
        stageBars('Grammar', s.stageCounts.bp),
      ),
      section('Grammar by JLPT level', ...jlptList().map((level) => jlptRow(level, s.jlpt[level]))),
      section('Totals', ...ITEM_KINDS.map(([key, label]) => itemRow(label, s.wkItems[key]))),
      section('Leeches', leechList(s.leeches)),
    );
  }

  function reviewChart(daily) {
    if (!daily.some((day) => day.reviews > 0)) return h('p', { class: 'learn-sub' }, 'No reviews in the last 30 days.');
    const bars = forecastBars(
      daily.map((d) => ({ label: d.date, count: d.reviews })),
      100,
    );
    return h(
      'div',
      { class: 'learn-forecast' },
      bars.map(({ label, count, height }) =>
        h('span', {
          class: 'learn-fbar',
          title: `${label}: ${count} reviews`,
          'aria-label': `${label}: ${count} reviews`,
          style: `height:${height}px`,
        }),
      ),
    );
  }

  function heatStrip(daily) {
    if (!daily.some((day) => (day.reviews ?? 0) > 0 || (day.lessons ?? 0) > 0)) return h('p', { class: 'learn-sub' }, 'No activity yet.');
    return h(
      'div',
      { class: 'learn-heat' },
      dailyHeat(daily).map(({ date, level }) =>
        h('span', { class: `learn-heat-cell level-${level}`, title: date, 'aria-label': `${date}: level ${level}` }),
      ),
    );
  }

  function stageBars(label, counts) {
    const max = Math.max(1, ...STAGES.map((stage) => counts[stage] ?? 0));
    return h(
      'div',
      { class: 'learn-stage-group' },
      h('h3', {}, label),
      !STAGES.some((stage) => counts[stage] > 0) ? h('p', { class: 'learn-sub' }, 'No items started yet.') : null,
      STAGES.map((stage) => {
        const count = counts[stage] ?? 0;
        return h(
          'div',
          { class: 'learn-stage-row' },
          h('span', { class: 'learn-stage-label' }, `Stage ${stage}`),
          h('span', { class: 'learn-minibar' }, h('span', { style: `width:${percent(count, max)}%` })),
          h('span', { class: 'learn-stage-count' }, String(count)),
        );
      }),
    );
  }

  function jlptRow(level, info) {
    const total = info?.total ?? 0;
    return h(
      'div',
      { class: 'learn-jlpt-row' },
      h('strong', {}, level),
      h('span', { class: 'learn-sub' }, `started ${info?.started ?? 0} / ${total}`),
      progressBar(percent(info?.started ?? 0, total) / 100),
      h('span', { class: 'learn-sub' }, `completed ${info?.completed ?? 0} / ${total}`),
      progressBar(percent(info?.completed ?? 0, total) / 100),
    );
  }

  function itemRow(label, info) {
    return h(
      'div',
      { class: 'learn-item-row' },
      h('strong', {}, label),
      h('span', { class: 'learn-sub' }, `${info.started} started of ${info.total}`),
    );
  }

  function leechList(leeches) {
    if (!leeches.length) return h('p', { class: 'learn-sub' }, 'No leeches yet.');
    return h(
      'ul',
      { class: 'learn-leeches' },
      leeches.map((leech) =>
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'learn-link',
              onclick: () => ctx.go(leech.id.startsWith('g:') ? 'point' : 'item', leech.id),
            },
            leech.label,
          ),
          h('span', { class: 'learn-sub' }, ` ${leech.incorrect} wrong · ${leech.correct} right`),
        ),
      ),
    );
  }
}
