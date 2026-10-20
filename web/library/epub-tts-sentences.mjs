// EPUB 朗读分句——服务端是唯一的分句实现。
// 以前分句在前端 DOM 上做（app.js collectEpubTtsSentences），脚本预生成缓存拿不到浏览器 DOM，
// 又必须切出一字不差的句子（缓存键 = sha1(句子文本 + 参考音频)），所以挪到这里：
// 阅读器接口直接返回已经包好 <span data-tts-index> 的 HTML 和句子列表，
// 前端不再自己切，朗读播放和预生成脚本用的是同一份结果。
//
// 规则与原前端逐条对应（改规则只改这里）：
//   1. 只收非空白文本节点（含 <a>/<b> 里的字），按最近的块级祖先分组，组间强制断句
//   2. 组内把文本节点拼成全文，按 [^。！？.!?]+[。！？.!?]* 切句，每句 trim
//   3. 一句超过 maxChars，按次级标点（，,、；;：:）贪心攒段，单个次级分句仍超长就硬切
// 输出里一句话可能对应多个 span：句子横跨 <b>/<ruby> 等元素边界时，每个文本节点里的那一段
// 各包一个同序号的 span，元素结构保持原样（不像浏览器 Range 那样把元素劈开）。
import { parseFragment, serialize, defaultTreeAdapter as adapter, html as parse5Html } from 'parse5'
import { assignFlags } from './epub-tts-flags.mjs'

const SENTENCE_RE = /[^。！？.!?]+[。！？.!?]*/g
// 每个字符都必须落进某个分句：「；：」「，、」这种连续次级标点要整串挂在前一段后面。
// （原前端用的 /[^，,、；;：:]+[，,、；;：:]?/ 会把第二个标点跳过去，句子文本少字、偏移也跟着漂。）
const CLAUSE_RE = /[^，,、；;：:]*[，,、；;：:]+|[^，,、；;：:]+/g
const BLOCK_TAGS = new Set(('p div li h1 h2 h3 h4 h5 h6 blockquote td th dt dd figcaption pre tr '
  + 'section article header footer aside caption').split(' '))

const RAW_TEXT_TAGS = new Set(['style', 'script'])

export const EPUB_TTS_SENTENCE_CLASS = 'epub-tts-sentence'

export function splitLongText(raw, maxChars) {
  if (raw.length <= maxChars) return [{ text: raw, start: 0, end: raw.length }]
  const clauses = []
  let cursor = 0
  for (const match of raw.matchAll(CLAUSE_RE)) {
    clauses.push({ text: match[0], start: cursor, end: cursor + match[0].length })
    cursor += match[0].length
  }
  const pieces = []
  let group = null
  const flush = () => { if (group) { pieces.push(group); group = null } }
  for (const clause of clauses) {
    if (clause.text.length > maxChars) {
      flush()
      for (let i = 0; i < clause.text.length; i += maxChars) {
        const end = Math.min(i + maxChars, clause.text.length)
        pieces.push({ text: clause.text.slice(i, end), start: clause.start + i, end: clause.start + end })
      }
      continue
    }
    if (group && (group.end - group.start) + clause.text.length > maxChars) flush()
    if (!group) group = { text: clause.text, start: clause.start, end: clause.end }
    else { group.text += clause.text; group.end = clause.end }
  }
  flush()
  return pieces
}

function isBlock(node) {
  return node.namespaceURI === parse5Html.NS.HTML && BLOCK_TAGS.has(node.tagName)
}

// 与前端 nearestEpubTtsBlock 一致：从文本节点往上找最近的块级祖先，找不到就是根
function nearestBlock(node, root) {
  for (let el = node.parentNode; el && el !== root; el = el.parentNode) {
    if (isBlock(el)) return el
  }
  return root
}

function* textNodes(node) {
  for (const child of adapter.getChildNodes(node)) {
    if (adapter.isTextNode(child)) {
      if (child.value && child.value.trim()) yield child
    } else if (adapter.isElementNode(child)) {
      // style/script 里是代码不是正文（原前端会把 CSS 当句子念出来）；
      // 而且它们是原始文本元素，往里塞 <span> 只会变成字面量文字
      if (RAW_TEXT_TAGS.has(adapter.getTagName(child))) continue
      // <template> 的内容在 .content 里，浏览器 TreeWalker 也不会进去
      yield* textNodes(child)
    }
  }
}

// 返回 { sentences: [{ index, text, flag, runIndex, start, end }], runs }，不改 DOM。
// 同一个块里相邻文字的 flag 不同就在那里断开成两段（和块级元素之间强制断句同理）：
// 一个句子只会有一个 flag，朗读时才不会半句中文半句日文。
function collectSentences(root, maxChars, flagRules = null) {
  const collected = []
  for (const node of textNodes(root)) collected.push({ node, block: nearestBlock(node, root) })
  const flags = assignFlags(collected, flagRules, root)
  const runs = []
  let currentBlock = null
  let currentFlag = null
  let currentRun = null
  collected.forEach(({ node, block }, i) => {
    if (block !== currentBlock || flags[i] !== currentFlag) {
      currentBlock = block
      currentFlag = flags[i]
      currentRun = { nodes: [], fullText: '', flag: flags[i] }
      runs.push(currentRun)
    }
    currentRun.nodes.push({ node, start: currentRun.fullText.length })
    currentRun.fullText += node.value
  })
  const sentences = []
  runs.forEach((run, runIndex) => {
    if (!run.fullText.trim()) return
    for (const match of run.fullText.matchAll(SENTENCE_RE)) {
      const raw = match[0]
      const text = raw.trim()
      if (!text) continue
      const push = (pieceRaw, offset) => {
        const pieceText = pieceRaw.trim()
        if (!pieceText) return
        const lead = pieceRaw.length - pieceRaw.trimStart().length
        const start = match.index + offset + lead
        sentences.push({ index: sentences.length, text: pieceText, flag: run.flag, runIndex, start, end: start + pieceText.length })
      }
      if (text.length <= maxChars) { push(raw, 0); continue }
      for (const piece of splitLongText(raw, maxChars)) push(piece.text, piece.start)
    }
  })
  return { sentences, runs }
}

function createSpan(index, flag = '') {
  const attrs = [
    { name: 'class', value: EPUB_TTS_SENTENCE_CLASS },
    { name: 'data-tts-index', value: String(index) },
  ]
  if (flag) attrs.push({ name: 'data-tts-flag', value: flag })
  return adapter.createElement('span', parse5Html.NS.HTML, attrs)
}

// 把每个文本节点按"落在它里面的句子片段"重建：[前缀文本][span(片段)][间隔文本]…[尾部文本]
function wrapSentences(runs, sentences) {
  const byNode = new Map()
  for (const sentence of sentences) {
    const run = runs[sentence.runIndex]
    for (const { node, start } of run.nodes) {
      const nodeEnd = start + node.value.length
      const from = Math.max(sentence.start, start)
      const to = Math.min(sentence.end, nodeEnd)
      if (from >= to) continue
      const list = byNode.get(node) || []
      list.push({ index: sentence.index, flag: sentence.flag, from: from - start, to: to - start })
      byNode.set(node, list)
    }
  }
  for (const [node, segments] of byNode) {
    segments.sort((a, b) => a.from - b.from)
    const parent = node.parentNode
    let cursor = 0
    const pieces = []
    for (const seg of segments) {
      if (seg.from > cursor) pieces.push(adapter.createTextNode(node.value.slice(cursor, seg.from)))
      const span = createSpan(seg.index, seg.flag)
      adapter.insertText(span, node.value.slice(seg.from, seg.to))
      pieces.push(span)
      cursor = seg.to
    }
    if (cursor < node.value.length) pieces.push(adapter.createTextNode(node.value.slice(cursor)))
    for (const piece of pieces) adapter.insertBefore(parent, piece, node)
    adapter.detachNode(node)
  }
}

// html 是 sanitizeHtml 的输出（body 内部片段）。按 div 上下文解析，
// 和前端 `div.innerHTML = html` 的解析行为一致。flagRules 是 parseFlagRules 的结果，可空。
export function annotateEpubSentences(htmlText, { maxChars = 200, flagRules = null } = {}) {
  const limit = Math.max(20, Number(maxChars) || 200)
  const context = adapter.createElement('div', parse5Html.NS.HTML, [])
  const fragment = parseFragment(context, String(htmlText || ''))
  const { sentences, runs } = collectSentences(fragment, limit, flagRules)
  wrapSentences(runs, sentences)
  return {
    content: serialize(fragment),
    sentences: sentences.map(({ index, text, flag }) => ({ index, text, flag })),
  }
}

// 只要句子（脚本预生成用），不需要序列化
export function epubSentenceTexts(htmlText, { maxChars = 200, flagRules = null } = {}) {
  const limit = Math.max(20, Number(maxChars) || 200)
  const context = adapter.createElement('div', parse5Html.NS.HTML, [])
  const fragment = parseFragment(context, String(htmlText || ''))
  return collectSentences(fragment, limit, flagRules).sentences.map((entry) => entry.text)
}
