// Unity「GameMaterial」系（Calcite『気になるあの娘はえろちゅーばー！』）：data.dsm（加密的 KAG 风格脚本）/ .psm（第一个字节被改的 PNG）。
// 密码学（对照 Assembly-CSharp.dll 的 IL，用真实 data.dsm / env.cof 解出过）：.NET Rijndael（= AES-256-CBC，PKCS7）；密码 'pass'；盐 UTF-8「saltは必ず8バイト以上」；
//   PBKDF2-HMAC-SHA1 1000 轮取 48 字节（前 32 = key，后 16 = IV）；输入是 base64 文本（可能带 UTF-8 BOM）。
import { createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto'

export const DSM_PASSWORD = 'pass'
const SALT = Buffer.from('saltは必ず8バイト以上', 'utf8')
export const DSM_MAX_BYTES = 64 * 1024 * 1024   // data.dsm 才 1 MB 左右；上限只是防坏文件

export function decryptDsm(input, password = DSM_PASSWORD) {
  const text = (Buffer.isBuffer(input) ? input.toString('utf8') : String(input)).replace(/^﻿/, '').trim()
  if (!text || !/^[A-Za-z0-9+/=\s]+$/.test(text)) throw new Error('不是 base64 文本（data.dsm 应该是加密后再 base64 的脚本）')
  const derived = pbkdf2Sync(Buffer.from(password, 'utf8'), SALT, 1000, 48, 'sha1')
  const cipher = Buffer.from(text, 'base64')
  if (cipher.length < 16 || cipher.length % 16) throw new Error('密文长度不是 16 的倍数')
  const decipher = createDecipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48))
  return Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8').replace(/^﻿/, '')
}
// 反向（测试夹具用）
export function encryptDsm(plain, password = DSM_PASSWORD) {
  const derived = pbkdf2Sync(Buffer.from(password, 'utf8'), SALT, 1000, 48, 'sha1')
  const cipher = createCipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48))
  return `﻿${Buffer.concat([cipher.update(Buffer.from(plain, 'utf8')), cipher.final()]).toString('base64')}`
}

// .psm = PNG，第一个字节 0x89 被改成 0xED（真实文件：ed 50 4e 47 0d 0a 1a 0a …）
export function psmToPng(buffer) {
  if (buffer.length < 8 || buffer.subarray(1, 8).toString('latin1') !== 'PNG\r\n\x1a\n') throw new Error('不是 .psm（第 2~7 字节不是 PNG 标记）')
  const out = Buffer.from(buffer)
  out[0] = 0x89
  return out
}
export const isPsm = (head) => head.length >= 8 && head.subarray(1, 8).toString('latin1') === 'PNG\r\n\x1a\n'

// 把整份脚本切成「章节」：边界标签（默认 *EpNNN / *chaN_ex / *chaN_end）各开一段，第一个边界之前的前言（*start）并进第一段。
// 每段开头加一行 `;//@dsm {"id","next","labels"}`：id = 这一段的脚本名，next = 顺着往下读的下一段，labels = 这段里引用、但在别的段里的标签 → 段名（跳转 / 选项用）。
export const DEFAULT_BOUNDARY = /^(?:Ep\d+|cha\d+_ex|cha\d+_end)$/i
export function splitDsm(text, { boundary = DEFAULT_BOUNDARY } = {}) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n')
  const marks = []   // { name, line }
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\*([^\s|]+)/.exec(lines[i])
    if (m && boundary.test(m[1])) marks.push({ name: m[1], line: i })
  }
  if (!marks.length) return [{ name: '00_all', text: `;//@dsm ${JSON.stringify({ id: '00_all', next: '', labels: {} })}\n${lines.join('\n')}` }]
  const chunks = marks.map((mark, n) => ({ id: `${String(n).padStart(2, '0')}_${mark.name}`, from: n === 0 ? 0 : mark.line, to: n + 1 < marks.length ? marks[n + 1].line : lines.length }))
  // 标签 → 段
  const owner = new Map()
  for (const chunk of chunks) for (let i = chunk.from; i < chunk.to; i += 1) { const m = /^\*([^\s|]+)/.exec(lines[i]); if (m) owner.set(m[1], chunk.id) }
  return chunks.map((chunk, n) => {
    const body = lines.slice(chunk.from, chunk.to)
    const labels = {}
    for (const line of body) {
      for (const m of line.matchAll(/\[(?:jump|link)\b[^\]]*?\btarget\s*=\s*["“]?\*?([^\s"”\]]+)/g)) {
        const target = m[1]
        const id = owner.get(target)
        if (id && id !== chunk.id) labels[target] = id
      }
    }
    // 这一段末尾要是 [end] / [s] / 无条件 [jump] 收尾，就不顺着读下一段（适配器自己判断；这里只给候选）
    const header = `;//@dsm ${JSON.stringify({ id: chunk.id, next: n + 1 < chunks.length ? chunks[n + 1].id : '', labels })}`
    return { name: chunk.id, text: `${header}\n${body.join('\n')}\n` }
  })
}
