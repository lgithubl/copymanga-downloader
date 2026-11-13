// AGE indexed ALF access. Index ordinals are scoped to their INI/AAI; append
// ordinals are never merged into the main table or confused with repeated IDs.
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { readFile, readdir, stat, mkdir, writeFile, rename } from 'node:fs/promises'
import { readAgeIndex, decodeAgeScript, readAgeImageHeader } from './age.mjs'
import { compileSafeRegex } from './voice.mjs'

const MAX_ENTRY = 256 * 1024 * 1024
export function ageRuleFilter(cfg) {
  const rules = (cfg.rules || []).map(rule => ({
    ...rule, re: compileSafeRegex(rule.match, { flags: 'i', label: 'AGE archive rule' }),
    include: (rule.include || []).map(match => compileSafeRegex(match, { flags: 'i', label: 'AGE include' })),
    exclude: (rule.exclude || []).map(match => compileSafeRegex(match, { flags: 'i', label: 'AGE exclude' })),
  }))
  return (row, kind) => {
    const rule = rules.find(rule => rule.re.test(row.archive))
    return Boolean(rule && !rule.skip && (!rule.kinds?.length || rule.kinds.includes(kind)) &&
      (!rule.include.length || rule.include.some(re => re.test(row.name))) && !rule.exclude.some(re => re.test(row.name)))
  }
}
function child(root, rel = '.') {
  if (typeof rel !== 'string' || rel.includes('\\') || rel.includes('\0') || path.isAbsolute(rel) || rel.split('/').includes('..')) throw Error('AGE relative root invalid')
  return path.resolve(root, rel)
}
export async function readAgeCatalog(mediaDir, { root = '.', dir = 'age', maxEntries = 200000 } = {}) {
  const source = child(mediaDir, root), names = (await readdir(source)).sort(), byName = new Map(names.map(name => [name.toLowerCase(), name]))
  const seenNames = new Set(), collisions = new Set()
  for (const name of names) { const lower = name.toLowerCase(); if (seenNames.has(lower)) collisions.add(lower); seenNames.add(lower) }
  if ([...collisions].some(name => name === 'sys4ini.bin' || /\.(?:alf|aai)$/.test(name))) throw Error('AGE archive/index filenames collide ignoring case')
  const main = byName.get('sys4ini.bin')
  if (!main) throw Error('AGE 缺少 SYS4INI.BIN')
  const indexNames = [main, ...names.filter(name => /\.aai$/i.test(name))]
  if (indexNames.length > 65) throw Error('AGE has more than 64 additional indexes')
  const archiveSizes = {}, archiveFiles = new Map(), parts = []
  for (const name of names.filter(name => /\.alf$/i.test(name))) {
    const file = path.join(source, name), info = await stat(file)
    if (!info.isFile()) continue
    archiveFiles.set(name.toLowerCase(), file); archiveSizes[name.toLowerCase()] = info.size
    parts.push([name, info.size, info.mtimeMs])
  }
  const indexes = [], entries = [], missingArchives = new Set()
  for (const name of indexNames) {
    const file = path.join(source, name), info = await stat(file)
    if (info.size > 16 * 1024 * 1024) throw Error('AGE index exceeds 16 MiB: ' + name)
    const bytes = await readFile(file), parsed = readAgeIndex(bytes, { archiveSizes })
    parts.push([name, createHash('sha256').update(bytes).digest('hex')])
    const namespace = name.replace(/\.(?:bin|aai)$/i, '').toLowerCase()
    const rows = parsed.entries.map(row => ({ ...row, namespace, file: archiveFiles.get(row.archive.toLowerCase()) || '',
      src: `${dir}/res/${namespace}/${row.name.replace(/\.(?:agf|xwm)$/i, ext => ext.toLowerCase() === '.agf' ? '.png' : '.wav')}` }))
    const overrides = rows.filter(row => byName.has(row.name.toLowerCase()))
    for (let k = 0; k < overrides.length; k += 64) await Promise.all(overrides.slice(k, k + 64).map(async row => {
      if (collisions.has(row.name.toLowerCase())) throw Error('AGE loose resource filename collision: ' + row.name)
      const actual = byName.get(row.name.toLowerCase()), file = path.join(source, actual), info = await stat(file)
      if (!info.isFile()) return
      parts.push(['loose:' + actual, info.size, info.mtimeMs])
      Object.assign(row, { file, offset: 0, size: info.size, loose: true, archivedSize: row.size })
    }))
    for (const row of rows) if (!row.file) missingArchives.add(row.archive)
    indexes.push({ name, namespace, ...parsed, entries: rows }); entries.push(...rows)
    if (entries.length > maxEntries) throw Error('AGE index entry count exceeds limit')
  }
  parts.sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  return { source, indexes, entries, missingArchives: [...missingArchives], sig: createHash('sha256').update(JSON.stringify(parts)).digest('hex') }
}

export function readAgeEntry(row, byteLength = row.size) {
  if (!row.file) throw Error('AGE archive missing: ' + row.archive)
  if (!Number.isSafeInteger(row.offset) || row.offset < 0 || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > MAX_ENTRY) throw Error('AGE resource range invalid/oversized: ' + row.name)
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > row.size) throw Error('AGE resource read length invalid: ' + row.name)
  const fd = openSync(row.file, 'r')
  try {
    if (row.offset + row.size > fstatSync(fd).size) throw Error('AGE resource outside archive: ' + row.name)
    const bytes = Buffer.alloc(byteLength)
    let done = 0
    while (done < bytes.length) { const n = readSync(fd, bytes, done, bytes.length - done, row.offset + done); if (!n) throw Error('AGE archive truncated: ' + row.name); done += n }
    return bytes
  } finally { closeSync(fd) }
}

export function ageResourceContext(catalog, namespace = 'sys4ini', toResourcePath = value => value) {
  const table = catalog.indexes.find(index => index.namespace === namespace)
  if (!table) throw Error('AGE resource namespace missing: ' + namespace)
  const images = {}, voice = {}, bgm = {}, links = {}, decoded = new Map()
  for (const row of table.entries) {
    if (/\.agf$/i.test(row.name)) Object.defineProperty(images, row.ordinal, { enumerable: true, get() {
      if (!decoded.has(row.ordinal)) {
        const head = readAgeEntry(row, 24), packed = head.readUInt32LE(20)
        if (packed < 1 || packed > 65536) throw Error('AGE AGF bitmap header bounds invalid')
        const { width, height } = readAgeImageHeader(readAgeEntry(row, 24 + packed))
        decoded.set(row.ordinal, { src: toResourcePath(row.src), width, height })
      }
      return decoded.get(row.ordinal)
    } })
    if (/\.(?:wav|xwm|ogg)$/i.test(row.name)) voice[row.ordinal] = toResourcePath(row.src)
    if (/\.bin$/i.test(row.name)) Object.defineProperty(links, row.ordinal, { enumerable: true, get() {
      const bytes = readAgeEntry(row); decodeAgeScript(bytes)
      return { name: row.name, script: bytes.toString('base64') }
    } })
  }
  // Native file-music player 47eac0 indexes its vector with (logical id - 2).
  // SYS4INI's zero-flags number table stores archive resource ordinals, not
  // filenames or repeated per-ALF entry ids. Id 0 stops; id 1 is not a track.
  // High-byte additional groups use a different native table and stay unmapped.
  if (table.metadata?.flags === 0) {
    const entries = new Map(table.entries.map(row => [row.ordinal, row]))
    for (const [k, ordinal] of table.metadata.numbers.entries()) {
      const row = entries.get(ordinal)
      if (!row || !/\.(?:wav|xwm|ogg)$/i.test(row.name)) throw Error('AGE BGM table references a non-audio ordinal: ' + ordinal)
      bgm[k + 2] = toResourcePath(row.src)
    }
  }
  const settings = Object.fromEntries((catalog.indexes[0].metadata?.settings || []).map(row => [row.name, row.value]))
  const stage = [Number(settings.SCREENX), Number(settings.SCREENY)]
  return { resources: { images, voice, bgm }, links, ...(stage.every(n => Number.isInteger(n) && n > 0 && n <= 8192) ? { stage } : {}) }
}

// Build only script packages; media remain in ALF until actually requested.
// A failed build retains the previous script tree and its stamp.
const builds = new Map()
export function expandAgeScripts(mediaDir, cfg) {
  const key = child(mediaDir, cfg.dir)
  const job = (builds.get(key) || Promise.resolve()).catch(() => {}).then(() => buildAgeScripts(mediaDir, cfg))
  builds.set(key, job)
  const release = () => { if (builds.get(key) === job) builds.delete(key) }
  job.then(release, release)
  return job
}
async function buildAgeScripts(mediaDir, cfg) {
  if (cfg.scan.length !== 1) throw Error('AGE currently requires exactly one container scan root')
  const catalog = await readAgeCatalog(mediaDir, { root: cfg.scan[0], dir: cfg.dir, maxEntries: cfg.maxEntries })
  const out = child(mediaDir, cfg.dir), stampFile = path.join(out, '.age-stamp.json')
  if (out === catalog.source || out === path.resolve(mediaDir)) throw Error('AGE generated cache must not be the source root')
  const sig = createHash('sha256').update(JSON.stringify([catalog.sig, cfg.scriptExt, cfg.rules, cfg.maxTotalMB, cfg.maxEntries, 1])).digest('hex')
  try { const old = JSON.parse(await readFile(stampFile, 'utf8')); if (old.sig === sig && (await stat(path.join(out, 'script'))).isDirectory()) return { ...old.report, cached: true } } catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error }
  await mkdir(out, { recursive: true })
  const allowed = ageRuleFilter(cfg)
  const pending = path.join(out, '.age-build-' + randomUUID()), report = { at: Date.now(), format: 'age', scripts: 0, skippedScripts: 0, looseOverrides: catalog.entries.filter(row => row.loose).map(row => ({ name: row.name, namespace: row.namespace, archivedSize: row.archivedSize, size: row.size })), missingArchives: catalog.missingArchives, unsupported: {}, arcs: {} }
  for (const index of catalog.indexes) report.arcs[index.namespace] = { scripts: 0, res: index.entries.filter(row => row.file && /\.(?:agf|xwm|wav|ogg)$/i.test(row.name) && allowed(row, 'res')).length, unsupported: 0 }
  await mkdir(pending, { recursive: true })
  let bytes = 0
  const scriptPaths = new Set()
  try {
    for (const row of catalog.entries) {
      if (!/\.bin$/i.test(row.name) || !row.file) continue
      if (!allowed(row, 'script')) { report.skippedScripts++; continue }
      if (row.size > 16 * 1024 * 1024) throw Error('AGE script exceeds 16 MiB: ' + row.name)
      const raw = readAgeEntry(row)
      if (!/^SYS4\d{3} $/.test(raw.toString('ascii', 0, 8))) { report.unsupported[row.namespace + '/' + row.name] = 'not SYS4 script'; report.arcs[row.namespace].unsupported++; continue }
      decodeAgeScript(raw)
      const data = JSON.stringify({ format: 'age-sys4/1', name: row.name, namespace: row.namespace, script: raw.toString('base64') })
      bytes += Buffer.byteLength(data)
      if (bytes > cfg.maxTotalMB * 1024 * 1024) throw Error('AGE expanded scripts exceed byte limit')
      const target = path.join(pending, row.namespace, row.name.replace(/\.bin$/i, '.' + (cfg.scriptExt || 'age')))
      if (scriptPaths.has(target.toLowerCase())) throw Error('AGE duplicate script path: ' + row.namespace + '/' + row.name)
      scriptPaths.add(target.toLowerCase())
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, data); report.scripts++; report.arcs[row.namespace].scripts++
    }
    const current = await readAgeCatalog(mediaDir, { root: cfg.scan[0], dir: cfg.dir, maxEntries: cfg.maxEntries })
    if (current.sig !== catalog.sig) throw Error('AGE source changed during script expansion; previous cache retained')
    const target = path.join(out, 'script'), moved = [], archive = path.join(out, 'archive', randomUUID())
    try {
      for (const part of ['script', 'res']) {
        const from = path.join(out, part)
        try { await stat(from) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
        await mkdir(archive, { recursive: true })
        const backup = path.join(archive, part); await rename(from, backup); moved.push({ from, backup })
      }
      await rename(pending, target)
    } catch (error) { for (const move of moved.reverse()) await rename(move.backup, move.from); throw error }
    report.mediaCacheArchived = moved.some(move => path.basename(move.from) === 'res')
    const tmpStamp = stampFile + '.' + randomUUID() + '.part'
    await writeFile(tmpStamp, JSON.stringify({ sig, report })); await rename(tmpStamp, stampFile)
    return report
  } catch (error) {
    report.error = String(error.message || error)
    const archive = path.join(out, 'archive'); await mkdir(archive, { recursive: true })
    await rename(pending, path.join(archive, 'failed-' + randomUUID())).catch(() => {})
    throw Object.assign(error, { ageReport: report })
  }
}
