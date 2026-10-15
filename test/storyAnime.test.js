const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildAnimeScene, buildAnimeScenes, sceneId } = require('../src/core/storyAnime');

const example = { videoPath: '/videos/Show - 01.mkv', start: 10, end: 14, text: '写真を撮ってもいいですか。', matchStart: 5, matchEnd: 9 };
const point = { id: 'g:n5-te-mo-ii', title: '〜てもいい', meaning: 'may / it is okay to (do something)', jlpt: 'N5' };
const others = ['must not do', 'want to do', 'because', 'also', point.meaning];

test('an anime line becomes a short scene with the grammar point as its challenge', () => {
  const scene = buildAnimeScene({ example, point, otherMeanings: others });
  assert.equal(scene.source, 'anime');
  assert.equal(scene.id, sceneId(example));
  assert.deepEqual(scene.items, ['g:n5-te-mo-ii']);
  const line = scene.beats.find((b) => b.who === 'line');
  assert.equal(line.text, example.text);
  const meaning = scene.beats.find((b) => b.type === 'meaning');
  assert.equal(meaning.display, 'てもいい');
  assert.equal(meaning.options[meaning.correct], point.meaning);
  assert.equal(meaning.options.length, 4);
  assert.equal(new Set(meaning.options).size, 4, 'the correct meaning appears once');
  assert.equal(scene.bgImage, undefined);
});

test('building is deterministic so a line always gets the same id and option order', () => {
  assert.deepEqual(buildAnimeScene({ example, point, otherMeanings: others }), buildAnimeScene({ example, point, otherMeanings: others }));
});

test('a frame becomes the background when given', () => {
  const frame = 'data:image/jpeg;base64,/9j/4AAQ';
  assert.equal(buildAnimeScene({ example, point, otherMeanings: others, frame }).bgImage, frame);
});

test('a line with nothing to quiz against is skipped, not invented', () => {
  assert.equal(buildAnimeScene({ example, point, otherMeanings: [] }), null);
  assert.equal(buildAnimeScene({ example, point, otherMeanings: [point.meaning] }), null);
  assert.equal(buildAnimeScene({ example: { ...example, matchEnd: 5 }, point, otherMeanings: others }), null);
});

test('with the source video present, the frame is grabbed at the middle of the cue through ffmpeg', async () => {
  const calls = [];
  const scenes = await buildAnimeScenes([{ example, point, otherMeanings: others }], {
    fileExists: async (file) => file === example.videoPath,
    screenshot: async (args) => {
      calls.push(args);
      return Buffer.from([0xff, 0xd8, 0xff]);
    },
  });
  assert.deepEqual(calls, [{ video: example.videoPath, time: 12, maxWidth: 960 }]);
  assert.equal(scenes[0].bgImage, `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString('base64')}`);
});

test('without the source video the scene keeps the default background and ffmpeg is never called', async () => {
  let called = false;
  const scenes = await buildAnimeScenes([{ example, point, otherMeanings: others }], {
    fileExists: async () => false,
    screenshot: async () => {
      called = true;
      return Buffer.alloc(1);
    },
  });
  assert.equal(called, false);
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].bgImage, undefined);
  assert.equal(scenes[0].bg, 'anime-default');
});

test('an ffmpeg failure or an oversized frame degrades to the default background', async () => {
  const run = (screenshot) => buildAnimeScenes([{ example, point, otherMeanings: others }], { fileExists: async () => true, screenshot });
  assert.equal((await run(async () => { throw new Error('ffmpeg exploded'); }))[0].bgImage, undefined);
  assert.equal((await run(async () => Buffer.alloc(2_000_000)))[0].bgImage, undefined);
  assert.equal((await run(async () => 'not a buffer'))[0].bgImage, undefined);
  assert.equal((await run(async () => Buffer.alloc(0)))[0].bgImage, undefined);
});
