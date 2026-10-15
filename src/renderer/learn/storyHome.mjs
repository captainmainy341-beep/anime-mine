import { fill, h } from '../lib/ui.mjs';
import { backgroundFor, backgroundSvg, characterSvg } from './vn/defaultSkin.mjs';
import { continueRow, currentSeason, featured, genkiBooks, genkiRows, heroCopy, isDone, nudges, seasonRows, sheetActions, statusLabel, storyProgress, tileProgress, titleParts } from './storyHomeModel.mjs';

const ROTATE_MS = 9000;
const button = (label, onclick, className = 'story-btn', props = {}) => h('button', { type: 'button', class: className, onclick, ...props }, label);

// Drawn art for one scene: its background plus the first two characters of its cast. Pure markup, no assets.
function artNode(summary, { cast = 2, expr = 'smile', className = '' } = {}) {
  const art = h('div', { class: `nf-art ${className}`, style: `background:${backgroundFor(summary.bg).css}` });
  const bg = h('div', { class: 'story-bg-art nf-bgart' });
  bg.innerHTML = backgroundSvg(summary.bg);
  art.append(bg);
  const people = h('div', { class: 'nf-cast' });
  (summary.cast ?? []).slice(0, cast).forEach((c, i) => {
    const bust = h('div', { class: `nf-bust story-char pos-${i}`, 'data-char': c.id });
    bust.innerHTML = characterSvg(c.id, i === 0 ? expr : 'neutral', c.color ?? undefined);
    people.append(bust);
  });
  art.append(people);
  return art;
}

function particles(mood) {
  const count = mood === 'city' ? 18 : 16;
  return h('div', { class: `nf-fx fx-${mood}`, 'aria-hidden': 'true' }, Array.from({ length: count }, (_, i) => h('i', { style: `--x:${(i * 61 + 7) % 100}%;--d:${((i * 37) % 90) / 10}s;--t:${8 + (i % 6) * 1.7}s;--s:${0.6 + ((i * 29) % 70) / 100};--r:${(i * 47) % 360}deg` })));
}

function ring(done, total, accent) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return h('div', { class: 'nf-ring', style: `--p:${pct};--accent:${accent ?? 'var(--accent)'}`, role: 'img', 'aria-label': `${done} of ${total} complete` }, h('span', {}, `${done}/${total}`));
}

// Mounts the home into `root`. Returns a dispose function.
export function mountHome(root, list, actions) {
  const timers = [];
  const observers = [];
  const all = [...(list.chapters ?? []), ...(list.genki ?? [])];
  const byId = new Map(all.map((s) => [s.id, s]));
  const seasons = seasonRows(list.chapters ?? []);
  const overall = storyProgress(list);
  let sheet = null;

  const header = h('header', { class: 'nf-top' },
    h('div', { class: 'nf-top-title' }, h('h1', {}, 'Story'), h('p', { class: 'learn-sub' }, 'Play a scene. Every kanji you read and sentence you build is a review.')),
    h('div', { class: 'nf-top-tools' },
      overall.total ? h('div', { class: 'nf-overall', title: `${overall.done} of ${overall.total} chapters finished` }, ring(overall.done, overall.total), h('span', {}, 'Main story')) : null,
      button('Particle guide', actions.onGuide, 'story-btn'),
      actions.skinSelect),
  );

  const slides = featured(list);
  const hero = slides.length ? buildHero(slides) : null;
  const rows = [];
  const resume = continueRow(all);
  if (resume.length) rows.push(buildRow({ key: 'continue', title: 'Continue where you left off', sub: 'Saved scenes', scenes: resume, accent: 'var(--accent)' }));
  const genki = genkiRows(list.genki);
  for (const book of genkiBooks(genki)) {
    const lessonsDone = book.rows.filter((g) => g.primer?.done && isDone(g)).length;
    rows.push(buildRow({
      key: book.key,
      title: `${book.name} path · learn it, then live it`,
      sub: `Lessons ${book.from} to ${book.to}. Each lesson starts with a short, playful primer on that lesson's words and grammar, then a story scene that uses them. Follows the textbook order; original story, not affiliated with Genki or The Japan Times.`,
      accent: '#7cc6b4',
      scenes: book.rows,
      progress: { done: lessonsDone, total: book.rows.length },
      focusId: book.rows.find((g) => g.upNext)?.id,
      genki: true,
    }));
  }
  const current = currentSeason(seasons);
  for (const season of seasons) {
    rows.push(buildRow({
      key: `season-${season.level}`,
      title: `Season ${season.number} · ${season.name}`,
      sub: season.blurb,
      level: season.level,
      accent: season.accent,
      scenes: season.chapters,
      progress: { done: season.done, total: season.total },
      focusId: season.started || season === current ? season.nextId : null,
      active: season === current,
    }));
  }
  rows.push(buildMined());
  if (actions.aiReady) rows.push(buildAi());
  rows.push(buildGallery());
  const bonds = buildBonds();
  if (bonds) rows.push(bonds);

  fill(root, header, hero?.node, hero ? nudgeBar() : null, h('div', { class: 'nf-rows' }, rows));
  observeRows();
  scrollToFocus();
  hero?.start();

  return () => {
    timers.forEach(clearInterval);
    observers.forEach((o) => o.disconnect());
    hero?.stop();
    closeSheet();
  };

  // ---- billboard ----

  function buildHero(items) {
    let index = 0;
    let paused = false;
    let timer = null;
    const slideEls = items.map((item, i) => {
      const copy = heroCopy(item);
      const done = isDone(item.scene);
      const mood = item.season?.mood ?? 'petals';
      const accent = item.season?.accent ?? '#7cc6b4';
      const meta = [item.scene.jlpt, `${item.scene.challenges} challenges`, item.scene.primer ? `${item.scene.primer.minutes} min primer` : null].filter(Boolean);
      return h('div', { class: `nf-slide${i === 0 ? ' on' : ''}`, 'data-mood': mood, style: `--accent-season:${accent}`, 'aria-hidden': String(i !== 0) },
        artNode(item.scene, { cast: 3, expr: 'smile', className: 'nf-hero-art' }),
        particles(mood),
        h('div', { class: 'nf-shade' }),
        h('div', { class: 'nf-copy' },
          h('span', { class: 'nf-eyebrow' }, copy.eyebrow),
          h('h2', { class: 'nf-hero-title', lang: 'ja' }, copy.title),
          h('p', { class: 'nf-hero-sum' }, copy.summary),
          h('div', { class: 'nf-meta' }, meta.map((m) => h('span', {}, m)), done ? h('span', { class: 'ok' }, '✓ Completed') : null),
          h('div', { class: 'nf-hero-actions' },
            button(`▶  ${copy.cta}`, () => (item.kind === 'genki' && !item.scene.primer?.done ? actions.onLesson(item.scene.id) : actions.onPlay(item.scene.id)), 'nf-play'),
            button('ⓘ  More info', () => openSheet(item.scene), 'nf-info'))),
      );
    });
    const dots = items.length > 1 ? h('div', { class: 'nf-dots', role: 'tablist', 'aria-label': 'Featured' }, items.map((_, i) => h('button', { type: 'button', class: `nf-dot${i === 0 ? ' on' : ''}`, role: 'tab', 'aria-label': `Featured ${i + 1}`, onclick: () => show(i) }, h('i', {})))) : null;
    const node = h('section', { class: 'nf-hero', 'aria-roledescription': 'carousel', 'aria-label': 'Featured scenes' }, ...slideEls, dots);
    node.addEventListener('mouseenter', () => { paused = true; });
    node.addEventListener('mouseleave', () => { paused = false; });
    node.addEventListener('focusin', () => { paused = true; });
    node.addEventListener('focusout', () => { paused = false; });
    node.addEventListener('pointermove', (event) => {
      const rect = node.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      node.style.setProperty('--px', x.toFixed(3));
      node.style.setProperty('--py', y.toFixed(3));
    });
    function show(i) {
      index = (i + items.length) % items.length;
      slideEls.forEach((el, n) => {
        el.classList.toggle('on', n === index);
        el.setAttribute('aria-hidden', String(n !== index));
      });
      dots?.querySelectorAll('.nf-dot').forEach((d, n) => {
        d.classList.toggle('on', n === index);
        d.classList.remove('run');
        void d.offsetWidth;
        d.classList.toggle('run', n === index && items.length > 1);
      });
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    return {
      node,
      start() {
        show(0);
        if (items.length < 2 || reduce) return;
        timer = setInterval(() => { if (!paused && !document.hidden) show(index + 1); }, ROTATE_MS);
        timers.push(timer);
      },
      stop() { clearInterval(timer); },
    };
  }

  function nudgeBar() {
    const items = nudges(list);
    if (!items.length) return null;
    return h('div', { class: 'nf-nudges' }, items.map((n) => button(n.text, () => (n.action === 'lesson' ? actions.onLesson(n.scene) : actions.onPlay(n.scene)), 'nf-nudge')));
  }

  // ---- rows ----

  function tile(summary, opts = {}) {
    const { fraction, status } = tileProgress(summary);
    const parts = titleParts(summary);
    const label = summary.lesson ? `Lesson ${summary.lesson}` : parts.label;
    const up = Boolean(opts.focusId && summary.id === opts.focusId);
    const open = () => openSheet(summary);
    const el = h('article', { class: `nf-tile${up ? ' up' : ''}`, tabindex: '0', role: 'button', 'data-status': status, 'data-id': summary.id, 'aria-label': `${label}: ${parts.name}. ${statusLabel(status)}`, onclick: open, onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } } },
      artNode(summary, { cast: 2 }),
      h('div', { class: 'nf-tile-shade' }),
      h('span', { class: 'nf-badge' }, label),
      up ? h('span', { class: 'nf-up' }, 'Up next') : null,
      status === 'done' ? h('span', { class: 'nf-check', title: 'Completed' }, '✓') : null,
      summary.primer ? h('div', { class: 'nf-steps', title: 'Learn first, then the story' },
        h('span', { class: summary.primer.done ? 'on' : '' }, '① Learn'),
        h('span', { class: isDone(summary) ? 'on' : '' }, '② Story')) : null,
      h('div', { class: 'nf-tile-info' },
        h('h3', { lang: 'ja' }, parts.name),
        h('p', {}, statusLabel(status) || summary.covers || `${summary.challenges} challenges`)),
      h('div', { class: 'nf-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round(fraction * 100)}%` })),
      h('div', { class: 'nf-tile-hover' },
        h('p', {}, summary.summary || summary.covers || ''),
        h('div', { class: 'nf-tile-actions' },
          button('▶', (event) => { event.stopPropagation(); (summary.primer && !summary.primer.done ? actions.onLesson : actions.onPlay)(summary.id); }, 'nf-round', { 'aria-label': summary.primer && !summary.primer.done ? 'Start lesson' : 'Play' }),
          button('ⓘ', (event) => { event.stopPropagation(); open(); }, 'nf-round', { 'aria-label': 'More info' }))),
    );
    return el;
  }

  function buildRow({ key, title, sub, scenes, accent, progress, focusId, level, active, genki: isGenki }) {
    const track = h('div', { class: 'nf-track', tabindex: '-1' }, scenes.map((s) => tile(s, { focusId })));
    const left = button('‹', () => track.scrollBy({ left: -track.clientWidth * 0.85, behavior: 'smooth' }), 'nf-arrow left', { 'aria-label': 'Scroll left' });
    const right = button('›', () => track.scrollBy({ left: track.clientWidth * 0.85, behavior: 'smooth' }), 'nf-arrow right', { 'aria-label': 'Scroll right' });
    const sync = () => {
      left.hidden = track.scrollLeft < 8;
      right.hidden = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
    };
    track.addEventListener('scroll', sync, { passive: true });
    queueMicrotask(sync);
    setTimeout(sync, 250);
    return h('section', { class: `nf-row${active ? ' active' : ''}${isGenki ? ' genki' : ''}`, 'data-key': key, style: `--accent-season:${accent}` },
      h('header', { class: 'nf-row-head' },
        h('div', {}, h('h2', {}, level ? h('span', { class: 'nf-level' }, level) : null, title), sub ? h('p', { class: 'nf-row-sub' }, sub) : null),
        progress ? ring(progress.done, progress.total, accent) : null),
      h('div', { class: 'nf-track-wrap' }, left, track, right),
    );
  }

  function buildMined() {
    const scenes = list.anime ?? [];
    const plus = h('article', { class: 'nf-tile nf-plus', tabindex: '0', role: 'button', onclick: actions.onBuildAnime, onkeydown: (e) => { if (e.key === 'Enter') actions.onBuildAnime(); } },
      h('div', { class: 'nf-plus-body' }, h('span', { class: 'nf-plus-mark' }, '＋'), h('h3', {}, 'Build scenes from my anime'), h('p', {}, 'Short scenes made from lines you mined. A frame from the episode becomes the background.')));
    const track = h('div', { class: 'nf-track' }, scenes.map((s) => tile(s)), plus);
    return h('section', { class: 'nf-row', 'data-key': 'anime', style: '--accent-season:#f5c26b' },
      h('header', { class: 'nf-row-head' }, h('div', {}, h('h2', {}, 'Your anime moments'), h('p', { class: 'nf-row-sub' }, scenes.length ? 'Bonus scenes from sentences you mined.' : 'Mine some lines, then turn them into scenes here.'))),
      h('div', { class: 'nf-track-wrap' }, track));
  }

  function buildAi() {
    const scenes = list.ai?.scenes ?? [];
    const plus = h('article', { class: 'nf-tile nf-plus', tabindex: '0', role: 'button', onclick: actions.onGenerate, onkeydown: (e) => { if (e.key === 'Enter') actions.onGenerate(); } },
      h('div', { class: 'nf-plus-body' }, h('span', { class: 'nf-plus-mark' }, '✦'), h('h3', {}, 'Generate a side quest'), h('p', {}, 'Your AI provider writes a fresh scene around what you are studying. Saved, so replays are free.')));
    return h('section', { class: 'nf-row', 'data-key': 'ai', style: '--accent-season:#c9a7ff' },
      h('header', { class: 'nf-row-head' }, h('div', {}, h('h2', {}, 'Side quests'), h('p', { class: 'nf-row-sub' }, 'Written for you by your AI provider.'))),
      h('div', { class: 'nf-track-wrap' }, h('div', { class: 'nf-track' }, scenes.map((s) => tile(s)), plus)));
  }

  function buildGallery() {
    const unlocked = new Map((list.overview?.gallery ?? []).map((g) => [g.id, g]));
    const pictures = all.flatMap((s) => (s.pictures ?? []).map((p) => ({ ...p, scene: s })));
    const have = pictures.filter((p) => unlocked.has(p.id)).length;
    const tiles = pictures.map((p) => {
      const on = unlocked.has(p.id);
      const el = h('figure', { class: `nf-cg${on ? ' on' : ''}`, title: on ? p.title : 'Finish the scene to unlock' }, artNode(p.scene, { cast: 2, expr: 'smile' }), h('figcaption', {}, on ? p.title : '???'));
      if (!on) el.append(h('span', { class: 'nf-lock', 'aria-hidden': 'true' }, '🔒'));
      return el;
    });
    return h('section', { class: 'nf-row', 'data-key': 'gallery', style: '--accent-season:#f38bb0' },
      h('header', { class: 'nf-row-head' }, h('div', {}, h('h2', {}, 'Gallery'), h('p', { class: 'nf-row-sub' }, 'Every scene unlocks a picture. Collect them all.')), ring(have, pictures.length, '#f38bb0')),
      h('div', { class: 'nf-track-wrap' }, h('div', { class: 'nf-track nf-gallery' }, tiles)));
  }

  function buildBonds() {
    const entries = Object.entries(list.overview?.affection ?? {}).sort((a, b) => b[1].value - a[1].value);
    if (!entries.length) return null;
    const colors = new Map(all.flatMap((s) => (s.cast ?? []).map((c) => [c.id, c.color])));
    const people = entries.map(([id, e]) => {
      const face = h('div', { class: 'nf-face story-char' });
      face.innerHTML = characterSvg(id, 'smile', colors.get(id) ?? undefined);
      return h('div', { class: 'nf-bond', title: `${e.name}: ${e.value} / 100` },
        h('div', { class: 'nf-bond-ring', style: `--p:${Math.max(0, Math.min(100, e.value))}` }, face),
        h('strong', { lang: 'ja' }, e.name), h('small', {}, `${e.value} / 100`));
    });
    return h('section', { class: 'nf-row', 'data-key': 'bonds', style: '--accent-season:#f38bb0' },
      h('header', { class: 'nf-row-head' }, h('div', {}, h('h2', {}, 'Bonds'), h('p', { class: 'nf-row-sub' }, 'Finish scenes to grow closer to the people in them.'))),
      h('div', { class: 'nf-bonds' }, people));
  }

  // ---- detail sheet ----

  function openSheet(summary) {
    closeSheet();
    const parts = titleParts(summary);
    const act = sheetActions(summary);
    const { fraction, status } = tileProgress(summary);
    const season = seasons.find((s) => s.level === summary.jlpt);
    const accent = summary.track === 'genki' ? '#7cc6b4' : season?.accent ?? 'var(--accent)';
    const close = () => closeSheet();
    const grammar = (summary.labels ?? []).filter((l) => l.id.startsWith('g:'));
    const kanji = (summary.labels ?? []).filter((l) => l.id.startsWith('k:'));
    const chips = (items) => items.map((l) => h('span', { class: 'nf-learn-chip', title: l.meaning, lang: 'ja' }, l.label, l.meaning ? h('small', {}, l.meaning) : null));
    const primer = summary.primer;
    const steps = primer
      ? h('div', { class: 'nf-sheet-steps' },
        h('div', { class: `nf-step${primer.done ? ' done' : ' now'}` },
          h('span', { class: 'n' }, primer.done ? '✓' : '1'),
          h('div', {}, h('strong', {}, 'Learn first'), h('p', {}, `${primer.words} words · ${primer.patterns} patterns · ${primer.drills} exercises · about ${primer.minutes} min`), primer.done ? h('small', {}, `Best first-try: ${Math.round(primer.accuracy * 100)}%`) : null)),
        h('div', { class: `nf-step${isDone(summary) ? ' done' : primer.done ? ' now' : ''}` },
          h('span', { class: 'n' }, isDone(summary) ? '✓' : '2'),
          h('div', {}, h('strong', {}, 'Play the story'), h('p', {}, `${summary.beats} beats · ${summary.challenges} challenges that use what you just learned`))))
      : null;
    const play = () => { close(); actions.onPlay(summary.id); };
    const fresh = () => { close(); actions.onRestart(summary.id); };
    const lesson = () => { close(); actions.onLesson(summary.id); };
    const buttons = h('div', { class: 'nf-sheet-actions' },
      act.lesson ? button(`📖  ${act.lesson}`, lesson, act.lessonPrimary ? 'nf-play' : 'nf-info') : null,
      button(`▶  ${act.play}`, play, act.playPrimary ? 'nf-play' : 'nf-info'),
      act.restart ? button(act.restart, fresh, 'nf-info') : null);
    const dialog = h('div', { class: 'nf-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': parts.name, style: `--accent-season:${accent}` },
      h('div', { class: 'nf-sheet-hero' }, artNode(summary, { cast: 3 }), h('div', { class: 'nf-shade' }), button('✕', close, 'nf-sheet-x', { 'aria-label': 'Close' }),
        h('div', { class: 'nf-copy' }, h('span', { class: 'nf-eyebrow' }, summary.lesson ? `Genki path · Lesson ${summary.lesson}` : `${summary.jlpt} · ${parts.label}`), h('h2', { class: 'nf-hero-title', lang: 'ja' }, parts.name))),
      h('div', { class: 'nf-sheet-body' },
        h('div', { class: 'nf-sheet-main' },
          h('p', { class: 'nf-sheet-sum' }, summary.summary || ''),
          steps,
          buttons,
          status !== 'new' ? h('div', { class: 'nf-sheet-progress' }, h('div', { class: 'nf-bar' }, h('i', { style: `width:${Math.round(fraction * 100)}%` })), h('small', {}, statusLabel(status))) : null),
        h('aside', { class: 'nf-sheet-side' },
          grammar.length ? h('div', {}, h('h3', {}, 'Grammar you will use'), h('div', { class: 'nf-learn' }, chips(grammar))) : null,
          kanji.length ? h('div', {}, h('h3', {}, 'Kanji you will read'), h('div', { class: 'nf-learn' }, chips(kanji))) : null,
          summary.pictures?.length ? h('p', { class: 'nf-sheet-pic' }, `🖼  Unlocks: ${summary.pictures.map((p) => p.title).join(', ')}`) : null)),
    );
    const backdrop = h('div', { class: 'nf-backdrop', onclick: (event) => { if (event.target === backdrop) close(); } }, dialog);
    const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    root.append(backdrop);
    sheet = { backdrop, onKey };
    requestAnimationFrame(() => backdrop.classList.add('open'));
    dialog.querySelector('.nf-play, .nf-info')?.focus();
  }

  function closeSheet() {
    if (!sheet) return;
    document.removeEventListener('keydown', sheet.onKey, true);
    sheet.backdrop.remove();
    sheet = null;
  }

  // ---- motion ----

  function observeRows() {
    if (typeof IntersectionObserver === 'undefined') {
      root.querySelectorAll('.nf-row').forEach((r) => r.classList.add('seen'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('seen');
          io.unobserve(entry.target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    observers.push(io);
    root.querySelectorAll('.nf-row').forEach((r) => io.observe(r));
  }

  // Bring the tile you should play next into view in its row.
  function scrollToFocus() {
    requestAnimationFrame(() => {
      root.querySelectorAll('.nf-row').forEach((row) => {
        const target = row.querySelector('.nf-tile.up');
        const track = row.querySelector('.nf-track');
        if (target && track && target.offsetLeft > track.clientWidth - target.offsetWidth) track.scrollTo({ left: Math.max(0, target.offsetLeft - 24) });
      });
    });
  }
}
