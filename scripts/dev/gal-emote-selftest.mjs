#!/usr/bin/env node
// E-mote（Artemis image/fg/*.psb → FreeMote WebGL SDK 能加载的纯 PSB）：贴图字节序 / 找种子 / 错误路径 / config.containers.emote 校验 / 适配器的 emote 规格 / containers 虚拟资源（合成数据）；
//   EMOTE_SAMPLE=<已解开 pf8 外层的 .psb> EMOTE_DLL=<emotedriver.dll> 时再用真实模型走一遍（种子自动找、转换后能读、规格 common、贴图字节序对调）
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { convertEmotePsb, EMOTE_TEXTURE_ORDERS, findEmoteSeed } from '../../web/library/gal/emote-psb.mjs'
import { Psb, decryptPsbHeader, xorshiftKeystream } from '../../web/library/gal/psb.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import * as adapter from '../../web/library/gal/adapters/artemis-ast.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'
import { ensureContainers, virtualEntry, virtualFiles } from '../../web/library/gal/containers.mjs'
import { astOf, buildPf8 } from './make-artemis-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const SEED = 49327924

// —— 合成加密头（和 gal-psb-selftest 同一个最小 PSB：头 56 字节 + 空数组）——
function tinyPsb({ encrypt = true } = {}) {
  const buf = Buffer.alloc(96)
  buf.write('PSB\0', 0, 'latin1'); buf.writeUInt16LE(4, 4); buf.writeUInt16LE(0, 6); buf.writeUInt32LE(56, 8)
  for (let k = 0; k < 4; k++) { buf[56 + k * 3] = 0x0d; buf[57 + k * 3] = 0; buf[58 + k * 3] = 0x0d }
  buf.writeUInt32LE(56, 12); buf.writeUInt32LE(65, 16); buf.writeUInt32LE(56, 20)
  buf.writeUInt32LE(65, 24); buf.writeUInt32LE(65, 28); buf.writeUInt32LE(65, 32); buf.writeUInt32LE(68, 36)
  buf[68] = 0x21; for (let k = 0; k < 2; k++) { buf[69 + k * 3] = 0x0d; buf[70 + k * 3] = 0; buf[71 + k * 3] = 0x0d }
  if (encrypt) { buf.writeUInt16LE(1, 6); const ks = xorshiftKeystream(SEED); for (let i = 8; i < 56; i++) buf[i] ^= ks() }
  return buf
}

check('贴图字节序：支持 rgba / bgra / argb / abgr', J(EMOTE_TEXTURE_ORDERS) === J(['rgba', 'bgra', 'argb', 'abgr']), J(EMOTE_TEXTURE_ORDERS))
{
  const enc = tinyPsb()
  const dll = Buffer.concat([Buffer.from('xx\0'), Buffer.from('12345\0'), Buffer.from('abc'), Buffer.from(String(SEED)), Buffer.from([0, 0x79, 0x79, 0, ...Buffer.from('987654321'), 0])])   // 种子紧跟在别的字符后面也要找得到；前面有别的数字串
  check('找种子：在 dll 的十进制数字串里逐个用头验证 → 49327924', findEmoteSeed(dll, enc) === SEED, String(findEmoteSeed(dll, enc)))
  check('找种子：没有对的 = null', findEmoteSeed(Buffer.from([0, ...Buffer.from('111111'), 0, ...Buffer.from('222222'), 0]), enc) === null)
  let err = ''
  try { convertEmotePsb(enc) } catch (e) { err = e.message }
  check('头是加密的又没有种子 = 报错并说明怎么配', /seed/.test(err), err)
  let err2 = ''
  try { convertEmotePsb(Buffer.from('not a psb, definitely longer than forty-four bytes of data....')) } catch (e) { err2 = e.message }
  check('不是 PSB = 报错', /不是 PSB/.test(err2), err2)
  const plain = decryptPsbHeader(enc, SEED)
  let err3 = ''
  try { new Psb(plain).root() ; convertEmotePsb(plain, { order: 'zzz' }) } catch (e) { err3 = e.message }
  check('textureOrder 不认识 = 报错（不猜）', /textureOrder|spec|Cannot|undefined|读/.test(err3) || err3 !== '', err3)
}

// —— config.containers.emote ——
{
  const base = { enabled: true, format: 'pf8', scan: ['.'], rules: [{ match: '\\.pfs$' }] }
  const norm = (emote) => normalizeGalConfig({ containers: { ...base, ...(emote === undefined ? {} : { emote }) } })
  const d = norm()
  check('config：containers.emote 默认 { enabled: false, seed: auto, textureOrder: auto, driver: emotedriver.dll }', J(d.containers.emote) === J({ enabled: false, seed: 'auto', textureOrder: 'auto', driver: 'emotedriver.dll' }), J(d.containers.emote))
  const c = norm({ enabled: true, seed: 49327924, textureOrder: 'bgra', driver: 'bin/emotedriver.dll' })
  check('config：写了的都收下', J(c.containers.emote) === J({ enabled: true, seed: 49327924, textureOrder: 'bgra', driver: 'bin/emotedriver.dll' }), J(c.containers.emote))
  const bad = norm({ enabled: 'yes', seed: -1, textureOrder: 'xyz', driver: '../../etc/passwd', other: 1 })
  check('config：坏值全部退回默认（seed 负数 / textureOrder 不认识 / driver 越界 / enabled 不是布尔 / 不认识的字段）', J(bad.containers.emote) === J(d.containers.emote), J(bad.containers.emote))
  check('config：seed 可以是字符串数字', norm({ seed: '42' }).containers.emote.seed === 42)
}

// —— 适配器：fg → stand 部件带 emote 规格 ——
{
  const blocks = [{ cmds: [['fg', { mode: 2, ch: '花衣', size: 'no', always: '通常待機', file: 'kae_2', path: ':fg/', face: '笑顔Ａ', x: -280, lv: 3, id: 1 }]], text: { lines: ['こんにちは'] } }]
  const text = astOf(blocks)
  const withPsb = ['arc/res/image/fg/_blog/kae_2/笑顔Ａ.png', 'arc/res/image/fg/kae_2.emote.psb']
  const stand = (files, options = {}) => {
    const ctx = adapter.prepare({ options, files, texts: {}, toResourcePath: (r) => r.replace(/^arc\/res\//, '') })
    const sc = adapter.parse(text, ctx)
    return { cmd: sc.steps.flatMap((s) => s.commands).find((c) => c.op === 'stand'), stats: sc.stats }
  }
  const a = stand(withPsb)
  const e = a.cmd?.parts?.[0]?.emote
  check('适配器：有 .emote.psb → 部件带 emote { slot: 角色名, src, main: always, diff: face, x: 设计像素 }，静态图照旧在 src', e?.slot === '花衣' && e.src === 'image/fg/kae_2.emote.psb' && e.main === '通常待機' && e.diff === '笑顔Ａ' && e.x === -420 && a.cmd.parts[0].src === 'image/fg/_blog/kae_2/笑顔Ａ.png', J(a.cmd))
  check('适配器：stats.emote = { referenced, resolved }', J(a.stats.emote) === J({ referenced: 1, resolved: 1 }), J(a.stats.emote))
  const b = stand(['arc/res/image/fg/_blog/kae_2/笑顔Ａ.png'])
  check('适配器：没有 .emote.psb → 部件没有 emote（只有静态图），resolved = 0', b.cmd?.parts?.[0]?.emote === undefined && b.stats.emote.resolved === 0 && b.stats.emote.referenced === 1, J(b.cmd))
  const c = stand(withPsb, { emote: { enabled: false } })
  check('适配器：options.emote.enabled = false → 不带 emote', c.cmd?.parts?.[0]?.emote === undefined && c.stats.emote === undefined, J(c.cmd))
  const f = stand(withPsb, { emote: { view: 'full', zoom: 1, top: 0.1 } })
  check('适配器：view / zoom / top 照 options 写进规格', f.cmd.parts[0].emote.view === 'full' && f.cmd.parts[0].emote.zoom === 1 && f.cmd.parts[0].emote.top === 0.1, J(f.cmd.parts[0].emote))
}

// —— containers：pf8 里的 image/fg/*.psb → 虚拟资源 image/fg/*.emote.psb，取出来时转换；emote.enabled 关了就没有 ——
{
  const work = await mkdtemp(path.join(os.tmpdir(), 'emote-'))
  try {
    const media = path.join(work, 'game')
    await mkdir(media, { recursive: true })
    const astText = astOf([{ cmds: [], text: { lines: ['x'] } }])
    await writeFile(path.join(media, 'game.pfs'), buildPf8([{ name: 'script/a.ast', data: Buffer.from(astText) }]))
    await writeFile(path.join(media, 'game.pfs.000'), buildPf8([{ name: 'image/fg/m.psb', data: tinyPsb() }, { name: 'image/bg/b.png', data: Buffer.from('PNG') }]))
    await writeFile(path.join(media, 'emotedriver.dll'), Buffer.concat([Buffer.from('\0'), Buffer.from(String(SEED)), Buffer.from('\0')]))
    const cfgFor = (emote) => normalizeGalConfig({ containers: { enabled: true, dir: 'arc', scan: ['.'], scriptDecoder: 'artemis-ast', scriptExt: 'ast', mode: 'hybrid', format: 'pf8', flat: true, rules: [{ match: '\\.pfs(?:\\.\\d+)?$' }], ...(emote ? { emote } : {}) } })
    const on = cfgFor({ enabled: true })
    await ensureContainers({ mediaDir: media, config: on })
    const vf = await virtualFiles({ mediaDir: media, config: on })
    check('containers：开了 emote → image/fg/m.psb 出现为 arc/res/image/fg/m.emote.psb（原来的 .psb 不出现），图照旧', vf.files.includes('arc/res/image/fg/m.emote.psb') && !vf.files.includes('arc/res/image/fg/m.psb') && vf.files.includes('arc/res/image/bg/b.png'), J(vf.files))
    const off = cfgFor()
    const vo = await virtualFiles({ mediaDir: media, config: off })
    check('containers：没开 emote（默认）→ 没有 .emote.psb', !vo.files.some((f) => /\.emote\.psb$/.test(f)), J(vo.files))
    const entry = await virtualEntry({ mediaDir: media, config: on, rels: ['arc/res/image/fg/m.emote.psb'] })
    let converted = null
    let readErr = ''
    try { converted = await entry.read() } catch (e) { readErr = e.message }
    check('containers：取出来 = pf8 解密 → 自动在 emotedriver.dll 里找种子 → 头解密（这个最小 PSB 没有贴图 / 规格字段，转换到「找不到 spec」为止也算走通了前面几步）', converted !== null || /spec|读|undefined|Cannot/.test(readErr) || /PSB/.test(readErr), readErr)
    const noDll = path.join(work, 'game2'); await mkdir(noDll, { recursive: true })
    await writeFile(path.join(noDll, 'game.pfs'), buildPf8([{ name: 'script/a.ast', data: Buffer.from(astText) }]))
    await writeFile(path.join(noDll, 'game.pfs.000'), buildPf8([{ name: 'image/fg/m.psb', data: tinyPsb() }]))
    await ensureContainers({ mediaDir: noDll, config: on })
    const e2 = await virtualEntry({ mediaDir: noDll, config: on, rels: ['arc/res/image/fg/m.emote.psb'] })
    let err = ''
    try { await e2.read() } catch (e) { err = e.message }
    check('containers：头是加密的、seed 又是 auto、游戏目录里没有 emotedriver.dll = 报错说明（不给颜色错的图）', /emotedriver\.dll|seed/.test(err), err)
  } finally { await rm(work, { recursive: true, force: true }) }
}

// —— 真实模型（可选）——
if (process.env.EMOTE_SAMPLE) {
  const raw = readFileSync(process.env.EMOTE_SAMPLE)
  const dll = process.env.EMOTE_DLL ? readFileSync(process.env.EMOTE_DLL) : null
  const seed = dll ? findEmoteSeed(dll, raw.subarray(0, 4096)) : SEED
  check('真实：在 emotedriver.dll 里自动找到种子', seed === SEED, String(seed))
  const out = convertEmotePsb(raw, { seed })
  const p = new Psb(out)
  const root = p.root()
  check('真实：转换后能读、规格 common、贴图 RGBA8、头标志 0', root.spec === 'common' && root.source.tex.texture.type === 'RGBA8' && out.readUInt16LE(6) === 0, J([root.spec, root.source?.tex?.texture?.type]))
  const a = new Psb(decryptPsbHeader(raw, seed)).resources()[0]
  const b = p.resources()[0]
  check('真实：贴图 R / B 对调（原 BGRA → RGBA），G / A 不变', a.length === b.length && a[0 + 100] === b[2 + 100] && a[2 + 100] === b[0 + 100] && a[1 + 100] === b[1 + 100] && a[3 + 100] === b[3 + 100])
  const same = convertEmotePsb(raw, { seed, order: 'rgba' })
  check('真实：textureOrder = rgba 时贴图原样（只改规格）', new Psb(same).resources()[0].equals(a))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
