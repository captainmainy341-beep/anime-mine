// STUB - owned by slice S6 (see docs/manga-ink-contracts.md). Signature is frozen.
import { h } from '../lib/ui.mjs';
export function mountTimeline(el, { onSeek, onOffset } = {}) {
  const root = h('aside', { class: 'ink-timeline' });
  el.append(root);
  return { setCues() {}, setCurrent() {}, setOffset() {}, destroy() { root.remove(); } };
}
