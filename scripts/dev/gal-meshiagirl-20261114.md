# meshiagirl 接入与验证（2026-11-14）

## 数据与格式

采集流程部署在 `vibe-test-20261008`，版本1.84–1.88。四轮自动上报：引擎探测、完整脚本与原始JS、角色与声音、CG差分；采集只读，不修改游戏。每个样本保留原路径、字节范围、大小、SHA256。

- 原始141087个文件。引擎为Cocos Creator2，不是Unity，不使用UnityPy。
- 以 `index.html` 实际引用的 `src/settings.9ed98.js` 和其中bundleVers为准；当前adventure为a215a。不会随意选目录里另一份过期manifest。
- adventure有1459个JsonAsset：1457个含tokenData的原始脚本、2个设置/表情表。默认排除引擎自测 `test` / `testall`（循环指令测试，不是正式剧情），列表显示1455个。排除表可在adapterOptions.excludeScripts修改，layout日志显示排除项。
- 特殊场景471个（原始命名 `_dekoEP_H` / H2 / H3等）；其中228份脚本引用still资源，其他包含前后剧情和角色骨架演出，不把它们错误地当作缺CG。
- 完整采集原始AdventureCommandManager、AdventureScreenController和文本/选择状态机，静态分析，不执行游戏JS或EXE。

## 实现

新增 `meshiagirl-json`，读取原始JsonAsset、Cocos压缩UUID、当前bundle清单和hashed native文件。无需解包或改写原始目录，无额外生产依赖，无运行时网络下载。

文字按原生click分页，组合SET/INSERT_TOP/APPEND/END片段；保留原始标签、真实选择与跳转。选择后汇合的剧情共享后续节点，避免连续选择产生指数级复制。缺失跳转标签按原引擎findIndex逻辑继续执行并明确诊断；不把后面文字全部丢掉。

角色使用Spine3.8二进制与6个表情轨道，按原舞台1170×640和0.8骨架比例摆放。atlas页名通过SkeletonData纹理UUID指向实际hashed PNG；核对432份SkeletonData，包括45份多页图集。

CG读取SpriteFrame的rect/offset/originalSize；脸部和覆盖层依原坐标叠加。双缓冲保留背景及前景切换；移动、缩放过渡采用结束位置。复用通用缩略图、中途开始卡片、上下标签及特殊场景视图。导入方案左侧“刷新JSON”下拉已加入meshiagirl。

## 明确限制

- 漫画情绪符号属于装饰骨架，采样为Spine3.8.75，现有官方运行时明确拒绝此版本。当前不尝试加载这类骨架，记录 `meshi:comic-mark-not-rendered`，主角色不受影响。
- 原版人像窗皮肤未复刻；原生红字等富文本用通用文字渲染。特殊ruby位置参数保留为未还原诊断。
- BGM使用循环段；前奏衔接、粒子、部分滤镜、曲线运动过程等未还原，逐条记录脚本名、token序号、原始行号、命令编号及参数。
- 这次是剧情阅读适配，不运行原游戏的战斗、商店或交互小游戏。

## 验证

- 1455份正式列表脚本全部执行并编译选择控制流，不只做JSON.parse。所有清单对应的资源仍由本地文件索引决定；测试素材只包含定向采集的真实媒体，其他媒体不伪造。
- 实际导入→layout→用户标题保留→全部剧情/特殊场景列表→真实文件接口读取通过。
- Chromium真实场景：`1012002_dekoEP_H3`、`1008001_dekoEP_H`（角色/表情/背景/MP3），`1014001_dekoEP_H3`、`1008001_dekoEP_H3`（3层CG差分/MP3）。验证顺序翻句与直接跳入相同，无资源缺失和Spine加载错误。
- TSK原始Ch10340034第45→46句表情回归、KiriKiri旧布局、Silky/Edoire旧导入与列表回归；完整参数表漂移、导入下拉与只读采集测试。
- 本地验证结果及截图：`.cache/meshiagirl/verification.json`、`corpus-report.json`、`browser/verification.json`、`browser/*.png`；不会把原游戏素材提交到Git。

## 导入配置

需更新镜像（新增适配器代码），并使用统一包内的gal-layout2.64.9。导入时可自动执行layout；根目录指向meshiagirl游戏外层，layout查找其缓存目录。

```json
{
  "rootDir": "/xxxxx/meshiagirl",
  "adapters": ["meshiagirl-json"],
  "defaultMetadataActions": ["gal-layout"],
  "dryRun": false,
  "config": {
    "game": { "id": "meshiagirl", "title": "meshiagirl" }
  }
}
```


## 2026-11-15：角色/服装分类、原版连续播放、表情渐变（2.65.0）

原先只列“全部剧情”，没有实现角色/服装层级。现从本地 `meshiamitm.db` 只读查询4个目录API记录：角色索引、服装列表、角色场景列表、场景执行顺序。不查询认证/会话表，不联网，不新增依赖（复用应用已有的Node SQLite）。目录库包含41个角色名、193个服装名；按实际本地剧情列出40个角色、156个有剧情的服装，另有28个“角色剧情”目录。主线按原始章节编号分组，活动和未归类脚本另列。

角色图与服装图按原始illust_url解析到各自hashed PNG。服装图只作为服装目录卡片封面，场景卡片继续生成CG缩略图与中途开始按钮，避免预设封面导致跳过场景摘要的问题。

原版执行表明确 `1001003` 顺序为H前篇→H2主体→H3后篇，现合并为一个315页场景卡片，保留主体/后篇/CG跳转按钮。其他角色场景也按执行表处理，共185组连续场景编译通过；1085个最终场景卡片对应1455份原脚本。`_N`另列通常版。存在例外：1001002执行表的main指向`ch001/1001002_dekoEP_H`，after指向`ch001/1001002_dekoEP_H2`，不能仅凭H2/H3后缀猜测。所有未被执行表引用的本地变体仍保留，不静默丢弃。

合并时按原文件隔离资源数字ID和标签作用域，诊断仍保留原文件名、行号与token序号。不会把各段的数字ID冲突当成同一资源。

闪烁复现：同一骨架未重新加载，但表情轨道默认mixDuration=0。现只对meshi表情轨道增加180ms混合（`expressionMix:0.18`，单位秒，可改为0关闭）；身体轨道不重启，直接跳入仍取最终姿势，其他适配器默认行为不变。真实Spine3.8的脸部ColorTimeline在过渡中出现0~1之间的alpha，已验证确实经过中间状态，并非仅设置一个未生效的参数。

真实网页验证：角色→[へっぽこ勇者]服装缩略图→一个连续H场景卡片→CG中途进入，315页、CG底图+表情差分均显示；顺序翻句/直接跳入、旧TSK表情、RPG Maker地图调用、KiriKiri布局回归通过。数据库SHA256前后相同。

更新镜像和统一tag包后重跑gal-layout2.65.0，使卡片采用新的分段/CG跳转规则。新参数：

```json
{
  "adapterOptions": {
    "meshiagirl-json": {
      "mergeEpisodes": true,
      "expressionMix": 0.18,
      "catalogDatabase": "meshiamitm.db"
    }
  }
}
```
