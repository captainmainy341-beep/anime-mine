const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {Desubber} = require('../src/core/desubber')

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-mine-desub-'))
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}))
  return dir
}

function makeVideo(dataDir, name) {
  const file = path.join(dataDir, name)
  fs.writeFileSync(file, 'source')
  return file
}

function createTools(toolsDir) {
  fs.mkdirSync(path.join(toolsDir, 'venv', 'bin'), {recursive: true})
  fs.writeFileSync(path.join(toolsDir, 'venv', 'bin', 'python'), '')
  fs.writeFileSync(path.join(toolsDir, 'big-lama.pt'), '')
}

// Each run writes a partial tmp file like the real engine does, then waits for the test to finish it.
function fakeRunner() {
  const runs = []
  const runner = ({python, args, onStdoutLine, signal}) =>
    new Promise(resolve => {
      const run = {python, args, video: args[1], temp: args.find(arg => arg.endsWith('.tmp.mp4')), model: args[3], ffmpeg: args[4], signal, line: onStdoutLine}
      run.finish = (code, stderr = '') => resolve({code, stderr})
      signal.addEventListener('abort', () => resolve({code: null, stderr: ''}), {once: true})
      fs.writeFileSync(run.temp, 'partial')
      runs.push(run)
    })
  return {runner, runs}
}

async function until(check) {
  for (let i = 0; i < 500 && !check(); i++) await new Promise(resolve => setImmediate(resolve))
  assert.ok(check(), 'condition not reached')
}

function stubProbe(t, duration) {
  const probe = require('../src/core/probe')
  const original = probe.probe
  probe.probe = async () => ({duration})
  t.after(() => {
    probe.probe = original
  })
}

function setup(t, {installed = true} = {}) {
  const dataDir = tempDir(t)
  const {runner, runs} = fakeRunner()
  const installs = []
  const desubber = new Desubber({
    dataDir,
    ffmpegPath: () => '/bin/ffmpeg',
    runner,
    installer: async ({toolsDir, onStatus}) => {
      installs.push(toolsDir)
      for (const step of ['venv', 'packages', 'model']) onStatus(step)
      createTools(toolsDir)
    },
  })
  if (installed) createTools(desubber.toolsDir)
  t.after(() => desubber.stop())
  return {dataDir, desubber, runs, installs}
}

test('jobs run one at a time in enqueue order', async t => {
  const {dataDir, desubber, runs} = setup(t)
  const first = makeVideo(dataDir, 'a.mkv')
  const second = makeVideo(dataDir, 'b.mkv')
  await desubber.enqueue(first, {})
  await desubber.enqueue(second, {})
  await until(() => runs.length === 1)
  assert.equal(runs[0].video, first)
  assert.deepEqual(desubber.status().queued, [second])
  runs[0].finish(0)
  await until(() => runs.length === 2)
  assert.equal(runs[1].video, second)
  assert.deepEqual(desubber.status().queued, [])
  runs[1].finish(0)
  await until(() => desubber.status().current === null)
  assert.equal(runs.length, 2)
})

test('a duplicate enqueue of a queued, running or cleaned video is a no-op', async t => {
  const {dataDir, desubber, runs} = setup(t)
  const video = makeVideo(dataDir, 'a.mkv')
  const other = makeVideo(dataDir, 'b.mkv')
  await desubber.enqueue(video, {})
  await desubber.enqueue(other, {})
  await desubber.enqueue(other, {})
  assert.deepEqual(desubber.status().queued, [other])
  await until(() => runs.length === 1)
  await desubber.enqueue(video, {})
  assert.deepEqual(desubber.status().queued, [other])
  runs[0].finish(0)
  await until(() => runs.length === 2)
  runs[1].finish(0)
  await until(() => desubber.status().current === null)
  await desubber.enqueue(video, {})
  assert.equal(runs.length, 2)
  assert.deepEqual(desubber.status().queued, [])
})

test('progress lines from the engine update the status and onProgress', async t => {
  const {dataDir, desubber, runs} = setup(t)
  const video = makeVideo(dataDir, 'a.mkv')
  const fractions = []
  await desubber.enqueue(video, {onProgress: fraction => fractions.push(fraction)})
  await until(() => runs.length === 1)
  runs[0].line('progress 0.25')
  runs[0].line('ffmpeg: noise')
  runs[0].line('progress 0.5000')
  await until(() => fractions.length === 2)
  assert.deepEqual(fractions, [0.25, 0.5])
  assert.deepEqual(desubber.status().current, {video, fraction: 0.5})
  runs[0].finish(1, 'stopped')
  await until(() => desubber.status().current === null)
})

test('a finished job renames tmp to the cache file that cleanedPath then finds', async t => {
  const {dataDir, desubber, runs} = setup(t)
  const video = makeVideo(dataDir, 'a.mkv')
  const done = []
  await desubber.enqueue(video, {onDone: output => done.push(output)})
  await until(() => runs.length === 1)
  assert.equal(await desubber.cleanedPath(video), null)
  assert.match(path.basename(runs[0].temp), /\.tmp\.mp4$/)
  runs[0].finish(0)
  await until(() => done.length === 1)

  const {mtimeMs, size} = fs.statSync(video)
  const key = crypto.createHash('sha1').update(`${video}|${mtimeMs}|${size}|desub1`).digest('hex')
  const output = path.join(dataDir, 'desubbed', `${key}.mp4`)
  assert.equal(done[0], output)
  assert.equal(await desubber.cleanedPath(video), output)
  assert.equal(fs.existsSync(output), true)
  assert.equal(fs.existsSync(runs[0].temp), false)
})

test('a failed job deletes its tmp file and reports the last stderr line', async t => {
  const {dataDir, desubber, runs} = setup(t)
  const video = makeVideo(dataDir, 'a.mkv')
  const errors = []
  await desubber.enqueue(video, {onError: error => errors.push(error.message)})
  await until(() => runs.length === 1)
  runs[0].finish(1, 'Traceback\nValueError: bad frame')
  await until(() => desubber.status().current === null)
  assert.deepEqual(errors, ['desub failed (1): ValueError: bad frame'])
  assert.equal(fs.existsSync(runs[0].temp), false)
  assert.equal(await desubber.cleanedPath(video), null)
})

test('cancel kills the running child, deletes its tmp file and starts the next job', async t => {
  const {dataDir, desubber, runs} = setup(t)
  const first = makeVideo(dataDir, 'a.mkv')
  const second = makeVideo(dataDir, 'b.mkv')
  const errors = []
  await desubber.enqueue(first, {onError: error => errors.push(error)})
  await desubber.enqueue(second, {})
  await until(() => runs.length === 1)
  await desubber.cancel(first)
  assert.equal(runs[0].signal.aborted, true)
  assert.equal(fs.existsSync(runs[0].temp), false)
  assert.deepEqual(errors, [])
  await until(() => runs.length === 2)
  assert.equal(runs[1].video, second)
})

test('stop cancels the running job and empties the queue', async t => {
  const {dataDir, desubber, runs} = setup(t)
  const first = makeVideo(dataDir, 'a.mkv')
  const second = makeVideo(dataDir, 'b.mkv')
  await desubber.enqueue(first, {})
  await desubber.enqueue(second, {})
  await until(() => runs.length === 1)
  desubber.stop()
  assert.equal(runs[0].signal.aborted, true)
  assert.deepEqual(desubber.status().queued, [])
  await until(() => desubber.status().current === null)
  assert.equal(runs.length, 1)
})

test('a job installs the tools first when they are missing', async t => {
  const {dataDir, desubber, runs, installs} = setup(t, {installed: false})
  const video = makeVideo(dataDir, 'a.mkv')
  assert.equal(desubber.status().installed, false)
  await desubber.enqueue(video, {})
  await until(() => runs.length === 1)
  assert.equal(installs.length, 1)
  assert.equal(desubber.isInstalled(), true)
  assert.equal(runs[0].python, path.join(desubber.toolsDir, 'venv', 'bin', 'python'))
  assert.equal(runs[0].model, path.join(desubber.toolsDir, 'big-lama.pt'))
  assert.equal(runs[0].ffmpeg, '/bin/ffmpeg')
  runs[0].finish(0)
  await until(() => desubber.status().current === null)
})

test('install reports each step through onStatus', async t => {
  const {desubber} = setup(t, {installed: false})
  const steps = []
  await desubber.install(step => steps.push(step))
  assert.deepEqual(steps, ['venv', 'packages', 'model'])
  assert.equal(desubber.status().installing, false)
  assert.equal(desubber.status().installed, true)
})

test('clearCache cancels the running job and deletes only cached videos', async t => {
  const {dataDir, desubber, runs} = setup(t)
  const cache = path.join(dataDir, 'desubbed')
  fs.mkdirSync(cache, {recursive: true})
  fs.writeFileSync(path.join(cache, `${'a'.repeat(40)}.mp4`), 'x'.repeat(10))
  fs.writeFileSync(path.join(cache, 'notes.txt'), 'keep')
  assert.equal(await desubber.cacheSize(), 10)

  const video = makeVideo(dataDir, 'a.mkv')
  await desubber.enqueue(video, {})
  await until(() => runs.length === 1)
  await desubber.clearCache()
  assert.equal(runs[0].signal.aborted, true)
  assert.equal(fs.existsSync(runs[0].temp), false)
  assert.deepEqual(fs.readdirSync(cache), ['notes.txt'])
  assert.equal(await desubber.cacheSize(), 0)
})

test('blur mode runs the blur filter through ffmpeg without installing or checking the tools', async t => {
  const {dataDir, desubber, runs, installs} = setup(t, {installed: false})
  stubProbe(t, 10)
  let checks = 0
  desubber.isInstalled = () => {
    checks += 1
    return false
  }
  const video = makeVideo(dataDir, 'a.mkv')
  await desubber.enqueue(video, {}, 'blur')
  await until(() => runs.length === 1)
  const {args} = runs[0]
  assert.equal(runs[0].python, '/bin/ffmpeg')
  assert.deepEqual(args.slice(0, 11), ['-hide_banner', '-loglevel', 'error', '-y', '-nostats', '-progress', 'pipe:1', '-protocol_whitelist', 'file', '-i', video])
  assert.equal(args[11], '-filter_complex')
  assert.match(args[12], /^\[0:v\]format=gbrp,split=2\[full\]\[bandsrc\];.*\[full\]\[bandout\]overlay=0:H\*0\.62,format=yuv420p\[o\]$/)
  assert.deepEqual(args.slice(13), [
    '-map', '[o]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy', '-sn', '-dn', '-movflags', '+faststart', '-f', 'mp4', runs[0].temp,
  ])
  assert.deepEqual(installs, [])
  assert.equal(checks, 0)
  runs[0].finish(0)
  await until(() => desubber.status().current === null)
})

test('blur progress reads out_time_us against the probed duration and clamps to 1', async t => {
  const {dataDir, desubber, runs} = setup(t)
  stubProbe(t, 10)
  const video = makeVideo(dataDir, 'a.mkv')
  const fractions = []
  await desubber.enqueue(video, {onProgress: fraction => fractions.push(fraction)}, 'blur')
  await until(() => runs.length === 1)
  runs[0].line('progress=continue')
  runs[0].line('out_time_us=N/A')
  runs[0].line('out_time_us=2500000')
  runs[0].line('out_time_us=12000000')
  await until(() => fractions.length === 2)
  assert.deepEqual(fractions, [0.25, 1])
  assert.deepEqual(desubber.status().current, {video, fraction: 1})
  runs[0].finish(1, 'stopped')
  await until(() => desubber.status().current === null)
})

test('blur output is cached under its own key and is not the ai cache file', async t => {
  const {dataDir, desubber, runs} = setup(t)
  stubProbe(t, 10)
  const video = makeVideo(dataDir, 'a.mkv')
  const done = []
  await desubber.enqueue(video, {onDone: output => done.push(output)}, 'blur')
  await until(() => runs.length === 1)
  runs[0].finish(0)
  await until(() => done.length === 1)

  const {mtimeMs, size} = fs.statSync(video)
  const key = crypto.createHash('sha1').update(`${video}|${mtimeMs}|${size}|blur1`).digest('hex')
  assert.equal(done[0], path.join(dataDir, 'desubbed', `${key}.mp4`))
  assert.equal(await desubber.cleanedPath(video, 'blur'), done[0])
  assert.equal(await desubber.cleanedPath(video), null)
  assert.equal(await desubber.cleanedPath(video, 'ai'), null)
})


test('blur progress is not reported when the duration is unknown', async t => {
  const {dataDir, desubber, runs} = setup(t)
  stubProbe(t, null)
  const video = makeVideo(dataDir, 'a.mkv')
  const fractions = []
  await desubber.enqueue(video, {onProgress: fraction => fractions.push(fraction)}, 'blur')
  await until(() => runs.length === 1)
  runs[0].line('out_time_us=2500000')
  assert.deepEqual(fractions, [])
  runs[0].finish(1, 'stopped')
  await until(() => desubber.status().current === null)
})

test('a blur job and an ai job for the same video are queued separately', async t => {
  const {dataDir, desubber, runs} = setup(t)
  stubProbe(t, 10)
  const video = makeVideo(dataDir, 'a.mkv')
  await desubber.enqueue(video, {}, 'blur')
  await desubber.enqueue(video, {}, 'ai')
  await desubber.enqueue(video, {}, 'ai')
  await until(() => runs.length === 1)
  assert.equal(desubber.status().queued.length, 1)
  runs[0].finish(0)
  await until(() => runs.length === 2)
  runs[1].finish(0)
  await until(() => desubber.status().current === null)
})
