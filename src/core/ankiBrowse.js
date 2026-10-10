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

function searchText(query) {
  const text = typeof query === 'string' ? query.trim() : '';
  return text ? quote(text) : '';
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

function toBrowseCard(info, dueIds) {
  const fields = info.fields ?? {};
  const raw = (name) => (Object.hasOwn(fields, name) ? fields[name]?.value : undefined);
  const ordered = Object.keys(fields).sort((a, b) => (fields[a]?.order ?? 0) - (fields[b]?.order ?? 0));
  const wordField = raw('Word') !== undefined ? 'Word' : ordered[0];
  const id = info.cardId ?? info.id;
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
    reps: info.reps ?? 0,
    lapses: info.lapses ?? 0,
    audio: soundName(raw('Audio')),
    picture: imageName(raw('Picture')),
  };
}

const forecastShape = (counts = []) =>
  Array.from({ length: FORECAST_DAYS }, (_, day) => ({ day, count: counts[day] ?? 0 }));

function emptyOverview() {
  return {
    decks: [],
    today: { studied: 0, due: 0, learning: 0, new: 0 },
    forecast: forecastShape(),
    retention30: null,
    streak: null,
    minedThisWeek: 0,
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
      mined: await this.minedCards({ scope, names, noteIds, dueIds: new Set(results[dueNow] ?? []) }),
    };
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

  async browse({ deck, query, state, limit } = {}) {
    if (typeof deck !== 'string' || deck === '') throw new Error('deck is required');
    const cardState = normalizeState(state);
    const max = clampLimit(limit);
    const scope = exactDeck(deck);
    const search = [scope, STATE_SEARCH[cardState], searchText(query)].filter(Boolean).join(' ');
    const [ids, due] = await this.run([
      ['findCards', { query: search }],
      ['findCards', { query: `${scope} is:due` }],
    ]);
    const page = (ids ?? []).slice(0, max);
    if (!page.length) return { cards: [] };
    const infos = await this.client.invoke('cardsInfo', { cards: page });
    const dueIds = new Set(due ?? []);
    return { cards: infos.filter((info) => info.deckName === deck).map((info) => toBrowseCard(info, dueIds)) };
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
  clampLimit,
  normalizeState,
  toBrowseCard,
  plainText,
};
