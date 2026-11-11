// RPG Maker MV/MZ encrypted images/audio. No game JavaScript is executed.
import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat, realpath, mkdir, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'

export function decryptRpgMaker(bytes, key) {
  const data = Buffer.from(bytes)
  const header = Buffer.from('5250474d560000000003010000000000', 'hex')
  if (data.length < 32 || !data.subarray(0, 16).equals(header)) throw new Error('RPG Maker 加密文件头无效')
  if (!/^[\da-f]{32}$/i.test(String(key))) throw new Error('RPG Maker System.json 缺少有效密钥')
  const out = Buffer.from(data.subarray(16)), mask = Buffer.from(key, 'hex')
  for (let i = 0; i < 16; i++) out[i] ^= mask[i]
  const png = out.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (!png && out.subarray(0, 4).toString() !== 'OggS' && out.subarray(4, 8).toString() !== 'ftyp') throw new Error('RPG Maker 解密后媒体签名无效')
  return out
}

const encrypted = /\.(?:rpgmvp|rpgmvo|rpgmvm|png_|ogg_|m4a_)$/i
export const isRpgMakerEncryptedFile = file => encrypted.test(String(file))
export function createRpgMakerResourceCache(directory) {
  const inflight = new Map()
  return async function materialize(file, mediaDir, options) {
    if (!options || !encrypted.test(file)) return file
    const root = await realpath(path.resolve(mediaDir, options.root || '.'))
    const media = await realpath(mediaDir)
    if (root !== media && !root.startsWith(media + path.sep)) throw new Error('RPG Maker 游戏目录越界')
    const source = await realpath(file)
    if (!source.startsWith(root + path.sep)) throw new Error('RPG Maker 资源越界')
    const system = await realpath(path.join(root, 'data/System.json'))
    if (!system.startsWith(root + path.sep)) throw new Error('RPG Maker System.json 越界')
    const [info, systemBytes] = await Promise.all([stat(source), readFile(system)])
    if (info.size > 128 * 1024 * 1024) throw new Error('RPG Maker 单个媒体超过128MB上限')
    const hash = createHash('sha256').update(`${source}:${info.size}:${info.mtimeMs}:`).update(systemBytes).digest('hex')
    const ext = /\.(?:rpgmvp|png_)$/i.test(source) ? '.png' : /\.(?:rpgmvm|m4a_)$/i.test(source) ? '.m4a' : '.ogg'
    const target = path.join(directory, hash.slice(0, 2), hash + ext)
    if ((await stat(target).catch(() => null))?.size) return target
    if (!inflight.has(target)) inflight.set(target, (async () => {
      const key = JSON.parse(systemBytes.toString('utf8').replace(/^\uFEFF/, '')).encryptionKey
      const bytes = decryptRpgMaker(await readFile(source), key)
      await mkdir(path.dirname(target), { recursive: true })
      const temp = `${target}.${randomUUID()}.part`
      await writeFile(temp, bytes); await rename(temp, target)
      return target
    })().finally(() => inflight.delete(target)))
    return inflight.get(target)
  }
}
