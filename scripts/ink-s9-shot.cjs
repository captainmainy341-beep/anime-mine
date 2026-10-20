// Run: node_modules/.bin/electron scripts/ink-s9-shot.cjs
// Renders the S9 study card (front/back + rating panel) with a mock mining card at 1440x1000 and saves
// PNGs to /tmp/ink-s9/ for comparison with docs/figma/manga-ink/anki-card-clean.png.
// The mock uses a fake API-free route: it imports the real modules into the running renderer.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const outDir = process.env.INK_SHOT_DIR || '/tmp/ink-s9';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-ink-s9-'));
app.setPath('userData', dataDir);
const errors = [];
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
});
app.on('browser-window-created', (_, win) => win.hide());
require(path.join(root, 'src/main/main.js'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let win;
const evaluate = (fn) => win.webContents.executeJavaScript(`(${fn.toString()})()`);

const MOUNT = async () => {
  const { inkHeader } = await import('./lib/inkHeader.mjs');
  const { createStudyCardView } = await import('./anki/studyCard.mjs');
  const { studyDocument } = await import('./lib/studyPresentation.mjs');
  const { gradeButtons } = await import('./lib/study.mjs');

  // Screenshot stand-in: the exported Figma rays as a data URI (the mock card has no real video frame).
  const shot = (() => {
    const lines = [];
    for (let i = 0; i < 130; i++) {
      const angle = (i / 130) * Math.PI * 2 + 0.02 * Math.sin(i * 1.7);
      const half = 0.002 + (i % 6) * 0.0016;
      const x1 = 50 + Math.cos(angle - half) * 3;
      const y1 = 50 + Math.sin(angle - half) * 3;
      const x2 = 50 + Math.cos(angle + half) * 92;
      const y2 = 50 + Math.sin(angle + half) * 92;
      lines.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="#f5f2ea" stroke-width="${(0.12 + (i % 4) * 0.3).toFixed(2)}"/>`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect width="100" height="100" fill="#0a0a0a"/>${lines.join('')}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  })();
  const scene = `<details class="images-details"><summary>Image</summary><div class="images"><img alt="Scene" src="${shot}"></div></details>`;
  const card = {
    id: 1,
    deck: 'Mining',
    css: '',
    audio: 'episode-04.mp3',
    sentence: '本当に大丈夫なの？',
    question: `<div class="wrap"><header><span class="tags">Mining New_card JLPT_N4</span></header><div class="sent-center"><div class="jpsentence" lang="ja">本当に<b>大丈夫</b>なの？</div></div>${scene}</div>`,
    answer: `<div class="wrap"><div class="sent-center"><div class="jpsentence" lang="ja">本当に<b>大丈夫</b>なの？</div><div class="ensentence">"Are you really okay?"</div></div><section class="headword_section"><div class="vocab"><div class="target_word">大丈夫</div><div class="reading">だいじょうぶ</div></div><div class="definitions meaning">all right; safe; certain</div></section><div class="tags">na-adjective common</div><div class="source">Kono Subarashii S3 · E04 · 12:34</div>${scene}</div>`,
  };

  if (!document.getElementById('ink-s9-nav-style')) {
    const style = document.createElement('style');
    style.id = 'ink-s9-nav-style';
    // Screenshot-only stand-in for slice S1's 200px black nav.
    style.textContent = '.topbar { width: 200px !important; background: #0a0a0a !important; border-right: 0 !important; color: #f5f2ea; } .topbar .brand span, .topbar #nav button { color: #f5f2ea; } .topbar .brand::after { background: #ff2e6e; }';
    document.head.append(style);
  }

  const view = createStudyCardView({
    onReveal: () => view.update({ ...DOCS, side: 'answer', buttons: gradeButtons({ intervals: ['<1m', '6m', '3d', '5d'] }), busy: false, hasAudio: true, status: '' }),
    onGrade: () => {},
    onReplay: () => {},
  });
  const DOCS = { frontDoc: studyDocument(card, 'question'), backDoc: studyDocument(card, 'answer') };
  const page = document.createElement('section');
  page.className = 'page anki ink-screen ink-clean';
  const header = inkHeader({ title: 'Review', label: 'CARD 14 OF 86 · MINING', value: 14, max: 86 });
  header.style.setProperty('--ink-hero-title', '50px');
  view.el.style.marginTop = '24px';
  page.append(header, view.el);
  const host = document.getElementById('view');
  host.replaceChildren(page);
  window.__inkS9 = { view, docs: DOCS };
  window.__inkS9Show = (side) => {
    view.update({ ...DOCS, side, buttons: gradeButtons({ intervals: ['<1m', '6m', '3d', '5d'] }), busy: false, hasAudio: true, status: '' });
    return true;
  };
  window.__inkS9Show('answer');
  window.scrollTo(0, 0);
  document.scrollingElement.scrollTop = 0;
  document.getElementById('view').scrollTop = 0;
  return true;
};

const MEASURE = () => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
  };
  const pick = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)].map(box);
  return {
    viewport: { width: innerWidth, height: innerHeight },
    front: box(pick('.ink-study-front')),
    back: box(pick('.ink-study-back')),
    frontTag: box(pick('.ink-study-front > .ink-tag')),
    backTag: box(pick('.ink-study-back > .ink-tag')),
    rate: box(pick('.ink-study-rate')),
    rateTag: box(pick('.ink-study-rate .ink-tag')),
    hint: box(pick('.ink-study-hint')),
    buttons: all('.ink-rate'),
    good: box(pick('.ink-rate-good')),
    replay: box(pick('.ink-study-replay')),
    frontFrame: box(pick('.ink-study-front iframe')),
    backFrame: box(pick('.ink-study-back iframe')),
  };
};

const INSPECT = async () => {
  const docs = window.__inkS9.docs;
  const measure = (html, width, height) => new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;border:0`;
    document.body.append(frame);
    frame.srcdoc = html;
    let tries = 0;
    const tick = () => {
      tries += 1;
      const d = frame.contentDocument;
      if (!d || !d.querySelector('.am-sentence')) {
        if (tries > 100) { resolve({ error: 'no doc' }); return; }
        setTimeout(tick, 30);
        return;
      }
      const win = frame.contentWindow;
      const info = (sel) => {
        const n = d.querySelector(sel);
        if (!n) return null;
        const s = win.getComputedStyle(n);
        const r = n.getBoundingClientRect();
        return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, size: s.fontSize, weight: s.fontWeight, color: s.color, bg: s.backgroundColor, border: s.borderTopWidth, margin: s.marginTop, line: s.lineHeight };
      };
      const res = {
        client: { w: d.documentElement.clientWidth, h: d.documentElement.clientHeight, scroll: d.documentElement.scrollHeight },
        body: info('body'),
        bodyPad: win.getComputedStyle(d.body).padding,
        scene: info('.am-scene img'),
        sentence: info('.am-sentence'),
        target: info('.am-target'),
        word: info('.target_word'),
        reading: info('.reading'),
        meaning: info('.meaning'),
        tags: info('.am-tags'),
        divider: info('.am-divider'),
        source: info('.am-source'),
        head: [...d.querySelectorAll('.wrap > *, .wrap > .wrap > *, .am-answer-grid > *')].map((n) => ({ cls: String(n.className), h: Math.round(n.getBoundingClientRect().height), top: Math.round(n.getBoundingClientRect().top) })),
      };
      frame.remove();
      resolve(res);
    };
    setTimeout(tick, 60);
  });
  return { front: await measure(docs.frontDoc, 524, 514), back: await measure(docs.backDoc, 532, 494) };
};

(async () => {
  await app.whenReady();
  for (let i = 0; i < 200 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await delay(50); }
  if (!win) throw new Error('main created no window');
  if (win.webContents.isLoading()) await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.setContentSize(1440, 1000);
  try {
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });
  } catch (err) {
    console.log('device emulation unavailable', err.message);
  }
  await delay(400);
  console.log('content size', win.getContentSize());
  await evaluate(MOUNT);
  await delay(600);
  await win.webContents.executeJavaScript('window.scrollTo(0,0); document.scrollingElement.scrollTop = 0; document.getElementById("view").scrollTop = 0;');
  await delay(200);
  fs.mkdirSync(outDir, { recursive: true });
  const answerShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'anki-card-clean.png'), answerShot.toPNG());
  console.log('measure answer', JSON.stringify(await evaluate(MEASURE), null, 2));
  console.log('inspect', JSON.stringify(await evaluate(INSPECT), null, 2));
  await win.webContents.executeJavaScript('window.__inkS9Show("question"); window.scrollTo(0,0); document.scrollingElement.scrollTop = 0; document.getElementById("view").scrollTop = 0;');
  await delay(300);
  const questionShot = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, 'anki-card-question.png'), questionShot.toPNG());
  console.log('measure question', JSON.stringify(await evaluate(MEASURE), null, 2));
  if (errors.length) console.log('renderer errors', errors);
  console.log('WROTE', outDir);
  app.exit(0);
})().catch((err) => { console.error(err); app.exit(1); });
