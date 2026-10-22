# Gal（视觉小说 / 剧情脚本）库类型

一个**目录 = 一个媒体条目，条目里只有一个单元（`main`）**。单元里是一棵由后端按需给出的**浏览节点树**（真实目录树）：
首页 → 一层层目录 → 脚本卡片 → 播放页。目录本身就是数据：导入只建元数据 JSON，不 mv、不拷贝、不改原文件。

## 分层：导入只存路径，配置全在 `config`，特化靠 tag 脚本

```
导入        只存：来源路径 source.path、adapters（脚本格式适配器）、标题。不扫描目录。
config      条目元数据里唯一的配置字段（gal/config.mjs）。引擎只认它；缺的字段用默认 = 「标准结构」（UViewer 资源包布局），
            所以按标准结构放的目录导入完不用脚本就能浏览/播放。
tag 脚本    gal-layout-v1（scripts/tag-scripts）：目录没按标准结构放时，探测实际结构、把 config 里的参数调对，再挑封面、数脚本。
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
| `dirThumbs` | 目录卡片头像规则：`{parent, name(正则), paths(模板，{name} {parent})}`，取第一个存在的 |
| `scriptThumbs` | 脚本缩略图模板（`{stem}` `{thumbsDir}`；`~/` = 相对媒体目录），之后才是「脚本里第一张背景图」 |
| `cover` / `scriptCount` / `script` | 封面路径（`~/` 开头 = 相对媒体目录，只给封面用）/ 脚本数 / 谁写的这份配置 `{id, version, ranAt}` |
| `groups` | 分组：`[{parent: 通配或 '.', pattern}]`。列 `parent` 下的目录时，脚本名（无扩展名）匹配 `pattern` 的按**第 1 个捕获组**归进虚拟目录（一个键一张卡片，节点 id `g:<键>:<路径>`），不匹配的照常列出；名字/头像和真实目录一样查 `labels` / `namesFiles` / `dirThumbs`。`parent: '.'` = 脚本根本身（`merge` 也认） |
| `game` | `{id, title}`：这个媒体是哪个游戏/资源包（`id` 只含字母数字 `_-`）。**导入时在 config 里写**，tag 脚本按它分发——同一个 adapter、配置不同的两个媒体靠它区分；脚本同时打 `Gal游戏: <id>` 标签方便搜索（以 config 为准） |
| `adapterOptions` | `{<adapter id>: {…}}`，原样交给适配器（≤ 8KB）；需要查别的文件的适配器用它指路径，见下 |
| `scriptIndex` | 脚本索引（给脚本配缩略图 + 来源角标）：`[{dir, pattern, key, badge}]`。`dir`（相对媒体目录）里的文件名匹配 `pattern` 时，按 `key` 模板（`{1}{2}…` = 捕获组）算出它对应哪个脚本（脚本名，无扩展名），这个文件就是那个脚本的缩略图，`badge` 显示在卡片右上角 |
| `hiddenDirs` | 列目录时不显示的目录名（任意层级，精确匹配） |
| `stripPrefixes` `scriptExtensions` `pageSize` | 资源找不到时去掉的前缀 / 脚本扩展名 / 每页卡片数 |

元数据里只存**写过的字段**（没写的随引擎默认值走）；补丁默认合并（写了的顶层字段整个替换，`null` = 删掉回默认），`replace` = 整体替换。
所有路径都是相对媒体目录、不许绝对路径和 `..`；模板只做占位符替换，读文件前仍要通过存在性检查和「只认媒体目录内的真实路径」——
脚本写进去的 config 再坏，也读不到媒体目录以外。

### 适配器的列表（catalog）

适配器可以实现 `catalog(ctx) → { children: [节点] }`，节点 = `{ id, title, subtitle?, thumb?, badge?, children? | script? }`（`script` = 相对媒体目录的脚本路径）。有它时首页和所有列表都由它给（节点 id `v:<编码后的 id>[#页码]`），
脚本卡片仍是 `s:<路径>`；`ctx` 来自 `prepare`，所以列表数据（名称表、缩略图目录…）和脚本解析用同一套「上下文」，文件变了就跟着变。没有 catalog 的适配器仍按真实目录树浏览（UViewer / monmusu）。

### 适配器的媒体上下文（context）

适配器本身只做 `text → scene`。有些格式的脚本里只写别名（Ren'Py 的 `scene 10001A1-10` 要查 `script/movie.rpy` 才知道是哪个 webm），
适配器可以声明 `contextFiles(options)`（要读的文本）/ `contextDirs(options)`（要递归列文件名的目录）/ `prepare(…) → ctx`，引擎读好后把 `ctx` 传给 `parse(text, ctx)`
（`gal/context.mjs`）：按文本文件 mtime+size、目录（自己和下一层子目录）mtime 缓存，目录里新增/删除文件马上生效，更深层的最多缓存 5 分钟；路径在 `config.adapterOptions[适配器 id]` 里配（相对媒体目录）。

### 适配器 renpy-monmusu 与脚本 gal-layout-monmusu

- 适配器认：`scene black|<视频别名>|<图片名> [with 转场]`、`play music/sound`、`stop music`、`voice`、`"名字" "台词"`、`pause 秒`；一句台词一步。
  视频别名来自 `image X = Movie(play=…)`，图片名来自 `images/` 下的文件名（或 `image X = "文件"`）；查不到的 `scene` 保留成 raw。翻译叠加（`tl/*`）暂不处理。
- 导入时自己填：`adapters: ['renpy-monmusu']`、路径、`config: {"game": {"id": "monmusu"}}`、`defaultMetadataActions: ['gal-layout-monmusu']`。
- 脚本探测 `script/hscene`（+ `script/movie.rpy`），多一层目录（如 `game/`）自动带前缀；写：脚本根 `<游戏根>/script`、资源根 `<游戏根>`、
  合并 `hscene`+`hscene_still`（角标 `anim`/`still`）、按文件名前 5 位角色编号分组、隐藏 `sub_nav`/`tl`、`adapterOptions`（别名表、图片目录）、
  头像模板（`images` 里找 `icon_<编号>_0_idle.*`）、封面、脚本数。只处理 `config.game.id` 为 `monmusu`（或没有 game 且认出结构）的媒体；
  `gal-layout-v1` 同理只处理 `uviewer`/没有 game 的媒体，两个脚本互不覆盖。

### 适配器 tenkeiprdx-json 与脚本 gal-layout-tenkeiprdx

- 输入是 Unity 剧情查看器素材（`StreamingAssets/Tenkeiprdx X/Imported`）里的剧情 JSON（对象形 `result.sceneDetails[].sceneFrameDetails[]`，取 `assetId` = 文件名那一项）。一帧 = 一步。
  背景（`Backgrounds/adventure|still|eventstill`）、BGM（`BGM/<名>.ogg`，没有就找 `_loop`）、音效、语音（`AdventureVoice/<场景id>/`）、说话人（`%username%` ← `Masterdata/username.txt`）、台词；
  站位立绘（`Spines/<角色id>/`，表情 0..6 → idle_normal/joy/sad/angry/surprise/shy/unique，站位 1 左 / 2 右 / 其余居中，动作 1 跳 / 2 抖 / 3 沉，空数组 = 全隐藏）；
  静态画面（`Stills/<名>/` 下所有骨架按数字前缀叠起来，animation2/3/4 联动背景音效 Hse2/3/4，animation4 闪白两次，animation5 白屏渐退，animation3 倍速 1.5）；镜头（起止位置 + Z 缩放千分比 + 毫秒时长）。
  只做对象形；`frameEffect` 的取值不明，原样记在 `scene.stats.frameEffects`；对象形里没有「谁在说话」的站位字段，所以不做说话人高亮。
- **列表（adapter.catalog）**：照原查看器的三个列表页，由适配器每次从数据文件现读（上下文按文件 / 目录 mtime 失效，所以新增剧情、缩略图、改名称表马上生效，不用重跑脚本、不用重新导入）：
  活动 = `EpisodeThumbnails/event`（新的在前，剧情 id = `2`+文件名第 3、4 段）；附加 = `EpisodeThumbnails/extra`（同上，id 以 1 结尾的末位换成 2，标题查 `Masterdata/masterdata_32.json`）；
  角色 = `CharacterIcons/<8 位角色号>*.png`（名字、称号查 `masterdata_4.json`）→ 点进去是这个角色的 EX 剧情（`masterdata_32.json` 里按 `<角色号>_01|02_still` 找，缩略图 `Backgrounds/still/<key>.png`）；
  全部剧情 = `scenes/` 下所有 JSON。点剧情卡片 = 进播放页，标题、面包屑、「↑ 列表」、上一话/下一话都按收它的那个列表来；进度仍按剧情路径记（和从哪个列表进来无关）。
- 适配器参数 `adapterOptions['tenkeiprdx-json']`：`root`（Imported 目录，相对媒体目录）、`positionX`（站位 → 横向位置 0..1）、`unknownName`（`%username%` 没有 username.txt 时的名字）。
- 脚本探测 `scenes/` + `Backgrounds|Spines|Stills|Masterdata`（外面多套几层目录自动带前缀），写：脚本根 `<素材根>/scenes`、资源根 `<素材根>`、扩展名 `json`、
  `scriptIndex`（`EpisodeThumbnails/event|extra` 的 `ep_eventstill_<a>_<b>…` → 剧情 id `2<a><b>`，缩略图 + 角标 event / extra）、适配器参数、封面、脚本数。只处理 `game.id = tenkeiprdx`（或没有 game 且认出结构）的媒体。

### Spine 骨骼动画（播放器 `web/static/gal-spine.js`）

- 规范场景新增指令：`spine`（slot / kind: chara|still / skel / atlas / anim / loop / speed / x / dim / action / order）、`spineOff`（slot 或 prefix 或全部）、`camera`（from / to / seconds）、`bgse` / `bgseStop`（背景音效声道）、`flash` / `wash`（闪屏 / 整屏渐退）。
  `spine` 按 slot 进状态（同 slot 再来一条 = 更新动画/颜色/位置，同一个骨架不重新加载）；后退/续播一步到位恢复。
- 渲染：一个叠在背景上的 WebGL canvas，官方 spine-webgl 3.8 运行时，骨骼文件二进制（`.skel.bytes`）和 JSON 都认；站位立绘按舞台高度 95% 底部对齐，静态画面 contain 居中；镜头作用在整个画面（背景 + 视频 + Spine）上。
- **运行时不在仓库里**（Spine Runtimes License 限制）：`Dockerfile.web` 构建时跑 `scripts/fetch-spine-runtime.sh`（固定提交 + sha256 校验）下载到 `web/static/vendor/`；本地开发手动跑一次。没有运行时：播放器栏里提示「Spine 运行时缺失」，其余照常。
- 版本必须和骨骼导出版本一致：运行时是 3.8，4.x 导出的骨骼读不了。

### 脚本 gal-layout-v1

- 探测：`user_data/settings.json` 的 `resource_path`（默认 `./resources`）下有 `download/adv/text` → UViewer；同级 `text*` 目录当作另一套文本；
  路径多套了一层就往下找（深度 ≤ 6）；都不认识 → 通用配置（整个目录当脚本根，找不到的资源去掉 `download/` 再试）。
- 封面：前几个脚本里，先找 UViewer 自己生成的缩略图，再找脚本里第一张存在的背景图；统计脚本数。
- 选项 `overrides`：`[{path, config?, cover?, title?}]`，按媒体目录的真实路径（通配或 `/正则/`）给个别媒体单独覆盖任何配置；
  其他选项：`dryRun`、`replace`、`coverScanLimit`、`countCap`。
- 状态标签：`Gal配置: uviewer / 通用 / 自定义`、`Gal配置version: <脚本版本>`。
- 脚本通过配置页的「上传元数据脚本」安装（覆盖同 id 的旧版本）。注意 `TAG_SCRIPTS_DIR` 要是持久目录（默认是数据目录下的 `tag-scripts`），指到镜像里的目录会在重建容器后丢掉上传的版本。

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
往回走到选项那一步 = 重选（这一步起的选择作废）。工具栏「自选」开关：⚙ 里设 `-1` 关 / `0` 随机 / `1 2 3…` 选对应项（没有该项就随机）。

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
快捷键：空格/回车/→ 下一句，←/Backspace 上一句，A 自动，L 记录，F 全屏，I 沉浸（默认进入，和其他类型一致，Esc 退出并记住）。
按钮在文本框底部（小号），⚙ 设置：字体大小（60%–200%，脚本里的 `<size>` 跟着一起缩放）、文本框背景透明度、BGM/音效音量、自动播放的「语音结束后等待秒数」（0–30，默认 1；没有语音的句子按字数估算时长）、自动选择。设置存在浏览器 localStorage。
沉浸是整个页面的状态：浏览层和播放页共用（默认进入；`I` 切换；`Esc` 退出并记住；沉浸里浏览层的顶栏有「退出沉浸 / 返回」）。
动画中按下一句 = 跳过动画（不是前进）。

自测：`scripts/dev/gal-selftest.mjs`（适配器/引擎/handler）、`scripts/dev/fe-gal-selftest.mjs`（浏览器）；
测试数据：`scripts/dev/make-gal-fixture.mjs <目录>`。
