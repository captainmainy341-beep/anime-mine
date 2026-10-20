// Manga Ink slice S1 (shell) screenshot check.
// Run: node_modules/.bin/electron scripts/ink-s1-shot.cjs
// Boots the real main/preload/renderer with an isolated data dir, then captures Library and Learn at 1440x1000
// into /tmp/ink-s1 (override with INK_S1_OUT). Never reads personal decks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const outDir = process.env.INK_S1_OUT || '/tmp/ink-s1';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-ink-s1-'));
const { buildPack } = require(path.join(root, 'src/core/studyPack'));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/study', name), 'utf8'));
const pack = buildPack({
  kanjidic: fixture('kanjidic.json'),
  kradfile: fixture('kradfile.json'),
  examples: fixture('examples.json'),
});
fs.writeFileSync(path.join(dataDir, 'study-pack.json'), JSON.stringify(pack));
const { LearnStore } = require(path.join(root, 'src/core/learnStore'));
const seeded = new LearnStore({ dataDir, pack, now: () => Date.now() - 24 * 3600000 });
seeded.addCustomWord({ word: '猫', kana: ['ねこ'], meanings: ['cat'] });
seeded.completeLessons(['c:猫']);

app.setPath('userData', dataDir);
const errors = [];
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_event, level, message) => {
    if (level === 3) errors.push(message);
  });
});
app.on('browser-window-created', (_, win) => win.hide());
require(path.join(root, 'src/main/main.js'));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let win;
const evaluate = (fn) => win.webContents.executeJavaScript(`(${fn.toString()})()`);

async function waitFor(fn, label) {
  for (let i = 0; i < 120; i++) {
    if (await evaluate(fn)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}

async function screenshot(name) {
  fs.mkdirSync(outDir, { recursive: true });
  await evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await delay(150);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
  console.log(`shot ${path.join(outDir, `${name}.png`)}`);
}

(async () => {
  await app.whenReady();
  for (let i = 0; i < 100 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (!win) await delay(50);
  }
  assert.ok(win, 'main created a window');
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.setContentSize(1440, 1000);
  await delay(300);
  await evaluate(() => document.fonts.ready.then(() => true));

  await waitFor(() => !!document.querySelector('#nav button.active'), 'Library route');
  await screenshot('library');
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 100, y: 310 });
  await delay(120);
  await screenshot('library-hover');
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 1000, y: 900 });

  const nav = await evaluate(() => {
    const strip = document.querySelector('.topbar');
    const brand = document.querySelector('.brand');
    const brandAfter = getComputedStyle(brand, '::after');
    const items = [...document.querySelectorAll('#nav button')].map((button) => {
      const box = button.getBoundingClientRect();
      const en = button.querySelector('.nav-en').getBoundingClientRect();
      const ja = button.querySelector('.nav-ja').getBoundingClientRect();
      return {
        route: button.dataset.route,
        y: Math.round(box.top),
        h: Math.round(box.height),
        w: Math.round(box.width),
        enX: Math.round(en.left),
        enY: Math.round(en.top),
        jaX: Math.round(ja.left),
      };
    });
    const brandBox = brand.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(brand);
    const line1 = document.createRange();
    line1.setStart(brand.firstChild, 0);
    line1.setEnd(brand.firstChild, brand.firstChild.textContent.length);
    const line1Box = line1.getBoundingClientRect();
    return {
      stripWidth: Math.round(strip.getBoundingClientRect().width),
      brandX: Math.round(line1Box.left),
      brandY: Math.round(brandBox.top),
      markW: brandAfter.width,
      markH: brandAfter.height,
      markTop: Math.round(brandBox.top + brandBox.height - parseFloat(brandAfter.height)),
      items,
    };
  });
  console.log(JSON.stringify(nav, null, 2));
  assert.equal(nav.stripWidth, 200, 'nav strip is 200px');
  assert.equal(nav.brandX, 28, 'brand starts at x=28');
  assert.equal(nav.brandY, 32, 'brand starts at y=32');
  assert.equal(nav.markW, '40px', 'mark is 40px wide');
  assert.equal(nav.markH, '3px', 'mark is 3px tall');
  assert.equal(nav.markTop, 118, 'mark sits at y=118');
  assert.deepEqual(
    nav.items.map((item) => item.y),
    [172, 230, 288, 346, 404, 462],
    'nav items step by 58px from y=172',
  );
  assert.deepEqual(nav.items.map((item) => item.enY), [181, 239, 297, 355, 413, 471], 'EN line boxes start at the frame rows');
  assert.deepEqual(nav.items.map((item) => item.w), [200, 200, 200, 200, 200, 200], 'active bar is full width');
  assert.deepEqual(nav.items.map((item) => item.enX), [28, 28, 28, 28, 28, 28], 'EN labels at x=28');
  assert.deepEqual(nav.items.map((item) => item.jaX), [132, 132, 132, 132, 132, 132], 'JA labels at x=132');

  await evaluate(() => document.querySelector('[data-route="learn"]').click());
  await waitFor(() => !!document.querySelector('.learn-shell-nav .learn-tab'), 'Learn shell tabs');
  await waitFor(() => !!document.querySelector('.learn-home, .learn-level, .learn-view .learn-card'), 'Learn content');
  await screenshot('learn-home');

  const strip = await evaluate(() => {
    const el = document.querySelector('.learn-shell-nav');
    const box = el.getBoundingClientRect();
    const tabs = [...el.querySelectorAll('.learn-tab')].map((tab) => {
      const rect = tab.getBoundingClientRect();
      return { label: tab.textContent, x: Math.round(rect.left), w: Math.round(rect.width), selected: tab.getAttribute('aria-selected') };
    });
    return { y: Math.round(box.top), h: Math.round(box.height), x: Math.round(box.left), tabs, headHidden: getComputedStyle(document.querySelector('.learn-head')).display };
  });
  console.log(JSON.stringify(strip, null, 2));
  assert.equal(strip.headHidden, 'none', '.learn-head is hidden');
  assert.ok(Math.abs(strip.h - 40) <= 1, 'tab strip is about 40px');
  assert.ok(strip.tabs.length >= 6, 'tabs render');

  await evaluate(() => [...document.querySelectorAll('.learn-tab')].find((tab) => tab.textContent === 'Kanji').click());
  await waitFor(() => !!document.querySelector('.learn-view'), 'Kanji view');
  await screenshot('learn-kanji');

  // Hook check: a mounted .ink-screen.ink-explore must drop the page padding and keep the strip gutters.
  const explore = await evaluate(() => {
    const view = document.querySelector('.learn-view');
    const section = document.createElement('section');
    section.className = 'ink-screen ink-explore';
    const stub = document.createElement('div');
    stub.style.cssText = 'height:110px;border:3px solid #0a0a0a;background:#0a0a0a';
    section.append(stub);
    view.replaceChildren(section);
    const page = document.querySelector('.page.learn');
    const pageBox = page.getBoundingClientRect();
    const screen = section.getBoundingClientRect();
    const stubBox = stub.getBoundingClientRect();
    const stripBox = document.querySelector('.learn-shell-nav').getBoundingClientRect();
    const styles = getComputedStyle(page);
    return {
      pagePadding: [styles.paddingTop, styles.paddingRight, styles.paddingBottom, styles.paddingLeft].join(' '),
      pageLeft: Math.round(pageBox.left),
      screenLeft: Math.round(screen.left),
      screenTop: Math.round(screen.top),
      headerX: Math.round(stubBox.left),
      headerY: Math.round(stubBox.top),
      stripY: Math.round(stripBox.top),
    };
  });
  console.log(JSON.stringify({ explore }, null, 2));
  assert.equal(explore.pagePadding, '0px 0px 0px 0px', 'Explore drops the page padding');
  assert.equal(explore.pageLeft, 200, 'page starts after the 200px nav');
  assert.equal(explore.screenLeft, 200, 'ink-screen is full-bleed');
  assert.equal(explore.headerX, 224, 'Explore header keeps the 24px gutter');
  assert.equal(explore.stripY, 28, 'strip stays at y=28 like the other Learn views');
  assert.equal(explore.headerY, 96, 'Explore header sits below the strip');
  await screenshot('learn-explore-hook');

  assert.deepEqual(errors, []);
  assert.deepEqual(await evaluate(() => window.smokeErrors || []), []);
  console.log('PASS shell nav and Learn strip');
  app.exit(0);
})().catch((err) => {
  console.error(err.stack);
  app.exit(1);
});
