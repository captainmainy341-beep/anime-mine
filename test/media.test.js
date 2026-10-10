const test = require('node:test')
const assert = require('node:assert/strict')
const {spawnSync} = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ffmpegStatic = require('ffmpeg-static')
const {extractAudio, screenshot, audioArgs, screenshotArgs} = require('../src/core/media')

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
