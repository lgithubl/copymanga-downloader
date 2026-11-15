# OrcX 数据确认及三个 RPG Maker 接入（2026-11-15）

## OrcX / RJ01743835

在实际目录 `OrcX` 找到数据，之前只按 RJ 编号定位会遗漏。Unity 6000.3.19 / IL2CPP，1622 个清单文件：

- `BepInEx/plugins/OrcXTextCN/scenarios/`：866 份中文剧情文本，约 2.77MiB；有原生音乐、背景、立绘、对话、等待及结束等标签。
- StreamingAssets 的 Common/Main 中有原生 ja/sc/en/ko/tc 剧情 bundle，另有 text、assettable、monoscripts 及实际图片/模型资源。
- 已采回全部中文文本、相关小型原生剧情包、global-metadata.dat、interop Assembly-CSharp.dll 及汉化插件用于静态分析；没有运行 EXE/DLL。

本轮只确认 OrcX 数据；没有把它冒充为已有 Unity 适配器支持的游戏。3D 演出与资源映射仍需独立适配。

## 三个新作

| RJ | 原生引擎 / 名称 | 导入 adapter / game.id |
|---|---|---|
| RJ01007726 | RPG Maker MZ / 苍蓝魔导士露娜 ～天才魔导士与传奇魔导士～ | `rpgmaker-json` / `rpgmaker::RJ01007726` |
| RJ01610452 | RPG Maker MZ / 光之公主 蒂亚丽普莉兹姆 | `rpgmaker-json` / `rpgmaker::RJ01610452` |
| RJ01319586 | RPG Maker MZ / 小悪魔スマホ（製品版+DLC）ver2.00.00 | `rpgmaker-json` / `rpgmaker::RJ01319586` |

复用通用 RPG Maker 导入下拉项，不新增重复适配器。layout 2.71.0 按 game.id 写入各作参数；用户填写的 title 优先。需要更新统一镜像包，再运行 layout。

### 实现

- DKTools：按配置语言静态读取 JSON 字典，支持嵌套文本标签、角色/地图名称及对话/选项。RJ01007726 默认 zh-CN，改 `adapterOptions.rpgmaker-json.localization.language` 可选原目录已有的语言。不下载语言包，不执行插件 JS。
- LL_LoopAnimation：读取原生动画帧表及帧间隔，支持播放、停止、固定帧、位置、缩放、镜像、旋转及无条件帧音效。条件音效与色调效果未模拟部分进入 raw 诊断。游戏原始帧已在浏览器验证动态变化。
- MIP：读取原生立绘表，支持 processChar / setEnabled、MessageLog 对白语音及常见地图战斗背景；QTE/战斗等交互插件保留 raw 诊断。没有把普通音效统称为对白配音。
- Koakuma：支持明确的 PlayVoice 和场景 BGV 角色/类型/强度/开始/停止/余韵命令；触摸小游戏状态机保留诊断。
- 封装 RPG：只读解析 EXE 的 Enigma 文件索引。数据库按需落应用 cache，外部图片/声音从原目录读取；解密密钥取已索引的 System.json，输出到 cache。目录边界与符号链接检查保留。没有执行 EXE 或游戏 JS。
- RJ01319586 的时间推进、自由行动、回想菜单总调度及小恶魔大范围互动调度不作为单段剧情展开；跳过调用时记录 `common-event-skipped-by-config`。否则一个剧情尾部会拉入大量无关事件并达到指令上限。具体剧情事件保留，图像与语音事件按原指令解析。
- 特殊场景归类、原始图片缩略图与中途开始沿用通用 RPG 功能，并补充各作 CG 路径规则。

### 实际验证

采集脚本 2.46：指定四个目录，源目录只读。EXE 只取有边界校验的数据库/插件区间；没有采整个 EXE。

本地保存证据在 `.cache/four-new-games-20261115/`：原目录清单、数据库、所需素材、解析统计、浏览器报告及截图。游戏素材不提交到仓库。

- 三作均走实际 `importFromSource → gal-layout → main 列表 → 场景 → getResource`。
- 实测入口：公共事件 `アニメ乱交8`（common-389）、`ハーレムLv5-3|授乳コキ`（common-406）、`QTE3-1:触手爬绕`（common-92）。分别 12 / 54 / 6 个文本步骤。以上是复现用样本，并非唯一可进入的剧情。
- 三作测试场景均有实际可见像素，语音均通过 Chromium PCM 解码和 HTMLAudio 播放计时递增检查。RJ01007726 确认动画画面随时间变化。
- RJ01319586 最终 62 张地图、1139 个目录卡片（含特殊场景重复入口）、73 个特殊场景入口；对全部卡片逐个 parse，0 失败。其它两作首轮分别 908 / 153 个卡片逐个 parse，0 失败；后续新增各自 CG 匹配规则。
- `gal-rpgmaker-new-three-selftest.mjs` 覆盖插件语义、语言、精确玩法排除、外部加密资源及越界/符号链接拒绝。
- RPG 既有事件/插件/地图/回想/跳过助手共 24 项测试通过，地图/标题表现测试 5 项通过；voiced/action-sequence、Djibril、RexEX 回归通过。
- 浏览器通用动画、实际 RPG 导入/地图/中途进入，以及刷新 JSON 下拉检查；下拉仍覆盖全部 38 个已注册适配器。

这些验证确认导入、测试场景显示和音频播放；没有宣称已模拟战斗、触摸/QTE 操作、全部原生视觉特效或每条剧情分支。

### 配置示例

使用现有“RPG Maker MV/MZ”下拉项，改根目录、id 和 title。例如：

```json
{
  "rootDir": "/data/library/gal/RJ01319586",
  "adapters": ["rpgmaker-json"],
  "defaultMetadataActions": ["gal-layout"],
  "dryRun": false,
  "config": {"game": {"id": "rpgmaker::RJ01319586", "title": "小悪魔スマホ"}}
}
```

另外两作仅替换 rootDir / id / title，已有导入项更新镜像后重跑 layout 即可。
