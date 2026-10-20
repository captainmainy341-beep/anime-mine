// Subtitle timeline screenshot check (slice S6).
// Run: node_modules/.bin/electron scripts/ink-s6-shot.cjs
// Mounts src/renderer/player/timeline.mjs in a 1440x1000 paper page at the Figma panel position
// (x1128 y128), checks the measured geometry and writes /tmp/ink-s6/player-timeline.png.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const outDir = process.env.ANIME_MINE_SCREENSHOTS || '/tmp/ink-s6';
const fileUrl = (rel) => `file://${path.join(root, rel).split(path.sep).map(encodeURIComponent).join('/')}`;

const cues = [
  { start: 742, end: 745.5, text: 'どうしたの？' },
  { start: 746, end: 749.5, text: 'ちょっと疲れただけ' },
  { start: 750, end: 753.5, text: '無理しないでね' },
  { start: 754, end: 757.5, text: '本当に大丈夫なの？' },
  { start: 758, end: 761.5, text: 'うん、大丈夫だよ' },
  { start: 762, end: 765.5, text: 'そう、よかった' },
  { start: 766, end: 769.5, text: 'じゃあ、帰ろうか' },
  { start: 770, end: 773.5, text: '明日も頭張ろう' },
  { start: 774, end: 777.5, text: 'また明日ね' },
  { start: 778, end: 781.5, text: 'おやすみ' },
];

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="${fileUrl('src/renderer/css/ink-theme.css')}">
<link rel="stylesheet" href="${fileUrl('src/renderer/css/ink-kit.css')}">
<link rel="stylesheet" href="${fileUrl('src/renderer/css/player-timeline.css')}">
<style>
  html, body { margin: 0; width: 1440px; height: 1000px; background: var(--paper); }
  .nav-strip { position: absolute; left: 0; top: 0; width: 200px; height: 1000px; background: var(--ink); }
  #host { position: absolute; left: 1128px; top: 128px; }
</style>
</head>
<body>
  <div class="nav-strip"></div>
  <div id="host"></div>
  <script type="module">
    import { mountTimeline } from ${JSON.stringify(fileUrl('src/renderer/player/timeline.mjs'))};
    const timeline = mountTimeline(document.getElementById('host'), { onSeek() {}, onOffset() {} });
    timeline.setCues(${JSON.stringify(cues)});
    timeline.setCurrent(3);
    timeline.setOffset(0);
    window.__timeline = timeline;
    window.__ready = true;
  </script>
</body></html>`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const fixture = path.join(outDir, 'fixture.html');
  fs.writeFileSync(fixture, html);

  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    useContentSize: true,
    webPreferences: { webSecurity: false, sandbox: false, contextIsolation: false, nodeIntegration: false },
  });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) errors.push(message);
  });
  await win.loadFile(fixture);
  for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript('window.__ready === true')); i += 1) await delay(50);
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
  await delay(200);
  win.setContentSize(1440, 1000);
  await delay(200);

  const rects = await win.webContents.executeJavaScript(`(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      panel: box('.ink-timeline'),
      tag: box('.ink-timeline > .ink-tag'),
      firstCard: box('.ink-tl-card'),
      currentCard: box('.ink-tl-line.is-current .ink-tl-card'),
      pip: box('.ink-tl-pip'),
      railFill: box('.ink-timeline-rail-fill'),
      minus: box('.ink-tl-minus'),
      value: box('.ink-tl-value'),
      plus: box('.ink-tl-plus'),
      rows: document.querySelectorAll('.ink-tl-line').length,
      currentAria: document.querySelector('.ink-tl-line.is-current .ink-tl-card')?.getAttribute('aria-current'),
      valueText: document.querySelector('.ink-tl-value')?.textContent,
    };
  })()`);
  console.log(JSON.stringify(rects, null, 2));

  const image = await win.webContents.capturePage();
  const size = image.getSize();
  const png = size.width === 1440 && size.height === 1000 ? image : image.resize({ width: 1440, height: 1000 });
  fs.writeFileSync(path.join(outDir, 'player-timeline.png'), png.toPNG());
  console.log(`Wrote ${path.join(outDir, 'player-timeline.png')} (${size.width}x${size.height})`);
  if (errors.length) console.error('Renderer console errors:', errors);
  win.destroy();
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
