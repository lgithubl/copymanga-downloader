#!/usr/bin/env node
// ArcRecord_D（幻想天街）：Dialog.txt 按 DramaID 切段（含重复 id / 坏字节）+ Text/<语言>.txt + arcrecord::dialog 适配器（背景 / BGM / 音效 / 语音 / 说话人 / 标记）+ containers 展开 + gal-layout 识别。纯 node。
//   真实样本（可选）：ARC_SAMPLE=<含 StaticData 的目录（…/Game）> 时再把真实表整份切段 + 解析一遍
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import * as adapter from '../../web/library/gal/adapters/arcrecord-dialog.mjs'
import { buildDramas, parseTable, parseText } from '../../web/library/gal/arcrecord-dialog.mjs'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { ensureContainers } from '../../web/library/gal/containers.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = JSON.stringify

const HEADER = 'ID@DramaID@Role1@RoleMotion1@TalkSound@Sound@Music@DialogBGPerfab@Speaker@Dialog@Scene'
const rows = [
  'a_01@E1_01@Hero/H047/H047_Dialog@talkdown@@@Sound/BGM/Stage03@BG/BG_Black@T_Sp_a@T_Dia_a1@T_Scene_a',
  'a_02@@@@Hero/H047/Sound/H047_V1@Sound/Dialog/Effect_Dialog@@BG/A0019_Dialog@T_Sp_player@T_Dia_a2@',
  'a_03@@@@@Sound/Dialog/Boom@Sound/BGM/Blank@BG/S0061_Dialog@T_Sp_a@T_Dia_a3@',
  'a_04@@@@@@@CG/A0069/A0069@@T_Dia_a4@',
  'b_01@E1_01@@@@@@@T_Sp_a@T_Dia_b1@',        // DramaID 重复：第二段
  'c_01@E1_02@@@@@@@@T_Dia_c1�@',          // 坏字节（游戏自己的数据）
].join('\r\n')
const dialogTxt = Buffer.from(`${HEADER}\r\n${rows}\r\n`)
const jpn = Buffer.from('Key@Value\r\nT_Sp_a@エパディ\r\nT_Sp_player@player\r\nT_Dia_a1@こんにちは<br>二行目\r\nT_Dia_a2@{0}さん、<color=#ff0000>赤い</color><size=60>大きい</size>字\r\nT_Dia_a3@ばくはつ\r\nT_Dia_a4@CG の台詞\r\nT_Dia_b1@別の段\r\nT_Dia_c1�@x\r\nT_Scene_a@病室\r\n')
const chs = Buffer.from('Key@Value\r\nT_Sp_a@艾帕迪\r\nT_Dia_a1@你好\r\n')

// ---- 表 / 切段 ----
const table = parseTable(dialogTxt)
check('Dialog.txt：首行是列名，空列不进行；\\r 去掉', table.header[0] === 'ID' && table.rows.length === 6 && !('Role1' in table.rows[1]) && table.rows[0].Music === 'Sound/BGM/Stage03', J(table.rows[0]))
const dramas = buildDramas(dialogTxt, { JPN: parseText(jpn), CHS: parseText(chs) })
check('切段：DramaID 非空的行开一段；重复的 id 加 _2；标题 = Scene 键的文本', J(dramas.map((d) => d.id)) === J(['E1_01', 'E1_01_2', 'E1_02']) && JSON.parse(dramas[0].text).title === '病室' && JSON.parse(dramas[0].text).rows.length === 4, J(dramas.map((d) => d.id)))
check('每段带这一段用到的几种语言的文本（只带用到的键）', J(Object.keys(JSON.parse(dramas[0].text).text)) === J(['JPN', 'CHS']) && !('T_Dia_b1' in JSON.parse(dramas[0].text).text.JPN) && JSON.parse(dramas[0].text).text.CHS.T_Dia_a1 === '你好')

// ---- 适配器 ----
const files = ['Game/BG/A0019_Dialog.png', 'Game/BG/S0061_Dialog/tex.png', 'Game/Sound/BGM/Stage03.wav', 'Game/Hero/H047/Sound/H047_V1.wav', 'Game/Sound/Dialog/Boom.wav']
const toRes = (rel) => rel.replace(/^Game\//, '')
const ctx = adapter.prepare({ options: {}, files, toResourcePath: toRes })
const sc = buildScene('arcrecord::dialog', dramas[0].text, ctx, { options: {} })
const all = sc.steps.flatMap((c) => c.commands)
check('嗅探：只认 arcrecord-dialog/1；原始表 / 别的 JSON 不认', adapter.sniff(dramas[0].text) && !adapter.sniff(dialogTxt.toString()) && !adapter.sniff('{"sceneId":"x"}'))
check('背景：BG_Black = 纯黑；BG/A0019_Dialog → png；预制体目录（BG/S0061_Dialog 里只有贴图）→ 目录里的 png；CG/… 的 Spine 场景记 ignored', all.some((c) => c.op === 'bg' && c.color?.[0] === 0) && all.some((c) => c.op === 'bg' && c.src === 'BG/A0019_Dialog.png') && all.some((c) => c.op === 'bg' && c.src === 'BG/S0061_Dialog/tex.png') && sc.stats.ignored['bg:CG'] === 1, J(all.filter((c) => c.op === 'bg')))
check('BGM：Sound/BGM/Stage03 → wav；Blank = 停；默认的 Effect_Dialog 音效不放、别的音效放；TalkSound = 角色语音', all.some((c) => c.op === 'bgm' && c.src === 'Sound/BGM/Stage03.wav') && all.some((c) => c.op === 'bgmStop') && all.some((c) => c.op === 'se' && c.src === 'Sound/Dialog/Boom.wav') && !all.some((c) => c.op === 'se' && /Effect_Dialog/.test(c.src)) && all.some((c) => c.op === 'voice' && c.src === 'Hero/H047/Sound/H047_V1.wav'), J(all.filter((c) => /bgm|se|voice/.test(c.op))))
const texts = sc.steps.map((s) => s.commands.find((c) => c.op === 'text')).filter(Boolean)
check('台词：<br> 换行；说话人键 → 文本；player = 主角名；{0} = 主角名；<color> → 颜色，<size> 去掉', texts[0].segments[0].text === 'こんにちは\n二行目' && J(texts[1].segments) === J([{ text: '主人公さん、' }, { text: '赤い', style: { color: '#ff0000' } }, { text: '大きい字' }]) && sc.steps[1].commands.find((c) => c.op === 'speaker').segments[0].text === '主人公' && sc.steps[0].commands.find((c) => c.op === 'speaker').segments[0].text === 'エパディ', J(texts))
const zh = buildScene('arcrecord::dialog', dramas[0].text, adapter.prepare({ options: { language: 'CHS', playerName: 'ユウ' }, files, toResourcePath: toRes }), { options: { language: 'CHS', playerName: 'ユウ' } })
check('语言可选（language = CHS）：有的键用中文，没有的键（这一段里 T_Dia_a2 …）空 → 那一行不出', zh.stats.language === 'CHS' && zh.stats.messages === 1 && zh.steps[0].commands.find((c) => c.op === 'text').segments[0].text === '你好', J(zh.stats))
check('Role1-3（Spine 预制体）没做：记进 ignored，不影响文字', sc.stats.ignored.role === 1 && sc.stats.messages === 4, J(sc.stats))
const noIndex = buildScene('arcrecord::dialog', dramas[0].text, adapter.prepare({ options: {}, files: [] }), { options: {} })
check('没有资源索引：不报缺资源、台词照出', Object.keys(noIndex.stats.unresolved).length === 0 && noIndex.stats.messages === 4)

// ---- containers + gal-layout ----
const work = await mkdtemp(path.join(os.tmpdir(), 'arcrec-'))
try {
  const game = path.join(work, 'Ark Re', 'ArcRecordExport', 'Assets', 'Game')
  await mkdir(path.join(game, 'StaticData', 'Text'), { recursive: true })
  await mkdir(path.join(game, 'BG'), { recursive: true })
  await writeFile(path.join(game, 'StaticData', 'Dialog.txt'), dialogTxt)
  await writeFile(path.join(game, 'StaticData', 'Text', 'JPN.txt'), jpn)
  await writeFile(path.join(game, 'StaticData', 'Text', 'CHS.txt'), chs)
  await writeFile(path.join(game, 'BG', 'A0019_Dialog.png'), 'x')
  await writeFile(path.join(work, 'Ark Re', 'ArcRecord_D.exe'), 'MZ')
  const layoutItem = { itemId: 'a', title: 'a', config: {}, source: { path: work }, adapters: ['arcrecord::dialog'] }
  const tagOut = await generateTags({ item: layoutItem, script: { id: 'gal-layout', version: '2.38.0', options: {} } })
  const cfgRaw = tagOut.itemPatch?.gal?.config
  const norm = cfgRaw ? normalizeGalConfigWithWarnings(cfgRaw) : null
  const c = norm?.config
  check('gal-layout：认出 ArcRecord_D（Game/StaticData/Dialog.txt 首行 ID@DramaID），base = ArcRecordExport/Assets，id = arcrecord::arkre，containers = arcdrama / hybrid，只扫 Game/StaticData；config 规整后零警告', Boolean(c) && c.game.id === 'arcrecord::arkre' && c.containers.format === 'arcdrama' && c.containers.mode === 'hybrid' && J(c.containers.scan) === J(['Ark Re/ArcRecordExport/Assets/Game/StaticData']) && J(c.resourceRoots) === J(['Ark Re/ArcRecordExport/Assets/Game']) && norm.warnings.length === 0, J([tagOut.logs, norm?.warnings, c?.containers, c?.resourceRoots]))
  const bad = path.join(work, 'Other', 'Game', 'StaticData'); await mkdir(bad, { recursive: true }); await writeFile(path.join(bad, 'Dialog.txt'), 'something else@entirely')
  const none = await generateTags({ item: { ...layoutItem, config: { game: { id: 'arcrecord::x' } }, source: { path: path.join(work, 'Other') } }, script: { id: 'gal-layout', version: '2.38.0', options: {} } })
  check('gal-layout：Dialog.txt 首行不是 ID@DramaID = 不认', !none.itemPatch?.gal?.config?.containers, J(none.logs))
  const report = await ensureContainers({ mediaDir: work, config: c })
  const rep = report.arcs['Ark Re/ArcRecordExport/Assets/Game/StaticData/Dialog.txt']
  const out = path.join(work, 'Ark Re/ArcRecordExport/Assets/arc/script/Dialog')
  check('展开：每段剧情一个 .arcdrama（E1_01 / E1_01_2 / E1_02），带 JPN + CHS', rep?.scripts === 3 && !rep.error && J(Object.keys(JSON.parse(await readFile(path.join(out, 'E1_01.arcdrama'), 'utf8')).text)) === J(['JPN', 'CHS']) && (await readFile(path.join(out, 'E1_01_2.arcdrama'), 'utf8')).includes('別の段'), J(report))
  const again = await ensureContainers({ mediaDir: work, config: c })
  check('再跑一遍：容器没变 = 命中缓存', again.arcs['Ark Re/ArcRecordExport/Assets/Game/StaticData/Dialog.txt']?.cached === true)

  const sample = process.env.ARC_SAMPLE
  if (sample) {
    const dlg = await readFile(path.join(sample, 'StaticData/Dialog.txt'))
    const texts2 = {}
    for (const lang of ['JPN', 'CHS']) texts2[lang] = parseText(await readFile(path.join(sample, `StaticData/Text/${lang}.txt`)))
    const all2 = buildDramas(dlg, texts2)
    let messages = 0
    for (const d of all2) messages += buildScene('arcrecord::dialog', d.text, adapter.prepare({ options: {}, files: [] }), { options: {} }).stats.messages
    check(`真实样本：Dialog.txt 切成 ${all2.length} 段、解析 ${messages} 句台词`, all2.length === 1719 && messages > 43000, J([all2.length, messages]))
  } else console.log('SKIP 真实样本（ARC_SAMPLE=<…/Game 目录> 才跑）')
} finally { await rm(work, { recursive: true, force: true }) }

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
