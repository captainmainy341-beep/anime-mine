const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', '..', 'native', 'pdf', 'mac-pdf.swift');
const RENDER_LONG_EDGE_PX = 2000;
const HELPER_TIMEOUT_MS = 60 * 1000;
const COMPILE_TIMEOUT_MS = 180 * 1000;

class PdfRenderer {
  #counts = new Map();

  constructor(dataDir, { execFileSync } = require('node:child_process')) {
    this.execFileSync = execFileSync;
    this.binDir = path.join(dataDir, 'bin');
    this.bin = path.join(this.binDir, 'mac-pdf');
    this.cacheDir = path.join(dataDir, 'manga-pdf');
  }

  pageCount(file) {
    const { mtimeMs, size } = fs.statSync(file);
    const stamp = `${mtimeMs}:${size}`;
    const memo = this.#counts.get(file);
    if (memo?.stamp === stamp) return memo.count;
    try {
      this.ensureBinary();
    } catch {
      return 0;
    }
    let count = 0;
    try {
      count = Number.parseInt(this.execFileSync(this.bin, ['count', file], helperOptions()), 10) || 0;
    } catch (error) {
      if (error.killed || error.signal) return 0;
    }
    this.#counts.set(file, { stamp, count });
    return count;
  }

  renderPage(file, index) {
    const { mtimeMs, size } = fs.statSync(file);
    const key = crypto.createHash('sha1').update(`${file}|${mtimeMs}|${size}|${index}`).digest('hex');
    const cached = path.join(this.cacheDir, `${key}.png`);
    if (fs.existsSync(cached)) return fs.readFileSync(cached);

    this.ensureBinary();
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const temp = `${cached}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      this.execFileSync(this.bin, ['render', file, String(index), temp, String(RENDER_LONG_EDGE_PX)], helperOptions());
      fs.renameSync(temp, cached);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw new Error(`cannot render pdf page ${index}: ${error.message}`);
    }
    return fs.readFileSync(cached);
  }

  ensureBinary() {
    if (process.platform !== 'darwin') throw new Error('PDF volumes require macOS');
    const hash = crypto.createHash('sha1').update(fs.readFileSync(SOURCE)).digest('hex');
    const hashFile = path.join(this.binDir, 'mac-pdf.sha1');
    if (fs.existsSync(this.bin) && fs.existsSync(hashFile) && fs.readFileSync(hashFile, 'utf8') === hash) return;

    fs.mkdirSync(this.binDir, { recursive: true });
    const temp = `${this.bin}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      this.execFileSync('swiftc', ['-O', SOURCE, '-o', temp], { stdio: 'pipe', timeout: COMPILE_TIMEOUT_MS });
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw new Error(`mac-pdf build failed: ${error.message}`);
    }
    fs.renameSync(temp, this.bin);
    fs.writeFileSync(hashFile, hash);
  }
}

function helperOptions() {
  return { encoding: 'utf8', stdio: 'pipe', timeout: HELPER_TIMEOUT_MS };
}

module.exports = { PdfRenderer };
