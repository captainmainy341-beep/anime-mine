import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'docs', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'docs', 'site.css'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'pages.yml'), 'utf8');

test('the Pages site explains Anime Mine and how to build it', () => {
  assert.match(html, /Anime Mine/);
  assert.match(html, /already own/);
  assert.match(html, /Anki/);
  assert.match(html, /macOS beta/);
  assert.match(html, /MIT/);
  assert.match(html, /not notarized/);
  assert.match(html, /npm install/);
  assert.match(html, /npm start/);
  assert.match(html, /scripts\/package-mac\.sh/);
  assert.match(html, /ai\.animemine\.app/);
  assert.match(html, /https:\/\/github\.com\/captainmainy341-beep\/anime-mine"/);
  assert.match(html, /extension\/README\.md/);
  assert.match(html, /href="site\.css"/);
  assert.equal(fs.existsSync(path.join(root, 'docs', '.nojekyll')), true);
});

test('the site uses the ink palette and does not advertise a pirate demo or a notarized download', () => {
  for (const color of ['#F5F2EA', '#0A0A0A', '#FF2E6E']) {
    assert.match(css, new RegExp(color, 'i'));
  }
  const blob = `${html}\n${css}`;
  assert.doesNotMatch(blob, /animepahe/i);
  assert.doesNotMatch(blob, /torrent/i);
  assert.doesNotMatch(blob, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  assert.doesNotMatch(blob, /▶|⛏|✦/);
  assert.doesNotMatch(html, /download the app/i);
  assert.match(html, /no notarized binary/i);
});

test('GitHub Actions publishes the docs folder', () => {
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path:\s*docs/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
});
