const fs = require('node:fs');
const path = require('node:path');

const SKINS_DIR = 'vn-skins';
const PACK_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function skinsRoot(dataDir) {
  return path.join(dataDir, SKINS_DIR);
}

function packDir(dataDir, pack) {
  if (typeof pack !== 'string' || !PACK_NAME.test(pack)) throw new Error('invalid skin pack name');
  return path.join(skinsRoot(dataDir), pack);
}

// Resolves a path from pack.json to a real file inside the pack, or null. Symlinks that leave the pack are refused.
function resolveAsset(dir, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.length > 200 || path.isAbsolute(rel) || rel.includes('\0')) return null;
  if (!Object.hasOwn(MIME, path.extname(rel).toLowerCase())) return null;
  const full = path.resolve(dir, rel);
  if (full !== dir && !full.startsWith(dir + path.sep)) return null;
  try {
    const real = fs.realpathSync(full);
    const realDir = fs.realpathSync(dir);
    if (!real.startsWith(realDir + path.sep)) return null;
    const stat = fs.statSync(real);
    return stat.isFile() && stat.size <= MAX_ASSET_BYTES ? real : null;
  } catch {
    return null;
  }
}

// Reads <userData>/vn-skins/<pack>/pack.json and keeps only entries whose image really exists.
// Returns null (so the caller falls back to the built-in code-drawn pack) when the pack is missing or unreadable.
function loadManifest(dataDir, pack) {
  let dir;
  try {
    dir = packDir(dataDir, pack);
  } catch {
    return null;
  }
  let raw;
  try {
    const file = path.join(dir, 'pack.json');
    if (fs.statSync(file).size > MAX_MANIFEST_BYTES) return null;
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const characters = {};
  for (const [id, expressions] of Object.entries(isObject(raw.characters) ? raw.characters : {})) {
    if (!ID_PATTERN.test(id) || !isObject(expressions)) continue;
    for (const [expr, rel] of Object.entries(expressions)) {
      if (ID_PATTERN.test(expr) && resolveAsset(dir, rel)) (characters[id] ??= {})[expr] = rel;
    }
  }
  const backgrounds = {};
  for (const [id, rel] of Object.entries(isObject(raw.backgrounds) ? raw.backgrounds : {})) {
    if (ID_PATTERN.test(id) && resolveAsset(dir, rel)) backgrounds[id] = rel;
  }
  const text = (value) => (typeof value === 'string' ? value.slice(0, 120) : '');
  return { pack, title: text(raw.name) || pack, author: text(raw.author), license: text(raw.license), characters, backgrounds };
}

function listPacks(dataDir) {
  let names = [];
  try {
    names = fs.readdirSync(skinsRoot(dataDir), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  return names
    .filter((name) => PACK_NAME.test(name))
    .sort()
    .map((name) => {
      const manifest = loadManifest(dataDir, name);
      return { pack: name, title: manifest?.title ?? name, valid: manifest !== null };
    });
}

function readAsset(dataDir, pack, rel) {
  const dir = packDir(dataDir, pack);
  const file = resolveAsset(dir, rel);
  if (!file) throw new Error('skin asset not found');
  const mime = MIME[path.extname(file).toLowerCase()];
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

module.exports = { loadManifest, listPacks, readAsset, resolveAsset, skinsRoot, PACK_NAME };
