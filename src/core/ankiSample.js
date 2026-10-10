const { assertMediaName, clampLimit, normalizeState } = require('./ankiBrowse');

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

const toCard = (card) => ({
  id: card.id,
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
      streak: 6,
      minedThisWeek: CARDS.filter((card) => card.deck === MINING_DECK && card.ago <= 7).length,
      mined,
    };
  }

  async browse({ deck, query, state, limit } = {}) {
    const cardState = normalizeState(state);
    const max = clampLimit(limit);
    const text = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const cards = CARDS.filter(
      (card) =>
        (!deck || card.deck === deck) &&
        matchesState(card, cardState) &&
        (!text || [card.word, card.reading, card.meaning, card.sentence, card.source].some((field) => field.toLowerCase().includes(text))),
    );
    return { cards: cards.slice(0, max).map(toCard) };
  }

  async media(filename) {
    assertMediaName(filename);
    return null;
  }
}

module.exports = { SampleBrowser, SAMPLE_DECKS: DECKS };
