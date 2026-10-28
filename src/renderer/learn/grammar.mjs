import { attempt, fill, h, toast } from '../lib/ui.mjs';
import { clozeParts, jlptList } from '../lib/learnView.mjs';
import { defaultJlpt, dueInLevel, levelSummary, pointStatus, timecode, videoTitle, exampleHit, highlightSegments, grammarBatchSize, grammarExplore, grammarLessons } from './grammarModel.mjs';
import { trailWindow, practiceVerdict, acceptedPracticeAnswers } from './courseModel.mjs';
import { nextLesson } from './exploreModel.mjs';
import { mountExplore } from './exploreView.mjs';
import { rubyNode } from './ruby.mjs';
import { speak, canSpeak } from './speak.mjs';
import { scanSummary } from './homeModel.mjs';
import { icon } from './icons.mjs';
import { doodle } from '../lib/doodleIcons.mjs';
import { lessonLabel, lessonsForPoint } from './genkiModel.mjs';

const button = (label, action, className = 'learn-g-btn', props = {}) => h('button', { type:'button', class:className, onclick:action, ...props }, label);
const chip = (text, className = '') => h('span', { class:`course-chip ${className}` }, text);

// Grammar opens on the Manga Ink Explore screen; "See all" opens the existing course view.
export function mountGrammar(el, ctx, arg = {}) {
  if (arg?.all === true) return mountCourse(el, ctx, arg);
  return mountExploreGrammar(el, ctx, arg);
}

function exploreLevel(stats, arg, ctx) {
  const preferred = arg?.jlpt ?? ctx?.prefs?.get?.('grammarLevel', null) ?? null;
  return jlptList().includes(preferred) ? preferred : defaultJlpt(stats?.jlpt);
}

function mountExploreGrammar(el, ctx, arg = {}) {
  const api = ctx.api.learn;
  let disposed = false;
  let seq = 0;
  let view = null;
  let model = null;
  let jlpt = null;
  let filter = 'all';
  load();
  return () => {
    disposed = true;
    seq += 1;
    view?.destroy();
    view = null;
  };

  async function load() {
    const mine = ++seq;
    showLoading();
    try {
      const [stats, due] = await Promise.all([api.stats(), api.reviews({ scope:'grammar' })]);
      if (stale(mine)) return;
      jlpt = exploreLevel(stats, arg, ctx);
      const rows = await api.browse({ type:'grammar', jlpt });
      if (stale(mine)) return;
      const dueIds = new Set((Array.isArray(due) ? due : []).map((card) => card?.id).filter(Boolean));
      const annotated = (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, due: dueIds.has(row.id) }));
      const lessons = grammarLessons(annotated, grammarBatchSize(ctx.settings));
      const next = nextLesson(lessons);
      let cards = [];
      if (next && typeof api.lessons === 'function') {
        try {
          cards = await api.lessons({ scope:'grammar', jlpt, ids: next.ids });
        } catch {
          cards = [];
        }
        if (stale(mine)) return;
      }
      model = grammarExplore(lessons, { cards, filter });
      view?.destroy();
      view = null;
      el.replaceChildren();
      view = mountExplore(el, viewProps());
    } catch (err) {
      if (!stale(mine)) showError(err);
    }
  }

  function stale(mine) {
    return disposed || mine !== seq;
  }

  function showLoading() {
    view?.destroy();
    view = null;
    el.replaceChildren(h('section', { class:'ink-screen ink-explore' }, h('p', { class:'ink-explore-loading' }, 'Loading grammar lessons…')));
  }

  function showError(err) {
    view?.destroy();
    view = null;
    el.replaceChildren(h('section', { class:'ink-screen ink-explore' },
      h('div', { class:'ink-panel ink-explore-error', role:'alert' },
        h('h2', {}, 'Could not load grammar'),
        h('p', {}, err?.message ?? 'Unknown error'),
        h('button', { type:'button', class:'ink-toggle', onclick:load }, 'Try again'))));
  }

  function viewProps() {
    const next = model.next;
    return {
      title: 'Explore Grammar',
      header: model.header,
      lesson: next ? {
        id: next.id,
        number: next.number,
        title: next.title,
        meta: next.meta,
        preview: next.preview,
        previewKind: 'text',
        isNew: next.isNew,
        done: next.done,
        start: () => ctx.go('session', { mode:'lesson', scope:'grammar', jlpt, ids: next.ids }),
      } : null,
      progress: model.progress,
      rows: model.rows.map((row) => ({
        id: row.id,
        tile: row.tile,
        tileKind: 'number',
        title: row.title,
        sub: row.sub,
        status: row.status,
        open: () => { if (row.firstId) ctx.go('point', row.firstId); },
      })),
      filter,
      onFilter: (value) => {
        filter = value;
        view?.update({ filter: value });
      },
      seeAll: { ...model.seeAll, onOpen: () => ctx.go('grammar', { all:true, jlpt }) },
      emptyText: model.emptyText,
    };
  }
}

function mountCourse(el, ctx, arg = {}) {
  const api = ctx.api.learn;
  let disposed = false, seq = 0, searchTimer, unmountPoint;
  const state = { jlpt:arg.jlpt ?? ctx.prefs.get('grammarLevel', null), query:'', selected:arg.selected ?? ctx.prefs.get('grammarPoint', null), rows:[] };
  const tabs = h('nav', { class:'learn-g-tabs', 'aria-label':'JLPT level' });
  const search = h('input', { class:'learn-g-search', type:'search', placeholder:'Search this level', 'aria-label':'Search grammar', oninput:event => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = event.target.value.trim(); refresh(); }, 180);
  }});
  const back = h('button', { type:'button', class:'learn-g-back', onclick:() => ctx.back() }, doodle('back'), h('span', {}, 'Explore'));
  const heading = h('header', { class:'course-heading' }, h('div', { class:'course-heading-main' }, back, h('div', {}, h('h1', {}, 'Grammar'), h('p', { class:'learn-sub' }, 'Learn a pattern. Try it in a sentence.'))), h('div', { class:'course-tools' }, tabs, search));
  const trail = h('nav', { class:'course-trail', 'aria-label':'Grammar learning trail' });
  const detail = h('div', { class:'course-selected' });
  const catalogue = h('details', { class:'course-catalog' });
  const summary = h('div', { class:'course-summary' });
  const root = h('section', { class:'learn-g course' }, heading, trail, detail, h('footer', { class:'course-footer' }, catalogue, summary));
  el.append(root);
  refresh();
  return () => { disposed = true; clearTimeout(searchTimer); unmountPoint?.(); root.remove(); };

  async function refresh() {
    const mine = ++seq;
    try {
      const [stats, due] = await Promise.all([api.stats(), api.reviews({ scope:'grammar' })]);
      if (disposed || mine !== seq) return;
      if (!jlptList().includes(state.jlpt)) state.jlpt = defaultJlpt(stats.jlpt);
      const rows = await api.browse({ type:'grammar', jlpt:state.jlpt, ...(state.query ? { query:state.query } : {}) });
      if (disposed || mine !== seq) return;
      state.rows = rows;
      if (!rows.some(row => row.id === state.selected)) state.selected = rows[0]?.id ?? null;
      renderTabs(); renderTrail(); renderCatalogue(); select(state.selected);
      const s = levelSummary(stats.jlpt[state.jlpt], dueInLevel(due, state.jlpt));
      fill(summary, ...[['Learned',s.learned],['Due',s.due],['Completed',s.completed]].map(([label,value]) => h('span', {}, h('strong', {}, String(value)), ` ${label}`)),
        button('Review grammar', () => ctx.go('session', { mode:'review', scope:'grammar' }), 'learn-g-btn', { disabled:due.length === 0 ? true : null }),
        button('Extra practice', () => ctx.go('session', { mode:'cram', scope:'grammar', source:'jlpt', value:state.jlpt }), 'learn-g-btn', { disabled:s.learned === 0 ? true : null }));
    } catch (err) { if (!disposed && mine === seq) fill(detail, h('div', { class:'learn-card learn-error', role:'alert' }, h('h2', {}, 'Could not load grammar'), h('p', {}, err.message), button('Try again', refresh))); }
  }
  function renderTabs() {
    fill(tabs, jlptList().map(name => button(name, () => { state.jlpt = name; state.selected = null; state.query = ''; search.value = ''; ctx.prefs.set('grammarLevel', name); refresh(); }, 'learn-g-tab', { 'aria-pressed':String(name === state.jlpt) })));
  }
  function renderTrail() {
    const rows = trailWindow(state.rows, state.selected);
    fill(trail, rows.map(row => button([
      h('span', { class:'course-stop-circle' }, row.stage > 0 ? icon('check') : row.selected ? icon('spark') : String(row.ordinal)),
      h('strong', { lang:'ja' }, row.label),
      h('small', {}, row.selected ? 'Selected pattern' : row.sub),
    ], () => select(row.id), `learn-g-row course-stop${row.selected ? ' selected' : ''}`, { 'aria-current':row.selected ? 'step' : null, title:`${row.label}: ${row.sub}` })));
  }
  function renderCatalogue() {
    const wasOpen = catalogue.open;
    fill(catalogue, h('summary', {}, icon('book'), `${state.jlpt} collection · ${state.rows.length} patterns`, h('span', {}, 'Browse all')),
      state.rows.length ? h('div', { class:'course-catalog-grid' }, state.rows.map(row => button([h('strong', { lang:'ja' }, row.label), h('small', {}, row.sub), chip(row.groupKey ? `Stage ${row.stage}` : 'New')], () => { select(row.id); catalogue.open = false; detail.scrollIntoView({ block:'nearest', behavior:'instant' }); }, 'course-catalog-item', { title:`${row.label}: ${row.sub}` }))) : h('p', { class:'learn-sub' }, 'No matches. Try a different word or clear the search.'));
    catalogue.open = wasOpen;
  }
  function select(id) {
    unmountPoint?.(); unmountPoint = null; state.selected = id; if (id) ctx.prefs.set('grammarPoint', id); renderTrail();
    fill(detail);
    if (!id) { fill(detail, h('div', { class:'learn-card course-empty' }, h('h2', {}, 'No patterns found'), h('p', { class:'learn-sub' }, 'Clear the search or choose another level.'))); return; }
    const index = state.rows.findIndex(row => row.id === id);
    unmountPoint = mountPoint(detail, ctx, id, {
      embedded:true,
      previous:index > 0 ? () => select(state.rows[index - 1].id) : null,
      next:index < state.rows.length - 1 ? () => select(state.rows[index + 1].id) : null,
    });
  }
}

export function mountPoint(el, ctx, id, options = {}) {
  const api = ctx.api.learn;
  let disposed = false, seq = 0;
  const body = h('section', { class:'learn-g-point' });
  el.append(body); load();
  return () => { disposed = true; seq++; body.remove(); };
  async function load() {
    const mine = ++seq;
    try {
      const [card, genki] = await Promise.all([api.card(id), ctx.api.story?.genki?.().catch(() => null)]);
      if (!disposed && mine === seq) render(card, lessonsForPoint(genki, id));
    }
    catch (err) { if (!disposed && mine === seq) fill(body, h('div', { class:'learn-card learn-error', role:'alert' }, err.message, button('Try again', load))); }
  }
  function render(card, genkiLessons = []) {
    const lesson = h('article', { class:'course-lesson' },
      h('div', { class:'course-tags' }, chip(`${card.jlpt} grammar`, 'pink'), chip(card.group?.label ?? 'New point'), chip(card.formality)),
      genkiLessons.length ? h('p', { class:'course-genki' }, 'Taught in ', genkiLessons.map((entry, i) => [i ? ', ' : null, button(lessonLabel(entry), () => ctx.go('story', { lesson:entry.id }), 'course-link', { title:'Open this lesson' })])) : null,
      h('h2', { class:'course-title', lang:'ja' }, card.title), h('p', { class:'course-meaning' }, card.meaning),
      h('section', { class:'course-explanation' }, h('h3', {}, 'How it works'), h('p', { class:'course-syntax', lang:'ja' }, card.structure), card.notes ? h('p', { class:'course-note' }, card.notes) : null), examples(card),
      card.similar?.length ? h('details', { class:'course-related' }, h('summary', {}, 'Related patterns'), h('div', { class:'learn-chips' }, card.similar.map(p => p.id ? button(p.title, () => ctx.go('point', p.id)) : chip(p.title)))) : null);
    const right = h('div', { class:'course-practice-column' }, practice(card), anime(card));
    const nav = h('div', { class:'course-point-nav' },
      options.embedded ? button('Previous pattern', options.previous, 'learn-g-btn', { disabled:options.previous ? null : true }) : button('Back', () => ctx.back()),
      options.embedded ? button(['Next pattern ', icon('arrow')], options.next, 'learn-g-btn', { disabled:options.next ? null : true }) : null);
    fill(body, options.embedded ? null : h('header', { class:'course-heading' }, h('h1', {}, 'Grammar')), h('div', { class:'course-detail' }, lesson, right), nav);
  }
  function examples(card) {
    let english = ctx.settings.showEnglish !== false, furigana = ctx.settings.showFurigana !== false;
    const first = h('div', { class:'course-examples course-first-example' });
    const more = h('div', { class:'course-examples' });
    const list = h('div', {}, first, card.examples?.length > 1 ? h('details', { class:'course-example-list' }, h('summary', {}, `${card.examples.length - 1} more example sentences`), more) : null);
    const englishButton = button('English', () => { english = !english; englishButton.setAttribute('aria-pressed', String(english)); list.querySelectorAll('.learn-g-en').forEach(e => e.hidden = !english); }, 'course-toggle', { 'aria-pressed':String(english) });
    const rubyButton = button('Furigana', () => { furigana = !furigana; rubyButton.setAttribute('aria-pressed', String(furigana)); paint(); }, 'course-toggle', { 'aria-pressed':String(furigana) });
    let paintSeq = 0;
    async function paint() {
      const mine = ++paintSeq;
      const rows = await Promise.all((card.examples ?? []).map(async ex => {
        const hit = exampleHit(card.cloze, ex.ja);
        const parts = hit ? highlightSegments(ex.ja, hit.start, hit.end) : [{ text:ex.ja, hit:false }];
        const nodes = await Promise.all(parts.map(part => rubyNode(api, part.text, { furigana })));
        const ja = h('span', {}, nodes.map((node, i) => parts[i].hit ? h('mark', { class:'course-highlight' }, node) : node));
        return h('div', { class:'learn-g-example' }, h('div', { class:'learn-g-ja' }, ja, canSpeak() ? button(icon('sound'), () => speak(ex.ja), 'course-speak', { 'aria-label':'Listen to example' }) : null), h('p', { class:'learn-g-en', hidden:!english }, ex.en));
      }));
      if (!disposed && mine === paintSeq) { fill(first, rows[0]); fill(more, rows.slice(1)); }
    }
    paint();
    return h('section', { class:'course-example-section' }, h('div', { class:'course-section-head' }, h('h3', {}, 'Hear it in context'), h('div', { class:'course-toggles' }, rubyButton, englishButton)),
      list);
  }
  function practice(card) {
    const cloze = card.cloze;
    const panel = h('section', { class:'course-practice' });
    const status = pointStatus(card, Date.now());
    const actions = h('div', { class:'learn-g-actions' },
      !card.stage ? button(['Learn this point ', icon('arrow')], () => ctx.go('session', { mode:'lesson', scope:'grammar', ids:[card.id] }), 'learn-g-btn primary') : button('Extra practice', () => ctx.go('session', { mode:'cram', scope:'grammar', source:'jlpt', value:card.jlpt }), 'learn-g-btn'),
      status ? h('div', { class:'learn-g-status' }, h('strong', {}, status.line), h('small', {}, status.next)) : h('small', {}, 'A lesson quiz starts your spaced reviews.'),
      card.group?.key === 'completed' ? button('Resurrect', () => attempt(async () => { await api.resurrect(card.id); toast('Ready to review again'); await load(); })) : null);
    if (!cloze) { fill(panel, h('h3', {}, 'Explore this pattern'), h('p', { class:'learn-sub' }, 'No practice sentence is available for this point.'), actions); return panel; }
    const { before, after } = clozeParts(cloze.ja);
    const gap = h('span', { class:'course-gap', 'aria-label':'missing phrase' }, '…');
    const feedback = h('p', { class:'course-feedback', role:'status', 'aria-live':'polite' }, 'Type the missing Japanese phrase. Kana and kanji are accepted.');
    const input = h('input', { class:'course-answer', type:'text', lang:'ja', autocomplete:'off', spellcheck:'false', 'aria-label':'Practice answer', placeholder:'Type your answer', oninput:() => { panel.classList.remove('incorrect'); } });
    const hint = h('p', { class:'course-hint', hidden:true }, cloze.hint || card.structure);
    let answers = cloze.answers, answered = false, checking = false;
    const prepared = acceptedPracticeAnswers(cloze.answers, text => api.furigana(text)).then(list => { answers = list; });
    const check = h('button', { class:'learn-g-btn course-check', type:'submit' }, 'Check answer');
    const form = h('form', { class:'course-answer-form', onsubmit:event => { event.preventDefault(); attempt(async () => {
      if (checking) return; checking = true; check.disabled = true;
      try {
        await prepared; if (disposed) return;
        const verdict = practiceVerdict(input.value, answers);
        feedback.textContent = verdict.message;
        panel.classList.toggle('correct', verdict.result === 'correct');
        panel.classList.toggle('incorrect', verdict.result === 'incorrect');
        if (verdict.result === 'correct') {
          answered = true; gap.textContent = cloze.answers[0]; input.readOnly = true;
          fill(check, icon('check'), 'Got it'); check.disabled = true;
          replay.hidden = false;
        } else input.focus();
      } finally { checking = false; if (!answered && !disposed) check.disabled = false; }
    }); } }, input, check);
    const replay = button('Try again', () => { answered = false; input.readOnly = false; input.value = ''; check.disabled = false; check.textContent = 'Check answer'; panel.classList.remove('correct','incorrect'); gap.textContent = '…'; feedback.textContent = 'A fresh try. Fill in the missing phrase.'; replay.hidden = true; input.focus(); }, 'course-link', { hidden:true });
    const reveal = button('Show answer', () => { gap.textContent = cloze.answers[0]; feedback.textContent = `Answer: ${cloze.answers.join(' / ')}. Try saying the whole sentence.`; replay.hidden = false; panel.classList.remove('incorrect'); }, 'course-link');
    fill(panel, h('div', { class:'course-section-head' }, h('h3', {}, 'Give it a try'), h('small', {}, 'Practice · no SRS changes')),
      h('div', { class:'course-cloze', lang:'ja' }, before, gap, after), ctx.settings.showEnglish !== false && cloze.en ? h('p', { class:'course-translation' }, cloze.en) : null,
      form, feedback, hint, h('div', { class:'course-practice-tools' }, button('Need a hint?', () => { hint.hidden = !hint.hidden; }, 'course-link'), reveal, replay), actions);
    return panel;
  }
  function anime(card) {
    const items = card.animeExamples ?? [];
    const scan = button([icon('play'), 'Scan my library'], () => {
      scan.disabled = true;
      attempt(async () => { try { const result = await api.scanGrammar(); if (!disposed) { toast(scanSummary(result)); await load(); } } finally { if (!disposed) scan.disabled = false; } });
    }, 'learn-g-btn');
    return h('details', { class:'course-anime' }, h('summary', {}, icon('play'), `From your anime${items.length ? ` · ${items.length} examples` : ''}`),
      items.length ? h('div', { class:'learn-g-anime' }, items.map(ex => h('article', { class:'learn-g-anime-row' }, h('p', { lang:'ja' }, ex.text.slice(0,ex.matchStart), h('mark', {}, ex.text.slice(ex.matchStart,ex.matchEnd)), ex.text.slice(ex.matchEnd)), h('small', {}, `${videoTitle(ex.videoPath)} · ${timecode(ex.start)}`), button('Watch scene', () => ctx.watch({ videoPath:ex.videoPath, start:ex.start }))))) : h('p', { class:'learn-sub' }, 'Find real examples in your subtitles and jump back to the scene.'), scan);
  }
}
