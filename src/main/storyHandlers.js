const fs = require('node:fs');
const path = require('node:path');
const media = require('../core/media');
const ai = require('../core/ai');
const { assertScene, ITEM_PATTERN, NAME_PATTERN } = require('../core/storySchema');
const { loadChapters, chapterSummary } = require('../core/storyContent');
const { StoryProgress } = require('../core/storyProgress');
const { buildAnimeScenes, sceneId: animeSceneId } = require('../core/storyAnime');
const { generateScene, listCached, readCached } = require('../core/storyAi');
const skins = require('../core/storySkins');
const particles = require('../core/storyParticles');
const { loadLessons, lessonSummary } = require('../core/storyLessons');

const ANIME_DIR = 'story-anime';
const ANIME_ID = /^anime-[0-9a-f]{10}$/;
const MAX_INCORRECT = 50;
const MAX_ANIME_BUILD = 6;
const MAX_ITEMS = 6;
const SCENE_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const SINGLE_KANJI = /^\p{Script=Han}$/u;
const MAX_KANJI_WORDS = 5;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function assertObject(value, name) {
  if (!isPlainObject(value)) throw new Error(`${name} must be an object`);
}

function assertSceneId(id) {
  if (typeof id !== 'string' || !SCENE_ID.test(id)) throw new Error(`invalid scene id: ${String(id)}`);
}

function assertItem(id) {
  if (typeof id !== 'string' || !ITEM_PATTERN.test(id)) throw new Error(`invalid study item: ${String(id)}`);
}

function assertInt(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
}

function itemInfo(id, card, glossary = {}) {
  const fallback = glossary[id] ?? null;
  if (!card) return fallback ? { ...fallback } : { label: id.slice(2), meaning: '' };
  if (card.kind === 'grammar') {
    return { label: card.title, meaning: card.meaning, note: [card.structure, card.notes].filter(Boolean).join(' — ') };
  }
  return {
    label: card.char ?? card.word ?? fallback?.label ?? id.slice(2),
    reading: card.readingText || fallback?.reading || '',
    meaning: (card.meanings ?? []).join(', ') || fallback?.meaning || '',
    note: fallback?.note ?? '',
  };
}

// `learn` is the already-registered map of learn:* IPC handlers. Story reads cards and writes SRS results
// only through them, so scheduling stays in one place (learnStore + srs).
function createStoryHandlers({ dataDir, learn, getSettings, deps = {} }) {
  const screenshot = deps.screenshot ?? media.screenshot;
  const complete = deps.complete ?? ai.complete;
  const aiReady = deps.aiReady ?? ai.aiReady;
  const now = deps.now ?? Date.now;
  const fileExists = deps.fileExists ?? (async (file) => fs.promises.access(file).then(() => true, () => false));
  const progress = new StoryProgress(dataDir, { now });
  const chapters = loadChapters().chapters;
  const chapterById = new Map(chapters.map((c) => [c.id, c]));
  const lessonById = new Map(loadLessons().lessons.map((l) => [l.id, l]));
  const animeDir = path.join(dataDir, ANIME_DIR);

  async function cardOf(id) {
    try {
      return await learn['learn:card'](id);
    } catch {
      return null;
    }
  }

  function readAnime(id) {
    try {
      return assertScene(JSON.parse(fs.readFileSync(path.join(animeDir, `${id}.json`), 'utf8')));
    } catch {
      return null;
    }
  }

  function listAnime() {
    try {
      return fs.readdirSync(animeDir).filter((n) => /^anime-[0-9a-f]{10}\.json$/.test(n)).map((n) => readAnime(n.slice(0, -5))).filter(Boolean);
    } catch {
      return [];
    }
  }

  function findScene(id) {
    assertSceneId(id);
    if (chapterById.has(id)) return chapterById.get(id);
    if (ANIME_ID.test(id)) return readAnime(id);
    if (/^ai-[0-9a-f]{12}$/.test(id)) return readCached(dataDir, id);
    return null;
  }

  function requireScene(id) {
    const scene = findScene(id);
    if (!scene) throw new Error(`unknown story scene: ${id}`);
    return scene;
  }

  const stateOf = (card) => (!card ? 'untracked' : card.stage > 0 ? 'started' : card.locked ? 'untracked' : 'new');

  async function itemStatuses(scene) {
    const out = {};
    for (const id of scene.items) {
      const card = await cardOf(id);
      out[id] = { state: stateOf(card), ...itemInfo(id, card, scene.glossary) };
    }
    return out;
  }

  // Dictionary handlers are optional here: tests and stripped-down builds may not register them.
  async function optional(channel, ...args) {
    if (typeof learn[channel] !== 'function') return null;
    try {
      return await learn[channel](...args);
    } catch {
      return null;
    }
  }

  function primerOf(sceneId) {
    const lesson = lessonById.get(sceneId);
    if (!lesson) return null;
    const done = progress.state.lessons[sceneId] ?? null;
    return { ...lessonSummary(lesson), done: (done?.plays ?? 0) > 0, plays: done?.plays ?? 0, accuracy: done?.bestAccuracy ?? 0 };
  }

  function summaryOf(scene) {
    const done = progress.state.chapters[scene.id] ?? null;
    const primer = primerOf(scene.id);
    const slot = progress.hasSave(scene.id) ? progress.loadSlot(scene.id) : null;
    const resume = slot && Number.isInteger(slot.index) ? Math.max(0, Math.min(1, slot.index / scene.beats.length)) : 0;
    return { ...chapterSummary(scene), completed: (done?.plays ?? 0) > 0, plays: done?.plays ?? 0, saved: slot !== null, resume, ...(primer ? { primer } : {}) };
  }

  async function startedItems(kind, limit) {
    const rows = await learn['learn:browse']({ type: kind });
    return rows.filter((row) => row.stage > 0).sort((a, b) => a.stage - b.stage).slice(0, limit);
  }

  const handlers = {
    'story:list': async () => {
      const settings = await getSettings();
      return {
        chapters: chapters.filter((c) => (c.track ?? 'main') === 'main').map(summaryOf),
        genki: chapters.filter((c) => c.track === 'genki').map(summaryOf),
        anime: listAnime().map(summaryOf),
        ai: { ready: aiReady(settings.ai), scenes: listCached(dataDir).map(summaryOf) },
        skins: skins.listPacks(dataDir),
        overview: progress.overview(),
      };
    },
    // Light summary of the Genki path for the Learn home and grammar pages: lessons in order, plus which lesson teaches which grammar point.
    'story:genki': async () => {
      const lessons = [...lessonById.values()].sort((a, b) => a.lesson - b.lesson);
      const rows = lessons.map((lesson) => {
        const primer = primerOf(lesson.id);
        const story = progress.state.chapters[lesson.id] ?? null;
        return { id: lesson.id, lesson: lesson.lesson, title: lesson.title, tagline: lesson.tagline, minutes: lesson.minutes, words: lesson.vocab.length, patterns: lesson.points.length, learned: Boolean(primer?.done), hasStory: chapters.some((c) => c.id === lesson.id), storyDone: (story?.plays ?? 0) > 0 };
      });
      const points = {};
      for (const lesson of lessons) {
        for (const point of lesson.points) (points[point.id] ??= []).push({ id: lesson.id, lesson: lesson.lesson, title: lesson.title });
      }
      return { lessons: rows, points };
    },
    'story:open': async (id) => {
      const scene = requireScene(id);
      return { scene: particles.annotateScene(scene), items: await itemStatuses(scene), save: progress.hasSave(scene.id), best: progress.state.chapters[scene.id] ?? null };
    },
    // Mirrors a Learn lesson: the in-story intro starts the item, and that first quiz is not a review.
    // The "learn first" primer for a Genki lesson, plus the learner's SRS state for each grammar point it teaches.
    'story:lesson': async (id) => {
      assertSceneId(id);
      const lesson = lessonById.get(id);
      if (!lesson) throw new Error(`no lesson primer for: ${id}`);
      const items = {};
      for (const point of lesson.points) {
        const card = await cardOf(point.id);
        items[point.id] = { state: stateOf(card), stage: card?.stage ?? 0 };
      }
      return { lesson, items, done: progress.state.lessons[id] ?? null };
    },
    'story:lessonDone': (input) => {
      assertObject(input, 'lesson result');
      assertSceneId(input.id);
      if (!lessonById.has(input.id)) throw new Error(`no lesson primer for: ${input.id}`);
      if (!Number.isFinite(input.accuracy) || input.accuracy < 0 || input.accuracy > 1) throw new Error('accuracy must be between 0 and 1');
      const result = progress.completeLesson(input.id, { accuracy: input.accuracy });
      return { ...result, overview: progress.overview() };
    },
    'story:learn': async (item) => {
      assertItem(item);
      const { started } = await learn['learn:completeLessons']([item]);
      return { started: started.includes(item) };
    },
    'story:report': async (input) => {
      assertObject(input, 'report');
      assertItem(input.item);
      assertInt(input.incorrectCount, 'incorrectCount', 0, MAX_INCORRECT);
      if (input.introducedNow !== undefined && typeof input.introducedNow !== 'boolean') throw new Error('introducedNow must be true or false');
      const card = await cardOf(input.item);
      if (!card || card.stage === 0) return { tracked: false, applied: false };
      if (input.introducedNow) return { tracked: true, applied: false, reason: 'lesson' };
      const result = await learn['learn:submit']({ id: input.item, incorrectCount: input.incorrectCount });
      return { tracked: true, applied: true, result };
    },
    'story:save': (input) => {
      assertObject(input, 'save');
      assertSceneId(input.id);
      requireScene(input.id);
      progress.saveSlot(input.id, input.snapshot);
      return true;
    },
    'story:load': (id) => {
      assertSceneId(id);
      return progress.loadSlot(id);
    },
    'story:clearSave': (id) => {
      assertSceneId(id);
      progress.clearSlot(id);
      return true;
    },
    'story:complete': (input) => {
      assertObject(input, 'completion');
      assertSceneId(input.id);
      const scene = requireScene(input.id);
      if (!Number.isFinite(input.accuracy) || input.accuracy < 0 || input.accuracy > 1) throw new Error('accuracy must be between 0 and 1');
      assertObject(input.affection ?? {}, 'affection');
      for (const [char, delta] of Object.entries(input.affection ?? {})) {
        if (!NAME_PATTERN.test(char) || !Number.isInteger(delta) || Math.abs(delta) > 50) throw new Error('invalid affection entry');
      }
      if (!Array.isArray(input.gallery ?? []) || (input.gallery ?? []).length > 20) throw new Error('gallery must be a short list');
      const result = progress.complete(scene.id, { accuracy: input.accuracy, affection: input.affection, gallery: input.gallery }, scene.characters);
      return { ...result, overview: progress.overview() };
    },
    'story:animeBuild': async () => {
      const grammar = await startedItems('grammar', 40);
      const all = await learn['learn:browse']({ type: 'grammar' });
      const entries = [];
      for (const row of grammar) {
        if (entries.length >= MAX_ANIME_BUILD) break;
        const card = await cardOf(row.id);
        const example = card?.animeExamples?.[0];
        if (!example || typeof example.text !== 'string') continue;
        const point = { id: card.id, title: card.title, meaning: card.meaning, jlpt: card.jlpt };
        const otherMeanings = all.filter((r) => r.id !== row.id).map((r) => r.sub);
        entries.push({ example, point, otherMeanings });
      }
      const fresh = entries.filter(({ example }) => !readAnime(animeSceneId(example)));
      const built = await buildAnimeScenes(fresh, { fileExists, screenshot });
      fs.mkdirSync(animeDir, { recursive: true });
      for (const scene of built) fs.writeFileSync(path.join(animeDir, `${scene.id}.json`), JSON.stringify(scene));
      return { built: built.length, available: listAnime().length, withoutExamples: grammar.length === 0 ? 'none-started' : entries.length === 0 ? 'none-scanned' : null };
    },
    'story:aiGenerate': async (input = {}) => {
      assertObject(input, 'options');
      const settings = await getSettings();
      if (!aiReady(settings.ai)) throw new Error('Add an AI key in Settings first');
      let ids = input.items;
      if (ids !== undefined) {
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ITEMS) throw new Error(`items must list 1 to ${MAX_ITEMS} study items`);
        ids.forEach(assertItem);
      } else {
        const kanji = await startedItems('kanji', 3);
        const grammar = await startedItems('grammar', 2);
        ids = [...grammar, ...kanji].map((row) => row.id);
      }
      const items = [];
      let jlpt = 'N5';
      for (const id of ids) {
        const card = await cardOf(id);
        if (!card || card.stage === 0) continue;
        items.push({ id, ...itemInfo(id, card) });
        if (card.jlpt && card.jlpt < jlpt) jlpt = card.jlpt;
      }
      if (items.length === 0) throw new Error('Learn some kanji or grammar first, then come back for a side quest');
      const { scene, cached, repairs } = await generateScene({ dataDir, complete, settings: settings.ai, items, jlpt });
      return { scene: summaryOf(scene), cached, repaired: repairs.length };
    },
    'story:particles': () => particles.guide(),
    // Everything the lookup card shows for one kanji: dictionary entry (KANJIDIC, when downloaded), the
    // learner's SRS state for k:<char>, and the scene glossary as a fallback.
    'story:kanji': async (input) => {
      assertObject(input, 'kanji lookup');
      if (typeof input.char !== 'string' || !SINGLE_KANJI.test(input.char)) throw new Error('char must be a single kanji');
      if (input.scene !== undefined) assertSceneId(input.scene);
      const id = `k:${input.char}`;
      const glossary = input.scene ? findScene(input.scene)?.glossary?.[id] ?? null : null;
      const status = await optional('vocab:status');
      const detail = status?.kanjidic ? await optional('vocab:kanji', input.char) : null;
      const card = await cardOf(id);
      const info = itemInfo(id, card, glossary ? { [id]: glossary } : {});
      return {
        char: input.char,
        dictionaryReady: Boolean(status?.kanjidic),
        canDownload: typeof learn['kanjidic:download'] === 'function',
        meanings: detail?.meanings?.length ? detail.meanings : info.meaning ? info.meaning.split(/,\s*/) : [],
        on: detail?.on ?? [],
        kun: detail?.kun ?? [],
        reading: info.reading ?? '',
        strokes: detail?.strokes ?? null,
        jlpt: detail?.jlpt ?? null,
        words: (detail?.usedInVocab ?? []).filter((w) => w && w.text).slice(0, MAX_KANJI_WORDS),
        item: { id, state: stateOf(card), stage: card?.stage ?? 0 },
      };
    },
    'story:skins': () => skins.listPacks(dataDir),
    'story:skinManifest': (pack) => skins.loadManifest(dataDir, pack),
    'story:skinAsset': (input) => {
      assertObject(input, 'skin asset');
      return skins.readAsset(dataDir, input.pack, input.path);
    },
  };

  return { handlers, stop: () => {} };
}

module.exports = { createStoryHandlers };
