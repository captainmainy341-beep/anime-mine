const DEFAULT_BASE_URL = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_TOKENS = 2000
const REQUEST_TIMEOUT_MS = 90 * 1000
const SECRET_PATTERNS = [/\bsk-[A-Za-z0-9_-]{8,}/g, /\bBearer\s+[^\s"',;]+/gi]

const PROMPT = [
  'Transcribe all Japanese text in this manga page image, one entry per speech bubble or text block.',
  'Reply with ONLY a JSON array, no prose and no markdown.',
  'Each entry is {"text": string, "x": number, "y": number, "w": number, "h": number, "vertical": boolean}.',
  'x, y, w, h are fractions from 0 to 1 of the image width and height; (x, y) is the top-left corner of the box.',
  'Set vertical to true when the text runs top to bottom, false when it runs left to right.',
  'Transcribe the Japanese exactly as written. Do not translate it and do not correct it.',
  'Order the array in manga reading order: right to left, then top to bottom.',
  'Skip sound effects only if they are unreadable.',
  'If there is no readable text, reply with [].',
].join(' ')

function baseUrl(settings) {
  return (settings.baseUrl || DEFAULT_BASE_URL[settings.provider]).replace(/\/+$/, '')
}

function redact(text, apiKey) {
  const literal = apiKey ? text.split(apiKey).join('[redacted]') : text
  return SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, '[redacted]'), literal)
}

function errorMessage(text, apiKey) {
  try {
    const data = JSON.parse(text)
    const message = typeof data.error === 'string' ? data.error : data.error?.message
    return redact(message || text, apiKey)
  } catch {
    return redact(text, apiKey)
  }
}

async function postJson(fetchImpl, url, headers, body, {apiKey, signal}) {
  let res
  let text
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {'content-type': 'application/json', ...headers},
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])]),
    })
    text = await res.text()
  } catch (err) {
    throw new Error(redact(`AI request failed: ${err.message}`, apiKey))
  }
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${errorMessage(text, apiKey)}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(redact('AI response is not JSON', apiKey))
  }
}

const PROVIDERS = new Map([
  ['anthropic', {
    request: (settings, data, mime) => ({
      url: `${baseUrl(settings)}/v1/messages`,
      headers: {'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01'},
      body: {
        model: settings.model,
        max_tokens: MAX_TOKENS,
        messages: [{
          role: 'user',
          content: [
            {type: 'image', source: {type: 'base64', media_type: mime, data}},
            {type: 'text', text: PROMPT},
          ],
        }],
      },
    }),
    reply: data => (data.content ?? []).filter(block => block.type === 'text').map(block => block.text).join(''),
  }],
  ['openai', {
    request: (settings, data, mime) => ({
      url: `${baseUrl(settings)}/v1/chat/completions`,
      headers: {authorization: `Bearer ${settings.apiKey}`},
      body: {
        model: settings.model,
        max_tokens: MAX_TOKENS,
        messages: [{
          role: 'user',
          content: [
            {type: 'text', text: PROMPT},
            {type: 'image_url', image_url: {url: `data:${mime};base64,${data}`}},
          ],
        }],
      },
    }),
    reply: data => data.choices?.[0]?.message?.content ?? '',
  }],
])

function firstJsonArray(text) {
  const start = text.indexOf('[')
  if (start === -1) return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
    } else if (ch === '[') {
      depth++
    } else if (ch === ']' && --depth === 0) {
      return text.slice(start, i + 1)
    }
  }
  return null
}

const unit = value => Math.min(1, Math.max(0, Number(value)))

function toBlock(item) {
  const text = typeof item?.text === 'string' ? item.text.trim() : ''
  const x = unit(item?.x)
  const y = unit(item?.y)
  const w = Math.min(unit(item?.w), 1 - x)
  const h = Math.min(unit(item?.h), 1 - y)
  if (!text || [x, y, w, h].some(Number.isNaN)) return null
  return {text, box: {x, y, w, h}, vertical: item.vertical === true, confidence: null}
}

function parseBlocks(reply) {
  const json = firstJsonArray(reply)
  if (json === null) return []
  let items
  try {
    items = JSON.parse(json)
  } catch {
    return []
  }
  return items.map(toBlock).filter(Boolean)
}

async function aiRecognize(settings, {bytes, mime}, {fetchImpl = fetch, signal} = {}) {
  const provider = PROVIDERS.get(settings.provider)
  if (!provider) throw new Error(`Unknown AI provider: ${settings.provider}`)
  if (!settings.apiKey) throw new Error(`No API key set for ${settings.provider}. Add one in Settings.`)
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; AI OCR accepts at most 8 MB`)
  }

  const req = provider.request(settings, bytes.toString('base64'), mime)
  const data = await postJson(fetchImpl, req.url, req.headers, req.body, {apiKey: settings.apiKey, signal})
  const blocks = parseBlocks(provider.reply(data))
  if (!blocks.length) throw new Error('AI OCR returned no readable blocks')
  return {width: null, height: null, blocks}
}

module.exports = {aiRecognize}
