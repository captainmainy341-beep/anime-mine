const DEFAULT_BASE_URL = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
}

const MAX_TOKENS = 700

const SYSTEM_PROMPT = [
  'You help a Japanese learner (about JLPT N4) understand lines from anime.',
  'Reply in plain text: no markdown, no headings, no bullet lists.',
  'Keep the reply under 150 words.',
].join(' ')

function buildPrompt({word, sentence, context}) {
  const lines = []
  if (word) {
    lines.push(`Explain the word 「${word}」 as used in this sentence: its meaning and nuance here, its reading, and any grammar around it.`)
  }
  lines.push('Always give a natural English translation of the sentence.')
  lines.push(`Sentence: ${sentence}`)
  if (context) lines.push(`Context: ${context}`)
  return {system: SYSTEM_PROMPT, user: lines.join('\n')}
}

function baseUrl(settings) {
  return (settings.baseUrl || DEFAULT_BASE_URL[settings.provider]).replace(/\/+$/, '')
}

function errorMessage(text) {
  try {
    const data = JSON.parse(text)
    const message = typeof data.error === 'string' ? data.error : data.error?.message
    return message || text
  } catch {
    return text
  }
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`AI request failed (${res.status}): ${errorMessage(text)}`)
  return JSON.parse(text)
}

async function callAnthropic(settings, {system, user}) {
  const data = await postJson(
    `${baseUrl(settings)}/v1/messages`,
    {'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01'},
    {model: settings.model, max_tokens: MAX_TOKENS, system, messages: [{role: 'user', content: user}]},
  )
  return (data.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
}

async function callOpenAI(settings, {system, user}) {
  const data = await postJson(
    `${baseUrl(settings)}/v1/chat/completions`,
    {authorization: `Bearer ${settings.apiKey}`},
    {
      model: settings.model,
      max_tokens: MAX_TOKENS,
      messages: [{role: 'system', content: system}, {role: 'user', content: user}],
    },
  )
  return data.choices?.[0]?.message?.content ?? ''
}

const PROVIDERS = new Map([
  ['anthropic', callAnthropic],
  ['openai', callOpenAI],
])

async function explain(settings, req) {
  const call = PROVIDERS.get(settings.provider)
  if (!call) throw new Error(`Unknown AI provider: ${settings.provider}`)
  if (!settings.apiKey) throw new Error(`No API key set for ${settings.provider}. Add one in Settings.`)
  const reply = (await call(settings, buildPrompt(req))).trim()
  if (!reply) throw new Error('AI returned an empty reply')
  return reply
}

module.exports = {explain, buildPrompt}
