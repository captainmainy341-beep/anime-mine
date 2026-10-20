const test = require('node:test')
const assert = require('node:assert/strict')
const {spawnSync} = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ffmpegStatic = require('ffmpeg-static')
const {extractAudio, screenshot, audioArgs, screenshotArgs, pcmToMp3} = require('../src/core/media')

const argAfter = (args, flag) => args[args.indexOf(flag) + 1]

function startsLikeMp3(buf) {
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') return true
  return buf[0] === 0xff && [0xfb, 0xf3, 0xf2].includes(buf[1])
}

test('audioArgs seeks to start minus padStart and spans to end plus padEnd', () => {
  const args = audioArgs({video: '/v/ep.mkv', start: 10, end: 12, padStart: 0.15, padEnd: 0.25, map: '0:a:0'})
  assert.equal(argAfter(args, '-ss'), '9.850')
  assert.equal(argAfter(args, '-i'), '/v/ep.mkv')
  assert.equal(argAfter(args, '-t'), '2.400')
  assert.equal(argAfter(args, '-map'), '0:a:0')
  assert.equal(argAfter(args, '-ac'), '1')
  assert.equal(argAfter(args, '-ar'), '44100')
  assert.equal(argAfter(args, '-b:a'), '64k')
  assert.equal(argAfter(args, '-f'), 'mp3')
  assert.equal(args.at(-1), 'pipe:1')
})

test('audioArgs clamps the seek position at zero', () => {
  const args = audioArgs({video: '/v/v.mkv', start: 0.05, end: 1, padStart: 0.15, padEnd: 0.25, map: '0:a:0'})
  assert.equal(argAfter(args, '-ss'), '0.000')
  assert.equal(argAfter(args, '-t'), '1.250')
})

test('audioArgs passes the requested stream map through', () => {
  const args = audioArgs({video: '/v/v.mkv', start: 1, end: 2, padStart: 0, padEnd: 0, map: '0:a:m:language:jpn'})
  assert.equal(argAfter(args, '-map'), '0:a:m:language:jpn')
})

test('screenshotArgs seeks to time, grabs one frame scaled to maxWidth as jpeg on stdout', () => {
  const args = screenshotArgs({video: '/v/ep.mkv', time: 5.5, maxWidth: 640})
  assert.equal(argAfter(args, '-ss'), '5.500')
  assert.equal(argAfter(args, '-i'), '/v/ep.mkv')
  assert.equal(argAfter(args, '-frames:v'), '1')
  assert.equal(argAfter(args, '-vf'), "scale='min(640,iw)':-2")
  assert.equal(argAfter(args, '-c:v'), 'mjpeg')
  assert.equal(argAfter(args, '-f'), 'image2pipe')
  assert.equal(args.at(-1), 'pipe:1')
})

test('audioArgs and screenshotArgs whitelist the file protocol right before the input', () => {
  const audio = audioArgs({video: '/v/ep.mkv', start: 1, end: 2, padStart: 0, padEnd: 0, map: '0:a:0'})
  const shot = screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640})
  for (const args of [audio, shot]) {
    const input = args.indexOf('-i')
    assert.equal(args[input - 2], '-protocol_whitelist')
    assert.equal(args[input - 1], 'file')
  }
})

test('audioArgs, screenshotArgs and the public functions reject a relative video path', async () => {
  assert.throws(() => audioArgs({video: 'ep.mkv', start: 1, end: 2, padStart: 0, padEnd: 0, map: '0:a:0'}), /absolute path/)
  assert.throws(() => screenshotArgs({video: 'ep.mkv', time: 1, maxWidth: 640}), /absolute path/)
  await assert.rejects(extractAudio({video: 'ep.mkv', start: 1, end: 2}), /absolute path/)
  await assert.rejects(screenshot({video: 'ep.mkv', time: 1}), /absolute path/)
})

test('extractAudio and screenshot produce real MP3 and JPEG data from a generated clip', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-media-'))
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}))
  const video = path.join(dir, 'sample.mkv')

  const gen = spawnSync(ffmpegStatic, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=3',
    video,
  ])
  assert.equal(gen.status, 0, gen.stderr.toString())

  const audio = await extractAudio({video, start: 1, end: 2})
  assert.ok(audio.length > 0, 'audio buffer is empty')
  assert.ok(startsLikeMp3(audio), `unexpected MP3 header: ${audio.subarray(0, 4).toString('hex')}`)

  const jpg = await screenshot({video, time: 1.5})
  assert.ok(jpg.length > 0, 'screenshot buffer is empty')
  assert.equal(jpg[0], 0xff)
  assert.equal(jpg[1], 0xd8)
})

test('extractAudio rejects a range whose end is not after start', async () => {
  await assert.rejects(extractAudio({video: 'missing.mkv', start: 2, end: 2}), /end must be after start/)
})

test('extractAudio rejects an audioStream that is not a non-negative integer', async () => {
  for (const audioStream of [1.5, -1, '1', NaN, Infinity]) {
    await assert.rejects(
      extractAudio({video: '/v/ep.mkv', start: 1, end: 2, audioStream}),
      /audioStream must be a non-negative integer/,
    )
  }
})

function zeroCrossings(mp3) {
  const pcm = spawnSync(ffmpegStatic, [
    '-hide_banner', '-loglevel', 'error',
    '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1',
  ], {input: mp3}).stdout
  let count = 0
  for (let i = 2; i < pcm.length; i += 2) {
    const prev = pcm.readInt16LE(i - 2)
    const cur = pcm.readInt16LE(i)
    if ((prev < 0) !== (cur < 0)) count++
  }
  return count
}

test('extractAudio with audioStream picks that exact ffmpeg stream from a two-track file', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-media-'))
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}))
  const video = path.join(dir, 'two-tracks.mkv')

  const gen = spawnSync(ffmpegStatic, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3',
    '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:d=3',
    '-map', '2:v', '-map', '0:a', '-map', '1:a',
    '-metadata:s:a:0', 'language=jpn',
    '-metadata:s:a:1', 'language=eng',
    video,
  ])
  assert.equal(gen.status, 0, gen.stderr.toString())

  const jpn = await extractAudio({video, start: 0.5, end: 2.5, audioStream: 1})
  const eng = await extractAudio({video, start: 0.5, end: 2.5, audioStream: 2})
  assert.ok(startsLikeMp3(jpn), `unexpected MP3 header: ${jpn.subarray(0, 4).toString('hex')}`)
  assert.ok(startsLikeMp3(eng), `unexpected MP3 header: ${eng.subarray(0, 4).toString('hex')}`)
  assert.ok(!jpn.equals(eng), 'audioStream 1 and 2 produced identical audio')

  const jpnHz = zeroCrossings(jpn)
  const engHz = zeroCrossings(eng)
  assert.ok(engHz > jpnHz * 1.5, `expected ~880 Hz (eng) to cross zero far more often than ~440 Hz (jpn): ${engHz} vs ${jpnHz}`)

  const defaulted = await extractAudio({video, start: 0.5, end: 2.5})
  assert.ok(defaulted.equals(jpn), 'default jpn lookup should select the same stream as audioStream 1')
})

test('pcmToMp3 encodes generated s16le PCM to MP3, falling back to untrimmed for silence', async () => {
  const sampleRate = 24000
  const tone = Buffer.alloc(sampleRate * 2)
  for (let i = 0; i < sampleRate; i++) tone.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), i * 2)
  const silence = Buffer.alloc(sampleRate * 2)

  const trimmed = await pcmToMp3({pcm: tone, sampleRate})
  assert.ok(startsLikeMp3(trimmed), `unexpected MP3 header: ${trimmed.subarray(0, 4).toString('hex')}`)
  const untrimmed = await pcmToMp3({pcm: tone, sampleRate, trimTrailingSilence: false})
  assert.ok(startsLikeMp3(untrimmed), `unexpected MP3 header: ${untrimmed.subarray(0, 4).toString('hex')}`)
  const quiet = await pcmToMp3({pcm: silence, sampleRate})
  assert.ok(quiet.length > 0 && startsLikeMp3(quiet), 'silent input should still yield an MP3')
})

test('pcmToMp3 returns a non-empty untrimmed MP3 when trimming removes all audio', async () => {
  const sampleRate = 24000
  const zeros = Buffer.alloc(sampleRate * 2)
  const result = await pcmToMp3({pcm: zeros, sampleRate})
  assert.ok(result.length > 0, 'all-zero PCM should fall back to a non-empty MP3')
  assert.ok(startsLikeMp3(result), `unexpected MP3 header: ${result.subarray(0, 4).toString('hex')}`)
})

test('pcmToMp3 caps output at maxSeconds, keeping the start', async () => {
  const sampleRate = 24000
  const tone = Buffer.alloc(sampleRate * 3 * 2)
  for (let i = 0; i < sampleRate * 3; i++) tone.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), i * 2)

  const mp3 = await pcmToMp3({pcm: tone, sampleRate, maxSeconds: 1})
  const decoded = spawnSync(ffmpegStatic, [
    '-hide_banner', '-loglevel', 'error',
    '-i', 'pipe:0', '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1',
  ], {input: mp3}).stdout
  const seconds = decoded.length / 2 / 8000
  assert.ok(Math.abs(seconds - 1) < 0.2, `expected ~1 s of audio, got ${seconds.toFixed(2)} s`)
})

test('screenshotArgs paints the subtitle cover with a blurred patch, and censorSubs searches only around the cover instead', () => {
  const cover = {x: .1, y: .8, w: .8, h: .12}
  const args = screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640, cover})
  const graph = argAfter(args, '-filter_complex')
  assert.match(graph, /vflip/)
  assert.match(graph, /boxblur/)
  assert.match(graph, /overlay/)
  assert.equal(argAfter(args, '-map'), '[o]')
  const both = screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640, censorSubs: true, cover})
  assert.match(argAfter(both, '-filter_complex'), /maskedmerge/)
  assert.match(argAfter(both, '-filter_complex'), /drawbox=x=0:y=0:w=iw:h=ih\*0\.660000/)
  assert.doesNotMatch(argAfter(both, '-filter_complex'), /overlay/)
  const invalid = screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640, cover: {x: NaN, y: 0, w: 0.5, h: 0.5}})
  assert.equal(invalid.includes('-filter_complex'), false)
})

test('screenshot applies a subtitle cover to a generated clip and returns a JPEG', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-cover-'))
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}))
  const video = path.join(dir, 'v.mp4')

  const gen = spawnSync(ffmpegStatic, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=1',
    '-pix_fmt', 'yuv420p', video,
  ])
  assert.equal(gen.status, 0, gen.stderr.toString())

  const jpg = await screenshot({video, time: 0.5, maxWidth: 320, cover: {x: .1, y: .8, w: .8, h: .12}})
  assert.equal(jpg[0], 0xff)
  assert.equal(jpg[1], 0xd8)
})

test('screenshotArgs censors burned-in subtitles through a filter graph only when asked', () => {
  const plain = screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640})
  assert.equal(plain.includes('-filter_complex'), false)
  const censored = screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640, censorSubs: true})
  assert.match(argAfter(censored, '-filter_complex'), /maskedmerge/)
  assert.equal(argAfter(censored, '-map'), '[o]')
  assert.equal(censored.includes('-vf'), false)
})

test('screenshot with censorSubs blurs a caption in the lower band and leaves the rest of the frame alone', async () => {
  const ffmpeg = require('../src/core/probe').ffmpegPath()
  const {execFileSync} = require('child_process')
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'censor-'))
  try {
    const video = path.join(dir, 'v.mp4')
    const caption = "drawtext=text='HELLO WORLD':fontsize=40:fontcolor=white:bordercolor=0x000040:borderw=3:x=(w-text_w)/2"
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x806040:s=640x360:d=1:r=10',
      '-vf', `${caption}:y=300,${caption}:y=20`, '-pix_fmt', 'yuv420p', video], {stdio: 'pipe'})
    const gray = (jpeg) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], {input: jpeg, maxBuffer: 1 << 24})
    const rows = (frame, from, to) => frame.subarray(from * 640, to * 640)
    const diff = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0)
    const plain = gray(await screenshot({video, time: 0.5}))
    const censored = gray(await screenshot({video, time: 0.5, censorSubs: true}))
    const lower = diff(rows(plain, 295, 350), rows(censored, 295, 350)) / (55 * 640)
    const upper = diff(rows(plain, 0, 70), rows(censored, 0, 70)) / (70 * 640)
    assert.ok(lower > 4 * upper + 1, 'lower caption is blurred more than the colour-conversion noise')
  } finally {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('screenshot cover never samples inside the box and still paints tiny boxes', async t => {
  const tall = argAfter(screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640, cover: {x: 0, y: .05, w: 1, h: .95}}), '-filter_complex')
  assert.match(tall, /gt\(ih-/)

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-cover-'))
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}))
  const video = path.join(dir, 'v.mp4')
  const gen = spawnSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x180:d=1', '-pix_fmt', 'yuv420p', video])
  assert.equal(gen.status, 0, gen.stderr.toString())

  const plain = await screenshot({video, time: 0.5, maxWidth: 320})
  const tiny = await screenshot({video, time: 0.5, maxWidth: 320, cover: {x: .2, y: .5, w: .6, h: .02}})
  assert.equal(tiny[0], 0xff)
  assert.notDeepEqual(tiny, plain)
})

test('screenshotArgs swaps the white/navy detector for the wand key when one is given', () => {
  const cover = {x: .1, y: .8, w: .8, h: .12}
  const key = {colors: [[250, 30, 30]], tolerance: 24}
  const graph = argAfter(screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640, censorSubs: true, cover, key}), '-filter_complex')
  assert.match(graph, /abs\(r\(X,Y\)-250\)/)
  assert.match(graph, /maskedmerge/)
  assert.match(graph, /drawbox=x=0:y=0:w=iw:h=ih\*0\.660000/)
  const plain = argAfter(screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640, censorSubs: true, cover}), '-filter_complex')
  assert.doesNotMatch(plain, /abs\(r\(X,Y\)-250\)/)
  const invalid = argAfter(screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640, censorSubs: true, cover, key: {colors: []}}), '-filter_complex')
  assert.doesNotMatch(invalid, /abs\(r\(X,Y\)-/)
  const unused = screenshotArgs({video: '/v/ep.mkv', time: 1, maxWidth: 640, cover, key})
  assert.doesNotMatch(argAfter(unused, '-filter_complex'), /abs\(r\(X,Y\)-250\)/)
})

test('screenshot with a wand key removes a red caption the built-in detector ignores, and spares the rest', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-wand-'))
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}))
  const video = path.join(dir, 'v.mp4')
  const caption = "drawtext=text='HELLO WORLD':fontsize=40:fontcolor=0xff2020:x=(w-text_w)/2"
  const made = spawnSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x806040:s=640x360:d=1:r=10',
    '-vf', `${caption}:y=300,${caption}:y=20`, '-pix_fmt', 'yuv420p', video], {stdio: 'pipe'})
  assert.equal(made.status, 0, made.stderr?.toString())
  const rgb = jpeg => spawnSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {input: jpeg, maxBuffer: 1 << 24}).stdout
  const redPixels = (frame, from, to) => {
    let count = 0
    for (let p = from * 640 * 3; p < to * 640 * 3; p += 3) if (frame[p] > 200 && frame[p + 1] < 100 && frame[p + 2] < 100) count++
    return count
  }
  const plain = rgb(await screenshot({video, time: 0.5}))
  const built = rgb(await screenshot({video, time: 0.5, censorSubs: true}))
  const keyed = rgb(await screenshot({video, time: 0.5, censorSubs: true, key: {colors: [[255, 32, 32]], tolerance: 40}}))
  assert.ok(redPixels(plain, 295, 350) > 500, 'fixture has a red caption at the bottom')
  assert.ok(redPixels(built, 295, 350) > 500, 'built-in white/navy detector leaves red text alone')
  assert.equal(redPixels(keyed, 295, 350), 0, 'wand key removes the red text')
  assert.ok(redPixels(keyed, 0, 70) > 500, 'text outside the lower search band is untouched')
})

test('screenshot with a cover touching the left edge or full width still censors the caption', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-edge-'))
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}))
  const video = path.join(dir, 'v.mp4')
  const caption = "drawtext=text='HELLO WORLD':fontsize=40:fontcolor=0xff2020:x=(w-text_w)/2:y=300"
  const made = spawnSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x806040:s=640x360:d=1:r=10',
    '-vf', caption, '-pix_fmt', 'yuv420p', video], {stdio: 'pipe'})
  assert.equal(made.status, 0, made.stderr?.toString())
  const key = {colors: [[255, 32, 32]], tolerance: 40}
  for (const cover of [{x: 0, y: 0.75, w: 1, h: 0.25}, {x: 0.02, y: 0, w: 0.96, h: 1}]) {
    const frame = spawnSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
      {input: await screenshot({video, time: 0.5, censorSubs: true, cover, key}), maxBuffer: 1 << 24}).stdout
    let red = 0
    for (let p = 0; p < frame.length; p += 3) if (frame[p] > 200 && frame[p + 1] < 100 && frame[p + 2] < 100) red++
    assert.equal(red, 0, `cover ${JSON.stringify(cover)} left ${red} red pixels`)
  }
})
