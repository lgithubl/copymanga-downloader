# RPG Maker 事件适配

`rpgmaker-json` 读取 RPG Maker MV/MZ 的原始事件 JSON。MV 用 RJ01482469 的实际采集验证；MZ 的原生消息、公共事件、图片等相同结构可复用，专用插件按规则扩展。它用于阅读剧情和回想，不是完整 RPG 游戏模拟器。

首次需要更新镜像，导入时选择 `rpgmaker-json`，然后运行新版 `gal-layout`。标准 `www/data` 和直接 `data` 的目录都能探测，之后新增同类游戏主要调整布局/匹配规则。

## 通用层与游戏配置

- 原生事件：消息、选择、开关/变量赋值与条件分支、公共事件调用、图片显示/终点移动/隐藏、BGM/BGS/SE、淡入淡出、等待、视频。分支条件在进入时取快照，分支里改开关不会误执行 else。
- 可选插件：SimpleVoice（含独立循环语音）、LL_StandingPictureMV（从启用插件的参数中读立绘表）、受限的字面量 `$gameScreen.showPicture/movePicture/erasePicture/clearPictures` 调用。自定义声音命令通过正则、命名捕获和目录配置映射。
- 系统不执行游戏 JavaScript。未知事件、脚本、插件、递归或调用深度上限会明确写入 `stats.raw` / `warnings`。库存/装备、地图行走、战斗、任意脚本条件、循环控制、立绘动作/眨眼、预约语音等尚不模拟。
- `root`、舞台、初始开关/变量、公共事件/地图列表开关、名称黑名单、CG/背景路径规则、特殊场景匹配、插件开关均来自 `adapterOptions`。RJ01482469 的文件命名规则只在布局表的专用 profile 中，通用解析器没有 RJ 号或角色编号。
- 每个公共事件及每个地图事件页有稳定的独立路径：`CommonEvents.json::common-123`、`Map018.json::event-35-2`；不会将全部事件按 ID 串成错误剧情。明确选择某页时，其开关/变量页条件作为初始条件；没有游戏存档状态。

## 列表的三个公共能力

1. **缩略图筛选**：图片命令按 `pictures.cgMatch/backgroundMatch` 标注 CG/背景，立绘独立标注；继续复用 `thumbFallback`（优先级、only/skip、扫描范围、最大张数）及 `thumbSkip`（路径、体积、尺寸）。普通 UI 小图不会因为是叠加层就自动充当 CG。
2. **中途开始**：复用 `sceneMarkers`，可按 CG 图片、循环语音、BGM 切换生成卡片按钮。目标在选择分支内时，按钮携带到达目标所需的选择记录，播放器从头重建变量/画面/持续声音状态后定位；最多尝试 128 条选择历史，无法到达的不生成误导按钮。无需执行任意游戏脚本。
3. **特殊场景汇总**：按事件名、地图名、CG 资源名匹配；支持开关、最少文本数、公共事件调用去重。汇总是附加入口，正常公共事件、地图列表仍保留。回想菜单只有简单提示并转调公共事件时，优先收实际事件，避免菜单套一层重复卡片。

例如，媒体 config 可覆盖（修改布局表 profile 或管理员配置均可）：

```json
{
  "adapterOptions": {
    "rpgmaker-json": {
      "root": "www",
      "pictures": {"cgMatch": "(^|/)(CG|EV)_"},
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

游戏原目录只读，不全量解包，不下载运行时或解码器。缩略图和正常媒体接口均使用解密缓存，因此卡片过滤、浏览器图片加载及音频 Range 请求可复用现有流程。

## 验证

- `node --test scripts/dev/gal-rpgmaker-selftest.mjs`：原生事件、分支取快照、公共事件循环保护、字面量图片参数、未知脚本不执行、缩略图筛选、分支中途开始。存在本地采集时另验证 RJ 的实际 38 张地图、179 套立绘配置、全部公共事件及加密媒体样本。
- `PLAYWRIGHT_PATH=... CHROME_PATH=... node scripts/dev/fe-gal-rpgmaker-selftest.mjs`：完整 app 导入、布局、特殊场景卡片、加密缩略图、点击分支按钮、正确文本与实际画布像素、页面错误检查；用通用合成游戏防止只对 RJ 生效。
