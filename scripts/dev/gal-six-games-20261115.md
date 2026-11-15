# 六作接入与验证（2026-11-15）

本轮目录采集、原生资源解析、导入入口和阅读器接入。分支 `feat/gal-download`；自动采集分支 `vibe-test-20261008`。更新镜像后，对这六作重跑 `gal-layout` 2.66.0。

## 入口与覆盖范围

| 游戏 | adapter | game.id 示例 | 当前边界 |
| --- | --- | --- | --- |
| RJ01610188／魔法少女ヨルティナ | `naninovel::script`（新增） | `naninovel::RJ01610188` | 174 原生 playlist，配置、人物分层、背景、CG、原始配音；特殊场景按原始 CG 调用归类。个别自定义特效记 raw。 |
| RJ01660877／GirlsClub | `utage::native`（新增） | `utage::RJ01660877` | 163 本体工作簿，保留独立 grid 入口；原生回想表 29 项；图片、声音、A/B/C Cubism 资源与原始曲线。游戏经营界面、部分系统回调/特效不执行，记原行 raw。 |
| RJ01474142／GirlReno | `rpgmaker-unite`（新增） | `unite::RJ01474142` | 344 可读事件入口、77 特殊场景；UUID/字符串参数转换后复用 RPG 编译器；VoiceEvent、原生选项、本地化人物名。没有存档的条件让用户选择；不实现战斗或地图探索。 |
| Night Stroll | `rpgmaker-json`（复用） | `rpgmaker::night-stroll` | 原生回想 42 项；Live2DInterfaceMZ 别名、位置、缩放与多槽位；实际 R018 的 Moc3 v5 几何/动画。 |
| RJ01664771 | `rpgmaker-json`（复用） | `rpgmaker::RJ01664771` | 原生回想 30 项，跟随回想目的地图唯一自动剧情；TRP Skit 单层身体与独立表情图、SimpleVoice。 |
| RJ01687472／Dark Elf Descent into Corruption | `celltalk::native`（新增，静态预览） | `celltalk::RJ01687472` | **不是完整游戏执行器**。已核对构建的 46 个回想控制器静态调用图，其中 44 个有可读正文；按原生 ID 范围/存档条件组织台词，按 CG 预制体/脸部组件引用导出图层，支持原始语音。其余控制器及原生动画/立绘操作见诊断。 |

新增四项全部进入“导入方案 → 刷新 JSON”左侧下拉。两作 MZ 使用现有 RPG Maker 选项，不重复新增。所有入口保留用户的 title；家族 id 的后缀可由用户自己命名。

## 配置示例

```json
{
  "rootDir": "/data/library/gal/RJ01610188",
  "adapters": ["naninovel::script"],
  "defaultMetadataActions": ["gal-layout"],
  "dryRun": false,
  "config": {"game": {"id": "naninovel::RJ01610188", "title": "魔法少女ヨルティナ"}}
}
```

其他游戏按表替换 rootDir、adapters、id、title。布局自动寻找原始 `*_Data`（含 `Game/*_Data`），不要求用户预先导出 UnityPy 文件。不要把这四种原生 Unity 当成 `unity::dsm` 或 UViewer。

## 原始素材与运行方式

- UnityFS 只读取命中的 LZ4 块；大型 textures/audio stream 按需读范围，不在打开列表时导出整批素材。
- Naninovel 的 SerializeReference 命令与配置均严格校验字段尾部；序列化布局作为静态数据随镜像内置。未执行任何采集到的 DLL/插件 JS。
- CellTalk 生产环境只读内置的数据调用图；GameAssembly 和 metadata 的 SHA-256 必须同时匹配。静态提取工具 `gal-celltalk-profile-dev.py` 仅供本地开发，依赖 pefile/capstone；不进入镜像，不运行原生指令。
- PNG 解码使用 Node 和既有 sharp；音频使用已有 FSB5/Vorbis 数据及 ffmpeg。Crunch 使用随镜像内置的约 178 KiB loader+WASM（版本及 SHA 在 vendor/texture2ddecoder/NOTICE.md）。**没有运行时下载、pip/npm 安装、UnityPy 或 Windows 依赖。**
- 小脚本写在游戏 Data 下 arc/script；旧导出移动到 arc/cache/script-backups。原始资源只读，媒体按普通资源缓存路径处理，没有直接删除源文件。
- Live2D 多槽位与 Moc3 v5 是新增路径，旧默认 Live2D 槽位保持兼容；缩略图复用同一个模型解码器，离屏截图才保留帧缓冲。

## 验证

始终区分“解析完成”“组件显示”“原生整段剧情完全执行”。fixture 位于 `.cache/six-games-20261115`，不提交原始 CG、配音、DLL 或游戏脚本。

- `gal-six-unity-selftest.mjs`：原始导入 → layout → 列表 → 真实场景 → PNG/模型 JSON、Ogg 字节；验证标题和配置，另测 sprite 裁边还原、范围与分支、损坏输入边界。
- `gal-six-native-mz-selftest.mjs`：42/30 原生回想、唯一自动事件、安全保留旧行为、真实 R018 v5 可见动态顶点。
- `fe-gal-six-native-selftest.mjs`：真实浏览器显示、音频、动态模型及 Live2D 缩略图，输出在 `.cache/six-games-20261115/browser-verified/`。
- 旧 RPG/Live2D 回归、布局参数漂移守卫、导入下拉覆盖守卫。

采集包含目录索引、剧情数据和指定的媒体样本/字节范围。大 Unity stream 采用稀疏本地验证副本，仅填充明确采集的范围；未采媒体不能因此声称已验证。CellTalk 的其余 CG 只采了 CAB 元数据所在块，并未批量下载全部 CG/声音。

## CellTalk 尚未完整覆盖

已核对的 54 个回想控制器中，10 个未进入可读预览：露出1、軍団長の夜伽5、踊り、母乳イベント、娼館、娼館ピエトロ、娼館手ほどき、レイス凌辱、軍団長の夜伽6、街の支配者。需要继续处理协程子调用、动态选项或反编译缺失的分支；其中两项只有未还原子协程，不作为空场景展示；不会把整张文本表直接拼成假剧情。

已导出控制器内，原生 `Animator`、`Stand*`、部分摄像机/系统调用仍带 native 地址记 raw；因此不承诺这些场景与原游戏演出完全一致。采集表中还存在控制器引用但文本表没有的 ID：はぐれ兵凌辱 的「非処女」「処女」、サキュバス凌辱 的「暗転」，单独记录 missing-text-id，不猜台词替代。存档条件以手动选择呈现。

后续修改 native profile/导出协议需更新 UNITY_NATIVE_VERSION，避免继续读取旧导出。只升级 tag 脚本无法启用此次新增的解析器和 Moc3 v5，必须更新镜像。


## 2026-11-15 用户复核后的修正与缺口

- RJ01664771：RPG code 225 不能套通用归一化 strength。现保留 power/speed/frames/wait，并按原生 60Hz updateShake 轨迹和舞台比例播放；单独 translate 不覆盖镜头 transform。跳转、快进、跳过等待及销毁时取消震动。真实浏览器 power=3/speed=3 的测试振幅约 6.56 CSS px，跳过后恢复零。
- RJ01660877：catalog 卡片已有原生缩略图时，enrichCatalogItems 曾直接 continue，导致未计算中途开始 markers。现在带 script 的叶节点继续补 markers，保留原生封面。真实导入→layout→特殊场景卡片（みくアフター１）和 MH1 播放接口验证通过。
- RJ01474142：**地图背景尚未实现**。normalizeUnite 曾只合成 width=1/data=[] 的空地图，adapter 显式 maps.enabled=false。2.10 追加采集的 37 个 Map/SO 定义均没有背景 PNG/Parallax，实际绘图来自 SavedMaps/*.prefab 的 Unity Tilemap。2.12 已请求 37 个原始 prefab，总计 632824 字节；不能用随机 CG 替代地图，也不能声称当前已支持地图演出。
- RJ01687472：**普通 Stand 与原生世界场景尚未实现**，目前 CGLoad 的分层 CG 与普通 Stand 是两套逻辑。资源管理表有 stand/ナタリア、ノエル、ミラ、ライラ，已经确认 saveinfo/defaultparts/poses 等序列化布局及 StandLayerInfo 的资源路径。原生控制器内 Stand、StandChangeCloth、StandSetActive 等目前仍为 unsupported；需要保留参数并还原 Animator 的站位、显隐与服装状态。根 Transform 的零缩放是运行时占位，不能直接按零缩放或猜坐标输出。背景涉及原始 Unity 场景/相机，而非缺少某个导入开关。
- RJ01610188：全量导出 playlist 计 4939 条 PrintText，可匹配 2577 条语音（条件执行后略少）。匹配角色：yorutina 2483、isari 75、yoruko 15、mahousyouzyoisari 4；很多路人整段无 Voice ID。0001_Story_Opening1 的真实样本在浏览器实际播放通过。已追加采集 sharedassets0..3 元数据头；其中仅 sharedassets0 另有 22 个 AudioClip（总对象数据2232字节），尚需读取名称排除其他语音库。没有用户具体场景，不能断言其遇到的全部无声均属正常。

本轮采集/分析文件保存在 `.cache/six-games-20261115/`，未把游戏资源写入仓库。


## Unite 地图跟进验证

- 已补齐 SavedMaps Tilemap → 按需 PNG → 普通 RPG 地图层的链路。Sprite 使用原生 PPtr、完整画布/pivot、ppu、色彩/透明度、SortingOrder 和瓦片坐标，不使用 MV/MZ 自动瓦片猜测。只在读取该地图时解码本地资源，图片裁切跟随事件位置。没有新增依赖或运行时下载。
- 37 张原始地图全部完成合成检查；初始化空地图原样保持黑色，未误报解析失败。活跃瓦片矩阵已校验，未支持矩阵显式报错。静态 PNG 有 64M 像素上限。
- 原生 ResolutionManager 构造器给定 1920×1080，CameraResolutionManager 基于此基准设置 assetsPPU=96；不是人为把地图放大填满屏幕。
- 真实导入→layout→Map021 event-1-1 电车开场→原生地图 PNG（1344×672）通过。Chrome 实际显示电车、人物 cs001aaa，并播放 ren0280；预载前五句资源也已采齐，无资源/音频错误。37 张合成审计见缓存 `unite-map-render-audit.json`，实际截图 `browser-verified/unite-map.png`。
- 导出协议版本升为 UNITY_NATIVE_VERSION=5，已有导出自动归档到 arc/cache/script-backups 后重建，无需删除游戏文件。导入配置不变；旧 RPG Maker 的地图路径不变。本项只覆盖静态地图背景，Unite UUID 角色小人/行走素材和完整交互游戏不因此算已支持。
- Naninovel sharedassets0 的22个 AudioClip 名称已全部核对，均为 BGM/SE/UI，并非漏掉的语音库。其余 sharedassets1..3 无 AudioClip；原始开场第7、8句存在真实 Voice ID 且浏览器播放通过。不能据此把所有无声场景判为错误或正常，需对照用户最近阅读位置。
- 采集脚本2.16增加每个已匹配游戏的阅读进度 JSON（只读，单文件2MiB/总24MiB限制，沿用敏感键脱敏），并同时采集六作实际元数据，后续可精确定位用户打开的节点。默认请求改为各作的小型标记文件，避免无关大媒体采集。


## 用户实际阅读位置复核（采集2.16）

- RJ01610188 实际阅读的是 `0117_Mob_SaintTarina1`（59条 PrintText，0条可匹配 Voice）和 `0211_Mob_Rabbipyon2`（56条 PrintText，0条可匹配 Voice）。原始目录、Addressables、Resources 和共享资源的 AudioClip 已交叉核对；这两段不是解析器漏播了已有的逐句配音。
- RJ01687472 实际阅读的是 `オーク凌辱` 和 `ミラ輪姦`；实际资源根是合法的空字符串根，decoder=celltalk，排除了导入根配错。
- `オーク凌辱` 第一帧应有 CG。此前 CG pose 根（path=''、part=当前pose）也被套上衣服/defaultparts过滤；该根 Sprite 是必须保留的底层整图。修复保留根图，只对其余服装/差分执行可选部件过滤，增加独立回归测试和真实 API 断言。
- `ミラ輪姦` 普通立绘与原生世界演出出现在前45个阅读步骤，原始 CGLoad 到第46步才执行；用户停留在约第28步，正好属于未还原的导入演出。该范围仍未支持，不能拿后面 CG 能显示当成前45句已修复。已有「画面切换」中途开始按钮可以定位真实 CG 起点；不删改前面的原始台词，不自动跳过。
- Unity导出缓存协议跟进到6，强制重建旧脚本并更新缩略图mtime，旧导出归档到游戏arc/cache/script-backups。


## Naninovel 人声循环通道修正（用户实际无声场景）

前面的 Voice ID 数量只表示逐句配音，不能推导为没有任何人声。进一步核对两段完整原始命令：SaintTarina1 使用 Bgv_20501/20502/20503，Rabbipyon2 使用 Bgv_20404，并与 Bgs 环境声同时循环。旧解析把所有 Loop PlaySfx 放入同一个 bgse 槽，后播放的循环覆盖前者；且 StopSfx 忽略具体 SfxPath，总是清空该槽。这是实际漏人声的原因。

现按原始资源路径分配 `nani-sfx:<path>` 独立槽；BGV 使用背景人声音量，其他循环使用背景音效音量；保留 Loop/Volume 与每次播放token。指定路径的 StopSfx 只停止该槽，无路径才停止该脚本的全部SFX循环，BGM与逐句Voice不受影响。增加真实两段API状态断言和独立音轨/指定停止的回归，继续采集原始人声/环境音资源验证真正的浏览器并行播放。


最终回归：`オーク凌辱` 全部当前/预载CG部件在真实Chrome中加载，原生CG底图＋其余部件共7层、音乐和语音播放，无资源错误；旧 `ゴブリン凌辱` 增加必须底图后共8层，同样通过。`ミラ輪姦` 第46步支持的CG在Chrome缩略图组件实际绘制，前45步仍明确未覆盖。

Naninovel 对用户两段原始剧情提取当时的真实音频状态做专门浏览器音频检查（不把该音频检查冒充两段全部CG也已验证）：两段均有原始BGM、Bgv、Bgs三路实际播放。SaintTarina的无路径StopSfx同时停止人声和环境音；Rabbipyon的指定Bgs停止后环境音暂停、人声继续播放。均无资源/音频错误。测试产物保存在 `browser-verified/nani-*-audio-verification.json`。


## 回想背景与 RJ01664771 层级复核

- RJ01474142：原生回想地图事件先转移地图，再调用场景公共事件；直接打开原公共事件丢失前置地图。现在只对特殊场景恢复同分支最近的固定转移，保持原有场景 ID，不执行图库确认/重置助手或无关地图自动事件。77/77 个特殊场景均有唯一原生目标。HS1 对应地图20，HS2 对应地图13；回归逐项检查地图命令。真实浏览器显示公共事件25背景以及原生电车地图，图音无错误。
- RJ01664771：原始 TRP_SkitMZ_Config 的 zOrder=2，原插件把 bustContainer 放到 pictureContainer 前（底层）。旧实现固定 z10/z11，反而覆盖了图片1。现身体与表情均沿用原始图片前后关系，不删原始 show/hide。用户指定的「発情カメラで生ストリップ」是回想公共事件216 → Map494 event87；明确先显示 b9_1，再 show エドワード，自动立绘关闭。因此人物存在是原指令，覆盖 CG 是我们的层级错误。
- 每个游戏可设置 config.adapterOptions['rpgmaker-json'].effects.shake=false。默认 true；关闭保留等待时间，无全局禁用其他游戏演出的副作用。
- RJ01687472：仍未修复原生世界背景。已静态定位「オーク凌辱」原生 level30（342个MeshRenderer），「ミラ輪姦」level78（353个MeshRenderer）；原环境是3D场景，不是一个漏掉的背景PNG。CGBG 的四个 RectTransform 是画框区域，不能当作原环境。现有 CG 底图修复不代表世界/相机/普通Stand已支持；后续需要恢复Camera、Mesh、Material及脚本摄像机状态，不使用猜测的其他CG替代。


追加验证：RJ01664771「発情カメラで生ストリップ」的原图合成在真实 Chrome 通过：人物本体与表情在 under 层（z2），b9_1 在图片层（z4），截图确认人物未盖在CG上；原始BGM与该句语音均实际播放。本项只验证CG/立绘合成，未把未采集的地图/SE或后续预载加入这项回归，不宣称整段演出逐句验证。旧RPG回归29项、默认参数漂移守卫8项及刷新JSON下拉检查通过。

G列表和剧情工具栏新增「详情」，复用图集的标题/单元/章节/可点击标签面板；补当前位置层级和游戏ID。原生全屏中把面板放进全屏根，关闭时移回body；点击标签退出全屏并沿用现有标签搜索。完整app浏览器验证列表、剧情、标签HTML转义、Esc、不推进台词、原生全屏及点击标签后的搜索，无页面错误。顺手修正旧自测在图片回调已立即显示终句后仍点击不可用「下一句」的过时假设；生产图片回调逻辑未修改。
