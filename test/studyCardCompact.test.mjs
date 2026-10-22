import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// Use the app's Chromium DOM rather than a mock selector implementation.
const require = createRequire(import.meta.url);
const root = resolve('.');
const fixtures = ['jp1k-card.json', 'jp1k-live-card.json'].map(name => JSON.parse(readFileSync(join(root, 'test/fixtures/study', name))));
const dir = mkdtempSync(join(tmpdir(), 'study-dom-'));
const runner = join(dir, 'check.cjs');
writeFileSync(runner, `
const {app,BrowserWindow}=require('electron');
app.whenReady().then(async()=>{
const w=new BrowserWindow({show:false,webPreferences:{webSecurity:false}});
await w.loadURL('file://' + ${JSON.stringify(join(root, 'src/renderer/index.html'))});
const result=await w.webContents.executeJavaScript('('+ ${JSON.stringify((async function () {
  const { studyDocument } = await import('./lib/studyPresentation.mjs');
  const cards = FIXTURES;
  const out = [];
  for (const card of cards) {
    const front = studyDocument(card, 'question');
    const back = studyDocument(card, 'answer');
    const parse = html => new DOMParser().parseFromString(html, 'text/html');
    const f = parse(front), b = parse(back);
    const frame = document.createElement('iframe');
    frame.style.width = '340px';
    document.body.append(frame);
    frame.srcdoc = front;
    await new Promise(resolve => frame.onload = resolve);
    const target = frame.contentDocument.querySelector('.am-target');
    const color = frame.contentWindow.getComputedStyle(target).color;
    const sentenceSize = frame.contentWindow.getComputedStyle(frame.contentDocument.querySelector('.am-sentence')).fontSize;
    frame.remove();
    out.push({
      spotlight: Boolean(f.querySelector('.am-spotlight')) && Boolean(b.querySelector('.am-spotlight')),
      count: f.querySelectorAll('.jpsentence').length,
      color, sentenceSize,
      chrome: b.querySelectorAll('.fside header, .fside .images-details, #pitchnum, #vocab-audio, #sent-audio').length,
      redPitch: [...b.querySelectorAll('.am-pitch [style]')].some(el => /red/.test(el.getAttribute('style'))),
      translation: b.querySelector('.ensentence')?.textContent,
      original: studyDocument(card, 'question', 'original').includes(card.question),
      originalTheme: studyDocument(card, 'question', 'original').includes('class="card am-card"'),
    });
  }
  const other = '<header>Custom</header><details open><summary>Other</summary>Keep me</details><div class="sentence">Unrelated</div>';
  const html = studyDocument({question: other, css: ''}, 'question');
  const nested = studyDocument({ question: '<div class="wrap"><section><div class="sent-center"><div class="jpsentence">Nested <b>target</b></div></div></section></div>' }, 'question');
  return { out, nested: Boolean(new DOMParser().parseFromString(nested, 'text/html').querySelector('.am-spotlight .am-sentence')), other: parseOther(html), untouched: new DOMParser().parseFromString(html, 'text/html').body.innerHTML === new DOMParser().parseFromString(other, 'text/html').body.innerHTML };
  function parseOther(html) { return new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.am-spotlight').length; }
}).toString().replace('FIXTURES', JSON.stringify(fixtures)))} +')()');
console.log('STUDY_RESULT:'+JSON.stringify(result)); app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
`);
let result;
try {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(require('electron'), [runner], { env, encoding: 'utf8', timeout: 60000 });
  const line = run.stdout?.split('\n').find(line => line.startsWith('STUDY_RESULT:'));
  assert.ok(line, `Chromium checks failed: ${run.stderr}\n${run.stdout}`);
  result = JSON.parse(line.slice('STUDY_RESULT:'.length));
} finally { rmSync(dir, { recursive: true, force: true }); }

for (const [i, name] of ['existing JP1K', 'live AJT JP1K'].entries()) {
  test(`${name}: ink matcher and single front sentence`, () => {
    assert.equal(result.out[i].spotlight, true);
    assert.equal(result.out[i].count, 1);
  });
  test(`${name}: template chrome removed; media/translation retained`, () => {
    assert.equal(result.out[i].chrome, 0);
    assert.ok(result.out[i].translation);
    assert.equal(result.out[i].redPitch, false);
  });
  test(`${name}: narrow iframe uses compact ink, never magenta`, () => {
    assert.equal(result.out[i].color, 'rgb(10, 10, 10)');
    assert.equal(result.out[i].sentenceSize, '30px');
  });
  test(`${name}: original style remains untouched`, () => {
    assert.equal(result.out[i].original, true);
    assert.equal(result.out[i].originalTheme, false);
  });
}
test('JP1K matcher accepts prompt wrappers', () => assert.equal(result.nested, true));
test('unmatched note types keep their raw template', () => {
  assert.equal(result.untouched, true);
  assert.equal(result.other, 0);
});
