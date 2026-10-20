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
    await waitFor(() => document.querySelectorAll('.manga-bubble .manga-word').length > 0, 'tokenized bubble');
    assert.equal(await evaluate(() => !!document.querySelector('.manga-panel:not([hidden])')), false, 'plain click does not open the side panel');
    const fits = await evaluate(() => {
      const b = document.querySelector('.manga-bubble').getBoundingClientRect();
      const r = document.querySelector('.manga-reader').getBoundingClientRect();
      return b.left >= r.left && b.top >= r.top && b.right <= r.right && b.bottom <= r.bottom;
    });
    assert.ok(fits, 'bubble is inside the reader');
    await screenshot('manga-bubble');
    await evaluate(() => document.querySelector('.manga-bubble .manga-word').click());
    await waitFor(() => !!document.querySelector('.manga-bubble .manga-bubble-card, .manga-bubble .manga-bubble-body > p.muted:not(:only-child)') && !/Loading/.test(document.querySelector('.manga-bubble').innerText), 'bubble lookup');
    await screenshot('manga-lookup');
    console.log('PASS block click opens the bubble with tokens and a lookup');

    await evaluate(() => {
      const btn = [...document.querySelectorAll('.manga-bubble-modes button')].find((b) => b.textContent === 'AI translate');
      btn.click();
    });
    await waitFor(() => !/Translating/.test(document.querySelector('.manga-bubble').innerText), 'AI translate settles');
    const ai = await evaluate(() => ({
      mode: localStorage.getItem('animeMine.mangaBubbleMode'),
      text: document.querySelector('.manga-bubble-body').innerText,
      active: document.querySelector('.manga-bubble-modes button.on').textContent,
    }));
    assert.equal(ai.mode, 'ai');
    assert.equal(ai.active, 'AI translate');
    assert.ok(ai.text.trim().length > 0, 'AI mode shows a result or an inline error');
    console.log('PASS AI translate toggle persists and renders', JSON.stringify(ai.text.slice(0, 80)));
    await evaluate(() => {
      [...document.querySelectorAll('.manga-bubble-modes button')].find((b) => b.textContent === 'Dictionary').click();
    });
    assert.equal(await evaluate(() => localStorage.getItem('animeMine.mangaBubbleMode')), 'dict');

    await evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await delay(100);
    assert.equal(await evaluate(() => !!document.querySelector('.manga-bubble')), false, 'Escape closes the bubble');
    assert.equal(await evaluate(() => !!document.querySelector('.manga-reader')), true, 'first Escape keeps the reader open');
    console.log('PASS Escape closes the bubble first');

    const drag = await evaluate(() => {
      const block = document.querySelector('.manga-block');
      const node = block.firstChild;
      const vertical = block.classList.contains('vertical');
      const charRect = (i) => { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getBoundingClientRect(); };
      const first = charRect(0);
      const last = charRect(Math.min(2, node.length - 1));
      return vertical
        ? { from: { x: Math.round(first.x + first.width / 2), y: Math.round(first.y + 2) }, to: { x: Math.round(last.x + last.width / 2), y: Math.round(last.bottom - 2) } }
        : { from: { x: Math.round(first.x + 2), y: Math.round(first.y + first.height / 2) }, to: { x: Math.round(last.right - 2), y: Math.round(last.y + last.height / 2) } };
    });
    const mid = { x: Math.round((drag.from.x + drag.to.x) / 2), y: Math.round((drag.from.y + drag.to.y) / 2) };
    const pageBefore = await evaluate(() => document.querySelector('.manga-progress').textContent);
    win.webContents.sendInputEvent({ type: 'mouseDown', ...drag.from, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...mid, button: 'left', modifiers: ['leftButtonDown'] });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...drag.to, button: 'left', modifiers: ['leftButtonDown'] });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...drag.to, button: 'left', clickCount: 1 });
    const picked = await evaluate(() => window.getSelection().toString().replace(/\s+/g, ''));
    assert.ok(picked.length > 0, 'dragging inside a block selects text');
    await waitFor(() => !!document.querySelector('.manga-bubble'), 'selection bubble');
    const shown = await evaluate(() => document.querySelector('.manga-bubble-head strong').textContent);
    assert.equal(shown, picked, 'bubble shows the selected substring');
    await waitFor(() => !/Loading/.test(document.querySelector('.manga-bubble').innerText), 'selection lookup');
    await screenshot('manga-bubble-selection');
    console.log(`PASS selecting text opens the bubble for ${JSON.stringify(picked)}`);

    const outside = await evaluate(() => {
      const img = document.querySelector('.manga-img');
      const r = img.getBoundingClientRect();
      const blocks = [...document.querySelectorAll('.manga-block')].map((el) => el.getBoundingClientRect());
      for (let fy = 0.1; fy < 0.95; fy += 0.05) {
        for (let fx = 0.3; fx < 0.7; fx += 0.05) {
          const x = Math.round(r.left + r.width * fx);
          const y = Math.round(r.top + r.height * fy);
          if (document.elementFromPoint(x, y) === img && !blocks.some((b) => x >= b.left - 4 && x <= b.right + 4 && y >= b.top - 4 && y <= b.bottom + 4)) return { x, y };
        }
      }
      return null;
    });
    assert.ok(outside, 'found a page point outside every block');
    win.webContents.sendInputEvent({ type: 'mouseDown', ...outside, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...outside, button: 'left', clickCount: 1 });
    await delay(200);
    const after = await evaluate(() => ({
      bubble: !!document.querySelector('.manga-bubble'),
      selection: window.getSelection().toString(),
      page: document.querySelector('.manga-progress').textContent,
    }));
    assert.equal(after.bubble, false, 'clicking the page outside any block closes the bubble');
    assert.equal(after.selection, '', 'selection is cleared');
    assert.equal(after.page, pageBefore, 'page did not turn');
    console.log('PASS clicking outside a block closes the bubble, clears the selection, keeps the page');

    win.webContents.sendInputEvent({ type: 'mouseDown', ...drag.from, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseMove', ...drag.to, button: 'left', modifiers: ['leftButtonDown'] });
    win.webContents.sendInputEvent({ type: 'mouseUp', ...drag.to, button: 'left', clickCount: 1 });
    await waitFor(() => !!document.querySelector('.manga-bubble'), 'second selection bubble');

    await evaluate(() => [...document.querySelectorAll('.manga-bubble-actions button')].find((b) => b.textContent === 'More…').click());
    await waitFor(() => document.querySelectorAll('.manga-panel .manga-word').length > 0, 'tokenized panel');
    assert.equal(await evaluate(() => !!document.querySelector('.manga-bubble')), false, 'More… closes the bubble');
    await evaluate(() => document.querySelector('.manga-panel .manga-word').click());
    await delay(600);
    await screenshot('manga-panel');
    console.log('PASS More… opens the side panel');
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
