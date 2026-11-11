import { mkdir, rename, lstat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const exec = promisify(execFile)
const missing = async (source) => {
  try { await lstat(source); return false } catch (error) {
    if (error.code === 'ENOENT') return true
    throw error
  }
}

// Keep failed partial files, released locks and test fixtures for inspection. Never delete them.
export async function archiveToTmp(source) {
  return archiveToDirectory(source, '/tmp/gal-download-archive')
}

export async function archiveToDirectory(source, directory) {
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, `${Date.now()}-${randomUUID()}-${path.basename(source)}`)
  try { await rename(source, target) } catch (error) {
    if (error.code === 'ENOENT') return null
    if (error.code !== 'EXDEV') throw error
    // Across mounts, rename can report EXDEV even if a successful download has
    // already renamed its .part file. There is then nothing left to archive.
    if (await missing(source)) return null
    try { await exec('mv', [path.resolve(source), target]) } catch (moveError) {
      if (await missing(source)) return null
      throw moveError
    }
  }
  return target
}
