// LANraragi → 压缩包图集 迁移。数据来源是 LANraragi 的 Redis db0（每个档案一个 hash，key 是档案 ID）：
//   name / title / tags(逗号分隔) / file(LRR 容器里的绝对路径) / pagecount / progress / lastreadtime / isnew / arcsize
// zip 本身只读挂载，不动它：条目 json 里记原路径（zip.external = true）。
// 可以反复运行：条目 id 就是 LRR 的档案 ID；元数据 json 是「提交点」——一个条目先写标签库、复制封面，
// 最后才原子地写 json。崩溃后要么 json 在（整条完成），要么不在（下次整条重做）。
//   skip（默认）：json 已存在就跳过；overwrite：用 LRR 里的内容重新生成并覆盖。
// 路径按字节处理：LRR 的 file 字段原样存着磁盘上的文件名字节，有些是 EUC-JP / Shift-JIS（不是 UTF-8）。
// 合法 UTF-8 的路径行为不变；非法的用字节访问，存进条目 zip.pathB64，显示名按 fileNameEncodings 严格解码。

import { stat } from 'node:fs/promises'
import path from 'node:path'
import { computeArchiveId, LRR_INIT_PROFILE } from './types/archive-gallery.mjs'
import { pairsToObject, RespClient } from './resp-client.mjs'
import { applyTagMap, DEFAULT_FILENAME_ENCODINGS, displayPath, extensionOfBytes, isValidUtf8, looksMojibake, mapPathBytes } from './legacy-path.mjs'

const ARCHIVE_ID = /^[0-9a-f]{40}$/
const SAMPLE_VERIFY = 200

// LRR 的 redis_decode：UTF-8 解两次（有些数据被双重编码过）。每次只在合法时才采用。
export function redisDecode(value) {
  if (value === null || value === undefined) return ''
  let text = Buffer.isBuffer(value) ? (isValidUtf8(value) ? value.toString('utf8') : value.toString('latin1')) : String(value)
  if ([...text].every((ch) => ch.codePointAt(0) <= 255) && /[\u0080-ÿ]/.test(text)) {
    const bytes = Buffer.from(text, 'latin1')
    if (isValidUtf8(bytes)) text = bytes.toString('utf8')
  }
  return text.normalize('NFC')
}

export function parseLrrTags(value) {
  const seen = new Set()
  const tags = []
  for (const part of String(value || '').split(/,\s?/)) {
    const tag = part.trim()
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    tags.push(tag)
  }
  return tags
}

function pushExample(list, value, limit = 20) {
  if (list.length < limit) list.push(value)
}

export async function runLrrMigration({
  handler,
  options = {},
  beforeWrite = null,
  onProgress = null,
  shouldStop = () => false,
}) {
  const { dryRun = false, overwrite = false, concurrency = 16, limit = 0, zipFilenameEncoding = '', redisUrl, contentDir, thumbDir, pathFrom, tagMap = {}, fileNameEncodings = DEFAULT_FILENAME_ENCODINGS } = options
  const namespaceCounts = new Map()
  // 非 UTF-8 文件名的例子：每种编码（以及「缺失」「解不出」）各留前 6 个，方便逐个编码人工核对解码质量
  const legacyExampleCounts = new Map()
  const pushLegacyExample = (example) => {
    const key = example.exists ? example.encoding : `${example.encoding}/缺失`
    const count = legacyExampleCounts.get(key) || 0
    if (count >= 6) return
    legacyExampleCounts.set(key, count + 1)
    report.nonUtf8.examples.push(example)
  }
  const internals = handler.internals
  const report = {
    dryRun,
    overwrite,
    limit,
    limited: false,
    zipFilenameEncoding,
    tagMap,
    fileNameEncodings,
    startedAt: new Date().toISOString(),
    redisKeys: 0,
    archives: 0,
    imported: 0,
    skippedExisting: 0,
    skippedExtension: {},
    missingFile: 0,
    pathMismatch: 0,
    noTitle: 0,
    noTags: 0,
    coverCopied: 0,
    noCover: 0,
    failed: 0,
    totalTags: 0,
    // 非 UTF-8 的文件名（EUC-JP / Shift-JIS …）：按字节访问，能不能解出可读的显示名
    nonUtf8: { total: 0, found: 0, stillMissing: 0, byEncoding: {}, undecodable: 0, titleReplaced: 0, examples: [] },
    namespaces: [],          // 迁移前的标签命名空间分布（前 20），用来设计 tagMap
    tagMapExamples: [],      // tagMap 生效后的前后对比
    examples: { missingFile: [], pathMismatch: [], noCover: [], failed: [], skippedExtension: [] },
    idCheck: { sampled: 0, mismatched: 0, mismatches: [] },
    cancelled: false,
  }
  const client = await RespClient.connect(redisUrl)
  const sampleKeep = []   // 蓄水池抽样：之后校验 id 算法
  let sampleSeen = 0
  try {
    report.redisKeys = Number(await client.command('DBSIZE')) || 0
    onProgress?.({ ...report })
    let cursor = '0'
    do {
      if (shouldStop()) { report.cancelled = true; break }
      const reply = await client.command('SCAN', cursor, 'COUNT', 2000)
      cursor = reply[0].toString('utf8')
      const keys = reply[1].map((key) => key.toString('utf8')).filter((key) => ARCHIVE_ID.test(key))
      if (!keys.length) continue
      const hashes = await client.pipeline(keys.map((key) => ['HGETALL', key]))
      const prepared = []
      const entries = keys.map((key, index) => ({ key, hash: pairsToObject(hashes[index]) }))
      const handleEntry = async ({ key, hash }) => {
        report.archives += 1
        try {
          const rawBytes = hash.file ? Buffer.from(hash.file) : Buffer.alloc(0)
          const ext = extensionOfBytes(rawBytes)
          const rawDisplay = displayPath(rawBytes, fileNameEncodings).text
          if (ext !== 'zip' && ext !== 'cbz') {
            report.skippedExtension[ext || '(无)'] = (report.skippedExtension[ext || '(无)'] || 0) + 1
            pushExample(report.examples.skippedExtension, rawDisplay)
            return
          }
          const mappedBytes = mapPathBytes(rawBytes, pathFrom, contentDir)
          if (!mappedBytes) {
            report.pathMismatch += 1
            pushExample(report.examples.pathMismatch, rawDisplay)
            return
          }
          // 合法 UTF-8 → 字符串路径（和以前完全一样）；否则 → Buffer 路径，按字节访问
          const legacy = !isValidUtf8(mappedBytes)
          const zipPathArg = legacy ? mappedBytes : mappedBytes.toString('utf8')
          const shown = displayPath(mappedBytes, fileNameEncodings)
          let legacyNote = null
          if (legacy) {
            report.nonUtf8.total += 1
            const encoding = shown.undecodable ? '' : (shown.encodings[0] || '')
            if (shown.undecodable) report.nonUtf8.undecodable += 1
            else for (const used of shown.encodings) report.nonUtf8.byEncoding[used] = (report.nonUtf8.byEncoding[used] || 0) + 1
            legacyNote = { display: shown.text, encoding: encoding || '(无法解码)', bytesHex: mappedBytes.subarray(Math.max(0, mappedBytes.lastIndexOf(0x2f) + 1)).toString('hex').slice(0, 60) }
          }
          let info
          try {
            info = await stat(zipPathArg)
          } catch {
            report.missingFile += 1
            if (legacy) {
              report.nonUtf8.stillMissing += 1
              pushLegacyExample({ ...legacyNote, exists: false })
            }
            pushExample(report.examples.missingFile, shown.text)
            return
          }
          if (legacy) {
            report.nonUtf8.found += 1
            pushLegacyExample({ ...legacyNote, exists: true })
          }
          if (!overwrite && await handler.internals.itemExists(key)) {
            report.skippedExisting += 1
            return
          }
          const name = redisDecode(hash.name)
          let title = redisDecode(hash.title).trim() || name
          // 路径不是 UTF-8 时，LRR 里的标题大概率是乱码（字节被当成 latin-1 存的）：能按编码列表解出可读文件名就用它
          let titleReplaced = false
          if (legacy && !shown.undecodable && looksMojibake(title)) {
            const base = shown.text.slice(shown.text.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '').trim()
            if (base) {
              title = base
              titleReplaced = true
            }
          }
          const lrrTags = parseLrrTags(redisDecode(hash.tags))
          const tags = applyTagMap(lrrTags, tagMap)
          const dateAdded = Number((tags.find((tag) => tag.toLowerCase().startsWith('date_added:')) || '').split(':')[1])
          const createdAt = new Date(Number.isFinite(dateAdded) && dateAdded > 0 ? dateAdded * 1000 : info.mtimeMs).toISOString()
          const thumb = path.join(thumbDir, key.slice(0, 2), `${key}.jpg`)
          const hasThumb = await stat(thumb).then(() => true, () => false)
          const num = (field) => Number(hash[field]?.toString('utf8')) || 0
          // 状态标签和脚本对齐：封面（缩略图脚本管理的「压缩包封面」组）、页数（标签脚本管理的「页数」组）；不经过 tagMap
          const statusTags = [`压缩包封面: ${hasThumb ? '有' : '无'}`, ...(num('pagecount') > 0 ? [`页数: ${num('pagecount')}`] : [])]
          const item = internals.buildItem({
            itemId: key,
            title: title || key,
            tags: [...tags, ...statusTags],
            zipPath: legacy ? shown.text : zipPathArg,
            zipPathBytes: legacy ? mappedBytes : null,
            external: true,
            size: info.size,
            mtimeMs: Math.floor(info.mtimeMs),
            pageCount: num('pagecount'),
            sourceProfile: LRR_INIT_PROFILE,
            origin: {
              lrr: {
                id: key,
                name,
                file: rawDisplay,
                ...(legacy ? { fileB64: rawBytes.toString('base64'), fileEncoding: shown.encodings.join(',') } : {}),
                isnew: hash.isnew ? hash.isnew.toString('utf8') : '',
                progress: num('progress'),
                pagecount: num('pagecount'),
                lastreadtime: num('lastreadtime'),
                arcsize: num('arcsize'),
              },
            },
            createdAt,
            cover: hasThumb ? internals.thumbnailUrl(key) : '',
            filenameEncoding: zipFilenameEncoding,
          })
          prepared.push({ item, thumb: hasThumb ? thumb : '', zipPath: zipPathArg, noTitle: !title, noLrrTags: lrrTags.length === 0, lrrTags, titleReplaced })
        } catch (error) {
          report.failed += 1
          pushExample(report.examples.failed, `${key}: ${error.message}`)
        }
      }
      // 分小块处理：限量时凑够名额就立刻停，不会把一整批（几千个）都 stat 一遍
      const chunk = Math.max(1, concurrency) * 4
      for (let at = 0; at < entries.length; at += chunk) {
        if (shouldStop()) break
        await mapPool(entries.slice(at, at + chunk), concurrency, handleEntry)
        if (limit > 0 && prepared.length >= Math.max(0, limit - report.imported)) break
      }
      // 限量：处理完后按配置的 limit 精确截断（已存在跳过的、缺文件的都不占名额）
      if (limit > 0) {
        const room = Math.max(0, limit - report.imported)
        if (prepared.length >= room) report.limited = true
        prepared.length = Math.min(prepared.length, room)
      }
      for (const entry of prepared) {
        if (entry.noTitle) report.noTitle += 1
        if (entry.noLrrTags) report.noTags += 1
        if (entry.titleReplaced) report.nonUtf8.titleReplaced += 1
        for (const tag of entry.lrrTags) {
          const colon = tag.indexOf(':')
          const key = colon > 0 ? tag.slice(0, colon).toLowerCase() : '(无命名空间)'
          namespaceCounts.set(key, (namespaceCounts.get(key) || 0) + 1)
        }
        if (Object.keys(tagMap).length && report.tagMapExamples.length < 8) {
          for (const from of entry.lrrTags) {
            const to = applyTagMap([from], tagMap)[0]
            if (to !== undefined && to !== from && report.tagMapExamples.length < 8 && !report.tagMapExamples.some((e) => e.from === from)) report.tagMapExamples.push({ from, to })
          }
        }
        if (!entry.thumb) {
          report.noCover += 1
          pushExample(report.examples.noCover, entry.item.itemId)
        }
        report.totalTags += entry.item.tags.length
        sampleSeen += 1
        if (sampleKeep.length < SAMPLE_VERIFY) sampleKeep.push({ key: entry.item.itemId, zipPath: entry.zipPath })
        else {
          const slot = Math.floor(Math.random() * sampleSeen)
          if (slot < SAMPLE_VERIFY) sampleKeep[slot] = { key: entry.item.itemId, zipPath: entry.zipPath }
        }
      }
      if (!dryRun && prepared.length) {
        // 提交顺序：标签库（可重复写）→ 封面 → 最后写 json（提交点）
        await beforeWrite?.(prepared.map((entry) => entry.item))
        await mapPool(prepared, concurrency, async ({ item, thumb }) => {
          try {
            if (thumb) {
              await internals.copyCoverFile(item.itemId, thumb)
              report.coverCopied += 1
            }
            await internals.writeItem(item)
            report.imported += 1
          } catch (error) {
            report.failed += 1
            pushExample(report.examples.failed, `${item.itemId}: ${error.message}`)
          }
        })
      } else if (dryRun) {
        report.imported += prepared.length   // 试运行里表示「将会导入」
      }
      onProgress?.({ ...report })
      if (report.limited) break
    } while (cursor !== '0')
  } finally {
    client.close()
  }
  // 抽样校验 id：全量校验要读约 250GB，抽样足够确认算法一致
  for (const { key, zipPath } of sampleKeep) {
    try {
      const actual = await computeArchiveId(zipPath)
      report.idCheck.sampled += 1
      if (actual !== key) {
        report.idCheck.mismatched += 1
        pushExample(report.idCheck.mismatches, `${key} ≠ ${actual}`)
      }
    } catch (error) {
      report.idCheck.sampled += 1
      report.idCheck.mismatched += 1
      pushExample(report.idCheck.mismatches, `${key}: ${error.message}`)
    }
  }
  report.namespaces = [...namespaceCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([namespace, count]) => ({ namespace, count }))
  report.finishedAt = new Date().toISOString()
  onProgress?.({ ...report })
  return report
}

async function mapPool(list, concurrency, work) {
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, async () => {
    while (next < list.length) {
      const index = next++
      await work(list[index], index)
    }
  })
  await Promise.all(workers)
}
