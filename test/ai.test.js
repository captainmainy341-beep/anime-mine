const test = require('node:test')
const assert = require('node:assert/strict')
const {explain, translate, complete, aiReady, deps, buildPrompt, buildTranslatePrompt} = require('../src/core/ai')

const anthropicSettings = {provider: 'anthropic', apiKey: 'sk-test', model: 'claude-haiku-4-5-20251001'}
const openaiSettings = {provider: 'openai', apiKey: 'sk-openai', model: 'gpt-4o-mini'}

function stubFetch(t, status, body) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({url, init, body: JSON.parse(init.body)})
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(text, {status, headers: {'content-type': 'application/json'}})
  })
  return calls
}

test('buildPrompt includes the word, sentence and context when given', () => {
  const {user} = buildPrompt({word: '食べる', sentence: '朝ご飯を食べた。', context: 'breakfast scene'})
  assert.match(user, /「食べる」/)
  assert.match(user, /Sentence: 朝ご飯を食べた。/)
  assert.match(user, /Context: breakfast scene/)
  assert.match(user, /English translation/)
})

test('buildPrompt omits the word explanation when no word is given', () => {
  const {user} = buildPrompt({sentence: 'おはよう。'})
  assert.doesNotMatch(user, /Explain the word/)
  assert.match(user, /Sentence: おはよう。/)
  assert.doesNotMatch(user, /Context:/)
})

test('buildPrompt system prompt targets N4 learners and asks for plain text under 150 words', () => {
  const {system} = buildPrompt({sentence: 'x'})
  assert.match(system, /N4/)
  assert.match(system, /no markdown/)
  assert.match(system, /under 150 words/)
})

test('anthropic: posts to the messages endpoint with key, version and body', async t => {
  const calls = stubFetch(t, 200, {content: [{type: 'text', text: '  It was breakfast.  '}]})
  const reply = await explain(anthropicSettings, {word: '食べる', sentence: '朝ご飯を食べた。'})

  assert.equal(reply, 'It was breakfast.')
  assert.equal(calls.length, 1)
  const {url, init, body} = calls[0]
  const prompt = buildPrompt({word: '食べる', sentence: '朝ご飯を食べた。'})
  assert.equal(url, 'https://api.anthropic.com/v1/messages')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers['content-type'], 'application/json')
  assert.equal(init.headers['x-api-key'], 'sk-test')
  assert.equal(init.headers['anthropic-version'], '2023-06-01')
  assert.deepEqual(body, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    system: prompt.system,
    messages: [{role: 'user', content: prompt.user}],
  })
})

test('anthropic: joins only text blocks of the reply', async t => {
  stubFetch(t, 200, {content: [{type: 'text', text: 'Hello'}, {type: 'thinking', text: 'x'}, {type: 'text', text: ' world'}]})
  assert.equal(await explain(anthropicSettings, {sentence: 'x'}), 'Hello world')
})

test('anthropic: honours a custom baseUrl', async t => {
  const calls = stubFetch(t, 200, {content: [{type: 'text', text: 'ok'}]})
  await explain({...anthropicSettings, baseUrl: 'http://localhost:9000/'}, {sentence: 'x'})
  assert.equal(calls[0].url, 'http://localhost:9000/v1/messages')
})

test('openai: posts to chat completions with a bearer key and system message', async t => {
  const calls = stubFetch(t, 200, {choices: [{message: {role: 'assistant', content: 'Good morning.'}}]})
  const reply = await explain(openaiSettings, {sentence: 'おはよう。', context: 'greeting'})

  assert.equal(reply, 'Good morning.')
  const prompt = buildPrompt({sentence: 'おはよう。', context: 'greeting'})
  const {url, init, body} = calls[0]
  assert.equal(url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers.authorization, 'Bearer sk-openai')
  assert.deepEqual(body, {
    model: 'gpt-4o-mini',
    max_tokens: 700,
    messages: [
      {role: 'system', content: prompt.system},
      {role: 'user', content: prompt.user},
    ],
  })
})

test('openai: honours a custom baseUrl', async t => {
  const calls = stubFetch(t, 200, {choices: [{message: {content: 'ok'}}]})
  await explain({...openaiSettings, baseUrl: 'http://localhost:1234'}, {sentence: 'x'})
  assert.equal(calls[0].url, 'http://localhost:1234/v1/chat/completions')
})

test('throws before any request when the API key is missing', async t => {
  const calls = stubFetch(t, 200, {})
  await assert.rejects(explain({...anthropicSettings, apiKey: ''}, {sentence: 'x'}), /No API key set for anthropic/)
  await assert.rejects(explain({...openaiSettings, apiKey: undefined}, {sentence: 'x'}), /No API key set for openai/)
  assert.equal(calls.length, 0)
})

test('non-2xx responses surface the status and the API error message', async t => {
  stubFetch(t, 401, {type: 'error', error: {type: 'authentication_error', message: 'invalid x-api-key'}})
  await assert.rejects(explain(anthropicSettings, {sentence: 'x'}), /AI request failed \(401\): invalid x-api-key/)
})

test('non-2xx responses with a plain-text body include that body', async t => {
  stubFetch(t, 502, 'bad gateway')
  await assert.rejects(explain(openaiSettings, {sentence: 'x'}), /AI request failed \(502\): bad gateway/)
})

test('unknown provider is rejected', async t => {
  const calls = stubFetch(t, 200, {})
  await assert.rejects(explain({provider: 'gemini', apiKey: 'k'}, {sentence: 'x'}), /Unknown AI provider: gemini/)
  assert.equal(calls.length, 0)
})

test('an empty reply is rejected', async t => {
  stubFetch(t, 200, {content: []})
  await assert.rejects(explain(anthropicSettings, {sentence: 'x'}), /empty reply/)
})

test('buildTranslatePrompt asks for only the English translation, one line, no quotes', () => {
  const {system, user} = buildTranslatePrompt({sentence: '彼は行った。'})
  assert.match(system, /ONLY the English translation/)
  assert.match(system, /on one line/)
  assert.match(system, /No quotes/)
  assert.equal(user, 'Sentence: 彼は行った。')
})

test('buildTranslatePrompt includes at most two non-empty context lines, marked as not to translate', () => {
  const {user} = buildTranslatePrompt({sentence: '行った。', context: 'A: どこ行くの？\n\nB: 学校。\nC: 早く。'})
  assert.match(user, /never translate it/)
  assert.match(user, /A: どこ行くの？\nB: 学校。/)
  assert.doesNotMatch(user, /早く/)
})

test('buildTranslatePrompt omits the context section when none is given', () => {
  const {user} = buildTranslatePrompt({sentence: 'おはよう。', context: '  \n '})
  assert.doesNotMatch(user, /Context/)
})

test('translate: anthropic posts the translate prompt with a 200 token cap', async t => {
  const calls = stubFetch(t, 200, {content: [{type: 'text', text: 'He went.'}]})
  const reply = await translate(anthropicSettings, {sentence: '彼は行った。', context: 'A: どこ?'})

  assert.equal(reply, 'He went.')
  const prompt = buildTranslatePrompt({sentence: '彼は行った。', context: 'A: どこ?'})
  const {url, init, body} = calls[0]
  assert.equal(url, 'https://api.anthropic.com/v1/messages')
  assert.equal(init.headers['x-api-key'], 'sk-test')
  assert.equal(init.headers['anthropic-version'], '2023-06-01')
  assert.deepEqual(body, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system: prompt.system,
    messages: [{role: 'user', content: prompt.user}],
  })
})

test('translate: openai posts the translate prompt with a 200 token cap', async t => {
  const calls = stubFetch(t, 200, {choices: [{message: {role: 'assistant', content: 'Good morning.'}}]})
  const reply = await translate(openaiSettings, {sentence: 'おはよう。'})

  assert.equal(reply, 'Good morning.')
  const prompt = buildTranslatePrompt({sentence: 'おはよう。'})
  const {url, init, body} = calls[0]
  assert.equal(url, 'https://api.openai.com/v1/chat/completions')
  assert.equal(init.headers.authorization, 'Bearer sk-openai')
  assert.deepEqual(body, {
    model: 'gpt-4o-mini',
    max_tokens: 200,
    messages: [
      {role: 'system', content: prompt.system},
      {role: 'user', content: prompt.user},
    ],
  })
})

test('translate trims whitespace and surrounding quotes from the reply', async t => {
  stubFetch(t, 200, {content: [{type: 'text', text: '\n  "It was breakfast."  \n'}]})
  assert.equal(await translate(anthropicSettings, {sentence: 'x'}), 'It was breakfast.')
})

test('translate strips Japanese and curly quotes', async t => {
  stubFetch(t, 200, {choices: [{message: {content: '「Let’s go.」'}}]})
  assert.equal(await translate(openaiSettings, {sentence: 'x'}), 'Let’s go.')
})

test('translate rejects a reply that is only quotes or whitespace', async t => {
  stubFetch(t, 200, {content: [{type: 'text', text: ' "" '}]})
  await assert.rejects(translate(anthropicSettings, {sentence: 'x'}), /empty reply/)
})

test('translate throws the same readable errors as explain', async t => {
  const calls = stubFetch(t, 200, {})
  await assert.rejects(translate({...anthropicSettings, apiKey: ''}, {sentence: 'x'}), /No API key set for anthropic/)
  await assert.rejects(translate({provider: 'gemini', apiKey: 'k'}, {sentence: 'x'}), /Unknown AI provider: gemini/)
  assert.equal(calls.length, 0)
})

test('translate surfaces non-2xx status and API error message', async t => {
  stubFetch(t, 429, {error: {message: 'rate limited'}})
  await assert.rejects(translate(openaiSettings, {sentence: 'x'}), /AI request failed \(429\): rate limited/)
})

test('translate rejects an empty reply', async t => {
  stubFetch(t, 200, {choices: [{message: {content: '   '}}]})
  await assert.rejects(translate(openaiSettings, {sentence: 'x'}), /empty reply/)
})

test('explain still uses the 700 token cap', async t => {
  const calls = stubFetch(t, 200, {choices: [{message: {content: 'ok'}}]})
  await explain(openaiSettings, {sentence: 'x'})
  assert.equal(calls[0].body.max_tokens, 700)
})

test('complete sends the given system and user prompt with the requested token cap', async t => {
  const calls = stubFetch(t, 200, {content: [{type: 'text', text: '  A hook.  '}]})
  const reply = await complete(anthropicSettings, {system: 'sys', user: 'usr'}, 300)

  assert.equal(reply, 'A hook.')
  assert.equal(calls[0].body.max_tokens, 300)
  assert.equal(calls[0].body.system, 'sys')
  assert.deepEqual(calls[0].body.messages, [{role: 'user', content: 'usr'}])
})

const claudeSettings = {provider: 'claude-cli', apiKey: '', model: 'claude-haiku-4-5-20251001'}

function stubExecFile(t, handler) {
  const calls = []
  t.mock.method(deps, 'execFile', (file, args, options, callback) => {
    calls.push({file, args, options})
    handler(callback)
  })
  return calls
}

test('claude-cli: runs Claude Code with Haiku 5.5 at medium effort, no tools, and no API key', async t => {
  const calls = stubExecFile(t, callback => callback(null, '  It was breakfast.\n', ''))
  const prompt = buildTranslatePrompt({sentence: '朝ご飯を食べた。'})
  const reply = await translate(claudeSettings, {sentence: '朝ご飯を食べた。'})

  assert.equal(reply, 'It was breakfast.')
  assert.equal(calls.length, 1)
  const {args} = calls[0]
  const flag = name => args[args.indexOf(name) + 1]
  assert.equal(args[0], '-p')
  assert.equal(flag('--model'), 'claude-haiku-5-5')
  assert.equal(flag('--effort'), 'medium')
  assert.equal(flag('--system-prompt'), prompt.system)
  assert.equal(flag('--tools'), '')
  assert.ok(args.includes('--no-session-persistence'))
  assert.equal(args.at(-1), prompt.user)
})

test('claude-cli: a missing binary gets a friendly install message', async t => {
  stubExecFile(t, callback => callback(Object.assign(new Error('spawn claude ENOENT'), {code: 'ENOENT'}), '', ''))
  await assert.rejects(
    translate(claudeSettings, {sentence: 'x'}),
    {message: 'Claude Code not found. Install it and run "claude" once to log in, or pick another provider in Settings.'},
  )
})

test('claude-cli: other failures surface the start of stderr', async t => {
  stubExecFile(t, callback => callback(new Error('Command failed'), '', 'not logged in'))
  await assert.rejects(translate(claudeSettings, {sentence: 'x'}), {message: 'Claude Code failed: not logged in'})
})

test('aiReady: claude-cli needs no key, other providers need one', () => {
  assert.equal(aiReady({provider: 'claude-cli', apiKey: ''}), true)
  assert.equal(aiReady({provider: 'anthropic', apiKey: 'sk-test'}), true)
  assert.equal(aiReady({provider: 'anthropic', apiKey: ''}), false)
  assert.equal(aiReady(undefined), false)
})
