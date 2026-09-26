import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const fileTails = new Map()

export function withFileLock(filePath, work) {
  const key = path.resolve(filePath)
  const previous = fileTails.get(key) || Promise.resolve()
  const next = previous.catch(() => {}).then(work)
  const stored = next.catch(() => {})
  fileTails.set(key, stored)
  stored.finally(() => {
    if (fileTails.get(key) === stored) fileTails.delete(key)
  }).catch(() => {})
  return next
}

export async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  )
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`)
    await rename(tempPath, filePath)
  } catch (error) {
    try {
      await rename(tempPath, `${tempPath}.failed`)
    } catch {
      // Best effort: keep the original error and avoid touching the target file.
    }
    throw error
  }
}
