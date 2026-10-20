// STUB - owned by slice S9 (see docs/manga-ink-contracts.md). Signatures are frozen.
import { h } from '../lib/ui.mjs';
export function ratingBar(buttons, onGrade) {
  return h('div', { class: 'ink-rating' }, (buttons ?? []).map((b) => h('button', { type: 'button', class: `ink-rate ink-rate-${b.label.toLowerCase()}`, 'data-ease': String(b.ease), onclick: () => onGrade?.(b.ease) }, b.label)));
}
export function createStudyCardView({ onReveal, onGrade, onReplay } = {}) {
  const el = h('section', { class: 'ink-study' });
  return { el, update() {}, destroy() { el.remove(); } };
}
