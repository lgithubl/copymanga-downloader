import { open, readFile } from 'node:fs/promises'
import path from 'node:path'

export function pngSize(bytes) {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20)
  return width && height ? { width, height } : null
}

export async function filePngSize(filename) {
  const file = await open(filename, 'r')
  try { const bytes = Buffer.alloc(24); const { bytesRead } = await file.read(bytes, 0, 24, 0); return pngSize(bytes.subarray(0, bytesRead)) }
  finally { await file.close() }
}

// An atlas/PNG size mismatch can also be intentional scaling. It is a candidate
// for comparison with a fresh export, never sufficient evidence to replace it.
export async function auditAtlasPages(plan, inspector, signal, progress) {
  const selected = new Map(plan.entries.flatMap(e => (e.assets || []).map(a => [a.target, a])))
  const atlases = [...selected.keys()].filter(p => p.endsWith('.atlas.txt'))
  const candidates = new Map()
  let checked = 0
  for (const atlas of atlases) {
    signal?.throwIfAborted()
    const current = await inspector.inspect(atlas)
    if (current.exists) {
      const text = await readFile(current.target, 'utf8')
      let page = ''
      for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim()
        if (!line) { page = ''; continue }
        if (/^[^/:\\]+\.png$/i.test(line)) { page = line; continue }
        if (!page) continue
        const size = /^size:\s*(\d+)\s*,\s*(\d+)\s*$/.exec(line)
        if (!size) { if (!line.includes(':')) page = ''; continue }
        const target = path.posix.join(path.posix.dirname(atlas), page)
        page = ''
        // Category-skipped assets and unrelated files must never be repaired.
        if (!selected.has(target)) continue
        const image = await inspector.inspect(target)
        if (!image.exists) continue
        const png = await filePngSize(image.target)
        const declared = { width: Number(size[1]), height: Number(size[2]) }
        if (!declared.width || !declared.height) continue
        if (!png || png.width !== declared.width || png.height !== declared.height) {
          const candidate = { target, atlas, png, declared, reason: png ? 'atlas-size-mismatch' : 'invalid-png-header' }
          const existing = candidates.get(target)
          if (existing) existing.atlases.push({ atlas, declared })
          else candidates.set(target, { ...candidate, atlases: [{ atlas, declared }] })
        }
      }
    }
    checked++
    if (checked % 250 === 0) await progress?.({ checked, total: atlases.length, candidates: candidates.size })
  }
  await progress?.({ checked, total: atlases.length, candidates: candidates.size })
  return candidates
}
