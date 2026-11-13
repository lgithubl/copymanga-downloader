// Rendering-component validation with original AGE assets and native placement
// bytecode. This does NOT claim the unknown full-game display transaction works.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { decodeAgeScript, decodeAgeImage, readAgeIndex, traceAgeProgram } from '../../web/library/gal/age.mjs'
import { analyzeAgeScene, encodeAgeScriptPackage } from '../../web/library/gal/adapters/age-sys4.mjs'
import { encodePng } from '../../web/library/gal/bgi.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { virtualEntry } from '../../web/library/gal/containers.mjs'
import { makeAgeNativeFixture } from './make-age-native-fixture.mjs'

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || '@playwright/test')
const root = '.cache/age-072229/extracted/g01/__verify/age', out = '.cache/age-adapter-display'
await mkdir(out, { recursive: true })
const index = readAgeIndex(await readFile('.cache/new-games-043952/extracted/g05/SYS4INI.BIN')), assets = new Map(), images = {}
for (const name of ['BG054AA.AGF', 'CS001AAA.AGF', 'CS002AAA.AGF']) {
  const decoded = decodeAgeImage(await readFile(root + '/' + name)), src = 'age/res/' + name.replace('.AGF', '.png')
  images[index.entries.find(e => e.name === name).ordinal] = { src, width: decoded.width, height: decoded.height }
  assets.set(src, encodePng(decoded.width, decoded.height, 4, decoded.rgba))
}
const prologueRoot = '.cache/age-prologue-065112/extracted/g01/__verify/age'
if (existsSync(prologueRoot)) for (const name of ['EV901A.AGF', 'EV902A.AGF']) {
  const decoded = decodeAgeImage(await readFile(prologueRoot + '/' + name)), src = 'age/res/' + name.replace('.AGF', '.png')
  images[index.entries.find(e => e.name === name).ordinal] = { src, width: decoded.width, height: decoded.height }
  assets.set(src, encodePng(decoded.width, decoded.height, 4, decoded.rgba))
}
const ids = traceAgeProgram(decodeAgeScript(await readFile('.cache/new-games-052443/extracted/g05/__verify/age/SYSTEM4.BIN')), { entry: 2040 })
const data = { ...JSON.parse(encodeAgeScriptPackage(await readFile('.cache/new-games-043952/extracted/g05/SC0000.BIN'), { name: 'SC0000.BIN' })), resources: { images } }
const draw = (slot, ordinal) => {
  const result = analyzeAgeScene(data, { scripts: { 'SC0000.BIN': { entry: 155991 } }, integers: { ...ids.integers, 970752: 101000, 970753: 101020, 970754: 101040, 970746: slot, 970711: ordinal } })
  assert.equal(result.complete, true); assert.equal(result.stats.run.status, 'returned')
  return result.steps.flatMap(s => s.commands)
}
const sn = JSON.parse(encodeAgeScriptPackage(await readFile(root + '/SN0000.BIN'), { name: 'SN0000.BIN' }))
const first = decodeAgeScript(Buffer.from(sn.script, 'base64')).instructions.find(i => i.opcode === 0x6e)
const narration = analyzeAgeScene(sn, { scripts: { 'SN0000.BIN': { entry: first.offset } } })
assert.equal(narration.complete, false); assert.equal(narration.stats.run.stopped.opcode, 0x305)
const nativeFixture = await makeAgeNativeFixture('.cache/age-native-browser')
const nativeConfig = normalizeGalConfig({ containers: { enabled: true, format: 'age', mode: 'hybrid', dir: 'age', scan: ['.'], rules: [{ match: '\\.alf$' }] } })
const voicePath = 'age/res/sys4ini/FIA0026.wav', voiceEntry = await virtualEntry({ mediaDir: nativeFixture.root, config: nativeConfig, rels: [voicePath] })
assert.ok(voiceEntry); assets.set(voicePath, await voiceEntry.read())
const scene = { format: 'gal-scene/1', adapter: 'age::sys4', steps: [{ index: 0, commands: [
  ...draw(0, 77), ...draw(2, 16485), { op: 'voice', src: voicePath }, ...narration.steps[0].commands,
] }], stats: { diagnosticOnly: true } }
await writeFile(out + '/diagnostic-scene.json', JSON.stringify(scene, null, 2))
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><link rel="stylesheet" href="/style.css"><div id="host" style="width:1280px;height:850px"></div>'); return }
    if (url.pathname === '/fixture') { const rel = url.searchParams.get('path'), bytes = assets.get(rel); if (!bytes) { res.writeHead(404); res.end(); return }; res.setHeader('Content-Type', rel.endsWith('.wav') ? 'audio/wav' : 'image/png'); res.end(bytes); return }
    const file = url.pathname.slice(1)
    if (!/^[a-zA-Z0-9_.-]+\.(?:js|css)$/.test(file)) { res.writeHead(404); res.end(); return }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/css')
    res.end(await readFile(path.join('web/static', file)))
  } catch { res.writeHead(404); res.end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port, errors = []
let browser
try {
  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
  const page = await browser.newPage({ viewport: { width: 1320, height: 900 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.addInitScript(() => { const Native = window.Audio; window.__audios = []; window.Audio = function(src) { const audio = new Native(src); window.__audios.push(audio); return audio }; window.Audio.prototype = Native.prototype })
  await page.goto(base)
  await page.evaluate(async ({ scene, base }) => {
    const { createGalPlayer } = await import('/gal-player.js')
    window.player = createGalPlayer({ container: document.querySelector('#host'), reader: { node: {}, scene, resourceBase: base + '/fixture' } })
  }, { scene, base })
  await page.waitForFunction(() => document.querySelector('.gal-text')?.textContent.includes('がありました。'))
  await page.waitForFunction(() => { const c = document.querySelector('canvas.gal-overlay'); return c && c.getContext('2d').getImageData(600, 200, 1, 1).data[3] > 0 })
  assert.ok(await page.locator('.gal-text ruby').count() > 0, 'native furigana renders')
  await page.waitForFunction(() => window.__audios.some(a => a.currentTime > 0 && !a.paused && !a.error && !a.loop), null, { timeout: 15000 })
  const pixels = await page.evaluate(async base => {
    const actual = document.querySelector('canvas.gal-overlay'), ref = document.createElement('canvas')
    ref.width = actual.width; ref.height = actual.height
    const ctx = ref.getContext('2d'), k = actual.width / 1600
    for (const [name, x, y] of [['BG054AA', 0, 0], ['CS001AAA', 128, -28]]) {
      const image = new Image(); image.src = base + '/fixture?path=' + encodeURIComponent('age/res/' + name + '.png'); await image.decode()
      ctx.drawImage(image, x * k, y * k, image.naturalWidth * k, image.naturalHeight * k)
    }
    const a = actual.getContext('2d').getImageData(0, 0, ref.width, ref.height).data, b = ctx.getImageData(0, 0, ref.width, ref.height).data
    let checked = 0, mismatches = 0
    for (let i = 0; i < b.length; i += 4 * 31) { checked++; if ([0, 1, 2, 3].some(c => Math.abs(a[i + c] - b[i + c]) > 2)) mismatches++ }
    return { checked, mismatches }
  }, base)
  assert.ok(pixels.checked > 1000); assert.equal(pixels.mismatches, 0)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: out + '/native-components.png' })
  let prologuePixels = null
  if (images[4814]) {
    const prefix = analyzeAgeScene({ ...sn, resources: { images } })
    assert.equal(prefix.complete, false); assert.equal(prefix.stats.run.stopped.opcode, 0x224)
    assert.deepEqual(prefix.stats.timeline, { elapsedMs: 5500, pendingMs: 0, barriers: 2 })
    const prefixScene = { format: 'gal-scene/1', steps: prefix.steps.map(s => ({ ...s, commands: s.commands.filter(c => c.op !== 'overlayMove') })), stats: { diagnosticOnly: true } }
    await writeFile(out + '/native-prologue-prefix.json', JSON.stringify(prefix, null, 2))
    const probe = await browser.newPage({ viewport: { width: 1320, height: 900 } })
    probe.on('pageerror', e => errors.push(e.message))
    await probe.goto(base)
    await probe.evaluate(async ({ scene, base }) => {
      const { createGalPlayer } = await import('/gal-player.js')
      window.player = createGalPlayer({ container: document.querySelector('#host'), reader: { node: {}, scene, resourceBase: base + '/fixture' } })
    }, { scene: prefixScene, base })
    await probe.waitForFunction(() => { const c = document.querySelector('canvas.gal-overlay'); return c && c.getContext('2d').getImageData(400, 200, 1, 1).data[3] > 0 }, null, { timeout: 20000 })
    prologuePixels = await probe.evaluate(async base => {
      const actual = document.querySelector('canvas.gal-overlay'), ref = document.createElement('canvas')
      ref.width = actual.width; ref.height = actual.height
      const image = new Image(); image.src = base + '/fixture?path=age/res/EV901A.png'; await image.decode()
      const k = ref.width / 1600
      ref.getContext('2d').drawImage(image, 0, (900 - 1844) * k, 1600 * k, 1844 * k)
      const a = actual.getContext('2d').getImageData(0, 0, ref.width, ref.height).data, b = ref.getContext('2d').getImageData(0, 0, ref.width, ref.height).data
      let checked = 0, mismatches = 0
      for (let i = 0; i < a.length; i += 4 * 31) { checked++; if ([0,1,2,3].some(c => Math.abs(a[i+c]-b[i+c]) > 2)) mismatches++ }
      return { checked, mismatches }
    }, base)
    assert.equal(prologuePixels.mismatches, 0); assert.deepEqual(errors, [])
    await probe.screenshot({ path: out + '/native-prologue-prefix.png' })
    await probe.close()
    // Render the native 80-second pan with a deterministic RAF clock. The
    // scene is a diagnostic prefix, not a claim that the remaining BIN runs.
    const pan = await browser.newPage({ viewport: { width: 1320, height: 900 } })
    pan.on('pageerror', e => errors.push(e.message))
    await pan.addInitScript(() => {
      window.__clock = 0
      // Repeated readbacks otherwise switch Chrome's actual canvas from GPU
      // to CPU while each fresh reference remains GPU-backed (different
      // resampling). Use the same deterministic 2D backend for pixel checks.
      const getContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function(kind, options) { return getContext.call(this, kind, kind === '2d' ? { ...options, willReadFrequently: true } : options) }
      Object.defineProperty(performance, 'now', { value: () => window.__clock })
      const raf = requestAnimationFrame.bind(window)
      window.requestAnimationFrame = cb => raf(() => cb(window.__clock))
    })
    await pan.goto(base)
    const panCommands = prefix.steps.flatMap(s => s.commands).filter(c => c.op === 'overlay' || c.op === 'overlayMove')
    await pan.evaluate(async ({ commands, base }) => {
      const { createGalPlayer } = await import('/gal-player.js')
      const scene = { format: 'gal-scene/1', steps: [
        { index: 0, commands: [...commands, { op: 'text', segments: [{ text: 'pan start' }] }] },
        { index: 1, commands: [{ op: 'text', segments: [{ text: 'pan continues' }] }] },
      ] }
      window.panScene = scene
      window.player = createGalPlayer({ container: document.querySelector('#host'), reader: { node: {}, scene, resourceBase: base + '/fixture' } })
    }, { commands: panCommands, base })
    await pan.waitForFunction(() => document.querySelector('canvas.gal-overlay')?.dataset.parts === '1')
    const frames = []
    for (const [ms, expectedY] of [[0, -944], [40000, -472], [80000, 0]]) {
      await pan.evaluate(ms => { window.__clock = ms }, ms)
      await pan.waitForTimeout(100)
      if (ms === 40000) {
        await pan.evaluate(() => window.player.next())
        await pan.waitForTimeout(100)
        assert.equal(await pan.evaluate(() => window.player.index), 1)
      }
      const result = await pan.evaluate(async ({ base, expectedY }) => {
        const actual = document.querySelector('canvas.gal-overlay'), ref = document.createElement('canvas')
        ref.width = actual.width; ref.height = actual.height
        const img = new Image(); img.src = base + '/fixture?path=age/res/EV901A.png'; await img.decode()
        const k = ref.width / 1600
        ref.getContext('2d').drawImage(img, 0, 0, 1600, 1844, 0, expectedY * k, 1600 * k, 1844 * k)
        const a = actual.getContext('2d').getImageData(0, 0, ref.width, ref.height).data, b = ref.getContext('2d').getImageData(0, 0, ref.width, ref.height).data
        window.__panReference = b
        let checked = 0, mismatches = 0, max = 0; const examples=[]
        for (let i = 0; i < a.length; i += 124) { checked++; const d=Math.max(...[0,1,2,3].map(c=>Math.abs(a[i+c]-b[i+c]))); max=Math.max(max,d); if(d>2) { mismatches++; if(examples.length<3) examples.push({x:(i/4)%ref.width,y:Math.floor(i/4/ref.width),a:[...a.slice(i,i+4)],b:[...b.slice(i,i+4)]}) } }
        return { checked, mismatches, max, examples }
      }, { base, expectedY })
      assert.equal(result.mismatches, 0, `native pan frame ${ms}ms`)
      frames.push({ ms, ...result })
    }
    // Backward seek reconstructs final state, without replaying a stale tween.
    await pan.evaluate(() => window.player.prev())
    await pan.waitForTimeout(100)
    const seekState = await pan.evaluate(async () => {
      const { stateAt } = await import('/gal-engine.js')
      return stateAt(window.panScene, 0).overlays[0]
    })
    assert.equal(seekState.y, 472)
    const seekPixels = await pan.evaluate(() => {
      const c = document.querySelector('canvas.gal-overlay'), a = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, b = window.__panReference
      let mismatches = 0
      for (let i = 0; i < a.length; i += 124) if ([0,1,2,3].some(k => Math.abs(a[i+k]-b[i+k]) > 2)) mismatches++
      return { mismatches }
    })
    assert.equal(seekPixels.mismatches, 0, 'backward seek paints the final pose')
    assert.deepEqual(errors, [])
    await writeFile(out + '/native-pan-verification.json', JSON.stringify({ frames, nextSentenceContinues: true, seekPixels, seekFinalY: seekState.y }, null, 2))
    await pan.close()
  }
  await writeFile(out + '/verification.json', JSON.stringify({ componentRendering: true, nativeXwmVoicePlayback: true, fullGamePlayback: false, pixels, prologuePixels, errors, placementHelperReturned: true, stops: ['SN0000 prefix:0x224', 'text-tail:0x305'] }, null, 2))
  console.log('PASS native AGE component display (not full scene playback)', pixels, out)
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
