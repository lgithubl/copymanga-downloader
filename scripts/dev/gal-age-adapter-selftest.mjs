import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { decodeAgeScript, decodeAgeImage, readAgeIndex, traceAgeProgram } from '../../web/library/gal/age.mjs'
import { analyzeAgeScene as analyzePreview, encodeAgeScriptPackage, parse as parsePreview } from '../../web/library/gal/adapters/age-sys4.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'
import { sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { stateAt } from '../../web/static/gal-engine.js'
import { createAgeState } from '../../web/library/gal/age-state.mjs'

// Preserve strict coverage checks while separately testing the user-selected
// warning policy through the real default parse/analyze exports.
const analyzeAgeScene = (data, options = {}) => analyzePreview(data, { unverifiedPolicy: 'error', ...options })
const parse = (text, ctx = null, meta = {}) => parsePreview(text, ctx, { ...meta, options: { unverifiedPolicy: 'error', ...meta.options } })

// Small binary assembler for control-flow/array edge cases, independent of the
// JSON transport. Native corpus tests below are the format compatibility oracle.
const arg = (type, value) => ({ type, value })
function bin(rows) {
  const code = [], footer = [], refs = []
  for (const [opcode, ...args] of rows) {
    code.push(opcode)
    for (const a of args) {
      code.push(a.type)
      const at = code.length; code.push(a.value ?? 0)
      if (a.text !== undefined) {
        const bytes = Buffer.from(a.text, 'ascii').map(x => x ^ 255)
        const chunk = Buffer.alloc(Math.ceil((bytes.length + 1) / 4) * 4, 255)
        bytes.copy(chunk); refs.push({ at, byte: footer.length * 4 })
        for (let i = 0; i < chunk.length; i += 4) footer.push(chunk.readUInt32LE(i))
      }
      if (a.values) { refs.push({ at, byte: footer.length * 4 }); footer.push(a.values.length, ...a.values) }
    }
  }
  for (const r of refs) code[r.at] = code.length + r.byte / 4
  const out = Buffer.alloc(60 + (code.length + footer.length) * 4)
  out.write('SYS4485 '); out.writeUInt32LE(28, 32)
  for (const at of [40, 48, 56]) out.writeUInt32LE(code.length + footer.length, at)
  ;[...code, ...footer].forEach((v, i) => out.writeUInt32LE(v >>> 0, 60 + i * 4))
  return out
}
const pkg = (rows, extra = {}) => ({ ...JSON.parse(encodeAgeScriptPackage(bin(rows), { name: 'case.BIN' })), ...extra })
const lit = n => arg(0, n), str = text => ({ type: 2, text }), global = n => arg(3, n)

test('selected unverified instructions continue and retain every scene position and initialization source', () => {
  const boot = { name: 'boot.BIN', script: bin([[0x35b,lit(2),lit(0)],[2]]).toString('base64') }
  const data=pkg([[0x6e,lit(0),str('first')],[0x305],[0x72,lit(0)],
    [0x35c,lit(0),lit(0)],[0x6e,lit(0),str('second')],[0x305],[0x72,lit(0)],[2]],{initialization:[boot]})
  const scene=parsePreview(JSON.stringify(data))
  assert.equal(scene.steps.length,2)
  assert.equal(scene.stats.initialization.complete,true)
  assert.deepEqual(scene.stats.opcodeWarnings.map(r=>[r.opcode,r.step,r.phase,r.script]),[
    ['0x35b',null,'initialization','boot.BIN'],['0x305',0,'scene','case.BIN'],
    ['0x35c',1,'scene','case.BIN'],['0x305',1,'scene','case.BIN']])
  assert.deepEqual(scene.stats.ignored,{'0x35b':1,'0x305':2,'0x35c':1})
  assert.ok(scene.stats.opcodeWarnings.every(r=>Number.isInteger(r.offset)&&Array.isArray(r.args)))
  assert.throws(()=>parsePreview(JSON.stringify(data),null,{options:{unverifiedPolicy:'error'}}),/0x35b/)
  assert.throws(()=>parsePreview(JSON.stringify(pkg([[0x304],[2]]))),/0x304/)
  assert.throws(()=>analyzePreview(data,{unverifiedPolicy:'ignore-everything'}),/unverifiedPolicy/)
})

test('explicit partial preview exposes only the executed native prefix and keeps incomplete status', () => {
  const data=pkg([[0x6e,lit(0),str('actual prefix')],[0x304],[2]])
  assert.throws(()=>parsePreview(JSON.stringify(data)),/0x304/)
  const scene=parsePreview(JSON.stringify(data),null,{options:{partialPreview:true}})
  assert.equal(scene.stats.complete,false)
  assert.equal(scene.stats.previewStopped.opcode,0x304)
  assert.equal(scene.steps[0].commands[0].segments[0].text,'actual prefix')
  assert.match(scene.stats.notes[0],/后续未解析/)
  assert.throws(()=>parsePreview(JSON.stringify(pkg([[0x304],[2]])),null,{options:{partialPreview:true}}),/0x304/)
})

test('best-effort preview keeps actual text boundaries while unknown instructions and unavailable textures become located warnings', () => {
  const rows = [[0x35d,lit(0),lit(0),lit(0)],[0x6e,lit(0),str('first')],[0x305],[0x73,...Array(10).fill(lit(0))],[0x72,lit(0)],
    [0x1fb,...[20,17,0,0,1,1,0,0].map(lit)],[0x6e,lit(0),str('second')],[0x72,lit(0)],[2]]
  const scene=parsePreview(JSON.stringify(pkg(rows)),null,{options:{unverifiedPolicy:'preview'}})
  assert.equal(scene.steps.length,2);assert.equal(scene.stats.approximate,true)
  assert.equal(scene.stats.previewMode,'best-effort')
  assert.deepEqual(scene.steps.map(s=>s.commands.find(c=>c.op==='text').segments[0].text),['first','second'])
  assert.deepEqual(scene.stats.opcodeWarnings.map(r=>r.opcode),['0x35d','0x305','0x73','0x1fb'])
  assert.match(scene.stats.opcodeWarnings.at(-1).reason,/texture is not initialized/)
  assert.throws(()=>parsePreview(JSON.stringify(pkg([[0x8c,lit(0)]])),null,{options:{unverifiedPolicy:'preview',maxSteps:3}}),/limit/)
})

test('explicit callback replay enters the registered target, returns to the interrupted text and rejects unresolved events', () => {
  const data = pkg([[0x7b, lit(19), lit(-1)], [0x192, arg(5,100), str('normal')], [0x6e, lit(0), arg(5,100)],
    [0x72, lit(0)], [2], [0x192, arg(5,100), str('callback')], [0x7c]])
  const plain = parse(JSON.stringify(data))
  assert.equal(plain.steps[0].commands[0].segments[0].text, 'normal')
  const options = { nativeEvents: [{ script: 'case.BIN', offset: 10, callback: 0 }] }
  const replay = parse(JSON.stringify(data), null, { options })
  assert.equal(replay.steps[0].commands[0].segments[0].text, 'callback')
  assert.deepEqual([replay.stats.state.nativeEvents.dispatched, replay.stats.state.nativeEvents.returned], [1,1])
  const disabled = parse(JSON.stringify(data), null, { options: { nativeEvents: [{ script: 'case.BIN', offset: 10, callback: 1 }] } })
  assert.equal(disabled.steps[0].commands[0].segments[0].text, 'normal')
  assert.equal(disabled.stats.state.nativeEvents.consumed,1); assert.equal(disabled.stats.state.nativeEvents.dispatched,0)
  assert.throws(() => parse(JSON.stringify(data), null, { options: { nativeEvents: [{ script: 'case.BIN', offset: 999, callback: 0 }] } }), /not reached/)
  assert.throws(() => parse(JSON.stringify(data), null, { options: { nativeEvents: [...options.nativeEvents, { script: 'case.BIN', offset: 19, callback: 0 }] } }), /nested callback/)
  assert.throws(() => parse(JSON.stringify(pkg([[0x7c], [2]]))), /0x7c/)
})

test('completed linked slots release callbacks while preserving their parent registration', () => {
  const data = pkg([[0x7b, lit(0), lit(-1)], ...Array.from({ length: 300 }, () => [3,lit(22)]), [2]],
    { links: { 22: { name:'child.BIN', script:bin([[0x7b,lit(0),lit(-1)],[2]]).toString('base64') } } })
  const scene = parse(JSON.stringify(data))
  assert.equal(scene.stats.state.nativeEvents.registrations,301)
  assert.equal(scene.stats.state.nativeEvents.released,301)
  assert.deepEqual(scene.stats.state.registeredCallbacks,[])
})

test('bootstrap gates production parsing and shares initialized strings without auto-selecting native menus', () => {
  const boot = { name:'bootstrap.BIN', script:bin([[0x192,arg(5,100),str('initialized')],[2]]).toString('base64') }
  const data = pkg([[0x6e,lit(0),arg(5,100)],[0x72,lit(0)],[2]], { initialization:[boot] })
  const scene = parse(JSON.stringify(data))
  assert.equal(scene.steps[0].commands[0].segments[0].text,'initialized')
  assert.equal(scene.stats.initialization.complete,true)
  assert.deepEqual(scene.stats.initialization.completed,[{script:'bootstrap.BIN',status:'exited'}])
  const bad = { name:'bootstrap.BIN', script:bin([[0x35b,lit(2),lit(0)],[2]]).toString('base64') }
  const result = analyzeAgeScene({...data,initialization:[bad]})
  assert.equal(result.complete,false);assert.equal(result.stats.run.stopped.script,'bootstrap.BIN')
  assert.equal(result.stats.run.stopped.opcode,0x35b);assert.equal(result.stats.initialization.complete,false)
  assert.equal(result.steps.length,0,'no main-script text is emitted from partial initialization')
  for (const rows of [[[0x72,lit(0)],[2]], [[0x1f4],[2]], [[0x238,lit(100)],[2]]]) {
    const row={name:'bootstrap.BIN',script:bin(rows).toString('base64')}
    assert.throws(()=>parse(JSON.stringify({...data,initialization:[row]})),/initialization/)
  }
})

test('real data initializer sequence is reusable; full SYSTEM4 still stops at its newer opaque instruction', {skip:!existsSync('.cache/age-upstream-20261113/manifest.json')}, async()=>{
  const manifest=JSON.parse(await readFile('.cache/age-upstream-20261113/manifest.json'))
  const load=async key=>{
    const row=manifest.records.find(row=>row.key===key)
    return { name:key.replace(/^[^-]*-/,''),script:(await readFile(row.source)).toString('base64') }
  }
  const names=await load('verify-CVINIT.BIN'), sound=await load('link-SNINIT.BIN')
  const globals=traceAgeProgram(decodeAgeScript(Buffer.from(names.script,'base64'))).strings
  const key=Number(Object.entries(globals).find(([,value])=>value==='ナレーション')[0])
  const data=pkg([[0x6e,lit(0),arg(5,key)],[0x72,lit(0)],[2]],{initialization:[sound,names]})
  const scene=parse(JSON.stringify(data))
  assert.equal(scene.steps[0].commands[0].segments[0].text,'ナレーション')
  assert.equal(scene.stats.initialization.completed.length,2)
  const full=analyzeAgeScene({...data,initialization:[await load('verify-SYSTEM4.BIN')]})
  assert.equal(full.complete,false);assert.equal(full.stats.initialization.complete,false)
  assert.equal(full.stats.run.stopped.script,'SYSTEM4.BIN');assert.equal(full.stats.run.stopped.opcode,0x35b)
  assert.deepEqual(full.stats.voices.resetChannels,[1,1,1])
  assert.deepEqual(full.stats.voices.centeredChannels,[1,1,1])
  assert.equal(full.steps.flatMap(row=>row.commands).some(row=>row.op==='text'),false)
})

test('native channel reset stops slot-zero voice without stopping the BGM or freeing resources',()=>{
  const data=pkg([[0xbf,lit(3)],[0xc4,lit(7)],[0x2f6,lit(0)],[0x2f6,lit(1)],[0x2f6,lit(2)],[2]],
    {resources:{bgm:{3:'age/res/bgm.wav'},voice:{7:'age/res/voice.wav'}}})
  const scene=parse(JSON.stringify(data))
  assert.deepEqual(scene.steps[0].commands.map(row=>row.op),['bgm','voice','voiceStop'])
  assert.deepEqual(scene.stats.voices.resetChannels,[1,1,1])
  assert.equal(stateAt(scene,0).bgm,'age/res/bgm.wav')
  assert.throws(()=>parse(JSON.stringify(pkg([[0x2f6,lit(3)],[2]]))),/voice channel/)
})

test('centered native voice pan preserves audio and rejects unimplemented nonzero pan',()=>{
  const scene=parse(JSON.stringify(pkg([[0x2f8,lit(0),lit(0)],[0x2f8,lit(1),lit(0)],[0x2f8,lit(2),lit(0)],[2]])))
  assert.deepEqual(scene.stats.voices.centeredChannels,[1,1,1])
  assert.equal(analyzeAgeScene(pkg([[0x2f8,lit(0),lit(500)],[2]])).complete,false)
  assert.throws(()=>parse(JSON.stringify(pkg([[0x2f8,lit(3),lit(0)],[2]]))),/voice channel/)
})

test('auxiliary clear preserves persistent images; object erase uses half-open ranges and keeps textures', () => {
  const load = [0x1f9, lit(77), lit(10), lit(-1)]
  const draw = id => [0x1fb, lit(id), lit(10), lit(0), lit(0), lit(16), lit(16), lit(0), lit(0)]
  const resources = { images: { 77: { src: 'age/res/atlas.png', width: 16, height: 16 } } }
  const scene = parse(JSON.stringify(pkg([load, draw(20), draw(21), draw(22), [0x224], [0x72, lit(0)],
    [0x1f7, lit(20), lit(2)], [0x72, lit(0)], draw(23), [0x1f7, lit(22), lit(0)], [2]], { resources })))
  assert.deepEqual(stateAt(scene, 0).overlays.map(o => o.slot), ['age:20', 'age:21', 'age:22'])
  assert.deepEqual(stateAt(scene, 1).overlays.map(o => o.slot), ['age:22'])
  assert.deepEqual(stateAt(scene, 2).overlays.map(o => o.slot), ['age:23'], 'erase leaves the texture reusable')
  const unknown = analyzeAgeScene(pkg([[0x223, ...Array(8).fill(lit(0))], [2]]))
  assert.equal(unknown.complete, false); assert.equal(unknown.stats.run.stopped.opcode, 0x223, 'unknown auxiliary producers are not accepted')
  assert.throws(() => parse(JSON.stringify(pkg([[0x1f7, lit(0xffffff), lit(2)], [2]]))), /erase range/)
})

test('native BGM stop cancels a prior fade before the next track', () => {
  const scene = parse(JSON.stringify(pkg([[0xbf, lit(13)], [0xc2, lit(0), lit(5000)], [0xb8], [0xbf, lit(14)], [2]],
    { resources: { bgm: { 13: 'age/res/BGM013.wav', 14: 'age/res/BGM014.wav' } } })))
  assert.deepEqual(scene.steps[0].commands, [{ op: 'bgm', src: 'age/res/BGM013.wav' }, { op: 'bgmStop', fade: 5 }, { op: 'bgmStop' }, { op: 'bgm', src: 'age/res/BGM014.wav' }])
})

test('native planar motion preserves delay, duration, final pose and blocking policy', () => {
  const setup = [[0x1f9, lit(77), lit(10), lit(-1)], [0x1fb, lit(21), lit(10), lit(0), lit(0), lit(16), lit(16), lit(100), lit(200)]]
  const move = [0x220, lit(21), lit(500), lit(1000), lit(30), lit(40), lit(0)]
  const resources = { images: { 77: { src: 'age/res/atlas.png', width: 16, height: 16 } } }
  const scene = parse(JSON.stringify(pkg([...setup, move, [0x238, lit(100)], [0x21c], [0x21a, lit(21), global(10), global(11), global(12)], [2]], { resources })))
  assert.deepEqual(scene.steps[0].commands.find(c => c.op === 'wait'), { op: 'wait', seconds: 1.5 })
  const state = stateAt(scene, 0), overlay = state.overlays[0]
  assert.deepEqual([overlay.x, overlay.y], [138 - 800, 248 - 450])
  assert.deepEqual(overlay.motion.from, [108 - 800, 208 - 450])
  assert.deepEqual(overlay.motion.to, [138 - 800, 248 - 450])
  assert.deepEqual([overlay.motion.seconds, overlay.motion.delay], [1, 0.5])
  const asyncScene = analyzeAgeScene(pkg([...setup, move, [0x242, lit(21), lit(1)], [0x238, lit(100)], [0x21c], [0x21a, lit(21), global(10), global(11), global(12)], [2]], { resources }))
  assert.equal(asyncScene.complete, false, 'active position queries must not invent a completed pose')
  assert.equal(asyncScene.stats.run.stopped.opcode, 0x21a)
  assert.equal(asyncScene.stats.timeline.elapsedMs, 100)
  const overlap = analyzeAgeScene(pkg([...setup, move, move, [2]], { resources }))
  assert.equal(overlap.complete, false); assert.equal(overlap.stats.run.stopped.opcode, 0x220)
  for (const bad of [[0, 1000, 0, 0, 1], [-1, 1000, 0, 0, 0], [0, 120001, 0, 0, 0]]) {
    const result = analyzeAgeScene(pkg([...setup, [0x220, lit(21), ...bad.map(lit)], [2]], { resources }))
    assert.equal(result.complete, false)
  }
})

test('registered AGE adapter uses execution order, ruby, input boundaries and scene state', () => {
  const data = pkg([
    [0x6e, lit(0), str('hello ')], [0x196, lit(0), str('world'), str('ruby')],
    [0x6f, lit(0)], [0x6e, lit(0), str('line 2')], [0xc4, lit(3)], [0x72, lit(0)],
    [0x8c, lit(34)], [0x6e, lit(0), str('unreachable')], [2],
  ], { resources: { voice: { 3: 'age/res/voice.wav' } } })
  const text = JSON.stringify(data)
  assert.equal(sniffGalAdapter(text), 'age::sys4')
  const scene = buildScene('age::sys4', text)
  assert.equal(scene.steps.length, 1)
  const commands = scene.steps[0].commands, segments = commands.find(c => c.op === 'text').segments
  assert.deepEqual(segments, [{ text: 'hello ' }, { text: 'world', ruby: 'ruby' }, { text: '\n' }, { text: 'line 2' }])
  assert.deepEqual(commands.find(c => c.op === 'voice'), { op: 'voice', src: 'age/res/voice.wav' })
  assert.equal(scene.stats.complete, true)
  assert.deepEqual(scene.stats.raw, {}, 'confirmed operations are not reported as unrendered instructions')
  assert.ok(stateAt(scene, 0))
})

test('array initialization feeds pointer lookup and linked scripts restore caller locals', () => {
  const data = pkg([
    [0x64, global(100), { type: 0, values: [7, 0xffffffff, 13] }],
    [0x61, arg(12, 0), global(100), lit(1)], [0x55, global(200), arg(12, 0)], [3, lit(22)], [2],
  ], { links: { 22: { name: 'child.BIN', script: bin([[0x6e, lit(0), str('child')], [2]]).toString('base64') } } })
  const decoded = decodeAgeScript(Buffer.from(data.script, 'base64'))
  assert.deepEqual(decoded.instructions[0].args[1].values, [7, 0xffffffff, 13])
  const trace = traceAgeProgram(decoded, { resolveScript: () => ({ name: 'child.BIN', program: { instructions: [{ offset: 0, opcode: 2, args: [] }] } }) })
  assert.equal(trace.integers[200], -1)
  assert.equal(parse(JSON.stringify(data)).steps[0].commands[0].segments[0].text, 'child')
  assert.throws(() => traceAgeProgram({ instructions: [{ offset: 0, opcode: 0x64, args: [global(0xffffff), { values: [1, 2] }] }] }), /destination/)
  const broken = Buffer.from(data.script, 'base64'), arrayAt = 60 + decoded.instructions[0].args[1].value * 4
  broken.writeUInt32LE(0xffffffff, arrayAt)
  assert.throws(() => decodeAgeScript(broken), /array truncated/)
})

test('unknown operations, missing links, invalid resources and budget exhaustion never become successful scenes', () => {
  const unknown = pkg([[0x6e, lit(0), str('partial')], [0x305], [2]])
  const detail = analyzeAgeScene(unknown)
  assert.equal(detail.complete, false); assert.equal(detail.stats.run.stopped.opcode, 0x305)
  assert.deepEqual(detail.stats.staticUnimplemented['0x305'], { count: 1, examples: [{ script: 'case.BIN', offset: 5 }] })
  assert.throws(() => parse(JSON.stringify(unknown)), error => Boolean(error.ageDiagnostic) && /0x305/.test(error.message))
  assert.throws(() => parse(JSON.stringify(pkg([[3, lit(2)], [2]]))), /missing-script/)
  for (const src of ['../outside.wav', '/tmp/out.wav', 'https://example.com/out.wav'])
    assert.throws(() => parse(JSON.stringify(pkg([[0xc4, lit(3)], [2]], { resources: { voice: { 3: src } } }))), /mapping missing/)
  assert.throws(() => parse(JSON.stringify(pkg([[0xbf, lit(3)], [2]], { resources: { images: { 3: { src: 'image.png', width: 1, height: 1 } } } }))), /bgm mapping missing/)
  assert.equal(analyzeAgeScene(pkg([[0x8c, lit(0)]]), { maxSteps: 3 }).stats.run.status, 'limit')
  assert.throws(() => parse('{"format":"age-sys4/1","script":"bad"}'), /base64/)
})

test('texture source crops and integer array storage use the existing scene contract', () => {
  const data = pkg([
    [0x1f9, lit(77), lit(10), lit(0xffffffff)],
    [0x1fb, lit(21), lit(10), lit(2), lit(3), lit(4), lit(5), lit(100), lit(200)], [2],
  ], { resources: { images: { 77: { src: 'age/res/atlas.png', width: 16, height: 16 } } } })
  const scene = buildScene('age::sys4', JSON.stringify(data)), overlay = stateAt(scene, 0).overlays[0]
  assert.deepEqual(overlay.crop, [2, 3, 4, 5])
  assert.deepEqual([overlay.x, overlay.y], [100 + 2 - 800, 200 + 2.5 - 450])
  data.resources.images[77].width = 3
  assert.throws(() => parse(JSON.stringify(data)), /rectangle outside/)
})

test('display update batches preserve nesting and reject an input wait before commit', () => {
  const data = pkg([[0x1f4], [0x1f4], [0x6e, lit(0), str('batched')], [0x1f5], [0x1f5], [0x72, lit(0)], [2]])
  assert.equal(parse(JSON.stringify(data)).stats.displayBatchDepth, 0)
  assert.equal(parse(JSON.stringify(data)).steps.length, 1)
  assert.throws(() => parse(JSON.stringify(pkg([[0x1f4], [0x72, lit(0)], [2]]))), /uncommitted/)
  assert.throws(() => parse(JSON.stringify(pkg([[0x1f4], [2]]))), /uncommitted/)
  assert.deepEqual(parse(JSON.stringify(pkg([[0xbf, lit(0)], [2]]))).steps[0].commands, [{ op: 'bgmStop' }])
})

test('native flag masks overwrite both bits, reset every slot, and reject invalid slots', () => {
  const data = pkg([[0x258, lit(0), lit(3)], [0x258, lit(999), lit(6)], [0x258, lit(0), lit(4)], [2]])
  const scene = parse(JSON.stringify(data))
  assert.deepEqual(scene.stats.state.flags, [{ slot: 999, mask: 2 }])
  assert.equal(scene.stats.state.writes, 3)
  assert.deepEqual(parse(JSON.stringify(pkg([[0x258, lit(999), lit(3)], [0x259], [2]]))).stats.state.flags, [])
  for (const slot of [-1, 1000]) assert.throws(() => parse(JSON.stringify(pkg([[0x258, lit(slot), lit(1)], [2]]))), /slot\/mask invalid/)
})

test('callbacks stay dormant during ordinary advance and are released with their execution slot', () => {
  const data = pkg([[0x7b, lit(15), lit(-1)], [0x6e, lit(0), str('registered')], [0x7b, lit(-1), lit(-1)], [2], [0x6e, lit(0), str('callback')], [5]])
  const scene = parse(JSON.stringify(data))
  assert.equal(scene.steps[0].commands[0].segments[0].text, 'registered')
  assert.deepEqual(scene.stats.state.registeredCallbacks, [])
  for (const tail of [[[2]], [[0x72, lit(0)], [2]]]) {
    const result = analyzeAgeScene(pkg([[0x7b, lit(0), lit(-1)], ...tail]))
    assert.equal(result.complete, true)
    assert.deepEqual(result.stats.state.registeredCallbacks, [])
    assert.equal(result.stats.state.nativeEvents.dispatched, 0)
    assert.equal(result.stats.state.nativeEvents.released, 1)
  }
  assert.throws(() => parse(JSON.stringify(pkg([[0x7b, lit(1), lit(-1)], [2]]))), /instruction boundary/)
})

test('input regions preserve native rectangle matching, first-match binding and pending dispatch', () => {
  const state = createAgeState(), machine = { read: a => a.value, isCodeOffset: n => n === 99, script: 'case', scriptInstance: 0 }
  const execute = (opcode, ...values) => state.instruction({ opcode, offset: 0, args: values.map(lit) }, machine)
  execute(0x97, 2, 3, 4, 5, 7)
  assert.deepEqual(state.snapshot().inputRegions, [], 'binding does not invent a missing region')
  execute(0x90, 2, 3, 4, 5, -1, -1, 99)
  execute(0x90, 2, 3, 4, 5, -1, -1, 99)
  execute(0x97, 2, 3, 4, 5, 7)
  assert.deepEqual(state.snapshot().inputRegions.map(r => [r.rect, r.inputBit]), [[[2, 3, 6, 8], 7], [[2, 3, 6, 8], -1]])
  execute(0x259)
  assert.equal(state.hasCallbacks(), true, 'flag reset does not clear unrelated input registrations')
  const snapshot = state.snapshot(); snapshot.inputRegions[0].rect[0] = 123
  assert.equal(state.snapshot().inputRegions[0].rect[0], 2)
  assert.throws(() => execute(0x90, 2, 3, 4, 5, -1, 98, -1), /instruction boundary/)
  for (let n = 2; n < 100; n++) execute(0x90, 2, 3, 4, 5, -1, -1, 99)
  assert.throws(() => execute(0x90, 2, 3, 4, 5, -1, -1, 99), /rectangle limit/)
  assert.throws(() => parse(JSON.stringify(pkg([[0x90, lit(0), lit(0), lit(1), lit(1), lit(-1), lit(-1), lit(0)], [2]]))), /input region dispatch/)
})

test('input activation is sequential registration, not a jump, wait or callback cancellation', () => {
  const data = pkg([[0x94], [0x1ad], [0x6e, lit(0), str('after input setup')], [2]])
  const scene = parse(JSON.stringify(data))
  assert.equal(scene.steps[0].commands[0].segments[0].text, 'after input setup')
  assert.deepEqual(scene.stats.state.input, { enabled: true, columns: 10000, owner: { script: 'case.BIN', instance: 0 }, nativeSkip: false, nativeAdvance: false, queries: 0 })
  const pending = analyzeAgeScene(pkg([[0x7b, lit(0), lit(-1)], [0x94], [0x1ad], [2]]))
  assert.equal(pending.complete, true); assert.equal(pending.stats.state.nativeEvents.released, 1)
})

test('native restore checkpoint takes only the supported fresh-run path', () => {
  const scene = parse(JSON.stringify(pkg([[0xae], [0x6e, lit(0), str('fresh')], [0xae], [2]])))
  assert.equal(scene.steps[0].commands[0].segments[0].text, 'fresh')
  assert.deepEqual(scene.stats.state.restore, { nativeSaveLoaded: false, checks: 2 })
  assert.throws(() => parse(JSON.stringify(pkg([[0xae], [0x305], [2]]))), /0x305/)
})

test('fresh normal-path input queries write zero without cancelling registered callbacks', () => {
  const scene = parse(JSON.stringify(pkg([[0x1c7, global(1)], [0x1cc, global(2)], [0x21b, lit(1)], [0xa0, global(1), lit(17), lit(-1)], [2], [0x305]])))
  assert.equal(scene.stats.state.graphicsInputGuard, true)
  assert.equal(scene.stats.state.input.queries, 2)
  const result = analyzeAgeScene(pkg([[0x7b, lit(0), lit(-1)], [0x1c7, global(1)], [0x1cc, global(2)], [2]]))
  assert.equal(result.complete, true)
  assert.equal(result.stats.state.nativeEvents.registrations, 1)
  assert.equal(result.stats.state.nativeEvents.released, 1)
})

test('native zero-gain BGM control uses an asynchronous fade and rejects other unimplemented gains', () => {
  const result = parse(JSON.stringify(pkg([[0xc2, lit(0), lit(5000)], [0x6e, lit(0), str('next')], [2]])))
  assert.deepEqual(result.steps[0].commands.map(c => c.op), ['bgmStop', 'text'])
  assert.deepEqual(result.steps[0].commands[0], { op: 'bgmStop', fade: 5 })
  assert.deepEqual(parse(JSON.stringify(pkg([[0xc2, lit(0), lit(0)], [2]]))).steps[0].commands[0], { op: 'bgmStop', fade: 0 })
  for (const [gain, ms] of [[5000, 5000], [0, -1], [0, 120001]])
    assert.throws(() => parse(JSON.stringify(pkg([[0xc2, lit(gain), lit(ms)], [2]]))), /0xc2/)
})

test('static update policy changes neither visible image nor position; unknown policy/animation still fails', () => {
  const data = pkg([[0x1f9, lit(77), lit(10), lit(-1)],
    [0x1fb, lit(21), lit(10), lit(0), lit(0), lit(4), lit(5), lit(100), lit(200)],
    [0x242, lit(21), lit(1)], [0x242, lit(21), lit(0)], [2]],
    { resources: { images: { 77: { src: 'age/res/image.png', width: 4, height: 5 } } } })
  const result = parse(JSON.stringify(data)), overlay = stateAt({ format: 'gal-scene/1', steps: result.steps }, 0).overlays[0]
  assert.equal(overlay.src, 'age/res/image.png')
  assert.deepEqual([overlay.x, overlay.y], [102 - 800, 202.5 - 450])
  assert.throws(() => parse(JSON.stringify(pkg([[0x242, lit(21), lit(2)], [2]]))), /0x242/)
  assert.throws(() => parse(JSON.stringify(pkg([[0x220, lit(1), lit(0), lit(0), lit(1), lit(1), lit(0)], [2]]))), /0x220/)
})

test('update timer barriers retain sequence, replace earlier timers and never sleep in parsing', () => {
  const result = parse(JSON.stringify(pkg([[0x6e, lit(0), str('before')], [0x238, lit(5000)], [0x238, lit(5500)], [0x21c],
    [0x6e, lit(0), str('after')], [0x21c], [2]])))
  assert.deepEqual(result.steps[0].commands.map(c => c.op), ['text', 'wait', 'text'])
  assert.deepEqual(result.steps[0].commands[1], { op: 'wait', seconds: 5.5 })
  assert.deepEqual(result.stats.timeline, { elapsedMs: 5500, pendingMs: 0, barriers: 2 })
  for (const value of [-1, 120001]) assert.throws(() => parse(JSON.stringify(pkg([[0x238, lit(value)], [0x21c], [2]]))), /timer out of range/)
  for (const end of [[[2]], [[0x72, lit(0)], [2]]]) assert.throws(() => parse(JSON.stringify(pkg([[0x238, lit(10)], ...end]))), /pending update timer/)
  assert.throws(() => parse(JSON.stringify(pkg([[0x1f4], [0x238, lit(10)], [0x21c], [2]]))), /uncommitted display batch/)
  assert.throws(() => parse(JSON.stringify(pkg([[0x1cf, lit(1)], [2]]))), /0x1cf/)
})

const corpus = '.cache/age-upstream-20261113/manifest.json'
test('all 146 native arrays match upstream element-for-element; all 30 instruction streams retain compatibility', { skip: !existsSync(corpus) }, async () => {
  const manifest = JSON.parse(await readFile(corpus)), comparison = JSON.parse(await readFile('.cache/age-upstream-20261113/comparison.json'))
  assert.equal(comparison.parseDifferences.length, 0)
  let arrays = 0, elements = 0, instructions = 0
  for (const row of manifest.records) {
    const own = decodeAgeScript(await readFile(row.source)), upstream = JSON.parse(await readFile(row.audit))
    assert.equal(own.instructions.length, upstream.instructions.length); instructions += own.instructions.length
    for (let k = 0; k < own.instructions.length; k++) if (own.instructions[k].opcode === 0x64) {
      const values = own.instructions[k].args[1].values
      assert.deepEqual(values, upstream.instructions[k].args[1].array, row.key + '@' + own.instructions[k].offset)
      arrays++; elements += values.length
    }
  }
  assert.deepEqual({ arrays, elements, instructions }, { arrays: 146, elements: 697, instructions: 185890 })
})

const native = '.cache/age-072229/extracted/g01/__verify/age'
test('native SN0000 fails explicitly; native first narration preserves ruby in diagnostic output without claiming playback', { skip: !existsSync(native) }, async () => {
  const bytes = await readFile(native + '/SN0000.BIN'), data = JSON.parse(encodeAgeScriptPackage(bytes, { name: 'SN0000.BIN' }))
  assert.throws(() => parse(JSON.stringify(data)), /SN0000.BIN @23131 opcode 0x1f9.*image mapping missing: 4814/)
  const start = analyzeAgeScene(data)
  assert.deepEqual(start.stats.run.stopped, { script: 'SN0000.BIN', offset: 23131, opcode: 0x1f9, phase: 'scene' })
  assert.equal(start.stats.run.status, 'error')
  assert.deepEqual(start.stats.timeline, { elapsedMs: 5500, pendingMs: 0, barriers: 1 })
  assert.deepEqual(start.steps[0].commands, [{ op: 'bgmStop', fade: 5 }, { op: 'wait', seconds: 5.5 }])
  assert.equal(start.stats.state.resets, 1); assert.equal(start.stats.state.writes, 34)
  assert.deepEqual(start.stats.state.input, { enabled: true, columns: 10000, owner: { script: 'SN0000.BIN', instance: 0 }, nativeSkip: false, nativeAdvance: false, queries: 0 })
  assert.deepEqual(start.stats.state.restore, { nativeSaveLoaded: false, checks: 1 })
  assert.equal(start.stats.state.flags.length, 34)
  assert.deepEqual(start.stats.state.registeredCallbacks[0].targets, [2555, 2607])
  assert.deepEqual(start.stats.state.inputRegions.map(r => [r.rect, r.inputBit, r.targets[2]]), [
    [[-1000, -1000, -999, -999], 0, 1543], [[-1000, -1001, -999, -1000], 1, 1704],
    [[-1000, -1002, -999, -1001], 2, 1853], [[-1000, -1003, -999, -1002], 3, 2060],
    [[-1000, -1008, -999, -1007], 8, 2540], [[-1000, -1007, -999, -1006], 7, 2413],
  ])
  const first = decodeAgeScript(bytes).instructions.find(i => i.opcode === 0x6e)
  const result = analyzeAgeScene(data, { scripts: { 'SN0000.BIN': { entry: first.offset } } })
  assert.equal(result.complete, false); assert.equal(result.stats.run.stopped.opcode, 0x305)
  const segments = result.steps[0].commands[0].segments
  assert.ok(segments.some(s => s.text === '精域神戦争' && s.ruby === 'フィユシア聖戦'))
  assert.ok(segments.map(s => s.text).join('').includes('がありました。'))
})

test('native image-placement helper returns normally and feeds actual standard scene overlays', { skip: !existsSync(native) }, async () => {
  const base = '.cache/new-games-043952/extracted/g05', index = readAgeIndex(await readFile(base + '/SYS4INI.BIN'))
  const images = {}
  for (const name of ['BG054AA.AGF', 'CS001AAA.AGF', 'CS002AAA.AGF']) {
    const { width, height } = decodeAgeImage(await readFile(native + '/' + name))
    images[index.entries.find(e => e.name === name).ordinal] = { width, height, src: 'age/res/' + name.replace('.AGF', '.png') }
  }
  const system = traceAgeProgram(decodeAgeScript(await readFile('.cache/new-games-052443/extracted/g05/__verify/age/SYSTEM4.BIN')), { entry: 2040 })
  const data = { ...JSON.parse(encodeAgeScriptPackage(await readFile(base + '/SC0000.BIN'), { name: 'SC0000.BIN' })), resources: { images } }
  const result = analyzeAgeScene(data, { scripts: { 'SC0000.BIN': { entry: 155991 } }, integers: { ...system.integers, 970752: 101000, 970753: 101020, 970754: 101040, 970746: 2, 970711: 16485 } })
  assert.equal(result.complete, true); assert.equal(result.stats.run.status, 'returned')
  const overlay = result.steps.flatMap(s => s.commands).find(c => c.op === 'overlay')
  assert.deepEqual([overlay.x, overlay.y, overlay.stage], [0, -14, [1600, 900]])
  assert.equal(overlay.src, 'age/res/CS001AAA.png')
  const state = stateAt({ format: 'gal-scene/1', steps: result.steps }, 0)
  assert.equal(state.overlays.length, 1)
})

// This reproduces the reported HTTP failure at the real adapter boundary: a
// one-image prefix is insufficient, even if that image and its tween render.
test('captured original SN0000 preview yields all 25 original dialogue groups and two CG resources', {skip:!existsSync('.cache/age-http-demo/game/SYS4INI.BIN')}, async()=>{
  const {prepare}=await import('../../web/library/gal/adapters/age-sys4.mjs')
  const profile=JSON.parse(await readFile('.cache/age-http-demo/profile.json'))
  const root='.cache/age-http-demo/game',ctx=await prepare({mediaDir:root,options:profile.config.adapterOptions['age::sys4']})
  const scene=parsePreview(await readFile(root+'/age/script/sys4ini/SN0000.age','utf8'),ctx)
  const text=scene.steps.filter(s=>s.commands.some(c=>c.op==='text'))
  assert.equal(text.length,25);assert.equal(scene.steps.length,26)
  assert.equal(scene.stats.previewMode,'best-effort');assert.equal(scene.stats.approximate,true)
  assert.equal(stateAt(scene,0).overlays[0]?.src,'age/res/sys4ini/EV901A.png','text-window cleanup must not erase CG slot')
  assert.equal(stateAt(scene,13).overlays[0]?.src,'age/res/sys4ini/EV902A.png','INIT2 layer IDs must preserve CG2 when erasing CG1')
  assert.ok(text[0].commands.find(c=>c.op==='text').segments.some(s=>s.ruby==='フィユシア聖戦'))
  assert.ok(text.at(-1).commands.find(c=>c.op==='text').segments.some(s=>s.text.includes('ろ我慢の限界')))
  assert.deepEqual([...new Set(scene.steps.flatMap(s=>s.commands.filter(c=>c.op==='overlay').map(c=>c.src)))],['age/res/sys4ini/EV901A.png','age/res/sys4ini/EV902A.png'])
})
