import { readFileSync } from 'node:fs'
import { readUnityFS } from './unityfs.mjs'

// Unity format string offsets (also documented by AssetStudio CommonString.cs).
// Static format data, never a downloaded type database.
const COMMON = JSON.parse(readFileSync(new URL('./unity-strings.json', import.meta.url)))
const align = (p) => (p + 3) & ~3
const cstr = (buf, p) => { const end = buf.indexOf(0, p); if (end < 0) throw new Error('Unity 字符串未结束'); return { value: buf.toString('utf8', p, end), next: end + 1 } }

export function serializedObjects(buf) {
  const version = buf.readUInt32BE(8)
  if (version < 17 || version > 22) throw new Error(`不支持 SerializedFile v${version}`)
  let dataOffset = buf.readUInt32BE(12)
  let p = version >= 22 ? 48 : 20
  if (version >= 22) dataOffset = Number(buf.readBigUInt64BE(32))
  if (buf[16] !== 0) throw new Error('暂不支持大端 Unity 对象')
  p = cstr(buf, p).next
  p += 4
  const hasTree = !!buf[p++]
  const i32 = () => { const v = buf.readInt32LE(p); p += 4; return v }
  const count = i32()
  if (count < 0 || count > 10000) throw new Error('Unity 类型数量无效')
  const types = []
  for (let t = 0; t < count; t++) {
    const classId = i32()
    p += 3
    if (classId === 114) p += 16
    p += 16
    const nodes = []
    if (hasTree) {
      const nodeCount = i32(), stringSize = i32()
      const stride = version >= 19 ? 32 : 24
      if (nodeCount < 0 || nodeCount > 100000 || stringSize < 0) throw new Error('Unity type tree 无效')
      const stringStart = p + nodeCount * stride
      const stringAt = (offset) => {
        if (offset & 0x80000000) {
          const name = COMMON[offset & 0x7fffffff]
          if (name === undefined) throw new Error(`未知 Unity common string ${offset & 0x7fffffff}`)
          return name
        }
        if (offset >= stringSize) throw new Error('Unity string offset 越界')
        return cstr(buf, stringStart + offset).value
      }
      for (let i = 0; i < nodeCount; i++) {
        nodes.push({ level: buf[p + 2], type: stringAt(buf.readUInt32LE(p + 4)), name: stringAt(buf.readUInt32LE(p + 8)), size: buf.readInt32LE(p + 12), flags: buf.readUInt32LE(p + 20), children: [] })
        p += stride
      }
      p += stringSize
      if (version >= 21) { const n = i32(); p += n * 4 }
      const stack = []
      for (const node of nodes) {
        while (stack.length && stack.at(-1).level >= node.level) stack.pop()
        if (stack.length) stack.at(-1).children.push(node)
        stack.push(node)
      }
    }
    types.push({ classId, tree: nodes[0] })
  }
  const objectCount = i32()
  if (objectCount < 0 || objectCount > 1000000) throw new Error('Unity 对象数量无效')
  const out = []
  for (let i = 0; i < objectCount; i++) {
    p = align(p)
    const pathId = String(buf.readBigInt64LE(p)); p += 8
    const offset = version >= 22 ? Number(buf.readBigUInt64LE(p)) : buf.readUInt32LE(p); p += version >= 22 ? 8 : 4
    const size = buf.readUInt32LE(p); p += 4
    const type = types[i32()]
    if (!type || dataOffset + offset + size > buf.length) throw new Error('Unity 对象范围无效')
    const data = buf.subarray(dataOffset + offset, dataOffset + offset + size)
    out.push({ ...type, pathId, data, decode: () => decodeTree(data, type.tree) })
  }
  return out
}

export function decodeTree(data, tree) {
  if (!tree) throw new Error('该 bundle 未包含 type tree；禁止隐式下载类型数据库')
  let p = 0
  const read = (node) => {
    if (p > data.length) throw new Error('Unity 对象截断')
    let value
    const primitives = { bool: ['readUInt8', 1], char: ['readUInt8', 1], UInt8: ['readUInt8', 1], SInt8: ['readInt8', 1], short: ['readInt16LE', 2], SInt16: ['readInt16LE', 2], UInt16: ['readUInt16LE', 2], int: ['readInt32LE', 4], SInt32: ['readInt32LE', 4], UInt32: ['readUInt32LE', 4], 'unsigned int': ['readUInt32LE', 4], float: ['readFloatLE', 4], double: ['readDoubleLE', 8], SInt64: ['readBigInt64LE', 8], UInt64: ['readBigUInt64LE', 8], FileSize: ['readBigUInt64LE', 8] }
    if (node.type === 'string') {
      const length = data.readInt32LE(p); p += 4
      if (length < 0 || p + length > data.length) throw new Error('Unity string 长度无效')
      value = data.toString('utf8', p, p + length); p = align(p + length)
    } else if (node.type === 'TypelessData') {
      const length = data.readInt32LE(p); p += 4
      if (length < 0 || p + length > data.length) throw new Error('Unity bytes 长度无效')
      value = data.subarray(p, p + length); p = align(p + length)
    } else if (primitives[node.type]) {
      const [method, length] = primitives[node.type]
      value = data[method](p); p += length
      if (typeof value === 'bigint') value = Number.isSafeInteger(Number(value)) ? Number(value) : String(value)
    } else if (node.type === 'Array') {
      const length = data.readInt32LE(p); p += 4
      if (length < 0 || length > 100000000) throw new Error('Unity 数组长度无效')
      const item = node.children[1]
      if (!item) throw new Error('Unity 数组缺少元素类型')
      if (['UInt8', 'char'].includes(item.type)) {
        if (p + length > data.length) throw new Error('Unity 数组截断')
        value = data.subarray(p, p + length); p += length
      } else value = Array.from({ length }, () => read(item))
    } else if (node.children.length === 1 && node.children[0].type === 'Array') value = read(node.children[0])
    else if (node.children.length) {
      value = Object.create(null)
      for (const child of node.children) value[child.name] = read(child)
    } else if (node.size >= 0) { value = data.subarray(p, p + node.size); p += node.size }
    else throw new Error(`未知 Unity 字段类型: ${node.type}`)
    if (node.flags & 0x4000) p = align(p)
    return value
  }
  return read(tree)
}

export function openBundles(buffers) {
  const objects = [], resources = new Map()
  for (const buffer of buffers) for (const file of readUnityFS(buffer)) {
    if (/\.(resS|resource)$/i.test(file.name)) resources.set(file.name.toLowerCase(), file.data)
    else objects.push(...serializedObjects(file.data))
  }
  return { objects, resources }
}

export function resourceBytes(resources, name, offset, size) {
  const key = name.split('/').at(-1).toLowerCase()
  const buffer = resources.get(key)
  if (!buffer || !Number.isSafeInteger(Number(offset)) || Number(offset) + size > buffer.length) throw new Error(`资源流缺失/越界: ${name}`)
  return buffer.subarray(Number(offset), Number(offset) + size)
}
