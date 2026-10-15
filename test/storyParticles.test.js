const { test } = require('node:test');
const assert = require('node:assert/strict');
const PARTICLES = require('../src/core/data/particles.json');
const { guide, annotateScene, roleExplanation, noteFor, CONFUSIONS } = require('../src/core/storyParticles');
const { loadChapters } = require('../src/core/storyContent');

test('the guide lists N5/N4 particles with roles and links each to the pairs it is confused with', () => {
  const g = guide();
  assert.ok(g.particles.length >= 20);
  assert.ok(g.particles.every((p) => ['N5', 'N4'].includes(p.level) && p.roles.length > 0));
  const ni = g.particles.find((p) => p.surface === 'に');
  assert.ok(ni.confusions.includes('ni-de') && ni.confusions.includes('ni-e'));
  assert.ok(g.confusions.length >= 8);
  for (const c of CONFUSIONS) {
    assert.ok(c.points.length >= 2 && c.examples.length >= 1, c.id);
    assert.ok(c.examples.every((ex) => ex.ja && ex.en), c.id);
  }
});

test('notes explain a particle; roles resolve against particles.json', () => {
  assert.match(noteFor('で'), /where an action happens/);
  assert.match(noteFor('ずつ'), /^[a-z]/, 'particles without a short note fall back to their first role');
  assert.equal(noteFor('xyz'), null);
  assert.match(roleExplanation('p:ni/destination'), /^marks where someone goes/);
  assert.equal(roleExplanation('p:ni/nope'), null);
  assert.equal(roleExplanation(undefined), null);
});

test('every particle role used by a shipped chapter exists in the particle data', () => {
  const roles = new Set(PARTICLES.flatMap((p) => p.roles.map((r) => `${p.id}/${r.id}`)));
  for (const chapter of loadChapters().chapters) {
    for (const beat of chapter.beats.filter((b) => b.type === 'particle' && b.role)) {
      assert.ok(roles.has(beat.role), `${chapter.id}: unknown role ${beat.role}`);
    }
  }
});

test('annotateScene adds notes for every option and why the answer fits, leaving other beats alone', () => {
  const scene = {
    beats: [
      { type: 'say', text: 'x' },
      { type: 'particle', item: 'g:n5-ni', text: '学校＿行く', options: ['に', 'で', 'を'], answers: ['に'], role: 'p:ni/destination' },
    ],
  };
  const out = annotateScene(scene);
  assert.equal(out.beats[0], scene.beats[0]);
  assert.deepEqual(Object.keys(out.beats[1].notes), ['に', 'で', 'を']);
  assert.match(out.beats[1].why, /goes or moves to/);
  assert.equal(scene.beats[1].notes, undefined, 'the input is not mutated');
  const plain = { beats: [{ type: 'say' }] };
  assert.equal(annotateScene(plain), plain);
});
