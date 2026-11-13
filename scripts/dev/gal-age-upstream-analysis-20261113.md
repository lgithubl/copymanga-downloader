# 天結い：Eushully-Decompiler 实际解析验证

日期：2026-11-13

## 结论

已在 macOS 编译并实际运行上游工具，处理当前采集的全部 30 个 SYS4 脚本 BIN。无需 Windows，也无需先解开 AGE.EXE 才能进行这一步。此前将 EXE 解包视为继续分析的前置条件过于绝对。

- 上游：https://github.com/Kelebek1/Eushully-Decompiler
- 本机源码：`/tmp/Eushully-Decompiler`（按用户要求复用；原 `.cache/eushully-decompiler-src` 为兼容既有构建的软链接）。
- 固定版本：`21da1e80b992241027737b67310fa999690f02c1`
- 30 个文件全部反编译成功。
- 上游 `-x` 反编译后重编译：30/30 与原始 BIN 逐字节一致。
- 185,890 条指令逐条与现有 Node 解析器比较，指令地址、操作码、参数数量、参数类型、参数值和已解码字符串均无差异。
- 包含 2,122 条 show-text 指令；不是 2,122 个独立场景或实际播放顺序的完整台词数。
- 所有原始输入文件 SHA256 保持不变。

## 发现的具体缺口

上游读取了 146 条 `copy-local-array`（0x64）指令引用的 697 个数组元素。现有 Node 解析器校验了数组地址和长度，却没有将数组内容保留到解析结果里。这是可确认的数据读取缺口，后续需要补上解析结果及执行语义。

例：SYSTEM4.BIN，字偏移 462，目标 global-int 970720（十六进制见原工具输出），数组为 `[0,4,5,7]`；CGMODE.BIN 存在 `[0,160,0,90]` 等数组。不能仅凭这些数值就断言所有数组都是图片坐标；应结合调用点确认用途。

上游在本批样本中还有 176 种操作码使用地址名或数字名，而没有说明功能。例如：

- `0x1f4` → `u004160D0`，出现在 SN0000 开头及各段之间。
- `0x242` → `u00422D60`，出现在图层相关调用之后，但上游没有提供它的执行语义。

这表示参数边界可被完整读回，不表示已知如何执行这些操作。不能将未知指令全部跳过后宣称画面正确，也不能仅凭反编译成功宣称完整播放器已完成。

## 本轮变更边界

只进行本地工具编译、解析、对比和记录；没有修改生产适配器、镜像依赖或 NAS 数据，没有执行游戏 EXE，没有运行时下载。

Mac 兼容处理：3 处 seekg 参数改用标准枚举；补标准头文件；Windows 字符转换接口用系统 iconv 实现 CP932/UTF8 转换。未修改上游操作码表或解析算法。仅验证了本批 SYS4 数据，不声称 SYS5 已兼容。

## 结果位置

仓库下 `.cache/age-upstream-20261113/`：

- `decompiled/`：30 个可读指令文本。
- `audit/`：上游原解析逻辑输出的结构化指令及数组数据。
- `manifest.json`：输入来源、SHA256 和逐文件统计。
- `comparison.json`：与 Node 解析器逐条对照的结果。
- `roundtrip.json`：逐文件二进制回编译验证。
- `run_analysis.py`、`compare.mjs`：本次批量运行与对比入口。

编译工具位于 `.cache/eushully-decompiler-build/age-asm`。

## 逐文件结果

| 文件（带采集批次前缀） | 指令数 | show-text 数 | 数组指令数 | 二进制回编译 |
| --- | ---: | ---: | ---: | --- |
| base-$1$SC6870.BIN | 2686 | 16 | 0 | 通过 |
| base-$1$SCINIT.BIN | 50 | 0 | 0 | 通过 |
| base-$1$SCJUMP.BIN | 350 | 0 | 0 | 通过 |
| base-EVINIT.BIN | 9320 | 0 | 0 | 通过 |
| base-SC0000.BIN | 33296 | 553 | 0 | 通过 |
| base-SC0010.BIN | 49716 | 667 | 0 | 通过 |
| base-SC1000.BIN | 57717 | 777 | 0 | 通过 |
| base-SC6690.BIN | 5616 | 51 | 0 | 通过 |
| base-VIINIT.BIN | 1999 | 0 | 0 | 通过 |
| verify-CVINIT.BIN | 333 | 0 | 0 | 通过 |
| verify-SCINIT.BIN | 733 | 0 | 0 | 通过 |
| verify-SCJUMP.BIN | 5339 | 0 | 0 | 通过 |
| verify-SYSTEM4.BIN | 706 | 0 | 1 | 通过 |
| link-CCINIT.BIN | 2363 | 0 | 0 | 通过 |
| link-CGINIT.BIN | 716 | 0 | 0 | 通过 |
| link-CGMODE.BIN | 922 | 0 | 60 | 通过 |
| link-CSINIT.BIN | 5149 | 0 | 0 | 通过 |
| link-FAINIT.BIN | 404 | 0 | 0 | 通过 |
| link-GAMESTART.BIN | 1086 | 0 | 32 | 通过 |
| link-GSINIT.BIN | 41 | 0 | 0 | 通过 |
| link-HMODE.BIN | 1429 | 0 | 37 | 通过 |
| link-INIT.BIN | 18 | 0 | 0 | 通过 |
| link-INIT2.BIN | 459 | 0 | 16 | 通过 |
| link-INITGAME.BIN | 22 | 0 | 0 | 通过 |
| link-MUINIT.BIN | 191 | 0 | 0 | 通过 |
| link-NOVEL.BIN | 518 | 0 | 0 | 通过 |
| link-SETMEMOIR.BIN | 173 | 0 | 0 | 通过 |
| link-SN0000.BIN | 4335 | 58 | 0 | 通过 |
| link-SNINIT.BIN | 70 | 0 | 0 | 通过 |
| link-SPINIT.BIN | 133 | 0 | 0 | 通过 |


### 2026-11-14 更新

Mac 可独立实现的初始化串联、单精度赋值、回调生命周期/显式事件恢复、原生语音停止与居中声像已接入，验证及边界见 [进度记录](gal-age-adapter-progress-20261113.md#mac-可独立完成部分的收尾2026-11-14)。完整 SYSTEM4 默认入口调用的是 2023（语音声像居中），随后 @16 停于 0x35b；组件测试单独使用的 2040 不能代表完整启动。源码继续复用 `/tmp/Eushully-Decompiler`，没有运行 Windows 代码。


### 社区来源复核（2026-11-14，用户补充链接）

结论限定于本次实际读取的文件，不以单个工具缺失推断整个 GitHub 没有实现。资料只下载为静态源码/文档，没有执行 Windows 程序、CE/CT、DLL 或脱壳脚本，没有修改生产适配器。

| 来源 | 实际核对内容 | 对当前三个指令的结果 |
| --- | --- | --- |
| [Kelebek1/Eushully-Decompiler](https://github.com/Kelebek1/Eushully-Decompiler/blob/21da1e80b992241027737b67310fa999690f02c1/Decompiler/age-shared.cpp) | master 仍为 21da1e8；本地与远端 HEAD 一致；最新提交为 2024-08-30 的 v5 压缩归档解包更新 | 305=0 参数、35B/35C=2 参数，均为数值标签，无执行语义。不能将 SYS5 归档支持等同新版指令执行支持，也不能称此提交是最近更新 |
| 6 个 fork | neko-para、Cercospora、Zoltanar、natsumerinchan、UESTC-LXY、ichisadashioko 的指令表及现有 C++/头文件 | 三个数值标签和参数数量仍保留；本次未发现额外执行处理。fork 新的 push 时间本身不代表已实现它们 |
| [VNTextPatch AgeDisassembler](https://github.com/arcusmaximus/VNTranslationTools/blob/36fbe909d02f2e9bb187443e03e2df595f56bfec/VNTextPatch.Shared/Scripts/ArcGameEngine/AgeDisassembler.cs) / [AgeScript](https://github.com/arcusmaximus/VNTranslationTools/blob/36fbe909d02f2e9bb187443e03e2df595f56bfec/VNTextPatch.Shared/Scripts/ArcGameEngine/AgeScript.cs) | ArcGameEngine 目录全部 7 个 C# 文件；AgeDisassembler:493 的 OperandCounts；AgeScript:118 起的文本分组及枚举 | 0305 只有零参数登记，35B/35C 不在该版本参数表。文本分组遇非文本指令会结束当前组，这是提取算法，不是 305 原生处理实现 |
| [foxofice/alf](https://github.com/foxofice/alf/blob/8a70066bcd4b8c4b92253ca01f7852f52d4d1d2c/unpack_alf/unpack_alf.cpp) | 归档/文本提取/打包/LZSS 源码；unpack_alf:152 的 SYS3/4/5 索引名称 | 可以参考索引、解包和编码，不提供这三个操作码的执行处理 |
| [GARbro Eushully](https://github.com/morkt/GARbro/tree/b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0/ArcFormats/Eushully) | 目录中 5 个 C# 文件，包括 ArcALF/ImageAGF/AudioAOG | 是归档、图像和音频读取依据，未发现目标 VM 操作码实现 |
| [Dir-A ASProtect 文章](https://www.cnblogs.com/Dir-A/p/18097019)及 GitHub Markdown | 明确目标为《魔導巧殻》、2013 年代 ASProtect 2.xx、Windows XP/Ollydbg；另核对 Enigma 线索和注册检查两篇 Markdown | 可借鉴处理函数定位和保护器分析，不能把旧 ASProtect 教程直接套到当前受保护 EXE。未得到新三个处理函数 |
| [necocan 讨论](https://necocan-index.rick-addison.com/bbs/patio.cgi?read=64&ukey=1) | 浏览工具不可读，但本机 HTTP 成功，UTF-8 正文已读；首帖有 AGE 掩码/范围自动定位 CT 说明 | 变量存储定位线索，并非三个操作码说明；对应首个 ZIP 附件 HTTP 403，未声称已审阅 CT |
| [贴吧](https://tieba.baidu.com/p/5146684434) | 浏览工具与本机请求均 HTTP 403 | 未核实正文；用户摘述的移位/常数不能不经版本核对直接用于当前引擎 |
| [PyVNTrans 格式页](https://pyvntrans.blogspot.com/2013/04/format-specs-arcgameengine-eushully.html) | HTTP 200 取得 HTML，但本次可提取内容未获得正文 | 不把用户转述的版本/结构说明计为本轮独立验证结果 |

静态源码保留在 `/tmp/age-community-references/`，其中 `manifest.json` 记录来源 commit、路径与 SHA256；`forks.json` 和 `fork-code-search.json` 保存 fork 检索结果；`pages/fetch.json` 记录访问成功/失败。原 Kelebek1 工作副本继续复用 `/tmp/Eushully-Decompiler`。

后续可继续走 Mac 静态路径：利用可取得的新版本处理器/符号/调试资料，与当前 BIN 的所有使用点、初始化数据和调用顺序交叉验证。仅按调用位置推测 35C 是音频范围、305 是文本结束，尚不足以合入执行逻辑。CE 动态观察属于另一路方案，本轮没有启动，也不把 Windows 说成唯一可能的途径。
