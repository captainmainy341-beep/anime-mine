const test = require('node:test')
const assert = require('node:assert/strict')
const {aiRecognize} = require('../src/core/aiOcr')

const anthropicSettings = {provider: 'anthropic', apiKey: 'sk-test', model: 'claude-haiku-4-5-20251001'}
const openaiSettings = {provider: 'openai', apiKey: 'sk-openai', model: 'gpt-4o-mini'}
const image = {bytes: Buffer.from('fake-jpeg-bytes'), mime: 'image/jpeg'}

function fakeFetch(status, body) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({url, init, body: JSON.parse(init.body)})
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(text, {status, headers: {'content-type': 'application/json'}})
  }
  return {fetchImpl, calls}
}

const anthropicReply = text => ({content: [{type: 'text', text}]})
const openaiReply = text => ({choices: [{message: {role: 'assistant', content: text}}]})

test('anthropic: posts a base64 image block and instruction to the messages endpoint', async () => {
  const {fetchImpl, calls} = fakeFetch(200, anthropicReply('[{"text":"こんにちは","x":0.1,"y":0.2,"w":0.3,"h":0.4,"vertical":true}]'))
  const result = await aiRecognize(anthropicSettings, image, {fetchImpl})

  assert.deepEqual(result, {
    width: null,
    height: null,
    blocks: [{text: 'こんにちは', box: {x: 0.1, y: 0.2, w: 0.3, h: 0.4}, vertical: true, confidence: null}],
  })
  assert.equal(calls.length, 1)
  const {url, init, body} = calls[0]
  assert.equal(url, 'https://api.anthropic.com/v1/messages')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers['content-type'], 'application/json')
  assert.equal(init.headers['x-api-key'], 'sk-test')
  assert.equal(init.headers['anthropic-version'], '2023-06-01')
  assert.equal(init.headers.authorization, undefined)
  assert.equal(body.model, 'claude-haiku-4-5-20251001')
  assert.equal(body.max_tokens, 2000)
  assert.equal(body.messages.length, 1)
  assert.equal(body.messages[0].role, 'user')
  const [imageBlock, textBlock] = body.messages[0].content
  assert.deepEqual(imageBlock, {
    type: 'image',
    source: {type: 'base64', media_type: 'image/jpeg', data: Buffer.from('fake-jpeg-bytes').toString('base64')},
  })
  assert.equal(textBlock.type, 'text')
  assert.match(textBlock.text, /ONLY a JSON array/)
  assert.match(textBlock.text, /Do not translate/)
  assert.match(textBlock.text, /right to left/)
})

test('anthropic: joins only text blocks of the reply', async () => {
  const {fetchImpl} = fakeFetch(200, {content: [
    {type: 'thinking', text: 'ignore me'},
    {type: 'text', text: '[{"text":"A","x":0,"y":0,"w":0.5,"h":0.5,"vertical":false}'},
    {type: 'text', text: ',{"text":"B","x":0.5,"y":0,"w":0.5,"h":0.5,"vertical":false}]'},
  ]})
  const {blocks} = await aiRecognize(anthropicSettings, image, {fetchImpl})
  assert.deepEqual(blocks.map(block => block.text), ['A', 'B'])
})

test('openai: posts an image_url data URL to chat completions with a bearer key', async () => {
  const {fetchImpl, calls} = fakeFetch(200, openaiReply('[{"text":"おはよう","x":0.5,"y":0.1,"w":0.2,"h":0.3,"vertical":false}]'))
  const result = await aiRecognize(openaiSettings, {bytes: Buffer.from('png'), mime: 'image/png'}, {fetchImpl})

  assert.equal(result.blocks[0].text, 'おはよう')
  const {url, init, body} = calls[0]
  assert.equal(url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.authorization, 'Bearer sk-openai')
  assert.equal(init.headers['x-api-key'], undefined)
  assert.equal(body.model, 'gpt-4o-mini')
  assert.equal(body.max_tokens, 2000)
  assert.equal(body.messages.length, 1)
  assert.equal(body.messages[0].role, 'user')
  const [textBlock, imageBlock] = body.messages[0].content
  assert.equal(textBlock.type, 'text')
  assert.match(textBlock.text, /ONLY a JSON array/)
  assert.deepEqual(imageBlock, {
    type: 'image_url',
    image_url: {url: `data:image/png;base64,${Buffer.from('png').toString('base64')}`},
  })
})

test('honours a custom baseUrl and strips trailing slashes', async () => {
  const anthropic = fakeFetch(200, anthropicReply('[{"text":"a","x":0,"y":0,"w":1,"h":1,"vertical":false}]'))
  await aiRecognize({...anthropicSettings, baseUrl: 'http://localhost:9000/'}, image, {fetchImpl: anthropic.fetchImpl})
  assert.equal(anthropic.calls[0].url, 'http://localhost:9000/v1/messages')

  const openai = fakeFetch(200, openaiReply('[{"text":"a","x":0,"y":0,"w":1,"h":1,"vertical":false}]'))
  await aiRecognize({...openaiSettings, baseUrl: 'http://localhost:1234'}, image, {fetchImpl: openai.fetchImpl})
  assert.equal(openai.calls[0].url, 'http://localhost:1234/v1/chat/completions')
})

test('parses a JSON array wrapped in code fences and surrounding prose', async () => {
  const reply = 'Here you go:\n```json\n[{"text":"「行く」","x":0.1,"y":0.1,"w":0.1,"h":0.5,"vertical":true},\n{"text":"はい","x":0.6,"y":0.1,"w":0.2,"h":0.1,"vertical":false}]\n```\nDone [1].'
  const {fetchImpl} = fakeFetch(200, anthropicReply(reply))
  const {blocks} = await aiRecognize(anthropicSettings, image, {fetchImpl})
  assert.deepEqual(blocks.map(block => [block.text, block.vertical]), [['「行く」', true], ['はい', false]])
})

test('keeps brackets inside JSON strings when extracting the array', async () => {
  const {fetchImpl} = fakeFetch(200, anthropicReply('[{"text":"[笑]","x":0,"y":0,"w":0.5,"h":0.5,"vertical":false}]'))
  const {blocks} = await aiRecognize(anthropicSettings, image, {fetchImpl})
  assert.equal(blocks[0].text, '[笑]')
})

test('clamps boxes into the 0..1 image and keeps them inside the frame', async () => {
  const reply = JSON.stringify([
    {text: 'a', x: -0.25, y: 0.5, w: 1.5, h: 0.75, vertical: false},
    {text: 'b', x: 0.5, y: 1.25, w: 0.75, h: 0.5, vertical: true},
  ])
  const {fetchImpl} = fakeFetch(200, anthropicReply(reply))
  const {blocks} = await aiRecognize(anthropicSettings, image, {fetchImpl})
  assert.deepEqual(blocks.map(block => block.box), [
    {x: 0, y: 0.5, w: 1, h: 0.5},
    {x: 0.5, y: 1, w: 0.5, h: 0},
  ])
})

test('drops empty-text entries and entries with non-numeric coordinates', async () => {
  const reply = JSON.stringify([
    {text: '   ', x: 0, y: 0, w: 0.1, h: 0.1, vertical: false},
    {text: 'bad', x: 'left', y: 0, w: 0.1, h: 0.1, vertical: false},
    {text: 'keep', x: 0, y: 0, w: 0.1, h: 0.1, vertical: false},
    null,
  ])
  const {fetchImpl} = fakeFetch(200, anthropicReply(reply))
  const {blocks} = await aiRecognize(anthropicSettings, image, {fetchImpl})
  assert.deepEqual(blocks.map(block => block.text), ['keep'])
})

test('throws when the reply contains no readable blocks', async () => {
  for (const reply of ['[]', 'I cannot read this page.', '[{"text":""}]', '[not json']) {
    const {fetchImpl} = fakeFetch(200, anthropicReply(reply))
    await assert.rejects(aiRecognize(anthropicSettings, image, {fetchImpl}), {message: 'AI OCR returned no readable blocks'})
  }
})

test('throws when the reply is empty', async () => {
  const {fetchImpl} = fakeFetch(200, {content: []})
  await assert.rejects(aiRecognize(anthropicSettings, image, {fetchImpl}), {message: 'AI OCR returned no readable blocks'})
})

test('throws before any request when the API key is missing', async () => {
  const {fetchImpl, calls} = fakeFetch(200, {})
  await assert.rejects(aiRecognize({...anthropicSettings, apiKey: ''}, image, {fetchImpl}), /No API key set for anthropic/)
  await assert.rejects(aiRecognize({...openaiSettings, apiKey: undefined}, image, {fetchImpl}), /No API key set for openai/)
  assert.equal(calls.length, 0)
})

test('rejects images over 8 MB before any request', async () => {
  const {fetchImpl, calls} = fakeFetch(200, {})
  const oversize = {bytes: Buffer.alloc(8 * 1024 * 1024 + 1), mime: 'image/jpeg'}
  await assert.rejects(aiRecognize(anthropicSettings, oversize, {fetchImpl}), /AI OCR accepts at most 8 MB/)
  assert.equal(calls.length, 0)
})

test('accepts an image of exactly 8 MB', async () => {
  const {fetchImpl, calls} = fakeFetch(200, anthropicReply('[{"text":"a","x":0,"y":0,"w":1,"h":1,"vertical":false}]'))
  const atLimit = {bytes: Buffer.alloc(8 * 1024 * 1024), mime: 'image/jpeg'}
  await aiRecognize(anthropicSettings, atLimit, {fetchImpl})
  assert.equal(calls.length, 1)
})

test('non-2xx responses surface the status and the API error message', async () => {
  const {fetchImpl} = fakeFetch(401, {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}})
  await assert.rejects(aiRecognize(anthropicSettings, image, {fetchImpl}), /AI request failed \(401\): invalid x-api-key/)
})

test('unknown provider is rejected before any request', async () => {
  const {fetchImpl, calls} = fakeFetch(200, {})
  await assert.rejects(aiRecognize({provider: 'gemini', apiKey: 'k'}, image, {fetchImpl}), /Unknown AI provider: gemini/)
  assert.equal(calls.length, 0)
})
