#!/usr/bin/env node
// 造一份很大的媒体库索引缓存（NDJSON，schema 4），服务启动时直接读它：压测「几十万条的库」用，不用真的建几十万个条目。
//   node scripts/dev/make-big-index.mjs <数据目录> [条目数，默认 300000]
import { createWriteStream, mkdirSync } from 'node:fs'
import path from 'node:path'

export async function makeBigIndex(dataDir, count = 300000) {
  const dir = path.join(dataDir, 'cache', 'library-index')
  mkdirSync(dir, { recursive: true })
  const out = createWriteStream(path.join(dir, 'media-items.0.ndjson'))
  const write = (value) => new Promise((resolve) => { if (out.write(`${JSON.stringify(value)}\n`)) resolve(); else out.once('drain', resolve) })
  await write({ schema: 4, itemCount: count, sourceCount: count, builtAt: new Date().toISOString() })
  for (let i = 0; i < count; i++) {
    const tags = [`作者:作者${i % 5000}`, `社团:社团${i % 3000}`, '原作:原作X', '语言:中文', `页数:${i % 50}`, '标签:汉化', `系列:S${i % 20000}`, `标题:${i}`]
    const at = new Date(1.7e12 + i * 1000).toISOString()
    await write({ k: 'i', v: { type: 'archive', itemId: `a${i}`, title: `标题 ${i}`, displayTitle: `标题 ${i}`, cover: `/api/library/items/archive/a${i}/thumbnail/cover`, sourceProfile: 'archive-gallery', productId: '', unitCount: 1, tags, unitTags: [], dlsite: {}, createdAt: at, importedAt: at, publishedAt: at, searchText: `archive a${i} 标题 ${i} ${tags.join(' ')}` } })
  }
  await new Promise((resolve) => out.end(resolve))
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (!process.argv[2]) { console.error('用法：make-big-index.mjs <数据目录> [条目数]'); process.exit(2) }
  await makeBigIndex(process.argv[2], Number(process.argv[3] || 300000))
  console.log(`done: ${process.argv[3] || 300000} 条 → ${process.argv[2]}/cache/library-index`)
}
