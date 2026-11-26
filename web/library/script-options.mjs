// 元数据脚本配置的分层覆盖。脚本配置原来只有一份全局的（manifest 默认值 + 配置页里改的 JSON），
// 同一个脚本跑在不同类型的条目上只能用同一套参数。现在配置里可以再写两层覆盖：
//
//   {
//     ...全局配置,
//     "byType":    { "<条目类型>":   { ...覆盖 } },    // archive / media / gal / epub
//     "byProfile": { "<导入方案>":   { ...覆盖 } },    // 条目的 sourceProfile：archive-gallery / lrr-init / text-media / rj-media / gal-import ...
//   }
//
// 生效顺序（越往后越具体、覆盖前面的）：manifest 默认值 → 用户全局配置 → byType[类型] → byProfile[导入方案]。
// 各层都是深合并：嵌套对象（比如 namespaces）只写想改的字段就行；数组和其它值整个替换。
//
// 以 $ 开头的键是服务端自己用的，不会传给脚本：
//   "$enabled": false  —— 对这一类条目不运行这个脚本（服务端直接跳过，已有的标签原样保留）。
//   不用 "enabled" 这个名字：anidb-udp-v1 等脚本已经有叫 enabled 的选项了。

import { createHash } from 'node:crypto'

export const LAYER_KEYS = ['byType', 'byProfile']

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function deepMerge(base, override) {
  if (!isPlainObject(base)) base = {}
  if (!isPlainObject(override)) return { ...base }
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value
  }
  return out
}

function stripServerKeys(options) {
  return Object.fromEntries(Object.entries(options).filter(([key]) => !key.startsWith('$') && !LAYER_KEYS.includes(key)))
}

// 返回 { options, enabled, layers }：options 是交给脚本的最终配置（不含 byType/byProfile/$ 键），
// layers 记下实际套用了哪几层，方便配置页展示「这个值是从哪来的」。
export function resolveScriptOptions({ defaultOptions = {}, userOptions = {}, type = '', profile = '' } = {}) {
  const merged = deepMerge(defaultOptions, userOptions)
  const byType = isPlainObject(merged.byType) ? merged.byType : {}
  const byProfile = isPlainObject(merged.byProfile) ? merged.byProfile : {}
  let effective = Object.fromEntries(Object.entries(merged).filter(([key]) => !LAYER_KEYS.includes(key)))
  const layers = []
  if (type && isPlainObject(byType[type])) {
    effective = deepMerge(effective, byType[type])
    layers.push(`byType.${type}`)
  }
  if (profile && isPlainObject(byProfile[profile])) {
    effective = deepMerge(effective, byProfile[profile])
    layers.push(`byProfile.${profile}`)
  }
  return { options: stripServerKeys(effective), enabled: effective.$enabled !== false, layers }
}

// 生效配置的指纹：记进脚本的运行记录。配置改了（哪怕脚本版本没变），「同版本已生成，跳过」就不再成立。
export function optionsFingerprint(options) {
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable)
    if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    return value
  }
  return createHash('sha1').update(JSON.stringify(stable(options || {}))).digest('hex').slice(0, 16)
}

// manifest 里声明的 libraryTypes：空 = 不限类型
export function scriptAppliesToType(script, type) {
  const types = Array.isArray(script?.libraryTypes) ? script.libraryTypes : []
  return !types.length || types.includes(type)
}
