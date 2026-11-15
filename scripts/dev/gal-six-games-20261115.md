# 六作目录、引擎与适配器复用分析（2026-11-15）

范围：RJ01687472、RJ01610188、RJ01660877、RJ01474142、Night Stroll、RJ01664771。本轮只采集与分析，没有给旧游戏变更适配器或布局规则，也没有发布镜像。

采集脚本为 `scripts/dev/gal-collect-run.sh`，开发分支 `feat/gal-download`；自动执行分支 `vibe-test-20261008`。采集只读源目录，先完整列目录，再采脚本、配置、序列化索引等指定文件；不复制存档，不启动游戏，不批量抓 CG / 语音。

## 数据轮次

- v1.90：`gal-collect-20261114-174248-331ab718-truenas_`。找到五作，RJ01610188 未找到。扫描根为 `/mnt/s1/nas/k8s/manga-image-translator/copymanga/data/library/gal/[G]/[]`。原始采集、目录列表及 SHA 清单保存在 `.cache/six-games-20261115/probe/`。
- v1.91：将 RJ 编号识别扩展到名称中间/末尾的独立编号；已知五作按清单补采约 38.9 MiB 剧情与索引，而不是全部素材。报告为 `gal-collect-20261114-175221-550fafa8-truenas_`，本地在 `.cache/six-games-20261115/followup/`。

- v1.92：`gal-collect-20261114-175548-19b64754-truenas_`，补采 Utage sharedassets0、MonoScript 类型索引，以及 MZ 回想表实际指向的 30 张地图和 Tilesets。关键数据保存在 `.cache/six-games-20261115/verify/`。
- v1.93：`gal-collect-20261114-175914-9cc1b97d-truenas_`，从已解析的资源对象目录得到偏移，只读取 RJ01687472 的四个 TextAsset 范围，合计约 165 KiB。保存在 `.cache/six-games-20261115/textassets/`。
- 上述已下载的补采数据共 105 个文件/范围均核对了采集端 SHA-256；目录源文件不做修改。v1.92/v1.93 的其他已知游戏小文件用于保持完整任务清单，分析时没有重复下载其全部报告。

## 结论边界

“能复用引擎逻辑”不等于“原目录现在能完整导入播放”。以下将容器读取、剧情指令、图像/声音绑定分别判断。没有做浏览器真实显示验证的游戏，不标成已经支持。

| 游戏 | 原目录证据 | 现有实现 | 判断 |
| --- | --- | --- | --- |
| RJ01687472 | Dark Elf Descent into Corruption；Unity IL2CPP、Addressables、global-metadata.dat | UnityFS / SerializedFile 底层读取器 | Unity 自定义剧情，需新格式接入；现有 `unity::dsm` 是另一种 GameMaterial 格式，不能套用 |
| RJ01610188 | 多轮目录未命中，包括名称中间/末尾编号匹配 | 未知 | 没有实物目录不能判断 |
| RJ01660877 | GirlsClub；Unity Mono，含 Utage.dll，剧情资源封装在 assets | `utage-book`，TSK 的 Unity 导出基础 | 已找到原生 AdvImportBook / AdvChapterData，可复用书表；需补原始 assets 导出和 Live2D 资源/指令绑定 |
| RJ01474142 | GirlReno；RPG Maker Unite，含 RPGMaker.CodeBase.CoreSystem.dll 及 Addressable event bundles | MV/MZ 事件解释器与 UnityFS 读取器 | Unite 不是 MV/MZ JSON；需要 Unite 数据转换层，不能只增加游戏 ID |
| Night Stroll | RPG Maker MZ；System 标题为“夜行 Live2D”；有 model3 / motion3 | `rpgmaker-json` + 已有 Cubism 播放器 | 可以扩展现有 RPG 适配器，但必须接 Live2DInterfaceMZ 指令，不能只显示普通图片 |
| RJ01664771 | RPG Maker MZ；百合姫学園のヘテロセクシャル Ver_1.03 | `rpgmaker-json`、TRP Skit、SimpleVoice | 适合扩展现有 RPG；需补回想地图入口跟踪、独立表情图片及部分 Skit 指令 |

## 第一轮具体发现

### Night Stroll

3,915 个文件，22 个 data JSON，8 张地图。全部 data JSON 约 4.6 MiB；CommonEvents.json 约 3.85 MiB。图片和声音均使用 MZ 加密封装，现有 RPG 解密路径可复用。

启用 RecollectionModeMZ、SimpleVoice、Live2DInterfaceMZ、cubism4ForMZ。回想列表是 `img/system/RecollectionModeMZData.json`，沙盒地图 ID 为 2。模型位于 `Assets/<模型>/`，含 model3、moc3 和 motion3。不能因为普通地图和台词可读，就漏掉动态画面。

### RJ01664771

8,778 个文件，561 个 data JSON，547 张 Map*.json 地图；全量 data JSON 约 77.8 MiB，因此没有全量采集。回想列表也是 RecollectionModeMZData.json，沙盒地图 ID 为 513。

启用 TRP_SkitMZ、SimpleVoice、ApngPicture 等；Skit 配置明确 `useMultiLayer=false`、`useSpritesheets=false`，实际目录是 `img/pictures/busts/<角色>/normal.png_`、`normal_1.png_` 等，没有 texture.json。现有 `rpgmaker-skit.mjs` 依赖 atlas 元数据恢复表情，不应将“认识插件名”当成已完整支持本作。需要复用同一适配器并补分离图片表情分支。

### RJ01660877

184 个文件，Unity Mono，包含 Utage.dll。resources.assets 约 13.2 MB，level0 约 5.6 MB；没有 TSK 那种已经导出的 Adventure/*.book.json 目录。应优先尝试原生 Utage 书表提取，再复用 `utage-book`；不要为了原封装新写一套完全独立的文本播放器。

### RJ01474142

6,247 个文件，其中 6,041 个 .bundle。主程序 GirlReno.exe；存在 RPGMaker.CodeBase.CoreSystem.dll。大量 `others_assets_event_<UUID>...bundle`、`so_eventcommon`、`so_eventmap` 是 Unite 事件资源。现有 MV/MZ JSON 适配器不能直接读取这一格式。

### RJ01687472

438 个文件，Unity IL2CPP，主程序 Dark Elf Descent into Corruption.exe。global-metadata.dat 约 6.8 MB；resources.assets 约 43 MB；Addressables 的 CG、立绘和声音分包。补采 metadata、catalog 和 resources 索引片段以识别剧情类型，没有采 21 MB GameAssembly 或整批 CG 包。


## 实物验证结果与接入边界

### 现有 RPG 适配器的实际输出

直接用现有 `rpgmaker-json.prepare/parse` 读取采集的完整 JSON，没有执行插件 JS。输入文件名索引仍采用原始全目录列表；只有实际采集的地图加入事件上下文，不把未采集地图假装成已验证。

- **Night Stroll**：全部 8 张地图、500 个公共事件已读。181 个直接含文本的公共事件解析不抛错，但这只证明事件可解析。公共事件里原生有 2,061 条 `Live2DInterfaceMZ` 指令：show 181、scale 181、pos 181、motion 1,341、hide 177。现有适配器将其记为 raw，故动态画面未支持。目录中实际有 42 个 model3、781 个 motion3，原生回想表有 42 项。现有自动目录生成的“特殊场景”数量是另一套启发式结果，不能当作 42 项原生回想已经正确接通的证明。后续应按原生回想表挂标题、缩略图、公共事件，并接入 Live2D 命令。
- **RJ01664771**：已合并读取 33 张地图（此前 3 张和回想目标 30 张）、完整 CommonEvents / Tilesets。原生回想表有 30 项，公共事件 205–234 只负责传送到 Map483–512，正文、语音、CG 在目标地图。现有解释器从这些公共事件入口进入时，会生成 `map-autorun-ambiguous`，没有接着播放正文；原因是地图有许多普通事件，当前安全判定要求过严。实际 Map483 的事件 136 第 1 页是唯一自动剧情，含 149 条原生文本；Map484 的事件 70 第 1 页含 167 条。应识别唯一满足条件的自动事件，而不是直接串联整张地图。已采数据中还有 1,057 条 `SimpleVoice:PLAY_VOICE`，语音并非原作没有。需要补图集外表情读取、Skit auto/动作支持；战斗 HUD、粒子等可单独记录为未支持，不应吞掉台词、立绘和语音。

这两作均不需要另建一套 RPG 播放器。建议在共用适配器中按实际启用的插件/明确配置分支接入，保留旧路径，避免改变其他 RPG 游戏。

### RJ01660877：原生 Utage 书表已找到

剧情实际在 `GirlsClub_Data/sharedassets0.assets`，不是 resources.assets。通过已有 Node SerializedFile 读取器解析对象目录，并与 `globalgamemanagers.assets` 的 MonoScript 类型索引关联，确认：

- `Boot.chapter` 类型是 `AdvChapterData`；167 个 `.book` 类型是 `AdvImportBook`。167 包含设置、参数和调试表，不等于 167 个可播放场景。
- 包括 M1 / M10 等主线书、MH 系列，以及 ClubTalk 等角色对话书。`M1.book` 中可见原生 Command、Arg1–Arg6、Text、PageCtrl、Voice 列。
- resources.assets 中 A/B/C 的类型是 `CubismMoc`，配套 `.fade` 类型是 `CubismFadeMotionData`，不是 TSK 的 Spine。现有 `utage-book` 没有本作所需的 Live2D 翻译分支。
- 三个 Unity assets 文件均未携带 TypeTree。当前只完成对象/原生类型/书表证据识别，没有把其二进制字段未经校验地伪造为 `.book.json`。后续需要按照本地 Utage.dll 定义建立静态序列化结构，或者构建期导出书表；不需要生产镜像运行时下载类型数据库。

因此可复用 `utage-book` 的场景协议和普通指令，并扩展通用 Unity/Utage 读取层；资源与动态指令需要单独补齐。原始对象、DLL 和索引现已具备，不必再采同一批剧情资源。

### RJ01474142：Unite 事件已经成功解码

现有 `unity.mjs` / `unityfs.mjs` 能直接解出本作事件 bundle，内嵌 TypeTree 可用，没有引入 UnityPy。

- 三个实际剧情事件样本分别包含 206 / 258 / 146 条事件指令，其中 51 / 70 / 50 条文本、17 / 21 / 11 条图片显示，并有公共事件调用。
- 公共事件索引包含 147 项，地图事件索引包含 439 项。
- 指令仍有 code / indent / parameters，但 parameters 是字符串，变量、开关、公共事件采用 UUID；条件、消息框和音频字段的位置也与 MV/MZ 不同。不能只把 parameters 转成数字后直接输入旧解释器。

方案是新增 Unite 容器/数据转换模块，转换到统一事件表达后复用现有 RPG 展示。需建立 UUID 引用、资源地址、语音/角色/回想索引，不需要复制另一套 UI。

### RJ01687472：自定义 Unity，现有适配器无法直接套用

IL2CPP metadata 版本为 31，Assembly-CSharp 中有大量本作 script_*、Talk、场景协程等自定义类；并未发现可直接判定为 Utage / Naninovel 的框架证据。metadata 字符串只用于识别类型，不能据此还原场景执行顺序。

已从 resources.assets 头部完整读出对象目录，定位 4 个 TextAsset 后精确补采。其中包括 `00UIテキスト_汎用`：使用 `|セル|` 等分隔符的多语言表；另外三个是 image HTML 索引和换行字符表。**这张 UI 表不是完整剧情表**，本轮没有将它当作可播放场景。

已有 UnityFS、SerializedFile、Cubism 等底层能力能减少重复工作，但还需定位各 sharedassets 中的剧情表、对象引用和自定义调用关系，再确定新适配器的输入。当前不能声称这个原目录能导入播放。若下一步开始实现，优先只采几份 sharedassets 的目录和 TextAsset，不采整包 CG / 声音，也不必先拿完整 GameAssembly。

### RJ01610188：明确未找到

多轮均在本次扫描根下未找到，已检查前缀、方括号、全角归一化以及名称中间/末尾的独立 RJ 编号。结论仅限此次配置的扫描范围，不能据此说 NAS 上一定不存在，也不能猜引擎或套用配置。

## 建议顺序

1. RJ01664771：复用 RPG Maker MZ，先修通回想正文、语音与独立表情图。
2. Night Stroll：复用 RPG Maker MZ，增加通用 Live2DInterfaceMZ / Cubism 插件翻译和原生回想目录。
3. RJ01660877：复用 Utage，做原始书表导出与 Unity Cubism 绑定。
4. RJ01474142：新增 Unite 转换层，再复用 RPG 展示逻辑。
5. RJ01687472：独立分析自定义 Unity 剧情数据，需要新格式适配。
6. RJ01610188：本轮没有采集到目录，暂不确定。

本轮没有修改 adapter、gal-layout、导入下拉选项或镜像依赖；因此也没有触发镜像构建 Action。采集脚本语法检查、六作匹配/只读/大小边界测试，以及旧 fuyukuru/えどわ～る、meshiagirl 的采集回归均通过。
