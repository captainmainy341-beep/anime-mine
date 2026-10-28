// Deeper learner tour — explores features and reports bugs to /tmp/am-qa/
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const appRoot = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const outDir = process.env.AM_QA_DIR || '/tmp/am-qa';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-qa-'));
fs.mkdirSync(outDir, { recursive: true });

const { buildPack } = require(path.join(appRoot, 'src/core/studyPack'));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(appRoot, 'test/fixtures/study', name), 'utf8'));
const pack = buildPack({
  kanjidic: fixture('kanjidic.json'),
  kradfile: fixture('kradfile.json'),
  examples: fixture('examples.json'),
});
fs.writeFileSync(path.join(dataDir, 'study-pack.json'), JSON.stringify(pack));
const { LearnStore } = require(path.join(appRoot, 'src/core/learnStore'));
const seeded = new LearnStore({ dataDir, pack, now: () => Date.now() - 24 * 3600000 });
seeded.addCustomWord({ word: '猫', kana: ['ねこ'], meanings: ['cat'] });
seeded.addCustomWord({ word: '勉強', kana: ['べんきょう'], meanings: ['study'] });
seeded.completeLessons(['c:猫']);

app.setPath('userData', dataDir);
const errors = [];
const bugs = [];
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) errors.push({ level, message, line, sourceId });
  });
  contents.on('did-fail-load', (_e, code, desc, url) => bugs.push({ type: 'fail-load', code, desc, url }));
});
app.on('browser-window-created', (_, win) => win.hide());
require(path.join(appRoot, 'src/main/main.js'));

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let win;
const run = (code) => win.webContents.executeJavaScript(code);

async function shot(name) {
  await run('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  await delay(350);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
}

async function probe(label) {
  const info = await run(`(() => {
    const view = document.querySelector('#view');
    const text = (view?.innerText || '').slice(0, 800);
    const overflow = [...document.querySelectorAll('#view *')].filter((el) => {
      if (!el.getClientRects().length) return false;
      return el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;
    }).slice(0, 12).map((el) => ({
      tag: el.tagName, class: String(el.className || '').slice(0, 80),
      sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight,
      text: (el.innerText || '').slice(0, 60)
    }));
    const truncated = [...document.querySelectorAll('.ink-row-sub, .ink-preview-glyph, .ink-deck-name, .anki-deck-name')]
      .slice(0, 20).map((el) => ({ class: String(el.className || '').slice(0, 60), text: (el.innerText || '').slice(0, 80), title: el.title || null }));
    const empty = !!document.querySelector('.empty, .ink-empty, [class*="empty-state"]');
    const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => h.innerText.trim()).filter(Boolean).slice(0, 12);
    return { text, overflow, truncated, empty, headings };
  })()`);
  fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(info, null, 2));
  if (/untitled folder/i.test(info.text)) bugs.push({ type: 'content', where: label, msg: 'Shows "untitled folder"' });
  if (/\b37\s*\/\s*2\b/.test(info.text)) bugs.push({ type: 'content', where: label, msg: 'Anki shows 37/2' });
  if (/undefined|\[object Object\]|\bNaN\b/.test(info.text)) bugs.push({ type: 'content', where: label, msg: 'Leaked undefined/[object Object]/NaN', sample: info.text.match(/undefined|\[object Object\]|\bNaN\b/)?.[0] });
  const badOverflow = (info.overflow || []).filter((o) => o.sw > o.cw + 40 || o.sh > o.ch + 80);
  if (badOverflow.length) bugs.push({ type: 'layout', where: label, msg: 'Significant overflow', samples: badOverflow.slice(0, 5) });
  return info;
}

const nav = (route) => run(`document.querySelector('#nav button[data-route="${route}"]').click()`);
const clickText = (sel, text) => run(`(() => { const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x => (x.textContent||'').trim() === ${JSON.stringify(text)}); if(!b) throw new Error('missing '+${JSON.stringify(text)}); b.click(); })()`);

(async () => {
  await app.whenReady();
  for (let i = 0; i < 120 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await delay(50); }
  if (!win) throw new Error('no window');
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  win.setContentSize(1440, 900);
  await delay(500);
  await run('document.fonts.ready.then(() => true)');

  const steps = [];
  async function step(name, fn) {
    try {
      await fn();
      await shot(name);
      await probe(name);
      steps.push({ name, ok: true });
    } catch (e) {
      steps.push({ name, ok: false, error: String(e) });
      bugs.push({ type: 'tour', where: name, msg: String(e) });
      try { await shot(name + '-error'); } catch {}
    }
  }

  await step('01-library', async () => { await delay(300); });
  await step('02-learn-home', async () => { await nav('learn'); await delay(900); });
  for (const label of ['Kanji', 'Vocab', 'Grammar', 'Story', 'Stats', 'Study settings']) {
    await step('03-learn-' + label.toLowerCase(), async () => {
      await clickText('.learn-tabs > button, .learn-tabs [role="tab"]', label);
      await delay(900);
    });
  }
  await step('04-grammar-seeall', async () => {
    await clickText('.learn-tabs > button, .learn-tabs [role="tab"]', 'Grammar');
    await delay(600);
    await run(`(() => { const b=document.querySelector('.ink-seeall'); if(b) b.click(); })()`);
    await delay(1000);
  });
  await step('05-kanji-seeall', async () => {
    await clickText('.learn-tabs > button, .learn-tabs [role="tab"]', 'Kanji');
    await delay(600);
    await run(`(() => { const b=document.querySelector('.ink-seeall'); if(b) b.click(); })()`);
    await delay(1000);
  });
  await step('06b-learn-actions', async () => {
    await nav('learn'); await delay(800);
    await run(`(() => {
      const btns=[...document.querySelectorAll('button')];
      const start = btns.find(b => /start|lesson|Study|Review|Learn/i.test(b.textContent||''));
      if (start) start.click();
    })()`);
    await delay(1200);
  });
  await step('07-manga', async () => { await nav('manga'); await delay(1000); });
  await step('08-vocab', async () => { await nav('vocab'); await delay(800); });
  await step('09-anki', async () => { await nav('anki'); await delay(1500); });
  await step('10-anki-browse', async () => {
    await run(`(() => {
      const b=[...document.querySelectorAll('button,a,[role=tab]')].find(x => /browse|deck|cards/i.test(x.textContent||''));
      if (b) b.click();
    })()`);
    await delay(1000);
  });
  await step('11-settings', async () => { await nav('settings'); await delay(800); });
  await step('12-learn-settings', async () => {
    await nav('learn'); await delay(600);
    await clickText('.learn-tabs > button, .learn-tabs [role="tab"]', 'Study settings');
    await delay(800);
  });

  const report = { at: new Date().toISOString(), steps, bugs, consoleErrors: errors, dataDir, outDir };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ steps: steps.length, bugs: bugs.length, errors: errors.length, outDir }, null, 2));
  if (bugs.length) console.log('BUGS\n' + bugs.map((b) => JSON.stringify(b)).join('\n'));
  app.exit(0);
})().catch((e) => { console.error(e); try { fs.writeFileSync(path.join(outDir, 'fatal.json'), String(e)); } catch {} app.exit(1); });
