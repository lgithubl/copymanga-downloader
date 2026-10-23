# 媒体库：很多标签页同时搜索 / 浏览时的性能设计

场景：同一个浏览器里开几十上百个「点标签搜索」的页面（`#/library?tab=new&tag=…`），每页 20~500 条、带缩略图。
瓶颈不是单个请求慢，而是 **请求数 × 共用的 6 个连接**（HTTP/1.1 下浏览器对同一主机最多 6 个连接，所有标签页共用）和 **Node 单线程上的同步 CPU**。

## 搜索页是「只读页」（tab=new）

- 只发一个启动请求 `GET /api/library/boot?<和列表一样的查询参数>`：配置 + 类型 + 列表（带进度）+ 元数据脚本一次取回。
- 不开 SSE、不轮询，不请求 jobs / downloaded / reading-progress / inventory-update / history / config / types / metadata-actions。
- 用户在这个页里切到别的视图（下载、搜索漫画…）时才启动后台同步（`showView`），补一次任务快照。
- 普通页面（没有 `tab=new`）的启动流程不变，但卡片上的「继续」进度改成服务端按当前页条目附带（`item.history`），不再单独取 1000 条历史。
- 普通页面之间：一个浏览器只开一条 SSE（Web Locks 选组长，`BroadcastChannel` 转发事件，组长关了自动接班）；后台标签页不轮询。

## 服务端

| 项 | 做法 |
|---|---|
| 标签搜索 | 倒排索引（`library/tag-search.mjs`）：标签 → 升序的条目位置；一次搜索只和命中数有关。启动 / 重建后分批在后台建，建好之前走线性扫描（结果一样）。`tagIndex=off` 可强制线性扫描做对照 |
| 系列过滤 | `seriesKey` 缓存在条目上（以前每次对整库重新规整标签） |
| 列表项体积 | 系列只带摘要 `series.primary`（主条目的 type / itemId / sourceProfile / unitCount），不带 `members`；点系列弹窗用 `seriesKey=…&sort=series` 取成员 |
| 列表响应 | ETag（索引版本 + 历史版本 + 查询串）→ `If-None-Match` 命中直接 304，不搜索不序列化；≥1KB 且接受 gzip 时压缩（走线程池）。随机排序不给 ETag |
| 静态文件 | ETag（内容哈希）+ `Cache-Control: no-cache`（每次校验，没变 304，改了立刻生效）+ 预压缩 br / gzip；V8 因此能缓存编译结果 |
| 缩略图 | `getThumbnailFile` → ETag / Last-Modified / 304 / 流式发送；缓存一天 + stale-while-revalidate |
| 线程池 | `config.threadPoolSize`（默认 16，4~128，**改了要重启**；不用环境变量，见 `threadpool.mjs`）；fs / zlib 共用 |
| 连接 | `keepAliveTimeout` 65 秒（Node 默认 5 秒，稀疏请求时浏览器老得重建连接） |

## 浏览器端缩略图（`static/thumb-loader.js`）

卡片 DOM 全部渲染（页内查找、全选正常），只有 `<img>` 的 `src` 分批设置：
- 第一批（`libraryThumbFirstBatch`，默认 30）：列表一渲染就请求，哪怕标签页在后台——切过去时第一屏已经有图。`0` = 页面第一次可见才开始。
- 之后每批（`libraryThumbBatch`，默认 60）：滚动到视口外 600px 内才放行；后台标签页不放行，第一次可见时才继续。
- 并发：前台 `libraryThumbConcurrency`（默认 6）、后台 `libraryThumbConcurrencyHidden`（默认 2）。重新渲染时没发出去的丢掉、在飞的中止。

以上五个设置 + `threadPoolSize` 都在配置页「媒体库性能」里。

## 实测（合成的 30 万条库，每条 12 个标签；本机回环，6 连接共用，100 个搜索页同时打开）

| | 以前 | 现在 |
|---|---|---|
| limit=500：全部完成 / 首屏 p50 | 13.2 s / 7.2 s | 1.8 s / 0.77 s |
| limit=100：全部完成 / 首屏 p50 | 7.6 s / 4.1 s | 0.76 s / 0.20 s |
| 总传输（不含缩略图） | 249 MB（limit=500） | 3.3 MB |
| 单个标签搜索（热） | ~700 ms（冷）/ 43 ms | ~1 ms 量级（倒排） |
| 带 seriesSubtitle / seriesKey 过滤 | 566~655 ms | 几十 ms |
| 单页 JS 解析（冷 / 热缓存） | ~43 ms / ~43 ms | ~43 ms / 0 ms |

## 自测

`node scripts/dev/tag-search-selftest.mjs`（倒排 = 线性扫描，随机 4000 个查询）、
`node scripts/dev/library-search-selftest.mjs`（起服务：三方对照、瘦身、history、ETag / 304 / gzip、boot、静态、缩略图、配置、线程池）、
`scripts/dev/fe-thumbs-selftest.mjs`、`scripts/dev/fe-tabs-selftest.mjs`（浏览器；后者验证 tab=new 的请求清单、SSE、事件转发、后台不轮询）。
`scripts/dev/make-big-index.mjs` 能造任意大小的索引缓存来压测。
