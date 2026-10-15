const crypto = require('node:crypto');
const { execFile, spawn: nodeSpawn } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'native', 'ocr', 'mac-ocr.swift');
const CACHE_KEY = /^[A-Za-z0-9_.-]+$/;
const HELPER_TIMEOUT_MS = 60 * 1000;
const COMPILE_TIMEOUT_MS = 180 * 1000;

function unavailable(message) {
  const error = new Error(message);
  error.code = 'OCR_UNAVAILABLE';
  return error;
}

function defaultExec(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}${stderr ? `: ${stderr.trim()}` : ''}`, { cause: error }));
      else resolve(stdout);
    });
  });
}

function runHelper(spawn, bin, imagePath, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const proc = spawn(bin, [imagePath], { stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    const settle = (done, value) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      done(value);
    };
    const onAbort = () => {
      proc.kill();
      settle(reject, signal.reason);
    };
    const timer = setTimeout(() => {
      proc.kill();
      settle(reject, new Error(`mac-ocr timed out after ${HELPER_TIMEOUT_MS / 1000} s`));
    }, HELPER_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
    proc.stdout.on('data', chunk => out.push(chunk));
    proc.stderr.on('data', chunk => err.push(chunk));
    proc.on('error', error => settle(reject, error));
    proc.on('close', code => {
      if (code === 0) settle(resolve, Buffer.concat(out).toString('utf8'));
      else settle(reject, new Error(`mac-ocr failed (${code}): ${Buffer.concat(err).toString('utf8').trim()}`));
    });
  });
}

const centerX = block => block.box.x + block.box.w / 2;
const centerY = block => block.box.y + block.box.h / 2;

// Manga columns read right to left; each column is ordered top to bottom.
function orderColumns(blocks) {
  const columns = [];
  for (const block of [...blocks].sort((a, b) => centerX(b) - centerX(a))) {
    const column = columns.find(item => Math.abs(item.x - centerX(block)) <= Math.max(item.w, block.box.w) * 0.6);
    if (column) column.blocks.push(block);
    else columns.push({ x: centerX(block), w: block.box.w, blocks: [block] });
  }
  return columns.flatMap(column => column.blocks.sort((a, b) => centerY(a) - centerY(b)));
}

// Horizontal text reads top to bottom; each row is ordered left to right.
function orderRows(blocks) {
  const rows = [];
  for (const block of [...blocks].sort((a, b) => centerY(a) - centerY(b))) {
    const row = rows.find(item => Math.abs(item.y - centerY(block)) <= Math.max(item.h, block.box.h) * 0.6);
    if (row) row.blocks.push(block);
    else rows.push({ y: centerY(block), h: block.box.h, blocks: [block] });
  }
  return rows.flatMap(row => row.blocks.sort((a, b) => centerX(a) - centerX(b)));
}

function readingOrder(blocks) {
  const vertical = blocks.filter(block => block.vertical).length * 2 > blocks.length;
  return vertical ? orderColumns(blocks) : orderRows(blocks);
}

function importMokuro(jsonOrPath) {
  const page = typeof jsonOrPath === 'string' ? JSON.parse(fs.readFileSync(jsonOrPath, 'utf8')) : jsonOrPath;
  const { img_width: width, img_height: height } = page;
  const blocks = page.blocks.map(block => {
    const [x1, y1, x2, y2] = block.box;
    return {
      text: block.lines.join(''),
      box: { x: x1 / width, y: y1 / height, w: (x2 - x1) / width, h: (y2 - y1) / height },
      vertical: Boolean(block.vertical),
      confidence: 1,
    };
  });
  return { width, height, blocks: readingOrder(blocks) };
}

function findMokuroSidecar(imagePath) {
  const dir = path.dirname(imagePath);
  const volume = path.basename(dir);
  const stem = path.basename(imagePath, path.extname(imagePath));
  const candidates = [
    path.join(dir, `${stem}.json`),
    path.join(dir, '_ocr', volume, `${stem}.json`),
    path.join(path.dirname(dir), '_ocr', volume, `${stem}.json`),
  ];
  return candidates.find(file => fs.existsSync(file)) ?? null;
}

class OcrEngine {
  constructor({ dataDir, spawn = nodeSpawn, exec = defaultExec }) {
    this.dataDir = dataDir;
    this.spawn = spawn;
    this.exec = exec;
    this.binDir = path.join(dataDir, 'bin');
    this.bin = path.join(this.binDir, 'mac-ocr');
    this.cacheDir = path.join(dataDir, 'manga-ocr-v2');
    this.building = null;
  }

  async recognize(input, { cacheKey, signal } = {}) {
    if (cacheKey !== undefined && !CACHE_KEY.test(cacheKey)) throw new Error(`invalid cacheKey: ${cacheKey}`);
    if (typeof input === 'string') {
      const sidecar = findMokuroSidecar(input);
      if (sidecar) return importMokuro(sidecar);
    }
    const cached = cacheKey !== undefined ? this.readCache(cacheKey) : null;
    if (cached) return cached;

    const result = await this.recognizeLive(input, signal);
    if (cacheKey !== undefined) this.writeCache(cacheKey, result);
    return result;
  }

  async recognizeLive(input, signal) {
    if (process.platform !== 'darwin') throw unavailable('live OCR requires macOS (Vision)');
    await this.ensureBinary();
    signal?.throwIfAborted();
    const { file, cleanup } = await this.imageFile(input);
    try {
      const raw = JSON.parse(await runHelper(this.spawn, this.bin, file, signal));
      const blocks = raw.blocks.map(block => ({
        text: block.text,
        box: block.box,
        vertical: block.vertical,
        confidence: block.confidence,
      }));
      return { width: raw.width, height: raw.height, blocks: readingOrder(blocks) };
    } finally {
      await cleanup();
    }
  }

  ensureBinary() {
    this.building ??= this.buildBinary().finally(() => {
      this.building = null;
    });
    return this.building;
  }

  async buildBinary() {
    const source = await fsp.readFile(SOURCE);
    const hash = crypto.createHash('sha1').update(source).digest('hex');
    const hashFile = path.join(this.binDir, 'mac-ocr.sha1');
    const built = fs.existsSync(this.bin) && fs.existsSync(hashFile) && fs.readFileSync(hashFile, 'utf8') === hash;
    if (built) return;

    await fsp.mkdir(this.binDir, { recursive: true });
    const temp = `${this.bin}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      await this.exec('swiftc', ['-O', SOURCE, '-o', temp], { timeout: COMPILE_TIMEOUT_MS });
    } catch (error) {
      await fsp.rm(temp, { force: true });
      if (error.code === 'ENOENT' || error.cause?.code === 'ENOENT') throw unavailable('swiftc not found; install Xcode command line tools');
      throw unavailable(`mac-ocr build failed: ${error.message}`);
    }
    await fsp.rename(temp, this.bin);
    await fsp.writeFile(hashFile, hash);
  }

  async imageFile(input) {
    if (typeof input === 'string') return { file: input, cleanup: async () => {} };
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'mac-ocr-'));
    const file = path.join(dir, 'page');
    await fsp.writeFile(file, input);
    return { file, cleanup: () => fsp.rm(dir, { recursive: true, force: true }) };
  }

  readCache(cacheKey) {
    const file = path.join(this.cacheDir, `${cacheKey}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  }

  writeCache(cacheKey, result) {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const file = path.join(this.cacheDir, `${cacheKey}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(result));
    fs.renameSync(`${file}.tmp`, file);
  }
}

module.exports = { OcrEngine, importMokuro, findMokuroSidecar };
