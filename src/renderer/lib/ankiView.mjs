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

// Review activity: a 53-week heatmap (Monday-first) and the streak / learned streak summary.
const ONE_DAY = 24 * 60 * 60 * 1000;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HEATMAP_COLUMNS = 53;
const DAYS_PER_YEAR = 365;

const pad2 = (n) => String(n).padStart(2, '0');

// Local calendar day, never UTC: a review belongs to the day the app is showing.
const isoDate = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

function startOfDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return startOfDay(new Date());
  date.setHours(0, 0, 0, 0);
  return date;
}

const dayNumber = (date) => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / ONE_DAY);

// '"YYYY-MM-DD"' -> a local Date, or null when the string is not a calendar day.
function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return isoDate(date) === match[0] ? date : null;
}

function countMap(reviewsByDay) {
  const map = new Map();
  for (const row of Array.isArray(reviewsByDay) ? reviewsByDay : []) {
    const date = parseDay(row?.date);
    const count = Math.max(0, Math.round(Number(row?.count ?? 0) || 0));
    if (date && count > 0) map.set(isoDate(date), count);
  }
  return map;
}

// 0 when there are no reviews (or nothing to scale against), 1..3 as a share of the busiest day.
export function heatmapLevel(count, max) {
  const value = Number(count);
  const busiest = Number(max);
  if (!Number.isFinite(value) || !Number.isFinite(busiest) || value <= 0 || busiest <= 0) return 0;
  if (value <= busiest / 3) return 1;
  if (value <= (2 * busiest) / 3) return 2;
  return 3;
}

// reviewsByDay -> { weeks: 53 columns of 7 Monday-first cells, months: [{ label, column }], max }.
// The grid ends with the week that holds today; the rest of that week is flagged future.
export function heatmapModel(reviewsByDay, today = new Date()) {
  const end = startOfDay(today);
  const todayKey = isoDate(end);
  const counts = countMap(reviewsByDay);
  const mondayOffset = (end.getDay() + 6) % 7; // 0 = Monday
  const lastMonday = new Date(end);
  lastMonday.setDate(end.getDate() - mondayOffset);
  const firstMonday = new Date(lastMonday);
  firstMonday.setDate(lastMonday.getDate() - (HEATMAP_COLUMNS - 1) * 7);

  const weeks = [];
  let max = 0;
  for (let column = 0; column < HEATMAP_COLUMNS; column += 1) {
    const week = [];
    for (let row = 0; row < 7; row += 1) {
      const date = new Date(firstMonday);
      date.setDate(firstMonday.getDate() + column * 7 + row);
      const key = isoDate(date);
      const future = key > todayKey;
      const count = future ? 0 : counts.get(key) ?? 0;
      max = Math.max(max, count);
      week.push({ date: key, count, level: 0, isToday: key === todayKey, future });
    }
    weeks.push(week);
  }
  for (const week of weeks) for (const cell of week) cell.level = heatmapLevel(cell.count, max);

  const months = [];
  let lastColumn = -3;
  let lastMonth = -1;
  for (let column = 0; column < HEATMAP_COLUMNS; column += 1) {
    const first = new Date(firstMonday);
    first.setDate(firstMonday.getDate() + column * 7);
    const month = first.getMonth();
    if (month !== lastMonth) {
      lastMonth = month;
      if (column - lastColumn >= 2) {
        months.push({ label: MONTH_NAMES[month], column });
        lastColumn = column;
      }
    }
  }
  return { weeks, months, max };
}

// -> { streak, daysLearnedPct, dailyAverage } over the last 365 days.
// The streak ends today, or yesterday when today has no review yet.
export function activityStats(reviewsByDay, today = new Date()) {
  const end = startOfDay(today);
  const todayKey = isoDate(end);
  const windowStart = new Date(end);
  windowStart.setDate(end.getDate() - (DAYS_PER_YEAR - 1));
  const startKey = isoDate(windowStart);
  const counts = countMap(reviewsByDay);

  const keys = [...counts.keys()].filter((key) => key >= startKey && key <= todayKey).sort();
  if (!keys.length) return { streak: 0, daysLearnedPct: 0, dailyAverage: 0 };

  const total = keys.reduce((sum, key) => sum + counts.get(key), 0);
  const span = dayNumber(end) - dayNumber(parseDay(keys[0])) + 1;
  const daysLearnedPct = Math.min(100, Math.max(0, Math.round((100 * keys.length) / span)));
  const dailyAverage = Math.round(total / span);

  const cursor = new Date(end);
  if (!counts.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (streak < DAYS_PER_YEAR && counts.has(isoDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { streak, daysLearnedPct, dailyAverage };
}
