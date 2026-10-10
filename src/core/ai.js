const DEFAULT_BASE_URL = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
}

const MAX_TOKENS = 700
const TRANSLATE_MAX_TOKENS = 200

const SYSTEM_PROMPT = [
  'You help a Japanese learner (about JLPT N4) understand lines from anime.',
  'Reply in plain text: no markdown, no headings, no bullet lists.',
  'Keep the reply under 150 words.',
].join(' ')

const TRANSLATE_SYSTEM_PROMPT = [
  'You translate Japanese dialogue from anime into natural English.',
  'Reply with ONLY the English translation of the given sentence, on one line.',
  'No quotes, notes, romanization, markdown or explanations.',
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

function buildTranslatePrompt({sentence, context}) {
  const lines = [`Sentence: ${sentence}`]
  const contextLines = (context || '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 2)
  if (contextLines.length) lines.push(`Context (use only to resolve pronouns or ellipsis; never translate it):\n${contextLines.join('\n')}`)
  return {system: TRANSLATE_SYSTEM_PROMPT, user: lines.join('\n')}
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

async function callAnthropic(settings, {system, user}, maxTokens) {
  const data = await postJson(
    `${baseUrl(settings)}/v1/messages`,
    {'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01'},
    {model: settings.model, max_tokens: maxTokens, system, messages: [{role: 'user', content: user}]},
  )
  return (data.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
}

async function callOpenAI(settings, {system, user}, maxTokens) {
  const data = await postJson(
    `${baseUrl(settings)}/v1/chat/completions`,
    {authorization: `Bearer ${settings.apiKey}`},
    {
      model: settings.model,
      max_tokens: maxTokens,
      messages: [{role: 'system', content: system}, {role: 'user', content: user}],
    },
  )
  return data.choices?.[0]?.message?.content ?? ''
}

const PROVIDERS = new Map([
  ['anthropic', callAnthropic],
  ['openai', callOpenAI],
])

async function run(settings, prompt, maxTokens) {
  const call = PROVIDERS.get(settings.provider)
  if (!call) throw new Error(`Unknown AI provider: ${settings.provider}`)
  if (!settings.apiKey) throw new Error(`No API key set for ${settings.provider}. Add one in Settings.`)
  const reply = (await call(settings, prompt, maxTokens)).trim()
  if (!reply) throw new Error('AI returned an empty reply')
  return reply
}

async function explain(settings, req) {
  return run(settings, buildPrompt(req), MAX_TOKENS)
}

async function translate(settings, req) {
  const reply = await run(settings, buildTranslatePrompt(req), TRANSLATE_MAX_TOKENS)
  const text = reply.replace(/^[\s"'“”‘’「」『』]+|[\s"'“”‘’「」『』]+$/g, '')
  if (!text) throw new Error('AI returned an empty reply')
  return text
}

module.exports = {explain, translate, buildPrompt, buildTranslatePrompt}
