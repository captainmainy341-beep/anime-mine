// Run: node_modules/.bin/electron scripts/ink-s8-shot.cjs
// Boots the real main/preload/renderer with isolated data, stubs only the Anki IPC the redesign needs
// (S7's reviewsByDay / deck actions are owned by another slice), screenshots the two S8 frames and
// prints the measured layout so it can be compared with docs/figma/manga-ink/*.json.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const outDir = process.env.ANIME_MINE_SCREENSHOTS || '/tmp/ink-s8';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-ink-s8-'));
app.setPath('userData', dataDir);

const DAY = 24 * 60 * 60 * 1000;
const today = new Date();
today.setHours(0, 0, 0, 0);
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const reviewsByDay = [];
for (let back = 364; back >= 0; back -= 1) {
  const date = new Date(today.getTime() - back * DAY);
  const weekday = date.getDay();
  const seed = (date.getDate() * 7 + date.getMonth() * 13) % 11;
  const streak = back < 14;
  if (streak || (weekday !== 0 && seed > 2) || seed > 8) {
    const count = streak ? 18 + (seed % 30) : Math.max(1, seed * 3 + (weekday % 3));
    reviewsByDay.push({ date: iso(date), count });
  }
}

const decks = [
  { name: 'Mining', new: 20, learn: 6, due: 60, total: 412 },
  { name: 'Genki I', new: 8, learn: 3, due: 13, total: 216 },
  { name: 'Kanji N5', new: 5, learn: 0, due: 4, total: 80 },
  { name: 'Sentences', new: 10, learn: 2, due: 19, total: 540 },
  { name: 'Default', new: 0, learn: 0, due: 0, total: 0 },
];
const overview = {
  mode: 'sample',
  decks,
  today: { studied: 0, due: 86, learning: 6, new: 20 },
  forecast: Array.from({ length: 22 }, (_, day) => ({ day, count: (day * 7) % 23 })),
  retention30: 91,
  streak: 14,
  minedThisWeek: 7,
  mined: [],
  reviewsByDay,
};

const cards = [
  {
    id: 1,
    deck: 'Mining',
    question: '<div class="wrap"><div class="sent-center"><div class="jpsentence">本当に大丈夫なの？</div></div></div>',
    answer: '<div class="wrap"><div class="sent-center"><div class="jpsentence">本当に大丈夫なの？</div></div></div>',
    css: '',
    audio: null,
    sentence: '本当に大丈夫なの？',
    intervals: ['<1m', '6m', '3d', '5d'],
  },
  {
    id: 2,
    deck: 'Mining',
    question: '<div class="wrap"><div class="sent-center"><div class="jpsentence">猫が好きです。</div></div></div>',
    answer: '<div class="wrap"><div class="sent-center"><div class="jpsentence">猫が好きです。</div></div></div>',
    css: '',
    audio: null,
    sentence: '猫が好きです。',
    intervals: ['<1m', '10m', '4d', '6d'],
  },
];

function stubHandlers() {
  const replace = (channel, handler) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => handler());
  };
  replace('anki:getView', () => ({ mode: 'live', connected: true, visibleDecks: ['Mining', 'Genki I'] }));
  replace('anki:setView', () => ({ ok: true }));
  replace('anki:overview', () => ({ ...overview, mode: 'live' }));
  replace('anki:studyQueue', () => ({ cards, remaining: { new: 20, reviews: 60, learning: 6 } }));
  replace('anki:studyAnswer', () => ({ ok: true }));
  replace('anki:media', () => null);
}

app.on('browser-window-created', (_, win) => win.hide());
require(path.join(root, 'src/main/main.js'));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let win;
const evaluate = (fn) => win.webContents.executeJavaScript(`(${fn.toString()})()`);

async function waitFor(fn, label) {
  for (let i = 0; i < 160; i += 1) {
    if (await evaluate(fn)) return;
    await delay(50);
  }
  const text = await evaluate(() => document.querySelector('#view')?.innerText);
  throw new Error(`Timed out: ${label}\n${text}`);
}

async function screenshot(name) {
  fs.mkdirSync(outDir, { recursive: true });
  await delay(250);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
  return path.join(outDir, `${name}.png`);
}


async function measureDetails() {
  return evaluate(() => {
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const rel = (selector, panelSelector) => {
      const el = document.querySelector(selector);
      const panel = document.querySelector(panelSelector);
      if (!el || !panel) return null;
      const r = el.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      return { dx: Math.round(r.x - p.x), dy: Math.round(r.y - p.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      deckTag: rel('.ink-anki-decks .ink-tag', '.ink-anki-decks'),
      deckTable: rel('.ink-deck-table', '.ink-anki-decks'),
      deckActions: rel('.ink-anki-actions', '.ink-anki-decks'),
      deckButtons: [...document.querySelectorAll('.ink-anki-actions .ink-anki-btn')].map((b) => Math.round(b.getBoundingClientRect().width)),
      title: rel('.ink-anki-glance-title', '.ink-anki-glance'),
      underline: rel('.ink-anki-glance-underline', '.ink-anki-glance'),
      sub: rel('.ink-anki-glance-sub', '.ink-anki-glance'),
      stats: rel('.ink-anki-stats', '.ink-anki-glance'),
      stat: box('.ink-anki-stat'),
      done: rel('.ink-anki-done', '.ink-anki-glance'),
      doneTrack: rel('.ink-anki-done-track', '.ink-anki-glance'),
      studyNow: rel('.ink-anki-studynow', '.ink-anki-glance'),
      heatTag: rel('.ink-anki-heat .ink-tag', '.ink-anki-heat'),
      heatRange: rel('.ink-anki-heat-range', '.ink-anki-heat'),
      heatMonths: rel('.ink-heat-months', '.ink-anki-heat'),
      heatGrid: rel('.ink-heat-grid', '.ink-anki-heat'),
      heatStats: rel('.ink-heat-stats', '.ink-anki-heat'),
      heatLegend: rel('.ink-heat-legend', '.ink-anki-heat'),
      heatNote: rel('.ink-heat-note', '.ink-anki-heat'),
      heatMonthLabels: [...document.querySelectorAll('.ink-heat-month')].map((m) => ({ label: m.textContent, left: Math.round(m.getBoundingClientRect().x - document.querySelector('.ink-heat-grid').getBoundingClientRect().x) })),
    };
  });
}

async function measureOverview() {
  const panels = await evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const cells = [...document.querySelectorAll('.ink-heat-cell')];
    const first = cells[0].getBoundingClientRect();
    const nextCol = cells[7].getBoundingClientRect();
    const nextRow = cells[1].getBoundingClientRect();
    return {
      decks: rect(document.querySelector('.ink-anki-decks')),
      glance: rect(document.querySelector('.ink-anki-glance')),
      heat: rect(document.querySelector('.ink-anki-heat')),
      cell: { w: Math.round(first.width), h: Math.round(first.height), pitchX: Math.round(nextCol.x - first.x), pitchY: Math.round(nextRow.y - first.y) },
      cells: cells.length,
      today: document.querySelectorAll('.ink-heat-cell.is-today').length,
      selected: document.querySelectorAll('.ink-deck-row.is-selected').length,
      rows: document.querySelectorAll('.ink-deck-row').length,
      header: document.querySelector('.ink-hero-label')?.textContent,
      scrolled: (() => { const s = document.querySelector('.ink-heat-scroll'); return { left: s.scrollLeft, max: s.scrollWidth - s.clientWidth }; })(),
    };
  });
  return panels;
}

(async () => {
  await app.whenReady();
  for (let i = 0; i < 200 && !win; i += 1) {
    win = BrowserWindow.getAllWindows()[0];
    if (!win) await delay(50);
  }
  assert.ok(win, 'main created a window');
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const [width, height] = (process.env.ANIME_MINE_WINDOW_SIZE || '1440,1000').split(',').map(Number);
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
  win.setContentSize(width, height);
  await delay(350);
  const viewport = await evaluate(() => ({ w: innerWidth, h: innerHeight }));
  console.log('viewport', viewport);
  stubHandlers();

  await evaluate(new Function('window.addEventListener("error", (event) => { window.__inkErrors ??= []; window.__inkErrors.push(event.message); }); window.addEventListener("unhandledrejection", (event) => { window.__inkErrors ??= []; window.__inkErrors.push(String(event.reason)); });'));
  await evaluate(new Function('document.querySelector("[data-route=anki]").click()'));
  await waitFor(() => !!document.querySelector('.ink-anki-decks'), 'Anki overview');
  await waitFor(() => document.querySelector('.ink-heat-cell.is-today'), 'heatmap today cell');

  const overviewPath = await screenshot('anki-clean');
  const measured = await measureOverview();
  console.log('overview', JSON.stringify(measured, null, 2));
  console.log('details', JSON.stringify(await measureDetails(), null, 2));
  assert.equal(measured.rows, 5, 'five sample decks');
  assert.equal(measured.selected, 1, 'one selected deck row');
  assert.equal(measured.cells, 371, '53 weeks x 7 days');
  assert.equal(measured.today, 1, 'today is flagged once');
  assert.equal(measured.cell.w, 17);
  assert.equal(measured.cell.pitchX, 21);
  assert.ok(measured.scrolled.left > 0 && measured.scrolled.left === measured.scrolled.max, 'heatmap scrolled to today');
  assert.match(measured.header ?? '', /due today of/i);

  // Kebab menu, inline create-deck form, guarded S7 actions.
  await evaluate(new Function('document.querySelector(".ink-deck-row .ink-deck-more").click()'));
  const menu = await evaluate(() => {
    const menuEl = document.querySelector('.ink-deck-menu');
    return menuEl ? { items: [...menuEl.querySelectorAll('.ink-deck-menu-item')].map((b) => b.textContent), expanded: document.querySelector('.ink-deck-more').getAttribute('aria-expanded') } : null;
  });
  console.log('deck menu', JSON.stringify(menu));
  assert.deepEqual(menu.items, ['Study', 'Options', 'Browse']);
  assert.equal(menu.expanded, 'true');
  await evaluate(new Function('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))'));
  assert.equal(await evaluate(() => !!document.querySelector('.ink-deck-menu')), false, 'Escape closes the menu');

  await evaluate(new Function('document.querySelector(".ink-anki-actions .ink-anki-btn").click()'));
  await waitFor(() => !!document.querySelector('.ink-anki-actions.is-form input'), 'inline create deck form');
  await evaluate(new Function('(() => { const input = document.querySelector(".ink-anki-actions.is-form input"); input.value = "Test deck"; document.querySelector(".ink-anki-actions.is-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); })()'));
  await delay(250);
  const createToast = await evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  console.log('guarded create toast', createToast);
  assert.match(createToast, /Anki service/);
  await evaluate(new Function('[...document.querySelectorAll(".ink-anki-btn")].find((b) => b.textContent === "Cancel").click()'));
  await waitFor(() => !!document.querySelector('.ink-anki-actions .ink-anki-btn'), 'deck actions restored');

  // Browse and deck options keep working on the clean look.
  await evaluate(new Function('[...document.querySelectorAll(".ink-anki-tab")].find((b) => b.textContent === "Browse").click()'));
  await waitFor(() => !!document.querySelector('.bw'), 'browse tab');
  await evaluate(new Function('document.querySelectorAll(".toast").forEach((t) => t.remove())'));
  const browsePath = await screenshot('anki-browse');
  await evaluate(new Function('[...document.querySelectorAll(".ink-anki-tab")].find((b) => b.textContent === "Deck options").click()'));
  await waitFor(() => !!document.querySelector('.anki-options-split'), 'deck options tab');
  const optionsPath = await screenshot('anki-deck-options');
  await evaluate(new Function('[...document.querySelectorAll(".ink-anki-tab")].find((b) => b.textContent === "Overview").click()'));
  await waitFor(() => !!document.querySelector('.ink-anki-decks'), 'overview restored');

  // Study tab (card screen). S9 owns createStudyCardView; the stub still exercises the S8 wiring.
  await evaluate(new Function('[...document.querySelectorAll(".ink-anki-tab")].find((b) => b.textContent === "Study").click()'));
  await waitFor(() => !!document.querySelector('.study-start'), 'study tab');
  const hasStart = await evaluate(() => !!document.querySelector('.study-start .primary'));
  if (hasStart) await evaluate(new Function('document.querySelector(".study-start .primary").click()'));
  await waitFor(() => !!document.querySelector('.ink-anki-study-view'), 'study card view');
  const studyPath = await screenshot('anki-card-clean');
  const header = await evaluate(() => document.querySelector('.ink-hero-label')?.textContent);
  const title = await evaluate(() => document.querySelector('.ink-hero-title')?.textContent);
  const studyState = await evaluate(() => ({
    side: document.querySelector('.ink-anki-study-meta')?.textContent,
    actions: [...document.querySelectorAll('.ink-anki-chip')].map((b) => ({ label: b.textContent, hidden: b.hidden, disabled: b.disabled })),
  }));
  console.log('study', JSON.stringify({ header, title, studyState }, null, 2));
  assert.match(header ?? '', /Card 1 of 2 · Mining/i);
  assert.equal(title, 'Review');
  assert.equal(studyState.actions.find((b) => b.label === 'Grammar')?.hidden, true, 'grammar is hidden on the front');
  await evaluate(new Function('[...document.querySelectorAll(".ink-anki-tab")].find((b) => b.textContent === "Overview").click()'));
  await waitFor(() => !!document.querySelector('.ink-anki-decks'), 'back to overview');
  const interactions = await evaluate(() => {
    document.querySelector('.ink-deck-row:nth-child(2) .ink-deck-pick').click();
    return { selectedDeckTitle: document.querySelector('.ink-anki-glance-title').textContent };
  });
  console.log('interactions', interactions);
  assert.equal(interactions.selectedDeckTitle, 'Genki I', 'clicking a row selects that deck');

  const pageErrors = await evaluate(() => window.__inkErrors ?? []);
  console.log('screenshots', JSON.stringify({ overviewPath, browsePath, optionsPath, studyPath }));
  if (pageErrors.length) throw new Error(`renderer errors: ${pageErrors.join('\n')}`);
  console.log('OK');
  app.quit();
})().catch((err) => {
  console.error(err);
  app.exit(1);
});
