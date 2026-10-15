import { h } from '../lib/ui.mjs';
const paths = {
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  check: '<path d="M5 12l4 4L19 6"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zM17 8a7 7 0 010 8M20 5a11 11 0 010 14"/>',
  spark: '<path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  book: '<path d="M4 5h6a3 3 0 013 3v13a4 4 0 00-4-3H4zM20 5h-4a3 3 0 00-3 3v13a4 4 0 014-3h3z"/>',
  play: '<path d="M9 5l10 7-10 7z"/>',
};
export function icon(name) {
  const el = h('span', { class:'learn-icon', 'aria-hidden':'true' });
  // Only static, authored SVG is inserted here. Never accepts study content.
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? paths.spark}</svg>`;
  return el;
}
