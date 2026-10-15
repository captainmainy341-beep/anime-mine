// Pure helpers for the Vocab tab and word/kanji cards. No DOM access, so they run under node --test.
import { hasKanji, toHiragana } from './furigana.mjs';

export const STATUS_ORDER = ['new', 'learning', 'known', 'never-forget', 'suspended', 'blacklisted'];
export const STORED_STATUSES = STATUS_ORDER.filter((status) => status !== 'new');

export const STATUS_META = {
  new: { label: 'New', css: 'status-new', hint: 'Not marked yet. Shows up as a word to learn.' },
  learning: { label: 'Learning', css: 'status-learning', hint: 'Being studied. Counts as known for coverage.' },
  known: { label: 'Known', css: 'status-known', hint: 'You already know it.' },
  'never-forget': { label: 'Never forget', css: 'status-never-forget', hint: 'Permanently known. Never comes back in reviews.' },
  suspended: { label: 'Suspended', css: 'status-suspended', hint: 'Unknown, but not suggested.' },
  blacklisted: { label: 'Blacklisted', css: 'status-blacklisted', hint: 'Ignored entirely. Never counted or suggested.' },
};

export function statusChips(counts = {}) {
  return STORED_STATUSES.map((status) => ({
    status,
    label: STATUS_META[status].label,
    count: counts[status] ?? 0,
  }));
}

export function statusCountLabel(status, count) {
  return `${STATUS_META[status].label} · ${formatCount(count)}`;
}

const BANDS = [
  [20, 'Beginner'],
  [40, 'Easy'],
  [60, 'Intermediate'],
  [80, 'Advanced'],
  [Infinity, 'Expert'],
];

export function difficultyBand(score) {
  if (!Number.isFinite(score)) return 'Unknown';
  const clamped = Math.min(100, Math.max(0, score));
  return BANDS.find(([limit]) => clamped < limit)[1];
}

export function difficultyColor(score) {
  const clamped = Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
  return `hsl(${Math.round(120 - 1.2 * clamped)} 65% 62%)`;
}

const SORT_KEYS = {
  title: (w) => w.title,
  difficulty: (w) => w.difficulty,
  words: (w) => w.words,
  uniqueWords: (w) => w.uniqueWords,
  uniqueOncePct: (w) => w.uniqueOncePct,
  uniqueKanji: (w) => w.uniqueKanji,
  avgSentenceLength: (w) => w.avgSentenceLength,
  knownPct: (w) => w.knownPct,
};

export function sortWorks(works, key, dir = 'desc') {
  const accessor = SORT_KEYS[key];
  if (!accessor) throw new Error(`unknown sort key: ${key}`);
  const sign = dir === 'asc' ? 1 : -1;
  const value = (work) => {
    const v = accessor(work);
    if (typeof v === 'string') return v.toLowerCase();
    return Number.isFinite(v) ? v : null;
  };
  return [...works].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else if (x !== y) {
      return x < y ? -sign : sign;
    }
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
}

export function filterWorks(works, query = '') {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...works];
  return works.filter((work) => work.title.toLowerCase().includes(needle));
}

export function formatPct(value) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 10) / 10}%`;
}

export function formatCount(n) {
  const whole = Number.isFinite(n) ? Math.trunc(n) : 0;
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const csvField = (value) => {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function rowsToCsv(rows, headers) {
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((key) => csvField(row[key])).join(','));
  return lines.join('\n');
}

export function wordRowSummary(row) {
  const reading = row.reading ? ` (${row.reading})` : '';
  const count = row.count ? ` · ×${row.count}` : '';
  return `${row.word}${reading}${count} · ${STATUS_META[row.status]?.label ?? row.status}`;
}

export function kanjiOnly(text = '') {
  return [...new Set([...text].filter((ch) => hasKanji(ch)))];
}

export function frequencyLabel(frequency) {
  if (!frequency) return null;
  if (frequency.bucket) return frequency.bucket;
  return frequency.rank ? `Rank ${formatCount(frequency.rank)}` : null;
}

// heiban and odaka share one pattern shape, so they are reported together.
export function pitchLabelFromPattern(patterns = []) {
  if (!patterns.length) return null;
  const high = patterns.map((p) => p.high);
  if (high[0] && high.slice(1).every((h) => !h)) return 'atamadaka';
  if (high.some((h, i) => h && i + 1 < high.length && !high[i + 1])) return 'nakadaka';
  return 'heiban / odaka';
}

export function kanjiFacts(info) {
  const facts = [];
  if (info.grade != null) facts.push({ label: 'Grade', value: String(info.grade) });
  if (info.jlpt != null) facts.push({ label: 'JLPT', value: `N${info.jlpt}` });
  if (info.strokes != null) facts.push({ label: 'Strokes', value: String(info.strokes) });
  if (info.heisig != null) facts.push({ label: 'Heisig', value: `#${info.heisig}` });
  if (info.radical?.number != null) {
    const name = info.radical.name ? ` ${info.radical.name}` : '';
    facts.push({ label: 'Radical', value: `${info.radical.number}${name}` });
  }
  const freq = frequencyLabel(info.frequency);
  if (freq) facts.push({ label: 'Frequency', value: freq });
  return facts;
}

export function missingDownloads(status) {
  return ['kanjidic', 'examples'].filter((key) => !status?.[key]);
}

export function splitAround(text, needle) {
  if (!needle) return [{ text, hit: false }];
  const parts = [];
  let rest = text;
  let index;
  while ((index = rest.indexOf(needle)) !== -1) {
    if (index > 0) parts.push({ text: rest.slice(0, index), hit: false });
    parts.push({ text: needle, hit: true });
    rest = rest.slice(index + needle.length);
  }
  if (rest) parts.push({ text: rest, hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}

const isKana = (ch) => /[\u3041-\u3096\u30a1-\u30fa\u30fc]/.test(ch);

// Splits a word into ruby segments: kana shared between surface and reading stay bare, the rest gets the reading.
export function rubyParts(surface, reading) {
  if (!hasKanji(surface) || !reading) return [{ text: surface, rt: null }];
  const chars = [...surface];
  const kana = [...toHiragana(reading)];
  let head = 0;
  while (head < chars.length && !hasKanji(chars[head]) && head < kana.length && toHiragana(chars[head]) === kana[head]) head++;
  let tail = 0;
  while (
    tail < chars.length - head &&
    isKana(chars[chars.length - 1 - tail]) &&
    tail < kana.length - head &&
    toHiragana(chars[chars.length - 1 - tail]) === kana[kana.length - 1 - tail]
  ) tail++;
  const middle = chars.slice(head, chars.length - tail).join('');
  const middleReading = kana.slice(head, kana.length - tail).join('');
  const parts = [];
  if (head) parts.push({ text: chars.slice(0, head).join(''), rt: null });
  if (middle) parts.push({ text: middle, rt: middleReading || null });
  if (tail) parts.push({ text: chars.slice(chars.length - tail).join(''), rt: null });
  return parts;
}
