const test = require('node:test')
const assert = require('node:assert/strict')
const {spawnSync} = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ffmpegStatic = require('ffmpeg-static')
const {Converter} = require('../src/core/converter')
const {probe} = require('../src/core/probe')

function ffmpeg(args) {
  const result = spawnSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  assert.equal(result.status, 0, result.stderr.toString())
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-converter-'))
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}))
  return dir
}

function sourceClip(dir, name, args) {
  const file = path.join(dir, name)
  ffmpeg(args.concat(file))
  return file
}

function tenBitClip(dir) {
  return sourceClip(dir, 'ten-bit [two audio].mkv', [
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2',
    '-map', '0:v', '-map', '1:a', '-map', '2:a',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-profile:v', 'high10', '-c:a', 'aac',
  ])
}

async function waitForFile(dir, predicate) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const match = fs.existsSync(dir) && fs.readdirSync(dir).find(predicate)
    if (match) return match
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('timed out waiting for a file in the cache')
}

test('plain h264 aac mp4 is played directly without touching the cache', async t => {
  const dir = tempDir(t)
  const video = sourceClip(dir, 'plain.mp4', [
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=2',
    '-f', 'lavfi', '-i', 'sine=duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
  ])
  const cacheDir = path.join(dir, 'cache')
  const converter = new Converter({cacheDir})
  const info = await probe(video)
  assert.equal(converter.plan(info, '.mp4', 1).mode, 'direct')
  assert.deepEqual(await converter.prepare(video, {audioStreamIndex: 1}), {path: video, mode: 'direct'})
  assert.equal(fs.existsSync(cacheDir), false)
})

test('10-bit h264 mkv is transcoded to one 8-bit h264 and one aac track, and cache hits skip ffmpeg', async t => {
  const dir = tempDir(t)
  const video = tenBitClip(dir)
  const cacheDir = path.join(dir, 'cache')
  const converter = new Converter({cacheDir})
  const info = await probe(video)
  assert.equal(converter.plan(info, '.mkv', 2).mode, 'transcode')

  const progress = []
  const first = await converter.prepare(video, {audioStreamIndex: 2, onProgress: fraction => progress.push(fraction)})
  assert.equal(first.mode, 'transcode')
  assert.equal(path.dirname(first.path), cacheDir)
  assert.ok(progress.length > 0 && progress.every(value => value >= 0 && value <= 1))
  assert.equal(progress.at(-1), 1)

  const out = await probe(first.path)
  const [v] = out.streams.filter(item => item.type === 'video')
  assert.deepEqual([v.codec, v.bitDepth], ['h264', 8])
  const audio = out.streams.filter(item => item.type === 'audio')
  assert.equal(audio.length, 1)
  assert.equal(audio[0].codec, 'aac')
  assert.equal(audio[0].channels, 2)

  const mtime = fs.statSync(first.path).mtimeMs
  const again = []
  const second = await converter.prepare(video, {audioStreamIndex: 2, onProgress: fraction => again.push(fraction)})
  assert.equal(second.path, first.path)
  assert.deepEqual(again, [1])
  assert.equal(fs.statSync(second.path).mtimeMs, mtime)
})

test('concurrent prepare calls share one output and cacheSize and clearCache manage it', async t => {
  const dir = tempDir(t)
  const video = tenBitClip(dir)
  const cacheDir = path.join(dir, 'cache')
  const converter = new Converter({cacheDir})
  const seen = [[], []]
  const [a, b] = await Promise.all([
    converter.prepare(video, {audioStreamIndex: 1, onProgress: fraction => seen[0].push(fraction)}),
    converter.prepare(video, {audioStreamIndex: 1, onProgress: fraction => seen[1].push(fraction)}),
  ])
  assert.equal(a.path, b.path)
  assert.deepEqual(fs.readdirSync(cacheDir), [path.basename(a.path)])
  assert.equal(seen[0].at(-1), 1)
  assert.equal(seen[1].at(-1), 1)
  assert.equal(await converter.cacheSize(), fs.statSync(a.path).size)
  await converter.clearCache()
  assert.equal(await converter.cacheSize(), 0)
  assert.equal(fs.existsSync(a.path), false)
})

test('8-bit h264 with ac3 audio in mkv is remuxed with video copied and audio converted', async t => {
  const dir = tempDir(t)
  const video = sourceClip(dir, 'remux.mkv', [
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=2',
    '-f', 'lavfi', '-i', 'sine=duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'ac3',
  ])
  const converter = new Converter({cacheDir: path.join(dir, 'cache')})
  const info = await probe(video)
  assert.equal(converter.plan(info, '.mkv', 1).mode, 'remux')
  const out = await converter.prepare(video, {audioStreamIndex: 1})
  assert.equal(out.mode, 'remux')
  const result = await probe(out.path)
  assert.equal(result.streams.find(item => item.type === 'video').codec, 'h264')
  const audio = result.streams.filter(item => item.type === 'audio')
  assert.deepEqual(audio.map(item => item.codec), ['aac'])
})

test('abort kills ffmpeg and removes the temp file', async t => {
  const dir = tempDir(t)
  const video = sourceClip(dir, 'long.mkv', [
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=60',
    '-f', 'lavfi', '-i', 'sine=duration=60',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-profile:v', 'high10', '-c:a', 'aac',
  ])
  const cacheDir = path.join(dir, 'cache')
  const converter = new Converter({cacheDir})
  const controller = new AbortController()
  const pending = converter.prepare(video, {audioStreamIndex: 1, signal: controller.signal})
  pending.catch(() => {})
  await waitForFile(cacheDir, name => name.endsWith('.tmp.mp4'))
  controller.abort()
  await assert.rejects(pending, {name: 'AbortError'})
  assert.deepEqual(fs.readdirSync(cacheDir), [])
})

test('re-preparing a key right after abort waits for the cancelled job and yields a valid output', async t => {
  const dir = tempDir(t)
  const video = sourceClip(dir, 'restart.mkv', [
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=30',
    '-f', 'lavfi', '-i', 'sine=duration=30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-profile:v', 'high10', '-c:a', 'aac',
  ])
  const cacheDir = path.join(dir, 'cache')
  const converter = new Converter({cacheDir})
  const controller = new AbortController()
  const pending = converter.prepare(video, {audioStreamIndex: 1, signal: controller.signal})
  pending.catch(() => {})
  await waitForFile(cacheDir, name => name.includes('.tmp'))
  controller.abort()
  const second = await converter.prepare(video, {audioStreamIndex: 1})
  await assert.rejects(pending, {name: 'AbortError'})
  assert.deepEqual(fs.readdirSync(cacheDir), [path.basename(second.path)])
  const out = await probe(second.path)
  assert.deepEqual(out.streams.filter(item => item.type === 'video').map(item => [item.codec, item.bitDepth]), [['h264', 8]])
  assert.deepEqual(out.streams.filter(item => item.type === 'audio').map(item => item.codec), ['aac'])
})

test('force re-encodes a direct-playable mp4 into a cached remux copy', async t => {
  const dir = tempDir(t)
  const video = sourceClip(dir, 'forced.mp4', [
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=2',
    '-f', 'lavfi', '-i', 'sine=duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
  ])
  const cacheDir = path.join(dir, 'cache')
  const converter = new Converter({cacheDir})
  const out = await converter.prepare(video, {audioStreamIndex: 1, force: true})
  assert.equal(out.mode, 'remux')
  assert.equal(path.dirname(out.path), cacheDir)
  assert.deepEqual(fs.readdirSync(cacheDir), [path.basename(out.path)])
  const result = await probe(out.path)
  assert.deepEqual(result.streams.filter(item => item.type === 'video').map(item => item.codec), ['h264'])
  assert.deepEqual(result.streams.filter(item => item.type === 'audio').map(item => item.codec), ['aac'])
  assert.deepEqual(await converter.prepare(video, {audioStreamIndex: 1}), {path: video, mode: 'direct'})
})
