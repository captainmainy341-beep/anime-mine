const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MangaLibrary } = require('../src/core/manga');
const { PdfRenderer } = require('../src/core/pdf');

async function setup(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'manga-pdf-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function touch(file, content = 'pdf') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function minimalPdf(pageCount) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>'),
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = Buffer.byteLength(body);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

const fakePdf = {
  pageCount: file => (file.endsWith('Broken.pdf') ? 0 : 3),
  renderPage: (file, index) => Buffer.from(`png${index}`),
};

test('a pdf file is one volume with one image page per pdf page', async t => {
  const root = await setup(t);
  const series = path.join(root, 'Series P');
  touch(path.join(series, 'Vol 1.pdf'));
  touch(path.join(series, 'Vol 2.PDF'));
  touch(path.join(series, 'Broken.pdf'));

  const library = new MangaLibrary(path.join(root, 'data'), { pdf: fakePdf });
  library.addFolder(root);
  const [found] = library.scan();
  const volumes = found.volumes.map(v => [v.title, v.kind, v.pageCount]);
  assert.deepEqual(volumes, [['Vol 1.pdf', 'pdf', 3], ['Vol 2.PDF', 'pdf', 3]]);

  const [volume] = found.volumes;
  assert.deepEqual(library.pages(found.id, volume.id), [
    { index: 0, name: '0001.png' },
    { index: 1, name: '0002.png' },
    { index: 2, name: '0003.png' },
  ]);
});

test('readPage returns rendered png bytes for a pdf page', async t => {
  const root = await setup(t);
  touch(path.join(root, 'Series P', 'Vol 1.pdf'));

  const library = new MangaLibrary(path.join(root, 'data'), { pdf: fakePdf });
  library.addFolder(root);
  const [found] = library.scan();
  const volume = found.volumes[0];

  const page = library.readPage(found.id, volume.id, 1);
  assert.equal(page.kind, 'bytes');
  assert.equal(page.mime, 'image/png');
  assert.equal(page.data.toString(), 'png1');
});

test('pageKey differs per pdf page', async t => {
  const root = await setup(t);
  touch(path.join(root, 'Series P', 'Vol 1.pdf'));

  const library = new MangaLibrary(path.join(root, 'data'), { pdf: fakePdf });
  library.addFolder(root);
  const [found] = library.scan();
  const volume = found.volumes[0];

  const keys = [0, 1, 2].map(index => library.pageKey(found.id, volume.id, index));
  assert.equal(new Set(keys).size, 3);
});

test('a pdf with no renderable pages is omitted', async t => {
  const root = await setup(t);
  touch(path.join(root, 'Series P', 'Broken.pdf'));

  const library = new MangaLibrary(path.join(root, 'data'), { pdf: fakePdf });
  library.addFolder(root);
  assert.deepEqual(library.scan(), []);
});

test('PdfRenderer renders a real two-page pdf to png on macOS', { skip: process.platform !== 'darwin' }, async t => {
  const root = await setup(t);
  const file = touch(path.join(root, 'two.pdf'), minimalPdf(2));

  const renderer = new PdfRenderer(path.join(root, 'data'));
  assert.equal(renderer.pageCount(file), 2);

  const png = renderer.renderPage(file, 0);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 1500);
  assert.equal(png.readUInt32BE(20), 2000);
});
