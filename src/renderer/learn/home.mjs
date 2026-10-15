import { attempt, fill, h } from '../lib/ui.mjs';
import { icon } from './icons.mjs';
import { formatDue, forecastBars, groupLabel, groupOrder, streakLabel } from '../lib/learnView.mjs';
import {
  PACK_HINT,
  groupHue,
  lessonsDisabledReason,
  levelSentence,
  reviewsDisabledReason,
  scanProgressText,
  scanSummary,
  vacationBanner,
} from './homeModel.mjs';

const EXTRA_SOURCES = [
  ['recentMistakes', 'Recent mistakes'],
  ['recentLessons', 'Recent lessons'],
  ['burned', 'Burned items'],
  ['ghosts', 'Ghosts'],
];

export async function runPackDownload(api, onFraction) {
  const unsubscribe = api.learn.onProgress(onFraction);
  try {
    return await api.learn.downloadPack();
  } finally {
    unsubscribe();
  }
}

export function progressBar(fraction) {
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return h(
    'div',
    { class: 'learn-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
    h('span', { style: `width:${pct}%` }),
  );
}

const dayLabel = (offset) => (offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : `In ${offset} days`);

export function mountHome(el, ctx) {
  const { api } = ctx;
  const body = h('div', { class: 'learn-home' });
  el.append(body);
  let disposed = false;
  let seq = 0;
  let scanResult = null;
  let grammarRows = [];

  load();

  return () => {
    disposed = true;
  };

  async function load() {
    const mine = ++seq;
    try {
      const [dashboard, rows] = await Promise.all([api.learn.dashboard(), api.learn.browse({ type:'grammar', jlpt:ctx.prefs.get('grammarLevel', 'N5') })]);
      grammarRows = rows;
      if (disposed || mine !== seq) return;
      render(dashboard);
    } catch (err) {
      if (disposed || mine !== seq) return;
      fill(body, h('p', { class: 'learn-error', role: 'alert' }, `Could not load the dashboard: ${err.message}`));
    }
  }

  function render(d) {
    fill(body,
      h('header', { class:'course-heading' }, h('div', {}, h('h1', {}, 'A little Japanese, every day.'), h('p', { class:'learn-sub' }, 'Your next session is ready when you are.')),
        h('span', { class:'course-chip mint' }, ctx.settings.dailyLessonLimit === 0 ? 'No daily lesson limit' : `${d.lessons.remainingToday} lessons left today`)),
      d.packReady ? null : dataGate(),
      d.vacation ? h('div', { class:'learn-banner warn', role:'status' }, vacationBanner(true)) : null,
      levelCard(d.level),
      h('div', { class:'home-session-heading' }, h('h2', {}, 'What do you feel like learning?'), h('span', { class:'course-chip' }, `${ctx.settings.lessonBatch} items per session`)),
      h('div', { class:'learn-actions home-session-options' },
        lessonOption('字', 'Kanji & vocabulary', 'Start with radicals. Build up to the words you hear in your shows.', 'Kanji & vocab lessons',
          !d.packReady ? PACK_HINT : lessonsDisabledReason(d.lessons.kanji), () => ctx.go('session', { mode:'lesson', scope:'kanji' })),
        lessonOption('文', 'Grammar', 'A pattern, a real sentence, and that moment when it clicks.', 'Explore grammar', null, () => ctx.go('grammar'))),
      grammarTrail(), srsSection(d.groups),
      h('div', { class:'home-support-grid' }, reviewsCard(d), animeCard(), extraRow(), streakCard(d)),
      h('details', { class:'home-forecast' }, h('summary', {}, 'Your upcoming reviews'), forecastSection(d)));
  }
  function lessonOption(symbol, title, text, label, disabledReason, action) {
    return h('section', { class:`home-session-option${symbol === '文' ? ' grammar-option' : ''}` },
      h('span', { class:'home-session-symbol', lang:'ja', 'aria-hidden':'true' }, symbol),
      h('div', {}, h('h2', {}, title), h('p', { class:'learn-sub' }, text),
        h('button', { type:'button', class:'learn-btn primary', disabled:disabledReason ? true : null, onclick:action }, label, icon('arrow')),
        disabledReason ? h('p', { class:'learn-hint' }, disabledReason) : null));
  }
  function grammarTrail() {
    return h('section', { class:'home-grammar-trail' }, h('div', { class:'home-session-heading' }, h('h2', {}, 'Your grammar trail'), h('button', { type:'button', class:'course-link', onclick:() => ctx.go('grammar') }, 'Browse grammar')),
      h('div', { class:'course-trail' }, grammarRows.slice(0,5).map((row, i) => h('button', { type:'button', class:`course-stop${i === 0 ? ' selected' : ''}`, onclick:() => ctx.go('point', row.id), title:row.sub },
        h('span', { class:'course-stop-circle' }, row.stage ? icon('check') : i === 0 ? icon('spark') : String(i + 1)), h('strong', { lang:'ja' }, row.label), h('small', {}, row.stage ? `Stage ${row.stage}` : 'Ready to explore')))));
  }

  function dataGate() {
    let bar = progressBar(0);
    const button = h(
      'button',
      {
        type: 'button',
        class: 'learn-btn primary',
        onclick: () => {
          button.disabled = true;
          attempt(async () => {
            try {
              await runPackDownload(api, (fraction) => bar.replaceWith((bar = progressBar(fraction))));
              await load();
            } finally {
              button.disabled = false;
            }
          });
        },
      },
      'Download data',
    );
    return h(
      'section',
      { class: 'learn-card learn-gate' },
      h('h2', {}, 'Download kanji & vocabulary data'),
      h(
        'p',
        { class: 'learn-sub' },
        'Kanji and vocabulary use open data: KANJIDIC2, JMdict and Tatoeba example sentences. About 16 MB, built locally on this machine. Grammar works without it.',
      ),
      button,
      bar,
    );
  }

  function reviewsCard(d) {
    const dueKanjiReason = !d.packReady ? PACK_HINT : reviewsDisabledReason(d.reviews.dueKanji);
    return h(
      'section',
      { class: 'learn-card learn-action' },
      h('h2', {}, 'Reviews'),
      h('p', {}, `${d.reviews.due} due`),
      h('p', { class: 'learn-sub' }, `${d.reviews.dueKanji} kanji & vocab · ${d.reviews.dueGrammar} grammar`),
      h('p', { class: 'learn-sub' }, d.reviews.due > 0
        ? 'Reviews due now'
        : d.reviews.nextAt == null ? 'No reviews scheduled yet' : `Next review ${formatDue(d.reviews.nextAt, Date.now())}`),
      actionButton('Kanji & vocab reviews', dueKanjiReason, () =>
        ctx.go('session', { mode: 'review', scope: 'kanji' }),
      ),
      actionButton('Grammar reviews', reviewsDisabledReason(d.reviews.dueGrammar), () =>
        ctx.go('session', { mode: 'review', scope: 'grammar' }),
      ),
      actionButton('All reviews', reviewsDisabledReason(d.reviews.due), () =>
        ctx.go('session', { mode: 'review', scope: 'all' }),
      ),
    );
  }

  function actionButton(label, disabledReason, onclick) {
    return h(
      'div',
      { class: 'learn-action-row' },
      h('button', { type: 'button', class: 'learn-btn', disabled: disabledReason ? true : null, onclick }, label),
      disabledReason ? h('span', { class: 'learn-hint' }, disabledReason) : null,
    );
  }

  function levelCard(level) {
    return h('section', { class:'home-level' }, h('span', { class:'home-level-number' }, String(level.current)),
      h('div', { class:'home-level-copy' }, h('strong', {}, `Level ${level.current} · Build your foundation`), h('small', {}, levelSentence(level))),
      progressBar(level.percent / 100), h('span', { class:'course-chip' }, `${level.kanjiPassed} / ${level.needed}`));
  }
  function srsSection(groups) {
    return h('section', { class:'home-stage-section' }, h('div', { class:'home-session-heading' }, h('h2', {}, 'Your learning, at a glance'), h('small', {}, 'Starts filling as you learn')),
      stageRow('Kanji & vocabulary', 'wk', groups.wk), stageRow('Grammar', 'bp', groups.bp));
  }
  function stageRow(label, schedule, counts) {
    return h('div', { class:'home-stages' }, h('span', { class:'home-stage-label' }, label), groupOrder(schedule).map(key =>
      h('div', { class:'home-stage', style:`--group-hue:${groupHue(key)}` }, h('strong', {}, String(counts[key] ?? 0)), h('span', {}, groupLabel(schedule,key)))));
  }

  function forecastSection(d) {
    const hours = forecastBars(
      d.forecastHours.map((b) => ({ label: `+${b.hourOffset}h`, count: b.count })),
      80,
    );
    return h(
      'section',
      { class: 'learn-card' },
      h('h2', {}, 'Next 24 hours'),
      h(
        'div',
        { class: 'learn-forecast' },
        hours.map(({ label, count, height }) =>
          h('span', {
            class: 'learn-fbar',
            title: `${label}: ${count} due`,
            'aria-label': `${label}: ${count} due`,
            style: `height:${height}px`,
          }),
        ),
      ),
      h('h2', {}, 'Next 7 days'),
      h(
        'ul',
        { class: 'learn-days' },
        d.forecastDays.map(({ dayOffset, count }) =>
          h('li', { title: `${dayLabel(dayOffset)}: ${count} due` }, `${dayLabel(dayOffset)} · ${count}`),
        ),
      ),
    );
  }

  function streakCard(d) {
    const toggle = h('input', {
      type: 'checkbox',
      checked: d.vacation ? true : null,
      onchange: (event) =>
        attempt(async () => {
          await api.learn.vacation(event.target.checked);
          await load();
        }),
    });
    return h(
      'section',
      { class: 'learn-card' },
      h('h2', {}, 'Streak'),
      h('p', {}, streakLabel(d.streakDays)),
      h('label', { class: 'learn-switch' }, toggle, h('span', {}, 'Vacation mode')),
    );
  }

  function animeCard() {
    const status = h('p', { class: 'learn-sub', role: 'status' }, scanResult ? scanSummary(scanResult) : '');
    const button = h(
      'button',
      {
        type: 'button',
        class: 'learn-btn',
        onclick: () => {
          button.disabled = true;
          attempt(async () => {
            const unsubscribe = api.learn.onScanProgress((p) => {
              status.textContent = scanProgressText(p);
            });
            try {
              scanResult = await api.learn.scanGrammar();
              status.textContent = scanSummary(scanResult);
            } finally {
              unsubscribe();
              button.disabled = false;
            }
          });
        },
      },
      'Scan my library for grammar examples',
    );
    return h(
      'section',
      { class: 'learn-card' },
      h('h2', {}, 'From your anime'),
      h('p', { class: 'learn-sub' }, 'Real lines from the shows you watch become extra practice sentences.'),
      button,
      status,
    );
  }

  function extraRow() {
    return h(
      'section',
      { class: 'learn-card' },
      h('h2', {}, 'Extra study'),
      h(
        'div',
        { class: 'learn-chips' },
        EXTRA_SOURCES.map(([source, label]) =>
          h(
            'button',
            {
              type: 'button',
              class: 'learn-chip',
              onclick: () => ctx.go('session', { mode: 'cram', scope: 'all', source }),
            },
            label,
          ),
        ),
      ),
    );
  }
}
