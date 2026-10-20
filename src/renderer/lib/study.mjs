// Pure helpers for the Study tab. No DOM access, so they run under node --test.
import { STUDY_THEME } from './studyTheme.mjs';

const CSP = "default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'";

const BASE_STYLE = `
html, body { margin: 0; min-height: 100%; background: #fffaf0; color: #2a1b0a; }
body {
  padding: 16px;
  box-sizing: border-box;
  text-align: center;
  font: 28px/1.6 "Hiragino Sans", "Yu Gothic", "Noto Sans JP", system-ui, sans-serif;
}
img { max-width: 100%; height: auto; }
`;

const GRADES = [
  [1, 'Again'],
  [2, 'Hard'],
  [3, 'Good'],
  [4, 'Easy'],
];

export function cardDocument(card, side, { theme = 'original' } = {}) {
  const css = String(card.css ?? '').replace(/<\/style/gi, '<\\/style');
  const body = side === 'answer' ? card.answer : card.question;
  const appTheme = theme === 'app';
  const sideAttr = appTheme ? ` data-side="${side === 'answer' ? 'answer' : 'question'}"` : '';
  // Retain the native class and a script-free sandbox in either presentation.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${BASE_STYLE}</style><style>${css}</style>${appTheme ? `<style>${STUDY_THEME}</style>` : ''}</head><body class="card${appTheme ? ' am-card' : ''}"${sideAttr}>${body ?? ''}</body></html>`;
}

export function deckLabel(deck) {
  const parts = String(deck ?? '').split('::');
  return { name: parts.pop(), parent: parts.join(' / ') };
}

export function createCardDocumentCache(build) {
  const cache = new WeakMap();
  return (card, side, theme) => {
    let docs = cache.get(card);
    if (!docs) { docs = new Map(); cache.set(card, docs); }
    const key = `${side}:${theme}`;
    if (!docs.has(key)) docs.set(key, build(card, side, theme));
    return docs.get(key);
  };
}

export function gradeButtons(card) {
  const intervals = Array.isArray(card.intervals) ? card.intervals : [];
  return GRADES.map(([ease, label]) => ({ ease, label, interval: intervals[ease - 1] ?? '' }));
}

export function sessionSummary({ reviewed, again }) {
  if (!reviewed) return 'Nothing reviewed yet';
  const correct = Math.round(((reviewed - again) / reviewed) * 100);
  return `${reviewed} reviewed · ${correct}% correct`;
}

const ENTITY_TEXT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export function plainSentence(html) {
  return String(html ?? '')
    .replace(/<(rp|rt)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITY_TEXT[entity])
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function easeForKey(key) {
  const n = Number(key);
  return Number.isInteger(n) && n >= 1 && n <= 4 && String(key).length === 1 ? n : null;
}
