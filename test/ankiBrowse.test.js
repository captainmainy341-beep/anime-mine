const test = require('node:test')
const assert = require('node:assert/strict')
const {AnkiBrowser} = require('../src/core/ankiBrowse')
const {SampleBrowser} = require('../src/core/ankiSample')

// Fake AnkiClient: records every invoke and answers from a replies table.
function fakeClient(replies = {}) {
  const calls = []
  return {
    calls,
    async invoke(action, params = {}) {
      calls.push({action, params})
      const reply = replies[action]
      if (reply === undefined) throw new Error(`no reply for ${action}`)
      return typeof reply === 'function' ? reply(params) : reply
    },
  }
}

const queriesOf = calls => calls.flatMap(({action, params}) =>
  action === 'multi' ? params.actions.map(a => a.params.query) : [params.query]).filter(q => typeof q === 'string')

test('listDecks asks AnkiConnect for deckNames', async () => {
  const client = fakeClient({deckNames: () => ['Core', 'Anime']})
  assert.deepEqual(await new AnkiBrowser(client).listDecks(), ['Core', 'Anime'])
  assert.deepEqual(client.calls.map(c => c.action), ['deckNames'])
})

const INFO = {
  1: {
    cardId: 1, note: 10, ord: 0, deckName: 'Anime Mining',
    fields: {
      Word: {value: '降る', order: 0},
      Reading: {value: 'ふる', order: 1},
      Meaning: {value: 'to fall<br>(rain)', order: 2},
      Sentence: {value: '雨が<b>降ってる</b>', order: 3},
      SentenceTranslation: {value: 'It is raining.', order: 4},
      Notes: {value: '', order: 5},
      Audio: {value: '[sound:am_1.mp3]', order: 6},
      Picture: {value: '<img src="am_1.jpg">', order: 7},
      Source: {value: 'Show S01E05', order: 8},
    },
    type: 2, queue: 2, interval: 12, factor: 2500, reps: 5, lapses: 1,
  },
  2: {cardId: 2, note: 11, ord: 0, deckName: 'Anime Mining', fields: {Word: {value: 'a&amp;b', order: 0}}, type: 0, queue: 0, interval: 0, factor: 0, reps: 0, lapses: 0},
  3: {cardId: 3, note: 12, ord: 0, deckName: 'Anime Mining', fields: {Word: {value: 'x', order: 0}}, type: 1, queue: -1, interval: 2, factor: 2300, reps: 1, lapses: 0},
}

test('browse scopes to the exact deck, escapes free text and maps card fields', async () => {
  const client = fakeClient({
    multi: ({actions}) => actions.map(a => (a.params.query.endsWith('is:due') ? [1] : [1, 2, 3])),
    cardsInfo: ({cards}) => cards.map(id => INFO[id]),
  })
  const {cards} = await new AnkiBrowser(client).browse({deck: 'Anime Mining', query: 'a"b*c_d:e\\f', limit: 10})

  const [find] = client.calls[0].params.actions
  assert.equal(find.params.query, '(deck:"Anime Mining" -deck:"Anime Mining::*") "a\\"b\\*c\\_d\\:e\\\\f"')
  assert.deepEqual(cards, [
    {
      id: 1, word: '降る', reading: 'ふる', meaning: 'to fall\n(rain)', sentence: '雨が降ってる',
      source: 'Show S01E05', state: 'review', due: true, interval: 12, ease: 2.5, reps: 5, lapses: 1,
      audio: 'am_1.mp3', picture: 'am_1.jpg',
    },
    {
      id: 2, word: 'a&b', reading: '', meaning: '', sentence: '', source: '', state: 'new', due: false,
      interval: 0, ease: 0, reps: 0, lapses: 0, audio: null, picture: null,
    },
    {
      id: 3, word: 'x', reading: '', meaning: '', sentence: '', source: '', state: 'suspended', due: false,
      interval: 2, ease: 2.3, reps: 1, lapses: 0, audio: null, picture: null,
    },
  ])
})

test('browse cannot be widened by a query that tries to name another deck', async () => {
  const client = fakeClient({multi: () => [[], []]})
  await new AnkiBrowser(client).browse({deck: 'Visible', query: 'x" OR deck:"Hidden'})
  const query = client.calls[0].params.actions[0].params.query
  assert.equal(query, '(deck:"Visible" -deck:"Visible::*") "x\\" OR deck\\:\\"Hidden"')
  assert.equal(client.calls.length, 1)
})

test('browse applies the state filter and clamps the limit to 1..500 (default 200)', async () => {
  const many = Array.from({length: 600}, (_, i) => i + 1)
  const infoFor = ({cards}) => cards.map(id => ({cardId: id, deckName: 'D', fields: {}, type: 0, queue: 0}))

  const low = fakeClient({multi: () => [[1, 2, 3], []], cardsInfo: infoFor})
  await new AnkiBrowser(low).browse({deck: 'D', state: 'learn', limit: 0})
  assert.equal(low.calls[0].params.actions[0].params.query, '(deck:"D" -deck:"D::*") is:learn')
  assert.deepEqual(low.calls[1].params.cards, [1])

  const high = fakeClient({multi: () => [many, []], cardsInfo: infoFor})
  await new AnkiBrowser(high).browse({deck: 'D', limit: 9999})
  assert.equal(high.calls[1].params.cards.length, 500)

  const dflt = fakeClient({multi: () => [many.slice(0, 250), []], cardsInfo: infoFor})
  await new AnkiBrowser(dflt).browse({deck: 'D'})
  assert.equal(dflt.calls[1].params.cards.length, 200)
})

test('browse rejects unknown states and a missing deck without calling AnkiConnect', async () => {
  const client = fakeClient({multi: () => [[], []]})
  const browser = new AnkiBrowser(client)
  await assert.rejects(browser.browse({deck: 'D', state: 'everything'}), /state must be one of/)
  await assert.rejects(browser.browse({query: 'x'}), /deck is required/)
  assert.equal(client.calls.length, 0)
})

test('overview with an empty allow-list makes no requests and returns zero totals', async () => {
  const client = fakeClient()
  const overview = await new AnkiBrowser(client).overview({decks: [], model: 'AnimeMine'})

  assert.equal(client.calls.length, 0)
  assert.deepEqual(overview.decks, [])
  assert.deepEqual(overview.today, {studied: 0, due: 0, learning: 0, new: 0})
  assert.equal(overview.forecast.length, 22)
  assert.ok(overview.forecast.every(f => f.count === 0))
  assert.equal(overview.retention30, null)
  assert.equal(overview.streak, null)
  assert.equal(overview.minedThisWeek, 0)
  assert.deepEqual(overview.mined, [])
})

test('overview counts only the allowed decks and lists mined cards newest first', async () => {
  const COUNTS = {Core: {total: 10, new: 2, learn: 1, due: 3}, Anime: {total: 5, new: 1, learn: 0, due: 2}}
  const answer = ({action, params}) => {
    const q = params.query
    if (action === 'findNotes') return q.includes('added:7') ? [10, 20] : [10, 20, 30]
    if (q.includes('nid:')) return [101, 201, 202, 301]
    if (q.includes('prop:due')) {
      const day = Number(/prop:due(?:<=|=)(\d+)/.exec(q)[1])
      return Array.from({length: day + 1}, (_, i) => i)
    }
    if (q.includes('rated:1')) return [1, 2, 3, 4, 5]
    if (!q.includes(' OR ')) {
      const deck = /^\(deck:"([^"]+)"/.exec(q)[1]
      const key = q.includes('is:new') ? 'new' : q.includes('is:learn') ? 'learn' : q.includes('is:due') ? 'due' : 'total'
      return Array.from({length: COUNTS[deck][key]}, (_, i) => i)
    }
    return []
  }
  const infos = {
    101: {cardId: 101, note: 10, ord: 0, deckName: 'Core', fields: {Word: {value: '食べる', order: 0}, Meaning: {value: 'to eat', order: 1}}, type: 2, queue: 2, interval: 3, factor: 2300, reps: 2, lapses: 0},
    201: {cardId: 201, note: 20, ord: 0, deckName: 'Anime', fields: {Word: {value: '約束', order: 0}}, type: 2, queue: 2, interval: 6, factor: 2400, reps: 3, lapses: 0},
    202: {cardId: 202, note: 20, ord: 1, deckName: 'Anime', fields: {Word: {value: 'second', order: 0}}, type: 0, queue: 0, interval: 0, factor: 0, reps: 0, lapses: 0},
    301: {cardId: 301, note: 30, ord: 0, deckName: 'Hidden', fields: {Word: {value: 'secret', order: 0}}, type: 2, queue: 2, interval: 1, factor: 2500, reps: 1, lapses: 0},
  }
  const client = fakeClient({
    multi: ({actions}) => actions.map(a => answer({action: a.action, params: a.params})),
    findCards: ({query}) => answer({action: 'findCards', params: {query}}),
    cardsInfo: ({cards}) => cards.map(id => infos[id]),
  })

  const overview = await new AnkiBrowser(client).overview({decks: ['Core', 'Anime'], model: 'AnimeMine'})

  assert.deepEqual(overview.decks, [
    {name: 'Core', new: 2, learn: 1, due: 3, total: 10},
    {name: 'Anime', new: 1, learn: 0, due: 2, total: 5},
  ])
  assert.deepEqual(overview.today, {studied: 5, due: 5, learning: 1, new: 3})
  assert.equal(overview.forecast.length, 22)
  assert.deepEqual(overview.forecast[0], {day: 0, count: 1})
  assert.deepEqual(overview.forecast[3], {day: 3, count: 4})
  assert.equal(overview.minedThisWeek, 2)
  assert.deepEqual(overview.mined.map(card => [card.id, card.deck]), [[201, 'Anime'], [101, 'Core']])
  assert.equal(overview.mined[0].word, '約束')
  assert.ok(queriesOf(client.calls).every(q => !q.includes('Hidden')), 'no request may mention a hidden deck')
  assert.ok(client.calls.some(c => c.action === 'findCards' && c.params.query.includes('nid:30,20,10')))
})

test('media returns a data URL with a MIME type from the extension, or null when missing', async () => {
  const client = fakeClient({retrieveMediaFile: ({filename}) => (filename === 'clip.mp3' ? 'AAEC' : false)})
  const browser = new AnkiBrowser(client)
  assert.equal(await browser.media('clip.mp3'), 'data:audio/mpeg;base64,AAEC')
  assert.equal(await browser.media('missing.jpg'), null)
})

test('media rejects path-like filenames before calling AnkiConnect', async () => {
  const client = fakeClient({retrieveMediaFile: () => 'AAEC'})
  const browser = new AnkiBrowser(client)
  for (const name of ['../x.mp3', 'a/b.mp3', 'a\\b.jpg', '..', 'x..y', '', 'a\u0000b.png']) {
    await assert.rejects(browser.media(name), /Invalid media filename/, name)
  }
  assert.equal(client.calls.length, 0)
})

test('sample browser needs no client and returns deterministic data in the browse shape', async () => {
  const sample = new SampleBrowser()
  const first = await sample.overview({decks: [], model: 'AnimeMine'})
  assert.deepEqual(first, await sample.overview({decks: ['anything'], model: 'AnimeMine'}))
  assert.equal(first.decks.length, 4)
  assert.equal(first.forecast.length, 22)
  assert.ok(first.mined.length > 0 && first.mined.length <= 24)
  assert.deepEqual(Object.keys(first.mined[0]).sort(), [
    'audio', 'deck', 'due', 'ease', 'id', 'interval', 'lapses', 'meaning', 'picture',
    'reading', 'reps', 'sentence', 'source', 'state', 'word',
  ])

  const decks = await sample.listDecks()
  assert.equal(decks.length, 4)
  const {cards} = await sample.browse({deck: decks[0], state: 'due'})
  assert.ok(cards.length > 0 && cards.every(c => c.due))
  assert.deepEqual((await sample.browse({deck: decks[0], query: '食べ'})).cards.map(c => c.word), ['食べる'])
  assert.equal(await sample.media('clip.mp3'), null)
  await assert.rejects(sample.media('../clip.mp3'), /Invalid media filename/)
})

test('forecast queries leave out suspended cards', async () => {
  const queries = []
  const client = {
    invoke: async (action, params) => {
      if (action === 'multi') {
        for (const a of params.actions) queries.push(a.params.query)
        return params.actions.map(() => [])
      }
      return []
    },
  }
  await new AnkiBrowser(client).overview({decks: ['Core'], model: 'AnimeMine'})
  const forecast = queries.filter((q) => q.includes('prop:due'))
  assert.equal(forecast.length, 22)
  assert.ok(forecast.every((q) => q.includes('-is:suspended')))
})
