#!/usr/bin/env node
// 演示站点冒烟（只走接口，不用浏览器）：灌完数据后确认「今天几个改动」都在、都能用。
//   node scripts/dev/demo-smoke.mjs <站点地址> [认证头] [--expect-archive]
import { createHash } from 'node:crypto'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const BASE = (args[0] || '').replace(/\/$/, '')
if (!BASE) { console.error('用法: demo-smoke.mjs <站点地址> [认证头] [--expect-archive]'); process.exit(2) }
const EXPECT_ARCHIVE = process.argv.includes('--expect-archive')
const headers = {}
if (args[1]) { const [k, ...v] = args[1].split(':'); headers[k.trim()] = v.join(':').trim() }
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const get = async (p) => {
  const res = await fetch(BASE + p, { headers })
  const buf = Buffer.from(await res.arrayBuffer())
  let body = null; try { body = JSON.parse(buf.toString('utf8')) } catch { /* 不是 JSON */ }
  return { status: res.status, body, buf, type: res.headers.get('content-type') || '' }
}
const post = async (p, v) => {
  const res = await fetch(BASE + p, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(v) })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const crossings = (wav) => { let n = 0; let prev = 0; for (let i = 44; i + 1 < wav.length; i += 2) { const s = wav.readInt16LE(i); if ((s >= 0) !== (prev >= 0)) n++; prev = s } return n }

check('服务健康', (await get('/health')).status === 200)
const cfg = (await get('/api/config')).body
check('配置：新页面规则（打开媒体、点标签）是数组', Array.isArray(cfg.mediaOpenInNewTabRules) && Array.isArray(cfg.tagSearchOpenInNewTabRules) && cfg.mediaOpenInNewTabRules.length > 0, J([cfg.mediaOpenInNewTabRules, cfg.tagSearchOpenInNewTabRules]))
check('配置：朗读规则 ja / zh（各自的参数），模拟 TTS 地址已配', Array.isArray(cfg.epubTtsRules) && cfg.epubTtsRules.some((r) => r.flag === 'ja' && r.prompt_audio) && cfg.epubTtsRules.some((r) => r.match === '*' && r.flag === 'zh') && Boolean(cfg.epubTtsApiBase), J(cfg.epubTtsRules))
check('配置：统一的「新页里返回=关闭标签页」开关存在', typeof cfg.mediaCloseNewTabOnBack === 'boolean')

// ---- 媒体库性能相关：启动接口 / ETag / 压缩 / 缩略图缓存 ----
{
  const raw = async (p, extra = {}) => { const r = await fetch(BASE + p, { headers: { ...headers, ...extra } }); return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) } }
  const boot = (await get('/api/library/boot?type=all&page=1&limit=5')).body
  check('启动接口 /api/library/boot：配置 + 类型 + 列表（带进度）+ 元数据脚本一次取回', Boolean(boot?.config) && Array.isArray(boot.types) && Array.isArray(boot.items?.items) && Array.isArray(boot.tagScripts?.items), J(Object.keys(boot || {})))
  check('配置里有缩略图分批 / 线程池设置', typeof cfg.libraryThumbFirstBatch === 'number' && typeof cfg.libraryThumbBatch === 'number' && typeof cfg.libraryThumbConcurrency === 'number' && typeof cfg.threadPoolSize === 'number', J(cfg))
  const list = await raw('/api/library/items?type=all&page=1&limit=5')
  const etag = list.headers.get('etag')
  check('列表接口带 ETag；带 If-None-Match 再取是 304', Boolean(etag) && (await raw('/api/library/items?type=all&page=1&limit=5', { 'if-none-match': etag })).status === 304)
  const staticBr = await raw('/app.js', { 'accept-encoding': 'br' })
  check('静态文件：br 压缩 + ETag，If-None-Match 命中 304', staticBr.headers.get('content-encoding') === 'br' && Boolean(staticBr.headers.get('etag')) && (await raw('/app.js', { 'if-none-match': staticBr.headers.get('etag') })).status === 304)
  const first = (boot?.items?.items || []).find((i) => i.cover)
  if (first) {
    const t = await raw(first.cover)
    check('缩略图：ETag + Last-Modified + 长缓存，带 If-None-Match 是 304', t.status === 200 && Boolean(t.headers.get('etag')) && /max-age=86400/.test(t.headers.get('cache-control') || '') && (await raw(first.cover, { 'if-none-match': t.headers.get('etag') })).status === 304, J([...t.headers.entries()].slice(0, 8)))
  }
  const withSeries = (boot?.items?.items || []).find((i) => i.series)
  check('列表项里系列只带摘要（series.primary），不带 members', !withSeries || (!('members' in withSeries.series) && Boolean(withSeries.series.primary)))
}

const items = (await get('/api/library/items?page=1&limit=200')).body.items || []
const byProfile = (p) => items.find((i) => i.sourceProfile === p)
const galItems = items.filter((i) => i.type === 'gal')
const G = galItems.find((i) => i.title === 'UViewer演示') || byProfile('gal-import')
const T = byProfile('text-media')
const E = items.find((i) => i.type === 'epub')
check('媒体库里有：Gal 媒体、文本媒体、EPUB', Boolean(G && T && E), J(items.map((i) => [i.type, i.sourceProfile, i.title]).slice(0, 12)))
if (EXPECT_ARCHIVE) check('媒体库里有压缩包图集条目（点标签新页规则的对象）', items.some((i) => i.sourceProfile === 'archive-gallery'))

// ---- Gal：目录方案 + 浏览节点 + 分支 ----
if (G) {
  check('Gal 条目：一个目录 = 一个媒体，只有 1 个单元', G.unitCount === 1, J(G.unitCount))
  // 导入后自动排了元数据脚本 gal-layout：等它把 config 写好（config.script.version）
  let full = null
  for (let i = 0; i < 60; i++) { full = (await get(`/api/library/items/gal/${G.itemId}`)).body; if (full?.config?.script?.version) break; await new Promise((r) => setTimeout(r, 1000)) }
  check('导入后元数据脚本 gal-layout 自动跑过：config.script 记着脚本 id 和版本；状态标签「Gal配置version」', full?.config?.script?.id === 'gal-layout' && /^\d+\.\d+/.test(full.config.script.version) && (full.tags || []).some((t) => t.startsWith('Gal配置version:')), J([full?.config?.script, full?.tags]))
  check('config 里是脚本探测出的结构：脚本根（text + 日文）、资源根 resources、名称文件、缩略图目录；脚本数；封面', full.config.scriptRoots?.length >= 2 && full.config.resourceRoots?.[0] === 'resources' && full.config.namesFiles?.[0] === 'user_data/character_names.json' && full.config.thumbsDirs?.[0] === 'user_data/thumbnails' && full.scriptCount >= 50 && Boolean(full.coverPath), J(full.config).slice(0, 300))
  check('元数据里没有目录树/脚本清单；只有路径、adapters、标题、config', !('layout' in full) && J(full.adapters) === J(['uviewer-csv']) && !J(full).includes('600130.txt'))
  const node = async (id) => (await get(`/api/library/items/gal/${G.itemId}/reader/main?sectionId=${encodeURIComponent(id)}`)).body
  const home = await node('')
  check('Gal 首页：卡片，真实目录树（9 个目录），有文本版本下拉（text + 另一套）', home.node.kind === 'cards' && home.node.items.length === 9 && home.node.sets.length === 2, J(home.node.items.map((i) => i.title)))
  const chars = await node('d:character')
  check('角色页：名称文件里的名字（卡蒂娅/小夜）+ 没名字的编号 + 头像', chars.node.items.map((i) => i.title).join() === '卡蒂娅,小夜,2001' && chars.node.items[0].thumb, J(chars.node.items.map((i) => i.title)))
  const avatar = await get(`/api/library/items/gal/${G.itemId}/resource?path=${encodeURIComponent(chars.node.items[0].thumb)}`)
  check('头像资源能取到（相对资源根解析）', avatar.status === 200 && avatar.type.startsWith('image/'), String(avatar.status))
  const merged = await node('d:character/1003')
  check('角色目录合并：卡蒂娅这一层直接是脚本（adultr + extra 合并，5 个），每个带来源标记 adu / ext', merged.node.items.length === 5 && merged.node.items.every((i) => i.type === 'script') && merged.node.items.map((i) => i.badge).join() === 'adu,ext,adu,adu,adu', J(merged.node.items.map((i) => [i.title, i.badge])))
  const cab = await node('d:cabin/adultr')
  const thumb = cab.node.items.find((i) => i.thumb.startsWith('~/'))
  check('UViewer 自己生成的缩略图（user_data/thumbnails）也能用', thumb && (await get(`/api/library/items/gal/${G.itemId}/resource?path=${encodeURIComponent(thumb.thumb)}`)).status === 200)
  check('不能通过资源接口读 user_data 里别的文件（license.dat）', (await get(`/api/library/items/gal/${G.itemId}/resource?path=${encodeURIComponent('~/user_data/license.dat')}`)).status >= 400)
  const branch = await node('s:character/1003/adultr/100300.txt')
  check('分支脚本：场景里有 choice 和条件；多余的 endif 被容忍', branch.scene.steps.some((s) => s.commands.some((c) => c.op === 'choice')) && branch.scene.steps.some((s) => s.commands.some((c) => c.when)) && branch.scene.stats.unmatchedEndif === 1)
  check('分支脚本：返回上一级是合并后的卡蒂娅列表，上下话是列表里相邻的脚本（跨来源）', branch.node.parent === 'd:character/1003' && branch.sectionNavigation.next?.sectionId.endsWith('10030302.txt'))
  const room2 = await node('d:room#2')
  check('房间列表翻页：第 2 页有内容、带页码', room2.node.page === 2 && room2.node.items.length > 0)
  const jp = await node('@text---日文20251102|d:')
  check('另一套文本（日文）能浏览', jp.node.items.length === 2)
}

// ---- EPUB：朗读规则 ----
if (E) {
  const unit = (await get(`/api/library/items/epub/${E.itemId}/units`)).body[0]
  const reader = (await get(`/api/library/items/epub/${E.itemId}/reader/${encodeURIComponent(unit.unitId)}`)).body
  const sentences = reader.sentences || []
  const ja = sentences.find((s) => s.flag === 'ja'), zh = sentences.find((s) => s.flag === 'zh' && s.text.length > 4)
  check('EPUB 阅读器：句子带 flag（淡色段落 = ja，其余 = zh）', Boolean(ja && zh) && /data-tts-flag="ja"/.test(reader.content), J(sentences.slice(0, 4)))
  if (ja && zh) {
    const r = await post(`/api/epub/${E.itemId}/tts-chunk`, { texts: [ja.text, zh.text], flags: ['ja', 'zh'] })
    const [cj, cz] = r.body?.chunks || []
    check('混合 flag 的朗读请求：两句各自合成（地址不同），没有报错', r.status === 200 && cj?.url && cz?.url && cj.url !== cz.url && !cj.error && !cz.error, J(r.body))
    const aj = await get(cj.url), az = await get(cz.url)
    check('合成的音频能取回（wav）', aj.status === 200 && az.status === 200 && /wav/.test(aj.type))
    const same = await post(`/api/epub/${E.itemId}/tts-chunk`, { texts: [zh.text, zh.text], flags: ['ja', 'zh'] })
    const [sj, sz] = same.body.chunks
    const wj = await get(sj.url), wz = await get(sz.url)
    const cjn = crossings(wj.buf), czn = crossings(wz.buf)
    check('同一句话：ja 和 zh 用了不同的参数 → 不同的缓存地址、音高不同（模拟 TTS 按参数变音高）', sj.url !== sz.url && Math.abs(cjn - czn) > Math.max(cjn, czn) * 0.1, J([cjn, czn]))
    const again = await post(`/api/epub/${E.itemId}/tts-chunk`, { texts: [ja.text, zh.text], flags: ['ja', 'zh'] })
    check('再请求：命中缓存（地址不变）', J(again.body.chunks.map((c) => c.url)) === J([cj.url, cz.url]))
    const hash = createHash('sha1').update('x').digest('hex')
    void hash
  }
}

// ---- Gal：monmusu（Ren'Py）和 tenkeiprdx（Unity 剧情 JSON + Spine）----
{
  const waitScript = async (item) => {
    let full = null
    for (let i = 0; i < 60; i++) { full = (await get(`/api/library/items/gal/${item.itemId}`)).body; if (full?.config?.script?.version) break; await new Promise((r) => setTimeout(r, 1000)) }
    return full
  }
  const resource = (item, p) => get(`/api/library/items/gal/${item.itemId}/resource?path=${encodeURIComponent(p)}`)
  const readerNode = async (item, id) => (await get(`/api/library/items/gal/${item.itemId}/reader/main?sectionId=${encodeURIComponent(id)}`)).body

  const MM = galItems.find((i) => i.title === 'monmusu演示')
  check('媒体库里有 monmusu 演示媒体', Boolean(MM))
  if (MM) {
    const full = await waitScript(MM)
    check('monmusu：导入时填的 adapter / game.id 在；脚本 gal-layout 跑过（游戏根 game/）；标签 Gal游戏: monmusu', J(full.adapters) === J(['renpy-monmusu']) && full.config.game?.id === 'monmusu' && full.config.script?.id === 'gal-layout' && full.config.resourceRoots?.[0] === 'game' && (full.tags || []).includes('Gal游戏: monmusu'), J([full.adapters, full.config.game, full.config.script, full.tags]))
    const root = await readerNode(MM, '')
    check('monmusu 首页：三个入口 动画 / 事件 / 总览', J(root.node.items.map((i) => [i.title, i.node])) === J([['动画', 'd:hscene'], ['事件', 'd:hscene_still'], ['总览', 'd:overview']]), J(root.node.items))
    const home = await readerNode(MM, 'd:overview')
    check('monmusu 总览：按角色编号分组成卡片（10001 三个、10004 一个），有头像', J(home.node.items.map((i) => [i.title, i.subtitle])) === J([['10001', '3 项'], ['10004', '1 项']]) && home.node.items.every((i) => i.thumb), J(home.node.items))
    const group = await readerNode(MM, home.node.items[0].node)
    check('monmusu 总览分组页：动画 + 静图混排，角标 anim / still', group.node.items.map((i) => i.badge).join() === 'anim,anim,still', J(group.node.items))
    const play = await readerNode(MM, group.node.items[0].node)
    const movie = play.scene.steps.flatMap((s) => s.commands).find((c) => c.op === 'movie')
    check('monmusu 播放页：视频别名查表成 movie；资源路径相对游戏根', movie?.srcs?.[0] === 'images/webm/10001/rev10001_01_10.webm' && play.scene.steps.length === 2, J(movie))
    const still = await readerNode(MM, group.node.items[2].node)
    check('monmusu 静图：scene 图片名按文件名查到（头像/背景图能取）', still.scene.steps[0].commands.some((c) => c.op === 'bg' && c.src === 'images/bg/r18_10001_stla1.png') && (await resource(MM, home.node.items[0].thumb)).status === 200, J(still.scene.steps[0].commands))
  }

  const MG = galItems.find((i) => i.title === 'minashigo演示')
  check('媒体库里有 minashigo 演示媒体', Boolean(MG))
  if (MG) {
    const full = await waitScript(MG)
    check('minashigo：adapter renpy-minashigo / game.id minashigo；脚本 gal-layout 跑过（游戏根 MinashigoViewer-1.2/game）；脚本数 5；标签 Gal游戏: minashigo', J(full.adapters) === J(['renpy-minashigo']) && full.config.game?.id === 'minashigo' && full.config.script?.id === 'gal-layout' && full.config.resourceRoots?.[0] === 'MinashigoViewer-1.2/game' && full.scriptCount === 5 && (full.tags || []).includes('Gal游戏: minashigo'), J([full.adapters, full.config.game, full.config.resourceRoots, full.scriptCount, full.tags]))
    const home = await readerNode(MG, '')
    check('minashigo 首页：角色 / 活动 / 主线 三个分类（不再平铺脚本）', J(home.node.items.map((i) => [i.title, i.type])) === J([['角色', 'dir'], ['活动', 'dir'], ['主线', 'dir']]), J(home.node.items.map((i) => [i.title, i.subtitle])))
    const chars = await readerNode(MG, home.node.items.find((i) => i.title === '角色').node)
    check('minashigo 角色：按角色编号分组（302201 两个脚本、100101 一个）', chars.node.items.map((i) => `${i.title}:${i.subtitle}`).sort().join() === '100101:1 项,302201:2 项', J(chars.node.items.map((i) => [i.title, i.subtitle])))
    const group = await readerNode(MG, chars.node.items.find((i) => i.title === '302201').node)
    const play = await readerNode(MG, group.node.items.find((i) => i.title === 'scene_130220102').node)
    const ops = play.scene.steps.flatMap((s) => s.commands)
    check('minashigo 播放页：立绘（图集裁剪部件）/ 说话人（$ name=）/ 语音（voice2）/ 背景；立绘图集能取', play.scene.adapter === 'renpy-minashigo' && ops.some((c) => c.op === 'stand' && c.parts.length === 2 && c.parts[0].crop) && ops.some((c) => c.op === 'speaker' && c.segments[0]?.text === 'ワーテルロー') && ops.some((c) => c.op === 'voice') && ops.some((c) => c.op === 'bg' && c.src === 'images/bg/bg5000604.jpg') && (await resource(MG, 'images/stand/302201stand_a.png')).status === 200, J(play.scene.stats))
  }

  const TK = galItems.find((i) => i.title === 'tenkeiprdx演示')
  check('媒体库里有 tenkeiprdx 演示媒体', Boolean(TK))
  if (TK) {
    const full = await waitScript(TK)
    check('tenkeiprdx：adapter / game.id 在；脚本 gal-layout 跑过（素材根在 StreamingAssets/…/Imported）', J(full.adapters) === J(['tenkeiprdx-json']) && full.config.game?.id === 'tenkeiprdx' && full.config.script?.id === 'gal-layout' && /Imported$/.test(full.config.resourceRoots?.[0] || '') && full.scriptCount === 4, J([full.config.game, full.config.script, full.scriptCount]))
    const home = await readerNode(TK, '')
    check('tenkeiprdx 首页 = 列表：活动 / 附加 / 角色 / 全部剧情', J(home.node.items.map((i) => [i.title, i.subtitle])) === J([['活动', '1 项'], ['附加', '1 项'], ['角色', '2 项'], ['全部剧情', '4 项']]), J(home.node.items))
    const events = await readerNode(TK, home.node.items[0].node)
    check('活动列表：名字（名称表）、角标 event、缩略图', J(events.node.items.map((i) => [i.title, i.badge])) === J([['The First Event', 'event']]) && (await resource(TK, events.node.items[0].thumb)).status === 200, J(events.node.items))
    const arrayScene = await readerNode(TK, 's:22000003201.json')
    check('tenkeiprdx 位置数组形剧情（没有键名的游戏原始数据）：能识别、4 步、noBGM 停 BGM', arrayScene.node.kind === 'player' && arrayScene.scene.steps.length === 4 && arrayScene.scene.stats.form === 'array' && arrayScene.scene.steps.flatMap((st) => st.commands).some((c) => c.op === 'bgmStop'), J(arrayScene.scene?.stats))
    const people = await readerNode(TK, home.node.items[2].node)
    check('角色列表：名字 + 称号 + 头像；角色页：EX 剧情', J(people.node.items.map((i) => i.title)) === J(['Bob', 'Alice']) && (await resource(TK, people.node.items[1].thumb)).status === 200 && (await readerNode(TK, people.node.items[1].node)).node.items[0].title === 'Alice EX', J(people.node.items))
    const story = await readerNode(TK, (await readerNode(TK, people.node.items[1].node)).node.items[0].node)
    const ops = story.scene.steps.flatMap((s) => s.commands)
    check('tenkeiprdx 剧情：立绘（二进制 + JSON 骨骼）、语音（场景 id 目录）、BGM（_loop 版）、说话人（username.txt）；标题 = 列表里的名字', story.node.title === 'Alice EX' && ops.some((c) => c.op === 'spine' && c.skel === 'Spines/1001/1001_01.skel.bytes') && ops.some((c) => c.op === 'spine' && c.skel === 'Spines/1002/1002_01.skel.bytes') && ops.some((c) => c.op === 'voice' && c.src === 'AdventureVoice/10010101/v002.ogg') && ops.some((c) => c.op === 'bgm' && c.src === 'BGM/bgm_a_loop.ogg') && ops.some((c) => c.op === 'speaker' && c.segments[0]?.text === 'Tester') && Object.keys(story.scene.stats.unresolved).length === 0, J(story.scene.stats))
    const still = await readerNode(TK, events.node.items[0].node)
    const sops = still.scene.steps.flatMap((s) => s.commands)
    check('tenkeiprdx 静态画面：两层骨架、镜头、联动背景音效、闪屏', sops.filter((c) => c.op === 'spine' && c.slot.startsWith('still')).length >= 2 && sops.some((c) => c.op === 'camera') && sops.some((c) => c.op === 'bgse') && sops.some((c) => c.op === 'flash'))
    const skel = await resource(TK, 'Spines/1001/1001_01.skel.bytes')
    check('tenkeiprdx 资源：骨骼 / atlas / 图集 / 缩略图都能取', skel.status === 200 && (await resource(TK, 'Spines/1001/1001_01.atlas.txt')).status === 200 && (await resource(TK, 'Spines/1001/1001_01.png')).status === 200 && (await resource(TK, events.node.items[0].thumb)).status === 200)
  }

  const runtime = await get('/vendor/spine-webgl.js')
  check('Spine 运行时（官方 3.8 spine-webgl）已随镜像下载好，能被页面取到', runtime.status === 200 && runtime.buf.length > 300000 && /javascript/.test(runtime.type) && runtime.buf.toString('utf8', 0, 20000).includes('spine'), J([runtime.status, runtime.buf.length, runtime.type]))
}
// ---- 文本媒体 ----
if (T) check('文本媒体条目：1 个单元，类型 text', T.unitCount === 1)

// ---- 新页面规则：判断由前端做，这里只检查规则本身合法 ----
check('新页面规则每条至少有 profile 或 kind', [...(cfg.mediaOpenInNewTabRules || []), ...(cfg.tagSearchOpenInNewTabRules || [])].every((r) => r.profile || r.kind))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
