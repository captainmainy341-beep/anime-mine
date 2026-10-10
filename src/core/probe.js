const {spawn} = require('child_process')
const fs = require('fs/promises')
const path = require('path')
const ffmpegStatic = require('ffmpeg-static')
const {parseSubtitles} = require('./subtitles')

const BITMAP_SUBTITLES = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'])
const LANGS = {jpn: 'ja', ja: 'ja', eng: 'en', en: 'en'}
const CHANNELS = {mono: 1, stereo: 2, '2.1': 3, quad: 4, '4.0': 4, '5.1': 6, '5.1(side)': 6, '6.1': 7, '7.1': 8, '7.1(wide)': 8}
const KINDS = {Video: 'video', Audio: 'audio', Subtitle: 'subtitle'}
const DIRECT_CONTAINERS = ['.mp4', '.m4v', '.webm', '.mkv']
const FIRST_AUDIO_CONTAINERS = ['.mkv', '.webm', '.mp4']
const DIRECT_VIDEO = ['h264', 'vp9', 'av1']
const DIRECT_AUDIO = ['aac', 'mp3', 'opus', 'vorbis', 'flac']

const STREAM_LINE = /^(\s*)Stream #0:(\d+)([^:]*): (Video|Audio|Subtitle): (.*)$/
const META_LINE = /^(\s*)([A-Za-z_][\w ]*?)\s*:\s?(.*)$/
const DURATION_LINE = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/
const PIX_FMT = /\b(yuv\w*|nv\d\w*|gray\w*|rgb\w*|bgr\w*|gbr\w*|pal8|p0\w*)/
const BIT_DEPTH = /p0?(9|1[024]|16)(?:le|be)?$/

function ffmpegPath() {
  if (!ffmpegStatic) throw new Error('ffmpeg binary not found')
  return ffmpegStatic.replace('app.asar', 'app.asar.unpacked')
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
    proc.on('close', code => resolve({code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8')}))
  })
}

function normaliseLang(raw) {
  if (!raw) return null
  const lang = raw.toLowerCase()
  return LANGS[lang] || lang
}

function channelCount(details) {
  for (const part of details.split(', ')) {
    const name = part.trim().toLowerCase()
    if (Object.hasOwn(CHANNELS, name)) return CHANNELS[name]
    const count = name.match(/^(\d+) channels?$/)
    if (count) return Number(count[1])
  }
  return null
}

function describeStream([, , index, qualifier, kind, details]) {
  const type = KINDS[kind]
  const codec = (details.match(/^[^\s,(]+/) || [''])[0]
  const pixFmt = type === 'video' ? (details.match(PIX_FMT) || [])[1] || null : null
  return {
    index: Number(index),
    type,
    codec,
    lang: normaliseLang((qualifier.match(/\(([^)]*)\)/) || [])[1]),
    title: null,
    default: /\(default\)/.test(details),
    pixFmt,
    bitDepth: pixFmt ? Number((pixFmt.match(BIT_DEPTH) || [])[1] || 8) : null,
    channels: type === 'audio' ? channelCount(details) : null,
    textBased: type === 'subtitle' ? !BITMAP_SUBTITLES.has(codec) : false,
  }
}

function parseStreams(text) {
  const streams = []
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(STREAM_LINE)
    if (match) {
      current = {indent: match[1].length, stream: describeStream(match)}
      streams.push(current.stream)
      continue
    }
    if (!current || !line.trim()) continue
    const indent = line.match(/^\s*/)[0].length
    const meta = line.match(META_LINE)
    if (meta && indent > current.indent) {
      if (meta[2].trim() === 'title' && current.stream.title === null && meta[3].trim()) current.stream.title = meta[3].trim()
      continue
    }
    if (indent <= current.indent) current = null
  }
  return streams
}

function parseDuration(text) {
  const match = text.match(DURATION_LINE)
  if (!match) return null
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
}

async function probe(video) {
  try {
    await fs.access(video)
  } catch {
    throw new Error(`video not found: ${video}`)
  }
  const {stderr} = await runFfmpeg(['-hide_banner', '-protocol_whitelist', 'file', '-i', path.resolve(video)])
  if (!/Input #\d+/.test(stderr)) throw new Error(`could not read media ${path.basename(video)}: ${lastLine(stderr)}`)
  return {duration: parseDuration(stderr), streams: parseStreams(stderr)}
}

function pickDefaultAudio(streams) {
  const audio = streams.filter(stream => stream.type === 'audio')
  return audio.find(stream => stream.lang === 'ja') || audio.find(stream => stream.default) || audio[0] || null
}

function pickDefaultSubtitle(streams) {
  const japanese = streams.filter(stream => stream.type === 'subtitle' && stream.textBased && stream.lang === 'ja')
  const isSignOrSong = stream => /sign|song/i.test(stream.title || '')
  return japanese.find(stream => !isSignOrSong(stream)) || japanese[0] || null
}

function isDirectPlayable(info, ext, audioStreamIndex) {
  const container = String(ext).toLowerCase()
  if (!DIRECT_CONTAINERS.includes(container)) return false
  const video = info.streams.find(stream => stream.type === 'video')
  if (!video || !DIRECT_VIDEO.includes(video.codec) || video.bitDepth !== 8) return false
  const audio = info.streams.filter(stream => stream.type === 'audio')
  const selected = audio.find(stream => stream.index === audioStreamIndex)
  if (!selected || !DIRECT_AUDIO.includes(selected.codec)) return false
  return !FIRST_AUDIO_CONTAINERS.includes(container) || audio[0] === selected
}

async function extractSubtitles({video, streamIndex}) {
  const info = await probe(video)
  const stream = info.streams.find(item => item.type === 'subtitle' && item.index === streamIndex)
  if (!stream) throw new Error(`no subtitle stream ${streamIndex} in ${path.basename(video)}`)
  if (!stream.textBased) throw new Error(`subtitle stream ${streamIndex} is bitmap (${stream.codec}) and cannot be extracted as text`)
  const {code, stdout, stderr} = await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file',
    '-i', path.resolve(video), '-map', `0:${streamIndex}`, '-f', 'srt', '-',
  ])
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${lastLine(stderr)}`)
  return parseSubtitles(stdout.toString('utf8').replace(/^\uFEFF/, ''), '.srt')
    .map(cue => ({...cue, text: cue.text.replace(/\{[^}]*\}/g, '').trim()}))
    .filter(cue => cue.text)
}

module.exports = {probe, pickDefaultAudio, pickDefaultSubtitle, isDirectPlayable, extractSubtitles, ffmpegPath}
