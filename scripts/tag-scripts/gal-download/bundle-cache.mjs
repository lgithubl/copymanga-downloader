import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { archiveToDirectory } from './archive.mjs'

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const exists = async file => { try { await stat(file); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e } }
async function save(file, record) {
  const temp = `${file}.${randomUUID()}.part`
  await writeFile(temp, JSON.stringify(record, null, 2))
  await rename(temp, file)
}

// URL identifies a cache slot, not an immutable CDN version. Local checksums
// detect damage; validators and sourceStamp detect versions changing in place.
export async function downloadBundle(entry, cache, signal, timeout, pacing, options = {}) {
  const { sourceStamp = '', log = () => {}, stats = {}, claimDownload = () => true } = options
  const backupDir = options.backupDir || path.join(path.dirname(cache), 'bundle-backups')
  const file = path.join(cache, sha(entry.url)), metadata = file + '.json'
  const count = key => { stats[key] = (stats[key] || 0) + 1 }
  let record
  try {
    const candidate = JSON.parse(await readFile(metadata, 'utf8')), bytes = await readFile(file)
    if (candidate.url === entry.url && candidate.sha256 === sha(bytes) && (!entry.bundle || bytes.subarray(0, 7).toString() === 'UnityFS') && (!entry.sha256 || entry.sha256 === candidate.sha256) && (!entry.size || entry.size === bytes.length)) record = candidate
  } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code) && !(error instanceof SyntaxError)) throw error }
  const needsValidation = !!record && record.sourceStamp !== sourceStamp
  if (record && !entry.refresh && (entry.cachedOnly || !needsValidation)) return { file, status: 'cached', needsValidation }
  if (entry.cachedOnly) throw Error('缓存不存在或校验失败')
  if (!/^https?:\/\//.test(entry.url)) throw Error('下载 URL 必须是 HTTP(S)')
  await mkdir(cache, { recursive: true })
  const part = `${file}.${randomUUID()}.part`
  const headers = {}
  if (record && !entry.refresh) {
    if (record.etag) headers['If-None-Match'] = record.etag
    else if (record.lastModified) headers['If-Modified-Since'] = record.lastModified
  }
  if (needsValidation && !entry.refresh) { log(`cache-validate: ${entry.url}；APK/catalog版本变化或旧缓存无版本信息`) }
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const { requestSignal, pending } = await pacing.start(entry.url, timeout, { headers, cache: 'no-store' })
        const response = await pending
        if (response.status === 304 && record && Object.keys(headers).length) {
          await response.body?.cancel()
          await save(metadata, { ...record, sourceStamp, checkedAt: new Date().toISOString() })
          count('validated'); count('unchanged'); log(`cache-unchanged: ${entry.url}；CDN 304，继续使用本地缓存`)
          return { file, status: 'cached', cacheEvent: 'unchanged' }
        }
        if (!response.ok) { await response.body?.cancel(); throw Error(`HTTP ${response.status}`) }
        if (!claimDownload(entry.url)) {
          await response.body?.cancel(); count('limited')
          throw Object.assign(Error('缓存需要下载新版，本次 downloadLimit 已用尽；旧缓存保留，下次重试'), { code: 'DOWNLOAD_LIMIT' })
        }
        await pipeline(response.body, createWriteStream(part), { signal: requestSignal })
        const bytes = await readFile(part), digest = sha(bytes)
        if (!bytes.length || (entry.size && bytes.length !== entry.size)) throw Error('下载长度不符')
        if (entry.sha256 && digest !== entry.sha256) throw Error('SHA-256 不符')
        if (entry.bundle && bytes.subarray(0, 7).toString() !== 'UnityFS') throw Error('下载结果不是 UnityFS bundle')
        const next = { url: entry.url, sha256: digest, size: bytes.length, sourceStamp, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), checkedAt: new Date().toISOString() }
        const changed = !!record && digest !== record.sha256
        let backup, metadataBackup
        if (!record || changed) {
          // Validate the replacement completely before moving the old slot.
          try {
            if (await exists(file)) backup = await archiveToDirectory(file, backupDir)
            if (await exists(metadata)) metadataBackup = await archiveToDirectory(metadata, backupDir)
            await rename(part, file)
            await save(metadata, next)
          } catch (error) {
            // Restore the previous pair even if publication fails midway.
            if (backup) { await archiveToDirectory(file, path.join(backupDir, 'failed-publish')); await rename(backup, file) }
            if (metadataBackup) { await archiveToDirectory(metadata, path.join(backupDir, 'failed-publish')); await rename(metadataBackup, metadata) }
            throw error
          }
        } else await save(metadata, next)
        const cacheEvent = record ? changed ? 'refreshed' : 'unchanged' : 'downloaded'
        if (needsValidation && !entry.refresh) count('validated')
        if (record) count(cacheEvent)
        log(`cache-${cacheEvent}: ${entry.url}${backup ? `；旧缓存: ${backup}；元信息: ${metadataBackup}` : ''}`)
        return { file, status: 'downloaded', cacheEvent, backup, metadataBackup }
      } catch (error) {
        if (error.code === 'DOWNLOAD_LIMIT' || attempt >= 2 || signal.aborted) throw error
        await pacing.retry(entry.url, attempt + 2, error)
      }
    }
  } finally { await archiveToDirectory(part, path.join(backupDir, 'partials')) }
}
