#!/usr/bin/env node
// WillPlus AdvHD 自测（不需要浏览器）：ws2 解码、ARC / PNA 读取、容器展开（config.containers）、advhd::ws2 适配器、
// 引擎家族（game.id = advhd::<游戏>）的布局 / 浏览 / 取资源。全部用合成数据（scripts/dev/make-advhd-fixture.mjs），不含任何真实游戏资源。
//   node scripts/dev/gal-advhd-selftest.mjs
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../../scripts/tag-scripts/gal-layout/main.js'
import { decodeWs2, OPCODE_TABLE, ror2 } from '../../web/library/gal/adapters/advhd-ws2-decode.mjs'
import { galAdapter, galAdapterIds, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { applyGalConfigPatch, normalizeGalConfig, normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { containerReport, ensureContainers, invalidateContainers, parsePna, readArcIndex, SCRIPT_DECODERS } from '../../web/library/gal/containers.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { resolveOnDisk } from '../../web/library/gal/resolve.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { activePath } from '../../web/static/gal-engine.js'
import { STORY_001, STORY_BRANCH, STORY_COND, STORY_SKIP, arcBuild, buildAdvhdFixture, msg, pnaBuild, pngBytes, ws2Encode, ws2Plain } from './make-advhd-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const J = (v) => JSON.stringify(v)
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-advhd-'))
const exists = (p) => stat(p).then(() => true, () => false)
const list = async (dir) => { try { return (await readdir(dir)).sort() } catch { return [] } }
const decodeText = (buffer, arc = 'Rio1', name = 'x') => SCRIPT_DECODERS['advhd-ws2'].decode(buffer, { arc, name })
const FAMILY_CONTAINERS = { enabled: true, dir: 'arc', scan: ['.'], scriptDecoder: 'advhd-ws2', scriptExt: 'advhd', rules: [{ match: '^(?:Script\\d*|DX11Effect|Model|Rio)\\.arc$', skip: true }, { match: '\\.arc$' }] }
const cfgWith = (containers, extra = {}) => normalizeGalConfig({ scriptRoots: [{ id: 'story', dir: 'arc/script', label: '剧情' }], resourceRoots: ['arc/res'], scriptExtensions: ['advhd'], containers, limits: { sampleFiles: 20000, sampleBytes: 262144 }, ...extra })

// ================= ws2 解码 =================
{
  const buf = Buffer.from([0, 1, 2, 3, 4, 5, 250, 251, 252, 253, 254, 255])
  check('ror2：逐字节循环右移 2 位，再循环左移 2 位（测试编码器的 rol2）= 原样', ror2(buf).equals(Buffer.from(buf.map((x) => ((x >> 2) | ((x & 3) << 6)) & 0xff))) && ror2(Buffer.from([0x01]))[0] === 0x40)
  const items = [['SetBackground', ['bg01', '背景.PNG']], ['Unk65', [1, 2, 3, 0.5, 0.25, 4, 5, 6]], ['UnkAF', [255, 255, 0, 0, 0, 0, 1, 0]], ['FileEnd', [0, 0, 0, 0, 0]]]
  const out = decodeWs2(ror2(ws2Encode(items)))
  check('解码：指令名 / 参数（UTF-16LE 字符串、f32）和编码前一致；0xAF = b4 + f4（8 个参数）', J(out.map((i) => i.name)) === J(items.map((i) => i[0])) && J(out.map((i) => i.args)) === J(items.map((i) => i[1])), J(out))
  check('解码：每条指令带它在文件里的偏移 at，且单调递增', out.every((i, k) => k === 0 || i.at > out[k - 1].at) && out[0].at === 0)
  const withCond = decodeWs2(ror2(ws2Encode([['Condition', [1]], ['Condition', [2, 127, 1, 0, 40]], ['Condition', [130, 99, -1, 0, 40]], ['Condition', [3]], ['FileEnd', [0, 0, 0, 0, 0]]])))
  check('Condition：类型 1 / 3（后面不是 50 51 125 127 128）没有参数；2 / 130 带 变量 + 值 + 两个跳转', J(withCond.map((i) => i.args.length)) === J([1, 5, 5, 1, 5]), J(withCond.map((i) => i.args)))
  const choice = decodeWs2(ror2(ws2Encode(STORY_BRANCH))).find((i) => i.name === 'ShowChoice')
  check('ShowChoice：选项（id、文字、3 个标志字节、跳转类型 6 = 本脚本偏移 / 7 = 文件名）', choice.choices.length === 3 && choice.choices[0].jump === 6 && typeof choice.choices[0].target === 'number' && choice.choices[2].target === 'OTHER_00' && choice.choices[1].text === '右へ', J(choice))
  const fn = decodeWs2(ror2(ws2Encode(STORY_SKIP))).find((i) => i.name === 'ExecuteFunction')
  check('ExecuteFunction：函数名 / 字符串参数 / u16 标志号（999）/ byte', J(fn.args) === J(['GetMsgSkip', '', 999, 1]), J(fn))
  const stand = decodeWs2(ror2(ws2Encode(STORY_001))).find((i) => i.name === 'DisplayCharacterImage')
  check('DisplayCharacterImage：第 3 个字节 = 图片 id 个数，id 表在 extra 里', J(stand.ids) === J([1, 3]) && stand.args[0] === 'st01', J(stand))
  let err = null
  try { decodeWs2(Buffer.from([0x7e, 0x00])) } catch (e) { err = e }
  check('不认识的 opcode：抛错，带偏移和 opcode；tolerant 模式停在那里、返回已解出的部分、truncated 记原因', /偏移 0（opcode 0x7e）/.test(err?.message || '') && decodeWs2(Buffer.concat([ws2Plain([['ClearLayer', ['*']]]), Buffer.from([0x7e])]), { tolerant: true }).truncated?.includes('0x7e'))
  let err2 = null
  try { decodeWs2(ws2Plain([['SetBackground', ['bg01', 'x']]]).subarray(0, 9)) } catch (e) { err2 = e }
  check('文件被截断（字符串没有结束）：报 eof，带偏移', /偏移 0.*eof/.test(err2?.message || ''), err2?.message)
  check('opcode 表：社区表的指令 + 0xAF；没有重复的名字', OPCODE_TABLE[0xaf]?.[0] === 'UnkAF' && new Set(Object.values(OPCODE_TABLE).map(([n]) => n)).size === Object.keys(OPCODE_TABLE).length)
}

// ================= ARC / PNA 读取 =================
{
  const dir = path.join(work, 'arc-read')
  await mkdir(dir, { recursive: true })
  const good = arcBuild([{ name: 'a.png', data: pngBytes(1) }, { name: '日本語.ogg', data: Buffer.from('OggS') }, { name: 'empty.bin', data: Buffer.alloc(0) }])
  await writeFile(path.join(dir, 'good.arc'), good)
  const idx = await readArcIndex(path.join(dir, 'good.arc'))
  check('ARC 索引：条目数、UTF-16 名字（含中日文）、数据偏移 / 大小', idx.entries.length === 3 && idx.entries[1].name === '日本語.ogg' && good.subarray(idx.entries[1].offset, idx.entries[1].offset + idx.entries[1].size).toString() === 'OggS' && idx.entries[2].size === 0, J(idx))
  const bad = {
    'tiny.arc': Buffer.from([1, 2, 3]),
    'dirbig.arc': (() => { const b = Buffer.from(good); b.writeUInt32LE(0x7fffffff, 4); return b })(),
    'count.arc': (() => { const b = Buffer.from(good); b.writeUInt32LE(1000000, 0); return b })(),
    'beyond.arc': good.subarray(0, good.length - 3),
    'noterm.arc': (() => { const b = Buffer.from(good); const dirSize = b.readUInt32LE(4); b.fill(0x41, 8 + 8, 8 + dirSize); return b })(),
  }
  const results = {}
  for (const [name, data] of Object.entries(bad)) { await writeFile(path.join(dir, name), data); results[name] = await readArcIndex(path.join(dir, name)).then(() => 'ok', (e) => e.message) }
  check('损坏的 ARC：太小 / 目录大小不合理 / 条目数和目录对不上 / 数据超出文件 / 名字没有结束符，都明确报错（不崩、不读超界）', Object.values(results).every((r) => r !== 'ok'), J(results))

  const png = pngBytes(5)
  const pna = parsePna(pnaBuild({ magic: 'WPAS', width: 10, height: 20, frames: [{ type: 1 }, { type: 0, id: 7, x: 1, y: 2, w: 3, h: 4, scale: 0.5, data: png }, { type: 2 }] }))
  check('PNA：魔数 / 宽高 / 帧（type、id、位置、尺寸、缩放、数据）；type 1 / 2 的组标记帧没有数据', pna.magic === 'WPAS' && pna.width === 10 && pna.height === 20 && pna.frames.length === 3 && pna.frames[1].id === 7 && pna.frames[1].w === 3 && pna.frames[1].scale === 0.5 && pna.frames[1].data.equals(png) && pna.frames[0].size === 0, J(pna.frames.map((f) => [f.type, f.id, f.size])))
  let e1 = null
  try { parsePna(Buffer.from('NOPE000000000000000000000')) } catch (e) { e1 = e }
  let e2 = null
  try { const b = pnaBuild({ frames: [{ type: 0, id: 1, data: png }] }); parsePna(b.subarray(0, b.length - 5)) } catch (e) { e2 = e }
  check('PNA 损坏：魔数不对 / 帧数据超出文件，报错', /魔数/.test(e1?.message || '') && /超出/.test(e2?.message || ''), `${e1?.message} | ${e2?.message}`)
}

// ================= 容器展开（config.containers）=================
const game = path.join(work, 'game')
await buildAdvhdFixture(game, { brokenArc: true })
{
  const cfg = cfgWith(FAMILY_CONTAINERS)
  const report = await ensureContainers({ mediaDir: game, config: cfg })
  const arcs = report.arcs
  check('规则：Script2 / Rio 在黑名单（skip）里不展开；坏的 Chip9.arc 报错但不影响别的容器', arcs['./Script2.arc']?.skipped === 'rule' && arcs['./Rio.arc']?.skipped === 'rule' && /不是 ARC|不合理|太小/.test(arcs['./Chip9.arc']?.error || '') && arcs['./Rio1.arc']?.scripts === 3, J(arcs))
  check('展开：剧情 = arc/script/<容器>/<脚本>.advhd（readme.txt 这种不认识的类型不展开）；图 / 声音 = arc/res/<容器>/<条目名> 原样', J(await list(path.join(game, 'arc/script/Rio1'))) === J(['001_00.advhd', '002_00_H.advhd', '003_00.advhd']) && J(await list(path.join(game, 'arc/res/Voice'))) === J(['SV_TOW_01.ogg', 'TW_0001.ogg', 'TW_0002.ogg']) && (await readFile(path.join(game, 'arc/res/Bgm/BGM01.ogg'), 'utf8')) === 'OggS-bgm' && !(await exists(path.join(game, 'arc/script/Rio')) ) && !(await exists(path.join(game, 'arc/res/Chip9'))), J(await list(path.join(game, 'arc'))))
  const text = await readFile(path.join(game, 'arc/script/Rio1/001_00.advhd'), 'utf8')
  const parsed = JSON.parse(text)
  check('脚本被解成 JSON 指令流：format / arc / name / size / ins[[偏移, 指令名, 参数]]；sniff 认得', parsed.format === 'advhd-ws2/1' && parsed.arc === 'Rio1' && parsed.name === '001_00' && parsed.ins.length === STORY_001.length && parsed.ins[0][1] === 'ClearLayer' && galAdapter('advhd::ws2').sniff(text) && sniffGalAdapter(text) === 'advhd::ws2', J(parsed.ins.slice(0, 2)))
  const pnaDir = path.join(game, 'arc/res/Chip3/ST_TOW_A_M.pna')
  const index = JSON.parse(await readFile(path.join(pnaDir, 'index.json'), 'utf8'))
  check('PNA 展开成目录：index.json（宽 / 高 / 帧：type id x y w h scale file）+ <帧 id>.png；组标记帧没有文件', J(await list(pnaDir)) === J(['1.png', '2.png', '3.png', 'index.json']) && index.width === 600 && index.height === 800 && index.frames.length === 5 && index.frames[1].file === '1.png' && index.frames[0].file === undefined && (await readFile(path.join(pnaDir, '3.png'))).equals(pngBytes(13)), J(index))
  const stampFile = path.join(game, 'arc/.stamp.json')
  const mtime1 = (await stat(path.join(game, 'arc/res/Bgm/BGM01.ogg'))).mtimeMs
  invalidateContainers(game)
  const again = await ensureContainers({ mediaDir: game, config: cfg })
  check('幂等：容器没变（大小 + mtime + 规则指纹）→ 不重新展开（文件 mtime 不变，报告 cached）', again.arcs['./Bgm.arc'].cached === true && (await stat(path.join(game, 'arc/res/Bgm/BGM01.ogg'))).mtimeMs === mtime1 && (await exists(stampFile)))
  // 容器换了内容 → 重新展开，旧文件清掉
  await writeFile(path.join(game, 'Bgm.arc'), arcBuild([{ name: 'BGM02.ogg', data: Buffer.from('OggS-new') }]))
  invalidateContainers(game)
  const changed = await ensureContainers({ mediaDir: game, config: cfg })
  check('容器变了 → 重新展开，旧条目不残留', !changed.arcs['./Bgm.arc'].cached && J(await list(path.join(game, 'arc/res/Bgm'))) === J(['BGM02.ogg']), J(await list(path.join(game, 'arc/res/Bgm'))))
  await writeFile(path.join(game, 'Bgm.arc'), arcBuild([{ name: 'BGM01.ogg', data: Buffer.from('OggS-bgm') }]))
  // 规则指纹变了（改了 include）→ 重新展开
  invalidateContainers(game)
  const narrowed = await ensureContainers({ mediaDir: game, config: cfgWith({ ...FAMILY_CONTAINERS, rules: [{ match: '^Rio1\\.arc$', kinds: ['script'], exclude: ['^003'] }, { match: '^Chip3\\.arc$', kinds: ['res'], include: ['^BG_'] }, { match: '\\.arc$', skip: true }] }) })
  check('规则可配：kinds / include / exclude / skip（黑名单）——003 被 exclude、Chip3 只收 BG_*、PNA 不在 kinds 里、别的容器 skip', J(await list(path.join(game, 'arc/script/Rio1'))) === J(['001_00.advhd', '002_00_H.advhd']) && J(await list(path.join(game, 'arc/res/Chip3'))) === J(['BG_01.png']) && narrowed.arcs['./Bgm.arc'].skipped === 'rule' && narrowed.arcs['./Rio1.arc'].excluded === 1, J(narrowed.arcs['./Chip3.arc']))
  const noPna = path.join(work, 'game-nopna')
  await buildAdvhdFixture(noPna)
  await ensureContainers({ mediaDir: noPna, config: cfgWith({ ...FAMILY_CONTAINERS, rules: [{ match: '^Chip3\\.arc$', pna: 'raw' }] }) })
  check('pna: raw = .pna 原样放（不拆帧）；pna: skip = 不要', (await exists(path.join(noPna, 'arc/res/Chip3/ST_TOW_A_M.pna'))) && !(await stat(path.join(noPna, 'arc/res/Chip3/ST_TOW_A_M.pna'))).isDirectory())
  const noPna2 = path.join(work, 'game-skippna')
  await buildAdvhdFixture(noPna2)
  await ensureContainers({ mediaDir: noPna2, config: cfgWith({ ...FAMILY_CONTAINERS, rules: [{ match: '^Chip3\\.arc$', pna: 'skip' }] }) })
  check('pna: skip：Chip3 里只剩普通图片', J(await list(path.join(noPna2, 'arc/res/Chip3'))) === J(['BG_01.png', 'EV_01.png']))
  check('没启用（默认）：什么都不做、不建目录、返回 null', (await ensureContainers({ mediaDir: path.join(work, 'x'), config: normalizeGalConfig({}) })) === null && !(await exists(path.join(work, 'x'))))
}
{
  // 条目名安全：越界 / 绝对路径 / 隐藏文件 / 特殊字符 / 太长 / 层数太多 都不展开，不会写到 arc 目录外面
  const dir = path.join(work, 'evil')
  await mkdir(dir, { recursive: true })
  const names = ['../evil.png', 'a/../../evil2.png', '/abs.png', '.hidden.png', 'a|b.png', 'x#y.png', `${'n'.repeat(250)}.png`, 'a/b/c/d/e/f/g.png', 'dir/ok.png', 'ok2.png']
  await writeFile(path.join(dir, 'Evil.arc'), arcBuild(names.map((name) => ({ name, data: pngBytes(3) }))))
  const report = await ensureContainers({ mediaDir: dir, config: cfgWith({ ...FAMILY_CONTAINERS, rules: [{ match: '\\.arc$' }] }) })
  const r = report.arcs['./Evil.arc']
  check('条目名只认安全的相对路径：越界 / 隐藏 / 特殊字符 / 太长 / 层数太多的 7 个名字被拒（记在 bad），开头的 / 去掉当相对路径（abs.png）；展开的只有 abs.png、dir/ok.png、ok2.png；arc 目录外没有任何新文件', r.res === 3 && r.bad.length === 7 && J(await list(path.join(dir, 'arc/res/Evil'))) === J(['abs.png', 'dir', 'ok2.png']) && !(await exists(path.join(dir, 'evil.png'))) && !(await exists(path.join(work, 'evil.png'))) && !(await exists(path.join(dir, 'arc/evil.png'))), J(r))
  const small = path.join(work, 'budget')
  await mkdir(small, { recursive: true })
  await writeFile(path.join(small, 'Big.arc'), arcBuild([{ name: 'a.ogg', data: Buffer.alloc(1100 * 1024) }, { name: 'b.ogg', data: Buffer.alloc(1100 * 1024) }]))
  const budget = await ensureContainers({ mediaDir: small, config: { ...cfgWith({ ...FAMILY_CONTAINERS, rules: [{ match: '\\.arc$' }] }), containers: { ...cfgWith(FAMILY_CONTAINERS).containers, rules: [{ match: '\\.arc$' }], maxTotalMB: 1 } } })
  check('展开总大小有上限（containers.maxTotalMB）：超了这个容器报错、半截内容不留下', /总大小超过上限/.test(budget.arcs['./Big.arc'].error || '') && !(await exists(path.join(small, 'arc/res/Big'))), J(budget.arcs))
  const many = path.join(work, 'many')
  await mkdir(many, { recursive: true })
  await writeFile(path.join(many, 'Many.arc'), arcBuild([1, 2, 3].map((n) => ({ name: `f${n}.png`, data: pngBytes(n) }))))
  const limited = await ensureContainers({ mediaDir: many, config: { ...cfgWith(FAMILY_CONTAINERS), containers: { ...cfgWith(FAMILY_CONTAINERS).containers, rules: [{ match: '\\.arc$' }], maxEntries: 2 } } })
  check('单个容器条目数上限（containers.maxEntries）', /条目 3 个，超过上限 2/.test(limited.arcs['./Many.arc'].error || ''), J(limited.arcs))
  const concurrent = path.join(work, 'concurrent')
  await buildAdvhdFixture(concurrent)
  const cfg = cfgWith(FAMILY_CONTAINERS)
  const [p1, p2, p3] = [ensureContainers({ mediaDir: concurrent, config: cfg }), ensureContainers({ mediaDir: concurrent, config: cfg }), ensureContainers({ mediaDir: concurrent, config: cfg })]
  check('并发调用共用同一次展开（单飞）：三个调用拿到同一个 Promise 的结果', p1 === p2 && p2 === p3 && (await p1).arcs['./Rio1.arc'].scripts === 3 && containerReport(concurrent)?.arcs['./Rio1.arc'].scripts === 3)
}

// ================= config：containers 规整 =================
{
  const { config, warnings } = normalizeGalConfigWithWarnings({ containers: { enabled: true, dir: '../x', scan: ['a/../b', '.'], scriptDecoder: 'nope', scriptExt: 'A B', maxEntries: 'many', maxTotalMB: 999999, rules: [{ match: '(a+)+' }, { match: '\\.arc$', kinds: ['res', 'bogus'], include: ['ok', '(b+)+'], pna: 'weird' }, 'x', { match: 'Rio', skip: true, extra: 1 }], bogus: 1 } })
  check('containers 规整：不安全目录 / 不认识的解码器 / 坏正则 / 越界数字 都丢掉或夹住并报告，合法的保留', config.containers.dir === 'arc' && J(config.containers.scan) === J(['.']) && config.containers.scriptDecoder === 'advhd-ws2' && config.containers.scriptExt === 'advhd' && config.containers.maxEntries === 200000 && config.containers.maxTotalMB === 65536 && config.containers.rules.length === 2 && J(config.containers.rules[0]) === J({ match: '\\.arc$', kinds: ['res'], include: ['ok'] }) && config.containers.rules[1].skip === true && warnings.length >= 8, J([config.containers, warnings.map((w) => w.field)]))
  check('containers 默认关闭；game.id / 适配器 id 允许 :: 分段（advhd::lpsl / advhd::ws2），不合格的丢掉', normalizeGalConfig({}).containers.enabled === false && normalizeGalConfig({ game: { id: 'advhd::lpsl' } }).game.id === 'advhd::lpsl' && normalizeGalConfig({ game: { id: 'a::b::c' } }).game?.id === 'a::b::c' && normalizeGalConfig({ game: { id: 'a::b::c::d' } }).game === null && normalizeGalConfig({ game: { id: 'a:b' } }).game === null && normalizeGalConfig({ game: { id: '::a' } }).game === null && !!normalizeGalConfig({ adapterOptions: { 'advhd::ws2': { a: 1 } } }).adapterOptions['advhd::ws2'] && !normalizeGalConfig({ adapterOptions: { 'Advhd::ws2': { a: 1 } } }).adapterOptions['Advhd::ws2'])
  check('适配器注册：advhd::ws2', galAdapterIds().includes('advhd::ws2'))
}

// ================= 适配器 advhd::ws2 =================
const parseGame = async (mediaDir, story, options = {}, configExtra = {}) => {
  const config = cfgWith(FAMILY_CONTAINERS, configExtra)
  await ensureContainers({ mediaDir, config })
  const adapter = galAdapter('advhd::ws2')
  const ctxConfig = { ...config, adapterOptions: { 'advhd::ws2': options } }
  const ctx = await loadAdapterContext({ adapter, mediaDir, config: ctxConfig })
  return buildScene('advhd::ws2', decodeText(ws2Encode(story)), ctx, { rel: 'arc/script/Rio1/x.advhd', stem: 'x', options, config: {} })
}
const cmdsOf = (scene, step) => scene.steps[step].commands
const textOf = (scene) => scene.steps.flatMap((s) => s.commands).filter((c) => c.op === 'text').map((c) => c.segments.map((x) => x.text).join(''))
{
  const scene = await parseGame(game, STORY_001)
  const [s0, s1, s2, s3, s4, s5] = scene.steps.map((s) => s.commands)
  check('剧情脚本 → 6 步（每句台词一步）；图层变更在「提交」（Unk65）时才生效，渐变秒数取 Unk65 的 f32', scene.steps.length === 6 && scene.stats.messages === 6 && s0[0].op === 'bg' && s0[0].src === 'Chip3/BG_01.png' && s0[0].fade === 0.5, J(s0))
  check('第 1 步：bgm（Bgm 容器）→ voice（char* 通道，Voice 容器）→ speaker（%LC 去掉）→ text（\\n = 换行，{汉字:ふりがな} = ruby，%K %P 去掉）', J(s0.slice(1).map((c) => c.op)) === J(['bgm', 'voice', 'speaker', 'text']) && s0[1].src === 'Bgm/BGM01.ogg' && s0[2].src === 'Voice/TW_0001.ogg' && s0[3].segments[0].text === '透羽' && J(s0[4].segments) === J([{ text: '「' }, { text: '應賀', ruby: 'おうが' }, { text: 'です。\nよろしく」' }]), J(s0))
  check('说话人换了才发 speaker：空名 = 旁白（segments: []），同一个人连续不重复发', s1[0].op === 'speaker' && s1[0].segments.length === 0 && s1[1].op === 'text' && !s3.some((c) => c.op === 'speaker'), J([s1, s3]))
  const stand = s2.find((c) => c.op === 'stand')
  check('立绘：UsePnaPackage + DisplayCharacterImage(id 表 [1, 3]) + MoveBackground(x, y) → stand（slot = 图层名，parts = PNA 里那两帧的 PNG，舞台 1280×720，位置 = 图层位置 + 帧位置，换算成「中心相对舞台中心」）', stand?.slot === 'st01' && J(stand.stage) === J([1280, 720]) && stand.fade === 0.2 && J(stand.parts) === J([{ src: 'Chip3/ST_TOW_A_M.pna/1.png', x: -290, y: 90 }, { src: 'Chip3/ST_TOW_A_M.pna/3.png', x: -480, y: -235 }]), J(stand))
  check('事件图：ev 图层有图时 bg = { src: bg 的图, over: ev 的图 }', J(s3.find((c) => c.op === 'bg')) === J({ op: 'bg', src: 'Chip3/BG_01.png', over: 'Chip3/EV_01.png' }), J(s3))
  check('声音通道：char* = voice，bgv* = bgvoice（槽位 = 通道名，音量 1），se* = se；StopMusic = bgmStop（带淡出秒数）', J(s4.slice(0, 2)) === J([{ op: 'bgvoice', slot: 'bgvtow', src: 'Voice/SV_TOW_01.ogg', volume: 1 }, { op: 'se', src: 'Se/SE_01.ogg' }]) && s5.some((c) => c.op === 'bgmStop' && c.fade === 1), J([s4, s5]))
  check('stats：语音引用 / 解析（3 / 3）、bgm、图片、choices 等计数；没走到的指令（NextFile 后面的 FileEnd）计 unvisited', scene.stats.voices.referenced === 3 && scene.stats.voices.resolved === 3 && scene.stats.voices.unresolved === 0 && scene.stats.bgm.resolved === 1 && scene.stats.images.referenced === 2 && scene.stats.images.resolved === 2 && scene.stats.stands === 1 && scene.stats.choices === 0 && scene.stats.unvisited === 1, J(scene.stats))
  check('没做的功能看得见：未知函数 playSpecialEffect → raw（ExecuteFunction:playSpecialEffect）+ stats.skippedFunctions；GetMsgSkip 在 drop 表里不记；Effect1 → raw；UnkAF 在 ignoreOps 里只计数', J(scene.stats.skippedFunctions) === J({ playSpecialEffect: 1 }) && scene.stats.raw['ExecuteFunction:playSpecialEffect'] === 1 && scene.stats.raw.Effect1 === 1 && !scene.stats.raw['ExecuteFunction:GetMsgSkip'] && scene.stats.ignored.UnkAF === 1 && s5.some((c) => c.op === 'raw' && c.cmd === 'ExecuteFunction:playSpecialEffect') && s5.some((c) => c.op === 'raw' && c.cmd === 'Effect1'), J([scene.stats.raw, scene.stats.ignored]))
  check('NextFile 的目标记进 stats.links（播放器没有换脚本）；脚本在 FileEnd / NextFile 结束', scene.stats.links['next:002_00_H'] === 1)

  const opt = await parseGame(game, STORY_001, { functions: { default: 'drop' }, channels: [{ match: '^char', as: 'se' }], ignoreOps: ['Effect1'], fade: { max: 0.1 } })
  check('options 可改：functions.default = drop（不记 raw）/ channels（char* 当 se）/ ignoreOps（Effect1 不再 raw）/ fade.max 夹渐变秒数', !opt.stats.raw['ExecuteFunction:playSpecialEffect'] && !opt.stats.raw.Effect1 && opt.stats.ignored.Effect1 === 1 && opt.steps[0].commands.find((c) => c.op === 'se')?.src === 'Voice/TW_0001.ogg' && opt.steps[0].commands[0].fade === 0.1, J(opt.steps[0].commands.slice(0, 3)))
  const noIndex = buildScene('advhd::ws2', decodeText(ws2Encode(STORY_001)), null, { rel: 'x', stem: 'x', options: {}, config: {} })
  check('没有资源索引（ctx 为空）：台词照常，资源不发指令也不报缺（不是缺资源，是没法查）', noIndex.stats.messages === 6 && !noIndex.steps.flatMap((s) => s.commands).some((c) => ['voice', 'bgm', 'bg', 'stand'].includes(c.op)) && J(noIndex.stats.unresolved) === '{}')
  // 缺资源：删掉 Voice 容器
  const noVoice = path.join(work, 'game-novoice')
  await buildAdvhdFixture(noVoice, { voices: false })
  const missing = await parseGame(noVoice, STORY_001)
  check('缺容器（没有 Voice.arc）：语音 3 个都记 unresolved（stats.unresolved["voice:TW_0001.OGG"]），不发 voice 指令，台词 / 别的资源不受影响', missing.stats.voices.unresolved === 3 && missing.stats.unresolved['voice:TW_0001.OGG'] === 1 && !missing.steps.flatMap((s) => s.commands).some((c) => c.op === 'voice') && missing.stats.bgm.resolved === 1 && missing.stats.messages === 6, J(missing.stats.unresolved))
}
{
  const scene = await parseGame(game, STORY_BRANCH)
  const c1 = scene.steps[0].commands.at(-1)
  check('选项：choice（id = 步序号:指令序号、var、options 值 1..3）挂在问题那句台词的步里（问题留在文本框里）；本脚本跳转的两个选项 → 带 when 的分支，汇合点之后不带 when', scene.steps.length === 5 && c1.op === 'choice' && c1.id === '0:3' && c1.var === 'sel0' && c1.options.length === 3 && c1.options[2].value === 3 && J(textOf(scene)) === J(['選んでください', '（「別の話へ」→ 脚本 OTHER_00 へ続く）', '左の道', '右の道', '合流']), J(textOf(scene)))
  const guardOf = (i) => J([...new Set(scene.steps[i].commands.map((c) => J(c.when)))])
  const g = (op, value) => J([J([{ var: 'sel0', op, value }])])
  check('分支的 when：左 = sel0 == 1，右 = sel0 == 2，别的脚本的选项 = sel0 == 3，汇合之后 = sel0 != 3（选了「跳到别的脚本」就在提示那里结束）；问题那一步没有 when', guardOf(2) === g('==', 1) && guardOf(3) === g('==', 2) && guardOf(1) === g('==', 3) && guardOf(4) === g('!=', 3) && scene.steps[0].commands.every((c) => !c.when), J([0, 1, 2, 3, 4].map(guardOf)))
  const path1 = activePath(scene, { '0:3': 1 })
  const path2 = activePath(scene, { '0:3': 2 })
  const path3 = activePath(scene, { '0:3': 3 })
  const said = (p) => J(p.map((i) => scene.steps[i].commands.filter((c) => c.op === 'text').map((c) => c.segments.map((x) => x.text).join('')).join('')))
  check('播放器按选择走：选 1 = 左 → 合流；选 2 = 右 → 合流；选 3 = 提示 → 结束（没有合流）', said(path1) === J(['選んでください', '左の道', '合流']) && said(path2) === J(['選んでください', '右の道', '合流']) && said(path3) === J(['選んでください', '（「別の話へ」→ 脚本 OTHER_00 へ続く）']), J([path1, path2, path3]))
  check('stats：choices = 1，别的脚本的选项记进 links', scene.stats.choices === 1 && Object.keys(scene.stats.links).some((k) => /choice 3 「別の話へ」→ OTHER_00/.test(k)), J(scene.stats.links))
}
{
  const scene = await parseGame(game, STORY_COND)
  check('条件：SetFlag 设的变量按设的值求值（==1 为真 → 走真的那条）；127 默认 0（flags.values）→ 「127 == 1」为假 → 跳过；ConditionalJump 默认取第二个目标（跳过动画）', J(textOf(scene)) === J(['flag10 = 1 の道', '通常', '終端']) && scene.stats.unvisited === 4, J(textOf(scene)))
  const none = await parseGame(game, STORY_COND, { conditionalJump: 'none' })
  const first = await parseGame(game, STORY_COND, { conditionalJump: 'first' })
  check('options.conditionalJump：none = 不跳（动画 A、B 都走）/ first = 取第一个目标', J(textOf(none)) === J(['flag10 = 1 の道', '通常', 'アニメ A', 'アニメ B', '終端']) && J(textOf(first)) === J(['flag10 = 1 の道', '通常', 'アニメ B', '終端']), J([textOf(none), textOf(first)]))
  const flag = await parseGame(game, STORY_COND, { flags: { values: { 127: 1 } } })
  check('options.flags.values：127 = 1 → 「127 == 1」为真，多出那一句', J(textOf(flag)) === J(['flag10 = 1 の道', '127 = 1 の道（既定では通らない）', '通常', '終端']), J(textOf(flag)))
  const unknown = [['Condition', [2, 55, 1, 0, { ref: 'skip' }]], msg(0, '未知の変数は真'), ['Jump', [{ ref: 'end' }]], { label: 'skip' }, msg(1, '未知の変数は偽'), { label: 'end' }, ['FileEnd', [0, 0, 0, 0, 0]]]
  const t = await parseGame(game, unknown)
  const f = await parseGame(game, unknown, { flags: { unknown: false } })
  check('没设过的变量：flags.unknown（默认 = 真 → 走 p1（0 = 继续往下）；false = 走 p2）；stats.ignored 记一笔 Condition:unknown-flag', J(textOf(t)) === J(['未知の変数は真']) && J(textOf(f)) === J(['未知の変数は偽']) && t.stats.ignored['Condition:unknown-flag'] === 1, J([textOf(t), textOf(f)]))
  // GetMsgSkip 之后的 if / else 版式：成立 = 往下（StopMusic 0），不成立 = else 块（p1，StopMusic 1）；GetMsgSkip 把 999 写成 0（没在快进）→ 走 else
  const stopsOf = (scene) => scene.steps.flatMap((st) => st.commands).filter((c) => c.op === 'bgmStop').map((c) => c.fade)
  const skipNormal = await parseGame(game, STORY_SKIP)
  const skipOn = await parseGame(game, STORY_SKIP, { functions: { GetMsgSkip: { setFlag: 1 } } })
  const skipUnknown = await parseGame(game, STORY_SKIP.slice(1).map((i) => (i[0] === 'Condition' ? ['Condition', [2, 998, 1, i[1][3], i[1][4]]] : i)))   // 998：没有默认值也没人写过 → flags.unknown（真）→ 往下
  check('Condition 的跳转：成立 = 顺着往下，不成立 = p1（else 块）；GetMsgSkip（functions.GetMsgSkip = { setFlag: 0 }）把 999 写成 0 → 走 else = StopMusic 淡出 1 秒；改成 { setFlag: 1 } → 往下 = StopMusic 0；两种都只走一个块；没有值的变量 998 按 flags.unknown（真）往下', J(stopsOf(skipNormal)) === J([1]) && J(stopsOf(skipOn)) === J([0]) && J(textOf(skipNormal)) === J(['終わり']) && J(stopsOf(skipUnknown)) === J([0]), J([stopsOf(skipNormal), stopsOf(skipOn), stopsOf(skipUnknown)]))
  check('ExecuteFunction 的 setFlag 模式不记 raw（只计 stats.ignored）；没有 p1 的 Condition（只有 p2）= 没有 else：不成立直接跳到结尾', !skipNormal.stats.raw['ExecuteFunction:GetMsgSkip'] && skipNormal.stats.ignored['ExecuteFunction:GetMsgSkip'] === 1)
  const loop = [{ label: 'top' }, msg(0, '一度だけ'), ['Jump', [{ ref: 'top' }]]]
  const looped = await parseGame(game, loop)
  check('死循环的脚本（Jump 回自己）：每条指令只走一次，不会卡死', J(textOf(looped)) === J(['一度だけ']))
  const broken = buildScene('advhd::ws2', '{"format":"advhd-ws2/1","arc":"x","name":"y","truncated":"ws2 偏移 5（opcode 0x7e）：不认识","ins":[]}', null, { rel: 'x', stem: 'x', options: {}, config: {} })
  check('解码被截断的脚本（truncated）：stats.truncated 带原因，不崩，至少有一步', broken.stats.truncated.includes('0x7e') && broken.steps.length === 1)
  let bad = null
  try { buildScene('advhd::ws2', 'not json', null, { rel: 'x', stem: 'x', options: {}, config: {} }) } catch (e) { bad = e }
  check('不是 JSON：报「不是有效的 JSON」', /不是有效的 JSON/.test(bad?.message || ''))
}

// ================= 家族布局（gal-layout）+ handler 端到端 =================
{
  const media = path.join(work, 'lpsl')
  await buildAdvhdFixture(media)
  const run = (config, options = {}) => generateTags({ item: { itemId: 'x', title: 'x', config, source: { path: media }, adapters: ['advhd::ws2'] }, script: { id: 'gal-layout', version: '2.18.0', options } })
  const out = await run({ game: { id: 'advhd::lpsl' } })
  const cfg = out.itemPatch.gal.config
  check('家族布局：game.id「advhd::lpsl」不在表里 → 按家族 advhd 处理（日志说明），写 脚本根 / 资源根 / 脚本扩展名 / adapterOptions.resDir / containers / limits，game.id 原样写回', cfg.game.id === 'advhd::lpsl' && cfg.scriptRoots[0].dir === 'arc/script' && cfg.resourceRoots[0] === 'arc/res' && J(cfg.scriptExtensions) === J(['advhd']) && cfg.adapterOptions['advhd::ws2'].resDir === 'arc/res' && cfg.containers.enabled === true && cfg.containers.rules.some((r) => r.skip) && cfg.limits.sampleBytes === 262144 && out.logs.some((l) => /按家族「advhd」/.test(l)) && out.details.kind === 'advhd' && out.itemTags.includes('Gal游戏: advhd::lpsl'), J([out.logs.slice(0, 5), cfg.game]))
  const auto = await run({})
  check('没声明 game.id：自动探测（Script*.arc + AdvHD.exe + Rio*.arc），认领成 advhd::<目录名>', auto.itemPatch.gal.config.game.id === 'advhd::lpsl', J(auto.itemPatch.gal.config.game))
  const emptyDir = path.join(work, 'not-advhd')
  await mkdir(emptyDir, { recursive: true })
  await writeFile(path.join(emptyDir, 'Script2.arc'), 'x')
  const noMarkers = await generateTags({ item: { itemId: 'x', title: 'x', config: {}, source: { path: emptyDir } }, script: { id: 'gal-layout', version: '2.18.0', options: {} } })
  check('只有 Script2.arc、没有 AdvHD.exe / Rio*.arc：自动探测不认领（markers 不满足）；声明了 id 才按锚点认', noMarkers.itemPatch?.gal?.config?.game?.id !== 'advhd::lpsl' && !String(noMarkers.itemPatch?.gal?.config?.game?.id || '').startsWith('advhd'))
  const declared = await generateTags({ item: { itemId: 'x', title: 'x', config: { game: { id: 'advhd::other' } }, source: { path: emptyDir } }, script: { id: 'gal-layout', version: '2.18.0', options: {} } })
  check('声明了 advhd::other、目录里有 Script2.arc → 认（锚点够了）', declared.itemPatch?.gal?.config?.game?.id === 'advhd::other')
  const over = await run({ game: { id: 'advhd::lpsl' } }, { layouts: { 'advhd::lpsl': { scriptRoots: [{ id: 'main', dir: 'arc/script/Rio1', label: '本篇' }] } } })
  check('这个游戏自己的差异：选项 layouts["advhd::lpsl"] 叠在家族项之上（只覆盖写了的字段），别的游戏不受影响', over.itemPatch.gal.config.scriptRoots[0].id === 'main' && over.itemPatch.gal.config.containers.enabled === true && (await run({ game: { id: 'advhd::lpsl2' } })).itemPatch.gal.config.scriptRoots[0].id === 'story')
  const overFamily = await run({ game: { id: 'advhd::lpsl' } }, { layouts: { advhd: { notes: [], engine: { containers: { enabled: true, rules: [{ match: '\\.arc$' }] } } } } })
  check('选项 layouts.advhd（家族 key）对家族下所有游戏生效：这里把 containers 规则换成「全收」', overFamily.itemPatch.gal.config.containers.rules.length === 1)
  const again = await generateTags({ item: { itemId: 'x', title: 'x', config: cfg, source: { path: media }, adapters: ['advhd::ws2'] }, script: { id: 'gal-layout', version: '2.18.0', options: {} } })
  check('存进条目再跑一次 = 没有改动（containers 的默认值字段和引擎规整一致，不会被当成改动）', /新增 0 项 \/ 修改 0 项 \/ 删除 0 项/.test(again.logs.join('\n')), again.logs.filter((l) => /本次改动|^[+~-]/.test(l)).join(' | '))
  const { warnings } = normalizeGalConfigWithWarnings(applyGalConfigPatch({}, cfg))
  check('写出来的 config 经引擎规整没有任何警告', warnings.length === 0, J(warnings))

  // handler：导入 → 脚本 → 浏览 → 播放 → 取资源（第一次浏览时服务端读 arc）
  const dataDir = path.join(work, 'data')
  const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => exists(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media, adapters: ['advhd::ws2'] } } }) })
  const imported = await handler.importFromSource({ options: { adapters: ['advhd::ws2'], config: { game: { id: 'advhd::lpsl' } } } })
  const item = imported.items[0]
  check('导入：adapters 里的 advhd::ws2 被认；game.id 带 :: 能存', J(item.adapters) === J(['advhd::ws2']) && item.config.game.id === 'advhd::lpsl', J([item.adapters, item.config.game]))
  check('导入本身不碰 arc（只建元数据）', !(await exists(path.join(media, 'arc'))))
  const tagOut = await generateTags({ item, script: { id: 'gal-layout', version: '2.18.0', options: {} } })
  await handler.patchItemMetadata(item.itemId, { gal: tagOut.itemPatch.gal })
  const I = await handler.getItem(item.itemId)
  let warmed = false
  for (let i = 0; i < 100 && !warmed; i++) { warmed = await exists(path.join(media, 'arc/res/Chip3/BG_01.png')); if (!warmed) await new Promise((r) => setTimeout(r, 50)) }
  check('gal-layout 写好 config（containers 已启用）后服务端在后台马上展开 arc——不用等第一次打开列表', I.config.containers?.enabled === true && warmed)
  const home = (await handler.getReaderContent(I.itemId, 'main', { sectionId: '' })).node
  check('第一次浏览：服务端读 arc 展开，首页 = 容器目录卡片（Rio1），不是空的；没有 problems', home.items.map((i) => i.title).join() === 'Rio1' && (await exists(path.join(media, 'arc/res/Chip3/BG_01.png'))) && !home.problems?.some((p) => p.level === 'error'), J(home.items.map((i) => i.title)))
  const dirNode = (await handler.getReaderContent(I.itemId, 'main', { sectionId: home.items[0].node || home.items[0].id })).node
  check('目录：3 个脚本（readme.txt / Rio.arc 里的辅助脚本不在）', dirNode.items.map((i) => i.title).join() === '001_00,002_00_H,003_00', J(dirNode.items.map((i) => i.title)))
  const play = await handler.getReaderContent(I.itemId, 'main', { sectionId: dirNode.items[0].node || dirNode.items[0].id })
  check('播放：scene 来自适配器 advhd::ws2，台词 / 语音 / 背景资源都解析到了 arc 展开的文件；脚本卡片有封面（兜底封面优先 cg：事件图 EV_01）', play.node.kind === 'player' && play.scene.adapter === 'advhd::ws2' && play.scene.stats.voices.resolved === 3 && play.scene.steps[0].commands[0].src === 'Chip3/BG_01.png' && dirNode.items[0].thumb === 'Chip3/EV_01.png', J([play.scene.adapter, play.scene.stats.voices, dirNode.items[0].thumb]))
  const res = await handler.getResource(I.itemId, play.scene.steps[0].commands[0].src)
  const voice = await handler.getResource(I.itemId, 'Voice/TW_0001.ogg')
  const frame = await handler.getResource(I.itemId, 'Chip3/ST_TOW_A_M.pna/1.png')
  check('取资源：图（image/png）、语音、PNA 的帧 PNG 都能取（路径按资源根 arc/res、名字忽略大小写）；大小写不一致也行', res.body.equals(pngBytes(1)) && res.contentType === 'image/png' && voice.body.toString() === 'OggS-1' && frame.body.equals(pngBytes(11)) && (await handler.getResource(I.itemId, 'chip3/bg_01.PNG')).body.equals(pngBytes(1)))
  const evil = await handler.getResource(I.itemId, '../Rio1.arc').then(() => 'ok', (e) => e.statusCode)
  check('取资源：../ 越界挡住（400）', evil === 400, String(evil))
  // 直接取资源（没经过浏览）也能展开
  const fresh = path.join(work, 'lpsl2')
  await buildAdvhdFixture(fresh)
  const handler2 = createGalHandler({ dataDir: path.join(work, 'data2'), safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => exists(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: fresh, adapters: ['advhd::ws2'] } } }) })
  const imp2 = (await handler2.importFromSource({ options: { adapters: ['advhd::ws2'], config: { game: { id: 'advhd::lpsl' } } } })).items[0]
  const tag2 = await generateTags({ item: imp2, script: { id: 'gal-layout', version: '2.18.0', options: {} } })
  await handler2.internals.updateItem(imp2.itemId, (it) => ({ ...it, config: applyGalConfigPatch(it.config, tag2.itemPatch.gal.config) }))   // 绕过 patchItemMetadata（它会在后台预热展开）
  check('没浏览、也没预热，直接取资源也会先展开 arc（resolveAsset 自己保证；不依赖谁先打开列表页）', !(await exists(path.join(fresh, 'arc'))) && (await handler2.getResource(imp2.itemId, 'Bgm/BGM01.ogg')).body.toString() === 'OggS-bgm')
}
{
  // 容器出问题时列表页的渲染诊断（problems）说清楚；浏览本身不被挡住
  const media = path.join(work, 'broken')
  await buildAdvhdFixture(media, { brokenArc: true })
  const cfg = cfgWith(FAMILY_CONTAINERS)
  const provider = createBrowseProvider({ mediaDir: media, config: cfg, adapters: ['advhd::ws2'], resolveAsset: async () => '' })
  const home = (await provider.getNode('')).node
  const problems = home.problems || []
  check('坏容器：problems 里有 container-failed（指名是哪个容器）；其余容器照常展开、能浏览', problems.some((p) => p.code === 'container-failed' && /Chip9\.arc/.test(p.message)) && home.items.map((i) => i.title).join() === 'Rio1', J(problems))
  const empty = path.join(work, 'nothing')
  await mkdir(empty, { recursive: true })
  const provider2 = createBrowseProvider({ mediaDir: empty, config: cfgWith(FAMILY_CONTAINERS), adapters: ['advhd::ws2'], resolveAsset: async () => '' })
  const home2 = (await provider2.getNode('')).node
  check('启用了容器但目录里没有 .arc：problems 里 container-empty 提示检查 scan / rules（不是静默空）', (home2.problems || []).some((p) => p.code === 'container-empty'), J(home2.problems))
}

console.log(`\n${pass} passed, ${fail} failed`)
await rm(work, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
