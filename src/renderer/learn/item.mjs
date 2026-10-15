import { attempt, fill, h, toast } from '../lib/ui.mjs';
import { formatDue, groupLabel, kindLabel } from '../lib/learnView.mjs';
import { renderCard } from './cardView.mjs';

const UNSTARTED_LABEL = 'Not started';

function scheduleOf(card) {
  return card.kind === 'grammar' ? 'bp' : 'wk';
}

function stageLine(card) {
  if (card.stage === 0) return UNSTARTED_LABEL;
  const group = groupLabel(scheduleOf(card), card.group);
  return `${group} (stage ${card.stage})`;
}

function nextReviewLine(card, now) {
  if (card.stage === 0) return null;
  if (card.nextReview == null) return 'No further reviews';
  return formatDue(card.nextReview, now);
}

function lockedNotice(card) {
  if (!card.locked) return null;
  if (card.components?.length) {
    const names = card.components.map((c) => c.name).join(', ');
    return h('p', { class: 'learn-item-locked' }, `Reach Guru on ${names} to unlock`);
  }
  const text = card.level ? `Unlocks at level ${card.level}.` : 'Locked.';
  return h('p', { class: 'learn-item-locked' }, text);
}

export function mountItem(el, ctx, id) {
  if (id.startsWith('g:')) {
    ctx.go('point', id);
    return () => {};
  }

  let disposed = false;
  let seq = 0;
  const body = h('div', { class: 'learn-item-body' });
  const root = h(
    'section',
    { class: 'page learn-item' },
    h(
      'div',
      { class: 'learn-item-top' },
      h('button', { type: 'button', class: 'learn-item-back', onclick: () => ctx.back() }, 'Back'),
    ),
    body,
  );
  el.append(root);

  load();

  return () => {
    disposed = true;
  };

  async function load() {
    const current = ++seq;
    try {
      const card = await ctx.api.learn.card(id);
      if (disposed || current !== seq) return;
      render(card);
    } catch (err) {
      if (disposed || current !== seq) return;
      fill(body, h('p', { class: 'learn-item-error' }, err.message));
    }
  }

  function render(card) {
    seq++;
    const now = Date.now();
    const next = nextReviewLine(card, now);
    const srs = h(
      'section',
      { class: 'learn-item-srs' },
      h('div', { class: 'learn-item-kind' }, kindLabel(card.kind)),
      h('div', { class: 'learn-item-stage' }, stageLine(card)),
      next ? h('div', { class: 'learn-item-next' }, `Next review ${next}`) : null,
      lockedNotice(card),
      card.group?.key === 'burned' ? h('button', { type: 'button', class: 'learn-item-btn', onclick: () => resurrect(card) }, 'Resurrect') : null,
      card.stage === 0 && !card.locked
        ? h('button', { type: 'button', class: 'learn-item-btn learn-item-primary', onclick: () => learnNow(card) }, 'Learn this now')
        : null,
    );
    fill(body, srs, renderCard(card, ctx, { onChange: render }));
  }

  function learnNow(card) {
    ctx.go('session', { mode: 'lesson', scope: 'kanji', ids: [card.id] });
  }

  function resurrect(card) {
    attempt(async () => {
      const updated = await ctx.api.learn.resurrect(card.id);
      toast('Resurrected', 'info');
      render(updated);
    });
  }
}
