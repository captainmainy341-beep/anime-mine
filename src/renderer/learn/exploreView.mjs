// STUB - owned by slice S2 (see docs/manga-ink-contracts.md). Signature is frozen.
import { h } from '../lib/ui.mjs';
export function mountExplore(el, props) {
  const root = h('section', { class: 'ink-screen ink-explore' }, props?.title ?? '');
  el.append(root);
  return { update() {}, destroy() { root.remove(); } };
}
