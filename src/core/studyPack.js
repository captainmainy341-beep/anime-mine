const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require('fflate');
const { RADICAL_NAMES } = require('./radicalNames');

const RELEASE_URL = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';
const USER_AGENT = 'anime-mine';
const ASSET_PATTERNS = [
  /^kanjidic2-en-.*\.json\.zip$/,
  /^kradfile-(?!.*u)[\d.+\w]*\.json\.zip$/,
  /^jmdict-examples-eng-.*\.json\.zip$/,
];
const MAX_KANJI_VOCAB_REFS = 12;
const MAX_SENTENCES = 2;
const MAX_SENTENCE_CHARS = 40;
const MAX_MEANINGS = 4;
const MAX_SINGLE_CHAR_VOCAB_PER_LEVEL = 8;
const WORD_FORM = /^[\p{Script=Han}\u3041-\u309F\u30FC]+$/u;
const COUNTER_OR_NUMBER_POS = new Set(['ctr', 'num']);
const DAY_OF_MONTH_GLOSS = /day of the month|^(the )?\d/i;

const isKanjiChar = (ch) => /\p{Script=Han}/u.test(ch);
const charCount = (text) => [...text].length;

function selectionKey({ misc }) {
  const grade = misc.grade;
  return misc.frequency + (grade >= 1 && grade <= 6 ? (grade - 1) * 150 : 600);
}

function englishMeanings(kanji) {
  return kanji.readingMeaning.groups.flatMap((group) =>
    group.meanings.filter((m) => m.lang === 'en').map((m) => m.value),
  );
}

function readingsOf(kanji, type) {
  return kanji.readingMeaning.groups.flatMap((group) =>
    group.readings.filter((r) => r.type === type).map((r) => r.value),
  );
}

function formChars(text, kanjiLevel) {
  const chars = [...new Set([...text].filter(isKanjiChar))];
  return chars.length > 0 && chars.every((ch) => kanjiLevel.has(ch)) ? chars : null;
}

function exampleSentences(word) {
  const seen = new Set();
  const pairs = [];
  for (const sense of word.sense) {
    for (const example of sense.examples) {
      const ja = example.sentences.find((s) => s.lang === 'jpn')?.text;
      const en = example.sentences.find((s) => s.lang === 'eng')?.text;
      if (!ja || !en || charCount(ja) > MAX_SENTENCE_CHARS || seen.has(ja)) continue;
      seen.add(ja);
      pairs.push({ ja, en });
    }
  }
  return pairs.sort((a, b) => charCount(a.ja) - charCount(b.ja));
}

function vocabCandidate(word, kanjiLevel, freqByChar) {
  const picked = word.kanji
    .filter((form) => form.common && WORD_FORM.test(form.text))
    .map((form) => ({ form, chars: formChars(form.text, kanjiLevel) }))
    .find((p) => p.chars);
  if (!picked || word.sense.every((sense) => sense.misc.includes('uk'))) return null;
  if (word.sense.every((sense) => sense.partOfSpeech.every((pos) => COUNTER_OR_NUMBER_POS.has(pos)))) return null;
  const firstGloss = word.sense[0].gloss.find((g) => g.lang === 'eng')?.text ?? '';
  if (DAY_OF_MONTH_GLOSS.test(firstGloss)) return null;
  const pairs = exampleSentences(word);
  if (pairs.length === 0) return null;

  const { form, chars } = picked;
  const entry = {
    id: `v:${word.id}`,
    word: form.text,
    kana: word.kana
      .filter((k) => k.appliesToKanji.includes('*') || k.appliesToKanji.includes(form.text))
      .slice(0, 2)
      .map((k) => k.text),
    meanings: word.sense
      .slice(0, 2)
      .flatMap((sense) => sense.gloss.filter((g) => g.lang === 'eng').map((g) => g.text))
      .slice(0, MAX_MEANINGS),
    pos: word.sense[0].partOfSpeech,
    kanji: chars.map((ch) => `k:${ch}`),
    level: Math.max(...chars.map((ch) => kanjiLevel.get(ch))),
    sentences: pairs.slice(0, MAX_SENTENCES),
  };
  const score = chars.reduce((sum, ch) => sum + freqByChar.get(ch), 0);
  return { entry, score, exampleCount: pairs.length, numericId: Number(word.id) };
}

function buildPack({ kanjidic, kradfile, examples }, { levels = 60, maxVocabPerLevel = 80, maxKanji = 2600 } = {}) {
  const chosen = kanjidic.characters
    .filter((c) => c.misc.frequency != null)
    .sort((a, b) => selectionKey(a) - selectionKey(b))
    .slice(0, maxKanji);
  const chunk = Math.max(1, Math.ceil(chosen.length / levels));
  const kanjiLevel = new Map(chosen.map((c, i) => [c.literal, Math.floor(i / chunk) + 1]));
  const freqByChar = new Map(chosen.map((c) => [c.literal, c.misc.frequency]));

  const components = new Map(chosen.map((c) => [c.literal, kradfile.kanji[c.literal] ?? []]));
  const usage = new Map();
  for (const parts of components.values()) {
    for (const part of new Set(parts)) usage.set(part, (usage.get(part) ?? 0) + 1);
  }
  const keepComponent = (glyph) => RADICAL_NAMES[glyph] !== undefined || usage.get(glyph) >= 2;

  const kanjiFirstMeaning = new Map();
  for (const c of chosen) {
    const [first] = englishMeanings(c);
    if (first !== undefined) kanjiFirstMeaning.set(c.literal, first);
  }
  const glyphName = (glyph) => kanjiFirstMeaning.get(glyph) ?? RADICAL_NAMES[glyph] ?? `component ${glyph}`;

  const byChar = new Map(chosen.map((c) => [c.literal, c]));
  // components mix r: radicals and k: kanji ids; a k: is used only for a kanji placed strictly earlier, so no cycles
  const usesKanjiComponent = (char, glyph) => {
    const glyphLevel = kanjiLevel.get(glyph);
    if (glyphLevel === undefined) return false;
    const level = kanjiLevel.get(char);
    return glyphLevel < level || (glyphLevel === level && selectionKey(byChar.get(glyph)) < selectionKey(byChar.get(char)));
  };
  const componentId = (char, glyph) => (usesKanjiComponent(char, glyph) ? `k:${glyph}` : `r:${glyph}`);
  const componentGlyphs = (char) => components.get(char).filter((glyph) => usesKanjiComponent(char, glyph) || keepComponent(glyph));

  const radicals = {};
  for (const c of chosen) {
    const level = kanjiLevel.get(c.literal);
    for (const glyph of components.get(c.literal)) {
      if (usesKanjiComponent(c.literal, glyph) || !keepComponent(glyph)) continue;
      const id = `r:${glyph}`;
      if (radicals[id]) radicals[id].level = Math.min(radicals[id].level, level);
      else radicals[id] = { id, char: glyph, name: glyphName(glyph), level };
    }
  }

  const kanji = {};
  for (const c of chosen) {
    const char = c.literal;
    const glyphs = componentGlyphs(char);
    kanji[`k:${char}`] = {
      id: `k:${char}`,
      char,
      meanings: englishMeanings(c),
      onyomi: readingsOf(c, 'ja_on'),
      kunyomi: readingsOf(c, 'ja_kun'),
      nanori: c.readingMeaning.nanori ?? [],
      strokes: c.misc.strokeCounts[0],
      grade: c.misc.grade ?? null,
      jlptOld: c.misc.jlptLevel ?? null,
      freq: c.misc.frequency,
      level: kanjiLevel.get(char),
      components: glyphs.map((glyph) => componentId(char, glyph)),
      hint: glyphs.map((glyph) => glyphName(glyph)).join(' + '),
      vocab: [],
    };
  }

  const candidates = [];
  for (const word of examples.words) {
    const candidate = vocabCandidate(word, kanjiLevel, freqByChar);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((a, b) => b.exampleCount - a.exampleCount || a.score - b.score || a.numericId - b.numericId);

  const keptPerLevel = new Map();
  const singleCharPerLevel = new Map();
  const seenWords = new Set();
  const kept = [];
  for (const { entry } of candidates) {
    if (seenWords.has(entry.word)) continue;
    const count = keptPerLevel.get(entry.level) ?? 0;
    if (count >= maxVocabPerLevel) continue;
    const isSingle = charCount(entry.word) === 1;
    const singles = singleCharPerLevel.get(entry.level) ?? 0;
    if (isSingle && singles >= MAX_SINGLE_CHAR_VOCAB_PER_LEVEL) continue;
    seenWords.add(entry.word);
    keptPerLevel.set(entry.level, count + 1);
    if (isSingle) singleCharPerLevel.set(entry.level, singles + 1);
    kept.push(entry);
  }

  for (const entry of kept) {
    for (const kanjiId of entry.kanji) {
      const target = kanji[kanjiId];
      if (target.vocab.length < MAX_KANJI_VOCAB_REFS) target.vocab.push(entry.id);
    }
  }

  const vocab = Object.fromEntries(kept.map((entry) => [entry.id, entry]));
  const levelList = Array.from({ length: levels }, (_, i) => {
    const level = i + 1;
    return {
      level,
      radicals: Object.values(radicals).filter((r) => r.level === level).map((r) => r.id),
      kanji: Object.values(kanji).filter((k) => k.level === level).map((k) => k.id),
      vocab: kept.filter((v) => v.level === level).map((v) => v.id),
    };
  });

  return { version: 1, levels, radicals, kanji, vocab, levelList };
}

async function fetchRelease(fetchImpl) {
  const res = await fetchImpl(RELEASE_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub request failed: HTTP ${res.status}`);
  return res.json();
}

function pickAsset(release, pattern) {
  const asset = release.assets.find(({ name }) => pattern.test(name) && !name.includes('common'));
  if (!asset) throw new Error(`No study data asset matching ${pattern} in latest release`);
  return asset;
}

async function fetchBytes(fetchImpl, url, onFraction) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Study data download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks = [];
  let received = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (total) onFraction(Math.min(1, received / total));
  }
  onFraction(1);
  return Buffer.concat(chunks);
}

function parseArchive(bytes) {
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((file) => file.endsWith('.json'));
  if (!name) throw new Error('Study data archive contains no JSON file');
  return JSON.parse(Buffer.from(files[name]).toString('utf8'));
}

function packFile(dataDir) {
  return path.join(dataDir, 'study-pack.json');
}

async function downloadPack({ dataDir, fetchImpl = fetch, onProgress = () => {}, now = Date.now() }) {
  const release = await fetchRelease(fetchImpl);
  const assets = ASSET_PATTERNS.map((pattern) => pickAsset(release, pattern));

  const archives = [];
  for (const [i, asset] of assets.entries()) {
    archives.push(await fetchBytes(fetchImpl, asset.browser_download_url, (f) =>
      onProgress(((i + f) / assets.length) * 0.6),
    ));
  }
  const datasets = [];
  for (const [i, bytes] of archives.entries()) {
    datasets.push(parseArchive(bytes));
    onProgress(0.6 + ((i + 1) / assets.length) * 0.2);
  }
  const [kanjidic, kradfile, examples] = datasets;

  const pack = { ...buildPack({ kanjidic, kradfile, examples }), builtAt: now };
  const file = packFile(dataDir);
  await fs.promises.mkdir(dataDir, { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(pack));
  await fs.promises.rename(tmp, file);
  onProgress(1);
}

function loadPack(dataDir) {
  try {
    return JSON.parse(fs.readFileSync(packFile(dataDir), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function notReadyStatus() {
  return { ready: false, builtAt: null, counts: { radicals: 0, kanji: 0, vocab: 0 } };
}

const statusCache = new Map();

function packStatus(dataDir) {
  let stat;
  try {
    stat = fs.statSync(packFile(dataDir));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    statusCache.delete(dataDir);
    return notReadyStatus();
  }
  const cached = statusCache.get(dataDir);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.status;
  const pack = loadPack(dataDir);
  if (!pack) return notReadyStatus();
  const status = {
    ready: true,
    builtAt: pack.builtAt,
    counts: {
      radicals: Object.keys(pack.radicals).length,
      kanji: Object.keys(pack.kanji).length,
      vocab: Object.keys(pack.vocab).length,
    },
  };
  statusCache.set(dataDir, { mtimeMs: stat.mtimeMs, size: stat.size, status });
  return status;
}

module.exports = { buildPack, downloadPack, loadPack, packStatus };
