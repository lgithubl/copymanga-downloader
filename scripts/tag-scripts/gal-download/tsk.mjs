import { readFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { openBundles, resourceBytes } from './unity.mjs'
import { encodePng } from './png.mjs'
import { classifyTskAsset } from './tsk-categories.mjs'
import { decodeASTC } from './vendor/astc.mjs'
import { decodeETC2RGBA8 } from './vendor/etc2.mjs'
import { unpackFsb5 } from './fsb5.mjs'
const exec = promisify(execFile)

function keyObject(data, offset) {
  const tag = data[offset++]
  if (tag === 0 || tag === 1) {
    const length = data.readInt32LE(offset); offset += 4
    if (length < 0 || offset + length > data.length) throw new Error('Catalog key 长度无效')
    return data.toString(tag ? 'utf16le' : 'ascii', offset, offset + length)
  }
  if (tag === 2) return data.readUInt16LE(offset)
  if (tag === 3) return data.readUInt32LE(offset)
  if (tag === 4) return data.readInt32LE(offset)
  if (tag === 5) return data.toString('ascii', offset + 1, offset + 1 + data[offset])
  throw new Error(`不支持 catalog key 类型 ${tag}`)
}

export function catalogEntries(catalog) {
  const bucket = Buffer.from(catalog.m_BucketDataString, 'base64')
  const keys = Buffer.from(catalog.m_KeyDataString, 'base64')
  const entries = Buffer.from(catalog.m_EntryDataString, 'base64')
  const count = bucket.readInt32LE(0), decodedKeys = [], refs = []
  if (count < 0 || count > bucket.length / 8) throw new Error('Catalog bucket 数量无效')
  let p = 4
  for (let i = 0; i < count; i++) {
    const keyOffset = bucket.readInt32LE(p), length = bucket.readInt32LE(p + 4); p += 8
    if (length < 0 || p + length * 4 > bucket.length) throw new Error('Catalog bucket 越界')
    decodedKeys.push(keyObject(keys, keyOffset))
    refs.push(Array.from({ length }, () => { const value = bucket.readInt32LE(p); p += 4; return value }))
  }
  const length = entries.readInt32LE(0)
  if (length < 0 || 4 + length * 28 > entries.length) throw new Error('Catalog entries 越界')
  return Array.from({ length }, (_, i) => {
    const p = 4 + i * 28
    const internal = entries.readInt32LE(p), dep = entries.readInt32LE(p + 8), primary = entries.readInt32LE(p + 20)
    let identifier = catalog.m_InternalIds[internal]
    if (typeof identifier !== 'string') throw new Error('Catalog internal id 无效')
    identifier = identifier.replace(/^(\d+)#(.*)$/, (_, n, suffix) => {
      const prefix = catalog.m_InternalIdPrefixes[Number(n)]
      if (prefix === undefined) throw new Error('Catalog prefix 越界')
      return prefix + suffix
    })
    if (dep >= refs.length || primary < 0 || primary >= decodedKeys.length) throw new Error('Catalog key index 越界')
    return { key: decodedKeys[primary], internal: identifier, deps: dep < 0 ? [] : refs[dep] }
  })
}

function mappedDestination(asset) {
  if (asset === 'Assets/Adventure/Master.chapter.asset') return { target: 'Adventure/Master.chapter.json', kind: 'master', category: 'scenario', rank: 10 }
  let m = /^Assets\/Adventure\/ImportChara\/(\d+)\.chapter\.asset$/.exec(asset)
  if (m) return { target: `Adventure/CharaScenario/CharaScenario${m[1]}.book.json`, kind: 'book', category: 'scenario', rank: 10 }
  m = /^Assets\/Adventure\/([A-Za-z]+Scenario)\/([^/]+)\.chapter\.asset$/.exec(asset)
  if (m) return { target: `Adventure/${m[1]}/${m[2]}.book.json`, kind: 'book', category: 'scenario', rank: 10 }
  if (!asset.startsWith('Assets/AssetBundles/')) return null
  let relative = asset.slice('Assets/AssetBundles/'.length)
  if (!/^(Stills|Characters|Cutin|Adventure\/(?:BackGrounds|Spine|Textures)|Sound|Sprites|GachaCharaAnim)\//.test(relative) || relative.includes('/LowQuality/')) return null
  let rank = relative.includes('/HighQuality/') ? 10 : 0
  if (/^(Characters|GachaCharaAnim|Adventure\/BackGrounds)\//.test(relative)) relative = relative.replaceAll('/HighQuality/', '/')
  relative = relative.replace(/^Characters\/(general|adult)\//, 'Characters/')
  if (relative.startsWith('GachaCharaAnim/')) {
    if (relative.includes('/adult/')) rank++
    relative = relative.replace(/^GachaCharaAnim\/(general|adult)\//, 'GachaCharaAnim/GachaCharaAnim/')
  }
  if (relative.startsWith('Cutin/')) {
    if (relative.includes('/adult/')) rank++
    relative = relative.replace(/^Cutin\/Characters\/HighQuality\/(?:general|adult)\//, 'Cutin/')
  }
  const kind = relative.endsWith('.png') ? 'png' : /\.(skel\.bytes|atlas\.txt)$/.test(relative) ? 'raw' : relative.endsWith('.ogg') ? 'ogg' : ''
  if (!kind) return null
  return { target: relative, kind, category: { png: 'image', raw: 'spine', ogg: 'voice' }[kind], rank }
}

export function destinationDecision(asset) {
  if (typeof asset !== 'string' || !asset.startsWith('Assets/')) return { reason: 'skip-catalog-key' }
  if (asset.includes('/LowQuality/')) return { reason: 'skip-low-quality' }
  const mapped = mappedDestination(asset)
  if (mapped) return { mapped }
  if (/\.(?:asset|mat|prefab|shader|controller|anim|obj)$/i.test(asset)) return { reason: 'skip-unsupported-format' }
  return { reason: 'skip-unsupported-path-or-format' }
}
export const destination = (asset) => destinationDecision(asset).mapped || null

function textAsset(obj) {
  const buffer = obj.data
  const nameLength = buffer.readInt32LE(0)
  const start = (4 + nameLength + 3) & ~3
  const size = buffer.readInt32LE(start)
  if (nameLength < 0 || size < 0 || start + 4 + size > buffer.length) throw new Error('TextAsset 长度无效')
  return { name: buffer.toString('utf8', 4, 4 + nameLength), bytes: buffer.subarray(start + 4, start + 4 + size) }
}

export async function planTsk(request, progress = () => {}) {
  const source = request.source || {}, catalogs = []
  if (source.type === 'apk') {
    if (!source.path || !path.isAbsolute(source.path)) throw new Error('APK path 必须是本地绝对路径')
    for (const name of ['catalog.bundle', 'catalog_sound.bundle']) {
      progress(`读取 APK: ${name}`)
      // unzip already exists in the application image; never download APKs, tools or dependencies here.
      const { stdout } = await exec('unzip', ['-p', source.path, `assets/aa/${name}`], { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 })
      progress(`本地解压 / 解码: ${name} (${stdout.length} bytes)`)
      const found = openBundles([stdout]).objects.filter((o) => o.classId === 49).map((o) => JSON.parse(textAsset(o).bytes.toString('utf8'))).filter((c) => c?.m_EntryDataString)
      if (found.length !== 1) throw new Error(`${name}: 未找到唯一完整 catalog`)
      catalogs.push(...found)
      progress(`已读取: ${name}`)
    }
  } else if (source.type === 'catalog') {
    for (const filename of source.paths || [source.path]) {
      const value = JSON.parse(await readFile(filename, 'utf8'))
      catalogs.push(...(Array.isArray(value) ? value : [value]))
    }
  } else throw new Error('TSK source.type 必须是 apk 或 catalog；URL TSV 无法映射目标资源')
  const include = request.include || ['scenario', 'image', 'spine', 'voice']
  if (!Array.isArray(include) || include.some((v) => !['scenario', 'image', 'spine', 'voice'].includes(v))) throw new Error('include 不合法')
  const selected = new Map(), unresolved = [], auditRows = []
  for (const [catalogIndex, catalog] of catalogs.entries()) {
    progress('解析 Addressables 资源键和依赖')
    const entries = catalogEntries(catalog)
    function bundles(index, seen = new Set()) {
      if (seen.has(index)) return []
      seen.add(index)
      const entry = entries[index]
      if (!entry) throw new Error('Catalog 依赖索引越界')
      const own = /^https:\/\/.*\.bundle(?:\?.*)?$/.test(entry.internal) ? [entry.internal] : []
      return [...new Set([...own, ...entry.deps.flatMap((dep) => bundles(dep, seen))])]
    }
    entries.forEach((entry, index) => {
      const row = { catalog: catalogIndex, index, source: entry.key, category: typeof entry.key === 'string' && entry.key.startsWith('Assets/') ? classifyTskAsset(entry.key) : 'other', status: 'candidate' }
      auditRows.push(row)
      const decision = destinationDecision(entry.key), mapped = decision.mapped
      if (!mapped) { row.status = decision.reason; return }
      if (!include.includes(mapped.category)) { row.status = 'skip-include'; return }
      const urls = bundles(index)
      if (!urls.length) { unresolved.push(entry.key); row.status = 'skip-no-bundle'; return }
      const previous = selected.get(mapped.target)
      if (!previous || mapped.rank > previous.rank) {
        if (previous) previous.audit.status = 'skip-duplicate-target'
        selected.set(mapped.target, { ...mapped, source: entry.key, urls, audit: row })
        row.status = 'mapped'
      } else row.status = 'skip-duplicate-target'
    })
  }
  const catalogAudit = { totalEntries: auditRows.length, mappedAssets: selected.size, byCategory: Object.create(null), skipped: [] }
  for (const row of auditRows) {
    const counts = catalogAudit.byCategory[row.category] ||= Object.create(null)
    counts[row.status] = (counts[row.status] || 0) + 1
    if (row.status !== 'mapped') catalogAudit.skipped.push(row)
  }
  const accounted = Object.values(catalogAudit.byCategory).flatMap(Object.values).reduce((a,b) => a+b,0)
  if (accounted !== catalogAudit.totalEntries || auditRows.some(row => row.status === 'candidate')) throw new Error('Catalog 审计不完整，拒绝生成 plan')
  progress(`APK catalog 全量审计: ${catalogAudit.totalEntries} 条，候选目标 ${selected.size}，skip ${catalogAudit.skipped.length}；完整原因写入 catalog-audit.json`)

  const groups = new Map()
  for (const asset of selected.values()) {
    for (const url of asset.urls) if (!groups.has(url)) groups.set(url, { url, bundle: true, assets: [], dependencies: [] })
    const owner = groups.get(asset.urls[0])
    owner.assets.push({ source: asset.source, target: asset.target, kind: asset.kind, category: classifyTskAsset(asset.source), dependencies: asset.urls.slice(1) })
    owner.dependencies = [...new Set([...owner.dependencies, ...asset.urls.slice(1)])]
  }
  return { entries: [...groups.values()], unresolved, catalogAudit, warnings: ['活动 banner_id 映射保留现有数据，不从网络补取。', `${unresolved.length} 个资源无远端 bundle；详见 unresolved。`] }
}

// Unity LDR ASTC enums form one family; dispatch every square block size.
const ASTC_BLOCKS = Object.freeze({ 48: 4, 49: 5, 50: 6, 51: 8, 52: 10, 53: 12 })
export function texturePixels(texture, resources) {
  const w = texture.m_Width, h = texture.m_Height, format = texture.m_TextureFormat
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > 64 * 1024 * 1024) throw new Error('纹理尺寸无效')
  const stream = texture.m_StreamData
  const raw = texture['image data']?.length ? texture['image data'] : resourceBytes(resources, stream.path, stream.offset, stream.size)
  if (format === 47 || Object.hasOwn(ASTC_BLOCKS, format)) {
    const block = format === 47 ? 4 : ASTC_BLOCKS[format]
    const size = Math.ceil(w / block) * Math.ceil(h / block) * 16
    if (raw.length < size) throw new Error('压缩纹理数据截断')
    const decoded = format !== 47 ? decodeASTC(raw.subarray(0, size), w, h, block, block) : decodeETC2RGBA8(raw.subarray(0, size), w, h)
    const pixels = Buffer.alloc(w * h * 4), stride = w * 4
    for (let y = 0; y < h; y++) pixels.set(decoded.subarray((h - 1 - y) * stride, (h - y) * stride), y * stride)
    return { w, h, pixels }
  }
  const bpp = { 1: 1, 3: 3, 4: 4, 5: 4, 14: 4 }[format]
  if (!bpp) throw new Error(`尚未实现纹理格式 ${format} 的 Node 解码；保留缓存，不下载解码器`)
  if (raw.length < w * h * bpp) throw new Error('纹理数据截断')
  const pixels = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((h - 1 - y) * w + x) * bpp, d = (y * w + x) * 4
    if (format === 1) { pixels[d] = pixels[d + 1] = pixels[d + 2] = 255; pixels[d + 3] = raw[s] }
    else if (format === 5) { pixels[d] = raw[s + 1]; pixels[d + 1] = raw[s + 2]; pixels[d + 2] = raw[s + 3]; pixels[d + 3] = raw[s] }
    else if (format === 14) { pixels[d] = raw[s + 2]; pixels[d + 1] = raw[s + 1]; pixels[d + 2] = raw[s]; pixels[d + 3] = raw[s + 3] }
    else { pixels[d] = raw[s]; pixels[d + 1] = raw[s + 1]; pixels[d + 2] = raw[s + 2]; pixels[d + 3] = format === 4 ? raw[s + 3] : 255 }
  }
  return { w, h, pixels }
}

let audioEncoder
async function ogg(bytes) {
  if (bytes.subarray(0, 4).toString() === 'FSB5') bytes = unpackFsb5(bytes).bytes
  if (bytes.subarray(0, 4).toString() === 'OggS') return Promise.resolve(bytes)
  // Use only codecs already installed in the host. Both encoders produce Ogg
  // playable by the web player; Vorbis remuxing above never re-encodes audio.
  audioEncoder ||= exec('ffmpeg', ['-hide_banner', '-encoders']).then(({ stdout }) => {
    if (/\blibvorbis\b/.test(stdout)) return 'libvorbis'
    if (/\blibopus\b/.test(stdout)) return 'libopus'
    throw new Error('现有 ffmpeg 缺少 libvorbis/libopus 编码器；保留缓存，不安装工具')
  })
  const encoder = await audioEncoder
  // Existing ffmpeg is the only external executable used for audio. Missing/unsupported = explicit failure.
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-v', 'error', '-protocol_whitelist', 'pipe', '-i', 'pipe:0', '-f', 'ogg', '-c:a', encoder, 'pipe:1'], { stdio: ['pipe', 'pipe', 'pipe'] })
    const parts = []; let error = '', size = 0
    child.on('error', reject)
    child.stdin.on('error', () => {})
    child.stdout.on('data', (data) => { size += data.length; if (size > 256 * 1024 * 1024) child.kill(); else parts.push(data) })
    child.stderr.on('data', (data) => { error = (error + data).slice(-4096) })
    child.on('close', (code) => code === 0 ? resolve(Buffer.concat(parts)) : reject(new Error(`现有 ffmpeg 无法转换音频: ${error}`)))
    child.stdin.end(bytes)
  })
}

export async function extractTsk(request) {
  const { objects, resources } = openBundles(await Promise.all([request.bundle, ...(request.dependencies || [])].map((f) => readFile(f))))
  const decoded = new Map()
  const decode = (o) => { if (!decoded.has(o)) decoded.set(o, o.decode()); return decoded.get(o) }
  const names = (o) => o.classId === 49 ? textAsset(o).name : decode(o).m_Name
  const containers = new Map()
  for (const bundle of objects.filter((o) => o.classId === 142)) for (const entry of decode(bundle).m_Container || []) {
    const key = entry.first.toLowerCase()
    containers.set(key, [...(containers.get(key) || []), String(entry.second.asset.m_PathID)])
  }
  const exports = []
  for (const asset of request.assets) {
    let data
    const stem = path.posix.basename(asset.source).replace(/\.chapter\.asset$/, '')
    if (asset.kind === 'master' || asset.kind === 'book') {
      const field = asset.kind === 'master' ? 'settingList' : 'importGridList'
      const mono = objects.filter((o) => o.classId === 114)
      const ids = containers.get(asset.source.toLowerCase()) || []
      const chapters = mono.filter(o => ids.includes(o.pathId))
      let values
      if (chapters.length) {
        if (chapters.length !== 1) throw new Error(`剧情入口不唯一: ${asset.source}`)
        const chapter = decode(chapters[0])
        if (asset.kind === 'book' && Array.isArray(chapter.dataList)) {
          // Catalog chapter aliases need not share the referenced book's name.
          values = chapter.dataList.flatMap(pointer => {
            if (pointer.m_FileID !== 0) throw new Error(`剧情外部文件引用尚未支持: ${asset.source}`)
            const matches = mono.filter(o => o.pathId === String(pointer.m_PathID))
            if (matches.length !== 1) throw new Error(`剧情引用缺失或不唯一: ${asset.source}`)
            const value = decode(matches[0])
            if (!value[field]) throw new Error(`剧情引用不是 Utage book: ${asset.source}`)
            return [value]
          })
        } else values = chapter[field] ? [chapter] : []
      } else {
        const candidates = mono.map(decode).filter(v => v[field])
        const expected = new Set([stem, path.posix.basename(asset.target).replace(/\.(?:book|chapter)\.json$/, '')])
        if (/^Assets\/Adventure\/ImportChara\/\d+\.chapter\.asset$/.test(asset.source)) expected.add(`CharaScenario${stem}`)
        const exact = candidates.filter(v => expected.has((v.m_Name || '').replace(/\.(book|chapter)$/, '')))
        values = exact.length ? exact : candidates
      }
      if (values.length !== 1) throw new Error(`剧情对象缺失或不唯一: ${asset.source}`)
      data = Buffer.from(JSON.stringify(values[0]))
    } else {
      const types = { png: [28, 213], raw: [49], ogg: [83] }[asset.kind]
      if (!types) throw new Error(`不支持导出类型 ${asset.kind}`)
      const ids = containers.get(asset.source.toLowerCase()) || []
      let candidates = objects.filter((o) => ids.includes(o.pathId) && types.includes(o.classId))
      if (!candidates.length) {
        const namesToMatch = new Set(); let name = path.posix.basename(asset.source)
        while (true) { namesToMatch.add(name); if (!name.includes('.')) break; name = name.slice(0, name.lastIndexOf('.')) }
        candidates = objects.filter((o) => types.includes(o.classId) && namesToMatch.has(names(o)))
      }
      // The PNG container can expose both its full texture and a trimmed Sprite subasset.
      // Prefer the Texture2D to preserve atlas page coordinates and original PNG size.
      if (asset.kind === 'png' && candidates.some(o => o.classId === 28)) candidates = candidates.filter(o => o.classId === 28)
      else if (asset.kind === 'png' && candidates.some(o => o.classId === 213)) candidates = candidates.filter(o => o.classId === 213)
      if (candidates.length !== 1) throw new Error(`资源对象缺失或不唯一: ${asset.source}`)
      const obj = candidates[0]
      if (asset.kind === 'raw') data = textAsset(obj).bytes
      else if (asset.kind === 'png') {
        let texture = decode(obj), rect
        if (obj.classId === 213) {
          const sprite = texture
          const pointer = sprite.m_RD?.texture
          if (!pointer || !pointer.m_PathID) throw new Error('SpriteAtlas 外部图集尚未支持，保留 bundle 缓存')
          const matches = objects.filter((o) => o.classId === 28 && o.pathId === String(pointer.m_PathID))
          if (matches.length !== 1) throw new Error('Sprite 纹理引用无法唯一解析')
          texture = decode(matches[0]); rect = sprite.m_RD.textureRect || sprite.m_Rect
          if (sprite.m_RD.settingsRaw & 0x1) throw new Error('压紧/旋转 Sprite 尚未支持，保留 bundle 缓存')
        }
        let { w, h, pixels } = texturePixels(texture, resources)
        if (rect) {
          const x = Math.round(rect.x), y = Math.round(rect.y), width = Math.round(rect.width), height = Math.round(rect.height)
          if (x < 0 || y < 0 || width < 1 || height < 1 || x + width > w || y + height > h) throw new Error('Sprite 裁剪范围无效')
          const crop = Buffer.alloc(width * height * 4)
          for (let row = 0; row < height; row++) pixels.copy(crop, row * width * 4, ((h - y - height + row) * w + x) * 4, ((h - y - height + row) * w + x + width) * 4)
          pixels = crop; w = width; h = height
        }
        data = encodePng(w, h, pixels, 4)
      } else {
        const clip = decode(obj), resource = clip.m_Resource
        const bytes = clip.m_AudioData?.length ? clip.m_AudioData : resourceBytes(resources, resource.m_Source, resource.m_Offset, resource.m_Size)
        data = await ogg(bytes)
      }
    }
    if (!data.length) throw new Error(`导出结果为空: ${asset.target}`)
    exports.push({ target: asset.target, data })
  }
  return { exports }
}
