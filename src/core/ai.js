const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const deps = {execFile: require('node:child_process').execFile}

const CLAUDE_CLI_MODEL = 'claude-haiku-5-5'
const LEGACY_DEFAULT_MODEL = 'claude-haiku-4-5-20251001'
const CLAUDE_MISSING = 'Claude Code not found. Install it and run "claude" once to log in, or pick another provider in Settings.'

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

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function findClaude() {
  const home = os.homedir()
  const candidates = [
    process.env.CLAUDE_BIN,
    path.join(home, '.local/bin/claude'),
    path.join(home, '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(home, '.local/share/pi-node/current/bin/claude'),
  ]
  return candidates.find(candidate => candidate && isExecutable(candidate)) || 'claude'
}

function claudeModel(settings) {
  const model = settings.model
  return model && model.startsWith('claude-') && model !== LEGACY_DEFAULT_MODEL ? model : CLAUDE_CLI_MODEL
}

function claudeWorkDir() {
  const dir = path.join(os.tmpdir(), `anime-mine-claude-${os.userInfo().username}`)
  fs.mkdirSync(dir, {recursive: true, mode: 0o700})
  return dir
}

function claudeEnv(bin) {
  const dirs = path.isAbsolute(bin) ? [path.dirname(bin)] : []
  const {CLAUDECODE, ...env} = process.env
  return {...env, PATH: [...dirs, process.env.PATH].filter(Boolean).join(path.delimiter)}
}

async function callClaudeCli(settings, {system, user}) {
  const bin = findClaude()
  const args = [
    '-p', '--model', claudeModel(settings), '--effort', 'medium',
    '--system-prompt', system, '--setting-sources', 'user', '--tools', '', '--no-session-persistence', '--', user,
  ]
  const options = {timeout: 60000, maxBuffer: 1024 * 1024, cwd: claudeWorkDir(), env: claudeEnv(bin)}
  return new Promise((resolve, reject) => {
    const child = deps.execFile(bin, args, options, (err, stdout, stderr) => {
      if (!err) return resolve(stdout)
      if (err.code === 'ENOENT') return reject(new Error(CLAUDE_MISSING))
      reject(new Error(`Claude Code failed: ${String(stderr || err.message).trim().slice(0, 200)}`))
    })
    child?.stdin?.end()
  })
}

const PROVIDERS = new Map([
  ['claude-cli', callClaudeCli],
  ['anthropic', callAnthropic],
  ['openai', callOpenAI],
])

function aiReady(settings) {
  return Boolean(settings && (settings.provider === 'claude-cli' || settings.apiKey))
}

async function run(settings, prompt, maxTokens) {
  const call = PROVIDERS.get(settings.provider)
  if (!call) throw new Error(`Unknown AI provider: ${settings.provider}`)
  if (!aiReady(settings)) throw new Error(`No API key set for ${settings.provider}. Add one in Settings.`)
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

async function complete(settings, {system, user}, maxTokens = 400) {
  return run(settings, {system, user}, maxTokens)
}

module.exports = {explain, translate, complete, aiReady, deps, buildPrompt, buildTranslatePrompt}
