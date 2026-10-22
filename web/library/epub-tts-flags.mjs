// 朗读规则：给每个句子打一个 flag（你自己起名，比如 ja / zh），阅读页和脚本再按 flag 选择读哪些；
// 每条规则还可以带这个 flag 自己的 TTS 参数（参考音频、语言…），所以中文/日文可以用不同的音色。
// 页面显示不看 flag，所有内容照常展示。
//
// 配置是一个 JSON 数组，每条规则：
//   match            选择器：该元素（或它的任何后代）里的文字打这个 flag，按书写顺序第一条匹配的生效
//                    "@kana"  所在段落里有假名就打这个 flag（书里没有可依赖的标记时的备用判断）
//                    "*"      兜底：没有被上面规则命中的文字打这个 flag。
//                             只在「这一章里至少有一条非兜底规则命中」时才生效，否则不打——
//                             普通的书没有任何命中，就不会被平白无故全打上一个 flag。
//   flag             flag 名
//   speaker_audio / prompt_audio / prompt_text / text_language / prompt_language
//                    （都可选）这个 flag 的 TTS 参数，名字和 GSV-TTS-Lite 接口一致；没写的用「默认」（配置页上面那几项）：
//                    参考音频三件套（speaker_audio、prompt_audio、prompt_text 是配套的，prompt_text 是 prompt_audio 的文字稿）
//                    只要规则里写了其中任何一个，这三个就整组取规则里的（没写的留空，交给 GSV 服务端自己的默认），不和默认混用；
//                    两个语言各自单独回落。
// 同一个 flag 写在多条规则里：参数只取第一条。没有任何规则命中的句子、没配参数的 flag，都用默认。
// 选择器语法见 css-lite.mjs。

import { compileSelector } from './css-lite.mjs'

const FLAG_NAME = /^[\w\-一-鿿぀-ヿ]{1,24}$/u
const KANA = /[぀-ヿ]/
const LANGUAGES = ['ja', 'zh', 'en']
const AUDIO_TRIO = ['speaker_audio', 'prompt_audio', 'prompt_text']
const PARAM_FIELDS = [...AUDIO_TRIO, 'text_language', 'prompt_language']
const MAX_RULES = 50
const MAX_PARAM_LENGTH = 2000

// 把一条原始规则整理成干净的 { match, flag, ...参数 }；不合法返回 { error }
function cleanRule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: '每条规则必须是对象' }
  const match = typeof raw.match === 'string' ? raw.match.trim() : ''
  if (!match) return { error: '缺少 match（选择器）' }
  const flag = typeof raw.flag === 'string' ? raw.flag.trim() : ''
  if (!FLAG_NAME.test(flag)) return { error: 'flag 名只能是字母、数字、下划线、横线、汉字或假名，最长 24 个字符' }
  const rule = { match, flag }
  for (const field of PARAM_FIELDS) {
    const value = raw[field]
    if (value === undefined || value === null || value === '') continue
    if (typeof value !== 'string') return { error: `${field} 必须是字符串` }
    const text = AUDIO_TRIO.includes(field) && field !== 'prompt_text' ? value.trim() : value
    if (text.length > MAX_PARAM_LENGTH) return { error: `${field} 太长（最多 ${MAX_PARAM_LENGTH} 个字符）` }
    if (field === 'text_language' || field === 'prompt_language') {
      const language = value.trim().toLowerCase()
      if (language === 'auto') continue   // auto 和留空等价（GSV 不传就是 auto）
      if (!LANGUAGES.includes(language)) return { error: `${field} 只能是 ${LANGUAGES.join(' / ')}（或留空 = auto）` }
      rule[field] = language
    } else if (text) rule[field] = text
  }
  return { rule }
}

// 存进配置用：只留合法的规则（非法的丢掉）、数量有上限。页面保存前会先用 parseTtsRules 报错
export function cleanTtsRules(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const raw of value.slice(0, MAX_RULES)) {
    const { rule } = cleanRule(raw)
    if (rule) out.push(rule)
  }
  return out
}

// value：规则数组（配置里存的）。返回 { rules, fallback, params, errors, empty }
//   rules / fallback  给 assignFlags 用的匹配规则；params：Map(flag -> 参数)，同一个 flag 取第一条
//   errors：[{ index（第几条，从 1 起）, error }]，非法的规则忽略
export function parseTtsRules(value) {
  const rules = []
  const errors = []
  const params = new Map()
  let fallback = null
  if (!Array.isArray(value)) {
    return { rules, fallback, params, errors: value === undefined || value === null ? [] : [{ index: 0, error: '规则必须是 JSON 数组' }], empty: true }
  }
  value.slice(0, MAX_RULES).forEach((raw, i) => {
    const index = i + 1
    const { rule, error } = cleanRule(raw)
    if (error) { errors.push({ index, error }); return }
    let compiled = null
    if (rule.match === '@kana') compiled = { kind: 'kana' }
    else if (rule.match !== '*') {
      try { compiled = { kind: 'selector', match: compileSelector(rule.match) } } catch (e) { errors.push({ index, error: String(e.message || e) }); return }
    }
    if (rule.match === '*') { if (!fallback) fallback = { index, flag: rule.flag } } else rules.push({ index, flag: rule.flag, ...compiled })
    if (!params.has(rule.flag)) {
      const { match, flag, ...own } = rule
      params.set(rule.flag, own)
    }
  })
  if (value.length > MAX_RULES) errors.push({ index: MAX_RULES + 1, error: `最多 ${MAX_RULES} 条规则，后面的忽略` })
  return { rules, fallback, params, errors, empty: !rules.length && !fallback }
}

// 这个 flag 实际发给 TTS 的参数：规则里没写的用 defaults（{ speakerAudio, promptAudio, promptText, textLanguage, promptLanguage }）。
// 参考音频三件套整组取规则里的（只要写了其中一个），两个语言各自回落；flag 为空/没有这个 flag 的规则 = 全用默认
export function ttsParamsFor(defaults, parsed, flag) {
  const own = flag ? parsed?.params?.get(flag) : null
  if (!own) return { ...defaults }
  const hasAudio = AUDIO_TRIO.some((field) => own[field])
  return {
    speakerAudio: hasAudio ? own.speaker_audio || '' : defaults.speakerAudio,
    promptAudio: hasAudio ? own.prompt_audio || '' : defaults.promptAudio,
    promptText: hasAudio ? own.prompt_text || '' : defaults.promptText,
    textLanguage: own.text_language || defaults.textLanguage,
    promptLanguage: own.prompt_language || defaults.promptLanguage,
  }
}

// 缓存键里的「音色」部分：参考音频 + 语言 + 参考文字稿（它们变了合成结果就变）。
// 没有语言、没有文字稿时和只有参考音频的键完全一样
export function ttsVoiceKey(params) {
  const language = params.textLanguage || params.promptLanguage ? `\n${params.textLanguage}|${params.promptLanguage}` : ''
  const text = params.promptText ? `\n~${params.promptText}` : ''
  return `${params.speakerAudio}\n${params.promptAudio}${language}${text}`
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
