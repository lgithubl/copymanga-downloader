// 把 TXT 文件的字节解成字符串。TXT 没有任何编码声明，不能像 EPUB 那样信 charset：
// epub 里的兜底顺序是「shift_jis → gb18030 → big5」且前一个不报错就采用——对 TXT 就是灾难，
// GBK 的中文会被 shift_jis 当成「解码成功」得到一堆乱码（非严格模式下几乎什么字节都能解）。
//
// 做法：BOM → UTF-16 特征 → 严格 UTF-8（合法就一定是它）→ 对 GB18030 / Big5 / Shift_JIS
// 各做一次严格解码，能解的再按「像不像人话」打分：假名、常用汉字加分，私用区/半角假名/
// 生僻字这类乱码特征扣分，取最高。文件很短、内容几乎全是 ASCII 时没有足够信息，按 GB18030 处理。

const STRICT = { fatal: true, ignoreBOM: true }

// 高频简体字与对应的繁体字。只用来给「解出来像不像中文」打分，不求完整。
const COMMON_SIMPLIFIED = '的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山无它常书写读问答吗吧呢啊吧着让给跟从还才又更太非别该应使样感觉知道觉得已经因为所以但是如果虽然可是不过然后一直马上突然终于忽然慢慢静静轻轻看见听见说话回答问题孩子朋友老师学生先生小姐父母哥哥姐姐弟弟妹妹今天明天昨天晚上早上中午时候地方东西事情工作生活世界国家社会学校公司城市村庄房间门口窗户桌子椅子书本笔记电话电脑手机汽车火车飞机'
const COMMON_TRADITIONAL = '的一是不了人我在有他這中大來上國個到說們為子和你地出道也時年得就那要下以生會自著去之過家學對可她裡後小麼心多天而能好都然沒日於起還發成事只作當想看文無開手十用主行方又如前所本見經頭面公同三已老從動兩長知民樣現分將外但身些與高意進把法此實回二理美點月明其種聲全工話兒者向情部正名定女問力機給等幾很業最間新什打便位因重被走電四第門相次東政海口使教西再平真聽世氣信北少關並內加化由卻代軍產入先山無它常書寫讀問答嗎吧呢啊讓給跟從還才又更太非別該應使樣感覺知道覺得已經因為所以但是如果雖然可是不過然後一直馬上突然終於忽然慢慢靜靜輕輕看見聽見說話回答問題孩子朋友老師學生先生小姐父母哥哥姐姐弟弟妹妹今天明天昨天晚上早上中午時候地方東西事情工作生活世界國家社會學校公司城市村莊房間門口窗戶桌子椅子書本筆記電話電腦手機汽車火車飛機'
const COMMON = new Set([...COMMON_SIMPLIFIED, ...COMMON_TRADITIONAL])

function tryDecode(encoding, buffer) {
  try {
    return new TextDecoder(encoding, STRICT).decode(buffer)
  } catch {
    return null
  }
}

// 越像正常文本分越高（0..1）。只看非 ASCII 字符：几个候选解码里 ASCII 部分完全一样，没有区分度。
// 权重：假名、全角标点、高频汉字 1；其它汉字 0.2（错解出来的往往是一堆生僻字）；
// 半角假名 FF61-FF9F、私用区、拉丁扩展、谚文、符号杂项 0（几乎都是错解的产物）。
// 分母是所有非 ASCII 字符的个数——生僻字不能只加分子不进分母，否则纯乱码的得分反而是满分。
function plausibility(text) {
  let weight = 0
  let count = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code < 0x80) continue
    count += 1
    if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x3000 && code <= 0x303f) || (code >= 0xff01 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6)) weight += 1
    else if (code >= 0x4e00 && code <= 0x9fff) weight += COMMON.has(char) ? 1 : 0.2
    else if (code >= 0x2010 && code <= 0x2026) weight += 1   // 引号、破折号、省略号
  }
  return count ? weight / count : 1
}

export function decodeTextFile(buffer) {
  if (!buffer?.length) return { text: '', encoding: 'utf-8' }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buffer.subarray(3)), encoding: 'utf-8' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encoding: 'utf-16le' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), encoding: 'utf-16be' }
  }
  // 没有 BOM 的 UTF-16：中日文的 UTF-16 里大部分字节都不是 0，只有 ASCII 字符（换行、数字、标点）
  // 的高位字节是 0，所以不能按「0 的占比」判断。正常的 UTF-8/GBK/Big5/Shift_JIS 文本里根本不会有 NUL，
  // 只要出现几个 NUL 就当 UTF-16，奇数下标上的 NUL 多说明是小端（ASCII 的 0 在高位字节）。
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  let evenNul = 0
  let oddNul = 0
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) (i % 2 === 0 ? evenNul++ : oddNul++)
  if (evenNul + oddNul >= 2) {
    const encoding = oddNul >= evenNul ? 'utf-16le' : 'utf-16be'
    return { text: new TextDecoder(encoding).decode(buffer), encoding }
  }
  const utf8 = tryDecode('utf-8', buffer)
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' }

  let best = null
  for (const encoding of ['gb18030', 'big5', 'shift_jis']) {
    const text = tryDecode(encoding, buffer)
    if (text === null) continue
    // 平分时 gb18030 在前，所以内容几乎全是 ASCII、没有区分度的文件按 GB18030 处理
    const score = plausibility(text)
    if (!best || score > best.score + 1e-9) best = { text, encoding, score }
  }
  if (best) return { text: best.text, encoding: best.encoding }
  // 三个严格解码都失败（夹杂坏字节）：宽松解码，至少能读
  return { text: new TextDecoder('gb18030').decode(buffer), encoding: 'gb18030' }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

// 一行一个段落；空行不产生空段落。行首的全角空格（　　）是中文小说常见的段首缩进，保留。
export function textParagraphs(text) {
  return String(text || '')
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim())
}

export function paragraphsToHtml(paragraphs) {
  return paragraphs.map((line) => `<p>${line.replace(/[&<>]/g, (char) => ESCAPES[char])}</p>`).join('\n')
}

export function textToHtml(text) {
  return paragraphsToHtml(textParagraphs(text))
}

// 句末标点（含紧跟的收尾引号/括号）。单个段落比分段上限还长时，在句末切，句子保持完整。
const SENTENCE_PIECE = /[^。！？!?…]+[。！？!?…]*[」』）)”’"']*/g

function breakLongParagraph(paragraph, limit) {
  const pieces = []
  let current = ''
  const flush = () => { if (current) { pieces.push(current); current = '' } }
  for (const sentence of paragraph.match(SENTENCE_PIECE) || [paragraph]) {
    if (sentence.length > limit) {
      // 一个句子自己就超过上限（没有标点的长文本）：只能硬切，保证能继续读
      flush()
      for (let i = 0; i < sentence.length; i += limit) pieces.push(sentence.slice(i, i + limit))
      continue
    }
    if (current && current.length + sentence.length > limit) flush()
    current += sentence
  }
  flush()
  return pieces
}

// 把段落按字数切成若干段，每段是一个段落数组。在段落边界切，不劈开句子：
// 朗读缓存的键是句子文本，句子不变缓存就继续有效。最后一段太短（< 上限的 20%）并进上一段。
export function splitParagraphsBySize(paragraphs, maxChars) {
  const limit = Math.max(1, Math.floor(maxChars) || 1)
  const pieces = []
  for (const paragraph of paragraphs) {
    if (paragraph.length <= limit) pieces.push(paragraph)
    else pieces.push(...breakLongParagraph(paragraph, limit))
  }
  const sections = []
  let current = []
  let length = 0
  for (const piece of pieces) {
    if (current.length && length + piece.length > limit) {
      sections.push(current)
      current = []
      length = 0
    }
    current.push(piece)
    length += piece.length
  }
  if (current.length) sections.push(current)
  if (sections.length > 1 && length < limit * 0.2) {
    const tail = sections.pop()
    sections[sections.length - 1].push(...tail)
  }
  return sections
}

export function textSectionList(count) {
  return Array.from({ length: count }, (_, index) => ({
    sectionId: `p${index + 1}`,
    title: `第 ${index + 1} 段`,
    index,
    type: 'chapter',
  }))
}
