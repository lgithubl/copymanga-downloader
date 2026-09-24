import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'

const EPUB_MIME = 'application/epub+zip'

export function createEpubHandler({ dataDir, safeSegment, pathExists, moveAside }) {
  const root = path.join(dataDir, 'library', 'epub')
  const progressRoot = path.join(dataDir, 'cache', 'library', 'reading-progress', 'epub')

  async function scanItems() {
    let entries = []
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      return []
    }
    const items = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        items.push(await readMetadata(entry.name))
      } catch {
        // Ignore broken imports so one bad book does not hide the whole library.
      }
    }
    return items
  }

  async function importItem({ fileName = 'book.epub', buffer }) {
    if (!buffer?.length) throw new Error('EPUB file is required')
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'copymanga-library-epub-'))
    const uploadPath = path.join(tmpDir, safeSegment(fileName || 'book.epub'))
    await writeFile(uploadPath, buffer)
    const parsed = await parseEpub(buffer, tmpDir, uploadPath)
    const itemId = uniqueItemId(parsed.title || path.basename(fileName, path.extname(fileName)), buffer)
    const itemDir = itemPath(itemId)
    if (await pathExists(itemDir)) await moveAside(itemDir, 'library-import')
    await mkdir(itemDir, { recursive: true })
    const originalPath = path.join(itemDir, 'original.epub')
    const extractedDir = path.join(itemDir, 'extracted')
    await copyFile(uploadPath, originalPath)
    await extractZip(buffer, extractedDir)
    const metadata = await parseEpubMetadata({ itemId, itemDir, originalPath, extractedDir, fileName })
    await writeMetadata(itemId, metadata)
    return metadata
  }

  async function createSampleItem() {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'copymanga-library-sample-epub-'))
    const buffer = await createSampleEpub()
    return importItem({ fileName: 'sample-library-book.epub', buffer })
  }

  async function getItem(itemId) {
    return readMetadata(itemId)
  }

  async function listUnits(itemId) {
    const item = await readMetadata(itemId)
    return mediaUnitsForItem(item)
  }

  async function getReaderContent(itemId, unitId, options = {}) {
    const item = await readMetadata(itemId)
    const units = mediaUnitsForItem(item)
    const index = units.findIndex((unit) => unit.unitId === unitId)
    if (index < 0) throw new Error(`Unit not found: ${unitId}`)
    const unit = units[index]
    const sections = unit.sections || []
    const sectionId = String(options.sectionId || '').trim() || sections[0]?.sectionId || ''
    const section = sections.find((item) => item.sectionId === sectionId) || sections[0]
    if (!section) throw new Error(`Section not found: ${sectionId}`)
    if (section.type === 'gallery') {
      return {
        type: 'images',
        item: pickPublicItem(item),
        unit,
        section,
        sections,
        navigation: {
          prev: units[index - 1] || null,
          next: units[index + 1] || null,
        },
        sectionNavigation: sectionNavigation(sections, section.sectionId),
        images: (unit.imageResources || item.imageResources || []).map((image, imageIndex) => ({
          index: imageIndex,
          title: image.title || path.posix.basename(image.resourcePath),
          url: `/api/library/items/epub/${encodeURIComponent(itemId)}/resource?path=${encodeURIComponent(image.resourcePath)}`,
        })),
      }
    }
    const unitPath = safeExtractedPath(itemId, section.resourcePath)
    const raw = await readFile(unitPath, 'utf8')
    return {
      type: 'html',
      item: pickPublicItem(item),
      unit,
      section,
      sections,
      navigation: {
        prev: units[index - 1] || null,
        next: units[index + 1] || null,
      },
      sectionNavigation: sectionNavigation(sections, section.sectionId),
      content: sanitizeHtml(raw, {
        itemId,
        basePath: path.posix.dirname(section.resourcePath),
      }),
    }
  }

  async function getResource(itemId, resourcePath) {
    const filePath = safeExtractedPath(itemId, resourcePath)
    const body = await readFile(filePath)
    return {
      body,
      contentType: contentType(filePath),
    }
  }

  async function getProgress(itemId) {
    try {
      return normalizeProgress(JSON.parse(await readFile(progressPath(itemId), 'utf8')), itemId)
    } catch {
      return normalizeProgress(null, itemId)
    }
  }

  async function saveProgress(itemId, patch = {}) {
    const current = await getProgress(itemId)
    const now = new Date().toISOString()
    const unitId = String(patch.unitId || patch.lastUnitId || '').trim()
    if (unitId) {
      current.lastUnitId = unitId
      current.lastSectionId = String(patch.sectionId || current.lastSectionId || '')
      current.lastSectionTitle = String(patch.sectionTitle || current.lastSectionTitle || '')
      current.lastScrollRatio = clampRatio(patch.scrollRatio ?? patch.lastScrollRatio ?? current.lastScrollRatio)
      current.readUnits ||= {}
      current.readUnits[unitId] = {
        ...(current.readUnits[unitId] || {}),
        unitId,
        title: String(patch.title || current.readUnits[unitId]?.title || unitId),
        enteredAt: current.readUnits[unitId]?.enteredAt || now,
        updatedAt: now,
      }
      if (current.lastSectionId) {
        current.readUnits[unitId].sections ||= {}
        current.readUnits[unitId].sections[current.lastSectionId] = {
          sectionId: current.lastSectionId,
          title: current.lastSectionTitle || current.lastSectionId,
          enteredAt: current.readUnits[unitId].sections[current.lastSectionId]?.enteredAt || now,
          updatedAt: now,
        }
      }
      if (current.lastScrollRatio >= 0.9) current.readUnits[unitId].completedAt ||= now
    }
    current.updatedAt = now
    await mkdir(progressRoot, { recursive: true })
    const file = progressPath(itemId)
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, JSON.stringify(current, null, 2))
    await rename(tmp, file)
    return current
  }

  function itemPath(itemId) {
    return path.join(root, safeSegment(itemId))
  }

  function metadataPath(itemId) {
    return path.join(itemPath(itemId), 'metadata.json')
  }

  function progressPath(itemId) {
    return path.join(progressRoot, `${safeSegment(itemId)}.json`)
  }

  async function readMetadata(itemId) {
    return normalizeItem(JSON.parse(await readFile(metadataPath(itemId), 'utf8')))
  }

  async function writeMetadata(itemId, metadata) {
    await mkdir(itemPath(itemId), { recursive: true })
    await writeFile(metadataPath(itemId), JSON.stringify(normalizeItem(metadata), null, 2))
  }

  function safeExtractedPath(itemId, resourcePath) {
    const extractedRoot = path.resolve(itemPath(itemId), 'extracted')
    const candidate = path.resolve(extractedRoot, resourcePath || '')
    if (candidate !== extractedRoot && !candidate.startsWith(`${extractedRoot}${path.sep}`)) {
      throw new Error('Forbidden resource path')
    }
    return candidate
  }

  async function parseEpub(buffer, outDir, epubPath) {
    const extractDir = path.join(outDir, 'parse')
    await mkdir(extractDir, { recursive: true })
    await extractZip(buffer, extractDir)
    return parseEpubMetadata({ itemId: 'preview', itemDir: outDir, originalPath: epubPath, extractedDir: extractDir, fileName: path.basename(epubPath) })
  }

  async function parseEpubMetadata({ itemId, itemDir, originalPath, extractedDir, fileName }) {
    const containerXml = await readFile(path.join(extractedDir, 'META-INF', 'container.xml'), 'utf8')
    const opfPath = xmlAttr(containerXml, 'rootfile', 'full-path')
    if (!opfPath) throw new Error('EPUB container missing OPF rootfile')
    const opf = await readFile(path.join(extractedDir, opfPath), 'utf8')
    const opfDir = path.posix.dirname(opfPath)
    const manifest = parseManifest(opf, opfDir)
    const spine = parseSpine(opf)
    const navTitles = await parseNavTitles({ extractedDir, manifest })
    const title = textTag(opf, 'dc:title') || textTag(opf, 'title') || path.basename(fileName, path.extname(fileName))
    const author = textTag(opf, 'dc:creator') || textTag(opf, 'creator') || ''
    const units = []
    for (const [index, idref] of spine.entries()) {
      const entry = manifest.get(idref)
      if (!entry?.href) continue
      const resourcePath = normalizeZipPath(path.posix.join(opfDir, entry.href))
      const unitTitle = navTitles.get(resourcePath) || await documentTitle(path.join(extractedDir, resourcePath)) || `章节 ${index + 1}`
      units.push({
        type: 'chapter',
        unitId: safeUnitId(idref || `unit-${index + 1}`),
        title: unitTitle,
        index,
        resourcePath,
      })
    }
    const imageResources = collectImageResources(manifest, opfDir)
    if (imageResources.length) {
      units.push({
        type: 'gallery',
        unitId: '__images__',
        title: '图片集',
        index: units.length,
        virtual: true,
        imageCount: imageResources.length,
      })
    }
    const coverEntry = [...manifest.values()].find((entry) => (
      /\bcover-image\b/.test(entry.properties || '') || /^cover/i.test(entry.id || '')
    )) || (imageResources[0] ? { href: path.posix.relative(opfDir, imageResources[0].resourcePath) } : null)
    const cover = coverEntry?.href
      ? `/api/library/items/epub/${encodeURIComponent(itemId)}/resource?path=${encodeURIComponent(normalizeZipPath(path.posix.join(opfDir, coverEntry.href)))}`
      : ''
    const info = await stat(originalPath)
    return normalizeItem({
      type: 'epub',
      itemId,
      title: decodeEntities(title),
      author: author ? [decodeEntities(author)] : [],
      cover,
      fileName,
      itemDir,
      unitCount: 1,
      units,
      imageResources,
      createdAt: new Date().toISOString(),
      updatedAt: info.mtime.toISOString(),
    })
  }

  return {
    type: 'epub',
    label: 'EPUB',
    scanItems,
    importItem,
    createSampleItem,
    getItem,
    listUnits,
    getReaderContent,
    getResource,
    getProgress,
    saveProgress,
  }
}

function normalizeItem(item) {
  const units = Array.isArray(item?.units) ? item.units : []
  return {
    type: 'epub',
    itemId: String(item?.itemId || ''),
    title: String(item?.title || item?.itemId || 'Untitled'),
    author: Array.isArray(item?.author) ? item.author : [],
    cover: String(item?.cover || ''),
    fileName: String(item?.fileName || ''),
    unitCount: Number(item?.unitCount || units.length || 0),
    units,
    imageResources: Array.isArray(item?.imageResources) ? item.imageResources : [],
    createdAt: String(item?.createdAt || ''),
    updatedAt: String(item?.updatedAt || new Date().toISOString()),
  }
}

function mediaUnitsForItem(item) {
  if (Array.isArray(item?.mediaUnits) && item.mediaUnits.length) return item.mediaUnits
  const sections = (Array.isArray(item?.units) ? item.units : []).map((unit, index) => ({
    type: unit.type || 'chapter',
    sectionId: unit.sectionId || unit.unitId || `section-${index + 1}`,
    title: unit.title || `章节 ${index + 1}`,
    index,
    resourcePath: unit.resourcePath || '',
    virtual: Boolean(unit.virtual),
    imageCount: unit.imageCount || 0,
  }))
  const chapterCount = sections.filter((section) => section.type !== 'gallery').length
  const imageCount = Number(item?.imageResources?.length || 0)
  return [{
    type: 'epub',
    unitId: item.epubUnitId || '__epub__',
    title: item.fileName || item.title || 'EPUB',
    index: 0,
    fileName: item.fileName || '',
    sectionCount: sections.length,
    chapterCount,
    imageCount,
    sections,
    imageResources: item.imageResources || [],
  }]
}

function sectionNavigation(sections, sectionId) {
  const index = sections.findIndex((section) => section.sectionId === sectionId)
  return {
    prev: index > 0 ? sections[index - 1] : null,
    next: index >= 0 && index < sections.length - 1 ? sections[index + 1] : null,
  }
}

function pickPublicItem(item) {
  const { units, mediaUnits, imageResources, ...publicItem } = item
  return publicItem
}

function normalizeProgress(value, itemId) {
  return {
    type: 'epub',
    itemId,
    lastUnitId: String(value?.lastUnitId || ''),
    lastSectionId: String(value?.lastSectionId || ''),
    lastSectionTitle: String(value?.lastSectionTitle || ''),
    lastScrollRatio: clampRatio(value?.lastScrollRatio || 0),
    readUnits: value?.readUnits && typeof value.readUnits === 'object' ? value.readUnits : {},
    updatedAt: String(value?.updatedAt || ''),
  }
}

function uniqueItemId(title, buffer) {
  const digest = createHash('sha1').update(buffer).digest('hex').slice(0, 10)
  return `${slug(title)}-${digest}`
}

function slug(value) {
  return String(value || 'book')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 64) || 'book'
}

function safeUnitId(value) {
  return slug(value).replace(/-/g, '_') || `unit_${Date.now()}`
}

function xmlAttr(xml, tag, attr) {
  const tagMatch = new RegExp(`<${tag}\\b([^>]*)>`, 'i').exec(xml)
  if (!tagMatch) return ''
  return attrValue(tagMatch[1], attr)
}

function attrValue(attrs, name) {
  const match = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(attrs)
  return match ? decodeEntities(match[1]) : ''
}

function textTag(xml, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml)
  return match ? stripTags(match[1]).trim() : ''
}

function parseManifest(opf, opfDir) {
  const manifest = new Map()
  for (const match of opf.matchAll(/<item\b([^>]*)\/?>/gi)) {
    const attrs = match[1]
    const id = attrValue(attrs, 'id')
    if (!id) continue
    manifest.set(id, {
      id,
      href: attrValue(attrs, 'href'),
      mediaType: attrValue(attrs, 'media-type'),
      properties: attrValue(attrs, 'properties'),
      absolutePath: normalizeZipPath(path.posix.join(opfDir, attrValue(attrs, 'href'))),
    })
  }
  return manifest
}

function parseSpine(opf) {
  return [...opf.matchAll(/<itemref\b([^>]*)\/?>/gi)]
    .map((match) => attrValue(match[1], 'idref'))
    .filter(Boolean)
}

function collectImageResources(manifest, opfDir) {
  const seen = new Set()
  const images = []
  for (const entry of manifest.values()) {
    if (!/^image\/(?:jpeg|jpg|png|gif|webp)$/i.test(entry.mediaType || '')) continue
    const resourcePath = normalizeZipPath(path.posix.join(opfDir, entry.href))
    if (!resourcePath || seen.has(resourcePath)) continue
    seen.add(resourcePath)
    images.push({
      resourcePath,
      title: path.posix.basename(resourcePath),
      mediaType: entry.mediaType,
    })
  }
  return images.sort((a, b) => a.resourcePath.localeCompare(b.resourcePath, undefined, { numeric: true }))
}

async function parseNavTitles({ extractedDir, manifest }) {
  const titles = new Map()
  const nav = [...manifest.values()].find((entry) => /\bnav\b/.test(entry.properties || ''))
  if (!nav?.absolutePath) return titles
  try {
    const navHtml = await readFile(path.join(extractedDir, nav.absolutePath), 'utf8')
    const navDir = path.posix.dirname(nav.absolutePath)
    for (const match of navHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attrValue(match[1], 'href').split('#')[0]
      if (!href) continue
      const target = normalizeZipPath(path.posix.join(navDir, href))
      titles.set(target, stripTags(match[2]).trim())
    }
  } catch {
    return titles
  }
  return titles
}

async function documentTitle(filePath) {
  try {
    const html = await readFile(filePath, 'utf8')
    return textTag(html, 'title') || textTag(html, 'h1') || ''
  } catch {
    return ''
  }
}

function sanitizeHtml(html, { itemId, basePath }) {
  let body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] || html
  body = body
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object\b[\s\S]*?<\/object>/gi, '')
    .replace(/<embed\b[\s\S]*?<\/embed>/gi, '')
    .replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
    .replace(/\s(?:src|href)\s*=\s*["']\s*javascript:[^"']*["']/gi, '')
  body = body.replace(/\s(src)\s*=\s*["']([^"']+)["']/gi, (_, attr, value) => {
    if (/^(?:https?:|data:|#)/i.test(value)) return ` ${attr}="${escapeAttr(value)}"`
    const target = normalizeZipPath(path.posix.join(basePath, decodeEntities(value).split('#')[0]))
    return ` ${attr}="/api/library/items/epub/${encodeURIComponent(itemId)}/resource?path=${encodeURIComponent(target)}"`
  })
  body = body.replace(/\s(href)\s*=\s*["']([^"']+)["']/gi, (_, attr, value) => {
    if (/^#/i.test(value)) return ` ${attr}="${escapeAttr(value)}"`
    return ` ${attr}="#"`
  })
  return body
}

function normalizeZipPath(value) {
  return path.posix.normalize(String(value || '').replace(/\\/g, '/')).replace(/^(\.\.\/)+/, '').replace(/^\//, '')
}

function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function escapeAttr(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function clampRatio(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.xhtml' || ext === '.html') return 'text/html; charset=utf-8'
  if (ext === '.css') return 'text/css; charset=utf-8'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.otf') return 'font/otf'
  if (ext === '.ttf') return 'font/ttf'
  if (ext === '.epub') return EPUB_MIME
  return 'application/octet-stream'
}

async function createSampleEpub() {
  const files = new Map()
  files.set('mimetype', Buffer.from(EPUB_MIME))
  files.set('META-INF/container.xml', Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`))
  files.set('OEBPS/styles/book.css', Buffer.from(`body{font-family:serif;} p{line-height:1.8;}`))
  files.set('OEBPS/images/sample.png', samplePng())
  const chapters = [
    ['chapter1.xhtml', '第一章 入口', ['这是一本用于测试新媒体库的示例 EPUB。', '它包含多个章节、段落和内部资源，阅读进度会写入新系统的 progress 文件。']],
    ['chapter2.xhtml', '第二章 长廊', ['第二章用于测试上一章和下一章导航。', '滚动到接近底部时，这一章会被记录为完成阅读。']],
    ['chapter3.xhtml', '第三章 窗边', ['这里放一些更长的正文，用来观察宽度、行高和滚动体验。', '新系统使用 item/unit/readerContent 的抽象，后续 CopyManga 也可以接入。', '<img src="../images/sample.png" alt="示例图片" />']],
    ['chapter4.xhtml', '第四章 雨声', ['EPUB handler 不调用外部漫画接口，只读取本地解包后的文件。', '资源会通过统一 resource API 输出。']],
    ['chapter5.xhtml', '第五章 尾声', ['最后一章用于验证章节目录和结束位置。', '这个样例可以安全删除或重新生成。']],
  ]
  for (const [file, title, paragraphs] of chapters) {
    files.set(`OEBPS/text/${file}`, Buffer.from(chapterXhtml(title, paragraphs)))
  }
  files.set('OEBPS/nav.xhtml', Buffer.from(navXhtml(chapters)))
  files.set('OEBPS/content.opf', Buffer.from(opfXml(chapters)))
  return createZip(files)
}

async function extractZip(buffer, targetDir) {
  const entries = readZipEntries(buffer)
  for (const entry of entries) {
    const entryPath = normalizeZipPath(entry.name)
    if (!entryPath || entryPath.endsWith('/')) continue
    const outPath = path.resolve(targetDir, entryPath)
    const root = path.resolve(targetDir)
    if (!outPath.startsWith(`${root}${path.sep}`)) continue
    await mkdir(path.dirname(outPath), { recursive: true })
    await writeFile(outPath, entry.body)
  }
}

function readZipEntries(buffer) {
  const eocdOffset = findSignatureBackwards(buffer, 0x06054b50)
  if (eocdOffset < 0) throw new Error('Invalid ZIP: EOCD not found')
  const entryCount = buffer.readUInt16LE(eocdOffset + 10)
  let cursor = buffer.readUInt32LE(eocdOffset + 16)
  const entries = []
  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP: central directory expected')
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP: local header expected')
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize)
    let body
    if (method === 0) body = compressed
    else if (method === 8) body = inflateRawSync(compressed)
    else throw new Error(`Unsupported ZIP compression method: ${method}`)
    entries.push({ name, body })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function createZip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [name, body] of files.entries()) {
    const nameBuffer = Buffer.from(name)
    const stored = name === 'mimetype'
    const compressed = stored ? body : deflateRawSync(body)
    const method = stored ? 0 : 8
    const crc = crc32(body)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuffer, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)
    offset += local.length + nameBuffer.length + compressed.length
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.size, 8)
  eocd.writeUInt16LE(files.size, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, ...centralParts, eocd])
}

function findSignatureBackwards(buffer, signature) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset
  }
  return -1
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
  }
  return value >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chapterXhtml(title, paragraphs) {
  const body = paragraphs.concat([
    '为了让页面有足够的滚动距离，这里补充一段重复测试文本。阅读器应该保持舒适的正文宽度，而不是把内容撑满整个屏幕。',
    '这是另一段测试文字。未来如果接入 manga、pdf、cbz，也应该只是新增 renderer 或 handler，而不是重写库存系统。',
    '章节末尾。滚动进度会按当前章节保存。',
  ]).map((text) => `<p>${text}</p>`).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
<head><title>${title}</title><link rel="stylesheet" href="../styles/book.css"/></head>
<body><h1>${title}</h1>${body}</body>
</html>`
}

function navXhtml(chapters) {
  const links = chapters.map(([file, title]) => `<li><a href="text/${file}">${title}</a></li>`).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>目录</title></head>
<body><nav epub:type="toc"><ol>${links}</ol></nav></body>
</html>`
}

function opfXml(chapters) {
  const manifestChapters = chapters
    .map(([file], index) => `<item id="chapter${index + 1}" href="text/${file}" media-type="application/xhtml+xml"/>`)
    .join('\n')
  const spine = chapters.map((_, index) => `<itemref idref="chapter${index + 1}"/>`).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="bookid" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">sample-library-book</dc:identifier>
    <dc:title>媒体库示例 EPUB</dc:title>
    <dc:creator>Codex</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="styles/book.css" media-type="text/css"/>
    <item id="sample-image" href="images/sample.png" media-type="image/png" properties="cover-image"/>
    ${manifestChapters}
  </manifest>
  <spine>${spine}</spine>
</package>`
}

function samplePng() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAVklEQVR4nO3PQQ0AIBDAMMC/5+ONAvZoFSzZnTtZ3Qf8bQOIAyAOgDgA4gCIAyAOgDgA4gCIAyAOgDgA4gCIAyAOgDgA4gCIAyAOgDgA4gCIAyAOgHhL1gKQGk2bWAAAAABJRU5ErkJggg==',
    'base64',
  )
}
