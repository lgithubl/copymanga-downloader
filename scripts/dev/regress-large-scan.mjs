#!/usr/bin/env node
// 回归：scanLibraryItems 在单个 handler 返回超过 V8「展开成函数参数」上限（约 12 万）的条目数时不能崩。
// 曾经 `items.push(...await handler.scanItems())` 在 42 万条的库上抛 RangeError: Maximum call stack size exceeded，索引永远建不起来。
// 用法：node scripts/dev/regress-large-scan.mjs
import { registerLibraryHandler, scanLibraryItems } from '../../web/library/registry.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const big = Array.from({ length: 200000 }, (_, i) => ({ type: 'big', itemId: `b${i}`, createdAt: new Date(1700000000000 + i * 1000).toISOString() }))
registerLibraryHandler({ type: 'big', scanItems: async () => big })
registerLibraryHandler({ type: 'small', scanItems: async () => [{ type: 'small', itemId: 's1', createdAt: '2026-01-01T00:00:00.000Z' }] })

const items = await scanLibraryItems()
check('20 万 + 1 条：scanLibraryItems 不崩且全部返回', items.length === 200001, String(items.length))
check('排序仍生效（createdAt 倒序）', items[0].itemId === 's1' && items[1].itemId === 'b199999', `${items[0].itemId},${items[1].itemId}`)
check('按类型取不受影响', (await scanLibraryItems({ type: 'small' })).length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
