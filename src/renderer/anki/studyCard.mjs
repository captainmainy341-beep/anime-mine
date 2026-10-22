// Manga Ink study card: front/back panels with sandboxed card iframes and the four-key rating bar.
// Layout and classes are frozen in docs/manga-ink-contracts.md ("Anki card"). Presentation only:
// card documents arrive pre-built from lib/studyPresentation.mjs and are never rewritten here.
import { h } from '../lib/ui.mjs';
import { doodle } from '../lib/doodleIcons.mjs';

const slug = (label) => String(label ?? '').toLowerCase().replace(/[^a-z]/g, '');
const easeOf = (button) => {
  const ease = Number(button?.ease);
  return Number.isFinite(ease) ? ease : button?.ease;
};

// div.ink-rating > 4 x button.ink-rate.ink-rate-again|hard|good|easy[data-ease] (kbd, label, interval).
// Only the Good button is black (CSS), matching the clean frame. Disabling is the view's job.
export function ratingBar(buttons, onGrade) {
  const bar = h('div', { class: 'ink-rating' });
  for (const button of buttons ?? []) {
    const ease = easeOf(button);
    const label = String(button?.label ?? '');
    const interval = String(button?.interval ?? '');
    bar.append(h('button', {
      type: 'button',
      class: `ink-rate ink-rate-${slug(label)}`,
      'data-ease': String(ease),
      'aria-label': interval ? `${label} (${ease}), ${interval}` : `${label} (${ease})`,
      onclick: () => onGrade?.(ease),
    },
      h('kbd', { class: 'ink-rate-key' }, String(ease)),
      h('span', { class: 'ink-rate-label' }, label),
      h('span', { class: 'ink-rate-interval' }, interval)));
  }
  return bar;
}

// state = { frontDoc, backDoc, side, buttons, busy, hasAudio, status, tags? }
// update() only touches an iframe's srcdoc when the document itself changed, so a review save
// or a busy flag never reloads the card the reader is looking at.
export function createStudyCardView({ onReveal, onGrade, onReplay } = {}) {
  const frontFrame = h('iframe', { class: 'study-card', sandbox: '', title: 'Front of card', tabindex: '-1' });
  const backFrame = h('iframe', { class: 'study-card', sandbox: '', title: 'Back of card', tabindex: '-1' });
  const replay = h('button', {
    type: 'button', class: 'ink-study-replay', 'aria-label': 'Replay audio', title: 'Replay audio',
    hidden: true, onclick: () => onReplay?.(),
  }, doodle('sound'));
  const tags = h('div', { class: 'ink-study-tags', hidden: true });

  const front = h('div', { class: 'ink-study-front ink-card' },
    h('span', { class: 'ink-tag' }, 'Front · question'),
    h('div', { class: 'ink-study-frame' }, frontFrame),
    h('div', { class: 'ink-study-audio' }, replay),
    tags);

  const reveal = h('button', { type: 'button', class: 'ink-study-reveal', onclick: () => onReveal?.() }, 'Show answer');
  const placeholder = h('div', { class: 'ink-study-placeholder' },
    doodle('book'),
    h('p', { class: 'ink-study-placeholder-line' }, 'Recall the word before you look. The answer stays hidden until you ask for it.'),
    reveal,
    h('p', { class: 'ink-study-placeholder-hint' }, 'Space also shows the answer.'));
  const back = h('div', { class: 'ink-study-back ink-card' },
    h('span', { class: 'ink-tag' }, 'Back · answer'),
    h('div', { class: 'ink-study-frame' }, backFrame, placeholder));

  let bar = ratingBar([], onGrade);
  const status = h('p', { class: 'ink-study-status', role: 'status', 'aria-live': 'polite' });
  const rate = h('div', { class: 'ink-study-rate ink-card' },
    h('div', { class: 'ink-study-rate-head' },
      h('span', { class: 'ink-tag' }, 'How well did you remember it?'),
      h('p', { class: 'ink-study-hint' }, 'Space shows the answer · 1 to 4 rates the card')),
    bar,
    status);

  const el = h('section', { class: 'ink-study' },
    h('div', { class: 'ink-study-cards' }, front, back),
    rate);

  let frontDoc = null;
  let backDoc = null;
  let barKey = '';

  function update(state = {}) {
    const answered = state.side === 'answer';

    if (typeof state.frontDoc === 'string' && state.frontDoc !== frontDoc) {
      frontDoc = state.frontDoc;
      frontFrame.srcdoc = frontDoc;
    }
    if (typeof state.backDoc === 'string' && state.backDoc !== backDoc) {
      backDoc = state.backDoc;
      backFrame.srcdoc = backDoc;
    }

    el.setAttribute('data-side', answered ? 'answer' : 'question');
    placeholder.hidden = answered;
    backFrame.setAttribute('aria-hidden', answered ? 'false' : 'true');

    replay.hidden = !state.hasAudio;

    const chips = Array.isArray(state.tags) ? state.tags.filter((tag) => tag != null && tag !== '') : [];
    tags.hidden = chips.length === 0;
    tags.replaceChildren(...chips.map((tag) => h('span', { class: 'ink-study-tag' }, String(tag))));

    const buttons = Array.isArray(state.buttons) ? state.buttons : [];
    const nextKey = JSON.stringify(buttons.map((b) => [b?.ease, b?.label, b?.interval]));
    if (nextKey !== barKey) {
      barKey = nextKey;
      const next = ratingBar(buttons, onGrade);
      bar.replaceWith(next);
      bar = next;
    }

    const locked = Boolean(state.busy) || !answered;
    for (const button of bar.querySelectorAll('.ink-rate')) button.disabled = locked;
    reveal.disabled = Boolean(state.busy);
    el.setAttribute('aria-busy', String(Boolean(state.busy)));
    status.textContent = state.status == null ? '' : String(state.status);
  }

  function destroy() {
    el.remove();
  }

  update({});
  return { el, update, destroy };
}
