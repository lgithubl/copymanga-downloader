// 压缩包图集：生成标签。只读 zip 的目录（和 ComicInfo.xml 这一个小文件），不解压。
// 本脚本产出的标签由服务端管理：下次运行没产出的会被移除，所以每次都完整产出一遍。

const LANGUAGES = [
  [/中国翻訳|中國翻譯|中文|汉化|漢化|chinese/i, 'chinese'],
  [/英訳|english/i, 'english'],
  [/日本語|japanese/i, 'japanese'],
  [/韓国翻訳|korean/i, 'korean'],
]

function splitList(value) {
  return String(value || '').split(/[、,，;；]/).map((part) => part.trim()).filter(Boolean)
}

// (Comiket 99) [社团 (作者)] 标题 (原作) [中国翻訳] [DL版]
export function parseFilename(rawName) {
  let text = String(rawName || '').replace(/\.[^./]+$/, '').trim()
  const tags = []
  const event = text.match(/^\(([^()]+)\)\s*/)
  if (event) {
    tags.push(`event:${event[1].trim()}`)
    text = text.slice(event[0].length)
  }
  const head = text.match(/^\[([^\]]+)\]\s*/)
  if (head) {
    const inner = head[1].trim()
    const circle = inner.match(/^(.+?)\s*\((.+)\)$/)
    if (circle) {
      tags.push(`circle:${circle[1].trim()}`)
      for (const artist of splitList(circle[2])) tags.push(`artist:${artist}`)
    } else {
      for (const artist of splitList(inner)) tags.push(`artist:${artist}`)
    }
    text = text.slice(head[0].length)
  }
  // 末尾连续的 [..] 是修饰（语言、DL 版…），只认语言
  const trailing = []
  for (;;) {
    const match = text.match(/\s*\[([^\]]+)\]\s*$/)
    if (!match) break
    trailing.unshift(match[1])
    text = text.slice(0, match.index)
  }
  for (const label of trailing) {
    for (const [pattern, language] of LANGUAGES) {
      if (pattern.test(label)) { tags.push(`language:${language}`); break }
    }
  }
  const parody = text.match(/\(([^()]+)\)\s*$/)
  if (parody) {
    const value = parody[1].trim()
    tags.push(`parody:${/^(オリジナル|original)$/i.test(value) ? 'original' : value}`)
  }
  return tags
}

function xmlValue(xml, name) {
  const match = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))
  return match ? match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : ''
}

export function parseComicInfo(xml) {
  const tags = []
  for (const writer of splitList(xmlValue(xml, 'Writer'))) tags.push(`artist:${writer}`)
  for (const penciller of splitList(xmlValue(xml, 'Penciller'))) tags.push(`artist:${penciller}`)
  const series = xmlValue(xml, 'Series')
  if (series) tags.push(`series:${series}`)
  for (const genre of splitList(xmlValue(xml, 'Genre'))) tags.push(`genre:${genre}`)
  for (const tag of splitList(xmlValue(xml, 'Tags'))) tags.push(tag)
  const language = xmlValue(xml, 'LanguageISO')
  if (language) tags.push(`language:${language.toLowerCase()}`)
  const publisher = xmlValue(xml, 'Publisher')
  if (publisher) tags.push(`publisher:${publisher}`)
  return tags
}

export async function generateTags(ctx) {
  const service = ctx.services?.archiveGallery
  if (!service) throw new Error('这个脚本只能用在压缩包图集条目上')
  const options = { parseFilename: true, readComicInfo: true, pageCountTag: true, ...(ctx.script?.options || {}) }
  const logs = []
  const tags = []
  const info = await service.inspect()
  try {
    if (options.pageCountTag) {
      tags.push(`页数: ${info.pageCount}`)
      await service.setPageCount(info.pageCount)
      logs.push(`页数 ${info.pageCount}`)
    }
    if (options.parseFilename) {
      // 条目的标题就是导入时的原文件名（压缩包 mv 进受管目录后文件名变成 <id>.zip，原名只留在标题里）；
      // 迁移来的条目标题是 LRR 里的标题。标题和（不是哈希名的）文件名都解析，取并集。
      const candidates = [ctx.item?.title, /^[0-9a-f]{40}\./i.test(ctx.item?.fileName || '') ? '' : ctx.item?.fileName].filter(Boolean)
      const parsed = [...new Set(candidates.flatMap((name) => parseFilename(name)))]
      tags.push(...parsed)
      logs.push(`文件名解析出 ${parsed.length} 个标签`)
    }
    if (options.readComicInfo) {
      const name = info.allNames.find((candidate) => candidate.split('/').pop().toLowerCase() === 'comicinfo.xml')
      if (name) {
        const xml = await info.readText(name)
        const parsed = xml ? parseComicInfo(xml) : []
        tags.push(...parsed)
        logs.push(`ComicInfo.xml 解析出 ${parsed.length} 个标签`)
      }
    }
  } finally {
    await info.close()
  }
  const seen = new Set()
  const itemTags = tags.filter((tag) => {
    const key = tag.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { itemTags, logs, details: { pageCount: info.pageCount, tags: itemTags.length } }
}
