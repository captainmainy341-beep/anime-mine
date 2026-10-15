const crypto = require('node:crypto');
const path = require('node:path');
const { assertScene } = require('./storySchema');

const MAX_FRAME_BYTES = 1_400_000;
const FRAME_WIDTH = 960;

const sha = (text) => crypto.createHash('sha1').update(text).digest('hex');

function seededOrder(items, seed) {
  return items
    .map((item, i) => ({ item, key: sha(`${seed}:${i}`) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .map(({ item }) => item);
}

function sceneId(example) {
  return `anime-${sha(`${example.videoPath}|${example.start}|${example.text}`).slice(0, 10)}`;
}

function videoTitle(videoPath) {
  const name = path.basename(String(videoPath ?? ''), path.extname(String(videoPath ?? '')));
  return name.slice(0, 50) || 'anime';
}

// Builds a short bonus scene around one mined anime line and the grammar point it contains.
// `frame` is an optional JPEG data URL used as the background; without it the default background is used.
function buildAnimeScene({ example, point, otherMeanings = [], frame = null }) {
  const matched = example.text.slice(example.matchStart, example.matchEnd);
  const wrong = [...new Set(otherMeanings.filter((m) => typeof m === 'string' && m && m !== point.meaning))].map((m) => m.slice(0, 80));
  if (!matched || wrong.length === 0) return null;
  const id = sceneId(example);
  const options = seededOrder([point.meaning.slice(0, 80), ...wrong.slice(0, 3)], id);
  const title = videoTitle(example.videoPath);
  const scene = {
    schema: 1,
    id,
    title: `Anime line: ${title}`,
    jlpt: ['N5', 'N4', 'N3', 'N2', 'N1'].includes(point.jlpt) ? point.jlpt : 'N5',
    source: 'anime',
    summary: `A line from ${title}.`,
    bg: 'anime-default',
    characters: { line: { name: 'アニメ', color: '#a2befa' } },
    glossary: { [point.id]: { label: point.title.slice(0, 40), meaning: point.meaning.slice(0, 160) } },
    beats: [
      { type: 'say', who: null, text: `「${title}」で 聞いた ひとこと。`, en: `A line you heard in ${title}.` },
      { type: 'show', char: 'line', expr: 'neutral', pos: 'center' },
      { type: 'say', who: 'line', text: example.text.slice(0, 240) },
      { type: 'intro', item: point.id },
      {
        type: 'meaning',
        item: point.id,
        display: matched.slice(0, 40),
        prompt: `In this line, what does 「${matched.slice(0, 30)}」 express?`,
        options,
        correct: options.indexOf(point.meaning.slice(0, 80)),
      },
      { type: 'say', who: null, text: 'ひとつ、わかった。', en: 'One more piece of the line makes sense.' },
    ],
  };
  if (frame) scene.bgImage = frame;
  return assertScene(scene);
}

// Grabs a still from the episode with the existing ffmpeg helper. Any failure (file moved, no ffmpeg) means
// "no frame", never an error: the scene simply keeps the default background.
async function grabFrame(example, { fileExists, screenshot }) {
  try {
    if (!(await fileExists(example.videoPath))) return null;
    const time = Math.max(0, (Number(example.start) + Number(example.end ?? example.start)) / 2);
    const jpeg = await screenshot({ video: example.videoPath, time, maxWidth: FRAME_WIDTH });
    if (!Buffer.isBuffer(jpeg) || jpeg.length === 0 || jpeg.length > MAX_FRAME_BYTES) return null;
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  } catch {
    return null;
  }
}

async function buildAnimeScenes(entries, deps) {
  const scenes = [];
  for (const { example, point, otherMeanings } of entries) {
    const frame = await grabFrame(example, deps);
    const scene = buildAnimeScene({ example, point, otherMeanings, frame });
    if (scene) scenes.push(scene);
  }
  return scenes;
}

module.exports = { buildAnimeScene, buildAnimeScenes, grabFrame, sceneId };
