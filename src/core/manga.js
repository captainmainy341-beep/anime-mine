const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require('fflate');
const { PdfRenderer } = require('./pdf');

const IMAGE_MIME = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.bmp', 'image/bmp'],
]);
const ARCHIVE_EXTS = new Set(['.cbz', '.zip']);
const IGNORED = new Set(['__MACOSX', 'Thumbs.db']);
const DEFAULT_PROGRESS = { page: 0, direction: 'rtl', spread: false };
const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;
const MAX_ARCHIVE_ENTRIES = 5000;
const MAX_PAGE_BYTES = 64 * 1024 ** 2;

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const naturalCompare = (a, b) => collator.compare(a, b);

const shortHash = text => crypto.createHash('sha1').update(text).digest('hex').slice(0, 12);

const stampOf = file => {
  try {
    const { mtimeMs, size } = fs.statSync(file);
    return `${mtimeMs}:${size}`;
  } catch {
    return null;
  }
};

const isIgnored = name => name.startsWith('.') || IGNORED.has(name);
const mimeOf = name => IMAGE_MIME.get(path.extname(name).toLowerCase()) ?? null;
const isArchive = name => ARCHIVE_EXTS.has(path.extname(name).toLowerCase());
const isPdf = name => path.extname(name).toLowerCase() === '.pdf';

function isSafeEntryName(name) {
  const normalized = name.replace(/\\/g, '/');
  if (path.posix.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized)) return false;
  return !normalized.split('/').includes('..');
}

const archiveCache = new Map();

function archiveEntries(file) {
  const stat = fs.statSync(file);
  if (stat.size > MAX_ARCHIVE_BYTES) throw new Error(`archive is larger than 2 GiB: ${file}`);
  const cached = archiveCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.entries;
  const listed = [];
  unzipSync(fs.readFileSync(file), {
    filter: entry => {
      if (listed.length >= MAX_ARCHIVE_ENTRIES) throw new Error(`archive has more than ${MAX_ARCHIVE_ENTRIES} entries: ${file}`);
      listed.push({ name: entry.name, size: entry.originalSize });
      return false;
    },
  });
  const entries = listed
    .filter(({ name }) => !name.endsWith('/') && !isIgnored(path.posix.basename(name)) && mimeOf(name))
    .filter(({ name }) => isSafeEntryName(name))
    .map(({ name, size }) => ({ name, size, mime: mimeOf(name) }))
    .sort((a, b) => naturalCompare(a.name, b.name));
  archiveCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, entries });
  return entries;
}

function directoryEntries(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && !isIgnored(entry.name) && mimeOf(entry.name))
    .map(entry => {
      const full = path.join(dir, entry.name);
      return { name: entry.name, size: fs.statSync(full).size, mime: mimeOf(entry.name) };
    })
    .sort((a, b) => naturalCompare(a.name, b.name));
}

function hasDirectPages(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .some(entry => entry.isFile() && !isIgnored(entry.name) && (mimeOf(entry.name) || isArchive(entry.name) || isPdf(entry.name)));
}

function childDirectories(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !isIgnored(entry.name))
    .map(entry => path.join(dir, entry.name));
}

function relativeId(root, target) {
  return path.relative(root, target).split(path.sep).join('/') || '.';
}

function idOf(root, target) {
  return shortHash(`${fs.realpathSync(root)}\0${relativeId(root, target)}`);
}

class MangaLibrary {
  #scanMemo = null;
  #stamps = new Map();
  #pageEntriesCache = new Map();

  constructor(dataDir, { pdf = new PdfRenderer(dataDir) } = {}) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'manga.json');
    this.progressFile = path.join(dataDir, 'manga-progress.json');
    this.pdf = pdf;
  }

  load() {
    const saved = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : {};
    return { folders: [], ...saved };
  }

  save(data) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, this.file);
  }

  getFolders() {
    return this.load().folders;
  }

  addFolder(dir) {
    const data = this.load();
    const folder = path.resolve(dir);
    if (data.folders.includes(folder)) return;
    data.folders.push(folder);
    this.save(data);
    this.invalidate();
  }

  removeFolder(dir) {
    const data = this.load();
    const folder = path.resolve(dir);
    data.folders = data.folders.filter(item => item !== folder);
    this.save(data);
    this.invalidate();
  }

  invalidate() {
    this.#scanMemo = null;
  }

  #stamp(file) {
    this.#stamps.set(file, stampOf(file));
  }

  scan() {
    const folders = this.getFolders();
    const key = JSON.stringify(folders);
    const memo = this.#scanMemo;
    if (memo?.key === key && [...memo.stamps].every(([file, stamp]) => stampOf(file) === stamp)) return memo.series;
    this.#stamps = new Map();
    const series = folders.flatMap(root => this.scanRoot(root));
    this.#scanMemo = { key, stamps: this.#stamps, series };
    return series;
  }

  scanRoot(root) {
    this.#stamp(root);
    if (!fs.existsSync(root)) return [];
    const series = hasDirectPages(root)
      ? [this.series(root, root)]
      : childDirectories(root).map(dir => this.series(root, dir));
    return series.filter(item => item.volumes.length > 0);
  }

  series(root, dir) {
    this.#stamp(dir);
    return {
      id: idOf(root, dir),
      title: path.basename(dir),
      volumes: this.volumes(root, dir),
    };
  }

  volumes(root, dir) {
    const volumes = [];
    for (const child of childDirectories(dir)) {
      this.#stamp(child);
      const pageCount = directoryEntries(child).length;
      if (pageCount > 0) volumes.push(this.volumeRecord(root, child, 'dir', pageCount));
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || isIgnored(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (isArchive(entry.name)) {
        this.#stamp(full);
        const pageCount = archiveEntries(full).length;
        if (pageCount > 0) volumes.push(this.volumeRecord(root, full, 'cbz', pageCount));
      } else if (isPdf(entry.name)) {
        this.#stamp(full);
        const pageCount = this.pdf.pageCount(full);
        if (pageCount > 0) volumes.push(this.volumeRecord(root, full, 'pdf', pageCount));
      }
    }
    if (volumes.length === 0) {
      const pageCount = directoryEntries(dir).length;
      if (pageCount > 0) volumes.push(this.volumeRecord(root, dir, 'dir', pageCount));
    }
    return volumes.sort((a, b) => naturalCompare(a.title, b.title));
  }

  volumeRecord(root, full, kind, pageCount) {
    return {
      id: idOf(root, full),
      title: path.basename(full),
      kind,
      path: full,
      pageCount,
    };
  }

  findVolume(seriesId, volId) {
    const series = this.scan().find(item => item.id === seriesId);
    const volume = series?.volumes.find(item => item.id === volId);
    if (!volume) throw new Error(`volume not found: ${seriesId}/${volId}`);
    return volume;
  }

  pageEntries(volume) {
    const stamp = stampOf(volume.path);
    const cached = this.#pageEntriesCache.get(volume.path);
    if (cached?.stamp === stamp) return cached.entries;
    const listed = volume.kind === 'pdf'
      ? Array.from({ length: volume.pageCount }, (_, page) => ({ name: `${String(page + 1).padStart(4, '0')}.png`, size: 0, mime: 'image/png' }))
      : volume.kind === 'cbz' ? archiveEntries(volume.path) : directoryEntries(volume.path);
    const entries = listed.map((entry, index) => ({ index, ...entry }));
    this.#pageEntriesCache.set(volume.path, { stamp, entries });
    return entries;
  }

  pages(seriesId, volId) {
    return this.pageEntries(this.findVolume(seriesId, volId)).map(({ index, name }) => ({ index, name }));
  }

  readPage(seriesId, volId, index) {
    const volume = this.findVolume(seriesId, volId);
    const page = this.pageEntries(volume)[index];
    if (!page) throw new Error(`page out of range: ${index}`);
    if (volume.kind === 'dir') {
      return { kind: 'file', path: path.join(volume.path, page.name), mime: page.mime };
    }
    if (volume.kind === 'pdf') {
      return { kind: 'bytes', data: this.pdf.renderPage(volume.path, index), mime: 'image/png' };
    }
    const extracted = unzipSync(fs.readFileSync(volume.path), {
      filter: entry => {
        if (entry.name !== page.name) return false;
        if (entry.originalSize > MAX_PAGE_BYTES || entry.size > MAX_PAGE_BYTES) throw new Error(`page is too large to extract: ${page.name} declares ${entry.originalSize} bytes`);
        return true;
      },
    });
    const bytes = extracted[page.name];
    if (bytes.byteLength > MAX_PAGE_BYTES) throw new Error(`page is too large to extract: ${page.name}`);
    return {
      kind: 'bytes',
      data: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      mime: page.mime,
    };
  }

  pageKey(seriesId, volId, index) {
    const volume = this.findVolume(seriesId, volId);
    const page = this.pageEntries(volume)[index];
    if (!page) throw new Error(`page out of range: ${index}`);
    if (volume.kind === 'pdf') {
      return crypto.createHash('sha1').update(`${volume.id}|${page.name}|pdf|${fs.statSync(volume.path).size}|${fs.statSync(volume.path).mtimeMs}`).digest('hex');
    }
    const { size, mtimeMs } = volume.kind === 'cbz'
      ? { size: page.size, mtimeMs: fs.statSync(volume.path).mtimeMs }
      : fs.statSync(path.join(volume.path, page.name));
    return crypto.createHash('sha1').update(`${volume.id}|${page.name}|${size}|${mtimeMs}`).digest('hex');
  }

  loadProgress() {
    return fs.existsSync(this.progressFile) ? JSON.parse(fs.readFileSync(this.progressFile, 'utf8')) : {};
  }

  saveProgress(data) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temp = `${this.progressFile}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, this.progressFile);
  }

  getProgress(volId) {
    return { ...DEFAULT_PROGRESS, ...this.loadProgress()[volId] };
  }

  setProgress(volId, { page, direction, spread }) {
    if (direction !== undefined && direction !== 'rtl' && direction !== 'ltr') {
      throw new Error(`direction must be rtl or ltr: ${direction}`);
    }
    const data = this.loadProgress();
    const latest = Math.max(0, ...Object.values(data).map(item => item.updatedAt));
    data[volId] = {
      page,
      direction: direction ?? DEFAULT_PROGRESS.direction,
      spread: spread ?? DEFAULT_PROGRESS.spread,
      updatedAt: Math.max(Date.now(), latest + 1),
    };
    this.saveProgress(data);
  }

  continueReading() {
    const entries = Object.entries(this.loadProgress()).sort(([, a], [, b]) => b.updatedAt - a.updatedAt);
    for (const [volId, progress] of entries) {
      for (const series of this.scan()) {
        if (series.volumes.some(volume => volume.id === volId)) {
          return { seriesId: series.id, volId, page: progress.page };
        }
      }
    }
    return null;
  }
}

module.exports = { MangaLibrary, naturalCompare };
