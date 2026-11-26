// 路径标签：从条目的原始路径（目录 + 文件名）解析标签。纯字符串处理，不打开任何文件，所以不限条目类型。
//   解析规则照搬自定义 LANraragi 插件 ARegexParse（"My Filename Parsing" v2.5）：
//     - 先后对「目录路径」和「文件名（去扩展名，下划线换空格）」做同样的处理：
//       反复取出每个 [...]：内容形如 "X (Y)" → group:X、tag:Y，否则 → tag:内容；再反复取出每个 (...) → tag:内容；
//     - 整体按先后顺序去重（保留第一次出现）；
//     - saveTitle 为真时，用去掉所有 [...] 和 (...) 之后剩下的名字当条目标题。
//   "group" / "tag" 这两个名字可以在 namespaces 里改（比如 circle / artist，空字符串 = 不加前缀）。
//   pathDepth：只解析最后几层目录（0 = 全部），避开挂载根目录这类带括号的上层目录。
//   exclude：正则列表（不区分大小写），匹配括号里的内容就不生成标签，比如 1080p、RJ 号、年份。
//
// 各类型的「原始路径」（见 sourcePathOf）：
//   压缩包图集：导入前的完整路径（origin.sourceFile；迁移来的用 LRR 里记的路径）
//   Gal：作品目录（source.path）
//   媒体：按路径导入时的来源目录（origin.sourcePath）；上传单个文件时是文件名（origin.sourceFiles）
//   EPUB（旧库）：只有一本时用它的文件名
//   都没有：用标题（当成一个名字，不去「扩展名」）
//
// 原来这个脚本叫「压缩包图集标签」，还管页数和 ComicInfo.xml；3.0.0 起那两样挪到了缩略图脚本
// （archive-gallery-thumbnail-v1），这里只剩路径解析。id 不变：已有的标签归属和导入方案的默认勾选都按 id 认。
// 默认只对压缩包图集开：别的类型在配置里用 byType 打开（manifest 里默认 "scriptEnabled": false），见脚本配置页的说明。
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

function compileExclude(patterns, logs) {
  const list = Array.isArray(patterns) ? patterns : (patterns ? [patterns] : [])
  const out = []
  for (const pattern of list) {
    try {
      out.push(new RegExp(String(pattern), 'i'))
    } catch (error) {
      logs?.push(`exclude 里的正则无效，忽略：${pattern}（${error.message}）`)
    }
  }
  return out
}

// file：原始路径。isDir：这个路径本身是目录（Gal 作品目录、媒体的来源目录、标题兜底），最后一段当名字、不去扩展名。
// 返回 { tags, title }，title 是去掉所有 [...] 和 (...) 之后的名字（已整理空格）。
export function parseFilenameTags(file, { usePath = true, namespaces = {}, pathDepth = 0, exclude = [], isDir = false, logs = null } = {}) {
  const names = { group: 'group', tag: 'tag', ...namespaces }
  const decoded = redisDecode(file).replace(/\/+$/, '')
  let { dir, name } = splitPath(decoded)
  if (isDir) name = decoded.slice(decoded.lastIndexOf('/') + 1)
  const depth = Math.max(0, Math.floor(Number(pathDepth) || 0))
  if (depth > 0) dir = dir.split('/').filter(Boolean).slice(-depth).join('/')
  const excludes = compileExclude(exclude, logs)
  const prefixes = [names.group, names.tag].filter(Boolean).map((prefix) => `${prefix}:`)
  const keep = (tag) => {
    const prefix = prefixes.find((candidate) => tag.startsWith(candidate)) || ''
    const value = tag.slice(prefix.length)
    return !excludes.some((regex) => regex.test(value))
  }
  const tags = []
  if (usePath && dir) tags.push(...extract(dir, names).tags)
  const fromName = extract(name.replace(/_/g, ' '), names)
  tags.push(...fromName.tags)
  const seen = new Set()
  return {
    tags: tags.filter((value) => keep(value) && (seen.has(value) ? false : (seen.add(value), true))),
    title: fromName.rest.replace(/\s+/g, ' ').trim(),
  }
}

// 各类型条目的原始路径：{ path, isDir, source }。source 写进日志，方便看「这次解析的是哪个字段」
export function sourcePathOf(item, units = []) {
  const origin = item?.origin || {}
  if (origin.sourceFile) return { path: String(origin.sourceFile), isDir: false, source: 'origin.sourceFile' }
  if (origin.lrr?.file) return { path: String(origin.lrr.file), isDir: false, source: 'origin.lrr.file' }
  if (origin.sourcePath) return { path: String(origin.sourcePath), isDir: true, source: 'origin.sourcePath' }
  if (Array.isArray(origin.sourceFiles) && origin.sourceFiles.length === 1) return { path: String(origin.sourceFiles[0]), isDir: false, source: 'origin.sourceFiles' }
  if (item?.source?.path) return { path: String(item.source.path), isDir: true, source: 'source.path' }
  const files = (units || []).map((unit) => unit?.fileName).filter(Boolean)
  if (files.length === 1) return { path: String(files[0]), isDir: false, source: 'unit.fileName' }
  return { path: String(item?.title || ''), isDir: true, source: 'title' }
}

export async function generateTags(ctx) {
  const options = {
    usePath: true,
    pathDepth: 0,
    exclude: [],
    saveTitle: false,
    namespaces: { group: 'group', tag: 'tag' },
    ...(ctx.script?.options || {}),
  }
  const logs = []
  // 2.x 的老配置可能写了 parseFilename: false（当时只想要页数 / ComicInfo）：那两样已经挪走，这里就什么都不产出
  if (options.parseFilename === false) return { itemTags: [], logs: ['parseFilename 为 false，不解析路径'], details: {} }
  const source = sourcePathOf(ctx.item, ctx.units)
  if (!source.path) return { itemTags: [], logs: ['没有可解析的路径'], details: { source: source.source } }
  const parsed = parseFilenameTags(source.path, {
    usePath: options.usePath !== false,
    namespaces: options.namespaces,
    pathDepth: options.pathDepth,
    exclude: options.exclude,
    isDir: source.isDir,
    logs,
  })
  logs.push(`从 ${source.source}（${source.path}）解析出 ${parsed.tags.length} 个标签`)
  let itemPatch
  if (options.saveTitle && parsed.title) {
    itemPatch = { title: parsed.title }
    logs.push(`标题改为：${parsed.title}`)
  }
  return { itemTags: parsed.tags, ...(itemPatch ? { itemPatch } : {}), logs, details: { source: source.source, tags: parsed.tags.length } }
}
