// 压缩包图集：生成标签。
//   1) 文件名/目录解析 —— 照搬自定义 LANraragi 插件 ARegexParse（"My Filename Parsing" v2.5）的逻辑：
//        - 先后对「目录路径」和「文件名（去扩展名，下划线换空格）」做同样的处理：
//          反复取出每个 [...]：内容形如 "X (Y)" → group:X、tag:Y，否则 → tag:内容；
//          再反复取出每个 (...) → tag:内容；
//        - 整体按先后顺序去重（保留第一次出现）；
//        - saveTitle 为真时，用去掉所有 [...] 和 (...) 之后剩下的文件名当条目标题。
//      "group" / "tag" 这两个名字可以在 namespaces 选项里改成别的（比如 circle / artist，空字符串 = 不加前缀）。
//      原始路径来自导入时记下的 origin.sourceFile（压缩包 mv 进受管目录后文件名会变成 <id>.zip，原名只留在这里）。
//   2) 页数（页数: N，同时回写条目页数）、包内 ComicInfo.xml（Writer、Penciller、Series、Genre、Tags、LanguageISO）。
// 本脚本产出的标签由服务端管理：下次运行没产出的会被移除，所以每次都完整产出一遍。

// LANraragi 的 redis_decode：UTF-8 解两次（文件名可能被双重编码过）。只在合法时采用。
function isValidUtf8(buf) {
  return Buffer.compare(Buffer.from(buf.toString('utf8'), 'utf8'), buf) === 0
}

export function redisDecode(text) {
  let value = String(text || '')
  if ([...value].every((ch) => ch.codePointAt(0) <= 255) && /[\u0080-ÿ]/.test(value)) {
    const bytes = Buffer.from(value, 'latin1')
    if (isValidUtf8(bytes)) value = bytes.toString('utf8')
  }
  return value.normalize('NFC')
}

// Perl 的 fileparse($file, qr/\.[^.]*/)：目录（带结尾斜杠）、文件名（去掉最后一个扩展名）
export function splitPath(file) {
  const slash = file.lastIndexOf('/')
  const dir = slash >= 0 ? file.slice(0, slash + 1) : ''
  const base = slash >= 0 ? file.slice(slash + 1) : file
  return { dir, name: base.replace(/\.[^.]*$/, '') }
}

// 对一段文本：先取出所有 [...]，再取出所有 (...)。返回 { tags, rest }，rest 是取完之后剩下的文本。
// 正则和 Perl 的 s/\[([^\]]+)\]// 一一对应：最左匹配、每次只替换第一个、循环到没有为止。
export function extract(text, names) {
  const tag = (value) => (names.tag ? `${names.tag}:${value}` : value)
  const group = (value) => (names.group ? `${names.group}:${value}` : value)
  const tags = []
  let rest = text
  for (;;) {
    const match = rest.match(/\[([^\]]+)\]/)
    if (!match) break
    rest = rest.replace(/\[([^\]]+)\]/, '')
    const inner = match[1]
    if (inner === '') continue
    const split = inner.match(/(.*) \((.*)\)/)
    if (split) {
      tags.push(group(split[1]))
      tags.push(tag(split[2]))
    } else {
      tags.push(tag(inner))
    }
  }
  for (;;) {
    const match = rest.match(/\(([^)]+)\)/)
    if (!match) break
    rest = rest.replace(/\(([^)]+)\)/, '')
    if (match[1] !== '') tags.push(tag(match[1]))
  }
  return { tags, rest }
}

// file：原始完整路径（或只有文件名）。返回 { tags, title }，title 是去掉所有 [...] 和 (...) 之后的文件名（已整理空格）。
export function parseFilenameTags(file, { usePath = true, namespaces = {} } = {}) {
  const names = { group: 'group', tag: 'tag', ...namespaces }
  const { dir, name } = splitPath(redisDecode(file))
  const tags = []
  if (usePath && dir) tags.push(...extract(dir, names).tags)
  const fromName = extract(name.replace(/_/g, ' '), names)
  tags.push(...fromName.tags)
  const seen = new Set()
  return {
    tags: tags.filter((value) => (seen.has(value) ? false : (seen.add(value), true))),
    title: fromName.rest.replace(/\s+/g, ' ').trim(),
  }
}

function splitList(value) {
  return String(value || '').split(/[、,，;；]/).map((part) => part.trim()).filter(Boolean)
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

// 原始路径：导入时记下的 sourceFile；迁移来的条目退回 LRR 里的路径；都没有就用标题当文件名（没有目录部分）
function originalFile(item) {
  return item?.origin?.sourceFile || item?.origin?.lrr?.file || item?.title || ''
}

export async function generateTags(ctx) {
  const service = ctx.services?.archiveGallery
  if (!service) throw new Error('这个脚本只能用在压缩包图集条目上')
  const options = {
    parseFilename: true,
    usePath: true,
    saveTitle: false,
    namespaces: { group: 'group', tag: 'tag' },
    readComicInfo: true,
    pageCountTag: true,
    ...(ctx.script?.options || {}),
  }
  const logs = []
  const tags = []
  let itemPatch

  if (options.parseFilename) {
    const parsed = parseFilenameTags(originalFile(ctx.item), { usePath: options.usePath !== false, namespaces: options.namespaces })
    tags.push(...parsed.tags)
    logs.push(`文件名/目录解析出 ${parsed.tags.length} 个标签`)
    if (options.saveTitle && parsed.title) {
      itemPatch = { title: parsed.title }
      logs.push(`标题改为：${parsed.title}`)
    }
  }

  // 页数和 ComicInfo 才需要打开压缩包；都关掉时只做字符串处理，不碰磁盘
  let pageCount
  if (options.pageCountTag || options.readComicInfo) {
    const info = await service.inspect()
    try {
      pageCount = info.pageCount
      if (options.pageCountTag) {
        tags.push(`页数: ${info.pageCount}`)
        await service.setPageCount(info.pageCount)
        logs.push(`页数 ${info.pageCount}`)
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
  }

  // 迁移时按 LRR 的 pagecount 写过「页数: N」：先清掉，脚本算出的真实页数才能替换它
  if (options.pageCountTag) await service.clearTagGroups(['页数'])
  const seen = new Set()
  const itemTags = tags.filter((tag) => {
    const key = tag.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { itemTags, ...(itemPatch ? { itemPatch } : {}), logs, details: { pageCount, tags: itemTags.length } }
}
