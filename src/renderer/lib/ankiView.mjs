// Pure helpers for the Anki section. No DOM access, so they run under node --test.

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const forecastLabel = (day) => {
  if (day === 0) return 'Today';
  if (day > 0 && day % 7 === 0) return `+${day}d`;
  return '';
};

// forecast: [{day, count}] -> [{day, count, height: 0..100, label}] normalised to the busiest day.
export function forecastBars(forecast) {
  const days = Array.isArray(forecast) ? forecast : [];
  const counts = days.map((d) => Number(d.count) || 0);
  const max = Math.max(0, ...counts);
  return days.map((d, i) => {
    const count = counts[i];
    const height = count > 0 && max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
    return { day: d.day, count, height, label: forecastLabel(d.day) };
  });
}

// Badge for the state column. Priority: suspended, new, due, learn, review.
export function stateBadge(card) {
  if (card.state === 'suspended') return { label: 'suspended', tone: 'muted' };
  if (card.state === 'new') return { label: 'new', tone: 'blue' };
  if (card.due) return { label: 'due', tone: 'accent' };
  if (card.state === 'learn') return { label: 'learn', tone: 'warn' };
  return { label: 'review', tone: 'muted' };
}

// retention is a percentage (91 -> '91%').
export function formatRetention(n) {
  return typeof n === 'number' && Number.isFinite(n) ? `${Math.round(n)}%` : '—';
}

export function formatStreak(n) {
  return typeof n === 'number' && Number.isFinite(n) ? plural(Math.round(n), 'day') : '—';
}

// Ease arrives either as Anki's permille factor (2500 -> 250%) or as a multiplier (2.5 -> 250%).
function formatEase(ease) {
  if (!(ease > 0)) return '—';
  return `${Math.round(ease > 10 ? ease / 10 : ease * 100)}%`;
}

export function formatHistory(card) {
  const interval = card.interval > 0 ? `${card.interval}d` : '—';
  return [
    `Interval ${interval}`,
    `Ease ${formatEase(card.ease)}`,
    plural(card.reps ?? 0, 'review'),
    plural(card.lapses ?? 0, 'lapse'),
  ].join(' · ');
}

// Splits a sentence around the first occurrence of word. Never returns HTML.
export function highlightParts(sentence, word) {
  const text = sentence ?? '';
  if (!text) return [];
  const at = word ? text.indexOf(word) : -1;
  if (at < 0) return [{ text, hit: false }];
  return [
    { text: text.slice(0, at), hit: false },
    { text: word, hit: true },
    { text: text.slice(at + word.length), hit: false },
  ].filter((part) => part.text !== '');
}

// Which panel the section should show.
export function modeSummary(view) {
  const { mode, connected, visibleDecks } = view ?? {};
  if (mode === 'sample') return 'sample';
  if (mode !== 'live') return 'hidden';
  if (!connected) return 'connect';
  if (!visibleDecks?.length) return 'pick';
  return 'ready';
}
