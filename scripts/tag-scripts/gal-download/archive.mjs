import { mkdir, rename } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const exec = promisify(execFile)

// Keep failed partial files, released locks and test fixtures for inspection. Never delete them.
export async function archiveToTmp(source) {
  const directory = '/tmp/gal-download-archive'
  await mkdir(directory, { recursive: true })
  const target = path.join(directory, `${Date.now()}-${randomUUID()}-${path.basename(source)}`)
  try { await rename(source, target) } catch (error) {
    if (error.code === 'ENOENT') return null
    if (error.code !== 'EXDEV') throw error
    await exec('mv', [path.resolve(source), target])
  }
  return target
}
