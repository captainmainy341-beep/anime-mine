const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { generateScene, listCached, buildPrompt, cacheKey } = require('../src/core/storyAi');

const dirs = [];
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-ai-'));
  dirs.push(dir);
  return dir;
};

const items = [
  { id: 'k:雨', label: '雨', reading: 'あめ', meaning: 'rain' },
  { id: 'g:n5-ka', label: '〜か', meaning: 'question marker' },
];
const reply = JSON.stringify({
  title: 'Rain',
  characters: { rin: { name: 'りん' } },
  beats: [
    { type: 'say', who: 'rin', text: '雨ですね。' },
    { type: 'reading', item: 'k:雨', display: '雨', answers: ['あめ'] },
    { type: 'choice', item: 'g:n5-ka', options: [{ text: '雨ですか。', correct: true }, { text: '雨かです。' }] },
  ],
});
const settings = { provider: 'openai', apiKey: 'sk-SECRET-KEY', model: 'm' };

test('the prompt carries the target items and the schema, and no secrets', () => {
  const { system, user } = buildPrompt(items, 'N5', null);
  assert.match(user, /k:雨 \| 雨 \| reading: あめ \| meaning: rain/);
  assert.match(user, /g:n5-ka/);
  assert.match(system, /ONE JSON object/);
  assert.match(system, /EXACTLY ONE correct/);
  assert.doesNotMatch(system + user, /SECRET/);
  assert.match(buildPrompt(items, 'N5', 'bad json').user, /previous reply was rejected: bad json/);
});

test('a generated scene is validated, cached on disk without any credentials, and replayed for free', async () => {
  const dir = tmp();
  const prompts = [];
  const complete = async (s, prompt, max) => {
    prompts.push({ s, prompt, max });
    return `Here you go:\n\`\`\`json\n${reply}\n\`\`\``;
  };
  const first = await generateScene({ dataDir: dir, complete, settings, items });
  assert.equal(first.cached, false);
  assert.equal(first.scene.source, 'ai');
  assert.match(first.scene.id, /^ai-[0-9a-f]{12}$/);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].s, settings, 'the learner\'s configured provider settings are passed straight through');

  const replay = await generateScene({ dataDir: dir, complete: async () => { throw new Error('must not be called'); }, settings, items: [...items].reverse() });
  assert.equal(replay.cached, true);
  assert.deepEqual(replay.scene, first.scene);
  assert.equal(listCached(dir).length, 1);

  for (const file of fs.readdirSync(path.join(dir, 'story-ai'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'story-ai', file), 'utf8'), /SECRET|apiKey/);
  }
});

test('a bad first reply gets one repair attempt that quotes the problem', async () => {
  const dir = tmp();
  const replies = ['I am sorry, here is some prose.', reply];
  const seen = [];
  const out = await generateScene({ dataDir: dir, settings, items, complete: async (s, prompt) => { seen.push(prompt.user); return replies.shift(); } });
  assert.equal(out.cached, false);
  assert.equal(seen.length, 2);
  assert.match(seen[1], /did not contain a JSON scene/);
});

test('two unusable replies fail with a readable error and cache nothing', async () => {
  const dir = tmp();
  await assert.rejects(
    generateScene({ dataDir: dir, settings, items, complete: async () => '{"title":"x"}' }),
    /did not return a usable scene/,
  );
  assert.deepEqual(listCached(dir), []);
});

test('provider errors propagate and nothing is cached', async () => {
  const dir = tmp();
  await assert.rejects(generateScene({ dataDir: dir, settings, items, complete: async () => { throw new Error('AI request failed (401)'); } }), /401/);
  assert.deepEqual(listCached(dir), []);
});

test('no items means no request', async () => {
  await assert.rejects(generateScene({ dataDir: tmp(), settings, items: [], complete: async () => assert.fail('no call') }), /No study items/);
  await assert.rejects(generateScene({ dataDir: tmp(), settings, items: [{ id: 'bad' }], complete: async () => assert.fail('no call') }), /No study items/);
});

test('the cache key ignores order and duplicates but not level or items', () => {
  assert.equal(cacheKey(items, 'N5'), cacheKey([items[1], items[0], items[0]], 'N5'));
  assert.notEqual(cacheKey(items, 'N5'), cacheKey(items, 'N4'));
  assert.notEqual(cacheKey(items, 'N5'), cacheKey([items[0]], 'N5'));
});
