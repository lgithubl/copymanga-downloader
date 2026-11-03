// 自测用：getResource 现在返回 { file, contentType, cacheControl }（服务端流式发、带 Range），不再带 body。
// 这里包一层：有 file 的补上 body（读进内存），旧断言（res.body.equals(...)）照常写。
import { readFile } from 'node:fs/promises'
import { createGalHandler as create } from '../../web/library/types/gal.mjs'

export function createGalHandler(...args) {
  const handler = create(...args)
  const raw = handler.getResource
  handler.getResource = async (...rest) => {
    const res = await raw(...rest)
    return res?.file && res.body === undefined ? { ...res, body: await readFile(res.file) } : res
  }
  return handler
}
