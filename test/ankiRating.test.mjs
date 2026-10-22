import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStudyCardView, ratingBar } from '../src/renderer/anki/studyCard.mjs';
import { easeForKey, gradeButtons } from '../src/renderer/lib/study.mjs';

// --- A tiny fake DOM -------------------------------------------------------------------------
// The component only needs createElement, attributes, listeners, text and class lookups; no layout.
function makeEl(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    attrs: Object.create(null),
    children: [],
    listeners: Object.create(null),
    style: {},
    parentNode: null,
    hidden: false,
    disabled: false,
    srcdoc: '',
    innerHTML: '',
    title: '',
  };
  node.classList = {
    contains: (name) => String(node.attrs.class ?? '').split(/\s+/).includes(name),
    add: (...names) => {
      const set = new Set(String(node.attrs.class ?? '').split(/\s+/).filter(Boolean));
      for (const name of names) set.add(name);
      node.attrs.class = [...set].join(' ');
    },
    remove: (...names) => {
      const set = new Set(String(node.attrs.class ?? '').split(/\s+/).filter(Boolean));
      for (const name of names) set.delete(name);
      node.attrs.class = [...set].join(' ');
    },
    toggle: (name, force) => {
      const on = force === undefined ? !node.classList.contains(name) : Boolean(force);
      if (on) node.classList.add(name); else node.classList.remove(name);
      return on;
    },
  };
  node.setAttribute = (name, value) => {
    node.attrs[name] = String(value);
    if (name === 'hidden') node.hidden = true;
  };
  node.getAttribute = (name) => (name in node.attrs ? node.attrs[name] : null);
  node.hasAttribute = (name) => name in node.attrs;
  node.removeAttribute = (name) => { delete node.attrs[name]; };
  node.addEventListener = (type, fn) => { (node.listeners[type] ??= []).push(fn); };
  node.append = (...kids) => {
    for (const kid of kids) {
      if (kid == null) continue;
      if (typeof kid === 'string') node.children.push(kid);
      else { kid.parentNode = node; node.children.push(kid); }
    }
  };
  node.replaceChildren = (...kids) => { node.children = []; node.append(...kids); };
  node.replaceWith = (next) => {
    const parent = node.parentNode;
    if (!parent) return;
    const index = parent.children.indexOf(node);
    parent.children.splice(index, 1, next);
    next.parentNode = parent;
    node.parentNode = null;
  };
  node.remove = () => {
    const parent = node.parentNode;
    if (!parent) return;
    parent.children = parent.children.filter((child) => child !== node);
    node.parentNode = null;
  };
  Object.defineProperty(node, 'textContent', {
    get() { return node.children.map((child) => (typeof child === 'string' ? child : child.textContent)).join(''); },
    set(value) { node.children = [String(value)]; },
  });
  node.querySelectorAll = (selector) => {
    const out = [];
    const visit = (el) => {
      for (const child of el.children) {
        if (typeof child === 'string') continue;
        if (matches(child, selector)) out.push(child);
        visit(child);
      }
    };
    visit(node);
    return out;
  };
  return node;
}

function matches(el, selector) {
  const parsed = selector.trim().match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/);
  if (!parsed) return false;
  const [, tag, classes, attrs] = parsed;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  for (const cls of classes.match(/\.[\w-]+/g) ?? []) if (!el.classList.contains(cls.slice(1))) return false;
  for (const attr of attrs.match(/\[[^\]]+\]/g) ?? []) {
    const inner = attr.slice(1, -1);
    const equals = inner.match(/^([\w-]+)(?:="([^"]*)")?$/);
    if (!equals || !(equals[1] in el.attrs)) return false;
    if (equals[2] != null && el.attrs[equals[1]] !== equals[2]) return false;
  }
  return true;
}

const fakeDocument = () => ({ createElement: (tag) => makeEl(tag) });
globalThis.document = fakeDocument();

const one = (root, selector) => root.querySelectorAll(selector)[0];
const click = (el) => { for (const fn of el.listeners.click ?? []) fn({}); };
const BUTTONS = [
  { ease: 1, label: 'Again', interval: '<1m' },
  { ease: 2, label: 'Hard', interval: '6m' },
  { ease: 3, label: 'Good', interval: '3d' },
  { ease: 4, label: 'Easy', interval: '5d' },
];

// --- easeForKey ------------------------------------------------------------------------------
test('easeForKey accepts exactly the four rating keys', () => {
  assert.deepEqual(['1', '2', '3', '4'].map(easeForKey), [1, 2, 3, 4]);
});

test('easeForKey rejects zero, five and out-of-range or non-numeric keys', () => {
  for (const key of ['0', '5', '11', 'a', ' ', '', ' 1', '1.0', '-1', null, undefined]) {
    assert.equal(easeForKey(key), null, `key ${JSON.stringify(key)} must not rate`);
  }
});

// --- gradeButtons ----------------------------------------------------------------------------
test('gradeButtons keeps the Again, Hard, Good, Easy order and intervals', () => {
  assert.deepEqual(gradeButtons({ intervals: ['<1m', '6m', '3d', '5d'] }), [
    { ease: 1, label: 'Again', interval: '<1m' },
    { ease: 2, label: 'Hard', interval: '6m' },
    { ease: 3, label: 'Good', interval: '3d' },
    { ease: 4, label: 'Easy', interval: '5d' },
  ]);
});

test('gradeButtons keeps every key when Anki has no intervals yet', () => {
  const buttons = gradeButtons({});
  assert.deepEqual(buttons.map((b) => b.ease), [1, 2, 3, 4]);
  assert.deepEqual(buttons.map((b) => b.label), ['Again', 'Hard', 'Good', 'Easy']);
  assert.deepEqual(buttons.map((b) => b.interval), ['', '', '', '']);
});

// --- ratingBar -------------------------------------------------------------------------------
test('ratingBar renders four rate buttons with data-ease 1 to 4 and the frozen classes', () => {
  const bar = ratingBar(BUTTONS, () => {});
  assert.equal(bar.getAttribute('class'), 'ink-rating');
  const buttons = bar.querySelectorAll('.ink-rate');
  assert.equal(buttons.length, 4);
  assert.deepEqual(buttons.map((b) => b.getAttribute('data-ease')), ['1', '2', '3', '4']);
  assert.deepEqual(buttons.map((b) => b.getAttribute('class')),
    ['ink-rate ink-rate-again', 'ink-rate ink-rate-hard', 'ink-rate ink-rate-good', 'ink-rate ink-rate-easy']);
});

test('ratingBar shows the key, label and interval in each button', () => {
  const buttons = ratingBar(BUTTONS, () => {}).querySelectorAll('.ink-rate');
  assert.deepEqual(buttons.map((b) => one(b, '.ink-rate-key').textContent), ['1', '2', '3', '4']);
  assert.deepEqual(buttons.map((b) => one(b, '.ink-rate-label').textContent), ['Again', 'Hard', 'Good', 'Easy']);
  assert.deepEqual(buttons.map((b) => one(b, '.ink-rate-interval').textContent), ['<1m', '6m', '3d', '5d']);
  assert.equal(buttons[2].getAttribute('aria-label'), 'Good (3), 3d');
});

test('ratingBar calls onGrade with the ease of the pressed button', () => {
  const graded = [];
  const buttons = ratingBar(BUTTONS, (ease) => graded.push(ease)).querySelectorAll('.ink-rate');
  click(buttons[0]);
  click(buttons[2]);
  click(buttons[3]);
  assert.deepEqual(graded, [1, 3, 4]);
});

test('Good is the only primary black rate button', () => {
  const buttons = ratingBar(BUTTONS, () => {}).querySelectorAll('.ink-rate');
  const good = buttons.filter((b) => b.classList.contains('ink-rate-good'));
  assert.equal(good.length, 1);
  assert.equal(good[0].getAttribute('data-ease'), '3');
  assert.equal(buttons.filter((b) => b.classList.contains('is-primary')).length, 0);
  const css = readFileSync(new URL('../src/renderer/css/ink-anki-card.css', import.meta.url), 'utf8');
  const black = css.match(/\.ink-rate[\w-]*\s*\{[^}]*background:\s*var\(--ink\)/g) ?? [];
  assert.equal(black.length, 1, 'exactly one rate button is painted ink');
});

// --- createStudyCardView ---------------------------------------------------------------------
function makeView() {
  const calls = { reveal: 0, replay: 0, grades: [] };
  const view = createStudyCardView({
    onReveal: () => { calls.reveal += 1; },
    onReplay: () => { calls.replay += 1; },
    onGrade: (ease) => calls.grades.push(ease),
  });
  return { view, calls };
}

test('createStudyCardView renders the frozen card, tag and rating DOM', () => {
  const { view } = makeView();
  const front = one(view.el, '.ink-study-front');
  const back = one(view.el, '.ink-study-back');
  const rate = one(view.el, '.ink-study-rate');
  assert.ok(front && back && rate);
  assert.equal(one(front, '.ink-tag').textContent, 'Front · question');
  assert.equal(one(back, '.ink-tag').textContent, 'Back · answer');
  assert.equal(one(rate, '.ink-tag').textContent, 'How well did you remember it?');
  assert.equal(one(rate, '.ink-study-hint').textContent, 'Space shows the answer · 1 to 4 rates the card');
  const iframes = view.el.querySelectorAll('iframe');
  assert.equal(iframes.length, 2);
  for (const frame of iframes) {
    assert.equal(frame.getAttribute('class'), 'study-card');
    assert.equal(frame.getAttribute('sandbox'), '');
  }
  assert.ok(one(front, 'iframe'));
  assert.ok(one(back, 'iframe'));
  assert.ok(one(rate, '.ink-rating'));
});

test('the back card keeps a calm placeholder with a Show answer button until reveal', () => {
  const { view, calls } = makeView();
  const back = one(view.el, '.ink-study-back');
  const placeholder = one(back, '.ink-study-placeholder');
  assert.equal(placeholder.hidden, false);
  const reveal = one(back, '.ink-study-reveal');
  assert.equal(reveal.textContent, 'Show answer');
  click(reveal);
  assert.equal(calls.reveal, 1);
  const frame = one(back, 'iframe');
  assert.equal(frame.getAttribute('aria-hidden'), 'true');
  view.update({ side: 'answer' });
  assert.equal(placeholder.hidden, true);
  assert.equal(frame.getAttribute('aria-hidden'), 'false');
});

test('update() only writes an iframe when its document changed', () => {
  const { view } = makeView();
  const [front, back] = view.el.querySelectorAll('iframe');
  let frontWrites = 0;
  let backWrites = 0;
  let frontDoc = front.srcdoc;
  let backDoc = back.srcdoc;
  Object.defineProperty(front, 'srcdoc', { get: () => frontDoc, set: (value) => { frontWrites += 1; frontDoc = value; }, configurable: true });
  Object.defineProperty(back, 'srcdoc', { get: () => backDoc, set: (value) => { backWrites += 1; backDoc = value; }, configurable: true });

  view.update({ frontDoc: '<p>front</p>', backDoc: '<p>back</p>', side: 'question' });
  assert.equal(frontWrites, 1);
  assert.equal(backWrites, 1);
  assert.equal(frontDoc, '<p>front</p>');

  view.update({ frontDoc: '<p>front</p>', backDoc: '<p>back</p>', side: 'answer', busy: true, status: 'Saving review…' });
  assert.equal(frontWrites, 1, 'grading must not reload the front frame');
  assert.equal(backWrites, 1, 'grading must not reload the back frame');

  view.update({ frontDoc: '<p>next</p>', backDoc: '<p>back</p>', side: 'question' });
  assert.equal(frontWrites, 2);
  assert.equal(backWrites, 1);
});

test('the rating bar is rebuilt only when its buttons change', () => {
  const { view, calls } = makeView();
  view.update({ side: 'answer', buttons: BUTTONS, busy: false });
  const first = one(view.el, '.ink-rating');
  click(one(first, '.ink-rate-good'));
  assert.deepEqual(calls.grades, [3]);
  view.update({ side: 'answer', buttons: BUTTONS, busy: false, status: 'Saved' });
  assert.equal(one(view.el, '.ink-rating'), first, 'same buttons keep the same nodes');
  view.update({ side: 'answer', buttons: [{ ease: 3, label: 'Good', interval: '4d' }], busy: false });
  const next = one(view.el, '.ink-rating');
  assert.notEqual(next, first);
  assert.equal(one(next, '.ink-rate').getAttribute('data-ease'), '3');
});

test('every rate button is disabled while busy and before the answer is shown', () => {
  const { view, calls } = makeView();
  view.update({ side: 'question', buttons: BUTTONS, busy: false });
  assert.ok(view.el.querySelectorAll('.ink-rate').every((b) => b.disabled), 'no grading from the question side');
  view.update({ side: 'answer', buttons: BUTTONS, busy: false });
  assert.ok(view.el.querySelectorAll('.ink-rate').every((b) => !b.disabled));
  view.update({ side: 'answer', buttons: BUTTONS, busy: true });
  const buttons = view.el.querySelectorAll('.ink-rate');
  assert.ok(buttons.every((b) => b.disabled));
  assert.equal(view.el.getAttribute('aria-busy'), 'true');
  view.update({ side: 'answer', buttons: BUTTONS, busy: false });
  assert.ok(view.el.querySelectorAll('.ink-rate').every((b) => !b.disabled));
  assert.equal(view.el.getAttribute('aria-busy'), 'false');
  assert.deepEqual(calls.grades, []);
});

test('the replay button appears on the front card only when the card has audio', () => {
  const { view, calls } = makeView();
  view.update({ side: 'question', hasAudio: false });
  const replay = one(view.el, '.ink-study-replay');
  assert.equal(replay.hidden, true);
  view.update({ side: 'question', hasAudio: true });
  assert.equal(replay.hidden, false);
  click(replay);
  assert.equal(calls.replay, 1);
  assert.ok(one(view.el, '.ink-study-front').querySelectorAll('.ink-study-replay').includes(replay));
  view.update({ side: 'question', hasAudio: false });
  assert.equal(replay.hidden, true);
});

test('card tags render as chips and an empty list hides the row', () => {
  const { view } = makeView();
  const row = one(view.el, '.ink-study-tags');
  assert.equal(row.hidden, true);
  view.update({ side: 'question', tags: ['Mining', 'New card', 'JLPT N4'] });
  assert.equal(row.hidden, false);
  assert.deepEqual(row.querySelectorAll('.ink-study-tag').map((chip) => chip.textContent), ['Mining', 'New card', 'JLPT N4']);
  view.update({ side: 'question', tags: [] });
  assert.equal(row.hidden, true);
  assert.equal(row.querySelectorAll('.ink-study-tag').length, 0);
});

test('the status line is polite and empty when there is nothing to say', () => {
  const { view } = makeView();
  const status = one(view.el, '.ink-study-status');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  assert.equal(status.textContent, '');
  view.update({ side: 'answer', status: 'Saving review…' });
  assert.equal(status.textContent, 'Saving review…');
});

test('destroy() detaches the view', () => {
  const { view } = makeView();
  const host = makeEl('div');
  host.append(view.el);
  view.destroy();
  assert.equal(view.el.parentNode, null);
  assert.equal(host.children.length, 0);
});

test('the stylesheet keeps the frame geometry and the single black Good button', () => {
  const css = readFileSync(new URL('../src/renderer/css/ink-anki-card.css', import.meta.url), 'utf8');
  assert.match(css, /\.ink-study-cards\s*\{[^}]*grid-template-columns:\s*minmax\(0, 580fr\) minmax\(0, 588fr\)/);
  assert.match(css, /\.ink-study-cards\s*\{[^}]*gap:\s*16px/);
  assert.match(css, /\.ink-study-cards\s*\{[^}]*height:\s*var\(--ink-study-card-h,\s*620px\)/);
  assert.match(css, /\.ink-rating\s*\{[^}]*grid-template-columns:\s*repeat\(4/);
  assert.match(css, /\.ink-study-rate\s*\{[^}]*min-height:\s*172px/);
  assert.match(css, /\.ink-rate\s*\{[^}]*height:\s*74px/);
  assert.match(css, /\.ink-rate-good\s*\{[^}]*border:\s*3px solid var\(--ink\)/);
});

// The cards follow the viewport (S8 sets --ink-study-card-h, 380..620) so the rating panel stays
// above the fold. Inside, the iframes yield to the remaining height and scroll their own content.
test('the cards take their height from --ink-study-card-h and survive 380px', () => {
  const css = readFileSync(new URL('../src/renderer/css/ink-anki-card.css', import.meta.url), 'utf8');
  const card = css.match(/\.ink-study-front,\s*\.ink-study-back\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(card, /height:\s*var\(--ink-study-card-h,\s*620px\)/);
  assert.match(card, /display:\s*flex/);
  assert.match(card, /min-height:\s*0/);
  assert.match(card, /overflow:\s*hidden/);
  const frame = css.match(/\.ink-study-frame\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(frame, /flex:\s*1(?![\d.])/);
  assert.match(frame, /min-height:\s*0/);
  const iframe = css.match(/\.ink-study-frame\s*>\s*iframe\.study-card\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(iframe, /width:\s*100%/);
  assert.match(iframe, /height:\s*100%/);
  // The replay button sits in the card footer, so it never straddles the screenshot edge.
  const replay = css.match(/\.ink-study-replay\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(replay, /position:\s*static/);
  assert.doesNotMatch(replay, /top:/);
  // The placeholder gaps follow the card height so the copy, icon and button still fit.
  const placeholder = css.match(/\.ink-study-placeholder\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.match(placeholder, /gap:\s*clamp\([^)]*var\(--ink-study-card-h,\s*620px\)/);
  // Stacked narrow layout keeps its own fixed frame height and does not follow the variable.
  const narrow = css.slice(css.indexOf('@media (max-width: 800px)'));
  assert.match(narrow, /\.ink-study-front,\s*\.ink-study-back\s*\{\s*height:\s*auto/);
  assert.match(narrow, /\.ink-study-frame\s*\{\s*flex:\s*none;\s*height:\s*460px/);
});
