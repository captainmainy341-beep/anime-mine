import { fill, h } from './ui.mjs';
import { renderGrammarGuide } from './grammarGuide.mjs';

const analyses = new Map();

export function analyzeCached(api, text) {
  if (!analyses.has(text)) {
    const pending = api.grammar.analyze(text);
    pending.catch(() => analyses.delete(text));
    analyses.set(text, pending);
  }
  return analyses.get(text);
}

export function grammarPanel({ api, text, compact = true }) {
  const body = h('div', { class: 'grammar-panel-body' }, h('p', { class: 'muted grammar-hint' }, 'Analysing grammar…'));
  const root = h('div', { class: 'grammar-panel' }, body);
  analyzeCached(api, text).then(
    (analysis) => fill(body, renderGrammarGuide(analysis, { compact })),
    (err) => fill(body, h('p', { class: 'grammar-error', role: 'alert' }, `Couldn’t analyse this sentence: ${err.message}`)),
  );
  return root;
}
