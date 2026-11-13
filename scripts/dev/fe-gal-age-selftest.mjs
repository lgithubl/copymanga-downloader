// Rendering-component validation with original AGE assets and native placement
// bytecode. This does NOT claim the unknown full-game display transaction works.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { decodeAgeScript, decodeAgeImage, readAgeIndex, traceAgeProgram } from '../../web/library/gal/age.mjs'
import { analyzeAgeScene, encodeAgeScriptPackage, parse } from '../../web/library/gal/adapters/age-sys4.mjs'
import { computeMarkers } from '../../web/library/gal/markers.mjs'
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
// A controlled bytecode scene exercises the complete parser/player path.
// Original CVINIT/SNINIT and AGF/WAV are used; this is not original plot flow.
const manifest = JSON.parse(await readFile('.cache/age-upstream-20261113/manifest.json'))
const initialization = await Promise.all(['link-SNINIT.BIN','verify-CVINIT.BIN'].map(async key => ({ name: key.replace(/^[^-]*-/, ''), script: (await readFile(manifest.records.find(r => r.key === key).source)).toString('base64') })))
const names = traceAgeProgram(decodeAgeScript(Buffer.from(initialization[1].script,'base64'))).strings
const nameKey = Number(Object.entries(names).find(([,v]) => v === 'ナレーション')[0])
const words = [], emit = (op, ...args) => { words.push(op); for (const [type,value] of args) words.push(type,value) }, n = v => [0,v]
emit(0x1f9,n(77),n(10),n(-1)); emit(0x1fb,...[20,10,0,0,1600,900,0,0].map(n))
emit(0x6e,n(0),[5,nameKey]); emit(0x72,n(0))
emit(0x1f9,n(16485),n(11),n(-1)); emit(0x1fb,...[21,11,0,0,512,900,0,0].map(n))
emit(0xc4,n(7)); emit(0x6e,n(0),[5,nameKey]); emit(0x72,n(0))
emit(0x2f6,n(0)); emit(0x6e,n(0),[5,nameKey]); emit(0x72,n(0))
emit(0x6e,n(0),[5,nameKey]); emit(0x72,n(0)); emit(2)
const controlBin=Buffer.alloc(60+words.length*4);controlBin.write('SYS4485 ');controlBin.writeUInt32LE(28,32)
for(const at of [40,48,56])controlBin.writeUInt32LE(words.length,at)
words.forEach((v,i)=>controlBin.writeUInt32LE(v>>>0,60+i*4))
const parsedScene=parse(JSON.stringify({ ...JSON.parse(encodeAgeScriptPackage(controlBin,{name:'controlled.BIN'})),initialization,resources:{images,voice:{7:voicePath}} }))
assert.equal(parsedScene.stats.initialization.complete,true);assert.equal(parsedScene.steps.length,4)
const markers=computeMarkers(parsedScene,[{kind:'cmd',op:'overlay',re:/CS001AAA/,label:'CG',pick:'each',max:6}])
assert.deepEqual(markers.map(m=>m.step),[1])
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
    assert.equal(prefix.complete, false); assert.equal(prefix.stats.run.stopped.opcode, 0x35c)
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
  // Use the captured XWM-derived WAV to verify actual Audio lifecycle. The
  // fixture intentionally reuses it as BGM; this is not a native track binding.
  await page.bringToFront()
  await page.evaluate(async ({ base, voicePath }) => {
    window.player.destroy(); window.__audios = []
    const { createGalPlayer } = await import('/gal-player.js')
    const scene = { format: 'gal-scene/1', steps: [
      { index: 0, commands: [{ op: 'bgm', src: voicePath }, { op: 'text', segments: [{ text: 'A' }] }] },
      { index: 1, commands: [{ op: 'bgmStop', fade: 80 }, { op: 'text', segments: [{ text: 'B' }] }] },
      { index: 2, commands: [{ op: 'bgmStop' }, { op: 'text', segments: [{ text: 'C' }] }] },
      { index: 3, commands: [{ op: 'bgm', src: voicePath }, { op: 'text', segments: [{ text: 'D' }] }] },
    ] }
    window.player = createGalPlayer({ container: document.querySelector('#host'), reader: { node: {}, scene, resourceBase: base + '/fixture' } })
  }, { base, voicePath })
  await page.waitForFunction(() => window.__audios.some(a => a.currentTime > 0 && !a.paused && !a.error))
  await page.waitForTimeout(150)
  await page.evaluate(() => window.player.next())
  await page.waitForFunction(() => window.player.index === 1 && !window.__audios[0].paused)
  await page.waitForTimeout(150)
  await page.evaluate(() => window.player.next())
  await page.waitForFunction(() => window.player.index === 2 && window.__audios.every(a => a.paused))
  await page.waitForTimeout(150)
  await page.evaluate(() => window.player.next())
  await page.waitForFunction(() => window.player.index === 3 && window.__audios.length === 2 && !window.__audios[1].paused && window.__audios[1].volume > 0)
  await page.waitForTimeout(150)
  await page.evaluate(() => window.player.prev())
  await page.waitForFunction(() => window.__audios.every(a => a.paused))
  await page.waitForTimeout(150)
  await page.evaluate(() => window.player.prev())
  await page.waitForTimeout(150)
  await page.evaluate(() => window.player.prev())
  await page.waitForFunction(() => window.__audios.some(a => !a.paused))
  await page.waitForTimeout(150)
  await page.evaluate(() => window.player.next())
  await page.waitForFunction(() => window.player.index === 1)
  await page.evaluate(() => window.player.destroy())
  assert.equal(await page.evaluate(() => window.__audios.every(a => a.paused)), true, 'destroy stops detached fading BGM too')
  assert.deepEqual(errors, [])
  await writeFile(out + '/bgm-stop-verification.json', JSON.stringify({ immediateStopDuringFade: true, nextTrackRestoresVolume: true, backwardSeekStopsAudio: true, destroyStopsFade: true }, null, 2))
  // Real browser audio: stopping voice keeps BGM playing; a visibility
  // transition must not restart the stopped voice. Seeking stops it as well.
  await page.evaluate(async ({ base, voicePath }) => {
    window.__audios = []
    const { createGalPlayer } = await import('/gal-player.js')
    const scene = { format: 'gal-scene/1', steps: [
      { index: 0, commands: [{ op: 'bgm', src: voicePath }, { op: 'voice', src: voicePath }, { op: 'text', segments: [{ text: 'voice start' }] }] },
      { index: 1, commands: [{ op: 'voiceStop' }, { op: 'text', segments: [{ text: 'voice stopped' }] }] },
      { index: 2, commands: [{ op: 'voice', src: voicePath }, { op: 'text', segments: [{ text: 'voice again' }] }] },
    ] }
    window.player = createGalPlayer({ container: document.querySelector('#host'), reader: { node: {}, scene, resourceBase: base + '/fixture' } })
  }, { base, voicePath })
  await page.waitForFunction(() => window.__audios.some(a => a.loop && a.currentTime > 0 && !a.paused) && window.__audios.some(a => !a.loop && a.currentTime > 0 && !a.paused))
  await page.evaluate(() => { window.__voice = window.__audios.find(a => !a.loop && a.currentTime > 0 && !a.paused); window.__bgm = window.__audios.find(a => a.loop && !a.paused) })
  await page.evaluate(() => window.player.next())
  await page.waitForFunction(() => window.player.index === 1 && !window.__bgm.paused && window.__voice.paused)
  await page.locator('#host').evaluate(el => { el.style.display = 'none' })
  await page.waitForFunction(() => window.__bgm.paused)
  await page.locator('#host').evaluate(el => { el.style.display = '' })
  await page.waitForFunction(() => !window.__bgm.paused)
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => window.__voice.paused), true, 'visibility must not resume stopped voice')
  await page.evaluate(() => window.player.next())
  await page.waitForFunction(() => window.__audios.some(a => !a.loop && a !== window.__voice && a.currentTime > 0 && !a.paused))
  await page.evaluate(() => { window.__voice2 = window.__audios.find(a => !a.loop && a !== window.__voice && a.currentTime > 0 && !a.paused); window.player.prev() })
  await page.waitForFunction(() => window.__voice2.paused)
  await page.evaluate(() => window.player.destroy())
  assert.equal(await page.evaluate(() => window.__audios.every(a => a.paused)), true)
  assert.deepEqual(errors, [])
  await writeFile(out + '/voice-stop-verification.json', JSON.stringify({ stopPreservesBgm: true, visibilityDoesNotResumeVoice: true, seekStopsVoice: true, destroyStopsAudio: true }, null, 2))
  await page.evaluate(async ({ scene, markers, base }) => {
    const { createGalPlayer } = await import('/gal-player.js')
    window.player=createGalPlayer({container:document.querySelector('#host'),reader:{node:{markers},scene,resourceBase:base+'/fixture'},startStep:markers[0].step})
  }, {scene:parsedScene,markers,base})
  await page.waitForFunction(()=>window.player.index===1 && document.querySelector('canvas.gal-overlay')?.dataset.parts==='2')
  await page.waitForFunction(()=>document.querySelector('.gal-text')?.textContent.includes('ナレーション'))
  await page.evaluate(()=>window.player.prev())
  await page.waitForFunction(()=>window.player.index===0 && document.querySelector('canvas.gal-overlay')?.dataset.parts==='1')
  await page.evaluate(()=>window.player.destroy())
  const thumb=await page.evaluate(async({scene,base})=>{
    const {renderSceneThumb}=await import('/gal-thumb-render.js')
    const blob=await renderSceneThumb({apiBase:base,resourceBase:base+'/fixture',node:'controlled',width:640},{fetchImpl:async()=>({ok:true,json:async()=>({scene})})})
    const img=await createImageBitmap(blob),c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0)
    const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data
    let colored=0;for(let i=0;i<pixels.length;i+=124)if(pixels[i]+pixels[i+1]+pixels[i+2]>40)colored++
    return{width:img.width,height:img.height,bytes:blob.size,colored}
  },{scene:parsedScene,base})
  assert.equal(thumb.width,640);assert.equal(thumb.height,360);assert.ok(thumb.bytes>1000&&thumb.colored>100)
  assert.deepEqual(errors,[])
  await writeFile(out+'/parsed-scene-verification.json',JSON.stringify({controlledBytecode:true,originalPlotFlow:false,realInitializers:true,markerStartStep:1,backwardReconstruction:true,thumb},null,2))
  await writeFile(out + '/verification.json', JSON.stringify({ componentRendering: true, nativeXwmVoicePlayback: true, fullGamePlayback: false, pixels, prologuePixels, errors, placementHelperReturned: true, stops: ['SN0000 prefix:0x35c', 'text-tail:0x305'] }, null, 2))
  console.log('PASS native AGE component display (not full scene playback)', pixels, out)
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)) }
