import { readdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

export function relativeTarget(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative) || relative.split('/').some((s) => s === '..' || s === '.' || !s)) throw new Error(`不合法的目标路径: ${relative}`)
  return path.resolve(root, relative)
}

// Read each relevant directory once, instead of stat/realpath on every catalog asset.
// This snapshot is for planning only. Actual writes still validate paths afresh.
export function createPathInspector(root, signal) {
  const stats = { directoriesRead: 0, pathsInspected: 0, symlinksChecked: 0 }
  const directories = new Map([[root, Promise.resolve({ exists: true, absolute: root })]])
  const targets = new Map()
  const inside = (absolute) => { if (absolute !== root && !absolute.startsWith(root + path.sep)) throw new Error(`目标路径越界: ${absolute}`) }
  async function listing(directory) {
    signal?.throwIfAborted()
    if (!directory.listing) {
      stats.directoriesRead++
      directory.listing = readdir(directory.absolute, { withFileTypes: true }).then((entries) => new Map(entries.map((entry) => [entry.name, entry])))
    }
    return directory.listing
  }
  function directory(absolute) {
    if (directories.has(absolute)) return directories.get(absolute)
    const pending = (async () => {
      const parent = await directory(path.dirname(absolute))
      if (!parent.exists) return { exists: false }
      const entry = (await listing(parent)).get(path.basename(absolute))
      if (!entry) return { exists: false }
      let resolved = path.join(parent.absolute, entry.name)
      if (entry.isSymbolicLink()) {
        stats.symlinksChecked++
        resolved = await realpath(resolved); inside(resolved)
        if (!(await stat(resolved)).isDirectory()) throw new Error(`目标父路径不是目录: ${absolute}`)
      } else if (!entry.isDirectory()) throw new Error(`目标父路径不是目录: ${absolute}`)
      return { exists: true, absolute: resolved }
    })()
    directories.set(absolute, pending)
    return pending
  }
  function inspect(relative) {
    if (targets.has(relative)) return targets.get(relative)
    const pending = (async () => {
      signal?.throwIfAborted()
      stats.pathsInspected++
      const target = relativeTarget(root, relative)
      const parent = await directory(path.dirname(target))
      if (!parent.exists) return { target, exists: false }
      const entry = (await listing(parent)).get(path.basename(target))
      if (!entry) return { target, exists: false }
      let actual = path.join(parent.absolute, entry.name)
      if (entry.isSymbolicLink()) { stats.symlinksChecked++; actual = await realpath(actual); inside(actual) }
      return { target: actual, exists: true }
    })()
    targets.set(relative, pending)
    return pending
  }
  return { inspect, stats }
}
