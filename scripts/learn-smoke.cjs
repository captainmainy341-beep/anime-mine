// Run: node_modules/.bin/electron scripts/learn-smoke.cjs
// Boots the real main/preload/renderer with isolated data. Never reads personal decks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = process.env.ANIME_MINE_APP_ROOT || path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-learn-smoke-'));
const { buildPack } = require(path.join(root, 'src/core/studyPack'));
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../test/fixtures/study', name), 'utf8'));
const pack = buildPack({ kanjidic: fixture('kanjidic.json'), kradfile: fixture('kradfile.json'), examples: fixture('examples.json') });
fs.writeFileSync(path.join(dataDir, 'study-pack.json'), JSON.stringify(pack));
const { LearnStore } = require(path.join(root, 'src/core/learnStore'));
const seeded = new LearnStore({ dataDir, pack, now: () => Date.now() - 24 * 3600000 });
seeded.addCustomWord({ word: '猫', kana: ['ねこ'], meanings: ['cat'] });
seeded.completeLessons(['c:猫']);
app.setPath('userData', dataDir);
const errors = [];
app.on('web-contents-created', (_, contents) => {
  contents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
});
app.on('browser-window-created', (_, win) => win.hide());
require(path.join(root, 'src/main/main.js'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const evaluate = fn => win.webContents.executeJavaScript(`(${fn.toString()})()`);
async function waitFor(fn, label) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(fn)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}\n${await evaluate(() => document.querySelector('#view').innerText)}`);
}
async function tab(name) {
  await win.webContents.executeJavaScript(`(() => {const b = [...document.querySelectorAll('.learn-tabs > button')].find(b => b.textContent === ${JSON.stringify(name)}); if (!b) throw new Error('Missing tab'); b.click();})()`);

}
// Explore screens put the full course behind See all. Grammar and the Kanji level grid are only reachable there
// now. The Explore view loads its data over IPC, so wait for the button before clicking; when a slice still mounts
// its full view directly (no Explore screen), leave the current view alone.
async function seeAll() {
  let directSeen = 0;
  for (let i = 0; i < 80; i++) {
    const state = await evaluate(() => {
      const button = document.querySelector('.ink-seeall');
      if (button && button.getClientRects().length) {
        button.click();
        return 'clicked';
      }
      // S3 renders a loading host first; S2 swaps in the Explore screen when its data arrives.
      if (document.querySelector('.learn-explore-host, .ink-explore')) return 'loading';
      if (document.querySelector('.learn-g, .learn-level, .learn-browse')) return 'direct';
      return 'waiting';
    });
    if (state === 'clicked') {
      await delay(150);
      return true;
    }
    // A slice that still mounts its full course/browse view directly has no Explore screen to click through.
    if (state === 'direct') {
      directSeen += 1;
      if (directSeen >= 3) return false;
    } else {
      directSeen = 0;
    }
    await delay(50);
  }
  return false;
}
async function screenshot(name) {
  if (!process.env.ANIME_MINE_SCREENSHOTS) return;
  fs.mkdirSync(process.env.ANIME_MINE_SCREENSHOTS, { recursive: true });
  await delay(150);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(process.env.ANIME_MINE_SCREENSHOTS, `${name}.png`), image.toPNG());
}
(async () => {
  await app.whenReady();
  for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await delay(50); }
  assert.ok(win, 'main created a window');
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  if (process.env.ANIME_MINE_WINDOW_SIZE) {
    const [width,height] = process.env.ANIME_MINE_WINDOW_SIZE.split(',').map(Number);
    win.setContentSize(width,height);
    await delay(200);
  }
  await evaluate(() => {
    window.addEventListener('error', event => { window.smokeErrors ??= []; window.smokeErrors.push(event.message); });
    window.addEventListener('unhandledrejection', event => { window.smokeErrors ??= []; window.smokeErrors.push(String(event.reason)); });
    document.querySelector('[data-route="learn"]').click();
  });
  await waitFor(() => !!document.querySelector('.learn-home .learn-actions'), 'Learn dashboard');
  assert.equal(await evaluate(async () => (await window.api.learn.status()).grammar.ready), true);
  assert.equal(await evaluate(() => [...document.querySelectorAll('.home-stage')].every(el => el.getBoundingClientRect().height < 50)), true, 'SRS counts must stay compact');
  console.log('PASS Learn home and real IPC');
  await screenshot('home');
  await tab('Grammar');
  await seeAll();
  await waitFor(() => !!document.querySelector('.learn-g-row'), 'grammar browser');
  console.log('PASS grammar browser');
  await screenshot('grammar');
  const beforePractice = fs.readFileSync(path.join(dataDir, 'learn.json'), 'utf8');
  await evaluate(() => [...document.querySelectorAll('.learn-g-tab')].find(b => b.textContent === 'N4').click());
  await waitFor(() => document.querySelector('.course-title')?.textContent === '〜たことがある', 'N4 course content');
  await screenshot('grammar-n4');
  await evaluate(() => [...document.querySelectorAll('.course-practice-tools button')].find(b => b.textContent === 'Need a hint?').click());
  assert.equal(await evaluate(() => document.querySelector('.course-hint').hidden), false);
  await evaluate(() => [...document.querySelectorAll('.course-practice-tools button')].find(b => b.textContent === 'Show answer').click());
  assert.equal(await evaluate(() => document.querySelector('.course-practice').classList.contains('correct')), false, 'revealing is not a scored correct answer');
  await evaluate(() => [...document.querySelectorAll('.course-practice-tools button')].find(b => b.textContent === 'Try again').click());
  await evaluate(() => { const input = document.querySelector('.course-answer'); input.value = '違う'; input.closest('form').requestSubmit(); });
  await waitFor(() => document.querySelector('.course-practice').classList.contains('incorrect'), 'incorrect practice feedback');
  await evaluate(() => { const input = document.querySelector('.course-answer'); input.value = 'いったことがあります'; input.closest('form').requestSubmit(); });
  await waitFor(() => document.querySelector('.course-practice').classList.contains('correct'), 'kana answer accepted');
  assert.equal(fs.readFileSync(path.join(dataDir, 'learn.json'), 'utf8'), beforePractice, 'quick practice must never change SRS or progress');
  await screenshot('grammar-feedback');
  await evaluate(() => [...document.querySelectorAll('.course-practice-tools button')].find(b => b.textContent === 'Try again').click());
  assert.equal(await evaluate(() => document.querySelector('.course-answer').readOnly), false);
  await evaluate(() => document.querySelector('.course-point-nav button:last-child').click());
  await waitFor(() => document.querySelector('.course-title')?.textContent === '〜たり〜たりする', 'next real pattern');
  await evaluate(() => { const search = document.querySelector('.learn-g-search'); search.value = 'no-matching-pattern'; search.dispatchEvent(new Event('input', { bubbles:true })); });
  await waitFor(() => !!document.querySelector('.course-empty'), 'recoverable empty search');
  await evaluate(() => { const search = document.querySelector('.learn-g-search'); search.value = ''; search.dispatchEvent(new Event('input', { bubbles:true })); });
  await waitFor(() => !!document.querySelector('.course-answer'), 'search recovery');
  await evaluate(() => [...document.querySelectorAll('.learn-g-tab')].find(b => b.textContent === 'N5').click());
  await waitFor(() => document.querySelector('.course-title')?.textContent === '〜は〜です', 'N5 restored');
  // Check narrower Electron geometry, not just screenshot success.
  win.setContentSize(600, 850);
  await delay(200);
  await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no narrow-window overflow');
  await screenshot('grammar-narrow');
  win.setContentSize(1280, 768);
  await delay(200);
  await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  console.log('PASS trail selection, hints, kana practice, no SRS writes, search recovery and narrow geometry');
  await evaluate(() => document.querySelector('.learn-g-row').click());
  await waitFor(() => !!document.querySelector('.learn-g-point .learn-g-actions button'), 'grammar detail');
  await evaluate(() => document.querySelector('.learn-g-point .learn-g-actions button').click());
  await waitFor(() => [...document.querySelectorAll('.learn-s-screen button')].some(b => b.textContent === 'Start quiz'), 'grammar lesson');
  await evaluate(() => [...document.querySelectorAll('.learn-s-screen button')].find(b => b.textContent === 'Start quiz').click());
  await waitFor(() => !!document.querySelector('.learn-s-input'), 'lesson quiz');
  await evaluate(async () => {
    const [card] = await window.api.learn.lessons({ scope: 'grammar', ids: [(await window.api.learn.browse({ type: 'grammar', jlpt: 'N5' }))[0].id] });
    const input = document.querySelector('.learn-s-input');
    input.value = card.cloze.answers[0];
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await waitFor(() => [...document.querySelectorAll('.learn-s-screen button')].some(b => b.textContent === 'Next'), 'checked cloze');
  await evaluate(() => [...document.querySelectorAll('.learn-s-screen button')].find(b => b.textContent === 'Next').click());
  await waitFor(() => document.querySelector('#view').innerText.includes('Batch complete'), 'lesson completion');
  assert.ok((await evaluate(() => document.querySelector('#view').innerText)).includes('1 item started'), 'lesson summary reports a numeric count');
  console.log('PASS grammar lesson, cloze quiz and persistence');
  await tab('Grammar');
  await seeAll();
  await waitFor(() => !!document.querySelector('.learn-g-row'), 'grammar after lesson');
  await evaluate(() => document.querySelector('.learn-g-row').click());
  await waitFor(() => !!document.querySelector('.learn-g-status'), 'started grammar detail');
  assert.ok((await evaluate(() => document.querySelector('.learn-g-status').innerText)).includes('Beginner (stage 1)'));
  console.log('PASS started grammar status');
  await tab('Kanji');
  await seeAll();
  await waitFor(() => !!document.querySelector('.learn-level'), 'kanji levels');
  await evaluate(() => document.querySelector('.learn-level').click());
  await waitFor(() => !!document.querySelector('.learn-tile'), 'kanji tiles');
  await evaluate(() => document.querySelector('.learn-tile').click());
  await waitFor(() => !!document.querySelector('.learn-cv-block'), 'kanji details');
  assert.ok(!(await evaluate(() => document.querySelector('#view').innerText)).includes('is not a function'));
  console.log('PASS kanji levels and item details');
  await screenshot('kanji-detail');
  await evaluate(() => {
    document.querySelector('.learn-cv-field input').value = 'trial synonym';
    [...document.querySelectorAll('.learn-cv-btn')].find(b => b.textContent === 'Save').click();
  });
  await waitFor(() => [...document.querySelectorAll('.learn-cv-field input')].some(input => input.value === 'trial synonym'), 'notes update');
  // Wait for the real IPC write, rather than trusting the unchanged input value.
  for (let i = 0; i < 100 && !Object.values(JSON.parse(fs.readFileSync(path.join(dataDir, 'learn.json'), 'utf8')).userData).some(d => d.synonyms?.includes('trial synonym')); i++) await delay(50);
  assert.ok(Object.values(JSON.parse(fs.readFileSync(path.join(dataDir, 'learn.json'), 'utf8')).userData).some(d => d.synonyms?.includes('trial synonym')));
  await tab('Kanji');
  await seeAll();
  await evaluate(() => [...document.querySelectorAll('.learn-browse-type')].find(b => b.textContent === 'Mined words').click());
  await waitFor(() => !!document.querySelector('.learn-mined-form'), 'mined word form');
  await evaluate(() => {
    const form = document.querySelector('.learn-mined-form');
    const fields = [...form.querySelectorAll('input')];
    ['犬', 'いぬ', 'dog', '犬です。'].forEach((value, i) => fields[i].value = value);
    form.requestSubmit();
  });
  await waitFor(() => document.querySelector('.learn-mined-list')?.innerText.includes('犬'), 'custom vocabulary saved');
  console.log('PASS notes and custom vocabulary');
  await tab('Home');
  await waitFor(() => !!document.querySelector('.learn-home .learn-actions'), 'home before reviews');
  await evaluate(() => [...document.querySelectorAll('.learn-home button')].find(b => b.textContent === 'Kanji & vocab reviews').click());
  await waitFor(() => !!document.querySelector('.learn-s-input'), 'due review');
  // Answer both questions; exercise the incorrect-answer override on whichever is first.
  for (let q = 0; q < 2; q++) {
    await evaluate(() => {
      const input = document.querySelector('.learn-s-input');
      input.value = input.lang === 'en' ? 'wrong' : 'あ';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      [...document.querySelectorAll('.learn-s-screen button')].find(b => b.textContent === 'I was right').click();
      [...document.querySelectorAll('.learn-s-screen button')].find(b => b.textContent === 'Next').click();
    });
  }
  await waitFor(() => document.querySelector('#view').innerText.includes('Session complete'), 'review completion');
  const cat = await evaluate(() => window.api.learn.card('c:猫'));
  assert.equal(cat.stage, 2, 'one review must advance exactly one stage');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'learn.json'), 'utf8')).items['c:猫'].incorrect, 0, 'override must remove the mistake');
  console.log('PASS due review, override and single SRS transition');
  await tab('Kanji');
  await seeAll();
  await waitFor(() => !!document.querySelector('.learn-level'), 'levels before started item');
  await evaluate(() => [...document.querySelectorAll('.learn-browse-type')].find(b => b.textContent === 'Mined words').click());
  await waitFor(() => !!document.querySelector('.learn-mined-word'), 'mined list');
  await evaluate(() => [...document.querySelectorAll('.learn-mined-word')].find(b => b.textContent === '猫').click());
  await waitFor(() => !!document.querySelector('.learn-item-stage'), 'started word detail');
  assert.ok((await evaluate(() => document.querySelector('.learn-item-stage').textContent)).includes('Apprentice (stage 2)'));
  console.log('PASS started vocabulary status');
  await tab('Stats');
  await waitFor(() => !!document.querySelector('.learn-stats .learn-big'), 'stats');
  console.log('PASS stats');
  await tab('Study settings');
  await waitFor(() => !!document.querySelector('.learn-settings form'), 'settings');
  await evaluate(() => document.querySelector('.learn-settings form').requestSubmit());
  await waitFor(() => [...document.querySelectorAll('#toasts *')].some(el => el.textContent === 'Learn settings saved'), 'save settings');
  console.log('PASS settings save');
  await tab('Home');
  await waitFor(() => !!document.querySelector('.learn-home .learn-actions'), 'return home');
  await evaluate(() => document.querySelector('[data-route="anki"]').click());
  await waitFor(() => !!document.querySelector('.anki'), 'Anki privacy');
  assert.equal(await evaluate(async () => (await window.api.anki.getView()).mode), 'hidden');
  assert.deepEqual(errors, []);
  assert.deepEqual(await evaluate(() => window.smokeErrors || []), []);
  console.log('PASS Anki remains hidden; no renderer errors');
  app.exit(0);
})().catch(err => { console.error(err.stack); app.exit(1); });
