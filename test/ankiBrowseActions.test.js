const test = require('node:test')
const assert = require('node:assert/strict')
const {cardAction, cardInfo, facets} = require('../src/core/ankiBrowseActions')
const {BRIDGE_MESSAGE} = require('../src/core/ankiDeckOptions')

const READS = new Set(['cardsInfo', 'findCards', 'multi', 'notesInfo', 'getReviewsOfCards'])

// Fake AnkiClient: answers reads from fixtures, records every call, and makes writes fail loudly if unexpected.
function fakeClient({cards = {}, replies = {}} = {}) {
  const calls = []
  return {
    calls,
    writes: () => calls.filter(c => !READS.has(c.action)),
    async invoke(action, params = {}) {
      calls.push({action, params})
      if (action === 'cardsInfo') return params.cards.map(id => cards[id]).filter(Boolean)
      const reply = replies[action]
      if (reply === undefined) return action === 'multi' ? params.actions.map(() => []) : []
      return typeof reply === 'function' ? reply(params) : reply
    },
  }
}

const VISIBLE = {cardId: 1, note: 10, deckName: 'Visible', fields: {}, type: 2, queue: 2}
const HIDDEN = {cardId: 2, note: 20, deckName: 'Hidden', fields: {}, type: 2, queue: 2}
const DECKS = ['Visible']

const WRITE_CASES = [
  ['suspend', {}],
  ['unsuspend', {}],
  ['flag', {flag: 3}],
  ['bury', {}],
  ['unbury', {}],
  ['mark', {}],
  ['unmark', {}],
  ['addTags', {tags: ['leech']}],
  ['removeTags', {tags: ['leech']}],
  ['changeDeck', {deck: 'Visible'}],
  ['forget', {}],
  ['setDueDate', {days: '3'}],
  ['deleteNotes', {confirm: true}],
]

for (const [action, args] of WRITE_CASES) {
  test(`${action} refuses a card from a hidden deck before any write`, async () => {
    const client = fakeClient({cards: {1: VISIBLE, 2: HIDDEN}})
    await assert.rejects(cardAction(client, {action, cardIds: [1, 2], args, decks: DECKS}), /Card is not in a visible deck/)
    assert.deepEqual(client.writes(), [])
  })
}

test('note-level writes refuse a note with a sibling card in a hidden deck before any write', async () => {
  for (const action of ['mark', 'unmark', 'addTags', 'removeTags', 'deleteNotes']) {
    const client = fakeClient({
      cards: {1: VISIBLE, 3: {cardId: 3, note: 10, deckName: 'Hidden', fields: {}, type: 2, queue: 2}},
      replies: {findCards: () => [1, 3]},
    })
    await assert.rejects(cardAction(client, {action, cardIds: [1], args: {tags: ['leech'], confirm: true}, decks: DECKS}), /Deck is hidden/)
    assert.deepEqual(client.writes(), [])
    assert.deepEqual(client.calls.find(c => c.action === 'findCards').params, {query: 'nid:10'})
  }
})

test('note-level sibling lookup is chunked by note and covers every note of the selection', async () => {
  const cards = Object.fromEntries(Array.from({length: 101}, (_, i) => [i + 1, {cardId: i + 1, note: (i + 1) * 10, deckName: 'Visible', fields: {}, type: 2, queue: 2}]))
  const client = fakeClient({cards, replies: {findCards: ({query}) => query.split(' or ').map(part => Number(part.slice(4)) / 10)}})
  await cardAction(client, {action: 'mark', cardIds: Object.keys(cards).map(Number), decks: DECKS})
  const lookups = client.calls.filter(c => c.action === 'findCards').map(c => c.params.query.split(' or '))
  assert.deepEqual(lookups.map(parts => parts.length), [100, 1])
  assert.deepEqual(client.writes().map(c => c.params.notes.length), [101])
})

test('changeDeck refuses a target deck that is not visible', async () => {
  const client = fakeClient({cards: {1: VISIBLE}})
  await assert.rejects(cardAction(client, {action: 'changeDeck', cardIds: [1], args: {deck: 'Hidden'}, decks: DECKS}), /Deck is hidden/)
  assert.deepEqual(client.writes(), [])
})

test('actions refuse more than 500 cards or an empty list without reading or writing', async () => {
  const client = fakeClient()
  const many = Array.from({length: 501}, (_, i) => i + 1)
  await assert.rejects(cardAction(client, {action: 'suspend', cardIds: many, decks: DECKS}), /at most 500/)
  await assert.rejects(cardAction(client, {action: 'suspend', cardIds: [], decks: DECKS}), /at least one card/)
  assert.equal(client.calls.length, 0)
})

test('a guard that fails stops the write after the card lookup', async () => {
  const client = fakeClient({cards: {1: VISIBLE}})
  const guard = async () => {
    throw new Error('Anki connection or visible decks changed. Start a new session.')
  }
  await assert.rejects(cardAction(client, {action: 'suspend', cardIds: [1], decks: DECKS, guard}), /visible decks changed/)
  assert.deepEqual(client.writes(), [])
})

test('tag actions trim, reject whitespace and enforce count and length limits', async () => {
  const client = fakeClient({cards: {1: VISIBLE}})
  await cardAction(client, {action: 'addTags', cardIds: [1], args: {tags: [' leech ', 'hard']}, decks: DECKS})
  assert.deepEqual(client.calls.at(-1), {action: 'addTags', params: {notes: [10], tags: 'leech hard'}})
  for (const tags of [['two words'], ['x'.repeat(101)], Array.from({length: 21}, (_, i) => `t${i}`), [], ['']]) {
    await assert.rejects(cardAction(client, {action: 'addTags', cardIds: [1], args: {tags}, decks: DECKS}), /tags|Tags|tag/)
  }
})

test('mark and unmark use the marked tag on each card note', async () => {
  const client = fakeClient({cards: {1: VISIBLE}})
  await cardAction(client, {action: 'mark', cardIds: [1], decks: DECKS})
  await cardAction(client, {action: 'unmark', cardIds: [1], decks: DECKS})
  assert.deepEqual(client.writes().map(c => [c.action, c.params]), [
    ['addTags', {notes: [10], tags: 'marked'}],
    ['removeTags', {notes: [10], tags: 'marked'}],
  ])
})

test('setDueDate, flag and deleteNotes validate their arguments', async () => {
  const client = fakeClient({cards: {1: VISIBLE}})
  for (const days of ['3-', 'x', '', '1.5', '2-5-6']) {
    await assert.rejects(cardAction(client, {action: 'setDueDate', cardIds: [1], args: {days}, decks: DECKS}), /days must look like/)
  }
  for (const flag of [8, -1, '2', 1.5]) {
    await assert.rejects(cardAction(client, {action: 'flag', cardIds: [1], args: {flag}, decks: DECKS}), /flag must be an integer 0-7/)
  }
  await assert.rejects(cardAction(client, {action: 'deleteNotes', cardIds: [1], args: {}, decks: DECKS}), /needs confirmation/)
  assert.deepEqual(client.writes(), [])
})

test('deleteNotes resolves the notes from the cards and runs once confirmed', async () => {
  const client = fakeClient({cards: {1: VISIBLE}})
  await cardAction(client, {action: 'deleteNotes', cardIds: [1], args: {confirm: true}, decks: DECKS})
  assert.deepEqual(client.writes(), [{action: 'deleteNotes', params: {notes: [10]}}])
})

test('flag, bury and unbury go through the bridge and report a missing add-on clearly', async () => {
  const client = fakeClient({cards: {1: VISIBLE}, replies: {animeMineCardAction: () => ({ok: true})}})
  await cardAction(client, {action: 'flag', cardIds: [1], args: {flag: 2}, decks: DECKS})
  assert.deepEqual(client.writes().at(-1), {action: 'animeMineCardAction', params: {action: 'flag', cardIds: [1], args: {flag: 2}}})

  for (const action of ['flag', 'bury', 'unbury']) {
    const missing = fakeClient({cards: {1: VISIBLE}, replies: {animeMineCardAction: () => { throw new Error('unsupported action animeMineCardAction') }}})
    await assert.rejects(cardAction(missing, {action, cardIds: [1], args: {flag: 1}, decks: DECKS}), {message: BRIDGE_MESSAGE})
  }
})

test('unknown actions are refused without any request', async () => {
  const client = fakeClient()
  await assert.rejects(cardAction(client, {action: 'deleteCollection', cardIds: [1], decks: DECKS}), /Unsupported card action/)
  assert.equal(client.calls.length, 0)
})

test('cardInfo returns history and note for a visible card and refuses a hidden one', async () => {
  const client = fakeClient({
    cards: {1: {...VISIBLE, note: 10, fields: {Word: {value: '<b>降る</b>', order: 0}}, factor: 2500, interval: 6, reps: 2}},
    replies: {
      getReviewsOfCards: () => ({1: [{id: 1000, ease: 3, ivl: 1, lastIvl: 0, type: 0, time: 4000}, {id: 2000, ease: 3, ivl: 6, lastIvl: 1, type: 1, time: 2000}]}),
      findCards: () => [],
      notesInfo: () => [{noteId: 10, tags: ['marked'], fields: {Word: {value: '<b>降る</b>'}}}],
    },
  })
  const info = await cardInfo(client, {cardId: 1, decks: DECKS})
  assert.equal(info.card.word, '降る')
  assert.equal(info.card.marked, true)
  assert.equal(info.card.easePct, 250)
  assert.deepEqual(info.history.map(h => h.interval), [1, 6])
  assert.equal(info.firstReview, 1000)
  assert.equal(info.lastReview, 2000)
  assert.equal(info.averageTimeMs, 3000)
  assert.equal(info.totalTimeMs, 6000)
  assert.deepEqual(info.note, {id: 10, fields: {Word: '降る'}, tags: ['marked']})

  const hidden = fakeClient({cards: {2: HIDDEN}})
  await assert.rejects(cardInfo(hidden, {cardId: 2, decks: DECKS}), /Card is not in a visible deck/)
  assert.deepEqual(hidden.calls.map(c => c.action), ['cardsInfo'])
})

test('facets only query the allowed decks and never ask for global tags or note types', async () => {
  const forbidden = ['getTags', 'modelNames']
  const client = fakeClient({
    replies: {
      findNotes: () => [10],
      notesInfo: () => [{noteId: 10, tags: ['leech', 'marked'], modelName: 'AnimeMine'}],
      multi: ({actions}) => actions.map(() => [1]),
    },
  })
  const result = await facets(client, {decks: ['Visible', 'Other']})
  assert.deepEqual(result.decks.map(d => d.name), ['Visible', 'Other'])
  assert.equal(result.saved.length, 9)
  assert.deepEqual(result.tags, [{name: 'leech', count: 1}, {name: 'marked', count: 1}])
  assert.deepEqual(result.noteTypes, [{name: 'AnimeMine', count: 1}])
  for (const call of client.calls) assert.ok(!forbidden.includes(call.action))
  const queries = client.calls.filter(c => c.action === 'multi').flatMap(c => c.params.actions.map(a => a.params.query))
  assert.ok(queries.every(q => !q.includes('Hidden')))
  assert.ok(client.calls.find(c => c.action === 'findNotes').params.query.includes('deck:"Visible"'))
})

test('cardInfo labels the due day from the add-on and falls back when the add-on is missing', async () => {
  const cards = {1: {...VISIBLE, type: 2, queue: 2, due: 105}}
  const withDay = fakeClient({cards, replies: {animeMineToday: () => ({today: 100, cutoff: 0})}})
  assert.equal((await cardInfo(withDay, {cardId: 1, decks: DECKS})).card.dueText, 'in 5d')
  assert.equal((await cardInfo(withDay, {cardId: 1, decks: DECKS})).card.dueDay, 5)

  const missing = fakeClient({cards, replies: {animeMineToday: () => { throw new Error('unsupported action animeMineToday') }}})
  const card = (await cardInfo(missing, {cardId: 1, decks: DECKS})).card
  assert.equal(card.dueText, 'scheduled')
  assert.equal(card.dueDay, null)
})

test('facets with no allowed decks make no request', async () => {
  const client = fakeClient()
  assert.deepEqual(await facets(client, {decks: []}), {decks: [], tags: [], noteTypes: [], saved: []})
  assert.equal(client.calls.length, 0)
})
