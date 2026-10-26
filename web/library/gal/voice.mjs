// 「随机语音」的纯逻辑（不碰磁盘）：从规范场景里收语音、白名单 / 黑名单正则（带安全检查）、按脚本缓存的 LRU、均匀随机。
// 接口怎么接到浏览层见 browse.mjs 的 randomVoice；README「随机语音」一节有对外约定。
//
// 过滤用的是用户写的正则，所以要防「灾难性回溯」（ReDoS）。JS 没法给一次 test 设超时，这里从三头收：
//   1. 源码长度 ≤ 200；编译不过就拒绝（报原因）；
//   2. 拒绝容易指数回溯的写法：量词套量词 `(a+)+` `(\w*)*` `(a{1,9}){1,9}`，以及反向引用 `\1` `\k<n>`；
//   3. 被匹配的文本截到 300 字符，且只对一份有上限的候选表（每脚本 ≤ MAX_VOICES_PER_SCRIPT 条）逐条匹配。
// 这是启发式（`(a|aa)+` 这类交替重叠不拦——交替写法的回溯被 300 字符的输入上限压住了），不是证明。

export const MAX_REGEX_LENGTH = 200
export const MAX_MATCH_INPUT = 300
export const MAX_VOICES_PER_SCRIPT = 5000
export const VOICE_TARGETS = ['path', 'speaker', 'text']

const failWith = (message, code, statusCode = 400) => Object.assign(new Error(message), { statusCode, code })

// 量词：在 pattern[i] 处认一个量词（* + ? {n} {n,} {n,m}），返回 { end（量词之后的位置，含惰性 ?）, repeat（能重复多于 1 次） }；不是量词返回 null
function quantifierAt(pattern, i) {
  const c = pattern[i]
  let end
  let repeat
  if (c === '*' || c === '+') { end = i + 1; repeat = true }
  else if (c === '?') { end = i + 1; repeat = false }
  else if (c === '{') {
    const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(pattern.slice(i, i + 24))
    if (!m) return null
    end = i + m[0].length
    repeat = m[2] ? (m[3] === '' || Number(m[3]) > 1) : false   // {n} 固定次数不算「重复」（不会造成指数回溯）
  } else return null
  if (pattern[end] === '?') end += 1   // 惰性
  return { end, repeat }
}

// 找「量词套量词」：一个组里面有能重复的东西，组本身又被重复。返回 true = 危险
export function hasNestedQuantifier(pattern) {
  const stack = []     // 每层括号：里面有没有重复量词
  let inClass = false
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]
    if (c === '\\') { i += 1; continue }
    if (inClass) { if (c === ']') inClass = false; continue }
    if (c === '[') { inClass = true; continue }
    if (c === '(') { stack.push(false); continue }
    if (c === ')') {
      const inner = stack.length ? stack.pop() : false
      const q = quantifierAt(pattern, i + 1)
      if (q?.repeat && inner) return true
      const carries = inner || Boolean(q?.repeat)
      if (stack.length) stack[stack.length - 1] = stack[stack.length - 1] || carries
      continue
    }
    const q = quantifierAt(pattern, i)
    if (q) {
      if (q.repeat && stack.length) stack[stack.length - 1] = true
      i = q.end - 1
    }
  }
  return false
}

// 源码 → RegExp（不分大小写）。空串 = 没有这个过滤（返回 null）；不合格抛 400 { code: 'invalid-regex' }
//   flags：默认 'i'；配置里的规则（classify / resourceResolve.rewrites / indexSkip）和随机语音共用这一套安全检查
export function compileSafeRegex(source, { flags = 'i', label = '正则' } = {}) {
  const text = String(source ?? '').trim()
  if (!text) return null
  if (text.length > MAX_REGEX_LENGTH) throw failWith(`${label}太长（${text.length} > ${MAX_REGEX_LENGTH} 个字符）`, 'invalid-regex')
  if (/\\[1-9]|\\k</.test(text)) throw failWith(`${label}不允许反向引用（\\1 / \\k<名字>）：容易造成灾难性回溯`, 'invalid-regex')
  if (hasNestedQuantifier(text)) throw failWith(`${label}里有量词套量词（如 (a+)+ / (\\w*)*）：容易造成灾难性回溯，请改写`, 'invalid-regex')
  try { return new RegExp(text, flags) } catch (error) { throw failWith(`${label}不是合法的正则：${error.message.replace(/^Invalid regular expression: /, '')}`, 'invalid-regex') }
}
export const compileVoiceRegex = (source, label = '正则') => compileSafeRegex(source, { flags: 'i', label })
// 配置 / 前端预检用：合法返回 true（不抛）
export const isValidVoiceRegex = (source) => { try { compileVoiceRegex(source); return true } catch { return false } }

// target：'path' | 'speaker' | 'text'，可以逗号连写（'path,speaker'：任一个匹配就算匹配）。非法的值抛 400
export function parseVoiceTargets(value) {
  const list = String(value || 'path').split(',').map((x) => x.trim()).filter(Boolean)
  if (!list.length || list.length > VOICE_TARGETS.length || list.some((x) => !VOICE_TARGETS.includes(x))) throw failWith(`target 只能是 ${VOICE_TARGETS.join(' / ')}（可用逗号连写）`, 'invalid-target')
  return [...new Set(list)]
}

// 场景 → 语音候选 [{ src, step, speaker, text, kind }]（按出现顺序，src 去重，留第一次出现）。
//   speaker：这一步之前最近一次 speaker 指令的名字（说话人只在变化时才发指令，所以要往后带）；text：这一步第一句有字的台词（截 80 字）
//   默认只收 voice；withBg = true 时也收 bgvoice（循环的背景人声，kind = 'bgvoice'）
export function collectVoices(scene, { withBg = false } = {}) {
  const out = []
  const seen = new Set()
  let speaker = ''
  for (const step of scene?.steps || []) {
    let text = ''
    const found = []
    for (const command of step.commands || []) {
      if (command.op === 'speaker') speaker = (command.segments || []).map((s) => s.text).join('').replace(/\s+/g, ' ').trim().slice(0, 40)
      else if (command.op === 'text' && !text) text = (command.segments || []).map((s) => s.text).join('').replace(/\s+/g, ' ').trim()
      else if ((command.op === 'voice' || (withBg && command.op === 'bgvoice')) && typeof command.src === 'string' && command.src) found.push(command)
    }
    for (const command of found) {
      if (seen.has(command.src)) continue
      seen.add(command.src)
      out.push({ src: command.src, step: step.index, speaker, text: text.length > 80 ? `${text.slice(0, 80)}…` : text, kind: command.op })
      if (out.length >= MAX_VOICES_PER_SCRIPT) return out
    }
  }
  return out
}

// 白名单 / 黑名单：include 为空 = 全收；exclude 为空 = 不排除；两个都给时先 include 再 exclude。targets 见 parseVoiceTargets
export function filterVoices(voices, { include = null, exclude = null, targets = ['path'] } = {}) {
  if (!include && !exclude) return voices
  const hit = (re, voice) => targets.some((t) => re.test(String(t === 'path' ? voice.src : voice[t] || '').slice(0, MAX_MATCH_INPUT)))
  return voices.filter((voice) => (!include || hit(include, voice)) && (!exclude || !hit(exclude, voice)))
}

// 均匀随机：list 里等概率取一个；rand 可注入（测试用）
export const pickRandom = (list, rand = Math.random) => list[Math.min(list.length - 1, Math.floor(rand() * list.length))]
// Fisher-Yates（不改原数组）
export function shuffled(list, rand = Math.random) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

// ---------- 按脚本缓存语音表（进程内 LRU）----------
// 键 = 脚本路径 + mtime + size + 配置 / 适配器上下文指纹（由调用方拼）；值 = { voices, adapterId }。有上限，永不无限长。
// stats.parses = 真的解析了几次脚本（缓存没命中），stats.hits = 缓存命中几次——测试靠它确认「第二次点同一个脚本不再解析」。
export const VOICE_CACHE_MAX = 200
const voiceCache = new Map()
export const voiceStats = { parses: 0, hits: 0 }
export function voiceCacheGet(key) {
  const hit = voiceCache.get(key)
  if (hit === undefined) return undefined
  voiceCache.delete(key)
  voiceCache.set(key, hit)   // 最近用过 = 放到最后
  voiceStats.hits += 1
  return hit
}
export function voiceCacheSet(key, value) {
  voiceCache.delete(key)
  voiceCache.set(key, value)
  while (voiceCache.size > VOICE_CACHE_MAX) voiceCache.delete(voiceCache.keys().next().value)
}
export const voiceCacheSize = () => voiceCache.size
// 「刷新索引」/ 测试：丢掉键以 prefix 开头的（prefix 空 = 全部）
export function voiceCacheClear(prefix = '') {
  let n = 0
  for (const key of [...voiceCache.keys()]) if (!prefix || key.startsWith(prefix)) { voiceCache.delete(key); n += 1 }
  return n
}
