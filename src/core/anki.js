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
]

const MODEL_CSS = `.card { font-family: arial, sans-serif; font-size: 22px; text-align: center; color: #222; background-color: #fff; }
.word { font-size: 36px; }
.sentence { font-size: 26px; }
.meaning, .translation { margin-top: 0.5em; }
.source { color: #888; font-size: 14px; margin-top: 1em; }`

const RECOGNITION_TEMPLATE = {
  Name: 'Recognition',
  Front: '{{#Reading}}{{Picture}}<div class="word">{{Word}}</div>{{Audio}}{{/Reading}}',
  Back: '{{FrontSide}}<hr id="answer">'
    + '<div class="reading">{{Reading}}</div>'
    + '<div class="meaning">{{Meaning}}</div>'
    + '<div class="sentence">{{Sentence}}</div>'
    + '<div class="translation">{{SentenceTranslation}}</div>'
    + '<div class="notes">{{Notes}}</div>'
    + '<div class="source">{{Source}}</div>',
}

const SENTENCE_TEMPLATE = {
  Name: 'Sentence',
  Front: '<div class="sentence">{{Sentence}}</div>{{Audio}}',
  Back: '{{FrontSide}}<hr id="answer">'
    + '<div class="translation">{{SentenceTranslation}}</div>'
    + '<div class="word">{{Word}}</div>'
    + '<div class="meaning">{{Meaning}}</div>'
    + '{{Picture}}'
    + '<div class="source">{{Source}}</div>',
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
    if (!models.includes(model)) await this.invoke('createModel', modelDefinition(model))
  }

  async addCard({deck, model, fields, audio, picture}) {
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
        options: {allowDuplicate: false, duplicateScope: 'deck'},
      },
    })
  }

  storeMedia({filename, data}) {
    return this.invoke('storeMediaFile', {filename, data: data.toString('base64')})
  }
}

module.exports = {AnkiClient}
