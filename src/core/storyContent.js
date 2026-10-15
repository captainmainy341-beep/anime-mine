const fs = require('node:fs');
const path = require('node:path');
const { validateScene } = require('./storySchema');

const DEFAULT_DIR = path.join(__dirname, 'data', 'story');

// Authored chapters ship as one JSON scene per file. A malformed file is skipped (and reported) rather than
// taking the whole Story tab down, but the test suite fails on any invalid shipped chapter.
function loadChapters(dir = DEFAULT_DIR) {
  const chapters = [];
  const problems = [];
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch {
    return { chapters, problems: [{ file: dir, errors: ['story directory is missing'] }] };
  }
  for (const name of names) {
    try {
      const result = validateScene(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
      if (result.ok && result.scene.source === 'authored') chapters.push(result.scene);
      else problems.push({ file: name, errors: result.ok ? ['authored chapters must have source "authored"'] : result.errors });
    } catch (err) {
      problems.push({ file: name, errors: [err.message] });
    }
  }
  const seen = new Set();
  const unique = chapters.filter((chapter) => !seen.has(chapter.id) && seen.add(chapter.id));
  unique.sort((a, b) => (a.order ?? 999) - (b.order ?? 999) || a.id.localeCompare(b.id));
  return { chapters: unique, problems };
}

function chapterSummary(scene) {
  return {
    id: scene.id,
    title: scene.title,
    jlpt: scene.jlpt,
    source: scene.source,
    summary: scene.summary ?? '',
    order: scene.order ?? null,
    beats: scene.beats.length,
    challenges: scene.beats.filter((b) => ['choice', 'reading', 'meaning'].includes(b.type)).length,
    items: scene.items,
  };
}

module.exports = { loadChapters, chapterSummary, DEFAULT_DIR };
