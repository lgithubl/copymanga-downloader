# RPG Maker 事件适配

`rpgmaker-json` 读取 RPG Maker MV/MZ 的原始事件 JSON。MV/MZ 用四个游戏的实际采集验证，专用插件按通用命令规则扩展。它用于阅读剧情和回想，不是完整 RPG 游戏模拟器。

首次需要更新镜像，导入时选择 `rpgmaker-json`，然后运行新版 `gal-layout`。标准 `www/data` 和直接 `data` 的目录都能探测，之后新增同类游戏主要调整布局/匹配规则。

## 通用层与游戏配置

- 原生事件：消息、选择、开关/变量赋值与条件分支、公共事件调用、图片显示/终点移动/隐藏、BGM/BGS/SE、淡入淡出、等待、视频。分支条件在进入时取快照，分支里改开关不会误执行 else。
- 地图：按 MapNNN.json + Tilesets.json 渲染 A1–A5/B–E 瓦片、自动拼接、阴影、桌边、上下层遮挡；按事件页显示普通/大人物行走图，支持剧情指令的位置、转向、移动路线、消失、开关换页及固定目标地图转移。前进、回退、中途开始均重建地图状态。水面与踏步动画在本地绘制。
- 可选插件：SimpleVoice（MV 日文命令及 MZ 结构化命令，普通语音不循环）、VisuMZ VoiceActControl、ParallelBgs 多路背景音、LL_GalgeChoiceWindow 条件选项及结果变量、LogDisplayPlugin 文本窗口、VariableSpriteDisplay 图片/变量组、DTextPicture 基本文字图片、PictureCallCommon 图片按钮、LL_StandingPictureMV（从启用插件的参数中读立绘表）、受限的字面量 `$gameScreen.showPicture/movePicture/erasePicture/clearPictures` 调用。自定义声音命令通过正则、命名捕获和目录配置映射。
- 系统不执行游戏 JavaScript。未知事件、脚本、插件、递归或调用深度上限会明确写入 `stats.raw` / `warnings`。库存/装备、玩家操控行走、战斗、任意脚本条件、向后循环、立绘动作/眨眼、预约语音等尚不模拟。
- `root`、舞台、初始开关/变量、公共事件/地图列表开关、名称黑名单、CG/背景路径规则、特殊场景匹配、插件开关均来自 `adapterOptions`。RJ01482469 的文件命名规则只在布局表的专用 profile 中，通用解析器没有 RJ 号或角色编号。
- 每个公共事件及每个地图事件页有稳定的独立路径：`CommonEvents.json::common-123`、`Map018.json::event-35-2`；不会将全部事件按 ID 串成错误剧情。明确选择某页时，其开关/变量页条件作为初始条件；没有游戏存档状态。

## 列表的三个公共能力

1. **缩略图筛选**：图片命令按 `pictures.cgMatch/backgroundMatch` 标注 CG/背景，立绘独立标注。未命中命名规则的原生/字面量“显示图片”也可通过 `pictures.thumbnailMatch` 提供缩略图候选（默认 `.`），排在明确 CG 之后；只影响卡片，不改变 CG 标记、特殊场景分类或跳转点。`pictures.thumbnailSkip` 排除常见按钮/图标名称，插件立绘表中的图片不作此兜底。继续复用 `thumbFallback`（优先级、only/skip、扫描范围、最大张数）及 `thumbSkip`（路径、体积、尺寸）。布局默认排除 system/faces/characters 目录，以及宽小于256且高小于144的 pictures 小图；均可配置。不能保证靠名称过滤识别所有游戏 UI。
2. **中途开始**：复用 `sceneMarkers`，可按 CG 图片、循环语音、BGM 切换生成卡片按钮。目标在选择分支内时，按钮携带到达目标所需的选择记录，播放器从头重建变量/画面/持续声音状态后定位；最多尝试 128 条选择历史，无法到达的不生成误导按钮。无需执行任意游戏脚本。
3. **特殊场景汇总**：按事件名、地图名、CG 资源名匹配；支持开关、最少文本数、公共事件调用去重。汇总是附加入口，正常公共事件、地图列表仍保留。回想菜单只有简单提示并转调公共事件时，优先收实际事件，避免菜单套一层重复卡片。

例如，媒体 config 可覆盖（修改布局表 profile 或管理员配置均可）：

```json
{
  "adapterOptions": {
    "rpgmaker-json": {
      "root": "www",
      "maps": {"enabled": true, "tileSize": 48, "player": true, "follow": "event"},
      "pictures": {
        "cgMatch": "(^|/)(CG|EV)_",
        "thumbnailMatch": ".",
        "thumbnailSkip": "(^|/)(button|btn|cursor|icon|window|balloon|loading)([_./]|$)"
      },
      "special": {
        "enabled": true,
        "nameMatch": "回想|回憶|replay",
        "mapNameMatch": "回想部屋|recollection",
        "imageMatch": "(^|/)(CG|EV)_",
        "minText": 4,
        "deduplicateCalls": true
      },
      "plugins": {
        "commands": [{"match": "^MY_VOICE (?<name>[^ ]+)$", "op": "voice", "folder": "audio/customvoice"}]
      }
    }
  },
  "thumbFallback": {"prefer": ["cg", "bg"], "only": [], "skip": ["button|cursor|icon"], "scanSteps": 2000, "max": 3},
  "thumbSkip": [{"match": "(^|/)img/(system|faces|characters)/"}],
  "sceneMarkers": [{"label": "CG 开始", "kind": "cmd", "op": "overlay", "match": "(^|/)(CG|EV)_", "pick": "each", "max": 6}]
}
```

## 原始媒体与缓存

MV 的 `.rpgmvp/.rpgmvo/.rpgmvm` 和 MZ 的 `.png_/.ogg_/.m4a_` 使用本地 `System.json` 密钥解密，仅在请求该资源时写到 `cache/gal-rpgmaker-res`。先验证加密头和解密后的媒体签名。缓存键含源路径/体积/mtime 和 System.json 内容；换文件或换密钥不会复用旧缓存。

游戏原目录只读，不全量解包，不下载运行时或解码器。

封装成 Enigma Virtual Box EXE 的 MV/MZ 游戏可自动识别。`packedExe` 记录媒体根目录的 EXE 文件名；服务端只读其资源索引，不启动 EXE 或执行游戏 JS。先把事件 JSON 和插件参数写到 `cache/gal-rpgmaker-packed`，图片/音频按请求读取，再复用解密和缩略图流程。源文件路径、大小及修改时间参与缓存版本。当前支持已验证的现代、未压缩 VFS 条目；压缩或旧式封装明确报错，不静默忽略。缩略图和正常媒体接口均使用解密缓存，因此卡片过滤、浏览器图片加载及音频 Range 请求可复用现有流程。

地图及本轮插件/EXE 资源支持需要更新镜像及 `gal-layout` 2.51.0，然后重跑布局并刷新游戏索引，无需重新导入。只更新 tag 包无法加入浏览器渲染代码。图片卡片沿用图片缩略图规则，纯地图事件暂不生成地图截图缩略图。

地图从事件的初始状态开始，没有存档时玩家放在系统起点或事件附近；`maps.follow` 默认跟随当前事件，可改为 `player`，`maps.player:false` 可隐藏玩家。仅支持静态地图与剧情指令驱动的演出，不执行自主移动、并行事件、玩家操控、碰撞或游戏 JavaScript。随机/脚本路线、无限重复路线、变量目标地图、气泡及战斗仍记入 raw，重复路线仅执行一轮。地图远景沿用背景层，不模拟插件视差/光照。

## 验证

- `node --test scripts/dev/gal-rpgmaker-selftest.mjs`：原生事件、分支取快照、公共事件循环保护、字面量图片参数、未知脚本不执行、缩略图筛选、分支中途开始。存在本地采集时另验证 RJ 的实际 38 张地图、179 套立绘配置、全部公共事件及加密媒体样本。
- `PLAYWRIGHT_PATH=... CHROME_PATH=... node scripts/dev/fe-gal-rpgmaker-selftest.mjs`：完整 app 导入、布局、特殊场景卡片、加密缩略图、点击分支按钮、正确文本与实际画布像素、页面错误检查；用通用合成游戏防止只对 RJ 生效。

- `node --test scripts/dev/gal-rpgmaker-map-selftest.mjs`：地图状态/转向/移动/换页/转移/回退，对照采集 MV 引擎逐项验证8191种瓦片切分。完整 app 浏览器测试另验证加密瓦片、加密人物、移动转向和回退的实际像素。

## 插件演出边界与本轮验证

LogDisplayPlugin 窗口保留显示、追加、隐藏和回退状态；VariableSpriteDisplay 读取启用插件的参数，变量文本随剧情状态更新。自定义窗口使用安全的静态绘制，不模拟所有插件字体、滚动、计时消失或游戏交互逻辑。图片按钮在当前场景末尾提供图片点击及普通列表按钮；仅展开受限的小型公共事件回调，最多默认16个。较大、递归或循环回调记为 `picture-actions-complex-gameplay`，可从公共事件列表单独进入，不将游戏循环拼成无限剧情。多页 `call_ev` 需要实际存档状态时记入诊断。

通用规则扩大了特殊场景的事件名/图片路径匹配，并排除准备、删除、并列等辅助事件名。实际游戏仍可能需要配置 `special.nameMatch/skipNameMatch/imageMatch`、初始开关/变量和缩略图过滤；这些不写死到适配器。

- `node --test scripts/dev/gal-rpgmaker-plugins-selftest.mjs`：结构化/日文语音、多路BGS、条件选择、插件文本窗口、图片按钮、前向标签跳转、确定性随机值、回退状态。
- `node --test scripts/dev/gal-rpgmaker-collected-selftest.mjs`：本地存在采集时，验证 RJ01220265/RJ01282923/RJ01402662 的真实布局、场景目录和全部24个媒体样本；图片经过实际解密及缩略图接口，音频校验 Ogg 签名；提供 `PLAYWRIGHT_PATH`/`CHROME_PATH` 时另验证浏览器解码及有效时长。封装游戏使用保留原始偏移的采集副本，验证4200项索引和11个样本。未采集的媒体不计为已验证。
- 完整 app 浏览器测试另验证插件文本窗口实际画布和图片按钮回调；不宣称已模拟完整 RPG 游戏玩法。

布局2.53.0：保留手动媒体标题，显式标题覆盖项优先；标题仍是目录名时使用配置的游戏标题，最后回退 System.json 标题。优先用游戏目录/icon目录中的 PNG/ICO 图标，ICO复用内置PNG/DIB解码后写到应用cache，无新增依赖。非循环插件语音归到普通语音设置、自动播放等待和当前句重播，也能进入随机语音列表。
