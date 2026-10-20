const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const MINED_LIMIT = 24;
const FORECAST_DAYS = 22;
const BROWSE_STATES = ['all', 'due', 'new', 'learn', 'suspended'];
const STATE_SEARCH = { all: '', due: 'is:due', new: 'is:new', learn: 'is:learn', suspended: 'is:suspended' };
const MEDIA_TYPES = Object.assign(Object.create(null), {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
});
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

// Escapes Anki search metacharacters so user text stays a literal term.
const escapeSearch = (text) => String(text).replace(/[\\"*_:]/g, '\\$&');
const quote = (text) => `"${escapeSearch(text)}"`;

// Exact deck match: the deck itself, not its subdecks (AnkiConnect deck names use "::").
const exactDeck = (name) => `(deck:${quote(name)} -deck:"${escapeSearch(name)}::*")`;
const deckScope = (names) => `(${names.map(exactDeck).join(' OR ')})`;

const OPERATOR = /(^|[\s(])-?[a-z]+:|\(|\)|(^|\s)-|\s(or|and)\s|(^|\s)"/i;

// Balanced quotes (only at token start or after name:) and parens, so raw text can't close our scope group.
function isWellFormed(text) {
  let depth = 0;
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '\\') i++;
      else if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '\\') { i++; continue; }
    if (ch === '"') {
      const prev = text[i - 1] ?? ' ';
      if (!/[\s(:-]/.test(prev)) return false;
      inQuote = true;
    } else if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return !inQuote && depth === 0;
}

// Plain words stay an exact phrase; anything using Anki operators is passed through untouched.
function searchText(query) {
  const text = typeof query === 'string' ? query.trim() : '';
  if (!text) return '';
  return OPERATOR.test(text) && isWellFormed(text) ? `(${text})` : quote(text);
}

function normalizeState(state = 'all') {
  if (!BROWSE_STATES.includes(state)) throw new Error(`state must be one of ${BROWSE_STATES.join(', ')}`);
  return state;
}

function clampLimit(limit) {
  const n = Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

function assertMediaName(name) {
  if (typeof name !== 'string' || name === '' || /[\/\\\u0000]/.test(name) || name.includes('..')) {
    throw new Error('Invalid media filename');
  }
}

const mimeType = (name) => MEDIA_TYPES[/\.([^.]+)$/.exec(name)?.[1]?.toLowerCase()] ?? 'application/octet-stream';

function plainText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
    .trim();
}

const soundName = (text) => /\[sound:([^\]]+)\]/.exec(text ?? '')?.[1] ?? null;
const imageName = (text) => /<img[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(text ?? '')?.[1] ?? null;

// queue -1 is suspended; otherwise the card type decides (0 new, 1/3 learning, 2 review).
function cardState(info) {
  if (info.queue === -1) return 'suspended';
  if (info.type === 0) return 'new';
  if (info.type === 2) return 'review';
  return 'learn';
}

const FIELD_CHARS = 2000;

function wordFieldName(fields) {
  if (Object.hasOwn(fields, 'Word')) return 'Word';
  return Object.keys(fields).sort((a, b) => (fields[a]?.order ?? 0) - (fields[b]?.order ?? 0))[0];
}

function plainFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, plainText(field?.value).slice(0, FIELD_CHARS)]));
}

const truncatedFields = (fields) => Object.keys(fields).filter((name) => plainText(fields[name]?.value).length > FIELD_CHARS);

function reviewDays(info, today) {
  return today != null && info.type === 2 ? info.due - today : null;
}

function dayLabel(days) {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 0) return `overdue ${-days}d`;
  if (days <= 30) return `in ${days}d`;
  return `in ${Math.round(days / 30)}mo`;
}

function dueText(info, due, today) {
  if (info.queue === -1) return 'suspended';
  if (info.queue === -2 || info.queue === -3) return 'buried';
  if (info.type === 0) return `new #${info.due}`;
  if (info.type !== 2) return 'learning';
  const days = reviewDays(info, today);
  if (days === null) return due ? 'due' : 'scheduled';
  return dayLabel(days);
}

function toBrowseCard(info, dueIds, tags = [], today = null) {
  const fields = info.fields ?? {};
  const raw = (name) => (Object.hasOwn(fields, name) ? fields[name]?.value : undefined);
  const wordField = wordFieldName(fields);
  const id = info.cardId ?? info.id;
  const isNew = info.type === 0;
  return {
    id,
    word: plainText(wordField ? raw(wordField) : ''),
    reading: plainText(raw('Reading')),
    meaning: plainText(raw('Meaning')),
    sentence: plainText(raw('Sentence')),
    source: plainText(raw('Source')),
    state: cardState(info),
    due: dueIds.has(id),
    interval: info.interval ?? 0,
    ease: info.factor ? info.factor / 1000 : 0,
    easePct: isNew || !info.factor ? null : Math.round(info.factor / 10),
    reps: info.reps ?? 0,
    lapses: info.lapses ?? 0,
    audio: soundName(raw('Audio')),
    picture: imageName(raw('Picture')),
    noteId: info.note ?? null,
    deck: info.deckName ?? null,
    noteType: info.modelName ?? null,
    fields: plainFields(fields),
    fieldsTruncated: truncatedFields(fields),
    tags: [...tags],
    flag: info.flags ?? 0,
    marked: tags.includes('marked'),
    suspended: info.queue === -1,
    buried: info.queue === -2 || info.queue === -3,
    dueText: dueText(info, dueIds.has(id), today),
    dueDay: reviewDays(info, today),
    createdTs: info.note ?? null,
    modifiedTs: info.mod ? info.mod * 1000 : null,
  };
}

const SORTS = ['created', 'due', 'interval', 'ease', 'lapses', 'reps', 'modified', 'word', 'deck'];
const INFO_CHUNK = 500;

function normalizeSort(sort = 'created') {
  if (!SORTS.includes(sort)) throw new Error(`sort must be one of ${SORTS.join(', ')}`);
  return sort;
}

const clampOffset = (offset) => Math.max(0, Number.isFinite(offset) ? Math.floor(offset) : 0);

const scopeOf = (names) => (names.length === 1 ? exactDeck(names[0]) : deckScope(names));

async function cardInfos(client, ids) {
  const infos = [];
  for (let i = 0; i < ids.length; i += INFO_CHUNK) {
    infos.push(...((await client.invoke('cardsInfo', { cards: ids.slice(i, i + INFO_CHUNK) })) ?? []));
  }
  return infos;
}

// The collection day comes from the add-on; any failure leaves it unknown so browsing never fails on it.
async function collectionToday(client) {
  try {
    const day = await client.invoke('animeMineToday');
    return Number.isInteger(day?.today) ? day.today : null;
  } catch {
    return null;
  }
}

async function noteTags(client, infos) {
  const notes = [...new Set(infos.map((info) => info.note))];
  if (!notes.length) return new Map();
  const found = (await client.invoke('notesInfo', { notes })) ?? [];
  return new Map(found.map((note) => [note.noteId, note.tags ?? []]));
}

const sortValue = {
  interval: (info) => info.interval ?? 0,
  ease: (info) => info.factor ?? 0,
  lapses: (info) => info.lapses ?? 0,
  reps: (info) => info.reps ?? 0,
  modified: (info) => info.mod ?? 0,
  word: (info) => {
    const fields = info.fields ?? {};
    const name = wordFieldName(fields);
    return name ? plainText(fields[name]?.value) : '';
  },
  deck: (info) => info.deckName ?? '',
};

// Without the collection day, raw due order stands. With it, new cards come first by position, then learning, then review.
// A review card's due is a day number, so comparing raw due orders reviews by dueDay.
function dueRank(info, today) {
  if (today == null || info.type === 0) return 0;
  return info.type === 2 ? 2 : 1;
}

function compareDue(a, b, today) {
  return dueRank(a, today) - dueRank(b, today) || (a.due ?? 0) - (b.due ?? 0);
}

function compareValues(x, y) {
  return typeof x === 'string' ? x.localeCompare(y) : x - y;
}

function sortInfos(infos, sort, desc, today) {
  const key = sortValue[sort];
  const sign = desc ? -1 : 1;
  return infos.sort((a, b) => {
    const order = sort === 'due' ? compareDue(a, b, today) : compareValues(key(a), key(b));
    return order * sign || a.cardId - b.cardId;
  });
}

const forecastShape = (counts = []) =>
  Array.from({ length: FORECAST_DAYS }, (_, day) => ({ day, count: counts[day] ?? 0 }));

const REVIEW_WINDOW_DAYS = 365;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Local collection day as YYYY-MM-DD, the shape AnkiConnect uses for daily review counts.
function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function reviewsByDay(rows, today = new Date()) {
  if (!Array.isArray(rows)) return [];
  const end = dateKey(today);
  const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (REVIEW_WINDOW_DAYS - 1));
  const start = dateKey(startDate);
  const totals = new Map();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const [date, value] = row;
    if (typeof date !== 'string' || !DATE_KEY.test(date) || date < start || date > end) continue;
    const count = Math.floor(Number(value));
    if (!Number.isFinite(count) || count <= 0) continue;
    totals.set(date, (totals.get(date) ?? 0) + count);
  }
  return [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, count]) => ({ date, count }));
}

function normalizeDeckName(name) {
  const deck = typeof name === 'string' ? name.trim() : '';
  if (deck === '') throw new Error('name must be a non-empty string');
  return deck;
}

function emptyOverview() {
  return {
    decks: [],
    today: { studied: 0, due: 0, learning: 0, new: 0 },
    forecast: forecastShape(),
    retention30: null,
    streak: null,
    minedThisWeek: 0,
    reviewsByDay: [],
    mined: [],
  };
}

class AnkiBrowser {
  constructor(client) {
    this.client = client;
  }

  listDecks() {
    return this.client.invoke('deckNames');
  }

  // Runs several AnkiConnect actions in one HTTP request.
  async run(actions) {
    const results = await this.client.invoke('multi', {
      actions: actions.map(([action, params]) => ({ action, params })),
    });
    return results ?? [];
  }

  async overview({ decks = [], model }) {
    const names = [...new Set(decks)];
    if (!names.length) return emptyOverview();

    const scope = deckScope(names);
    const notes = `note:${quote(model)} ${scope}`;
    const actions = [];
    const slot = (query, action = 'findCards') => {
      actions.push([action, { query }]);
      return actions.length - 1;
    };

    const perDeck = names.map((name) => ({
      total: slot(exactDeck(name)),
      new: slot(`${exactDeck(name)} is:new`),
      learn: slot(`${exactDeck(name)} is:learn`),
      due: slot(`${exactDeck(name)} is:review is:due`),
    }));
    const studied = slot(`${scope} rated:1`);
    const dueNow = slot(`${scope} is:due`);
    // Day 0 folds in overdue reviews; prop:due is relative to today.
    const forecast = Array.from({ length: FORECAST_DAYS }, (_, day) =>
      slot(`${scope} is:review -is:suspended ${day === 0 ? 'prop:due<=0' : `prop:due=${day}`}`),
    );
    const minedThisWeek = slot(`${notes} added:7`, 'findNotes');
    const minedNotes = slot(notes, 'findNotes');

    const results = await this.run(actions);
    const count = (index) => (results[index] ?? []).length;
    const deckStats = names.map((name, i) => ({
      name,
      new: count(perDeck[i].new),
      learn: count(perDeck[i].learn),
      due: count(perDeck[i].due),
      total: count(perDeck[i].total),
    }));
    const sum = (key) => deckStats.reduce((acc, deck) => acc + deck[key], 0);
    const noteIds = [...(results[minedNotes] ?? [])].sort((a, b) => b - a).slice(0, MINED_LIMIT);

    return {
      decks: deckStats,
      today: { studied: count(studied), due: sum('due'), learning: sum('learn'), new: sum('new') },
      forecast: forecastShape(forecast.map((index) => count(index))),
      retention30: null,
      streak: null,
      minedThisWeek: count(minedThisWeek),
      reviewsByDay: await this.reviewActivity(),
      mined: await this.minedCards({ scope, names, noteIds, dueIds: new Set(results[dueNow] ?? []) }),
    };
  }

  // Collection-wide daily review counts for the last year. Older AnkiConnect builds may not know the action;
  // the heatmap is decoration, so a missing reply leaves an empty series instead of failing the overview.
  async reviewActivity() {
    try {
      return reviewsByDay(await this.client.invoke('getNumCardsReviewedByDay'));
    } catch {
      return [];
    }
  }

  async createDeck({ name } = {}) {
    const deck = normalizeDeckName(name);
    await this.client.invoke('createDeck', { deck });
    return { ok: true, name: deck };
  }

  async importPackage({ path } = {}) {
    if (typeof path !== 'string' || path.trim() === '') throw new Error('path must be a non-empty string');
    await this.client.invoke('importPackage', { path });
    return { imported: true, path };
  }

  async sync() {
    await this.client.invoke('sync');
    return { ok: true };
  }

  // One card per note (lowest ord), newest note first, only cards in allowed decks.
  async minedCards({ scope, names, noteIds, dueIds }) {
    if (!noteIds.length) return [];
    const cardIds = await this.client.invoke('findCards', { query: `${scope} nid:${noteIds.join(',')}` });
    const infos = cardIds?.length ? await this.client.invoke('cardsInfo', { cards: cardIds }) : [];
    const allowed = new Set(names);
    const best = new Map();
    for (const info of infos) {
      if (!allowed.has(info.deckName)) continue;
      const current = best.get(info.note);
      if (!current || info.ord < current.ord) best.set(info.note, info);
    }
    return noteIds
      .filter((id) => best.has(id))
      .map((id) => {
        const info = best.get(id);
        return { ...toBrowseCard(info, dueIds), deck: info.deckName };
      });
  }

  async browse({ deck, decks, query, state, limit, sort, desc = false, offset } = {}) {
    const names = typeof deck === 'string' && deck !== '' ? [deck] : Array.isArray(decks) ? [...new Set(decks)] : null;
    if (!names) throw new Error('deck is required');
    if (!names.length) return { cards: [], total: 0 };
    const cardState = normalizeState(state);
    const sortBy = normalizeSort(sort);
    const max = clampLimit(limit);
    const start = clampOffset(offset);
    const scope = scopeOf(names);
    const search = [scope, STATE_SEARCH[cardState], searchText(query)].filter(Boolean).join(' ');
    const [ids, due] = await this.run([
      ['findCards', { query: search }],
      ['findCards', { query: `${scope} is:due` }],
    ]);
    const today = await collectionToday(this.client);
    const matched = ids ?? [];
    const dueIds = new Set(due ?? []);
    const allowed = new Set(names);
    const keep = (info) => allowed.has(info.deckName);
    let page;
    let total = matched.length;
    if (sortBy === 'created') {
      const ordered = desc ? [...matched].reverse() : matched;
      const infos = await cardInfos(this.client, ordered.slice(start, start + max));
      page = infos.filter(keep);
      if (page.length !== infos.length) total = (await cardInfos(this.client, matched)).filter(keep).length;
    } else {
      const found = (await cardInfos(this.client, matched)).filter(keep);
      page = sortInfos(found, sortBy, desc, today).slice(start, start + max);
      total = found.length;
    }
    const tags = await noteTags(this.client, page);
    return {
      cards: page.map((info) => toBrowseCard(info, dueIds, tags.get(info.note), today)),
      total,
    };
  }

  async facets(args) {
    const actions = require('./ankiBrowseActions');
    return actions.facets(this.client, args);
  }

  async cardInfo(args) {
    const actions = require('./ankiBrowseActions');
    return actions.cardInfo(this.client, args);
  }

  async cardAction(args) {
    const actions = require('./ankiBrowseActions');
    return actions.cardAction(this.client, args);
  }

  async media(filename) {
    assertMediaName(filename);
    const data = await this.client.invoke('retrieveMediaFile', { filename });
    return data ? `data:${mimeType(filename)};base64,${data}` : null;
  }
}

module.exports = {
  AnkiBrowser,
  BROWSE_STATES,
  assertMediaName,
  cardInfos,
  clampLimit,
  collectionToday,
  dateKey,
  noteTags,
  normalizeState,
  plainFields,
  reviewsByDay,
  scopeOf,
  toBrowseCard,
  plainText,
};
