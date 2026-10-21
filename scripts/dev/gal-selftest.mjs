#!/usr/bin/env node
// Gal 自测（不需要浏览器）：适配器 / 播放引擎 / 库类型 handler。需要 ImageMagick 和 python3（造测试数据）。
//   node scripts/dev/gal-selftest.mjs
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { galAdapterIds, registerGalAdapter, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { parse, parseRichText, sniff } from '../../web/library/gal/adapters/uviewer-csv.mjs'
import { buildScene, firstBackgroundSrc } from '../../web/library/gal/scene.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { applyCommand, assetUrl, backlog, commandDuration, ratioOfStep, stateAt, stepOfRatio } from '../../web/static/gal-engine.js'
import { buildGalFixture } from './make-gal-fixture.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const J = (v) => JSON.stringify(v)

// ================= 适配器 =================
{
  const s = parse('bg,download/bg/a.jpg,0.5\nname,甲,\nmsg,0,你好，世界,,,,,,,,,\nclickwait\nmsg,0,第二句')
  check('clickwait 切步：2 步', s.steps.length === 2, J(s.steps.length))
  check('bg 路径/渐变', J(s.steps[0].commands[0]) === J({ op: 'bg', src: 'download/bg/a.jpg', fade: 0.5 }), J(s.steps[0].commands[0]))
  check('末尾没有 clickwait 的指令也成一步', s.steps[1].commands.length === 1)
  check('msg 的台词来自第 2 个参数（第 1 个是别的东西）', segText(s.steps[0].commands[2]) === '你好，世界', J(s.steps[0].commands[2]))
}
function segText(command) { return (command.segments || []).map((x) => x.text).join('') }
{
  const s = parse('msg,0,a, b, c,,,,,,,,\nclickwait')
  check('台词里的半角逗号保留（只剥末尾那串空参数）', segText(s.steps[0].commands[0]) === 'a, b, c', segText(s.steps[0].commands[0]))
  check('msg,0, 和 msg,0 = 清空台词', parse('msg,0,').steps[0].commands[0].segments.length === 0 && parse('msg,0').steps[0].commands[0].segments.length === 0)
  check('name 空 = 清空说话人', parse('name,,,,,').steps[0].commands[0].segments.length === 0)
  check('\\n（反斜杠 n 两个字符）变换行', segText(parse('msg,0,甲\\n乙').steps[0].commands[0]) === '甲\n乙')
}
{
  const s = parse('bg,color_10_20_300,1\nbg,,0\nbgoff,2\nstopbgm,0.5\nplaybgm,/a/b.mp3,0,\nplaybgm,\nplayvoice,0,/v/1.wav\nplayvoice,/v/2.wav\nplayse,/s.wav\nfadeinblack,0.5\nfadeoutblack\nwait,0.2\nwait,abc\nmovie,a.mp4:b.mp4,0,1\nmovie,c.mp4,0,0\nmovieoff')
  const c = s.steps[0].commands
  check('纯色背景 color_R_G_B（超范围截到 255）', J(c[0]) === J({ op: 'bg', color: [10, 20, 255], fade: 1 }), J(c[0]))
  check('bg 空路径 = 去掉背景', c[1].op === 'bgoff')
  check('bgoff 渐变秒', J(c[2]) === J({ op: 'bgoff', fade: 2 }))
  check('stopbgm 渐变秒', J(c[3]) === J({ op: 'bgmStop', fade: 0.5 }))
  check('playbgm 去掉前导 /', J(c[4]) === J({ op: 'bgm', src: 'a/b.mp3' }), J(c[4]))
  check('playbgm 没路径：忽略', c[5].op === 'voice')
  check('playvoice 取第 2 个参数；只有 1 个参数就用它', c[5].src === 'v/1.wav' && c[6].src === 'v/2.wav', J([c[5], c[6]]))
  check('playse', J(c[7]) === J({ op: 'se', src: 's.wav' }))
  check('fadeinblack = 变黑；fadeoutblack = 出黑场（默认 1 秒）', J(c[8]) === J({ op: 'fade', to: 'black', seconds: 0.5 }) && J(c[9]) === J({ op: 'fade', to: 'clear', seconds: 1 }))
  check('wait 非法数字按 0', c[10].seconds === 0.2 && c[11].seconds === 0)
  check('movie 多段 + 循环标志', J(c[12]) === J({ op: 'movie', srcs: ['a.mp4', 'b.mp4'], loop: true }) && c[13].loop === false)
  check('movieoff', c[14].op === 'movieOff')
  check('秒数上限 60', parse('wait,9999').steps[0].commands[0].seconds === 60)
  check('反斜杠路径规范成 /', parse('bg,download\\bg\\a.jpg,0').steps[0].commands[0].src === 'download/bg/a.jpg')
}
{
  const s = parse('spriteatlas,download/c/1,body:sad,a,300,-90,0.5,0.5,,,,\nanm,tint,a,150_150_150,0.0001,0\nendwait,,,\nfoo,bar')
  check('立绘/特效等指令原样保留为 raw（带参数），并统计', s.steps[0].commands.filter((c) => c.op === 'raw').length === 3 && s.stats.raw.spriteatlas === 1 && s.stats.raw.anm === 1 && s.stats.raw.foo === 1, J(s.stats))
  check('raw 参数去掉末尾空参数', J(s.steps[0].commands[0].args) === J(['download/c/1', 'body:sad', 'a', '300', '-90', '0.5', '0.5']), J(s.steps[0].commands[0].args))
  check('endwait 不进规范场景', !s.steps[0].commands.some((c) => c.cmd === 'endwait'))
  check('BOM 和 // 注释行、CRLF', parse('﻿// 注释\r\nmsg,0,A\r\nclickwait\r\n').steps.length === 1)
  check('空文本 = 0 步', parse('').steps.length === 0 && parse('\n\n').steps.length === 0)
}
{
  const r = parseRichText('<outline width=2 color=black>「甲」</outline>乙<color=#ff0000>红</color><b>粗<i>粗斜</i></b><br>下一行<unknown>保留文字</unknown>')
  check('outline 样式', r[0].style.outline.width === 2 && r[0].style.outline.color === 'black' && r[0].text === '「甲」', J(r[0]))
  check('无样式文字', r[1].text === '乙' && !r[1].style)
  check('<color=#hex>', r[2].style.color === '#ff0000')
  check('嵌套 b/i，样式叠加', r[3].style.bold && !r[3].style.italic && r[4].style.bold && r[4].style.italic, J(r.slice(3, 5)))
  check('<br> 换行；未知标记丢标记留文字', r.map((x) => x.text).join('').endsWith('\n下一行保留文字'), J(r.map((x) => x.text)))
  const xss = parseRichText('<script>alert(1)</script><img src=x onerror=alert(2)>字<outline color="red;background:url(x)">z</outline>')
  check('危险标记：文字保留为纯文本，标记被丢；非法颜色回退 black（不会注入样式）', xss.map((x) => x.text).join('').includes('alert(1)') && xss.every((x) => !x.style || !x.style.outline || x.style.outline.color === 'black'), J(xss))
  check('未闭合标记不死循环', parseRichText('<outline width=2>未闭合').length === 1)
  check('不成对的 </b> 不报错', parseRichText('a</b>b').map((x) => x.text).join('') === 'ab')
}
{
  check('sniff：典型脚本', sniff('stopbgm,\nfadeinblack,0\nbg,a.jpg,0\nmsg,0,hi') === true)
  check('sniff：普通文本不是脚本', sniff('hello world\nthis is text\nanother line') === false)
  check('sniff：CSV 数据表（首列不是已知指令）不是脚本', sniff('name,age\nbob,3\namy,4\nzed,5') === false)
  check('sniff：太短不算', sniff('bg,a.jpg,0') === false)
  check('适配器注册表', galAdapterIds().includes('uviewer-csv') && sniffGalAdapter('stopbgm,\nfadeinblack,0\nbg,a.jpg,0\nmsg,0,hi') === 'uviewer-csv' && sniffGalAdapter('x\ny\nz') === '')
  registerGalAdapter({ id: 'fake', label: 'fake', sniff: (t) => t.startsWith('FAKE'), parse: (t) => ({ steps: [{ index: 0, commands: [{ op: 'text', segments: [{ text: t }] }] }], stats: { commands: 1, raw: {} } }) })
  check('新增适配器：只需要 registerGalAdapter（以后加格式不用动播放器）', sniffGalAdapter('FAKE data') === 'fake' && buildScene('fake', 'FAKE data').steps[0].commands[0].op === 'text' && sniffGalAdapter('FAKE data', ['uviewer-csv']) === '')
  let threw = false
  try { buildScene('nope', '') } catch { threw = true }
  check('未知适配器：报错', threw)
}

// ================= 播放引擎 =================
{
  const scene = buildScene('uviewer-csv', 'bg,a.jpg,0\nplaybgm,m1.mp3\nname,甲,\nmsg,0,一\nclickwait\nfadeinblack,0.5\nbg,color_1_2_3,0\nstopbgm,0\nmsg,0,二\nclickwait\nfadeoutblack,0.5\nplayvoice,0,v.wav\nplaybgm,m2.mp3\nname,乙,\nmsg,0,三\nclickwait\nmovie,x.mp4,0,1\nmsg,0,\nclickwait')
  const st = (i) => stateAt(scene, i)
  check('stateAt(0)：背景/BGM/说话人/台词', st(0).bg.src === 'a.jpg' && st(0).bgm === 'm1.mp3' && st(0).text[0].text === '一' && st(0).speaker[0].text === '甲' && !st(0).black)
  check('stateAt(1)：黑场 + 纯色背景 + BGM 停', st(1).black === true && J(st(1).bg) === J({ color: [1, 2, 3] }) && st(1).bgm === '')
  check('stateAt(2)：出黑场，新 BGM，说话人换了（语音不进状态）', st(2).black === false && st(2).bgm === 'm2.mp3' && st(2).speaker[0].text === '乙')
  check('stateAt(3)：视频 + 台词清空', st(3).movie.srcs[0] === 'x.mp4' && st(3).movie.loop === true && st(3).text.length === 0)
  check('stateAt 越界取到最后一步；-1 = 初始', J(st(99)) === J(st(3)) && st(-1).bg === null && st(-1).text.length === 0)
  check('stateAt 是纯的：重复调用结果一样，不修改场景', J(st(2)) === J(st(2)))
  check('backlog：只含有文字的台词，按步数截断', backlog(scene, 3).length === 3 && backlog(scene, 0).length === 1 && backlog(scene, 2)[2].speaker[0].text === '乙' && backlog(scene, 2)[2].step === 2)
  check('commandDuration', commandDuration({ op: 'bg', fade: 1.5 }) === 1.5 && commandDuration({ op: 'fade', seconds: 2 }) === 2 && commandDuration({ op: 'wait', seconds: 0.3 }) === 0.3 && commandDuration({ op: 'text' }) === 0 && commandDuration({ op: 'voice' }) === 0)
  check('进度 ratio ↔ step 往返', [0, 1, 2, 3].every((i) => stepOfRatio(ratioOfStep(i, 4), 4) === i) && ratioOfStep(0, 1) === 1 && stepOfRatio(0.5, 1) === 0 && stepOfRatio(2, 5) === 4 && stepOfRatio(-1, 5) === 0)
  check('assetUrl 编码', assetUrl('/api/x/resource', 'download/bg/a b&c.jpg') === '/api/x/resource?path=download%2Fbg%2Fa%20b%26c.jpg')
  check('applyCommand 忽略未知 op', J(applyCommand({ a: 1 }, { op: 'raw' })) === J({ a: 1 }))
}

// ================= handler / 浏览节点 =================
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-selftest-'))
const dataDir = path.join(work, 'data')
const root = path.join(dataDir, 'gal')
await mkdir(root, { recursive: true })
await buildGalFixture(root, { exampleScript: process.env.GAL_EXAMPLE || '' })   // GAL_EXAMPLE：真实示例脚本（不入库）；不给就用模拟长脚本
const cfg = { mediaImportProfiles: { 'gal-import': { rootDir: root } } }
const mk = (over = {}) => createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: root, ...over } } }) })
const handler = mk()
const err = (promise) => promise.then(() => null, (e) => e)

const dry = await handler.importFromSource({ options: { dryRun: true } })
check('dryRun：统计但不写元数据', dry.items.length === 0 && dry.report.dryRun && dry.report.scripts === 38 && (await handler.scanItems()).length === 0, J(dry.report))
const imp = await handler.importFromSource({ tags: ['演示'] })
const items = await handler.scanItems()
check('导入：整个目录 = 1 个媒体条目', items.length === 1 && imp.report.imported === 1 && imp.items[0].itemId === items[0].itemId, J(imp.report))
const M = items[0]
check('条目只有一个单元 main；元数据 source.path 指向传进来的目录（真实路径）', M.unitCount === 1 && M.mediaUnits[0].unitId === 'main' && M.source.path === await realpath(root) && M.title === 'gal', J([M.unitCount, M.source]))
check('条目记了脚本数、tag、默认浏览约定（layout.browse，以后改约定改这里）', M.scriptCount === 38 && M.tags.includes('演示') && M.layout.browse.pageSize === 25 && M.layout.browse.categories.length === 4 && M.layout.stripPrefixes[0] === 'download/', J([M.scriptCount, M.layout]))
check('封面 = 目录里第一张存在的背景图', M.coverPath === 'download/bg/bg_school.jpg' && /thumbnail\/script\/cover$/.test(M.cover), M.coverPath)

// 重新导入：幂等，保留手工 tag / 创建时间 / 标题改动
await handler.updateItemTags(M.itemId, ['手工标签', '系列:测试'])
await handler.patchItemMetadata(M.itemId, { title: '改过的标题' })
const before = (await handler.getItem(M.itemId)).createdAt
const again = await handler.importFromSource({})
const M2 = await handler.getItem(M.itemId)
check('重复导入：不新增条目，算更新', again.report.imported === 0 && again.report.updated === 1 && (await handler.scanItems()).length === 1, J(again.report))
check('重复导入：保留 tag、标题、创建时间；条目 id 不变', M2.tags.includes('手工标签') && M2.title === '改过的标题' && M2.createdAt === before && M2.itemId === M.itemId)

// 来源目录
{
  const sub = await handler.importFromSource({ sourcePath: path.join(root, 'cabin'), options: { dryRun: true } })
  check('传别的目录 = 另一个媒体（dryRun 能统计，且不写）', sub.report.scripts === 2 && sub.report.imported === 1 && (await handler.scanItems()).length === 1, J(sub.report))
  check('不存在的目录：明确报错', /不存在或不可读/.test((await err(handler.importFromSource({ sourcePath: '/nonexistent-gal-dir' })))?.message || ''))
  check('文件不是目录：报错', /不存在或不可读/.test((await err(handler.importFromSource({ sourcePath: path.join(root, 'cabin', 'ep02 终章.txt') })))?.message || ''))
  const emptyDir = path.join(work, 'empty')
  await mkdir(emptyDir, { recursive: true })
  await writeFile(path.join(emptyDir, 'notes.txt'), 'hello\nworld\nnot a script\n')
  const none = await handler.importFromSource({ sourcePath: emptyDir })
  check('没有脚本的目录：不建条目，计入 skippedNoScript', none.items.length === 0 && none.report.skippedNoScript === 1 && (await handler.scanItems()).length === 1, J(none.report))
  const noArg = await mk({ rootDir: path.join(work, 'nowhere') }).importFromSource({}).then(() => null, (e) => e)
  check('不传来源又没有 rootDir：报错', /不存在或不可读/.test(noArg?.message || ''))
}

// ---- 节点 ----
const read = (sectionId = '', unitId = 'main') => handler.getReaderContent(M.itemId, unitId, { sectionId })
const nodeOf = async (id) => (await read(id)).node
const home = await read('')
check('首页：type=gal，单元 main，section 带节点 id，kind=grid，4 个分类', home.type === 'gal' && home.unit.unitId === 'main' && home.section.sectionId === '' && home.node.kind === 'grid' && home.node.items.length === 4 && home.scene === null && home.node.parent === null, J(home.node.items.map((i) => i.node)))
check('首页：分类卡片自带下一个节点和数量', J(home.node.items.map((i) => [i.title, i.node, i.subtitle])) === J([['纪念馆', 'c:cabin', '2 个脚本'], ['角色', 'c:character', '3 个角色'], ['家具', 'c:room', '30 个脚本'], ['复刻', 'c:other', '1 个脚本']]), J(home.node.items.map((i) => [i.title, i.node, i.subtitle])))
check('reader 带资源基址、没有 mediaUnits、没有单元级上下导航', home.resourceBase === `/api/library/items/gal/${M.itemId}/resource` && !('mediaUnits' in home.item) && home.navigation.prev === null && home.navigation.next === null && home.sectionNavigation.prev === null)
check('每个选项字段恒定（variants 恒为数组）', home.node.items.every((i) => Array.isArray(i.variants) && 'thumb' in i && 'node' in i))
const cabin = await nodeOf('c:cabin')
check('纪念馆：list，2 个脚本（README.txt 不算），带缩略图（脚本里第一张存在的背景）', cabin.kind === 'list' && cabin.total === 2 && cabin.items[0].title === 'ep01 序章' && cabin.items[0].thumb === 'download/bg/bg_school.jpg' && cabin.items[0].node === 's:cabin/ep01 序章.txt' && cabin.parent === '' && cabin.id === 'c:cabin#1', J(cabin.items.map((i) => [i.title, i.thumb])))
const room1 = await nodeOf('c:room'), room2 = await nodeOf('c:room#2')
check('家具：30 个脚本，每页 25，第 2 页 5 个，页码/页数/总数', room1.items.length === 25 && room1.pageCount === 2 && room1.total === 30 && room2.items.length === 5 && room2.page === 2 && room2.id === 'c:room#2' && room2.items.at(-1).title === '缺资源', J([room1.items.length, room2.items.length, room2.items.map((i) => i.title)]))
check('翻页：页码越界夹到最后一页；#0 夹到第 1 页', (await nodeOf('c:room#99')).page === 2 && (await nodeOf('c:room#0')).page === 1)
check('自然序：家具2 在 家具10 前面', (() => { const t = room1.items.map((i) => i.title); return t.indexOf('家具02') < t.indexOf('家具10') })())
check('缺资源的脚本：缩略图为空（不报错）', room2.items.find((i) => i.title === '缺资源').thumb === '')
const chars = await nodeOf('c:character')
check('角色：grid，按自然序，显示名来自 character_names.json，头像存在才给', chars.kind === 'grid' && J(chars.items.map((i) => [i.title, i.node, i.thumb])) === J([['小夜', 'ch:1010', 'character/1010/icon.png'], ['2001', 'ch:2001', ''], ['阿梓', 'ch:10580', '']]), J(chars.items.map((i) => [i.title, i.thumb])))
const c1010 = await nodeOf('ch:1010')
check('角色页：脚本按组；有图片/视频两个版本的带 variants，只有一个版本的直接带 node', c1010.kind === 'list' && c1010.items.length === 2 && c1010.items[0].title === 'story01' && c1010.items[0].node === '' && J(c1010.items[0].variants) === J([{ label: '图片', node: 's:character/1010/story01_image.txt' }, { label: '视频', node: 's:character/1010/story01_video.txt' }]) && c1010.items[1].node === 's:character/1010/story02.txt' && c1010.items[1].variants.length === 0, J(c1010.items))
check('角色页：标题用显示名；返回上一级是角色列表', c1010.title === '小夜' && c1010.parent === 'c:character#1' && c1010.breadcrumb.map((b) => b.title).join('>') === '首页>角色>小夜')
const long = await read('s:character/10580/long.txt').catch(() => read('s:character/10580/example.txt'))
check('播放页：kind=player，带规范场景；section 就是这个节点', long.node.kind === 'player' && long.scene.format === 'gal-scene/1' && long.scene.steps.length > 20 && long.section.sectionId === long.node.id && long.node.items.length === 0)
const ep1 = await read('s:cabin/ep01 序章.txt')
check('播放页：返回上一级 = 所在列表；面包屑完整', ep1.node.parent === 'c:cabin#1' && ep1.node.breadcrumb.map((b) => b.title).join('>') === '首页>纪念馆>ep01 序章' && ep1.scene.steps.length === 6, J(ep1.node.breadcrumb))
check('播放页：上下话 = 同一级序列里的邻居', ep1.sectionNavigation.prev === null && ep1.sectionNavigation.next.sectionId === 's:cabin/ep02 终章.txt')
const ep2 = await read('s:cabin/ep02 终章.txt')
check('带 BOM 的脚本能解析；末尾没有下一话', ep2.scene.steps.length === 2 && ep2.sectionNavigation.next === null && ep2.sectionNavigation.prev.sectionId === 's:cabin/ep01 序章.txt')
const vid = await read('s:character/1010/story01_video.txt')
const img = await read('s:character/1010/story01_image.txt')
check('变体：标题带版本；上下话保持同一种版本，没有就退到第一个', vid.node.title === 'story01 · 视频' && vid.sectionNavigation.next.sectionId === 's:character/1010/story02.txt' && img.sectionNavigation.prev === null && vid.node.parent === 'ch:1010#1')
const f28 = await read('s:room/家具28.txt')
check('返回页码：第 2 页的脚本返回到 c:room#2（回到点进来的那一页）', f28.node.parent === 'c:room#2' && (await read('s:room/家具01.txt')).node.parent === 'c:room#1', f28.node.parent)
const oneChar = await read('s:character/2001/only.txt')
check('只有一个角色页上的脚本：返回 ch:2001；角色在第 1 页 → 返回 c:character#1', oneChar.node.parent === 'ch:2001#1' && (await nodeOf('ch:2001')).parent === 'c:character#1')
check('分类、角色在更多页时返回对应页（pageSize=2 时 阿梓 在第 2 页）', await (async () => {
  const small = mk(); await small.internals.updateItem(M.itemId, (it) => ({ ...it, layout: { ...it.layout, browse: { ...it.layout.browse, pageSize: 2 } } }))
  const n = await small.getReaderContent(M.itemId, 'main', { sectionId: 'ch:10580' })
  const c = await small.getReaderContent(M.itemId, 'main', { sectionId: 'c:character#2' })
  await small.internals.updateItem(M.itemId, (it) => ({ ...it, layout: { ...it.layout, browse: { ...it.layout.browse, pageSize: 25 } } }))
  return n.node.parent === 'c:character#2' && c.node.items.length === 1 && c.node.pageCount === 2 && c.node.id === 'c:character#2'
})())
check('超长文件名：标题完整保留', (await nodeOf('c:other')).items[0].title.length > 100)

// 非法节点
for (const [name, id, code] of [
  ['目录穿越 ..', 's:../x.txt', 400], ['中间有 ..', 's:cabin/../../x.txt', 400], ['空段', 's:cabin//ep01.txt', 400], ['绝对路径', 's:/etc/passwd', 400],
  ['扩展名不在白名单', 's:download/bg/bg_school.jpg', 400], ['不是脚本的 txt', 's:cabin/README.txt', 400], ['脚本不存在', 's:cabin/none.txt', 404],
  ['未知分类', 'c:nope', 404], ['角色 id 穿越', 'ch:..', 400], ['角色 id 带斜杠', 'ch:a/b', 400], ['角色不存在', 'ch:999', 404], ['未知节点类型', 'x:1', 400],
]) {
  const e = await err(read(id))
  check(`非法节点：${name} → ${code}`, e?.statusCode === code, `${e?.statusCode} ${e?.message}`)
}
check('未知单元报错（单元只有 main）', Boolean(await err(read('', 'nope'))))
await symlink(path.join(work, 'empty', 'notes.txt'), path.join(root, 'cabin', 'link.txt'))
check('符号链接指到媒体目录之外的脚本：不读', Boolean(await err(read('s:cabin/link.txt'))))

// 没有分类目录：首页退化成递归脚本列表
{
  const flat = path.join(work, 'flat')
  await mkdir(path.join(flat, 'deep/er'), { recursive: true })
  await writeFile(path.join(flat, 'a.txt'), 'stopbgm,\nfadeinblack,0\nmsg,0,A\nclickwait\n')
  await writeFile(path.join(flat, 'deep/er/b.txt'), 'stopbgm,\nfadeinblack,0\nmsg,0,B\nclickwait\n')
  const r = await handler.importFromSource({ sourcePath: flat })
  const F = r.items[0]
  const h = await handler.getReaderContent(F.itemId, 'main', { sectionId: '' })
  const leaf = await handler.getReaderContent(F.itemId, 'main', { sectionId: 's:deep/er/b.txt' })
  check('无分类目录：首页是脚本列表（递归找到），没有封面就不给', h.node.kind === 'list' && h.node.items.length === 2 && F.cover === '' && (await err(handler.getThumbnail(F.itemId)))?.statusCode === 404, J(h.node.items.map((i) => i.title)))
  check('无分类目录：脚本返回首页（空 id）', leaf.node.parent === '' && leaf.sectionNavigation.prev.sectionId === 's:a.txt')
  await rm(path.join(dataDir, 'library-meta'), { recursive: true, force: true }).catch(() => {})
  await handler.importFromSource({})   // 元数据被清掉后重新导入主媒体，后面的测试继续用
}

// 资源解析（相对媒体目录；去掉 download/ 前缀重试）
const M3 = await handler.getItem(M.itemId)   // 同一个目录，条目 id 不变
const res = async (p) => handler.getResource(M3.itemId, p).then((r) => r, (e) => ({ error: e }))
check('资源：按媒体目录解析（download/bg/…）', (await res('download/bg/bg_school.jpg')).contentType === 'image/jpeg')
check('资源：content-type 按扩展名（wav/mp3）', (await res('download/sound/voice/v_1.wav')).contentType === 'audio/wav' && (await res('download/sound/bgm/bgm192.mp3')).contentType === 'audio/mpeg')
check('资源：缺失 → 404；目录穿越 → 400；空路径/双斜杠 → 400', (await res('download/bg/none.jpg')).error?.statusCode === 404 && (await res('../x')).error?.statusCode === 400 && (await res('download/../../x')).error?.statusCode === 400 && (await res('')).error?.statusCode === 400 && (await res('a//b')).error?.statusCode === 400)
await mkdir(path.join(root, 'plain'), { recursive: true })
await writeFile(path.join(root, 'plain', 'x.txt'), 'plain')
check('资源：去掉 download/ 前缀重试', (await res('download/plain/x.txt')).body?.toString() === 'plain')
await writeFile(path.join(work, 'secret.txt'), 'SECRET')
await symlink(path.join(work, 'secret.txt'), path.join(root, 'link.bin'))
await symlink(work, path.join(root, 'linkdir'))
check('资源：符号链接指到媒体目录之外 → 拒绝（不泄露文件）', (await res('link.bin')).error?.statusCode === 404 && (await res('linkdir/secret.txt')).error?.statusCode === 404)
const thumb = await handler.getThumbnail(M3.itemId)
check('封面：原样返回背景图', thumb.contentType === 'image/jpeg' && thumb.body.length > 1000)
await writeFile(path.join(root, 'cover.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
const recover = await handler.importFromSource({})
check('目录里有 cover.png：优先用它当封面', recover.items[0].coverPath === 'cover.png')
check('条目 id 不合法 → 报错（防路径拼接）', Boolean(await err(handler.getItem('../x'))))

// GBK 脚本 + 太大/太深
{
  const dir = path.join(root, 'character', 'gbk')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'g.txt'), Buffer.concat([Buffer.from('stopbgm,\nfadeinblack,0\nbg,a.jpg,0\nname,'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), Buffer.from(',\nmsg,0,'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), Buffer.from(',,,\nclickwait\n')]))
  const gr = await read('s:character/gbk/g.txt')
  check('GBK 编码的脚本：能识别、能解码', segText(gr.scene.steps[0].commands.find((c) => c.op === 'text')) === '你好', J(gr.scene.steps[0].commands))
  await writeFile(path.join(root, 'cabin', 'big.txt'), 'stopbgm,\n'.repeat(3000))
  const lim = mk({ maxScriptBytes: 2000 })
  const cab = await lim.getReaderContent(M3.itemId, 'main', { sectionId: 'c:cabin' })
  check('大小上限：太大的脚本不收（列表里没有）', !cab.node.items.some((i) => i.title === 'big') && cab.node.total === 2, J(cab.node.items.map((i) => i.title)))
  await rm(path.join(root, 'cabin', 'big.txt'))
}

// 进度：只有播放页算；每个脚本各记各的
{
  const p0 = await handler.getProgress(M3.itemId)
  check('进度：初始为空', p0.lastUnitId === '' && p0.lastSectionId === '' && p0.lastScrollRatio === 0 && Object.keys(p0.nodes).length === 0)
  await handler.saveProgress(M3.itemId, { unitId: 'main', sectionId: 'c:cabin#1', scrollRatio: 0 })
  const afterBrowse = await handler.getProgress(M3.itemId)
  check('进度：在列表里逛不记（「继续」不会落到列表上）', afterBrowse.lastSectionId === '' && Object.keys(afterBrowse.nodes).length === 0)
  const p1 = await handler.saveProgress(M3.itemId, { unitId: 'main', title: 'x', sectionId: 's:cabin/ep01 序章.txt', scrollRatio: 0.6 })
  check('进度：播放页记 section 和比例', p1.lastSectionId === 's:cabin/ep01 序章.txt' && p1.lastScrollRatio === 0.6 && p1.nodes['s:cabin/ep01 序章.txt'].ratio === 0.6)
  await handler.saveProgress(M3.itemId, { unitId: 'main', sectionId: 's:cabin/ep02 终章.txt', scrollRatio: 5 })
  const p2 = await handler.getProgress(M3.itemId)
  check('进度：各脚本各记各的；比例夹在 0..1；到末尾算看完', p2.lastSectionId === 's:cabin/ep02 终章.txt' && p2.nodes['s:cabin/ep01 序章.txt'].ratio === 0.6 && p2.nodes['s:cabin/ep02 终章.txt'].ratio === 1 && p2.nodes['s:cabin/ep02 终章.txt'].completedAt)
  await handler.saveProgress(M3.itemId, { unitId: 'main', sectionId: 'ch:1010#1', scrollRatio: 0.3 })
  check('进度：之后又逛列表，上次看的位置不变', (await handler.getProgress(M3.itemId)).lastSectionId === 's:cabin/ep02 终章.txt')
}
// 标签
{
  const t = await handler.updateUnitTags(M3.itemId, 'main', ['章节标签'])
  check('单元标签', t.tags[0] === '章节标签' && (await handler.listUnits(M3.itemId))[0].tags[0] === '章节标签')
  check('单元标签：不存在的单元报错', Boolean(await err(handler.updateUnitTags(M3.itemId, 'nope', []))))
  check('重新导入后单元标签还在', (await handler.importFromSource({})).items[0].mediaUnits[0].tags[0] === '章节标签')
}

await rm(work, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
