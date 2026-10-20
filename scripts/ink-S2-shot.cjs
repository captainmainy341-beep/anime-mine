// Manga Ink S2 screenshot + frame + viewport check.
// Run: node_modules/.bin/electron scripts/ink-S2-shot.cjs   (from the repo root; Electron binary from the install)
//
// Scenarios:
//   frame  - the Figma frame itself (1440x1000, no Learn strip), pixel-diffed against explore-kanji.png.
//   shell  - the same screen inside the app's Learn shell: .page.learn > .learn-shell-nav (40px + 28px top margin,
//            from S1's ink-theme.css) > .ink-screen. Verified at 1440x1000 and 1440x900, with and without a lesson.
//            Every scenario must fit the viewport with no page scroll: hero, both panels, Start and See all.
// Writes /tmp/ink-S2/*.png and exits 1 when a check fails.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, nativeImage } = require('electron');

const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const outDir = process.env.INK_S2_OUT || '/tmp/ink-S2';
const frame = { width: 1440, height: 1000, contentLeft: 224 };
const STRIP_HEIGHT = 40;
const STRIP_MARGIN = 28;
const PANEL_MAX = 808;
const PANEL_MIN = 620;
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/ink-S2-kanji.json'), 'utf8'));

const css = ['styles.css', 'css/ink-theme.css', 'css/ink-kit.css', 'css/ink-explore.css']
  .map((file) => `<link rel="stylesheet" href="${pathToFileURL(path.join(root, 'src/renderer', file)).href}">`)
  .join('\n');

// Mirrors S1 ink-theme.css: .page.learn:has(.ink-explore) { padding: 0 }, .learn-shell-nav { height: 40px; margin: 28px 0 0 }.
const shellCss = `
  html, body { width: 100%; height: 100%; margin: 0; background: #f5f2ea; }
  body { display: flex; flex-direction: row; overflow: hidden; }
  #view { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
  .page.learn { flex: 1; min-height: 0; overflow: auto; padding: 0; }
  .learn-shell-nav {
    display: flex; align-items: center; height: ${STRIP_HEIGHT}px; margin: ${STRIP_MARGIN}px 0 0;
    padding: 0 32px 0 24px; border: 0; background: none;
  }
  .learn-tabs { display: flex; flex-wrap: nowrap; align-items: stretch; gap: 24px; height: 100%; margin: 0; padding: 0; border: 0; }
  .learn-tab {
    display: inline-flex; align-items: center; height: 100%; margin: 0; padding: 0; border: 0; background: none;
    color: #5c5a55; font-family: var(--font); font-size: 12px; font-weight: 700; line-height: 1;
    letter-spacing: 1.5px; text-transform: uppercase; white-space: nowrap;
  }
  .learn-tab[aria-selected='true'] { color: var(--ink); }
  .learn-body { min-width: 0; }
  #stage { width: 100%; }
`;

const tabs = ['Home', 'Kanji', 'Vocab', 'Grammar', 'Story', 'Stats', 'Settings']
  .map((label, index) => `<button class="learn-tab" type="button" aria-selected="${index === 1 ? 'true' : 'false'}">${label}</button>`)
  .join('');

const shellMarkup = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Ink Explore S2 shell</title>
${css}
<style>${shellCss}</style></head>
<body><div id="view"><section class="page learn">
  <header class="learn-shell-nav"><nav class="learn-tabs" role="tablist" aria-label="Learn sections">${tabs}</nav></header>
  <div class="learn-body"><div id="stage"></div></div>
</section></div>
<script type="module">
  import { mountExplore } from ${JSON.stringify(pathToFileURL(path.join(root, 'src/renderer/learn/exploreView.mjs')).href)};
  window.mountExplore = mountExplore;
  window.__moduleReady = true;
</script>
</body></html>`;

const frameMarkup = `<!doctype html>
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
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +(r.y + r.height).toFixed(1), right: +(r.x + r.width).toFixed(1) };
  };
  const style = (selector, props) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const s = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, s[p]]));
  };
  if (!document.querySelector('.ink-explore')) return null;
  const scroller = document.querySelector('.page') || document.documentElement;
  const lessonPanel = box('.ink-explore-lesson');
  const upnextPanel = box('.ink-explore-upnext');
  const preview = document.querySelector('.ink-lesson-preview');
  const card = document.querySelector('.ink-lesson-card');
  const stripEl = document.querySelector('.learn-shell-nav');
  const stripStyle = stripEl ? getComputedStyle(stripEl) : null;
  return {
    viewport: { w: innerWidth, h: innerHeight },
    scroller: {
      scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight,
      scrollTop: scroller.scrollTop, overflowY: getComputedStyle(scroller).overflowY,
    },
    strip: stripEl ? { ...box('.learn-shell-nav'), marginTop: stripStyle.marginTop, marginBottom: stripStyle.marginBottom } : null,
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
    numberText: document.querySelector('.ink-lesson-card.is-empty .ink-lesson-number')?.textContent ?? null,
    numberFont: style('.ink-lesson-number', ['fontFamily', 'fontWeight', 'fontSize', 'lineHeight']),
    emptyCopy: box('.ink-lesson-empty-text'),
    emptyCopyFont: style('.ink-lesson-empty-text', ['fontSize', 'fontWeight', 'lineHeight', 'color']),
    emptyAction: box('.ink-empty-action'),
    emptyActionStyle: style('.ink-empty-action', ['backgroundColor', 'borderColor', 'borderWidth', 'fontSize', 'fontWeight']),
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
    rows: [...document.querySelectorAll('.ink-row')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    }),
    upnextEmpty: box('.ink-upnext-empty'),
    previewOverflowX: preview ? preview.scrollWidth - preview.clientWidth : 0,
    seeAll: box('.ink-seeall'),
    chevron: box('.ink-row-chevron'),
    filterBoxes: [...document.querySelectorAll('.ink-toggle')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), w: +r.width.toFixed(2), pressed: el.getAttribute('aria-pressed') };
    }),
    startCount: document.querySelectorAll('.ink-explore-start').length,
    actionClicks: window.__actionClicks ?? 0,
  };
})()`;

function emptyProps(withAction, emptyTitle) {
  return {
    ...fixture,
    header: { label: '80 OF 80 LEARNED', value: 80, max: 80 },
    progress: { label: 'KANJI LEARNED', value: 80, max: 80 },
    lesson: null,
    rows: [],
    ...(emptyTitle ? { emptyTitle } : {}),
    emptyText: withAction
      ? 'Every kanji in this level is done. Keep the reviews moving.'
      : 'Nothing new to learn in this level right now. Reviews keep the rest moving.',
    ...(withAction ? { emptyAction: { label: 'Review 12 kanji' } } : {}),
  };
}

async function mountAndMeasure(win, data) {
  await win.webContents.executeJavaScript(`(() => {
    const data = JSON.parse(JSON.stringify(${JSON.stringify(data)}));
    if (data.lesson) data.lesson.start = () => {};
    data.rows.forEach((row) => { row.open = () => {}; });
    data.onFilter = () => {};
    if (data.seeAll) data.seeAll.onOpen = () => {};
    if (data.emptyAction) data.emptyAction.onClick = () => { window.__actionClicks = (window.__actionClicks ?? 0) + 1; };
    document.getElementById('stage').replaceChildren();
    window.__actionClicks = 0;
    window.mountExplore(document.getElementById('stage'), data);
    const scroller = document.querySelector('.page');
    if (scroller) scroller.scrollTop = 0;
    document.scrollingElement.scrollTop = 0;
    return true;
  })()`);
  for (let i = 0; i < 200; i += 1) {
    const status = await win.webContents.executeJavaScript('document.fonts.status').catch(() => 'loaded');
    if (status === 'loaded') break;
    await delay(25);
  }
  await delay(150);
  return win.webContents.executeJavaScript(measureScript);
}

async function loadPage(win, markup, htmlName) {
  const htmlPath = path.join(outDir, htmlName);
  fs.writeFileSync(htmlPath, markup);
  await win.loadFile(htmlPath);
  for (let i = 0; i < 200; i += 1) {
    const ready = await win.webContents.executeJavaScript('Boolean(window.__moduleReady)').catch(() => false);
    if (ready) break;
    await delay(25);
  }
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
}

async function shot(win, name, width, height) {
  const image = await win.webContents.capturePage();
  const shotPath = path.join(outDir, `${name}.png`);
  fs.writeFileSync(shotPath, image.resize({ width, height, quality: 'best' }).toPNG());
  return shotPath;
}

const failures = [];
function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures.push(`${name}: ${detail}`);
    console.log(`FAIL ${name}: ${detail}`);
  }
}

function near(value, expected, tolerance = 1.5) {
  return Math.abs(Number(value) - expected) <= tolerance;
}

function checkLayout(name, boxes, { strip, expectedPanelH, expectedPanelTop, empty = false, expectedTitle = null }) {
  const panel = boxes.lessonPanel;
  const panelBottom = panel.y + panel.h;
  const viewportBottom = boxes.viewport.h;
  const scrolls = boxes.scroller.scrollHeight > boxes.scroller.clientHeight + 1;
  check(`${name}: panels are ${expectedPanelH}px tall`, near(panel.h, expectedPanelH), `got ${panel.h}`);
  check(`${name}: up-next panel matches lesson panel`, near(boxes.upnextPanel.h, panel.h), `${boxes.upnextPanel.h} vs ${panel.h}`);
  check(`${name}: panels never exceed the 808px frame`, panel.h <= PANEL_MAX + 0.5, `got ${panel.h}`);
  check(`${name}: hero + panels fit the viewport without scrolling`,
    boxes.hero.y >= 0 && panelBottom <= viewportBottom + 0.5 && !scrolls,
    `hero y=${boxes.hero.y}, panels bottom=${panelBottom}, viewport=${viewportBottom}, scroll=${boxes.scroller.scrollHeight}/${boxes.scroller.clientHeight}`);
  if (strip) {
    const stripH = boxes.strip.h + parseFloat(boxes.strip.marginTop || '0');
    check(`${name}: Learn strip is 40px + 28px gutter (68px)`, near(stripH, 68, 0.5), `got ${stripH}`);
    check(`${name}: panels start below the strip + hero`, near(panel.y, expectedPanelTop), `panels y=${panel.y}, expected ${expectedPanelTop}`);
  }
  if (empty) {
    check(`${name}: no Start button when the lesson is null`, boxes.startCount === 0, `startCount=${boxes.startCount}`);
    check(`${name}: empty heading shows ${JSON.stringify(expectedTitle ?? 'All caught up')}`,
      boxes.numberText === (expectedTitle ?? 'All caught up'), `got ${JSON.stringify(boxes.numberText)}`);
    check(`${name}: caught-up heading is 40px, not the 64px lesson size`, near(parseFloat(boxes.numberFont.fontSize), 40, 0.5), boxes.numberFont.fontSize);
    check(`${name}: empty copy is 17px muted`, boxes.emptyCopy && near(parseFloat(boxes.emptyCopyFont.fontSize), 17, 0.5)
      && boxes.emptyCopyFont.color === 'rgb(92, 90, 85)', `${boxes.emptyCopyFont?.fontSize} ${boxes.emptyCopyFont?.color}`);
    check(`${name}: empty copy sits inside the panel`, boxes.emptyCopy && boxes.emptyCopy.bottom < panelBottom, 'copy overflows');
  } else {
    check(`${name}: exactly one Start button`, boxes.startCount === 1, `startCount=${boxes.startCount}`);
    check(`${name}: Start stays inside the panel`, boxes.start && boxes.start.bottom <= panelBottom + 0.5, `start bottom=${boxes.start?.bottom}, panel bottom=${panelBottom}`);
    check(`${name}: caught-up heading style is only used for the empty state`,
      near(parseFloat(boxes.numberFont.fontSize), 64, 0.5), boxes.numberFont.fontSize);
  }
  check(`${name}: See all stays inside the panel and the viewport`,
    boxes.seeAll && boxes.seeAll.bottom <= panelBottom + 0.5 && boxes.seeAll.bottom <= viewportBottom + 0.5,
    `seeAll bottom=${boxes.seeAll?.bottom}, panel bottom=${panelBottom}, viewport=${viewportBottom}`);
  check(`${name}: no horizontal overflow`, boxes.cardOverflowX <= 0 && boxes.previewOverflowX <= 0,
    `card=${boxes.cardOverflowX}, preview=${boxes.previewOverflowX}`);
}

async function run() {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: frame.width,
    height: frame.height,
    useContentSize: true,
    show: false,
    backgroundColor: '#f5f2ea',
    webPreferences: { contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });

  try {
    // 1. The Figma frame, unchanged: standalone screen at 1440x1000 -> 808px panels.
    await win.webContents.setZoomFactor(1);
    win.setContentSize(frame.width, frame.height);
    await loadPage(win, frameMarkup, 'explore-frame.html');
    const frameBoxes = await mountAndMeasure(win, fixture);
    console.log('# frame boxes (panels 700/468 at x=224, card 604x712, rows 364x140)');
    console.log(JSON.stringify(frameBoxes, null, 1));
    check('frame: lesson panel is 808px at 1440x1000', near(frameBoxes.lessonPanel.h, PANEL_MAX), `got ${frameBoxes.lessonPanel.h}`);
    check('frame: panel starts at y=162', near(frameBoxes.lessonPanel.y, 162), `got ${frameBoxes.lessonPanel.y}`);
    check('frame: Start and See all inside the panel', frameBoxes.start.bottom <= frameBoxes.lessonPanel.bottom + 0.5
      && frameBoxes.seeAll.bottom <= frameBoxes.upnextPanel.bottom + 0.5, 'content overflows the frame panels');
    const frameShot = await shot(win, 'explore-kanji-s2', frame.width, frame.height);
    console.log(`# screenshot ${frameShot}`);
    const diff = diffAgainstFrame(frameShot);
    if (diff) {
      if (diff.error) console.log(`# diff error: ${diff.error}`);
      else {
        console.log(`# diff vs explore-kanji.png (x>=224): ${diff.pct.toFixed(1)}% pixels differ (>32), mean channel delta ${diff.mean.toFixed(1)}`);
        console.log(`# diff image ${path.join(outDir, 'explore-kanji-diff.png')}`);
      }
    }

    // 2. The app shell: Learn tab strip above the header. Panels must fit 1000 and 900 without scrolling.
    const shellScenarios = [
      { name: 'shell-kanji-1440x1000', width: 1440, height: 1000, empty: false, action: false },
      { name: 'shell-empty-1440x1000', width: 1440, height: 1000, empty: true, action: false },
      { name: 'shell-kanji-1440x900', width: 1440, height: 900, empty: false, action: false },
      { name: 'shell-empty-1440x900', width: 1440, height: 900, empty: true, action: false },
      { name: 'shell-empty-action-1440x900', width: 1440, height: 900, empty: true, action: true },
      { name: 'shell-empty-title-1440x900', width: 1440, height: 900, empty: true, action: false, title: 'All kanji learned' },
    ];
    for (const scenario of shellScenarios) {
      win.setContentSize(scenario.width, scenario.height);
      await loadPage(win, shellMarkup, 'explore-shell.html');
      const data = scenario.empty ? emptyProps(scenario.action, scenario.title) : fixture;
      const boxes = await mountAndMeasure(win, data);
      if (!boxes) {
        check(`${scenario.name}: screen mounts`, false, 'not mounted');
        continue;
      }
      console.log(`# ${scenario.name}`);
      console.log(JSON.stringify({
        viewport: boxes.viewport,
        strip: boxes.strip,
        hero: boxes.hero,
        lessonPanel: boxes.lessonPanel,
        upnextPanel: boxes.upnextPanel,
        number: boxes.number && { h: boxes.number.h, text: boxes.numberText, font: boxes.numberFont.fontSize },
        emptyCopy: boxes.emptyCopy && { y: boxes.emptyCopy.y, h: boxes.emptyCopy.h, font: boxes.emptyCopyFont.fontSize },
        emptyAction: boxes.emptyAction && { ...boxes.emptyAction, ...boxes.emptyActionStyle },
        start: boxes.start,
        seeAll: boxes.seeAll,
        rows: boxes.rows,
        scroll: boxes.scroller,
      }, null, 1));
      const expectedPanelH = Math.min(PANEL_MAX, Math.max(PANEL_MIN, scenario.height - 260));
      const expectedTop = 28 + 68 + 110 + 24;
      checkLayout(scenario.name, boxes, {
        strip: true,
        expectedPanelH,
        expectedPanelTop: expectedTop,
        empty: scenario.empty,
        expectedTitle: scenario.title ?? null,
      });
      if (scenario.empty && scenario.action) {
        check(`${scenario.name}: empty action is a paper outlined button`, boxes.emptyAction
          && boxes.emptyActionStyle.backgroundColor === 'rgb(245, 242, 234)'
          && boxes.emptyActionStyle.borderColor === 'rgb(10, 10, 10)'
          && near(parseFloat(boxes.emptyActionStyle.borderWidth), 3, 0.1),
        JSON.stringify(boxes.emptyActionStyle));
      }
      const pathShot = await shot(win, scenario.name, scenario.width, scenario.height);
      console.log(`# screenshot ${pathShot}`);
    }

    // 3. Narrow windows still stack and never overlap.
    win.setContentSize(frame.width, frame.height);
    await loadPage(win, frameMarkup, 'explore-frame.html');
    await mountAndMeasure(win, fixture);
    for (const width of [1280, 1120, 1024]) {
      win.setContentSize(width, frame.height);
      await delay(180);
      const narrow = await win.webContents.executeJavaScript(measureScript);
      const stacked = narrow.upnextPanel.y >= narrow.lessonPanel.y + narrow.lessonPanel.h - 0.5;
      console.log(`# ${width}px: panels ${narrow.lessonPanel.w}x${narrow.lessonPanel.h} / ${narrow.upnextPanel.w}x${narrow.upnextPanel.h}, ${stacked ? 'stacked' : 'side by side'}, overlap ${narrow.overlap}, card overflow-x ${narrow.cardOverflowX}, preview overflow-x ${narrow.previewOverflowX}`);
      check(`${width}px: ${width <= 1120 ? 'panels stack' : 'panels do not overlap'}`,
        width <= 1120 ? stacked : narrow.overlap === 0,
        stacked ? `upnext y=${narrow.upnextPanel.y}, lesson bottom=${narrow.lessonPanel.y + narrow.lessonPanel.h}` : `overlap ${narrow.overlap}`);
      check(`${width}px: no preview overflow`, narrow.previewOverflowX <= 0, `overflow ${narrow.previewOverflowX}`);
      if (width === 1280) await shot(win, 'explore-kanji-s2-1280', width, frame.height);
    }
  } finally {
    win.destroy();
    if (failures.length) {
      console.log(`# ${failures.length} check(s) failed`);
      for (const failure of failures) console.log(`# - ${failure}`);
      app.exit(1);
    } else {
      console.log('# all checks passed');
      app.exit(0);
    }
  }
}

app.whenReady().then(run).catch((error) => {
  console.error(error?.stack ?? error);
  app.exit(1);
});
