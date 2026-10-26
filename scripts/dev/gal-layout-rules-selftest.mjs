#!/usr/bin/env node
// 漂移守卫（纯 node，不需要浏览器 / fixture）：gal-layout 脚本里的规则表（ADAPTER_RULES + 每个游戏的 ruleTables / ruleOverrides / engine）和适配器自己的 DEFAULT_OPTIONS 不能悄悄分叉。
//   node scripts/dev/gal-layout-rules-selftest.mjs
// 设计：
//   · main.js 不能 import 适配器（线上只加载 main.js），所以 ADAPTER_RULES 是创作时抄来的字面量；这里 import 每个适配器的 DEFAULT_OPTIONS，逐键深度比较。
//   · 「脚本声称镜像的键」= ADAPTER_RULES[适配器] 的所有键；允许不一致的只有两处：RULE_DEVIATIONS（全局、有意的，点路径）和某个游戏自己的 ruleOverrides（只对这个游戏有效，路径也要列出来）。
//     适配器默认值变了而表没跟 → 红；表里多出 / 缺了键 → 红；RULE_DEVIATIONS 里列了但其实一致（过期的豁免）→ 红。
//   · 另外：每个游戏的 ruleTables 覆盖它的 adapters；ruleOverrides 只写在 ruleTables 里的适配器上；engine 字段合格（引擎规整零警告）；每张表是纯 JSON 数据且 ≤ 16 KB。
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mergeOptions } from '../../web/library/gal/adapters/options-merge.mjs'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const MAIN = process.env.GAL_LAYOUT_MAIN || path.join(here, '../tag-scripts/gal-layout/main.js')
const ADAPTERS = path.join(here, '../../web/library/gal/adapters')
const { ADAPTER_RULES, RULE_DEVIATIONS, LAYOUTS, resolveLayout } = await import(pathToFileURL(MAIN).href)

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v)

// 适配器 id → 导出 DEFAULT_OPTIONS 的模块文件（girlscreation-line / -tag 共用同一份）
const MODULES = {
  'renpy-legeclo': 'renpy-legeclo', 'renpy-monmusu': 'renpy-monmusu', 'renpy-minashigo': 'renpy-minashigo', 'uviewer-csv': 'uviewer-csv',
  'girlscreation-tag': 'girlscreation-tag', 'girlscreation-line': 'girlscreation-line', 'tenkeiprdx-json': 'tenkeiprdx-json', 'misttrain-json': 'misttrain-json',
  'utage-book': 'utage-book', 'artwhirl-json': 'artwhirl-json', 'tyrano-ks': 'tyrano-ks', 'bokusen-json': 'bokusen-json', 'grenze-xml': 'grenze-xml',
}
const defaults = {}
for (const [id, file] of Object.entries(MODULES)) defaults[id] = JSON.parse(J((await import(pathToFileURL(path.join(ADAPTERS, `${file}.mjs`)).href)).DEFAULT_OPTIONS))

// 叶子级差异（点路径）：两边任意一边在这个路径上是标量 / 数组 / 缺失，且不相等
function diffPaths(a, b, prefix = '') {
  if (isPlain(a) && isPlain(b)) {
    const out = []
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) out.push(...diffPaths(a[key], b[key], prefix ? `${prefix}.${key}` : key))
    return out
  }
  return J(a) === J(b) ? [] : [prefix]
}
const covered = (diff, allowed) => allowed.some((p) => diff === p || diff.startsWith(`${p}.`) || p.startsWith(`${diff}.`))

// ================= 表 ↔ 适配器 =================
check(`ADAPTER_RULES 覆盖全部 ${Object.keys(MODULES).length} 个适配器（不多不少）`, J(Object.keys(ADAPTER_RULES).sort()) === J(Object.keys(MODULES).sort()), J(Object.keys(ADAPTER_RULES)))
{
  const bad = []
  for (const id of Object.keys(MODULES)) {
    const diffs = diffPaths(ADAPTER_RULES[id], defaults[id]).filter((d) => !covered(d, RULE_DEVIATIONS[id] || []))
    if (diffs.length) bad.push(`${id}: ${diffs.slice(0, 6).join(', ')}`)
  }
  check('漂移守卫：每个适配器的规则表和它的 DEFAULT_OPTIONS 深度相等（RULE_DEVIATIONS 列出的路径除外）', !bad.length, bad.join(' | '))
  const stale = []
  for (const [id, paths] of Object.entries(RULE_DEVIATIONS)) {
    if (!(id in MODULES)) { stale.push(`${id}（没有这个适配器）`); continue }
    const diffs = diffPaths(ADAPTER_RULES[id], defaults[id])
    for (const p of paths) if (!diffs.some((d) => d === p || d.startsWith(`${p}.`))) stale.push(`${id}.${p}`)
  }
  check('RULE_DEVIATIONS 里没有过期的豁免（列出来的路径确实和 DEFAULT_OPTIONS 不一样）', !stale.length, stale.join(', '))
  check('规则表是纯 JSON 数据（来回序列化不变）、每张 ≤ 16 KB、合计 ≤ 64 KB', Object.values(ADAPTER_RULES).every((t) => J(JSON.parse(J(t))) === J(t) && J(t).length <= 16 * 1024) && J(ADAPTER_RULES).length <= 64 * 1024, String(J(ADAPTER_RULES).length))
  // 写满全表 = 没写（适配器按子键在自己的默认值上合并）：mergeOptions 的结果相同
  const notSame = Object.keys(MODULES).filter((id) => J(mergeOptions(defaults[id], ADAPTER_RULES[id])) !== J(mergeOptions(defaults[id], undefined)))
  check('写满全表和不写等价：mergeOptions(DEFAULT_OPTIONS, 全表) = mergeOptions(DEFAULT_OPTIONS, 无)', !notSame.length, notSame.join())
}

// ================= 每个游戏 =================
{
  const problems = []
  const perGameOverrides = []
  for (const id of Object.keys(LAYOUTS)) {
    const entry = resolveLayout(id, {}, problems)
    if (!entry) { problems.push(`${id}: 解析不出来`); continue }
    const missing = entry.adapters.filter((a) => !entry.ruleTables.includes(a))
    if (missing.length) problems.push(`${id}: ruleTables 没覆盖适配器 ${missing.join()}`)
    for (const adapter of entry.ruleTables) if (!(adapter in ADAPTER_RULES)) problems.push(`${id}: ruleTables 里的 ${adapter} 不在 ADAPTER_RULES`)
    for (const adapter of Object.keys(entry.ruleOverrides)) if (!entry.ruleTables.includes(adapter)) problems.push(`${id}: ruleOverrides.${adapter} 不在 ruleTables 里（不会生效）`)
    for (const adapter of entry.ruleTables) {
      const override = entry.ruleOverrides[adapter] || {}
      // 这个游戏有效的表 = 全表 + ruleOverrides；和 DEFAULT_OPTIONS 的差异必须全部落在 ruleOverrides（或 RULE_DEVIATIONS）列出的键上
      const effective = JSON.parse(J(mergeOverride(ADAPTER_RULES[adapter] || {}, override)))
      const overridePaths = leafPaths(override)
      const diffs = diffPaths(effective, defaults[adapter] || {}).filter((d) => !covered(d, [...(RULE_DEVIATIONS[adapter] || []), ...overridePaths]))
      if (diffs.length) problems.push(`${id}/${adapter}: 和 DEFAULT_OPTIONS 不一致且没有被 ruleOverrides 声明：${diffs.slice(0, 4).join(', ')}`)
      if (overridePaths.length) perGameOverrides.push(`${id}/${adapter}`)
    }
    if (entry.engine && Object.keys(entry.engine).length) {
      const { warnings } = normalizeGalConfigWithWarnings(JSON.parse(J(entry.engine)))
      if (warnings.length) problems.push(`${id}: engine 字段引擎规整有警告：${warnings.map((w) => `${w.field} ${w.reason}`).join('; ').slice(0, 200)}`)
    }
  }
  check(`每个游戏（共 ${Object.keys(LAYOUTS).length} 个 id，含别名）：ruleTables 覆盖 adapters；ruleOverrides 只写在 ruleTables 里；有效的表和 DEFAULT_OPTIONS 的差异都已在 ruleOverrides / RULE_DEVIATIONS 里声明；engine 字段零警告`, !problems.length, problems.slice(0, 6).join(' | '))
  check(`现在没有任何游戏用 ruleOverrides 改默认值（表 = 适配器默认值）${perGameOverrides.length ? `；有：${perGameOverrides.join()}` : ''}`, true)
}

// ================= 守卫自己会报警（把适配器默认值 / 表改一下，测试函数要能发现） =================
{
  const tampered = JSON.parse(J(ADAPTER_RULES['bokusen-json']))
  tampered.bgm.index = 9
  tampered.extraKey = 1
  const diffs = diffPaths(tampered, defaults['bokusen-json'])
  check('守卫自检：表里改了一项 / 多一个键 → 能发现（bgm.index、extraKey）；列进豁免后不再报', J(diffs.sort()) === J(['bgm.index', 'extraKey']) && diffs.every((d) => covered(d, ['bgm.index', 'extraKey'])) && !covered('bgm.patterns', ['bgm.index']))
}

function leafPaths(obj, prefix = '') {
  if (!isPlain(obj)) return prefix ? [prefix] : []
  return Object.entries(obj).flatMap(([k, v]) => leafPaths(v, prefix ? `${prefix}.${k}` : k))
}
function mergeOverride(a, b) {
  if (!isPlain(a) || !isPlain(b)) return b === undefined ? a : b
  const out = { ...a }
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? mergeOverride(out[k], v) : v
  return out
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
