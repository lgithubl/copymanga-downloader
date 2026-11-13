# AGE adapter：第一阶段实现与实际显示验证

日期：2026-11-13。状态：**适配器基础已实现；天結い尚未达到可导入、完整播放的状态。** 本轮没有发布镜像、触发 Action 或提供会误报可用的导入预设。

## 已实现

- 独立 `age::sys4` 适配器及 `age-sys4` 脚本解码入口；输入是 `age-sys4/1` 包，携带完整 BIN 的 base64。执行时再校验字节码，不信任调用方提供的指令列表。只匹配自己的格式，旧 krkr/kk/BGI 的识别条件未改。
- 补齐 0x64 数组读取和整数数组复制。数组参数、长度、目标地址、总解析量和 VM 内存受限；146 处、697 个元素与上游逐项一致。30 个 BIN 的 185,890 条指令重新对比，参数/文本/数组均无差异。
- 使用已有的分支、函数调用、跨 BIN 调用、局部变量恢复和全局状态追踪；不将整个文件按物理顺序拼成台词。
- 主文本窗口的文本片段、注音、换行和等待输入；按等待点形成播放器步。尚不猜测说话人或其他文本窗口的用途。
- 已确认绘图原语转成现有 `overlay`：保持来源裁剪矩形、原始尺寸和舞台坐标。新增只保留纹理元数据的路径，场景转换无需复制 RGBA 像素；原像素模式保持。
- voice/BGM 指令接口分开使用显式映射表。**未完成原生音频映射表的自动生成，也未声称已经实际验证原生语音播放。** BGM 号不能直接拿来当 ALF 资源 ordinal。
- 未实现操作码静态清单记录数量及来源偏移（包含不可达代码）；执行遇到未知指令、缺映射/脚本、越界或超预算立即终止正常解析。诊断 API 可保留部分结果，正常 `parse()` 会抛错，不能将残缺场景交给播放器当作成功。

## 已实际验证

1. `node scripts/dev/gal-age-adapter-selftest.mjs`：7 项通过，包含全部已采原生数组、原生 SN0000 的显式失败诊断、原生绘图辅助函数转换、分支跳过、跨 BIN 返回、注音、裁剪及错误路径。
2. `node scripts/dev/gal-age-selftest.mjs`：原有 10 项通过。
3. `node scripts/dev/gal-next-five-selftest.mjs`：5 项通过；旧 krkr 布局回归 1 项、BGI 58 项、adapter options 87 项通过。
4. `scripts/dev/fe-gal-age-selftest.mjs` 在本机已有 Chrome/Playwright 中运行通过：解码真实 BG054AA / CS001AAA 的 AGF，执行原生 SC0000 图片摆放辅助函数，转成通用场景再交给实际播放器。66,891 个采样像素与独立按原始坐标合成的参考画布一致；日文注音实际显示；无浏览器 JS 异常。没有下载浏览器或运行时。

浏览器验证产物在仓库 `.cache/age-adapter-display/`：

- `native-components.png`：实际播放器截图。
- `verification.json`：像素对比与尚未支持的停止点。
- `diagnostic-scene.json`：组件验证输入。

**截图是组件组合验证，不是原版该句对应画面的对照。** 背景/立绘来自已验证的原生摆放函数，文本来自 SN0000 第一段旁白；不能据此宣称已还原整段剧情。标准播放入口仍拒绝残缺结果。

本机验证命令（路径可按已有安装调整）：

```sh
PLAYWRIGHT_PATH=/Users/xiangli/.npm/_npx/e41f203b7505f1fb/node_modules/playwright \
CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
node scripts/dev/fe-gal-age-selftest.mjs
```

## 剩余接入项

- 天結い的显示事务、更新/调度、文本框开关及对象属性语义。原生 SN0000 从入口仍停止在 `0x1f4`；绘图辅助函数在 `0x242`；第一段文本后的 `0x305` 也不能静默略过。
- ALF/追加包到虚拟资源的完整接入、初始化脚本依赖组装、音频映射/格式处理、章节入口与分支/回想的可浏览目录。
- 入口可完整执行且图/语音顺序验证之后，再增加 gal-layout、导入下拉预设、缩略图和中途开始标记，并走标准 Action/Release 流程。当前没有改旧家族规则来强行识别 AGE。

## 不依赖 Windows 的后续静态分析线索

本轮另外检查 [andreili/Eushully-Editor](https://github.com/andreili/Eushully-Editor)，固定提交 `92d08433ee56fe4855daab14850e3b3c0bf46091`。其中附有旧版未加壳 AGE.EXE。它不是用户当前版本，**不能沿用函数地址或无条件认定语义相同**；仅作为静态交叉验证材料，从未执行其中的 EXE/DLL。

已从该旧版初始化与分派代码交叉定位处理表：对象偏移 `0xa4f1c`（分派处 `0x411b8e`、`0x41320d`）。旧版 `0x1f4` 对应 `0x419a60`、`0x242` 对应 `0x4247c0`，与 Kelebek1 工具中函数名地址不同。前者操作嵌套计数/计时状态，后者把第二参数写入图形对象字段并同步对象列表；尚须追踪这些字段的消费者，不能直接把它们定为无操作或简单的显示/隐藏。

原始反汇编和映射留在 `.cache/age-upstream-20261113/editor-age-disassembly.txt`、`editor-handlers.json`。格式解析原始验证见 [gal-age-upstream-analysis-20261113.md](gal-age-upstream-analysis-20261113.md)。
