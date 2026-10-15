const fs = require('node:fs/promises');
const path = require('node:path');

const JLPT_LEVELS = new Set(['N5', 'N4', 'N3', 'N2', 'N1', 'none']);

const sidecarPath = (source, kind) => {
  const stem = path.basename(source, path.extname(source));
  return path.join(path.dirname(source), `${stem}.${kind}.json`);
};

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function parseFix(data) {
  if (!Array.isArray(data?.changes)) return null;
  const fix = new Map();
  for (const change of data.changes) {
    if (!Number.isInteger(change?.n) || typeof change.text !== 'string' || change.text.trim() === '') continue;
    fix.set(change.n, change.text);
  }
  return fix;
}

function parseTag(data) {
  if (!Array.isArray(data?.cues)) return null;
  const tag = new Map();
  for (const cue of data.cues) {
    if (!Number.isInteger(cue?.n) || !JLPT_LEVELS.has(cue.jlpt)) continue;
    if (!Array.isArray(cue.words) || !cue.words.every((word) => typeof word === 'string')) continue;
    tag.set(cue.n, { jlpt: cue.jlpt, words: cue.words });
  }
  return tag;
}

async function firstValid(sources, kind, parse) {
  for (const source of sources) {
    const parsed = parse(await readJson(sidecarPath(source, kind)));
    if (parsed) return parsed;
  }
  return new Map();
}

async function loadColabSidecars({ videoPath, subtitlePath }) {
  const sources = [videoPath, subtitlePath].filter(Boolean);
  return {
    fix: await firstValid(sources, 'fix', parseFix),
    tag: await firstValid(sources, 'tag', parseTag),
  };
}

function applyColabSidecars(cues, { fix, tag }) {
  return cues.map((cue, index) => {
    const n = index + 1;
    const corrected = fix.get(n);
    const tagged = tag.get(n);
    const showJlpt = tagged !== undefined && tagged.jlpt !== 'none';
    if (corrected === undefined && !showJlpt) return cue;
    return {
      ...cue,
      ...(corrected === undefined ? {} : { text: corrected, originalText: cue.text }),
      ...(showJlpt ? { jlpt: tagged.jlpt, words: tagged.words } : {}),
    };
  });
}

module.exports = { loadColabSidecars, applyColabSidecars };
