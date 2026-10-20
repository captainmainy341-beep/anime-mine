// Run: node_modules/.bin/electron scripts/ink-S4-shot.cjs
// Screenshots Explore Grammar (and the existing grammar course behind See all) at 1440x1000 into /tmp/ink-grammar/.
// Boots the real main/preload/renderer with an isolated data dir; never reads personal decks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-ink-grammar-'));
const outDir = process.env.INK_SHOT_DIR || path.join('/tmp', 'ink-grammar');
fs.mkdirSync(outDir, { recursive: true });

const { buildPack } = require(path.join(root, 'src/core/studyPack'));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/study', name), 'utf8'));
const pack = buildPack({
  kanjidic: fixture('kanjidic.json'),
  kradfile: fixture('kradfile.json'),
  examples: fixture('examples.json'),
});
fs.writeFileSync(path.join(dataDir, 'study-pack.json'), JSON.stringify(pack));

// Seed two finished lessons of three patterns so the frame's "2 OF N DONE" state shows.
const grammar = require(path.join(root, 'src/core/grammar')).loadGrammar();
const { LearnStore } = require(path.join(root, 'src/core/learnStore'));
const seeded = new LearnStore({ dataDir, pack, grammar });
seeded.settingsSet({ lessonBatch: 3 });
const firstSix = seeded.browse({ type: 'grammar', jlpt: 'N5' }).slice(0, 6).map((row) => row.id);
seeded.completeLessons(firstSix);

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
  for (let i = 0; i < 160; i += 1) {
    if (await evaluate(fn)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}\n${await evaluate(() => document.querySelector('#view').innerText)}`);
}

async function screenshot(name) {
  await delay(200);
  const image = await win.webContents.capturePage();
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log(`shot ${file}`);
}

async function tab(name) {
  await win.webContents.executeJavaScript(`(() => {
    const b = [...document.querySelectorAll('.learn-tabs > button')].find((el) => el.textContent === ${JSON.stringify(name)});
    if (!b) throw new Error('Missing Learn tab');
    b.click();
  })()`);
}

(async () => {
  await app.whenReady();
  for (let i = 0; i < 100 && !win; i += 1) {
    win = BrowserWindow.getAllWindows()[0];
    if (!win) await delay(50);
  }
  assert.ok(win, 'main created a window');
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.setContentSize(1440, 1000);
  await delay(250);

  await evaluate(() => {
    window.addEventListener('error', (event) => {
      window.shotErrors ??= [];
      window.shotErrors.push(event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.shotErrors ??= [];
      window.shotErrors.push(String(event.reason));
    });
    document.querySelector('[data-route="learn"]').click();
  });
  await waitFor(() => !!document.querySelector('.learn-tabs'), 'Learn tabs');
  await tab('Grammar');
  await waitFor(() => !!document.querySelector('.ink-explore .ink-lesson-card'), 'Explore Grammar lesson card');
  assert.ok(await evaluate(() => !!document.querySelector('.ink-explore .ink-bigbtn.ink-explore-start')), 'Start button exists');
  await screenshot('explore-grammar');

  await evaluate(() => document.querySelector('.ink-seeall').click());
  await waitFor(() => !!document.querySelector('.learn-g.course .learn-g-row'), 'grammar course after See all');
  assert.ok(await evaluate(() => !!document.querySelector('.learn-g-back')), 'course has a back link to Explore');
  await screenshot('explore-grammar-all');

  await evaluate(() => document.querySelector('.learn-g-back').click());
  await waitFor(() => !!document.querySelector('.ink-explore .ink-lesson-card'), 'Explore Grammar after back');
  assert.deepEqual(errors, []);
  assert.deepEqual(await evaluate(() => window.shotErrors || []), []);
  console.log('PASS Explore Grammar, See all course and back link');
  app.exit(0);
})().catch(async (err) => {
  console.error(err);
  if (win) console.error(await evaluate(() => document.querySelector('#view')?.innerText ?? ''));
  app.exit(1);
});
