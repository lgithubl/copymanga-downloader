// 朗读文本的预处理：发给 TTS 之前，每个句子先过一遍「替换规则」，再判断还剩不剩可读字符。
// 听书、读选中、预生成脚本都走 resolveEpubTtsChunks，所以规则只在这里生效一份。
//
// 规则写法（配置页，一行一条）：
//   /正则/标志 => 替换文本
//   # 开头的行和空行忽略；标志省略时默认 gu；总是强制带 g（替换所有匹配）。
//   正则里的 / 要写成 \/；替换文本沿用 JS 的 $1 $& 写法，写空就是删除。
// 非法的规则整条忽略并报告，不影响其它规则、更不会让朗读失败。
//
// 缓存键用的是替换之后的文本（见 epubTtsHash）：规则改了，受影响的句子文本变了、键自然就变了，
// 没碰到的句子键不变，所以规则本身不需要进缓存键。

const RULE_LINE = /^\/((?:\\.|[^/\\])+)\/([a-z]*)\s*=>\s?(.*)$/s
const VALID_FLAGS = new Set(['i', 'm', 's', 'u', 'y', 'v'])

// GSV 对「没有任何字母/汉字/假名」的文本一定报 no valid segments，而且 /tts/batched 整批成败，
// 一个这样的句子会拖垮同批的所有句子。分隔线（＊＊＊ ◇）、单独的省略号、只有数字的行都属于这一类。
// \p{Nl} 把〇这类字母数字也算作可读（GSV 能切出来）。
const SPEAKABLE = /[\p{L}\p{Nl}]/u

export function isSpeakable(text) {
  return SPEAKABLE.test(text)
}

export function parseReplacements(source) {
  const rules = []
  const errors = []
  String(source || '').split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim() || line.trimStart().startsWith('#')) return
    const match = RULE_LINE.exec(line.trimStart())
    if (!match) {
      errors.push({ line: index + 1, text: raw, error: '格式应为 /正则/标志 => 替换' })
      return
    }
    const [, pattern, flagText, replacement] = match
    const flagSet = new Set(flagText.split(''))
    const bad = [...flagSet].find((flag) => flag !== 'g' && !VALID_FLAGS.has(flag))
    if (bad) {
      errors.push({ line: index + 1, text: raw, error: `不支持的标志 ${bad}` })
      return
    }
    // 没写标志 = gu；写了就尊重（比如不想要 u），但 g 一定要有
    const flags = flagText ? [...new Set([...flagSet, 'g'])].join('') : 'gu'
    try {
      rules.push({ line: index + 1, source: line, regex: new RegExp(pattern, flags), replacement })
    } catch (error) {
      errors.push({ line: index + 1, text: raw, error: String(error.message || error) })
    }
  })
  return { rules, errors }
}

// 返回真正发给 TTS 的文本；null = 没有可读内容，不合成（不算失败）
export function toSpokenText(text, rules = []) {
  let spoken = String(text ?? '')
  for (const rule of rules) spoken = spoken.replace(rule.regex, rule.replacement)
  spoken = spoken.trim()
  return isSpeakable(spoken) ? spoken : null
}
