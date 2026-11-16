# OrcX、RJ01375307、future、RJ01562637 接入记录

日期：2026-11-16。布局脚本版本：2.75.0。需要更新统一镜像；仅替换 tag 脚本不能提供这些新增解析器。

## 导入配置

在“导入方案 → 刷新 JSON”左侧可选 OrcX、CatPaw future、Unity Spine 原生 CG 互动；RJ01375307 继续用现有 RPG Maker 选项。每个游戏分别建立方案，修改 rootDir 和 title。

| 目录 | adapters | config.game.id | 当前范围 |
| --- | --- | --- | --- |
| RJ01743835/OrcX | `["orcx::script"]` | `orcx::RJ01743835` | 原生剧情、背景、立绘、CG、声音；部分演出标签待核对 |
| RJ01375307 | `["rpgmaker-json"]` | `rpgmaker::rj01375307` | 复用 RPG Maker MZ，增加原生 Hakubox 插件命令、配音及 Spine 多皮肤支持 |
| future | `["catpaw::script"]` | `catpaw::future` | 本地主线、回想、Live2D、声音；普通角色原生坐标/缩放、分层动作及回想；部分控制器演出尚未还原 |
| RJ01562637 | `["unityspine::gallery"]` | `unityspine::RJ01562637` | 原生开场/对话、配音、多轨动作及互动片段；连续原生按钮、已知条件自动判断、附加骨架显隐；未知存档状态手动选择，未模拟经营/触摸控制器 |

```json
{
  "rootDir": "/data/library/gal/RJ01743835/OrcX",
  "adapters": ["orcx::script"],
  "defaultMetadataActions": ["gal-layout"],
  "dryRun": false,
  "config": {
    "game": {
      "id": "orcx::RJ01743835",
      "title": "自己设置的标题"
    }
  }
}
```

其他游戏按上表替换三个字段。用户提供的标题保留。新增家族均有缩略图候选、特殊场景汇总及中途开始标记；标记只覆盖已解析的画面/动作切换，不代表原生所有控制流均已实现。

## 采集事实与验证（2.74.0 基线，本轮差异见 2.75.0）

原始数据、样本和测试报告仅放本地 `.cache/five-new-games-20261116/`，未提交游戏素材。源目录只读，未执行游戏 EXE、DLL 或 JS。稀疏样本只保证明确采集的字节区间有效，不拿空洞作为真实素材验证。

### OrcX

- Unity 6000.3.19 IL2CPP；866 个原生剧本，11,875 个作用域资源。Common/Main 同名文件分开索引。
- 866 个剧本全部解析，无抛错，共生成 23,214 步和 7,774 条语音指令；这不是每段完整原生演出均通过验证的声明。
- 导入、layout、列表、资源读取通过。`00_op_000` 样本 39 步、6 条语音、4 个中途标记；`50_ap_001_02_02_00` 样本 85 步、34 条语音。
- 浏览器实测背景、人物叠放及 CG；切换 CG 时人物正确清除。真实声音解码为 8.605 秒 PCM，RMS 0.240。
- 未核对的 CG 变体、调查控制流、计数和演出效果保留原脚本及行号诊断，不猜测资源后缀含义。

### RJ01375307

- RPG Maker MZ，原生 Hakubox 插件。只在原生 Hakubox_Core 启用时接入，其他 RPG Maker 不触发这些命令。
- 原生图片层、CV 目录、循环背景帧、多皮肤组合、服装/表情切换及显隐命令已接入。atlas 中文页名按原生预加载表映射至实际文件。
- 252 个公共事件解析通过。common-131 样本为 272 步、104 条语音指令（包含分支/调用展开，不等同原版一次游玩的句数）。
- 真实浏览器 Spine 显示、皮肤组合加载通过；`audio/cv/kana/cv_kana_184.ogg` 实际播放，10.897 秒，RMS 0.0908。
- 未执行好感度、日记、玩法计数、部分自定义 JS 与控制器逻辑，保留原始事件诊断。

### future

- 原生目录确实叫 `futrue_Data`。SENS 独立 RC4 块按需读取，footer/逻辑尺寸/边界校验，源文件不变。
- 4,945 条原始 talk 数据；31 个主线、24 个回想、31 个模型。55 个场景解析无抛错，共 5,655 步、3,192 条语音指令；存在分组复用，不作为去重台词数。
- Animator 状态通过实际 controller → AnimationClip → ResourceManager 引用解析原始 motion3，不按编号猜动作。
- `replay/100006` 导入得到 53 步、33 条语音引用；实际浏览器显示 119 个网格、106 个绘制网格，两张 8192 图集均成功读取，连续帧变化、暂停稳定。
- `talk100003` 实播 3.242 秒、RMS 0.0463；`alose_scene0` 实播 10 秒、RMS 0.00379。浏览器 Audio.currentTime 正常推进。
- 普通立绘精确位置、头像面板、部分非回想工具及事件控制器尚未还原，保留源行诊断；不能称为整段原生游戏逻辑完整复现。

### RJ01562637

- Fox Sex Farm，Unity 2021.3.45f2。上一版漏接了 sharedassets2.assets 中的正式 Story books，不能把这些对话都视为 Utage 示例；2.74.0 已沿原生控制器的 CallAVG 标签串回这些原始文本和配音。
- BuildSettings 有 32 个场景，其中 28 个原生 CG 房间。沿实际 level → Main SkeletonGraphic → SkeletonDataAsset → atlas/material/Texture2D 引用读取。
- 全部 28 个 CG 骨架及动作表解析通过；每个含 14–137 个动作，总计 2,092 个动作预览步骤。
- 实际导入列表有“特殊场景”和“角色CG”。`Ch02_Hcg01_黃毛正常位` 的 `z.premix/sex_lv1` 用真实 4096 图集在浏览器播放，Spine 4.2.43，无缺页/缺动作；连续帧变化、暂停稳定。
- 2.74.0 每个 CG 下有“原生开场 / 对话”“原生互动片段”“动作资源预览”。CG 控制数据用只读 Odin 二进制数据解析，不执行其 C# formatter、回调或游戏代码。7 本原始书籍中有 736 个标签，唯一名称的语音索引为 1,595 条；重复的音效名保留歧义诊断，不任选一个。
- 28 个开场批量解析得到 119 步、64 条配音指令（包含随机分支展开，非去重台词数）；2,424 个原生函数入口均解析无异常。原生随机对话和依赖游戏数值的条件均供手动选择。原版禁用的指令不执行；调用循环有界并保留来源诊断。
- 首个房间真实浏览器验证：身体轨道 0 `body/IdleBit_未插入待機` 与表情轨道 2 `face/IdleBit_未插入待機_Lv1` 同时显示、运动；A195、A196 对白音频分别实播 5.242/3.320 秒，PCM RMS 0.126/0.155。
- 仍未模拟经营、触摸命中、连续数值状态、完整并发调度、依赖状态挑选的多音源，以及部分子对象视觉显隐。对应来源、字段与偏移进入 raw 诊断；不能称为完整游戏控制器复现。

### underworld 阻塞原因

入口是失效软链接：

```text
/mnt/s1/nas/k8s/manga-image-translator/copymanga/data/library/gal/[G]/[]/underworld
  -> /mnt/s1/nas/k8s/manga-image-translator/copymanga/data/library/gal/[G]/Cat Paw Game/underworld
```

目标不存在，入口 isLink=true、isDir=false、isFile=false，因此没有游戏数据可采。未凭目录名猜测引擎或宣布支持。修复链接或放回目标后再采集。

## 依赖及兼容性

- 没有新增 npm/Python 运行时依赖，没有镜像正常运行时下载。
- Spine 元数据只复用镜像现有、固定 SHA256 的官方 Spine 4.2 JS 解析器，vm 中不暴露文件/模块/网络，仅传骨架和 atlas 数据；不执行游戏脚本。生产镜像的构建步骤本来已打包此文件。
- LZMA 解码复用已有 gal-download 的纯 Node 实现；SENS 用 Node 内建能力。
- Unity 2021 类布局来自 AssetRipper/TypeTreeDumps 的 2021.3.45f2；Animator 类布局来自 2022.3.0f1。SpineAtlasAsset/AtlasAssetBase 的字段结构与官方 spine-runtimes 4.2 源码及实际序列化字节核对。
- 参数漂移守卫通过：42 个注册适配器、64 个布局配置；导入下拉浏览器测试通过。旧 krkr 布局、BGI、RPG Maker、Djibril、RexEX、Utage、Naninovel、Unity Unite/CellTalk 回归通过。
- 真实浏览器报告：`browser-report.json`、`future-browser-report.json`、`fox-browser-report.json`；静态场景扫描报告：`all-scenes-report.json`、`rpg-audit.json`。这些报告留在上述本地 cache。

## 2.74.0 演出补充

- future：真实 angleRoleTalkPrefab 在 story/100000-0 第 100 个导出步骤（0-based 99）验证 185 网格、79 绘制网格；身体 await、服装 cloth_2、表情 face8、talk_fast 四条原生动作同时加载、播放及暂停通过，无缺失资源。高立绘按其原始画布比例显示，避免压扁。按原生 Animator 层号组合身体、衣服、表情及说话 motion3；同一句多个动作不再只留最后一个。保留未改动层，支持 roleTool 的第二组 key2/value2，显式参数在动画曲线后覆盖。精确普通立绘摆位及部分工具别名仍需继续核对。
- Unity 虚拟模型缓存修复：同一物理 assets 中的不同生成 JSON 现在按虚拟名称区分缓存身份，Native 版本升到 13 自动失效旧缓存。真实 alose/anglerole 两份模型在重新创建 handler 后仍各自返回自己的 moc、图集和动作，避免模型串用。
- RJ01375307：增加原生相对移动、帧数→秒的等待，以及渐隐目标透明度的实时过渡。真实浏览器读取到渐隐前/中/后 alpha 总量 31,184,414 / 28,318,700 / 0；逐步降低而非瞬间移除。
- OrcX：没有扩展名的音效只在相同原生作用域内查唯一精确文件；存在多个候选时保留诊断，不靠近似文件名猜测。特殊 CG 差分等演出仍待可靠的原生映射。
- 新增 gal-fox-room-selftest.mjs 和 gal-catpaw-native-selftest.mjs；前者验证数据边界、原始配音引用、手动分支、禁用指令、多轨 seek；后者用本地真实元数据回归同源不同模型缓存及重启后的身份。无新增运行时依赖或运行时下载。

Odin 数据格式参考：[BinaryEntryType](https://github.com/TeamSirenix/odin-serializer/blob/master/OdinSerializer/Core/DataReaderWriters/Binary/BinaryEntryType.cs)、[BinaryDataReader](https://github.com/TeamSirenix/odin-serializer/blob/master/OdinSerializer/Core/DataReaderWriters/Binary/BinaryDataReader.cs)。仅据格式读取原始数据，不加载其运行时库。


## 2.75.0 演出补完与验证

本轮没有新增运行时依赖、安装器或网络下载。服务端和播放器都有修改，需要更新统一 `gal-download` 镜像，再重跑 `gal-layout`；只替换脚本不够。原生索引版本升至 15，重新生成小型元数据，原游戏资源只读。

### RJ01562637

入口：特殊场景 → 对应房间 → **原生互动演出**。28 个房间都从原场景 `SexInteractiveArea_色色互動區塊.callAndIcons` 提取实际按钮，避免把内部函数当作玩家入口。连续轮数由 `adapterOptions["unityspine::gallery"].interactionLimit` 管理，默认 8、范围 1–16；编译命令超预算会降低轮数并报告 requested/actual，仍保留每种按钮和分支。

- 连续选择保留已经赋值的整数/浮点状态；原生 `AddStateTo` 求和可执行。条件采用原版 CompareGroup 的顺序短路，忽略原版也会覆盖的序列化旧操作数，不能套用 JS 的运算优先级。
- 原版没有 trueBlock 时会直接执行 falseBlock，按其实际实现处理。
- 对未知存档数值继续手动选择，保留原文件、偏移及条件。`SetXState` 的整数截断/ClampFloat 上下界、经营数值、触摸命中、部分状态选音和队列动作仍未完整还原，不能说成完整模拟原游戏。
- 从原始 CanvasScaler、RectTransform、SkeletonGraphic 和 SkeletonDataAsset 计算 1920×1080 舞台的位置/缩放、翻转与父级显隐。隐藏的附加骨架首次不加载图集，后续显示仍可恢复原轨道。尚未映射的 UI Image 开关和场景对象继续给出诊断。
- 28 个互动入口及全部 2,424 个原生函数入口通过解析审计；第一房间真实骨架、分层动作、语音 A195/A196 在 Chrome 播放和暂停验证通过。验证覆盖真实样本，未逐个观看全部房间。

### future

普通剧情角色从原始 `talkPrefab` 的 backGround/role 和角色预制体获取坐标，按原生 3840×2160 舞台、角色 offset、scale、模型画布原点和 pixels-per-unit 计算，不再统一缩放成全身。新建角色先计算摆位再首次显示。

主线 `100000-0` 第 100 个解析步骤的 angleRoleTalkPrefab 使用 offset=(-183,-1017)、原生 scale=2000；真实立绘的身体、服装、表情/说话层和暂停均通过浏览器验证。回想样本的多图集 Live2D 及语音也保留验证。未知布局继续记录源行诊断；未声称全部原生界面/小游戏已经模拟。

### OrcX

采集版本 2.58 取得原始 GameAssembly.dll（仅静态分析，没有执行游戏代码），使用本地 Cpp2IL 及反汇编确认：

- `ScenarioScript.LoadData @ 0x18042dbb0`：射精 / ぶっかけ / 潮吹 分别展开为原音效 903/904/905、白色过渡、x1/x2、y1/y2、z1/z2 差分序列；间隔 500ms。
- `ScenarioScript.ReadLine @ 0x180430050`：スチル 后缀原样拼接到脚本名，大小写保留。无后缀也有定义；日夜/怀孕相关存档变体未假装自动判断。
- 普通 CG 默认过渡 500ms；背景特效和其关闭命令也按时序输出，振动复用当前播放器效果（随机轨迹未逐帧对齐原版）。未支持的指令仍有文件/行号。
- 2.59 进一步只读采集约 11MiB 的精确压缩块，包括 `50_ap_001_02_02_00_x1/x2` 和原音效；本地稀疏验证目录的其他空洞不算真实样本。

### 回归记录

`gal-native-presentation-selftest.mjs` 覆盖原生条件顺序、已知/未知状态、缺失 trueBlock、连续按钮及退出、骨架显隐、future 坐标和 OrcX 大小写差分。

旧 TSK `Ch10340034` 45→46 表情顺序播放/直接跳转一致；旧 Krkr/BGI、RPG Maker、Live2D、导入预设及参数漂移检查通过。导入下拉 49 项覆盖 41 个注册适配器；刷新保留用户其他配置，且不提交保存。

浏览器补验：OrcX 原始 x1、x2 均有实际像素且画面不同；637 完整 reader → 原生对话选择 → 互动菜单 → 退出通过，未请求未使用的图集，没有浏览器错误。

本地证据保存在 `.cache/five-new-games-20261116/`：`fox-player-report.json`、`fox-browser-report.json`、`future-standing-browser-report.json`、`browser-report.json` 及各项回归日志。
