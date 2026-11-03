#!/usr/bin/env node
// Unity GameMaterial（Calcite『気になるあの娘はえろちゅーばー！』）：data.dsm 解密 / 切章节 + .psm → PNG + unity::dsm 适配器（选项 / 汇合 / 条件跳转 / 立绘位置 / 说话人颜色）+ containers + gal-layout 识别。纯 node；
//   真实样本（可选）：DSM_SAMPLE=<GameMaterial 目录（里面有 data.dsm）> 时额外把真实脚本整份解密 + 切章节 + 解析一遍
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import * as adapter from '../../web/library/gal/adapters/unity-dsm.mjs'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { ensureContainers, materialize, virtualFiles } from '../../web/library/gal/containers.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'
import { decryptDsm, encryptDsm, isPsm, psmToPng, splitDsm } from '../../web/library/gal/unity-dsm.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = JSON.stringify

// ---- 夹具脚本（和真实 data.dsm 同样的写法：智能引号 g=“名" / 只有开头引号的 f="Yume001 / 重复的 f / SQ + link / [if]+[jump]）----
const SCRIPT = `
*start
;//注释
[eval exp="Cha1flg = 0"]

*Ep000
;//|序章
[FO layer="A"]
[BG g="black"]
[wait time=100]
[OnMes]
[plbgm bg="bg_se"]
旁白第一行
旁白第二行
[cpg]
[BG g="b_01" rule="ue"]
[FG f="CHA01_p3_00" f="1" pos="L"]
[pv f="Yume001]
[OnName num="ゆめ"]
「こんにちは」
[cpg cn=true]
[FG g=“CHA01_p3_00" f=1 pos=R]
[ps se=se001]
右の人
[cpg1]
[SQ]
[link target="*pick_1"]
左
[link target="*pick_2"]
右
[s]

１、左
２、右

*pick_1
左を選んだ。
[cpg]
[eval exp="Cha1flg += 1"]
[jump target="*pick_3"]

*pick_2
右を選んだ。
[cpg]
[jump target="*pick_3"]

*pick_3
合流した。
[cpg]
[if exp="Cha1flg == 3"]
[jump target="*cha1_ex"]
[endif]
[jump target="*cha1_end"]

*cha1_ex
特殊ルート。
[cpg]

*cha1_end
[end]
[s]

*Ep001
[stbgm]
次の章。
[cpg]
`

const text = decryptDsm(encryptDsm(SCRIPT))
check('data.dsm 加解密：PBKDF2-SHA1(pass, 盐, 1000) → 48 字节 → AES-256-CBC，来回一致（BOM + base64）', text === SCRIPT && encryptDsm(SCRIPT).startsWith('﻿'))
let bad = ''
try { decryptDsm('hello world!') } catch (error) { bad = error.message }
check('不是 base64 / 密文长度不对 → 报错而不是乱码', /base64/.test(bad), bad)
check('解密：密码不对 → 报错', (() => { try { decryptDsm(encryptDsm(SCRIPT), 'wrong'); return false } catch { return true } })())

const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const psm = Buffer.from(png1); psm[0] = 0xed
check('.psm：首字节 0xED → 0x89 就是 PNG；不是 .psm 报错', isPsm(psm) && psmToPng(psm).equals(png1) && (() => { try { psmToPng(Buffer.from('hello world')); return false } catch { return true } })())

// ---- 切章节 ----
const chunks = splitDsm(text)
check('切章节：*Ep000 / *chaN_ex / *chaN_end / *Ep001 各一段（前言并进第一段），段名 = <序号>_<标签>，每段第一行 ;//@dsm 头', J(chunks.map((c) => c.name)) === J(['00_Ep000', '01_cha1_ex', '02_cha1_end', '03_Ep001']) && chunks.every((c) => c.text.startsWith(';//@dsm {')) && chunks[0].text.includes('*start'), J(chunks.map((c) => c.name)))
const head0 = JSON.parse(chunks[0].text.split('\n')[0].slice(';//@dsm '.length))
check('段头：next = 下一段；labels = 本段引用、在别段的标签 → 段名（cha1_ex / cha1_end）', head0.next === '01_cha1_ex' && head0.labels.cha1_ex === '01_cha1_ex' && head0.labels.cha1_end === '02_cha1_end', J(head0))

// ---- 词法 ----
const attrs = adapter.parseAttrs(' f="CHA01_p3_00" f="1" pos="L"')
check('属性：重复的 f 都留着；智能引号 g=“名" / 只有开头引号 f="Yume001 / 无引号', J(attrs) === J([['f', 'CHA01_p3_00'], ['f', '1'], ['pos', 'L']]) && J(adapter.parseAttrs(' g=“CHA01_p3_02" f=4 pos=C')) === J([['g', 'CHA01_p3_02'], ['f', '4'], ['pos', 'C']]) && J(adapter.parseAttrs(' f="Yume001')) === J([['f', 'Yume001']]), J(attrs))

// ---- 适配器（带资源索引）----
const files = ['b_01.png', 'CHA01_p3_00_a_1.png', 'voice/Yume001.ogg', 'sound/bg_se.ogg', 'se/se001.ogg']   // 资源路径（相对资源根：arc/res / GameMaterial）
const ctx = adapter.prepare({ options: {}, files })
const run = (chunk, c = ctx) => buildScene('unity::dsm', chunk.text, c, { options: {} })
const scene = run(chunks[0])
const all = scene.steps.flatMap((s) => s.commands)
const stand = all.filter((c) => c.op === 'stand' && !c.when).slice(0, 2)   // 选项汇合后会再发一遍（分支各自重置了画面）
check('嗅探：只认 ;//@dsm 头；加密的原文件 / 别的文本不认', adapter.sniff(chunks[0].text) && !adapter.sniff(encryptDsm(SCRIPT)) && !adapter.sniff('*start\n[cpg]') && !adapter.sniff('{"format":"rscript-gsc/1"}'))
check('文字：一页多行 = 一步（换行连接）；[OnName] 只管这一页；说话人颜色（ゆめ = #ffde00）；[pv] → voice/Yume001.ogg', scene.steps[0].commands.some((c) => c.op === 'text' && c.segments[0]?.text === '旁白第一行\n旁白第二行') && all.some((c) => c.op === 'speaker' && c.segments[0]?.text === 'ゆめ' && c.segments[0].style?.color === '#ffde00') && all.some((c) => c.op === 'voice' && c.src === 'voice/Yume001.ogg') && !scene.steps.find((s) => s.commands.some((c) => c.op === 'text' && c.segments[0]?.text === '右の人')).commands.some((c) => c.op === 'speaker' && c.segments.length), J(scene.steps.slice(0, 3)))
check('背景：black = 纯色；带 rule 的 BG = 淡入淡出；bgm = sound/bg_se.ogg；se = se/se001.ogg', all.some((c) => c.op === 'bg' && c.color && c.color[0] === 0) && all.some((c) => c.op === 'bg' && c.src === 'b_01.png' && c.fade > 0) && all.some((c) => c.op === 'bgm' && c.src === 'sound/bg_se.ogg') && all.some((c) => c.op === 'se' && c.src === 'se/se001.ogg'))
check('立绘：两种写法（f + f / g + f）都找到 CHA01_p3_00_a_1.png；L = −420 + (−50) = −470，R = 420 + 50 = 470（Sprite2DTestScript.ShowFGImage + system/StandPos）；stage 1920×1080', stand.length === 2 && stand[0].slot === 'L' && stand[0].parts[0].x === -470 && stand[1].slot === 'R' && stand[1].parts[0].x === 470 && stand[0].parts[0].src === 'CHA01_p3_00_a_1.png' && J(stand[0].stage) === J([1920, 1080]), J(stand))
const choice = all.find((c) => c.op === 'choice')
check('选项：[SQ] + [link] 文字 → choice，选项文字取 link 后面的行', choice?.options.length === 2 && choice.options[0].segments[0].text === '左' && choice.options[1].segments[0].text === '右', J(choice))
const textsOf = (when) => all.filter((c) => c.op === 'text' && c.when && c.when[0]?.value === when).map((c) => c.segments[0]?.text).filter(Boolean)
const merge = scene.steps.map((s) => s.commands).flat().filter((c) => c.op === 'text' && !c.when).map((c) => c.segments[0]?.text).filter(Boolean)
check('分支：每个选项一段带 when 的内容，汇合点之后只有一份（无 when）；分支结尾的 [jump] 不进输出；[eval] 不影响', J(textsOf(1)) === J(['左を選んだ。']) && J(textsOf(2)) === J(['右を選んだ。']) && merge.filter((t) => t === '合流した。').length === 1 && !JSON.stringify(scene.steps).includes('Cha1flg'), J([textsOf(1), textsOf(2), merge]))
check('条件跳转 [if][jump *cha1_ex]：不跟（特殊路线单独成段）；之后的无条件 [jump *cha1_end] = 去别的段（scene.next）；特殊路线的文字不在主线里', scene.next?.script === '02_cha1_end' && !JSON.stringify(scene).includes('特殊ルート') && scene.stats.links['if-jump:Cha1flg == 3'] === 1, J([scene.next, scene.stats.links]))
const ex = run(chunks[1])
const end = run(chunks[2])
check('特殊路线段：自己的文字 + 顺着读下一段（next = 02_cha1_end）；结局段只有 [end] = 空的一步、没有 next', JSON.stringify(ex).includes('特殊ルート') && ex.next?.script === '02_cha1_end' && end.steps.length === 1 && !end.next, J([ex.next, end]))
const last = run(chunks[3])
check('最后一段没有 next；[stbgm] → bgmStop', !last.next && last.steps[0].commands.some((c) => c.op === 'bgmStop'), J(last))
const noIndex = run(chunks[0], adapter.prepare({ options: {}, files: [] }))
check('没有资源索引：不报缺资源、文字照出', Object.keys(noIndex.stats.unresolved).length === 0 && noIndex.stats.messages > 0)
const miss = run(chunks[0], adapter.prepare({ options: {}, files: ['unrelated.txt'] }))
check('有索引但没有这些资源：缺的图 / 声音都记进 unresolved', miss.stats.images.unresolved >= 2 && miss.stats.voices.unresolved === 1 && Object.keys(miss.stats.unresolved).some((k) => k.startsWith('image:')), J(miss.stats))

// 跨段选项：goto
const cross = `;//@dsm ${J({ id: '00_A', next: '01_B', labels: { b1: '01_B', b2: '02_C' } })}\n[SQ]\n[link target="*b1"]\n甲\n[link target="*b2"]\n乙\n[s]\n`
const crossScene = run({ text: cross })
check('跨段选项：目标标签在别的段 = 带 when 的 goto <段名>；选项之后不顺着读（没有 next）', crossScene.steps.flatMap((s) => s.commands).filter((c) => c.op === 'goto').map((c) => `${c.script}@${c.when[0].value}`).join() === '01_B@1,02_C@2' && !crossScene.next, J(crossScene))

// ---- containers + gal-layout ----
const work = await mkdtemp(path.join(os.tmpdir(), 'dsm-'))
try {
  const root = path.join(work, 'Cake', 'GameMaterial')
  for (const dir of ['bgimage', 'fgimage', 'voice', 'sound', 'se', 'system']) await mkdir(path.join(root, dir), { recursive: true })
  await writeFile(path.join(root, 'data.dsm'), encryptDsm(SCRIPT))
  await writeFile(path.join(root, 'env.cof'), 'x')
  await writeFile(path.join(root, 'bgimage', 'b_01.psm'), psm)
  await writeFile(path.join(root, 'fgimage', 'CHA01_p3_00_a_1.psm'), psm)
  await writeFile(path.join(root, 'voice', 'Yume001.ogg'), 'OggS')
  await writeFile(path.join(root, 'sound', 'bg_se.ogg'), 'OggS')
  await writeFile(path.join(root, 'se', 'se001.ogg'), 'OggS')
  const layoutItem = { itemId: 'u', title: 'u', config: {}, source: { path: work }, adapters: ['unity::dsm'] }
  const tagOut = await generateTags({ item: layoutItem, script: { id: 'gal-layout', version: '2.35.0', options: {} } })
  const cfgRaw = tagOut.itemPatch?.gal?.config
  const norm = cfgRaw ? normalizeGalConfigWithWarnings(cfgRaw) : null
  const c = norm?.config
  check('gal-layout：认出 Unity GameMaterial（data.dsm 是 base64 + env.cof），id = unity::cake，containers = dsm / hybrid / flat；写出来的 config 规整后零警告', Boolean(c) && c.game.id === 'unity::cake' && c.containers.format === 'dsm' && c.containers.mode === 'hybrid' && c.containers.flat === true && c.containers.scriptDecoder === 'unity-dsm' && norm.warnings.length === 0, J([tagOut.logs, norm?.warnings, c?.containers]))
  check('gal-layout：资源根 = arc/res（虚拟索引，磁盘上还没有也要写）+ base（voice / sound / se 的普通文件）；以前只写了 base，.psm 转出来的图一张都解析不到', J(c?.resourceRoots) === J(['Cake/GameMaterial/arc/res', 'Cake/GameMaterial']), J(c?.resourceRoots))
  check('gal-layout：适配器参数里的路径带上 base（Cake/GameMaterial/arc/res、…/voice）；资源根 = arc/res + base', J(c?.adapterOptions?.['unity::dsm']?.mediaDirs) === J(['Cake/GameMaterial/voice', 'Cake/GameMaterial/sound', 'Cake/GameMaterial/se']) && c.adapterOptions['unity::dsm'].resDir === 'Cake/GameMaterial/arc/res', J(c?.adapterOptions))
  const media = work
  const report = await ensureContainers({ mediaDir: media, config: c })
  const rep = report.arcs['Cake/GameMaterial/data.dsm']
  check('展开：data.dsm 解密 → 4 段脚本写到 arc/script/data/；.psm 不展开（只进虚拟索引）', rep?.scripts === 4 && !rep.error && (await readFile(path.join(root, 'arc/script/data/00_Ep000.dsm'), 'utf8')).includes('*Ep000') && report.arcs['Cake/GameMaterial/bgimage/b_01.psm']?.res === 1, J(report))
  const vf = await virtualFiles({ mediaDir: media, config: c })
  check('虚拟索引：每个 .psm 一个 .png（flat：arc/res/<名>.png，不带目录）', J([...vf.files].sort()) === J(['Cake/GameMaterial/arc/res/CHA01_p3_00_a_1.png', 'Cake/GameMaterial/arc/res/b_01.png']), J(vf.files))
  const n = await materialize({ mediaDir: media, config: c, rels: ['Cake/GameMaterial/arc/res/b_01.png'] })
  check('取资源：把首字节改回 0x89 = 合法 PNG', n === 1 && (await readFile(path.join(root, 'arc/res/b_01.png'))).equals(png1))
  const again = await ensureContainers({ mediaDir: media, config: c })
  check('再跑一遍：容器没变 = 命中缓存、不重复展开', again.arcs['Cake/GameMaterial/data.dsm']?.cached === true)

  const notB64 = path.join(work, 'Plain', 'GameMaterial')
  await mkdir(path.join(notB64, 'bgimage'), { recursive: true })
  await writeFile(path.join(notB64, 'data.dsm'), '这不是 base64 \u0000\u0001'.repeat(10))
  await writeFile(path.join(notB64, 'env.cof'), 'x')
  const none = await generateTags({ item: { ...layoutItem, config: { game: { id: 'unity::x' } }, source: { path: path.join(work, 'Plain') } }, script: { id: 'gal-layout', version: '2.35.0', options: {} } })
  check('gal-layout：data.dsm 不是 base64 文本 = 不认', !none.itemPatch?.gal?.config?.containers, J(none.logs))

  // 真实样本
  const sample = process.env.DSM_SAMPLE
  if (sample) {
    const real = decryptDsm(await readFile(path.join(sample, 'data.dsm')))
    const parts = splitDsm(real)
    let messages = 0
    let chosen = 0
    for (const part of parts) { const s = buildScene('unity::dsm', part.text, adapter.prepare({ options: {}, files: [] }), { options: {} }); messages += s.stats.messages; chosen += s.stats.choices }
    check(`真实样本：data.dsm 解密 + 切成 ${parts.length} 段 + 全部解析（${messages} 页台词、${chosen} 个选项）`, parts.length >= 10 && messages > 5000 && chosen === 4, J([parts.length, messages, chosen]))
  } else console.log('SKIP 真实样本（DSM_SAMPLE=<GameMaterial 目录> 才跑）')
} finally { await rm(work, { recursive: true, force: true }) }

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
