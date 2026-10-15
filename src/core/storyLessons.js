const fs = require('node:fs');
const path = require('node:path');
const { ITEM_PATTERN, NAME_PATTERN, BLANK } = require('./storySchema');
const { toHiragana } = require('./kana');

const SCHEMA_VERSION = 1;
const DEFAULT_DIR = path.join(__dirname, 'data', 'lessons');
const KANA = /^[ぁ-ゖァ-ヶー・ 　〜]+$/;
const DRILL_TYPES = ['gap', 'pick', 'order', 'type'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;
const isList = (value, min, max) => Array.isArray(value) && value.length >= min && value.length <= max;
const unique = (list) => new Set(list).size === list.length;

function checkVocab(raw, errors) {
  if (!isList(raw, 8, 30)) {
    errors.push('vocab needs 8 to 30 words');
    return [];
  }
  const out = [];
  raw.forEach((row, i) => {
    const [ja, reading, en, emoji] = Array.isArray(row) ? row : [];
    if (!isText(ja, 20) || !isText(reading, 30) || !KANA.test(reading) || !isText(en, 60) || (emoji !== undefined && !isText(emoji, 12))) {
      errors.push(`vocab[${i}] must be [japanese, kana reading, english, emoji?]`);
      return;
    }
    out.push({ ja: ja.trim(), reading: reading.trim(), en: en.trim(), ...(emoji ? { emoji } : {}) });
  });
  if (!unique(out.map((w) => w.ja))) errors.push('vocab words must be different');
  return out;
}

function checkExample(raw, where, errors) {
  if (!isObject(raw) || !isText(raw.ja, 120) || !isText(raw.en, 160)) {
    errors.push(`${where} needs ja and en`);
    return null;
  }
  const chunks = raw.ja.split('|');
  const out = { ja: raw.ja.trim(), en: raw.en.trim() };
  if (raw.gloss !== undefined) {
    const gloss = typeof raw.gloss === 'string' ? raw.gloss.split('|') : [];
    if (gloss.length !== chunks.length) errors.push(`${where}: gloss must have one entry for every | chunk`);
    else out.gloss = raw.gloss.trim();
  }
  return out;
}

function checkPoint(raw, i, errors) {
  const where = `points[${i}]`;
  if (!isObject(raw) || typeof raw.id !== 'string' || !ITEM_PATTERN.test(raw.id) || !raw.id.startsWith('g:')) {
    errors.push(`${where} needs a grammar id like g:n5-ka`);
    return null;
  }
  if (!isText(raw.title, 40) || !isText(raw.formula, 80) || !isText(raw.gist, 120)) errors.push(`${where} needs title, formula and gist`);
  if (!isList(raw.explain, 1, 4) || !raw.explain.every((p) => isText(p, 320))) errors.push(`${where} needs 1 to 4 short explain paragraphs`);
  const examples = isList(raw.examples, 2, 4) ? raw.examples.map((e, j) => checkExample(e, `${where}.examples[${j}]`, errors)) : (errors.push(`${where} needs 2 to 4 examples`), []);
  const out = { id: raw.id, title: raw.title, formula: raw.formula, gist: raw.gist, explain: raw.explain, examples: examples.filter(Boolean) };
  for (const key of ['tip', 'watch']) {
    if (raw[key] === undefined) continue;
    if (!isText(raw[key], 300)) errors.push(`${where}.${key} is too long`);
    else out[key] = raw[key].trim();
  }
  return out;
}

function checkDrill(raw, i, pointCount, errors) {
  const where = `drills[${i}]`;
  if (!isObject(raw) || !DRILL_TYPES.includes(raw.type)) {
    errors.push(`${where} has an unknown type`);
    return null;
  }
  const out = { type: raw.type };
  if (raw.point !== undefined) {
    if (!Number.isInteger(raw.point) || raw.point < 0 || raw.point >= pointCount) errors.push(`${where}.point must index a point`);
    else out.point = raw.point;
  }
  if (raw.why !== undefined) {
    if (!isText(raw.why, 240)) errors.push(`${where}.why is too long`);
    else out.why = raw.why.trim();
  }
  if (raw.type === 'gap') {
    if (!isText(raw.ja, 120) || raw.ja.split(BLANK).length !== 2) errors.push(`${where} needs a sentence with one ${BLANK} gap`);
    if (!isList(raw.options, 2, 4) || !raw.options.every((o) => isText(o, 12)) || !unique(raw.options)) errors.push(`${where} needs 2 to 4 different options`);
    else if (!raw.options.includes(raw.answer)) errors.push(`${where}.answer must be one of the options`);
    if (!isText(raw.en, 160)) errors.push(`${where} needs an english line`);
    Object.assign(out, { ja: raw.ja, options: raw.options, answer: raw.answer, en: raw.en });
  } else if (raw.type === 'pick') {
    if (!isText(raw.q, 200)) errors.push(`${where} needs a question`);
    if (!isList(raw.options, 2, 4) || !raw.options.every((o) => isText(o, 90)) || !unique(raw.options)) errors.push(`${where} needs 2 to 4 different options`);
    else if (!Number.isInteger(raw.answer) || raw.answer < 0 || raw.answer >= raw.options.length) errors.push(`${where}.answer must index an option`);
    Object.assign(out, { q: raw.q, options: raw.options, answer: raw.answer });
  } else if (raw.type === 'order') {
    if (!isText(raw.en, 160)) errors.push(`${where} needs an english line`);
    if (!isList(raw.chunks, 2, 7) || !raw.chunks.every((c) => isText(c, 20)) || !unique(raw.chunks)) errors.push(`${where} needs 2 to 7 different chunks`);
    const extra = raw.extra ?? [];
    if (!Array.isArray(extra) || extra.length > 2 || !extra.every((c) => isText(c, 20)) || extra.some((c) => raw.chunks?.includes(c))) errors.push(`${where}.extra must be up to 2 chunks that are not in the answer`);
    const alts = raw.alts ?? [];
    const sorted = (list) => [...list].sort().join('|');
    if (!Array.isArray(alts) || alts.length > 3 || !alts.every((a) => Array.isArray(a) && sorted(a) === sorted(raw.chunks ?? []))) errors.push(`${where}.alts must reorder the same chunks`);
    Object.assign(out, { en: raw.en, chunks: raw.chunks, ...(extra.length ? { extra } : {}), ...(alts.length ? { alts } : {}) });
  } else {
    if (!isText(raw.prompt, 160)) errors.push(`${where} needs a prompt`);
    const answers = (Array.isArray(raw.answers) ? raw.answers : []).map((a) => (typeof a === 'string' ? toHiragana(a.normalize('NFKC').replace(/\s+/g, '')) : ''));
    if (answers.length === 0 || !answers.every((a) => a && KANA.test(a))) errors.push(`${where} needs kana answers`);
    Object.assign(out, { prompt: raw.prompt, answers: [...new Set(answers)] });
    if (raw.show !== undefined) {
      if (!isText(raw.show, 40)) errors.push(`${where}.show is too long`);
      else out.show = raw.show;
    }
  }
  return out;
}

function validateLesson(raw) {
  const errors = [];
  if (!isObject(raw)) return { ok: false, errors: ['lesson must be an object'] };
  if (raw.schema !== SCHEMA_VERSION) errors.push(`schema must be ${SCHEMA_VERSION}`);
  if (typeof raw.id !== 'string' || !NAME_PATTERN.test(raw.id)) errors.push('id must be lowercase letters, digits, - or _');
  if (!Number.isInteger(raw.lesson) || raw.lesson < 1 || raw.lesson > 30) errors.push('lesson must be 1 to 30');
  if (!isText(raw.title, 80) || !isText(raw.tagline, 140) || !isText(raw.hook, 400)) errors.push('title, tagline and hook are required');
  if (!isList(raw.goals, 2, 5) || !raw.goals.every((g) => isText(g, 90))) errors.push('goals needs 2 to 5 short lines');
  if (!Number.isInteger(raw.minutes) || raw.minutes < 3 || raw.minutes > 30) errors.push('minutes must be 3 to 30');
  const vocab = checkVocab(raw.vocab, errors);
  const pointsRaw = isList(raw.points, 2, 6) ? raw.points : (errors.push('points needs 2 to 6 grammar points'), []);
  const points = pointsRaw.map((p, i) => checkPoint(p, i, errors)).filter(Boolean);
  const drillsRaw = isList(raw.drills, 6, 24) ? raw.drills : (errors.push('drills needs 6 to 24 exercises'), []);
  const drills = drillsRaw.map((d, i) => checkDrill(d, i, pointsRaw.length, errors)).filter(Boolean);
  if (points.length && !unique(points.map((p) => p.id))) errors.push('points must be different');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    lesson: { schema: SCHEMA_VERSION, id: raw.id, lesson: raw.lesson, title: raw.title.trim(), tagline: raw.tagline.trim(), hook: raw.hook.trim(), goals: raw.goals.map((g) => g.trim()), minutes: raw.minutes, vocab, points, drills },
  };
}

function loadLessons(dir = DEFAULT_DIR) {
  const lessons = [];
  const problems = [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return { lessons, problems: [{ file: dir, errors: ['lesson directory is missing'] }] };
  }
  for (const name of names) {
    try {
      const result = validateLesson(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
      if (result.ok) lessons.push(result.lesson);
      else problems.push({ file: name, errors: result.errors });
    } catch (err) {
      problems.push({ file: name, errors: [err.message] });
    }
  }
  const seen = new Set();
  return { lessons: lessons.filter((l) => !seen.has(l.id) && seen.add(l.id)).sort((a, b) => a.lesson - b.lesson), problems };
}

function lessonSummary(lesson) {
  return { id: lesson.id, lesson: lesson.lesson, title: lesson.title, tagline: lesson.tagline, minutes: lesson.minutes, words: lesson.vocab.length, patterns: lesson.points.length, drills: lesson.drills.length };
}

module.exports = { SCHEMA_VERSION, DEFAULT_DIR, validateLesson, loadLessons, lessonSummary };
