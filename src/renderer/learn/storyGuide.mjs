import { h } from '../lib/ui.mjs';
import { PEEK_WARNING, splitKanji } from './storyModel.mjs';

const chip = (label, onclick, props = {}) => h('button', { type: 'button', class: 'story-chip', onclick, ...props }, label);

// Japanese text with every kanji in its own tappable span (story.mjs listens for clicks on .story-k).
export function jaNodes(text) {
  return splitKanji(text).map((seg) => (seg.kanji ? h('span', { class: 'story-k', title: 'Look up this kanji' }, seg.text) : seg.text));
}

// Same, applied in place to markup that is already rendered (for example furigana from ruby.mjs).
export function kanjify(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('rt, .story-k') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const parts = jaNodes(node.textContent);
    if (parts.length === 1 && typeof parts[0] === 'string') continue;
    node.replaceWith(...parts);
  }
  return root;
}

export function renderParticleGuide(guide, { focus = null, onClose = null } = {}) {
  const pairs = guide.confusions.map((c) => h(
    'section',
    { class: `story-guide-pair${c.id === focus ? ' focus' : ''}`, id: `story-guide-${c.id}` },
    h('h3', { lang: 'ja' }, c.title),
    h('ul', {}, c.points.map((point) => h('li', {}, point))),
    h('ul', { class: 'story-guide-examples' }, c.examples.map((ex) => h('li', {}, h('span', { lang: 'ja' }, ex.ja), h('small', {}, ex.en)))),
  ));
  const particles = guide.particles.map((p) => h(
    'section',
    { class: 'story-guide-particle', id: `story-guide-${p.id.replace(':', '-')}` },
    h('h3', {}, h('span', { class: 'story-guide-surface', lang: 'ja' }, p.surface), ` ${p.name}`, h('span', { class: 'story-level' }, ` ${p.level}`)),
    h('ul', {}, p.roles.map((r) => h('li', {}, r.explanation, r.example ? h('div', { class: 'story-guide-ex' }, h('span', { lang: 'ja' }, r.example.ja), h('small', {}, r.example.en)) : null))),
    p.confusions.length ? h('p', { class: 'story-foot' }, 'Often mixed up: ', p.confusions.map((id) => {
      const pair = guide.confusions.find((c) => c.id === id);
      return chip(pair.title, () => document.getElementById(`story-guide-${id}`)?.scrollIntoView({ block: 'start' }));
    })) : null,
  ));
  const index = h('div', { class: 'story-guide-index' }, guide.particles.map((p) => chip(p.surface, () => document.getElementById(`story-guide-${p.id.replace(':', '-')}`)?.scrollIntoView({ block: 'start' }), { lang: 'ja', title: p.name })));
  const body = h(
    'div',
    { class: 'story-guide', role: onClose ? 'dialog' : null, 'aria-label': 'Particle guide' },
    h('header', {}, h('h2', {}, 'Particle guide'), onClose ? chip('Close', onClose) : null),
    index,
    h('h2', {}, 'Often mixed up'),
    pairs,
    h('h2', {}, 'Every particle (N5 / N4)'),
    particles,
  );
  if (focus) queueMicrotask(() => body.querySelector('.focus')?.scrollIntoView({ block: 'start' }));
  return body;
}

// The lookup card. `actions` are callbacks: onClose, onLearn, onDownload.
export function renderKanjiCard(model, actions) {
  const rows = [
    model.on ? ['On', model.on] : null,
    model.kun ? ['Kun', model.kun] : null,
    model.reading ? ['Reading', model.reading] : null,
  ].filter(Boolean);
  return h(
    'div',
    { class: 'story-kanji-card', role: 'dialog', 'aria-label': `Kanji ${model.char}` },
    h('header', {}, h('span', { class: 'story-kanji-char', lang: 'ja' }, model.char), chip('Close', actions.onClose)),
    model.tested ? h('p', { class: 'story-feedback' }, 'Looked up during the challenge: it will come back later.') : null,
    h('p', { class: 'story-kanji-meaning' }, model.meaning),
    rows.length ? h('dl', {}, rows.map(([k, v]) => [h('dt', {}, k), h('dd', { lang: 'ja' }, v)])) : null,
    model.facts ? h('p', { class: 'story-foot' }, model.facts) : null,
    model.words.length ? h('ul', { class: 'story-kanji-words' }, model.words.map((w) => h('li', {}, h('span', { lang: 'ja' }, w.text), w.reading ? h('small', { lang: 'ja' }, ` ${w.reading}`) : null, w.gloss ? h('small', {}, ` ${w.gloss}`) : null))) : null,
    h('p', { class: 'story-foot' }, model.status),
    h('div', { class: 'story-card-actions' },
      model.learnable ? h('button', { type: 'button', class: 'story-btn primary', onclick: actions.onLearn }, 'Learn it') : null,
      model.needsDownload && model.canDownload ? h('button', { type: 'button', class: 'story-btn', onclick: actions.onDownload }, 'Download the kanji dictionary for readings and words') : null,
    ),
  );
}

export function renderPeekConfirm(char, { onConfirm, onCancel }) {
  return h(
    'div',
    { class: 'story-kanji-card', role: 'alertdialog', 'aria-label': 'Look up the tested kanji?' },
    h('header', {}, h('span', { class: 'story-kanji-char', lang: 'ja' }, char)),
    h('p', {}, PEEK_WARNING),
    h('div', { class: 'story-card-actions' },
      h('button', { type: 'button', class: 'story-btn', onclick: onCancel }, 'Keep trying'),
      h('button', { type: 'button', class: 'story-btn primary', onclick: onConfirm }, 'Look it up anyway')),
  );
}
