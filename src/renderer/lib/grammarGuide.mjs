import { fill, h } from './ui.mjs';

export function chunkClasses(chunk, selected = false) {
  return ['chunk', `chunk-${chunk.kind}`, selected ? 'selected' : ''].filter(Boolean).join(' ');
}

export function groupParticles(particles) {
  const groups = new Map();
  for (const p of particles) {
    const key = `${p.id}|${p.role}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else {
      groups.set(key, {
        key,
        surface: p.surface,
        name: p.name,
        role: p.role,
        explanation: p.explanation,
        example: p.example,
        level: p.level,
        count: 1,
      });
    }
  }
  return [...groups.values()];
}

function stepSpans(conjugation) {
  const headLength = conjugation.surface.length - conjugation.steps.map((s) => s.form).join('').length;
  let cursor = conjugation.start + headLength;
  return conjugation.steps.map((step) => {
    const span = { step, start: cursor, end: cursor + step.form.length };
    cursor = span.end;
    return span;
  });
}

export function explanationFor(analysis, chunk) {
  const particle = analysis.particles.find((p) => p.start === chunk.start && p.end === chunk.end);
  if (particle) {
    return { title: `${particle.surface} · ${particle.name}`, body: particle.explanation, example: particle.example };
  }
  for (const conjugation of analysis.conjugations) {
    const span = stepSpans(conjugation).find((s) => s.start === chunk.start && s.end === chunk.end);
    if (span) {
      return {
        title: `${chunk.text} · ${span.step.label}`,
        body: `${span.step.explanation}. Part of ${conjugation.surface} (from ${conjugation.base}).`,
        example: null,
      };
    }
  }
  const pattern = analysis.patterns.find((p) => chunk.start >= p.start && chunk.end <= p.end);
  if (pattern) {
    return { title: pattern.title, body: pattern.level ? `Grammar pattern, JLPT ${pattern.level}.` : 'Grammar pattern.', example: null };
  }
  return null;
}

function card(explanation) {
  if (!explanation) return h('p', { class: 'muted grammar-hint' }, 'Hover or tap a highlighted part for its explanation.');
  return h(
    'div',
    { class: 'grammar-card' },
    h('div', { class: 'grammar-card-title' }, explanation.title),
    h('p', { class: 'grammar-card-body' }, explanation.body),
    explanation.example
      ? h('p', { class: 'grammar-card-example' }, explanation.example.ja, h('span', { class: 'muted' }, ` ${explanation.example.en}`))
      : null,
  );
}

function section(title, ...children) {
  return h('section', { class: 'grammar-section' }, h('h4', { class: 'grammar-heading' }, title), ...children);
}

function particlesSection(particles) {
  return section(
    'Particles',
    h(
      'ul',
      { class: 'grammar-list' },
      groupParticles(particles).map((g) =>
        h(
          'li',
          { class: 'grammar-item' },
          h('span', { class: 'grammar-surface' }, g.surface),
          h('span', { class: 'grammar-name muted' }, g.name),
          h('span', { class: 'grammar-role' }, g.explanation),
          h('span', { class: 'grammar-example' }, g.example.ja, h('span', { class: 'muted' }, ` ${g.example.en}`)),
          g.count > 1 ? h('span', { class: 'chip' }, `×${g.count}`) : null,
        ),
      ),
    ),
  );
}

function conjugationSection(conjugations) {
  return section(
    'Conjugation',
    ...conjugations.map((c) =>
      h(
        'div',
        { class: 'grammar-chain' },
        h('div', { class: 'grammar-chain-head' }, h('span', { class: 'grammar-surface' }, c.surface), h('span', { class: 'muted' }, `from ${c.base}`)),
        h(
          'ol',
          { class: 'grammar-steps' },
          c.steps.flatMap((s, i) => [
            i ? h('li', { class: 'grammar-arrow', 'aria-hidden': 'true' }, '→') : null,
            h('li', { class: 'grammar-step', title: s.explanation }, h('span', { class: 'grammar-step-form' }, s.form), h('span', { class: 'grammar-step-label' }, s.label)),
          ]),
        ),
      ),
    ),
  );
}

function patternsSection(patterns) {
  return section(
    'Patterns',
    h(
      'ul',
      { class: 'grammar-list' },
      patterns.map((p) =>
        h('li', { class: 'grammar-item' }, h('span', { class: 'grammar-role' }, p.title), p.level ? h('span', { class: 'chip grammar-level' }, p.level) : null),
      ),
    ),
  );
}

export function renderGrammarGuide(analysis, { compact = false } = {}) {
  const root = h('div', { class: `grammar-guide${compact ? ' compact' : ''}` });
  if (!analysis.chunks.length) {
    fill(root, h('p', { class: 'muted grammar-hint' }, 'Nothing to analyse in this line.'));
    return root;
  }

  const explanations = analysis.chunks.map((chunk) => explanationFor(analysis, chunk));
  const elements = analysis.chunks.map((chunk, i) => {
    if (!explanations[i]) return h('span', { class: chunkClasses(chunk) }, chunk.text);
    return h(
      'button',
      {
        type: 'button',
        class: chunkClasses(chunk),
        'aria-pressed': 'false',
        onmouseenter: () => show(i),
        onfocus: () => show(i),
        onclick: () => show(i),
      },
      chunk.text,
    );
  });
  const cardSlot = h('div', { class: 'grammar-card-slot', 'aria-live': 'polite' }, card(null));

  let shown = -1;
  function show(i) {
    if (shown === i) return;
    if (shown >= 0) {
      elements[shown].className = chunkClasses(analysis.chunks[shown], false);
      elements[shown].setAttribute('aria-pressed', 'false');
    }
    shown = i;
    elements[i].className = chunkClasses(analysis.chunks[i], true);
    elements[i].setAttribute('aria-pressed', 'true');
    fill(cardSlot, card(explanations[i]));
  }

  const hasInfo = analysis.particles.length || analysis.conjugations.length || analysis.patterns.length;
  fill(
    root,
    h('p', { class: 'grammar-sentence' }, ...elements),
    cardSlot,
    analysis.particles.length ? particlesSection(analysis.particles) : null,
    analysis.conjugations.length ? conjugationSection(analysis.conjugations) : null,
    analysis.patterns.length ? patternsSection(analysis.patterns) : null,
    hasInfo ? null : h('p', { class: 'muted grammar-hint' }, 'No particles or grammar patterns found.'),
    analysis.notes.map((note) => h('p', { class: 'muted grammar-note' }, note)),
  );
  return root;
}
