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
