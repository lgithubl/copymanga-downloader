# Gal（视觉小说 / 剧情脚本）库类型

一个**作品目录 = 一个条目**，目录里每个**剧情脚本 = 一个单元**。目录本身就是数据：导入只建元数据 JSON，不 mv、不拷贝、不改原文件。

```
<rootDir>/                      「Gal 导入」方案 JSON 里的 rootDir，默认 <data>/gal
  作品A/                         每个子目录一个作品（目录名 = 标题）
    scenario/ep01.txt            脚本：扩展名在 scriptExtensions 里，且被某个适配器认得（sniff）
    download/bg/xxx.jpg          资源：脚本里的相对路径，按作品目录解析
    download/sound/bgm/xxx.mp3
```

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

## 还没定死的约定（都写在每个条目的元数据 `layout` 里，改约定只改 gal.mjs）

- `layout.stripPrefixes`（默认 `['download/']`）：资源找不到时，去掉这些前缀再试。
- `layout.sharedRoot`（默认 `true`）：再找不到，去 rootDir 下找共享资源。
- 封面 = 脚本里出现的第一张、且磁盘上存在的背景图（`coverPath`）。
- 资源解析只认 rootDir 之内的真实路径（`..` 和指出去的符号链接都拒绝）。

## 播放器（第一期）

背景（渐变/纯色）、说话人和台词（描边/颜色/粗斜体）、BGM/语音/音效、黑场、wait、视频、点击/键盘推进、后退、自动、回看记录、续播。
快捷键：空格/回车/→ 下一句，←/Backspace 上一句，A 自动，L 记录，F 全屏，I 沉浸（默认进入，和其他类型一致，Esc 退出并记住）。
按钮在文本框底部（小号），⚙ 设置：文本框背景透明度、BGM/音效音量、自动播放的「语音结束后等待秒数」（0–30，默认 1；没有语音的句子按字数估算时长）。设置存在浏览器 localStorage。
动画中按下一句 = 跳过动画（不是前进）。

自测：`scripts/dev/gal-selftest.mjs`（适配器/引擎/handler）、`scripts/dev/fe-gal-selftest.mjs`（浏览器）；
测试数据：`scripts/dev/make-gal-fixture.mjs <目录>`。
