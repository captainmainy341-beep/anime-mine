import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMELINE_SIZE,
  currentLineIndex,
  formatCueTime,
  formatOffset,
  pipState,
  timelineWindow,
} from '../src/renderer/lib/subtitleTimeline.mjs';
import { mountTimeline } from '../src/renderer/player/timeline.mjs';

const cues3 = [
  { start: 1, end: 2, text: 'a' },
  { start: 3, end: 4, text: 'b' },
  { start: 5, end: 6, text: 'c' },
];

test('TIMELINE_SIZE is the frozen window size', () => {
  assert.equal(TIMELINE_SIZE, 8);
});

test('currentLineIndex finds the cue under the playhead', () => {
  assert.equal(currentLineIndex(cues3, 1), 0);
  assert.equal(currentLineIndex(cues3, 1.25), 0);
  assert.equal(currentLineIndex(cues3, 3.5), 1);
  assert.equal(currentLineIndex(cues3, 5.9), 2);
});

test('currentLineIndex keeps the last started cue between cues and after the last one', () => {
  assert.equal(currentLineIndex(cues3, 2.5), 0);
  assert.equal(currentLineIndex(cues3, 4.5), 1);
  assert.equal(currentLineIndex(cues3, 60), 2);
});

test('currentLineIndex is -1 before the first cue and for empty input', () => {
  assert.equal(currentLineIndex(cues3, 0.5), -1);
  assert.equal(currentLineIndex(cues3, -3), -1);
  assert.equal(currentLineIndex([], 5), -1);
  assert.equal(currentLineIndex(null, 5), -1);
  assert.equal(currentLineIndex(cues3, Number.NaN), -1);
});

test('currentLineIndex walks a long sorted list', () => {
  const cues = Array.from({ length: 40 }, (_, i) => ({ start: i * 2, end: i * 2 + 1.5, text: `${i}` }));
  assert.equal(currentLineIndex(cues, 0), 0);
  assert.equal(currentLineIndex(cues, 21.2), 10);
  assert.equal(currentLineIndex(cues, 21.9), 10);
  assert.equal(currentLineIndex(cues, 80), 39);
});

test('timelineWindow keeps the current line 4th when it can', () => {
  assert.deepEqual(timelineWindow(20, 3), { start: 0, end: 8 });
  assert.deepEqual(timelineWindow(20, 4), { start: 1, end: 9 });
  assert.deepEqual(timelineWindow(20, 10), { start: 7, end: 15 });
  assert.equal(timelineWindow(20, 10).start + 3, 10);
});

test('timelineWindow clamps at the start and the end', () => {
  assert.deepEqual(timelineWindow(20, 0), { start: 0, end: 8 });
  assert.deepEqual(timelineWindow(20, 1), { start: 0, end: 8 });
  assert.deepEqual(timelineWindow(20, 19), { start: 12, end: 20 });
  assert.deepEqual(timelineWindow(20, 16), { start: 12, end: 20 });
  assert.deepEqual(timelineWindow(20, 99), { start: 12, end: 20 });
});

test('timelineWindow handles short lists, no current line and tiny sizes', () => {
  assert.deepEqual(timelineWindow(3, 1), { start: 0, end: 3 });
  assert.deepEqual(timelineWindow(5, 0), { start: 0, end: 5 });
  assert.deepEqual(timelineWindow(0, -1), { start: 0, end: 0 });
  assert.deepEqual(timelineWindow(20, -1), { start: 0, end: 8 });
  assert.deepEqual(timelineWindow(20, 10, 4), { start: 7, end: 11 });
  assert.deepEqual(timelineWindow(20, 0, 4), { start: 0, end: 4 });
  assert.deepEqual(timelineWindow(20, 10, 0), { start: 0, end: 0 });
});

test('pipState marks past, current and future pips', () => {
  assert.equal(pipState(0, 2), 'past');
  assert.equal(pipState(1, 2), 'past');
  assert.equal(pipState(2, 2), 'current');
  assert.equal(pipState(3, 2), 'future');
  assert.equal(pipState(0, -1), 'future');
});

test('formatCueTime prints mm:ss under an hour and h:mm:ss from an hour', () => {
  assert.equal(formatCueTime(742), '12:22');
  assert.equal(formatCueTime(0), '00:00');
  assert.equal(formatCueTime(59.9), '00:59');
  assert.equal(formatCueTime(3599), '59:59');
  assert.equal(formatCueTime(3600), '1:00:00');
  assert.equal(formatCueTime(3661), '1:01:01');
  assert.equal(formatCueTime(-4), '00:00');
});

test('formatOffset signs and rounds to one decimal', () => {
  assert.equal(formatOffset(0), '+0.0s');
  assert.equal(formatOffset(0.3), '+0.3s');
  assert.equal(formatOffset(-0.3), '-0.3s');
  assert.equal(formatOffset(0.30000000000000004), '+0.3s');
  assert.equal(formatOffset(-0.30000000000000004), '-0.3s');
  assert.equal(formatOffset(0.04), '+0.0s');
  assert.equal(formatOffset(-0.04), '+0.0s');
  assert.equal(formatOffset(-0.06), '-0.1s');
  assert.equal(formatOffset(1), '+1.0s');
  assert.equal(formatOffset(Number.NaN), '+0.0s');
});

// ---- mountTimeline DOM (tiny fake document; there is no DOM in node tests) ----

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.parent = null;
    this._html = '';
  }
  append(...kids) {
    for (const kid of kids) {
      if (kid == null) continue;
      if (typeof kid === 'object') {
        kid.parent = this;
        this.children.push(kid);
      } else {
        this.children.push(String(kid));
      }
    }
  }
  replaceChildren(...kids) {
    for (const kid of this.children) if (typeof kid === 'object') kid.parent = null;
    this.children = [];
    this.append(...kids);
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== fn);
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  set textContent(value) {
    this.children = [String(value)];
  }
  get textContent() {
    return this.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join('');
  }
  set innerHTML(value) {
    this._html = String(value);
  }
  get innerHTML() {
    return this._html;
  }
  click() {
    for (const fn of this.listeners.click ?? []) fn({ type: 'click' });
  }
}

function byClass(root, name) {
  const found = [];
  const walk = (node) => {
    if (typeof node === 'string') return;
    if ((node.getAttribute('class') ?? '').split(/\s+/).includes(name)) found.push(node);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}

const lineCues = Array.from({ length: 10 }, (_, i) => ({ start: 742 + i * 4, end: 745 + i * 4, text: `line ${i}` }));

// The DOM tests below need document.createElement only; keep the shim installed for the whole file.
const previousDocument = globalThis.document;
globalThis.document = { createElement: (tag) => new FakeElement(tag) };
after(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

function mount(handlers = {}) {
  const host = new FakeElement('div');
  const api = mountTimeline(host, handlers);
  return { host, api, root: host.children[0] };
}

test('mountTimeline renders the frozen panel structure', () => {
  const { root } = mount();
  assert.equal(root.tagName, 'ASIDE');
  assert.equal(root.getAttribute('class'), 'ink-timeline');
  const tags = byClass(root, 'ink-tag');
  assert.deepEqual(tags.map((tag) => tag.textContent), ['Subtitles', 'Offset']);

  const rail = byClass(root, 'ink-timeline-rail')[0];
  assert.ok(rail);
  assert.equal(byClass(root, 'ink-timeline-rail-fill')[0].parent, rail);

  const list = byClass(root, 'ink-timeline-list')[0];
  assert.equal(list.tagName, 'OL');
  assert.equal(list.getAttribute('aria-label'), 'Subtitle lines');

  const value = byClass(root, 'ink-tl-value')[0];
  assert.equal(value.tagName, 'OUTPUT');
  assert.equal(value.textContent, '+0.0s');
  assert.equal(byClass(root, 'ink-tl-minus')[0].tagName, 'BUTTON');
  assert.equal(byClass(root, 'ink-tl-plus')[0].tagName, 'BUTTON');
});

test('setCues/setCurrent render the 8-line window with past/current states and aria-current', () => {
  const { api, root } = mount();
  api.setCues(lineCues);
  api.setCurrent(4);

  const list = byClass(root, 'ink-timeline-list')[0];
  const rows = byClass(root, 'ink-tl-line');
  assert.equal(rows.length, 8);
  assert.equal(rows[0].children.find((child) => child.getAttribute?.('class') === 'ink-tl-card').getAttribute('data-index'), '1');
  assert.equal(rows[0].getAttribute('class'), 'ink-tl-line is-past');
  assert.equal(rows[2].getAttribute('class'), 'ink-tl-line is-past');
  assert.equal(rows[3].getAttribute('class'), 'ink-tl-line is-current');
  assert.equal(rows[4].getAttribute('class'), 'ink-tl-line');

  const cards = byClass(root, 'ink-tl-card');
  assert.equal(cards[3].getAttribute('aria-current'), 'true');
  assert.equal(cards[2].getAttribute('aria-current'), null);
  assert.equal(cards[0].textContent, '12:26line 1');

  // rail fill runs from the top pip to the current pip: 3 rows down at a 72px pitch.
  assert.equal(byClass(root, 'ink-timeline-rail-fill')[0].style.height, '216px');
  assert.equal(list.children.length, 8);
});

test('clicking a card seeks to its absolute cue index', () => {
  const sought = [];
  const { api, root } = mount({ onSeek: (index) => sought.push(index) });
  api.setCues(lineCues);
  api.setCurrent(4);
  const cards = byClass(root, 'ink-tl-card');
  cards[0].click();
  cards[3].click();
  assert.deepEqual(sought, [1, 4]);
});

test('minus and plus call onOffset with -0.1 and +0.1 and the value uses formatOffset', () => {
  const deltas = [];
  const { api, root } = mount({ onOffset: (delta) => deltas.push(delta) });
  byClass(root, 'ink-tl-minus')[0].click();
  byClass(root, 'ink-tl-plus')[0].click();
  assert.deepEqual(deltas, [-0.1, 0.1]);

  api.setOffset(-0.3);
  assert.equal(byClass(root, 'ink-tl-value')[0].textContent, '-0.3s');
  api.setOffset(0.25);
  assert.equal(byClass(root, 'ink-tl-value')[0].textContent, '+0.3s');
});

test('setCurrent is cheap while the window stays put and re-renders only when it moves', () => {
  const { api, root } = mount();
  api.setCues(lineCues);
  api.setCurrent(4);
  const list = byClass(root, 'ink-timeline-list')[0];
  const first = list.children[0];
  api.setCurrent(4);
  assert.equal(list.children[0], first);
  api.setCurrent(4);
  assert.equal(list.children[0], first);

  api.setCurrent(5);
  assert.notEqual(list.children[0], first);
  assert.equal(byClass(root, 'ink-tl-card')[0].getAttribute('data-index'), '2');
});

test('setCurrent(-1) and empty cue lists render without a current line', () => {
  const { api, root } = mount();
  api.setCues(lineCues);
  api.setCurrent(4);
  api.setCurrent(-1);
  assert.equal(byClass(root, 'is-current').length, 0);
  assert.equal(byClass(root, 'ink-timeline-rail-fill')[0].style.height, '0px');
  assert.equal(byClass(root, 'ink-tl-card').every((card) => card.getAttribute('aria-current') === null), true);

  api.setCues([]);
  assert.equal(byClass(root, 'ink-tl-card').length, 0);
  assert.equal(byClass(root, 'ink-timeline-rail-fill')[0].style.height, '0px');
});

test('setOffset shifts the rendered cue times', () => {
  const { api, root } = mount();
  api.setCues(lineCues);
  api.setCurrent(4);
  api.setOffset(-6.5);
  assert.equal(byClass(root, 'ink-tl-time')[0].textContent, '12:19');
  api.setOffset(0);
  assert.equal(byClass(root, 'ink-tl-time')[0].textContent, '12:26');
});

test('destroy removes the panel', () => {
  const { api, host, root } = mount();
  assert.equal(host.children[0], root);
  api.destroy();
  assert.equal(host.children.length, 0);
});
