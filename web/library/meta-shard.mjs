// 元数据分片：<root>/ab/cd/<id>.json
// 40 位十六进制的 id（压缩包图集用文件前 512000 字节的 SHA-1）直接取它自己的前 4 位；
// 其它 id（按标题生成的）先 sha1 再取，保证分布均匀。两级各 256 个目录，百万条目每个目录约 15 个文件。

import { createHash } from 'node:crypto'
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function shardOf(itemId) {
  const id = String(itemId)
  const hex = /^[0-9a-f]{40}$/.test(id) ? id : createHash('sha1').update(id).digest('hex')
  return [hex.slice(0, 2), hex.slice(2, 4)]
}

export function shardedPath(root, itemId, suffix = '.json') {
  const [a, b] = shardOf(itemId)
  return path.join(root, a, b, `${itemId}${suffix}`)
}

// 紧凑 JSON + 临时文件 rename：崩溃后要么是完整的新文件，要么还是旧文件
export async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`)
  await writeFile(temp, JSON.stringify(value))
  await rename(temp, filePath)
}

// 遍历分片目录里的所有 json 文件路径（不读内容）
export async function* walkShardedFiles(root, suffix = '.json') {
  let level1 = []
  try {
    level1 = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const a of level1) {
    if (!a.isDirectory()) continue
    let level2 = []
    try {
      level2 = await readdir(path.join(root, a.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const b of level2) {
      if (!b.isDirectory()) continue
      let files = []
      try {
        files = await readdir(path.join(root, a.name, b.name), { withFileTypes: true })
      } catch {
        continue
      }
      for (const file of files) {
        if (file.isFile() && file.name.endsWith(suffix) && !file.name.startsWith('.')) {
          yield path.join(root, a.name, b.name, file.name)
        }
      }
    }
  }
}
