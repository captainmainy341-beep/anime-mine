import { h } from './ui.mjs';

// Hand-drawn line icons. Slightly off-true curves on purpose, so nothing reads as a stock glyph or an emoji.
// Static authored SVG only; this module never takes study content.
const paths = {
  play: '<path d="M7.6 4.8C10.2 6.4 15.6 10 18.6 12.1C15.5 14.2 10.2 17.6 7.4 19.3C7.2 14.6 7.7 9.4 7.6 4.8Z"/>',
  check: '<path d="M4.6 12.6C6.4 14.1 7.8 15.6 9.2 17.4C12.4 12.6 15.8 8.6 19.6 5.6"/>',
  close: '<path d="M5.5 5.2C9 8.8 14.6 14.8 18.6 18.9M18.4 5.4C14.8 9 9.4 14.4 5.3 18.6"/>',
  lock: '<path d="M6 11L18.2 10.8L18 19.6L6.2 19.8Z"/><path d="M8.4 11C8 7 9.4 4.6 12 4.6C14.6 4.6 16 7 15.6 10.8"/><path d="M12 14.4V16.6"/>',
  book: '<path d="M4 5.2C6.4 4.8 9.8 4.6 12 7.4V20C9.6 18.2 6.6 18.2 4.2 18.6Z"/><path d="M20 5.2C17.6 4.8 14.2 4.6 12 7.4V20C14.4 18.2 17.4 18.2 19.8 18.6Z"/>',
  image: '<path d="M4 5.6L20 5.2L20.2 18.6L4.2 19Z"/><path d="M5 16.6L9.4 11.4L12.6 15L15 12.4L19.4 17"/><path d="M8.2 9.2C8.2 8.4 9.6 8.4 9.6 9.2C9.6 10 8.2 10 8.2 9.2Z"/>',
  bolt: '<path d="M13.4 3.6L6.4 13.2L11.6 13.4L10.4 20.6L17.6 10.6L12.4 10.4Z"/>',
  flame: '<path d="M12.4 3.4C13.4 7 17.4 9 17.2 13.8C17 17.6 14.6 20.4 11.8 20.4C8.4 20.4 6.6 17.8 6.8 14.8C7 12.4 8.4 11.4 9.6 9.8C10.4 11.2 10.8 11.8 11.6 12.4C12.4 9.8 12.6 6.6 12.4 3.4Z"/>',
  sound: '<path d="M4 9.2L8 9L13 5V19L8 15L4.2 14.8Z"/><path d="M16.6 8.4C18 10.2 18 13.8 16.6 15.6"/><path d="M19.4 5.6C22 9 22 15 19.4 18.4"/>',
  spark: '<path d="M12 3.4C12.6 8.4 15.6 11.4 20.6 12C15.6 12.6 12.6 15.6 12 20.6C11.4 15.6 8.4 12.6 3.4 12C8.4 11.4 11.4 8.4 12 3.4Z"/>',
  bulb: '<path d="M9 17.6H15M10 20.4H14"/><path d="M12 3.6C8.4 3.6 6.4 6.2 6.6 9C6.8 11.4 8.6 12.6 9.2 14.6L9.4 17M12 3.6C15.6 3.6 17.6 6.2 17.4 9C17.2 11.4 15.4 12.6 14.8 14.6L14.6 17"/>',
  warn: '<path d="M12 4.2L21 19.6L3.2 19.4Z"/><path d="M12 10V14.4M12 16.8V17.2"/>',
  info: '<path d="M12 3.6C16.8 3.4 20.6 7 20.4 12C20.2 16.8 16.6 20.6 11.8 20.4C7 20.2 3.4 16.6 3.6 11.8C3.8 7.2 7.4 3.8 12 3.6Z"/><path d="M12 10.8V16M12 7.6V8"/>',
  back: '<path d="M19.6 12.2C15 11.8 9 12.4 4.8 12M10 6.6C8 8.6 6.6 10.2 4.6 12C6.6 13.8 8.2 15.4 10 17.6"/>',
  next: '<path d="M4.4 12.2C9 11.8 15 12.4 19.2 12M14 6.6C16 8.6 17.4 10.2 19.4 12C17.4 13.8 15.8 15.4 14 17.6"/>',
  replay: '<path d="M5.4 12.6C5.2 8.2 8.6 5.2 12.4 5.2C16.4 5.2 19.2 8.4 19 12.2C18.8 16 15.8 18.8 12 18.8C9.4 18.8 7.4 17.6 6.2 15.6"/><path d="M5.2 7L5.4 12.6L10.6 12"/>',
  plus: '<path d="M12 5C12.2 9 11.8 14 12 19M5 12.2C9 11.8 15 12.4 19 12"/>',
  down: '<path d="M6 9.6C8.6 12 10.4 14 12 15.8C13.8 14 15.6 12 18 9.4"/>',
  right: '<path d="M9.6 6C12 8.6 14 10.4 15.8 12C14 13.8 12 15.6 9.4 18"/>',
  up: '<path d="M6 14.4C8.6 12 10.4 10 12 8.2C13.8 10 15.6 12 18 14.6"/>',
  mine: '<path d="M4.6 19.6L15 9.2"/><path d="M7.6 7.4C11 4.8 16.4 5.4 19.4 9.2"/><path d="M7.6 7.4C9.6 7.6 12 8.6 13.4 10.6"/><path d="M19.4 9.2C19.2 11.4 18.2 13 16.6 14.2"/>',
};

export function doodle(name, props = {}) {
  const el = h('span', { class: `doodle doodle-${name}`, 'aria-hidden': 'true', ...props });
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths[name] ?? paths.spark}</svg>`;
  return el;
}

// An icon followed by a label, for buttons and callouts. Returns an array h() flattens into children.
export const withIcon = (name, label) => [doodle(name), label ? ` ${label}` : ''];

export const iconNames = Object.keys(paths);
