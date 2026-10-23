#!/usr/bin/env node
// 标签倒排索引自测（纯 Node，不起服务）：随机条目 + 随机查询，倒排索引的结果必须和线性扫描（参考实现）逐位置一致。
//   node scripts/dev/tag-search-selftest.mjs
import { normalizeTagName } from '../../web/library/tag-store.mjs'
import { INDEX_POS, TagIndex, linearTagMatch, parseTagQuery } from '../../web/library/tag-search.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const norm = normalizeTagName
const CACHE = Symbol('norm')

// 可复现的伪随机
let seed = 12345
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
const pick = (list) => list[Math.floor(rnd() * list.length)]

// ---- 查询解析 ----
check('解析：普通 / 排除 / 前缀 / tag: / unitTag: / 引号 / 大小写与多余空格规整', J(parseTagQuery('  作者:A  -语言:中文 系列:* tag:原作:X unitTag:"集 数:2" -unitTag:S* ', norm)) === J([
  { exclude: false, unitOnly: false, prefix: false, name: '作者:a' },
  { exclude: true, unitOnly: false, prefix: false, name: '语言:中文' },
  { exclude: false, unitOnly: false, prefix: true, name: '系列:' },
  { exclude: false, unitOnly: false, prefix: false, name: '原作:x' },
  { exclude: false, unitOnly: true, prefix: false, name: '集 数:2' },
  { exclude: true, unitOnly: true, prefix: true, name: 's' },
]), J(parseTagQuery('  作者:A  -语言:中文 系列:* tag:原作:X unitTag:"集 数:2" -unitTag:S* ', norm)))
check('解析：空查询 / 只有空白 → 没有 token', parseTagQuery('', norm).length === 0 && parseTagQuery('   ', norm).length === 0)

// ---- 造数据：标签有大小写 / 空格差异、重复、一部分条目有单元标签 ----
const AUTHORS = Array.from({ length: 40 }, (_, i) => `作者:作者${i}`)
const CIRCLES = Array.from({ length: 25 }, (_, i) => `社团:社团${i}`)
const COMMON = ['语言:中文', '语言: 日语', '标签:汉化', '类型:同人志', '评级:R18', '字幕v1: 有', '字幕v1: 无']
const SERIES = Array.from({ length: 30 }, (_, i) => `系列: S${i}`)
const UNITS = ['集数:1', '集数:2', '音声:有', '字幕:有', '字幕:无']
const items = []
for (let i = 0; i < 3000; i++) {
  const tags = [pick(AUTHORS), pick(CIRCLES), pick(COMMON), pick(COMMON), pick(SERIES)]
  if (rnd() < 0.2) tags.push(tags[0].toUpperCase())      // 大小写不同的重复
  if (rnd() < 0.1) tags.push(tags[1])                    // 完全重复
  if (rnd() < 0.5) tags.push(`页数:${Math.floor(rnd() * 20)}`)
  const unitTags = rnd() < 0.4 ? [pick(UNITS), pick(UNITS)] : []
  items.push({ itemId: `i${i}`, tags, unitTags })
}
items.push({ itemId: 'empty', tags: [], unitTags: [] })
const index = await TagIndex.build(items, norm, { chunk: 500, yieldFn: (fn) => setImmediate(fn) })
check('建索引：条目带上位置；索引覆盖全部条目', index.size === items.length && items.every((item, i) => item[INDEX_POS] === i))

const linear = (tokens) => { const out = []; items.forEach((item, i) => { if (linearTagMatch(item, tokens, norm, CACHE)) out.push(i) }); return out }
const viaIndex = (tokens) => [...index.match(tokens)]

// ---- 固定用例 ----
const fixed = [
  '作者:作者3', '作者:作者3 社团:社团5', '作者:作者3 -语言:中文', '-语言:中文', '系列:*', '-系列:*', '作者:*', 'unitTag:集数:1', '-unitTag:集数:1',
  'unitTag:集数:* 语言:中文', '作者:作者1* 社团:社团2*', '不存在的标签', '作者:作者3 不存在的标签', '-不存在的标签', '字幕v1:有', '字幕v1: 有 -unitTag:字幕:无',
  '语言:中文 语言:日语', 'TAG:作者:作者7', '"作者:作者7"', 'tag:"社团:社团1"', '集数:1',
]
for (const query of fixed) {
  const tokens = parseTagQuery(query, norm)
  const a = linear(tokens)
  const b = viaIndex(tokens)
  check(`固定用例「${query}」：${a.length} 条，倒排 = 线性扫描`, J(a) === J(b), `${a.length} vs ${b.length}`)
}

// ---- 随机查询：几千条，覆盖各种 token 组合 ----
const vocab = [...AUTHORS, ...CIRCLES, ...COMMON, ...SERIES, ...UNITS, '作者:作者1', '系列:', '作者:作者', '集数:', '不存在:x']
let mismatches = 0
let nonEmpty = 0
let first = ''
for (let n = 0; n < 4000; n++) {
  const parts = []
  const count = 1 + Math.floor(rnd() * 4)
  for (let t = 0; t < count; t++) {
    let value = pick(vocab).replace(/\s/g, rnd() < 0.5 ? ' ' : '')
    if (rnd() < 0.3) value = `${value.slice(0, Math.max(2, Math.floor(rnd() * value.length)))}*`
    if (value.includes(' ')) value = `"${value}"`
    if (rnd() < 0.2) value = `unitTag:${value}`
    if (rnd() < 0.3) value = `-${value}`
    parts.push(value)
  }
  const query = parts.join(' ')
  const tokens = parseTagQuery(query, norm)
  const a = linear(tokens)
  const b = viaIndex(tokens)
  if (a.length) nonEmpty++
  if (J(a) !== J(b)) { mismatches++; if (!first) first = `${query}: ${a.length} vs ${b.length}` }
}
check(`随机 4000 个查询（${nonEmpty} 个有命中）：倒排和线性扫描逐位置完全一致`, mismatches === 0, `${mismatches} 个不一致，例：${first}`)

// ---- 结果性质 ----
const m = index.match(parseTagQuery('作者:作者3', norm))
check('结果是升序、没有重复的位置', m.every((v, i) => i === 0 || m[i - 1] < v) && m.length > 0)
const dupIndex = await TagIndex.build([{ tags: ['a', 'A', 'a'], unitTags: [] }, { tags: ['b'], unitTags: ['a', 'a'] }], norm)
check('一个条目里同一个标签重复（含大小写不同）：只记一次；条目标签和单元标签里都有也只算一个条目', dupIndex.itemMap.get('a').length === 1 && dupIndex.match(parseTagQuery('a', norm)).length === 2 && J([...dupIndex.match(parseTagQuery('a', norm))]) === '[0,1]')
check('建索引过程中条目数组被换掉（isStale）：返回 null', (await TagIndex.build(items, norm, { chunk: 100, isStale: () => true })) === null)
let calls = 0
check('建索引按批让出事件循环（每批 chunk 个条目）', await (async () => { await TagIndex.build(items, norm, { chunk: 1000, yieldFn: (fn) => { calls++; setImmediate(fn) } }); return calls === Math.ceil(items.length / 1000) - 1 })(), `让出 ${calls} 次`)

// ---- 性能（粗略）：同一批数据放大后，索引查询应该比线性扫描快得多 ----
const big = []
for (let i = 0; i < 200000; i++) big.push({ tags: [`作者:作者${i % 5000}`, `社团:社团${i % 3000}`, '语言:中文', `页数:${i % 50}`, `系列:S${i % 20000}`], unitTags: [] })
const bigIndex = await TagIndex.build(big, norm)
const tokens = parseTagQuery('作者:作者7 语言:中文', norm)
let t0 = performance.now()
const viaBig = bigIndex.match(tokens)
const indexMs = performance.now() - t0
t0 = performance.now()
let linearCount = 0
for (const item of big) if (linearTagMatch(item, tokens, norm, CACHE)) linearCount++
const linearMs = performance.now() - t0
console.log(`   20 万条：倒排 ${indexMs.toFixed(2)}ms，线性扫描（第一次含规整）${linearMs.toFixed(0)}ms`)
check('20 万条：倒排结果和线性扫描一致，并且快 10 倍以上', viaBig.length === linearCount && indexMs * 10 < linearMs, `${indexMs}ms vs ${linearMs}ms`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
