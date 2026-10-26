#!/usr/bin/env node
// 自测（不需要浏览器）：ぼくらの放課後戦争（bokusen-json，编译脚本 JSON）——适配器（交叉淡入背景 / 数字层立绘 + move / 多帧动画 / playse 下标 → .wav /
// 【说话人】「台词」拆分）、资源缺失和 JSON 解析失败都不炸、gal-layout 探测、导入 → 列表 → 取场景 → 取资源（走真实的 handler + 文件索引）。
//   node scripts/dev/fe-gal-bokusen-selftest.mjs
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { galAdapter, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { parse, prepare, sniff } from '../../web/library/gal/adapters/bokusen-json.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { generateTags as galLayoutScript } from '../../scripts/tag-scripts/gal-layout/main.js'
import { SCRIPT_1001, buildBokusenFixture, compileBokusen } from './make-bokusen-fixture.mjs'
import { readFile } from 'node:fs/promises'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

const work = await mkdtemp(path.join(os.tmpdir(), 'fe-bokusen-'))
const root = path.join(work, 'ぼくらの放課後戦争演示')
await buildBokusenFixture(root)
const STEM = '1001 テスト－初H'
const text1001 = await readFile(path.join(root, 'json', `${STEM}.json`), 'utf8')
const cmdsOf = (out) => out.steps.flatMap((st) => st.commands)

try {
  // ---------- sniff / 登记 ----------
  check('sniff：认 {"data":{"code":{ 开头（BOM / 截断的文件也认），不认别的 JSON / 文本；对非 JSON、null、数字都不抛', sniff(text1001) && sniff(text1001.slice(0, 120)) && !sniff('{"data":{"x":1}}') && !sniff('{"bgms":[],"chara_keys":{}}') && !sniff('bg,a.jpg') && !sniff('') && !sniff(null) && !sniff(42), '')
  check('适配器登记，sniffGalAdapter 认得', galAdapter('bokusen-json').id === 'bokusen-json' && sniffGalAdapter(text1001) === 'bokusen-json', sniffGalAdapter(text1001))

  // ---------- 用真实的文件索引（context.mjs）解析 1001 ----------
  const config = normalizeGalConfig({ resourceRoots: ['resource'], adapterOptions: { 'bokusen-json': { root: '', resourceDir: 'resource' } } })
  const adapter = galAdapter('bokusen-json')
  const ctx = await loadAdapterContext({ adapter, mediaDir: root, config })
  check('文件索引：resource/<脚本名>/images|sounds 里的文件按资源根（resource）去前缀收进来', ctx.hasIndex && ctx.resources.has(`${STEM}/images/0.jpg`) && ctx.resources.has(`${STEM}/sounds/3.wav`) && !ctx.resources.has(`${STEM}/images/6.png`), J([...ctx.resources].slice(0, 4)))
  const out = parse(text1001, ctx, { stem: STEM })
  const cmds = cmdsOf(out)
  const res = (kind, n, ext) => `${STEM}/${kind}/${n}.${ext}`

  // 开场：base fore → 立刻显示，base back + trans cross 1000ms → 带 fade 1 的 bg
  const bgs = cmds.filter((c) => c.op === 'bg')
  check('开场背景：image base/fore 0 → bg（fade 0）；image base/back 1 + trans cross 1000 → bg（fade 1）', bgs[0]?.src === res('images', 0, 'jpg') && bgs[0].fade === 0 && bgs[1]?.src === res('images', 1, 'jpg') && bgs[1].fade === 1, J(bgs))
  check('bgm：playbgm 取 sounds 里路径带 /bgm/ 的那个（.m4a 在磁盘上是 .wav）；fadeoutbgm 1000 → bgmStop fade 1', cmds[0]?.op === 'bgm' && cmds[0].src === res('sounds', 0, 'wav') && cmds.some((c) => c.op === 'bgmStop' && c.fade === 1), J(cmds[0]))

  // 数字层：stand（x 偏移）+ move（终点）；opacity 0 去掉
  const stands = cmds.filter((c) => c.op === 'stand')
  check('数字层图 → stand（x 240 / y -10）；move (0 -10 255) → 同一层移到 x 0', stands[0]?.parts[0]?.src === res('images', 2, 'png') && stands[0].parts[0].x === 240 && stands[0].parts[0].y === -10 && stands[1]?.parts[0]?.x === 0, J(stands.slice(0, 2)))
  check('单帧 animstart 在数字层 3：显示 3 号图（x 145），和层 0 叠放；animstop 去掉；trans 提交层 0 的 back 图；move 不透明度 0 → standOff', stands.some((s) => s.parts.length === 2 && s.parts[1].x === 145 && s.parts[1].src === res('images', 3, 'png')) && stands.some((s) => s.parts.length === 1 && s.parts[0].src === res('images', 3, 'png')) && cmds.some((c) => c.op === 'standOff'), J(stands))

  // 多帧动画（base 层）→ bg + frames；缺的帧记 unresolved
  const anim = bgs.find((c) => c.frames)
  check('animstart base 层 3 帧（4 5 6）→ bg + frames，和 Aku 的帧动画一样；磁盘上没有的 6.png 跳过并记 unresolved', anim?.frames?.length === 2 && anim.src === res('images', 4, 'png') && out.stats.unresolved['anim-missing:1'] === 1, J([anim, out.stats.unresolved]))

  // 声音
  check('playse 下标 → sounds/<i>.wav：路径带 /voice/ → voice，其它 → se', cmds.some((c) => c.op === 'voice' && c.src === res('sounds', 1, 'wav')) && cmds.some((c) => c.op === 'se' && c.src === res('sounds', 2, 'wav')), J(cmds.filter((c) => c.op === 'voice' || c.op === 'se')))
  check('循环的 playse → bgse loop；stopse 同声道 → bgseStop；wait 500 → wait 0.5', cmds.some((c) => c.op === 'bgse' && c.loop === true && c.src === res('sounds', 3, 'wav')) && cmds.some((c) => c.op === 'bgseStop') && cmds.some((c) => c.op === 'wait' && c.seconds === 0.5), '')

  // 台词拆分
  const dialogue = out.steps.map((st) => ({ speaker: st.commands.find((c) => c.op === 'speaker')?.segments[0]?.text ?? null, text: st.commands.find((c) => c.op === 'text')?.segments[0]?.text }))
  check('【小春】标题行 → speaker 小春，「こんにちは」是台词（不含标题行）；cm 之后说话人清空', dialogue[0].text === 'ナレーション。' && dialogue[1].speaker === '小春' && dialogue[1].text === '「こんにちは」' && out.steps[2].commands.find((c) => c.op === 'speaker')?.segments.length === 0, J(dialogue))
  check('一页里中途出现【李】：先把前面的地の文出成一步，再换说话人', dialogue[3].text === '地の文' && dialogue[4].speaker === '李' && dialogue[4].text === '「やあ」', J(dialogue))
  check('结尾没有 p 的最后一句也会出（最后一步）', dialogue.at(-1).text === '最後の一行' && out.steps.every((st, i) => st.index === i), J(dialogue.at(-1)))

  // 未知 / 非法：不炸
  check('下标越界的 image、没见过的标签 → 不炸，记 stats.raw（image 带 raw 指令）', out.stats.raw.image === 1 && out.stats.raw['tag:mystery'] === 1 && cmds.some((c) => c.op === 'raw' && c.cmd === 'image'), J(out.stats))

  // 标签表是每个文件自己的：打乱顺序照样解析
  const reordered = compileBokusen({ images: ['a.jpg'], sounds: [], articles: ['【甲】', '「乙」'], script: [['p'], ['image', { 15: 'base', 23: 'fore', 28: 0 }], ['articles', { 0: 0 }], ['articles', { 0: 1 }], ['p']] })
  reordered.data.code.tags.reverse(); reordered.data.code.commands.forEach((c) => { c[0] = reordered.data.code.tags.length - 1 - c[0] })
  const re = parse(J(reordered), null, { stem: 'x' })
  check('标签下标不固定：标签表倒过来排，仍按 tags[下标] 取名字；没有文件索引时按约定拼路径', cmdsOf(re).some((c) => c.op === 'bg' && c.src === 'x/images/0.jpg') && cmdsOf(re).some((c) => c.op === 'text' && c.segments[0].text === '「乙」'), J(re.steps))

  // ---------- 资源缺失 / 解析失败 ----------
  const lacking = parse(await readFile(path.join(root, 'json', '1002 リソースなし.json'), 'utf8'), ctx, { stem: '1002 リソースなし' })
  check('没有资源目录的脚本（1002）：图 / 声音记 unresolved，台词照常出，不炸', Object.keys(lacking.stats.unresolved).length === 2 && !cmdsOf(lacking).some((c) => c.op === 'bg' || c.op === 'se') && lacking.steps.length === 1 && cmdsOf(lacking).some((c) => c.op === 'text' && c.segments[0].text === '「やあ」'), J(lacking))
  let error = ''
  try { parse(await readFile(path.join(root, 'json', '1003 壊れた.json'), 'utf8'), ctx, { stem: '1003' }) } catch (e) { error = e.message }
  check('被截断的 JSON：parse 抛一个明确的 Error（列表页当「解析失败」列出），sniff 不抛', /JSON/.test(error) && sniff(text1001.slice(0, 120)), error)
  let shape = ''
  try { parse('{"data":{"code":{"images":[]}}}', null, {}) } catch (e) { shape = e.message }
  check('形状不对（缺 tags / parameters / commands）：明确的错，不是 TypeError', /data\.code/.test(shape), shape)
  check('没有 ctx 也不炸（ctx = null，按约定拼路径）', parse(text1001, null, { stem: STEM }).steps.length === out.steps.length, '')

  // ---------- gal-layout：没写 game.id 也认出 bokusen ----------
  const layout = await galLayoutScript({ item: { itemId: 'bk', title: 'bk', config: {}, source: { path: root }, adapters: ['bokusen-json'] }, script: { id: 'gal-layout', version: '2.9.0', options: {} } })
  const cfg = layout.itemPatch?.gal?.config
  check('gal-layout 认出 bokusen：game.id、脚本根 json、资源根 resource、扩展名 json、适配器参数、脚本数 3', cfg?.game?.id === 'bokusen' && cfg.scriptRoots?.[0]?.dir === 'json' && J(cfg.resourceRoots) === J(['resource']) && J(cfg.scriptExtensions) === J(['json']) && cfg.adapterOptions?.['bokusen-json']?.resourceDir === 'resource' && cfg.scriptCount === 3, J(cfg))
  const other = await galLayoutScript({ item: { itemId: 'no', title: 'no', config: {}, source: { path: path.join(work, 'empty') }, adapters: [] }, script: { id: 'gal-layout', version: '2.9.0', options: {} } })
  check('gal-layout 不会把别的目录认成 bokusen（不存在的目录 → 不认领）', other.itemPatch?.gal?.config?.game?.id !== 'bokusen', J(other.logs))

  // ---------- 真实 handler：导入 → 列表 → 取场景 → 取资源 ----------
  const handler = createGalHandler({ dataDir: path.join(work, 'data'), safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) })
  const imported = await handler.importFromSource({ sourcePath: root, options: { adapters: ['bokusen-json'], config: { ...cfg, game: { id: 'bokusen', title: 'bokusen' } } } })
  const itemId = imported.items[0].itemId
  const node = async (sectionId) => (await handler.getReaderContent(itemId, 'main', { sectionId })).node
  const home = await node('')
  const titles = (home.items || []).map((x) => x.title)
  check('列表：标题 = 文件名（stem）；被截断的 JSON 也列出来（嗅探只看开头）', titles.includes(STEM) && titles.includes('1002 リソースなし') && titles.includes('1003 壊れた'), J(titles))
  const card = home.items.find((x) => x.title === STEM)
  const played = await handler.getReaderContent(itemId, 'main', { sectionId: card.node })
  const scene = played.scene || played.node?.scene
  check('播放页：取到 gal-scene/1，adapter bokusen-json，背景 src 能被资源接口取到（resource/<脚本名>/images/0.jpg）', scene?.adapter === 'bokusen-json' && scene.steps.length === out.steps.length, J(Object.keys(played)))
  const bg0 = scene.steps.flatMap((s) => s.commands).find((c) => c.op === 'bg')
  const png = await handler.getResource(itemId, bg0.src).catch((e) => e)
  check('资源接口：bg src → 图片字节（PNG 文件头）', png?.body?.subarray?.(1, 4).toString() === 'PNG', String(png?.message || bg0.src))
  const wav = await handler.getResource(itemId, res('sounds', 1, 'wav')).catch((e) => e)
  check('资源接口：sounds/<i>.wav → 音频字节（RIFF）', wav?.body?.subarray?.(0, 4).toString() === 'RIFF', String(wav?.message))
  const broken = home.items.find((x) => x.title === '1003 壊れた')
  const brokenRes = await handler.getReaderContent(itemId, 'main', { sectionId: broken.node }).then(() => '', (e) => e.message)
  check('打开解析失败的脚本：明确的错误，不是服务崩溃', brokenRes !== '', 'resolved without error')
} finally { await rm(work, { recursive: true, force: true }) }

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
