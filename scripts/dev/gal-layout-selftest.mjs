#!/usr/bin/env node
// gal-layout 脚本自测（不需要浏览器）：已知布局表、探测结果回归（golden）、decoy / 搜索回退、别名、改动报告。需要 ImageMagick 和 python3（造 fixture）。
//   node scripts/dev/gal-layout-selftest.mjs                 跑测试
//   node scripts/dev/gal-layout-selftest.mjs --update-golden 重新生成 scripts/dev/gal-layout-golden.json（只在「探测结果有意改变」时用；规则表 / engine 字段关掉后的探测结果，即探测函数自己写的字段）
//   node scripts/dev/gal-layout-selftest.mjs --update-rules-golden 重新生成 scripts/dev/gal-layout-rules-golden.json（只含规则字段：adapterOptions 里探测函数没写的键 + classify / resourceResolve / indexSkip / limits / player；改了 ADAPTER_RULES / engine 后用，看 git diff 审）
//   GAL_LAYOUT_MAIN=/path/old-main.js …                      用另一份 main.js 跑（比较新旧实现）
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildBokusenFixture } from './make-bokusen-fixture.mjs'
import { buildGalFixture } from './make-gal-fixture.mjs'
import { buildMonmusuFixture, buildTenkeiFixture } from './make-gal-games-fixture.mjs'
import { buildGirlsCreationFixture } from './make-girlscreation-fixture.mjs'
import { buildGrenzeFixture } from './make-grenze-fixture.mjs'
import { buildKamihimeFixture } from './make-kamihime-fixture.mjs'
import { buildLegecloFixture } from './make-legeclo-fixture.mjs'
import { buildMinashigoFixture } from './make-minashigo-fixture.mjs'
import { buildTskFixture } from './make-tsk-fixture.mjs'
import { galAdapter } from '../../web/library/gal/adapters/index.mjs'
import { applyGalConfigPatch, normalizeGalConfig, normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const MAIN = process.env.GAL_LAYOUT_MAIN || path.join(here, '../tag-scripts/gal-layout/main.js')
const GOLDEN = path.join(here, 'gal-layout-golden.json')
const RULES_GOLDEN = path.join(here, 'gal-layout-rules-golden.json')
const mod = await import(pathToFileURL(MAIN).href)
const { generateTags } = mod
const LAYOUTS = mod.LAYOUTS   // 旧实现没有；新实现导出

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const J = (v) => JSON.stringify(v)
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-layout-selftest-'))
const put = async (root, rel, content = 'x') => { const abs = path.join(root, ...rel.split('/')); await mkdir(path.dirname(abs), { recursive: true }); await writeFile(abs, content) }
const run = (media, config = {}, options = {}, extra = {}) => generateTags({ item: { itemId: 'x', title: 'x', config, source: { path: media }, ...extra }, script: { id: 'gal-layout', version: '2.12.0', options } })
const cfgOf = (out) => out.itemPatch?.gal?.config
const sortDeep = (v) => (Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v)
const stable = (config) => { const c = JSON.parse(J(config || null)); if (c?.script) delete c.script.ranAt; return sortDeep(c) }

// ---------------------------------------------------------------- fixtures（每个游戏一个，路径 = 真实目录结构）
const rpy = (name) => `label ${name}:\n    scene bg_a\n    "甲" "你好"\n    return\n`
const CASES = [
  { name: 'uviewer', ids: ['uviewer', 'deepone'], build: (d) => buildGalFixture(d, { many: 3 }) },
  { name: 'legeclo', ids: ['legeclo'], build: buildLegecloFixture },
  { name: 'monmusu', ids: ['monmusu'], build: buildMonmusuFixture },
  { name: 'minashigo', ids: ['minashigo'], build: buildMinashigoFixture },
  { name: 'girlscreation', ids: ['girlscreation', 'girlscreation282', 'aster', 'jaxin', 'maid', 'aku', 'fruits'], build: buildGirlsCreationFixture },
  { name: 'tenkeiprdx', ids: ['tenkeiprdx'], build: (d) => buildTenkeiFixture(d) },
  { name: 'tsk', ids: ['tsk'], build: buildTskFixture },
  { name: 'grenze', ids: ['grenze'], build: buildGrenzeFixture },
  { name: 'kamihime', ids: ['kamihime'], build: buildKamihimeFixture },
  { name: 'bokusen', ids: ['bokusen'], build: buildBokusenFixture },
  {
    name: 'misttrain', ids: ['misttrain'], build: async (d) => {
      for (const rel of ['MistTrainGirls X_Data/StreamingAssets/MistTrainGirls X/UScenes/Stills/249', 'MistTrainGirls X_Data/StreamingAssets/MistTrainGirls X/UScenes/55000405', 'MistTrainGirls X_Data/StreamingAssets/MistTrainGirls X/Spines', 'MistTrainGirls X_Data/StreamingAssets/MistTrainGirls X/Sounds', 'MistTrainGirls X_Data/StreamingAssets/MistTrainGirls X/MasterData']) await mkdir(path.join(d, rel), { recursive: true })
      await put(d, 'MistTrainGirls X_Data/StreamingAssets/MistTrainGirls X/UScenes/Stills/249/224920105.json', '[]')
      await put(d, 'MistTrainGirls X_Data/StreamingAssets/MistTrainGirls X/UScenes/55000405/55000405.json', '[]')
    },
  },
  {
    name: 'angelic', ids: ['angelic'], build: async (d) => {
      for (const dir of ['game/script/hscene', 'game/script/sub_nav', 'game/images/bg', 'game/resources/012I']) await mkdir(path.join(d, dir), { recursive: true })
      await put(d, 'game/script/hscene/008JL955Z8.rpy', rpy('h_008'))
      await put(d, 'game/script/hscene/016IW9Z0AU.rpy', rpy('h_016'))
      await put(d, 'game/script/movies.rpy', 'image mv_a = Movie(play="resources/012I/a.webm")\n')
      await put(d, 'game/script/stills.rpy', 'image still_a = "resources/012I/s.png"\n')
    },
  },
  {
    name: 'artwhirl', ids: ['artwhirl'], build: async (d) => {
      for (const dir of ['game/episode_scripts/main', 'game/hscripts/h', 'game/images/stands', 'game/audio/bgm']) await mkdir(path.join(d, dir), { recursive: true })
      await put(d, 'game/episode_scripts/main/a.json', '{}')
      await put(d, 'game/hscripts/h/b.json', '{}')
    },
  },
  {
    name: 'minashigo_r', ids: ['minashigo_r'], build: async (d) => {
      for (const dir of ['data/adv/textfiles/story', 'data/adv/image', 'data/adv/sound']) await mkdir(path.join(d, dir), { recursive: true })
      await put(d, 'data/adv/textfiles/story/1001.txt', 'msg,0,hi\n')
      await put(d, 'data/adv/textfiles/story/1002.txt', 'msg,0,hi\n')
    },
  },
]

// 每个 case：media = <work>/<name>/<name>（直接）和 <work>/<name>（多一层，逼出搜索回退）；声明每个 id、不声明（自动探测）
async function buildAll() {
  const media = {}
  for (const c of CASES) {
    const base = path.join(work, c.name)
    const inner = path.join(base, c.name)
    await mkdir(base, { recursive: true })
    await c.build(inner)
    media[c.name] = { direct: inner, wrapped: base }
  }
  return media
}
const MEDIA = await buildAll()

// legacy = 把规则表和 engine 字段关掉（每个 id 的 ruleTables: [] / engine: {}）：只剩探测函数自己写的字段，和第 2.12 版的产出逐字段对比
const LEGACY_OPTIONS = () => ({ layouts: Object.fromEntries(Object.keys(LAYOUTS).map((id) => [id, { ruleTables: [], engine: {} }])) })
async function snapshot(legacy = true) {
  const snap = {}
  for (const c of CASES) {
    for (const variant of ['direct', 'wrapped']) {
      for (const id of [...c.ids, '']) {
        const out = await run(MEDIA[c.name][variant], id ? { game: { id } } : {}, legacy ? LEGACY_OPTIONS() : {})
        snap[`${c.name}|${variant}|${id || 'auto'}`] = {
          config: stable(cfgOf(out)),
          itemTags: out.itemTags,
          details: out.details ? { game: out.details.game, kind: out.details.kind, scripts: out.details.scripts, cover: out.details.cover, overrides: out.details.overrides } : null,
          replace: out.itemPatch?.gal?.replace,
        }
      }
    }
  }
  return snap
}

const ENGINE_KEYS = ['classify', 'resourceResolve', 'indexSkip', 'limits', 'player']
// 规则字段快照：每个游戏 id（直接放的目录、声明 id）一份：adapterOptions 里探测函数没写的键（= 规则表贡献的）+ engine 字段
async function rulesSnapshot() {
  const snap = {}
  for (const c of CASES) {
    for (const id of c.ids) {
      const full = cfgOf(await run(MEDIA[c.name].direct, { game: { id } }))
      const legacy = cfgOf(await run(MEDIA[c.name].direct, { game: { id } }, LEGACY_OPTIONS()))
      const entry = {}
      for (const [adapter, table] of Object.entries(full.adapterOptions || {})) {
        const own = legacy.adapterOptions?.[adapter] || {}
        entry[adapter] = Object.fromEntries(Object.entries(table).filter(([k]) => !(k in own)))
      }
      snap[id] = { adapterOptions: entry, ...Object.fromEntries(ENGINE_KEYS.filter((k) => full[k] !== undefined).map((k) => [k, full[k]])) }
    }
  }
  return sortDeep(snap)
}

if (process.argv.includes('--update-rules-golden')) {
  await writeFile(RULES_GOLDEN, `${JSON.stringify(await rulesSnapshot(), null, 1)}\n`)
  console.log(`wrote ${RULES_GOLDEN}`)
  await rm(work, { recursive: true, force: true })
  process.exit(0)
}

if (process.argv.includes('--update-golden')) {
  await writeFile(GOLDEN, `${JSON.stringify(await snapshot(), null, 1)}\n`)
  console.log(`wrote ${GOLDEN}`)
  await rm(work, { recursive: true, force: true })
  process.exit(0)
}

// ================= 回归：每个游戏 fixture 的探测结果和 golden（旧实现产出）逐字段一致 =================
{
  const golden = JSON.parse(await readFile(GOLDEN, 'utf8'))
  const snap = await snapshot()
  const keys = Object.keys(golden)
  check(`golden 覆盖 ${CASES.length} 个 fixture × 直接 / 多一层 × 每个 id + 自动探测（共 ${keys.length} 组）`, keys.length === Object.keys(snap).length && keys.every((k) => k in snap), J(keys.filter((k) => !(k in snap))))
  let bad = []
  for (const k of keys) if (J(golden[k]) !== J(snap[k])) bad.push(k)
  check('每一组：config / 标签 / details（游戏、类型、脚本数、封面）和 golden 完全相等', bad.length === 0, bad.slice(0, 3).map((k) => `${k}\n  want ${J(golden[k]).slice(0, 300)}\n  got  ${J(snap[k]).slice(0, 300)}`).join('\n'))
  const rulesGolden = JSON.parse(await readFile(RULES_GOLDEN, 'utf8'))
  const rulesNow = await rulesSnapshot()
  check(`规则 golden（${Object.keys(rulesGolden).length} 个游戏 id）：规则表贡献的 adapterOptions 键 + classify / resourceResolve / limits 和 gal-layout-rules-golden.json 逐字段一致`, J(rulesGolden) === J(rulesNow), Object.keys(rulesGolden).filter((k) => J(rulesGolden[k]) !== J(rulesNow[k])).join())
  const legacySnap = await snapshot(false)
  const sameDetector = Object.keys(golden).every((k) => { const a = JSON.parse(J(legacySnap[k].config)); for (const key of ENGINE_KEYS) delete a[key]; for (const [adapter, table] of Object.entries(a.adapterOptions || {})) a.adapterOptions[adapter] = Object.fromEntries(Object.entries(table).filter(([name]) => name in (golden[k].config.adapterOptions?.[adapter] || {}))); for (const adapter of Object.keys(a.adapterOptions || {})) if (!(adapter in (golden[k].config.adapterOptions || {}))) delete a.adapterOptions[adapter]; if (a.adapterOptions && !Object.keys(a.adapterOptions).length) delete a.adapterOptions; return J(sortDeep(a)) === J(golden[k].config) })
  check('规则表是纯增量：打开规则表后的结果，去掉规则字段（engine 字段 + 探测函数没写的 adapterOptions 键），和旧 golden 逐字段相等（探测函数写的 root / aliasFiles / imageDirs / 布局字段一个没变）', sameDetector)
  check('golden 里至少有一组真的认出了游戏（防止全是空的假通过）', keys.filter((k) => golden[k].config?.game?.id).length >= 40, String(keys.filter((k) => golden[k].config?.game?.id).length))
}


const ALL_IDS = ['uviewer', 'deepone', 'legeclo', 'monmusu', 'angelic', 'minashigo', 'minashigo_r', 'girlscreation', 'girlscreation282', 'aster', 'jaxin', 'maid', 'aku', 'fruits', 'tenkeiprdx', 'misttrain', 'artwhirl', 'kamihime', 'bokusen', 'grenze', 'tsk', 'otogi']
const logText = (out) => (out.logs || []).join('\n')
const withLayouts = (layouts) => ({ layouts })

// ================= 表：22 个 id 全在、extends 都解析得到、所有列表字段都是数组 =================
{
  check('LAYOUTS 导出了、含全部 22 个 id（不多不少）', LAYOUTS && J(Object.keys(LAYOUTS).sort()) === J([...ALL_IDS].sort()), J(Object.keys(LAYOUTS || {})))
  const unresolved = []
  for (const id of ALL_IDS) {
    const problems = []
    const entry = mod.resolveLayout(id, {}, problems)
    if (!entry || problems.length) unresolved.push(`${id}: ${problems.join(';')}`)
  }
  check('每个 id 都能解析出可用的布局（extends 链到头、bases / anchors 非空）', !unresolved.length, unresolved.join(' | '))
  const dangling = Object.entries(LAYOUTS).filter(([, e]) => e.extends !== undefined && !(typeof e.extends === 'string' && e.extends in LAYOUTS)).map(([id]) => id)
  check('每个 extends 都指向表里存在的 id', !dangling.length, dangling.join())
  const aliases = Object.entries(LAYOUTS).filter(([, e]) => e.extends).map(([id, e]) => `${id}→${e.extends}`).sort()
  check('别名：aster / jaxin / maid / aku / fruits → girlscreation，deepone → uviewer（用 extends，没有拷贝整份）', J(aliases) === J(['aku→girlscreation', 'aster→girlscreation', 'deepone→uviewer', 'fruits→girlscreation', 'girlscreation282→girlscreation', 'jaxin→girlscreation', 'maid→girlscreation']) && Object.entries(LAYOUTS).filter(([, e]) => e.extends).every(([, e]) => Object.keys(e).filter((k) => k !== 'extends' && k !== 'title' && !(k === 'engine' && e === LAYOUTS.aku)).length === 0), aliases.join())   // 别名只改 title；唯一的例外是 aku 多一份 engine（player.cameraMode: 'widget'，原版 spine-widget 的摆放）
  const girls = mod.resolveLayout('girlscreation')
  const noAkuPlayer = (layout) => ({ ...layout, title: '', engine: { ...layout.engine, player: undefined } })
  check('别名解析出来的数据 = 父项的数据（只有 title 不同；aku 另有 engine.player.cameraMode = widget）', ALL_IDS.filter((id) => LAYOUTS[id].extends === 'girlscreation').every((id) => J(noAkuPlayer(mod.resolveLayout(id))) === J(noAkuPlayer(girls))) && J(mod.resolveLayout('aku').engine.player) === J({ cameraMode: 'widget' }) && !girls.engine.player)
  const handlers = ALL_IDS.map((id) => [id, LAYOUTS[id].autoOrder])
  check('自动探测顺序：只有主 id 有 autoOrder（别名只在声明了 game.id 时走），顺序 legeclo → monmusu → angelic → girlscreation → …', J(handlers.filter(([, o]) => Number.isFinite(o)).sort((a, b) => a[1] - b[1]).map(([id]) => id)) === J(['legeclo', 'monmusu', 'angelic', 'girlscreation', 'tenkeiprdx', 'misttrain', 'minashigo', 'minashigo_r', 'artwhirl', 'kamihime', 'bokusen', 'grenze', 'tsk', 'otogi', 'uviewer']), J(handlers))
}
{
  // schema：遍历表里每一项（未解析 extends 的原始写法），所有「列表」字段必须是数组，哪怕现在只有一个元素
  const TOP_LISTS = ['bases', 'anchors', 'siblings', 'markers', 'scriptRoots', 'resourceRoots', 'adapters', 'count', 'cover', 'avatars', 'scriptIndexScan', 'expectedDirs', 'nodes', 'notes']
  const CONFIG_LISTS = ['namesFiles', 'thumbsDirs', 'scriptExtensions', 'hiddenDirs', 'merge', 'views', 'groups', 'dirThumbs', 'scriptThumbs', 'scriptIndex', 'thumbSources', 'stripPrefixes']
  const bad = []
  const isPlainObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
  for (const [id, entry] of Object.entries(LAYOUTS)) {
    for (const key of TOP_LISTS) if (entry[key] !== undefined && !Array.isArray(entry[key])) bad.push(`${id}.${key}`)
    if (entry.config !== undefined) {
      if (!isPlainObj(entry.config)) bad.push(`${id}.config`)
      else for (const key of CONFIG_LISTS) if (entry.config[key] !== undefined && !Array.isArray(entry.config[key])) bad.push(`${id}.config.${key}`)
      if (isPlainObj(entry.config) && entry.config.labels !== undefined && !isPlainObj(entry.config.labels)) bad.push(`${id}.config.labels`)
    }
    for (const [adapter, options] of Object.entries(entry.adapterOptions || {})) {
      if (!isPlainObj(options)) { bad.push(`${id}.adapterOptions.${adapter}`); continue }
      for (const [name, spec] of Object.entries(options)) {
        if (isPlainObj(spec) && !((Array.isArray(spec.path) && Object.keys(spec).length === 1) || (Array.isArray(spec.paths) && Object.keys(spec).length === 1))) bad.push(`${id}.adapterOptions.${adapter}.${name}`)
      }
    }
    for (const root of entry.scriptRoots || []) if (!(typeof root.dir === 'string' || Array.isArray(root.dir))) bad.push(`${id}.scriptRoots.dir`)
    for (const marker of entry.markers || []) if (!(typeof marker === 'string' || (Array.isArray(marker) && marker.every((m) => typeof m === 'string')))) bad.push(`${id}.markers`)
    if (entry.extends === undefined) {
      for (const key of ['bases', 'anchors', 'scriptRoots', 'resourceRoots', 'adapters']) if (!Array.isArray(entry[key])) bad.push(`${id}.${key}（必填）`)
      if (!entry.config || typeof entry.config !== 'object') bad.push(`${id}.config（必填）`)
    }
  }
  check('schema：表里所有列表字段（bases / anchors / siblings / markers / scriptRoots / resourceRoots / adapters / scriptExtensions / hiddenDirs / thumbsDirs …）都是数组，adapterOptions 只用 {path: []} / {paths: []} 两种候选写法', !bad.length, bad.join(', '))
  const fixed = Object.entries(LAYOUTS).filter(([, e]) => !e.extends).every(([, e]) => e.bases.every((b) => typeof b === 'string') && e.anchors.length >= 1)
  check('每个游戏至少有一个 bases 候选和一个 anchors', fixed)
}

// ================= decoy：字典序更靠前的假目录不能抢走已知布局 =================
{
  const lg = path.join(work, 'decoy-legeclo')
  await buildLegecloFixture(lg)
  await put(lg, 'aaa/script/hscene/zzz_01.rpy', 'label x:\n    return\n')   // BFS 会先搜到它
  const out = await run(lg, { game: { id: 'legeclo' } })
  check('decoy legeclo：声明了 id 时按表里的 game/script/hscene，不被 aaa/script/hscene 抢走；日志说「已知布局命中」', cfgOf(out)?.scriptRoots[0].dir === 'game/script/hscene' && /已知布局命中：legeclo/.test(logText(out)) && !/改用搜索/.test(logText(out)), logText(out))
  const auto = await run(lg, {})
  check('decoy legeclo：不声明（自动探测）同样认 game/script/hscene', cfgOf(auto)?.game?.id === 'legeclo' && cfgOf(auto).scriptRoots[0].dir === 'game/script/hscene', logText(auto))

  const bk = path.join(work, 'decoy-bokusen')
  await buildBokusenFixture(bk)
  await put(bk, 'aaa/json/x.json', '{}')
  const bo = await run(bk, { game: { id: 'bokusen' } })
  check('decoy bokusen：aaa/json 不抢根目录的 json/；脚本数 = 根 json/ 里的 3 个', cfgOf(bo)?.scriptRoots[0].dir === 'json' && cfgOf(bo).scriptCount === 3 && /已知布局命中：bokusen/.test(logText(bo)), logText(bo))
  const bauto = await run(bk, {})
  check('decoy bokusen：自动探测也认根目录的（脚本内容标记 + resource/）', cfgOf(bauto)?.game?.id === 'bokusen' && cfgOf(bauto).scriptRoots[0].dir === 'json', logText(bauto))

  // tsk：*_Data/StreamingAssets/* 通配候选；旁边有字典序更靠前的 Aaa_Data / Other_Data 假目录（有 Adventure/Master.chapter.json 但没有 Characters|Stills|Sound，或者根本没有 Master.chapter.json）
  const tskRoot = path.join(work, 'decoy-tsk')
  await buildTskFixture(tskRoot)
  const game = path.join(tskRoot, 'Twinkle Star Knights X')
  await put(game, 'Aaa_Data/StreamingAssets/Foo/Adventure/Master.chapter.json', '{}')
  await put(game, 'Other_Data/StreamingAssets/Bar/Adventure/x.book.json', '{}')
  await put(game, 'Other_Data/StreamingAssets/Bar/Characters/a.png', 'x')
  const ts = await run(game, { game: { id: 'tsk' } })
  const real = 'Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X'
  check('decoy tsk：通配 *_Data/StreamingAssets/* 展开后逐个核对 anchors / siblings，假目录（Aaa_Data / Other_Data）被跳过；命中真正的数据根', cfgOf(ts)?.resourceRoots[0] === real && cfgOf(ts).scriptRoots[0].dir === `${real}/Adventure` && cfgOf(ts).adapterOptions['utage-book'].root === real && /已知布局命中：tsk → Twinkle Star Knights X_Data/.test(logText(ts)), logText(ts))
  const tsAuto = await run(game, {})
  check('decoy tsk：自动探测一样', cfgOf(tsAuto)?.game?.id === 'tsk' && cfgOf(tsAuto).resourceRoots[0] === real, logText(tsAuto))

  // tenkeiprdx：*_Data/StreamingAssets/*/*，假目录只有 scenes/（没有 Backgrounds|Spines|Stills|Masterdata）
  const tk = path.join(work, 'decoy-tenkei')
  await buildTenkeiFixture(path.join(tk, 'Tenkei_Data/StreamingAssets/Game/Imported'), { wrapper: false })
  await put(tk, 'Aaa_Data/StreamingAssets/Game/Imported/scenes/a.json', '{}')
  const tko = await run(tk, { game: { id: 'tenkeiprdx' } })
  check('decoy tenkeiprdx：只有 scenes/ 的 Aaa_Data 假目录不算（要同级有 Backgrounds|Spines|Stills|Masterdata）；命中 Tenkei_Data/StreamingAssets/Game/Imported', cfgOf(tko)?.resourceRoots[0] === 'Tenkei_Data/StreamingAssets/Game/Imported' && /已知布局命中：tenkeiprdx/.test(logText(tko)), logText(tko))
}

// ================= 回退：布局挪到了表里没有的位置 → 广度优先搜索，日志说是搜索 =================
{
  for (const [id, build, key] of [['legeclo', buildLegecloFixture, 'scriptRoots'], ['monmusu', buildMonmusuFixture, 'scriptRoots'], ['girlscreation', buildGirlsCreationFixture, 'scriptRoots'], ['bokusen', buildBokusenFixture, 'scriptRoots'], ['tsk', buildTskFixture, 'scriptRoots']]) {
    const dir = path.join(work, `moved-${id}`)
    const deep = id === 'tsk' ? ['x'] : ['x', 'y', 'z']   // tsk 的数据根本身已经在第 4 层
    await build(path.join(dir, ...deep))
    const out = await run(dir, { game: { id } })
    const cfg = cfgOf(out)
    check(`搜索回退 ${id}：布局在 ${deep.join('/')} 下（表里没有这个位置）仍然认出来，日志说「已知布局没命中，改用搜索」，路径带上多出的前缀`, cfg?.game?.id === id && /已知布局没命中，改用搜索/.test(logText(out)) && !/已知布局命中/.test(logText(out)) && cfg[key][0].dir.startsWith(`${deep.join('/')}/`), logText(out))
  }
  // 表里改 bases 就能认：不用改代码（选项 layouts 覆盖）
  const dir = path.join(work, 'moved-legeclo2')
  await buildLegecloFixture(path.join(dir, 'weird'))
  const plain = await run(dir, { game: { id: 'legeclo' } })
  const patched = await run(dir, { game: { id: 'legeclo' } }, withLayouts({ legeclo: { bases: ['', 'weird/game'] } }))
  check('改表（选项 layouts.legeclo.bases）后直接命中已知布局，不再搜索', /改用搜索/.test(logText(plain)) && /已知布局命中：legeclo → weird\/game/.test(logText(patched)) && J(stable(cfgOf(plain))) === J(stable(cfgOf(patched))), logText(patched))
  // 写坏的表项不崩：忽略、记日志、用内置的
  const garbled = [{ legeclo: { bases: 'oops', anchors: 42, scriptRoots: 'x' } }, { legeclo: null }, { legeclo: [] }, { legeclo: { bases: [], anchors: [] } }, { legeclo: { bases: ['a/../b', '/(unclosed/'], anchors: [{}] } }, { nope: { x: 1 } }, 'junk']
  let crashed = ''
  const okAll = []
  for (const layouts of garbled) {
    try {
      const out = await run(MEDIA.legeclo.direct, { game: { id: 'legeclo' } }, { layouts })
      okAll.push(cfgOf(out)?.game?.id === 'legeclo' && cfgOf(out).scriptRoots[0].dir === 'game/script/hscene')
    } catch (error) { crashed = String(error); okAll.push(false) }
  }
  check('写坏的 layouts 覆盖（类型不对 / 空 / 非法路径 / 不存在的 id）：不崩、仍然按内置的布局认出来', !crashed && okAll.every(Boolean), `${crashed} ${okAll}`)
  // 表本身被改坏（脚本里手改写错了）：整项不是对象 / extends 指向不存在 / 循环 extends → 不崩，认得出的照常认
  const saved = { tsk: LAYOUTS.tsk, legeclo: LAYOUTS.legeclo, monmusu: LAYOUTS.monmusu }
  LAYOUTS.junk = null; LAYOUTS.loopA = { extends: 'loopB' }; LAYOUTS.loopB = { extends: 'loopA' }; LAYOUTS.tsk = { extends: 'nowhere' }; LAYOUTS.legeclo = 'garbage'; LAYOUTS.monmusu = { ...saved.monmusu, bases: 7, anchors: 'x' }
  let tableCrash = ''
  const outs = []
  try {
    for (const [media, cfg] of [[MEDIA.tsk.direct, { game: { id: 'tsk' } }], [MEDIA.legeclo.direct, { game: { id: 'legeclo' } }], [MEDIA.legeclo.direct, {}], [MEDIA.bokusen.direct, {}], [MEDIA.uviewer.direct, { game: { id: 'loopA' } }], [MEDIA.monmusu.direct, { game: { id: 'monmusu' } }], [MEDIA.girlscreation.direct, {}]]) outs.push(await run(media, cfg))
  } catch (error) { tableCrash = String(error.stack || error) }
  for (const [key, value] of Object.entries(saved)) LAYOUTS[key] = value
  for (const key of ['junk', 'loopA', 'loopB']) delete LAYOUTS[key]
  check('LAYOUTS 本身被改坏（项不是对象 / extends 指向不存在或循环 / 字段类型不对）：不崩，坏的游戏跳过并说明，别的游戏照常认', !tableCrash && outs[3] && cfgOf(outs[3])?.game?.id === 'bokusen' && cfgOf(outs[6])?.game?.id === 'girlscreation' && outs[1].itemPatch === undefined, tableCrash || outs.map((o) => logText(o).slice(0, 200)).join('\n---\n'))
  const g1 = await run(MEDIA.legeclo.direct, { game: { id: 'legeclo' } }, { layouts: { legeclo: { bases: 'oops' } } })
  check('写坏的字段在日志里说明（布局表「legeclo」：bases 不是数组）', /布局表「legeclo」：bases 不是数组/.test(logText(g1)), logText(g1))
  const g2 = await run(MEDIA.tsk.direct, { game: { id: 'tsk' } }, { layouts: { tsk: { markers: [5, ['a', 7]], siblings: ['/(bad/'] } } })
  check('部分写坏（markers / siblings 里有非法项）：非法项丢掉，别的照用，不崩', cfgOf(g2)?.game?.id === 'tsk', logText(g2))
}

// ================= 别名：共用 girlscreation 的数据，写回各自声明的 id =================
{
  const base = await run(MEDIA.girlscreation.direct, { game: { id: 'girlscreation' } })
  for (const id of ['girlscreation282', 'aster', 'jaxin', 'maid', 'aku', 'fruits']) {
    const out = await run(MEDIA.girlscreation.direct, { game: { id, title: `T-${id}` } })
    const cfg = cfgOf(out)
    check(`别名 ${id}：数据和 girlscreation 一致（aku 多 player.cameraMode = widget），game.id 写回「${id}」（title 保留）、标签 Gal游戏: ${id}`, cfg?.game?.id === id && cfg.game.title === `T-${id}` && J(stable({ ...cfg, game: null, player: null })) === J(stable({ ...cfgOf(base), game: null, player: null })) && (id === 'aku' ? cfg.player?.cameraMode === 'widget' : !cfg.player?.cameraMode) && out.itemTags.includes(`Gal游戏: ${id}`) && out.details.kind === 'girlscreation', J(cfg?.game))
  }
  const dp = await run(MEDIA.uviewer.direct, { game: { id: 'deepone' } })
  const uv = await run(MEDIA.uviewer.direct, { game: { id: 'uviewer' } })
  check('别名 deepone：和 uviewer 同一套探测，写回 deepone', cfgOf(dp)?.game?.id === 'deepone' && J(stable({ ...cfgOf(dp), game: null })) === J(stable({ ...cfgOf(uv), game: null })) && dp.itemTags.includes('Gal游戏: deepone'))
  const auto = await run(MEDIA.girlscreation.direct, {})
  check('自动探测（没填 id）时别名不抢：认成 girlscreation', cfgOf(auto)?.game?.id === 'girlscreation')
}

// ================= 改动报告 =================
const storeOf = (out, prev = {}, replace = out.itemPatch?.gal?.replace) => ({ config: applyGalConfigPatch(prev, out.itemPatch.gal.config, { replace }), tags: out.itemTags })
const summaryOf = (out) => (out.logs || []).find((l) => /^(本次改动|没有改动)/.test(l)) || ''
const lineOf = (out, re) => (out.logs || []).find((l) => re.test(l)) || ''
{
  const first = await run(MEDIA.uviewer.direct, {}, {}, { tags: [] })
  const s1 = summaryOf(first)
  const added = first.details.changes.added.map((x) => x.field)
  check('改动报告：空条目第一次运行 → 汇总在最前面、全是新增、没有修改 / 删除 / 未变', /^本次改动：新增 \d+ 项 \/ 修改 0 项 \/ 删除 0 项 \/ 未变 0 项（共 \d+ 个字段）$/.test(s1) && first.logs.indexOf(s1) > 0 && added.includes('scriptRoots') && added.includes('cover') && added.includes('scriptCount') && added.includes('game') && first.details.changes.changed.length === 0 && first.details.changes.kept.length === 0, `${s1}\n${logText(first)}`)
  check('改动报告：新增的数组字段列出内容和项数；标签 / game.id 写回有说明', /^\+ scriptRoots（新增）：2 项 /.test(lineOf(first, /^\+ scriptRoots/)) && /game\.id：写回「uviewer」（原来没有）/.test(logText(first)) && /标签：新增 Gal配置: uviewer、Gal配置version: 2\.12\.0、Gal游戏: uviewer；无删除/.test(logText(first)), logText(first))
  check('改动报告：config.script 运行标记不算进改动（不在任何一类里）', ![...first.details.changes.added, ...first.details.changes.changed].some((x) => x.field === 'script') && !first.details.changes.unchanged.includes('script'))

  const item2 = storeOf(first)
  const second = await run(MEDIA.uviewer.direct, item2.config, {}, { tags: item2.tags })
  check('改动报告：紧接着第二次相同运行 → 「没有改动」，details.changes 全是 unchanged', summaryOf(second) === '没有改动' && second.details.changes.added.length + second.details.changes.changed.length + second.details.changes.removed.length === 0 && second.details.changes.unchanged.length === added.length, logText(second))

  // 改一处：删掉脚本根里的一个元素 / 加一条多余的缩略图目录
  const stored = storeOf(first)
  const cfg1 = JSON.parse(J(stored.config))
  cfg1.scriptRoots = cfg1.scriptRoots.slice(0, 1)
  cfg1.thumbsDirs = [...cfg1.thumbsDirs, 'stray/thumbs']
  const third = await run(MEDIA.uviewer.direct, cfg1, {}, { tags: stored.tags })
  const ch = third.details.changes
  check('改动报告：只改了 scriptRoots（缺一项）和 thumbsDirs（多一项）→ 恰好这两个字段是「修改」，别的都是未变', J(ch.changed.map((x) => x.field).sort()) === J(['scriptRoots', 'thumbsDirs']) && ch.added.length === 0 && ch.removed.length === 0 && /修改 2 项/.test(summaryOf(third)), logText(third))
  check('改动报告：数组列出具体增删的项（scriptRoots 新增 1 项 text---日文…；thumbsDirs 删除 1 项 stray/thumbs），不是只说「变了」', /~ scriptRoots（修改）：新增 1 项 .*text---/.test(lineOf(third, /^~ scriptRoots/)) && /~ thumbsDirs（修改）：删除 1 项 "stray\/thumbs"/.test(lineOf(third, /^~ thumbsDirs/)), logText(third))
  check('改动报告：details.changes.changed 带简要信息（+1 −0 / +0 −1）', ch.changed.find((x) => x.field === 'scriptRoots').info === '+1 −0' && ch.changed.find((x) => x.field === 'thumbsDirs').info === '+0 −1', J(ch.changed))
  // 标量：封面 / 脚本数旧 → 新
  const cfg2 = JSON.parse(J(stored.config)); cfg2.cover = 'old/cover.png'; cfg2.scriptCount = 3
  const fourth = await run(MEDIA.uviewer.direct, cfg2, {}, { tags: stored.tags })
  check('改动报告：标量字段 旧 → 新（cover / scriptCount）', /~ cover（修改）："old\/cover\.png" → "~\/user_data/.test(lineOf(fourth, /^~ cover/)) && /~ scriptCount（修改）：3 → 27/.test(lineOf(fourth, /^~ scriptCount/)), logText(fourth))
  // 对象：改了哪些键
  const cfg3 = JSON.parse(J(stored.config)); cfg3.game = { id: 'deepone', title: '' }
  const fifth = await run(MEDIA.uviewer.direct, cfg3, {}, { tags: stored.tags })
  check('改动报告：条目声明了 deepone → 写回的还是 deepone（game.id「未变」）；自动探测认成 uviewer 而条目里原来是别的 id 时才会显示 a → b', /game\.id：「deepone」未变/.test(logText(fifth)) && fifth.details.changes.game.after === 'deepone', logText(fifth))
  // 保留：合并模式下本次没写的字段
  const cfg4 = { ...JSON.parse(J(stored.config)), pageSize: 50, labels: { a: 'b' } }
  const sixth = await run(MEDIA.uviewer.direct, cfg4, {}, { tags: stored.tags })
  check('改动报告：合并模式下本次没写的字段列为「保留」（pageSize / labels），不算删除', J(sixth.details.changes.kept.sort()) === J(['labels', 'pageSize']) && /保留（本次没写，原值不动）：.*pageSize/.test(logText(sixth)) && sixth.details.changes.removed.length === 0, logText(sixth))
  // replace = true：没写的字段被删掉
  const seventh = await run(MEDIA.uviewer.direct, cfg4, { replace: true }, { tags: stored.tags })
  check('改动报告：replace=true 时没写的字段（pageSize / labels）列为「删除」', J(seventh.details.changes.removed.map((x) => x.field).sort()) === J(['labels', 'pageSize']) && seventh.details.changes.kept.length === 0 && /- pageSize（删除，replace 整体替换）：原值 50/.test(logText(seventh)) && /删除 2 项/.test(summaryOf(seventh)), logText(seventh))
  // 补丁里的 null（overrides 写 null = 删掉）
  const eighth = await run(MEDIA.uviewer.direct, cfg4, { overrides: [{ path: '*', config: { pageSize: null } }] }, { tags: stored.tags })
  check('改动报告：overrides 写 null = 删掉字段，列为删除；覆盖项列出改了哪些字段', eighth.details.changes.removed.some((x) => x.field === 'pageSize') && /覆盖项第 1 条改了：config\.pageSize/.test(logText(eighth)) && J(eighth.details.changes.overrides) === J([{ rule: 1, fields: ['config.pageSize'] }]), logText(eighth))
  // 版本变化：标签变
  const ninth = await generateTags({ item: { itemId: 'x', config: stored.config, source: { path: MEDIA.uviewer.direct }, tags: stored.tags }, script: { id: 'gal-layout', version: '9.9.9', options: {} } })
  check('改动报告：脚本版本变了 → config 全是未变，但标签 Gal配置version 换了，汇总不会说「没有改动」', summaryOf(ninth) !== '没有改动' && /标签：新增 Gal配置version: 9\.9\.9；删除 Gal配置version: 2\.12\.0/.test(logText(ninth)) && ninth.details.changes.tags.added.length === 1, logText(ninth))
  // 覆盖项（cover / title / config）
  const tenth = await run(MEDIA.uviewer.direct, {}, { overrides: [{ path: '*', config: { pageSize: 10 }, cover: 'x.png', title: 'Renamed' }] }, { title: 'Old' })
  check('改动报告：覆盖项列出改了哪些字段（config.pageSize / cover / title）+ 标题变化', /覆盖项第 1 条改了：config\.pageSize、cover、title/.test(logText(tenth)) && /标题：Old → Renamed/.test(logText(tenth)) && tenth.details.changes.title.to === 'Renamed', logText(tenth))
  // dryRun
  const dry = await run(MEDIA.uviewer.direct, cfg1, { dryRun: true }, { tags: stored.tags })
  check('改动报告：dryRun 标「【dryRun】将要产生的改动」、汇总紧跟其后；不写任何东西（没有 itemPatch）；details.changes 仍在', dry.logs.some((l, i) => l === '【dryRun】将要产生的改动' && /^本次改动：/.test(dry.logs[i + 1])) && dry.itemPatch === undefined && dry.details.changes.dryRun === true && dry.details.changes.changed.length === 2 && J(dry.itemTags) === J(stored.tags), logText(dry))
  const dryNo = await run(MEDIA.uviewer.direct, item2.config, { dryRun: true }, { tags: item2.tags })
  check('改动报告：dryRun 且没有改动 → 「【dryRun】将要产生的改动」+「没有改动」', dryNo.logs.some((l, i) => l === '【dryRun】将要产生的改动' && dryNo.logs[i + 1] === '没有改动'), logText(dryNo))
  // keepOwn 路径：没有识别 / 跳过
  const missing = await run(path.join(work, 'does-not-exist'), {})
  const unknown = await run(MEDIA.uviewer.direct, { game: { id: 'nope' } })
  const wrong = await run(MEDIA.legeclo.direct, { game: { id: 'tsk' } })
  check('改动报告：不认识的 id / 目录不存在 / 声明了 id 但认不出结构 → 「没有改动（未识别 / 已跳过）」，没有 itemPatch，details.changes.skipped', [missing, unknown, wrong].every((o) => o.logs.includes('没有改动（未识别 / 已跳过）') && o.itemPatch === undefined && o.details.changes.skipped === true), [missing, unknown, wrong].map(logText).join('\n---\n'))
  check('改动报告：skipped 的 details.changes 把现有字段列为 kept（原样不动）', J(unknown.details.changes.kept) === J(['game']), J(unknown.details.changes))
}

// ================= 全部 fixture：存下来再跑一遍都是「没有改动」（改动对比的规整和引擎一致）；日志 / details 的体量在服务端限额内 =================
{
  const notStable = []
  const oversize = []
  for (const c of CASES) {
    for (const variant of ['direct', 'wrapped']) {
      for (const id of [...c.ids, '']) {
        const cfg0 = id ? { game: { id } } : {}
        const out1 = await run(MEDIA[c.name][variant], cfg0)
        const st = storeOf(out1, cfg0)
        const out2 = await run(MEDIA[c.name][variant], st.config, {}, { tags: st.tags })
        if (summaryOf(out2) !== '没有改动') notStable.push(`${c.name}|${variant}|${id || 'auto'}: ${summaryOf(out2)} ${J(out2.details.changes.changed)}`)
        for (const out of [out1, out2]) {
          const lines = out.logs.flatMap((l) => String(l).split(/\r?\n/))
          if (lines.length > 80 || lines.some((l) => l.length > 500) || out.logs.some((l) => typeof l !== 'string') || JSON.stringify(out.details).length > 4000) oversize.push(`${c.name}|${variant}|${id}: ${lines.length} 行 / details ${JSON.stringify(out.details).length}`)
        }
      }
    }
  }
  check(`每个 fixture × 每个 id（共 ${CASES.reduce((n, c) => n + (c.ids.length + 1) * 2, 0)} 组）：存进条目（引擎的合并规整）后再跑一次 = 「没有改动」`, !notStable.length, notStable.slice(0, 4).join('\n'))
  check('日志都是字符串、不超过 80 行 / 每行 500 字（服务端 normalizeScriptLogs 的限额），details 在 4000 字符内', !oversize.length, oversize.slice(0, 4).join('\n'))

  // 体量失控：现有 config 巨大、全变 → 改动明细被截断，写「… 另有 N 项」，改动段 ≤ 8KB
  const huge = { scriptThumbs: Array.from({ length: 10 }, (_, i) => `~/{thumbsDir}/${'x'.repeat(280)}${i}.webp`), labels: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, `v${i}`])) }
  const out = await run(MEDIA.uviewer.direct, huge, { replace: true })
  const section = out.logs.slice(out.logs.findIndex((l) => /^本次改动/.test(l)))
  check('大量改动：每行 ≤ 500 字、改动段 ≤ 8KB、总行数 ≤ 80；明细放不下时有「… 另有 N 项」', section.every((l) => l.length <= 500) && Buffer.byteLength(section.join('\n')) <= 8192 && out.logs.length <= 80 && JSON.stringify(out.details).length <= 4000, `${out.logs.length} 行 ${Buffer.byteLength(section.join('\n'))} 字节`)
  const many = await run(MEDIA.uviewer.direct, Object.fromEntries(Array.from({ length: 24 }, (_, i) => [['scriptThumbs', 'thumbsDirs', 'namesFiles', 'hiddenDirs', 'rawIgnore', 'merge'][i % 6], []])), { replace: true, overrides: Array.from({ length: 70 }, (_, i) => ({ path: '*', config: { [`z${i}`]: i } })) })
  check('极端：70 条覆盖项也不会把日志撑过 80 行', many.logs.length <= 80, String(many.logs.length))
}


// ================= 规则表（ADAPTER_RULES + engine 字段）：写进 config、体量、端到端等价、和 layouts / overrides 的关系 =================
{
  const manifest = JSON.parse(await readFile(path.join(path.dirname(MAIN), 'manifest.json'), 'utf8'))
  check('manifest：版本 2.17.0，description 说明规则表（ADAPTER_RULES / ruleTables / engine）在 main.js 里、改表重跑即可', manifest.version === '2.17.0' && /ADAPTER_RULES/.test(manifest.description) && /ruleOverrides/.test(manifest.description), manifest.version)

  // 每个 fixture 的声明 id（别名都跑）：写出来的 config 经过引擎规整一条警告都没有（规则表 / engine 字段都合格），体量在引擎上限内
  const tooBig = []
  const warned = []
  const biggest = { id: '', adapter: '', size: 0 }
  let nTables = 0
  for (const c of CASES) {
    for (const id of c.ids) {
      const out = await run(MEDIA[c.name].direct, { game: { id } })
      const cfg = cfgOf(out)
      const total = JSON.stringify(cfg.adapterOptions || {}).length
      for (const [adapter, table] of Object.entries(cfg.adapterOptions || {})) {
        const size = JSON.stringify(table).length
        nTables++
        if (size > biggest.size) Object.assign(biggest, { id, adapter, size })
        if (size > 16 * 1024) tooBig.push(`${id}.${adapter}: ${size}`)
      }
      if (total > 64 * 1024) tooBig.push(`${id} 合计 ${total}`)
      const { warnings } = normalizeGalConfigWithWarnings(cfg)
      if (warnings.length) warned.push(`${id}: ${warnings.map((w) => `${w.field} ${w.reason}`).join('; ').slice(0, 200)}`)
      const kept = normalizeGalConfig(applyGalConfigPatch({}, cfg))
      for (const adapter of Object.keys(cfg.adapterOptions || {})) if (!kept.adapterOptions?.[adapter]) warned.push(`${id}: ${adapter} 被引擎丢掉`)
      if ('pending' in cfg) warned.push(`${id}: pending 被写进了 config`)
    }
  }
  check(`体量：每个游戏写出的每个适配器表 ≤ 16 KB、合计 ≤ 64 KB（共 ${nTables} 张表，最大 ${biggest.adapter}（${biggest.id}）${biggest.size} 字符）`, !tooBig.length && biggest.size > 1000, tooBig.join(' | '))
  check('写出的 config（含规则表 / classify / resourceResolve / limits）经引擎规整没有任何警告、适配器表一张不丢；pending 占位只是文档，不写进 config', !warned.length, warned.slice(0, 4).join('\n'))

  // 端到端等价：写满规则表（+ engine 字段）和关掉规则表时，每个脚本解析出来的场景逐字节相同（适配器在自己的默认值上合并，写满 = 没写）
  const walkScripts = async (root, exts, limit = 60) => {
    const found = []
    const walk = async (dir) => {
      let names = []
      try { names = await readdir(path.join(MEDIA_ROOT, dir), { withFileTypes: true }) } catch { return }
      for (const e of names.sort((a, b) => a.name.localeCompare(b.name))) {
        if (found.length >= limit) return
        const rel = dir ? `${dir}/${e.name}` : e.name
        if (e.isDirectory()) await walk(rel)
        else if (exts.includes(path.extname(e.name).slice(1).toLowerCase())) found.push(rel)
      }
    }
    await walk(root)
    return found
  }
  let MEDIA_ROOT = ''
  const diffs = []
  let compared = 0
  let errored = 0
  const perGame = {}
  for (const c of CASES) {
    const id = c.ids[0]
    MEDIA_ROOT = MEDIA[c.name].direct
    const full = normalizeGalConfig(applyGalConfigPatch({}, cfgOf(await run(MEDIA_ROOT, { game: { id } }))))
    const legacy = normalizeGalConfig(applyGalConfigPatch({}, cfgOf(await run(MEDIA_ROOT, { game: { id } }, LEGACY_OPTIONS()))))
    const adapterIds = mod.resolveLayout(id).adapters
    if (Object.keys(mod.resolveLayout(id).ruleOverrides || {}).length) continue   // 游戏自己声明了和默认值不同的规则（angelic 的立绘）：写满规则表 ≠ 关掉规则表是故意的
    const view = (cfg) => ({ classify: cfg.classify, resourceResolve: cfg.resourceResolve, player: cfg.player, limits: cfg.limits, indexSkip: cfg.indexSkip })
    for (const adapterId of adapterIds) {
      let adapter = null
      try { adapter = galAdapter(adapterId) } catch { continue }   // girlscreation-line 是 girlscreation-tag 内部用的（没有单独注册）
      const ctxFull = await loadAdapterContext({ adapter, mediaDir: MEDIA_ROOT, config: full })
      const ctxLegacy = await loadAdapterContext({ adapter, mediaDir: MEDIA_ROOT, config: legacy })
      const files = []
      for (const root of full.scriptRoots) files.push(...(await walkScripts(root.dir, full.scriptExtensions, 40)))
      for (const rel of files) {
        const text = await readFile(path.join(MEDIA_ROOT, rel), 'utf8').catch(() => '')
        const stem = path.basename(rel, path.extname(rel))
        const go = (cfg, ctx) => { try { return J(buildScene(adapterId, text, ctx, { rel, stem, options: cfg.adapterOptions[adapterId] || {}, config: view(cfg) })) } catch (error) { return `ERR ${error.message}` } }
        const a = go(full, ctxFull)
        const b = go(legacy, ctxLegacy)
        compared++
        if (a.startsWith('ERR')) errored++
        perGame[id] = (perGame[id] || 0) + 1
        if (a !== b) diffs.push(`${id}/${adapterId}/${rel}`)
      }
    }
  }
  check(`端到端等价：${compared} 个脚本（${Object.keys(perGame).length} 个游戏的 fixture × 它的全部适配器）用写满规则表的 config 和关掉规则表的 config 解析，场景逐字节相同（其中解析报错 ${errored} 个，两边报错信息也一致）`, !diffs.length && compared >= 20 && errored < compared / 2 && Object.keys(perGame).length >= 8, `${compared} ${J(perGame)} ${diffs.slice(0, 4).join(' | ')}`)

  // 合并顺序：规则表 < ruleOverrides < 探测值；深度合并（只改一个子键，别的保留）
  const bk = (extra) => run(MEDIA.bokusen.direct, { game: { id: 'bokusen' } }, extra)
  const ov = cfgOf(await bk({ layouts: { bokusen: { ruleOverrides: { 'bokusen-json': { root: 'zzz', resourceDir: 'other', bgm: { index: 3 }, stand: { xScale: 2 } } } } } }))
  const table = ov.adapterOptions['bokusen-json']
  check('合并顺序：ruleOverrides 深度合并在全表之上（bgm.index 3 / stand.xScale 2 生效，bgm.patterns / stand.layers 等别的子键保留）；探测函数写的 root / resourceDir 永远赢', table.bgm.index === 3 && J(table.bgm.patterns) === J(['/bgm/']) && table.stand.xScale === 2 && table.stand.yScale === 1 && table.root === '' && table.resourceDir === 'resource', J(table).slice(0, 300))
  const noTables = cfgOf(await bk({ layouts: { bokusen: { ruleTables: [] } } }))
  check('layouts.<id>.ruleTables: [] = 不写这个适配器的全表，只剩探测函数写的键（root / resourceDir）；engine 字段不受影响', J(Object.keys(noTables.adapterOptions['bokusen-json']).sort()) === J(['resourceDir', 'root']) && noTables.limits?.walkFiles === 1000000, J(noTables.adapterOptions))
  const noEngine = cfgOf(await bk({ layouts: { bokusen: { engine: { limits: { walkFiles: 5 } } } } }))
  check('layouts.<id>.engine 整个字段替换（只写 limits → 没有 classify / resourceResolve）；全表照写', noEngine.limits.walkFiles === 5 && noEngine.resourceResolve === undefined && noEngine.classify === undefined && Object.keys(noEngine.adapterOptions['bokusen-json']).length === 11, J(noEngine.limits))
  const badRule = await bk({ layouts: { bokusen: { ruleTables: 'x', ruleOverrides: [1], engine: { bogus: 1, limits: 5 } } } })
  check('layouts 里写坏的 ruleTables / ruleOverrides / engine：不崩、日志说明、内置值仍可用', cfgOf(badRule)?.game?.id === 'bokusen' && /ruleTables 不是数组/.test(logText(badRule)) && /ruleOverrides 不是对象/.test(logText(badRule)) && /engine 里不认识的字段 bogus/.test(logText(badRule)), logText(badRule).slice(0, 400))
  const viaOverrides = cfgOf(await bk({ overrides: [{ path: '*', config: { adapterOptions: { 'bokusen-json': { root: 'q' } } } }] }))
  check('overrides 的 config 是顶层字段整个替换：写 adapterOptions 会替换掉整张（含规则表）——要改单个子键用 layouts.<id>.ruleOverrides', J(viaOverrides.adapterOptions) === J({ 'bokusen-json': { root: 'q' } }) && viaOverrides.limits.walkFiles === 1000000)
  const tooHuge = await bk({ layouts: { bokusen: { ruleOverrides: { 'bokusen-json': { huge: 'x'.repeat(17000) } } } } })
  check('规则表超过 16 KB：日志警告「会被整张丢掉」', /adapterOptions\['bokusen-json'\].*超过引擎的单个适配器上限/.test(logText(tooHuge)), logText(tooHuge).slice(0, 300))

  // 改动报告：adapterOptions 按适配器 id 汇总，不倾倒整张表
  const first = await run(MEDIA.bokusen.direct, { game: { id: 'bokusen' } }, {}, { tags: [] })
  const l1 = lineOf(first, /^\+ adapterOptions\['bokusen-json'\]/)
  const sec1 = first.logs.slice(first.logs.findIndex((l) => /^本次改动/.test(l)))
  check('改动报告：新增 adapterOptions → 「+ adapterOptions[\'bokusen-json\']（新增）：11 个键（…）」一行，不是整张表的 JSON；classify / limits / resourceResolve 也各一行', /^\+ adapterOptions\['bokusen-json'\]（新增）：11 个键（root、resourceDir、/.test(l1) && l1.length < 160 && /^\+ classify（新增）：（空）/.test(lineOf(first, /^\+ classify/)) && /^\+ limits（新增）/.test(lineOf(first, /^\+ limits/)) && /^\+ resourceResolve（新增）/.test(lineOf(first, /^\+ resourceResolve/)) && J(first.details.changes.adapterOptions.added) === J({ 'bokusen-json': 11 }), l1)
  check('改动报告：规则表很大时改动段仍 ≤ 8KB / 每行 ≤ 500 字 / 总行数 ≤ 80、details ≤ 4000', Buffer.byteLength(sec1.join('\n')) <= 8192 && sec1.every((l) => l.length <= 500) && first.logs.length <= 80 && JSON.stringify(first.details).length <= 4000, `${Buffer.byteLength(sec1.join('\n'))} / ${JSON.stringify(first.details).length}`)
  const store1 = storeOf(first)
  const again = await run(MEDIA.bokusen.direct, store1.config, {}, { tags: store1.tags })
  check('改动报告：规则表写进去之后再跑一次 = 「没有改动」', summaryOf(again) === '没有改动', logText(again).slice(0, 600))
  // 管理员改了脚本里的表（模拟：条目里存着旧值）→ 报告点名变了哪个适配器的哪几个键
  const stale = JSON.parse(J(store1.config))
  stale.adapterOptions['bokusen-json'].bgm.index = 7
  stale.adapterOptions['bokusen-json'].sound.defaultExt = '.mp3'
  delete stale.adapterOptions['bokusen-json'].animation
  stale.limits = { walkFiles: 1 }
  const changed = await run(MEDIA.bokusen.direct, stale, {}, { tags: store1.tags })
  const l2 = lineOf(changed, /^~ adapterOptions\['bokusen-json'\]/)
  check('改动报告：规则表和条目里存的不一样 → 「~ adapterOptions[\'bokusen-json\']（修改）：3 个键变了：…」，列出变了的子键和简短差别；limits 照常对比', /^~ adapterOptions\['bokusen-json'\]（修改）：3 个键变了：(?=.*bgm)(?=.*sound)(?=.*animation)/.test(l2) && l2.length < 500 && J(changed.details.changes.adapterOptions.changed['bokusen-json'].slice().sort()) === J(['animation', 'bgm', 'sound']) && /~ limits（修改）/.test(logText(changed)), l2)
  // 每个游戏第一次运行：改动段都在预算内、adapterOptions 一行一个适配器
  const budget = []
  for (const c of CASES) for (const id of c.ids) {
    const out = await run(MEDIA[c.name].direct, { game: { id } }, {}, { tags: [] })
    const sec = out.logs.slice(out.logs.findIndex((l) => /^本次改动/.test(l)))
    const adapters = Object.keys(cfgOf(out).adapterOptions || {})
    const lines = out.logs.filter((l) => /^\+ adapterOptions\[/.test(l))
    if (Buffer.byteLength(sec.join('\n')) > 8192 || out.logs.length > 80 || lines.length !== adapters.length || sec.some((l) => l.length > 500)) budget.push(`${id}: ${Buffer.byteLength(sec.join('\n'))} 字节 ${out.logs.length} 行 ${lines.length}/${adapters.length}`)
  }
  check('改动报告：每个游戏第一次运行（空条目）：adapterOptions 每个适配器一行、改动段 ≤ 8KB、日志 ≤ 80 行', !budget.length, budget.join(' | '))
}

console.log(`\n${pass} passed, ${fail} failed`)
await rm(work, { recursive: true, force: true })
process.exit(fail ? 1 : 0)
