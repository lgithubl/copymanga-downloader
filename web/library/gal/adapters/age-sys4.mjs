// AGE SYS4: execute confirmed instructions, never flatten every code block into
// dialogue. Unknown operations abort normal playback and remain inspectable via
// analyzeAgeScene(). No EXE/DLL execution, native runtime, or network downloads.
import { decodeAgeScript, traceAgeProgram } from '../age.mjs'
import { createAgeGraphics } from '../age-graphics.mjs'
import { createAgeState } from '../age-state.mjs'
import { readAgeCatalog, ageResourceContext } from '../age-archive.mjs'

export const ADAPTER_ID = 'age::sys4'
export const DEFAULT_OPTIONS = { root: '.', resDir: 'age/res', stage: null, maxSteps: 100000 }
export const sniff = text => /^\s*\{\s*"format"\s*:\s*"age-sys4\/1"/.test(String(text || '').slice(0, 256))
export const explainSniff = () => '需要 age-sys4/1 脚本包；不把 SYS4INI 索引或原始 BIN 当作文本'
export const contextFiles = () => []
export const contextDirs = options => [options?.resDir || DEFAULT_OPTIONS.resDir]
export async function prepare({ options = {}, mediaDir, toResourcePath }) {
  const resDir = options.resDir || DEFAULT_OPTIONS.resDir
  if (!resDir.endsWith('/res')) throw Error('AGE resDir must end with /res')
  const catalog = await readAgeCatalog(mediaDir, { root: options.root || '.', dir: resDir.slice(0, -4) })
  const namespaces = new Map()
  return { options, context(namespace = 'sys4ini') {
    if (!namespaces.has(namespace)) namespaces.set(namespace, ageResourceContext(catalog, namespace, toResourcePath))
    return namespaces.get(namespace)
  } }
}

const safeSrc = src => typeof src === 'string' && src.length <= 1024 && !src.includes('\\') && !src.startsWith('/') && !src.includes(':') && src.split('/').every(part => part && part !== '.' && part !== '..')
const IMPLEMENTED = new Set([
  2, 3, 5, 9, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e, 0x5f,
  0x61, 0x64, 0x6e, 0x6f, 0x72, 0x8c, 0x8f, 0xa0, 0xbf, 0xc2, 0xc4, 0x12c, 0x192, 0x193, 0x196, 0x1a7, 0x1a8,
  0x7b, 0x90, 0x94, 0x97, 0xae, 0x1ad, 0x242, 0x258, 0x259, 0x1f4, 0x1f5, 0x1f9, 0x1fa, 0x1fb, 0x208, 0x215, 0x216, 0x217, 0x218, 0x21a,
])
function binary(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 22369624 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw Error('AGE BIN base64 invalid/oversized')
  return decodeAgeScript(Buffer.from(encoded, 'base64'))
}
export function encodeAgeScriptPackage(bytes, { name = '', arc = '' } = {}) {
  decodeAgeScript(bytes)
  return JSON.stringify({ format: 'age-sys4/1', name, arc, script: bytes.toString('base64') })
}

// `images`: resource ordinal -> { src, width, height }. Audio indices are kept
// in separate tables: the BGM number is NOT an archive resource ordinal.
// Tables must come from verified initialization, never filename guessing.
export function analyzeAgeScene(data, options = {}) {
  if (data?.format !== 'age-sys4/1') throw Error('不是 age-sys4/1 脚本包')
  const program = binary(data.script), stage = options.stage || [1600, 900]
  if (!Array.isArray(stage) || stage.length !== 2 || stage.some(n => !Number.isInteger(n) || n < 1 || n > 8192)) throw Error('AGE stage invalid')
  const profile = options.scripts?.[data.name] || {}, resources = data.resources || {}
  const steps = [], stats = { messages: 0, images: { referenced: 0, resolved: 0, unresolved: 0 }, voices: { referenced: 0, resolved: 0, unresolved: 0 }, bgm: { referenced: 0, resolved: 0, unresolved: 0 }, raw: {}, ignored: {} }
  // Static inventory includes unreachable branches too; it is a coverage
  // report, not an instruction to skip these operations during execution.
  stats.staticUnimplemented = {}
  const inventory = (program, name) => {
    for (const i of program.instructions) if (!IMPLEMENTED.has(i.opcode)) {
      const key = '0x' + i.opcode.toString(16)
      const row = stats.staticUnimplemented[key] ||= { count: 0, examples: [] }
      row.count++
      if (row.examples.length < 8) row.examples.push({ script: name, offset: i.offset })
    }
  }
  inventory(program, data.name || '')
  let commands = [], segments = [], source = null, displayBatchDepth = 0
  const flushText = () => { if (segments.length) { commands.push({ op: 'text', segments }); segments = [] } }
  const finish = () => {
    flushText()
    if (commands.length) { steps.push({ index: steps.length, commands, ...(source ? { source } : {}) }); commands = []; source = null }
  }
  const image = ordinal => {
    stats.images.referenced++
    const row = resources.images?.[ordinal]
    if (!row || !safeSrc(row.src)) { stats.images.unresolved++; throw Error('AGE image mapping missing: ' + ordinal) }
    stats.images.resolved++; return row
  }
  const gpu = createAgeGraphics({ loadImage: image, metadataOnly: true })
  const runtime = createAgeState()
  const audio = (op, id) => {
    const bucket = op === 'voice' ? 'voices' : 'bgm'
    stats[bucket].referenced++
    const src = resources[op]?.[id]
    if (!safeSrc(src)) { stats[bucket].unresolved++; throw Error('AGE ' + op + ' mapping missing: ' + id) }
    stats[bucket].resolved++; commands.push({ op, src })
  }
  let run, failure, current
  try {
    run = traceAgeProgram(program, {
      programName: data.name || '', entry: profile.entry,
      integers: options.integers || {}, strings: options.strings || {},
      maxSteps: options.maxSteps ?? DEFAULT_OPTIONS.maxSteps,
      resolveScript: ordinal => {
        const row = data.links?.[ordinal]
        if (!row) return null
        const program = binary(row.script)
        inventory(program, row.name || String(ordinal))
        return { name: row.name, program }
      },
      onInstruction(i, machine) {
        current = { script: machine.script, offset: i.offset, opcode: i.opcode }
        const op = '0x' + i.opcode.toString(16), read = k => machine.read(i.args[k])
        stats.operations ||= {}
        stats.operations[op] = (stats.operations[op] || 0) + 1
        const unsupported = () => { stats.raw[op] = (stats.raw[op] || 0) + 1; return false }
        source ||= { script: machine.script, offset: i.offset }
        if (runtime.instruction(i, machine)) return true
        // Static native handlers (older unpacked AGE: 419a60/419ab0), checked
        // against the paired use in collected SYS4485 scripts: suspend display
        // updates with nesting, then release them. This is state, not a blanket
        // "ignore unknown" rule; waits in an uncommitted batch cannot succeed.
        if (i.opcode === 0x1f4) { if (++displayBatchDepth > 64) throw Error('AGE display batch nesting limit'); return true }
        if (i.opcode === 0x1f5) { displayBatchDepth = Math.max(0, displayBatchDepth - 1); return true }
        if (i.opcode === 0x6e) {
          // Only the primary text window is verified. Another window must not
          // silently merge into dialogue or invent a speaker name.
          if (read(0) !== 0 || typeof read(1) !== 'string') return unsupported()
          segments.push({ text: read(1) }); stats.messages++; return true
        }
        if (i.opcode === 0x196) {
          if (read(0) !== 0 || typeof read(1) !== 'string' || typeof read(2) !== 'string') return unsupported()
          segments.push({ text: read(1), ruby: read(2) }); return true
        }
        if (i.opcode === 0x6f) {
          if (read(0) !== 0) return unsupported()
          if (segments.length) segments.push({ text: '\n' }); return true
        }
        if (i.opcode === 0x72) { if (read(0) !== 0) return unsupported(); if (displayBatchDepth) throw Error('AGE wait inside uncommitted display batch'); if (runtime.hasCallbacks()) throw Error('AGE callback dispatch at input wait is not implemented'); finish(); return true }
        if (i.opcode === 0xbf && read(0) === 0) { commands.push({ op: 'bgmStop' }); return true }
        if (i.opcode === 0xc2) {
          // 420500 -> 47aa70/47abb0: interpolate BGM gain toward arg 1.
          // Only zero gain (fade out) maps to the existing scene contract.
          // Native milliseconds select 100 small or 10 larger gain ticks;
          // this starts a fade, it is NOT a script wait.
          const target = read(0), ms = read(1)
          if (target !== 0 || !Number.isInteger(ms) || ms < 0 || ms > 120000) return unsupported()
          commands.push({ op: 'bgmStop', fade: ms / 1000 }); return true
        }
        if (i.opcode === 0xc4 || i.opcode === 0xbf) { audio(i.opcode === 0xc4 ? 'voice' : 'bgm', read(0)); return true }
        // Other sound operations have incompletely understood looping/channel
        // semantics and deliberately stop execution instead of being guessed.
        if (gpu.instruction(i, machine)) {
          if (i.opcode === 0x1fb) {
            const row = gpu.objects.get(read(0)), texture = gpu.textures.get(row.texture)
            const [cx, cy, width, height] = row.crop
            commands.push({ op: 'overlay', slot: 'age:' + row.id, src: texture.src, fit: 'none', stage,
              crop: [cx, cy, width, height],
              x: row.x + width / 2 - stage[0] / 2, y: row.y + height / 2 - stage[1] / 2, z: row.z })
          }
          return true
        }
        return unsupported()
      },
    })
  } catch (error) { failure = String(error.message || error) }
  if (!failure && ['returned', 'exited'].includes(run?.status) && displayBatchDepth) failure = 'AGE uncommitted display batch at script end'
  if (!failure && ['returned', 'exited'].includes(run?.status) && runtime.hasCallbacks()) failure = 'AGE callback dispatch at script exit is not implemented'
  const complete = !failure && ['returned', 'exited'].includes(run?.status)
  // Preserve partial output exclusively for diagnostics; parse() below does
  // not hand it to the player as a successfully reconstructed scene.
  finish()
  stats.run = run ? { status: run.status, stopped: run.stopped, missingScript: run.missingScript, steps: run.trace.length } : { status: 'error', stopped: current || null }
  stats.complete = complete
  stats.displayBatchDepth = displayBatchDepth
  stats.state = runtime.snapshot()
  if (failure) stats.error = failure
  return { steps, stats, complete }
}

export function parse(text, ctx = null, meta = {}) {
  const input = String(text || '').replace(/^\uFEFF/, '')
  if (input.length > 32 * 1024 * 1024) throw Error('AGE package exceeds 32 MiB')
  const data = JSON.parse(input)
  const context = ctx?.context(data.namespace)
  const options = { ...(context?.stage ? { stage: context.stage } : {}), ...(ctx?.options || {}), ...(meta.options || {}) }
  if (!Array.isArray(options.stage) && context?.stage) options.stage = context.stage
  const result = analyzeAgeScene({ ...data, resources: data.resources || context?.resources, links: data.links || context?.links }, options)
  if (!result.complete) {
    const stop = result.stats.run.stopped
    const where = stop ? `${stop.script || data.name || 'BIN'} @${stop.offset} opcode 0x${stop.opcode.toString(16)}` : data.name || 'BIN'
    const error = Error(`AGE 场景尚未完整解析：${where}；${result.stats.error || result.stats.run.status}；未把部分台词当成完整场景`)
    error.ageDiagnostic = result
    throw error
  }
  return { steps: result.steps, stats: result.stats }
}

export const ageSys4Adapter = { id: ADAPTER_ID, label: 'AGE SYS4（已确认指令；未支持指令明确报错）', sniff, explainSniff, parse, prepare, contextFiles, contextDirs }
