const fs = require('node:fs');
const path = require('node:path');

const ID_PATTERN = /^g:[a-z0-9-]+$/;
const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];
const FORMALITIES = ['casual', 'neutral', 'polite', 'formal'];
const MARKER_PATTERN = /\{\{[^{}]*\}\}/g;
const MIN_CUE_LENGTH = 6;
const MAX_CUE_LENGTH = 40;
const regexCache = new Map();

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function compileDetect(source) {
  if (!regexCache.has(source)) regexCache.set(source, new RegExp(source, 'u'));
  return regexCache.get(source);
}

function detectErrors(detect) {
  if (!isStringArray(detect)) return ['detect must be an array of strings'];
  const errors = [];
  for (const source of detect) {
    let regex;
    try {
      regex = compileDetect(source);
    } catch {
      errors.push(`detect "${source}" is not a valid regex`);
      continue;
    }
    if (regex.test('')) errors.push(`detect "${source}" matches the empty string`);
  }
  return errors;
}

function exampleErrors(example, index) {
  const label = `examples[${index}]`;
  if (!example || typeof example !== 'object') return [`${label} must be an object`];
  const errors = [];
  if (typeof example.ja !== 'string') {
    errors.push(`${label}.ja must be a string`);
  } else {
    const markers = [...example.ja.matchAll(MARKER_PATTERN)];
    if (markers.length !== 1) {
      errors.push(`${label}.ja must contain exactly one {{...}} marker, found ${markers.length}`);
    } else if (markers[0][0].slice(2, -2).split('|').some(alt => alt.trim() === '')) {
      errors.push(`${label}.ja has an empty cloze alternative`);
    }
  }
  if (!isNonEmptyString(example.en)) errors.push(`${label}.en must be a non-empty string`);
  if (typeof example.hint !== 'string') errors.push(`${label}.hint must be a string`);
  return errors;
}

function validatePoint(p) {
  if (!p || typeof p !== 'object') return ['point must be an object'];
  const errors = [];
  if (typeof p.id !== 'string' || !ID_PATTERN.test(p.id)) errors.push(`id must match ${ID_PATTERN}`);
  if (!JLPT_LEVELS.includes(p.jlpt)) errors.push(`jlpt must be one of ${JLPT_LEVELS.join(', ')}`);
  for (const field of ['title', 'meaning', 'structure']) {
    if (!isNonEmptyString(p[field])) errors.push(`${field} must be a non-empty string`);
  }
  if (!FORMALITIES.includes(p.formality)) errors.push(`formality must be one of ${FORMALITIES.join(', ')}`);
  if (typeof p.notes !== 'string') errors.push('notes must be a string');
  if (!isStringArray(p.similar)) errors.push('similar must be an array of strings');
  errors.push(...detectErrors(p.detect));
  if (!Array.isArray(p.examples) || p.examples.length < 2) {
    errors.push('examples must be an array of at least 2 entries');
  } else {
    p.examples.forEach((example, i) => errors.push(...exampleErrors(example, i)));
  }
  return errors;
}

function parseCloze(ja) {
  const markers = [...ja.matchAll(MARKER_PATTERN)];
  if (markers.length !== 1) throw new Error(`expected exactly one cloze marker, found ${markers.length}: ${ja}`);
  const [marker] = markers;
  const before = ja.slice(0, marker.index);
  const after = ja.slice(marker.index + marker[0].length);
  const answers = marker[0].slice(2, -2).split('|');
  return { before, after, answers, text: before + answers[0] + after };
}

function readPointFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .sort()
    .flatMap((name) => {
      const list = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (!Array.isArray(list)) throw new Error(`${name}: expected a JSON array of points`);
      return list;
    });
}

function loadGrammar(dir = path.join(__dirname, 'data', 'grammar')) {
  const raw = readPointFiles(dir);
  const problems = [];
  const seenIds = new Set();
  for (const p of raw) {
    const id = p?.id;
    const errors = validatePoint(p);
    if (errors.length) problems.push(`${id ?? '(no id)'}: ${errors.join('; ')}`);
    if (typeof id === 'string') {
      if (seenIds.has(id)) problems.push(`${id}: duplicate id`);
      seenIds.add(id);
    }
  }
  if (problems.length) throw new Error(`Invalid grammar data:\n${problems.join('\n')}`);

  const titles = new Set(raw.map(p => p.title));
  const points = raw.map(p => ({ ...p, similar: p.similar.filter(title => titles.has(title)) }));
  const byId = new Map(points.map(p => [p.id, p]));
  const byTitle = new Map(points.map(p => [p.title, p]));
  return { points, byId, byTitle };
}

function detectGrammar(text, points) {
  const found = [];
  for (const point of points) {
    let best = null;
    for (const source of point.detect) {
      const match = compileDetect(source).exec(text);
      if (match && (!best || match.index < best.start)) {
        best = { id: point.id, start: match.index, end: match.index + match[0].length, text: match[0] };
      }
    }
    if (best) found.push(best);
  }
  return found.sort((a, b) => a.start - b.start);
}

function buildAnimeCloze(point, cue, match, { videoPath } = {}) {
  const span = cue.text.slice(match.start, match.end);
  return {
    ja: `${cue.text.slice(0, match.start)}{{${span}}}${cue.text.slice(match.end)}`,
    en: null,
    hint: point.title,
    answers: [span],
    source: { ...(videoPath === undefined ? {} : { videoPath }), start: cue.start, end: cue.end },
  };
}

async function collectCandidates(episode, points, parseSubtitleFile) {
  const byPoint = new Map();
  let cues;
  try {
    cues = await parseSubtitleFile(episode.subtitlePath);
  } catch {
    return byPoint;
  }
  for (const cue of cues) {
    if (cue.text.length < MIN_CUE_LENGTH || cue.text.length > MAX_CUE_LENGTH) continue;
    for (const match of detectGrammar(cue.text, points)) {
      const list = byPoint.get(match.id) ?? [];
      list.push({
        videoPath: episode.path,
        start: cue.start,
        end: cue.end,
        text: cue.text,
        matchStart: match.start,
        matchEnd: match.end,
      });
      byPoint.set(match.id, list);
    }
  }
  return byPoint;
}

function pickRoundRobin(pointId, perEpisode, used, perPoint) {
  const picked = [];
  const cursors = perEpisode.map(() => 0);
  let advanced = true;
  while (picked.length < perPoint && advanced) {
    advanced = false;
    for (const [i, byPoint] of perEpisode.entries()) {
      if (picked.length >= perPoint) break;
      const list = byPoint.get(pointId) ?? [];
      while (cursors[i] < list.length) {
        const item = list[cursors[i]++];
        if (used.has(item.text)) continue;
        used.add(item.text);
        picked.push(item);
        advanced = true;
        break;
      }
    }
  }
  return picked;
}

async function scanLibrary({ shows, points, parseSubtitleFile, perPoint = 5, onProgress }) {
  const episodes = shows.flatMap(show => show.episodes).filter(episode => episode.subtitlePath);
  const perEpisode = [];
  for (const [index, episode] of episodes.entries()) {
    perEpisode.push(await collectCandidates(episode, points, parseSubtitleFile));
    onProgress?.(index + 1, episodes.length);
  }
  const used = new Set();
  const result = {};
  for (const point of points) {
    result[point.id] = pickRoundRobin(point.id, perEpisode, used, perPoint);
  }
  return result;
}

module.exports = { validatePoint, parseCloze, loadGrammar, detectGrammar, buildAnimeCloze, scanLibrary };
