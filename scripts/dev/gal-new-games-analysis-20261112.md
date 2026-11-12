# 五作接入：补采后的格式验证结果

2026-11-12；分支 `feat/gal-download`。最新样本为 `gal-collect-20261111-162126`。本次已完成シロクロ的 Edoire 档案与静态剧情适配器（gal-layout 2.55.0），通过真实采集数据导入、资源读取和浏览器验证。另两作仍待 1.53 小配置补采。

## 当前结论

| 游戏 | 实际验证结果 | 接入方案 |
| --- | --- | --- |
| ツヴァイトリガー | 5 份完整剧情可由现有 PSB 解码器和 `krkr::scn` 解析；共 69 个内部场景、1,324 步、468 次普通语音引用 | 复用剧情适配器；扩展 MDF 外壳、普通 patch.xp3、补丁优先、PBD 分层立绘及内部跳转处理 |
| シロクロv1.1 | 141 份 Unity bundle 均取出 1 份 Lua 文本；25,162 次字面 text 调用。两个图片样本解出 PNG；语音样本用已有 FSB5 模块成功恢复 Vorbis | 新增 Edoire 容器与 Lua 风格文本适配器，复用 Unity/FSB5/播放器；不引入或执行 Lua 运行时 |
| AI | 5 个剧情 .ks 已解开；主剧情有 3,839 个 cpg 分页、1,103 次 VOICE、213 次 CG；自定义宏定义也已取得 | 新增 SakanaGL 容器与专用 KAG 方言适配器，复用通用场景/图层/音频；不能直接指定 Tyrano 适配器 |

シロクロ已接入；ツヴァイ与 AI 的后续实现仍需约245KiB配置补采。不能将五份场景解析成功当作ツヴァイ的整作导入验收。

## ツヴァイトリガー：剧情可复用，立绘仍有差异

上一轮已从原始 EXE 静态恢复本作 HXV4 参数：STARTUP.TJS 结构、BOOTSTRAP 的 PE/解压长度、PARAMS 排列及五包特殊索引认证均通过。现有 HXV4 模块已经验证过 41 个完整文本/图片/音频条目。没有运行游戏 EXE/DLL。

本轮按每条数据的 partial 标志区分完整与截断样本：302 个完整条目完成读取/校验；文件头样本只用于识别类型，没有冒充完整导入测试。两类包的情况不同：

- `data.xp3` 是 HXV4，按已恢复参数解密。
- `patch.xp3` 的条目名清晰，所采内容已是可解读的普通资源；不能直接交给仅支持 HXV4 描述符的打开函数。
- 部分剧情是 `mdf\0 + 预期长度 + zlib(PSB)`，现有 SCN 解码器要求输入已经是 PSB。需要有界解压这层外壳。

实际用现有解码器解析成功的完整剧情：

| 来源 | 正文名 | 内部场景 | 步数 | 语音引用 |
| --- | --- | ---: | ---: | ---: |
| data | l02_3 | 8 | 123 | 53 |
| data | s14 | 19 | 445 | 168 |
| data | y15_5_3 | 19 | 340 | 93 |
| patch | s17_1_2 | 2 | 148 | 65 |
| patch | y14 | 21 | 268 | 89 |

这些数据经过 `decodeKrkrScnBuffer`，再交给现有 `krkr::scn.parse`。其中 6 步是没有普通台词的演出步。样本内有 19 个内部场景的 nexts 超过一个，实际接入要核对内部跳转，不能只把所有分支顺序拼起来。

**立绘不能仅凭“PSB 剧情匹配”就算完成。** 剧情引用如 `浩一郎.stand`，包里找得到此定义，却不存在同名 `浩一郎.pimg`。现有适配器主要走同名 PIMG 层表；本作使用 `.stand` / `.sinfo` / `TJS/4s0` 包装的 `.pbd` 与单独 TLG 差分，需要补定义解析并转换成通用 stand 部件。现有部分 PBD 被截到 2 KB，无法用于完整定义验证。

特殊场景、缩略图和中途开始可继续复用现有机制；需要先保留真实的剧情标记、分支及补丁覆盖关系。

密钥恢复算法参考 [xp3-brute 的静态分析源码与合成向量](https://github.com/xmoezzz/xp3-brute/blob/master/src/krkr_exe.rs)。本地实现与公开合成向量一致，且通过本作索引认证；参数保存在本地分析缓存，没有提交到仓库。

## シロクロ：Lua 文本与普通媒体，读取基础可复用

两个 `@ARCH000` 尾索引分别有 1,513 和 3,780 项，均完整消费，包含真实路径及范围。格式特征也对应 [EdoireTools](https://github.com/crskycode/EdoireTools) 描述的封装。

本轮 141 份脚本实际都是 UnityFS bundle，使用现有 `readTextAssets` 全部成功取出正文：

- `/src/game` 108 份，追加/系统流程 22 份，引擎系统文本 11 份。
- 正文为 `return function()`、`::block_00001::`、`text(...)`、`setname(...)`、`set(...)`、`playVoice(...)` 等 Lua 风格调用。
- 静态计数有 25,162 次 text 调用、9,226 次 playVoice、270 次 sel，以及 if/goto/while。这些是源文件调用计数，**不是某一条游玩路径的去重台词数**。
- `GALLERY_SORT_ORDERS`、`GALLERY_MEMORY_SETTING`、`GALLERY_ENDING_SETTING` 均已取到，特殊场景应优先采用原作的回想配置，不靠文件名猜全部分类。

图片验证：`black.bytes` 和 `sky_001a.bytes` 的 TextAsset 原始字节实际是 PNG；两个 1920×1080 样本均由现有 sharp 完整解码。图片取二进制 payload，不能通过 UTF-8 字符串中转。

音频验证：已有首个语音 bundle 内含 AudioClip 和 FSB5 resource。现有 `gal-download/fsb5.mjs` 恢复出 88,445 字节 Ogg；ffprobe 确认是 48 kHz 单声道 Vorbis，时长约 8.254 秒；ffmpeg 完整解码无错误。因此不需要新增音频运行时，但要将既有 FSB5 模块及静态头部数据正确纳入共享镜像路径。

文本适配器应静态识别允许的字面调用、条件和跳转，不 eval Lua、不加载原作代码；无法求值的动态逻辑要显式记录。图层、选择、快进、回想卡片及缩略图走现有通用播放器。

## AI：自定义 KAG 方言，需要自己的宏映射

SakanaGL 索引已完整解密和 Zstd 解压，76,632 字节的预期长度匹配，目录树完整消费，得到 2,154 个条目。算法参考 [GARbro 的 SakanaGL 源码](https://github.com/kyororay/GARbro/blob/master/ArcFormats/SakanaGL/ArcSX.cs)。现有头尾样本的 549 个完整条目及本轮 49 个项目条目均已按各自标志处理。

这次正文实际读到了：

- `scenario/define.ks`：宏的真实实现。
- `scenario/ep_all.ks`：约 540 KB 的主剧情。
- `scenario/epend.ks`、`main.ks`、`start.ks`：入口及结尾控制。

主剧情有 50 个标签、3,839 次 cpg 分页、20 次 SCENE、1,103 次 VOICE，以及 BG/FG/FACE/CG/BGM 等自定义宏。直接测试现有 Tyrano：sniff 不认；强行解析会把 3,839 个 cpg 记为 raw，整份正文只剩 1 步。因此应新增 Sakana 方言，避免改变已有 Tyrano 游戏的含义。

宏源码说明了资源关系：

- BG/FG 接收 `.ui`。真实 `.ui` 样本的词元字符串表包含 `/img/bg/b_07_1.webp` 等资源路径，不能把 UI 文件本身当图片。
- VOICE/SE 通过音频名及声音配置定位。
- CG 通过 `gamesetting.cg[id].graphics[index]` 映射。
- OnName 使用角色表；SCENE/回想需要章节配置。

目前缺的是 `conf/` 的 11 个小文件，包括 `cg.conf`、`character.conf`、`scene.conf`、`bgm.conf` 等，原始存储总计仅 8,572 字节。它们未在上一轮按目录选择的范围内。不能猜 CG 数字 ID 与图片文件名的对应关系。

## 首批两作的附带核验

美好国度：完整 PAC 索引已确认 CG 文件名模板；20 份文本共解析 801 步，图片路径未出现未匹配项。8 处音频未匹配来自 BGSPLAY 误用 SE 目录，实际应走 BGM 目录。WFSET/WFOUT 头像仍待实现。

夜勤：真实 .CHAR 的 base/sub 模型、1920×1080 底图和 8 帧脸图集已经取得；坐标、槽位与合成仍需核验。此项不能只根据资源存在就宣布画面正确。

## 只补缺失的定义数据

采集脚本 **1.53** 仍用 `bash gal-collect.sh .`，默认只处理 AI 和ツヴァイ：

| 目标 | 条目 | 原始字节 |
| --- | ---: | ---: |
| AI 的 conf | 11 | 8,572 |
| ツヴァイ立绘定义及流程表 | 175 | 241,782 |
| 总计 | 186 | 250,354（约 245 KiB） |

ツヴァイ的逻辑名经过真实 HXV4 哈希表验证才纳入清单，不是按猜测偏移读取。源索引 SHA-256、文件长度、范围边界和每作 8 MB 上限继续生效；所有目标条目均完整读取。源目录只读，不重采剧情、图片、声音或 EXE/DLL，不安装运行时。

采集测试已覆盖目标排除、准确字节范围、版本哈希不匹配拒绝、源目录不被修改。TSK 日志环境变量的优先级保持原状。

本地正文及验证报告位于 `.cache/new-games-162126/analysis/`；原始游戏内容没有提交到仓库。

## 2.55.0 实现与验证

- 新增 `edo::lua`，自动检测 Archives 下的 ARCH000；原档案只读，脚本解包，PNG/Vorbis 按资源请求读取缓存。复用已有 UnityFS、FSB5 代码与静态头表，没有新增依赖或运行时下载。
- 静态识别文字/手机聊天、语音/BGM、背景/CG/立绘分层、缩放位移、选择与 if/goto/while；不执行 Lua。控制图有指令及循环次数上限，动态函数、养成分数计算与未支持演出保留在 stats.raw/externalVariables；不能视作完整游戏模拟。
- 真实141份脚本均解包/编译成功；重建稀疏原档案后，实际 import→layout→剧情/特殊场景列表→正文→PNG/Ogg资源接口通过。没有改动NAS数据。
- 浏览器以合成分支脚本配真实采集PNG/Vorbis验证：选择B跳过A，后退恢复B，中途开始携带选择历史进入B，Canvas实际有像素，音频实际播放。此项不代表对原游戏所有CG、立绘定位作了截图比对。
- 原作 gallery_setting 的回想条目包含99_TEST占位，不能匹配真实脚本；特殊场景暂按实际CG调用及剧情文件名分类，不生成虚假回想入口。
- Kingdom 的 BGSPLAY 改为原表的 Sound/BGM 路径，与普通SE分开。
- 专项后端/浏览器、规则表漂移、生产目录依赖检查通过。旧 gal-selftest / gal-layout-selftest 因本机没有 ImageMagick convert，停在既有fixture生成阶段；未把它们计作通过。

待补采的命令与范围仍为下节1.53方案；Release31目前最新数据仍是162126，未收到该补采。
