const {spawn} = require('child_process')
const crypto = require('crypto')
const fs = require('fs/promises')
const path = require('path')
const {probe, isDirectPlayable, ffmpegPath} = require('./probe')

const CACHE_FILE = /^[0-9a-f]{40}(\.tmp)?\.mp4$/
const VIDEO_ENCODERS = [
  ['-c:v', 'h264_videotoolbox', '-b:v', '6M', '-pix_fmt', 'yuv420p'],
  ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p'],
]

function abortError() {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError()
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

function encodeArgs({video, output, audioStreamIndex, videoArgs}) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-protocol_whitelist', 'file',
    '-i', video,
    '-map', '0:v:0', ...videoArgs,
    '-map', `0:${audioStreamIndex}`, '-c:a', 'aac', '-b:a', '192k', '-ac', '2',
    '-sn', '-dn', '-movflags', '+faststart',
    '-progress', 'pipe:1',
    output,
  ]
}

function runEncode(args, signal, onTime) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError())
    const proc = spawn(ffmpegPath(), args, {stdio: ['ignore', 'pipe', 'pipe']})
    const err = []
    let pending = ''
    const abort = () => proc.kill('SIGKILL')
    signal.addEventListener('abort', abort, {once: true})
    proc.stdout.on('data', chunk => {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop()
      for (const line of lines) {
        const match = line.match(/^out_time_us=(\d+)/)
        if (match) onTime(Number(match[1]))
      }
    })
    proc.stderr.on('data', chunk => err.push(chunk))
    proc.on('error', error => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
    proc.on('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(abortError())
      else if (code === 0) resolve()
      else reject(new Error(`ffmpeg failed (${code}): ${lastLine(Buffer.concat(err).toString('utf8'))}`))
    })
  })
}

function waitFor(promise, signal, onAbort) {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const fail = () => reject(abortError())
    const abort = () => {
      if (onAbort()) promise.then(fail, fail)
      else fail()
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, {once: true})
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

class Converter {
  constructor({cacheDir}) {
    if (!cacheDir) throw new Error('cacheDir is required')
    this.cacheDir = cacheDir
    this.jobs = new Map()
  }

  plan(info, ext, audioStreamIndex) {
    if (isDirectPlayable(info, ext, audioStreamIndex)) return {mode: 'direct', reason: 'container, video and audio are playable as-is'}
    const video = info.streams.find(stream => stream.type === 'video')
    if (video?.codec === 'h264' && video.bitDepth === 8) return {mode: 'remux', reason: 'h264 8-bit video is copied; audio is converted to AAC'}
    return {mode: 'transcode', reason: 'video must be re-encoded to 8-bit H.264 for Chromium'}
  }

  async prepare(video, {audioStreamIndex, onProgress = () => {}, signal} = {}) {
    throwIfAborted(signal)
    const info = await probe(video)
    if (!info.streams.some(stream => stream.type === 'audio' && stream.index === audioStreamIndex)) {
      throw new Error(`no audio stream ${audioStreamIndex} in ${path.basename(video)}`)
    }
    const {mode} = this.plan(info, path.extname(video).toLowerCase(), audioStreamIndex)
    if (mode === 'direct') return {path: video, mode}

    const stat = await fs.stat(video)
    throwIfAborted(signal)
    const key = crypto.createHash('sha1').update(`${video}|${stat.mtimeMs}|${stat.size}|${audioStreamIndex}`).digest('hex')
    const output = path.join(this.cacheDir, `${key}.mp4`)
    const job = this.#join(output, ({signal: jobSignal, emit}) => this.#encode({video, output, info, audioStreamIndex, mode}, jobSignal, emit))
    job.listeners.add(onProgress)
    job.refs += 1
    await waitFor(job.promise, signal, () => {
      job.listeners.delete(onProgress)
      job.refs -= 1
      if (job.refs > 0) return false
      this.#cancel(output, job)
      return true
    })
    return {path: output, mode}
  }

  async cacheSize() {
    const sizes = await Promise.all((await this.#cacheFiles()).map(name => fs.stat(path.join(this.cacheDir, name)).then(stat => stat.size, () => 0)))
    return sizes.reduce((total, size) => total + size, 0)
  }

  async clearCache() {
    await Promise.all((await this.#cacheFiles()).map(name => fs.rm(path.join(this.cacheDir, name), {force: true})))
  }

  async #cacheFiles() {
    try {
      return (await fs.readdir(this.cacheDir)).filter(name => CACHE_FILE.test(name))
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
  }

  #join(output, run) {
    const existing = this.jobs.get(output)
    if (existing) return existing
    const job = {controller: new AbortController(), listeners: new Set(), refs: 0}
    job.emit = fraction => {
      for (const listener of job.listeners) listener(fraction)
    }
    job.promise = run({signal: job.controller.signal, emit: job.emit}).finally(() => {
      if (this.jobs.get(output) === job) this.jobs.delete(output)
    })
    this.jobs.set(output, job)
    return job
  }

  #cancel(output, job) {
    if (this.jobs.get(output) === job) this.jobs.delete(output)
    job.controller.abort()
  }

  async #encode({video, output, info, audioStreamIndex, mode}, signal, emit) {
    await fs.mkdir(this.cacheDir, {recursive: true})
    if (await exists(output)) {
      emit(1)
      return output
    }
    const temp = output.replace(/\.mp4$/, '.tmp.mp4')
    const onTime = micros => {
      if (info.duration > 0) emit(Math.min(1, micros / 1e6 / info.duration))
    }
    const encoders = mode === 'remux' ? [['-c:v', 'copy']] : VIDEO_ENCODERS
    try {
      for (const [attempt, videoArgs] of encoders.entries()) {
        try {
          await runEncode(encodeArgs({video, output: temp, audioStreamIndex, videoArgs}), signal, onTime)
          break
        } catch (error) {
          if (signal.aborted || attempt === encoders.length - 1) throw error
        }
      }
      await fs.rename(temp, output)
      emit(1)
      return output
    } finally {
      await fs.rm(temp, {force: true})
    }
  }
}

module.exports = {Converter}
