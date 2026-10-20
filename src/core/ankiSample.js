const { assertMediaName, clampLimit, dateKey, normalizeState } = require('./ankiBrowse');

// Fake data for the 'sample' view. Never touches AnkiConnect; ignores the allow-list.
const DECKS = ['Sample · Core 2k', 'Sample · Anime mining', 'Sample · Grammar', 'Sample · Kanji'];
const MINING_DECK = DECKS[1];
const FORECAST = [14, 9, 11, 7, 6, 12, 8, 5, 4, 10, 9, 6, 3, 7, 8, 5, 2, 4, 6, 3, 2, 5];

// ago: days since the note was mined (only used for the mined list).
const CARDS = [
  { id: 1001, deck: DECKS[0], word: '食べる', reading: 'たべる', meaning: 'to eat', sentence: '毎朝パンを食べる。', source: 'Core 2k (sample)', state: 'review', due: true, interval: 21, ease: 2.5, reps: 7, lapses: 1 },
  { id: 1002, deck: DECKS[0], word: '大きい', reading: 'おおきい', meaning: 'big, large', sentence: 'この部屋は思ったより大きい。', source: 'Core 2k (sample)', state: 'review', due: false, interval: 45, ease: 2.7, reps: 9, lapses: 0 },
  { id: 1003, deck: DECKS[0], word: '友達', reading: 'ともだち', meaning: 'friend', sentence: '彼は中学からの友達だ。', source: 'Core 2k (sample)', state: 'new', due: false, interval: 0, ease: 0, reps: 0, lapses: 0 },
  { id: 1004, deck: DECKS[0], word: '行く', reading: 'いく', meaning: 'to go', sentence: '明日、学校に行く。', source: 'Core 2k (sample)', state: 'suspended', due: false, interval: 3, ease: 2.3, reps: 4, lapses: 2 },
  { id: 1005, deck: MINING_DECK, word: '降る', reading: 'ふる', meaning: 'to fall (of rain)', sentence: '朝から雨が降ってる。', source: 'Sample Show S01E05', state: 'learn', due: true, interval: 0, ease: 2.5, reps: 2, lapses: 0, ago: 1 },
  { id: 1006, deck: MINING_DECK, word: '約束', reading: 'やくそく', meaning: 'promise', sentence: '絶対に約束を破らない。', source: 'Sample Show S01E07', state: 'review', due: true, interval: 6, ease: 2.4, reps: 3, lapses: 0, ago: 2 },
  { id: 1007, deck: MINING_DECK, word: '走る', reading: 'はしる', meaning: 'to run', sentence: '全力で走った。', source: 'Sample Show S01E02', state: 'new', due: false, interval: 0, ease: 0, reps: 0, lapses: 0, ago: 3 },
  { id: 1008, deck: MINING_DECK, word: '本気', reading: 'ほんき', meaning: 'seriousness, earnest', sentence: '本気で言ってるの？', source: 'Sample Show S01E09', state: 'learn', due: true, interval: 0, ease: 2.5, reps: 1, lapses: 0, ago: 5 },
  { id: 1009, deck: MINING_DECK, word: '見つける', reading: 'みつける', meaning: 'to find', sentence: '探していた鍵を見つけた。', source: 'Sample Show S01E04', state: 'review', due: false, interval: 14, ease: 2.6, reps: 4, lapses: 0, ago: 6 },
  { id: 1010, deck: DECKS[2], word: '〜ておく', reading: 'ておく', meaning: 'to do in advance', sentence: '明日のために準備しておく。', source: 'Grammar (sample)', state: 'review', due: true, interval: 9, ease: 2.5, reps: 3, lapses: 0 },
  { id: 1011, deck: DECKS[2], word: '〜ことにする', reading: 'ことにする', meaning: 'to decide to', sentence: '来月から勉強することにした。', source: 'Grammar (sample)', state: 'new', due: false, interval: 0, ease: 0, reps: 0, lapses: 0 },
  { id: 1012, deck: DECKS[3], word: '鬼', reading: 'おに', meaning: 'demon, ogre', sentence: '鬼が出た！', source: 'Kanji (sample)', state: 'review', due: false, interval: 30, ease: 2.8, reps: 8, lapses: 0 },
  { id: 1013, deck: DECKS[3], word: '心', reading: 'こころ', meaning: 'heart, mind', sentence: '心から感謝する。', source: 'Kanji (sample)', state: 'learn', due: false, interval: 0, ease: 2.5, reps: 1, lapses: 0 },
];

const SAMPLE_NOTE_TYPE = 'AnimeMine';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const SAMPLE_NOW = Date.UTC(2026, 9, 12);

// Seeded review history: 365 days of study, ending in the six-day streak the sample overview reports.
const REVIEW_WINDOW_DAYS = 365;
const REVIEW_SEED = 0x9e3779b9;
const SAMPLE_STREAK = 6;
const SAMPLE_TODAY_REVIEWS = 37;

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Midnight today, so the generated heatmap always has "today" in its last column.
function sampleToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function sampleReviewsByDay(today = sampleToday()) {
  const random = mulberry32(REVIEW_SEED);
  const rows = [];
  for (let ago = REVIEW_WINDOW_DAYS - 1; ago >= 0; ago--) {
    const roll = random();
    const weight = random();
    const spike = random();
    const date = dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - ago));
    if (ago < SAMPLE_STREAK) {
      rows.push({ date, count: ago === 0 ? SAMPLE_TODAY_REVIEWS : 12 + Math.round(weight * 24) });
      continue;
    }
    if (ago === SAMPLE_STREAK) continue; // a rest day keeps the current streak at exactly six days
    const chance = ago < 120 ? 0.78 : ago < 240 ? 0.64 : 0.5;
    if (ago !== REVIEW_WINDOW_DAYS - 1 && roll >= chance) continue;
    const count = 6 + Math.round(weight * 28) + (spike < 0.08 ? 20 + Math.round(spike * 200) : 0);
    rows.push({ date, count });
  }
  return rows;
}

const dueTextOf = (card) => {
  if (card.state === 'suspended') return 'suspended';
  if (card.state === 'new') return `new #${card.id % 100}`;
  if (card.state === 'learn') return 'learning';
  return card.due ? 'due' : 'scheduled';
};

const toCard = (card) => ({
  id: card.id,
  noteId: card.id + 5000,
  deck: card.deck,
  noteType: SAMPLE_NOTE_TYPE,
  fields: { Word: card.word, Reading: card.reading, Meaning: card.meaning, Sentence: card.sentence, Source: card.source },
  tags: card.state === 'learn' ? ['sample'] : [],
  flag: 0,
  marked: false,
  suspended: card.state === 'suspended',
  buried: false,
  easePct: card.state === 'new' ? null : Math.round(card.ease * 100),
  dueText: dueTextOf(card),
  createdTs: SAMPLE_NOW - (card.id % 100) * DAY,
  modifiedTs: SAMPLE_NOW - card.reps * MINUTE,
  word: card.word,
  reading: card.reading,
  meaning: card.meaning,
  sentence: card.sentence,
  source: card.source,
  state: card.state,
  due: card.due,
  interval: card.interval,
  ease: card.ease,
  reps: card.reps,
  lapses: card.lapses,
  audio: null,
  picture: null,
});

const SAMPLE_SORT = {
  created: (card) => card.id,
  due: (card) => (card.due ? 0 : 1),
  interval: (card) => card.interval,
  ease: (card) => card.ease,
  lapses: (card) => card.lapses,
  reps: (card) => card.reps,
  modified: (card) => card.reps,
  word: (card) => card.word,
  deck: (card) => card.deck,
};

const inDecks = (names) => (card) => !names || names.includes(card.deck);

const minedCards = () =>
  CARDS.filter((card) => card.deck === MINING_DECK)
    .sort((a, b) => a.ago - b.ago)
    .map((card) => ({ ...toCard(card), deck: card.deck }));

const matchesState = (card, state) => {
  if (state === 'all') return true;
  if (state === 'due') return card.due;
  return card.state === state;
};

const sumOf = (decks, key) => decks.reduce((acc, deck) => acc + deck[key], 0);

class SampleBrowser {
  async listDecks() {
    return [...DECKS];
  }

  async overview() {
    const decks = DECKS.map((name) => {
      const cards = CARDS.filter((card) => card.deck === name);
      return {
        name,
        new: cards.filter((card) => card.state === 'new').length,
        learn: cards.filter((card) => card.state === 'learn').length,
        due: cards.filter((card) => card.state === 'review' && card.due).length,
        total: cards.length,
      };
    });
    const mined = minedCards();
    return {
      decks,
      today: { studied: 37, due: sumOf(decks, 'due'), learning: sumOf(decks, 'learn'), new: sumOf(decks, 'new') },
      forecast: FORECAST.map((count, day) => ({ day, count })),
      retention30: 91,
      streak: SAMPLE_STREAK,
      minedThisWeek: CARDS.filter((card) => card.deck === MINING_DECK && card.ago <= 7).length,
      reviewsByDay: sampleReviewsByDay(),
      mined,
    };
  }

  async browse({ deck, decks, query, state, limit, sort = 'created', desc = false, offset = 0 } = {}) {
    const cardState = normalizeState(state);
    const max = clampLimit(limit);
    if (!Object.hasOwn(SAMPLE_SORT, sort)) throw new Error(`sort must be one of ${Object.keys(SAMPLE_SORT).join(', ')}`);
    const names = deck ? [deck] : decks ?? null;
    const text = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const matched = CARDS.filter(
      (card) =>
        inDecks(names)(card) &&
        matchesState(card, cardState) &&
        (!text || [card.word, card.reading, card.meaning, card.sentence, card.source].some((field) => field.toLowerCase().includes(text))),
    );
    const key = SAMPLE_SORT[sort];
    const sorted = [...matched].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const order = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return (desc ? -order : order) || a.id - b.id;
    });
    const start = Math.max(0, Math.floor(offset) || 0);
    return { cards: sorted.slice(start, start + max).map(toCard), total: matched.length };
  }

  async facets({ decks = [] } = {}) {
    const scoped = CARDS.filter(inDecks(decks));
    const count = (predicate) => scoped.filter(predicate).length;
    const saved = [
      { id: 'today', label: 'Today', query: 'added:1', count: count((c) => c.ago === 0) },
      { id: 'week', label: 'Added this week', query: 'added:7', count: count((c) => c.ago === undefined || c.ago <= 7) },
      { id: 'due', label: 'Due today', query: 'is:due', count: count((c) => c.due) },
      { id: 'flagged', label: 'Flagged', query: '-flag:0', count: 0 },
      { id: 'marked', label: 'Marked', query: 'tag:marked', count: 0 },
      { id: 'suspended', label: 'Suspended', query: 'is:suspended', count: count((c) => c.state === 'suspended') },
      { id: 'buried', label: 'Buried', query: 'is:buried', count: 0 },
      { id: 'leeches', label: 'Leeches', query: 'tag:leech', count: 0 },
      { id: 'failed', label: 'Failed today', query: 'rated:1:1', count: 0 },
    ];
    return {
      decks: decks.map((name) => {
        const cards = scoped.filter((c) => c.deck === name);
        return { name, total: cards.length, due: cards.filter((c) => c.due).length, new: cards.filter((c) => c.state === 'new').length };
      }),
      tags: [{ name: 'sample', count: count((c) => c.state === 'learn') }],
      noteTypes: [{ name: SAMPLE_NOTE_TYPE, count: scoped.length }],
      saved,
    };
  }

  async cardInfo({ cardId, decks } = {}) {
    const card = CARDS.find((c) => c.id === cardId);
    if (!card || !inDecks(decks)(card)) throw new Error('Card is not in a visible deck');
    const info = toCard(card);
    return {
      card: info,
      history: [],
      created: info.createdTs,
      firstReview: null,
      lastReview: null,
      averageTimeMs: null,
      totalTimeMs: null,
      note: { id: info.noteId, fields: info.fields, tags: info.tags },
    };
  }

  async media(filename) {
    assertMediaName(filename);
    return null;
  }
}

module.exports = { SampleBrowser, SAMPLE_DECKS: DECKS, sampleReviewsByDay };
