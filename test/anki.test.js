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
const paramsOf = (calls, action) => calls.find(call => call.req.action === action).req.params

const OLD_FIELDS = ['Word', 'Reading', 'Meaning', 'Sentence', 'SentenceTranslation', 'Notes', 'Audio', 'Picture', 'Source']
const CURRENT_FIELDS = [...OLD_FIELDS, 'WordFurigana', 'SentenceFurigana']

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

const LEGACY_CSS = `.card { font-family: arial, sans-serif; font-size: 22px; text-align: center; color: #222; background-color: #fff; }
.word { font-size: 36px; }
.sentence { font-size: 26px; }
.meaning, .translation { margin-top: 0.5em; }
.source { color: #888; font-size: 14px; margin-top: 1em; }`

const V2_CSS = `/* animemine-template:2 */
.card {
  font-family: "Hiragino Sans","Noto Sans JP","Yu Gothic","Meiryo",sans-serif;
  font-size: 20px;
  line-height: 1.6;
  text-align: center;
  color: #1f2430;
  background-color: #f6f6f2;
}
.nightMode.card, .nightMode .card {
  color: #e8e8ee;
  background-color: #1b1d26;
}
.card-wrap { max-width: 680px; margin: 0 auto; padding: 8px 14px; }
.word { font-size: 44px; }
.jp { line-height: 1.8; }
.jp ruby rt { font-size: 0.5em; color: #6b7280; }
.nightMode .jp ruby rt { color: #9ca3af; }
.sentence { font-size: 28px; line-height: 1.9; }
.sentence b { color: #d6336c; }
.nightMode .sentence b { color: #ff7aa8; }
.reading { font-size: 22px; color: #6b7280; }
.meaning { margin: .6em 0; font-size: 19px; text-align: left; display: inline-block; max-width: 100%; }
.translation { font-size: 18px; color: #4b5563; margin: .8em 0; }
.nightMode .translation { color: #aab; }
.pic img { max-width: 100%; max-height: 260px; border-radius: 10px; }
.audio { margin: .5em 0; }
.vocab { margin-top: 1em; padding-top: .8em; border-top: 1px dashed rgba(128,128,128,.4); }
.vocab-word { font-size: 24px; margin-right: .4em; }
.notes { font-size: 15px; color: #6b7280; margin-top: .6em; }
.source { font-size: 12px; color: #9ca3af; margin-top: 1.2em; letter-spacing: .04em; }
hr#answer { border: 0; border-top: 1px solid rgba(128,128,128,.35); margin: 1em 0; }`

test('ensureSetup migrates an existing old model instead of recreating it', async t => {
  const calls = stubAnki(t, {
    createDeck: () => ok(1),
    modelNames: () => ok(['Basic', 'AnimeMine']),
    modelFieldNames: () => ok(OLD_FIELDS),
    modelFieldAdd: () => ok(null),
    modelStyling: () => ok({css: LEGACY_CSS}),
    modelTemplates: () => ok({Recognition: {Front: '', Back: ''}, Sentence: {Front: '', Back: ''}}),
    updateModelTemplates: () => ok(null),
    updateModelStyling: () => ok(null),
  })
  await new AnkiClient().ensureSetup('Anime Mining', 'AnimeMine')

  assert.deepEqual(actions(calls), [
    'createDeck', 'modelNames', 'modelFieldNames', 'modelFieldAdd', 'modelFieldAdd',
    'modelStyling', 'modelTemplates', 'updateModelTemplates', 'updateModelStyling',
  ])
  assert.deepEqual(calls[0].req.params, {deck: 'Anime Mining'})
  assert.deepEqual(calls[3].req.params, {modelName: 'AnimeMine', fieldName: 'WordFurigana', index: 9})
  assert.deepEqual(calls[4].req.params, {modelName: 'AnimeMine', fieldName: 'SentenceFurigana', index: 10})

  const {templates} = paramsOf(calls, 'updateModelTemplates').model
  assert.deepEqual(Object.keys(templates), ['Recognition', 'Sentence'])
  assert.match(templates.Recognition.Back, /\{\{FrontSide\}\}/)
  assert.match(templates.Sentence.Front, /\{\{Sentence\}\}/)

  const {name, css} = paramsOf(calls, 'updateModelStyling').model
  assert.equal(name, 'AnimeMine')
  assert.match(css, /^\/\* animemine-template:3 \*\//)
})

test('ensureSetup upgrades an untouched v2 model to the current templates and styling', async t => {
  const calls = stubAnki(t, {
    createDeck: () => ok(1),
    modelNames: () => ok(['AnimeMine']),
    modelFieldNames: () => ok(CURRENT_FIELDS),
    modelStyling: () => ok({css: V2_CSS}),
    modelTemplates: () => ok({Recognition: {Front: '', Back: ''}, Sentence: {Front: '', Back: ''}}),
    updateModelTemplates: () => ok(null),
    updateModelStyling: () => ok(null),
  })
  await new AnkiClient().ensureSetup('Anime Mining', 'AnimeMine')

  assert.deepEqual(actions(calls), [
    'createDeck', 'modelNames', 'modelFieldNames', 'modelStyling', 'modelTemplates', 'updateModelTemplates', 'updateModelStyling',
  ])
  const {templates} = paramsOf(calls, 'updateModelTemplates').model
  assert.match(templates.Recognition.Back, /\{\{SentenceTranslation\}\}/)
  assert.match(paramsOf(calls, 'updateModelStyling').model.css, /^\/\* animemine-template:3 \*\//)
})

test('ensureSetup adds fields but keeps templates and styling of a customised model', async t => {
  const calls = stubAnki(t, {
    createDeck: () => ok(1),
    modelNames: () => ok(['AnimeMine']),
    modelFieldNames: () => ok(OLD_FIELDS),
    modelFieldAdd: () => ok(null),
    modelStyling: () => ok({css: '.card { color: hotpink; }'}),
  })
  await new AnkiClient().ensureSetup('Anime Mining', 'AnimeMine')

  assert.deepEqual(actions(calls), [
    'createDeck', 'modelNames', 'modelFieldNames', 'modelFieldAdd', 'modelFieldAdd', 'modelStyling',
  ])
})

test('ensureSetup leaves a model alone when its styling already carries the template marker', async t => {
  const calls = stubAnki(t, {
    createDeck: () => ok(1),
    modelNames: () => ok(['AnimeMine']),
    modelFieldNames: () => ok(CURRENT_FIELDS),
    modelStyling: () => ok({css: '/* animemine-template:2 */\n.card { color: #1f2430; }'}),
  })
  await new AnkiClient().ensureSetup('Anime Mining', 'AnimeMine')

  assert.deepEqual(actions(calls), ['createDeck', 'modelNames', 'modelFieldNames', 'modelStyling'])
})

test('ensureSetup still resolves when the migration fails', async t => {
  stubAnki(t, {
    createDeck: () => ok(1),
    modelNames: () => ok(['AnimeMine']),
    modelFieldNames: () => ok(CURRENT_FIELDS),
    modelStyling: () => fail('styling unavailable'),
  })
  await assert.doesNotReject(new AnkiClient().ensureSetup('Anime Mining', 'AnimeMine'))
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
  assert.deepEqual(inOrderFields, CURRENT_FIELDS)
  assert.equal(isCloze, false)
  assert.match(css, /^\/\* animemine-template:3 \*\//)
  assert.deepEqual(cardTemplates.map(tpl => tpl.Name), ['Recognition', 'Sentence'])
  for (const tpl of cardTemplates) {
    assert.equal(typeof tpl.Front, 'string')
    assert.equal(typeof tpl.Back, 'string')
  }
  assert.match(cardTemplates[0].Back, /\{\{FrontSide\}\}/)
  assert.match(cardTemplates[1].Back, /\{\{FrontSide\}\}/)
  assert.match(cardTemplates[0].Front, /\{\{Word\}\}/)
  assert.match(cardTemplates[1].Front, /\{\{Sentence\}\}/)
})

test('model templates both show the sentence translation', async t => {
  const calls = stubAnki(t, {
    createDeck: () => ok(1),
    modelNames: () => ok([]),
    createModel: () => ok(null),
  })
  await new AnkiClient().ensureSetup('Anime Mining', 'AnimeMine')

  for (const tpl of calls[2].req.params.cardTemplates) {
    assert.match(tpl.Back, /\{\{#SentenceTranslation\}\}<div class="translation">\{\{SentenceTranslation\}\}/)
  }
})

test('Recognition front is only generated for notes that have a Reading', async t => {
  const calls = stubAnki(t, {
    createDeck: () => ok(1),
    modelNames: () => ok([]),
    createModel: () => ok(null),
  })
  await new AnkiClient().ensureSetup('Anime Mining', 'AnimeMine')

  const [recognition] = calls[2].req.params.cardTemplates
  assert.match(recognition.Front, /^\{\{#Reading\}\}<div class="card-wrap">/)
  assert.match(recognition.Front, /\{\{#WordFurigana\}\}\{\{furigana:WordFurigana\}\}\{\{\/WordFurigana\}\}\{\{\^WordFurigana\}\}\{\{Word\}\}/)
  assert.match(recognition.Front, /\{\{Sentence\}\}/)
  assert.match(recognition.Front, /\{\{\/Reading\}\}$/)
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

test('addCard with duplicateRoot checks for duplicates across the root deck and its subdecks', async t => {
  const calls = stubAnki(t, {addNote: () => ok(42)})
  await new AnkiClient().addCard({deck: 'Anime Mining::Frieren', duplicateRoot: 'Anime Mining', model: 'M', fields: {Word: 'a'}})

  assert.deepEqual(calls[0].req.params.note.deckName, 'Anime Mining::Frieren')
  assert.deepEqual(calls[0].req.params.note.options, {
    allowDuplicate: false,
    duplicateScope: 'deck',
    duplicateScopeOptions: {deckName: 'Anime Mining', checkChildren: true},
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

test('deckStats picks the named deck from getDeckStats and maps its counts', async t => {
  const calls = stubAnki(t, {
    getDeckStats: () => ok({
      1: {name: 'Other', new_count: 9, learn_count: 9, review_count: 9, total_in_deck: 9},
      2: {name: 'Anime Mining', new_count: 3, learn_count: 1, review_count: 4, total_in_deck: 20},
    }),
  })

  assert.deepEqual(await new AnkiClient().deckStats('Anime Mining'), {new: 3, learn: 1, due: 4, total: 20})
  assert.deepEqual(calls[0].req.params, {decks: ['Anime Mining']})
})

test('deckStats returns null when the deck is absent from the result', async t => {
  stubAnki(t, {getDeckStats: () => ok({})})
  assert.equal(await new AnkiClient().deckStats('Missing'), null)
})

test('deck and model names are escaped and quoted in every search query', async t => {
  const calls = stubAnki(t, {findNotes: () => ok([1])})
  const client = new AnkiClient()
  const deck = 'Anime "Mining" *_ \\ 50%'
  const model = 'Anime_"Mine"'

  await client.countAddedToday(deck)
  await client.recentNotes(deck, model, 5)

  assert.deepEqual(calls[0].req.params, {query: String.raw`deck:"Anime \"Mining\" \*\_ \\ 50%" added:1`})
  assert.deepEqual(calls[1].req.params, {query: String.raw`deck:"Anime \"Mining\" \*\_ \\ 50%" note:"Anime\_\"Mine\""`})
})

test('countAddedToday counts the notes returned for today', async t => {
  stubAnki(t, {findNotes: () => ok([3, 4, 5])})
  assert.equal(await new AnkiClient().countAddedToday('Anime Mining'), 3)
})

test('recentNotes sorts ids numerically, newest first, and fetches notesInfo for the slice only', async t => {
  const calls = stubAnki(t, {
    findNotes: () => ok([5, 100, 20, 7]),
    notesInfo: ({notes}) => ok(notes.map(noteId => ({noteId}))),
  })
  const infos = await new AnkiClient().recentNotes('Anime Mining', 'AnimeMine', 2)

  assert.deepEqual(actions(calls), ['findNotes', 'notesInfo'])
  assert.deepEqual(calls[1].req.params, {notes: [100, 20]})
  assert.deepEqual(infos, [{noteId: 100}, {noteId: 20}])
})

test('recentNotes skips notesInfo when nothing matches', async t => {
  const calls = stubAnki(t, {findNotes: () => ok([])})
  assert.deepEqual(await new AnkiClient().recentNotes('Anime Mining', 'AnimeMine', 30), [])
  assert.deepEqual(actions(calls), ['findNotes'])
})

test('noteModel is the model name for a real note and null for a missing one', async t => {
  stubAnki(t, {notesInfo: ({notes}) => ok(notes[0] === 1 ? [{noteId: 1, modelName: 'AnimeMine'}] : [{}])})
  const client = new AnkiClient()
  assert.equal(await client.noteModel(1), 'AnimeMine')
  assert.equal(await client.noteModel(2), null)
})

test('note write helpers send the documented AnkiConnect params', async t => {
  const calls = stubAnki(t, {
    updateNoteFields: () => ok(null),
    deleteNotes: () => ok(null),
    guiBrowse: () => ok([]),
  })
  const client = new AnkiClient()
  await client.updateNoteFields(7, {Meaning: 'x'})
  await client.deleteNotes([7])
  await client.guiBrowse('nid:7')

  assert.deepEqual(actions(calls), ['updateNoteFields', 'deleteNotes', 'guiBrowse'])
  assert.deepEqual(calls[0].req.params, {note: {id: 7, fields: {Meaning: 'x'}}})
  assert.deepEqual(calls[1].req.params, {notes: [7]})
  assert.deepEqual(calls[2].req.params, {query: 'nid:7'})
})

test('retrieveMedia returns base64 data, or null when AnkiConnect reports the file missing', async t => {
  stubAnki(t, {retrieveMediaFile: ({filename}) => ok(filename === 'clip.mp3' ? 'AAEC' : false)})
  const client = new AnkiClient()
  assert.equal(await client.retrieveMedia('clip.mp3'), 'AAEC')
  assert.equal(await client.retrieveMedia('gone.mp3'), null)
})
