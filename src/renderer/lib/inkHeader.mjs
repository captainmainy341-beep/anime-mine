import { h } from './ui.mjs';

// The black "manga panel" header from the Manga Ink frames: speed lines, a Dela Gothic title on an ink plate,
// and a paper plate on the right with a caps label and a red progress track. Shared by Explore, Player and Anki.

export function inkPercent(value, max) {
  const v = Number(value), m = Number(max);
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return 0;
  return Math.max(0, Math.min(100, (v / m) * 100));
}

// opts: { title, label = '', value = 0, max = 0, compact = false }
// compact = the 84px Player header (40px title); otherwise 110px tall (title size via --ink-hero-title, 44px default).
export function inkHeader(opts = {}) {
  const title = h('h1', { class: 'ink-hero-title' });
  const label = h('span', { class: 'ink-hero-label' });
  const fill = h('i', { class: 'ink-track-fill' });
  const track = h('span', { class: 'ink-track', role: 'progressbar', 'aria-valuemin': '0' }, fill);
  const plate = h('div', { class: 'ink-hero-plate' }, label, track);
  const el = h('header', { class: `ink-hero${opts.compact ? ' ink-hero-compact' : ''}` },
    h('div', { class: 'ink-hero-titleplate' }, title), plate);
  el._ink = { title, label, fill, track, plate };
  setInkHeader(el, opts);
  return el;
}

// Patch any of { title, label, value, max } on a header made by inkHeader().
export function setInkHeader(el, { title, label, value, max } = {}) {
  const parts = el?._ink;
  if (!parts) return;
  if (title != null) parts.title.textContent = String(title);
  if (label != null) {
    parts.label.textContent = String(label);
    parts.track.setAttribute('aria-label', String(label));
  }
  if (value != null || max != null) {
    const v = value ?? Number(parts.track.getAttribute('aria-valuenow') ?? 0);
    const m = max ?? Number(parts.track.getAttribute('aria-valuemax') ?? 0);
    parts.track.setAttribute('aria-valuenow', String(v));
    parts.track.setAttribute('aria-valuemax', String(m));
    parts.fill.style.width = `${inkPercent(v, m)}%`;
  }
  parts.plate.hidden = !parts.label.textContent && !Number(parts.track.getAttribute('aria-valuemax'));
}
