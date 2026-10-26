#!/usr/bin/env node
// Gal 引擎配置自测（只用 node，不要浏览器）：phase 1 的引擎层通用能力
//   config 新字段（classify / resourceResolve / indexSkip / limits / player / adapterOptions 上限）的校验 + warnings、
//   scene.mjs 的 classify 后处理、resolve.mjs（文件系统层 + 内存索引层）、context.mjs 的 indexSkip / limits / sampleTruncated、
//   player 默认值经 node 下发、诊断（config-dropped / sample-truncated）、meta.options / meta.config 到达适配器（有 / 没有 prepare）。
//   node scripts/dev/gal-engine-config-selftest.mjs
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { registerGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { applyGalConfigPatch, cleanGalConfigRaw, DEFAULT_INDEX_SKIP, galConfigView, normalizeGalConfig, normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { contextStats, loadAdapterContext } from '../../web/library/gal/context.mjs'
import { candidatePaths, createIndexResolver } from '../../web/library/gal/resolve.mjs'
import { applyClassify, buildScene } from '../../web/library/gal/scene.mjs'
import { compileSafeRegex } from '../../web/library/gal/voice.mjs'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { galPlayerDefaults } from '../../web/static/gal-engine.js'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const has = (norm, field) => norm.warnings.some((w) => w.field === field || w.field.startsWith(`${field}.`))
const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'gal-engine-cfg-')))

// ================= 1. config 新字段 =================
{
  const w = normalizeGalConfigWithWarnings({})
  const n = normalizeGalConfig({})
  check('默认：新字段都是「没写」的值（classify [] / resourceResolve {} / limits {} / player {} / indexSkip = 默认三条）', J(n.classify) === '[]' && J(n.resourceResolve) === '{}' && J(n.limits) === '{}' && J(n.player) === '{}' && J(n.indexSkip) === J(['^\\.', '\\|', '#']) && J(n.indexSkip) === J(DEFAULT_INDEX_SKIP), J(n))
  check('向后兼容：normalizeGalConfig 返回 config（warnings 是不可枚举属性，展开 / JSON 里没有），WithWarnings 返回 { config, warnings }', Array.isArray(n.warnings) && !Object.keys(n).includes('warnings') && !('warnings' in { ...n }) && !J(n).includes('warnings') && w.warnings.length === 0 && w.config.pageSize === n.pageSize)

  // classify
  const c = normalizeGalConfig({ classify: [
    { match: '/voice/', as: 'voice' },                                  // 合法（没有 on / from：默认 src / 全部音频 op）
    { match: '^x', on: 'speaker', from: ['se', 'bgm', 'zzz'], as: 'drop' },   // from 里有一个不认识的：丢那一项并报告
    { match: '(a+)+', as: 'se' },                                       // 量词套量词
    { match: '(', as: 'se' },                                           // 编译不过
    { match: 'ok', on: 'nope', as: 'se' },                              // on 非法
    { match: 'ok', as: 'movie' },                                       // as 非法
    { match: '', as: 'se' },                                            // 空
    { match: 'ok', from: ['zzz'], as: 'se' },                           // from 全非法
    'garbage',
    { match: 'text-rule', on: 'text', from: ['voice'], as: 'bgvoice' },
  ] })
  check('classify：合法规则规整（on 默认 src、from 默认全部音频 op）', J(c.classify[0]) === J({ match: '/voice/', on: 'src', from: ['se', 'voice', 'bgm', 'bgse', 'bgvoice'], as: 'voice' }), J(c.classify[0]))
  check('classify：from 里不认识的 op 被丢（规则保留）并报告', J(c.classify[1].from) === J(['se', 'bgm']) && c.warnings.some((x) => x.field === 'classify' && /from/.test(x.reason)))
  check('classify：嵌套量词 / 编译错误 / on 非法 / as 非法 / match 空 / from 全非法 / 非对象 全部丢掉（共留 3 条）', c.classify.length === 3 && c.classify[2].match === 'text-rule', J(c.classify.map((r) => r.match)))
  check('classify：每个被丢的规则都有 warning（field = classify，带原因和片段）', c.warnings.filter((x) => x.field === 'classify').length >= 7 && c.warnings.every((x) => x.field && x.reason && typeof x.snippet === 'string'), J(c.warnings))
  check('classify：超过 50 条只留 50 并报告', normalizeGalConfig({ classify: Array.from({ length: 60 }, (_, i) => ({ match: `m${i}`, as: 'se' })) }).classify.length === 50 && has(normalizeGalConfig({ classify: Array.from({ length: 60 }, () => ({ match: 'm', as: 'se' })) }), 'classify'))
  check('classify：不是数组 → 丢掉并报告', normalizeGalConfig({ classify: { match: 'a', as: 'se' } }).classify.length === 0 && has(normalizeGalConfig({ classify: 5 }), 'classify'))

  // resourceResolve
  const r = normalizeGalConfig({ resourceResolve: {
    extensionFallbacks: { '.M4A': ['.wav', '.ogg', 'bad', '.a/b'], '.x': [], nodot: ['.y'] },
    rewrites: [{ match: '^bgm/(.*)\\.m4a$', replace: 'sound/$1.wav', flags: 'i' }, { match: '(a+)+', replace: 'x' }, { match: 'a', replace: 5 }, { match: 'a', replace: 'b', flags: 'g' }, { match: '(', replace: 'b' }],
    normalizeUnicode: ['NFC', 'NFD', 'NFKC'],
    preferDirs: ['a/b/', '../x', 'c'],
    caseInsensitive: false,
    allowedRoots: ['/data/extra/', 'relative/dir', '/a/../b', '/'],
    bogus: 1,
  } })
  check('resourceResolve.extensionFallbacks：键小写、值只留合法扩展名；整项不合格丢掉并报告', J(r.resourceResolve.extensionFallbacks) === J({ '.m4a': ['.wav', '.ogg'] }) && has(r, 'resourceResolve.extensionFallbacks'), J(r.resourceResolve.extensionFallbacks))
  check('resourceResolve.rewrites：合法留下（flags i 保留）；嵌套量词 / replace 非字符串 / flags 非法 / 编译错误 丢掉并报告', r.resourceResolve.rewrites.length === 1 && r.resourceResolve.rewrites[0].flags === 'i' && r.warnings.filter((x) => x.field === 'resourceResolve.rewrites').length === 4, J(r.resourceResolve.rewrites))
  check('resourceResolve.normalizeUnicode：只留 NFC / NFD（NFKC 丢掉并报告）', J(r.resourceResolve.normalizeUnicode) === J(['NFC', 'NFD']) && has(r, 'resourceResolve.normalizeUnicode'))
  check('resourceResolve.preferDirs：去尾斜杠、含 .. 的丢掉并报告', J(r.resourceResolve.preferDirs) === J(['a/b', 'c']) && has(r, 'resourceResolve.preferDirs'), J(r.resourceResolve.preferDirs))
  check('resourceResolve.caseInsensitive：false 保留；非布尔 → 按默认并报告', r.resourceResolve.caseInsensitive === false && has(normalizeGalConfig({ resourceResolve: { caseInsensitive: 'no' } }), 'resourceResolve.caseInsensitive') && normalizeGalConfig({ resourceResolve: { caseInsensitive: 'no' } }).resourceResolve.caseInsensitive === undefined)
  check('resourceResolve.allowedRoots：只留绝对目录（去尾斜杠）；相对 / 含 .. / 根目录 丢掉并报告', J(r.resourceResolve.allowedRoots) === J(['/data/extra']) && r.warnings.filter((x) => x.field === 'resourceResolve.allowedRoots').length === 3, J(r.resourceResolve.allowedRoots))
  check('resourceResolve：不认识的字段丢掉并报告；不是对象整个丢掉并报告', has(r, 'resourceResolve') && J(normalizeGalConfig({ resourceResolve: [] }).resourceResolve) === '{}' && has(normalizeGalConfig({ resourceResolve: 'x' }), 'resourceResolve'))
  check('resourceResolve.rewrites 超过 30 条只留 30 并报告', normalizeGalConfig({ resourceResolve: { rewrites: Array.from({ length: 35 }, (_, i) => ({ match: `a${i}`, replace: 'b' })) } }).resourceResolve.rewrites.length === 30)

  // indexSkip
  check('indexSkip：写了就用写的（可以是空数组 = 一个都不跳过）；非法正则丢掉并报告；超过 20 条截断；非数组 → 默认并报告',
    J(normalizeGalConfig({ indexSkip: [] }).indexSkip) === '[]' && J(normalizeGalConfig({ indexSkip: ['^_'] }).indexSkip) === J(['^_'])
    && J(normalizeGalConfig({ indexSkip: ['^_', '(', '(a+)+', ''] }).indexSkip) === J(['^_']) && normalizeGalConfig({ indexSkip: ['^_', '(', '(a+)+', ''] }).warnings.filter((x) => x.field === 'indexSkip').length === 3
    && normalizeGalConfig({ indexSkip: Array.from({ length: 25 }, (_, i) => `n${i}`) }).indexSkip.length === 20
    && J(normalizeGalConfig({ indexSkip: 'x' }).indexSkip) === J(DEFAULT_INDEX_SKIP) && has(normalizeGalConfig({ indexSkip: 'x' }), 'indexSkip'))

  // limits
  const l = normalizeGalConfig({ limits: { walkFiles: 99999999, sampleFiles: 500.7, sampleBytes: 10, scriptBytes: 1e12, walkDepth: 99, bogus: 1 } })
  check('limits：夹到范围（walkFiles ≤ 2,000,000 / sampleFiles ≤ 20,000 / sampleBytes 256..256KB / scriptBytes ≤ 64MB / walkDepth ≤ 12），夹了要报告', J(l.limits) === J({ walkFiles: 2000000, sampleFiles: 500, sampleBytes: 256, scriptBytes: 64 * 1024 * 1024, walkDepth: 12 }) && l.warnings.filter((x) => x.field.startsWith('limits.')).length === 4, J(l.limits))
  check('limits：不是数字 / 不认识的字段 / 非对象 → 丢掉并报告；合法值不报告', J(normalizeGalConfig({ limits: { walkFiles: 'abc', walkDepth: null } }).limits) === '{}' && has(normalizeGalConfig({ limits: { walkFiles: 'abc' } }), 'limits.walkFiles') && has(l, 'limits') && has(normalizeGalConfig({ limits: [] }), 'limits') && normalizeGalConfig({ limits: { walkFiles: 1000, walkDepth: 8 } }).warnings.length === 0)

  // player
  const p = normalizeGalConfig({ player: { fontScale: 5, textOpacity: -1, autoDelay: 2.5, cameraMode: 'fixed', zoom: 1.5, minFitScale: 0.1, fastInterval: 5.4, bogus: 1 } })
  check('player：白名单 + 夹范围（fontScale 0.6..2 / textOpacity 0..1 / autoDelay 0..30 / zoom 0.5..4 / minFitScale 0.3..1 / fastInterval 20..500 取整）', J(p.player) === J({ fontScale: 2, textOpacity: 0, autoDelay: 2.5, cameraMode: 'fixed', zoom: 1.5, minFitScale: 0.3, fastInterval: 20 }), J(p.player))
  check('player：夹了 / 不认识的字段都报告；cameraMode 只认 auto | fixed；非数字丢掉', p.warnings.filter((x) => x.field.startsWith('player')).length === 5 && normalizeGalConfig({ player: { cameraMode: 'fit' } }).player.cameraMode === undefined && has(normalizeGalConfig({ player: { cameraMode: 'fit' } }), 'player.cameraMode') && J(normalizeGalConfig({ player: { fontScale: 'big' } }).player) === '{}' && J(normalizeGalConfig({ player: 3 }).player) === '{}' && has(normalizeGalConfig({ player: 3 }), 'player'))
  check('player：前端 galPlayerDefaults 再白名单 + 夹一次（不信下发的值）', J(galPlayerDefaults({ fontScale: 9, cameraMode: 'x', zoom: '2', evil: 1, fastInterval: 1, textOpacity: true })) === J({ fontScale: 2, zoom: 2, fastInterval: 20 }) && J(galPlayerDefaults(null)) === '{}', J(galPlayerDefaults({ fontScale: 9 })))

  // adapterOptions
  const big = (n) => ({ s: 'x'.repeat(n) })
  const a = normalizeGalConfig({ adapterOptions: { a1: big(16000), a2: big(17000), a3: big(16000), a4: big(16000), a5: big(16000), a6: big(100), 'Bad Id': {}, six: 5 } })
  check('adapterOptions：单个 ≤ 16KB（16000 字符的留下，17000 的丢掉并报告）', 'a1' in a.adapterOptions && !('a2' in a.adapterOptions) && a.warnings.some((x) => x.field === 'adapterOptions.a2' && /单个/.test(x.reason)), J(Object.keys(a.adapterOptions)))
  check('adapterOptions：合计 ≤ 64KB（a1 a3 a4 a5 共 64KB 以内；之后的 a6 超限丢掉并报告）', J(Object.keys(a.adapterOptions)) === J(['a1', 'a3', 'a4', 'a5']) || J(Object.keys(a.adapterOptions)) === J(['a1', 'a3', 'a4', 'a5', 'a6']), J(Object.keys(a.adapterOptions)))
  const total = normalizeGalConfig({ adapterOptions: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`t${i}`, big(15000)])) })
  check('adapterOptions：合计上限 64KB：6 个 15000 字符的只留 4 个，其余带「合计」warning', Object.keys(total.adapterOptions).length === 4 && total.warnings.filter((x) => /合计/.test(x.reason)).length === 2, J(total.warnings))
  check('adapterOptions：非法 id（Bad Id，整项丢掉）/ 非对象（six）都有 warning', a.warnings.some((x) => x.field === 'adapterOptions' && /id/.test(x.reason)) && a.warnings.some((x) => x.field === 'adapterOptions.six'), J(a.warnings.map((x) => x.field + x.reason)))

  // 旧字段的静默丢弃也报告
  const o = normalizeGalConfig({ scriptRoots: [{ id: 'a|b', dir: 'x' }, { id: 'ok', dir: '../up' }], groups: [{ parent: '.', pattern: '(' }], rawIgnore: ['(', 'ok'], voiceInclude: '(a+)+', game: { id: 'a b' }, thumbMode: 'zzz', merge: [{ parent: '', dirs: [] }] })
  check('旧字段被丢掉的内容也报告（scriptRoots / groups / rawIgnore / voiceInclude / game / thumbMode / merge）', ['scriptRoots', 'groups', 'rawIgnore', 'voiceInclude', 'game', 'thumbMode', 'merge'].every((f) => has(o, f)), J(o.warnings.map((x) => x.field)))

  // cleanGalConfigRaw / applyGalConfigPatch：新字段进 KNOWN，只存写过的
  const raw = cleanGalConfigRaw({ classify: [{ match: 'a', as: 'se' }], limits: { walkFiles: 5000 }, player: { fontScale: 1.2 }, resourceResolve: { caseInsensitive: false }, indexSkip: [], bogus: 1 })
  check('cleanGalConfigRaw：新字段是已知字段（只存写过的；indexSkip: [] 被保留；未知字段丢掉）', J(Object.keys(raw).sort()) === J(['classify', 'indexSkip', 'limits', 'player', 'resourceResolve']) && J(raw.indexSkip) === '[]' && raw.player.fontScale === 1.2, J(raw))
  const patched = applyGalConfigPatch(raw, { limits: null, player: { zoom: 2 } })
  check('applyGalConfigPatch：补丁替换整个顶层字段，null 删除', !('limits' in patched) && J(patched.player) === J({ zoom: 2 }) && 'classify' in patched)
  const view = galConfigView(normalizeGalConfig({ classify: [{ match: 'a', as: 'se' }], player: { zoom: 2 } }))
  check('galConfigView：{ classify, resourceResolve, player, limits, indexSkip } 深度冻结', J(Object.keys(view)) === J(['classify', 'resourceResolve', 'player', 'limits', 'indexSkip']) && Object.isFrozen(view) && Object.isFrozen(view.classify) && Object.isFrozen(view.classify[0]) && Object.isFrozen(view.classify[0].from) && Object.isFrozen(view.player), J(view))
  check('compileSafeRegex：与随机语音同一套安全检查（空 → null，嵌套量词 / 反向引用 / 过长 / 语法错误抛 invalid-regex；flags 可选）', compileSafeRegex('') === null && ['(a+)+', '(a)\\1', 'x'.repeat(201), '('].every((s) => { try { compileSafeRegex(s); return false } catch (e) { return e.code === 'invalid-regex' } }) && compileSafeRegex('A', { flags: '' }).test('a') === false && compileSafeRegex('A').test('a'))
}

// ================= 2. classify 后处理 =================
{
  const speaker = (name) => ({ op: 'speaker', segments: [{ text: name }] })
  const text = (t) => ({ op: 'text', segments: [{ text: t }] })
  const mkSteps = () => [
    { index: 0, commands: [speaker('Alice'), { op: 'voice', src: 'snd/a.ogg' }, text('Hello there')] },
    { index: 1, commands: [{ op: 'se', src: 'snd/ev_door.ogg' }, { op: 'bgm', src: 'bgm/theme.ogg', loop: true, fade: 2, when: [{ var: 'v', op: '==', value: 1 }] }, text('Next')] },
    { index: 2, commands: [{ op: 'bgse', src: 'amb/wind.ogg', loop: true }, { op: 'bgvoice', slot: 's1', src: 'v/loop.ogg', volume: 0.5 }, { op: 'voice', src: '' }, { op: 'bg', src: 'bg/aa.png' }] },
  ]
  const run = (rules) => { const steps = mkSteps(); const n = applyClassify(steps, rules.map((r) => ({ on: 'src', from: ['se', 'voice', 'bgm', 'bgse', 'bgvoice'], ...r }))); return { steps, n } }
  const cmds = (steps, i) => steps[i].commands
  let r = run([{ match: 'ev_door', as: 'voice' }])
  check('as voice：se → { op: voice, src }', J(cmds(r.steps, 1)[0]) === J({ op: 'voice', src: 'snd/ev_door.ogg' }) && r.n === 1, J(cmds(r.steps, 1)))
  r = run([{ match: 'a\\.ogg', as: 'se' }])
  check('as se：voice → { op: se, src }', J(cmds(r.steps, 0)[1]) === J({ op: 'se', src: 'snd/a.ogg' }), J(cmds(r.steps, 0)))
  r = run([{ match: 'theme', as: 'se' }])
  check('as se：bgm 的 loop / fade 丢掉，when 条件保留', J(cmds(r.steps, 1)[1]) === J({ op: 'se', src: 'bgm/theme.ogg', when: [{ var: 'v', op: '==', value: 1 }] }), J(cmds(r.steps, 1)[1]))
  r = run([{ match: 'ev_door', as: 'bgm' }])
  check('as bgm：{ op: bgm, src }（没有 loop / fade）', J(cmds(r.steps, 1)[0]) === J({ op: 'bgm', src: 'snd/ev_door.ogg' }))
  r = run([{ match: 'ev_door', as: 'bgse' }, { match: 'wind', as: 'bgse' }])
  check('as bgse：需要 loop（原来没有 = 循环 true；原来是 bgse 的保持不变）', J(cmds(r.steps, 1)[0]) === J({ op: 'bgse', src: 'snd/ev_door.ogg', loop: true }) && J(cmds(r.steps, 2)[0]) === J({ op: 'bgse', src: 'amb/wind.ogg', loop: true }) && r.n === 1, J(r))
  r = run([{ match: 'theme', as: 'bgvoice' }, { match: 'loop\\.ogg', as: 'bgvoice' }])
  check('as bgvoice：{ slot, src, volume }（slot 默认 classified、volume 默认 1；原来就是 bgvoice 的原样保留）', J(cmds(r.steps, 1)[1]) === J({ op: 'bgvoice', slot: 'classified', src: 'bgm/theme.ogg', volume: 1, when: [{ var: 'v', op: '==', value: 1 }] }) && J(cmds(r.steps, 2)[1]) === J({ op: 'bgvoice', slot: 's1', src: 'v/loop.ogg', volume: 0.5 }), J(r.steps))
  r = run([{ match: 'ev_door|theme', as: 'drop' }])
  check('as drop：指令被删（其它指令、step 保留）', cmds(r.steps, 1).length === 1 && cmds(r.steps, 1)[0].op === 'text' && r.steps.length === 3 && r.n === 2)
  r = run([{ match: '.', as: 'se', from: ['voice'] }])
  check('from 过滤：只处理列出的 op（voice → se；别的 op 不动；src 为空的 voice 不处理）', J(cmds(r.steps, 0)[1]) === J({ op: 'se', src: 'snd/a.ogg' }) && cmds(r.steps, 1)[0].op === 'se' && cmds(r.steps, 1)[1].op === 'bgm' && cmds(r.steps, 2)[2].op === 'voice' && r.n === 1, J(r))
  r = run([{ match: 'alice', on: 'speaker', from: ['voice'], as: 'bgvoice' }])
  check('on speaker：匹配当前说话人（不分大小写；speaker 指令之后的语音）；from 之外的 op 不动', cmds(r.steps, 0)[1].op === 'bgvoice' && cmds(r.steps, 1)[0].op === 'se' && r.n === 1, J(r.steps[0]))
  r = run([{ match: '^Next$', on: 'text', as: 'drop' }])
  check('on text：匹配这一步的台词（台词可以在指令之后）', cmds(r.steps, 1).every((c) => c.op === 'text') && cmds(r.steps, 0).length === 3 && r.n === 2, J(r.steps[1]))
  check('说话人沿用到后面的步骤（speaker 只在变化时发指令）：step 1 的 se 没有自己的 speaker 指令，仍按 Alice 匹配', (() => { const steps = mkSteps(); const n = applyClassify(steps, [{ match: 'Alice', on: 'speaker', from: ['se'], as: 'drop' }]); return n === 1 && steps[1].commands[0].op === 'bgm' })())
  check('on speaker：没有说话人时（空串）不匹配 ^.+$', (() => { const steps = [{ index: 0, commands: [{ op: 'voice', src: 'a.ogg' }] }]; return applyClassify(steps, [{ match: '^.+$', on: 'speaker', as: 'drop' }]) === 0 })())
  r = run([{ match: 'a', as: 'se' }, { match: 'a', as: 'drop' }])
  check('顺序：第一条命中的规则生效（后面的不再看）', cmds(r.steps, 0)[1]?.op === 'se', J(r.steps[0]))
  r = run([{ match: 'snd/a', as: 'voice' }])
  check('命中但类型没变：不改、不计数', r.n === 0 && J(r.steps) === J(mkSteps()))
  r = run([{ match: '(', as: 'drop' }, { match: '(a+)+', as: 'drop' }, { match: 'x', on: 'nope', as: 'drop' }, { match: 'x', as: 'movie' }, { match: 'ev_door', as: 'drop' }])
  check('无效规则（编译错误 / 嵌套量词 / on 非法 / as 非法）在运行时被跳过，不影响后面的规则', r.n === 1 && cmds(r.steps, 1)[0].op === 'bgm')
  check('没有规则 / 空规则：0 条、steps 不动', applyClassify(mkSteps(), []) === 0)

  // buildScene：meta.config.classify → stats.classified；没规则时 stats 原样
  registerGalAdapter({ id: 'eng-classify-stub', label: 's', sniff: (t) => t === 'CLS', parse: () => ({ steps: mkSteps(), stats: { commands: 9, raw: {} } }) })
  const plain = buildScene('eng-classify-stub', 'CLS', null, {})
  const withCfg = buildScene('eng-classify-stub', 'CLS', null, { config: galConfigView(normalizeGalConfig({ classify: [{ match: 'ev_door|theme', as: 'drop' }, { match: 'a\\.ogg', as: 'se' }] })) })
  check('buildScene：meta.config.classify 生效，stats.classified = 改动条数，原 stats 字段保留', withCfg.stats.classified === 3 && withCfg.stats.commands === 9 && J(withCfg.steps[1].commands.map((c) => c.op)) === J(['text']) && !('classified' in plain.stats) && plain.steps[0].commands[1].op === 'voice', J(withCfg.stats))
  const none = buildScene('eng-classify-stub', 'CLS', null, { config: galConfigView(normalizeGalConfig({})) })
  check('buildScene：classify 为空 → 不碰场景、stats 没有 classified', !('classified' in none.stats) && J(none.steps) === J(mkSteps()))
}

// ================= 3. resolve.mjs =================
{
  // 内存索引层
  const index = new Map([['audio/voice/a.wav', 1], ['audio/se/Door.OGG', 1], ['sound/b.wav', 1], ['dirA/same.png', 1], ['dirB/same.png', 1], ['dirC/same.png', 1], ['jp/é.png', 1]])
  const cfgOf = (resourceResolve) => normalizeGalConfig({ resourceResolve }).resourceResolve
  let rs = createIndexResolver({ index, cfg: cfgOf({ extensionFallbacks: { '.m4a': ['.wav', '.ogg'] } }) })
  check('扩展名回退：.m4a → .wav（精确优先）', rs.resolve('audio/voice/a.m4a') === 'audio/voice/a.wav' && rs.resolve('audio/voice/a.wav') === 'audio/voice/a.wav' && rs.resolve('audio/voice/zzz.m4a') === '' && rs.has('audio/voice/a.m4a'))
  check('扩展名回退：按列表顺序（.wav 不存在时试 .ogg），扩展名大小写不敏感，回退后仍可忽略大小写（Door.OGG）', rs.resolve('audio/se/door.M4A') === 'audio/se/Door.OGG')
  check('没配规则：只做精确 + 忽略大小写（和以前的行为一致）', createIndexResolver({ index }).resolve('audio/voice/a.m4a') === '' && createIndexResolver({ index }).resolve('AUDIO/VOICE/A.WAV') === 'audio/voice/a.wav')
  rs = createIndexResolver({ index, cfg: cfgOf({ rewrites: [{ match: '^bgm/(.*)\\.m4a$', replace: 'sound/$1.wav' }, { match: '^voice/(\\w+)/(\\w+)\\.mp3$', replace: 'audio/voice/$2.wav', flags: 'i' }] }) })
  check('正则重写（捕获组 $1）：bgm/b.m4a → sound/b.wav；第二条规则 flags i；不匹配 = 空', rs.resolve('bgm/b.m4a') === 'sound/b.wav' && rs.resolve('VOICE/x/a.MP3') === 'audio/voice/a.wav' && rs.resolve('bgm/zzz.m4a') === '' && rs.resolve('voice/x/a.mp3') === 'audio/voice/a.wav')
  check('重写规则默认区分大小写；flags i 才忽略', createIndexResolver({ index, cfg: cfgOf({ rewrites: [{ match: '^BGM/(.*)\\.m4a$', replace: 'sound/$1.wav' }] }) }).resolve('bgm/b.m4a') === '' && createIndexResolver({ index, cfg: cfgOf({ rewrites: [{ match: '^BGM/(.*)\\.m4a$', replace: 'sound/$1.wav', flags: 'i' }] }) }).resolve('bgm/b.m4a') === 'sound/b.wav')
  check('重写产生的越界路径（.. / 绝对路径）被丢掉', candidatePaths('a/b.png', cfgOf({ rewrites: [{ match: '^a/(.*)$', replace: '../$1' }, { match: '^a/(.*)$', replace: '/etc/$1' }, { match: '^a/(.*)$', replace: 'ok/$1' }] })).join() === 'a/b.png,ok/b.png')
  check('候选顺序：原路径 → rewrites → extensionFallbacks → unicode', candidatePaths('x/a.m4a', cfgOf({ rewrites: [{ match: 'x/', replace: 'y/' }], extensionFallbacks: { '.m4a': ['.wav'] }, normalizeUnicode: ['NFC'] })).join() === 'x/a.m4a,y/a.m4a,x/a.wav,y/a.wav', candidatePaths('x/a.m4a', cfgOf({ rewrites: [{ match: 'x/', replace: 'y/' }], extensionFallbacks: { '.m4a': ['.wav'] } })).join())
  const nfd = 'jp/é.png'
  check('Unicode：NFD 的名字 → 索引里是 NFC（normalizeUnicode 含 NFC）；没配时找不到', nfd !== 'jp/é.png' && createIndexResolver({ index, cfg: cfgOf({ normalizeUnicode: ['NFC'] }) }).resolve(nfd) === 'jp/é.png' && createIndexResolver({ index }).resolve(nfd) === '')
  const nfdIndex = new Set([nfd])
  check('Unicode：NFC 的名字 → 索引里是 NFD（normalizeUnicode 含 NFD）', createIndexResolver({ index: nfdIndex, cfg: cfgOf({ normalizeUnicode: ['NFD'] }) }).resolve('jp/é.png') === nfd && createIndexResolver({ index: nfdIndex }).resolve('jp/é.png') === '')
  check('Unicode：忽略大小写的比较也先归一（NFD + 大小写同时不一致）', createIndexResolver({ index: new Set(['jp/É.png']), cfg: cfgOf({ normalizeUnicode: ['NFC'] }) }).resolve('JP/é.PNG') === 'jp/É.png')
  check('大小写：caseInsensitive 默认 true；设 false 只认精确', createIndexResolver({ index, cfg: cfgOf({}) }).resolve('Sound/B.wav') === 'sound/b.wav' && createIndexResolver({ index, cfg: cfgOf({ caseInsensitive: false }) }).resolve('Sound/B.wav') === '' && createIndexResolver({ index, cfg: cfgOf({ caseInsensitive: false }) }).resolve('sound/b.wav') === 'sound/b.wav')
  rs = createIndexResolver({ index, cfg: cfgOf({ preferDirs: ['dirC', 'dirB'] }) })
  check('resolveByName：同名文件按 preferDirs 的顺序挑（dirC 先于 dirB）', rs.resolveByName('same.png') === 'dirC/same.png' && createIndexResolver({ index, cfg: cfgOf({ preferDirs: ['dirB'] }) }).resolveByName('same.png') === 'dirB/same.png')
  check('resolveByName：不在 preferDirs 下 → 字典序第一个；preferDirs 参数覆盖 cfg；名字带目录只取文件名；找不到 = 空', createIndexResolver({ index }).resolveByName('same.png') === 'dirA/same.png' && createIndexResolver({ index, cfg: cfgOf({ preferDirs: ['dirC'] }), preferDirs: ['dirB'] }).resolveByName('x/y/same.png') === 'dirB/same.png' && rs.resolveByName('nope.png') === '')
  check('resolveByName：配合扩展名回退 / 忽略大小写（caseInsensitive false 时只认大小写完全一致的）', createIndexResolver({ index, cfg: cfgOf({ extensionFallbacks: { '.mp3': ['.wav'] } }) }).resolveByName('A.mp3') === 'audio/voice/a.wav' && createIndexResolver({ index, cfg: cfgOf({ caseInsensitive: false }) }).resolveByName('A.wav') === '' && createIndexResolver({ index, cfg: cfgOf({ caseInsensitive: false }) }).resolveByName('a.wav') === 'audio/voice/a.wav')
  check('文件名索引（键就是文件名）也能用 resolveByName / resolve', createIndexResolver({ index: new Map([['x.png', 'v']]) }).resolveByName('X.PNG') === 'x.png' && createIndexResolver({ index: new Map([['x.png', 'v']]) }).resolve('x.png') === 'x.png')
  check('index 可以是 Set / 数组 / 普通对象 / 只有 has 的对象（后者只能精确匹配）', createIndexResolver({ index: new Set(['a/b']) }).resolve('A/B') === 'a/b' && createIndexResolver({ index: ['a/b'] }).resolve('a/b') === 'a/b' && createIndexResolver({ index: { 'a/b': 1 } }).resolve('A/B') === 'a/b' && createIndexResolver({ index: { has: (k) => k === 'a/b' } }).resolve('a/b') === 'a/b' && createIndexResolver({ index: { has: (k) => k === 'a/b' } }).resolve('A/B') === '' && createIndexResolver({}).resolve('a') === '')

  // 文件系统层（resolveAsset）
  const dataDir = path.join(work, 'data')
  const media = path.join(work, 'media')
  const outside = path.join(work, 'outside')
  const allowed = path.join(work, 'allowed')
  for (const dir of [path.join(media, 'resources', 'audio'), path.join(media, 'resources', 'Img'), outside, allowed, path.join(media, 'resources', 'dup')]) await mkdir(dir, { recursive: true })
  await writeFile(path.join(media, 'resources', 'audio', 'a.wav'), 'W')
  await writeFile(path.join(media, 'resources', 'audio', 'b.ogg'), 'O')
  await writeFile(path.join(media, 'resources', 'Img', 'Pic.PNG'), 'P')
  await writeFile(path.join(media, 'resources', 'audio', 'é.wav'), 'E')   // NFD 文件名
  await writeFile(path.join(media, 'resources', 'audio', 'snd_x.wav'), 'X')
  await writeFile(path.join(outside, 'secret.txt'), 'SECRET')
  await writeFile(path.join(allowed, 'ok.wav'), 'ALLOWED')
  await symlink(path.join(allowed, 'ok.wav'), path.join(media, 'resources', 'audio', 'linked-ok.wav'))
  await symlink(path.join(outside, 'secret.txt'), path.join(media, 'resources', 'audio', 'linked-bad.wav'))
  await mkdir(path.join(media, 'script'), { recursive: true })
  await writeFile(path.join(media, 'script', 's.txt'), 'NOPREP')
  const handler = createGalHandler({ dataDir, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: async (p) => existsSync(p), getConfig: () => ({ mediaImportProfiles: {} }) })
  const imported = await handler.importFromSource({ sourcePath: media, options: { adapters: ['uviewer-csv'], config: { scriptRoots: [{ id: '', dir: 'script', label: 's' }], resourceRoots: ['resources'] } } })
  const itemId = imported.items[0].itemId
  const setCfg = async (config) => { await handler.patchItemMetadata(itemId, { gal: { config, replace: true } }) }
  const get = async (rel) => { try { return (await handler.getResource(itemId, rel)).body.toString() } catch (error) { return `ERR${error.statusCode}` } }
  const base = { scriptRoots: [{ id: '', dir: 'script', label: 's' }], resourceRoots: ['resources'] }
  await setCfg(base)
  check('resolveAsset 默认行为不变：精确 / 忽略大小写（Img/pic.png）/ 找不到 404 / 路径穿越 400', await get('audio/a.wav') === 'W' && await get('img/pic.png') === 'P' && await get('audio/a.m4a') === 'ERR404' && await get('../outside/secret.txt') === 'ERR400' && await get('audio/../../outside/secret.txt') === 'ERR400')
  check('默认：符号链接指到媒体目录之外 → 404（含指向 allowedRoots 目录的，没配 allowedRoots 时）', await get('audio/linked-bad.wav') === 'ERR404' && await get('audio/linked-ok.wav') === 'ERR404')
  await setCfg({ ...base, resourceRoots: ['resources'], resourceResolve: { extensionFallbacks: { '.m4a': ['.wav', '.ogg'] } } })
  check('resolveAsset：.m4a → .wav / .ogg 回退', await get('audio/a.m4a') === 'W' && await get('audio/b.m4a') === 'O' && await get('audio/zzz.m4a') === 'ERR404')
  await setCfg({ ...base, resourceResolve: { rewrites: [{ match: '^bgm/(\\w+)\\.mp3$', replace: 'audio/$1.wav' }, { match: '^evil/(.*)$', replace: '../outside/$1' }] } })
  check('resolveAsset：正则重写（捕获组）；重写出的 .. 路径被丢（不能逃出去）', await get('bgm/a.mp3') === 'W' && await get('evil/secret.txt') === 'ERR404')
  await setCfg({ ...base, resourceResolve: { rewrites: [{ match: '^snd/(.*)$', replace: 'audio/snd_$1' }], extensionFallbacks: { '.mp3': ['.wav'] } } })
  check('resolveAsset：规则可以叠加（重写 + 扩展名回退：snd/x.mp3 → audio/snd_x.mp3 → audio/snd_x.wav）', await get('snd/x.mp3') === 'X')
  await setCfg({ ...base, resourceResolve: { normalizeUnicode: ['NFD'] } })
  check('resolveAsset：NFC 请求名 → 磁盘上是 NFD（normalizeUnicode NFD）；没配时 404', await get('audio/é.wav') === 'E')
  await setCfg(base)
  check('resolveAsset：没配 normalizeUnicode 时 NFC / NFD 不互通（和以前一样）', await get('audio/é.wav') === 'ERR404')
  await setCfg({ ...base, resourceResolve: { caseInsensitive: false } })
  check('resolveAsset：caseInsensitive false → 大小写不一致 404、一致仍可', await get('img/pic.png') === 'ERR404' && await get('Img/Pic.PNG') === 'P')
  await setCfg({ ...base, resourceResolve: { allowedRoots: [allowed] } })
  check('allowedRoots：符号链接指到媒体目录外、但在允许的绝对目录里 → 放行', await get('audio/linked-ok.wav') === 'ALLOWED')
  check('allowedRoots：指到两处都不在的目录 → 仍然 404；路径穿越仍然 400', await get('audio/linked-bad.wav') === 'ERR404' && await get('../outside/secret.txt') === 'ERR400' && await get('audio/../../allowed/ok.wav') === 'ERR400')
  await setCfg({ ...base, resourceResolve: { allowedRoots: [path.join(work, 'alloweded')] } })
  check('allowedRoots：前缀相似但不是同一个目录（allowed vs alloweded）不放行', await get('audio/linked-ok.wav') === 'ERR404')
  await setCfg({ ...base, resourceResolve: { allowedRoots: ['relative/dir'] } })
  check('allowedRoots：相对路径无效（被丢掉并报告），不放行', await get('audio/linked-ok.wav') === 'ERR404')
  await setCfg({ ...base, stripPrefixes: ['download/'] })
  await mkdir(path.join(media, 'resources', 'download'), { recursive: true })
  check('stripPrefixes 逻辑保持（download/audio/a.wav → audio/a.wav）', await get('download/audio/a.wav') === 'W')
  check('~/ 路径不套规则：只放行缩略图目录（以前的行为）', await (async () => { try { await handler.internals.resolveAsset({ ...(await handler.getItem(itemId)), config: { ...base, resourceResolve: { allowedRoots: [allowed] } } }, '~/script/s.txt'); return false } catch (e) { return e.statusCode === 403 } })())
  globalThis.__eng = { handler, itemId, media, work, setCfg, base }
}

// ================= 4. context.mjs：indexSkip / limits / sampleTruncated =================
{
  const dir = path.join(work, 'ctxmedia')
  await mkdir(path.join(dir, 'd', 'sub', 'deep', 'deeper'), { recursive: true })
  await mkdir(path.join(dir, 'd', '#special'), { recursive: true })
  await mkdir(path.join(dir, 'd', '.hidden'), { recursive: true })
  for (const f of ['d/a.txt', 'd/b.txt', 'd/c.txt', 'd/#hash.txt', 'd/p|ipe.txt', 'd/.dot.txt', 'd/_under.txt', 'd/#special/in.txt', 'd/.hidden/in.txt', 'd/sub/s.txt', 'd/sub/deep/t.txt', 'd/sub/deep/deeper/u.txt']) await writeFile(path.join(dir, f), `content of ${f} ${'x'.repeat(600)}`)
  let n = 0
  const stub = (extra = {}) => ({ id: `ctx-stub-${n++}`, contextDirs: () => ['d'], prepare: (args) => args, ...extra })
  const cfgOf = (o) => normalizeGalConfig({ resourceRoots: [], ...o })
  const names = (ctx) => ctx.files.map((f) => f.slice(2)).sort()
  const dflt = await loadAdapterContext({ adapter: stub(), mediaDir: dir, config: cfgOf({}) })
  check('indexSkip 默认 = 以前的规则：. 开头 / 含 | / 含 # 的文件和目录不进索引', !names(dflt).some((f) => /^\.|[|#]|\/\./.test(f)) && names(dflt).includes('a.txt') && names(dflt).includes('_under.txt') && names(dflt).includes('sub/deep/t.txt'), J(names(dflt)))
  const none = await loadAdapterContext({ adapter: stub(), mediaDir: dir, config: cfgOf({ indexSkip: [] }) })
  check('indexSkip: [] → 什么都不跳过（# / | / . 开头的都进索引）', ['#hash.txt', 'p|ipe.txt', '.dot.txt', '#special/in.txt', '.hidden/in.txt'].every((f) => names(none).includes(f)), J(names(none)))
  const custom = await loadAdapterContext({ adapter: stub(), mediaDir: dir, config: cfgOf({ indexSkip: ['^_', '^\\.'] }) })
  check('indexSkip 自定义：只跳过写的（^_ 和 ^\\.；# 的进来）', !names(custom).includes('_under.txt') && !names(custom).some((f) => f.includes('.dot') || f.includes('.hidden')) && names(custom).includes('#hash.txt'), J(names(custom)))
  const adapter = stub()
  const c1 = await loadAdapterContext({ adapter, mediaDir: dir, config: cfgOf({}) })
  const c2 = await loadAdapterContext({ adapter, mediaDir: dir, config: cfgOf({}) })
  const c3 = await loadAdapterContext({ adapter, mediaDir: dir, config: cfgOf({ indexSkip: [] }) })
  check('缓存键包含 indexSkip：同配置命中缓存，改了 indexSkip 重建', c1 === c2 && c3 !== c1 && c3.files.length > c1.files.length)
  // limits
  const warn = console.warn
  console.warn = () => {}
  const walkCut = await loadAdapterContext({ adapter: stub({ contextWalkLimit: 5000 }), mediaDir: dir, config: cfgOf({ limits: { walkFiles: 3 } }) })
  console.warn = warn
  check('limits.walkFiles 覆盖适配器的 contextWalkLimit：只收 3 个、truncated = true', walkCut.files.length === 3 && walkCut.truncated === true, J(walkCut.files))
  const st = contextStats(dir).find((x) => x.limit === 3)
  check('stats 带 limit / truncated（索引状态用）', st?.truncated === true && st.files === 3)
  const depth1 = await loadAdapterContext({ adapter: stub(), mediaDir: dir, config: cfgOf({ limits: { walkDepth: 1 } }) })
  const depth12 = await loadAdapterContext({ adapter: stub(), mediaDir: dir, config: cfgOf({ limits: { walkDepth: 12 } }) })
  check('limits.walkDepth：1 → 只到 d/sub；默认 6 / 12 → 深层文件都在', names(depth1).includes('sub/s.txt') && !names(depth1).includes('sub/deep/t.txt') && names(depth12).includes('sub/deep/deeper/u.txt') && names(dflt).includes('sub/deep/deeper/u.txt'), J(names(depth1)))
  const sampling = async (extra, limits) => { const quiet = console.warn; console.warn = () => {}; try { return await loadAdapterContext({ adapter: stub({ contextTextFilter: () => (rel) => rel.endsWith('.txt'), ...extra }), mediaDir: dir, config: cfgOf({ limits }) }) } finally { console.warn = quiet } }
  console.warn = () => {}
  const s2 = await sampling({}, { sampleFiles: 2 })
  console.warn = warn
  check('limits.sampleFiles：只读 2 个，sampleTruncated = true（prepare 也收到）', Object.keys(s2.texts).length === 2 && s2.sampleTruncated === true && s2.truncated === false, J(Object.keys(s2.texts)))
  check('stats.sampleTruncated 记录在上下文状态里（诊断用）', contextStats(dir).some((x) => x.sampleTruncated === true && x.sampleLimit === 2))
  const sAll = await sampling({}, { sampleFiles: 100 })
  check('没超过抽样上限：sampleTruncated = false', sAll.sampleTruncated === false && Object.keys(sAll.texts).length === 7)
  const sBytes = await sampling({}, { sampleBytes: 300 })
  const sBytesDefault = await sampling({ id: 'ctx-stub-default-bytes' }, {})
  check('limits.sampleBytes：每个文件只读前 300 字节（默认 24KB 读全）', Object.values(sBytes.texts).every((t) => t.length <= 300) && Object.values(sBytesDefault.texts).some((t) => t.length > 300))
  const sAdapterLimit = await sampling({ contextSampleLimit: 3 }, {})
  const sOverride = await sampling({ contextSampleLimit: 3 }, { sampleFiles: 6 })
  check('抽样上限：适配器 contextSampleLimit 是适配器自己的默认，config.limits.sampleFiles 覆盖它', Object.keys(sAdapterLimit.texts).length === 3 && sAdapterLimit.sampleTruncated === true && Object.keys(sOverride.texts).length === 6)
}

// ================= 5. 节点 / 诊断 / player 默认值 / meta.options =================
{
  const { handler, itemId, media, work: w2, setCfg, base } = globalThis.__eng
  const seen = []
  const stepsOf = (marker) => [{ index: 0, commands: [{ op: 'text', segments: [{ text: marker }] }, { op: 'se', src: 'audio/a.wav' }, { op: 'voice', src: 'audio/b.ogg' }] }]
  registerGalAdapter({ id: 'eng-noprep', label: 'n', sniff: (t) => t.startsWith('NOPREP'), parse: (text, ctx, meta) => { seen.push({ id: 'eng-noprep', ctx, meta }); return { steps: stepsOf('noprep'), stats: { commands: 3, raw: {} } } } })
  registerGalAdapter({ id: 'eng-prep', label: 'p', sniff: (t) => t.startsWith('PREP'), prepare: ({ options }) => ({ got: options }), contextDirs: () => ['audio'], parse: (text, ctx, meta) => { seen.push({ id: 'eng-prep', ctx, meta }); return { steps: stepsOf('prep'), stats: { commands: 3, raw: {} } } } })
  await writeFile(path.join(media, 'script', 'p.txt'), 'PREP script')
  const patch = async (config, adapters = ['eng-noprep', 'eng-prep']) => {
    const file = handler.internals.metaPath(itemId)
    const { readFile } = await import('node:fs/promises')
    const raw = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, J({ ...raw, adapters, config }))
  }
  const read = (section) => handler.getReaderContent(itemId, 'main', { sectionId: section })

  // meta.options / meta.config
  await patch({ ...base, adapterOptions: { 'eng-noprep': { k: 1, rules: [{ a: 1 }] }, 'eng-prep': { z: 2 } }, classify: [{ match: 'a\\.wav', as: 'voice' }], limits: { walkDepth: 3 }, player: { zoom: 2 }, resourceResolve: { preferDirs: ['x'] }, indexSkip: ['^\\.'] })
  seen.length = 0
  const scene1 = (await read('s:s.txt')).scene
  const m1 = seen.find((x) => x.id === 'eng-noprep')?.meta
  check('meta.options：没有 prepare 的适配器也拿到 config.adapterOptions[自己的 id]', J(m1?.options) === J({ k: 1, rules: [{ a: 1 }] }), J(m1))
  check('meta.config：{ classify, resourceResolve, player, limits, indexSkip } 深度冻结的只读视图', J(Object.keys(m1.config)) === J(['classify', 'resourceResolve', 'player', 'limits', 'indexSkip']) && Object.isFrozen(m1.config) && Object.isFrozen(m1.config.classify) && m1.config.limits.walkDepth === 3 && m1.config.player.zoom === 2 && J(m1.config.indexSkip) === J(['^\\.']) && m1.config.resourceResolve.preferDirs[0] === 'x', J(m1.config))
  check('meta 仍带 rel / stem（原有字段不变）', m1.rel === 's.txt' && m1.stem === 's')
  check('classify 经 browse 生效：播放页场景里 se → voice，stats.classified = 1', scene1.steps[0].commands[1].op === 'voice' && scene1.stats.classified === 1, J(scene1.steps[0].commands))
  seen.length = 0
  await read('s:p.txt')
  const m2 = seen.find((x) => x.id === 'eng-prep')
  check('有 prepare 的适配器：prepare({ options }) 不变，同时 meta.options 也有', J(m2?.ctx?.got) === J({ z: 2 }) && J(m2?.meta.options) === J({ z: 2 }), J(m2))
  await patch({ ...base })
  seen.length = 0
  await read('s:s.txt')
  check('没有配置参数的适配器：meta.options = {}，meta.config 是空视图', J(seen[0].meta.options) === '{}' && J(seen[0].meta.config) === J({ classify: [], resourceResolve: {}, player: {}, limits: {}, indexSkip: ['^\\.', '\\|', '#'] }), J(seen[0].meta))
  // 列表页（scriptInfo 的 buildScene）也带 options
  seen.length = 0
  await patch({ ...base, adapterOptions: { 'eng-noprep': { listed: true } } })
  await read('')
  check('列表页（脚本卡片摘要）解析脚本时 meta.options 同样带上', seen.some((x) => x.id === 'eng-noprep' && x.meta.options?.listed === true), J(seen.map((x) => x.meta?.options)))
  // 随机语音
  seen.length = 0
  await patch({ ...base, adapterOptions: { 'eng-noprep': { voiceTest: 1 } } })
  await handler.getRandomVoice(itemId, { node: 's:s.txt', bgvoice: false }).catch(() => {})
  check('随机语音解析脚本时 meta.options 同样带上', seen.some((x) => x.meta?.options?.voiceTest === 1), J(seen.map((x) => x.meta?.options)))

  // player 默认值经 node 下发
  await patch({ ...base, player: { fontScale: 1.4, textOpacity: 0.3, autoDelay: 4, cameraMode: 'fixed', zoom: 1.5, minFitScale: 0.5, fastInterval: 30 } })
  const home = await read('')
  const play = await read('s:s.txt')
  check('player 默认值：首页节点和播放页节点都带 node.player（规整后的值）', J(home.node.player) === J({ fontScale: 1.4, textOpacity: 0.3, autoDelay: 4, cameraMode: 'fixed', zoom: 1.5, minFitScale: 0.5, fastInterval: 30 }) && J(play.node.player) === J(home.node.player), J(play.node.player))
  await patch({ ...base })
  check('没配 player：节点没有 player 字段（和以前一样）', !('player' in (await read('')).node) && !('player' in (await read('s:s.txt')).node))

  // 诊断：config-dropped
  await patch({ ...base, classify: [{ match: '(a+)+', as: 'se' }, { match: 'ok', as: 'zzz' }], limits: { walkFiles: 9e9 }, resourceResolve: { allowedRoots: ['rel'] } }, ['eng-noprep', 'bogus!id', 'no-such'])
  const diag = (await read('')).node.problems || []
  const dropped = diag.filter((p) => p.code === 'config-dropped')
  check('诊断 config-dropped：classify 丢掉的规则 / limits 夹住 / allowedRoots 无效 各一行（渲染诊断里能看到）', dropped.length >= 4 && dropped.some((p) => /classify/.test(p.message)) && dropped.some((p) => /limits\.walkFiles/.test(p.message)) && dropped.some((p) => /allowedRoots/.test(p.message)) && dropped.every((p) => p.level === 'warn'), J(dropped))
  check('诊断 config-dropped：被丢掉的适配器 id（不认识 / 写坏）也报告', dropped.some((p) => /adapters/.test(p.message) && /bogus!id/.test(p.message)) && dropped.some((p) => /no-such/.test(p.message)), J(dropped))
  await mkdir(path.join(media, 'script', 'subdir'), { recursive: true })
  await writeFile(path.join(media, 'script', 'subdir', 'q.txt'), 'NOPREP q')
  check('列表页（非首页，d:subdir）同样报告', ((await read('d:subdir')).node.problems || []).some((p) => p.code === 'config-dropped' && /classify/.test(p.message)))
  await patch({ ...base }, ['eng-noprep'])
  check('干净的配置：问题列表里没有 config-dropped / sample-truncated', ((await read('')).node.problems || []).every((p) => p.code !== 'config-dropped' && p.code !== 'sample-truncated'))
  const many = Array.from({ length: 15 }, (_, i) => ({ match: `r${i}`, as: 'nope' }))
  await patch({ ...base, classify: many })
  const capped = ((await read('')).node.problems || []).filter((p) => p.code === 'config-dropped')
  check('诊断 config-dropped：最多列 10 行，多的汇总成一行', capped.length === 11 && /还有 5 处/.test(capped[10].message), J(capped.map((p) => p.message)))

  // 诊断：sample-truncated + index status
  await mkdir(path.join(media, 'samples'), { recursive: true })
  for (let i = 0; i < 6; i++) await writeFile(path.join(media, 'samples', `f${i}.txt`), `sample ${i}`)
  registerGalAdapter({ id: 'eng-sampler', label: 's', sniff: (t) => t.startsWith('SAMPLER'), catalog: () => null, contextDirs: () => ['samples'], contextTextFilter: () => (rel) => rel.endsWith('.txt'), contextSampleLimit: 2, prepare: (args) => args, parse: () => ({ steps: [], stats: { commands: 0, raw: {} } }) })
  await patch({ ...base }, ['eng-sampler'])
  const warn = console.warn
  console.warn = () => {}
  const home2 = await read('')
  console.warn = warn
  check('诊断 sample-truncated：抽样超过上限（适配器 contextSampleLimit 2 < 6 个文件）→ problems 里有 sample-truncated，index.sampleTruncated = true', home2.node.index?.sampleTruncated === true && (home2.node.problems || []).some((p) => p.code === 'sample-truncated'), J([home2.node.index, home2.node.problems]))
  await patch({ ...base, limits: { sampleFiles: 50 } }, ['eng-sampler'])
  await handler.refreshIndex(itemId)
  const home3 = await read('')
  check('config.limits.sampleFiles 放宽后（刷新索引）不再截断', home3.node.index?.sampleTruncated === false && !(home3.node.problems || []).some((p) => p.code === 'sample-truncated'), J(home3.node.index))
  await patch({ ...base, limits: { walkFiles: 2 } }, ['eng-sampler'])
  console.warn = () => {}
  await handler.refreshIndex(itemId)
  const home4 = await read('')
  console.warn = warn
  check('walk 超限：index.truncated = true + index-truncated 问题（limit = config.limits.walkFiles）', home4.node.index?.truncated === true && home4.node.index.limit === 2 && (home4.node.problems || []).some((p) => p.code === 'index-truncated'), J(home4.node.index))
  // limits.scriptBytes
  await patch({ ...base, limits: { scriptBytes: 1024 } }, ['eng-noprep'])
  await writeFile(path.join(media, 'script', 'big.txt'), `NOPREP ${'y'.repeat(3000)}`)
  const small = await read('').catch(() => ({ node: { items: [] } }))
  check('limits.scriptBytes：超过上限的脚本不被识别（列表里没有 big.txt），小的照常', !small.node.items.some((i) => i.id === 'big.txt') && small.node.items.some((i) => i.id === 's.txt'), J(small.node.items.map((i) => i.id)))
  await patch({ ...base }, ['eng-noprep'])
  check('默认 scriptBytes（4MB）：big.txt 被识别', (await read('')).node.items.some((i) => i.id === 'big.txt'))
}

// ================= 6. 补丁 / 导入产生的 warnings 记在条目上 =================
{
  const { handler, itemId, base } = globalThis.__eng
  const patched = await handler.patchItemMetadata(itemId, { gal: { config: { ...base, classify: [{ match: '(', as: 'se' }, { match: 'ok', as: 'se' }], limits: { walkDepth: 99 } }, replace: true } })
  check('元数据脚本补丁（patchItemMetadata）里被丢掉 / 夹住的内容记在 item.configWarnings 上（落盘）', patched.configWarnings?.some((x) => x.field === 'classify') && patched.configWarnings.some((x) => x.field === 'limits.walkDepth') && J(patched.config.classify.map((r) => r.match)) === J(['ok']) && patched.config.limits.walkDepth === 12, J(patched.configWarnings))
  const shown = ((await handler.getReaderContent(itemId, 'main', { sectionId: '' })).node.problems || []).filter((p) => p.code === 'config-dropped')
  check('补丁里丢掉的内容之后在列表页「渲染诊断」里能看到（config-dropped）', shown.length >= 2 && shown.some((p) => /limits\.walkDepth/.test(p.message)), J(shown))
  const fixed = await handler.patchItemMetadata(itemId, { gal: { config: { ...base }, replace: true } })
  check('下一次干净的补丁清掉记录（没有 configWarnings 字段）', fixed.configWarnings === undefined && !((await handler.getReaderContent(itemId, 'main', { sectionId: '' })).node.problems || []).some((p) => p.code === 'config-dropped'))
  const again = await handler.importFromSource({ sourcePath: globalThis.__eng.media, options: { adapters: ['uviewer-csv'], config: { player: { fontScale: 99, bogus: 1 } } } })
  check('导入时 options.config 里的非法内容同样记录并报告；合法部分写入', again.items[0].config.player.fontScale === 2 && again.items[0].configWarnings?.some((x) => x.field.startsWith('player')), J(again.items[0].configWarnings))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
