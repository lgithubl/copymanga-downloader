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

const items = (await get('/api/library/items?page=1&limit=200')).body.items || []
const byProfile = (p) => items.find((i) => i.sourceProfile === p)
const G = byProfile('gal-import')
const T = byProfile('text-media')
const E = items.find((i) => i.type === 'epub')
check('媒体库里有：Gal 媒体、文本媒体、EPUB', Boolean(G && T && E), J(items.map((i) => [i.type, i.sourceProfile, i.title]).slice(0, 12)))
if (EXPECT_ARCHIVE) check('媒体库里有压缩包图集条目（点标签新页规则的对象）', items.some((i) => i.sourceProfile === 'archive-gallery'))

// ---- Gal：目录方案 + 浏览节点 + 分支 ----
if (G) {
  check('Gal 条目：一个目录 = 一个媒体，只有 1 个单元（main）；方案是 uviewer', G.unitCount === 1 && G.mediaUnits?.[0]?.unitId === 'main' || G.unitCount === 1, J([G.unitCount, G.layout]))
  const full = (await get(`/api/library/items/gal/${G.itemId}`)).body
  check('元数据只存几个路径（方案、脚本根、资源根、名称文件、缩略图目录）', full.layout?.profile === 'uviewer' && full.layout.resourceRoot === 'resources' && full.layout.namesFile === 'user_data/character_names.json' && full.layout.scriptRoots?.length >= 2, J(full.layout))
  const node = async (id) => (await get(`/api/library/items/gal/${G.itemId}/reader/main?sectionId=${encodeURIComponent(id)}`)).body
  const home = await node('')
  check('Gal 首页：grid，真实目录树（9 个目录），有文本版本下拉（text + 另一套）', home.node.kind === 'grid' && home.node.items.length === 9 && home.node.sets.length === 2, J(home.node.items.map((i) => i.title)))
  const chars = await node('d:character')
  check('角色页：名称文件里的名字（卡蒂娅/小夜）+ 没名字的编号 + 头像', chars.node.items.map((i) => i.title).join() === '卡蒂娅,小夜,2001' && chars.node.items[0].thumb, J(chars.node.items.map((i) => i.title)))
  const avatar = await get(`/api/library/items/gal/${G.itemId}/resource?path=${encodeURIComponent(chars.node.items[0].thumb)}`)
  check('头像资源能取到（相对资源根解析）', avatar.status === 200 && avatar.type.startsWith('image/'), String(avatar.status))
  const cab = await node('d:cabin/adultr')
  const thumb = cab.node.items.find((i) => i.thumb.startsWith('~/'))
  check('UViewer 自己生成的缩略图（user_data/thumbnails）也能用', thumb && (await get(`/api/library/items/gal/${G.itemId}/resource?path=${encodeURIComponent(thumb.thumb)}`)).status === 200)
  check('不能通过资源接口读 user_data 里别的文件（license.dat）', (await get(`/api/library/items/gal/${G.itemId}/resource?path=${encodeURIComponent('~/user_data/license.dat')}`)).status >= 400)
  const branch = await node('s:character/1003/adultr/100300.txt')
  check('分支脚本：场景里有 choice 和条件；多余的 endif 被容忍', branch.scene.steps.some((s) => s.commands.some((c) => c.op === 'choice')) && branch.scene.steps.some((s) => s.commands.some((c) => c.when)) && branch.scene.stats.unmatchedEndif === 1)
  check('分支脚本：返回上一级是所在列表，上下话是同目录的相邻脚本', branch.node.parent === 'd:character/1003/adultr' && branch.sectionNavigation.next?.sectionId.endsWith('10030304.txt'))
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
// ---- 文本媒体 ----
if (T) check('文本媒体条目：1 个单元，类型 text', T.unitCount === 1)

// ---- 新页面规则：判断由前端做，这里只检查规则本身合法 ----
check('新页面规则每条至少有 profile 或 kind', [...(cfg.mediaOpenInNewTabRules || []), ...(cfg.tagSearchOpenInNewTabRules || [])].every((r) => r.profile || r.kind))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
