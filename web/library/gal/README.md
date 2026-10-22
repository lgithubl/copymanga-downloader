# Gal（视觉小说 / 剧情脚本）库类型

一个**目录 = 一个媒体条目，条目里只有一个单元（`main`）**。单元里是一棵由后端按需给出的**浏览节点树**（真实目录树）：
首页 → 一层层目录 → 脚本列表 → 播放页。目录本身就是数据：导入只建元数据 JSON（`source.path` 指向传进来的目录），不 mv、不拷贝、不改原文件。

## 分层

```
目录方案 profile（gal/profiles）   这个目录里东西在哪：脚本根（可以有几个，如不同语言文本）、资源根、名称文件、缩略图目录
        │                          元数据（layout）只存方案名 + 这几个路径；目录树/标题/缩略图全部靠读真实目录和脚本内容现算
节点提供者（gal/browse.mjs）        目录树 → 节点（grid / list / player），翻页、返回页码、上下话、面包屑
脚本适配器（gal/adapters）          脚本文本 → 规范场景 gal-scene/1（含 select / if 分支）
前端渲染器                          gal-browse.js（grid/list）、gal-player.js（player）；沉浸等页面状态两者共用
```

- **方案 `uviewer`**（`profiles/uviewer.mjs`）：UViewer 自己把位置写死在后端里（静态分析 exe 得到），我们只认出这种布局：
  `<resource_path>/download/adv/text` 是脚本根（`resource_path` 来自 `user_data/settings.json`，默认 `./resources`），
  同级以 `text` 开头的目录（比如 `text---日文…`，换汉化文本时留下的备份）是可切换的另一套文本；资源根 = `resource_path`；
  `user_data/character_names.json` 是名称文件；`user_data/thumbnails` 是 UViewer 自己生成的脚本缩略图。
  目录名的中文标签（cabin→纪念馆…）、角色头像去哪找，也在这个方案里。UViewer 只扫 4 个分类，我们按真实目录树走，所以 event/quest/gacha… 也看得到。
- **方案 `generic`**（兜底）：整个目录是脚本根，脚本里的路径按媒体目录解析（找不到再去掉 `download/` 前缀试一次）。
- **新增一种目录布局 = 新写一个方案**（id / label / detect / 几个小钩子），在 `profiles/index.mjs` 登记，浏览和播放都不用改。

## 浏览节点（取数接口 = 通用的 reader）

前端不认识目录，只认节点。取节点就是通用的 `GET /api/library/items/gal/<id>/reader/main?sectionId=<节点 id>`
（`sectionId` 是 epub 就有的参数，路由 `#/media/gal/<id>/main?section=…`、进度、历史都是现成的）。

| 节点 id | kind | 内容 |
|---|---|---|
| `''` | `grid` | 首页：默认脚本根下的目录 |
| `d:<相对路径>[#页]` | `grid` / `list` | 目录：全是目录 → 卡片网格；有脚本 → 列表（目录在前，每页 25，每项带缩略图和第一句台词） |
| `s:<相对路径>` | `player` | 播放页：带规范场景；`sectionNavigation` = 同一目录里的上/下一个脚本 |
| `@<脚本根 id>\|…` | | 非默认的文本版本（另一种语言）；节点带 `sets` 列表，前端做下拉 |

每个节点带 `parent`（返回上一级，列表节点带页码，所以返回会回到点进来的那一页）和 `breadcrumb`。
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

## 还没定死的约定（都写在每个条目的元数据 `layout` 里）

- `layout.stripPrefixes`（默认 `['download/']`）：资源找不到时，去掉这些前缀再试。
- `layout.browse`：分类/角色目录、每页条数、变体后缀等（见上）。
- 资源解析和脚本读取都只认媒体目录之内的真实路径（`..` 和指出去的符号链接都拒绝）。

## 播放器（第一期）

背景（渐变/纯色）、说话人和台词（描边/颜色/粗斜体/`<size>` 相对字号/`<ruby>` 注音）、BGM/语音/音效、黑场、wait、视频、点击/键盘推进、后退、自动、回看记录、续播。
快捷键：空格/回车/→ 下一句，←/Backspace 上一句，A 自动，L 记录，F 全屏，I 沉浸（默认进入，和其他类型一致，Esc 退出并记住）。
按钮在文本框底部（小号），⚙ 设置：字体大小（60%–200%，脚本里的 `<size>` 跟着一起缩放）、文本框背景透明度、BGM/音效音量、自动播放的「语音结束后等待秒数」（0–30，默认 1；没有语音的句子按字数估算时长）、自动选择。设置存在浏览器 localStorage。
沉浸是整个页面的状态：浏览层和播放页共用（默认进入；`I` 切换；`Esc` 退出并记住；沉浸里浏览层的顶栏有「退出沉浸 / 返回」）。
动画中按下一句 = 跳过动画（不是前进）。

自测：`scripts/dev/gal-selftest.mjs`（适配器/引擎/handler）、`scripts/dev/fe-gal-selftest.mjs`（浏览器）；
测试数据：`scripts/dev/make-gal-fixture.mjs <目录>`。
