// 全书进度条用的「章节分量」：阅读器一次只加载一章，别的章节没排版、不知道有几页，
// 所以全书位置按字数加权估算 ——（前面各章字数 + 本章读到的比例 × 本章字数）/ 全书字数。
// 每章的字数在这里算好，随阅读器接口的 sections[].chars 一起返回。
//
// 计法：去掉标签后的非空白字符数；每张图另算 IMAGE_WEIGHT 个字（只有一张插图的章节不至于是 0，
// 拖进度条时也能落到它）。只是估算：插图很多的章节会偏，但纯文字的书很准。
import { stat, readFile } from 'node:fs/promises'

const IMAGE_WEIGHT = 200
const CACHE_LIMIT = 5000
const cache = new Map()   // `${路径}|${mtime}|${大小}` -> 字数；文件变了键就变，不会读到旧值

export function htmlTextWeight(raw) {
  const html = String(raw || '')
  const body = /<body[\s>]/i.test(html) ? html.slice(html.search(/<body[\s>]/i)) : html
  const images = (body.match(/<(?:img|image)\b/gi) || []).length
  const text = body
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[#a-z0-9]+;/gi, 'x')   // 实体按一个字算
    .replace(/\s+/g, '')
  return text.length + images * IMAGE_WEIGHT
}

async function fileWeight(filePath) {
  const info = await stat(filePath)
  const key = `${filePath}|${info.mtimeMs}|${info.size}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const weight = htmlTextWeight(await readFile(filePath, 'utf8'))
  cache.set(key, weight)
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
  return weight
}

// sections 原样返回一份带 chars 的拷贝（不改 unit 里存的那份）。
// 「图片集」这种虚拟章节（type: gallery）不算进全书：它是全书插图的汇总，不是正文的一部分。
// 某一章读不出来就当 0，不影响别的章节和阅读本身。
export async function withSectionWeights(sections, resolvePath) {
  return await Promise.all((sections || []).map(async (section) => {
    if (section.type === 'gallery' || !section.resourcePath) return { ...section, chars: 0 }
    try {
      return { ...section, chars: await fileWeight(resolvePath(section)) }
    } catch {
      return { ...section, chars: 0 }
    }
  }))
}
