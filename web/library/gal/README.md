# Gal（视觉小说 / 剧情脚本）库类型

一个**目录 = 一个媒体条目，条目里只有一个单元（`main`）**。单元里是一棵由后端按需给出的**浏览节点树**（真实目录树）：
首页 → 一层层目录 → 脚本卡片 → 播放页。目录本身就是数据：导入只建元数据 JSON，不 mv、不拷贝、不改原文件。

## 分层：导入只存路径，配置全在 `config`，特化靠 tag 脚本

```
导入        只存：来源路径 source.path、adapters（脚本格式适配器）、标题。不扫描目录。
config      条目元数据里唯一的配置字段（gal/config.mjs）。引擎只认它；缺的字段用默认 = 「标准结构」（UViewer 资源包布局），
            所以按标准结构放的目录导入完不用脚本就能浏览/播放。
tag 脚本    gal-layout（scripts/tag-scripts，三种游戏合一，按 config.game.id 分发）：目录没按标准结构放时，探测实际结构、把 config 里的参数调对，再挑封面、数脚本。
            导入后自动跑一次；上传新版本脚本重跑即可，不用改镜像。版本和运行时间写进 config.script，并打「Gal配置version」标签。
节点提供者  gal/browse.mjs：按 config 把目录树变成节点（卡片 / 播放页），翻页、合并目录、来源标记、返回页码、上下话。
脚本适配器  gal/adapters：脚本文本 → 规范场景 gal-scene/1（含 select / if 分支）。
前端        gal-browse.js（卡片）、gal-player.js（播放）；沉浸等页面状态两者共用。
```

### config 字段（全是数据，没有代码）

| 字段 | 含义（默认值 = 标准结构） |
|---|---|
| `scriptRoots` | 脚本根 `[{id, dir, label}]`，相对媒体目录；多个 = 可切换的文本版本（比如中/日），第一个是默认。默认 `resources/download/adv/text` |
| `resourceRoots` / `namesFiles` / `thumbsDirs` | 资源根（脚本里的 `download/...` 从这里起算）、名称文件（`{目录名: 显示名}`）、缩略图缓存目录——**都是数组，按顺序查找** |
| `labels` | 目录名 → 中文标签（cabin→纪念馆…） |
| `merge` | 合并目录：`[{parent: 通配, dirs: [子目录名…], badges: {子目录名: 标记}}]`。列 `parent` 下的目录时，把 `dirs` 里这几个子目录的内容合进同一个列表（不再显示这几个子目录），每张卡片右上角带来源标记（默认 `character/*` 合并 `adultr`+`extra`，标记 `adu` / `ext`）；合并后按文件名自然序混排 |
| `views` | 虚拟目录（视图）：`[{parent, as, label, dirs, match, exclusive, badges}]`。在 `parent`（`.` = 脚本根）下多出一个叫 `as` 的目录（磁盘上没有，路径 `<parent>/<as>`，有内容才列出）；内容 = `dirs` 里这几个子目录（不写 = `parent` 自己）里 stem 匹配 `match`（正则，不写 = 全部）的脚本，`badges` 按来源目录给角标。`exclusive: true`（只对来源是 `parent` 自己的有效）= 被它收走的脚本不再平铺在 `parent` 的列表里，脚本的「上一级」「上一话/下一话」也算在这个视图里。分组 `groups`、封面 `dirThumbs`、标签 `labels` 都按视图路径配（比如 `groups: [{parent: 'chars', …}]`）。monmusu：首页 动画 / 事件 / 总览（总览 = `hscene` + `hscene_still`）；minashigo：角色 / 活动 / 主线 |
| `dirThumbs` | 目录卡片头像规则：`{parent, name(正则), paths(模板，{name} {parent})}`；匹配的规则里**所有存在的**路径都进缩略图数组（见「卡片缩略图」），路径的目录 / 文件名段可带通配 `*` `?` |
| `scriptThumbs` | 脚本缩略图模板（`{stem}` `{thumbsDir}`；`~/` = 相对媒体目录；可带通配），之后才是「脚本里第一张背景图」（前面都没有才用） |
| `thumbSources` | 按文件名规律提取缩略图的规则列表（接在 `dirThumbs` / `scriptThumbs` 后面），见「卡片缩略图」 |
| `thumbMode` | 卡片有多张图时怎么显示：`random`（默认）/ `first` / `hover` |
| `cover` / `scriptCount` / `script` | 封面路径（`~/` 开头 = 相对媒体目录，只给封面用）/ 脚本数 / 谁写的这份配置 `{id, version, ranAt}` |
| `groups` | 分组：`[{parent: 通配或 '.', pattern}]`。列 `parent` 下的目录时，脚本名（无扩展名）匹配 `pattern` 的按**第 1 个捕获组**归进虚拟目录（一个键一张卡片，节点 id `g:<键>:<路径>`），不匹配的照常列出；名字/头像和真实目录一样查 `labels` / `namesFiles` / `dirThumbs`。`parent: '.'` = 脚本根本身（`merge` 也认） |
| `game` | `{id, title}`：这个媒体是哪个游戏/资源包（`id` 只含字母数字 `_-`）。**导入时在 config 里写**，tag 脚本按它分发——同一个 adapter、配置不同的两个媒体靠它区分；脚本同时打 `Gal游戏: <id>` 标签方便搜索（以 config 为准） |
| `adapterOptions` | `{<adapter id>: {…}}`，原样交给适配器（每个适配器序列化后 ≤ 16 KB，合计 ≤ 64 KB，最多 10 个适配器；规则表会放在这里）；需要查别的文件的适配器用它指路径。适配器从 `prepare({options})` 或 **`parse` 的 `meta.options`** 拿到，见「适配器契约」 |
| `scriptIndex` | 脚本索引（给脚本配缩略图 + 来源角标）：`[{dir, pattern, key, badge}]`。`dir`（相对媒体目录）里的文件名匹配 `pattern` 时，按 `key` 模板（`{1}{2}…` = 捕获组）算出它对应哪个脚本（脚本名，无扩展名），这个文件就是那个脚本的缩略图，`badge` 显示在卡片右上角 |
| `hiddenDirs` | 列目录时不显示的目录名（任意层级，精确匹配） |
| `classify` / `resourceResolve` / `indexSkip` / `limits` / `player` | 引擎层的通用能力（只读配置、按配置匹配；脏知识由元数据脚本写进来）：音频指令重分类 / 资源路径解析规则 / 文件索引跳过的名字 / 上限 / 播放器默认值，见下「引擎层通用配置」 |
| `stripPrefixes` `scriptExtensions` `pageSize` | 资源找不到时去掉的前缀 / 脚本扩展名 / 每页卡片数 |

元数据里只存**写过的字段**（没写的随引擎默认值走）；补丁默认合并（写了的顶层字段整个替换，`null` = 删掉回默认），`replace` = 整体替换。
所有路径都是相对媒体目录、不许绝对路径和 `..`；模板只做占位符替换，读文件前仍要通过存在性检查和「只认媒体目录内的真实路径」——
脚本写进去的 config 再坏，也读不到媒体目录以外。

### 适配器契约：`meta.options` / `meta.config`

`adapter.parse(text, ctx, meta)` 的 `meta`（`buildScene(adapterId, text, ctx, meta)` 的第 4 个参数；浏览、列表摘要、随机语音三处都一样）：

```js
meta = {
  rel, stem, scene?,          // 脚本路径 / 文件名（无扩展名）/ <文件>::<场景> 里的场景号
  options,                    // config.adapterOptions[适配器 id]，没有 = {}（和 prepare({options}) 同一个对象；没有 prepare 的适配器只能从这里拿）
  config,                     // 引擎配置的只读视图（深度冻结）：{ classify, resourceResolve, player, limits, indexSkip }
}
```

适配器只做「读配置、按配置匹配」；脚本（`scripts/tag-scripts/gal-layout`，管理员运行）把路径 / 正则 / 命名规则 / 猜出来的映射写进 `adapterOptions` 和上面这几个字段。
`prepare({ options, texts, files, toResourcePath, truncated, sampleTruncated, mediaDir })` 不变（多了 `sampleTruncated`）。
适配器按文件索引查资源时用 `gal/resolve.mjs` 的 `createIndexResolver({ index, cfg: meta.config.resourceResolve, preferDirs })`（见下），不要自己写大小写 / 扩展名 / 重复文件名的逻辑。
`parse` 之后 `buildScene` 统一过一遍 `meta.config.classify`（适配器不用管）。

### 适配器参数（`adapterOptions`）：tenkeiprdx-json / misttrain-json / artwhirl-json / girlscreation-tag

四个适配器（girlscreation 的行式脚本 `girlscreation-line.mjs` 共用 `girlscreation-tag` 的参数）都只做「读参数、按参数匹配」：路径模板、字段位置、命名规则、猜出来的数字全写成 `DEFAULT_OPTIONS`（适配器文件里导出，也是参数的 schema + 默认值，头部注释逐项说明），**不写 = 以前的行为**；`gal-layout` 的 `LAYOUTS` 表把需要的项写进 `adapterOptions[<适配器 id>]`。
合并规则（`adapters/options-merge.mjs` 的 `mergeOptions`，宽容、不抛错）：对象逐键递归合并（站位表、动画表这类映射可以加项）；**数组整体替换**（要关掉某一项：数组写空 / `['','']`，字符串写 `''`）；数字 / 字符串 / 布尔类型不符就用默认值；`null` 默认值的项是可选项，给什么收什么；不认识的键保留。正则一律走 `compileSafeRegex`（不合格 = 这条规则没有）。
`prepare` 现在还收到 `resourceResolve`（= `config.resourceResolve`），按文件索引查名字的地方（artwhirl 的资源 / 语音、tenkeiprdx 的背景 / BGM、misttrain 的语音）都走 `createIndexResolver`：大小写忽略、`preferDirs` 挑同名文件、`caseInsensitive: false` 回到精确匹配。

- **tenkeiprdx-json**：`root` / `unknownName` / `stillPng` / `userPlaceholder`；`positions`（站位 → 横向位置，`positionX` 是旧名）+ `defaultX` + `facial`（表情 → 动画名）；`fieldMap`（数组形各字段的位置：`scene` / `frame` / `character` / `skip` / `master`，游戏版本变了只改这里）；`dirs` / `files`；`paths`（`background` / `bgm` / `se` / `voice` 候选模板，`backgroundMissing` 规则，`thumbStill`）；`still`（`backgroundRe` / `animationRe` / `animationName`）；`hse`（`stillRe` + `effects`：背景名触发的音效 / 闪白 / 白屏，指令原样发出）；`animations`（`noLoop` / `slow` / `speed` / `linked` / `flash` / `wash`）；`animationSpeed`（`msThreshold` / `msDivisor`）；`camera`；`stand`；`bgm`（停 BGM 的写法）；列表：`kinds`（分类 + 缩略图目录）、`idRules`（缩略图名 → 剧情 id：`segments` / `prefix` / `lastDigit` / `forms`）、`catalog`（缩略图前缀、角色号、角色 still 前缀、标题）。
- **misttrain-json**：`root` / `showMosaic`；`dirs` / `master`（名称表文件与键）/ `scenes`（`dirs` 剧情目录、`stillsDir`、`collision: 'last'|'first'` 同名剧情谁赢）；`fieldMap`（`row` 行内位置、`detail` stillDetail 内位置）；`paths`（bgm / se / bgse / background / voiceFallback 模板）；`backgrounds.ext`；`voice`（`dir` / `ext` / `preferDirs` / `duplicates: 'first'|'skip'`）；`titleLookup`（`trim` / `tryAsIs` / `tryMinusOne`）；`still`；`camera`（`positionScale` 0.84、`zoomAdd` 0.03、`zoomUnit` 1.3、…，都是没真机对照的估值）；`effects`（`fadeSeconds` / `flashSeconds` / `flashCount` 估值、`map` effect 取值 → wash / flash、`oneShotRule` 一次性动画、`linkedBgSe` 联动背景音效表、`fastSpeed` / `loopExcept`）；`emoji`。
- **artwhirl-json**：`root`（默认 `game`）/ `dirs` / `standZoom`；`dic.indexFields`（哪些字段的整数是 dic 下标）；`assets`（资源名 → 路径的规则表：`{ match, replace }`，第一条命中的生效）；`extPrefer`（`.mp3` → `.ogg`）；`stand`（`path` 模板、`fields` 立绘字典的键名、`defaults`、`hSuffix`、`fallback` 有序的替换组 `[['h->'], ['brow->b'], …]`）；`hcg`（`match` / `imageExts`）；`video`（`ext` / `noLoopFrames` / `frameSplit`）；`voice`（`dir` / `preferDirs` / `ext` / `fallback`）。
- **girlscreation-tag（+line）**：`root` / `categoryLabels` / `player.names`（数组；旧写法 `player: '館長'` 也认）；`dialect`（`window` / `headWindow` / `markers.aku|display|branch`）；`stand`（`akuOffset` 450、`akuDirections`、`fruitsDim` 0.6）；`animation.maxFrames`；`line`（`expressionPrefix` / `imageIdRe`）；`category`（`re` / `other` / `unknownSpeaker`）；`titleLines`、`speaker.suffixRe`；`dirs` / `sceneDirs` / `audioKinds`；`scenes`（`script` 优先级列表 / `lineScript` / `thumb`）；`sample.files`（读开头的文件；字节数由引擎 `limits.sampleBytes` 管）。

测试：`node scripts/dev/gal-adapter-options-selftest.mjs`（node 即可）：每个参数「默认值整份显式写出来结果不变 / 覆盖后结果按上面变」，每个适配器一条 `adapterOptions → loadAdapterContext → buildScene` 的完整链路。

### 引擎层通用配置（`config` 的新字段，全部可选；没写 = 原来的行为）

写错的部分**丢掉并报告**：规整时每处被丢掉 / 夹住 / 退回默认的内容都进 `warnings`（`{field, reason, snippet}`；`normalizeGalConfigWithWarnings(raw)` 返回 `{config, warnings}`，`normalizeGalConfig(raw)` 的返回值上有不可枚举的 `warnings`）。
导入 / 元数据脚本补丁里丢掉的内容记在条目的 `configWarnings`（落盘，下一次干净的补丁清掉）；条目 JSON 里手写坏的也会报；不认识 / 写坏的适配器 id 也报。列表页（所有非播放页节点）的**渲染诊断**里每条一行
`code: config-dropped`（最多 10 行，多的汇总一行）。

- **`classify`**（数组 ≤ 50）：`[{ match, on?, from?, as }]`。`match` = 正则源码（不分大小写，≤ 200 字符，和随机语音同一套安全检查：量词套量词 / 反向引用 / 编译错误 = 丢掉并报告）；
  `on` = `src`（默认，指令的资源路径）| `speaker`（当前说话人 = 这一步之前最近一条 speaker 指令，跨步沿用）| `text`（这一步第一句有字的台词，台词在语音之后也行）；
  `from` = 只处理这些 op，`se` `voice` `bgm` `bgse` `bgvoice` 的子集（默认全部音频 op）；`as` = `voice` `se` `bgm` `bgse` `bgvoice` | `drop`（删掉）。
  `scene.mjs` 的 `buildScene` 在适配器 `parse` 之后对所有音频指令过一遍，**第一条命中的规则生效**；改类型时字段保持合理：`se` / `voice` / `bgm` = `{src}`（bgm 的 loop / fade 丢掉），`bgse` 要 `loop`（原来没有 = `true`），
  `bgvoice` 要 `slot`（默认 `classified`）/ `volume`（默认 1）；指令上的 `when` 条件保留。命中但类型没变的不改。改动条数写进 `scene.stats.classified`（有规则才有这个字段）。
  例：`classify: [{ match: '/voice/', as: 'voice' }, { match: '^narrator$', on: 'speaker', from: ['voice'], as: 'drop' }]`
- **`resourceResolve`**（对象；资源路径解析规则，`gal/resolve.mjs` 只实现一次，磁盘层 `resolveAsset` 和内存索引层 `createIndexResolver` 共用）：
  `extensionFallbacks`：`{ '.m4a': ['.wav', '.ogg'] }`（键小写；≤ 30 项、每项 ≤ 10 个）；`rewrites`：`[{ match, replace, flags? }]`（≤ 30 条，`replace` 里 `$1` 引用捕获组，`flags` 只能是 `'i'`，默认区分大小写；**每条规则各自对原路径替换**，按顺序各出一个候选；替换出的 `..` / 绝对路径丢掉）；
  `normalizeUnicode`：`['NFC', 'NFD']`（对每个候选再试这些形式）；`preferDirs`：`['dir/a', …]`（索引里同名文件不止一个时，按这些目录前缀的顺序挑，没有就取字典序第一个）；
  `caseInsensitive`：默认 `true`（= 以前的行为），`false` 只认大小写完全一致；`allowedRoots`：`['/abs/dir', …]`（**管理员专用**，绝对目录，≤ 20 个，不许 `..` / `/`；realpath 确认时，目标在媒体目录内**或**这些目录内都放行，默认 `[]` = 只认媒体目录）。
  **解析顺序**：原路径（资源根依次，`stripPrefixes` 去前缀的变体）→ `rewrites` → `extensionFallbacks`（对前面每个候选）→ `normalizeUnicode`（对前面每个候选）→ 按路径段忽略大小写（`caseInsensitive`）；每一步找到的真实路径都要在媒体目录或 `allowedRoots` 内，目录穿越（`..`）一律 400。`~/` 路径（缩略图 / 封面）不套任何规则。
  例：`resourceResolve: { extensionFallbacks: { '.m4a': ['.wav'] }, rewrites: [{ match: '^bgm/(.*)\\.mp3$', replace: 'sound/$1.ogg' }], preferDirs: ['voice/jp'], allowedRoots: ['/data/shared-assets'] }`
- **`indexSkip`**（数组 ≤ 20，正则源码，对**文件 / 目录名**匹配，区分大小写）：文件索引（`context.mjs` 遍历）跳过的名字。**默认（没写）= 以前写死的规则**，写成默认值 `['^\\.', '\\|', '#']`（`.` 开头 / 含 `|` / 含 `#`）；可以覆盖，写 `[]` = 一个都不跳过（索引 `#` 的名字）。浏览列表（节点 id 里不能有 `|` `#`）不受它影响。
- **`limits`**：`{ walkFiles ≤ 2,000,000（默认 40 万）, sampleFiles ≤ 20,000（默认 3000）, sampleBytes 256..256KB（默认 24KB）, scriptBytes ≤ 64MB（默认 4MB，超过的脚本不被识别）, walkDepth ≤ 12（默认 6） }`。超出范围夹住并报告，不是数字丢掉并报告。适配器自己的 `contextWalkLimit` / `contextSampleLimit` 仍是适配器的默认，`config.limits` 覆盖两者。缓存键含这些值。
- **索引截断的诊断**：目录遍历超过 walk 上限 → `truncated`（`index-truncated` 问题）；脚本抽样（`contextTextFilter`）超过 sample 上限 → **新的 `sampleTruncated`**（`stats` / 节点的 `index.sampleTruncated` / `sample-truncated` 问题；控制台也打日志；传给 `prepare({ sampleTruncated })`），以前这里是悄悄丢的。
- **`player`**（这个游戏的播放器**默认值**，只在用户浏览器里没存过对应设置时生效；经节点的 `node.player` 下发，前端白名单 + 夹范围再来一次）：`fontScale` 0.6..2（`copymanga.gal.fontScale`）、`textOpacity` 0..1（`copymanga.gal.boxOpacity`）、`autoDelay` 0..30 秒（`copymanga.gal.autoVoiceDelay`）、
  `cameraMode` `'auto'` | `'fixed'`（角色摆放；没有按媒体存过时）、`zoom` 0.5..4（静图 / 角色放大，没有按媒体存过时）、`minFitScale` 0.3..1（台词太长最多缩到的倍数，没有浏览器设置项）、`fastInterval` 20..500 毫秒（快进每步间隔，没有浏览器设置项）。例：`player: { fontScale: 1.2, cameraMode: 'fixed' }`。

**适配器用的内存索引解析器**（`web/library/gal/resolve.mjs`）：

```js
import { createIndexResolver, candidatePaths } from '../resolve.mjs'
const r = createIndexResolver({ index, cfg: meta.config.resourceResolve, preferDirs })   // index：Map / Set / 数组 / 普通对象 / { has(), keys()? }
r.resolve('audio/a.m4a')    // → 索引里真实存在的路径（原样的键），没有 ''（精确 → rewrites → 扩展名回退 → unicode → 忽略大小写）
r.resolveByName('a.m4a')    // → 只知道文件名：索引里 basename 匹配的路径，按 preferDirs（参数覆盖 cfg.preferDirs）的顺序挑，没有 ''
r.has(path)                 // → resolve(path) !== ''
candidatePaths(path, cfg)   // → 按顺序要试的候选路径（含原路径，去重，都是安全相对路径）
```

测试：`node scripts/dev/gal-engine-config-selftest.mjs`（node 即可）；播放器默认值的浏览器检查：`node scripts/dev/fe-gal-player-defaults-selftest.mjs`（端口 8171）。

### 适配器的列表（catalog）

适配器可以实现 `catalog(ctx) → { children: [节点] }`，节点 = `{ id, title, subtitle?, thumb?, badge?, children? | script? }`（`script` = 相对媒体目录的脚本路径）。有它时首页和所有列表都由它给（节点 id `v:<编码后的 id>[#页码]`），
脚本卡片仍是 `s:<路径>`；`ctx` 来自 `prepare`，所以列表数据（名称表、缩略图目录…）和脚本解析用同一套「上下文」，文件变了就跟着变。没有 catalog 的适配器仍按真实目录树浏览（UViewer / monmusu）。

### 适配器的媒体上下文（context）

适配器本身只做 `text → scene`。有些格式的脚本里只写别名（Ren'Py 的 `scene 10001A1-10` 要查 `script/movie.rpy` 才知道是哪个 webm），
适配器可以声明 `contextFiles(options)`（要读的文本）/ `contextDirs(options)`（要递归列文件名的目录）/ `prepare(…) → ctx`，引擎读好后把 `ctx` 传给 `parse(text, ctx)`
（`gal/context.mjs`）：按文本文件 mtime+size、目录（自己和下一层子目录）mtime 缓存，目录里新增/删除文件马上生效，更深层的最多缓存 5 分钟；路径在 `config.adapterOptions[适配器 id]` 里配（相对媒体目录）。

### Girls Creation 的 FRAME_ANIM

`<FRAME_ANIM>前缀,起始帧,结束帧,速度`：场景自己的 `animations/<前缀>_<帧号>.jpg`，从起始帧到结束帧循环播放，当背景（换背景 / 退出时停）。第 4 项速度不用——速度统一在播放器「设置 → 画面 → 帧动画速度」里设（帧/秒，默认 30，存在浏览器里）。
缺的帧跳过并记 `stats.unresolved`。`SPINE_ACTOR_TRACK 槽,轨道,动画,循环` 和 `PLAY` 一样给轨道设动画（参数顺序不同）；`SPINE_ACTOR_SHAKE 槽,x,y,时长` 让角色衰减地来回晃（时长按 60 = 1 秒折，单位没有对照样本）。

### 适配器 misttrain-json（MistTrainGirls X，Unity 剧情查看器）

- 适配器认：`[null, [<场景 id>, [行…], …]]` 的位置数组（`UScenes/<id>/<id>.json`、`UScenes/Stills/<角色底号>/<id>.json`）。一行 19 项（说话人、台词、语音、背景、BGM、音效、effect、stillDetail…），
  字段位置和播放规则（没台词的行并进下一句、effect 1 白屏淡入 / 3 白色闪烁、联动背景音效 Hse1~4 的选法、一次性动画降速、镜头缩放 / 平移 / 旋转）都写在 `adapters/misttrain-json.mjs` 的头注释里，来自反编译的 `Assembly-CSharp.dll`。
- 静态画面 = `Spines/**/<场景 id>/`：按 `still_configuration.json` 的 `Parts` 叠层，`IsMosaic` 的层默认不叠（`adapterOptions['misttrain-json'].showMosaic` 打开才叠）。
- 导入页选「MistTrainGirls X」点「刷新 json」，或自己写：`adapters: ['misttrain-json']`、`config: {"game": {"id": "misttrain"}}`、勾元数据脚本 `gal-layout`。
  脚本探测「有 `UScenes/`，同级有 `Spines` / `Sounds` / `MasterData` / `BackGrounds`」的目录（多一层自动带前缀），写：脚本根 `<数据根>/UScenes`、资源根 `<数据根>`、扩展名 `json`、适配器参数 `root`。
- 列表（`catalog`）：角色（名字查 `MasterData/MCharacterBaseViewModel.json`，剧情标题查 `MSceneViewModel.json`，场景 id = 文件名去掉末 2 位）/ 其它剧情 / 全部剧情，每次从文件现读。
- 没验证的（没有真机对照）：镜头位置的换算（×0.84）、effect 的时长（1 秒 / 0.3 秒 × 2）、Hse1 / 其余联动音效的循环标志。

### 适配器 renpy-monmusu-monmusu

- 适配器认：`scene black|<视频别名>|<图片名> [with 转场]`、`play music/sound`、`stop music`、`voice`、`"名字" "台词"`、`pause 秒`；一句台词一步。
  视频别名来自 `image X = Movie(play=…)`，图片名来自 `images/` 下的文件名（或 `image X = "文件"`）；查不到的 `scene` 保留成 raw。翻译叠加（`tl/*`）暂不处理。
- 导入时自己填：`adapters: ['renpy-monmusu']`、路径、`config: {"game": {"id": "monmusu"}}`、导入页勾元数据脚本 `gal-layout`。
- 脚本探测 `script/hscene`（+ `script/movie.rpy`），多一层目录（如 `game/`）自动带前缀；写：脚本根 `<游戏根>/script`、资源根 `<游戏根>`、
  合并 `hscene`+`hscene_still`（角标 `anim`/`still`）、按文件名前 5 位角色编号分组、隐藏 `sub_nav`/`tl`、`adapterOptions`（别名表、图片目录）、
  头像模板（`images` 里找 `icon_<编号>_0_idle.*`）、封面、脚本数。只处理 `config.game.id` 为 `monmusu`（或没有 game 且认出结构）的媒体；
  （探测逻辑在合一的 `gal-layout` 脚本里，见下。）

### 适配器 tenkeiprdx-json-tenkeiprdx

- 输入是 Unity 剧情查看器素材（`StreamingAssets/Tenkeiprdx X/Imported`）里的剧情 JSON（对象形 `result.sceneDetails[].sceneFrameDetails[]`，取 `assetId` = 文件名那一项）。一帧 = 一步。
  背景（`Backgrounds/adventure|still|eventstill`）、BGM（`BGM/<名>.ogg`，没有就找 `_loop`）、音效、语音（`AdventureVoice/<场景id>/`）、说话人（`%username%` ← `Masterdata/username.txt`）、台词；
  站位立绘（`Spines/<角色id>/`，表情 0..6 → idle_normal/joy/sad/angry/surprise/shy/unique，站位 1 左 / 2 右 / 其余居中，动作 1 跳 / 2 抖 / 3 沉，空数组 = 全隐藏）；
  静态画面（`Stills/<名>/` 下所有骨架按数字前缀叠起来，animation2/3/4 联动背景音效 Hse2/3/4，animation4 闪白两次，animation5 白屏渐退，animation3 倍速 1.5）；镜头（起止位置 + Z 缩放千分比 + 毫秒时长）。
  只做对象形；`frameEffect` 的取值不明，原样记在 `scene.stats.frameEffects`；对象形里没有「谁在说话」的站位字段，所以不做说话人高亮。
- **列表（adapter.catalog）**：照原查看器的三个列表页，由适配器每次从数据文件现读（上下文按文件 / 目录 mtime 失效，所以新增剧情、缩略图、改名称表马上生效，不用重跑脚本、不用重新导入）：
  活动 = `EpisodeThumbnails/event`（新的在前，剧情 id = `2`+文件名第 3、4 段）；附加 = `EpisodeThumbnails/extra`（同上，id 以 1 结尾的末位换成 2，标题查 `Masterdata/masterdata_32.json`）；
  角色 = `CharacterIcons/<8 位角色号>*.png`（名字、称号查 `masterdata_4.json`）→ 点进去是这个角色的 EX 剧情（`masterdata_32.json` 里按 `<角色号>_01|02_still` 找，缩略图 `Backgrounds/still/<key>.png`）；
  全部剧情 = `scenes/` 下所有 JSON。点剧情卡片 = 进播放页，标题、面包屑、「↑ 列表」、上一话/下一话都按收它的那个列表来；进度仍按剧情路径记（和从哪个列表进来无关）。
- 适配器参数 `adapterOptions['tenkeiprdx-json']`（完整列表见上面「适配器参数」）：`root`（Imported 目录，相对媒体目录）、`positionX`（站位 → 横向位置 0..1）、`unknownName`（`%username%` 没有 username.txt 时的名字）。
- 脚本探测 `scenes/` + `Backgrounds|Spines|Stills|Masterdata`（外面多套几层目录自动带前缀），写：脚本根 `<素材根>/scenes`、资源根 `<素材根>`、扩展名 `json`、
  `scriptIndex`（`EpisodeThumbnails/event|extra` 的 `ep_eventstill_<a>_<b>…` → 剧情 id `2<a><b>`，缩略图 + 角标 event / extra）、适配器参数、封面、脚本数。只处理 `game.id = tenkeiprdx`（或没有 game 且认出结构）的媒体。

### Spine 骨骼动画（播放器 `web/static/gal-spine.js`）

- 规范场景新增指令：`spine`（slot / kind: chara|still / skel / atlas / anim / loop / speed / x / dim / action / order）、`spineOff`（slot 或 prefix 或全部）、`camera`（from / to / seconds）、`bgse` / `bgseStop`（背景音效声道）、`flash` / `wash`（闪屏 / 整屏渐退）。
  `spine` 按 slot 进状态（同 slot 再来一条 = 更新动画/颜色/位置，同一个骨架不重新加载）；后退/续播一步到位恢复。
- 渲染：一个叠在背景上的 WebGL canvas，官方 spine-webgl 运行时（3.6 / 3.8 / 4.0 / 4.2，见下），骨骼文件二进制（`.skel.bytes`）和 JSON 都认；站位立绘按舞台高度 95% 底部对齐，静态画面 contain 居中；镜头作用在整个画面（背景 + 视频 + Spine）上。
- **运行时不在仓库里**（Spine Runtimes License 限制）：`Dockerfile.web` 构建时跑 `scripts/fetch-spine-runtime.sh`（固定提交 + sha256 校验）下载到 `web/static/vendor/`；本地开发手动跑一次。没有运行时：播放器栏里提示「Spine 运行时缺失」，其余照常。
- **四个版本的运行时（3.6 / 3.8 / 4.0 / 4.2）**：`spine-webgl-3.6.js`（spine-runtimes 3.6 分支固定提交 `654c20e`）、`spine-webgl.js`（3.8）、`spine-webgl-4.0.js`（npm 4.0.31）、`spine-webgl-4.2.js`（npm 4.2.100），都由 `scripts/fetch-spine-runtime.sh` 下载并校验。
  每个骨骼先读文件头认版本（二进制：头里的版本字符串；JSON：`skeleton.spine`）再选运行时；每个版本一块 canvas（`data-runtime` 标了版本），同一幅画面里不同版本的骨骼各画各的、共用同一套变换。
  4.1 / 3.7 / 4.3 等没有对应运行时的版本，右下角提示「Spine 版本不支持」，诊断面板写「识别：Spine 4.1.55 → 没有对应的运行时」和「版本不对：…」；
  文件都取到了但解析失败写「骨骼解析失败（Spine x.y.z，运行时 …）」，**不再**冒充成缺 png；浏览器 console 里每个骨骼有一行 `[gal-spine] <路径>：识别为 Spine x.y.z → 运行时 …`。
- 贴图预乘 alpha（Spine 导出勾了 Premultiply Alpha）：按原始尺寸分块检测（半透明像素的 RGB 都不超过 alpha），预乘的走预乘混合；4.x 的 atlas 带 `pma: true` 也认。按普通贴图画预乘贴图会让半透明处（脸颊渐变、关节接缝）发黑。
- 静态画面各层共用一套变换，基准是最底下那一层（序号最小）的包围盒。
- 4.0 / 4.2 只用 JSON 骨骼做过浏览器测试（没有真实 4.x 二进制样本可测）；二进制走同一套官方运行时。
- **Spine 3.6（GrenzeViewer：`3.6.38` 二进制 `*.skel.asset` / `*.skel.bytes` + 旧格式 atlas `*.atlas.asset` / `*.atlas.txt`）**：
  - 官方 3.6 的 Web 运行时（`spine-ts/build/spine-webgl.js`）**只有 `SkeletonJson`，没有 `SkeletonBinary`**（spine-ts 的二进制加载器 3.7 才有）。所以二进制的 3.6 骨骼先由 `web/static/gal-spine36-binary.js` 按 3.6 二进制格式（对照 3.6 分支 libgdx 版 SkeletonBinary 的读取顺序）转成 3.6 JSON 结构，再交给官方 `SkeletonJson` 建骨架（附件 / 网格 / UV / 约束都由官方运行时建）。JSON 的 3.6 骨骼直接走官方 `SkeletonJson`。转换器读不对（截断 / 不是 3.6）会抛错，播放器报「骨骼解析失败（Spine 3.6.x，运行时 3.6）」，不会静默画空。
  - 3.6 和 3.8 都是全局 `var spine = …`，所以 3.6 取文本后包进函数里隔离执行，不覆盖 3.8 的全局 `spine`，同一页可以共存。
  - 3.6 的 `Skeleton` 没有 `scaleX / scaleY`（3.8 起才有），布局缩放改为乘到根骨骼的局部 x / y / scale 上再更新世界变换。
  - 已知取舍：转成 JSON 对象后纯整数的名字（动画 / 皮肤叫 `1`、`2`）会被排到最前面，动画列表顺序可能和文件不同。3.7 仍不支持。
  - 测试：`node scripts/dev/fe-gal-spine36-selftest.mjs`（需要 `PLAYWRIGHT_PATH`）。用官方 3.6 示例里成对的 `.skel` / `.json`（测试时下载到临时目录）逐项比对过转换结果；**没有真实的 Grenze 3.6.38 文件测过**（只测过合成骨架和官方 3.6.32 / 3.6.52 示例）。

### 脚本 gal-layout（所有 Gal 游戏合一）

- **分发**：`config.game.id` 填了（导入时写的）就只走那个游戏的探测（`uviewer` / `monmusu` / `tenkeiprdx`）；认不出结构：uviewer 退回通用配置，别的跳过（不乱改）；不认识的 id 跳过。
  没填 `game.id`：按 monmusu → tenkeiprdx → uviewer 的顺序探测，谁认出来谁认领（把 `game.id` 写回 config，并打 `Gal游戏: <id>` 标签）；都认不出 → 通用配置，不认领。
- 加新游戏 = 在 `LAYOUTS` 表里加一项（目录配置）+ 写一个探测函数并在 `DETECTORS` 里登记；不用新建脚本、不用多勾一个。
- **已知布局表 `LAYOUTS`**（`scripts/tag-scripts/gal-layout/main.js` 开头，单文件，上传一个 main.js 就够）：「游戏 id → 目录配置」只在这一处。发现某个游戏的目录配置不对，改这张表（或者在脚本选项 `layouts` 里按 id 覆盖某几个字段：`{"legeclo": {"bases": ["", "game", "weird/game"]}}`，整个字段替换），上传新版本重跑，不用改镜像。探测函数只做依赖数据的事（数脚本、挑封面、从真实文件里认头像模板 / 菜单按钮图、分类节点、读标记文件内容）。
  - 每项的字段（**所有列表都是数组**，哪怕现在只有一个元素）：`bases`（相对条目目录的候选 base，`''` = 条目目录本身，如 `['', 'game']`、`['', '*_Data/StreamingAssets/*']`）、`anchors`（base 下必须全在）、`siblings`（至少一个在）、`markers`（没声明 `game.id` 时才查；数组项 = 任选其一）、`scriptRoots`（`[{id, dir, label}]` 候选，存在的都写）、`resourceRoots`（候选，第一个存在的）、`adapters`（默认适配器 id）、`adapterOptions`（适配器参数模板，各适配器的选项形状不变：字符串 / 数组原样，`{path: [候选…]}` = 单个路径，`{paths: ['a', '?b']}` = 路径数组，`?` 开头 = 存在才写）、`config`（固定的引擎字段：`scriptExtensions` / `hiddenDirs` / `labels` / `merge` / `views` / `groups` / `thumbSources` / `namesFiles` / `thumbsDirs` …）、`count`（数脚本：`[{dir, ext, depth}]`）、`cover` / `avatars` / `scriptIndexScan`（封面 / 头像 / 菜单按钮图的规则）、`expectedDirs`、`nodes`、`notes`。
  - 路径写法：字面量只 stat；`*` 展开一级目录（段内也行，`text*`）；`/re/flags` 正则段（捕获组在 `scriptRoots` 的 `id` / `label` 里写 `{0}` `{1}`），带正则的路径写成数组 `['TextAsset', '/^easy_dialog-\\d+\\.xml$/i']`。
  - 别名用 `extends`：`aster` / `jaxin` / `maid` / `aku` / `fruits` → `girlscreation`，`deepone` → `uviewer`（只写 `{ extends, title }`，不拷贝）；写回 `config.game.id` 的是条目声明的 id。
  - 解析顺序：① 先按 `bases` 候选（只 stat，不遍历）依次查，`anchors` 全在、`siblings` 至少一个在就算命中，日志「已知布局命中：…」；② 都没命中才在条目目录下广度优先搜索（深度 `searchDepth`，判据相同），日志「已知布局没命中，改用搜索：…」（所以多套了一层 / 挪了位置的目录照样认）。没填 `game.id` 时按 `autoOrder` 顺序探测、再看 `markers`；声明了 id 就不看 markers。
  - 表项写坏了（类型不对 / 正则不合法 / 非数组）不会崩：坏的项丢掉、日志说明；整项不可用就退回内置的。
- **这次运行的改动情况**：返回的日志里有一段（汇总行在前，如 `本次改动：新增 3 项 / 修改 2 项 / 删除 0 项 / 未变 9 项（共 14 个字段）`，完全一样就是 `没有改动`；dryRun 前面加 `【dryRun】将要产生的改动`，仍然不写）。逐字段和条目现有 config 对比（合并语义：本次写了的顶层字段整个替换、没写的「保留」；`replace: true` 时没写的是「删除」；补丁里的 `null` = 删除）：数组列出增删的项（深度 JSON 相等比较）、标量 旧 → 新、对象列出改了的键（`adapterOptions` 按适配器 id）；`config.script`（版本 / 运行时间）不算改动；另有标签增删、`game.id` 是否写回 / 变化、命中的覆盖项改了哪些字段。长值截断（约 200 字，写明总字数），改动段 ≤ 8 KB 且不超过服务端对日志的限额（80 行 / 每行 500 字），放不下写「… 另有 N 项」。结构化版本在 `details.changes = { summary, added, changed, removed, unchanged, kept, tags, game, overrides, … }`（`added` / `changed` / `removed` 是 `{field, info}`，`unchanged` / `kept` 是字段名）。没识别 / 跳过的路径输出 `没有改动（未识别 / 已跳过）`。
- 测试：`node scripts/dev/gal-layout-selftest.mjs`（表的 schema、20 个 id 都在、别名、各游戏 fixture 的探测结果和 `gal-layout-golden.json` 逐项一致、decoy 目录、搜索回退、改动报告）。探测结果有意改变时用 `--update-golden` 重新生成 golden。
- 下面是 UViewer 的探测细节（别的游戏见上面各自的小节）。

- 探测：`user_data/settings.json` 的 `resource_path`（默认 `./resources`）下有 `download/adv/text` → UViewer；同级 `text*` 目录当作另一套文本；
  路径多套了一层就往下找（深度 ≤ 6）；都不认识 → 通用配置（整个目录当脚本根，找不到的资源去掉 `download/` 再试）。
- 封面：前几个脚本里，先找 UViewer 自己生成的缩略图，再找脚本里第一张存在的背景图；统计脚本数。
- 选项 `overrides`：`[{path, config?, cover?, title?}]`，按媒体目录的真实路径（通配或 `/正则/`）给个别媒体单独覆盖任何配置；
  其他选项：`dryRun`、`replace`、`coverScanLimit`、`countCap`。
- 状态标签：`Gal配置: uviewer / 通用 / 自定义`、`Gal配置version: <脚本版本>`。
- 脚本通过配置页的「上传元数据脚本」安装（覆盖同 id 的旧版本）。注意 `TAG_SCRIPTS_DIR` 要是持久目录（默认是数据目录下的 `tag-scripts`），指到镜像里的目录会在重建容器后丢掉上传的版本。

## 卡片缩略图：数组、随机封面、悬停轮播、`thumbSources`、视频帧

- **数组模型**：浏览节点里每张卡片带 `thumbs: [路径…]`（所有存在的候选，按真实文件去重，最多 12 张）；`thumb` 仍然 = `thumbs[0]`（旧客户端 / 旧测试照常）。一张图都没有时 `thumbs: []`、`thumb: ''`，`thumbWhy` 写每个来源试了什么（列表页「渲染诊断」里看）。
  - 脚本卡片的来源顺序：`scriptThumbs` 模板（通配全展开）→ `thumbSources`（`for` 含 script 的）→ `scriptIndex` → 脚本里第一张背景图（**前面都没有才用**）。目录 / 分组卡片：`dirThumbs`（parent、name 匹配的全部规则）→ `thumbSources`（`for` 含 dir 的）。
  - 通配（`dirThumbs.paths` / `scriptThumbs` 里）：`*` = 段内任意字符，`?` = 单个字符，不跨 `/`；匹配到的全部都算，按自然序；目录列表按目录 mtime 缓存（每个目录最多读 2 万项，一次展开最多 400 个路径）。
- **前端**（`web/static/gal-browse.js` + `thumb-cycle.js`）：`thumbMode` = `random`（默认）每次渲染随机一张当封面（一次渲染内稳定，刷新才换）；`first` = 永远第一张（旧行为）；`hover` = 封面第一张、悬停才轮播。有多张图的卡片鼠标悬停 → 其余图随机顺序轮播（每张 700–900ms，先预加载下一张再换），移开立刻停并还原封面。不悬停的卡片不做任何事；`prefers-reduced-motion`、触摸、标签页在后台、封面还没加载好都不轮播。封面的首次加载仍走 `thumbLoader`（`data-src` 分批），轮播只在它加载完之后改 `src`；封面加载失败先换同一张卡片的下一张，都失败才报「加载失败」。
- **`thumbSources`**：`[{ dir, match, key, for, forKey, forMatch, kind, limit, fallback }]`。每条规则只列一次 `dir`（相对资源根；`~/` = 相对媒体目录，只有 `thumbsDirs` 读得到；可带通配），建成 `键 → 文件[]` 的索引（按 mtime 缓存）；卡片用自己的键去查。
  - `match`：正则，对 `dir` 里的**文件名**（含扩展名）；`key`：文件的键，`{1}{2}` = 捕获组、`{名字}` = 命名捕获组（默认 `{1}`）。
  - `for`：`script` | `dir` | `both`（默认）；`forKey`：卡片的键，`{stem}`（脚本名）`{name}`（目录名 / 分组键）`{parent}`，默认脚本 `{stem}`、目录 `{name}`；`forMatch`（可选正则）：先对 stem / name 匹配，`{1}`… 也能写进 `forKey`，不匹配 = 规则不适用。
  - `kind`：`image`（默认，png jpg jpeg webp gif avif bmp）| `video`（mp4 mkv webm mov m4v）；`limit`：每张卡片最多几张（≤12）；`fallback: true`：前面都没找到图时才用。
  - 例（legeclo，gal-layout 写的）：`{dir:'images/thumbnail/st', match:'^hs_(.+)_st_(\\d\\d)\\d\\d(?:_(?:idle|hover))?\\.png$', key:'{1}_{2}', for:'script'}`——`hs_artemis_halloween_st_0301.png` → 键 `artemis_halloween_03` ↔ 脚本 `artemis_halloween_03.rpy`；同一话的 `0201` / `0202_idle` / `0203_hover` 全进数组；再来一条 `dir: 'images/st'` + `fallback: true` 退回整张场景图；角色卡片 `{dir:'images/thumbnail/char', match:'^st_(.+?)(?:_(?:idle|hover))?\\.(?:png|webp)$', key:'{1}', for:'dir'}`。
  - deepone / UViewer：默认 `dirThumbs` 的路径是 `download/character/{name}00/adv/image/{name}00.png`、`…_100.png`，再加 `download/character/{name}??/adv/image/{name}??.png` / `…_100.png`——资源目录是 `<4 位编号><2 位变体>`（`100181`、`102307`、`102309`…，几乎没有 `00`），`??` 把每个变体都收进数组，有 `00` 的排最前。
  - **minashigo / misttrain 暂未实现**（映射没确认）：minashigo 的 `images/thumb/<12 位数字>_360.jpg` ↔ `scene_<9 位数字>`、misttrain 的 `Textures/Characters/Bases/<id>201.png`；映射确认后只要写 `thumbSources`（`match` 取数字、`forMatch` / `forKey` 把脚本名转成键）就行，不用改代码。
- **视频帧缩略图**：候选（`thumbSources` 的 `kind: 'video'`，或模板解析到 mp4 / mkv / webm / mov 文件）在 `thumbs` 里仍是视频的路径；前端取图时带 `frame=1`（`…/resource?path=…&frame=1`），服务端用 ffmpeg 截一帧 JPEG（视频时长的 10%，最多 30 秒，读不到时长用第 1 秒；宽度 ≤640）缓存到 `<DATA_DIR>/cache/gal-thumbs/<hash 前两位>/<sha1(真实路径, mtime, size, 参数版本)>.jpg`（`gal/video-thumb.mjs`）。路径照常经过 `resolveAsset`（只认媒体目录内的真实路径），非视频 → 415；同时最多 2 个 ffmpeg、20 秒超时、同一视频并发只截一次，失败 30 秒内不重试（422，说明原因：ffmpeg 没装 / 超时 / 视频损坏），卡片显示无图状态并在诊断里报「加载失败」；缓存命中 = 按文件发送（ETag / 304，`max-age=7 天`）。ffmpeg 不在 PATH 里就是上面的失败路径（Dockerfile.web 装了 ffmpeg）。
  - 扩展点：骨架（spine / live2d）截图暂不做；以后在 `thumbSources` 加 `kind: 'skeleton'`，在 `gal/thumbs.mjs` 的 `collectSources` 里接渲染器、结果同样缓存到 `cache/gal-thumbs`。
- 测试：`scripts/dev/gal-selftest.mjs`（键提取 / 数组 / 去重封顶 / deepone 变体 / legeclo 映射 / thumbMode / 帧缓存）、`scripts/dev/fe-gal-thumbs-selftest.mjs`（端口 8162：随机封面、悬停轮播、reduced-motion、thumbMode、加载失败、视频帧）。

## 浏览节点（取数接口 = 通用的 reader）

前端不认识目录，只认节点。取节点就是通用的 `GET /api/library/items/gal/<id>/reader/main?sectionId=<节点 id>`
（`sectionId` 是 epub 就有的参数，路由 `#/media/gal/<id>/main?section=…`、进度、历史都是现成的）。
取到的是文本（`player`）就按文本渲染，取到的是选项（`cards`）就继续按选项渲染。

| 节点 id | kind | 内容 |
|---|---|---|
| `''` | `cards` | 首页：默认脚本根下的目录 |
| `d:<相对路径>[#页]` | `cards` | 目录：目录卡片在前、脚本卡片在后（缩略图、第一句台词、来源标记 `badge`），每页 `pageSize` 张 |
| `s:<相对路径>` | `player` | 播放页：带规范场景；`sectionNavigation` = 列表里（合并目录时跨来源）相邻的上/下一个脚本 |
| `@<脚本根 id>\|…` | | 非默认的文本版本（另一种语言）；节点带 `sets` 列表，前端做下拉 |

每个节点带 `parent`（返回上一级，卡片列表带页码，所以返回会回到点进来的那一页）和 `breadcrumb`（被合并掉的目录不出现）。
脚本节点 id 始终是真实路径，所以合并目录不影响进度/历史。
脚本根读不到时（目录没按标准结构放）首页是空的，带一条 `notice` 提示去跑脚本。
**以后加新的渲染方式 = 新增一个 kind + 前端一个渲染函数**，取数接口不变。
大目录靠翻页和按需读取：只列当前目录，读脚本头/内容只对当前页做，并按 mtime 缓存；子目录只显示直接数量。
进度只记播放页（`s:…`），每个脚本各记各的（`progress.nodes`，含选项的选择），在列表里逛不会冲掉「上次看到哪」。

## 分支（select / if）

适配器把 `select,選項1　甲,選項2　乙` 变成 `choice` 指令（选的序号 1 起，记进变量 `select`），把 `if / elseif / else / endif`
变成每条指令上的 `when` 条件（不配对的 `endif` 忽略）。播放时只执行条件成立的指令，没选中的分支整步跳过；变量没设过（还没选）时带它的条件都不成立。
选项出现在画面正中、竖排；数字键 1–9 也能选。选择按 `choice.id` 存进进度，所以回看 / 刷新续播能重放同一条路；
往回走到选项那一步 = 重选（这一步起的选择作废）。工具栏「自选」开关：「设置」里设 `-1` 关 / `0` 随机 / `1 2 3…` 选对应项（没有该项就随机）。

## 数据流（不落地、不缓存）

```
作品目录/脚本文件 ──读──▶ 适配器 parse() ──▶ 规范场景 gal-scene/1 ──HTTP──▶ 前端播放器（static/gal-player.js）
                                              (library/gal/scene.mjs)
```

- 适配器只做「原始文本 → 规范场景」：`web/library/gal/adapters/*.mjs`，在 `adapters/index.mjs` 登记。
  现在只有 `uviewer-csv`。**接新格式 = 新写一个适配器（id / label / sniff / parse）**，播放器不用改。
- 规范场景的指令集见 `scene.mjs`。适配器认得但播放器还没实现的指令（立绘 `spriteatlas`、`anm`、`mask`、`imgconf`、`spine`…）
  以 `raw` 原样保留（带参数），后面加对应渲染方式时直接用，不用重新解析。
- 以后要缓存：只需要在 `getReaderContent` 里给 `buildScene()` 外面套一层。

## 安全

- 资源解析和脚本读取都只认媒体目录之内的真实路径（`..` 和指出去的符号链接都拒绝）。
- 资源接口的 `~/` 只放行缩略图缓存目录（`thumbsDirs`），读不了 `user_data` 里别的文件（比如授权文件）；封面接口可以指到媒体目录里的任意文件。
- config 的每个字段都在读/写时规整：路径不许绝对/`..`，数量有上限，非法的丢掉或退回默认。

## 播放器（第一期）

背景（渐变/纯色）、说话人和台词（描边/颜色/粗斜体/`<size>` 相对字号/`<ruby>` 注音）、BGM/语音/音效、黑场、wait、视频、点击/键盘推进、后退、自动、回看记录、续播。
快捷键：空格/回车/→ 下一句，←/Backspace 上一句，A 自动，X 快进开关，L 记录，F 全屏，I 沉浸（默认进入，和其他类型一致，Esc 退出并记住）。
按钮在文本框底部（小号）。「设置 ▾」是**一个**弹层（原来的 ⚙ 设置和「更多」菜单合并；按钮上 `.gal-cfg` 和 `.gal-more-btn` 两个类名都留着），分四组（标题是 `data-title`，不占子元素位置）：
- **显示**：字体大小（60%–200%，脚本里的 `<size>` 跟着一起缩放）、文本框背景透明度、沉浸、全屏；
- **音频**：BGM 音量、语音/音效音量（滑块旁显示百分比，见下「音量曲线」）；
- **播放**：自动播放的「语音结束后等待秒数」（0–30，默认 1；没有语音的句子按字数估算时长）、自动选择（-1 关 / 0 随机 / 1 2 3…）；
- **画面**：动画 4 降速、帧动画速度、画面放大 / 选择中心、角色摆放、混合模式、表情…、显示马赛克层（后几项有对应内容时才出现）。
弹层内容多时自己滚动。弹层开着时点舞台 = 只收弹层（不翻页），Esc 也是先收弹层。设置存在浏览器 localStorage。以下文档里写的「更多 → X」现在都是「设置 → 画面 / 显示 → X」。
**文本框**：文本框矩形在任何一步都不变——名牌（`.gal-name`）固定占一行（旁白时加 `.gal-name-empty` 只是看不见，仍占位），台词区（`.gal-text`）固定 2 行高（按字体大小设置算，`--gal-fs * 3.4`）。台词放不下时只缩台词字号（`--gal-fit`，相对设置里的字号，二分查找，最小 0.6，带 `<size>` / ruby / 描边的也算在内）；缩到最小还放不下就保持最小并允许在台词区里滚动（隐藏滚动条；完整台词在「记录」里）。只在换句子 / 舞台尺寸变化（ResizeObserver，含沉浸 / 全屏）/ 改字体大小时量一次。「放得下」按台词区高度判断（缩字时行高跟着缩，所以最小字号时能放下约 3 行多）。
**快进**：工具栏「快进」是锁存开关（点一下一直快进，再点或按 X 停；按钮高亮），走的是和按住 Ctrl 同一套快进（动画 / 语音跳过）。按钮开的快进在**遇到选项时停下并自己关掉**，到脚本结尾或离开播放器也关；按住 Ctrl 的快进仍然是遇到选项暂停、选完接着走。
**音量曲线**：滑块位置 p（0..1，步长 0.02）→ 实际增益 `volumeGain(p) = p²`（`gal-engine.js` 导出的纯函数），BGM、语音 / 音效、视频、背景人声、BGM 淡出都用它。localStorage（`copymanga.gal.bgmVolume` / `seVolume`）存的是**滑块位置**。迁移：旧版把存的值直接当线性音量用，现在按滑块位置解释，同一个旧值会变轻（例如 0.5 从 50% 变成 25% 的增益）；没存过的 BGM 默认位置改成 0.7（≈ 原来线性 0.5 的响度）。
沉浸是整个页面的状态：浏览层和播放页共用（默认进入；`I` 切换；`Esc` 退出并记住；沉浸里浏览层的顶栏有「退出沉浸 / 返回」）。
动画中按下一句 = 跳过动画（不是前进）。

自测：`scripts/dev/gal-selftest.mjs`（适配器/引擎/handler）、`scripts/dev/fe-gal-selftest.mjs`（浏览器）、`scripts/dev/fe-gal-player-ui-selftest.mjs`（播放器界面：固定文本框 / 快进按钮 / 合并弹层 / 音量曲线，端口 8161）；
测试数据：`scripts/dev/make-gal-fixture.mjs <目录>`。

## 列表视图、回退轨迹、渲染诊断

- **列表视图**：筛选 / 排序 / 每页条数写在节点 id 里：`<基础 id>|q=…&s=name|name_desc&n=25|50|100|200|500[#页码]`（只写和默认不同的；脚本节点 id 不带视图参数，进度按 `s:` id 记）。节点返回 `viewBase`（不带视图和页码的基础 id）和 `view{q,sort,size,defaultSize,sizes,sorts,unfiltered}`，前端只拼 id。筛选 / 排序在整张名单上做（只有名字，便宜），读脚本摘要 / 缩略图 / 数量只对当前页做。浏览器端搜索框 400ms 防抖，每页条数、跳页输入框、首页/末页都在工具栏和翻页条里。
- **读目录的缓存**：浏览 provider 在进程内缓存 sniff / 目录列表 / 脚本摘要 / 数量（目录 mtime 变了就失效，脚本摘要 5 分钟 TTL），sniff 并发 16。1000 个脚本的目录热请求约 13ms。
- **回退轨迹**（`app.js` 的 `galNavigate`）：从列表点进下一层时记下当前列表的完整节点 id（含页码、筛选、排序、每页条数），往上走（上一级 / 面包屑 / 播放页的「列表」）回到记下的那个 id，而不是服务端算的默认第 1 页。存在 sessionStorage，每个单元一份。
- **config.rawIgnore**：正则字符串列表（不分大小写，最多 50 条，非法的丢掉）。播放器里「N 条指令暂未渲染」不计入匹配的指令（匹配指令名和 `指令名,参数…`）；节点 `rawIgnore` 带给前端。`gal-layout` 脚本有同名选项（全局值），某个媒体要单独的用 `overrides[].config.rawIgnore`。点右下角的提示可展开诊断面板（按指令名汇总 + 样例 + 缺资源 + Spine 状态），可一键复制。
- **「更多」菜单（浏览层）/「设置」弹层（播放器）**：沉浸 / 全屏收在里面（快捷键 I / F 不变）；沉浸按钮不再高亮。播放到最后一步且有下一章时，工具栏出现「继续下一章 ▶」。

## legeclo（Ren'Py，label H_<角色>_<编号>）

- **独立的 adapter `renpy-legeclo`**（`adapters/renpy-legeclo.mjs`），上下文（视频别名表 + 图片目录自动命名）复用 monmusu 的，解析自己写：
  - sniff：`label H_xxx:`（大写 H + 下划线）+ `$ enable_skip()` 或 `play voice "…"`；monmusu 的 label 是 `h<数字>`，不会被它认走；两个都允许时 legeclo 的脚本归 legeclo。
  - `scene <图片名> [with 转场]`：先查视频别名 → 图片目录（`images/` 下的文件按无扩展名的文件名自动命名）；名字里带 `black` 的当黑底（那张黑图不当背景图、也不会被拿去当缩略图）。
  - `show <立绘图名> [at left|right|center]`：立绘 = `images/sprite/` 下的**一整张图**（表情各是一个文件）→ `stand` 指令（单个部件、无裁剪）；不同的图名是不同的 tag，同时显示（和 Ren'Py 一样）；`hide <图名>` 去掉；`scene` 清掉所有立绘。`at left / right / center` → 部件的 `align`，立绘层给每个有 align 的部件各自独立摆放（底边对齐、水平贴左 / 居中 / 贴右）。
  - `play music / voice / sound`、`stop music fadeout (n)`、`"名字" "台词"` / `"" "旁白"`、`pause`、`with Dissolve(n)` 同 monmusu；`$ …`（python）、`hide screen …`、`stop voice` 忽略。
  - 不处理：翻译叠加（`tl/jptoen`、`tl/jptocn` 里的 `translate` 块）；只有 `.rpyc` 没有 `.rpy` 的脚本（编译产物，读不了）。
- **目录**：`game/script/hscene/<角色>_<编号>.rpy`（角色 id 可以带下划线，如 `agnes_boulanger_02`）、`game/script/movie.rpy`（视频别名）、`game/images/{bg,sprite,thumbnail/char,mo}`、`game/audio/{bgm,voice}`。`script/nav/` 里是导航界面，不是剧情。
- **`gal-layout` 探测**：目录结构和 monmusu 很像（都有 `script/hscene`、`script/movie.rpy`），所以靠名字区分：`options.rpy` 里有 `legeclo`，或游戏根旁边有 `legeclo_py.*`（启动器）；声明了 `game.id: legeclo` 的不要求这个标记。探测顺序 legeclo → monmusu → …。
  - 脚本根直接是 `game/script/hscene`，资源根 `game/`；按 `^(.+)_\d{2}$` 分组（去掉末尾两位编号 = 角色）；缩略图走 `thumbSources`（脚本 `images/thumbnail/st/hs_<角色>_st_<话><变体>[_idle|_hover].png`、退回 `images/st/`；角色 `images/thumbnail/char/st_<角色>[_idle|_hover].png`，变体全进数组，见「卡片缩略图」）；这些都没有时，脚本封面 = 脚本里第一张真正的背景图。
  - 导入：`adapters: ['renpy-legeclo']` + `config.game.id: 'legeclo'`。

## Girls Creation R Viewer（标签式脚本）

- **独立的 adapter `girlscreation-tag`**（`adapters/girlscreation-tag.mjs`），解析每个场景目录里的 `script.txt`（标签式：`<TAG>参数`，一行里可以连着几个标签）。同目录里逗号式的 `script_original.txt` / `original_script.txt`（只有部分场景有）不解析，只拿来取标题（`title,<标题>,`）。
- **目录**（`<root>` = `package.nw`，记在 `config.adapterOptions['girlscreation-tag'].root`）：`<root>/scenes/<场景 id>/{script.txt, thumbnail.png, images/, videos/, voices/, spines/}`，全局 BGM / 音效在 `<root>/data/audio/{bgm,se}/`。场景自己的资源按脚本所在目录拼，所以路径不依赖资源根下的公共目录。
- **指令**：`<NAME_PLATE>[说话人]` + 下一行起的正文 + `<PAUSE>` = 一句台词（一步），`[br]` 换行，NAME_PLATE 空 = 旁白，光秃秃的 `<PAUSE>` = 一个空步；`<BG>`（`images/<名>.*`）/`<BG_OUT>`、`<FADE_OUT2|FADE_IN2>black|white`、`<WAIT2>`、`<BGM_PLAY|STOP>`、`<SE_PLAY|STOP>`（循环的走背景音效声道）、`<VOICE_PLAY|VOICE_SINGLE_PLAY>`、`<VIDEO_PLAY|VIDEO_STOP>`、`<SCENARIO_END>`。最后一个 `<PAUSE>` 之后的收尾指令并进最后一步。
- **Spine 角色**（3.8 二进制，`.skel` / `.atlas` / `.png` 同名放在场景自己的 `spines/`）：`<SPINE_ACTOR>槽,骨架名,,,,0,淡入ms,x=..|y=..,缩放,skel` → `spine` 指令（`kind: 'actor'`、`slot: Actor<槽>`，最多 4 个槽，同一套骨架可以放在两个槽里）；`<SPINE_ACTOR_PLAY>槽,动画,轨道,循环` → `tracks`（轨道 0 = 身体，轨道 1 = 表情 `ex_<名>`，同时播）；`<SPINE_ACTOR_MOVE>` → `move`（秒，平滑移动）；`<SPINE_ACTOR_OUT>` → `spineOff`。脚本要的动画名骨架里没有的，记在 `missingAnimations`，渲染诊断里能看到。**角色的摆放（x / y / 缩放的单位和锚点）是照脚本参数猜的**：骨架包围盒先整个放进舞台，再乘缩放（绕舞台中心），x / y 按 1920×1080 设计稿的像素偏移（x 向右、y 向下）；没有原查看器的对照图。
- **暂未渲染**（记在 `stats.raw`，渲染诊断里能看到）：`SCREEN_SHAKE`、`EFFECT_BG_BLUR`、`BG_SCALE`、`SE_VOLUME`、`SPINE_MASK_OPACITY`、`FADE_*_COLOR`、`UI_DISP`、`BG` 的缩放 / 位移参数。
- **列表**（`adapter.catalog`，每次从文件现读）：分类（场景 id 前缀 `chmr` / `chsr` …，可以用 `adapterOptions['girlscreation-tag'].categoryLabels` 起名字）→ 主要说话人（场景里出现最多的、不是 `館長` 的名字；`adapterOptions.player` 可改）→ 场景（标题取自原始脚本的 title 行，没有就用 id；封面 = `thumbnail.png`）。读取场景开头 24KB 来取标题和说话人（`contextTextFilter`，最多 3000 个文件）。
- **`gal-layout` 探测**：`scenes/<场景>/script.txt` + `data/audio`（或 `sceneData.js`）；声明了 `game.id: girlscreation` 的不要求后者。探测顺序 legeclo → monmusu → girlscreation → tenkeiprdx → …（tenkeiprdx 也有 `scenes/`，但里面是 json 且旁边有 Backgrounds / Spines）。导入：`adapters: ['girlscreation-tag']` + `config.game.id: 'girlscreation'`。
- **不处理**：中文翻译（`sceneData.js` 里是同一批场景的另一种语言的文本）；行内标记只有 `[br]`。

## minashigo（Ren'Py，MinashigoViewer）

- **独立的 adapter `renpy-minashigo`**（`adapters/renpy-minashigo.mjs`），和 `renpy-monmusu` 互不影响：sniff 要求这个格式独有的写法（`$ name= "…"` 或 `xyz "…"`），monmusu 的脚本不会被它认走；两个都允许时 minashigo 的脚本归 minashigo、monmusu 的脚本归 monmusu。导入时填 `adapters: ['renpy-minashigo']` + `config.game.id: 'minashigo'`，`gal-layout` 脚本按 `game.id` 或目录结构（`game/scripts/` + `game/script.rpy` 里的 `DynamicCharacter("name")`）认出它。
- **写法**：说话人来自 `$ name= "…"`（空 = 旁白），台词是 `xyz "…"`（一句一步）；`play music / voice2 / queue sound '…'` → bgm / voice / se；`scene <图片名>`（先查 `movie.rpy` 里的 Movie 别名，再查图片目录；`black1` 这类没有图就是黑底）；`show black` / `hide black` 黑场；`with flash…` 闪屏；`stop music`。
- **立绘**：`script.rpy` 里的 `layeredimage standimage`，每个 `attribute` = 立绘图集上裁出的一块（`im.Crop("images/stand/…png",(x,y,w,h))` + `zoom` / `xpos` / `ypos`）。脚本里 `show standimage <属性…>` 逐个攒，到下一句台词前合成一条 `stand`（parts 按定义顺序）；`hide standimage` / `scene` → `standOff`。播放器用 canvas（`gal-stand.js`，1920×1080 设计坐标）按 Ren'Py 默认摆法（底边对齐、水平居中）画出来。
- **适配器参数**（`config.adapterOptions['renpy-minashigo']`，路径相对媒体目录）：`{ aliasFiles: ['game/movie.rpy'], standFiles: ['game/script.rpy'], imageDirs: ['game/images'] }`。路径和实际不一样时用 `gal-layout` 的 `overrides` 改（资源根 `resourceRoots` 默认 `game/`，音频 / 图片路径相对它）。
- **分组**：`scene_<1 位类别><6 位角色编号><2 位序号>` 按角色编号归成一张卡片，主线（`scene_2100002`）/ 活动（`scene_ev059_00_02`）照常列出；改规则用 `groups`。
- **暂未渲染**：别的特效图（`show slash_1` 之类）只记在 `stats.raw`，播放器提示里能看到，可用 `rawIgnore` 允许。

## Gal 的导航统一放底部

- **页面级头部**（标题 + 沉浸 / 上一章 / 目录 / 主题 / 下一章 / 返回）在 Gal 里挪到了最下面（CSS 重排，只对 `media-mode-gal` 生效，别的媒体类型不变）；Gal 里用不到的「宽度」「上一页 / 下一页」隐藏。窄屏整页滚动时它粘在视口底部，列表固定条再往上让出它的高度（`--gal-foot`，`app.js` 用 ResizeObserver 量）。沉浸时头部收起。
- **列表页**：只有一条底部固定条（`.gal-browse-bar`，不管往上还是往下滚都在同一个位置）：第 1 行位置（面包屑，每级可点）+ 共 N 项；第 2 行 `[↑ 上一级] [« ◀ 上一页] [页码 / 总页] [跳转] [下一页 ▶ »] …… [更多 ▾] [返回]`。和播放页底栏同一个顺序（↑ 列表 → ◀ ▶ → 计数 → 更多 → 返回）。
- **「更多」向上展开**，放不常用的：搜索 / 排序 / 每页条数 / 文本版本 / 沉浸 / 全屏。在里面改搜索、排序、每页后菜单保持打开（接着改别的）。
- **位置固定**：按钮不会因为状态消失，只会禁用——首页的 `↑ 上一级`、只有一页时的整条翻页条、播放页没有上一级时的 `↑ 列表`。
- **列表和播放器的底栏位置统一**：播放器的工具栏从舞台里（原来叠在文本框底部）挪到了舞台下面、播放器最底部，和列表页底栏用同一套样式、同一个宽度公式（`min(100%, max(520px, (100vh − 250px) × 16/9))`）、同样的内边距，阅读区都撑满高度——所以数据再少，列表的底栏也贴最下沿，「↑ 上一级」和「↑ 列表」在几乎同一个位置（`fe-gal` 里量了：差不到 16px）。沉浸 / 全屏时两个底栏都用深色。

## tenkeiprdx 位置数组形：角色项的字段顺序

`adventureCharacters` 的每个角色项（数组形）按对象形里这些键的声明顺序读：`[0] 角色 id、[1] 外观、[2] 站位、[3] 动作、[4] 表情图标、[5] 表情`。样本里 `[3]` 在有语音的那句从 0 变 4（像是说话动作）、`[5]` 恒为 2，和这个顺序吻合，但没有对照样本，所以 `stats.arrayGuess` 里一直标着「推的」。播放器右下角的提示点开（诊断面板）能看到每个骨架实际用了哪个动画、骨架里有哪些动画 / 皮肤，可以复制出来核对。

## 播放器快捷键补充

- **Ctrl**（按住约 0.25 秒）：快进——连续翻页，动画 / 语音 / 音效都跳过；遇到选项暂停（选完接着快进），到最后一步或松开就停。Ctrl+其他键（查找 / 复制）不触发。
- **X**：快进开关（同工具栏「快进」按钮）。
- **Alt**（单按一下）：切换自动播放；Alt+其他键不触发。


## 文件索引 / 列表阶段的问题 / 节点图（config.nodes）

### 文件索引与刷新
有 `prepare` 的适配器（tenkeiprdx / misttrain / girlscreation / monmusu …）要先遍历资源目录建一份文件索引（`gal/context.mjs`）。索引放在内存里：默认最多 40 万个文件（约 76MB），适配器可用 `contextWalkLimit` 调（封顶 200 万），超了会被截断并在界面上提示。
缓存失效：文本文件按 mtime+size，目录自己和下一层子目录按 mtime，更深的最多缓存 5 分钟。列表页「更多」里有一行「文件索引：N 个文件 · 建立于 … 〔刷新〕」，点刷新 = `POST /api/library/items/gal/<id>/index-refresh`：丢掉这个条目的全部浏览缓存（上下文、嗅探结果、目录列表、脚本摘要、数量），按磁盘现状重建，然后重取当前节点。

### 列表阶段的问题（node.problems）
列表节点上带 `problems: [{ level, code, message }]`，进「渲染诊断」（error 级的还直接显示在列表上方）。都是便宜的检查，不解析脚本：
索引被截断 `index-truncated` · 脚本根不存在 `script-root-missing` · 目录里扩展名对但没有适配器认得的文件 `unrecognized-scripts`（以前悄悄丢掉，规则对不上就永远发现不了）· 适配器没读到可用数据已退回目录浏览 `catalog-empty` ·
适配器自己的体检 `health(ctx)`（girlscreation：没有脚本的场景目录 / 没有标题 / 没有封面 / 没有 data/audio；misttrain：没读到名称表 / 没有标题 / 没有 Spines 目录；tenkeiprdx：没读到名称表 / 没有剧情）· 节点图的 `graph-*`（见下）。
缺什么资源、哪些指令没渲染仍然是打开脚本时才完整检查（播放页的渲染诊断）。

### 节点图 config.nodes
`config.nodes` 是从 `home` 开始的一张图；有它时首页和所有列表都由它给（优先于适配器 catalog 和真实目录），翻页 / 筛选 / 面包屑 / 上一话下一话沿用 catalog 那一套。节点之间有两种边：
`children`（包含，浏览用的树，返回上一级沿着它）和 `related`（关联，只做「相关」跳转链接，不当父子；从相关节点点「上一级」回到来路）。

```
nodes: {
  home:   { children: ['chars', 'events'] },
  chars:  { title: '角色', text: '描述文字', expand: { dirs: ['chars/*'], as: 'char' }, related: ['events'] },
  char:   { title: '{label}', subtitle: '{name}', dirs: ['{path}'] },        // 模板节点：{name} 目录名 · {path} 脚本根下的相对路径 · {label} 名称表里的显示名
  events: { title: '活动', dirs: ['events', 'events2'], match: '^ev' },      // 多个目录合在一起；match 过滤脚本名
}
```
字段：`title / subtitle / text / badge / thumb(模板) / children / related / dirs(目录通配，相对脚本根，* 只匹配一段) / match(脚本名正则) / expand { dirs, as, match }`。
`dirs` = 把这些目录里认得出的脚本收进来；`expand` = 每个匹配的目录生成一个子节点（用 `as` 指的节点当模板）——新增角色目录不用改配置。
规则对不上的地方记进 problems：`graph-dir-missing`（dirs 没匹配到目录）· `graph-glob-empty`（expand 没匹配到）· `graph-unrecognized`（目录里有文件没人认）· `graph-empty`（节点没内容）· `graph-cycle`（「包含」成环）· `graph-unknown-node` · `graph-related-missing` · `graph-too-deep`。
没有 `home` 节点就当没配。要加新的节点类型 / 解析器时才需要改代码，平常改配置就是多写几个目录。

### Girls Creation 行式脚本
`scenes/<id>/hmr_<id>.txt` / `hsr_<id>.txt`（逗号分隔、一行一条命令）和标签式 `script.txt` 是同一个游戏的两种写法，适配器按内容分发（`adapters/girlscreation-line.mjs`）；一个场景目录里优先级 `script.txt` > `output_script.txt` > 行式脚本。

### gal-layout 自动生成默认节点图
tenkeiprdx / misttrain / girlscreation 的列表原来是适配器里写死的（`catalog`）。`gal-layout` 现在会顺手生成一份默认的 `config.nodes`：首页下每个适配器目录的顶层项各是一个 `auto` 节点，用 `catalog` 引用适配器原来给的那份内容——
效果和不用节点图时一模一样（自测逐层对比过卡片的标题 / 副标题 / 缩略图 / 角标 / 脚本路径，节点 id 也沿用适配器原来的，已有的链接和进度不受影响），但每一项都变成了配置：可以改标题、挪顺序、隐藏、加相关（`related`）、旁边再接自己的 `dirs` / `expand` 节点。
- 引用：`{ catalog: 'chars' }`（适配器目录里的节点 id，如 tenkeiprdx 的 event / extra / special / chars / all，misttrain 的 chars / other / all，girlscreation 的 `c/<分类>`；`'*'` = 全部顶层）。空的 title / subtitle / thumb / badge 沿用适配器节点的。
- `auto: true` 是 gal-layout 生成的标记：重跑会重新生成（新增分类 / 新增列表就是重跑一次）。**手写的 nodes（home 不带 auto）重跑时原样保留**；`replace` 整体替换时也会带上；适配器没有某个目录时（比如没有 Stills）auto 节点静默跳过，手写节点引用不存在的目录会报 `graph-catalog-missing`。
- 想改某一项：把那个节点的 `auto` 去掉（或者干脆把 home 的 `auto` 去掉）就变成手写的，重跑不会覆盖。
- UViewer / monmusu / minashigo / legeclo 本来就是按真实目录 + views / groups / merge 配置的，不生成节点图。


### Girls Creation 系列的角色摆放（「更多 → 角色摆放」）与画面放大 / 中心
- **默认 = 自动**（和以前一样）：把骨架包围盒整个放进舞台居中，脚本里的 `x` / `y` / 缩放按这个比例算，缩放绕骨骼原点（脚）。不依赖任何游戏的相机常数，所以各个游戏都不会跑出画面。
- **固定相机**（「更多」里手动选，按媒体存）：Girls Creation R Viewer（读过它的 `preloader.js` / `spine-player.js`）给每个角色一个和舞台一样大的 Spine Player，视口写死 `{ x: 0, y: 900, width: 960, height: 540, padLeft: 100%, padTop: -100% }`，展开后世界窗口 = 宽 **1920** 个骨骼单位、中心在 **(0, 900)**；
  脚本里的 `x` / `y` 是 `skeleton.x = x`、`skeleton.y = -y`，缩放是 `skeleton.scale`（× 全局 ZOOM）。所以每个骨骼单位 = 舞台宽 / 窗口宽 个像素，原点落在舞台中心 + (x − 中心X, −(y + 中心Y)) 个单位处。「更多」里三个数字：**窗口宽 / 中心 X / 中心 Y**（Girls Creation R Viewer = 1920 / 0 / 900）。
  只有 Girls Creation R Viewer 的常数是读过源码的；Angelica Aster / jaxin / maid 的查看器脚本是加密的（`.js.enc`），常数没读过——原点在画面正中的 CG 类骨架大概要 中心 Y = 0——所以交给使用者按媒体自己调，别的游戏默认不用固定相机。
- 预乘 alpha：原查看器写死 `premultipliedAlpha: true`，我们按图集标记 + 像素统计猜，渲染诊断里会列出两个来源和实际用的、非 normal 混合的槽。
- 「更多 → 画面放大 / 选择中心」**按媒体（条目）存**（`localStorage` 的 `copymanga.gal.view.<条目 id>` = `{ still: { zoom, cx, cy }, actor: { … }, camera: { mode, width, cx, cy }, showMosaic }`）：静态画面和角色各一组，当前画面里有静态画面就调静态画面，否则调角色。旧版的全局设置只在这个媒体没存过时当默认值读。

### misttrain 的马赛克层 / 空包围盒的层 / 渲染时特意不画的东西
- `still_configuration.json` 的 `Parts` 决定叠哪几层：`IsMosaic: true` 的层默认不叠，不在 `Parts` 里的文件也不叠。两种都会在渲染诊断里写明（`提示：…`）。播放器「更多 → 显示马赛克层」（这个场景有马赛克层时才出现）打开后重取脚本、叠上它们；按媒体存在浏览器里
  （`copymanga.gal.view.<条目 id>.showMosaic`，经 `reader?mosaic=1|0` 传给适配器，优先于 `adapterOptions['misttrain-json'].showMosaic`）。
- 初始姿势下没有任何可见附件的层（附件由动画打开）包围盒是 `Infinity`：不能拿它缩放（以前它序号最小时整个画面会消失），布局时跳过它、改用序号最小的有包围盒的层当参照；诊断里写「边界 无（…不当参照层）」。
- 渲染时特意不画 / 改着画的：multiply 和 screen 混合的槽按 normal 画（原查看器 `spine.js` 的注释：这两种在它那里渲染不对）；不支持的 Spine 版本（3.7 / 4.1 / 4.3）不画并报版本不支持；默认皮肤是空的就改用第一个有内容的命名皮肤；
  maid 的分层脸骨架在表情预设名对不上时用默认脸顶上（诊断里写明）。除此之外没有忽略别的，包括 additive 和 clipping。


### maid 的表情预设（分层脸骨架）
- maid 的角色骨架是分层脸：动画名是 `eye/eye_001`、`eyebrow/…`、`mouse/…`、`eyemain/…`、`eyepos/…`、`cheek/…`、`highlight/…`、`sweat/…`、`tear/…`，脸是靠这些动画把附件一层层打开的（初始姿势里没有眼睛和嘴巴）；脚本里写的是预设名（通常 / 照れ / 喜 / 哀 / 楽 / 驚き / 慌て / 大慌て / 苦笑い / 怒 / 困り …）。
  各角色的零件数量不一样（momiji：eye 10 / eyebrow 11 / mouse 11；scarlet：7 / 9 / 9；nashwa：9 / 10 / …），原游戏用加密的 `castData.js.enc` 展开，所以没法从资源里推——做成可配置的表。
- 表：`{ <范围>: { <预设名>: { <部件>: <后缀> } } }`。范围 = `default`（所有角色）/ 角色目录名（`cast009001`）/ 骨架文件名（`nashwa_001`），越具体越优先；部件 = `eye / eyebrow / mouse / eyemain / eyepos / cheek / highlight / sweat / tear`；
  后缀是数字（`3` → `003`）或字符串（`normal` / `none` / `on` / `off` / `half`），对应动画 `<部件>/<部件>_<后缀>`；骨架里没有的部件 / 号码跳过（该部件用默认动画）；同一范围里别的预设没写的部件沿用「通常」的。表里没有的预设 = 默认脸（各部件 001 / normal / none / on）。
- 三层合并（后面的盖前面的）：**内置初始值**（`gal-spine.js` 的 `DEFAULT_EXPRESSIONS`：通常 = 各部件 001；照れ = 通常 + 腮红 001；慌て / 大慌て / 苦笑い = 通常 + 汗 001——只放有把握的）← **服务端配置**（`config.adapterOptions['girlscreation-tag'].expressions`）← **这个媒体自己调的**（播放器「更多 → 表情…」，按媒体存在浏览器里）。
- 「更多 → 角色表情 → 表情…」：选角色 + 预设名（默认是正在用的），每个部件一个下拉，改了马上预览，「应用并保存」存到「这个角色」或「所有角色」，「清除这个预设」回到配置 / 内置值，「复制配置」把自己调的表复制成 JSON（可以放进服务端配置）。
- 脚本里 `SPINE_ACTOR` 的第 4 项（初始动画，如 `通常`）和 `SPINE_ACTOR_PLAY` 的动画名都走这张表；渲染诊断里写明用的是哪个预设、哪个范围、哪几个动画。


### tenkeiprdx 的静态画面：`Backgrounds/still/<骨架目录>_still_0N.png` = 骨架的 animationN
`Stills/<名字>/` 是静态画面的 Spine 骨架（层按数字前缀叠），`Backgrounds/still/<名字>_still_01..05.png` 是同名的五张静态图，对应骨架的 animation1..5。剧情里只有第一帧写了 `still`，后面几帧常常只写 `backgroundImage: "<名字>_still_0N"`——
适配器把它当成静态画面继续播骨架的 `animationN`（`_still_02` → animation2，`_still_04` → animation4 降速 + 闪白，`_still_05` → animation5 白屏淡出），不再退成不动的背景图。`Stills/` 下没有对应目录时仍然是普通背景图。
关掉：`config.adapterOptions['tenkeiprdx-json'].stillPng = 'image'`（`_still_0N` 当普通背景图，带原来的音效 / 闪白）。统计里 `stats.stillFromBackground` 记了这样的帧数。


### 预乘 alpha / Screen、Multiply 混合（chara_0125 的白块 / 紫色罩子 / 脸上一块白）
直通 alpha 的图集（透明处还带着颜色；Spine 4.0 的 atlas 没有 pma 行，所以认不出来）以前按普通方式画，Screen / Multiply 这类混合直接用 RGB、不看 alpha，透明处的颜色被加上去：
`Eff`（整幅紫色渐变，Screen）→ 整体紫色 + 两大块白，`Sunlight` / `Particle`（Screen）→ 白色光斑，`Cheek`（Multiply）→ 脸中间一块白。现在：图集标记或像素统计认出已经预乘的原样上传；其余的（直通贴图）**上传时让浏览器预乘一次**，之后**一律按预乘方式画**，
透明处是 0，不再有这个问题；Normal 混合的结果不变。渲染诊断里写「直通贴图，上传时预乘 / 已经是预乘，原样上传」和非 normal 混合的槽数。


### 首页「表情」入口（逐个确认表情预设）与 WebGL 诊断
- 适配器实现了 `scanExpressions(text)`（girlscreation）时，首页第一页多一张「表情」卡片（有全局分层脸骨架——`data/spine/…`——才出现），点进去是节点 `x:expr`（`kind: 'expr'`）：
  后端扫整个脚本目录一次（每个脚本读全文，模拟槽 → 骨架，收集轨道 0 的预设名：`SPINE_ACTOR` 第 4 项、`SPINE_ACTOR_PLAY`、`SPINE_ACTOR_TRACK`），按骨架 + 预设名 + 次数返回，只列全局骨架（场景自己的骨架不算）；结果缓存，「刷新索引」会清掉。
- 前端（`gal-expr.js`）：左边角色列表（带「已确认 n / m」），右边是预览（和播放同一个 Spine 层）、该角色的预设按钮（按次数排，确认过的带 ✓）、各部件下拉（改了立即预览）、「保存到 这个角色 / 所有角色」、「保存」、「确认这个预设」、「下一个未确认 ▶」，顶部总进度「已确认 x / y」和「复制配置」。
  存法和播放器「更多 → 表情…」是同一份：`localStorage` 的 `copymanga.gal.view.<条目 id>` 里的 `expressions`（预设表）和 `confirmed`（`{ 范围: { 预设名: true } }`），播放器改别的设置不会弄丢它们。预设表的合并顺序和播放时一样：内置初始值 ← 服务端配置 ← 你调的。
- 渲染诊断多一行 WebGL：`显卡 … · 上下文正常 / 已丢失 · 画布 宽x高（css …，dpr …）· 最大贴图 … · 最近 GL 错误 …`，白屏 / 黑屏时贴出来能看出是驱动、上下文丢失还是 GL 报错。


### 混合模式开关（「更多 → 混合模式」）与 Gal 演示工作流
- 骨骼里有 additive / multiply / screen 的槽时，「更多」里出现「混合模式」：**原样**（默认）/ **加色(additive)改按普通** / **全部按普通**，按媒体存（`copymanga.gal.view.<条目 id>.blend`），改了马上重画，渲染诊断写明「混合模式覆盖」。
  有的显卡驱动上这几种混合会画成整屏白（软件渲染里复现不了），用它快速验证 / 绕过。
- `.github/workflows/gal-demo.yml`：手动触发（`Gal Interactive Demo`），起 web 容器（HTTP）→ 生成合成的演示数据（`make-gal-fixture` / `make-gal-games-fixture` / `make-gal-maid-fixture`，没有任何原作内容）→ 把各游戏演示导入媒体库（含 `gal-layout`）→ 冒烟（maid 演示首页必须有「表情」卡片）→ Cloudflare 快速隧道，URL 写在 job 摘要和 commit 评论里。
  可选仓库 secret `DEMO_PASSWORD`（配了就要密码）。看点：maid演示 →「表情」；maid演示 → fx_blend →「更多 → 混合模式」。


### 已支持的游戏（结构对照）
| 游戏 | 家族 / 适配器 | 说明 |
|---|---|---|
| Girls Creation R Viewer、Angelica Aster、jaxin、maid、**Aku No Onna Kanbu**、**Fruits Fulcute!** | NW.js（`girlscreation-tag`，game.id 各自唯一：`girlscreation` / `aster` / `jaxin` / `maid` / `aku` / `fruits`） | `<根>/scenes/<场景>/script.txt`（或 `output_script.txt` / `hmr_·hsr_<id>.txt`）+ `data/audio/{bgm,se}`；根可以是 `package.nw`，也可以没有这层（Fruits：`scenes` 直接在根下，场景里多一个 `img.txt` 不影响） |
| monmusu | Ren'Py（`renpy-monmusu`） | `game/script/hscene` + `hscene_still` + `script/movie.rpy` |
| **angelic_py** | Ren'Py（`renpy-monmusu`，game.id `angelic`） | `game/script/hscene/*.rpy`；别名表是 `script/movies.rpy` + `script/stills.rpy`（复数），图片在 `images` + `resources`；菜单脚本 `sub_nav` / `sub_nav_byname` 隐藏；脚本文件名是随机串，没有角色编号，所以不分组、卡片显示脚本名；只有 `.rpyc` 的脚本解析不了（列表页问题里会列出） |
| **ぼくらの放課後戦争** | 编译脚本 JSON（`bokusen-json`，game.id `bokusen`） | `<根>/json/<脚本名>.json` + `<根>/resource/<脚本名>/{images,sounds}`（只有一部分脚本有资源目录），见「ぼくらの放課後戦争」一节 |
| **Kamihime Player** | TyranoScript（`tyrano-ks`，game.id `kamihime`） | `game/dmm/raw_scenario/<类别>/<目录>/<id>_script.ks` + 同目录 `<id>.json`；资源 `game/dmm/assets`（带 hash 的平铺 + `<resource_directory>/` 里的语音）；见「Kamihime Player」一节 |
| **Grenze**（GrenzeViewer） | Unity 导出（`grenze-xml`，game.id `grenze`） | `TextAsset/easy_dialog-N.xml`（一个文件几百个场景）+ `assets/resources/patchres/{bg/battlebg,bgm,sound,voice,merc/pic}`；见「Grenze」一节 |
| legeclo、minashigo（Ren'Py）、tenkeiprdx、misttrain、UViewer | 见各自一节 | |
| **Twinkle Star Knights X** | Unity + Utage（`utage-book`，game.id `tsk`） | `<数据根>/Adventure/<剧情文件夹>/*.book.json` + `Adventure/Master.chapter.json`；数据根 = `…_Data/StreamingAssets/<游戏名>`，见「Twinkle Star Knights X」一节 |


### Aku / Fruits 的写法差异（Girls Creation 家族的两种方言）
目录结构一样（`scenes/<场景>/script.txt` + `data/audio`），脚本的标签语义有差别，适配器按内容识别：
- **Aku No Onna Kanbu**（脚本里有 `<GROUP>` / `<EV_DISPLAY>` / `<SPINE_ACTOR_DISPLAY>`）：`<GROUP><FADE_IN>black,0 <EV>… <FADE_OUT>black,500</GROUP>` = 先黑场、换图、再淡出显示，所以 `FADE_IN` = 变黑、`FADE_OUT` = 去掉黑场（和 `FADE_OUT2` / `FADE_IN2` 相反，不处理会一直黑屏）；
  `<SPINE_ACTOR>槽,骨架,动画,纵向,横向,NONE,linear,0` 的动画是第 3 项，要等 `<SPINE_ACTOR_DISPLAY>槽,SHOW` 才显示（`HIDE` 收起）；`<EV_DISPLAY>0,FALSE` 收起 EV 图；`GROUP` / `NAME_DISP` 忽略。
  还没做：`SELECT` / `LABEL` / `JUMP`（分支，现在按顺序一路播下去）、`EV_FADE`、`ANIM_*`、`SPINE_ACTOR_FADE` / `MOVE`、非 CENTER 的位置（LEFT / RIGHT 的偏移是估的）。
- **Fruits Fulcute!**：`<SE_PLAY>E004`（只有名字）；立绘不是 Spine，是 `<ACTOR>槽,身体图,纵向,横向,NONE,linear,0,缩放,脸名,脸图,脸x,脸y,宽,高,0,0`：身体（`_00`）+ 脸（`_01…`）两张同尺寸的透明图叠成一个 `stand`（横向 LEFT / RIGHT 各自贴边，CENTER 居中）；`<ACTOR_COLOR_FILTER>槽,dark` 压暗（亮度 0.6，stand 部件的 `dim`）、`<ACTOR_OUT>` 收掉。脸图的偏移按第 11、12 项（样本里全是 0）；宽高（1624,1430）没用。
- Aku 的 `<ANIM_PLAY>槽,前缀,位数,起始,结束(不含),…,速度`：`<前缀><补零帧号>.webp` 逐帧循环当背景（和 FRAME_ANIM 一样，速度在「更多」里设）；LOAD / SPEED / STOP 不处理。

### 魔法学园（ArtWhirl，`artwhirl-json`）
- 剧情是 JSON 的**并行数组**：第 i 行 = `texts[i]`（null = 只放指令，并进下一句）、`bgs` / `bgms` / `charas` / `names` / `colors`（整数 = `dic` 的下标）、`voices`、`others`（指令）、`effects`、`waits`。语义照游戏自带的 `json_story_player.rpy`。
- 资源路径：`bg/x` → `images/bg/x`；`chara/<角色>/<文件>`（3 段）→ `images/bg/<角色>_<文件>`；`chara/<角色>/<资源>/<帧>`（4 段）→ `images/hcg/…`，有同名 `.webm` 就当视频播（帧名 1 / 4 不循环）；bgm `.mp3` 优先找同名 `.ogg`；语音按**文件名**在整个索引里找（有的剧情复用别的剧情组的语音）。立绘 `images/stands/<key>/<body>/<key>_<body>_<brow>_<eye>_<lip>[_h].png`，找不到按 brow→b、eye→e、h→不带 h 的顺序退。
- gal-layout：`game/episode_scripts` + `game/hscripts` 当脚本根（扩展名 json），资源根 = `game`；没写 game.id 时要求同时有 `images/stands` 和 `audio`。导入页预设「魔法学园的少女们」。
- 未渲染：`others` 里的 action / emotion、`effects`、`waits`；统计里（`stats.raw`）会列出次数。

### ぼくらの放課後戦争（bokusen，`bokusen-json`）
- 脚本是 KAG / Tyrano 风格脚本编译出来的 JSON 表：`{data:{code:{images, sounds, articles, characters, tags, parameters, commands}}}`（可能有 BOM）。`commands` 每项 `[标签下标, 参数组下标, 顺序]`（顺序 = 源码行号，单调不减）；`parameters` 每组是按槽位排的数组，`'nil'` = 没设。**标签表是每个文件自带的**：永远用 `tags[标签下标]` 取名字，不假定固定下标（21 种标签：bgmopt / playbgm / image / trans / wt / r / articles / p / cm / move / wm / animstart / playse / stopse / animstop / wait / seopt / fadese / wf / fadeoutbgm / wb）。
- 目录：`<根>/json/<脚本名>.json`（1888 个，其中 10 个解析不了）+ `<根>/resource/<脚本名>/images/<序号>.<扩展名>`、`sounds/<序号>.wav`。**只有 826 个脚本有资源目录**——没有的脚本只出台词，图片 / 声音记进 `stats.unresolved`（列表页「渲染诊断」报缺资源），不是错误。资源对应：`images[i]` ↔ `images/<i><images[i] 的扩展名>`；`sounds[i]` ↔ `sounds/<i>.wav`（列表里写 `.m4a`，磁盘上是 `.wav`：先找 `.wav`，再找列表里的扩展名；扩展名对不上时按序号找）。
- 解析失败的 JSON：`sniff` 只看开头 8KB 的 `{"data":{"code":{`（`images` / `sounds` / `articles` 在 `tags` 之前，读全文太慢），所以截断的文件也会列在列表里，打开时 `parse` 抛一个明确的 `Error`（不会崩）。
- 资源怎么定位：脚本里没有路径，靠 `meta.stem`（脚本文件名）拼 `<stem>/images/<i>.<ext>`；`config.resourceRoots = [<根>/resource]`，适配器参数 `adapterOptions['bokusen-json'] = { root: <游戏根，相对媒体目录>, resourceDir: 'resource' }`；文件索引（`contextDirs` = resource 目录）用来核对文件是否存在和找真实扩展名，没有索引时按约定拼路径。
- 槽位表（样本 1888 个文件里没有反例的；**未证实**的单列）：

| 标签 | 槽位 | 含义 |
|---|---|---|
| `articles` | 0 | `articles[]` 下标；文本是 `【说话人】` 标题行和 `「台词」` 行，和 `r`（换行）/ `p`（等点击）/ `cm`（清文本框）交错 |
| `image` | 15 / 23 / 28 | 层（`base` = 背景，数字 = 立绘 / 叠加层）/ 页（`fore` 立刻显示，`back` 放后台等 `trans`）/ `images[]` 下标 |
| `image` | 16 / 29 | x / y 偏移（常见 0、±240、±250、±100；y 0 / -10） |
| `image` | 22 | **未证实**：0 / 100 / 150 / 200 / 255，像不透明度，忽略 |
| `trans` | 2 / 3 / 6 | 层 / 方式（只见过 `cross`）/ 毫秒：把该层 back 页的图换成前台；背景 = 交叉淡入 |
| `move` | 2 / 4 / 6 | 层 / 目标 `(x y 不透明度)` / 毫秒；只取终点不做补间，不透明度 0 = 去掉该层 |
| `animstart` | 0 / 2 / 3 / 5 / 8 / 9 | 动画 id / 层 / x / 循环 / 页 / 帧下标列表（空格分隔，`images[]` 下标） |
| `animstart` | 1 / 4 / 6 / 7 / 10 / 11 | **未证实**：1 恒为 15（像帧率），4 / 6 / 7 / 10 / 11 的含义不明，都不用 |
| `animstop` | 0 | 动画 id |
| `playse` / `stopse` / `fadese` / `seopt` | 见下 | playse：0 声道 · 1 循环 · 2 `sounds[]` 下标；stopse：0 声道；fadese：0 声道 · 1 毫秒 · 2 目标音量；seopt：0 声道 · 3 音量（忽略） |
| `playbgm` / `bgmopt` / `fadeoutbgm` | 见下 | playbgm：0 循环 · 1 恒为 0（**未证实**）——**没有曲子下标**，取 `sounds[]` 里路径带 `/bgm/` 的第一个，没有就取第 0 个（**未证实**）；bgmopt：1 音量（忽略）；fadeoutbgm：0 毫秒 |
| `wait` | 2 | 毫秒；`wt` / `wm` / `wf` / `wb` 是等待，忽略 |

- 表达（用现有指令）：`base` 层图 → `bg`；`trans cross` → 带 `fade` 的 `bg`（先 `back` 页放图，`trans` 时才提交）；数字层 → `stand`（每层一个 part，按层号叠放，part 带 `x` / `y`）；`base` 层多帧 `animstart` → `bg` + `frames`（和 Aku 的帧动画一样，速度在播放器「更多」里设）；循环的 `playse` → `bgse`（只有一路，后来的覆盖前面的）/ `stopse` 或淡到 0 的 `fadese` → `bgseStop`，不循环的 → `se`（路径带 `/voice/` 的 → `voice`）；`playbgm` → `bgm`，`fadeoutbgm` → `bgmStop`；`wait` → `wait`；`【名字】` → `speaker`（`cm` 清掉；一页里中途换说话人时，前面的文字先单独出一步），`「…」` 和地の文 → `text`（同一页的多行用 `\n` 连起来）。
- 表达不了的（`raw` 指令 + `stats.raw`）：数字层的多帧动画（只显示第一帧）、淡到非 0 音量的 `fadese`、非 `cross` 的 `trans`、`move` 到没有显示的层、`images[]` 下标越界的 `image`、没见过的标签（只计入 `stats.raw`）。`move` 的补间、`bgmopt` / `seopt` 的音量、`animstop` 对 `base` 层帧动画（不停，换背景才停）没做。
- `gal-layout`：`<根>/json` 当脚本根、`<根>/resource` 当资源根（扩展名 json）；没写 game.id 时要求 `json/` 里前几个脚本开头是 `{"data":{"code":{` 并且同级有 `resource/`。导入页预设「ぼくらの放課後戦争（bokusen）」。
- 自测：`node scripts/dev/fe-gal-bokusen-selftest.mjs`（不需要浏览器；造数据 `scripts/dev/make-bokusen-fixture.mjs <输出根目录>`，合成脚本含开场交叉淡入、立绘层 + move、多帧动画、playse → wav、缺资源、被截断的 JSON）。

### Kamihime Player（TyranoScript .ks，`tyrano-ks`）
- **独立的 adapter `tyrano-ks`**（`adapters/tyrano-ks.mjs`），sniff：`*start` 开头 + Tyrano 标签（`[chara_new` / `[call target=*start storage="tyrano.ks"]` / `[position` …）。**目录**（`<根>` = `game/dmm`，记在 `config.adapterOptions['tyrano-ks'].root`）：`<根>/raw_scenario/<类别>/<目录>/<id>_script.ks` + 同目录 `<id>.json`（`{ is_r18, resource_directory, scenario_path, summary, title }`），资源 `<根>/assets/`。
- **写法**：`#<角色 key>` = 说话人（key → `[chara_new … jname=]` 的显示名，没声明的 key 原样当名字，单独的 `#` = 旁白）；非标签、非 `#` 的行是台词，行内 `[r]` 换行、`[l]` 等点击（结束一步）、`[cm]` 清文本框；`[l]` 之后文本框里累加到下一个 `[cm]` 之前的全部文字，没有 `[l]` 的残余文字在 `[cm]` / 结尾处也算一步。
- **立绘** = 每个表情一整张图：`[chara_new]` 的 `storage` 是基础图，`[chara_face name face storage]` 登记表情，`[chara_mod face=]` 换表情，`[chara_show]` / `[chara_hide]` 出场 / 退场 → `stand` 指令（部件带 `align`，和 legeclo 一样）。摆放是**猜的**：在场 1 个居中，2 个左 / 右，3 个以上 左 / 中 / 右（按出场顺序），脚本里的 `left=` / `top=` 不用（没有对照图，也不知道原舞台尺寸）。
- **资源查找**（相对资源根 `game/dmm/assets`）：带 hash 的（`<stem>-<sha1>.<ext>`）整名在平铺层找，找不到再按 stem 找；不带 hash 的图按 `stem + 扩展名` 找平铺层的 `<stem>-<sha1>.<ext>`；不带 hash 的语音 / 音效先查本剧情的 `assets/<resource_directory>/<文件名>`（resource_directory 来自同目录 json，**不带 `_script`**），再按文件名在所有 resource_directory 里找第一个。
  文件索引走 `contextDirs`（`assets` + `raw_scenario`）：真实规模是 1.1 万个平铺文件 + 5000 多个 resource_directory 子目录（约 10 万个文件），适配器的 `contextWalkLimit` 设为 80 万；3000 多个 json 靠 `contextSampleLimit`（新增的适配器属性，默认 3000、封顶 2 万，`context.mjs`）全部读到。合成数据上建一次索引约 1 秒、命中缓存约 0.13 秒。
- **缺文件不致命**：真实数据里不少文件磁盘上就没有（表情图 / 带 hash 的 png 都有缺）。表情缺 → 退回这个角色的基础立绘（`stats.fallbacks`）；背景 / BGM / 基础立绘缺 → `stats.unresolved`（渲染诊断里能看到）；表情 / 语音 / 音效 / 滤镜缺 → 只记 `stats.missing`，不提示、不出指令。
- **指令对应**：`[bg]` → `bg`（`black-<hash>.png` / `white-<hash>.png` 直接当纯色，`time` → 渐变秒数）；`[playbgm]` / `[stopbgm]` / `[fadeoutbgm]` → `bgm` / `bgmStop`；`[playse]`：`loop=true` → `bgse`（`[stopse]` 停它），否则在 resource_directory 里的 → `voice`、别的 → `se`；`[wait time=]` → `wait`；`[quake hmax|vmax]` → `shake`（幅度 1 像素 = 1/40）；
  连着的 `[anim name= top|left=]`（角色跳 / 抖）合成一个 `shake`（**整个画面抖**，没有单个立绘的动作指令）；`[image storage="sepia_filter-…" layer=4]` → 当前背景的 `over`（再发一条 `bg`，换背景时带着走），`[freeimage layer=4]` / `[layopt layer=4 visible=]` 去掉 / 隐藏它。
- **暂未渲染**（`raw` 指令 + `stats.raw`）：`[anim layer=…]` 的滑入 / 滑出（`left="±=640"`）、layer 3 的 `layopt` / `freeimage`（layer 3 里是什么没有样本，所以不敢猜成立绘滑动）、`[kanim]` / `[keyframe]` / `[frame]`、`[iscript]` 块、`[mem_img]` / `[mem_voice]` / `[memorial]`、没见过的标签；流程标签（`[if]` / `[jump]` / `[glink]` …）也只记 raw、脚本按顺序一路播下去（样本里没有分支）。点右下角的提示看明细，要允许就用 `rawIgnore`。
- **列表**（`adapter.catalog`，每次从索引现读、按 ctx 缓存）：类别 → 目录 → 剧情，剧情标题取 json 的 `title`（没有 json 就用脚本名），`is_r18` 的卡片带 `R18` 角标；体检 `health`：没读到 assets / 没读到 json。
- **`gal-layout` 探测**：`dmm/raw_scenario`（多套几层目录自动带前缀）；没声明 `game.id` 时还要求有 `dmm/assets` 和至少一个 `.ks`。写：脚本根 `<…>/dmm/raw_scenario`、资源根 `<…>/dmm/assets`、扩展名 `ks`、`adapterOptions['tyrano-ks'].root`、脚本数。探测顺序在 artwhirl 之后、uviewer 之前。导入：`adapters: ['tyrano-ks']` + `config.game.id: 'kamihime'`，导入页预设「Kamihime Player」。
- **自测**：`scripts/dev/fe-gal-kamihime-selftest.mjs`（适配器 / 索引 / gal-layout 不需要浏览器；有 `PLAYWRIGHT_PATH` 且 `web/node_modules` 装好时再起服务做导入、列表、资源接口、立绘像素）；合成数据 `scripts/dev/make-kamihime-fixture.mjs <目录>`，`gal-demo` 工作流里会生成并导入。
- **没验证的**：立绘摆放（上面）；`[quake time=]` 当总时长；`[anim layer=3]` 的含义；`[l]` 之后文字累加的规则是按 Tyrano 的 `[l]` / `[cm]` 语义推的，没有逐字对照原播放器。
### Grenze（GrenzeViewer，`grenze-xml`）
- **格式**：`TextAsset/easy_dialog-N.xml`（N ≥ 27，每个 1~10MB、最多约 5 万行），一行一句：`<easy_dialog-N id next_id name text hero_group_id pic_pos pic_face voice_pack voice sound1..3 bg_sound1..3 bgm background screen_effect pic_action effect effect_pos … />`。
  用正则逐行扫（不建 DOM），属性值里的 `&#xA;`（换行）`&amp;` 等转义还原；`《俺》` 这类心声记号当普通文字保留。`name="-"` 或没有 name = 旁白。sniff 认 `<easy_dialog-N … id="…">` 行。
- **场景 = next_id 链**：一个文件里没有任何行指向的行是起点，沿 `next_id` 走到底（没有 next_id、指向不存在的 id、绕回走过的行都在那里结束）；行在文件里交错、id 不连续都没关系。
  几条链汇合到同一行（几行的 `next_id` 相同）时，每个场景各自走到底，共用的后半段在每个场景里都有（没看到过选项属性，所以没有 `choice`）；没人指向的环也算一个场景（从文件里最靠前的行起）。
- **列表（catalog）**：一个文件装着几百个场景，所以列表由适配器给：首页 = 每个 `easy_dialog-N.xml` 一个目录（按数字排序），里面是它的场景（标题 = 起点行 id，副标题 = `句数 · 前三个说话人 · 首句`）。
  场景的脚本路径是 `TextAsset/easy_dialog-1.xml::<起点行 id>`：`::` 之后的部分由 `browse.mjs` 拆出来作为 `meta.scene` 交给适配器，磁盘上读的还是那个文件（这种路径不受 4MB 的脚本大小上限限制，只读 8KB 头嗅探；适配器要声明 `sceneInPath: true`）。
  文件在 `prepare` 里读一次（引擎给 `prepare` 传了 `mediaDir`），场景列表按「文件 mtime+size」缓存；打开一个场景要重新读 + 扫整个文件（8.5MB、5 万行约 0.3 秒）。
- **资源**（相对资源根 `assets/resources/patchres`）：全部按「文件名（无扩展名，小写）」查文件索引，不写死目录层级——`background` → `bg/**/<名>.webp|png|jpg`（实际 `bg/battlebg/<名>/<名>.webp`，名字带 `#数字` 的重复文件被引擎的索引跳过）、
  `bgm` → `bgm/<名小写>/<名>.m4a`、`sound1..3` / `bg_sound1..3` → `sound/<名>/<名>.m4a`、`voice_pack` + `voice` → `voice/<包小写>/<语音名>.m4a`（包里没有就按语音名在整个 `voice/` 里找，撞名的不乱猜）。
  索引的目录：`TextAsset`、`bg`、`bgm`、`sound`、`voice`、`merc/pic`（`voice` 十万级文件、`merc/pic` 近 3000 个目录），适配器把 `contextWalkLimit` 提到引擎封顶的 200 万，索引不会被默认的 40 万悄悄截断（真被截断了会记进 `stats.indexTruncated`）。找不到的名字记 `stats.unresolved`，不致命。
- **立绘（静态）**：`hero_group_id` → `merc/pic/<id>/body.webp`（没有再 `body.png`）= 一整张图，`pic_pos` 1/2/3 = 左 / 中 / 右（别的值按中间）→ `stand` 指令（单个部件，带 `align`；底边对齐、水平贴左 / 居中 / 贴右）。
  同目录里的 `N.webp` / `N.png`（72/96px）是头像图标，`<id>.webp`（2048²）是图集，**都不是表情叠层**，所以 `pic_face` 不用来合成；没有 body 的 hero（有一些）记 unresolved、清掉立绘。
  `stand` 部件多了 `fit: 1`（`gal-stand.js`）：整张图比画面（1080）还高时缩到画面高度（有 1426×1580 的），矮的不放大。
  **沿用规则（没有对照样本，按推测）**：没有 `hero_group_id` 的行（旁白 / 只放指令）沿用上一个立绘，直到换了 `hero_group_id` / `pic_pos`、或换背景（`background`）才清掉；一次只显示一个立绘（左右两个人轮流说话时只显示当前说话的）。Spine（`merc/ani`、`merc/full_ani`）不在这里，不发 `spine` 指令。
- **声音**：`bgm="non"` → `bgmStop`（正在放才发）；`sound` / `bg_sound` 的 `non` = 没有（不发）。`bg_sound1..3` 是不是循环的背景音没有对照样本，按一次性 `se` 放。
- **背景**：`bg_b` 没有对应的图时当黑底（推测，没有对照样本）。
- **未知，不猜，记成 `raw {cmd, args}`（计入 `stats.raw`，播放页提示「暂未渲染」）**：`screen_effect`（1~13，出现最多的是 8 / 4 / 3）、`pic_action`（1~10，最多的是 5）、`effect` + `effect_pos`（1~22 / 1~3）、`pic_action_val`、`pic_size`、`back_voice`。
- **gal-layout**：脚本根 `<游戏根>/TextAsset`、资源根 `<游戏根>/assets/resources/patchres`、扩展名 `xml`、适配器参数 `root`（游戏根多一层目录也找得到）；没写 game.id 时要求 `TextAsset` 里有 `easy_dialog-N.xml` 且同级有 `assets/` 和 patchres。探测顺序在 artwhirl 之后、UViewer 之前。导入页预设「Grenze（GrenzeViewer）」。
- **自测**：`node scripts/dev/make-grenze-fixture.mjs <目录> [大文件行数]` 造合成数据；`PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-grenze-selftest.mjs`（适配器单测 + 导入 / 列表 / 播放 / 立绘像素，含 5 万行的大文件）。

### Twinkle Star Knights X（Utage 工作簿，`utage-book`）
- **独立的 adapter `utage-book`**（`adapters/utage-book.mjs`）：认 Unity 导出的 Utage 工作簿 `*.book.json`（顶层 `importGridList`，每个 grid = 一张剧情表 `{ name, headerRow, rows: [{ rowIndex, strings[], isEmpty, isCommentOut }] }`）。sniff 要求头 8KB 里有 `importGridList` 和表头行的 `Command` / `Arg1`，所以同目录的 `Master.chapter.json`（`settingList`）、`NAME.txt` 都不会被认走。
  列按表头行的列名找（没有就按 `Command Arg1…Arg6 Skin SpineAnim SpineSubAnim AnimCompType AnimSpd WaitType Text PageCtrl Voice WindowType` 的顺序），所以表头重复出现、列错位都不影响；注释行 / 空行 / `//` 开头的行跳过；`WaitType` 的手滑（`NoWiat` / `NoWite` / `NoWati`）和 `WindowType` 里的表格公式（`IF(COUNTA(…))`）一律不看。
- **一个文件 = 一个场景**：脚本节点是文件路径（`s:<路径>`），播放页里没法再指到某个 grid，所以一个 book.json 的所有 grid 按顺序接成一个场景；每个 grid 开头清掉立绘 / 静态画面 / 背景人声 / 背景音效（Utage 里它们是各自独立启动的剧情），标签（`*xxx`）只在本 grid 里查。
  列表（`catalog`）因此是「剧情文件夹（`Adventure/` 下的 MainScenario / CharaScenario / StoryEventScenario …，中文名是猜的，副标题里同时写着文件夹名）→ 剧情文件」+「全部剧情」；剧情没有标题表，卡片标题就是文件名（不带 `.book`）。
- **Master.chapter.json**（`contextFiles`）：`settingList[]` 里名字以 `:Character` / `:Texture` / `:Sound` 结尾的表（`:Layer` / `:Param` / `:Particle` 不用）。有的表第 0 列是空的（Character / Texture / Sound），有的不是（Layer / Param），所以列名一律按各表自己的表头行找。
  Character：`CharacterName` → `NameText`（显示名）+ `FileName`（`Characters/ch_1001001/ch_1001001_m0_SkeletonData.asset` 去掉 `_SkeletonData.asset` = 真实文件的基名，`.skel.bytes` / `.atlas.txt` / `.png`）；Texture：Bg 标签 → `Adventure/BackGrounds/<名>.png`；Sound：`Bgm`（`IntroFileName` + `FileName`）/ `Se` 标签 → `Sound/…ogg`。文件索引（`contextDirs`）= `Adventure` / `Characters` / `Stills` / `Sound`，文件上限调到 80 万（语音很多）。
- **行 → 指令**：
  - 台词（Command 空 + Text）：Arg1 = 角色名；说话人显示名取 Master 的 `NameText`，没有就取角色名里**最后一个 `-` 之前**的部分（`名字-制服` → `名字`）；没有 Arg1 = 旁白（说话人清空）。台词原样保留（`“…”` 是说话、`‘…’` 是心里话），`<ruby=读音>字</ruby>` / `<color=…>` / `<b>` / `<i>` / `<br>` 变成注音 / 样式片段，其余标记去掉。`Voice` 按文件名在 `Sound/Voice/**`、`Sound/BgVoice/*` 的索引里找（不去推角色目录）。
  - 立绘行（Command 空 + 没有 Text + Arg3）：`spine` 指令，`slot` = Arg3（`Chara1|2|3`），`kind: 'chara'`，`x = 0.5 + Arg4 / 屏宽`（Arg4 是像素偏移，右为正；屏宽默认 1280，`adapterOptions['utage-book'].screenWidth` 可改），`fade` = Arg6，`anim` = SpineAnim，`skin` = Skin（`face1…`）、`sub` = SpineSubAnim。同一个角色换槽位先 `spineOff` 旧槽；说话的角色已经在场（没写 Arg3）只在表情 / 动画变了时更新。
  - `Bg` / `BgOff` / `BgEvent`（Stills 的 Spine，`kind: 'still'`，动画名 `cut_N`，`_loop` 结尾循环）/ `BgEventOff` / `Bgm`（见下）/ `StopBgm` / `Se` / `BgSe`（循环）/ `StopBgSe` / `BgVoice`（循环）/ `StopBgVoice` / `Wait` / `FadeOut`（变黑）/ `FadeIn` / `CharacterOff` / `HideMessageWindow` / `ShowMessageWindow` 都有对应的规范指令。
  - `Tween`（Utage 的 iTween）：`PunchPosition` / `ShakePosition` / 带 `pingPong` 的 `MoveBy` 是来回的动作 → 立绘动作（y < 0 = 下沉 3，y > 0 = 跳 1，x = 左右抖 2；时长、次数用播放器固定的）；`MoveTo x=…` / 不带 pingPong 的 `MoveBy x=…` 改槽位的横向位置；`ColorTo` / `ScaleTo` / `RotateTo` / y 方向的搬家没有对应的字段，记 raw。`Shake`：目标 `Graphics` = 整屏 `shake`（x、y 都有 = overall，强度 = 像素 / 40），角色 = 立绘动作。`ZoomCamera`：模式 1 = 回原位，其它模式 + Arg4 = 缩放百分比 → `camera`（z = (倍数 − 1) / 1.3 × 1000），Arg6 = 秒。
  - 记 raw（`stats.raw`，渲染诊断里能看到，可用 `rawIgnore` 允许）：`Sprite` / `SpriteOff`（特效图、表情气泡）、`Param`、`ChangeSoundVolume`、`ImageEffectOff`、`StopSe`、不认识的命令；`WaitCustom` / `WaitInput` 不处理（记在 `stats.ignored`）。不会崩。
- **分支**（Selection / 标签 / Jump / EndScenario）：`Selection` 的 Arg1 是跳转标签（`*S-<剧情>-<序号>`），Text 是选项文字。标签前缀相同（去掉末尾 `-数字`）的 Selection 算一组（没有这种后缀的，连续的 Selection 算一组）→ 在这一组**第一个** Selection 的位置弹一次 `choice`（序号 = 组里出现的顺序，记进 `sel<n>`）。
  每个选项的分支 = 从它的标签行到下一个 Selection / 同组标签 / 别的标签 / `Jump` / `EndScenario`，分支里每条指令带 `when`，结束后汇合；每个分支从弹选项那一刻的立绘状态重新开始。两种写法都认：交错（`Selection` → 标签 → 分支内容，样本里就是这样）和相邻（一串 `Selection` 之后才是各个标签）。
  `Jump`（没有 Arg2）向后跳 = 中间的行不会走到、到目标标签恢复；跳回前面的标签（循环）没法表示，当作这一段结束；带 Arg2（flag）的 `Jump` 没有运行时变量，记 raw 并当作没跳。`EndScenario` = 到下一个标签前的行不会走到。最后一个分支一直到 grid 末尾都没有结束标记时**不加条件**（宁可多放一段，也别把后面的剧情藏掉），在 `stats.notes` 里说明。
- **没有真机对照 / 没验证的**（样本里只有列含义和命令直方图，没有完整的行序列）：
  1. `<Off>`（Arg2）：按「只显示名字和台词、不（重新）摆立绘、不动已有的立绘」处理；Utage 里它可能还有「把这个角色的立绘收掉」的意思。
  2. 说话人显示名：`NameText`，没有就取最后一个 `-` 之前；`<Character=名字>` 当作「说话人显示成这个名字」（立绘仍按 Arg1）。
  3. BGM 的 intro / loop：播放器的 `bgm` 指令不能接续，只放 loop 文件（只有 intro 时放 intro），intro 记在指令的 `intro` 字段里（播放器不认）。
  4. 立绘位置：Arg4 的参照屏宽（默认 1280）、y 方向（Master 的 `Y` / `Scale` 列没用）都是猜的；`Skin`（表情 face1…）和 `SpineSubAnim` 带在 `spine` 指令的 `skin` / `sub` 字段里，**播放器暂时不认**（还没有「按名字换 Spine 皮肤」的渲染，不知道 face 是皮肤还是附件）。
  5. 分支的整套结构（交错写法下选项之间怎么汇合、最后一个分支怎么结束）是照标签命名和样本里的顺序推的；`Tween` → 立绘动作的对应（尤其 y 方向）、`ZoomCamera` 的参数含义（模式 1 / 2 + Arg4 百分比）、`BgEvent` 的 `AnimSpd`（0 / 1，当 1 倍速处理）、`Sprite` 的 `EffectF` / `BE_*`（转场遮罩？）都没有对照。
  6. 骨架是 Spine 4.0.37 的二进制（`.skel.bytes`），播放器用 4.0 运行时；合成素材只能造 JSON 骨架，二进制没有真实样本测过。`*.book.json` 超过 4MB 会被浏览层的 `MAX_SCRIPT_BYTES` 拒绝（真实最大的文件多大没统计）。
- **`gal-layout` 探测**（`game.id: tsk`）：往下找（深度 ≤ 6）「有 `Adventure/Master.chapter.json`，同级有 `Characters` / `Stills` / `Sound`」的目录（= 数据根 `…_Data/StreamingAssets/<游戏名>`；媒体目录可以是游戏根、`_Data`、`StreamingAssets` 或数据根本身），写：脚本根 `<数据根>/Adventure`、资源根 `<数据根>`、扩展名 `json`（只认 `*.book.json` 靠适配器的嗅探，不靠扩展名）、隐藏目录 `BackGrounds` / `Effects` / `Spine` / `Textures`、适配器参数 `root`、封面 = `Adventure/BackGrounds` 里第一张图、脚本数、默认节点图（每个剧情文件夹一个 `c/<文件夹>` 节点 + `all`）。探测顺序在 artwhirl 之后、uviewer 之前。
  导入页预设「Twinkle Star Knights X（Utage）」，或自己写：`adapters: ['utage-book']` + `config.game.id: 'tsk'` + 勾元数据脚本 `gal-layout`。
- 自测：`scripts/dev/gal-selftest.mjs` 里的 TSK 一节（适配器 / 分支 / gal-layout / 浏览节点）；浏览器 `PLAYWRIGHT_PATH=<@playwright/test> node scripts/dev/fe-gal-tsk-selftest.mjs`（真实 WebGL + Spine 4.0 运行时，需要先 `sh scripts/fetch-spine-runtime.sh`）；合成数据 `node scripts/dev/make-tsk-fixture.mjs <目录>`（`gal-demo` 工作流也会导入它）。

## 随机语音（列表上的 🎲，不打开脚本）

卡片（脚本 / 目录）右下角和底栏的「随机语音」按钮：随机放一条属于这个脚本 / 目录 / 当前这一层列表的语音。**完全按需**：列表接口不算任何语音，点了才算。

**接口**：`GET /api/library/items/gal/<条目 id>/random-voice?node=<节点 id>&include=<正则>&exclude=<正则>&target=path|speaker|text&bgvoice=1&tries=8`（和 `reader` / `resource` 同一层，同样的鉴权）

- `node`：卡片上的 `node`（`s:` 脚本 / `d:` 目录 / `g:` 分组 / `v:` 适配器目录 / `@<根>|…` / 空 = 首页；带视图参数 `|q=…` 时只在筛出来的项里取，页码忽略）。也可以直接写脚本路径。
- `include` / `exclude`：**JS 正则源码**（不分大小写），白名单 / 黑名单，先白后黑；默认匹配语音的**资源路径**（`voice` 指令的 `src`）。`target` 可换成 `speaker`（说话人）/ `text`（台词），也可逗号连写（`path,speaker`，任一个匹配即算）。不传时用 `config.voiceInclude` / `config.voiceExclude`（见下），传了就覆盖。
- `bgvoice=1`：把循环的背景人声（`bgvoice` 指令）也算候选，默认只有 `voice`（一次性语音）。`tries`：目录 / 列表节点最多试几个脚本，默认 8，封顶 30。
- 成功 200：`{ src（可直接播的资源地址）, resource（资源路径）, scriptId（脚本节点 id）, scriptTitle, step, speaker?, text?（语音所在步的台词，≤80 字）, kind, index / total（这条在「过滤后的候选」里的序号 / 个数）, adapter, cached（语音表是否来自缓存）, scripts（候选脚本数）, tried（试了几个）, ms }`。
- 没有可放的 404：`{ error: 'no-voice' | 'all-filtered', reason, scripts, tried, ms }`（`no-voice` = 没有语音 / 文件都找不到；`all-filtered` = 有语音但都被过滤掉了）。参数不合格 400：`{ error: 'invalid-regex' | 'invalid-target', reason }`。

**怎么取**：
- 脚本 = 和打开它同一条路（嗅探适配器 → 适配器上下文 → `buildScene`，所以 adapterOptions / resourceRoots / 覆盖都照常生效，大文件里的 `<文件>::<场景>` 也一样），收 `voice` 指令（同一个 `src` 去重），过滤后**均匀随机**取一条，再确认文件真的在（不在的丢掉再取）。
- 目录 / 分组 / 适配器目录 / 当前列表 = 用已缓存的列表（`listDir` / catalog）收脚本：先收这一层的，再随机展开子目录（最多展开 40 个），脚本最多 500 个，打乱后最多试 `tries` 个，第一个过滤后还有语音的脚本里随机取。所以目录很大、语音稀少时可能 `no-voice`（`reason` 里写了试了几个，再点一次会换一批）。
- 每个脚本的语音表缓存在进程内 LRU（200 条，键 = 脚本路径 + mtime + size + 配置指纹 + 适配器上下文建立时间；「刷新索引」会清）。同一脚本再点 = 不再解析，换过滤条件也不用重新解析。`voiceStats.parses / hits`（`web/library/gal/voice.mjs`）是命中 / 解析计数，测试靠它。
- 成本（合成 fixture，本机）：一个脚本冷调用 ≈ 打开它的解析成本；10MB / 60000 行的单个 grenze xml 里点一个场景，冷约 270 ms（读 + 解析整个文件），热（缓存）1–2 ms；目录节点 = 试 1–8 个脚本的解析（大文件的几百个场景同理，最坏 8 × 冷）。

**正则的安全**（用户填的正则，防灾难性回溯）：≤ 200 字符；编译失败直接报原因；拒绝量词套量词（`(a+)+` / `(\w*)*` / `(a{1,9}){1,9}`，`{n}` 固定次数不算）和反向引用（`\1` / `\k<名>`）；被匹配的文本截到 300 字符；只对每脚本 ≤ 5000 条的候选表逐条匹配。这是启发式，不是证明（交替重叠如 `(a|aa)+` 不拦，靠输入长度上限兜底）。前端有同一套校验（`static/gal-voice.js`，测试里和后端对拍），发请求前先提示。

**配置**：`config.voiceInclude` / `config.voiceExclude`：默认白 / 黑名单（正则源码，同样的限制，不合格的读取时置空），例如把 `voiceExclude` 设成 `breath|moan` 就默认不放喘息声。界面里填了的（`localStorage`：`copymanga.gal.voiceInclude` / `voiceExclude` / `voiceTarget`）随请求带上、覆盖配置里的；界面留空 = 用配置默认。

**前端**（`static/gal-voice.js` + `gal-browse.js`）：整页只有一个 `Audio`（放新的先停旧的；再点正在放的按钮 = 停止；放完复位）；音量取播放器存的 `copymanga.gal.seVolume`，感知曲线增益 = p²（本地一份，不引 gal-player.js）；提示条显示「脚本标题 · 说话人：台词 · x / total」，错误是红色非阻塞提示；底栏「随机语音」旁的「过滤 ▾」是白 / 黑名单弹层（输入时即时校验，非法的不保存）。卡片上的 🎲 是 `role=button` 的 `span`（卡片本身是 `<button>`，不能嵌套），回车 / 空格可触发，悬停 / 聚焦时显示，触屏常显。

测试：`scripts/dev/gal-voice-selftest.mjs`（纯 node：各适配器的语音收集 / 正则拒绝 / LRU / 目录多脚本 / 错误）、`scripts/dev/fe-gal-voice-selftest.mjs`（浏览器，端口 8163）。

### 每个游戏一个唯一的 game.id（导入页「Gal 游戏」下拉）

导入页选方案 `gal-import`，在「Gal 游戏」下拉里选游戏、点「刷新 json」，会把 `adapters` 和 `config.game`（id + 标题）填进方案 JSON；再改 `rootDir` 即可。`rootDir`、`dryRun`、`defaultMetadataActions` 保留文本框里现有的值。

| 下拉框 | `game.id` | 适配器 |
|---|---|---|
| UViewer 资源包（通用） | `uviewer` | `uviewer-csv` |
| deepone（UViewer 系） | `deepone` | `uviewer-csv` |
| Legeclo | `legeclo` | `renpy-legeclo` |
| Monmusu | `monmusu` | `renpy-monmusu` |
| Angelic（angelic_py） | `angelic` | `renpy-monmusu` |
| Minashigo | `minashigo` | `renpy-minashigo` |
| ミナシゴノシゴトR | `minashigo_r` | `uviewer-csv` |
| Girls Creation R Viewer | `girlscreation` | `girlscreation-tag` |
| Angelica Aster R Viewer | `aster` | `girlscreation-tag` |
| jaxin | `jaxin` | `girlscreation-tag` |
| maid | `maid` | `girlscreation-tag` |
| Aku No Onna Kanbu | `aku` | `girlscreation-tag` |
| Fruits Fulcute! | `fruits` | `girlscreation-tag` |
| Tenkeiprdx X | `tenkeiprdx` | `tenkeiprdx-json` |
| MistTrainGirls X | `misttrain` | `misttrain-json` |
| 魔法学园的少女们 | `artwhirl` | `artwhirl-json` |
| Kamihime Player | `kamihime` | `tyrano-ks` |
| ぼくらの放課後戦争 | `bokusen` | `bokusen-json` |
| Grenze | `grenze` | `grenze-xml` |
| Twinkle Star Knights X | `tsk` | `utage-book` |

- 同一套探测的游戏（Girls Creation 家族、UViewer 系）在 gal-layout 里是「别名 id」：声明了 `game.id` 才走，探测和原 id 完全一样，**声明什么 id 就原样写回 `config.game.id` 和状态 tag**（`Gal游戏: aku` 等）。
- 没填 `game.id` 时自动探测不区分别名：Girls Creation 家族的目录认成 `girlscreation`，UViewer 系认成 `uviewer`——想要唯一 id 就在导入方案里选对应的游戏。
- 适配器本身按脚本内容识别写法（Aku / Fruits 的方言差异在适配器里处理），不看 `game.id`，所以换 id 不影响解析。
