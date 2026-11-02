#!/usr/bin/env node
// 自测（纯 node）：Artemis —— pf8 档案（索引 / 解密）、Lua 表解析、适配器 artemis::ast、容器展开（hybrid：脚本解密展开、图 / 声音虚拟索引 + 取出时解密）、
// 整条链（导入 → gal-layout → 列表 → 场景 → 资源）。全是合成数据。
//   node scripts/dev/gal-artemis-selftest.mjs
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../../scripts/tag-scripts/gal-layout/main.js'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { ensureContainers, materialize, virtualEntry, virtualFiles } from '../../web/library/gal/containers.mjs'
import { galAdapterIds, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { LuaTable, parseLua } from '../../web/library/gal/adapters/artemis-ast.mjs'
import { readPf8Index, pf8Decrypt } from '../../web/library/gal/pf8.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { astOf, buildPf8 } from './make-artemis-fixture.mjs'
import { buildExe } from './make-pe-fixture.mjs'
import { encodePng } from '../../web/library/gal/bgi.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const exists = (p) => stat(p).then(() => true, () => false)
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-artemis-'))

// ---- pf8 ----
{
  const entries = [{ name: 'script/a.ast', data: Buffer.from('astver = 2.0\n') }, { name: 'image/bg/bg01.png', data: Buffer.from('PNGDATA-bg01') }, { name: 'sound/vo/kae/v1.ogg', data: Buffer.alloc(100, 7) }, { name: 'empty.bin', data: Buffer.alloc(0) }]
  const file = path.join(work, 't.pfs')
  await writeFile(file, buildPf8(entries))
  const idx = await readPf8Index(file)
  const whole = await readFile(file)
  const plain = idx.entries.map((e) => pf8Decrypt(whole.subarray(e.offset, e.offset + e.size), idx.key))
  check('pf8：索引（名字 / 偏移 / 大小）+ key = SHA1(索引块)；逐字节 XOR 解密 = 原文', J(idx.entries.map((e) => e.name)) === J(['script\\a.ast', 'image\\bg\\bg01.png', 'sound\\vo\\kae\\v1.ogg', 'empty.bin']) && idx.key.length === 20 && plain.every((p, i) => p.equals(entries[i].data)), J(idx.entries))
  const bad = async (buf) => { const f = path.join(work, 'bad.pfs'); await writeFile(f, buf); return readPf8Index(f).then(() => '', (e) => e.message) }
  check('pf8：魔数不对 / 被截断（条目超出文件）/ 条目数对不上 → 抛错（不崩）', /魔数/.test(await bad(Buffer.from('xxx'.padEnd(40, 'x')))) && /超出文件/.test(await bad(whole.subarray(0, whole.length - 20))) && /对不上|不合理/.test(await bad(Buffer.concat([whole.subarray(0, 7), Buffer.from([0xff, 0xff, 0xff, 0x7f]), whole.subarray(11)]))))
}

// ---- Lua 表 ----
{
  const t = parseLua('-- c\nastver = 2.0\nx = { a=1, b="s\\"q\\n", {"cmd",k=-3,f=true}, [2]=5, nested={ {1,2},{3} }, }\n')
  const x = t.get('x')
  check('Lua 表：数字 / 字符串（转义）/ 布尔 / 负数 / 嵌套 / [键] / 注释；位置值进 list、键值进 map', t.get('astver') === 2 && x instanceof LuaTable && x.get('a') === 1 && x.get('b') === 's"q\n' && x.list[0].list[0] === 'cmd' && x.list[0].get('k') === -3 && x.list[0].get('f') === true && x.get(2) === 5 && x.get('nested').list[0].list.length === 2, J(x))
  const err = (s) => { try { parseLua(s); return '' } catch (e) { return e.message } }
  check('Lua 表：缺 } / 字符串没结束 / 顶层不是赋值 → 抛错（带行号）', /没有结束/.test(err('a = { 1,')) && /没有结束/.test(err('a = "x')) && /顶层/.test(err('12')))
}

// ---- 适配器 ----
const adapter = (await import('../../web/library/gal/adapters/artemis-ast.mjs'))
const blocks = [
  { cmds: [['savetitle', { text: 'T' }], ['bg', { file: 'bg01', path: ':bg/' }], ['bgm', { file: 'bgm01' }], ['fg', { mode: 2, ch: '花衣', file: 'kae_0', path: ':fg/', face: '通常Ａ', x: -280, lv: 3, id: 11 }], ['ex', { time: 1500, func: 'wait' }]], text: { name: ['花衣'], lines: ['「こんにちは」', '二行目'], vo: { file: 'v001', ch: 'kae' } } },
  { cmds: [['se', { id: 1, file: 'se01' }], ['bg', { file: 'ev_x_01', path: ':ev/ev_x/' }], ['fg', { mode: -2, sync: 0 }]], text: { lines: ['地の文'] } },
  { cmds: [['select', { file: 'scene_b', text: 'select' }], ['select', { file: 'scene_c', text: 'select' }], ['select', { name: 'flag', mode: 'sys' }]], select: ['行く', 'やめる'] },
  { cmds: [['bg', { file: 'black', path: ':bg/' }], ['bgm', { stop: 1, time: 500 }], ['excall', { file: 'next_scene' }]], text: null },
]
const ast = astOf(blocks)
const files = ['arc/res/image/bg/bg01.png', 'arc/res/image/ev/ev_x/ev_x_01.ogv', 'arc/res/image/fg/_blog/kae_0/通常Ａ.png', 'arc/res/sound/bgm/bgm01.ogg', 'arc/res/sound/se/se01.ogg', 'arc/res/sound/vo/kae/v001.ogg']
{
  const ctx = adapter.prepare({ options: {}, files, texts: {}, toResourcePath: (r) => r.replace(/^arc\/res\//, '') })
  check('适配器认领：sniff 认 astver = …；已注册；别的格式不认', adapter.sniff(ast) && galAdapterIds().includes('artemis::ast') && sniffGalAdapter(ast) === 'artemis::ast' && !adapter.sniff('{"format":"bgi-bs/1"}'))
  const scene = adapter.parse(ast, ctx)
  const st = scene.steps
  const ops = (i) => st[i].commands.map((c) => c.op)
  check('场景：开头一步 = bgm / bg / stand / wait / voice / speaker / text（命令按出现顺序，视觉变化在台词那一刻提交）；stand = _blog 图 + center + zoom（576 宽放大到 1920）+ shiftX（x × 1.5）', J(ops(0)) === J(['bgm', 'wait', 'bg', 'stand', 'voice', 'speaker', 'text']) && st[0].commands[0].src === 'sound/bgm/bgm01.ogg' && st[0].commands[1].seconds === 1.5 && st[0].commands[2].src === 'image/bg/bg01.png' && J(st[0].commands[3].parts) === J([{ src: 'image/fg/_blog/kae_0/通常Ａ.png', align: 'center', zoom: 3.3333, shiftX: -420 }]) && st[0].commands[4].src === 'sound/vo/kae/v001.ogg', J(st[0]))
  check('场景：text 里每行之间 rt2 → 换行；说话人 = name 的最后一项，没有 = 旁白（speaker 空）', J(st[0].commands.find((c) => c.op === 'text').segments) === J([{ text: '「こんにちは」\n二行目' }]) && J(st[0].commands.find((c) => c.op === 'speaker').segments) === J([{ text: '花衣' }]) && J(st[1].commands.find((c) => c.op === 'speaker').segments) === J([]))
  check('场景：fg mode=-2 → standOff；ev 图找不到 png 时按同名找 .ogv → movie（循环）；se', st[1].commands.some((c) => c.op === 'movie' && c.srcs[0] === 'image/ev/ev_x/ev_x_01.ogv' && c.loop === true) && st[1].commands.some((c) => c.op === 'standOff') && st[1].commands.some((c) => c.op === 'se' && c.src === 'sound/se/se01.ogg'), J(st[1]))
  const ch = st[1].commands.find((c) => c.op === 'choice')
  check('场景：select = choice（文字在 block.select.ja）挂在问题那句台词的步里（本例前一句是「地の文」）', Boolean(ch) && ch.options.length === 2 && J(ch.options.map((o) => o.segments[0].text)) === J(['行く', 'やめる']), J(st[1]))
  const gotos = st.flatMap((s) => s.commands).filter((c) => c.op === 'goto')
  check('场景：每个选项一个带 when（selN == 选项）的 goto { script }；name / mode=sys 的 select 不算选项', gotos.length === 2 && gotos[0].script === 'scene_b' && gotos[1].script === 'scene_c' && J(gotos[0].when) === J([{ var: ch.var, op: '==', value: 1 }]), J(gotos))
  check('场景：最后一个 block 的 excall = scene.next；bgm stop = bgmStop；black 找不到图 = 纯色背景', J(scene.next) === J({ script: 'next_scene' }) && st.flatMap((s) => s.commands).some((c) => c.op === 'bgmStop') && st.flatMap((s) => s.commands).some((c) => c.op === 'bg' && J(c.color) === J([0, 0, 0])), J(scene.next))
  check('场景：stats —— 台词 / 选择 / 语音 / 图 / 立绘；全部 block 都走到了；没有缺资源；ignored 里记 savetitle', scene.stats.messages === 2 && scene.stats.choices === 1 && scene.stats.voices.resolved === 1 && scene.stats.blocks.walked === 4 && Object.keys(scene.stats.unresolved).length === 0 && scene.stats.ignored.savetitle === 1, J(scene.stats))
  const partial = adapter.parse(ast, adapter.prepare({ options: {}, files: ['arc/res/image/bg/bg01.png'], toResourcePath: (r) => r.replace(/^arc\/res\//, '') }))
  check('缺资源：索引里没有的图 / 声音记进 stats.unresolved，场景照常出', partial.stats.unresolved['image:kae_0/通常Ａ'] === 1 && partial.stats.unresolved['voice:v001'] === 1 && partial.stats.unresolved['bgm:bgm01'] === 1 && partial.steps.length === st.length, J(partial.stats.unresolved))
}

// ---- 容器 + 整条链 ----
const media = path.join(work, 'game')
await mkdir(media, { recursive: true })
const iconPng = encodePng(256, 256, 4, Buffer.alloc(256 * 256 * 4, 200))
await writeFile(path.join(media, 'game.exe'), buildExe({ icons: [{ w: 256, h: 256, png: iconPng }] }))
await writeFile(path.join(media, 'unins000.exe'), buildExe({ icons: [{ w: 256, h: 256, png: encodePng(256, 256, 4, Buffer.alloc(256 * 256 * 4, 1)) }] }))   // 卸载程序：默认黑名单排除
await writeFile(path.join(media, 'game.pfs'), buildPf8([
  { name: 'script/s1.ast', data: Buffer.from(astOf(blocks.slice(0, 3))) },
  { name: 'script/s2.ast', data: Buffer.from(astOf([{ cmds: [], text: { name: ['B'], lines: ['second'] } }])) },
  { name: 'script/04_kae_01h.ast', data: Buffer.from(astOf([{ cmds: [], text: { lines: ['h scene'] } }])) },
  { name: 'script/folder/s3.ast', data: Buffer.from(astOf([{ cmds: [], text: { lines: ['nested'] } }])) },
  { name: 'system/adv/adv.lua', data: Buffer.from('-- lua') },
  { name: 'sound/bgm/bgm01.ogg', data: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(30, 3)]) },
  { name: 'sound/vo/kae/v001.ogg', data: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(30, 4)]) },
  { name: 'sound/se/se01.ogg', data: Buffer.concat([Buffer.from('OggS'), Buffer.alloc(30, 5)]) },
  { name: 'sound/vo/kae/v001.vol.csv', data: Buffer.from('1,2') },
]))
await writeFile(path.join(media, 'game.pfs.000'), buildPf8([
  { name: 'image/bg/bg01.png', data: Buffer.from('PNGDATA-bg01') },
  { name: 'image/fg/_blog/kae_0/通常Ａ.png', data: Buffer.from('PNGDATA-stand') },
  { name: 'image/ev/ev_x/ev_x_01.ogv', data: Buffer.from('OGV-DATA') },
]))
const layoutItem = { itemId: 'a', title: 'a', config: { game: { id: 'artemis::test' } }, source: { path: media }, adapters: ['artemis::ast'] }
const tagOut = await generateTags({ item: layoutItem, script: { id: 'gal-layout', version: '2.35.0', options: {} } })
const cfgRaw = tagOut.itemPatch.gal.config
const cfg = normalizeGalConfig(cfgRaw)
check('gal-layout：认出 artemis（id = artemis::test），containers = pf8 / flat / hybrid / artemis-ast / 扫根 / 规则 .pfs[.nnn]；脚本根 arc/script、资源根 arc/res；适配器 artemis::ast；写出 adapterOptions', cfg.containers.enabled && cfg.containers.format === 'pf8' && cfg.containers.flat === true && cfg.containers.mode === 'hybrid' && cfg.containers.scriptDecoder === 'artemis-ast' && cfg.containers.scriptExt === 'ast' && J(cfg.containers.scan) === J(['.']) && cfg.scriptRoots[0].dir === 'arc/script' && J(cfg.resourceRoots) === J(['arc/res']) && cfg.adapterOptions['artemis::ast']?.resDir === 'arc/res', J([cfg.containers, cfg.scriptRoots, cfg.resourceRoots]))
{
  const notPf8 = path.join(work, 'notpf8'); await mkdir(notPf8); await writeFile(path.join(notPf8, 'x.exe'), 'MZ'); await writeFile(path.join(notPf8, 'x.pfs'), 'pf6-something-else')
  const none = await generateTags({ item: { itemId: 'n', title: 'n', config: {}, source: { path: notPf8 } }, script: { id: 'gal-layout', version: '2.35.0', options: {} } })
  check('gal-layout：没声明 game.id 且 .pfs 魔数不是 pf8 → 不认领（不写 artemis 配置）', !JSON.stringify(none.itemPatch?.gal?.config || {}).includes('artemis'), J(none.itemPatch?.gal?.config?.game))
}
{
  const again = await generateTags({ item: { ...layoutItem, config: cfgRaw }, script: { id: 'gal-layout', version: '2.35.0', options: {} } })
  check('gal-layout：存进条目再跑一次 = 没有改动', /新增 0 项 \/ 修改 0 项 \/ 删除 0 项/.test(again.logs.join('\n')), again.logs.filter((l) => /本次改动/.test(l)).join(' | '))
}
{
  const report = await ensureContainers({ mediaDir: media, config: cfg })
  const rep = report.arcs
  const s1 = await readFile(path.join(media, 'arc/script/game/s1.ast'), 'utf8')
  check('展开：.ast 解密后展开到 arc/script/<pfs 名>/<脚本>.ast（保留子目录）；lua / csv 不展开；图 / 声音一个都没落盘', s1.startsWith('astver = 2.0') && (await exists(path.join(media, 'arc/script/game/folder/s3.ast'))) && !(await exists(path.join(media, 'arc/script/game/adv.lua'))) && !(await exists(path.join(media, 'arc/res'))) && Object.values(rep).every((r) => !r.error), J(rep))
  const vf = await virtualFiles({ mediaDir: media, config: cfg })
  check('虚拟索引（flat）：图 / 声音 / ogv 在 arc/res/<档案里的路径>；lua / csv / 脚本不在；两个 pfs 的条目都在', J([...vf.files].sort()) === J(['arc/res/image/bg/bg01.png', 'arc/res/image/ev/ev_x/ev_x_01.ogv', 'arc/res/image/fg/_blog/kae_0/通常Ａ.png', 'arc/res/sound/bgm/bgm01.ogg', 'arc/res/sound/se/se01.ogg', 'arc/res/sound/vo/kae/v001.ogg'].sort()), J(vf.files))
  const entry = await virtualEntry({ mediaDir: media, config: cfg, rels: ['arc/res/image/bg/bg01.png'] })
  check('virtualEntry.read()：不落盘就给出解密后的内容', (await entry.read()).toString() === 'PNGDATA-bg01' && !(await exists(path.join(media, 'arc/res'))))
  const n = await materialize({ mediaDir: media, config: cfg, rels: ['arc/res/sound/bgm/bgm01.ogg'] })
  check('取出（materialize）：解密后的内容（OggS 开头）', n === 1 && (await readFile(path.join(media, 'arc/res/sound/bgm/bgm01.ogg'))).subarray(0, 4).toString() === 'OggS')
}
{
  const dataDir = path.join(work, 'data')
  const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => exists(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: media, adapters: ['artemis::ast'] } } }) })
  const imported = await handler.importFromSource({ options: { adapters: ['artemis::ast'], config: { game: { id: 'artemis::test' } } } })
  const item = imported.items[0]
  const out = await generateTags({ item, script: { id: 'gal-layout', version: '2.35.0', options: {} } })
  await handler.internals.updateItem(item.itemId, (it) => ({ ...it, config: { ...it.config, ...out.itemPatch.gal.config } }))
  const id = item.itemId
  const home = (await handler.getReaderContent(id, 'main', { sectionId: '' })).node
  check('列表：首页能列出脚本 / 目录卡片，没有 error 级 problems', home.items.length > 0 && !home.problems?.some((p) => p.level === 'error'), J(home))
  const find = async (node, title) => {
    const page = (await handler.getReaderContent(id, 'main', { sectionId: node })).node
    for (const it of page.items || []) { if (it.title === title) return it; if (it.kind === 'dir' || it.node) { const hit = await find(it.node || it.id, title).catch(() => null); if (hit) return hit } }
    return null
  }
  const special = home.items.find((i) => i.title === '特殊场景')
  const specialList = special ? (await handler.getReaderContent(id, 'main', { sectionId: special.node || special.id })).node.items.map((i) => i.title) : []
  check('首页：虚拟目录「特殊场景」收脚本名以 数字 + h 结尾的（04_kae_01h），别的不收', J(specialList) === J(['04_kae_01h']), J([home.items.map((i) => i.title), specialList]))
  check('封面：没有别的封面 → exe:game.exe（unins000.exe 被默认黑名单排除，虽然也有图标）', handler && (await handler.getReaderContent(id, 'main', { sectionId: '' })) && JSON.stringify(out.itemPatch.gal.config.cover) === '"exe:game.exe"', J(out.itemPatch.gal.config.cover))
  const thumb = await handler.getThumbnail(id)
  check('取封面：从 exe 资源里提取的图标（PNG 字节原样），第二次走缓存目录 gal-exe-icons', thumb.contentType === 'image/png' && thumb.body.equals(iconPng) && (await readdir(path.join(dataDir, 'cache', 'gal-exe-icons')).catch(() => [])).length === 1, J([thumb.contentType, thumb.body?.length]))
  const s1 = await find('', 's1')
  check('目录：能找到脚本 s1', Boolean(s1), J(home.items.map((i) => i.title)))
  const play = await handler.getReaderContent(id, 'main', { sectionId: s1.node || s1.id })
  check('播放：scene 来自适配器 artemis::ast；选项 goto 补上了 node（s2 不在，scene_b 找不到 = 不补）', play.node.kind === 'player' && play.scene.adapter === 'artemis::ast' && play.scene.steps.length >= 3, J([play.node?.kind, play.scene?.adapter]))
  const bg = play.scene.steps[0].commands.find((c) => c.op === 'bg')
  const res = await handler.getResource(id, bg.src)
  const cacheFiles = (await readdir(path.join(dataDir, 'cache', 'gal-arc-res'), { recursive: true }).catch(() => [])).filter((f) => /\.png$/i.test(f))
  check('取资源：背景 = 解密后的 PNG 字节，放进缓存目录 gal-arc-res（媒体目录 arc/res 下没有这张）', (res.body ? res.body : await readFile(res.file)).toString() === 'PNGDATA-bg01' && cacheFiles.length >= 1 && !(await exists(path.join(media, 'arc/res/image/bg/bg01.png'))), J(cacheFiles))
  const stand = play.scene.steps[0].commands.find((c) => c.op === 'stand')
  check('取资源：立绘（_blog，路径含全角字符）能取到', Boolean(stand) && (await handler.getResource(id, stand.parts[0].src)).body.toString() === 'PNGDATA-stand', J(stand))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
