const MODEL_FIELDS = [
  'Word',
  'Reading',
  'Meaning',
  'Sentence',
  'SentenceTranslation',
  'Notes',
  'Audio',
  'Picture',
  'Source',
  'WordFurigana',
  'SentenceFurigana',
]

const TEMPLATE_MARKER = 'animemine-template:3'

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

const MODEL_CSS = `/* ${TEMPLATE_MARKER} */
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
.word { font-size: 44px; font-weight: 700; line-height: 1.4; }
.jp { line-height: 1.8; }
.jp ruby rt { font-size: 0.5em; color: #6b7280; }
.nightMode .jp ruby rt { color: #9ca3af; }
.sentence { font-size: 22px; line-height: 1.8; margin: .4em 0; }
.sentence-lg { font-size: 30px; }
.sentence b, .jp b { color: #d6336c; font-weight: inherit; }
.nightMode .sentence b, .nightMode .jp b { color: #ff7aa8; }
.reading { font-size: 22px; color: #6b7280; margin-top: .2em; }
.nightMode .reading { color: #9ca3af; }
.definition {
  text-align: left;
  margin: .8em 0;
  padding: .7em 1em;
  border-radius: 12px;
  border-left: 4px solid #d6336c;
  background-color: rgba(214,51,108,.07);
}
.nightMode .definition { border-left-color: #ff7aa8; background-color: rgba(255,122,168,.1); }
.meaning { font-size: 19px; line-height: 1.6; }
.vocab-word { font-size: 24px; font-weight: 700; margin-bottom: .2em; }
.translation {
  text-align: left;
  font-style: italic;
  font-size: 18px;
  color: #4b5563;
  margin: .8em 0;
  padding: .2em .9em;
  border-left: 3px solid #d6336c;
}
.nightMode .translation { color: #c3c7d0; border-left-color: #ff7aa8; }
.pic img { max-width: 100%; max-height: 260px; height: auto; border-radius: 10px; }
.audio { margin: .5em 0; }
.notes { font-size: 15px; color: #6b7280; margin-top: .6em; }
.nightMode .notes { color: #9ca3af; }
.source {
  display: inline-block;
  font-size: 12px;
  color: #6b7280;
  background-color: rgba(128,128,128,.15);
  border-radius: 999px;
  padding: .2em .8em;
  margin-top: 1em;
  letter-spacing: .04em;
}
.nightMode .source { color: #9ca3af; }
hr#answer { border: 0; border-top: 1px solid rgba(128,128,128,.35); margin: 1em 0; }`

const RECOGNITION_TEMPLATE = {
  Name: 'Recognition',
  Front: '{{#Reading}}<div class="card-wrap">'
    + '<div class="word jp">{{#WordFurigana}}{{furigana:WordFurigana}}{{/WordFurigana}}{{^WordFurigana}}{{Word}}{{/WordFurigana}}</div>'
    + '<div class="sentence jp">{{Sentence}}</div>'
    + '{{#Picture}}<div class="pic">{{Picture}}</div>{{/Picture}}'
    + '{{#Audio}}<div class="audio">{{Audio}}</div>{{/Audio}}'
    + '</div>{{/Reading}}',
  Back: '{{FrontSide}}<hr id="answer">'
    + '<div class="card-wrap">'
    + '<div class="reading">{{Reading}}</div>'
    + '{{#Meaning}}<div class="definition"><div class="meaning">{{Meaning}}</div></div>{{/Meaning}}'
    + '{{#SentenceTranslation}}<div class="translation">{{SentenceTranslation}}</div>{{/SentenceTranslation}}'
    + '{{#Notes}}<div class="notes">{{Notes}}</div>{{/Notes}}'
    + '{{#Source}}<div class="source">{{Source}}</div>{{/Source}}'
    + '</div>',
}

const SENTENCE_TEMPLATE = {
  Name: 'Sentence',
  Front: '<div class="card-wrap"><div class="sentence sentence-lg jp">{{Sentence}}</div>'
    + '{{#Picture}}<div class="pic">{{Picture}}</div>{{/Picture}}'
    + '{{#Audio}}<div class="audio">{{Audio}}</div>{{/Audio}}'
    + '</div>',
  Back: '{{FrontSide}}<hr id="answer">'
    + '<div class="card-wrap">'
    + '{{#SentenceFurigana}}<div class="sentence jp">{{furigana:SentenceFurigana}}</div>{{/SentenceFurigana}}'
    + '{{#SentenceTranslation}}<div class="translation">{{SentenceTranslation}}</div>{{/SentenceTranslation}}'
    + '{{#Meaning}}<div class="definition"><div class="vocab-word jp">{{#WordFurigana}}{{furigana:WordFurigana}}{{/WordFurigana}}{{^WordFurigana}}{{Word}}{{/WordFurigana}}</div><div class="meaning">{{Meaning}}</div></div>{{/Meaning}}'
    + '{{#Notes}}<div class="notes">{{Notes}}</div>{{/Notes}}'
    + '{{#Source}}<div class="source">{{Source}}</div>{{/Source}}'
    + '</div>',
}

function modelDefinition(modelName) {
  return {
    modelName,
    inOrderFields: MODEL_FIELDS,
    css: MODEL_CSS,
    isCloze: false,
    cardTemplates: [RECOGNITION_TEMPLATE, SENTENCE_TEMPLATE],
  }
}

// Escapes Anki search metacharacters so a deck or model name stays a literal term.
const escapeSearch = (text) => String(text).replace(/[\\"*_]/g, '\\$&')
const quoted = (text) => `"${escapeSearch(text)}"`

class AnkiClient {
  constructor(url = 'http://127.0.0.1:8765') {
    this.url = url
  }

  async invoke(action, params = {}) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({action, version: 6, params}),
    })
    if (!res.ok) throw new Error(`AnkiConnect HTTP ${res.status}`)
    const data = await res.json()
    if (data.error) throw new Error(data.error)
    return data.result
  }

  async ping() {
    try {
      await this.invoke('version')
      return true
    } catch {
      return false
    }
  }

  async ensureSetup(deck, model) {
    await this.invoke('createDeck', {deck})
    const models = await this.invoke('modelNames')
    if (!models.includes(model)) {
      await this.invoke('createModel', modelDefinition(model))
      return
    }
    try {
      await this.migrateModel(model)
    } catch {
      // Best-effort: a failed migration must never block mining.
    }
  }

  async migrateModel(modelName) {
    const fields = await this.invoke('modelFieldNames', {modelName})
    for (const [index, fieldName] of MODEL_FIELDS.entries()) {
      if (!fields.includes(fieldName)) await this.invoke('modelFieldAdd', {modelName, fieldName, index})
    }
    const {css} = await this.invoke('modelStyling', {modelName})
    // Only untouched v1/v2 models are upgraded; customised styling is left alone.
    if (![LEGACY_CSS, V2_CSS].some(known => known.trim() === css.trim())) return
    const existing = await this.invoke('modelTemplates', {modelName})
    const templates = Object.fromEntries(
      [RECOGNITION_TEMPLATE, SENTENCE_TEMPLATE]
        .filter(tpl => tpl.Name in existing)
        .map(({Name, Front, Back}) => [Name, {Front, Back}]),
    )
    await this.invoke('updateModelTemplates', {model: {name: modelName, templates}})
    await this.invoke('updateModelStyling', {model: {name: modelName, css: MODEL_CSS}})
  }

  async addCard({deck, duplicateRoot, model, fields, audio, picture}) {
    if (audio) await this.storeMedia(audio)
    if (picture) await this.storeMedia(picture)
    return this.invoke('addNote', {
      note: {
        deckName: deck,
        modelName: model,
        fields: {
          ...fields,
          Audio: audio ? `[sound:${audio.filename}]` : '',
          Picture: picture ? `<img src="${picture.filename}">` : '',
        },
        options: duplicateRoot
          ? {allowDuplicate: false, duplicateScope: 'deck', duplicateScopeOptions: {deckName: duplicateRoot, checkChildren: true}}
          : {allowDuplicate: false, duplicateScope: 'deck'},
      },
    })
  }

  storeMedia({filename, data}) {
    return this.invoke('storeMediaFile', {filename, data: data.toString('base64')})
  }

  async deckStats(deck) {
    const stats = await this.invoke('getDeckStats', {decks: [deck]})
    const entry = Object.values(stats ?? {}).find(stat => stat.name === deck)
    if (!entry) return null
    return {
      new: entry.new_count,
      learn: entry.learn_count,
      due: entry.review_count,
      total: entry.total_in_deck,
    }
  }

  async countAddedToday(deck) {
    const ids = (await this.invoke('findNotes', {query: `deck:${quoted(deck)} added:1`})) ?? []
    return ids.length
  }

  async recentNotes(deck, model, limit) {
    const ids = (await this.invoke('findNotes', {query: `deck:${quoted(deck)} note:${quoted(model)}`})) ?? []
    const newest = [...ids].sort((a, b) => b - a).slice(0, limit)
    if (!newest.length) return []
    return this.invoke('notesInfo', {notes: newest})
  }

  async noteModel(noteId) {
    const [info] = (await this.invoke('notesInfo', {notes: [noteId]})) ?? []
    return info?.modelName ?? null
  }

  async retrieveMedia(filename) {
    const data = await this.invoke('retrieveMediaFile', {filename})
    return data || null
  }

  async updateNoteFields(noteId, fields) {
    return this.invoke('updateNoteFields', {note: {id: noteId, fields}})
  }

  async deleteNotes(ids) {
    return this.invoke('deleteNotes', {notes: ids})
  }

  async guiBrowse(query) {
    return this.invoke('guiBrowse', {query})
  }
}

module.exports = {AnkiClient}
