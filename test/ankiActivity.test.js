const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AnkiBrowser, dateKey, reviewsByDay } = require('../src/core/ankiBrowse');
const { SampleBrowser, sampleReviewsByDay } = require('../src/core/ankiSample');

// Fake AnkiClient: records every invoke and answers from a replies table.
function fakeClient(replies = {}) {
  const calls = [];
  return {
    calls,
    async invoke(action, params = {}) {
      calls.push({ action, params });
      const reply = replies[action];
      if (reply === undefined) throw new Error(`no reply for ${action}`);
      return typeof reply === 'function' ? reply(params) : reply;
    },
  };
}

const TODAY = new Date(2026, 4, 20); // 20 May 2026, local collection day
const dayBefore = (date, days) => dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() - days));

test('reviewsByDay keeps the last 365 days, ascending, with positive counts only', () => {
  const rows = [
    ['2026-05-20', 12],
    ['2025-05-21', 3], // exactly 365 days back: kept
    ['2026-05-19', 0],
    ['2025-05-20', 99], // one day before the window
    ['2026-05-21', 40], // tomorrow
    ['2026-05-18', -2],
    ['2026-5-18', 7],
    'not-a-row',
    null,
    ['2026-05-17'],
  ];
  assert.deepEqual(reviewsByDay(rows, TODAY), [
    { date: '2025-05-21', count: 3 },
    { date: '2026-05-20', count: 12 },
  ]);
});

test('reviewsByDay sums duplicate days and drops unusable counts', () => {
  const rows = [
    ['2026-05-20', 4],
    ['2026-05-20', 6],
    ['2026-05-19', '3'],
    ['2026-05-18', NaN],
    ['2026-05-17', 0.5],
  ];
  assert.deepEqual(reviewsByDay(rows, TODAY), [
    { date: '2026-05-19', count: 3 },
    { date: '2026-05-20', count: 10 },
  ]);
});

test('reviewsByDay tolerates missing or malformed AnkiConnect replies', () => {
  assert.deepEqual(reviewsByDay(undefined, TODAY), []);
  assert.deepEqual(reviewsByDay(null, TODAY), []);
  assert.deepEqual(reviewsByDay({}, TODAY), []);
  assert.deepEqual(reviewsByDay([], TODAY), []);
});

test('an overview without visible decks returns an empty review series and makes no requests', async () => {
  const client = fakeClient();
  const overview = await new AnkiBrowser(client).overview({ decks: [], model: 'AnimeMine' });

  assert.deepEqual(overview.reviewsByDay, []);
  assert.deepEqual(Object.keys(overview).sort(), [
    'decks',
    'forecast',
    'mined',
    'minedThisWeek',
    'retention30',
    'reviewsByDay',
    'streak',
    'today',
  ]);
  assert.deepEqual(client.calls, []);
});

test('overview adds the review series from AnkiConnect getNumCardsReviewedByDay', async () => {
  const today = new Date();
  const todayKey = dateKey(today);
  const yesterdayKey = dayBefore(today, 1);
  const client = fakeClient({
    multi: ({ actions }) => actions.map(() => []),
    getNumCardsReviewedByDay: () => [
      [todayKey, 21],
      [yesterdayKey, 9],
    ],
  });

  const overview = await new AnkiBrowser(client).overview({ decks: ['Core'], model: 'AnimeMine' });

  assert.deepEqual(overview.reviewsByDay, [
    { date: yesterdayKey, count: 9 },
    { date: todayKey, count: 21 },
  ]);
  assert.deepEqual(
    client.calls.filter((call) => call.action === 'getNumCardsReviewedByDay').map((call) => call.params),
    [{}],
  );
  assert.deepEqual(overview.decks.map((deck) => deck.name), ['Core']);
});

test('overview keeps its other fields when review activity is unavailable', async () => {
  const client = fakeClient({ multi: ({ actions }) => actions.map(() => []) });

  const overview = await new AnkiBrowser(client).overview({ decks: ['Core'], model: 'AnimeMine' });

  assert.deepEqual(overview.reviewsByDay, []);
  assert.equal(overview.decks.length, 1);
  assert.equal(overview.forecast.length, 22);
  assert.deepEqual(overview.today, { studied: 0, due: 0, learning: 0, new: 0 });
});

test('sample review data is deterministic and spans about twelve months', () => {
  const first = sampleReviewsByDay(TODAY);

  assert.deepEqual(sampleReviewsByDay(TODAY), first);
  assert.ok(first.length > 200 && first.length < 365, `unexpected density: ${first.length} days`);
  assert.equal(first[0].date, dayBefore(TODAY, 364));
  assert.equal(first.at(-1).date, '2026-05-20');
  const dates = first.map((row) => row.date);
  assert.deepEqual(dates, [...dates].sort(), 'days must be ascending');
  assert.equal(new Set(dates).size, dates.length, 'days must be unique');
  assert.ok(first.every((row) => Number.isInteger(row.count) && row.count > 0));
  assert.ok(first.some((row) => row.count > 40), 'the heatmap needs a few heavy days');
});

test('sample reviews end with a current six-day streak', () => {
  const rows = sampleReviewsByDay(TODAY);
  const expected = [5, 4, 3, 2, 1, 0].map((days) => dayBefore(TODAY, days));

  assert.deepEqual(rows.slice(-6).map((row) => row.date), expected);
  assert.ok(!rows.some((row) => row.date === dayBefore(TODAY, 6)), 'the streak must stop at six days');
  assert.equal(rows.at(-1).count, 37);
});

test('sample overview carries a stable review series ending today', async () => {
  const sample = new SampleBrowser();
  const first = await sample.overview();

  assert.deepEqual(first, await sample.overview());
  assert.ok(first.reviewsByDay.length > 200);
  assert.equal(first.reviewsByDay.at(-1).date, dateKey(new Date()));
  assert.equal(first.decks.length, 4);
  assert.equal(first.streak, 6);
  assert.equal(first.reviewsByDay.at(-1).count, 37);
});

test('createDeck trims the name and returns it', async () => {
  const client = fakeClient({ createDeck: () => 1 });

  assert.deepEqual(await new AnkiBrowser(client).createDeck({ name: '  Manga Ink  ' }), { ok: true, name: 'Manga Ink' });
  assert.deepEqual(client.calls, [{ action: 'createDeck', params: { deck: 'Manga Ink' } }]);
});

test('createDeck rejects blank or missing names before calling AnkiConnect', async () => {
  const client = fakeClient({ createDeck: () => 1 });
  const browser = new AnkiBrowser(client);

  for (const name of ['', '   ', '\n', undefined, null, 42, {}]) {
    await assert.rejects(browser.createDeck({ name }), /name must be a non-empty string/);
  }
  await assert.rejects(browser.createDeck(), /name must be a non-empty string/);
  assert.deepEqual(client.calls, []);
});

test('importPackage posts the chosen file path to AnkiConnect', async () => {
  const client = fakeClient({ importPackage: () => true });
  const browser = new AnkiBrowser(client);

  assert.deepEqual(await browser.importPackage({ path: '/packages/core.apkg' }), {
    imported: true,
    path: '/packages/core.apkg',
  });
  assert.deepEqual(client.calls, [{ action: 'importPackage', params: { path: '/packages/core.apkg' } }]);
  await assert.rejects(browser.importPackage({ path: '  ' }), /path must be a non-empty string/);
  assert.equal(client.calls.length, 1);
});

test('sync asks AnkiConnect to sync and reports ok', async () => {
  const client = fakeClient({ sync: () => null });

  assert.deepEqual(await new AnkiBrowser(client).sync(), { ok: true });
  assert.deepEqual(client.calls, [{ action: 'sync', params: {} }]);
});

const PRELOAD = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload.js'), 'utf8');

test('preload exposes the Anki activity actions on window.api.anki', () => {
  for (const [method, channel] of [
    ['createDeck', 'anki:createDeck'],
    ['importPackage', 'anki:importPackage'],
    ['sync', 'anki:sync'],
  ]) {
    assert.match(PRELOAD, new RegExp(`${method}: invoke\\('${channel}'\\)`), `${method} is not exposed`);
  }
});
