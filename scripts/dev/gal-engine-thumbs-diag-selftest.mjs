#!/usr/bin/env node
// Gal 引擎自测（只用 node，不要浏览器）：缩略图提取引擎的新能力 + 兜底封面 + 列表诊断。
//   1. thumbSources：目录结构当键（{dirname} / {dir2} / {parent}）、占位符一览、{x:起:止} 切片、forStrip 去前缀、forMatch 取数字段、多来源合并 / 去重 / 封顶、通配目录超过 50 个、校验 + 警告
//   2. thumbFallback：没有规则命中时从脚本收图（事件图 / CG → 立绘 → 背景，去重、跳黑白占位图、只扫前 N 步）、校验、enabled:false 回到旧行为、规则命中时不兜底
//   3. 诊断：unrecognized-scripts 带脱敏的头部片段 + 每个适配器为什么没认（explainSniff 钩子）、播放页节点也带 problems
//   node scripts/dev/gal-engine-thumbs-diag-selftest.mjs
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { explainSniffGalAdapters, registerGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { createBrowseProvider } from '../../web/library/gal/browse.mjs'
import { normalizeGalConfig, normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { explainRejectedFile, maskHeadSnippet } from '../../web/library/gal/diagnostics.mjs'
import { collectFallbackImages } from '../../web/library/gal/fallback-thumbs.mjs'
import { buildSourceIndex, fileVars, fillKey, subjectKey } from '../../web/library/gal/thumbs.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gal-thumbs-diag-')))
const media = path.join(work, 'media')
const mk = async (rel, content = 'x') => { await mkdir(path.dirname(path.join(media, rel)), { recursive: true }); await writeFile(path.join(media, rel), content) }
const resolveAsset = async (rel) => {
  const clean = rel.startsWith('~/') ? rel.slice(2) : `resources/${rel}`
  const file = path.join(media, clean)
  try { await readFile(file); return file } catch { throw Object.assign(new Error('资源不存在'), { code: 'ENOENT', statusCode: 404 }) }
}
const csv = (n) => `msg,0,hi ${n}\nclickwait\nmsg,0,again\nclickwait\n`
const provider = (config, adapters = ['uviewer-csv']) => createBrowseProvider({ mediaDir: media, adapters, resolveAsset, config: { scriptThumbs: [], thumbFallback: { enabled: false }, ...config } })
const nodeOf = async (config, id, adapters) => (await provider(config, adapters).getNode(id)).node

// ================= 1a. 纯函数：占位符 / 切片 / 卡片键 =================
{
  const m = /^(\d{9})(\d{3})_360\.jpg$/.exec('123456789012_360.jpg')
  check('fillKey：{1}{2} 捕获组、命名组、vars；不认识的 = 空', fillKey('{1}-{2}-{x}-{n}', m, { x: 'X' }) === '123456789-012-X-' && fillKey('{ep}', /^(?<ep>ep\d+)/.exec('ep01a'), {}) === 'ep01', '')
  check('fillKey 切片 {x:起:止}（JS slice：止不含、可省、可为负）：前 9 个字符 / 第 1～6 个字符 / 从第 3 个起 / 末 3 位 / 对捕获组也行', fillKey('{stem:0:9}|{stem:1:7}|{stem:3}|{stem:-3}|{stem::2}|{1:3:6}', m, { stem: '120090312' }) === '120090312|200903|090312|312|12|456', fillKey('{stem:0:9}|{stem:1:7}|{stem:3}|{stem:-3}|{stem::2}|{1:3:6}', m, { stem: '120090312' }))
  check('旧写法不受影响：没有冒号的占位符照旧；花括号里不是 \\w 的原样保留', fillKey('{1}{stem}{ }', m, { stem: 'S' }) === '123456789S{ }', '')
  check('fileVars：{dirname} = {dir1} = 最后一级目录名、{dir2} / {dir3} 往上、{dirpath}、{file} / {base}；~/ 不算目录名', J(fileVars('scenes/S001', 'thumbnail.png')) === J({ file: 'thumbnail.png', base: 'thumbnail', dirpath: 'scenes/S001', dirname: 'S001', dir1: 'S001', dir2: 'scenes', dir3: '' }) && fileVars('~/user_data/thumbnails', 'a.b.webp').dirname === 'thumbnails' && fileVars('~/user_data/thumbnails', 'a.b.webp').base === 'a.b' && fileVars('', 'x.png').dirname === '', J(fileVars('~/user_data/thumbnails', 'a.b.webp')))
  const idx = buildSourceIndex({ match: '^thumbnail\\.(png|jpe?g|webp)$', key: '{dirname}' }, [
    { dir: 'scenes/S001', name: 'thumbnail.png' }, { dir: 'scenes/S002', name: 'thumbnail.jpg' }, { dir: 'scenes/S002', name: 'other.png' }, { dir: 'scenes/S003', name: 'thumbnail.webp' }, { dir: 'scenes/S003', name: '.thumbnail.png' }, { dir: 'scenes/S004', name: 'thumbnail.txt' },
  ])
  check('索引：键来自目录名（Girls Creation scenes/<场景>/thumbnail.png → 键 = 场景目录名）；不匹配 / 隐藏 / 非图片忽略', J([...idx]) === J([['S001', ['scenes/S001/thumbnail.png']], ['S002', ['scenes/S002/thumbnail.jpg']], ['S003', ['scenes/S003/thumbnail.webp']]]), J([...idx]))
  const idx2 = buildSourceIndex({ match: '^(\\d+)\\.png$', key: '{dir2}/{dir1}:{1}:{base}' }, [{ dir: 'chara/c01/face', name: '7.png' }])
  check('索引：{dir2}（上一级目录名）/ {dir1} / 捕获组 / {base} 可以混写', J([...idx2.keys()]) === J(['c01/face:7:7']), J([...idx2.keys()]))
  const script = (stem, parent, extra = {}) => subjectKey({ for: 'script', forKey: '{parent}', ...extra }, { kind: 'script', stem, parent, parent2: 'root' })
  check('卡片键：{parent} = 脚本所在目录名（script.txt 的 stem 没用，键用父目录）；在脚本根下（没有父目录）= 规则不适用', script('script', 'S001') === 'S001' && script('script', '') === null && subjectKey({ for: 'script', forKey: '{parent2}/{parent}' }, { kind: 'script', stem: 'a', parent: 'p', parent2: 'q' }) === 'q/p', '')
  check('卡片键 forStrip：去前缀 scene_（minashigo：scene_<9 位> → <9 位>）；数组依次去（前缀 + 后缀）；去完是空 = 不适用', subjectKey({ for: 'script', forKey: '{stem}', forStrip: '^scene_' }, { kind: 'script', stem: 'scene_323100301' }) === '323100301' && subjectKey({ for: 'script', forKey: '{stem}', forStrip: ['^scene_', '_ex$'] }, { kind: 'script', stem: 'scene_1_ex' }) === '1' && subjectKey({ for: 'script', forStrip: '^scene_' }, { kind: 'script', stem: 'scene_' }) === null, '')
  check('卡片键 forMatch / 切片：前 9 位 = ^(\\d{9}) → {1}；角色 id = 第 [1:7] 位（120090312 → 200903）既可以 forMatch 也可以 {stem:1:7}；不匹配 = 不适用', subjectKey({ for: 'script', forMatch: '^(\\d{9})', forKey: '{1}' }, { kind: 'script', stem: '323100301_x' }) === '323100301' && subjectKey({ for: 'script', forMatch: '^\\d(\\d{6})', forKey: '{1}' }, { kind: 'script', stem: '120090312' }) === '200903' && subjectKey({ for: 'script', forKey: '{stem:1:7}' }, { kind: 'script', stem: '120090312' }) === '200903' && subjectKey({ for: 'script', forMatch: '^\\d{9}$', forKey: '{stem:0:9}' }, { kind: 'script', stem: 'abc' }) === null, '')
  check('卡片键（目录卡片）：{name} / {parent} / {parent2}；for 不对 = 不适用', subjectKey({ for: 'dir', forKey: '{parent2}.{parent}.{name}' }, { kind: 'dir', name: 'n', parent: 'p', parent2: 'q' }) === 'q.p.n' && subjectKey({ for: 'dir', forKey: '{name}' }, { kind: 'script', stem: 'a' }) === null, '')
}

// ================= 1b. 引擎（真实目录）=================
// Aster / Girls Creation：scenes/<场景>/thumbnail.png + scenes/<场景>/script.txt（脚本名都叫 script）。造 120 个场景（原来最多展开 50 个目录，会丢一半以上）
{
  for (let i = 1; i <= 120; i += 1) {
    const id = `S${String(i).padStart(3, '0')}`
    await mk(`resources/scenes/${id}/script.txt`, csv(id))
    if (i !== 7) await mk(`resources/scenes/${id}/thumbnail.${i % 2 ? 'png' : 'jpg'}`)
  }
  const rules = [
    { dir: 'scenes/*', match: '^thumbnail\\.(png|jpe?g|webp)$', key: '{dirname}', for: 'script', forKey: '{parent}' },
    { dir: 'scenes/*', match: '^thumbnail\\.(png|jpe?g|webp)$', key: '{dirname}', for: 'dir', forKey: '{name}' },
  ]
  const cfg = { scriptRoots: [{ id: 'text', dir: 'resources/scenes' }], thumbSources: rules, pageSize: 200 }
  const root = await nodeOf(cfg, '')
  const byTitle = Object.fromEntries(root.items.map((i) => [i.title, i]))
  check('Aster 布局（目录卡片）：每个场景目录一张卡，键 = 目录名 → scenes/<id>/thumbnail.*；120 个目录都有（超过原来 50 个目录的上限）；没有 thumbnail 的 S007 没图并写明原因', root.items.length === 120 && byTitle.S001.thumb === 'scenes/S001/thumbnail.png' && byTitle.S002.thumb === 'scenes/S002/thumbnail.jpg' && byTitle.S120.thumb === 'scenes/S120/thumbnail.jpg' && byTitle.S007.thumb === '' && /没有「S007」/.test((byTitle.S007.thumbWhy || []).join('|')), J([root.items.length, byTitle.S120?.thumb, byTitle.S007?.thumbWhy]))
  const inner = await nodeOf(cfg, 'd:S002')
  const inner119 = await nodeOf(cfg, 'd:S119')
  check('Aster 布局（脚本卡片）：scenes/S002/script.txt 的 stem 是 script（没用），键 = {parent} = S002 → scenes/S002/thumbnail.jpg；S119 同理', J(inner.items.map((i) => [i.title, i.thumbs])) === J([['script', ['scenes/S002/thumbnail.jpg']]]) && inner119.items[0].thumb === 'scenes/S119/thumbnail.png', J([inner.items, inner119.items]))
  const none = await nodeOf(cfg, 'd:S007')
  check('Aster 布局：没有 thumbnail 的场景，脚本卡片没图、thumbWhy 里有键', none.items[0].thumb === '' && /没有「S007」/.test(none.items[0].thumbWhy.join('|')), J(none.items[0]))
}

// minashigo：game/images/thumb/<12 位>_360.jpg，前 9 位 = scene_<9 位>；每个场景可能有几张（…001 / …002）
{
  for (const f of ['323100301001', '323100301002', '323100302001', '999999999999']) await mk(`resources/game/images/thumb/${f}_360.jpg`)
  await mk('resources/game/images/thumb/323100301003_720.jpg')   // 不是 _360：不匹配
  for (const n of ['scene_323100301', 'scene_323100302', 'scene_323100303']) await mk(`resources/game/script/${n}.txt`, csv(n))
  const cfg = { scriptRoots: [{ id: 'text', dir: 'resources/game/script' }], thumbSources: [{ dir: 'game/images/thumb', match: '^(\\d{9})\\d{3}_360\\.jpg$', key: '{1}', for: 'script', forKey: '{stem}', forStrip: '^scene_' }] }
  const list = await nodeOf(cfg, '')
  const by = Object.fromEntries(list.items.map((i) => [i.title, i.thumbs]))
  check('minashigo：scene_<9 位> 去掉 scene_ 前缀当键，对上 thumb/<12 位>_360.jpg 的前 9 位；一个场景多张都收（自然序）；没有的没图', J(by) === J({ scene_323100301: ['game/images/thumb/323100301001_360.jpg', 'game/images/thumb/323100301002_360.jpg'], scene_323100302: ['game/images/thumb/323100302001_360.jpg'], scene_323100303: [] }), J(by))
  const noStrip = await nodeOf({ ...cfg, thumbSources: [{ ...cfg.thumbSources[0], forStrip: undefined }] }, '')
  check('不写 forStrip：键是 scene_… 查不到（证明是 forStrip 起的作用）', noStrip.items.every((i) => i.thumbs.length === 0), J(noStrip.items.map((i) => i.thumbs)))
}

// ミナシゴノシゴトR：story/<9 位>.txt；每个脚本一张 data/image/episode/story/<9 位>.png，再加角色头像 data/image/character/thumb/<6 位>.png（角色 id = 脚本名第 [1:7] 位）
{
  await mk('resources/data/image/episode/story/120090312.png')
  await mk('resources/data/image/character/thumb/200903.png')
  await mk('resources/data/image/character/thumb/200904.png')
  for (const n of ['120090312', '120090399', '120090411', '555555555']) await mk(`resources/data/adv/textfiles/story/${n}.txt`, csv(n))
  const rules = [
    { dir: 'data/image/episode/story', match: '^(\\d{9})\\.png$', key: '{1}', for: 'script', forKey: '{stem}' },
    { dir: 'data/image/character/thumb', match: '^(\\d{6})\\.png$', key: '{1}', for: 'script', forKey: '{stem:1:7}' },
  ]
  const cfg = { scriptRoots: [{ id: 'text', dir: 'resources/data/adv/textfiles/story' }], thumbSources: rules }
  const list = await nodeOf(cfg, '')
  const by = Object.fromEntries(list.items.map((i) => [i.title, i.thumbs]))
  check('ミナシゴノシゴトR：规则 1 = 本集缩略图（键 = stem）；规则 2 = 角色头像（键 = stem 的第 [1:7] 位 {stem:1:7}）；两条合并，本集在前', J(by) === J({ 120090312: ['data/image/episode/story/120090312.png', 'data/image/character/thumb/200903.png'], 120090399: ['data/image/character/thumb/200903.png'], 120090411: ['data/image/character/thumb/200904.png'], 555555555: [] }), J(by))
  const viaMatch = await nodeOf({ ...cfg, thumbSources: [rules[0], { ...rules[1], forKey: '', forMatch: '^\\d(\\d{6})', forStrip: undefined }].map((r, i) => (i ? { ...r, forKey: '{1}' } : r)) }, '')
  check('同一个效果用 forMatch（^\\d(\\d{6}) + {1}）也行', J(Object.fromEntries(viaMatch.items.map((i) => [i.title, i.thumbs]))) === J(by), J(viaMatch.items.map((i) => i.thumbs)))
  const fb = await nodeOf({ ...cfg, thumbSources: [rules[0], { ...rules[1], fallback: true }] }, '')
  check('头像规则加 fallback:true：有本集图的脚本不再带头像，没有本集图的才用头像', J(Object.fromEntries(fb.items.map((i) => [i.title, i.thumbs]))) === J({ 120090312: ['data/image/episode/story/120090312.png'], 120090399: ['data/image/character/thumb/200903.png'], 120090411: ['data/image/character/thumb/200904.png'], 555555555: [] }), J(fb.items.map((i) => i.thumbs)))
}

// 多来源合并：scriptThumbs 模板 + 多条 thumbSources，按规则顺序、去重（同一个真实文件只算一次）、封顶 12
{
  for (let i = 0; i < 8; i += 1) { await mk(`resources/mix/a/m1_${i}.png`); await mk(`resources/mix/b/m1_${i}.png`) }
  await mk('resources/mix/pre/m1.png')
  await mk('resources/mix/s/m1.txt', csv('m1'))
  await mk('resources/mix/s/m2.txt', csv('m2'))
  await mk('resources/mix/pre/m2.png')
  const cfg = {
    scriptRoots: [{ id: 'text', dir: 'resources/mix/s' }], scriptThumbs: ['mix/pre/{stem}.png', 'mix/pre/{stem}.png'],
    thumbSources: [
      { dir: 'mix/a', match: '^(m\\d)_\\d\\.png$', key: '{1}', for: 'script' },
      { dir: 'mix/pre', match: '^(m\\d)\\.png$', key: '{1}', for: 'script' },         // 和 scriptThumbs 重复：去重
      { dir: 'mix/b', match: '^(m\\d)_\\d\\.png$', key: '{1}', for: 'script' },
      { dir: 'mix/*', match: '^(m\\d)_0\\.png$', key: '{1}', for: 'script' },         // 通配目录：又是 a / b 里的同一批文件
    ],
  }
  const list = await nodeOf(cfg, '')
  const m1 = list.items.find((i) => i.title === 'm1').thumbs
  const m2 = list.items.find((i) => i.title === 'm2').thumbs
  check('多来源合并：scriptThumbs（pre/m1.png）→ 规则 a 的 8 张 → 规则 b 补到 12 张封顶；重复的真实文件只算一次；顺序 = 规则顺序', m1.length === 12 && m1[0] === 'mix/pre/m1.png' && J(m1.slice(1, 9)) === J(Array.from({ length: 8 }, (_, i) => `mix/a/m1_${i}.png`)) && J(m1.slice(9)) === J(['mix/b/m1_0.png', 'mix/b/m1_1.png', 'mix/b/m1_2.png']) && new Set(m1).size === 12, J(m1))
  check('多来源合并：只有一个来源命中的卡片也正常（m2 = pre/m2.png 一张），thumb = thumbs[0]', J(m2) === J(['mix/pre/m2.png']) && list.items.every((i) => i.thumb === i.thumbs[0]), J(m2))
  const limited = await nodeOf({ ...cfg, scriptThumbs: [], thumbSources: [{ ...cfg.thumbSources[0], limit: 2 }, cfg.thumbSources[2]] }, '')
  check('规则的 limit 只管自己那条：a 取 2 张，b 全部（共 10 张）', J(limited.items.find((i) => i.title === 'm1').thumbs) === J(['mix/a/m1_0.png', 'mix/a/m1_1.png', ...Array.from({ length: 8 }, (_, i) => `mix/b/m1_${i}.png`)]), J(limited.items[0].thumbs))
}

// ================= 1c. 校验 =================
{
  const n = normalizeGalConfigWithWarnings({ thumbSources: [
    { dir: 'a', match: 'x', key: '{dirname}', forKey: '{parent}', forStrip: '^scene_' },
    { dir: 'a', match: 'x', forStrip: ['^a', '(', '^b', 'c', 'd', 'e'] },
    { dir: 'a', match: '^(?<ep>\\d+)', key: '{ep}{typo}', forMatch: '^(?<n>\\d+)', forKey: '{n}{stem}{nope:1:2}' },
    { dir: 'a', match: 'x', key: '{1:0:3}{base:0:9}', forKey: '{stem:1:7}' },
  ] })
  const rules = n.config.thumbSources
  check('校验：forStrip 一个正则 → 数组；数组里坏正则丢掉、最多 4 项（并报告）；没写 forStrip 的规则不带这个字段（旧规则的规整结果不变）', J(rules[0].forStrip) === J(['^scene_']) && J(rules[1].forStrip) === J(['^a', '^b', 'c']) && !('forStrip' in rules[3]) && n.warnings.some((w) => w.field === 'thumbSources' && /forStrip/.test(w.reason)), J(n.warnings))
  const unk = n.warnings.filter((w) => /不认识/.test(w.reason))
  check('校验：key / forKey 里的占位符拼错（不在占位符一览 / 命名组里）→ 警告但规则保留；命名组 {ep} / {n} 合法；{stem:0:9} 这类切片的名字也检查', rules.length === 4 && unk.length === 2 && /key 里的占位符 \{typo\}/.test(unk[0].reason) && /forKey 里的占位符 \{nope\}/.test(unk[1].reason) && !/stem|\{ep\}|\{n\}/.test(unk.map((w) => w.reason.replace(/（可用.*$/, '')).join()), J(unk))
  check('校验：key 里写了卡片侧的 {stem}（文件侧不能用）→ 警告；forKey 里写文件侧的 {dirname} → 警告', normalizeGalConfigWithWarnings({ thumbSources: [{ dir: 'a', match: 'x', key: '{stem}' }, { dir: 'a', match: 'x', forKey: '{dirname}' }] }).warnings.filter((w) => /不认识/.test(w.reason)).length === 2, '')
  const tf = (v) => normalizeGalConfigWithWarnings({ thumbFallback: v })
  const d = normalizeGalConfig({}).thumbFallback
  check('thumbFallback 默认：enabled、max 6、prefer [cg, stand, bg]、skipBlack、skip（black / white / blank）、scanSteps 200', d.enabled === true && d.max === 6 && J(d.prefer) === J(['cg', 'stand', 'bg']) && d.skipBlack === true && d.skip.length === 1 && d.scanSteps === 200, J(d))
  const c1 = tf({ enabled: false, max: 99, prefer: ['bgOver', 'bg', 'bg', 'zzz'], skipBlack: false, skip: ['ok', '(', 5], scanSteps: 5 })
  check('thumbFallback 校验：max 夹到 1–12、prefer 的 bgOver = cg 并去重去不认识的、skip 坏正则丢掉、scanSteps 夹到 10–2000，各自报告', c1.config.thumbFallback.enabled === false && c1.config.thumbFallback.max === 12 && J(c1.config.thumbFallback.prefer) === J(['cg', 'bg']) && c1.config.thumbFallback.skipBlack === false && J(c1.config.thumbFallback.skip) === J(['ok']) && c1.config.thumbFallback.scanSteps === 10 && ['max', 'prefer', 'skip', 'scanSteps'].every((f) => c1.warnings.some((w) => w.field === `thumbFallback.${f}`)), J(c1.warnings))
  const c2 = tf('junk')
  const c3 = tf({ enabled: 'no', max: 'x', prefer: [], zzz: 1 })
  check('thumbFallback 校验：不是对象 → 默认 + 警告；字段类型不对 / prefer 为空 → 该字段默认 + 警告；不认识的字段丢掉并警告', J(c2.config.thumbFallback) === J(d) && c2.warnings.some((w) => w.field === 'thumbFallback') && c3.config.thumbFallback.enabled === true && c3.config.thumbFallback.max === 6 && J(c3.config.thumbFallback.prefer) === J(['cg', 'stand', 'bg']) && c3.warnings.length === 4, J(c3.warnings))
  check('thumbFallback 只写一部分 = 其余默认（{ enabled: false } 只关兜底）', J(tf({ enabled: false }).config.thumbFallback) === J({ ...d, enabled: false }) && tf({ enabled: false }).warnings.length === 0, '')
}

// ================= 2. thumbFallback =================
registerGalAdapter({ id: 'test-fallback', label: '测试：JSON 步骤', sniff: (text) => text.startsWith('#FB'), parse: (text) => ({ steps: JSON.parse(text.slice(3)).map((commands, index) => ({ index, commands })), stats: {} }) })
{
  const files = ['black.png', 'room1.png', 'room2.png', 'room3.png', 'room4.png', 'room5.png', 'room6.png', 'room7.png', 'ev_a.png', 'ev_b.png', 'ev_c.png', 'cg9.png', 'st_a.png', 'st_b.png', 'st_c.png', 'late_cg.png', 'white_fade.png', 'blackboard.png']
  for (const f of files) await mk(`resources/fb/img/${f}`)
  const bg = (name, extra = {}) => ({ op: 'bg', src: `fb/img/${name}`, ...extra })
  const stand = (...names) => ({ op: 'stand', parts: names.map((n) => ({ src: `fb/img/${n}` })) })
  const write = (name, steps) => mk(`resources/fb/s/${name}.txt`, `#FB${J(steps.map((commands) => commands))}`)
  await write('mixed', [[bg('black.png')], [bg('room1.png')], [stand('st_a.png', 'st_b.png')], [bg('ev_a.png', { over: 'fb/img/ev_b.png' })], [bg('room1.png'), bg('room2.png')], [stand('st_c.png')], [{ op: 'bg', src: 'fb/img/cg9.png', cg: true }], [bg('white_fade.png')], [bg('blackboard.png')], [{ op: 'bg', color: [0, 0, 0] }]])
  await write('bgonly', [[bg('room1.png')], [bg('room2.png')], [bg('room3.png')], [bg('room4.png')], [bg('room5.png')], [bg('room6.png')], [bg('room7.png')]])
  await write('none', [[{ op: 'text', segments: [] }], [{ op: 'bg', color: [0, 0, 0] }]])
  await write('missing', [[bg('nope1.png')], [bg('nope2.png')]])
  await write('hasrule', [[bg('room1.png')]])
  await mk('resources/fb/rule/hasrule.png')
  const steps300 = Array.from({ length: 300 }, (_, i) => [i === 250 ? bg('late_cg.png', { over: 'fb/img/late_cg.png' }) : bg(`room${(i % 7) + 1}.png`)])
  await write('longone', steps300)
  const base = { scriptRoots: [{ id: 'text', dir: 'resources/fb/s' }] }
  const run = async (tf, extra = {}) => { const list = await nodeOf({ ...base, thumbFallback: tf, ...extra }, '', ['test-fallback']); return Object.fromEntries(list.items.map((i) => [i.title, i])) }
  const img = (list) => list.map((p) => p.replace('fb/img/', ''))

  const def = await run({})
  check('兜底默认：事件图（带 over 的 bg：over 先于 src；cg:true 的 bg）→ 立绘（每个 stand 指令取第一个部件）→ 背景；黑 / 白占位图（black、white_fade）跳过、blackboard 不算黑；最多 6 张；去重', J(img(def.mixed.thumbs)) === J(['ev_b.png', 'ev_a.png', 'cg9.png', 'st_a.png', 'st_c.png', 'room1.png']) && def.mixed.thumb === def.mixed.thumbs[0], J(def.mixed.thumbs))
  check('兜底默认：只有背景的脚本 → 7 张背景只取前 6 张（可以悬停轮播，不再是单张）', J(img(def.bgonly.thumbs)) === J(['room1.png', 'room2.png', 'room3.png', 'room4.png', 'room5.png', 'room6.png']), J(def.bgonly.thumbs))
  check('兜底默认：没有任何图（只有纯色 bg）→ thumbs 空，thumbWhy 说明扫了几步 / 各类张数；候选文件都不存在也说明', def.none.thumbs.length === 0 && /thumbFallback：扫了前 2 步.*事件图 0 \/ 立绘 0 \/ 背景 0 张，没有可用的图/.test(def.none.thumbWhy.join('|')) && def.missing.thumbs.length === 0 && /候选文件都不存在/.test(def.missing.thumbWhy.join('|')) && /nope1\.png/.test(def.missing.thumbWhy.join('|')), J([def.none.thumbWhy, def.missing.thumbWhy]))
  check('黑白名字说明：被跳过的张数写在 thumbWhy 里（只有黑图的脚本）', await (async () => { await write('onlyblack', [[bg('black.png')], [bg('white_fade.png')]]); const l = await run({}); return l.onlyblack.thumbs.length === 0 && /2 张是黑白占位图被跳过/.test(l.onlyblack.thumbWhy.join('|')) })(), '')
  const small = await run({ max: 2 })
  check('max：2 张封顶（事件图优先）', J(img(small.mixed.thumbs)) === J(['ev_b.png', 'ev_a.png']), J(small.mixed.thumbs))
  const reorder = await run({ prefer: ['bg', 'stand', 'bgOver'] })
  check('prefer 重排（bgOver = cg 别名）：背景 → 立绘 → 事件图', J(img(reorder.mixed.thumbs)) === J(['room1.png', 'room2.png', 'blackboard.png', 'st_a.png', 'st_c.png', 'ev_b.png']), J(reorder.mixed.thumbs))
  const onlyStand = await run({ prefer: ['stand'] })
  check('prefer 只写一类 = 只收这一类（其余不兜底）', J(img(onlyStand.mixed.thumbs)) === J(['st_a.png', 'st_c.png']) && onlyStand.bgonly.thumbs.length === 0, J(onlyStand.mixed.thumbs))
  const noSkip = await run({ skipBlack: false, max: 12 })
  check('skipBlack:false：黑 / 白占位图也收（背景里 black.png 在最前、white_fade 在 room 之后）', J(img(noSkip.mixed.thumbs).slice(5)) === J(['black.png', 'room1.png', 'room2.png', 'white_fade.png', 'blackboard.png']), J(noSkip.mixed.thumbs))
  const customSkip = await run({ skip: ['^room[12]$'] })
  check('skip 可配（正则，对无扩展名的文件名）：room1 / room2 被跳过，black 因为 skip 被换掉所以不再跳过', !img(customSkip.mixed.thumbs).includes('room1.png') && !img(customSkip.mixed.thumbs).includes('room2.png') && img(customSkip.mixed.thumbs).includes('black.png'), J(customSkip.mixed.thumbs))
  const off = await run({ enabled: false })
  check('enabled:false = 旧行为：只取脚本里第一张背景图（单图，这里第一张是 black.png）；只有纯色的脚本说明没有背景图', J(off.mixed.thumbs) === J(['fb/img/black.png']) && J(img(off.bgonly.thumbs)) === J(['room1.png']) && /没有背景图指令/.test(off.none.thumbWhy.join('|')), J([off.mixed.thumbs, off.none.thumbWhy]))
  const ruled = await run({}, { thumbSources: [{ dir: 'fb/rule', match: '^(\\w+)\\.png$', key: '{1}', for: 'script' }] })
  check('规则命中时不兜底：hasrule 只有规则那一张（不混进脚本里的背景）；规则没命中的脚本照常兜底', J(ruled.hasrule.thumbs) === J(['fb/rule/hasrule.png']) && ruled.bgonly.thumbs.length === 6, J(ruled.hasrule.thumbs))
  const shortScan = await run({})
  const longScan = await run({ scanSteps: 300 })
  check('只扫前 N 步（默认 200）：第 250 步才出现的事件图 default 扫不到，scanSteps 300 才排到最前', !shortScan.longone.thumbs.includes('fb/img/late_cg.png') && longScan.longone.thumbs[0] === 'fb/img/late_cg.png', J([shortScan.longone.thumbs, longScan.longone.thumbs]))
  const pure = collectFallbackImages({ steps: steps300.map((commands, index) => ({ index, commands })) }, { scanSteps: 50, max: 2 })
  check('collectFallbackImages（纯函数）：scanned / truncated / counts / 候选数 ≤ max × 3；不是图片 / 视频 / 空 src 的忽略', pure.scanned <= 50 && pure.truncated === true && pure.images.length <= 6 && pure.images.every((x) => x.kind === 'bg') && J(collectFallbackImages({ steps: [{ commands: [{ op: 'bg', src: 'a.mp4' }, { op: 'bg', src: '' }, { op: 'bg', src: 'a.txt' }, { op: 'bg', src: 'ok' }, { op: 'stand', parts: [{ src: 'p.txt' }, { src: 'p.webp' }] }, { op: 'spine', kind: 'still', thumb: 'x/t.png' }] }] }).images) === J([{ src: 'x/t.png', kind: 'cg' }, { src: 'p.webp', kind: 'stand' }, { src: 'ok', kind: 'bg' }]), J(pure))
  check('collectFallbackImages：空场景 / 没有 steps 不抛错', collectFallbackImages(null).images.length === 0 && collectFallbackImages({ steps: [] }).scanned === 0, '')
  const cached = provider({ ...base, thumbFallback: {} }, ['test-fallback'])
  const first = await cached.internals.scriptInfo(cached.config.scriptRoots[0], 'mixed.txt')
  const second = await cached.internals.scriptInfo(cached.config.scriptRoots[0], 'mixed.txt')
  check('scriptInfo 缓存：第二次是同一个对象（兜底收图随 info 缓存，不重复扫）', first === second && first.thumbs.length === 6, '')
  const reconf = provider({ ...base, thumbFallback: { max: 3 } }, ['test-fallback'])
  const third = await reconf.internals.scriptInfo(reconf.config.scriptRoots[0], 'mixed.txt')
  check('thumbFallback 变了，info 缓存键跟着变（max 3 → 3 张，不会拿到上面 6 张的缓存）', third.thumbs.length === 3, J(third.thumbs))
}

// ================= 3. 诊断 =================
{
  const mask = maskHeadSnippet('﻿{"error":{"msg":"こんにちは世界"},\n\t"data":{"user":{"name":"你好"}},\u0007"x":"ab"}')
  check('maskHeadSnippet：连续 3 个以上 CJK 换成 <N字>（2 个不换）、控制字符 / BOM 去掉、空白折叠', mask === '{"error":{"msg":"<7字>"}, "data":{"user":{"name":"你好"}},"x":"ab"}', mask)
  const long = maskHeadSnippet(`{"a":"${'x'.repeat(1000)}"}`)
  check('maskHeadSnippet：最多 160 个字符（加省略号）；超长的 CJK 只剩 <N字>（先截到 640 个字符再处理）', [...long].length === 161 && long.endsWith('…') && maskHeadSnippet('あ'.repeat(5000)) === '<640字>', `${[...long].length}`)
  check('maskHeadSnippet：空 / undefined / null', maskHeadSnippet('') === '' && maskHeadSnippet(undefined) === '' && maskHeadSnippet(null) === '', '')

  const real = '{"error":{"code":0,"msg":""},"data":{"user":{"name":"ぼくら","level":12,"items":[1,2,3]},"code":{"images":{}}},"server_time":1}'
  const sniffed = explainSniffGalAdapters(real, ['bokusen-json', 'uviewer-csv'], null)
  check('explainSniffGalAdapters：只列 sniff 没认的适配器；实现了 explainSniff 的用它的说明（bokusen：看到 data 但后面紧跟的不是 code），没实现的 = 「没有匹配 sniff」；说明里只有键名没有内容', sniffed.length === 2 && /"data" 后面紧跟的不是 "code".*error, code, msg, data, user/.test(sniffed.find((x) => x.id === 'bokusen-json').reason) && sniffed.find((x) => x.id === 'uviewer-csv').reason === '没有匹配 sniff' && !/ぼくら/.test(J(sniffed)), J(sniffed))
  registerGalAdapter({ id: 'test-thrower', label: 't', sniff: () => false, explainSniff: () => { throw new Error('boom') }, parse: () => ({ steps: [], stats: {} }) })
  registerGalAdapter({ id: 'test-numeric', label: 't', sniff: () => false, explainSniff: () => 42, parse: () => ({ steps: [], stats: {} }) })
  check('explainSniff 抛错 / 返回不是字符串 → 退回通用说明，不影响别的适配器', J(explainSniffGalAdapters('x', ['test-thrower', 'test-numeric'], null)) === J([{ id: 'test-thrower', reason: '没有匹配 sniff' }, { id: 'test-numeric', reason: '没有匹配 sniff' }]), '')
  const ex = explainRejectedFile({ text: real, size: real.length, maxBytes: 1e6, adapterIds: ['bokusen-json'] })
  check('explainRejectedFile：空文件 / 超大文件直接说文件的问题，不说 sniff', explainRejectedFile({ size: 0 }).reasons[0] === '文件是空的（0 字节）' && /超过脚本大小上限/.test(explainRejectedFile({ size: 5 * 1048576, maxBytes: 1048576 }).reasons[0]) && ex.reasons.length === 1 && ex.head.includes('<3字>'), J(ex))

  // 目录里的各种被拒文件（列表页 problems）
  for (const [name, content] of [['a_real.txt', real], ['b_cjk.txt', '今日はいい天気ですね。\u0003これは台本ではありません。'.repeat(30)], ['c_empty.txt', ''], ['d_long.txt', 'z'.repeat(6000)], ['e_more.txt', 'not a script'], ['f_more.txt', 'not a script either']]) await mk(`resources/diag/${name}`, content)
  await mk('resources/diag/ok.txt', csv('ok'))
  const node = await nodeOf({ scriptRoots: [{ id: 'text', dir: 'resources/diag' }] }, '', ['bokusen-json', 'uviewer-csv'])
  const problem = node.problems?.find((p) => p.code === 'unrecognized-scripts')
  const text = (problem?.details || []).join('\n')
  check('unrecognized-scripts：消息里是个数 + 文件名；details 最多 3 个样例（每个：文件名 + 大小 + 头部片段 + 每个适配器为什么没认）', Boolean(problem) && /6 个扩展名对的文件没有适配器认得/.test(problem.message) && problem.details.filter((l) => l.startsWith('样例 ')).length === 3 && /样例 a_real\.txt（\d+ 字节），开头：\{"error"/.test(text) && /bokusen-json: .*"data" 后面紧跟的不是 "code"/.test(text) && /uviewer-csv: 没有匹配 sniff/.test(text), J(problem))
  check('unrecognized-scripts：头部片段脱敏（CJK 连续 3 个以上 = <N字>，控制字符去掉），头部片段里没有 3 个以上连续的汉字 / 假名；空文件说「文件是空的」；不会带出长文本（每行 ≤ 400 字符，总共 ≤ 3000）', /<\d+字>/.test(text) && !/开头：.*[\u3040-\u30ff\u4e00-\u9fff]{3,}/.test(text) && !/\u0003/.test(text) && /样例 c_empty\.txt（0 字节）\n\s+文件是空的/.test(text) && problem.details.every((l) => l.length < 400) && text.length < 3000, text.slice(0, 600))
  check('unrecognized-scripts：d_long 这种长文本只出现 160 个字符 + …', problem.details.some((l) => /开头：z{100,}/.test(l) && !/z{200,}/.test(l)) || !problem.details.some((l) => l.includes('d_long')), J(problem.details))

  // 播放页节点也带 problems（config-dropped 等）
  const dropped = provider({ scriptRoots: [{ id: 'text', dir: 'resources/diag' }], thumbFallback: { max: 99 }, thumbSources: [{ dir: 'a', match: 'x', key: '{typo}' }] }, ['uviewer-csv'])
  const play = (await dropped.getNode('s:ok.txt')).node
  check('播放页节点带 problems：config 里被夹住 / 报警的内容（config-dropped）在播放页的渲染诊断里也看得到', play.kind === 'player' && play.problems?.some((p) => p.code === 'config-dropped' && /thumbFallback\.max/.test(p.message)) && play.problems.some((p) => /占位符 \{typo\}/.test(p.message)), J(play.problems))
  const clean = (await provider({ scriptRoots: [{ id: 'text', dir: 'resources/diag' }] }, ['uviewer-csv']).getNode('s:ok.txt')).node
  check('没有问题的播放页节点不带 problems 字段', clean.kind === 'player' && clean.problems === undefined, J(clean.problems))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
