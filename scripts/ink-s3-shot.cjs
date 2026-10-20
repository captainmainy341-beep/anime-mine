// Manga Ink S3 (Explore Kanji / Explore Vocab wiring): boot the real app with an isolated, seeded Learn store,
// open the Kanji and Vocab tabs at 1440x1000 and capture them for comparison with docs/figma/manga-ink.
// Run: node_modules/.bin/electron scripts/ink-s3-shot.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const shotDir = process.env.INK_S3_SCREENSHOTS || '/tmp/ink-s3';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-ink-s3-'));
const { buildPack } = require(path.join(root, 'src/core/studyPack'));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/study', name), 'utf8'));
const pack = buildPack({
  kanjidic: fixture('kanjidic.json'),
  kradfile: fixture('kradfile.json'),
  examples: fixture('examples.json'),
});
fs.writeFileSync(path.join(dataDir, 'study-pack.json'), JSON.stringify(pack));

// Seed real progress: learn the next batch and pass it to Guru a few times, so the Explore screens show a
// current level with a mix of learned, review and new items instead of a fresh install.
const { LearnStore } = require(path.join(root, 'src/core/learnStore'));
const seeded = new LearnStore({ dataDir, pack });
for (let round = 0; round < 8; round += 1) {
  const batch = seeded.lessonQueue({ scope: 'kanji', limit: 5 });
  if (!batch.length) break;
  seeded.completeLessons(batch.map((card) => card.id));
  for (const card of batch) {
    for (let i = 0; i < 4; i += 1) seeded.submitReview({ id: card.id, incorrectCount: 0 });
  }
}

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
  for (let i = 0; i < 120; i += 1) {
    if (await evaluate(fn)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}\n${await evaluate(() => document.querySelector('#view').innerText)}`);
}

async function tab(name) {
  await win.webContents.executeJavaScript(
    `(() => {
      const b = [...document.querySelectorAll('.learn-tabs > button')].find(b => b.textContent === ${JSON.stringify(name)});
      if (!b) throw new Error('Missing Learn tab ' + ${JSON.stringify(name)});
      b.click();
    })()`,
  );
}

async function screenshot(name) {
  fs.mkdirSync(shotDir, { recursive: true });
  await delay(250);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(shotDir, `${name}.png`), image.toPNG());
  return path.join(shotDir, `${name}.png`);
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
  await delay(300);
  await evaluate(() => {
    window.addEventListener('error', (event) => {
      window.smokeErrors ??= [];
      window.smokeErrors.push(event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
      window.smokeErrors ??= [];
      window.smokeErrors.push(String(event.reason));
    });
    document.querySelector('[data-route="learn"]').click();
  });
  await waitFor(() => !!document.querySelector('.learn-home .learn-actions'), 'Learn home');

  // Kanji tab: Explore Kanji by default (mountExplore from slice S2 receives the S3 model).
  await tab('Kanji');
  await waitFor(() => !!document.querySelector('.ink-explore'), 'Explore Kanji');
  const kanjiShot = await screenshot('explore-kanji');
  assert.equal(
    await evaluate(() => document.querySelector('.learn-tab[aria-selected="true"]')?.textContent),
    'Kanji',
    'the Kanji tab stays selected on the Explore screen',
  );
  const exploreText = await evaluate(() => document.querySelector('.ink-explore').innerText);
  assert.match(exploreText, /Explore Kanji/, 'Explore Kanji title comes from the S3 model');

  // Vocab tab: the same levels browser mounted with type 'vocab'.
  await tab('Vocab');
  await waitFor(() => !!document.querySelector('.ink-explore'), 'Explore Vocab');
  await waitFor(() => document.querySelector('.ink-explore').innerText.includes('Explore Vocab'), 'Explore Vocab title');
  const vocabShot = await screenshot('explore-vocab');
  assert.equal(
    await evaluate(() => document.querySelector('.learn-tab[aria-selected="true"]')?.textContent),
    'Vocab',
    'the Vocab tab stays selected on the Explore screen',
  );

  // Back to Kanji to prove the tabs remount correctly after the Vocab Explore.
  await tab('Kanji');
  await waitFor(() => document.querySelector('.ink-explore')?.innerText.includes('Explore Kanji'), 'Kanji Explore again');

  // "See all": the full browse (level grid, type chips, mined words) with a back link to Explore. The Explore
  // view itself belongs to slice S2, so drive mountLevels directly until its See all button lands.
  await evaluate(() => {
    const host = document.createElement('div');
    host.id = 'ink-s3-all';
    document.querySelector('#view').append(host);
    return import('./learn/browse.mjs').then(({ mountLevels }) => {
      window.__inkS3Nav = [];
      const ctx = {
        api: window.api,
        go(view, arg) {
          window.__inkS3Nav.push([view, arg ?? null]);
        },
        back() {},
        canBack: () => false,
        toast() {},
      };
      window.__inkS3All = mountLevels(host, ctx, { type: 'vocab', all: true });
    });
  });
  await waitFor(() => !!document.querySelector('#ink-s3-all .learn-level'), 'full browse level grid');
  await waitFor(
    () =>
      [...document.querySelectorAll('#ink-s3-all .learn-browse-type')].some(
        (b) => b.textContent === 'Vocabulary' && b.getAttribute('aria-pressed') === 'true',
      ),
    'Vocabulary chip selected',
  );
  assert.equal(await evaluate(() => !!document.querySelector('#ink-s3-all .learn-browse-explore')), true, 'back link to Explore');
  assert.equal(await evaluate(() => !!document.querySelector('#ink-s3-all .learn-browse-type')), true, 'type chips');
  const browseShot = await screenshot('browse-all-vocab');
  assert.equal(
    await evaluate(() => [...document.querySelectorAll('#ink-s3-all .learn-browse-type')].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent),
    'Vocabulary',
    'the See all browse opens on the Vocabulary chip',
  );
  await evaluate(() => document.querySelector('#ink-s3-all .learn-browse-explore').click());
  assert.deepEqual(
    await evaluate(() => window.__inkS3Nav),
    [['vocab', null]],
    'the back link targets the Vocab Explore screen when there is no history to pop',
  );
  await evaluate(() => {
    window.__inkS3All?.();
    document.querySelector('#ink-s3-all')?.remove();
  });

  // The Explore view itself is still the S2 stub, so exercise the S3 data shape end to end against the live
  // learn IPC: level overview, browse rows and cards in, the frozen Explore model out.
  const models = await evaluate(async () => {
    const { kanjiExplore, vocabExplore, exploreLevel } = await import('./learn/browseModel.mjs');
    const levels = await window.api.learn.levels();
    const settings = await window.api.learn.settingsGet();
    const batch = settings.lessonBatch;
    const shape = async (type) => {
      const level = exploreLevel(levels, type);
      const rows = level ? await window.api.learn.browse({ type, level: level.level }) : [];
      const cards = {};
      if (type === 'kanji') {
        for (const row of rows.slice(0, 9)) {
          try {
            cards[row.id] = await window.api.learn.card(row.id);
          } catch {
            cards[row.id] = null;
          }
        }
        return kanjiExplore({ levels, rows, cards, batch });
      }
      return vocabExplore({ levels, rows, batch });
    };
    const kanji = await shape('kanji');
    const vocab = await shape('vocab');
    return {
      kanji: {
        title: kanji.title,
        header: kanji.header.label,
        progress: kanji.progress.label,
        rows: kanji.rows.map((row) => [row.tileKind, row.status]),
        seeAll: kanji.seeAll.noun,
        lessonMeta: kanji.lesson?.meta ?? null,
        lessonKind: kanji.lesson?.previewKind ?? null,
      },
      vocab: {
        title: vocab.title,
        header: vocab.header.label,
        progress: vocab.progress.label,
        rows: vocab.rows.map((row) => [row.tileKind, row.title, row.sub, row.status]),
        seeAll: vocab.seeAll.noun,
        lessonMeta: vocab.lesson?.meta ?? null,
        lessonKind: vocab.lesson?.previewKind ?? null,
      },
    };
  });
  assert.equal(models.kanji.title, 'Explore Kanji');
  assert.match(models.kanji.header, /^\d+ OF \d+ LEARNED$/);
  assert.equal(models.kanji.progress, 'KANJI LEARNED');
  assert.ok(models.kanji.rows.every(([kind]) => kind === 'kanji'));
  assert.equal(models.kanji.seeAll, 'kanji');
  if (models.kanji.lessonMeta) {
    assert.match(models.kanji.lessonMeta, / · \d+ kanji · about \d+ min$/);
    assert.equal(models.kanji.lessonKind, 'kanji');
  }
  assert.equal(models.vocab.title, 'Explore Vocab');
  assert.match(models.vocab.header, /^\d+ OF \d+ DONE$/);
  assert.equal(models.vocab.progress, 'LESSONS DONE');
  assert.ok(models.vocab.rows.every(([kind]) => kind === 'number'));
  assert.ok(models.vocab.rows.every(([, , sub]) => /^\d+ words? · \d+ min$/.test(sub)));
  assert.equal(models.vocab.seeAll, 'lessons');
  if (models.vocab.lessonMeta) {
    assert.match(models.vocab.lessonMeta, / · \d+ words? · about \d+ min$/);
    assert.equal(models.vocab.lessonKind, 'text');
  }
  console.log(
    `PASS Explore models: ${models.kanji.header} / ${models.kanji.rows.length} kanji rows; ${models.vocab.header} / ${models.vocab.rows.length} vocab rows`,
  );

  // Keyboard tab navigation still moves Kanji -> Vocab and mounts the Vocab flavour of Explore.
  await tab('Kanji');
  await waitFor(() => document.querySelector('.ink-explore')?.innerText.includes('Explore Kanji'), 'Kanji Explore before keyboard test');
  await evaluate(() => {
    const selected = document.querySelector('.learn-tab[aria-selected="true"]');
    selected.focus();
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  await waitFor(
    () =>
      document.querySelector('.learn-tab[aria-selected="true"]')?.textContent === 'Vocab' &&
      document.querySelector('.ink-explore')?.innerText.includes('Explore Vocab'),
    'keyboard moves the Learn tab to Vocab',
  );
  console.log('PASS keyboard tab navigation: Kanji -> Vocab');

  assert.deepEqual(errors, []);
  assert.deepEqual(await evaluate(() => window.smokeErrors || []), []);
  console.log(`PASS Explore Kanji screenshot: ${kanjiShot}`);
  console.log(`PASS Explore Vocab screenshot: ${vocabShot}`);
  console.log(`PASS See all browse screenshot: ${browseShot}`);
  console.log('PASS no renderer errors');
  app.exit(0);
})().catch((err) => {
  console.error(err.stack);
  app.exit(1);
});
