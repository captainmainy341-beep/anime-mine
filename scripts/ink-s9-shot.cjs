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
  // S8 feeds the card height from the viewport (--ink-study-card-h, 380..620). The script sets the
  // same variable on the study section so all three states can be captured from one window.
  window.__inkS9SetHeight = (height) => {
    view.el.style.setProperty('--ink-study-card-h', `${height}px`);
    window.scrollTo(0, 0);
    document.scrollingElement.scrollTop = 0;
    document.getElementById('view').scrollTop = 0;
    // .page is the screen scroller in the real app; reset it too so measurements do not drift.
    document.querySelector('.page')?.scrollTo?.(0, 0);
    return getComputedStyle(view.el).getPropertyValue('--ink-study-card-h').trim();
  };
  // Front/back documents re-rendered in an unsandboxed offscreen frame at the live frame size, so the
  // script can report whether the content scrolls inside instead of being clipped or shrunk.
  window.__inkS9Fit = async () => {
    const frameSize = (title) => {
      const frame = document.querySelector(`iframe[title="${title}"]`);
      if (!frame) return null;
      const r = frame.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const probe = (html, { w, h }) => new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px;border:0`;
      document.body.append(frame);
      frame.srcdoc = html;
      let tries = 0;
      const tick = () => {
        tries += 1;
        const d = frame.contentDocument;
        if (!d || !d.querySelector('.am-card')) {
          if (tries > 100) { resolve({ error: 'no doc' }); return; }
          setTimeout(tick, 30);
          return;
        }
        const doc = d.documentElement;
        const type = (sel) => {
          const n = d.querySelector(sel);
          if (!n) return null;
          const s = frame.contentWindow.getComputedStyle(n);
          return { size: s.fontSize, line: s.lineHeight };
        };
        resolve({
          size: { w, h },
          client: { w: doc.clientWidth, h: doc.clientHeight },
          scroll: { w: doc.scrollWidth, h: doc.scrollHeight },
          scrollsInternally: doc.scrollHeight > doc.clientHeight + 1,
          horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1,
          sentence: type('.am-sentence'),
          target: type('.am-target'),
          word: type('.target_word'),
          reading: type('.reading'),
          meaning: type('.meaning'),
        });
        frame.remove();
      };
      setTimeout(tick, 60);
    });
    const front = frameSize('Front of card');
    const back = frameSize('Back of card');
    return {
      front: { frame: front, ...(await probe(DOCS.frontDoc, front)) },
      back: { frame: back, ...(await probe(DOCS.backDoc, back)) },
    };
  };
  window.__inkS9Show('answer');
  window.scrollTo(0, 0);
  document.scrollingElement.scrollTop = 0;
  document.getElementById('view').scrollTop = 0;
  return true;
};

const MEASURE = () => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, bottom: Math.round((r.y + r.height) * 10) / 10 };
  };
  const pick = (selector) => document.querySelector(selector);
  const all = (selector) => [...document.querySelectorAll(selector)].map(box);
  const within = (inner, outer) => Boolean(inner && outer)
    && inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5
    && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;
  const offset = (inner, outer) => (inner && outer
    ? { x: Math.round((inner.x - outer.x) * 10) / 10, y: Math.round((inner.y - outer.y) * 10) / 10 }
    : null);
  const front = box(pick('.ink-study-front'));
  const back = box(pick('.ink-study-back'));
  const frontFrame = box(pick('.ink-study-front iframe'));
  const backFrame = box(pick('.ink-study-back iframe'));
  const frontTag = box(pick('.ink-study-front > .ink-tag'));
  const backTag = box(pick('.ink-study-back > .ink-tag'));
  const replay = box(pick('.ink-study-replay'));
  const placeholder = box(pick('.ink-study-placeholder'));
  const placeholderParts = ['doodle', '.ink-study-placeholder-line', '.ink-study-reveal', '.ink-study-placeholder-hint']
    .map((selector) => (selector === 'doodle' ? pick('.ink-study-placeholder .doodle') : pick(selector)))
    .map(box)
    .filter(Boolean);
  const placeholderVisible = Boolean(placeholder && placeholder.h > 0);
  const replayVisible = Boolean(replay && replay.w > 0 && replay.h > 0);
  const rate = box(pick('.ink-study-rate'));
  return {
    viewport: { width: innerWidth, height: innerHeight },
    scroll: {
      page: pick('.page')?.scrollTop ?? null,
      view: pick('#view')?.scrollTop ?? null,
    },
    front,
    back,
    frontTag,
    backTag,
    tagOffset: { front: offset(frontTag, front), back: offset(backTag, back) },
    tags: all('.ink-study-tag'),
    rate,
    rateTag: box(pick('.ink-study-rate .ink-tag')),
    hint: box(pick('.ink-study-hint')),
    buttons: all('.ink-rate'),
    good: box(pick('.ink-rate-good')),
    replay,
    frontFrame,
    backFrame,
    placeholder,
    checks: {
      replayVisible,
      replayInsideFrontFrame: replayVisible ? within(replay, frontFrame) : null,
      replayText: replayVisible ? (within(replay, frontFrame) ? 'frame corner' : 'clipped') : 'hidden',
      placeholderInBackFrame: placeholderVisible ? within(placeholder, backFrame) : null,
      placeholderPartsInBackFrame: placeholderVisible ? placeholderParts.every((part) => within(part, backFrame)) : null,
      placeholderCentred: placeholderVisible && backFrame
        ? Math.abs((placeholder.y + placeholder.h / 2) - (backFrame.y + backFrame.h / 2)) <= 1
        : null,
      rateWidth: rate?.w,
      rateHeight: rate?.h,
      rateBottom: rate?.bottom,
      rateInViewport: rate ? rate.bottom <= innerHeight + 0.5 : null,
      pageOverflowX: document.documentElement.scrollWidth > innerWidth,
    },
  };
};

const FIT = () => window.__inkS9Fit();

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
  // The lead's fit bug: at 620 the 172px rating panel sat below the fold of a 1440x1000 window.
  // Capture the answer and placeholder sides at the tallest, middle and shortest card heights.
  const HEIGHTS = [620, 480, 380];
  const report = {};
  for (const height of HEIGHTS) {
    await win.webContents.executeJavaScript(`window.__inkS9Show('answer'); window.__inkS9SetHeight(${height});`);
    await delay(300);
    const answerShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `answer-${height}.png`), answerShot.toPNG());
    if (height === 620) fs.writeFileSync(path.join(outDir, 'anki-card-clean.png'), answerShot.toPNG());
    const answer = await evaluate(MEASURE);
    const answerFit = await evaluate(FIT);

    await win.webContents.executeJavaScript(`window.__inkS9Show('question'); window.__inkS9SetHeight(${height});`);
    await delay(300);
    const questionShot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `question-${height}.png`), questionShot.toPNG());
    if (height === 620) fs.writeFileSync(path.join(outDir, 'anki-card-question.png'), questionShot.toPNG());
    const question = await evaluate(MEASURE);

    report[height] = {
      cardHeight: { front: answer.front?.h, back: answer.back?.h },
      frames: {
        front: { h: answer.frontFrame?.h, scrolls: answerFit.front.scrollsInternally, contentH: answerFit.front.scroll.h },
        back: { h: answer.backFrame?.h, scrolls: answerFit.back.scrollsInternally, contentH: answerFit.back.scroll.h },
      },
      type: { sentence: answerFit.front.sentence, word: answerFit.back.word, meaning: answerFit.back.meaning },
      answerSide: answer.checks,
      questionSide: question.checks,
      placeholder: {
        h: question.placeholder?.h,
        parts: question.placeholder?.h ? 'visible' : 'hidden',
        ...question.checks,
      },
      rate: { w: answer.rate?.w, h: answer.rate?.h, bottom: answer.checks.rateBottom, inViewport: answer.checks.rateInViewport },
      tags: {
        front: answer.frontTag,
        back: answer.backTag,
        offset: answer.tagOffset,
        position: answer.tagOffset.back?.y,
        left: answer.tagOffset.back?.x,
      },
    };
    console.log(`height ${height}`, JSON.stringify(report[height], null, 2));
  }
  fs.writeFileSync(path.join(outDir, 'fit-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  // The fit contract in one place: the cards follow the variable, the frames take the leftover
  // height and scroll their documents, the placeholder and replay stay inside, the tags do not
  // move, the type does not shrink and the rating panel keeps its 1184x172 frame in the window.
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); };
  const expectedType = report[620].type;
  for (const height of HEIGHTS) {
    const r = report[height];
    check(r.cardHeight.front === height && r.cardHeight.back === height, `${height}px: both cards use --ink-study-card-h (front ${r.cardHeight.front}, back ${r.cardHeight.back})`);
    check(r.frames.front.h === height - 106, `${height}px: front frame fills the leftover height (${r.frames.front.h})`);
    check(r.frames.back.h === height - 126, `${height}px: back frame fills the leftover height (${r.frames.back.h})`);
    check(r.frames.front.contentH >= r.frames.front.h - 1, `${height}px: front document is measured, not clipped`);
    check(r.frames.back.contentH >= r.frames.back.h - 1, `${height}px: back document is measured, not clipped`);
    if (height <= 480) {
      check(r.frames.front.scrolls, `${height}px: front iframe scrolls internally`);
      check(r.frames.back.scrolls, `${height}px: back iframe scrolls internally`);
    }
    check(r.placeholder.h > 0 && r.placeholder.placeholderInBackFrame, `${height}px: placeholder stays in the back frame`);
    check(r.placeholder.placeholderPartsInBackFrame, `${height}px: placeholder icon, copy and button stay in the frame`);
    check(r.placeholder.placeholderCentred, `${height}px: placeholder is centred on the back frame`);
    check(r.questionSide.replayInsideFrontFrame && r.answerSide.replayInsideFrontFrame, `${height}px: replay button stays on the front frame`);
    check(r.rate.w === 1184 && r.rate.h === 172, `${height}px: rating panel keeps 1184x172 (${r.rate.w}x${r.rate.h})`);
    check(r.rate.inViewport, `${height}px: rating panel is inside the 1440x1000 window (bottom ${r.rate.bottom})`);
    check(r.tags.offset.front?.x === 28 && r.tags.offset.front?.y === 24, `${height}px: front caption tag keeps its 28/24 offset (${r.tags.offset.front?.x}/${r.tags.offset.front?.y})`);
    check(r.tags.position === 50 && r.tags.left === 52, `${height}px: back caption tag keeps its 52/50 offset (${r.tags.left}/${r.tags.position})`);
    check(JSON.stringify(r.type) === JSON.stringify(expectedType), `${height}px: type and kanji keep their size`);
    check(!r.answerSide.pageOverflowX && !r.questionSide.pageOverflowX, `${height}px: no horizontal page overflow`);
  }
  if (failures.length) throw new Error(`fit checks failed:\n${failures.join('\n')}`);
  console.log('FIT CHECKS OK', JSON.stringify(HEIGHTS.map((height) => ({ height, card: report[height].cardHeight, frames: report[height].frames, placeholder: report[height].placeholder.h, rate: report[height].rate, tags: { left: report[height].tags.left, top: report[height].tags.position } })), null, 2));

  if (process.env.INK_S9_INSPECT) console.log('inspect', JSON.stringify(await evaluate(INSPECT), null, 2));
  if (errors.length) console.log('renderer errors', errors);
  console.log('WROTE', outDir);
  app.exit(0);
})().catch((err) => { console.error(err?.stack ?? err); app.exit(1); });
