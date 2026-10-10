const test = require('node:test')
const assert = require('node:assert/strict')
const {spawnSync} = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const ffmpegStatic = require('ffmpeg-static')
const {probe, pickDefaultAudio, pickDefaultSubtitle, isDirectPlayable, extractSubtitles} = require('../src/core/probe')

const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 180

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.10,0:00:00.90,Default,,0,0,0,,{\\an8}Hello\\Nthere
Dialogue: 0,0:00:01.00,0:00:01.90,Default,,0,0,0,,{\\b1}Second {\\i1}line{\\i0}
`

function ffmpeg(args) {
  const result = spawnSync(ffmpegStatic, ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  assert.equal(result.status, 0, result.stderr.toString())
}

function stream(overrides) {
  return {index: 0, type: 'audio', codec: 'aac', lang: null, title: null, default: false, pixFmt: null, bitDepth: null, channels: 2, textBased: false, ...overrides}
}

function info(streams) {
  return {duration: 2, streams}
}

test('probe reads two audio tracks and an ASS subtitle from a bracketed mkv path', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-probe-'))
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}))
  const ass = path.join(dir, 'sub.ass')
  fs.writeFileSync(ass, ASS)
  const video = path.join(dir, '[Group] Show - 01 (1080p) test.mkv')
  ffmpeg([
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2',
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=2',
    '-i', ass,
    '-map', '2:v', '-map', '0:a', '-map', '1:a', '-map', '3:s',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'ass',
    '-metadata:s:a:0', 'language=jpn', '-metadata:s:a:0', 'title=Japanese',
    '-metadata:s:a:1', 'language=eng',
    '-metadata:s:s:0', 'language=jpn',
    video,
  ])

  const result = await probe(video)
  assert.ok(Math.abs(result.duration - 2) < 0.2, `duration ${result.duration}`)
  const audio = result.streams.filter(item => item.type === 'audio')
  const subtitles = result.streams.filter(item => item.type === 'subtitle')
  assert.deepEqual(audio.map(item => [item.index, item.lang, item.codec, item.channels]), [[1, 'ja', 'aac', 1], [2, 'en', 'aac', 1]])
  assert.equal(audio[0].title, 'Japanese')
  assert.equal(audio[0].default, true)
  assert.equal(audio[1].default, false)
  assert.equal(subtitles.length, 1)
  assert.deepEqual([subtitles[0].index, subtitles[0].lang, subtitles[0].codec, subtitles[0].textBased], [3, 'ja', 'ass', true])
  const video0 = result.streams.find(item => item.type === 'video')
  assert.deepEqual([video0.codec, video0.pixFmt, video0.bitDepth], ['h264', 'yuv420p', 8])

  assert.equal(pickDefaultAudio(result.streams).index, 1)
  assert.equal(pickDefaultSubtitle(result.streams).index, 3)

  const cues = await extractSubtitles({video, streamIndex: 3})
  assert.deepEqual(cues.map(cue => cue.text), ['Hello\nthere', 'Second line'])
  assert.ok(cues.every(cue => cue.end > cue.start))
  assert.ok(cues[0].start < cues[1].start)
})

test('probe reports 10-bit pixel formats and rejects bitmap subtitle extraction', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-probe-'))
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}))
  const video = path.join(dir, 'ten.mkv')
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc=size=320x180:duration=2',
    '-f', 'lavfi', '-i', 'sine=duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p10le', '-profile:v', 'high10', '-c:a', 'aac',
    video,
  ])
  const result = await probe(video)
  const [v] = result.streams
  assert.deepEqual([v.type, v.codec, v.pixFmt, v.bitDepth], ['video', 'h264', 'yuv420p10le', 10])
  assert.equal(isDirectPlayable(result, '.mkv', 1), false)
  await assert.rejects(extractSubtitles({video, streamIndex: 0}), /no subtitle stream 0/)
})

test('probe rejects a missing file with a readable error', async () => {
  await assert.rejects(probe('/nonexistent/anime-mine/missing.mkv'), /video not found: \/nonexistent\/anime-mine\/missing\.mkv/)
})

test('pickDefaultAudio prefers ja, then the default flag, then the first track', () => {
  const streams = [
    stream({index: 1, lang: 'en'}),
    stream({index: 2, lang: 'fr', default: true}),
    stream({index: 3, lang: 'ja'}),
  ]
  assert.equal(pickDefaultAudio(streams).index, 3)
  assert.equal(pickDefaultAudio(streams.slice(0, 2)).index, 2)
  assert.equal(pickDefaultAudio([stream({index: 4, lang: 'en'}), stream({index: 5})]).index, 4)
  assert.equal(pickDefaultAudio([stream({index: 0, type: 'video', codec: 'h264'})]), null)
})

test('pickDefaultSubtitle picks text-based ja tracks and avoids sign or song tracks when possible', () => {
  const sub = overrides => stream({type: 'subtitle', codec: 'subrip', textBased: true, channels: null, ...overrides})
  const streams = [
    sub({index: 2, lang: 'ja', title: 'Signs & Songs'}),
    sub({index: 3, lang: 'ja', title: 'Dialogue'}),
    sub({index: 4, lang: 'ja', codec: 'hdmv_pgs_subtitle', textBased: false}),
  ]
  assert.equal(pickDefaultSubtitle(streams).index, 3)
  assert.equal(pickDefaultSubtitle([sub({index: 5, lang: 'ja', title: 'Songs'})]).index, 5)
  assert.equal(pickDefaultSubtitle([sub({index: 6, lang: 'en'})]), null)
  assert.equal(pickDefaultSubtitle([sub({index: 7, lang: 'ja', codec: 'dvd_subtitle', textBased: false})]), null)
})

test('isDirectPlayable accepts supported codecs and only the first audio track in mkv, webm and mp4', () => {
  const video = (overrides = {}) => stream({index: 0, type: 'video', codec: 'h264', channels: null, pixFmt: 'yuv420p', bitDepth: 8, ...overrides})
  const plain = info([video(), stream({index: 1, lang: 'ja'}), stream({index: 2, lang: 'en', codec: 'opus'})])
  assert.equal(isDirectPlayable(plain, '.mkv', 1), true)
  assert.equal(isDirectPlayable(plain, '.MP4', 1), true)
  assert.equal(isDirectPlayable(plain, '.mkv', 2), false)
  assert.equal(isDirectPlayable(plain, '.avi', 1), false)
  assert.equal(isDirectPlayable(info([video({codec: 'vp9'}), stream({index: 1})]), '.webm', 1), true)
  assert.equal(isDirectPlayable(info([video({codec: 'av1'}), stream({index: 1, codec: 'flac'})]), '.mkv', 1), true)
  assert.equal(isDirectPlayable(info([video({codec: 'hevc'}), stream({index: 1})]), '.mkv', 1), false)
  assert.equal(isDirectPlayable(info([video({bitDepth: 10})]), '.mkv', 1), false)
  assert.equal(isDirectPlayable(info([video(), stream({index: 1, codec: 'ac3'})]), '.mkv', 1), false)
})
