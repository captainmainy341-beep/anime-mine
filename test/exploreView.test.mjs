import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tiny DOM shim: enough for lib/ui.mjs h(), lib/inkHeader.mjs and lib/doodleIcons.mjs.
// No layout, no CSS: these tests assert structure, classes, text and wiring only.
class FakeText {
  constructor(value) {
    this.tagName = '#text';
    this.textContent = String(value);
  }
}

class FakeNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.style = {};
    this.parent = null;
    this._html = '';
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
  }

  getAttribute(name) {
    return this.attributes.has(String(name)) ? this.attributes.get(String(name)) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  get className() {
    return this.getAttribute('class') ?? '';
  }

  get classList() {
    const read = () => this.className.split(/\s+/).filter(Boolean);
    const write = (list) => this.setAttribute('class', list.join(' '));
    return {
      add: (...names) => {
        const list = read();
        for (const name of names) if (!list.includes(name)) list.push(name);
        write(list);
      },
      remove: (...names) => write(read().filter((name) => !names.includes(name))),
      contains: (name) => read().includes(name),
      toggle: (name, force) => {
        const has = read().includes(name);
        const want = force === undefined ? !has : Boolean(force);
        if (want && !has) this.classList.add(name);
        if (!want && has) this.classList.remove(name);
        return want;
      },
    };
  }

  set innerHTML(value) {
    this._html = String(value);
  }

  get innerHTML() {
    return this._html;
  }

  get textContent() {
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.children = value === '' || value == null ? [] : [new FakeText(value)];
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node == null) continue;
      const child = typeof node === 'object' ? node : new FakeText(node);
      child.parent = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  dispatch(type, extra = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler({ type, target: this, ...extra });
  }

  click() {
    this.dispatch('click');
  }

  remove() {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }
}

globalThis.document = { createElement: (tagName) => new FakeNode(tagName) };

const { mountExplore } = await import('../src/renderer/learn/exploreView.mjs');

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const kanjiFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'ink-S2-kanji.json'), 'utf8'));

function walk(node, visit) {
  for (const child of node.children ?? []) {
    if (child.tagName === '#text') continue;
    visit(child);
    walk(child, visit);
  }
}

function all(root, predicate) {
  const found = [];
  walk(root, (node) => {
    if (predicate(node)) found.push(node);
  });
  return found;
}

const byClass = (root, name) => all(root, (node) => node.classList.contains(name));
const one = (root, name) => {
  const found = byClass(root, name);
  assert.equal(found.length, 1, `expected exactly one .${name}, found ${found.length}`);
  return found[0];
};

function fixtureProps(overrides = {}) {
  const props = {
    title: kanjiFixture.title,
    header: { ...kanjiFixture.header },
    lesson: { ...kanjiFixture.lesson, start() {} },
    progress: { ...kanjiFixture.progress },
    rows: kanjiFixture.rows.map((row) => ({ ...row, open() {} })),
    filter: kanjiFixture.filter,
    onFilter() {},
    seeAll: { ...kanjiFixture.seeAll, onOpen() {} },
  };
  return { ...props, ...overrides };
}

function mount(props = fixtureProps()) {
  const container = new FakeNode('div');
  const view = mountExplore(container, props);
  return { container, view, root: container.children[0], props };
}

test('mountExplore renders the frozen DOM skeleton', () => {
  const { root } = mount();
  assert.ok(root.classList.contains('ink-screen'));
  assert.ok(root.classList.contains('ink-explore'));
  assert.equal(root.tagName, 'SECTION');
  one(root, 'ink-hero');
  const grid = one(root, 'ink-explore-grid');
  assert.equal(grid.children.length, 2);

  const lessonPanel = one(root, 'ink-explore-lesson');
  assert.ok(lessonPanel.classList.contains('ink-panel'));
  assert.ok(lessonPanel.classList.contains('ink-hatch'));
  one(lessonPanel, 'ink-lesson-card');

  const upnextPanel = one(root, 'ink-explore-upnext');
  assert.ok(upnextPanel.classList.contains('ink-panel'));
  assert.ok(upnextPanel.classList.contains('ink-hatch'));
  one(upnextPanel, 'ink-upnext-card');
});

test('lesson card shows tag, NEW! stamp, heading, meta, preview and progress', () => {
  const { root } = mount();
  const card = one(root, 'ink-lesson-card');

  const tag = one(card, 'ink-tag');
  assert.ok(tag.classList.contains('ink-tag-caps'));
  assert.equal(tag.textContent, 'YOUR NEXT LESSON');

  assert.equal(one(card, 'ink-stamp').textContent, 'NEW!');
  assert.equal(one(card, 'ink-lesson-number').textContent, 'Lesson 6');
  one(card, 'ink-underline');
  assert.equal(one(card, 'ink-lesson-meta').textContent, 'Family and school · 5 kanji · about 6 min');

  const tiles = byClass(card, 'ink-preview-tile');
  assert.equal(tiles.length, 5);
  assert.deepEqual(tiles.map((tile) => tile.textContent), ['学', '校', '先', '生', '友']);
  assert.ok(tiles.every((tile) => tile.classList.contains('is-kanji')));

  assert.equal(one(card, 'ink-lesson-progress-label').textContent, 'KANJI LEARNED');
  assert.equal(one(card, 'ink-lesson-progress-count').textContent, '12 / 80');
  const track = one(card, 'ink-track');
  assert.equal(track.getAttribute('aria-valuenow'), '12');
  assert.equal(track.getAttribute('aria-valuemax'), '80');
  one(track, 'ink-track-fill');
});

test('text previews are three text tiles and long grammar patterns get the smaller class', () => {
  const vocab = mount(fixtureProps({
    lesson: {
      id: 'v3', number: 3, title: 'Food', meta: 'Food and eating · 8 words · about 5 min',
      preview: ['食べる', '飲む', 'お水'], previewKind: 'text', isNew: true, done: false, start() {},
    },
  })).root;
  const textPreview = one(vocab, 'ink-lesson-preview');
  assert.ok(textPreview.classList.contains('is-text'));
  assert.equal(textPreview.classList.contains('is-long'), false);
  assert.equal(byClass(vocab, 'ink-preview-tile').length, 3);

  const grammar = mount(fixtureProps({
    lesson: {
      id: 'g2', number: 2, title: 'Topic', meta: 'Topic and subject · 3 patterns · 8 min',
      preview: ['AはBです', 'Aが ある', 'Aを 食べる'], previewKind: 'text', isNew: true, done: false, start() {},
    },
  })).root;
  assert.ok(one(grammar, 'ink-lesson-preview').classList.contains('is-long'));
});

test('exactly one Start button starts the lesson', () => {
  let started = 0;
  const lesson = { ...kanjiFixture.lesson, start: () => { started += 1; } };
  const { root } = mount(fixtureProps({ lesson }));
  const starts = byClass(root, 'ink-explore-start');
  assert.equal(starts.length, 1);
  const button = starts[0];
  assert.equal(button.tagName, 'BUTTON');
  assert.ok(button.classList.contains('ink-bigbtn'));
  assert.match(button.textContent, /START LESSON/);
  assert.equal(byClass(button, 'doodle-arrow').length, 1);
  button.click();
  assert.equal(started, 1);
});

test('no NEW! stamp when the lesson is not new', () => {
  const { root } = mount(fixtureProps({ lesson: { ...kanjiFixture.lesson, isNew: false, start() {} } }));
  assert.equal(byClass(root, 'ink-stamp').length, 0);
});

test('filters render aria-pressed, call onFilter, and re-render the list', () => {
  const seen = [];
  const { root } = mount(fixtureProps({ onFilter: (filter) => seen.push(filter) }));
  const filters = byClass(root, 'ink-toggle');
  assert.equal(filters.length, 3);
  assert.deepEqual(filters.map((button) => button.getAttribute('data-filter')), ['all', 'new', 'review']);
  assert.deepEqual(filters.map((button) => button.getAttribute('aria-pressed')), ['true', 'false', 'false']);
  assert.deepEqual(filters.map((button) => button.textContent), ['All', 'New', 'Review']);

  assert.equal(byClass(root, 'ink-row').length, 3);
  filters[1].click();
  assert.deepEqual(seen, ['new']);
  assert.deepEqual(filters.map((button) => button.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.equal(byClass(root, 'ink-row').length, 2);
  assert.equal(one(root, 'ink-upnext-card').classList.contains('is-sparse'), true);

  filters[2].click();
  assert.deepEqual(seen, ['new', 'review']);
  assert.equal(byClass(root, 'ink-row').length, 1);

  filters[0].click();
  assert.equal(byClass(root, 'ink-row').length, 3);
  assert.equal(one(root, 'ink-upnext-card').classList.contains('is-sparse'), false);
});

test('up-next rows cap at three and each row opens', () => {
  const opened = [];
  const rows = [
    { id: 'a', tile: '家', tileKind: 'kanji', title: 'House, home', sub: 'カ, いえ · 10 strokes', status: 'new', open: () => opened.push('a') },
    { id: 'b', tile: '友', tileKind: 'kanji', title: 'Friend', sub: 'ユウ, とも', status: 'review', open: () => opened.push('b') },
    { id: 'c', tile: '年', tileKind: 'kanji', title: 'Year', sub: 'ネン', status: 'new', open: () => opened.push('c') },
    { id: 'd', tile: '04', tileKind: 'number', title: 'Places', sub: '7 words', status: 'new', open: () => opened.push('d') },
  ];
  const { root } = mount(fixtureProps({ rows }));
  const rendered = byClass(root, 'ink-row');
  assert.equal(rendered.length, 3);
  assert.deepEqual(rendered.map((row) => one(row, 'ink-row-title').textContent), ['House, home', 'Friend', 'Year']);
  assert.ok(one(rendered[0], 'ink-row-tile').classList.contains('is-kanji'));
  assert.equal(byClass(rendered[0], 'ink-row-chevron').length, 1);
  rendered[1].click();
  assert.deepEqual(opened, ['b']);
});

test('number tiles use the is-number class and lessonNumberLabel is exposed through the tile text', () => {
  const rows = [{ id: 'n4', tile: '04', tileKind: 'number', title: 'Places and travel', sub: '7 words · 5 min', status: 'new', open() {} }];
  const { root } = mount(fixtureProps({ rows }));
  const tile = one(root, 'ink-row-tile');
  assert.ok(tile.classList.contains('is-number'));
  assert.equal(tile.textContent, '04');
});

test('an empty filter result shows a plain empty line, no glyph icons', () => {
  const rows = [{ id: 'x', tile: '家', tileKind: 'kanji', title: 'House', sub: '', status: 'new', open() {} }];
  const { root } = mount(fixtureProps({ rows, filter: 'review' }));
  const empty = one(root, 'ink-upnext-empty');
  assert.equal(empty.textContent, 'Nothing here yet.');
  assert.equal(byClass(root, 'ink-row').length, 0);
  assert.equal(byClass(root, 'ink-upnext-list').length, 1);
});

test('see all shows the model label and calls onOpen', () => {
  let opens = 0;
  const { root } = mount(fixtureProps({ seeAll: { total: 74, noun: 'kanji', onOpen: () => { opens += 1; } } }));
  const seeAll = one(root, 'ink-seeall');
  const link = one(seeAll, 'ink-link');
  assert.equal(link.textContent, 'See all 74 kanji');
  assert.equal(byClass(seeAll, 'doodle-arrow').length, 1);
  seeAll.click();
  assert.equal(opens, 1);
});

test('lesson null renders the calm caught-up state without a Start button', () => {
  const { root } = mount(fixtureProps({ lesson: null }));
  const card = one(root, 'ink-lesson-card');
  assert.ok(card.classList.contains('is-empty'));
  assert.equal(one(root, 'ink-lesson-number').textContent, 'All caught up');
  assert.equal(byClass(root, 'ink-explore-start').length, 0);
  assert.equal(byClass(root, 'ink-underline').length, 1);
  one(root, 'ink-lesson-progress');

  const custom = mount(fixtureProps({ lesson: null, emptyText: 'Nothing queued' })).root;
  assert.equal(one(custom, 'ink-lesson-number').textContent, 'Nothing queued');
});

test('update() patches the header, lesson, progress, rows and filter in place', () => {
  const { root, view } = mount();
  view.update({
    title: 'Explore Vocab',
    header: { label: '3 OF 24 DONE', value: 3, max: 24 },
    lesson: {
      id: 'v3', number: 3, title: 'Food', meta: 'Food and eating · 8 words · about 5 min',
      preview: ['食べる', '飲む', 'お水'], previewKind: 'text', isNew: false, done: false, start() {},
    },
    progress: { label: 'LESSONS DONE', value: 3, max: 24 },
    rows: [{ id: 'n4', tile: '04', tileKind: 'number', title: 'Places and travel', sub: '7 words', status: 'new', open() {} }],
    filter: 'new',
    seeAll: { total: 24, noun: 'lessons' },
  });

  assert.equal(one(root, 'ink-hero-title').textContent, 'Explore Vocab');
  assert.equal(one(root, 'ink-hero-label').textContent, '3 OF 24 DONE');
  assert.equal(one(root, 'ink-lesson-number').textContent, 'Lesson 3');
  assert.equal(byClass(root, 'ink-stamp').length, 0);
  assert.equal(one(root, 'ink-lesson-progress-label').textContent, 'LESSONS DONE');
  assert.equal(one(root, 'ink-lesson-progress-count').textContent, '3 / 24');
  assert.equal(byClass(root, 'ink-row').length, 1);
  assert.equal(one(root, 'ink-row-title').textContent, 'Places and travel');
  assert.equal(byClass(root, 'ink-preview-tile').length, 3);
  assert.deepEqual(byClass(root, 'ink-toggle').map((button) => button.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.equal(one(root, 'ink-link').textContent, 'See all 24 lessons');
});

test('unknown filters keep every row and press no toggle', () => {
  const { root, view } = mount();
  view.update({ filter: 'learned' });
  assert.equal(byClass(root, 'ink-row').length, 3);
  assert.deepEqual(byClass(root, 'ink-toggle').map((button) => button.getAttribute('aria-pressed')), ['false', 'false', 'false']);
});

test('update() tolerates null header and see-all patches', () => {
  const { root, view } = mount();
  view.update({ header: null, seeAll: null });
  assert.equal(one(root, 'ink-hero-title').textContent, 'Explore Kanji');
  assert.equal(one(root, 'ink-seeall').hidden, true);
  view.update({ seeAll: { total: 24, noun: 'lessons' } });
  assert.equal(one(root, 'ink-link').textContent, 'See all 24 lessons');
});

test('destroy removes the screen', () => {
  const { container, view, root } = mount();
  assert.equal(container.children.length, 1);
  view.destroy();
  assert.equal(container.children.length, 0);
  assert.equal(root.parent, null);
  view.update({ title: 'late' });
});
