const test = require('node:test')
const assert = require('node:assert/strict')
const {AnkiClient} = require('../src/core/anki')

const ok = result => ({result, error: null})
const fail = error => ({result: null, error})

function stubAnki(t, handlers = {}) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const req = JSON.parse(init.body)
    calls.push({url, init, req})
    const reply = handlers[req.action] ? handlers[req.action](req.params) : ok(null)
    return new Response(JSON.stringify(reply), {status: 200})
  })
  return calls
}

const actions = calls => calls.map(call => call.req.action)

test('defaults to the local AnkiConnect URL', () => {
  assert.equal(new AnkiClient().url, 'http://127.0.0.1:8765')
})

test('invoke posts action, version 6 and params, and returns the result', async t => {
  const calls = stubAnki(t, {version: () => ok(6)})
  const client = new AnkiClient('http://localhost:9999')

  assert.equal(await client.invoke('version'), 6)
  assert.equal(calls[0].url, 'http://localhost:9999')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.deepEqual(calls[0].req, {action: 'version', version: 6, params: {}})
})

test('invoke throws the AnkiConnect error message', async t => {
  stubAnki(t, {deckNames: () => fail('unsupported action')})
  await assert.rejects(new AnkiClient().invoke('deckNames'), /unsupported action/)
})

test('invoke throws on a non-2xx HTTP status', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('nope', {status: 500}))
  await assert.rejects(new AnkiClient().invoke('version'), /AnkiConnect HTTP 500/)
})

test('ping is true when AnkiConnect answers and false when unreachable', async t => {
  stubAnki(t, {version: () => ok(6)})
  assert.equal(await new AnkiClient().ping(), true)

  t.mock.restoreAll()
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed')
  })
  assert.equal(await new AnkiClient().ping(), false)
})

test('ensureSetup does not recreate a model that already exists', async t => {
  const calls = stubAnki(t, {
    createDeck: () => ok(1),
    modelNames: () => ok(['Basic', 'AnimeMine']),
  })
  await new AnkiClient().ensureSetup('Anime Mining', 'AnimeMine')
  assert.deepEqual(actions(calls), ['createDeck', 'modelNames'])
  assert.deepEqual(calls[0].req.params, {deck: 'Anime Mining'})
})

test('ensureSetup creates a missing model with the mining fields and two templates', async t => {
  const calls = stubAnki(t, {
    createDeck: () => ok(1),
    modelNames: () => ok(['Basic']),
    createModel: () => ok(null),
  })
  await new AnkiClient().ensureSetup('Anime Mining', 'AnimeMine')

  assert.deepEqual(actions(calls), ['createDeck', 'modelNames', 'createModel'])
  const {modelName, inOrderFields, isCloze, cardTemplates, css} = calls[2].req.params
  assert.equal(modelName, 'AnimeMine')
  assert.deepEqual(inOrderFields, [
    'Word', 'Reading', 'Meaning', 'Sentence', 'SentenceTranslation',
    'Notes', 'Audio', 'Picture', 'Source',
  ])
  assert.equal(isCloze, false)
  assert.equal(typeof css, 'string')
  assert.deepEqual(cardTemplates.map(tpl => tpl.Name), ['Recognition', 'Sentence'])
  for (const tpl of cardTemplates) {
    assert.equal(typeof tpl.Front, 'string')
    assert.equal(typeof tpl.Back, 'string')
    assert.match(tpl.Back, /\{\{FrontSide\}\}/)
  }
  assert.match(cardTemplates[0].Front, /\{\{Word\}\}/)
  assert.match(cardTemplates[1].Front, /\{\{Sentence\}\}/)
})

test('Recognition front is only generated for notes that have a Reading', async t => {
  const calls = stubAnki(t, {
    createDeck: () => ok(1),
    modelNames: () => ok([]),
    createModel: () => ok(null),
  })
  await new AnkiClient().ensureSetup('Anime Mining', 'AnimeMine')

  const [recognition] = calls[2].req.params.cardTemplates
  assert.equal(
    recognition.Front,
    '{{#Reading}}{{Picture}}<div class="word">{{Word}}</div>{{Audio}}{{/Reading}}',
  )
})

test('addCard stores media first, then adds the note with sound and image fields', async t => {
  const calls = stubAnki(t, {
    storeMediaFile: params => ok(params.filename),
    addNote: () => ok(1700000000000),
  })
  const noteId = await new AnkiClient().addCard({
    deck: 'Anime Mining',
    model: 'AnimeMine',
    fields: {Word: '食べる', Reading: 'たべる', Meaning: 'to eat', Sentence: '<b>食べた</b>', Source: 'ep01.mkv'},
    audio: {filename: 'clip.mp3', data: Buffer.from('abc')},
    picture: {filename: 'shot.jpg', data: Buffer.from([0xff, 0xd8])},
  })

  assert.equal(noteId, 1700000000000)
  assert.deepEqual(actions(calls), ['storeMediaFile', 'storeMediaFile', 'addNote'])
  assert.deepEqual(calls[0].req.params, {filename: 'clip.mp3', data: 'YWJj'})
  assert.deepEqual(calls[1].req.params, {filename: 'shot.jpg', data: '/9g='})
  assert.deepEqual(calls[2].req.params, {
    note: {
      deckName: 'Anime Mining',
      modelName: 'AnimeMine',
      fields: {
        Word: '食べる',
        Reading: 'たべる',
        Meaning: 'to eat',
        Sentence: '<b>食べた</b>',
        Source: 'ep01.mkv',
        Audio: '[sound:clip.mp3]',
        Picture: '<img src="shot.jpg">',
      },
      options: {allowDuplicate: false, duplicateScope: 'deck'},
    },
  })
})

test('addCard without media stores nothing and leaves Audio and Picture empty', async t => {
  const calls = stubAnki(t, {addNote: () => ok(42)})
  await new AnkiClient().addCard({deck: 'D', model: 'M', fields: {Word: 'a'}})

  assert.deepEqual(actions(calls), ['addNote'])
  assert.equal(calls[0].req.params.note.fields.Audio, '')
  assert.equal(calls[0].req.params.note.fields.Picture, '')
})

test('addCard surfaces the AnkiConnect error, e.g. for duplicates', async t => {
  stubAnki(t, {addNote: () => fail('cannot create note because it is a duplicate')})
  await assert.rejects(
    new AnkiClient().addCard({deck: 'D', model: 'M', fields: {Word: 'a'}}),
    /cannot create note because it is a duplicate/,
  )
})
