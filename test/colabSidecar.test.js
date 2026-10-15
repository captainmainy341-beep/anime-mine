const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { loadColabSidecars, applyColabSidecars } = require('../src/core/colabSidecar');

const root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-colab-'));
after(() => fsSync.rmSync(root, { recursive: true, force: true }));

let seq = 0;
function caseDir() {
  const dir = path.join(root, `case-${seq++}`);
  fsSync.mkdirSync(dir);
  return dir;
}

const CUES = [
  { start: 0, end: 1, text: '雨 降る' },
  { start: 1, end: 2, text: 'そうだ' },
  { start: 2, end: 3, text: '行く' },
];
const FIX = { task: 'fix', changes: [{ n: 1, text: '雨が降る' }], errors: [] };
const TAG = {
  task: 'tag',
  cues: [{ n: 1, jlpt: 'N4', words: ['雨'] }, { n: 2, jlpt: 'none', words: [] }],
  errors: [],
};

test('valid fix and tag sidecars apply by cue number and leave other cues as-is', async () => {
  const dir = caseDir();
  await fs.writeFile(path.join(dir, 'ep.fix.json'), JSON.stringify(FIX));
  await fs.writeFile(path.join(dir, 'ep.tag.json'), JSON.stringify(TAG));

  const sidecars = await loadColabSidecars({ videoPath: path.join(dir, 'ep.mkv'), subtitlePath: null });
  assert.deepEqual(sidecars.fix, new Map([[1, '雨が降る']]));
  assert.deepEqual(sidecars.tag, new Map([[1, { jlpt: 'N4', words: ['雨'] }], [2, { jlpt: 'none', words: [] }]]));

  const out = applyColabSidecars(CUES, sidecars);
  assert.deepEqual(out[0], { start: 0, end: 1, text: '雨が降る', originalText: '雨 降る', jlpt: 'N4', words: ['雨'] });
  assert.equal(out[1], CUES[1]);
  assert.equal(out[2], CUES[2]);
});

test('partial sidecars are ignored', async () => {
  const dir = caseDir();
  await fs.writeFile(path.join(dir, 'ep.fix.partial.json'), JSON.stringify(FIX));
  await fs.writeFile(path.join(dir, 'ep.tag.partial.json'), JSON.stringify(TAG));

  const sidecars = await loadColabSidecars({ videoPath: path.join(dir, 'ep.mkv'), subtitlePath: null });
  assert.deepEqual(sidecars, { fix: new Map(), tag: new Map() });
});

test('corrupt and wrong-shape sidecars produce empty maps without throwing', async () => {
  const dir = caseDir();
  await fs.writeFile(path.join(dir, 'ep.fix.json'), '{"task":"fix"');
  await fs.writeFile(path.join(dir, 'ep.tag.json'), JSON.stringify({ task: 'tag', cues: 'nope' }));

  const sidecars = await loadColabSidecars({ videoPath: path.join(dir, 'ep.mkv'), subtitlePath: null });
  assert.deepEqual(sidecars, { fix: new Map(), tag: new Map() });
});

test('a corrupt sidecar beside the video falls through to the one beside the subtitle', async () => {
  const videoDir = caseDir();
  const subDir = caseDir();
  await fs.writeFile(path.join(videoDir, 'ep.fix.json'), '{broken');
  await fs.writeFile(path.join(subDir, 'ep.fix.json'), JSON.stringify(FIX));

  const sidecars = await loadColabSidecars({
    videoPath: path.join(videoDir, 'ep.mkv'),
    subtitlePath: path.join(subDir, 'ep.srt'),
  });
  assert.deepEqual(sidecars.fix, new Map([[1, '雨が降る']]));
});

test('sidecars beside the subtitle are used when the video directory has none', async () => {
  const videoDir = caseDir();
  const subDir = caseDir();
  await fs.writeFile(path.join(subDir, 'ep.fix.json'), JSON.stringify(FIX));
  await fs.writeFile(path.join(subDir, 'ep.tag.json'), JSON.stringify(TAG));

  const sidecars = await loadColabSidecars({
    videoPath: path.join(videoDir, 'ep.mkv'),
    subtitlePath: path.join(subDir, 'ep.srt'),
  });
  assert.deepEqual(sidecars.fix, new Map([[1, '雨が降る']]));
  assert.deepEqual(sidecars.tag, new Map([[1, { jlpt: 'N4', words: ['雨'] }], [2, { jlpt: 'none', words: [] }]]));
});

test('the video directory wins per kind over the subtitle directory', async () => {
  const videoDir = caseDir();
  const subDir = caseDir();
  await fs.writeFile(path.join(videoDir, 'ep.fix.json'), JSON.stringify(FIX));
  await fs.writeFile(path.join(subDir, 'ep.fix.json'), JSON.stringify({ task: 'fix', changes: [{ n: 1, text: 'other' }] }));
  await fs.writeFile(path.join(subDir, 'ep.tag.json'), JSON.stringify(TAG));

  const sidecars = await loadColabSidecars({
    videoPath: path.join(videoDir, 'ep.mkv'),
    subtitlePath: path.join(subDir, 'ep.srt'),
  });
  assert.deepEqual(sidecars.fix, new Map([[1, '雨が降る']]));
  assert.equal(sidecars.tag.size, 2);
});

test('invalid entries are skipped and out-of-range numbers are ignored when applying', async () => {
  const dir = caseDir();
  await fs.writeFile(path.join(dir, 'ep.fix.json'), JSON.stringify({
    task: 'fix',
    changes: [{ n: 0, text: 'zero' }, { n: 4, text: 'past end' }, { n: 1.5, text: 'x' }, { n: 2, text: '' }, { n: 3, text: 7 }],
  }));
  await fs.writeFile(path.join(dir, 'ep.tag.json'), JSON.stringify({
    task: 'tag',
    cues: [{ n: 1, jlpt: 'N6', words: [] }, { n: 2, jlpt: 'N3', words: ['ok', 5] }, { n: 3, jlpt: 'N1', words: ['行く'] }],
  }));

  const sidecars = await loadColabSidecars({ videoPath: path.join(dir, 'ep.mkv'), subtitlePath: null });
  assert.deepEqual(sidecars.fix, new Map([[0, 'zero'], [4, 'past end']]));
  assert.deepEqual(sidecars.tag, new Map([[3, { jlpt: 'N1', words: ['行く'] }]]));

  const out = applyColabSidecars(CUES, sidecars);
  assert.deepEqual(out[2], { start: 2, end: 3, text: '行く', jlpt: 'N1', words: ['行く'] });
  assert.equal(out[0], CUES[0]);
  assert.equal(out[1], CUES[1]);
});

test('applyColabSidecars does not mutate its input', () => {
  const cues = CUES.map((cue) => ({ ...cue }));
  const snapshot = structuredClone(cues);

  const out = applyColabSidecars(cues, {
    fix: new Map([[1, '雨が降る']]),
    tag: new Map([[1, { jlpt: 'N4', words: ['雨'] }]]),
  });

  assert.notEqual(out, cues);
  assert.notEqual(out[0], cues[0]);
  assert.deepEqual(cues, snapshot);
});
