// Artemis（pf8 档案 + .ast Lua 表脚本）的合成样本：只有测试用的编码器，没有任何游戏内容。
//   buildPf8(entries)   [{ name, data }] → pf8 档案（索引块 = 条目数 + 记录；key = SHA1(索引块)；数据逐字节 XOR key[i % 20]）
//   astOf(blocks, …)    把简化的 block 描述写成 .ast 文本
import { createHash } from 'node:crypto'

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

export function buildPf8(entries, { encrypt = true } = {}) {
  const names = entries.map((e) => Buffer.from(e.name.replace(/\//g, '\\'), 'utf8'))
  const bodySize = 4 + names.reduce((n, nm) => n + 4 + nm.length + 12, 0)
  let offset = 7 + bodySize
  const parts = [u32(entries.length)]
  const datas = []
  const placed = entries.map((e, i) => { const at = offset; offset += e.data.length; return at })
  entries.forEach((e, i) => { parts.push(u32(names[i].length), names[i], u32(0), u32(placed[i]), u32(e.data.length)) })
  const body = Buffer.concat(parts)
  const key = createHash('sha1').update(body).digest()
  entries.forEach((e) => datas.push(encrypt ? Buffer.from(e.data.map((c, i) => c ^ key[i % 20])) : e.data))
  return Buffer.concat([Buffer.from('pf8', 'latin1'), u32(body.length), body, ...datas])
}

const lua = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v))
// cmd：['bg', { file: 'bg01', path: ':bg/' }] → {"bg",file="bg01",path=":bg/"}
export const cmdOf = (name, params = {}) => `{${JSON.stringify(name)}${Object.entries(params).map(([k, v]) => `,${k}=${lua(v)}`).join('')}}`
// block：{ cmds: [[name, params]…], text: { name?: [..], lines: [..], vo?: { file, ch } }, select: [文字…], next? }
export function astOf(blocks, { top = 'block_00000' } = {}) {
  const out = ['astver = 2.0', 'astname = "ast"', 'ast = {']
  blocks.forEach((b, i) => {
    const id = `block_${String(i).padStart(5, '0')}`
    out.push(`${id}={`)
    for (const [name, params] of b.cmds || []) out.push(`${cmdOf(name, params)},`)
    if (b.text || b.select) out.push('{"text"},')
    if (b.text) {
      out.push('text={')
      if (b.text.vo) out.push(`vo={\n${cmdOf('vo', b.text.vo)},\n},`)
      out.push('ja={\n{')
      if (b.text.name) out.push(`name={${b.text.name.map((n) => JSON.stringify(n)).join(',')}},`)
      for (const line of b.text.lines) out.push(`${JSON.stringify(line)},\n{"rt2"},`)
      out.push('},\n},\n},')
    }
    if (b.select) out.push(`select={\nja={\n${b.select.map((t) => JSON.stringify(t)).join(',\n')},\n},\n},`)
    if (i > 0) out.push(`linkback="block_${String(i - 1).padStart(5, '0')}",`)
    if (i + 1 < blocks.length) out.push(`linknext="block_${String(i + 1).padStart(5, '0')}",`)
    out.push('},')
  })
  out.push(`label = {\ntop={block="${top}",label=1},\n},\n}`)
  return out.join('\n')
}
