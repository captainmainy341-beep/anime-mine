import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const main = source('src/main/main.js');
const kit = source('src/renderer/css/ink-kit.css');
const anki = source('src/renderer/css/ink-anki.css');

test('every window resets persisted zoom on DOM ready and finished loads', () => {
  const listeners = {};
  const calls = [];
  const contents = {
    on: (name, cb) => { listeners[name] = cb; },
    setZoomFactor: (n) => calls.push(['factor', n]),
    setVisualZoomLevelLimits: (...args) => calls.push(['limits', ...args]),
    setWindowOpenHandler() {},
  };
  const create = main.slice(main.indexOf('function createWindow()'), main.indexOf('\nfunction registerHandlers'));
  vm.runInNewContext(`${create}; createWindow();`, {
    BrowserWindow: function () { return { webContents: contents, loadFile() {} }; },
    path: { join() {} }, __dirname: '', APP_FILE: 'app', isAppUrl: () => true,
  });
  for (const name of ['dom-ready', 'did-finish-load']) listeners[name]();
  assert.deepEqual(calls, [['factor', 1], ['limits', 1, 1], ['factor', 1], ['limits', 1, 1]]);
  for (const key of ['+', '=', '-', '_', '0']) {
    let blocked = false;
    listeners['before-input-event']({ preventDefault() { blocked = true; } }, { key, meta: true });
    assert.equal(blocked, true, key);
  }
  let blocked = false;
  listeners['before-input-event']({ preventDefault() { blocked = true; } }, { key: 'c', meta: true });
  assert.equal(blocked, false, 'native editing shortcuts are unaffected');
});

test('native menu omits zoom roles but retains devtools and editing', () => {
  assert.doesNotMatch(main, /role:\s*['"](?:zoomIn|zoomOut|resetZoom|viewMenu)['"]/);
  for (const role of ['appMenu', 'editMenu', 'windowMenu', 'toggleDevTools']) assert.ok(main.includes(`role: '${role}'`));
});

test('Sync uses filled ink primary styling', () => {
  assert.match(source('src/renderer/anki.mjs'), /actionButton\('sync', 'Sync', syncNow, 'is-primary'\)/);
  assert.match(anki, /\.ink-anki-btn\.is-primary\s*\{[^}]*background: var\(--ink\);[^}]*color: var\(--paper\);/);
});

test('compact deck panels fit five complete rows and keep extra decks internally scrollable', () => {
  const compact = anki.split('@media (max-width: 1300px) {')[1].split('@media (max-width: 720px)')[0];
  const height = (selector) => Number(compact.match(new RegExp(`${selector} \\{ height: (\\d+)px;`))[1]);
  const panelHeight = height('\\.anki \\.ink-anki-decks');
  assert.equal(panelHeight, height('\\.anki \\.ink-anki-glance'), 'paired panels stay aligned');
  const rowHeight = height('\\.anki \\.ink-deck-row');
  // Border-box budget: panel borders (3), padding (32), caption (36), table gap (16),
  // table borders (3), header (36), actions gap (12), buttons (40).
  const bodyHeight = panelHeight - (3 + 32 + 36 + 16 + 3 + 36 + 12 + 40);
  assert.ok(bodyHeight >= 5 * rowHeight, `${bodyHeight}px body must fit five ${rowHeight}px rows`);
  assert.match(anki, /\.anki \.ink-deck-body\s*\{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(anki, /\.anki \.ink-anki-actions\s*\{[^}]*flex: none;/, 'actions cannot shrink when decks overflow');
  assert.match(anki, /\.anki \.ink-anki-decks\s*\{[^}]*height: 500px;/, 'desktop height is unchanged');
});

test('compact tier is shared, bounded and does not wrap the Anki strip', () => {
  for (const css of [kit, anki, source('src/renderer/css/ink-theme.css')]) assert.ok(css.includes('@media (max-width: 1300px)'));
  assert.match(kit, /\.ink-screen \{ padding: 18px 20px 22px 18px; \}/);
  assert.match(kit, /padding: 0 36px; white-space: nowrap;/);
  assert.match(anki, /\.ink-anki-stat \{ min-width: 0; overflow: hidden;/);
  assert.match(anki, /font-size: clamp\(20px, 2\.3vw, 30px\)/);
  assert.doesNotMatch(anki, /\.ink-anki-strip\s*\{[^}]*flex-wrap: wrap/);
  assert.match(anki, /height: 25px;\s*min-height: 25px;/);
  assert.match(anki, /grid-template-columns: 640fr 528fr;/, 'full-size layout retained');
});
