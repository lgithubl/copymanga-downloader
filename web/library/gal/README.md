# Gal（视觉小说 / 剧情脚本）库类型

一个**目录 = 一个媒体条目，条目里只有一个单元（`main`）**。单元里是一棵由后端按需给出的**浏览节点树**：
首页 → 选分类 → （选角色 →）选脚本 → 播放页。目录本身就是数据：导入只建元数据 JSON（`source.path` 指向传进来的目录），不 mv、不拷贝、不改原文件。

```
<媒体目录>/                      导入时传的目录（sourcePath），不传就用「Gal 导入」方案 JSON 的 rootDir（默认 <data>/gal）
  cabin/ room/ other/            各分类：下面直接是脚本
  character/<角色id>/            角色：下面是脚本；文件名以 _image / _video 结尾的算同一组的两个版本
  character/<角色id>/icon.png    可选，角色头像
  character_names.json           可选，{ 角色id: 显示名 }
  cover.jpg                      可选，封面（没有就取前几个脚本里第一张存在的背景图）
  download/bg/xxx.jpg            资源：脚本里的相对路径，按媒体目录解析
  download/sound/bgm/xxx.mp3
```
（目录约定是编的，真实样本到了再对齐：全部在 `gal/browse.mjs` 的 `DEFAULT_BROWSE_LAYOUT`，也存在条目元数据 `layout.browse`。
一个分类目录都没有时，首页退化成「递归找到的所有脚本」的列表。）

## 浏览节点（取数接口 = 通用的 reader）

前端不认识目录，只认节点。取节点就是通用的 `GET /api/library/items/gal/<id>/reader/main?sectionId=<节点 id>`
（`sectionId` 是 epub 就有的参数，路由 `#/media/gal/<id>/main?section=…`、进度、历史都是现成的）。

| 节点 id | kind | 内容 |
|---|---|---|
| `''` | `grid` | 首页：分类卡片 |
| `c:<分类>#<页>` | `grid` / `list` | 分类页：角色头像网格 / 脚本列表（每页 25） |
| `ch:<角色>#<页>` | `list` | 角色的脚本分组；一项可带多个「变体」按钮（图片版/视频版） |
| `s:<相对路径>` | `player` | 播放页：带规范场景；`sectionNavigation` = 同一级里的上/下一个脚本 |

每个节点带 `parent`（返回上一级，列表节点带页码，所以返回会回到点进来的那一页）和 `breadcrumb`；选项自带下一个节点 id。
**以后加新的渲染方式（文本+图片、文本+视频…）= 新增一个 kind + 前端一个渲染函数**，取数接口不变。
前端：`static/gal-browse.js`（grid/list）、`static/gal-player.js`（player）；`app.js` 的 `renderGal` 按 `reader.node.kind` 分发。
进度只记播放页（`s:…`），每个脚本各记各的（`progress.nodes`），在列表里逛不会冲掉「上次看到哪」。

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

背景（渐变/纯色）、说话人和台词（描边/颜色/粗斜体）、BGM/语音/音效、黑场、wait、视频、点击/键盘推进、后退、自动、回看记录、续播。
快捷键：空格/回车/→ 下一句，←/Backspace 上一句，A 自动，L 记录，F 全屏，I 沉浸（默认进入，和其他类型一致，Esc 退出并记住）。
按钮在文本框底部（小号），⚙ 设置：文本框背景透明度、BGM/音效音量、自动播放的「语音结束后等待秒数」（0–30，默认 1；没有语音的句子按字数估算时长）。设置存在浏览器 localStorage。
动画中按下一句 = 跳过动画（不是前进）。

自测：`scripts/dev/gal-selftest.mjs`（适配器/引擎/handler）、`scripts/dev/fe-gal-selftest.mjs`（浏览器）；
测试数据：`scripts/dev/make-gal-fixture.mjs <目录>`。
