// 压缩包图集：所有「要打开压缩包」的活都在这个脚本里 —— 封面缩略图、可选的预览动图、页数、包内 ComicInfo.xml。
// 真正的读 zip / 缩放 / 编码在服务端 ctx.services.archiveGallery 里，脚本只负责按选项调用和产出标签。
//   选项：force（重新生成已存在的）、previewCount（预览里除第一页外再放几页，0 = 不要预览）、
//        previewMode（random | even）、previewWidth（预览宽度，像素）、
//        pageCountTag（页数: N，同时回写条目页数）、readComicInfo（包内 ComicInfo.xml → 标签）
// 页数和 ComicInfo 原来在「压缩包图集标签」脚本里；那个脚本现在只解析路径、不碰压缩包（改名「路径标签」）。

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

export async function generateTags(ctx) {
  const service = ctx.services?.archiveGallery
  if (!service) throw new Error('这个脚本只能用在压缩包图集条目上')
  const options = { pageCountTag: true, readComicInfo: true, ...(ctx.script?.options || {}) }
  const force = Boolean(options.force)
  const previewCount = Math.max(0, Math.floor(Number(options.previewCount) || 0))
  const itemTags = []
  const logs = []
  const details = {}

  try {
    const result = await service.generateCover({ force })
    itemTags.push('压缩包封面: 有')
    logs.push(result.status === 'exists' ? '封面已存在，跳过' : '已生成封面')
    details.cover = result.status
  } catch (error) {
    itemTags.push('压缩包封面: 失败')
    logs.push(`封面生成失败：${error.message}`)
    details.cover = 'failed'
  }

  // 预览和封面分开判断：迁移带来的 LRR 封面保留，只补预览
  if (previewCount > 0) {
    try {
      const result = await service.generatePreview({
        count: previewCount,
        mode: options.previewMode === 'even' ? 'even' : 'random',
        width: options.previewWidth,
        force,
      })
      if (result.status === 'skipped') {
        itemTags.push('压缩包预览: 无')
        logs.push(`没有预览：${result.reason}`)
      } else {
        itemTags.push('压缩包预览: 有')
        logs.push(result.status === 'exists' ? '预览已存在，跳过' : `已生成预览（第 ${result.frames.map((index) => index + 1).join('、')} 页）`)
      }
      details.preview = result.status
      if (result.frames) details.frames = result.frames
    } catch (error) {
      itemTags.push('压缩包预览: 失败')
      logs.push(`预览生成失败：${error.message}`)
      details.preview = 'failed'
    }
  }

  // 页数 + ComicInfo：只读压缩包的目录和那一个 xml，不解压。打不开（坏包）不影响上面已经做完的封面/预览
  if (options.pageCountTag || options.readComicInfo) {
    let info = null
    try {
      info = await service.inspect()
      details.pageCount = info.pageCount
      if (options.pageCountTag) {
        itemTags.push(`页数: ${info.pageCount}`)
        await service.setPageCount(info.pageCount)
        logs.push(`页数 ${info.pageCount}`)
      }
      if (options.readComicInfo) {
        const name = info.allNames.find((candidate) => candidate.split('/').pop().toLowerCase() === 'comicinfo.xml')
        if (name) {
          const xml = await info.readText(name)
          const parsed = xml ? parseComicInfo(xml) : []
          itemTags.push(...parsed)
          logs.push(`ComicInfo.xml 解析出 ${parsed.length} 个标签`)
        }
      }
    } catch (error) {
      logs.push(`读取压缩包目录失败（页数 / ComicInfo 跳过）：${error.message}`)
    } finally {
      await info?.close().catch(() => {})
    }
  }

  // 迁移时按 LRR 数据写过「压缩包封面: 有/无」「页数: N」：互斥组里不是脚本产出的标签会挡住新值，所以先清掉再返回
  await service.clearTagGroups(options.pageCountTag ? ['压缩包封面', '页数'] : ['压缩包封面'])
  const seen = new Set()
  const unique = itemTags.filter((tag) => {
    const key = tag.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { itemTags: unique, logs, details }
}
