#!/usr/bin/env node
// 元数据脚本「分层配置」+ 压缩包脚本拆分的自测：
//   - library/script-options.mjs：byType / byProfile / scriptEnabled / 深合并 / 配置指纹
//   - 路径标签（archive-gallery-tags-v1 3.x）：只解析路径、不限类型；pathDepth / exclude / 目录当名字
//   - 缩略图脚本（archive-gallery-thumbnail-v1 2.x）：页数 + ComicInfo 挪到这里
//   - 服务端：libraryTypes 不适用就跳过、scriptEnabled: false 跳过且不动已有标签、配置变了不再「同版本跳过」、
//     标签换归属（页数从路径标签挪到缩略图脚本）时不会被旧归属方的重跑误删、查看生效配置接口
//
//   node scripts/dev/script-layers-selftest.mjs [站点地址]        只给纯函数部分就不传地址
//   可选 SELFTEST_DATA_DIR=<服务端的 DATA_DIR>：给了才测「标签换归属」（要改服务端的运行记录文件）
// 会上传一个测试压缩包和一个测试「媒体」条目，并改写两个脚本的用户配置（结束时重置）。需要 python3 打 zip。
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '../..')
const { resolveScriptOptions, optionsFingerprint, deepMerge, scriptAppliesToType } = await import(path.join(root, 'web/library/script-options.mjs'))
const pathTags = await import(path.join(root, 'scripts/tag-scripts/archive-gallery-tags-v1/main.js'))
const thumb = await import(path.join(root, 'scripts/tag-scripts/archive-gallery-thumbnail-v1/main.js'))
const pathManifest = JSON.parse(await readFile(path.join(root, 'scripts/tag-scripts/archive-gallery-tags-v1/manifest.json'), 'utf8'))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ================= 纯函数：分层配置 =================
{
  const defaults = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2], byType: { media: { a: 2, scriptEnabled: false } } }
  const user = { nested: { y: 3 }, byType: { media: { scriptEnabled: true }, gal: { a: 9 } }, byProfile: { 'text-media': { a: 5, nested: { x: 7 } } } }
  const base = resolveScriptOptions({ defaultOptions: defaults, userOptions: user })
  check('分层：不指定类型 = 默认 + 全局（嵌套对象深合并，只改 y）', J(base.options) === J({ a: 1, nested: { x: 1, y: 3 }, list: [1, 2] }) && base.enabled && base.layers.length === 0, J(base))
  const media = resolveScriptOptions({ defaultOptions: defaults, userOptions: user, type: 'media' })
  check('分层：byType 的默认和用户覆盖也深合并（默认 a=2 保留，用户把 scriptEnabled 改回 true）', media.options.a === 2 && media.enabled && J(media.layers) === J(['byType.media']), J(media))
  const text = resolveScriptOptions({ defaultOptions: defaults, userOptions: user, type: 'media', profile: 'text-media' })
  check('分层：byProfile 比 byType 更优先', text.options.a === 5 && text.options.nested.x === 7 && text.options.nested.y === 3 && J(text.layers) === J(['byType.media', 'byProfile.text-media']), J(text))
  check('分层：交给脚本的配置里没有 byType / byProfile / scriptEnabled', !('byType' in text.options) && !('byProfile' in text.options) && !('scriptEnabled' in text.options))
  const off = resolveScriptOptions({ defaultOptions: defaults, userOptions: {}, type: 'media' })
  check('分层：scriptEnabled: false → enabled 为 false', off.enabled === false)
  check('分层：数组整个替换，不拼接', J(deepMerge({ l: [1, 2] }, { l: [3] }).l) === J([3]))
  check('配置指纹：键顺序无关、值变了就变', optionsFingerprint({ a: 1, b: { c: 2, d: 3 } }) === optionsFingerprint({ b: { d: 3, c: 2 }, a: 1 }) && optionsFingerprint({ a: 1 }) !== optionsFingerprint({ a: 2 }))
  check('libraryTypes：空 = 不限；声明了就只认这些', scriptAppliesToType({ libraryTypes: [] }, 'gal') && scriptAppliesToType({ libraryTypes: ['archive'] }, 'archive') && !scriptAppliesToType({ libraryTypes: ['archive'] }, 'media'))
  const anidbLike = resolveScriptOptions({ defaultOptions: { enabled: false } })
  check('脚本自己的 enabled 选项不受影响（服务端只认 scriptEnabled）', anidbLike.enabled === true && anidbLike.options.enabled === false, J(anidbLike))
}

// ================= 纯函数：路径标签 =================
{
  const r = pathTags.parseFilenameTags('/input/[目录作者]/[社团 (作者)] 新书 (某原作) [中国翻訳].zip')
  check('路径标签：和 2.x 一样的 ARegexParse 结果（目录 + 文件名，按顺序去重）', J(r.tags) === J(['tag:目录作者', 'group:社团', 'tag:作者', 'tag:中国翻訳', 'tag:某原作']) && r.title === '新书', J(r))
  const deep = pathTags.parseFilenameTags('/mnt/[整理]/[作者A]/book.zip', { pathDepth: 1 })
  check('路径标签：pathDepth 1 只解析最后一层目录（挂载根目录的 [整理] 不算）', J(deep.tags) === J(['tag:作者A']), J(deep))
  const ex = pathTags.parseFilenameTags('[字幕组] 标题 [1080p] (2023).mkv', { exclude: ['^\\d{3,4}p$', '^(?:19|20)\\d{2}$'] })
  check('路径标签：exclude 正则匹配到的括号内容不生成标签', J(ex.tags) === J(['tag:字幕组']), J(ex))
  const logs = []
  const bad = pathTags.parseFilenameTags('[a] b', { exclude: ['('], logs })
  check('路径标签：exclude 里的无效正则忽略并记日志，不影响其它', J(bad.tags) === J(['tag:a']) && logs.some((l) => /无效/.test(l)), J({ bad, logs }))
  const dir = pathTags.parseFilenameTags('/data/gal/[社团] 作品 v1.2', { isDir: true, pathDepth: 1 })
  check('路径标签：目录当名字时不去「扩展名」（v1.2 保留）', J(dir.tags) === J(['tag:社团']) && dir.title === '作品 v1.2', J(dir))
  const ns = pathTags.parseFilenameTags('[社团 (作者)] x.zip', { namespaces: { group: 'circle' } })
  check('路径标签：namespaces 只写 group 时 tag 前缀保留默认', J(ns.tags) === J(['circle:社团', 'tag:作者']), J(ns))
  const src = (item, units) => pathTags.sourcePathOf(item, units).source
  check('路径来源：压缩包 sourceFile > LRR 路径 > 媒体来源目录 > 单个上传文件 > Gal 目录 > 单本 EPUB 文件名 > 标题',
    src({ origin: { sourceFile: 'a' } }) === 'origin.sourceFile' && src({ origin: { lrr: { file: 'a' } } }) === 'origin.lrr.file'
      && src({ origin: { sourcePath: '/x' } }) === 'origin.sourcePath' && src({ origin: { sourceFiles: ['a.mp4'] } }) === 'origin.sourceFiles'
      && src({ origin: { sourceFiles: ['a', 'b'] }, title: 't' }) === 'title' && src({ source: { path: '/g' } }) === 'source.path'
      && src({}, [{ fileName: 'b.epub' }]) === 'unit.fileName' && src({ title: 't' }) === 'title')
  check('路径标签 manifest：不限类型，默认对 media / gal / epub 关闭', J(pathManifest.libraryTypes) === '[]' && ['media', 'gal', 'epub'].every((t) => pathManifest.options.byType[t].scriptEnabled === false))
  const ci = thumb.parseComicInfo('<ComicInfo><Writer>甲、乙</Writer><Series>S</Series><Genre>g1,g2</Genre><Tags>x;y</Tags><LanguageISO>ZH</LanguageISO></ComicInfo>')
  check('缩略图脚本：ComicInfo 解析（挪过来后行为不变）', J(ci) === J(['artist:甲', 'artist:乙', 'series:S', 'genre:g1', 'genre:g2', 'x', 'y', 'language:zh']), J(ci))
}

// ================= 接口：真实服务端 =================
const BASE = (process.argv[2] || '').replace(/\/$/, '')
if (BASE) {
  const api = async (p, init = {}) => {
    const res = await fetch(BASE + p, init)
    const text = await res.text()
    let body; try { body = JSON.parse(text) } catch { body = text }
    return { status: res.status, body }
  }
  const postJson = (p, v) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(v) })
  const getItem = async (type, id) => (await api(`/api/library/items/${type}/${encodeURIComponent(id)}`)).body
  const setConfig = (id, options) => postJson(`/api/tag-scripts/${id}/config`, { options })
  const resetConfig = (id) => api(`/api/tag-scripts/${id}/config`, { method: 'DELETE' })
  const run = async (type, itemId, scriptId, force = true) => {
    const created = await postJson(`/api/library/items/${type}/${encodeURIComponent(itemId)}/tag-scripts`, { actionIds: [scriptId], force })
    const jobId = created.body?.job?.id
    if (!jobId) return { error: J(created.body) }
    for (let i = 0; i < 200; i++) {
      const job = (await api(`/api/tag-jobs/${jobId}`)).body
      if (['completed', 'failed'].includes(job.status)) return job.results?.[0] || job
      await sleep(250)
    }
    return { error: '超时' }
  }
  const PATH = 'archive-gallery-tags-v1'
  const THUMB = 'archive-gallery-thumbnail-v1'
  await resetConfig(PATH)
  await resetConfig(THUMB)
  const work = await mkdtemp(path.join(os.tmpdir(), 'script-layers-'))
  try {
    // ---- 压缩包：两张图 + ComicInfo ----
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await writeFile(path.join(work, '001.png'), png)
    await writeFile(path.join(work, '002.png'), png)
    await writeFile(path.join(work, 'ComicInfo.xml'), '<ComicInfo><Writer>作者丙</Writer><Series>测试系列</Series></ComicInfo>')
    const zipName = '[社团 (作者)] 分层测试本 (原作).zip'
    execFileSync('python3', ['-I', '-c', 'import sys,zipfile,os\nd,out=sys.argv[1],sys.argv[2]\nz=zipfile.ZipFile(out,"w")\nfor f in ["001.png","002.png","ComicInfo.xml"]: z.write(os.path.join(d,f),f)\nz.close()', work, path.join(work, 'book.zip')])
    const form = new FormData()
    form.set('importProfile', 'archive-gallery')
    form.append('file', new Blob([await readFile(path.join(work, 'book.zip'))]), zipName)
    const up = await api('/api/library/items?type=archive', { method: 'POST', body: form })
    const archiveId = up.body?.items?.[0]?.itemId
    check('上传测试压缩包', Boolean(archiveId), J(up.body).slice(0, 300))

    let r = await run('archive', archiveId, THUMB)
    let item = await getItem('archive', archiveId)
    // 封面要 ImageMagick（本机可能没有，镜像里有）：这里只要求有封面状态标签；封面失败也不能拖累页数 / ComicInfo
    check('缩略图脚本：产出 页数: 2 + ComicInfo 标签，回写页数（封面成败不影响这两样）', r.status === 'completed' && ['页数: 2', 'artist:作者丙', 'series:测试系列'].every((t) => item.tags.includes(t)) && item.tags.some((t) => /^压缩包封面: (有|失败)$/.test(t)) && item.pageCount === 2, J([r, item.tags, item.pageCount]))
    r = await run('archive', archiveId, PATH)
    item = await getItem('archive', archiveId)
    check('路径标签：从上传的文件名解析 group:社团 / tag:作者 / tag:原作，页数和 ComicInfo 标签不受影响', r.status === 'completed' && ['group:社团', 'tag:作者', 'tag:原作', '页数: 2', 'artist:作者丙'].every((t) => item.tags.includes(t)), J([r, item.tags]))

    // 标签换归属：模拟 2.x 的路径标签运行记录里还记着「页数: 2」，再重跑路径标签 —— 页数现在归缩略图脚本，不能被删
    if (process.env.SELFTEST_DATA_DIR) {
      const runFile = path.join(process.env.SELFTEST_DATA_DIR, 'cache', 'library', 'tag-runs', 'archive', archiveId, `${PATH}.json`)
      const record = JSON.parse(await readFile(runFile, 'utf8'))
      record.itemTags = [...record.itemTags, '页数: 2', 'artist:作者丙']
      delete record.optionsHash
      await writeFile(runFile, JSON.stringify(record))
      r = await run('archive', archiveId, PATH)
      item = await getItem('archive', archiveId)
      check('标签换归属：旧运行记录里有、别的脚本现在也产出的标签（页数 / ComicInfo），重跑旧归属方不会删', r.status === 'completed' && item.tags.includes('页数: 2') && item.tags.includes('artist:作者丙'), J(item.tags))
    }

    // byProfile：只对「压缩包图集」导入方案改 tag 前缀
    await setConfig(PATH, { byProfile: { 'archive-gallery': { namespaces: { tag: 't' } } } })
    r = await run('archive', archiveId, PATH, false)
    item = await getItem('archive', archiveId)
    check('配置变了：不带 force 也会重跑（不再「同版本已生成，跳过」）', r.status === 'completed', J(r))
    check('byProfile：archive-gallery 方案的 tag 前缀改成 t，group 不变，旧的 tag: 被替换', ['group:社团', 't:作者', 't:原作'].every((t) => item.tags.includes(t)) && !item.tags.includes('tag:作者'), J(item.tags))
    r = await run('archive', archiveId, PATH, false)
    check('配置没变：不带 force 跳过', r.status === 'skipped' && /同版本/.test(r.message), J(r))

    // ---- 媒体：上传一个文件名带括号的视频 ----
    const mf = new FormData()
    mf.append('file', new Blob([Buffer.alloc(2048)]), '[社团B (作者B)] 分层测试视频 [1080p] (2023).mp4')
    const mu = await api('/api/library/items?type=media', { method: 'POST', body: mf })
    const mediaId = mu.body?.itemId
    const media = mediaId ? await getItem('media', mediaId) : null
    check('媒体上传：记下了上传的文件名（origin.sourceFiles）', Boolean(media?.origin?.sourceFiles?.includes('[社团B (作者B)] 分层测试视频 [1080p] (2023).mp4')), J(mu.body).slice(0, 300))
    if (mediaId) {
      r = await run('media', mediaId, THUMB)
      check('libraryTypes：缩略图脚本对媒体条目跳过（不适用），不报错', r.status === 'skipped' && /不适用/.test(r.message), J(r))
      r = await run('media', mediaId, PATH)
      let mediaItem = await getItem('media', mediaId)
      check('路径标签默认对媒体关闭：跳过，提示是 byType.media 里关的', r.status === 'skipped' && /byType\.media/.test(r.message) && !mediaItem.tags.some((t) => /^(group|tag):/.test(t)), J(r))
      await setConfig(PATH, { byType: { media: { scriptEnabled: true } } })
      r = await run('media', mediaId, PATH)
      mediaItem = await getItem('media', mediaId)
      check('byType.media 打开后：解析出 group:社团B / tag:作者B；默认的 exclude 把 1080p 和 2023 挡掉了', r.status === 'completed' && ['group:社团B', 'tag:作者B'].every((t) => mediaItem.tags.includes(t)) && !mediaItem.tags.some((t) => /1080p|2023/.test(t)), J([r, mediaItem.tags]))
      const eff = (await api(`/api/tag-scripts/${PATH}/effective-options?type=media&profile=`)).body
      check('查看生效配置：媒体套用了 byType.media，已打开，pathDepth=1，exclude 来自默认', eff.enabled === true && J(eff.layers) === J(['byType.media']) && eff.options.pathDepth === 1 && eff.options.exclude.length >= 3 && !('byType' in eff.options), J(eff))
      const effThumb = (await api(`/api/tag-scripts/${THUMB}/effective-options?type=media`)).body
      check('查看生效配置：缩略图脚本对媒体显示不适用', effThumb.applies === false && J(effThumb.libraryTypes) === J(['archive']), J(effThumb))
    }
  } finally {
    await resetConfig(PATH)
    await resetConfig(THUMB)
    await rm(work, { recursive: true, force: true }).catch(() => {})
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
