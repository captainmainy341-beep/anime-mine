// Subtitle timeline panel (player right column). DOM classes and API are frozen in docs/manga-ink-contracts.md.
import { doodle } from '../lib/doodleIcons.mjs';
import { formatCueTime, formatOffset, pipState, timelineWindow } from '../lib/subtitleTimeline.mjs';
import { h } from '../lib/ui.mjs';

// Card height (64) + list gap (8), matching player-timeline.css. Used for the red rail fill height.
const ROW_PITCH = 72;

function lineClass(state) {
  if (state === 'current') return 'ink-tl-line is-current';
  if (state === 'past') return 'ink-tl-line is-past';
  return 'ink-tl-line';
}

export function mountTimeline(el, { onSeek, onOffset } = {}) {
  let cues = [];
  let current = -1;
  let offset = 0;
  let rows = [];
  let windowStart = 0;

  const fill = h('div', { class: 'ink-timeline-rail-fill' });
  const rail = h('div', { class: 'ink-timeline-rail', 'aria-hidden': 'true' }, fill);
  const list = h('ol', { class: 'ink-timeline-list', 'aria-label': 'Subtitle lines' });
  const track = h('div', { class: 'ink-timeline-track' }, rail, list);

  const value = h('output', { class: 'ink-tl-value', 'aria-live': 'polite' }, formatOffset(offset));
  const minus = h(
    'button',
    { class: 'ink-tl-minus', type: 'button', 'aria-label': 'Decrease subtitle offset', onclick: () => onOffset?.(-0.1) },
    doodle('minus'),
  );
  const plus = h(
    'button',
    { class: 'ink-tl-plus', type: 'button', 'aria-label': 'Increase subtitle offset', onclick: () => onOffset?.(0.1) },
    doodle('plus'),
  );
  const offsetBlock = h(
    'div',
    { class: 'ink-timeline-offset' },
    h('div', { class: 'ink-tag' }, 'Offset'),
    minus,
    value,
    plus,
  );

  const root = h('aside', { class: 'ink-timeline' }, h('div', { class: 'ink-tag' }, 'Subtitles'), track, offsetBlock);
  el.append(root);

  const cueTime = (index) => formatCueTime((Number(cues[index]?.start) || 0) + offset);

  // Classes and aria only: this runs on every timeupdate where the window does not move.
  function paint() {
    for (const row of rows) {
      const state = pipState(row.index, current);
      row.li.setAttribute('class', lineClass(state));
      if (state === 'current') row.card.setAttribute('aria-current', 'true');
      else row.card.removeAttribute('aria-current');
    }
    const step = current >= 0 && rows.length ? Math.min(Math.max(current - windowStart, 0), rows.length - 1) : 0;
    fill.style.height = `${step * ROW_PITCH}px`;
  }

  function renderWindow() {
    const win = timelineWindow(cues.length, current);
    windowStart = win.start;
    rows = [];
    for (let index = win.start; index < win.end; index += 1) {
      const cue = cues[index] ?? {};
      const state = pipState(index, current);
      const time = h('span', { class: 'ink-tl-time' }, cueTime(index));
      const text = h('span', { class: 'ink-tl-text' }, String(cue.text ?? ''));
      const card = h(
        'button',
        { class: 'ink-tl-card', type: 'button', 'data-index': String(index), onclick: () => onSeek?.(index) },
        time,
        text,
      );
      if (state === 'current') card.setAttribute('aria-current', 'true');
      const li = h('li', { class: lineClass(state) }, h('span', { class: 'ink-tl-pip', 'aria-hidden': 'true' }), card);
      rows.push({ index, li, card, time });
    }
    list.replaceChildren(...rows.map((row) => row.li));
    paint();
  }

  function setCues(next) {
    cues = Array.isArray(next) ? next.slice() : [];
    if (current >= cues.length) current = cues.length > 0 ? cues.length - 1 : -1;
    renderWindow();
  }

  function setCurrent(index) {
    current = Number.isInteger(index) ? index : -1;
    const win = timelineWindow(cues.length, current);
    if (win.start !== windowStart) renderWindow();
    else paint();
  }

  function setOffset(seconds) {
    const next = Number(seconds);
    offset = Number.isFinite(next) ? next : 0;
    value.textContent = formatOffset(offset);
    // Times move with the offset (S5 passes unshifted cues and the live subOffset).
    for (const row of rows) row.time.textContent = cueTime(row.index);
  }

  return {
    setCues,
    setCurrent,
    setOffset,
    destroy() {
      root.remove();
      cues = [];
      rows = [];
    },
  };
}
