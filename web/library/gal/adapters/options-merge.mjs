// 适配器参数（config.adapterOptions[<适配器 id>]）的统一规整：默认值表 + 管理员给的覆盖 → 补满的参数对象。
// 适配器本身只读这份参数、按参数匹配；猜出来的路径 / 正则 / 命名规则 / 魔法数字都写成默认值表里的数据，admin 脚本（gal-layout）可以逐项覆盖。
// 合并规则（宽容，不抛错）：
//   对象 → 逐键递归合并（给了默认表里没有的键也保留：站位表、动画表这类「名字 → 值」的映射要能加项）；
//   数组 → 整个替换（列表就是列表，不拼接）；数字 / 字符串 / 布尔 → 类型一致才替换，否则用默认值；默认值是 null 的项（可选项）→ 给什么收什么；
//   给了 null / undefined = 没给。
import { compileSafeRegex } from '../voice.mjs'

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function mergeOptions(defaults, given) {
  if (Array.isArray(defaults)) return Array.isArray(given) ? structuredClone(given) : structuredClone(defaults)
  if (isObject(defaults)) {
    const out = {}
    const source = isObject(given) ? given : {}
    for (const key of Object.keys(defaults)) out[key] = mergeOptions(defaults[key], source[key])
    for (const key of Object.keys(source)) if (!(key in out) && source[key] !== undefined && source[key] !== null) out[key] = structuredClone(source[key])
    return out
  }
  if (defaults === null) return given === undefined ? null : structuredClone(given)
  if (typeof defaults === 'number') return typeof given === 'number' && Number.isFinite(given) ? given : defaults
  return typeof given === typeof defaults ? given : defaults
}

// 每个适配器一个：reader(原始参数) → 规整后的参数（同一个原始对象只合并一次）
export function createOptionsReader(defaults) {
  const cache = new WeakMap()
  const base = mergeOptions(defaults, undefined)
  return (options) => {
    if (!isObject(options)) return base
    if (!cache.has(options)) cache.set(options, mergeOptions(defaults, options))
    return cache.get(options)
  }
}

// 配置里的正则源码 → RegExp；不合格（太长 / 回溯风险 / 语法错）返回 null，调用方按「这条规则没有」处理
export function safeRegex(source, flags = 'i') {
  try { return compileSafeRegex(source, { flags, label: 'adapterOptions' }) } catch { return null }
}
export const safeRegexList = (list, flags = 'i') => (Array.isArray(list) ? list : []).map((source) => safeRegex(source, flags)).filter(Boolean)
export const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 路径模板：{name} {scene} … 换成值；没给值的占位符原样保留
export const fillTemplate = (template, values) => String(template).replace(/\{(\w+)\}/g, (all, key) => (values[key] === undefined ? all : String(values[key])))
// 相对目录：反斜杠换正斜杠、去掉首尾斜杠
export const cleanDir = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
