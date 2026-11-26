#!/usr/bin/env node
// 字段映射 / 回填脚本（rj-series-v1 2.x）的自测：
//   - 默认配置和 1.x「RJ 系列生成」完全一样（原档 > 自身 > 导入编号，preferOriginal / tagPrefix / dryRun 老选项照认）
//   - 规则：from 候选 / 常量 / 模板、transform、map（大小写可配：规则级 mapIgnoreCase 和外层默认）、when、
//     写字段（默认 dryRun、不覆盖、白名单）、exclusive 互斥标签组
//   - 接口：真实服务端上补写 origin.sourcePath（按字段合并，不冲掉 sourceFiles），互斥标签组由脚本输出声明，
//     byProfile 里按规则名只改一条
//   - 文本媒体导入的 workKeyFromTitle：默认关；打开后新建合集写 title:<名称>（nfc + 空白规范化），追加导入不改；
//     同名合集进合并候选；老数据用回填规则补出来的键和导入时的一模一样
//
//   node scripts/dev/field-map-selftest.mjs [站点地址]      不给地址只跑纯函数部分
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '../..')
const mod = await import(path.join(root, 'scripts/tag-scripts/rj-series-v1/main.js'))
const manifest = JSON.parse(await readFile(path.join(root, 'scripts/tag-scripts/rj-series-v1/manifest.json'), 'utf8'))
const { deepMerge, resolveScriptOptions } = await import(path.join(root, 'web/library/script-options.mjs'))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// 和服务端一样：manifest 默认值 + 用户配置深合并后交给脚本
const run = (item, userOptions = {}, extra = {}) => mod.generateTags({
  item, type: extra.type || 'media', selectedUnitIds: [],
  script: { options: resolveScriptOptions({ defaultOptions: manifest.options, userOptions, type: extra.type || 'media', profile: item.sourceProfile || '' }).options },
})

// ================= 默认配置 = 1.x 行为 =================
{
  const both = await run({ dlsite: { originalProductId: ' rj01000001 ', productId: 'RJ02000002' }, productId: 'RJ03' })
  check('系列：有原档用原档（去空格 + 大写）', J(both.itemTags) === J(['系列: RJ01000001']) && J(both.exclusiveTagGroups) === J(['系列']), J(both))
  const own = await run({ dlsite: { productId: 'rj02000002' }, productId: 'RJ03' })
  check('系列：没有原档用自身', J(own.itemTags) === J(['系列: RJ02000002']), J(own.itemTags))
  const imported = await run({ productId: 'rj03000003' })
  check('系列：dlsite 都没有用导入编号', J(imported.itemTags) === J(['系列: RJ03000003']), J(imported.itemTags))
  const none = await run({ title: 'x' })
  check('系列：没有编号就不产出（不把无编号的作品归成一组）', none.itemTags.length === 0 && !none.itemPatch, J(none))
  const noOrig = await run({ dlsite: { originalProductId: 'RJ01', productId: 'RJ02' } }, { preferOriginal: false })
  check('1.x 选项 preferOriginal: false 仍然生效', J(noOrig.itemTags) === J(['系列: RJ02']), J(noOrig.itemTags))
  const prefix = await run({ dlsite: { productId: 'RJ02' } }, { tagPrefix: 'series' })
  check('1.x 选项 tagPrefix 仍然生效（互斥组跟着变）', J(prefix.itemTags) === J(['series: RJ02']) && J(prefix.exclusiveTagGroups) === J(['series']), J(prefix))
  const dry = await run({ dlsite: { productId: 'RJ02' } }, { dryRun: true })
  check('dryRun：不产出标签，日志里写会产出什么', dry.itemTags.length === 0 && dry.logs.some((l) => /dryRun.*系列: RJ02/.test(l)), J(dry))
  const backfillOff = await run({ title: '书' }, { constants: { sourceRoot: '/input/books' } })
  check('「来源路径回填」默认关闭：不写字段', !backfillOff.itemPatch, J(backfillOff))
}

// ================= 规则 =================
{
  const lang = (map, extra = {}) => ({ rules: { 系列: { enabled: false }, 语言: { from: ['dlsite.site'], map, to: { tag: '语言', exclusive: true }, ...extra } } })
  const map = { maniax: '日文', 'ECCHI-ENG': '英文' }
  let r = await run({ dlsite: { site: 'maniax' } }, lang(map))
  check('map：精确匹配', J(r.itemTags) === J(['语言: 日文']), J(r.itemTags))
  r = await run({ dlsite: { site: 'ecchi-eng' } }, lang(map))
  check('map：默认区分大小写，查不到也没 default → 保留原值', J(r.itemTags) === J(['语言: ecchi-eng']), J(r.itemTags))
  r = await run({ dlsite: { site: 'ecchi-eng' } }, lang(map, { mapIgnoreCase: true }))
  check('map：规则级 mapIgnoreCase: true → 忽略大小写', J(r.itemTags) === J(['语言: 英文']), J(r.itemTags))
  r = await run({ dlsite: { site: 'ecchi-eng' } }, { ...lang(map), mapIgnoreCase: true })
  check('map：外层 mapIgnoreCase 是所有规则的默认值', J(r.itemTags) === J(['语言: 英文']), J(r.itemTags))
  r = await run({ dlsite: { site: 'ecchi-eng' } }, { ...lang(map, { mapIgnoreCase: false }), mapIgnoreCase: true })
  check('map：规则级设置优先于外层', J(r.itemTags) === J(['语言: ecchi-eng']), J(r.itemTags))
  r = await run({ dlsite: { site: 'other' } }, lang(map, { default: '' }))
  check('map：default "" = 查不到就不写', r.itemTags.length === 0, J(r))
  r = await run({ dlsite: { site: 'other' } }, lang(map, { default: '未知' }))
  check('map：default 有值就用它', J(r.itemTags) === J(['语言: 未知']), J(r.itemTags))
  r = await run({ dlsite: { site: 'other', originalSite: 'maniax' } }, { rules: { 系列: { enabled: false }, 语言: { from: ['dlsite.site', 'dlsite.originalSite'], map, default: '', to: { tag: '语言' } } } })
  check('from：前一个候选映射后为空，接着试下一个', J(r.itemTags) === J(['语言: 日文']), J(r))
  r = await run({ title: '[RJ01234567] 作品 (完全版)' }, { rules: { 系列: { enabled: false }, 编号: { from: ['title'], transform: [{ regex: 'rj\\d+', ignoreCase: true }, 'upper'], to: { tag: '编号' } } } })
  check('transform：正则提取可以忽略大小写，再转大写', J(r.itemTags) === J(['编号: RJ01234567']), J(r.itemTags))
  r = await run({ title: 'ガイド'.normalize('NFD') }, { rules: { 系列: { enabled: false }, t: { from: ['title'], transform: ['nfc'], to: { tag: 't' } } } })
  check('transform：nfc 把分解形式（NFD）规范成组合形式', J(r.itemTags) === J(['t: ガイド']), J(r.itemTags))
  r = await run({ title: 'a_b_c' }, { rules: { 系列: { enabled: false }, t: { from: ['title'], transform: [{ replace: '_', with: ' ' }], to: { tag: 't' } } } })
  check('transform：正则替换（全部）', J(r.itemTags) === J(['t: a b c']), J(r.itemTags))
  r = await run({ title: 'x' }, { rules: { 系列: { enabled: false }, c: { from: [{ const: '固定值' }], to: { tag: 'c' } } } })
  check('from：常量', J(r.itemTags) === J(['c: 固定值']), J(r.itemTags))
  r = await run({ title: 'x', dlsite: { productId: 'RJ1' } }, { rules: { 系列: { enabled: false }, c: { when: { match: 'title', regex: '^\\[' }, from: [{ const: 'y' }], to: { tag: 'c' } }, d: { when: [{ notEmpty: 'dlsite.productId' }, { empty: 'workKey' }], from: [{ const: 'z' }], to: { tag: 'd' } } } })
  check('when：match 不满足跳过；数组条件全部满足才跑', J(r.itemTags) === J(['d: z']), J(r))
}

// ================= 写字段 =================
{
  const backfill = (rule = {}, constants = { sourceRoot: '/input/books/' }) => ({ constants, rules: { 系列: { enabled: false }, 来源路径回填: { enabled: true, ...rule } } })
  let r = await run({ title: '[作者A] 某系列' }, backfill())
  check('写字段：默认只记日志（dryRun），不产出 itemPatch', !r.itemPatch && r.logs.some((l) => /dryRun.*origin\.sourcePath.*\/input\/books\/\[作者A\] 某系列/.test(l)), J(r))
  r = await run({ title: '[作者A] 某系列' }, backfill({ dryRun: false }))
  check('写字段：dryRun: false 才写；模板拼接 + 重复斜杠合并', r.itemPatch?.origin?.sourcePath === '/input/books/[作者A] 某系列', J(r))
  r = await run({ title: '书', origin: { sourceFiles: ['a.epub'] } }, backfill({ dryRun: false }))
  check('写字段：when empty: origin —— 已有 origin（哪怕只有 sourceFiles）就不补', !r.itemPatch && r.logs.some((l) => /条件不满足/.test(l)), J(r))
  r = await run({ title: '书', origin: { sourceFiles: ['a.epub'] } }, backfill({ dryRun: false, when: { empty: 'origin.sourcePath' } }))
  check('写字段：条件改成 empty: origin.sourcePath 就补', r.itemPatch?.origin?.sourcePath === '/input/books/书', J(r))
  r = await run({ title: '书', origin: { sourcePath: '/old/书' } }, backfill({ dryRun: false, when: [] }))
  check('写字段：目标已有不同的值，默认不覆盖', !r.itemPatch && r.logs.some((l) => /不覆盖/.test(l)), J(r))
  r = await run({ title: '书', origin: { sourcePath: '/old/书' } }, backfill({ dryRun: false, when: [], overwrite: true }))
  check('写字段：overwrite: true 覆盖', r.itemPatch?.origin?.sourcePath === '/input/books/书', J(r))
  r = await run({ title: '书' }, backfill({ dryRun: false }, { sourceRoot: '' }))
  check('模板里引用的常量为空：整个结果算空，不写半截路径', !r.itemPatch && r.logs.some((l) => /const\.sourceRoot 为空/.test(l)), J(r))
  r = await run({ title: '书' }, { rules: { 系列: { enabled: false }, x: { from: ['title'], to: { field: 'tags' }, dryRun: false } } })
  check('写字段：不在白名单的字段拒绝', !r.itemPatch && r.logs.some((l) => /不允许写字段/.test(l)), J(r))
  r = await run({ title: '书' }, { dryRun: true, rules: { 系列: { enabled: false }, 来源路径回填: { enabled: true, dryRun: false } }, constants: { sourceRoot: '/a' } })
  check('外层 dryRun: true 压过规则自己的 dryRun: false', !r.itemPatch, J(r))
  const layered = resolveScriptOptions({ defaultOptions: manifest.options, userOptions: { byProfile: { 'text-media': { constants: { sourceRoot: '/input/books' }, rules: { 来源路径回填: { enabled: true, dryRun: false } } } } }, type: 'media', profile: 'text-media' }).options
  check('分层配置：byProfile 里按规则名只打开「来源路径回填」，「系列」规则和回填规则的其它字段都还在', layered.rules['系列']?.to?.tag === '系列' && layered.rules['来源路径回填'].enabled === true && layered.rules['来源路径回填'].to.field === 'origin.sourcePath', J(layered.rules))
  check('deepMerge 不改动 manifest 默认值', manifest.options.rules['来源路径回填'].enabled === false && J(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })) === J({ a: { b: 1, c: 2 } }))
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
  const getItem = async (id) => (await api(`/api/library/items/media/${encodeURIComponent(id)}`)).body
  const ID = 'rj-series-v1'
  const runJob = async (itemId) => {
    const created = await postJson(`/api/library/items/media/${encodeURIComponent(itemId)}/tag-scripts`, { actionIds: [ID], force: true })
    const jobId = created.body?.job?.id
    if (!jobId) return { error: J(created.body) }
    for (let i = 0; i < 200; i++) {
      const job = (await api(`/api/tag-jobs/${jobId}`)).body
      if (['completed', 'failed'].includes(job.status)) return job.results?.[0] || job
      await sleep(250)
    }
    return { error: '超时' }
  }
  await api(`/api/tag-scripts/${ID}/config`, { method: 'DELETE' })
  try {
    const form = new FormData()
    form.set('collectionTitle', '[作者C] 回填测试合集')
    form.append('file', new Blob([Buffer.alloc(1024)]), 'a.mp4')
    form.append('file', new Blob([Buffer.alloc(1024)]), 'b.mp4')
    const up = await api('/api/library/items?type=media', { method: 'POST', body: form })
    const itemId = up.body?.itemId
    const before = itemId ? await getItem(itemId) : null
    check('准备：上传两个文件的媒体合集（只有 sourceFiles，没有 sourcePath）', Boolean(before?.origin?.sourceFiles?.length === 2 && !before.origin.sourcePath), J(up.body).slice(0, 300))
    if (itemId) {
      await postJson(`/api/tag-scripts/${ID}/config`, { options: { constants: { sourceRoot: '/input/videos' }, rules: { 来源路径回填: { enabled: true, when: { empty: 'origin.sourcePath' } } } } })
      let r = await runJob(itemId)
      let item = await getItem(itemId)
      check('接口：回填默认 dryRun —— 任务完成、日志写了会补什么、条目没变', r.status === 'completed' && (r.logs || []).some((l) => /dryRun/.test(l)) && !item.origin?.sourcePath, J([r, item.origin]))
      await postJson(`/api/tag-scripts/${ID}/config`, { options: { constants: { sourceRoot: '/input/videos' }, rules: { 来源路径回填: { enabled: true, dryRun: false, when: { empty: 'origin.sourcePath' } } } } })
      r = await runJob(itemId)
      item = await getItem(itemId)
      check('接口：dryRun: false 后补上 origin.sourcePath，原有的 sourceFiles 还在', item.origin?.sourcePath === '/input/videos/[作者C] 回填测试合集' && item.origin?.sourceFiles?.length === 2, J([r, item.origin]))
      // 互斥标签组：组名不在 manifest 里，由脚本按 exclusive 声明；先手动打一个同组的标签，脚本产出后应该被替换成一个
      await postJson(`/api/tag-scripts/${ID}/config`, { options: { rules: { 系列: { enabled: false }, 分组: { from: [{ const: '甲' }], to: { tag: '自测分组', exclusive: true } } } } })
      r = await runJob(itemId)
      item = await getItem(itemId)
      check('接口：规则产出标签「自测分组: 甲」', r.status === 'completed' && item.tags.includes('自测分组: 甲'), J([r, item.tags]))
      await postJson(`/api/tag-scripts/${ID}/config`, { options: { rules: { 系列: { enabled: false }, 分组: { from: [{ const: '乙' }], to: { tag: '自测分组', exclusive: true } } } } })
      r = await runJob(itemId)
      item = await getItem(itemId)
      const group = item.tags.filter((t) => t.startsWith('自测分组'))
      check('接口：值变了，同组只剩新值', J(group) === J(['自测分组: 乙']), J(item.tags))
    }

    // ---------- 文本媒体导入：workKeyFromTitle ----------
    const importText = async (title, { options = null, itemId = '' } = {}) => {
      const f = new FormData()
      f.set('importProfile', 'text-media')
      if (title) f.set('collectionTitle', title)
      if (itemId) f.set('itemId', itemId)
      if (options !== null) f.set('profileOptions', typeof options === 'string' ? options : J(options))
      f.append('file', new Blob([`第一章\n${title || 'x'} ${Math.random()}\n`]), `${Math.random().toString(16).slice(2)}.txt`)
      return api('/api/library/items?type=media', { method: 'POST', body: f })
    }
    const NAME = '同名 归组测试'
    const off = await importText(NAME)
    check('workKeyFromTitle 默认关：导入后没有作品键', off.status < 300 && !(await getItem(off.body.itemId)).workKey, J(off.body).slice(0, 200))
    const on1 = await importText(NAME, { options: { workKeyFromTitle: true } })
    const key1 = (await getItem(on1.body.itemId)).workKey
    check('本次提交带 workKeyFromTitle: true：作品键 = title:<合集名称>', key1 === `title:${NAME}`, key1)
    const on2 = await importText(`  同名   归组测试 `, { options: { workKeyFromTitle: true } })
    check('合集名称多了首尾 / 连续空格：作品键一样', (await getItem(on2.body.itemId)).workKey === key1, (await getItem(on2.body.itemId)).workKey)
    const nfc = await importText('ガイド本', { options: { workKeyFromTitle: true } })
    const nfd = await importText('ガイド本'.normalize('NFD'), { options: { workKeyFromTitle: true } })
    check('合集名称是分解形式（NFD，macOS 文件名常见）：和组合形式的作品键一样', (await getItem(nfc.body.itemId)).workKey === (await getItem(nfd.body.itemId)).workKey && (await getItem(nfd.body.itemId)).workKey === 'title:ガイド本', J([(await getItem(nfc.body.itemId)).workKey, (await getItem(nfd.body.itemId)).workKey]))
    const appended = await importText('另一个名字', { options: { workKeyFromTitle: true }, itemId: on1.body.itemId })
    check('追加到已有合集：作品键不变', appended.status < 300 && (await getItem(on1.body.itemId)).workKey === key1, J([appended.status, (await getItem(on1.body.itemId)).workKey]))
    const bad = await importText('坏配置', { options: '{bad' })
    check('导入方案配置不是合法 JSON：导入报错，不建条目', bad.status >= 400, J(bad))
    // 保存过的方案配置（不随请求带）也生效；配置能存住 text-media（原来服务端只认几个固定方案，存了会被丢掉）
    const cfg = (await api('/api/config')).body
    const saved = await postJson('/api/config', { mediaImportProfiles: { ...(cfg.mediaImportProfiles || {}), 'text-media': { workKeyFromTitle: true } } })
    check('配置里能存住 text-media.workKeyFromTitle', saved.body?.mediaImportProfiles?.['text-media']?.workKeyFromTitle === true, J(saved.body?.mediaImportProfiles?.['text-media']))
    const viaSaved = await importText('存配置导入')
    check('用已保存的方案配置导入（请求里不带）：写了作品键', (await getItem(viaSaved.body.itemId)).workKey === 'title:存配置导入', (await getItem(viaSaved.body.itemId)).workKey)
    await postJson('/api/config', { mediaImportProfiles: { ...(cfg.mediaImportProfiles || {}), 'text-media': { workKeyFromTitle: false } } })
    // 老数据：开关关着时导入的那个，用回填规则补作品键 —— 必须和导入时生成的一模一样，才会进同一组
    await postJson(`/api/tag-scripts/${ID}/config`, { options: { rules: { 系列: { enabled: false }, 按合集名归组: { when: { empty: 'workKey' }, from: [{ template: 'title:${title}' }], transform: ['nfc', 'trim', { replace: '\\s+', with: ' ' }], to: { field: 'workKey' }, dryRun: false } } } })
    const fill = await runJob(off.body.itemId)
    check('老数据：回填规则补出的作品键和导入时生成的一样', (await getItem(off.body.itemId)).workKey === key1, J([fill, (await getItem(off.body.itemId)).workKey]))
    await postJson('/api/library/index/rebuild', {})
    for (let i = 0; i < 60; i++) {
      const st = (await api('/api/library/index/status')).body
      if (st?.status === 'ready' && !st?.dirty && !st?.rebuildQueued) break
      await sleep(500)
    }
    const groups = (await api(`/api/library/merge-candidates?page=1&limit=50&q=${encodeURIComponent(NAME)}`)).body?.items || []
    const group = groups.find((g) => g.key === key1)
    const ids = new Set((group?.members || []).map((m) => m.itemId))
    check('合并页：同名的三个合集（两个导入时写的 + 一个回填的）在同一组；主条目是最早创建的那个', group?.count === 3 && [off, on1, on2].every((x) => ids.has(x.body.itemId)) && group.targetItemId === off.body.itemId, J(group))
  } finally {
    await api(`/api/tag-scripts/${ID}/config`, { method: 'DELETE' })
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
