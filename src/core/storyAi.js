const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseAiScene, assertScene, ITEM_PATTERN } = require('./storySchema');

const CACHE_DIR = 'story-ai';
const MAX_TOKENS = 2200;
const MAX_ITEMS = 6;
const PROMPT_VERSION = 'v1';

const SYSTEM = [
  'You write short visual-novel side-quest scenes for a Japanese learner.',
  'Reply with ONE JSON object and nothing else: no markdown, no commentary.',
  'All characters and plot must be original. Use simple Japanese suited to the given JLPT level; add an English gloss in "en" for every dialogue line.',
  'Schema: {"schema":1,"title":str,"jlpt":"N5","summary":str,"bg":str?,"characters":{"<id>":{"name":str}},"glossary":{"<item>":{"label":str,"reading":str?,"meaning":str}},"beats":[...]}',
  'Character ids and bg use only a-z, 0-9, - and _. Beat types:',
  '{"type":"say","who":"<character id>"|null,"text":str,"en":str}',
  '{"type":"show","char":id,"expr":"neutral","pos":"left|center|right"}',
  '{"type":"intro","item":"<item>"}  (a short explanation card, place it before the first challenge on that item)',
  '{"type":"choice","item":"<grammar item>","who":id|null,"prompt":str,"options":[{"text":str,"correct":bool,"awkward":{"who":id|null,"text":str}}]}  (2-4 options, EXACTLY ONE correct, the others clearly ungrammatical)',
  '{"type":"reading","item":"<kanji item>","display":str,"target":str,"answers":["<reading in hiragana>"]}  (display contains the kanji; answers are the readings in this context)',
  '{"type":"meaning","item":"<item>","display":str,"prompt":str,"options":[str],"correct":int}',
  'Use only the items you are given, each in at least one challenge. 10 to 16 beats, at least 3 dialogue lines.',
].join('\n');

function describeItem(item) {
  const parts = [item.id, item.label];
  if (item.reading) parts.push(`reading: ${item.reading}`);
  if (item.meaning) parts.push(`meaning: ${item.meaning}`);
  return `- ${parts.join(' | ')}`;
}

function buildPrompt(items, jlpt, problem) {
  const lines = [`JLPT level: ${jlpt}`, 'Target items (use these exact item ids):', ...items.map(describeItem)];
  if (problem) lines.push('', `Your previous reply was rejected: ${problem}. Fix it and reply with the JSON object only.`);
  return { system: SYSTEM, user: lines.join('\n') };
}

function cacheKey(items, jlpt) {
  const ids = [...new Set(items.map((i) => i.id))].sort();
  return crypto.createHash('sha1').update(`${PROMPT_VERSION}|${jlpt}|${ids.join(',')}`).digest('hex').slice(0, 12);
}

function sceneIdFor(key) {
  return `ai-${key}`;
}

function cachePath(dataDir, id) {
  if (!/^ai-[0-9a-f]{12}$/.test(id)) throw new Error('invalid AI scene id');
  return path.join(dataDir, CACHE_DIR, `${id}.json`);
}

function readCached(dataDir, id) {
  try {
    return assertScene(JSON.parse(fs.readFileSync(cachePath(dataDir, id), 'utf8')));
  } catch {
    return null;
  }
}

function listCached(dataDir) {
  try {
    return fs
      .readdirSync(path.join(dataDir, CACHE_DIR))
      .filter((name) => /^ai-[0-9a-f]{12}\.json$/.test(name))
      .map((name) => readCached(dataDir, name.slice(0, -5)))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Generates (or replays from cache) one side-quest scene for the given study items.
// Only the scene JSON is cached: never settings, never the API key, never the prompt.
async function generateScene({ dataDir, complete, settings, items, jlpt = 'N5' }) {
  const targets = items.filter((i) => ITEM_PATTERN.test(i.id)).slice(0, MAX_ITEMS);
  if (targets.length === 0) throw new Error('No study items to build a scene from yet');
  const key = cacheKey(targets, jlpt);
  const id = sceneIdFor(key);
  const cached = readCached(dataDir, id);
  if (cached) return { scene: cached, cached: true, repairs: [] };

  const allowedItems = targets.map((i) => i.id);
  let problem = null;
  let failure = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await complete(settings, buildPrompt(targets, jlpt, problem), MAX_TOKENS);
    try {
      const { scene, repairs } = parseAiScene(reply, { allowedItems, id, jlpt });
      const covered = new Set(scene.beats.filter((b) => ['choice', 'reading', 'meaning'].includes(b.type)).map((b) => b.item));
      if (covered.size === 0) throw new Error('no challenge uses the target items');
      fs.mkdirSync(path.join(dataDir, CACHE_DIR), { recursive: true });
      fs.writeFileSync(cachePath(dataDir, id), JSON.stringify(scene));
      return { scene, cached: false, repairs };
    } catch (err) {
      failure = err;
      problem = err.message;
    }
  }
  throw new Error(`The AI did not return a usable scene (${failure.message}). Try again.`);
}

module.exports = { generateScene, listCached, readCached, buildPrompt, cacheKey, sceneIdFor, CACHE_DIR };
