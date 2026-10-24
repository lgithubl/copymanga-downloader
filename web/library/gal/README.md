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
- 适配器参数 `adapterOptions['tenkeiprdx-json']`：`root`（Imported 目录，相对媒体目录）、`positionX`（站位 → 横向位置 0..1）、`unknownName`（`%username%` 没有 username.txt 时的名字）。
- 脚本探测 `scenes/` + `Backgrounds|Spines|Stills|Masterdata`（外面多套几层目录自动带前缀），写：脚本根 `<素材根>/scenes`、资源根 `<素材根>`、扩展名 `json`、
  `scriptIndex`（`EpisodeThumbnails/event|extra` 的 `ep_eventstill_<a>_<b>…` → 剧情 id `2<a><b>`，缩略图 + 角标 event / extra）、适配器参数、封面、脚本数。只处理 `game.id = tenkeiprdx`（或没有 game 且认出结构）的媒体。

### Spine 骨骼动画（播放器 `web/static/gal-spine.js`）

- 规范场景新增指令：`spine`（slot / kind: chara|still / skel / atlas / anim / loop / speed / x / dim / action / order）、`spineOff`（slot 或 prefix 或全部）、`camera`（from / to / seconds）、`bgse` / `bgseStop`（背景音效声道）、`flash` / `wash`（闪屏 / 整屏渐退）。
  `spine` 按 slot 进状态（同 slot 再来一条 = 更新动画/颜色/位置，同一个骨架不重新加载）；后退/续播一步到位恢复。
- 渲染：一个叠在背景上的 WebGL canvas，官方 spine-webgl 3.8 运行时，骨骼文件二进制（`.skel.bytes`）和 JSON 都认；站位立绘按舞台高度 95% 底部对齐，静态画面 contain 居中；镜头作用在整个画面（背景 + 视频 + Spine）上。
- **运行时不在仓库里**（Spine Runtimes License 限制）：`Dockerfile.web` 构建时跑 `scripts/fetch-spine-runtime.sh`（固定提交 + sha256 校验）下载到 `web/static/vendor/`；本地开发手动跑一次。没有运行时：播放器栏里提示「Spine 运行时缺失」，其余照常。
- 版本必须和骨骼导出版本一致：运行时是 3.8，4.x 导出的骨骼读不了。

### 脚本 gal-layout（UViewer / monmusu / tenkeiprdx 合一）

- **分发**：`config.game.id` 填了（导入时写的）就只走那个游戏的探测（`uviewer` / `monmusu` / `tenkeiprdx`）；认不出结构：uviewer 退回通用配置，别的跳过（不乱改）；不认识的 id 跳过。
  没填 `game.id`：按 monmusu → tenkeiprdx → uviewer 的顺序探测，谁认出来谁认领（把 `game.id` 写回 config，并打 `Gal游戏: <id>` 标签）；都认不出 → 通用配置，不认领。
- 加新游戏 = 在脚本里加一个探测函数 + 在 `GAMES` 里登记；不用新建脚本、不用多勾一个。
- 下面是 UViewer 的探测细节（别的游戏见上面各自的小节）。

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

## 列表视图、回退轨迹、渲染诊断

- **列表视图**：筛选 / 排序 / 每页条数写在节点 id 里：`<基础 id>|q=…&s=name|name_desc&n=25|50|100|200|500[#页码]`（只写和默认不同的；脚本节点 id 不带视图参数，进度按 `s:` id 记）。节点返回 `viewBase`（不带视图和页码的基础 id）和 `view{q,sort,size,defaultSize,sizes,sorts,unfiltered}`，前端只拼 id。筛选 / 排序在整张名单上做（只有名字，便宜），读脚本摘要 / 缩略图 / 数量只对当前页做。浏览器端搜索框 400ms 防抖，每页条数、跳页输入框、首页/末页都在工具栏和翻页条里。
- **读目录的缓存**：浏览 provider 在进程内缓存 sniff / 目录列表 / 脚本摘要 / 数量（目录 mtime 变了就失效，脚本摘要 5 分钟 TTL），sniff 并发 16。1000 个脚本的目录热请求约 13ms。
- **回退轨迹**（`app.js` 的 `galNavigate`）：从列表点进下一层时记下当前列表的完整节点 id（含页码、筛选、排序、每页条数），往上走（上一级 / 面包屑 / 播放页的「列表」）回到记下的那个 id，而不是服务端算的默认第 1 页。存在 sessionStorage，每个单元一份。
- **config.rawIgnore**：正则字符串列表（不分大小写，最多 50 条，非法的丢掉）。播放器里「N 条指令暂未渲染」不计入匹配的指令（匹配指令名和 `指令名,参数…`）；节点 `rawIgnore` 带给前端。`gal-layout` 脚本有同名选项（全局值），某个媒体要单独的用 `overrides[].config.rawIgnore`。点右下角的提示可展开诊断面板（按指令名汇总 + 样例 + 缺资源 + Spine 状态），可一键复制。
- **「更多」菜单**：沉浸 / 全屏收在「更多」里（浏览层和播放器都是，快捷键 I / F 不变）；沉浸按钮不再高亮。播放到最后一步且有下一章时，工具栏出现「继续下一章 ▶」。

## legeclo（Ren'Py，label H_<角色>_<编号>）

- **独立的 adapter `renpy-legeclo`**（`adapters/renpy-legeclo.mjs`），上下文（视频别名表 + 图片目录自动命名）复用 monmusu 的，解析自己写：
  - sniff：`label H_xxx:`（大写 H + 下划线）+ `$ enable_skip()` 或 `play voice "…"`；monmusu 的 label 是 `h<数字>`，不会被它认走；两个都允许时 legeclo 的脚本归 legeclo。
  - `scene <图片名> [with 转场]`：先查视频别名 → 图片目录（`images/` 下的文件按无扩展名的文件名自动命名）；名字里带 `black` 的当黑底（那张黑图不当背景图、也不会被拿去当缩略图）。
  - `show <立绘图名> [at left|right|center]`：立绘 = `images/sprite/` 下的**一整张图**（表情各是一个文件）→ `stand` 指令（单个部件、无裁剪）；不同的图名是不同的 tag，同时显示（和 Ren'Py 一样）；`hide <图名>` 去掉；`scene` 清掉所有立绘。`at left / right / center` → 部件的 `align`，立绘层给每个有 align 的部件各自独立摆放（底边对齐、水平贴左 / 居中 / 贴右）。
  - `play music / voice / sound`、`stop music fadeout (n)`、`"名字" "台词"` / `"" "旁白"`、`pause`、`with Dissolve(n)` 同 monmusu；`$ …`（python）、`hide screen …`、`stop voice` 忽略。
  - 不处理：翻译叠加（`tl/jptoen`、`tl/jptocn` 里的 `translate` 块）；只有 `.rpyc` 没有 `.rpy` 的脚本（编译产物，读不了）。
- **目录**：`game/script/hscene/<角色>_<编号>.rpy`（角色 id 可以带下划线，如 `agnes_boulanger_02`）、`game/script/movie.rpy`（视频别名）、`game/images/{bg,sprite,thumbnail/char,mo}`、`game/audio/{bgm,voice}`。`script/nav/` 里是导航界面，不是剧情。
- **`gal-layout` 探测**：目录结构和 monmusu 很像（都有 `script/hscene`、`script/movie.rpy`），所以靠名字区分：`options.rpy` 里有 `legeclo`，或游戏根旁边有 `legeclo_py.*`（启动器）；声明了 `game.id: legeclo` 的不要求这个标记。探测顺序 legeclo → monmusu → …。
  - 脚本根直接是 `game/script/hscene`，资源根 `game/`；按 `^(.+)_\d{2}$` 分组（去掉末尾两位编号 = 角色）；头像模板 `images/thumbnail/char/st_{name}_idle.png` 和 `st_{name}.png`（名字不统一，两种都试）；脚本封面 = 脚本里第一张真正的背景图。
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
- **Alt**（单按一下）：切换自动播放；Alt+其他键不触发。
