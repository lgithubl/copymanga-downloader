// 朗读「flag 规则」：给每个句子打一个 flag（你自己起名，比如 ja / zh），阅读页和脚本再按 flag 选择读哪些。
// 页面显示不看 flag，所有内容照常展示。
//
// 配置（一行一条，# 开头为注释）：
//   选择器 => flag        该元素（或它的任何后代）里的文字打这个 flag，按书写顺序第一条匹配的生效
//   @kana => flag         所在段落里有假名就打这个 flag（书里没有可依赖的标记时的备用判断）
//   * => flag             兜底：没有被上面规则命中的文字打这个 flag。
//                         只在「这一章里至少有一条非兜底规则命中」时才生效，否则不打——
//                         普通的书没有任何命中，就不会被平白无故全打上一个 flag。
// 选择器语法见 css-lite.mjs。

import { compileSelector } from './css-lite.mjs'

const FLAG_NAME = /^[\w\-一-鿿぀-ヿ]{1,24}$/u
const KANA = /[぀-ヿ]/

export function parseFlagRules(source) {
  const rules = []
  const errors = []
  let fallback = null
  String(source || '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const at = line.lastIndexOf('=>')
    if (at < 0) {
      errors.push({ line: index + 1, text: raw, error: '格式应为「选择器 => flag」' })
      return
    }
    const selector = line.slice(0, at).trim()
    const flag = line.slice(at + 2).trim()
    if (!selector) {
      errors.push({ line: index + 1, text: raw, error: '缺少选择器' })
      return
    }
    if (!FLAG_NAME.test(flag)) {
      errors.push({ line: index + 1, text: raw, error: 'flag 名只能是字母、数字、下划线、横线、汉字或假名，最长 24 个字符' })
      return
    }
    if (selector === '*') {
      if (!fallback) fallback = { line: index + 1, flag }
      return
    }
    if (selector === '@kana') {
      rules.push({ line: index + 1, kind: 'kana', flag })
      return
    }
    try {
      rules.push({ line: index + 1, kind: 'selector', flag, match: compileSelector(selector) })
    } catch (error) {
      errors.push({ line: index + 1, text: raw, error: String(error.message || error) })
    }
  })
  return { rules, fallback, errors, empty: !rules.length && !fallback }
}

// nodes: [{ node, block }]，按文档顺序。返回与 nodes 等长的 flag 数组（'' = 没有 flag）
export function assignFlags(nodes, flagRules, root) {
  if (!flagRules || (!flagRules.rules.length && !flagRules.fallback)) return nodes.map(() => '')
  const blockKana = new Map()
  if (flagRules.rules.some((rule) => rule.kind === 'kana')) {
    for (const { node, block } of nodes) if (KANA.test(node.value)) blockKana.set(block, true)
  }
  const cache = flagRules.rules.map(() => new Map())   // 每条规则：元素 -> 是否匹配，往上找祖先时反复用到
  const flags = nodes.map(({ node, block }) => {
    for (let i = 0; i < flagRules.rules.length; i++) {
      const rule = flagRules.rules[i]
      if (rule.kind === 'kana') {
        if (blockKana.get(block)) return rule.flag
        continue
      }
      for (let el = node.parentNode; el && el !== root; el = el.parentNode) {
        if (!el.tagName) continue
        let hit = cache[i].get(el)
        if (hit === undefined) { hit = rule.match(el); cache[i].set(el, hit) }
        if (hit) return rule.flag
      }
    }
    return ''
  })
  if (flagRules.fallback && flags.some(Boolean)) {
    for (let i = 0; i < flags.length; i++) if (!flags[i]) flags[i] = flagRules.fallback.flag
  }
  return flags
}
