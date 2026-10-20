// Player (slice S5) screenshot: renders the real player.mjs in Electron against a stubbed window.api and a
// fake video element, at the Figma frame size 1440x1000. Compare with docs/figma/manga-ink/player-theater.png.
// Run: node_modules/.bin/electron scripts/ink-s5-shot.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const outDir = process.env.ANIME_MINE_SCREENSHOTS || '/tmp/ink-s5';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-ink-s5-'));
app.setPath('userData', dataDir);
app.commandLine.appendSwitch('disable-http-cache');
app.disableHardwareAcceleration();

const fileUrl = (file) => `file://${encodeURI(file).replace(/[?#]/g, encodeURIComponent)}`;
const css = [
  'styles.css',
  'css/player.css',
  'css/popup.css',
  'css/grammar-guide.css',
  'css/ink-theme.css',
  'css/ink-kit.css',
  'css/player-timeline.css',
];

const CUES = [
  { start: 742, end: 749, text: 'どうしたの？' },
  { start: 750, end: 757, text: '本当に大丈夫なの？' },
  { start: 758, end: 765, text: 'うん、大丈夫だよ' },
  { start: 766, end: 773, text: 'そう、よかった' },
  { start: 774, end: 781, text: 'じゃあ、帰ろうか' },
  { start: 782, end: 789, text: '明日も頑張ろう' },
];
const TOKENS = [
  { surface: '本当に', start: 0, end: 3, isWord: true, reading: 'ほんとうに', base: '本当に' },
  { surface: '大丈夫', start: 3, end: 6, isWord: true, reading: 'だいじょうぶ', base: '大丈夫' },
  { surface: 'な', start: 6, end: 7, isWord: true, reading: 'な', base: 'な' },
  { surface: 'の', start: 7, end: 8, isWord: true, reading: 'の', base: 'の' },
  { surface: '？', start: 8, end: 9, isWord: false },
];
const STATUSES = ['new', 'known', 'learning', 'known', 'skip'];

const harness = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Manga Ink player shot</title>
${css.map((href) => `<link rel="stylesheet" href="${fileUrl(path.join(root, 'src/renderer', href))}">`).join('\n')}
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; flex-direction: row; overflow: hidden; background: var(--paper); color: var(--ink); }
  #fake-nav { flex: none; width: 200px; height: 100%; background: #0a0a0a; }
  #view { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
</style>
</head>
<body>
<div id="fake-nav"></div>
<main id="view"></main>
<div id="toasts" class="toasts"></div>
<script type="module">
  // The player owns no video fixture in the repo: freeze the media element to a fixed clock instead.
  let fakeTime = 0;
  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get() { return fakeTime; },
    set(value) { fakeTime = Number(value) || 0; },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 1420; } });
  Object.defineProperty(HTMLMediaElement.prototype, 'src', { configurable: true, get() { return ''; }, set() {} });
  HTMLMediaElement.prototype.load = () => {};
  HTMLMediaElement.prototype.pause = () => {};
  HTMLMediaElement.prototype.play = () => Promise.resolve();
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get() { return 4; } });
  Object.defineProperty(HTMLMediaElement.prototype, 'videoWidth', { configurable: true, get() { return 1280; } });
  Object.defineProperty(HTMLMediaElement.prototype, 'videoHeight', { configurable: true, get() { return 720; } });

  const shows = [{ title: 'Kono Subarashii S3', episodes: Array.from({ length: 12 }, (_, i) => ({
    path: '/videos/kono-' + String(i + 1).padStart(2, '0') + '.mkv',
    name: 'Kono Subarashii S3 - ' + String(i + 1).padStart(2, '0') + '.mkv',
    season: 3,
    episode: i + 1,
    subtitlePath: '/subs/kono-' + String(i + 1).padStart(2, '0') + '.ass',
  })) }];

  window.api = {
    settings: { get: async () => ({ highlightUnknown: true, showFurigana: false }), set: async () => ({}) },
    media: {
      onProgress: () => () => {},
      probe: async () => ({
        duration: 1420,
        streams: [
          { index: 0, type: 'audio', lang: 'ja', codec: 'aac', channels: 2 },
          { index: 2, type: 'audio', lang: 'en', codec: 'aac', channels: 2, title: 'Dub' },
          { index: 1, type: 'subtitle', lang: 'ja', codec: 'ass', textBased: true },
        ],
        plan: { mode: 'direct' },
        defaults: { audioStreamIndex: 0, subtitleStreamIndex: 1 },
        saved: { position: 754, audioStreamIndex: 0, subtitle: 'external', subOffset: 0 },
      }),
      prepare: async () => ({ path: '/videos/fake.mkv', cleaned: false }),
      cancel: async () => {},
    },
    player: { loadCues: async () => ({ cues: ${JSON.stringify(CUES)}, source: 'external', synced: false }) },
    nlp: { tokenize: async () => ${JSON.stringify(TOKENS)} },
    known: { classify: async () => ({ statuses: ${JSON.stringify(STATUSES)}, info: { isIPlusOne: false } }) },
    library: { getShows: async () => shows },
    progress: { update: async () => ({}), next: async () => null },
    anki: { status: async () => ({ connected: true, deck: 'Mining' }) },
    dict: { onProgress: () => {} },
  };

  const { mountPlayer } = await import('${fileUrl(path.join(root, 'src/renderer/player.mjs'))}');
  mountPlayer(document.getElementById('view'), shows[0].episodes[3], {
    onBack() {}, onOpenSettings() {}, onPlayEpisode() {},
  });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const video = document.querySelector('video');
  video.dispatchEvent(new Event('loadedmetadata'));
  video.dispatchEvent(new Event('timeupdate'));
  await new Promise((resolve) => setTimeout(resolve, 600));
  video.dispatchEvent(new Event('timeupdate'));
  window.__ready = true;
</script>
</body>
</html>`;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errors = [];

app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_event, level, message) => {
    if (level >= 2) {
      errors.push(message);
      console.log('[renderer]', message);
    }
  });
  contents.on('render-process-gone', (_event, details) => console.log('[gone]', JSON.stringify(details)));
  contents.on('did-fail-load', (_event, code, description) => console.log('[fail-load]', code, description));
});

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const harnessPath = path.join(outDir, 'harness.html');
  fs.writeFileSync(harnessPath, harness);
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    useContentSize: true,
    webPreferences: { sandbox: false },
  });
  win.setContentSize(1440, 1000);
  await win.loadFile(harnessPath);
  for (let i = 0; i < 120; i++) {
    let ready = false;
    try {
      ready = await win.webContents.executeJavaScript('window.__ready === true');
    } catch (err) {
      console.log('[eval-error]', err.message);
      break;
    }
    if (ready) break;
    await delay(50);
  }
  await delay(400);
  fs.writeFileSync(path.join(outDir, 'player-theater.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('.stage-subs').click()");
  await delay(250);
  fs.writeFileSync(path.join(outDir, 'player-menu.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('.stage-subs').click()");
  await win.webContents.executeJavaScript("document.querySelector('.subtitle-overlay .word:nth-child(3)')?.click()");
  await delay(250);
  fs.writeFileSync(path.join(outDir, 'player-strip.png'), (await win.webContents.capturePage()).toPNG());
  const report = await win.webContents.executeJavaScript(`(() => ({
    header: document.querySelector('.ink-hero-label')?.textContent ?? null,
    plate: document.querySelector('.stage-plate')?.textContent ?? null,
    line: document.querySelector('.strip-line')?.textContent ?? null,
    chips: [...document.querySelectorAll('.strip-chip')].map((chip) => chip.textContent),
    selected: [...document.querySelectorAll('.strip-chip.is-selected')].map((chip) => chip.textContent),
    time: [...document.querySelectorAll('.ctrl-time')].map((el) => el.textContent),
    offset: document.querySelector('.ctrl-offset')?.textContent ?? null,
    trackChips: [...document.querySelectorAll('.ctrl-chip-label')].map((el) => el.textContent),
    menuRows: document.querySelectorAll('.player-menu-row').length,
    overlaySize: document.querySelector('.subtitle-overlay')?.getBoundingClientRect().width ?? null,
    words: [...document.querySelectorAll('.subtitle-overlay .word')].map((el) => el.className),
    rects: Object.fromEntries([
      ['header', '.ink-hero'],
      ['video', '.player-stage'],
      ['controls', '.player-controls'],
      ['strip', '.player-strip'],
      ['timeline', '.player-timeline'],
      ['back', '.stage-back'],
      ['plate', '.stage-plate'],
      ['subs', '.stage-subs'],
      ['bubble', '.subtitle-overlay'],
      ['play', '.ctrl-play'],
      ['track', '.ctrl-scrub .ink-track'],
      ['now', '.ctrl-time.is-now'],
      ['total', '.ctrl-time.is-total'],
      ['subChip', '.ctrl-subs'],
      ['audioChip', '.ctrl-audio'],
      ['offset', '.ctrl-offset'],
      ['fullscreen', '.ctrl-fullscreen'],
      ['line', '.strip-line'],
      ['hint', '.strip-hint'],
      ['chips', '.strip-chips'],
    ].map(([key, selector]) => {
      const el = document.querySelector(selector);
      if (!el) return [key, null];
      const r = el.getBoundingClientRect();
      return [key, [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]];
    })),
  }))()`);
  const checks = await win.webContents.executeJavaScript(`(() => {
    const out = {};
    const $ = (selector) => document.querySelector(selector);
    const key = (name) => document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    const video = $('video');
    video.currentTime = 754;
    out.offsetStart = $('.ctrl-offset').textContent;
    key(']');
    out.offsetRight = $('.ctrl-offset').textContent;
    key('[');
    out.offsetBack = $('.ctrl-offset').textContent;
    $('.strip-chip').click();
    out.popupVisible = !$('.popup-slot').hidden;
    out.selectedChip = [...document.querySelectorAll('.strip-chip.is-selected')].map((el) => el.textContent);
    key('Escape');
    out.popupHidden = $('.popup-slot').hidden;
    out.selectedAfterEscape = document.querySelectorAll('.strip-chip.is-selected').length;
    $('.stage-subs').click();
    out.menuOpen = !$('.player-menu').hidden;
    out.menuRows = [...document.querySelectorAll('.player-menu-row')].map((row) => row.textContent.trim().replace(/\\s+/g, ' '));
    key('Escape');
    out.menuClosed = $('.player-menu').hidden;
    key(']');
    out.offsetAfterMenu = $('.ctrl-offset').textContent;
    key('[');
    const scrub = $('.ctrl-scrub');
    scrub.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    out.timeAfterArrow = $('.ctrl-time.is-now').textContent;
    const track = $('.ctrl-scrub .ink-track').getBoundingClientRect();
    scrub.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 1, clientX: track.left + track.width / 4, clientY: track.top + 5,
    }));
    out.timeAfterPointerQuarter = $('.ctrl-time.is-now').textContent;
    out.aria = {
      role: scrub.getAttribute('role'),
      tabindex: scrub.getAttribute('tabindex'),
      valued: scrub.getAttribute('aria-valuenow') + '/' + scrub.getAttribute('aria-valuemax'),
    };
    out.headerValue = document.querySelector('.ink-track').getAttribute('aria-valuenow') + '/' + document.querySelector('.ink-track').getAttribute('aria-valuemax');
    out.controls = video.controls;
    out.hint = $('.strip-hint').textContent;
    video.currentTime = 754;
    video.dispatchEvent(new Event('timeupdate'));
    return out;
  })()`);
  console.log(JSON.stringify({ outDir, report, checks, errors }, null, 2));
  win.destroy();
  app.quit();
})().catch((err) => {
  console.error(err);
  app.exit(1);
});
