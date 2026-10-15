import { h } from '../lib/ui.mjs';
import { clozeParts } from '../lib/learnView.mjs';
import { LruCache } from '../lib/lru.mjs';

const cache = new LruCache(500);

function loadTokens(api, text) {
  const cached = cache.get(text);
  if (cached) return cached;
  const pending = api.furigana(text).catch((err) => {
    cache.delete(text);
    throw err;
  });
  cache.set(text, pending);
  return pending;
}

function tokenNode(token) {
  return token.ruby ? h('ruby', {}, token.text, h('rt', {}, token.ruby)) : token.text;
}

export async function rubyNode(api, text, { furigana = true } = {}) {
  if (!furigana || !text) return h('span', { class: 'learn-ruby' }, text);
  try {
    const tokens = await loadTokens(api, text);
    return h('span', { class: 'learn-ruby' }, tokens.map(tokenNode));
  } catch {
    return h('span', { class: 'learn-ruby' }, text);
  }
}

export function clozeNode(ja, { revealed = false, answer } = {}) {
  const { before, after, answers } = clozeParts(ja);
  const answerText = answer ?? answers[0] ?? '';
  const gap = revealed
    ? h('span', { class: 'learn-cloze-answer' }, answerText)
    : h('span', { class: 'learn-cloze-gap', 'aria-label': 'blank' }, '\u00a0'.repeat(Math.max(2, [...answerText].length)));
  return h('span', { class: 'learn-cloze' }, before, gap, after);
}
