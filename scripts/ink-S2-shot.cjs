// Manga Ink S2 screenshot + frame check.
// Run: node_modules/.bin/electron scripts/ink-S2-shot.cjs   (from the repo root; Electron binary from the install)
// Renders exploreView.mjs with test/fixtures/ink-S2-kanji.json at 1440x1000 (content starts at x=224, like the frame),
// writes /tmp/ink-S2/*.png and prints measured boxes plus a coarse pixel diff against docs/figma/manga-ink/explore-kanji.png.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, nativeImage } = require('electron');

const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const outDir = process.env.INK_S2_OUT || '/tmp/ink-S2';
const frame = { width: 1440, height: 1000, contentLeft: 224 };
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/ink-S2-kanji.json'), 'utf8'));

const css = ['styles.css', 'css/ink-theme.css', 'css/ink-kit.css', 'css/ink-explore.css']
  .map((file) => `<link rel="stylesheet" href="${pathToFileURL(path.join(root, 'src/renderer', file)).href}">`)
  .join('\n');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Ink Explore S2</title>
${css}
<style>
  html, body { width: 100%; height: 100%; margin: 0; background: #f5f2ea; }
  body { display: block; overflow: hidden; }
  #stage { position: absolute; left: 200px; top: 0; width: calc(100% - 200px); height: ${frame.height}px; }
  #stage > .ink-screen { min-height: ${frame.height}px; }
</style></head>
<body><div id="stage"></div>
<script type="module">
  import { mountExplore } from ${JSON.stringify(pathToFileURL(path.join(root, 'src/renderer/learn/exploreView.mjs')).href)};
  window.mountExplore = mountExplore;
  window.__moduleReady = true;
</script>
</body></html>`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bitmapOf(image) {
  const resized = image.resize({ width: frame.width, height: frame.height, quality: 'best' });
  return resized.getBitmap();
}

function diffAgainstFrame(actualPng) {
  const expectedPath = path.join(root, 'docs/figma/manga-ink/explore-kanji.png');
  if (!fs.existsSync(expectedPath)) return null;
  const actual = bitmapOf(nativeImage.createFromPath(actualPng));
  const expected = bitmapOf(nativeImage.createFromPath(expectedPath));
  if (actual.length !== frame.width * frame.height * 4 || expected.length !== frame.width * frame.height * 4) {
    return { error: `unexpected bitmap sizes ${actual.length}/${expected.length}` };
  }
  const out = Buffer.alloc(frame.width * frame.height * 4);
  let differing = 0;
  let compared = 0;
  let sum = 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      const i = (y * frame.width + x) * 4;
      const db = Math.abs(actual[i] - expected[i]);
      const dg = Math.abs(actual[i + 1] - expected[i + 1]);
      const dr = Math.abs(actual[i + 2] - expected[i + 2]);
      const d = Math.max(db, dg, dr);
      const lum = Math.round(((expected[i] + expected[i + 1] + expected[i + 2]) / 3) * 0.35 + 255 * 0.65);
      out[i] = x < frame.contentLeft ? lum : d > 32 ? 0 : lum;
      out[i + 1] = x < frame.contentLeft ? lum : d > 32 ? 0 : lum;
      out[i + 2] = x < frame.contentLeft ? lum : d > 32 ? 255 : lum;
      out[i + 3] = 255;
      if (x < frame.contentLeft) continue;
      compared += 1;
      sum += d;
      if (d > 32) differing += 1;
    }
  }
  const diffImage = nativeImage.createFromBitmap(out, { width: frame.width, height: frame.height });
  fs.writeFileSync(path.join(outDir, 'explore-kanji-diff.png'), diffImage.toPNG());
  return { compared, differing, pct: (100 * differing) / compared, mean: sum / compared };
}

const measureScript = `(() => {
  const box = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const style = (selector, props) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const s = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, s[p]]));
  };
  if (!document.querySelector('.ink-explore')) return null;
  const lessonPanel = box('.ink-explore-lesson');
  const upnextPanel = box('.ink-explore-upnext');
  const preview = document.querySelector('.ink-lesson-preview');
  const card = document.querySelector('.ink-lesson-card');
  return {
    hero: box('.ink-hero'),
    lessonPanel,
    upnextPanel,
    overlap: lessonPanel && upnextPanel && upnextPanel.x < lessonPanel.x + lessonPanel.w - 0.5
      ? +(lessonPanel.x + lessonPanel.w - upnextPanel.x).toFixed(1) : 0,
    lessonCard: card ? box('.ink-lesson-card') : null,
    cardOverflowX: card ? card.scrollWidth - card.clientWidth : 0,
    tag: box('.ink-lesson-tags .ink-tag'),
    stamp: box('.ink-stamp'),
    number: box('.ink-lesson-number'),
    underline: box('.ink-underline'),
    meta: box('.ink-lesson-meta'),
    preview,
    firstPreviewTile: box('.ink-preview-tile'),
    progressLabel: box('.ink-lesson-progress-label'),
    progressTrack: box('.ink-lesson-progress .ink-track'),
    start: box('.ink-explore-start'),
    upnextCard: box('.ink-upnext-card'),
    filters: box('.ink-explore-filters'),
    upnextTag: box('.ink-explore-upnext .ink-tag'),
    rows: [...document.querySelectorAll('.ink-row')].map((el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; }),
    previewOverflowX: preview ? preview.scrollWidth - preview.clientWidth : 0,
    seeAll: box('.ink-seeall'),
    chevron: box('.ink-row-chevron'),
    filterBoxes: [...document.querySelectorAll('.ink-toggle')].map((el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), w: +r.width.toFixed(2), pressed: el.getAttribute('aria-pressed') }; }),
    fonts: {
      number: style('.ink-lesson-number', ['fontFamily', 'fontWeight', 'fontSize', 'lineHeight']),
      tag: style('.ink-lesson-tags .ink-tag', ['fontSize', 'fontWeight', 'letterSpacing']),
      meta: style('.ink-lesson-meta', ['fontSize', 'fontWeight', 'lineHeight', 'color']),
      rowTitle: style('.ink-row-title', ['fontSize', 'fontWeight', 'lineHeight']),
      rowSub: style('.ink-row-sub', ['fontSize', 'fontWeight', 'lineHeight', 'color']),
      seeAll: style('.ink-seeall .ink-link', ['fontSize', 'fontWeight', 'lineHeight']),
    },
  };
})()`;

async function run() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const htmlPath = path.join(outDir, 'explore.html');
  fs.writeFileSync(htmlPath, html);

  const win = new BrowserWindow({
    width: frame.width,
    height: frame.height,
    useContentSize: true,
    show: false,
    backgroundColor: '#f5f2ea',
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });

  try {
    await win.loadFile(htmlPath);
    for (let i = 0; i < 200; i += 1) {
      const ready = await win.webContents.executeJavaScript('Boolean(window.__moduleReady)').catch(() => false);
      if (ready) break;
      await delay(25);
    }
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    await win.webContents.executeJavaScript(`(() => {
      const data = ${JSON.stringify(fixture)};
      data.lesson.start = () => {};
      data.rows.forEach((row) => { row.open = () => {}; });
      data.onFilter = () => {};
      data.seeAll.onOpen = () => {};
      window.__view = window.mountExplore(document.getElementById('stage'), data);
      return true;
    })()`);
    for (let i = 0; i < 200; i += 1) {
      const status = await win.webContents.executeJavaScript('document.fonts.status').catch(() => 'loaded');
      if (status === 'loaded') break;
      await delay(25);
    }
    await delay(200);

    const content = win.getContentSize();
    console.log(`# window content ${content[0]}x${content[1]}`);

    const boxes = await win.webContents.executeJavaScript(measureScript);
    console.log('# measured boxes (frame: panels 700/468 at x=224, card 604x712, rows 364x140)');
    console.log(JSON.stringify(boxes, null, 1));

    const image = await win.webContents.capturePage();
    const shot = image.resize({ width: frame.width, height: frame.height, quality: 'best' });
    const shotPath = path.join(outDir, 'explore-kanji-s2.png');
    fs.writeFileSync(shotPath, shot.toPNG());
    console.log(`# screenshot ${shotPath}`);

    const diff = diffAgainstFrame(shotPath);
    if (diff) {
      if (diff.error) console.log(`# diff error: ${diff.error}`);
      else {
        console.log(`# diff vs explore-kanji.png (x>=224): ${diff.pct.toFixed(1)}% pixels differ (>32), mean channel delta ${diff.mean.toFixed(1)}`);
        console.log(`# diff image ${path.join(outDir, 'explore-kanji-diff.png')}`);
      }
    }

    for (const width of [1280, 1120, 1024]) {
      win.setContentSize(width, frame.height);
      await delay(180);
      const narrow = await win.webContents.executeJavaScript(measureScript);
      const info = narrow
        ? `panels ${narrow.lessonPanel.w}x${narrow.lessonPanel.h} / ${narrow.upnextPanel.w}x${narrow.upnextPanel.h}, overlap ${narrow.overlap}, card overflow-x ${narrow.cardOverflowX}, preview overflow-x ${narrow.previewOverflowX}`
        : 'not mounted';
      console.log(`# ${width}px: ${info}`);
      if (width === 1280) {
        const narrowImage = await win.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'explore-kanji-s2-1280.png'), narrowImage.toPNG());
      }
    }
  } finally {
    win.destroy();
    app.quit();
  }
}

app.whenReady().then(run).catch((error) => {
  console.error(error?.stack ?? error);
  app.exit(1);
});
