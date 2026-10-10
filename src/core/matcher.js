const path = require('node:path');

const MATCH_THRESHOLD = 0.6;
const CONTAINMENT_WEIGHT = 0.9;
const MIN_CONTAINED_LENGTH = 4;

const EXTENSION = /\.(?:mkv|mp4|m4v|webm|avi|srt|ass|ssa|vtt)$/i;
const LANGUAGE_TAG = /\.([a-z]{2,10}(?:-[a-z]{2,4})?)$/i;
const LANGUAGE_CODES = {
  ja: ['ja', 'jp', 'jpn', 'japanese'],
  en: ['en', 'eng', 'english'],
  es: ['es', 'spa', 'spanish'],
  fr: ['fr', 'fre', 'fra', 'french'],
  de: ['de', 'ger', 'deu', 'german'],
  pt: ['pt', 'por', 'portuguese'],
  ru: ['ru', 'rus', 'russian'],
  zh: ['zh', 'chi', 'zho', 'chinese', 'chs', 'cht'],
  ko: ['ko', 'kor', 'korean'],
  id: ['id', 'ind', 'indonesian'],
  ar: ['ar', 'ara', 'arabic'],
  it: ['it', 'ita', 'italian'],
};
// Tag -> ISO 639-1 code; undetermined ('und') is recognised as a tag but yields null.
const LANGUAGE_TAGS = new Map([
  ...Object.entries(LANGUAGE_CODES).flatMap(([code, names]) => names.map(name => [name, code])),
  ['und', null],
]);
const RELEASE_TOKEN = /^(?:\d{3,4}p|\d{1,2}bit|4k|[xh]26[45]|hevc|av1|aac[\d.]*|flac|opus|ac3|eac3|dts|web|webrip|web-dl|webdl|bluray|bdrip|brrip|hdtv|dvdrip|remux|multi|dual|dub|subs?|jimaku|subsplease|erai-raws|crunchyroll|amzn|nf|batch|uncensored|v\d+)$/i;
const SXE = /\bS(\d{1,2})\s?E(\d{1,4})\b/i;
const SEASON_PATTERNS = [/\bS(\d{1,2})\b/i, /\bseason\s?(\d{1,2})\b/i];
const EPISODE_PATTERNS = [
  /第\s*(\d{1,4})\s*話/,
  /\bEP?\s?(\d{1,4})\b/i,
  /-\s*(\d{1,4})(?:v\d+)?(?=\s|$)/,
  /\s(\d{1,3})\s*$/,
];

function normalise(stem) {
  return stem
    .normalize('NFKC')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b([hx])\.(26[45])\b/gi, '$1$2')
    .replace(/\b\d\.\d\b/g, ' ')
    .replace(/[._]+/g, ' ')
    .split(/\s+/)
    .filter(word => word && !RELEASE_TOKEN.test(word))
    .join(' ');
}

function takeFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { value: Number(match[1]), text: text.replace(match[0], ' ') };
  }
  return { value: null, text };
}

function extractMarkers(text) {
  const sxe = text.match(SXE);
  if (sxe) return { season: Number(sxe[1]), episode: Number(sxe[2]), text: text.replace(sxe[0], ' ') };
  const season = takeFirst(text, SEASON_PATTERNS);
  const episode = takeFirst(season.text, EPISODE_PATTERNS);
  return { season: season.value, episode: episode.value, text: episode.text };
}

function cleanTitle(text) {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function takeLanguage(stem) {
  const match = stem.match(LANGUAGE_TAG);
  if (!match) return { text: stem, lang: null };
  const tag = match[1].toLowerCase();
  const known = [tag, tag.split('-')[0]].find(key => LANGUAGE_TAGS.has(key));
  if (known === undefined) return { text: stem, lang: null };
  return { text: stem.slice(0, match.index), lang: LANGUAGE_TAGS.get(known) };
}

function parseMediaName(filename) {
  const language = takeLanguage(path.basename(filename).replace(EXTENSION, ''));
  const markers = extractMarkers(normalise(language.text));
  return { title: cleanTitle(markers.text), season: markers.season, episode: markers.episode, lang: language.lang };
}

function bigrams(text) {
  const counts = new Map();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function bigramDice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = bigrams(b);
  let shared = 0;
  for (const [gram, count] of bigrams(a)) shared += Math.min(count, grams.get(gram) ?? 0);
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

function findBestVideo(subtitleFilename, videos) {
  const subtitle = parseMediaName(subtitleFilename);
  if (subtitle.episode === null) return null;
  let best = null;
  for (const video of videos) {
    const media = parseMediaName(video.name);
    if (media.episode !== subtitle.episode) continue;
    if (subtitle.season !== null && media.season !== null && subtitle.season !== media.season) continue;
    const score = titleSimilarity(subtitle.title, media.title);
    if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { video, score };
  }
  return best;
}

module.exports = { parseMediaName, findBestVideo };
