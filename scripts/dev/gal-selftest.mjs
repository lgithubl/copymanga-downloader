#!/usr/bin/env node
// Gal 自测（不需要浏览器）：适配器 / 播放引擎 / 库类型 handler。需要 ImageMagick 和 python3（造测试数据）。
//   node scripts/dev/gal-selftest.mjs
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
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

// ================= handler =================
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-selftest-'))
const dataDir = path.join(work, 'data')
const root = path.join(dataDir, 'gal')
await mkdir(root, { recursive: true })
await buildGalFixture(root, { exampleScript: process.env.GAL_EXAMPLE || '' })   // GAL_EXAMPLE：真实示例脚本（不入库）；不给就用模拟长脚本
const cfg = { mediaImportProfiles: { 'gal-import': { rootDir: root } } }
const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => (await import('node:fs')).existsSync(p), getConfig: () => cfg })

const dry = await handler.importFromSource({ options: { dryRun: true } })
check('dryRun：统计但不写元数据', dry.items.length === 0 && dry.report.dryRun && dry.report.scanned >= 4 && (await handler.scanItems()).length === 0, J(dry.report))
const imp = await handler.importFromSource({})
const items = await handler.scanItems()
const byTitle = (prefix) => items.find((i) => i.title.startsWith(prefix))
check('导入：有脚本的作品都建了条目；无脚本的目录/隐藏目录跳过', items.length === imp.report.imported && imp.report.skippedNoScript === 1 && !items.some((i) => i.title.includes('空目录')) && !items.some((i) => i.title.startsWith('.')), J(imp.report))
const A = byTitle('演示作品A')
check('A：2 个脚本单元，README.txt 没被当脚本', A.unitCount === 2 && A.mediaUnits.every((u) => u.mediaKind === 'gal' && !u.fileName.startsWith('README')), J(A.mediaUnits.map((u) => u.fileName)))
check('A：单元按自然序，带步数/大小', A.mediaUnits[0].fileName.startsWith('ep01') && A.mediaUnits[0].stepCount === 6 && A.mediaUnits[1].stepCount === 2 && A.mediaUnits[0].size > 0, J(A.mediaUnits.map((u) => [u.fileName, u.stepCount])))
check('A：封面 = 脚本里第一张且磁盘上存在的背景图', A.coverPath === 'download/bg/bg_school.jpg' && /thumbnail\/script\/cover$/.test(A.cover), J([A.coverPath, A.cover]))
check('A：元数据记录目录约定 layout 和适配器（以后改约定改这里）', A.layout.sharedRoot === true && A.layout.stripPrefixes[0] === 'download/' && A.adapter === 'uviewer-csv' && A.source.dir === '演示作品A')
const B = byTitle('演示作品B')
check('B（资源全缺）：条目照建，没有封面', B && B.cover === '' && B.coverPath === '')
const C = byTitle('演示作品C')
check('C（超长目录名）：标题完整保留', C && C.title.length > 100)
const D = byTitle('演示作品D')
check('D（立绘/特效等长脚本）：封面是它的第一张背景；真实示例 81 步', D.coverPath === 'download/bg/bg_10060200.jpg' && (!process.env.GAL_EXAMPLE || D.mediaUnits[0].stepCount === 81), J([D.mediaUnits[0].stepCount, D.coverPath]))

// 重新导入：幂等，保留手工 tag / 创建时间 / 标题改动
await handler.updateItemTags(A.itemId, ['手工标签', '系列:测试'])
await handler.patchItemMetadata(A.itemId, { title: '改过的标题' })
const before = (await handler.getItem(A.itemId)).createdAt
const again = await handler.importFromSource({})
const A2 = await handler.getItem(A.itemId)
check('重复导入：不新增条目，全部算更新', again.report.imported === 0 && again.report.updated === items.length && (await handler.scanItems()).length === items.length, J(again.report))
check('重复导入：保留 tag、标题、创建时间；条目 id 不变', A2.tags.includes('手工标签') && A2.title === '改过的标题' && A2.createdAt === before && A2.itemId === A.itemId)
check('limit 选项', (await handler.importFromSource({ options: { dryRun: true, limit: 1 } })).report.limited === true)
{
  let threw = ''
  try { await handler.importFromSource({ sourcePath: '/etc' }) } catch (e) { threw = e.message }
  check('来源路径只能是根目录（不能读任意路径）', /必须是 Gal 根目录/.test(threw), threw)
  const badRoot = createGalHandler({ dataDir, safeSegment: (v) => v, pathExists: async () => false, getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: '/nonexistent-gal-root' } } }) })
  threw = ''
  try { await badRoot.importFromSource({}) } catch (e) { threw = e.message }
  check('根目录不存在：给明确错误', /不存在或不可读/.test(threw), threw)
}

// 阅读
const reader = await handler.getReaderContent(A.itemId, A.mediaUnits[0].unitId)
check('reader：type=gal，带规范场景和资源基址', reader.type === 'gal' && reader.scene.format === 'gal-scene/1' && reader.scene.steps.length === 6 && reader.resourceBase === `/api/library/items/gal/${A.itemId}/resource`, J([reader.type, reader.scene?.format, reader.scene?.steps?.length]))
check('reader：上/下一单元导航', reader.navigation.prev === null && reader.navigation.next.unitId === A.mediaUnits[1].unitId)
const r2 = await handler.getReaderContent(A.itemId, A.mediaUnits[1].unitId)
check('reader：带 BOM 的脚本能解析', r2.scene.steps.length === 2 && r2.navigation.next === null && r2.navigation.prev.unitId === A.mediaUnits[0].unitId)
check('reader：场景里 XSS 样的台词只是文字', segText(r2.scene.steps[0].commands.find((c) => c.op === 'text')) === '第二个脚本（带 BOM）。' && reader.scene.steps[2].commands.some((c) => c.op === 'text' && segText(c).includes('<script>') === false && segText(c).includes('alert(1)')))
check('reader：未知单元报错', await handler.getReaderContent(A.itemId, 'nope').then(() => false, () => true))
check('reader：不返回 mediaUnits（和别的类型一致，单元走 /units）', !('mediaUnits' in reader.item))

// 资源解析
const res = async (p, id = A.itemId) => handler.getResource(id, p).then((r) => r, (e) => ({ error: e }))
check('资源：按作品目录解析（download/bg/…）', (await res('download/bg/bg_school.jpg')).contentType === 'image/jpeg')
check('资源：content-type 按扩展名（wav/png/mp3）', (await res('download/sound/bgm/bgm_a.wav')).contentType === 'audio/wav')
check('资源：缺失 → 404', (await res('download/bg/none.jpg')).error?.statusCode === 404)
check('资源：目录穿越 .. → 400', (await res('../演示作品B 缺资源/script/only.txt')).error?.statusCode === 400 && (await res('download/../../x')).error?.statusCode === 400)
check('资源：空路径/双斜杠 → 400', (await res('')).error?.statusCode === 400 && (await res('a//b')).error?.statusCode === 400)
await writeFile(path.join(root, 'shared.png'), 'x')
await mkdir(path.join(root, 'shared'), { recursive: true })
await writeFile(path.join(root, 'shared', 's.txt'), 'shared')
check('资源：作品里没有 → 退到根目录共享资源（layout.sharedRoot）', (await res('shared/s.txt')).body?.toString() === 'shared')
await mkdir(path.join(root, '演示作品A', 'plain'), { recursive: true })
await writeFile(path.join(root, '演示作品A', 'plain', 'x.txt'), 'plain')
check('资源：去掉 download/ 前缀重试', (await res('download/plain/x.txt')).body?.toString() === 'plain')
await writeFile(path.join(work, 'secret.txt'), 'SECRET')
await symlink(path.join(work, 'secret.txt'), path.join(root, '演示作品A', 'link.txt'))
await symlink(work, path.join(root, '演示作品A', 'linkdir'))
check('资源：符号链接指到根目录之外 → 拒绝（不泄露文件）', (await res('link.txt')).error?.statusCode === 404 && (await res('linkdir/secret.txt')).error?.statusCode === 404)
const thumb = await handler.getThumbnail(A.itemId)
check('封面：原样返回背景图', thumb.contentType === 'image/jpeg' && thumb.body.length > 1000)
check('封面：没有封面 → 404', await handler.getThumbnail(B.itemId).then(() => false, (e) => e.statusCode === 404))
check('条目 id 不合法 → 报错（防路径拼接）', await handler.getItem('../x').then(() => false, () => true))

// 非 UTF-8 脚本（GBK）能识别与解析
{
  const gbkDir = path.join(root, '演示GBK')
  await mkdir(gbkDir, { recursive: true })
  const iconv = new TextDecoder('gb18030') // 只用来确认环境支持；编码用手写 GBK 字节
  void iconv
  // 「你好」的 GBK 字节 C4 E3 BA C3
  await writeFile(path.join(gbkDir, 'g.txt'), Buffer.concat([Buffer.from('bg,a.jpg,0\nname,'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), Buffer.from(',\nmsg,0,'), Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), Buffer.from(',,,\nclickwait\n')]))
  await handler.importFromSource({})
  const G = (await handler.scanItems()).find((i) => i.title === '演示GBK')
  const gr = G && await handler.getReaderContent(G.itemId, G.mediaUnits[0].unitId)
  check('GBK 编码的脚本：能识别、能解码', gr && segText(gr.scene.steps[0].commands.find((c) => c.op === 'text')) === '你好', gr && J(gr.scene.steps[0].commands))
}
// 过大的文件 / 太深的目录
{
  const dir = path.join(root, '演示限制')
  await mkdir(path.join(dir, 'a/b/c/d/e/f/g/h'), { recursive: true })
  await writeFile(path.join(dir, 'a/b/c/d/e/f/g/h/deep.txt'), 'stopbgm,\nfadeinblack,0\nbg,a.jpg,0\nmsg,0,hi\nclickwait\n')
  await writeFile(path.join(dir, 'big.txt'), 'stopbgm,\n'.repeat(1000))
  const lim = createGalHandler({ dataDir: path.join(work, 'd2'), safeSegment: (v) => v, pathExists: async () => false, getConfig: () => ({ mediaImportProfiles: { 'gal-import': { rootDir: root, maxDepth: 3, maxScriptBytes: 2000 } } }) })
  const found = await lim.internals.findScripts(dir, { maxDepth: 3, scriptExtensions: ['txt'], maxScriptBytes: 2000, adapters: ['uviewer-csv'] })
  check('深度/大小上限：太深的、太大的脚本不收', found.length === 0, J(found.map((f) => f.full)))
}
// 进度
{
  const p0 = await handler.getProgress(A.itemId)
  check('进度：初始为空', p0.lastUnitId === '' && p0.lastScrollRatio === 0)
  const p1 = await handler.saveProgress(A.itemId, { unitId: A.mediaUnits[0].unitId, title: 'x', scrollRatio: 0.6 })
  check('进度：保存步数比例', p1.lastUnitId === A.mediaUnits[0].unitId && p1.lastScrollRatio === 0.6 && (await handler.getProgress(A.itemId)).lastScrollRatio === 0.6)
  const p2 = await handler.saveProgress(A.itemId, { unitId: A.mediaUnits[0].unitId, scrollRatio: 5 })
  check('进度：比例夹在 0..1，到末尾算读完', p2.lastScrollRatio === 1 && p2.readUnits[A.mediaUnits[0].unitId].completedAt)
}
// 标签
{
  const t = await handler.updateUnitTags(A.itemId, A.mediaUnits[0].unitId, ['章节标签'])
  check('单元标签', t.tags[0] === '章节标签' && (await handler.listUnits(A.itemId))[0].tags[0] === '章节标签')
  check('单元标签：不存在的单元报错', await handler.updateUnitTags(A.itemId, 'nope', []).then(() => false, () => true))
}

await rm(work, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
