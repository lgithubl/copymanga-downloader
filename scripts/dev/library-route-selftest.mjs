#!/usr/bin/env node
// 单元测试：媒体库搜索路由的生成和解析（web/static/library-route.js，纯函数）。
// 用法：node scripts/dev/library-route-selftest.mjs
import { libraryRouteHash, LIBRARY_ROUTE_DEFAULTS, parseLibraryRoute } from '../../web/static/library-route.js'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`)
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const defaults = { tagSearch: '', type: 'all', sourceProfile: '', seriesSubtitle: 'any', sort: 'imported_desc', limit: '20' }

// 1) 往返：生成 → 解析 → 得到同样的条件
const tricky = 'tag:"压缩包预览: 有" -tag:"标签:*" 带空格 & 号 # 井号 % 百分号 "引号" \\ 反斜杠 😀'
const full = { tagSearch: tricky, type: 'archive', sourceProfile: 'archive-gallery', seriesSubtitle: 'has', sort: 'title_asc', limit: '100' }
const hash = libraryRouteHash(full, { page: 3 })
const parsed = parseLibraryRoute(hash)
check('往返：所有条件原样回来（含中文、引号、& # % 😀 等特殊字符）', parsed && same(parsed.fields, { tag: tricky, type: 'archive', sourceProfile: 'archive-gallery', seriesSubtitle: 'has', sort: 'title_asc', limit: '100', page: '3' }), JSON.stringify(parsed))
check('tab=new 往返', parsed.newTab === true && hash.includes('tab=new'))
check('一个条件一个参数（可读）：URL 里能直接看到各字段名', ['tag=', 'type=archive', 'sourceProfile=archive-gallery', 'seriesSubtitle=has', 'sort=title_asc', 'limit=100', 'page=3'].every((part) => hash.includes(part)), hash)

// 2) 缺省值不写进 URL，缺参数解析回缺省值
const small = libraryRouteHash({ ...defaults, tagSearch: 'tag:"x"' })
check('只写和缺省不同的值（缺省的类型、排序、每页、页码都不出现）', small === `#/library?tab=new&tag=${encodeURIComponent('tag:"x"').replace(/%20/g, '+')}` || (!/type=|sort=|limit=|page=|sourceProfile=|seriesSubtitle=/.test(small) && small.startsWith('#/library?tab=new&tag=')), small)
const bare = parseLibraryRoute('#/library?tab=new')
check('缺参数 = 缺省值（不读 localStorage，任何浏览器结果一致）', bare && bare.newTab && same(bare.fields, LIBRARY_ROUTE_DEFAULTS), JSON.stringify(bare))
check('没有 tab=new 时 newTab 为 false', parseLibraryRoute('#/library?tag=a').newTab === false)
check('生成：newTab=false 时不带 tab=new；全是缺省时就是 #/library', libraryRouteHash(defaults, { newTab: false }) === '#/library')

// 3) 容错
check('不是库路由 → null（#/media/…、空、#/librarysomething）', parseLibraryRoute('#/media/media/x') === null && parseLibraryRoute('') === null && parseLibraryRoute('#/librarysomething?tab=new') === null)
check('只有 #/library（没有问号）也是库路由，全缺省', same(parseLibraryRoute('#/library').fields, LIBRARY_ROUTE_DEFAULTS))
check('未知参数被忽略（以后加条件、旧链接不受影响）', same(parseLibraryRoute('#/library?foo=1&tag=a&bar=2').fields, { ...LIBRARY_ROUTE_DEFAULTS, tag: 'a' }))
for (const [bad, expected] of [['abc', '1'], ['0', '1'], ['-5', '1'], ['2.9', '2'], ['', '1']]) {
  check(`坏页码 page=${JSON.stringify(bad)} → ${expected}`, parseLibraryRoute(`#/library?page=${bad}`).fields.page === expected)
}
check('百分号编码损坏的参数不抛错（按原样当文本）', (() => { try { return typeof parseLibraryRoute('#/library?tag=%E0%A4%A').fields.tag === 'string' } catch { return false } })())
check('重复参数取第一个', parseLibraryRoute('#/library?type=media&type=epub').fields.type === 'media')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
