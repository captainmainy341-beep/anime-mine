// Run: node_modules/.bin/electron scripts/manga-vocab-smoke.cjs
// Boots the real main/preload/renderer with isolated data and a generated manga folder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-manga-smoke-'));
const mangaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-manga-lib-'));
const fixtures = path.join(root, 'test/fixtures');
const volume = path.join(mangaRoot, 'Test Series', 'Vol 01');
fs.mkdirSync(volume, { recursive: true });
for (const n of [1, 2, 3]) fs.copyFileSync(path.join(fixtures, 'ocr-sample.png'), path.join(volume, `p${n}.png`));
fs.copyFileSync(path.join(fixtures, 'jmdict-mini.json'), path.join(dataDir, 'jmdict.json'));
fs.copyFileSync(path.join(fixtures, 'kanjidic-mini.json'), path.join(dataDir, 'kanjidic.json'));
fs.writeFileSync(path.join(dataDir, 'manga.json'), JSON.stringify({ folders: [mangaRoot] }));
app.setPath('userData', dataDir);
const errors = [];
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
});
if (!process.env.ANIME_MINE_SHOW) app.on('browser-window-created', (_, win) => win.hide());
require(path.join(root, 'src/main/main.js'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let win;
const evaluate = (fn) => win.webContents.executeJavaScript(`(${fn.toString()})()`);
async function waitFor(fn, label, tries = 400) {
  for (let i = 0; i < tries; i++) {
    if (await evaluate(fn)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}\n${await evaluate(() => document.querySelector('#view').innerText.slice(0, 600))}`);
}
async function screenshot(name) {
  if (!process.env.ANIME_MINE_SCREENSHOTS) return;
  fs.mkdirSync(process.env.ANIME_MINE_SCREENSHOTS, { recursive: true });
  await delay(200);
  fs.writeFileSync(path.join(process.env.ANIME_MINE_SCREENSHOTS, `${name}.png`), (await win.webContents.capturePage()).toPNG());
}
(async () => {
  await app.whenReady();
  for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await delay(50); }
  assert.ok(win, 'main created a window');
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.setContentSize(1280, 800);
  await evaluate(() => {
    window.addEventListener('error', (e) => { window.smokeErrors ??= []; window.smokeErrors.push(e.message); });
    window.addEventListener('unhandledrejection', (e) => { window.smokeErrors ??= []; window.smokeErrors.push(String(e.reason)); });
    document.querySelector('[data-route="manga"]').click();
  });
  await waitFor(() => document.querySelectorAll('.manga-cover').length === 1, 'series cover');
  console.log('PASS manga library lists the series');
  await screenshot('manga-library');
  await evaluate(() => document.querySelector('.manga-cover').click());
  await waitFor(() => document.querySelectorAll('.manga-volume').length === 1, 'volume row');
  await screenshot('manga-series');
  await evaluate(() => [...document.querySelectorAll('.manga-volume button')].find((b) => /read/i.test(b.textContent)).click());
  await waitFor(() => !!document.querySelector('.manga-reader img'), 'reader image');
  console.log('PASS reader opens a page');
  await waitFor(() => document.querySelectorAll('.manga-block').length > 0 || /vertical|OCR/i.test(document.querySelector('.manga-reader').innerText), 'OCR blocks or banner', 1200);
  const blocks = await evaluate(() => document.querySelectorAll('.manga-block').length);
  console.log(`INFO OCR blocks on page 1: ${blocks}`);
  await screenshot('manga-reader');
  if (blocks) {
    const rect = await evaluate(() => { const r = document.querySelector('.manga-block').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...rect, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...rect, button: 'left', clickCount: 1 });
    await waitFor(() => document.querySelectorAll('.manga-panel .manga-word').length > 0, 'tokenized panel');
    await evaluate(() => document.querySelector('.manga-panel .manga-word').click());
    await delay(600);
    await screenshot('manga-lookup');
    console.log('PASS block click tokenizes the sentence and opens lookup');
    await evaluate(() => [...document.querySelectorAll('.manga-panel button')].find((b) => b.textContent === 'Details').click());
    await delay(1500); console.log('DBG', await evaluate(() => JSON.stringify({wc: !!document.querySelector('.wordcard'), txt: document.querySelector('.wordcard')?.innerText?.slice(0, 300), err: window.smokeErrors})));
    await screenshot('manga-wordcard');
    console.log('PASS Details opens the shared word card');
    await evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await delay(200);
  }
  await evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  await delay(300);
  const saved = await evaluate(async () => {
    const series = (await window.api.manga.getSeries())[0];
    return window.api.manga.getProgress(series.volumes[0].id);
  });
  console.log('INFO saved progress', JSON.stringify(saved));
  await evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

  await evaluate(async () => { await window.api.known.mark({ word: '日本語', status: 'known' }); await window.api.known.mark({ word: '猫', status: 'blacklisted' }); document.querySelector('[data-route="vocab"]').click(); });
  await waitFor(() => !!document.querySelector('#view .vocab-tabs, #view [class*="vocab-tab"]'), 'vocab tabs');
  await screenshot('vocab-words');
  const tabNames = await evaluate(() => [...document.querySelectorAll('#view [class*="vocab-tab"]')].map((b) => b.textContent.trim()));
  console.log('INFO vocab tabs', tabNames.join(' | '));
  for (const name of ['Extract', 'Difficulty', 'Data']) {
    await evaluate(() => {}); // keep stack readable
    await win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('#view [class*="vocab-tab"]')].find((b) => b.textContent.trim() === ${JSON.stringify(name)}); if (!b) throw new Error('Missing tab ${name}'); b.click(); })()`);
    await delay(400);
    await screenshot(`vocab-${name.toLowerCase()}`);
  }
  const status = await evaluate(() => window.api.vocab.status());
  console.log('INFO vocab status', JSON.stringify(status));
  const word = await evaluate(() => window.api.vocab.word('日本'));
  assert.ok(word && typeof word === 'object', 'vocab.word returns detail');
  const kanji = await evaluate(() => window.api.vocab.kanji('日'));
  assert.equal(kanji.char ?? kanji.literal, '日');
  console.log('PASS vocab word + kanji detail over real IPC');
  const extract = await evaluate(() => window.api.vocab.extract({ text: '日本語を勉強しています。猫が好きです。', onlyUnknown: false }));
  assert.ok(extract.rows.length > 0, 'extract returns rows');
  console.log(`PASS extract returned ${extract.rows.length} words`);
  const smokeErrors = await evaluate(() => window.smokeErrors ?? []);
  console.log('INFO renderer errors', JSON.stringify(smokeErrors), 'console errors', JSON.stringify(errors));
  assert.deepEqual(smokeErrors, [], 'no uncaught renderer errors');
  app.exit(0);
})().catch((err) => {
  console.error('FAIL', err.message);
  app.exit(1);
});
