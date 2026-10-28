import { attempt, fill, h, toast } from '../lib/ui.mjs';
import { rubyNode } from './ruby.mjs';
import { createEngine } from './vn/engine.mjs';
import { revealAnswer, typedKana } from './vn/challenge.mjs';
import { autoDelay, isComplete, sliceText, visibleCount } from './vn/typewriter.mjs';
import { resolveBackground, resolveSprite } from './vn/skin.mjs';
import { backgroundFor, backgroundSvg, characterSvg } from './vn/defaultSkin.mjs';
import { TRANSLATE_PREF, backlogRows, endSummary, guideFocus, introModel, kanjiCard, menuSections, particleParts, pendingLabel, pickSkin, reportLine, translateLabel, translationOn } from './storyModel.mjs';
import { jaNodes, kanjify, renderKanjiCard, renderParticleGuide, renderPeekConfirm } from './storyGuide.mjs';
import { mountHome } from './storyHome.mjs';
import { mountLesson } from './lesson.mjs';
import { doodle, withIcon } from '../lib/doodleIcons.mjs';

const POSITIONS = ['left', 'center', 'right'];
const PEEKED_NOTE = 'You looked this kanji up: answer now, and it will come back later.';

const button = (label, onclick, className = 'story-btn', props = {}) => h('button', { type: 'button', class: className, onclick, ...props }, label);

export function restoredIntroductions(snapshot, items) {
  return new Set(Array.isArray(snapshot?.introducedNow) ? snapshot.introducedNow.filter((id) => items.includes(id)) : []);
}

export function mergeIntroductions(current, snapshot, items, reported) {
  for (const id of restoredIntroductions(snapshot, items)) {
    if (!reported.has(id)) current.add(id);
  }
  return current;
}

export function snapshotWithIntroductions(snapshot, introducedNow) {
  return { ...snapshot, introducedNow: [...introducedNow] };
}

export function mountStory(el, ctx, arg = {}) {
  const api = ctx.api.story;
  let disposed = false;
  let teardownPlay = null;
  let teardownMenu = null;
  let lastList = null;
  let screenSeq = 0;
  const root = h('section', { class: 'story' });
  el.append(root);
  showMenu();
  if (arg.play) play(arg.play);
  else if (arg.lesson) openLesson(arg.lesson);

  const unmount = () => {
    disposed = true;
    teardownPlay?.();
    teardownMenu?.();
    root.remove();
  };
  unmount.canLeave = () => teardownPlay?.canLeave ? teardownPlay.canLeave() : true;
  return unmount;

  function leaveScreens() {
    screenSeq++;
    teardownPlay?.();
    teardownPlay = null;
    teardownMenu?.();
    teardownMenu = null;
  }

  async function showMenu() {
    leaveScreens();
    const seq = screenSeq;
    fill(root, h('p', { class: 'learn-sub' }, 'Loading…'));
    let list;
    try {
      list = await api.list();
    } catch (err) {
      if (!disposed && seq === screenSeq) fill(root, h('div', { class: 'learn-card learn-error', role: 'alert' }, h('h2', {}, 'Could not load Story'), h('p', {}, err.message), button('Try again', showMenu)));
      return;
    }
    if (disposed || seq !== screenSeq) return;
    renderMenu(list);
  }

  function renderMenu(list) {
    lastList = list;
    const sections = menuSections(list);
    const skin = pickSkin(list.skins, ctx.prefs.get('storySkin', null));
    const skinSelect = h(
      'label',
      { class: 'story-skin-label' },
      'Art ',
      h(
        'select',
        { class: 'story-select', 'aria-label': 'Art pack', onchange: (event) => { ctx.prefs.set('storySkin', event.target.value || null); } },
        h('option', { value: '' }, 'Default (drawn in code)'),
        list.skins.filter((p) => p.valid).map((p) => h('option', { value: p.pack, selected: p.pack === skin ? true : null }, p.title)),
      ),
    );
    teardownMenu = mountHome(root, list, {
      skinSelect,
      aiReady: sections.aiVisible,
      onPlay: (id) => play(id),
      onLesson: (id) => openLesson(id),
      onRestart: (id) => attempt(async () => { await api.clearSave(id); play(id, { fresh: true }); }),
      onGuide: () => showGuide(),
      onBuildAnime: () => attempt(buildAnime),
      onGenerate: () => attempt(generate),
    });
  }

  async function showGuide() {
    leaveScreens();
    fill(root, h('p', { class: 'learn-sub' }, 'Loading…'));
    try {
      const guide = await api.particles();
      if (!disposed) fill(root, button(withIcon('back', 'Back to Story'), showMenu, 'story-btn'), renderParticleGuide(guide));
    } catch (err) {
      if (!disposed) fill(root, h('div', { class: 'learn-card learn-error', role: 'alert' }, h('p', {}, err.message), button('Back', showMenu)));
    }
  }

  async function buildAnime() {
    const out = await api.animeBuild();
    toast(out.built ? `Built ${out.built} anime scene${out.built === 1 ? '' : 's'}` : out.withoutExamples === 'none-started' ? 'Start some grammar points in Learn first' : out.withoutExamples === 'none-scanned' ? 'Scan your library for grammar examples in the Grammar tab first' : 'No new scenes to build');
    showMenu();
  }

  async function generate() {
    toast('Writing a side quest…');
    const out = await api.aiGenerate();
    toast(out.cached ? 'Replaying a saved side quest' : 'Side quest ready');
    showMenu();
  }

  // The "learn first" lesson that comes before a Genki scene. Finishing it offers the story.
  async function openLesson(id) {
    leaveScreens();
    fill(root, h('p', { class: 'learn-sub' }, 'Loading…'));
    try {
      const data = await api.lesson(id);
      if (disposed) return;
      const scene = lastList?.genki?.find((g) => g.id === id);
      const lead = scene?.cast?.[0];
      teardownPlay = mountLesson(root, ctx, {
        data,
        tutor: lead ? { char: lead.id, color: lead.color ?? undefined } : undefined,
        onExit: showMenu,
        onStory: () => play(id),
      });
    } catch (err) {
      if (!disposed) fill(root, h('div', { class: 'learn-card learn-error', role: 'alert' }, h('h2', {}, 'Could not open this lesson'), h('p', {}, err.message), button('Back', showMenu)));
    }
  }

  async function play(id, { fresh = false } = {}) {
    leaveScreens();
    const seq = screenSeq;
    const stale = () => disposed || seq !== screenSeq;
    fill(root, h('p', { class: 'learn-sub' }, 'Loading…'));
    try {
      const data = await api.open(id);
      if (stale()) return;
      const skins = await api.skins();
      if (stale()) return;
      const pack = pickSkin(skins, ctx.prefs.get('storySkin', null));
      const manifest = pack ? await api.skinManifest(pack) : null;
      if (stale()) return;
      const restore = !fresh && data.save ? await api.load(id) : null;
      if (stale()) return;
      teardownPlay = mountPlayer(root, ctx, { data, manifest, restore, exit: showMenu });
    } catch (err) {
      if (!stale()) fill(root, h('div', { class: 'learn-card learn-error', role: 'alert' }, h('h2', {}, 'Could not open this scene'), h('p', {}, err.message), button('Back', showMenu)));
    }
  }
}

function mountPlayer(host, ctx, { data, manifest, restore, exit }) {
  const api = ctx.api.story;
  const scene = data.scene;
  const introducedNow = restoredIntroductions(restore, scene.items);
  const reportedIntroductions = new Set();
  const pending = new Set();
  const assets = new Map();
  const furigana = ctx.settings?.showFurigana !== false;
  let engine = newEngine(restore);
  let disposed = false;
  let typing = null;
  let auto = false;
  let autoTimer = null;
  let completed = false;
  let tracker = '';
  let overlay = null;
  let translate = translationOn(ctx.prefs.get(TRANSLATE_PREF, null), scene);
  let guide = null;

  const stageBg = h('div', { class: 'story-bg' });
  const sprites = Object.fromEntries(POSITIONS.map((pos) => [pos, h('div', { class: `story-sprite story-sprite-${pos}` })]));
  const textBox = h('div', { class: 'story-textbox', role: 'button', tabindex: 0, 'aria-label': 'Dialogue, press space to continue', onclick: onBoxClick });
  const panel = h('div', { class: 'story-panel' });
  const hud = h('div', { class: 'story-hud' });
  const layer = h('div', { class: 'story-overlay', hidden: true });
  const stage = h('div', { class: 'story-stage' }, stageBg, h('div', { class: 'story-sprites' }, POSITIONS.map((pos) => sprites[pos])), panel, textBox, hud, layer);
  const view = h('div', { class: 'story-play' }, stage);
  stage.dataset.translate = translate ? 'on' : 'off';
  host.replaceChildren(view);

  document.addEventListener('keydown', onKey);
  // Capture phase, so tapping a kanji in the dialogue box opens the lookup instead of advancing.
  stage.addEventListener('click', onKanjiClick, true);
  render();

  const unmount = () => {
    disposed = true;
    stopTyping();
    clearTimeout(autoTimer);
    document.removeEventListener('keydown', onKey);
    view.remove();
  };
  unmount.canLeave = canLeave;
  return unmount;

  function newEngine(snapshot) {
    const skipIntro = Object.entries(data.items).filter(([, s]) => s.state === 'started').map(([id]) => id);
    try {
      return createEngine(scene, { restore: snapshot, skipIntro });
    } catch (err) {
      toast(`${err.message}. Starting from the beginning.`, 'error');
      return createEngine(scene, { skipIntro });
    }
  }

  function render() {
    if (disposed) return;
    stopTyping();
    clearTimeout(autoTimer);
    drawStage();
    drawHud();
    const frame = engine.frame();
    panel.replaceChildren();
    panel.hidden = true;
    textBox.hidden = true;
    if (frame.kind === 'say' || frame.kind === 'awkward') return showLine(frame);
    if (frame.kind === 'intro') return showIntro(frame);
    if (frame.kind === 'end') return showEnd(frame);
    return showChallenge(frame);
  }

  function drawStage() {
    const { bg, cast } = engine.stage();
    const background = resolveBackground(manifest, bg, scene.bgImage);
    stageBg.replaceChildren();
    stageBg.removeAttribute('style');
    if (background.source === 'frame') stageBg.style.backgroundImage = `url("${background.src}")`;
    else if (background.source === 'pack') loadAsset(background, (src) => { stageBg.style.backgroundImage = `url("${src}")`; });
    else {
      stageBg.style.background = backgroundFor(background.bg).css;
      const art = h('div', { class: 'story-bg-art' });
      art.innerHTML = backgroundSvg(background.bg);
      stageBg.append(art);
    }
    const frame = engine.frame();
    for (const pos of POSITIONS) sprites[pos].replaceChildren();
    for (const [char, { expr, pos }] of Object.entries(cast)) {
      const holder = sprites[pos] ?? sprites.center;
      const sprite = h('div', { class: `story-char${frame.who === char ? ' speaking' : ''}`, 'data-char': char });
      const resolved = resolveSprite(manifest, char, expr);
      if (resolved.source === 'pack') {
        const img = h('img', { alt: scene.characters[char]?.name ?? char, draggable: 'false' });
        loadAsset(resolved, (src) => img.setAttribute('src', src));
        sprite.append(img);
      } else {
        sprite.innerHTML = characterSvg(char, expr, scene.characters[char]?.color);
      }
      holder.append(sprite);
    }
  }

  function loadAsset({ pack, path }, apply) {
    const key = `${pack}|${path}`;
    if (!assets.has(key)) assets.set(key, api.skinAsset({ pack, path }));
    assets.get(key).then((src) => { if (!disposed) apply(src); }).catch(() => { assets.delete(key); });
  }

  function drawHud() {
    const progress = engine.progress();
    const pending = pendingLabel(progress.pending);
    fill(
      hud,
      h('span', { class: 'story-title', lang: 'ja' }, scene.title),
      h('span', { class: 'story-progress' }, `${Math.min(progress.index + 1, progress.total)} / ${progress.total}`),
      pending ? h('span', { class: 'story-pending', title: 'Missed challenges come back a few lines later' }, pending) : null,
      tracker ? h('span', { class: 'story-tracker', role: 'status' }, tracker) : null,
      h('span', { class: 'story-hud-spacer' }),
      translateButton(),
      button('Particles', () => openGuide(), 'story-chip', { title: 'Particle guide (P)' }),
      button('Backlog', openBacklog, 'story-chip'),
      button(auto ? 'Auto: on' : 'Auto: off', () => { auto = !auto; render(); }, 'story-chip', { 'aria-pressed': String(auto) }),
      button('Save', () => attempt(save), 'story-chip'),
      button('Load', () => attempt(load), 'story-chip'),
      button('Exit', leave, 'story-chip'),
    );
  }

  function translateButton() {
    return button(translateLabel(translate), toggleTranslate, 'story-chip', { 'aria-pressed': String(translate), title: 'Show English under each line (T)' });
  }

  // English lines are always in the DOM; the stage attribute hides them, so toggling never restarts the
  // typewriter or clears a typed answer.
  function toggleTranslate() {
    translate = !translate;
    ctx.prefs.set(TRANSLATE_PREF, translate);
    stage.dataset.translate = translate ? 'on' : 'off';
    drawHud();
    if (overlay === 'backlog') openBacklog();
  }

  function englishNode(en, props = {}) {
    return en ? h('p', { class: 'story-en', lang: 'en', ...props }, en) : null;
  }

  function showLine(frame) {
    textBox.hidden = false;
    const plate = frame.name ? h('div', { class: 'story-plate', style: scene.characters[frame.who]?.color ? `border-color:${scene.characters[frame.who].color}` : null }, frame.name) : null;
    const body = h('p', { class: 'story-line', lang: 'ja' });
    const english = englishNode(frame.en, { hidden: true });
    const explain = frame.explain ? h('p', { class: 'story-explain', hidden: true }, frame.explain) : null;
    textBox.replaceChildren(...[plate, body, english, explain, h('span', { class: 'story-next', 'aria-hidden': 'true' }, doodle('down'))].filter(Boolean));
    const started = performance.now();
    let done = false;
    const tick = () => {
      if (disposed) return;
      const count = visibleCount(frame.text, performance.now() - started);
      body.textContent = sliceText(frame.text, count);
      if (isComplete(frame.text, count)) return finish();
      typing = requestAnimationFrame(tick);
    };
    const finish = () => {
      if (done) return;
      done = true;
      stopTyping();
      textBox.dataset.done = 'true';
      body.replaceChildren(...jaNodes(frame.text));
      if (furigana) rubyNode(ctx.api.learn, frame.text, { furigana }).then((node) => { if (!disposed && textBox.dataset.done === 'true') body.replaceChildren(...kanjify(node).childNodes); });
      if (english) english.hidden = false;
      if (explain) explain.hidden = false;
      if (auto) autoTimer = setTimeout(next, autoDelay(frame.text));
    };
    textBox.dataset.done = 'false';
    textBox.finish = finish;
    tick();
  }

  function showIntro(frame) {
    const model = introModel(frame.item, data.items[frame.item] ?? { state: 'untracked', label: frame.item.slice(2), meaning: '' });
    panel.hidden = false;
    panel.replaceChildren(
      h('div', { class: 'story-card-intro' },
        h('span', { class: 'story-level' }, model.kind === 'grammar' ? 'New grammar' : 'New kanji'),
        h('h2', { lang: 'ja' }, model.label),
        model.reading ? h('p', { class: 'story-reading', lang: 'ja' }, model.reading) : null,
        h('p', {}, model.meaning),
        model.note ? h('p', { class: 'learn-sub' }, model.note) : null,
        h('p', { class: 'story-foot' }, model.footnote),
        button(model.action, () => attempt(async () => {
          if (data.items[frame.item]?.state === 'new') {
            const out = await api.learn(frame.item);
            if (out.started) {
              introducedNow.add(frame.item);
              data.items[frame.item].state = 'started';
            }
          }
          engine.advance();
          render();
        }), 'story-btn primary'),
      ),
    );
    panel.querySelector('button')?.focus();
  }

  function showChallenge(frame) {
    const { beat } = frame;
    panel.hidden = false;
    const recap = frame.recap
      ? h('div', { class: 'story-recap' },
        h('span', { class: 'story-level' }, 'Once more'),
        h('p', { lang: 'ja' }, frame.recap.name ? h('strong', {}, `${frame.recap.name}  `) : null, ...jaNodes(frame.recap.text)),
        englishNode(frame.recap.en))
      : null;
    const prompt = h('div', { class: 'story-prompt' }, recap, frame.name ? h('span', { class: 'story-plate' }, frame.name) : null, beat.prompt ? h('p', { lang: 'en' }, beat.prompt) : null);
    const feedback = h('p', { class: 'story-feedback', role: 'status', 'aria-live': 'polite' }, frame.peeked ? PEEKED_NOTE : frame.requeued ? 'You missed this one earlier.' : frame.attempts > 0 ? 'Try again.' : '');
    if (beat.type === 'reading') {
      const display = h('p', { class: 'story-display', lang: 'ja' }, ...displayParts(beat));
      const input = h('input', { class: 'story-input', type: 'text', lang: 'ja', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Type the reading', 'aria-label': 'Reading in kana',
        oninput: (event) => { event.target.value = typedKana(event.target.value); },
        onkeydown: (event) => {
          if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.stopPropagation();
          submit(typedKana(input.value, { final: true }), feedback);
        } });
      panel.replaceChildren(prompt, display, input, feedback, button('Decode', () => submit(typedKana(input.value, { final: true }), feedback), 'story-btn primary'));
      input.focus();
      return;
    }
    if (beat.type === 'particle') {
      const parts = particleParts(beat.text);
      fill(
        panel,
        prompt,
        h('p', { class: 'story-display story-particle', lang: 'ja' }, ...jaNodes(parts.before), h('span', { class: 'story-gap', 'aria-label': 'missing particle' }, '？'), ...jaNodes(parts.after)),
        englishNode(beat.en),
        h('div', { class: 'story-options story-options-row' }, beat.options.map((text, index) => h('button', { type: 'button', class: 'story-option', lang: 'ja', onclick: () => submit(index, feedback) }, h('kbd', {}, String(index + 1)), ' ', text))),
        h('div', { class: 'story-card-actions' }, button('Particle guide', () => openGuide(beat.answers[0]), 'story-chip')),
        feedback,
      );
      panel.querySelector('.story-option')?.focus();
      return;
    }
    const options = beat.type === 'choice' ? beat.options.map((o) => o.text) : beat.options;
    fill(
      panel,
      prompt,
      beat.display ? h('p', { class: 'story-display', lang: 'ja' }, ...jaNodes(beat.display)) : null,
      h('div', { class: 'story-options' }, options.map((text, index) => h('button', { type: 'button', class: 'story-option', lang: beat.type === 'choice' ? 'ja' : 'en', onclick: () => submit(index, feedback) }, h('kbd', {}, String(index + 1)), ' ', text))),
      feedback,
    );
    panel.querySelector('button')?.focus();
  }

  function displayParts(beat) {
    if (!beat.target) return jaNodes(beat.display);
    const at = beat.display.indexOf(beat.target);
    return [...jaNodes(beat.display.slice(0, at)), h('mark', {}, ...jaNodes(beat.target)), ...jaNodes(beat.display.slice(at + beat.target.length))];
  }

  function submit(value, feedback) {
    const out = engine.answer(value);
    if (out.result === 'invalid') {
      feedback.textContent = out.hint ?? 'Give an answer first.';
      return;
    }
    flushReports();
    render();
  }

  function flushReports() {
    for (const report of engine.takeReports()) {
      const task = api.report({ item: report.item, incorrectCount: report.incorrectCount, introducedNow: introducedNow.has(report.item) })
        .then((response) => {
          tracker = reportLine(report.item, response);
          if (!disposed) drawHud();
        })
        .catch((err) => toast(err.message, 'error'))
        .finally(() => pending.delete(task));
      if (introducedNow.delete(report.item)) reportedIntroductions.add(report.item);
      pending.add(task);
    }
  }

  async function showEnd(frame) {
    textBox.hidden = true;
    panel.hidden = false;
    const summary = endSummary(frame.summary);
    panel.replaceChildren(h('p', { class: 'learn-sub' }, 'Saving your results…'));
    await Promise.allSettled([...pending]);
    if (disposed) return;
    if (!completed) {
      completed = true;
      try {
        await api.complete({ id: scene.id, accuracy: frame.summary.accuracy, affection: frame.summary.affection, gallery: frame.summary.gallery });
      } catch (err) {
        toast(err.message, 'error');
      }
    }
    if (disposed) return;
    panel.replaceChildren(
      h('div', { class: 'story-card-intro story-end' },
        h('span', { class: 'story-level' }, 'Completed'),
        h('h2', {}, summary.heading),
        h('p', {}, summary.line),
        summary.revisited ? h('p', { class: 'story-foot' }, `${summary.revisited} challenge${summary.revisited === 1 ? '' : 's'} came back until you got ${summary.revisited === 1 ? 'it' : 'them'} right.`) : null,
        summary.affection.map(([char, delta]) => h('p', { class: 'story-foot' }, `${scene.characters[char]?.name ?? char}  ${delta > 0 ? '+' : ''}${delta}`)),
        summary.gallery.map((g) => h('p', { class: 'story-foot' }, `Unlocked: ${g.title}`)),
        h('div', { class: 'story-card-actions' }, button('Replay', () => { completed = false; engine = newEngine(null); tracker = ''; render(); }), button('Back to Story', exit, 'story-btn primary')),
      ),
    );
  }

  function next() {
    if (overlay) return;
    const frame = engine.frame();
    if (frame.kind !== 'say' && frame.kind !== 'awkward') return;
    engine.advance();
    render();
  }

  function onBoxClick() {
    if (textBox.dataset.done === 'false') textBox.finish?.();
    else next();
  }

  function onKey(event) {
    if (disposed || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      if (overlay) closeOverlay();
      else leave();
      return;
    }
    if (event.target?.closest?.('input, textarea, select')) return;
    if (event.key === ' ' || event.key === 'Enter') {
      if (overlay || event.target?.closest?.('button')) return;
      event.preventDefault();
      if (!textBox.hidden) onBoxClick();
    } else if (event.key.toLowerCase() === 'b') {
      openBacklog();
    } else if (event.key.toLowerCase() === 't') {
      toggleTranslate();
    } else if (event.key.toLowerCase() === 'p') {
      if (overlay === 'guide') closeOverlay();
      else openGuide();
    } else if (/^[1-4]$/.test(event.key)) {
      if (overlay) return;
      panel.querySelectorAll('.story-option')[Number(event.key) - 1]?.click();
    }
  }

  function stopTyping() {
    if (typing) cancelAnimationFrame(typing);
    typing = null;
  }

  function openBacklog() {
    overlay = 'backlog';
    layer.hidden = false;
    layer.replaceChildren(
      h('div', { class: 'story-backlog', role: 'dialog', 'aria-label': 'Backlog' },
        h('header', {}, h('h2', {}, 'Backlog'), h('div', { class: 'story-card-actions' }, translateButton(), button('Close', closeOverlay, 'story-chip'))),
        h('ol', {}, backlogRows(engine.backlog(), translate).map((e) => h('li', { class: e.bridge ? 'story-bridge' : null }, e.name ? h('strong', {}, `${e.name}  `) : null, h('span', { lang: 'ja' }, ...jaNodes(e.text)), e.en ? h('small', { lang: 'en' }, e.en) : null, e.explain ? h('small', { class: 'story-explain' }, e.explain) : null))),
      ),
    );
    layer.querySelector('ol')?.lastElementChild?.scrollIntoView?.();
  }

  async function openGuide(answer = null) {
    overlay = 'guide';
    layer.hidden = false;
    if (!guide) {
      layer.replaceChildren(h('div', { class: 'story-guide' }, h('p', { class: 'learn-sub' }, 'Loading…')));
      try {
        guide = await api.particles();
      } catch (err) {
        toast(err.message, 'error');
        return closeOverlay();
      }
    }
    if (disposed || overlay !== 'guide') return;
    layer.replaceChildren(renderParticleGuide(guide, { focus: answer ? guideFocus(guide, answer) : null, onClose: closeOverlay }));
  }

  function onKanjiClick(event) {
    const target = event.target?.closest?.('.story-k');
    if (!target || !stage.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    openKanji(target.textContent);
  }

  // A kanji the open challenge is testing asks first: looking it up counts as a miss for that challenge.
  function openKanji(char) {
    const tested = engine.isTested(char);
    if (tested && !engine.frame().peeked) {
      overlay = 'kanji';
      layer.hidden = false;
      layer.replaceChildren(renderPeekConfirm(char, {
        onCancel: closeOverlay,
        onConfirm: () => {
          engine.peek(char);
          const note = panel.querySelector('.story-feedback');
          if (note) note.textContent = PEEKED_NOTE;
          showKanji(char, true);
        },
      }));
      layer.querySelector('.story-btn')?.focus();
      return;
    }
    showKanji(char, tested);
  }

  async function showKanji(char, tested) {
    overlay = 'kanji';
    layer.hidden = false;
    layer.replaceChildren(h('div', { class: 'story-kanji-card' }, h('p', { class: 'learn-sub' }, 'Looking up…')));
    let detail;
    try {
      detail = await api.kanji({ char, scene: scene.id });
    } catch (err) {
      toast(err.message, 'error');
      return closeOverlay();
    }
    if (disposed || overlay !== 'kanji') return;
    const model = kanjiCard(detail, { tested });
    layer.replaceChildren(renderKanjiCard(model, {
      onClose: closeOverlay,
      onLearn: () => attempt(async () => {
        const out = await api.learn(detail.item.id);
        if (out.started && data.items[detail.item.id]) data.items[detail.item.id].state = 'started';
        toast(out.started ? `${char} added to your reviews` : `${char} could not be started yet`);
        showKanji(char, tested);
      }),
      onDownload: () => attempt(async () => {
        toast('Downloading the kanji dictionary…');
        await ctx.api.vocab.downloadKanjidic();
        showKanji(char, tested);
      }),
    }));
    layer.querySelector('button')?.focus();
  }

  function closeOverlay() {
    overlay = null;
    layer.hidden = true;
    layer.replaceChildren();
  }

  async function save() {
    await api.save({ id: scene.id, snapshot: snapshotWithIntroductions(engine.snapshot(), introducedNow) });
    toast('Saved');
  }

  async function load() {
    const snapshot = await api.load(scene.id);
    if (!snapshot) return toast('No save for this scene yet');
    engine = newEngine(snapshot);
    mergeIntroductions(introducedNow, snapshot, scene.items, reportedIntroductions);
    completed = false;
    render();
  }

  function canLeave() {
    return engine.isFinished() || window.confirm('Leave this scene? Unsaved progress is lost. Answers already reported to your reviews are kept.');
  }

  function leave() {
    if (canLeave()) exit();
  }
}
