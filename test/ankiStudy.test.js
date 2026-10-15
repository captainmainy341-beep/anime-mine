const test = require('node:test')
const assert = require('node:assert/strict')
const {AnkiStudy} = require('../src/core/ankiStudy')

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

// Answers each findCards query from a map keyed by the exact query string.
function multiReplies(queries) {
  return {
    multi: ({actions}) => actions.map(({params}) => queries[params.query] ?? []),
  }
}

const card = (cardId, deckName, extra = {}) => ({
  cardId,
  deckName,
  question: `Q${cardId}`,
  answer: `A${cardId}`,
  fields: {},
  ...extra,
})

const PNG = Buffer.from('png').toString('base64')

test('queue orders learn, then review, then only the first newLimit new cards', async () => {
  const queries = {
    'deck:"Anime" is:learn is:due': [1, 2],
    'deck:"Anime" is:review is:due -is:suspended -is:buried': [3],
    'deck:"Anime" is:new -is:suspended -is:buried': [10, 11, 12, 13],
  }
  const infos = [13, 12, 11, 10, 3, 2, 1].map((id) => card(id, 'Anime'))
  const client = fakeClient({...multiReplies(queries), cardsInfo: () => infos})

  const {cards} = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime'], newLimit: 2})

  assert.deepEqual(cards.map((c) => c.id), [1, 2, 3, 10, 11])
  assert.deepEqual(client.calls.map((c) => c.action), ['multi', 'cardsInfo'])
  assert.deepEqual(client.calls[1].params.cards, [1, 2, 3, 10, 11])
})

test('queue never returns more than 50 cards', async () => {
  const queries = {
    'deck:"Anime" is:learn is:due': Array.from({length: 30}, (_, i) => i + 1),
    'deck:"Anime" is:review is:due -is:suspended -is:buried': Array.from({length: 30}, (_, i) => i + 100),
    'deck:"Anime" is:new -is:suspended -is:buried': Array.from({length: 40}, (_, i) => i + 1000),
  }
  const client = fakeClient({...multiReplies(queries), cardsInfo: ({cards}) => cards.map((id) => card(id, 'Anime'))})

  const {cards} = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime'], newLimit: 40})

  assert.equal(cards.length, 50)
  assert.equal(cards[29].id, 30)
  assert.equal(cards[30].id, 100)
  assert.equal(cards[49].id, 119)
})

test('queue defaults to 20 new cards', async () => {
  const queries = {'deck:"Anime" is:new -is:suspended -is:buried': Array.from({length: 40}, (_, i) => i + 1000)}
  const client = fakeClient({...multiReplies(queries), cardsInfo: ({cards}) => cards.map((id) => card(id, 'Anime'))})

  const {cards} = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime']})

  assert.equal(cards.length, 20)
  assert.equal(cards[19].id, 1019)
})

test('queue returns no cards and skips cardsInfo when nothing is due', async () => {
  const client = fakeClient({multi: () => [[], [], []]})

  assert.deepEqual(await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime']}), {cards: []})
  assert.deepEqual(client.calls.map((c) => c.action), ['multi'])
})

test('queue escapes quotes and backslashes in the deck name', async () => {
  const client = fakeClient({multi: () => [[], [], []]})

  await new AnkiStudy(client).queue({deck: 'Say "hi"\\There', allowedDecks: ['Say "hi"\\There']})

  const queries = client.calls[0].params.actions.map((a) => a.params.query)
  assert.equal(queries[0], 'deck:"Say \\"hi\\"\\\\There" is:learn is:due')
  assert.equal(queries[2], 'deck:"Say \\"hi\\"\\\\There" is:new -is:suspended -is:buried')
})

test('queue shows a subdeck only when the subdeck itself is visible', async () => {
  const queries = {
    'deck:"Anime" is:new -is:suspended -is:buried': [1, 2, 3, 4, 5],
  }
  const infos = [
    card(1, 'Anime'),
    card(2, 'Anime::Frieren'),
    card(3, 'Anime Extra'),
    card(4, 'Animeish::x'),
    card(5, 'Other'),
  ]
  const client = fakeClient({...multiReplies(queries), cardsInfo: () => infos})

  const hiddenChild = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime']})
  assert.deepEqual(hiddenChild.cards.map((c) => c.id), [1])

  const {cards} = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime', 'Anime::Frieren']})
  assert.deepEqual(cards.map((c) => c.id), [1, 2])
  assert.deepEqual(cards.map((c) => c.deck), ['Anime', 'Anime::Frieren'])
})

test('queue drops a card that appears in more than one query only once', async () => {
  const queries = {
    'deck:"Anime" is:learn is:due': [7],
    'deck:"Anime" is:review is:due -is:suspended -is:buried': [7],
  }
  const client = fakeClient({...multiReplies(queries), cardsInfo: () => [card(7, 'Anime')]})

  const {cards} = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime']})

  assert.deepEqual(cards.map((c) => c.id), [7])
  assert.deepEqual(client.calls[1].params.cards, [7])
})

test('queue inlines valid images once per name and strips scripts and sound tags', async () => {
  const html = [
    '<script>alert(1)</script>',
    '[sound:hello.mp3] Hi',
    '<img src="pic.png"> <img class="x" src=\'pic.png\'>',
    '[anki:play:q:0]',
  ].join(' ')
  const client = fakeClient({
    multi: () => [[1, 2], [], []],
    cardsInfo: () => [card(1, 'Anime', {question: html, answer: html}), card(2, 'Anime', {question: '<img src="pic.png">', answer: 'x'})],
    retrieveMediaFile: ({filename}) => (filename === 'pic.png' ? PNG : false),
  })

  const {cards} = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime']})

  const expected = `data:image/png;base64,${PNG}`
  assert.equal(cards[0].question.trim(), `Hi <img src="${expected}"> <img class="x" src="${expected}">`)
  assert.equal(cards[0].answer, cards[0].question)
  assert.equal(cards[1].question, `<img src="${expected}">`)
  assert.deepEqual(client.calls.filter((c) => c.action === 'retrieveMediaFile').map((c) => c.params.filename), ['pic.png'])
})

test('queue removes the src of missing or invalid image files without fetching invalid names', async () => {
  const client = fakeClient({
    multi: () => [[1], [], []],
    cardsInfo: () => [card(1, 'Anime', {question: '<img src="gone.jpg"> <img src="../etc/passwd"> <img alt="none">', answer: ''})],
    retrieveMediaFile: () => false,
  })

  const {cards} = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime']})

  assert.equal(cards[0].question, '<img> <img> <img alt="none">')
  assert.deepEqual(client.calls.filter((c) => c.action === 'retrieveMediaFile').map((c) => c.params.filename), ['gone.jpg'])
})

test('queue returns the first valid sound by field order and null for invalid names', async () => {
  const fields = (sound) => ({
    Sentence: {value: 'plain', order: 1},
    Audio: {value: sound, order: 0},
  })
  const client = fakeClient({
    multi: () => [[1, 2, 3], [], []],
    cardsInfo: () => [
      card(1, 'Anime', {fields: {Sentence: {value: '[sound:b.mp3]', order: 1}, Audio: {value: '[sound:a.mp3]', order: 0}}}),
      card(2, 'Anime', {fields: fields('[sound:../x.mp3]')}),
      card(3, 'Anime', {fields: {Plain: {value: 'nothing', order: 0}}, css: '.x{}', nextReviews: ['1d', '2d', '3d', '4d']}),
    ],
  })

  const {cards} = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime']})

  assert.equal(cards[0].audio, 'a.mp3')
  assert.equal(cards[1].audio, null)
  assert.equal(cards[2].audio, null)
  assert.equal(cards[2].css, '.x{}')
  assert.deepEqual(cards[2].intervals, ['1d', '2d', '3d', '4d'])
})

test('queue defaults css to empty and intervals to empty unless there are exactly four strings', async () => {
  const client = fakeClient({
    multi: () => [[1, 2], [], []],
    cardsInfo: () => [
      card(1, 'Anime', {css: 3, nextReviews: ['1d', '2d']}),
      card(2, 'Anime', {nextReviews: ['1d', 2, '3d', '4d']}),
    ],
  })

  const {cards} = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime']})

  assert.deepEqual(cards.map((c) => [c.css, c.intervals]), [['', []], ['', []]])
})

test('answer rejects an ease outside 1-4 or a non-positive card id before contacting Anki', async () => {
  const client = fakeClient({})
  const study = new AnkiStudy(client)

  for (const ease of [0, 5, 2.5, '3', undefined]) {
    await assert.rejects(study.answer({cardId: 1, ease, allowedDecks: ['Anime']}), {message: 'ease must be 1-4'})
  }
  for (const cardId of [0, -1, 1.5, '1', undefined]) {
    await assert.rejects(study.answer({cardId, ease: 3, allowedDecks: ['Anime']}), /cardId must be a positive integer/)
  }
  assert.deepEqual(client.calls, [])
})

test('answer throws when the card does not exist', async () => {
  const client = fakeClient({cardsInfo: () => []})

  await assert.rejects(new AnkiStudy(client).answer({cardId: 9, ease: 3, allowedDecks: ['Anime']}), {message: 'Card not found'})
  assert.deepEqual(client.calls.map((c) => c.action), ['cardsInfo'])
})

test('answer refuses a card outside the allowed decks', async () => {
  const client = fakeClient({cardsInfo: () => [card(4, 'Secret::Deck')], answerCards: () => [true]})

  await assert.rejects(new AnkiStudy(client).answer({cardId: 4, ease: 3, allowedDecks: ['Anime']}), {message: 'Deck is hidden'})
  await assert.rejects(new AnkiStudy(client).answer({cardId: 4, ease: 3, allowedDecks: ['Anim']}), {message: 'Deck is hidden'})
  assert.deepEqual(client.calls.map((c) => c.action), ['cardsInfo', 'cardsInfo'])
})

test('answer refuses a subdeck that is not itself visible and posts the answer for an exactly visible deck', async () => {
  const client = fakeClient({cardsInfo: () => [card(4, 'Anime::Frieren')], answerCards: () => [true]})

  await assert.rejects(new AnkiStudy(client).answer({cardId: 4, ease: 3, allowedDecks: ['Anime']}), {message: 'Deck is hidden'})
  assert.deepEqual(client.calls.map((c) => c.action), ['cardsInfo'])

  assert.deepEqual(await new AnkiStudy(client).answer({cardId: 4, ease: 3, allowedDecks: ['Anime', 'Anime::Frieren']}), {ok: true})
  assert.deepEqual(client.calls[2], {action: 'answerCards', params: {answers: [{cardId: 4, ease: 3}]}})
})

test('answer throws when Anki does not accept the answer', async () => {
  for (const result of [[false], [], [true, true], null]) {
    const client = fakeClient({cardsInfo: () => [card(4, 'Anime')], answerCards: () => result})
    await assert.rejects(new AnkiStudy(client).answer({cardId: 4, ease: 3, allowedDecks: ['Anime']}), {message: 'Anki did not accept the answer'})
  }
})

test('native queue drops cards outside the visible list, including a hidden subdeck', async () => {
  const client = fakeClient({cardsInfo: () => [card(1, 'Anime'), card(2, 'Anime::Hidden')]})

  const {cards} = await new AnkiStudy(client).queue({deck: 'Anime', allowedDecks: ['Anime'], native: {cardIds: [1, 2], intervals: ['1m', '6m', '1d', '4d']}})

  assert.deepEqual(cards.map((c) => c.id), [1])
})
