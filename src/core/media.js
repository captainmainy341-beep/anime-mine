const {spawn} = require('child_process')
const path = require('path')
const ffmpegStatic = require('ffmpeg-static')

const JAPANESE_AUDIO = '0:a:m:language:jpn'
const FIRST_AUDIO = '0:a:0'
const LOG_ARGS = ['-hide_banner', '-loglevel', 'error']

function ffmpegPath() {
  if (!ffmpegStatic) throw new Error('ffmpeg binary not found')
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
}

function requireAbsolute(video) {
  if (typeof video !== 'string' || !path.isAbsolute(video)) throw new Error(`video must be an absolute path: ${video}`)
}

function lastLine(text) {
  return text.trim().split('\n').pop()
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, {stdio: ['ignore', 'pipe', 'pipe']})
    const out = []
    const err = []
    proc.stdout.on('data', chunk => out.push(chunk))
    proc.stderr.on('data', chunk => err.push(chunk))
    proc.on('error', reject)
    proc.on('close', code => {
      if (code === 0) resolve(Buffer.concat(out))
      else reject(new Error(`ffmpeg failed (${code}): ${lastLine(Buffer.concat(err).toString())}`))
    })
  })
}

function audioArgs({video, start, end, padStart, padEnd, map}) {
  requireAbsolute(video)
  const from = Math.max(0, start - padStart)
  const duration = end + padEnd - from
  return [
    ...LOG_ARGS,
    '-ss', from.toFixed(3),
    '-protocol_whitelist', 'file',
    '-i', video,
    '-t', duration.toFixed(3),
    '-map', map,
    '-vn', '-ac', '1', '-ar', '44100', '-b:a', '64k',
    '-f', 'mp3', 'pipe:1',
  ]
}

function screenshotArgs({video, time, maxWidth}) {
  requireAbsolute(video)
  return [
    ...LOG_ARGS,
    '-ss', time.toFixed(3),
    '-protocol_whitelist', 'file',
    '-i', video,
    '-frames:v', '1',
    '-vf', `scale='min(${maxWidth},iw)':-2`,
    '-c:v', 'mjpeg', '-q:v', '3',
    '-f', 'image2pipe', 'pipe:1',
  ]
}

async function extractAudio({video, start, end, padStart = 0.15, padEnd = 0.25}) {
  if (!(end > start)) throw new Error('end must be after start')
  const opts = {video, start, end, padStart, padEnd}
  try {
    return await runFfmpeg(audioArgs({...opts, map: JAPANESE_AUDIO}))
  } catch {
    return runFfmpeg(audioArgs({...opts, map: FIRST_AUDIO}))
  }
}

async function screenshot({video, time, maxWidth = 640}) {
  return runFfmpeg(screenshotArgs({video, time, maxWidth}))
}

module.exports = {extractAudio, screenshot, audioArgs, screenshotArgs}
