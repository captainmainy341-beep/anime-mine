const {spawn} = require('child_process')
const path = require('path')
const ffmpegStatic = require('ffmpeg-static')
const {normalizeCover} = require('./cover')

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

function runFfmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, {stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe']})
    const out = []
    const err = []
    if (input) {
      proc.stdin.on('error', () => {})
      proc.stdin.end(input)
    }
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

const pct = (n) => n.toFixed(6)
const MASK_GROW = 'dilation,dilation,dilation'
const WHITE = "geq=r='if(gt(min(r(X,Y),min(g(X,Y),b(X,Y))),215),255,0)':g='0':b='0'"
const NAVY = "geq=r='if(lt(r(X,Y),70)*lt(g(X,Y),70)*gt(b(X,Y),r(X,Y)+18)*lt(b(X,Y),140),255,0)':g='0':b='0'"

// Removes white-with-navy-outline burned-in subtitles by filling the text mask from the surrounding picture
// (blur of the unmasked pixels, normalised by how many of them there are); soft-sub video is untouched.
// Without a region it only looks in the lower third.
function censorFilter(maxWidth, region = null, out = 'o') {
  const keep = region
    ? [
      `drawbox=x=0:y=0:w=iw:h=ih*${pct(region.y0)}:color=black:t=fill`,
      `drawbox=x=0:y=0:w=iw*${pct(region.x0)}:h=ih:color=black:t=fill`,
      `drawbox=x=iw*${pct(region.x1)}:y=0:w=iw:h=ih:color=black:t=fill`,
    ].join(',')
    : 'drawbox=x=0:y=0:w=iw:h=ih*0.62:color=black:t=fill'
  return [
    `scale='min(${maxWidth},iw)':-2,format=gbrp,split=4[a][b][c][d]`,
    `[b]${WHITE},format=gbrp,extractplanes=r,${MASK_GROW}[w]`,
    `[c]${NAVY},format=gbrp,extractplanes=r,${MASK_GROW}[n]`,
    `[w][n]blend=all_mode=multiply,${MASK_GROW},${MASK_GROW},${MASK_GROW},${keep},format=gbrp,split=2[m][mv]`,
    '[mv]negate[v];[v]split=2[v1][v2]',
    '[d][v1]blend=all_mode=multiply,boxblur=20:3[num]',
    '[v2]boxblur=20:3[den]',
    "[num][den]blend=all_expr='min(255,A*255/max(B,2))'[fill]",
    '[m]boxblur=2:1[mf]',
    `[a][fill][mf]maskedmerge,format=yuvj420p[${out}]`,
  ].join(';')
}

// Replaces the user's cover box with a blurred copy of the strip just above it (or below, if the box sits in the top 8%), feathered at the edges.
function coverFilter(maxWidth, {x, y, w, h}) {
  const bx = `trunc(iw*${pct(x)})`
  const by = `trunc(ih*${pct(y)})`
  const bw = `max(2,trunc(iw*${pct(w)}/2)*2)`
  const bh = `max(2,trunc(ih*${pct(h)}/2)*2)`
  const useBelow = `lt(${by},ih*0.08)*gt(ih-${by}-${bh},0)`
  const above = `min(${bh},${by})`
  const bandH = `max(2,if(${useBelow},min(${bh},ih-${by}-${bh}),${above}))`
  const bandY = `min(ih-${bandH},if(${useBelow},${by}+${bh},${by}-${above}))`
  const feather = '255*min(1,(min(X,W-1-X)+0.5)/min(8,min(W,H)/4))*min(1,(min(Y,H-1-Y)+0.5)/min(8,min(W,H)/4))'
  return [
    `scale='min(${maxWidth},iw)':-2,format=yuv420p,split=3[base][band][ref]`,
    `[band]crop=w='${bw}':h='${bandH}':x='${bx}':y='${bandY}',vflip[src]`,
    `[src][ref]scale2ref=w='${bw}':h='${bh}'[scaled][r]`,
    '[r]nullsink',
    `[scaled]boxblur=luma_radius='min(10,floor(min(w,h)/2))':luma_power=2:chroma_radius='min(5,floor(min(w,h)/4))':chroma_power=2,format=yuva420p,geq=lum='p(X,Y)':a='${feather}'[patch]`,
    `[base][patch]overlay=x='trunc(W*${pct(x)})':y='trunc(H*${pct(y)})',format=yuvj420p[o]`,
  ].join(';')
}

// Subtitles often spill past a hand-drawn box (two-line captions), so look a bit above and beside it too.
function textRegion({x, y, w}) {
  return {x0: Math.max(0, x - 0.04), x1: Math.min(1, x + w + 0.04), y0: Math.max(0, y - 0.14)}
}

function screenshotArgs({video, time, maxWidth, censorSubs = false, cover = null}) {
  requireAbsolute(video)
  const box = normalizeCover(cover)
  const filter = censorSubs ? ['-filter_complex', censorFilter(maxWidth, box ? textRegion(box) : null), '-map', '[o]']
    : box ? ['-filter_complex', coverFilter(maxWidth, box), '-map', '[o]']
    : ['-vf', `scale='min(${maxWidth},iw)':-2`]
  return [
    ...LOG_ARGS,
    '-ss', time.toFixed(3),
    '-protocol_whitelist', 'file',
    '-i', video,
    '-frames:v', '1',
    ...filter,
    '-c:v', 'mjpeg', '-q:v', '3',
    '-f', 'image2pipe', 'pipe:1',
  ]
}

async function extractAudio({video, start, end, padStart = 0.15, padEnd = 0.25, audioStream}) {
  if (!(end > start)) throw new Error('end must be after start')
  const opts = {video, start, end, padStart, padEnd}
  if (audioStream !== undefined) {
    if (!Number.isInteger(audioStream) || audioStream < 0) throw new Error(`audioStream must be a non-negative integer: ${audioStream}`)
    return runFfmpeg(audioArgs({...opts, map: `0:${audioStream}`}))
  }
  try {
    return await runFfmpeg(audioArgs({...opts, map: JAPANESE_AUDIO}))
  } catch {
    return runFfmpeg(audioArgs({...opts, map: FIRST_AUDIO}))
  }
}

async function screenshot({video, time, maxWidth = 640, censorSubs = false, cover = null}) {
  return runFfmpeg(screenshotArgs({video, time, maxWidth, censorSubs, cover}))
}

const SILENCE_TRIM = 'areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse'

const MIN_TRIMMED_MP3_BYTES = 1500

function pcmArgs({sampleRate, filter, maxSeconds}) {
  return [
    ...LOG_ARGS,
    '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0',
    ...(filter ? ['-af', filter] : []),
    '-ac', '1', '-ar', '44100', '-b:a', '64k',
    '-t', String(maxSeconds),
    '-f', 'mp3', 'pipe:1',
  ]
}

async function pcmToMp3({pcm, sampleRate = 24000, trimTrailingSilence = true, maxSeconds = 20}) {
  if (trimTrailingSilence) {
    const trimmed = await runFfmpeg(pcmArgs({sampleRate, filter: SILENCE_TRIM, maxSeconds}), pcm)
    if (trimmed.length >= MIN_TRIMMED_MP3_BYTES) return trimmed
  }
  return runFfmpeg(pcmArgs({sampleRate, filter: null, maxSeconds}), pcm)
}

module.exports = {extractAudio, screenshot, audioArgs, screenshotArgs, pcmToMp3}
