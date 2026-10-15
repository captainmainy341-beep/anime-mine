import { fill, h, toast } from '../lib/ui.mjs';
import { createSession } from '../lib/session.mjs';
import { clozeParts, formatDue, percent } from '../lib/learnView.mjs';
import { renderCard } from './cardView.mjs';
import { clozeNode, rubyNode } from './ruby.mjs';
import { canSpeak } from './speak.mjs';
import { icon } from './icons.mjs';
import { checkAnswer, normaliseInput, outcomeOf, promptModel, revealAnswers } from './sessionModel.mjs';

const LIGHTNING_DELAY_MS = 600;
const EXIT_MESSAGE = 'Leave this session? Answers already submitted are kept.';

export function mountSession(el, ctx, opts) {
  let disposed = false;
  let timer = null;
  let keyHandler = null;
  const root = h('section', { class: 'learn-s-screen' });
  el.append(root);

  const onKey = (e) => keyHandler?.(e);
  document.addEventListener('keydown', onKey);
  start();

  return () => {
    disposed = true;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    root.remove();
  };

  function start() {
    keyHandler = null;
    fill(root, loadingScreen());
    load().catch((err) => {
      if (!disposed) fill(root, messageScreen('Could not load this session', err.message, [homeButton()]));
    });
  }

  function load() {
    if (opts.mode === 'lesson') return startLesson();
    if (opts.mode === 'cram') return startCram();
    return startReview();
  }

  function exit() {
    if (window.confirm(EXIT_MESSAGE)) ctx.back();
  }

  async function startReview() {
    const cards = await ctx.api.learn.reviews({ scope: opts.scope });
    if (disposed) return;
    if (!cards.length) return showNothingDue();
    runQuiz(cards, { submit: true });
  }

  async function startCram() {
    const cards = await ctx.api.learn.cram({ source: opts.source, value: opts.value });
    if (disposed) return;
    if (!cards.length) {
      fill(root, messageScreen('Nothing to practise yet', 'Learn some items first and they can be practised here.', [homeButton()]));
      return;
    }
    runQuiz(cards, { submit: false });
  }

  async function startLesson() {
    const cards = await ctx.api.learn.lessons({ scope: opts.scope, jlpt: opts.jlpt, ids: opts.ids });
    if (disposed) return;
    if (!cards.length) {
      fill(root, messageScreen('No new items right now', 'Pass more items to Guru to unlock new ones, or you may have reached today\'s lesson limit.', [homeButton()]));
      return;
    }
    showLessonPages(cards);
  }

  function showLessonPages(cards) {
    let index = 0;
    keyHandler = onPageKey;
    render();

    function render() {
      const last = index === cards.length - 1;
      const card = cards[index];
      fill(
        root,
        h(
          'header',
          { class: 'learn-s-head' },
          button('Exit', exit),
          h('span', { class: 'learn-s-stat' }, `${index + 1} of ${cards.length}`),
        ),
        h(
          'div',
          { class: 'learn-s-lesson-page' },
          renderCard(card, ctx, {
            onChange: (updated) => {
              cards[index] = updated;
            },
          }),
        ),
        h(
          'div',
          { class: 'learn-s-footer' },
          h(
            'div',
            { class: 'learn-s-lesson-nav' },
            h('button', { type: 'button', class: 'learn-s-btn', disabled: index === 0, onclick: prev }, 'Previous'),
            last
              ? button('Start quiz', () => startQuiz(cards), true)
              : h('button', { type: 'button', class: 'learn-s-btn learn-s-btn-primary', onclick: next }, 'Next'),
          ),
        ),
      );
    }

    function prev() {
      if (index === 0) return;
      index -= 1;
      render();
    }

    function next() {
      if (index >= cards.length - 1) return;
      index += 1;
      render();
    }

    function onPageKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        exit();
        return;
      }
      if (e.target?.closest?.('input, textarea')) return;
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    }
  }

  function startQuiz(cards) {
    runQuiz(cards, { submit: false, onFinish: () => finishLesson(cards) });
  }

  async function finishLesson(cards) {
    fill(root, loadingScreen());
    try {
      const { started, levelUp } = await ctx.api.learn.completeLessons(cards.map((card) => card.id));
      if (disposed) return;
      showLessonSummary(started.length, levelUp);
    } catch (err) {
      if (disposed) return;
      fill(root, messageScreen('Could not record these lessons', err.message, [button('Retry', () => finishLesson(cards), true), homeButton()]));
    }
  }

  function showLessonSummary(started, levelUp) {
    fill(
      root,
      h(
        'div',
        { class: 'learn-s-body' },
        h('span', { class:'learn-completion-mark', 'aria-hidden':'true' }, icon('check')),
        h('h2', {}, 'Batch complete'),
        h('p', { class: 'learn-s-english' }, `${started} ${started === 1 ? 'item' : 'items'} started`),
        levelUp ? h('p', { class: 'learn-s-hint' }, 'Level up!') : null,
        h(
          'div',
          { class: 'learn-s-lesson-nav' },
          button('Another batch', start, true),
          button('Start reviews', () => {
            ctx.back();
            ctx.go('session', { mode: 'review', scope: 'all' });
          }),
          homeButton(),
        ),
      ),
    );
  }

  async function showNothingDue() {
    const { reviews } = await ctx.api.learn.dashboard();
    if (disposed) return;
    const when = reviews.nextAt == null
      ? 'No reviews are scheduled yet.'
      : `Next review ${formatDue(reviews.nextAt, Date.now())}.`;
    fill(root, messageScreen('Nothing due', when, [homeButton()]));
  }

  function runQuiz(cards, { submit, onFinish = showSummary }) {
    const session = createSession({ cards });
    const byId = new Map(cards.map((card) => [card.id, card]));
    const missed = new Map();
    const submitted = [];
    const pendingSaves = [];
    const failed = [];
    let state = null;

    keyHandler = onQuizKey;
    showNext();

    function showNext() {
      clearTimeout(timer);
      const current = session.current();
      if (!current) return finish();
      state = {
        current,
        model: promptModel(current.card, current.question),
        outcome: null,
        input: null,
        feedback: null,
        promptSlot: null,
        controls: null,
        infoSlot: null,
        infoOpen: false,
      };
      renderQuestion();
    }

    function renderQuestion() {
      const { model } = state;
      state.input = h('input', {
        class: 'learn-s-input',
        type: 'text',
        lang: model.lang,
        placeholder: model.placeholder,
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        'aria-label': model.label,
        oninput: onInput,
        onkeydown: onInputKey,
      });
      state.feedback = h('p', { class: 'learn-s-hint', role: 'status', 'aria-live': 'polite' });
      state.promptSlot = h('div', { class: 'learn-s-prompt' });
      state.controls = h('div', { class: 'learn-s-lesson-nav' });
      state.infoSlot = h('div', { class: 'learn-s-info-slot' });
      fill(
        root,
        header(),
        h(
          'div',
          { class: 'learn-s-body' },
          h('div', { class: `learn-s-strip learn-s-strip-${model.tone}` }, model.label),
          state.promptSlot,
          state.input,
          state.feedback,
          state.controls,
          state.infoSlot,
        ),
        footer(),
      );
      refreshPrompt();
      refreshControls();
      state.input.focus();
    }

    function refreshPrompt() {
      const { card } = state.current;
      const { model, outcome } = state;
      const revealed = outcome !== null;
      if (model.cloze) {
        const showEnglish = revealed || ctx.settings?.showEnglish !== false;
        fill(
          state.promptSlot,
          clozeSlot(card, revealed),
          showEnglish ? h('p', { class: 'learn-s-english' }, model.clozeEnglish) : null,
          model.hint ? h('p', { class: 'learn-s-english' }, model.hint) : null,
        );
        return;
      }
      fill(state.promptSlot, h('div', { class: 'learn-s-glyph', lang: 'ja' }, model.glyph));
    }

    function clozeSlot(card, revealed) {
      const slot = h('div', { class: 'learn-s-cloze', lang: 'ja' }, clozeNode(card.cloze.ja, { revealed }));
      if (ctx.settings?.showFurigana) withFurigana(ctx.api.learn, slot, card.cloze.ja, revealed);
      return slot;
    }

    function refreshControls() {
      const { model, outcome } = state;
      const buttons = [];
      if (model.speakText && canSpeak()) buttons.push(button('Speak', () => ctx.speak(model.speakText)));
      if (outcome !== null) buttons.push(button('Info', toggleInfo));
      if (outcome === 'incorrect') buttons.push(button('I was right', overrideLast));
      if (outcome !== null) buttons.push(button('Next', advance, true));
      fill(state.controls, buttons);
    }

    function setInfo(open) {
      state.infoOpen = open;
      fill(state.infoSlot, open ? h('div', { class: 'learn-s-info' }, renderCard(state.current.card, ctx, { compact: true })) : null);
    }

    function toggleInfo() {
      if (state.outcome === null) return;
      setInfo(!state.infoOpen);
    }

    function onInput() {
      if (!state.model.convertsRomaji) return;
      const { input } = state;
      input.value = normaliseInput(state.current.question, input.value);
      input.setSelectionRange(input.value.length, input.value.length);
    }

    function onInputKey(e) {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      if (state.outcome !== null) advance();
      else check();
    }

    function check() {
      const { card, question } = state.current;
      const value = normaliseInput(question, state.input.value, { final: true });
      state.input.value = value;
      const verdict = checkAnswer(question, value, card);
      const outcome = outcomeOf(verdict.result);
      if (outcome === 'invalid') {
        fill(state.feedback, verdict.hint ?? 'Try again');
        shake();
        return;
      }
      answer(outcome, verdict.hint);
    }

    function answer(outcome, hint) {
      const { card, question } = state.current;
      const settled = session.answer(outcome);
      state.outcome = outcome;
      state.input.readOnly = true;
      state.input.classList.add(`learn-s-input-${outcome}`);
      if (outcome === 'incorrect') {
        missed.set(card.id, revealAnswers(question, card));
        fill(state.feedback, [hint, `Answer: ${revealAnswers(question, card).join(' / ')}`].filter(Boolean).join(' · '));
        setInfo(true);
      } else {
        fill(state.feedback, 'Correct');
      }
      if (settled.itemDone) recordDone(settled.itemId, settled.incorrectCount);
      refreshPrompt();
      refreshControls();
      if (ctx.prefs.get('autoSpeak', false)) ctx.speak(state.model.speakText);
      if (outcome === 'correct' && ctx.prefs.get('lightningMode', false)) {
        timer = setTimeout(advance, LIGHTNING_DELAY_MS);
      }
    }

    function overrideLast() {
      if (state.outcome !== 'incorrect') return;
      const settled = session.overrideLast();
      state.outcome = 'correct';
      state.input.classList.replace('learn-s-input-incorrect', 'learn-s-input-correct');
      fill(state.feedback, 'Marked as correct');
      if (settled.itemDone) recordDone(settled.itemId, settled.incorrectCount);
      setInfo(false);
      refreshPrompt();
      refreshControls();
    }

    function advance() {
      clearTimeout(timer);
      if (state.outcome === null) return;
      showNext();
    }

    function shake() {
      const { input } = state;
      input.classList.remove('learn-s-input-shake');
      void input.offsetWidth;
      input.classList.add('learn-s-input-shake');
    }

    function recordDone(id, incorrectCount) {
      if (submit) pendingSaves.push(saveResult(id, incorrectCount));
    }

    async function saveResult(id, incorrectCount) {
      try {
        const saved = await ctx.api.learn.submit({ id, incorrectCount });
        submitted.push({ ...saved, incorrectCount });
      } catch (err) {
        failed.push({ id, incorrectCount });
        toast(`Could not save ${byId.get(id)?.char ?? id}: ${err.message}`, 'error');
      }
    }

    async function finish() {
      keyHandler = null;
      clearTimeout(timer);
      fill(root, loadingScreen());
      await Promise.all(pendingSaves.splice(0));
      if (submit && failed.length) {
        const retry = failed.splice(0);
        await Promise.all(retry.map((item) => saveResult(item.id, item.incorrectCount)));
      }
      if (disposed) return;
      onFinish({ session, byId, missed, submitted, unsaved: failed.length, submit });
    }

    function onQuizKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        exit();
        return;
      }
      if (!state) return;
      const modified = e.ctrlKey || e.metaKey;
      if (modified && e.key.toLowerCase() === 'z' && state.outcome === 'incorrect') {
        e.preventDefault();
        overrideLast();
        return;
      }
      if (!modified && (e.key === 'f' || e.key === 'F')) toggleInfo();
    }

    function header() {
      const p = session.progress();
      const bar = h('div', { class: 'learn-s-progress-bar' });
      bar.style.width = `${percent(p.itemsDone, p.itemsTotal)}%`;
      return h(
        'header',
        { class: 'learn-s-head' },
        button('Exit', exit),
        h('div', { class: 'learn-s-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': p.itemsTotal, 'aria-valuenow': p.itemsDone }, bar),
        h('span', { class: 'learn-s-stat' }, p.accuracy == null ? 'Accuracy —' : `Accuracy ${Math.round(p.accuracy * 100)}%`),
        h('span', { class: 'learn-s-stat' }, `${p.itemsTotal - p.itemsDone} left`),
      );
    }
  }

  async function showSummary({ session, byId, missed, submitted, unsaved, submit }) {
    const p = session.progress();
    const wrong = session.results().filter((r) => r.incorrectCount > 0);
    const stats = [
      `${p.itemsDone} items done`,
      p.accuracy == null ? 'Accuracy —' : `Accuracy ${Math.round(p.accuracy * 100)}%`,
    ];
    if (submit) {
      stats.push(`Level-ups ${submitted.filter((r) => r.levelUp).length}`);
      stats.push(`Burned ${submitted.filter((r) => r.burned).length}`);
    }
    const dashboard = submit ? await ctx.api.learn.dashboard().catch(() => null) : null;
    if (disposed) return;
    const moreDue = (dashboard?.reviews.due ?? 0) > 0;
    fill(
      root,
      h(
        'div',
        { class: 'learn-s-body' },
        h('span', { class:'learn-completion-mark', 'aria-hidden':'true' }, icon('check')),
        h('h2', {}, 'Session complete'),
        h('p', { class: 'learn-s-english' }, stats.join(' · ')),
        unsaved ? h('p', { class: 'learn-s-hint' }, `${unsaved} results could not be saved.`) : null,
        wrong.length
          ? h('ul', { class: 'learn-s-summary-list' }, wrong.map((r) => wrongRow(r.id, byId.get(r.id), missed.get(r.id))))
          : h('p', { class: 'learn-s-english' }, 'No mistakes.'),
        h('div', { class: 'learn-s-lesson-nav' }, homeButton(), moreDue ? button('Review again', start, true) : null),
      ),
    );
  }

  function wrongRow(id, card, answers = []) {
    const label = card?.char ?? card?.word ?? card?.title ?? id;
    const target = id.startsWith('g:') ? 'point' : 'item';
    return h(
      'li',
      {},
      h('button', { type: 'button', class: 'learn-s-link', onclick: () => ctx.go(target, id) }, `${label} — ${answers.join(' / ')}`),
    );
  }

  function homeButton() {
    return button('Home', () => ctx.back());
  }
}

function button(label, onclick, primary = false) {
  return h('button', { type: 'button', class: primary ? 'learn-s-btn learn-s-btn-primary' : 'learn-s-btn', onclick }, label);
}

function footer() {
  return h(
    'footer',
    { class: 'learn-s-footer' },
    h('span', {}, 'Enter: submit or next'),
    h('span', {}, 'F: info'),
    h('span', {}, 'Ctrl+Z: I was right'),
    h('span', {}, 'Esc: exit'),
  );
}

function loadingScreen() {
  return h('div', { class: 'learn-s-body' }, h('p', { class: 'learn-s-english' }, 'Loading…'));
}

function messageScreen(title, text, actions) {
  return h(
    'div',
    { class: 'learn-s-body' },
    h('h2', {}, title),
    text ? h('p', { class: 'learn-s-english' }, text) : null,
    h('div', { class: 'learn-s-lesson-nav' }, actions),
  );
}

async function withFurigana(api, slot, ja, revealed) {
  const { before, after, answers } = clozeParts(ja);
  const [head, tail] = await Promise.all([rubyNode(api, before), rubyNode(api, after)]);
  if (!slot.isConnected) return;
  fill(slot, head, clozeNode(`{{${answers[0]}}}`, { revealed }), tail);
}
