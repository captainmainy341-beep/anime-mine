import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { continueRow, currentSeason, featured, genkiRows, heroCopy, nextUp, seasonRows, sheetActions, tileProgress, titleParts } from '../src/renderer/learn/storyHomeModel.mjs';

const require = createRequire(import.meta.url);
const { loadChapters, chapterSummary } = require('../src/core/storyContent');
const all = loadChapters().chapters.map((c) => ({ ...chapterSummary(c), completed: false, plays: 0, saved: false }));
const main = all.filter((c) => c.track === 'main');
const genki = all.filter((c) => c.track === 'genki').map((g) => ({ ...g, primer: { done: false, minutes: 8, words: 20, patterns: 4, drills: 12, accuracy: 0 } }));
const done = (c) => ({ ...c, completed: true, plays: 1 });

test('the story is grouped into five seasons of six chapters, in order', () => {
  const seasons = seasonRows(main);
  assert.deepEqual(seasons.map((s) => s.level), ['N5', 'N4', 'N3', 'N2', 'N1']);
  assert.ok(seasons.every((s) => s.total === 6 && s.done === 0 && s.nextId));
  assert.equal(currentSeason(seasons).level, 'N5');
  assert.equal(seasons[0].nextId, 'n5-ch1');
});

test('finishing a season moves "now" to the next one and next-up skips completed chapters', () => {
  const chapters = main.map((c) => (c.jlpt === 'N5' ? done(c) : c));
  const seasons = seasonRows(chapters);
  assert.equal(seasons[0].complete, true);
  assert.equal(currentSeason(seasons).level, 'N4');
  assert.equal(nextUp(chapters.filter((c) => c.jlpt === 'N4')).id, 'n4-ch1');
  const saved = chapters.map((c) => (c.id === 'n4-ch3' ? { ...c, saved: true, resume: 0.4 } : c));
  assert.equal(nextUp(saved.filter((c) => c.jlpt === 'N4')).id, 'n4-ch3', 'a saved scene comes first');
});

test('tile progress: genki counts the lesson as half and the story as half', () => {
  assert.deepEqual(tileProgress(main[0]), { fraction: 0, status: 'new' });
  assert.deepEqual(tileProgress(done(main[0])), { fraction: 1, status: 'done' });
  assert.equal(tileProgress({ ...main[0], saved: true, resume: 0.5 }).fraction, 0.5);
  const g = genki[0];
  assert.deepEqual(tileProgress(g), { fraction: 0, status: 'new' });
  assert.deepEqual(tileProgress({ ...g, primer: { ...g.primer, done: true } }), { fraction: 0.5, status: 'learned' });
  assert.deepEqual(tileProgress({ ...done(g), primer: { ...g.primer, done: true } }), { fraction: 1, status: 'done' });
  assert.equal(tileProgress(done(g)).status, 'story-only');
});

test('genki rows mark the first lesson that is not fully done as up next', () => {
  const rows = genkiRows([{ ...done(genki[0]), primer: { ...genki[0].primer, done: true } }, genki[1], genki[2]]);
  assert.deepEqual(rows.map((r) => r.upNext), [false, true, false]);
  assert.deepEqual(genkiRows(undefined), []);
});

test('the billboard features the main story, the next lesson, and anything saved first', () => {
  const fresh = featured({ chapters: main, genki });
  assert.deepEqual(fresh.map((f) => [f.kind, f.scene.id]), [['start', 'n5-ch1'], ['genki', 'genki-l01']]);
  const resumed = featured({ chapters: main.map((c) => (c.id === 'n5-ch2' ? { ...c, saved: true } : c)), genki });
  assert.equal(resumed[0].kind, 'continue');
  assert.equal(resumed[0].scene.id, 'n5-ch2');
  assert.ok(resumed.length <= 3);
  assert.deepEqual(continueRow(resumed.map((f) => f.scene)).map((c) => c.id), ['n5-ch2']);
});

test('titles split into a label and a name, and hero copy picks the right button', () => {
  assert.deepEqual(titleParts(main[3]), { label: 'Chapter 4', name: 'かいもの' });
  assert.deepEqual(titleParts(genki[0]), { label: 'Lesson 1', name: 'はじめまして、みなと町' });
  const [start, lesson] = featured({ chapters: main, genki });
  assert.equal(heroCopy(start).cta, 'Play');
  assert.match(heroCopy(start).eyebrow, /Season 1 · N5 · Chapter 1/);
  assert.equal(heroCopy(lesson).cta, 'Start lesson');
});

test('the detail sheet offers the lesson first for unlearned genki scenes, and the story otherwise', () => {
  assert.deepEqual(sheetActions(genki[0]), { lesson: 'Learn first', lessonPrimary: true, play: 'Skip to the story', playPrimary: false, restart: null });
  const learned = { ...genki[0], primer: { ...genki[0].primer, done: true } };
  assert.deepEqual(sheetActions(learned), { lesson: 'Review the lesson', lessonPrimary: false, play: 'Play', playPrimary: true, restart: null });
  assert.deepEqual(sheetActions({ ...main[0], saved: true }), { lesson: null, lessonPrimary: false, play: 'Continue', playPrimary: true, restart: 'Start over' });
});

test('the Genki path is split into Genki I (1-12) and Genki II (13-23) rows', async () => {
  const { genkiBooks } = await import('../src/renderer/learn/storyHomeModel.mjs');
  const books = genkiBooks(genkiRows(genki));
  assert.deepEqual(books.map((b) => [b.name, b.rows[0].lesson, b.rows.at(-1).lesson]), [['Genki I', 1, 12], ['Genki II', 13, 23]]);
  assert.deepEqual(genkiBooks(genkiRows(genki.slice(0, 12))).map((b) => b.name), ['Genki I']);
  assert.deepEqual(genkiBooks([]), []);
});
