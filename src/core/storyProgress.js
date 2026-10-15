const fs = require('node:fs');
const path = require('node:path');
const { NAME_PATTERN } = require('./storySchema');

const FILE = 'story.json';
const MAX_AFFECTION = 100;
const MAX_SNAPSHOT_BYTES = 120_000;
const MAX_GALLERY = 300;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function empty() {
  return { version: 1, chapters: {}, affection: {}, gallery: {}, saves: {} };
}

// Older files also stored a 0-3 star rating per chapter. Stars are gone; the rest of the record is kept.
function normalizeChapters(chapters) {
  const out = {};
  for (const [id, entry] of Object.entries(chapters)) {
    if (!isObject(entry)) continue;
    const plays = Number.isInteger(entry.plays) && entry.plays > 0 ? entry.plays : 0;
    out[id] = {
      plays,
      bestAccuracy: Number.isFinite(entry.bestAccuracy) ? clamp(entry.bestAccuracy, 0, 1) : 0,
      ...(Number.isFinite(entry.completedAt) ? { completedAt: entry.completedAt } : {}),
    };
  }
  return out;
}

// Player progress for the Story tab: completion, affection, gallery and one save slot per scene.
// Kept separate from the SRS store (learn.json) so game state can never corrupt study state.
class StoryProgress {
  constructor(dataDir, { now = Date.now } = {}) {
    this.file = path.join(dataDir, FILE);
    this.now = now;
    this.state = this.read();
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        ...empty(),
        chapters: isObject(parsed.chapters) ? normalizeChapters(parsed.chapters) : {},
        affection: isObject(parsed.affection) ? parsed.affection : {},
        gallery: isObject(parsed.gallery) ? parsed.gallery : {},
        saves: isObject(parsed.saves) ? parsed.saves : {},
      };
    } catch {
      return empty();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }

  overview() {
    return {
      chapters: this.state.chapters,
      affection: this.state.affection,
      gallery: Object.entries(this.state.gallery).map(([id, g]) => ({ id, ...g })),
    };
  }

  hasSave(sceneId) {
    return Object.hasOwn(this.state.saves, sceneId);
  }

  saveSlot(sceneId, snapshot) {
    if (!isObject(snapshot) || snapshot.scene !== sceneId) throw new Error('snapshot does not belong to this scene');
    if (JSON.stringify(snapshot).length > MAX_SNAPSHOT_BYTES) throw new Error('save is too large');
    this.state.saves[sceneId] = { ...snapshot, savedAt: this.now() };
    this.save();
  }

  loadSlot(sceneId) {
    return this.state.saves[sceneId] ?? null;
  }

  clearSlot(sceneId) {
    if (delete this.state.saves[sceneId]) this.save();
  }

  // Records a finished run. Best accuracy only goes up; affection and gallery are merged.
  complete(sceneId, { accuracy, affection = {}, gallery = [] }, characters = {}) {
    const prev = this.state.chapters[sceneId] ?? { plays: 0, bestAccuracy: 0 };
    this.state.chapters[sceneId] = {
      bestAccuracy: Math.max(prev.bestAccuracy, clamp(accuracy, 0, 1)),
      plays: prev.plays + 1,
      completedAt: this.now(),
    };
    // Affection is earned the first time a chapter is cleared so replays can't farm the meter.
    if (prev.plays === 0) {
      for (const [char, delta] of Object.entries(affection)) {
        if (!NAME_PATTERN.test(char) || !Number.isInteger(delta)) continue;
        const entry = this.state.affection[char] ?? { name: characters[char]?.name ?? char, value: 0 };
        entry.value = clamp(entry.value + delta, 0, MAX_AFFECTION);
        if (characters[char]?.name) entry.name = characters[char].name;
        this.state.affection[char] = entry;
      }
    }
    for (const entry of gallery) {
      const id = entry?.id;
      if (typeof id !== 'string' || !NAME_PATTERN.test(id) || Object.keys(this.state.gallery).length >= MAX_GALLERY) continue;
      this.state.gallery[id] ??= { title: String(entry.title ?? id).slice(0, 60), scene: sceneId, at: this.now() };
    }
    delete this.state.saves[sceneId];
    this.save();
    return this.state.chapters[sceneId];
  }
}

module.exports = { StoryProgress };
