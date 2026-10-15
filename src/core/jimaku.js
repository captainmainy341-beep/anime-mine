const BASE_URL = 'https://jimaku.cc/api';
const API_ORIGIN = 'https://jimaku.cc';
const DEFAULT_COOLDOWN_MS = 60_000;
const MATCH_THRESHOLD = 0.6;
const CONTAINMENT_WEIGHT = 0.9;
const MIN_CONTAINED_LENGTH = 4;
const SUBTITLE_NAME = /\.(?:srt|ass|ssa|vtt)$/i;
const JAPANESE_HINT = /japanese|\bja\b|\bjpn?\b|日本語/i;
const CC_HINT = /\b(?:cc|sdh|forced)\b/i;
const SEASON_MARKERS = [
  /\bseason\s*(\d{1,2})\b/i,
  /\b(\d{1,2})(?:st|nd|rd|th)\s*season\b/i,
  /第\s*(\d{1,2})\s*期/,
  /\bS(\d{1,2})\b/i,
];

class JimakuError extends Error {
  constructor(message, status = null, retryAfterMs = null) {
    super(message);
    this.name = 'JimakuError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function normalizeTitle(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function bigramDice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map();
  for (let i = 0; i < b.length - 1; i++) grams.set(b.slice(i, i + 2), (grams.get(b.slice(i, i + 2)) ?? 0) + 1);
  let shared = 0;
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    const left = grams.get(gram) ?? 0;
    if (left > 0) {
      shared++;
      grams.set(gram, left - 1);
    }
  }
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

function containment(a, b) {
  const [short, long] = [a.split(' '), b.split(' ')].sort((x, y) => x.length - y.length);
  if (short.join('').length < MIN_CONTAINED_LENGTH) return 0;
  const longTokens = new Set(long);
  return short.filter(token => longTokens.has(token)).length / short.length;
}

function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dice = bigramDice(a.replace(/ /g, ''), b.replace(/ /g, ''));
  return Math.max(dice, CONTAINMENT_WEIGHT * containment(a, b));
}

// Explicit season number in an entry's names; an entry without one is season 1.
function entrySeason(names) {
  for (const name of names) {
    for (const marker of SEASON_MARKERS) {
      const match = name.match(marker);
      if (match) return Number(match[1]);
    }
  }
  return 1;
}

function pickEntry(entries, { title, season, episode }) {
  const query = normalizeTitle(title);
  let best = null;
  for (const entry of entries) {
    if (episode !== null && entry.flags?.movie) continue;
    const names = [entry.name, entry.japanese_name, entry.english_name].filter(Boolean);
    if (entrySeason(names) !== (season ?? 1)) continue;
    const score = Math.max(0, ...names.map(name => titleSimilarity(query, normalizeTitle(name))));
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { entry, score };
  }
  return best?.entry ?? null;
}

function subtitleRank(file) {
  return [JAPANESE_HINT.test(file.name) ? 1 : 0, CC_HINT.test(file.name) ? 0 : 1, file.size ?? 0];
}

function pickFile(files) {
  const candidates = files.filter(file => SUBTITLE_NAME.test(file.name));
  candidates.sort((a, b) => {
    const x = subtitleRank(a);
    const y = subtitleRank(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i];
    return 0;
  });
  return candidates[0] ?? null;
}

function createJimaku({ apiKey, fetch = globalThis.fetch }) {
  async function send(url) {
    let response;
    try {
      const headers = new URL(url).origin === API_ORIGIN ? { Authorization: apiKey } : {};
      response = await fetch(url, { headers });
    } catch {
      throw new JimakuError('Jimaku is unreachable');
    }
    if (!response.ok) {
      const seconds = Number(response.headers?.get?.('x-ratelimit-reset-after') ?? response.headers?.get?.('retry-after'));
      const retryAfterMs = response.status === 429 ? (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_COOLDOWN_MS) : null;
      throw new JimakuError(`Jimaku request failed (HTTP ${response.status})`, response.status, retryAfterMs);
    }
    return response;
  }

  async function getJson(url) {
    const body = await (await send(url)).json().catch(() => {
      throw new JimakuError('Jimaku returned an invalid response');
    });
    return Array.isArray(body) ? body : [];
  }

  const searches = new Map();
  const search = (title) => {
    if (!searches.has(title)) {
      const url = `${BASE_URL}/entries/search?${new URLSearchParams({ query: title, anime: 'true' })}`;
      searches.set(title, getJson(url).catch((err) => {
        searches.delete(title);
        throw err;
      }));
    }
    return searches.get(title);
  };

  return {
    async findSubtitle({ title, season = null, episode = null }) {
      if (!normalizeTitle(title)) return null;
      const entries = await search(title);
      const entry = pickEntry(entries, { title, season, episode });
      if (!entry) return null;
      const filter = episode === null ? '' : `?${new URLSearchParams({ episode: String(episode) })}`;
      const files = await getJson(`${BASE_URL}/entries/${encodeURIComponent(String(entry.id))}/files${filter}`);
      const file = pickFile(files);
      if (!file) return null;
      const data = Buffer.from(await (await send(file.url)).arrayBuffer());
      return { name: file.name, data };
    },
  };
}

module.exports = { createJimaku, JimakuError, normalizeTitle };
