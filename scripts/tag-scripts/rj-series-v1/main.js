// 字段映射 / 回填（原「RJ 系列生成」）：按配置里的规则表，从条目字段取值 → 处理 → 写成标签或补写条目字段。
//
// 每条规则 = 从哪取（from）→ 怎么处理（transform / map）→ 写到哪（to），外加条件（when）和开关：
//   from      候选列表，取第一个算出非空结果的。每项可以是：
//               "dlsite.productId"                      条目字段路径（点分隔，数组用下标：origin.sourceFiles.0）
//               { "const": "xxx" }                      常量
//               { "template": "${const.root}/${title}" } 模板：${字段路径}、${const.常量名}、${type}、${profile}；
//                                                        引用的值有一个为空，整个模板就算空（不会拼出半截路径）
//   transform 处理步骤，按顺序：
//               "trim" / "upper" / "lower" / "nfc"（Unicode 规范化）
//               { "regex": "RJ\\d+", "group": 0, "ignoreCase": true }  正则提取（不匹配 = 空）
//               { "replace": "_", "with": " ", "ignoreCase": false }   正则替换（全部）
//   map       值映射表 { "原值": "新值" }；mapIgnoreCase 控制键是否忽略大小写（规则里不写就用外层的 mapIgnoreCase）。
//             查不到：写了 "default" 就用它（"" = 这个候选作废，试下一个），没写就保留原值
//   to        { "tag": "系列", "exclusive": true }   产出条目标签「系列: 值」；exclusive = 这个标签组一个条目只留一个值
//             { "field": "origin.sourcePath" }       补写条目字段（白名单见 FIELD_TARGETS）
//   when      执行条件（对象或数组，数组 = 全部满足）：
//               { "empty": "origin" } / { "notEmpty": "dlsite.productId" }
//               { "match": "title", "regex": "^\\[", "ignoreCase": false }
//   enabled   false = 这条规则不跑
//   dryRun    true = 只记日志不写入。写字段的规则默认 true（字段写进去就是永久的，不像标签下次运行会被收回），
//             要真正写入必须显式写 "dryRun": false；外层 dryRun: true 时所有规则都只记日志
//   overwrite 写字段时目标已有不同的值：false（默认）跳过，true 覆盖
//
// 规则按名字存在对象里（不是数组）：配置的分层覆盖（byType / byProfile）按名字逐条深合并，
// 只想打开某一条时写 { "rules": { "来源路径回填": { "enabled": true } } } 就行，不用把整张表抄一遍。
//
// 默认只有「系列」一条，和 1.x 的行为完全一样：有原档用原档 ID，没有就用自己的 ID（键来自 ctx.item.dlsite，
// 由 RJ / DLsite 脚本写入），所以本脚本要排在 RJ / DLsite 之后执行。1.x 的 preferOriginal / tagPrefix 两个选项仍然认。

const FIELD_TARGETS = new Set(['title', 'workKey', 'origin.sourcePath', 'origin.sourceFile'])
const ORIGINAL_ID_PATH = 'dlsite.originalProductId'

export function getPath(source, pathText) {
  let value = source
  for (const key of String(pathText || '').split('.').filter(Boolean)) {
    if (value === null || value === undefined) return undefined
    value = value[key]
  }
  return value
}

function setPath(target, pathText, value) {
  const keys = String(pathText).split('.').filter(Boolean)
  let node = target
  for (const key of keys.slice(0, -1)) {
    if (!node[key] || typeof node[key] !== 'object') node[key] = {}
    node = node[key]
  }
  node[keys[keys.length - 1]] = value
}

export function isEmptyValue(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.every(isEmptyValue)
  if (typeof value === 'object') return Object.values(value).every(isEmptyValue)
  return false
}

function scalar(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return ''
  return String(value)
}

function regexOf(pattern, ignoreCase, global = false) {
  return new RegExp(String(pattern), `${ignoreCase ? 'i' : ''}${global ? 'g' : ''}`)
}

// 模板：${const.x} / ${type} / ${profile} / ${字段路径}；有一个引用为空，整个结果为空
export function renderTemplate(template, scope) {
  let missing = ''
  const text = String(template || '').replace(/\$\{([^}]+)\}/g, (_, raw) => {
    const name = raw.trim()
    let value
    if (name.startsWith('const.')) value = scope.constants?.[name.slice(6)]
    else if (name === 'type') value = scope.type
    else if (name === 'profile') value = scope.profile
    else value = getPath(scope.item, name)
    const out = scalar(value)
    if (!out.trim() && !missing) missing = name
    return out
  })
  return { text: missing ? '' : text, missing }
}

export function applyTransforms(value, steps = []) {
  let out = String(value)
  for (const step of Array.isArray(steps) ? steps : [steps]) {
    if (!step) continue
    if (step === 'trim') out = out.trim()
    else if (step === 'upper') out = out.toUpperCase()
    else if (step === 'lower') out = out.toLowerCase()
    else if (step === 'nfc') out = out.normalize('NFC')   // Unicode 规范化：macOS 来的文件名常是分解形式（NFD），看着一样却不相等
    else if (typeof step === 'object' && step.regex !== undefined) {
      const match = out.match(regexOf(step.regex, step.ignoreCase === true))
      out = match ? String(match[Number(step.group) || 0] ?? '') : ''
    } else if (typeof step === 'object' && step.replace !== undefined) {
      out = out.replace(regexOf(step.replace, step.ignoreCase === true, true), String(step.with ?? ''))
    }
  }
  return out
}

// 值映射：先精确匹配，ignoreCase 时再忽略大小写匹配；查不到时有 default 用 default，没有就原样保留
export function applyMap(value, rule, defaultIgnoreCase = false) {
  const map = rule.map && typeof rule.map === 'object' ? rule.map : null
  if (!map) return value
  if (Object.prototype.hasOwnProperty.call(map, value)) return String(map[value] ?? '')
  const ignoreCase = rule.mapIgnoreCase ?? defaultIgnoreCase
  if (ignoreCase) {
    const lower = value.toLowerCase()
    const key = Object.keys(map).find((candidate) => candidate.toLowerCase() === lower)
    if (key !== undefined) return String(map[key] ?? '')
  }
  return Object.prototype.hasOwnProperty.call(rule, 'default') ? String(rule.default ?? '') : value
}

function conditionHolds(condition, scope) {
  if (!condition || typeof condition !== 'object') return true
  if (condition.empty !== undefined) return isEmptyValue(getPath(scope.item, condition.empty))
  if (condition.notEmpty !== undefined) return !isEmptyValue(getPath(scope.item, condition.notEmpty))
  if (condition.match !== undefined) return regexOf(condition.regex ?? '', condition.ignoreCase === true).test(scalar(getPath(scope.item, condition.match)))
  return true
}

// 一条规则的取值：候选依次 取值 → transform → map，第一个非空的胜出
export function evaluateRule(rule, scope, defaultIgnoreCase = false) {
  const candidates = Array.isArray(rule.from) ? rule.from : (rule.from !== undefined ? [rule.from] : [])
  const tried = []
  for (const candidate of candidates) {
    let raw = ''
    let label = ''
    if (typeof candidate === 'string') {
      raw = scalar(getPath(scope.item, candidate))
      label = candidate
    } else if (candidate && typeof candidate === 'object' && candidate.const !== undefined) {
      raw = scalar(candidate.const)
      label = '常量'
    } else if (candidate && typeof candidate === 'object' && candidate.template !== undefined) {
      const rendered = renderTemplate(candidate.template, scope)
      raw = rendered.text
      label = rendered.missing ? `模板（${rendered.missing} 为空）` : '模板'
    } else continue
    if (!raw.trim()) { tried.push(`${label} 为空`); continue }
    const value = applyMap(applyTransforms(raw, rule.transform), rule, defaultIgnoreCase)
    if (value.trim()) return { value, source: label, tried }
    tried.push(`${label} 处理后为空`)
  }
  return { value: '', source: '', tried }
}

// 1.x 的选项：preferOriginal: false = 系列不用原档 ID；tagPrefix = 系列标签前缀
function legacyAdjust(rules, raw) {
  const series = rules['系列']
  if (!series || typeof series !== 'object') return rules
  const next = { ...series, to: { ...(series.to || {}) } }
  if (raw.preferOriginal === false && Array.isArray(next.from)) next.from = next.from.filter((entry) => entry !== ORIGINAL_ID_PATH)
  if (typeof raw.tagPrefix === 'string' && raw.tagPrefix.trim()) next.to.tag = raw.tagPrefix.trim()
  return { ...rules, 系列: next }
}

export async function generateTags(ctx) {
  const raw = ctx.script?.options || {}
  const rules = legacyAdjust(raw.rules && typeof raw.rules === 'object' && !Array.isArray(raw.rules) ? raw.rules : {}, raw)
  const globalDry = raw.dryRun === true
  const defaultIgnoreCase = raw.mapIgnoreCase === true
  const item = ctx.item || {}
  const scope = { item, constants: raw.constants && typeof raw.constants === 'object' ? raw.constants : {}, type: ctx.type || '', profile: item.sourceProfile || '' }
  const fullRun = !Array.isArray(ctx.selectedUnitIds) || !ctx.selectedUnitIds.length
  const itemTags = []
  const exclusiveTagGroups = []
  const itemPatch = {}
  const logs = []
  const details = []

  for (const [name, rule] of Object.entries(rules)) {
    if (!rule || typeof rule !== 'object' || rule.enabled === false) continue
    const conditions = Array.isArray(rule.when) ? rule.when : (rule.when ? [rule.when] : [])
    let failed = null
    try {
      failed = conditions.find((condition) => !conditionHolds(condition, scope)) || null
    } catch (error) {
      logs.push(`[${name}] 条件写错了，跳过：${error.message}`)
      details.push({ rule: name, status: 'error' })
      continue
    }
    if (failed) {
      logs.push(`[${name}] 条件不满足（${JSON.stringify(failed)}），跳过`)
      details.push({ rule: name, status: 'skipped' })
      continue
    }
    let result
    try {
      result = evaluateRule(rule, scope, defaultIgnoreCase)
    } catch (error) {
      logs.push(`[${name}] 规则写错了，跳过：${error.message}`)
      details.push({ rule: name, status: 'error' })
      continue
    }
    if (!result.value) {
      // 没有值就不写：留空好过编一个（比如没编号的作品不能都归进同一个「系列」）
      logs.push(`[${name}] 没取到值（${result.tried.join('；') || '没有候选'}），不写`)
      details.push({ rule: name, status: 'empty' })
      continue
    }
    const to = rule.to && typeof rule.to === 'object' ? rule.to : {}
    if (to.field !== undefined) {
      const field = String(to.field)
      if (!FIELD_TARGETS.has(field)) {
        logs.push(`[${name}] 不允许写字段 ${field}（只能写 ${[...FIELD_TARGETS].join(' / ')}），跳过`)
        details.push({ rule: name, status: 'error' })
        continue
      }
      const dry = globalDry || rule.dryRun !== false   // 写字段默认只记日志，必须显式 dryRun: false
      const current = scalar(getPath(item, field))
      if (current === result.value) {
        logs.push(`[${name}] ${field} 已经是「${result.value}」，不用改`)
        details.push({ rule: name, status: 'same', value: result.value })
        continue
      }
      if (current && rule.overwrite !== true) {
        logs.push(`[${name}] ${field} 已有值「${current}」，不覆盖（要覆盖设 overwrite: true）；算出的是「${result.value}」`)
        details.push({ rule: name, status: 'kept', value: result.value, current })
        continue
      }
      if (dry) {
        logs.push(`[${name}] [dryRun] 会把 ${field} 写成「${result.value}」（来自 ${result.source}）`)
        details.push({ rule: name, status: 'dryRun', field, value: result.value })
        continue
      }
      if (!fullRun) continue
      setPath(itemPatch, field, result.value)
      logs.push(`[${name}] ${field} ← 「${result.value}」（来自 ${result.source}）`)
      details.push({ rule: name, status: 'written', field, value: result.value })
      continue
    }
    const prefix = String(to.tag ?? '').trim()
    if (!prefix) {
      logs.push(`[${name}] 没写 to（tag 或 field），跳过`)
      details.push({ rule: name, status: 'error' })
      continue
    }
    const tag = `${prefix}: ${result.value}`
    if (globalDry || rule.dryRun === true) {
      logs.push(`[${name}] [dryRun] 会产出标签「${tag}」（来自 ${result.source}）`)
      details.push({ rule: name, status: 'dryRun', tag })
      continue
    }
    // 只在合集作用域产出；选中部分章节执行时服务端会把 itemTags 清空，不必多此一举
    if (fullRun) itemTags.push(tag)
    if (to.exclusive === true) exclusiveTagGroups.push(prefix)
    logs.push(`[${name}] 标签「${tag}」（来自 ${result.source}）`)
    details.push({ rule: name, status: 'tag', tag })
  }

  return {
    itemTags,
    unitTags: [],
    unitPatches: [],
    ...(Object.keys(itemPatch).length ? { itemPatch } : {}),
    ...(exclusiveTagGroups.length ? { exclusiveTagGroups } : {}),
    logs: logs.length ? logs : ['没有启用的规则'],
    details: { rules: details },
  }
}
