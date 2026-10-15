const { toHiragana } = require('./kana');

const SCHEMA_VERSION = 1;
const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];
const SOURCES = ['authored', 'anime', 'ai'];
const ITEM_PATTERN = /^[kvg]:.{1,40}$/;
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const KANA_PATTERN = /^[ぁ-ゖァ-ヶーー]+$/;
const BG_IMAGE_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const POSITIONS = ['left', 'center', 'right'];
const BEAT_TYPES = ['bg', 'show', 'hide', 'say', 'intro', 'choice', 'reading', 'meaning', 'particle', 'affection', 'cg', 'jump'];
const CHALLENGES = ['choice', 'reading', 'meaning', 'particle'];
const TRACKS = ['main', 'genki'];
const MAX_LESSON = 30;
const BLANK = '＿';
const PARTICLE_PATTERN = /^[ぁ-ゖ]{1,4}$/;
const ROLE_PATTERN = /^p:[a-z-]{1,12}\/[a-z-]{1,20}$/;

const MAX_BEATS = 120;
const MAX_TEXT = 240;
const MAX_EN = 300;
const MAX_OPTIONS = 4;
const MAX_BG_IMAGE = 2_000_000;
const MAX_AFFECTION = 5;
const MAX_CHARACTERS = 8;
const MAX_GLOSSARY = 30;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max = MAX_TEXT) => typeof value === 'string' && value.trim() !== '' && value.length <= max;

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// Each checker returns { beat } or { error }. In repair mode, a checker may fix small problems and report them.
class Ctx {
  constructor(scene, repair) {
    this.characters = scene.characters;
    this.repair = repair;
    this.repairs = [];
  }

  fixed(message) {
    this.repairs.push(message);
  }
}

function speaker(raw, ctx) {
  if (raw === undefined || raw === null || raw === '') return { who: null };
  if (typeof raw === 'string' && Object.hasOwn(ctx.characters, raw)) return { who: raw };
  return { error: `unknown speaker: ${String(raw)}` };
}

function text(raw, name, ctx, max = MAX_TEXT) {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: `${name} is required` };
  if (raw.length <= max) return { value: raw.trim() };
  if (!ctx.repair) return { error: `${name} is longer than ${max} characters` };
  ctx.fixed(`${name} was truncated`);
  return { value: raw.trim().slice(0, max) };
}

function optionalName(raw, name) {
  if (raw === undefined || raw === null || raw === '') return { value: undefined };
  return typeof raw === 'string' && NAME_PATTERN.test(raw) ? { value: raw } : { error: `${name} is not a valid id` };
}

function itemOf(raw) {
  return typeof raw === 'string' && ITEM_PATTERN.test(raw) ? { value: raw } : { error: `invalid study item: ${String(raw)}` };
}

function firstError(...results) {
  return results.find((r) => r.error);
}

function checkSay(raw, ctx) {
  const who = speaker(raw.who, ctx);
  const body = text(raw.text, 'text', ctx);
  const expr = optionalName(raw.expr, 'expr');
  const bad = firstError(who, body, expr);
  if (bad) return bad;
  const beat = { type: 'say', who: who.who, text: body.value };
  if (expr.value) beat.expr = expr.value;
  const en = cleanText(raw.en, MAX_EN);
  if (en) beat.en = en;
  return { beat };
}

function checkAwkward(raw, ctx) {
  if (raw === undefined || raw === null) return { value: null };
  if (!isObject(raw)) return { error: 'awkward must be an object' };
  const who = speaker(raw.who, ctx);
  const body = text(raw.text, 'awkward.text', ctx);
  const bad = firstError(who, body);
  if (bad) return bad;
  const out = { who: who.who, text: body.value };
  const en = cleanText(raw.en, MAX_EN);
  if (en) out.en = en;
  return { value: out };
}

function checkChoice(raw, ctx) {
  const item = itemOf(raw.item);
  const who = speaker(raw.who, ctx);
  const prompt = raw.prompt === undefined ? { value: '' } : text(raw.prompt, 'prompt', ctx);
  const bad = firstError(item, who, prompt);
  if (bad) return bad;
  if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > MAX_OPTIONS) {
    return { error: `choice needs 2 to ${MAX_OPTIONS} options` };
  }
  const options = [];
  for (const option of raw.options) {
    if (!isObject(option)) return { error: 'every option must be an object' };
    const body = text(option.text, 'option.text', ctx);
    const awkward = checkAwkward(option.awkward, ctx);
    const failed = firstError(body, awkward);
    if (failed) return failed;
    const entry = { text: body.value, correct: option.correct === true };
    if (awkward.value) entry.awkward = awkward.value;
    options.push(entry);
  }
  if (options.filter((o) => o.correct).length !== 1) return { error: 'choice needs exactly one correct option' };
  if (new Set(options.map((o) => o.text)).size !== options.length) return { error: 'choice options must be different' };
  const beat = { type: 'choice', item: item.value, who: who.who, options };
  if (prompt.value) beat.prompt = prompt.value;
  return { beat };
}

function normaliseAnswers(raw, ctx) {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : null;
  if (!list || list.length === 0) return { error: 'answers must list at least one kana reading' };
  const kept = [];
  for (const entry of list) {
    const kana = typeof entry === 'string' ? toHiragana(entry.normalize('NFKC').replace(/\s+/g, '')) : '';
    if (kana && KANA_PATTERN.test(kana)) kept.push(kana);
    else if (!ctx.repair) return { error: `answer is not kana: ${String(entry)}` };
    else ctx.fixed(`dropped non-kana answer ${JSON.stringify(entry)}`);
  }
  return kept.length ? { value: [...new Set(kept)] } : { error: 'answers must list at least one kana reading' };
}

function checkReading(raw, ctx) {
  const item = itemOf(raw.item);
  const display = text(raw.display, 'display', ctx);
  const answers = normaliseAnswers(raw.answers, ctx);
  const prompt = raw.prompt === undefined ? { value: '' } : text(raw.prompt, 'prompt', ctx);
  const bad = firstError(item, display, answers, prompt);
  if (bad) return bad;
  if (!item.value.startsWith('k:') && !item.value.startsWith('v:')) return { error: 'reading challenges test kanji or vocabulary' };
  const beat = { type: 'reading', item: item.value, display: display.value, answers: answers.value };
  if (prompt.value) beat.prompt = prompt.value;
  if (typeof raw.target === 'string' && raw.target && display.value.includes(raw.target)) beat.target = raw.target;
  return { beat };
}

function checkMeaning(raw, ctx) {
  const item = itemOf(raw.item);
  const prompt = text(raw.prompt, 'prompt', ctx);
  const bad = firstError(item, prompt);
  if (bad) return bad;
  if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > MAX_OPTIONS) {
    return { error: `meaning needs 2 to ${MAX_OPTIONS} options` };
  }
  const options = [];
  for (const option of raw.options) {
    const body = text(option, 'option', ctx, 80);
    if (body.error) return body;
    options.push(body.value);
  }
  if (new Set(options).size !== options.length) return { error: 'meaning options must be different' };
  if (!Number.isInteger(raw.correct) || raw.correct < 0 || raw.correct >= options.length) return { error: 'correct must index an option' };
  const beat = { type: 'meaning', item: item.value, prompt: prompt.value, options, correct: raw.correct };
  if (typeof raw.display === 'string' && raw.display.trim()) beat.display = raw.display.trim().slice(0, 40);
  return { beat };
}

// Fill-in-the-particle: `text` has one ＿ gap, `options` are particles, `answers` the ones that fit.
// `role` (e.g. "p:ni/destination") points into the particle guide so a miss can explain itself.
function checkParticle(raw, ctx) {
  const item = itemOf(raw.item);
  const who = speaker(raw.who, ctx);
  const body = text(raw.text, 'text', ctx);
  const prompt = raw.prompt === undefined ? { value: '' } : text(raw.prompt, 'prompt', ctx);
  const bad = firstError(item, who, body, prompt);
  if (bad) return bad;
  if (body.value.split(BLANK).length !== 2) return { error: `particle text needs exactly one ${BLANK} gap` };
  if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > MAX_OPTIONS) {
    return { error: `particle needs 2 to ${MAX_OPTIONS} options` };
  }
  if (!raw.options.every((o) => typeof o === 'string' && PARTICLE_PATTERN.test(o))) return { error: 'particle options must be short kana' };
  if (new Set(raw.options).size !== raw.options.length) return { error: 'particle options must be different' };
  const answers = Array.isArray(raw.answers) ? raw.answers : typeof raw.answers === 'string' ? [raw.answers] : [];
  if (answers.length === 0 || !answers.every((a) => raw.options.includes(a))) return { error: 'particle answers must be among the options' };
  if (answers.length === raw.options.length) return { error: 'particle needs at least one wrong option' };
  const beat = { type: 'particle', item: item.value, who: who.who, text: body.value, options: [...raw.options], answers: [...new Set(answers)] };
  if (prompt.value) beat.prompt = prompt.value;
  const en = cleanText(raw.en, MAX_EN);
  if (en) beat.en = en;
  if (typeof raw.role === 'string' && ROLE_PATTERN.test(raw.role)) beat.role = raw.role;
  const awkward = checkAwkward(raw.awkward, ctx);
  if (awkward.error) return awkward;
  if (awkward.value) beat.awkward = awkward.value;
  return { beat };
}

const CHECKERS = {
  bg(raw) {
    const bg = optionalName(raw.bg, 'bg');
    return bg.error || !bg.value ? { error: bg.error ?? 'bg is required' } : { beat: { type: 'bg', bg: bg.value } };
  },
  show(raw, ctx) {
    if (typeof raw.char !== 'string' || !Object.hasOwn(ctx.characters, raw.char)) return { error: `unknown character: ${String(raw.char)}` };
    const expr = optionalName(raw.expr, 'expr');
    if (expr.error) return expr;
    const pos = raw.pos === undefined ? 'center' : raw.pos;
    if (!POSITIONS.includes(pos)) return { error: `pos must be one of ${POSITIONS.join(', ')}` };
    return { beat: { type: 'show', char: raw.char, expr: expr.value ?? 'neutral', pos } };
  },
  hide(raw, ctx) {
    if (typeof raw.char !== 'string' || !Object.hasOwn(ctx.characters, raw.char)) return { error: `unknown character: ${String(raw.char)}` };
    return { beat: { type: 'hide', char: raw.char } };
  },
  say: checkSay,
  intro(raw) {
    const item = itemOf(raw.item);
    return item.error ? item : { beat: { type: 'intro', item: item.value } };
  },
  choice: checkChoice,
  reading: checkReading,
  meaning: checkMeaning,
  particle: checkParticle,
  affection(raw, ctx) {
    if (typeof raw.char !== 'string' || !Object.hasOwn(ctx.characters, raw.char)) return { error: `unknown character: ${String(raw.char)}` };
    if (!Number.isInteger(raw.delta) || raw.delta === 0 || Math.abs(raw.delta) > MAX_AFFECTION) {
      if (!ctx.repair || !Number.isFinite(raw.delta)) return { error: `delta must be a non-zero integer up to ${MAX_AFFECTION}` };
      ctx.fixed('affection delta was clamped');
      const delta = Math.max(-MAX_AFFECTION, Math.min(MAX_AFFECTION, Math.round(raw.delta)));
      return delta === 0 ? { error: 'delta must be non-zero' } : { beat: { type: 'affection', char: raw.char, delta } };
    }
    return { beat: { type: 'affection', char: raw.char, delta: raw.delta } };
  },
  cg(raw, ctx) {
    const id = optionalName(raw.id, 'id');
    if (id.error || !id.value) return { error: id.error ?? 'cg id is required' };
    const beat = { type: 'cg', id: id.value };
    const title = cleanText(raw.title, 60);
    if (title) beat.title = title;
    void ctx;
    return { beat };
  },
  jump(raw) {
    const to = optionalName(raw.to, 'to');
    return to.error || !to.value ? { error: to.error ?? 'jump needs a target label' } : { beat: { type: 'jump', to: to.value } };
  },
};

function checkCharacters(raw, errors) {
  if (!isObject(raw) || Object.keys(raw).length === 0) {
    errors.push('characters must name at least one character');
    return {};
  }
  const out = {};
  const ids = Object.keys(raw);
  if (ids.length > MAX_CHARACTERS) errors.push(`at most ${MAX_CHARACTERS} characters`);
  for (const id of ids.slice(0, MAX_CHARACTERS)) {
    const c = raw[id];
    if (!NAME_PATTERN.test(id) || !isObject(c) || !isText(c.name, 30)) {
      errors.push(`character ${id} needs an id and a name`);
      continue;
    }
    out[id] = { name: c.name.trim() };
    if (typeof c.color === 'string' && COLOR_PATTERN.test(c.color)) out[id].color = c.color;
  }
  return out;
}

function checkGlossary(raw, errors) {
  if (raw === undefined) return {};
  if (!isObject(raw)) {
    errors.push('glossary must be an object');
    return {};
  }
  const out = {};
  for (const [id, entry] of Object.entries(raw).slice(0, MAX_GLOSSARY)) {
    if (!ITEM_PATTERN.test(id) || !isObject(entry) || !isText(entry.label, 40) || !isText(entry.meaning, 160)) {
      errors.push(`glossary entry ${id} needs a label and a meaning`);
      continue;
    }
    out[id] = { label: entry.label.trim(), meaning: entry.meaning.trim() };
    const reading = cleanText(entry.reading, 40);
    if (reading) out[id].reading = reading;
    const note = cleanText(entry.note, 300);
    if (note) out[id].note = note;
  }
  return out;
}

function checkJumps(beats, errors) {
  const labels = new Map();
  beats.forEach((beat, i) => {
    if (!beat.label) return;
    if (labels.has(beat.label)) errors.push(`duplicate label: ${beat.label}`);
    labels.set(beat.label, i);
  });
  beats.forEach((beat, i) => {
    if (beat.type !== 'jump') return;
    if (!labels.has(beat.to)) errors.push(`beats[${i}] jumps to unknown label ${beat.to}`);
    else if (labels.get(beat.to) <= i) errors.push(`beats[${i}] may only jump forward`);
  });
}

function validate(raw, { repair }) {
  const errors = [];
  if (!isObject(raw)) return { ok: false, errors: ['scene must be an object'], repairs: [] };
  if (raw.schema !== SCHEMA_VERSION) errors.push(`schema must be ${SCHEMA_VERSION}`);
  if (typeof raw.id !== 'string' || !NAME_PATTERN.test(raw.id)) errors.push('id must be lowercase letters, digits, - or _');
  if (!isText(raw.title, 80)) errors.push('title is required');
  if (!JLPT.includes(raw.jlpt)) errors.push(`jlpt must be one of ${JLPT.join(', ')}`);
  if (!SOURCES.includes(raw.source)) errors.push(`source must be one of ${SOURCES.join(', ')}`);
  if (raw.bg !== undefined && (typeof raw.bg !== 'string' || !NAME_PATTERN.test(raw.bg))) errors.push('bg must be a background id');
  if (raw.bgImage !== undefined && (typeof raw.bgImage !== 'string' || raw.bgImage.length > MAX_BG_IMAGE || !BG_IMAGE_PATTERN.test(raw.bgImage))) {
    errors.push('bgImage must be a small JPEG data URL');
  }
  const characters = checkCharacters(raw.characters, errors);
  const glossary = checkGlossary(raw.glossary, errors);
  const ctx = new Ctx({ characters }, repair);
  const beats = [];
  if (!Array.isArray(raw.beats) || raw.beats.length === 0) {
    errors.push('beats must be a non-empty list');
  } else {
    if (raw.beats.length > MAX_BEATS) errors.push(`at most ${MAX_BEATS} beats`);
    raw.beats.slice(0, MAX_BEATS).forEach((rawBeat, i) => {
      const checker = isObject(rawBeat) ? CHECKERS[rawBeat.type] : null;
      const result = checker && BEAT_TYPES.includes(rawBeat.type) ? checker(rawBeat, ctx) : { error: `unknown beat type: ${String(rawBeat?.type)}` };
      if (result.error) {
        if (repair) ctx.fixed(`dropped beats[${i}]: ${result.error}`);
        else errors.push(`beats[${i}]: ${result.error}`);
        return;
      }
      const label = optionalName(rawBeat.label, 'label');
      if (label.error) {
        if (repair) ctx.fixed(`dropped label on beats[${i}]`);
        else errors.push(`beats[${i}]: ${label.error}`);
      } else if (label.value) {
        result.beat.label = label.value;
      }
      beats.push(result.beat);
    });
  }
  if (beats.length) checkJumps(beats, errors);
  const items = [...new Set(beats.filter((b) => b.item).map((b) => b.item))];
  if (beats.length && !beats.some((b) => b.type === 'say')) errors.push('scene needs at least one dialogue line');
  if (items.length > 0 && !beats.some((b) => CHALLENGES.includes(b.type))) errors.push('scene has items but no challenge');
  if (errors.length) return { ok: false, errors, repairs: ctx.repairs };
  const scene = {
    schema: SCHEMA_VERSION,
    id: raw.id,
    title: raw.title.trim(),
    jlpt: raw.jlpt,
    source: raw.source,
    characters,
    items,
    beats,
  };
  if (raw.bg) scene.bg = raw.bg;
  if (raw.bgImage) scene.bgImage = raw.bgImage;
  if (Object.keys(glossary).length) scene.glossary = glossary;
  if (isText(raw.summary, 300)) scene.summary = raw.summary.trim();
  if (Number.isInteger(raw.order)) scene.order = raw.order;
  if (raw.track !== undefined) {
    if (!TRACKS.includes(raw.track)) return { ok: false, errors: [`track must be one of ${TRACKS.join(', ')}`], repairs: ctx.repairs };
    scene.track = raw.track;
  }
  if (raw.lesson !== undefined) {
    if (!Number.isInteger(raw.lesson) || raw.lesson < 1 || raw.lesson > MAX_LESSON) return { ok: false, errors: [`lesson must be 1 to ${MAX_LESSON}`], repairs: ctx.repairs };
    scene.lesson = raw.lesson;
  }
  if (isText(raw.covers, 300)) scene.covers = raw.covers.trim();
  return { ok: true, errors: [], repairs: ctx.repairs, scene };
}

function validateScene(raw) {
  return validate(raw, { repair: false });
}

function assertScene(raw) {
  const result = validateScene(raw);
  if (!result.ok) throw new Error(`Invalid story scene: ${result.errors.slice(0, 5).join('; ')}`);
  return result.scene;
}

// AI replies arrive as text that is usually, but not always, a JSON object.
function extractJson(reply) {
  if (typeof reply !== 'string') return null;
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : reply;
  const start = source.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Validates model output, repairs what is safely repairable and rejects the rest.
// `allowedItems` is the list the prompt asked for; beats about anything else are dropped.
function parseAiScene(reply, { allowedItems = [], id, jlpt = 'N5' } = {}) {
  const raw = extractJson(reply);
  if (!isObject(raw)) throw new Error('AI reply did not contain a JSON scene');
  const allowed = new Set(allowedItems);
  const candidate = {
    ...raw,
    schema: SCHEMA_VERSION,
    source: 'ai',
    id: id ?? raw.id,
    jlpt: JLPT.includes(raw.jlpt) ? raw.jlpt : jlpt,
  };
  delete candidate.bgImage;
  if (Array.isArray(candidate.beats)) {
    candidate.beats = candidate.beats.filter((beat) => !(isObject(beat) && beat.item !== undefined && allowed.size && !allowed.has(beat.item)));
  }
  if (isObject(candidate.glossary)) {
    candidate.glossary = Object.fromEntries(Object.entries(candidate.glossary).filter(([item]) => !allowed.size || allowed.has(item)));
  }
  if (typeof candidate.bg === 'string' && !NAME_PATTERN.test(candidate.bg)) delete candidate.bg;
  const result = validate(candidate, { repair: true });
  if (!result.ok) throw new Error(`AI scene rejected: ${result.errors.slice(0, 4).join('; ')}`);
  const challenged = new Set(result.scene.beats.filter((b) => CHALLENGES.includes(b.type)).map((b) => b.item));
  if (challenged.size === 0) throw new Error('AI scene rejected: no usable challenge');
  return { scene: result.scene, repairs: result.repairs };
}

module.exports = {
  SCHEMA_VERSION,
  JLPT,
  CHALLENGES,
  TRACKS,
  BLANK,
  ITEM_PATTERN,
  NAME_PATTERN,
  KANA_PATTERN,
  validateScene,
  assertScene,
  parseAiScene,
  extractJson,
};
