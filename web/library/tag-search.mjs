// 媒体库索引里的标签搜索：查询解析 + 倒排索引。纯函数 / 纯数据，不碰服务状态，Node 里直接单测（scripts/dev/tag-search-selftest.mjs）。
//
// 查询语法（和以前完全一样）：空格分隔的 token；`-xxx` 排除；`tag:xxx` / `unitTag:xxx`（unitTag = 只看单元标签）；带空格的值用 "引号"；
// 结尾的 * 表示前缀匹配；没写 tag: 的 token 也按标签名匹配。多个 token 之间是 AND。
//
// 为什么要倒排索引：以前每次搜索都线性扫整库（30 万条、每条几个到几十个标签，一次几十毫秒；前缀 / 排除更慢），
// 同时有很多个搜索页时这些同步 CPU 全挤在 Node 的单线程上。倒排索引 = 标签 → 含它的条目位置（升序的 Int32Array），
// 一次搜索的代价只和命中数有关（单个标签几乎是 O(1)）。
// 位置 = 条目在「索引总数组」里的下标（和排序无关；排序靠另外的 rank 数组，见 server.mjs）。

export const INDEX_POS = Symbol('libraryIndexPos')

// ---------- 查询解析 ----------
export function parseTagQuery(query = '', normalize) {
  const input = String(query || '').trim()
  if (!input) return []
  return [...input.matchAll(/-?(?:tag|unitTag):"[^"]+"|-?(?:tag|unitTag):\S+|-\S+|\S+/gi)]
    .map((match) => match[0])
    .map((raw) => {
      const exclude = raw.startsWith('-')
      let body = exclude ? raw.slice(1) : raw
      const unitOnly = /^unitTag:/i.test(body)
      body = body.replace(/^(?:tag|unitTag):/i, '').replace(/^"|"$/g, '')
      const name = normalize(body)
      // 结尾的 * 表示按前缀匹配。没有它就没法问「有没有任何系列」——
      // 精确匹配下 -系列 排除的是「字面就叫『系列』的 tag」，而实际 tag 是
      // 「系列: RJxxxx」，于是一条都排不掉，等于没过滤。
      const prefix = name.endsWith('*')
      return { exclude, unitOnly, prefix, name: prefix ? name.slice(0, -1).trim() : name }
    })
    .filter((item) => item.name)
}

// ---------- 线性扫描（参考实现：索引没建好时的回退，也是测试里的「标准答案」）----------
export function normalizedTagsOf(item, normalize, cacheKey) {
  let cached = item[cacheKey]
  if (!cached) {
    cached = { itemTags: (item.tags || []).map(normalize), unitTags: (item.unitTags || []).map(normalize) }
    item[cacheKey] = cached
  }
  return cached
}

export function linearTagMatch(item, tokens, normalize, cacheKey) {
  const { itemTags, unitTags } = normalizedTagsOf(item, normalize, cacheKey)
  for (const token of tokens) {
    let matched
    if (token.prefix) {
      // 前缀只能线性扫；带 * 的 token 一般就一两个，整库过一遍可接受
      matched = (!token.unitOnly && itemTags.some((tag) => tag.startsWith(token.name))) || unitTags.some((tag) => tag.startsWith(token.name))
    } else {
      matched = (!token.unitOnly && itemTags.includes(token.name)) || unitTags.includes(token.name)
    }
    if (token.exclude ? matched : !matched) return false
  }
  return true
}

// ---------- 倒排索引 ----------
const EMPTY = new Int32Array(0)

// 两个升序数组的并集（去重）
function unionSorted(a, b) {
  if (!a.length) return b
  if (!b.length) return a
  const out = new Int32Array(a.length + b.length)
  let i = 0
  let j = 0
  let k = 0
  while (i < a.length && j < b.length) {
    const x = a[i]
    const y = b[j]
    if (x === y) { out[k++] = x; i++; j++ } else if (x < y) { out[k++] = x; i++ } else { out[k++] = y; j++ }
  }
  while (i < a.length) out[k++] = a[i++]
  while (j < b.length) out[k++] = b[j++]
  return out.subarray(0, k)
}

function hasSorted(list, value) {
  let lo = 0
  let hi = list.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const v = list[mid]
    if (v === value) return true
    if (v < value) lo = mid + 1
    else hi = mid - 1
  }
  return false
}

export class TagIndex {
  constructor(items, itemMap, unitMap) {
    this.items = items          // 建索引时的条目数组（位置 = 下标）；条目数组被换掉后这份索引就作废
    this.itemMap = itemMap      // 规整后的标签 → Int32Array（升序）
    this.unitMap = unitMap
    this.itemKeys = [...itemMap.keys()]   // 前缀匹配要遍历所有标签名
    this.unitKeys = [...unitMap.keys()]
    this.size = items.length
  }

  // 分批建（每批 chunk 个条目、批间让出事件循环），建的过程中服务照常响应（那时走线性扫描）。
  // isStale()：条目数组已经被换掉了就中止，返回 null。
  static async build(items, normalize, { chunk = 3000, isStale = () => false, yieldFn = (fn) => setImmediate(fn) } = {}) {
    const itemLists = new Map()
    const unitLists = new Map()
    const add = (map, tag, pos) => {
      const list = map.get(tag)
      if (list) { if (list[list.length - 1] !== pos) list.push(pos) } else map.set(tag, [pos])   // 同一条目里重复的标签只记一次
    }
    let index = 0
    while (index < items.length) {
      if (isStale()) return null
      const end = Math.min(items.length, index + chunk)
      for (; index < end; index++) {
        const item = items[index]
        item[INDEX_POS] = index
        for (const tag of item.tags || []) add(itemLists, normalize(tag), index)
        for (const tag of item.unitTags || []) add(unitLists, normalize(tag), index)
      }
      if (index < items.length) await new Promise((resolve) => yieldFn(resolve))
    }
    if (isStale()) return null
    const freeze = (map) => { const out = new Map(); for (const [tag, list] of map) out.set(tag, Int32Array.from(list)); return out }
    return new TagIndex(items, freeze(itemLists), freeze(unitLists))
  }

  // 一个 token 命中的位置集合（升序、去重）。非排除、排除两种用法共用。
  tokenSet(token) {
    if (token.prefix) {
      let acc = EMPTY
      if (!token.unitOnly) for (const key of this.itemKeys) if (key.startsWith(token.name)) acc = unionSorted(acc, this.itemMap.get(key))
      for (const key of this.unitKeys) if (key.startsWith(token.name)) acc = unionSorted(acc, this.unitMap.get(key))
      return acc
    }
    const itemList = token.unitOnly ? EMPTY : (this.itemMap.get(token.name) || EMPTY)
    return unionSorted(itemList, this.unitMap.get(token.name) || EMPTY)
  }

  // tokens 全部命中的位置（升序）。语义和 linearTagMatch 逐条一致：正向 token 全部 AND，排除 token 命中的都去掉。
  match(tokens) {
    const positives = tokens.filter((token) => !token.exclude).map((token) => this.tokenSet(token))
    const negatives = tokens.filter((token) => token.exclude).map((token) => this.tokenSet(token))
    let candidates
    if (positives.length) {
      positives.sort((a, b) => a.length - b.length)
      candidates = positives[0]
      for (let t = 1; t < positives.length && candidates.length; t++) {
        const other = positives[t]
        const kept = new Int32Array(candidates.length)
        let n = 0
        for (let i = 0; i < candidates.length; i++) if (hasSorted(other, candidates[i])) kept[n++] = candidates[i]
        candidates = kept.subarray(0, n)
      }
    } else {
      candidates = new Int32Array(this.size)
      for (let i = 0; i < this.size; i++) candidates[i] = i   // 只有排除条件：从全库里去掉
    }
    for (const neg of negatives) {
      if (!candidates.length || !neg.length) continue
      const kept = new Int32Array(candidates.length)
      let n = 0
      for (let i = 0; i < candidates.length; i++) if (!hasSorted(neg, candidates[i])) kept[n++] = candidates[i]
      candidates = kept.subarray(0, n)
    }
    return candidates
  }
}
