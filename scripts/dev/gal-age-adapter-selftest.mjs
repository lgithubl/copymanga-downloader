import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { decodeAgeScript, decodeAgeImage, readAgeIndex, traceAgeProgram } from '../../web/library/gal/age.mjs'
import { analyzeAgeScene, encodeAgeScriptPackage, parse } from '../../web/library/gal/adapters/age-sys4.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'
import { sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { stateAt } from '../../web/static/gal-engine.js'

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
  const unknown = pkg([[0x6e, lit(0), str('partial')], [0x1f4], [2]])
  const detail = analyzeAgeScene(unknown)
  assert.equal(detail.complete, false); assert.equal(detail.stats.run.stopped.opcode, 0x1f4)
  assert.deepEqual(detail.stats.staticUnimplemented['0x1f4'], { count: 1, examples: [{ script: 'case.BIN', offset: 5 }] })
  assert.throws(() => parse(JSON.stringify(unknown)), error => Boolean(error.ageDiagnostic) && /0x1f4/.test(error.message))
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
  assert.throws(() => parse(JSON.stringify(data)), /SN0000.BIN @0 opcode 0x1f4/)
  const first = decodeAgeScript(bytes).instructions.find(i => i.opcode === 0x6e)
  const result = analyzeAgeScene(data, { scripts: { 'SN0000.BIN': { entry: first.offset } } })
  assert.equal(result.complete, false); assert.equal(result.stats.run.stopped.opcode, 0x305)
  const segments = result.steps[0].commands[0].segments
  assert.ok(segments.some(s => s.text === '精域神戦争' && s.ruby === 'フィユシア聖戦'))
  assert.ok(segments.map(s => s.text).join('').includes('がありました。'))
})

test('native image-placement helper feeds actual standard scene overlays; unsupported visibility remains explicit', { skip: !existsSync(native) }, async () => {
  const base = '.cache/new-games-043952/extracted/g05', index = readAgeIndex(await readFile(base + '/SYS4INI.BIN'))
  const images = {}
  for (const name of ['BG054AA.AGF', 'CS001AAA.AGF', 'CS002AAA.AGF']) {
    const { width, height } = decodeAgeImage(await readFile(native + '/' + name))
    images[index.entries.find(e => e.name === name).ordinal] = { width, height, src: 'age/res/' + name.replace('.AGF', '.png') }
  }
  const system = traceAgeProgram(decodeAgeScript(await readFile('.cache/new-games-052443/extracted/g05/__verify/age/SYSTEM4.BIN')), { entry: 2040 })
  const data = { ...JSON.parse(encodeAgeScriptPackage(await readFile(base + '/SC0000.BIN'), { name: 'SC0000.BIN' })), resources: { images } }
  const result = analyzeAgeScene(data, { scripts: { 'SC0000.BIN': { entry: 155991 } }, integers: { ...system.integers, 970752: 101000, 970753: 101020, 970754: 101040, 970746: 2, 970711: 16485 } })
  assert.equal(result.complete, false); assert.equal(result.stats.run.stopped.opcode, 0x242)
  const overlay = result.steps.flatMap(s => s.commands).find(c => c.op === 'overlay')
  assert.deepEqual([overlay.x, overlay.y, overlay.stage], [0, -14, [1600, 900]])
  assert.equal(overlay.src, 'age/res/CS001AAA.png')
  const state = stateAt({ format: 'gal-scene/1', steps: result.steps }, 0)
  assert.equal(state.overlays.length, 1)
})
