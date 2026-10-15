const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServices } = require('../src/main/services');
const { MangaLibrary } = require('../src/core/manga');

const ROOT = path.join(__dirname, '..', 'src', 'main');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const MAIN_SOURCE = ['services.js', 'features.js', 'mangaHandlers.js', 'vocabHandlers.js']
  .map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'))
  .join('\n');
const PREFIX = '(?:manga|vocab|corpus|kanjidic|examples):[^\'"]+';
const channelsOf = (method) => [...PRELOAD.matchAll(new RegExp(`${method}\\('(${PREFIX})'\\)`, 'g'))].map((m) => m[1]);
const dirs = [];

after(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

function setup({ log = { ensured: [], cards: [] } } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jpdb-wiring-'));
  dirs.push(dataDir);
  const services = createServices({
    dataDir,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    notify: () => {},
    deps: {
      Library: class FakeLibrary {
        getFolders() {
          return [];
        }

        async scan() {
          return [];
        }

        getSubtitle() {
          return null;
        }

        watchDownloads() {
          return () => {};
        }
      },
      Dictionary: class FakeDictionary {
        isReady() {
          return false;
        }
      },
      AnkiClient: class FakeAnkiClient {
        async ping() {
          return true;
        }

        async ensureSetup(deck) {
          log.ensured.push(deck);
        }

        async addCard(card) {
          log.cards.push(card);
          return 42;
        }
      },
    },
  });
  return { dataDir, services, log };
}

test('every preload invoke for the new prefixes has a registered handler', () => {
  const { services } = setup();
  const channels = channelsOf('invoke');
  assert.equal(channels.length, 25);
  assert.deepEqual(channels.filter((channel) => typeof services.handlers[channel] !== 'function'), []);
});

test('every preload subscribe for the new prefixes is notified by main-process code', () => {
  const channels = channelsOf('subscribe');
  assert.deepEqual(channels.sort(), [
    'corpus:progress',
    'examples:progress',
    'kanjidic:progress',
    'manga:indexProgress',
  ]);
  for (const channel of channels) {
    const notified = new RegExp(`notify\\(\\s*'${channel}'`);
    assert.match(MAIN_SOURCE, notified, `${channel} is never notified`);
  }
});

test('manga defaults to AI OCR off', () => {
  const { services } = setup();
  return services.handlers['settings:get']().then((settings) => {
    assert.deepEqual(settings.manga, { aiOcr: false });
  });
});

test('manga:mine reaches AnkiConnect with the manga deck, source and picture name', async () => {
  const { dataDir, services, log } = setup();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jpdb-manga-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'Series A', 'Vol 1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Series A', 'Vol 1', '001.jpg'), JPEG);
  new MangaLibrary(dataDir).addFolder(root);
  const [series] = await services.handlers['manga:getSeries']();

  const picture = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
  const result = await services.handlers['manga:mine']({
    seriesId: series.id,
    volId: series.volumes[0].id,
    index: 0,
    sentence: 'ページ',
    word: null,
    picture,
  });

  assert.deepEqual(result, { noteId: 42 });
  assert.deepEqual(log.ensured, ['Anime Mining::Manga::Series A']);
  const [card] = log.cards;
  assert.equal(card.deck, 'Anime Mining::Manga::Series A');
  assert.equal(card.duplicateRoot, 'Anime Mining');
  assert.equal(card.fields.Source, 'Series A');
  assert.equal(card.fields.Sentence, 'ページ');
  assert.equal(card.audio, undefined);
  assert.match(card.picture.filename, /^am_\d+\.jpg$/);
  assert.deepEqual(card.picture.data, JPEG);
});
