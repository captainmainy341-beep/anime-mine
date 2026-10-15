const crypto = require('crypto')
const fs = require('fs/promises')
const fsSync = require('fs')
const https = require('https')
const path = require('path')
const {spawn} = require('child_process')
const {pipeline} = require('stream/promises')
const probe = require('./probe')

const MODEL_URL = 'https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt'
const SCRIPT_SOURCE = path.join(__dirname, 'desub', 'desub.py')
const PROGRESS = /^progress ([\d.]+)/
const MAX_REDIRECTS = 5
const REDIRECT_STATUS = [301, 302, 303, 307, 308]
const BLUR_PROGRESS = /^out_time_us=(\d+)/
const BLUR_FILTER = [
  '[0:v]format=gbrp,split=2[full][bandsrc]',
  '[bandsrc]crop=iw:ih*0.38:0:ih*0.62,scale=iw/2:-2,format=gbrp,split=2[ba][bb]',
  '[bb]extractplanes=r+g+b[r][g][b]',
  '[r]split=2[r1][r2]',
  '[g]split=2[g1][g2]',
  '[b]split=2[b1][b2]',
  "[r1]lut=y='if(gt(val,215),255,0)'[wr]",
  "[g1]lut=y='if(gt(val,215),255,0)'[wg]",
  "[b1]lut=y='if(gt(val,215),255,0)'[wb]",
  '[wr][wg]blend=all_mode=multiply[wrg]',
  '[wrg][wb]blend=all_mode=multiply,dilation,dilation,dilation[w]',
  "[r2]lut=y='if(lt(val,70),255,0)'[nr]",
  "[g2]lut=y='if(lt(val,70),255,0)'[ng]",
  "[b2]lut=y='if(between(val,30,140),255,0)'[nb]",
  '[nr][ng]blend=all_mode=multiply[nrg]',
  '[nrg][nb]blend=all_mode=multiply,dilation,dilation,dilation[n]',
  '[w][n]blend=all_mode=multiply,dilation,dilation,dilation,dilation,dilation,dilation,format=gbrp[m]',
  '[ba]split[a1][a2]',
  '[a2]boxblur=10:2[bl]',
  '[a1][bl][m]maskedmerge,scale=iw*2:-2,format=gbrp[bandout]',
  '[full][bandout]overlay=0:H*0.62,format=yuv420p[o]',
].join(';')

function abortError() {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function lastLine(text) {
  return text.trim().split('\n').pop()
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function untilAborted(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const abort = () => reject(abortError())
    signal.addEventListener('abort', abort, {once: true})
    promise.then(
      value => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

function spawnLines(command, args, {onStdoutLine = () => {}, signal} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'pipe']})
    const stderr = []
    let pending = ''
    const kill = () => child.kill('SIGKILL')
    signal?.addEventListener('abort', kill, {once: true})
    child.stdout.on('data', chunk => {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop()
      for (const line of lines) onStdoutLine(line)
    })
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', error => {
      signal?.removeEventListener('abort', kill)
      reject(error)
    })
    child.on('close', code => {
      signal?.removeEventListener('abort', kill)
      if (pending) onStdoutLine(pending)
      resolve({code, stderr: Buffer.concat(stderr).toString('utf8')})
    })
  })
}

async function expectOk(running, message) {
  const {code, stderr} = await running
  if (code !== 0) throw new Error(`${message} (exit ${code}): ${lastLine(stderr)}`)
}

async function download(url, file, hops = 0) {
  const response = await new Promise((resolve, reject) => {
    https.get(url, resolve).on('error', reject)
  })
  if (REDIRECT_STATUS.includes(response.statusCode) && response.headers.location) {
    response.resume()
    if (hops === MAX_REDIRECTS) throw new Error('model download failed: too many redirects')
    return download(new URL(response.headers.location, url).href, file, hops + 1)
  }
  if (response.statusCode !== 200) {
    response.resume()
    throw new Error(`model download failed (HTTP ${response.statusCode})`)
  }
  await pipeline(response, fsSync.createWriteStream(file))
}

async function installTools({toolsDir, onStatus}) {
  await fs.mkdir(toolsDir, {recursive: true})
  const venv = path.join(toolsDir, 'venv')
  onStatus('venv')
  await expectOk(spawnLines('python3', ['-m', 'venv', venv]), 'Creating the Python environment failed')
  onStatus('packages')
  await expectOk(
    spawnLines(path.join(venv, 'bin', 'pip'), ['install', 'torch', 'numpy', 'opencv-python-headless']),
    'Installing Python packages failed',
  )
  onStatus('model')
  const model = path.join(toolsDir, 'big-lama.pt')
  await download(MODEL_URL, `${model}.tmp`).catch(async error => {
    await fs.rm(`${model}.tmp`, {force: true})
    throw error
  })
  await fs.rename(`${model}.tmp`, model)
  await fs.writeFile(path.join(toolsDir, 'desub.py'), await fs.readFile(SCRIPT_SOURCE))
}

class Desubber {
  #queue = []
  #current = null
  #installing = null
  #installer
  #runner
  #ffmpegPath

  constructor({
    dataDir,
    ffmpegPath = () => probe.ffmpegPath(),
    runner = ({python, args, onStdoutLine, signal}) => spawnLines(python, args, {onStdoutLine, signal}),
    installer = installTools,
  }) {
    this.toolsDir = path.join(dataDir, 'desub-tools')
    this.cacheDir = path.join(dataDir, 'desubbed')
    this.#ffmpegPath = ffmpegPath
    this.#runner = runner
    this.#installer = installer
  }

  #python() {
    return path.join(this.toolsDir, 'venv', 'bin', 'python')
  }

  #model() {
    return path.join(this.toolsDir, 'big-lama.pt')
  }

  isInstalled() {
    return fsSync.existsSync(this.#python()) && fsSync.existsSync(this.#model())
  }

  async install(onStatus = () => {}) {
    this.#installing ??= this.#installer({toolsDir: this.toolsDir, onStatus}).finally(() => {
      this.#installing = null
    })
    return this.#installing
  }

  async #paths(video, mode) {
    const stat = await fs.stat(video)
    const version = mode === 'blur' ? 'blur1' : 'desub1'
    const key = crypto.createHash('sha1').update(`${video}|${stat.mtimeMs}|${stat.size}|${version}`).digest('hex')
    return {output: path.join(this.cacheDir, `${key}.mp4`), temp: path.join(this.cacheDir, `${key}.tmp.mp4`)}
  }

  async cleanedPath(video, mode = 'ai') {
    let output
    try {
      output = (await this.#paths(video, mode)).output
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    return (await exists(output)) ? output : null
  }

  async enqueue(video, handlers = {}, mode = 'ai') {
    if (await this.cleanedPath(video, mode)) return
    if (this.#pending(video, mode)) return
    this.#queue.push({video, mode, handlers, fraction: 0, controller: new AbortController()})
    this.#kick()
  }

  #pending(video, mode) {
    const same = job => job.video === video && job.mode === mode
    return (this.#current ? same(this.#current) : false) || this.#queue.some(same)
  }

  #kick() {
    if (this.#current || this.#queue.length === 0) return
    const job = this.#queue.shift()
    this.#current = job
    job.done = this.#run(job).finally(() => {
      this.#current = null
      this.#kick()
    })
  }

  async #run(job) {
    const {video, mode, handlers, controller: {signal}} = job
    let temp = null
    try {
      const paths = await this.#paths(video, mode)
      temp = paths.temp
      if (await exists(paths.output)) return
      let result
      if (mode === 'blur') {
        const {duration} = await probe.probe(video)
        await fs.mkdir(this.cacheDir, {recursive: true})
        if (signal.aborted) return
        result = await this.#runner({
          python: this.#ffmpegPath(),
          args: [
            '-hide_banner', '-loglevel', 'error', '-y', '-nostats', '-progress', 'pipe:1',
            '-protocol_whitelist', 'file', '-i', video, '-filter_complex', BLUR_FILTER, '-map', '[o]', '-map', '0:a?',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
            '-c:a', 'copy', '-sn', '-dn', '-movflags', '+faststart', '-f', 'mp4', temp,
          ],
          onStdoutLine: line => {
            const match = line.match(BLUR_PROGRESS)
            if (!match) return
            if (!(duration > 0)) return
            job.fraction = Math.min(1, Number(match[1]) / 1e6 / duration)
            handlers.onProgress?.(job.fraction)
          },
          signal,
        })
      } else {
        if (!this.isInstalled()) await untilAborted(this.install(), signal)
        if (signal.aborted) return
        await fs.mkdir(this.cacheDir, {recursive: true})
        await fs.writeFile(path.join(this.toolsDir, 'desub.py'), await fs.readFile(SCRIPT_SOURCE))
        if (signal.aborted) return
        result = await this.#runner({
          python: this.#python(),
          args: [path.join(this.toolsDir, 'desub.py'), video, temp, this.#model(), this.#ffmpegPath()],
          onStdoutLine: line => {
            const match = line.match(PROGRESS)
            if (!match) return
            job.fraction = Number(match[1])
            handlers.onProgress?.(job.fraction)
          },
          signal,
        })
      }
      const {code, stderr} = result
      if (signal.aborted) return
      if (code !== 0) throw new Error(`desub failed (${code}): ${lastLine(stderr)}`)
      await fs.rename(temp, paths.output)
      handlers.onDone?.(paths.output)
    } catch (error) {
      if (!signal.aborted) handlers.onError?.(error)
    } finally {
      if (temp) await fs.rm(temp, {force: true}).catch(() => {})
    }
  }

  status() {
    const job = this.#current
    return {
      installed: this.isInstalled(),
      installing: this.#installing !== null,
      current: job ? {video: job.video, fraction: job.fraction} : null,
      queued: this.#queue.map(queued => queued.video),
    }
  }

  async cancel(video) {
    this.#queue = this.#queue.filter(job => job.video !== video)
    const job = this.#current
    if (job?.video !== video) return
    job.controller.abort()
    await job.done
  }

  stop() {
    this.#queue = []
    this.#current?.controller.abort()
  }

  async cacheSize() {
    const sizes = await Promise.all(
      (await this.#cacheFiles()).map(name => fs.stat(path.join(this.cacheDir, name)).then(stat => stat.size, () => 0)),
    )
    return sizes.reduce((total, size) => total + size, 0)
  }

  async clearCache() {
    const running = this.#current?.done
    this.stop()
    await running
    await Promise.all((await this.#cacheFiles()).map(name => fs.rm(path.join(this.cacheDir, name), {force: true})))
  }

  async #cacheFiles() {
    try {
      return (await fs.readdir(this.cacheDir)).filter(name => name.endsWith('.mp4'))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }
}

module.exports = {Desubber}
