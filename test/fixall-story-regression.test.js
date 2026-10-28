const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStoryHandlers } = require('../src/main/storyHandlers');
const { seriesTitle } = require('../src/core/manga');

test('introduced items survive a save and restart and are not submitted as reviews', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-save-'));
  try {
    let submitted = 0;
    const learn = { 'learn:card': () => ({ stage: 1 }), 'learn:submit': () => { submitted++; } };
    const make = () => createStoryHandlers({ dataDir: dir, learn, getSettings: async () => ({ ai: {} }) }).handlers;
    const { snapshotWithIntroductions, restoredIntroductions } = await import('../src/renderer/learn/story.mjs');
    const first = make();
    const snapshot = snapshotWithIntroductions({ scene: 'n5-ch1', index: 1 }, new Set(['g:n5-ka']));
    first['story:save']({ id: 'n5-ch1', snapshot });
    const second = make();
    const saved = second['story:load']('n5-ch1');
    assert.deepEqual(saved.introducedNow, ['g:n5-ka']);
    const restored = restoredIntroductions(saved, ['g:n5-ka']);
    assert.equal((await second['story:report']({ item: 'g:n5-ka', incorrectCount: 0, introducedNow: restored.has('g:n5-ka') })).reason, 'lesson');
    assert.equal(submitted, 0);
    first['story:save']({ id: 'n5-ch1', snapshot: { scene: 'n5-ch1', index: 1 } });
    const oldSave = make()['story:load']('n5-ch1');
    assert.equal(oldSave.introducedNow, undefined);
    assert.equal(restoredIntroductions(oldSave, ['g:n5-ka']).size, 0);
    assert.equal(restoredIntroductions({ introducedNow: ['g:other'] }, ['g:n5-ka']).size, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('generic folder names infer a shared series title across platforms', () => {
  const volumes = [{ title: 'Dorohedoro Vol. 1.cbz', kind: 'cbz' }, { title: 'Dorohedoro Vol. 2.pdf', kind: 'pdf' }];
  assert.equal(seriesTitle('/books/Untitled Folder', volumes), 'Dorohedoro');
  assert.equal(seriesTitle('C:\\books\\New Folder (2)', volumes), 'Dorohedoro');
  assert.equal(seriesTitle('/books/Collection', volumes), 'Collection');
  assert.equal(seriesTitle('/books/New Folder', [{ title: 'Vol 1.cbz', kind: 'cbz' }]), 'New Folder');
  assert.equal(seriesTitle('/books/New Folder', [...volumes, { title: 'Other.cbz', kind: 'cbz' }]), 'New Folder');
});
