# 天結正式导入修复与验证

旧 HTTP 演示手动提供了初始化状态，普通导入没有；目录又暴露了 RTN 内部例程。因此不能用演示可显示来证明正式列表可播放。

这次改为从匹配 SHA-256 的 SYSTEM4/INIT2 原始脚本读取数据初始化，并沿已实现的数据指令读取后续表。缺失数据、未实现指令或读取上限都会停止初始化并保留诊断，不执行 AGE.EXE、DLL 或 Windows 环境。

列表只展示 SN/SC/SG/SP 剧情脚本。SC 原生章节标签必须匹配其比较/跳转分派器，通过原生选择变量进入，保留脚本开头的公共设置；没有正文的保留分支不做章节卡片。RTN 仍可被剧情调用，但不再作为独立场景入口。

普通导入 → gal-layout 2.64.5 → 保存配置 → 真实媒体页面，已验证：

- 首页「开场 SN0000」连续 25 段原始台词，两张原生 CG；第二张画面像素匹配、上一句恢复、右下未知指令位置诊断均通过。
- 「剧情脚本（sys4ini，未逐场验证）」→ SC0000 → G0001：原生分派得到 252 段正文。真实页面首句「新婚旅行」显示 BG054AA 和 CF002AAO，画面位置与像素匹配，FIA0026.wav 确实进入播放状态。
- 测试使用采集的原始 BIN/AGF/WAV，通过正式 API 及网页，不使用旧演示配置、预计算全局变量、假资源路由或合成场景。

这是可进入的诊断播放，不是整个原版引擎还原。未知操作码继续按用户要求跳过并记录；缺失链接允许显示已执行的有效前缀并标明停止位置。其他章节未逐场验证，不能宣称全游戏演出、选择分支、地图或动画均正确。初始化只支持已核对的版本，其他版本明确报告未应用原因。

回归入口：gal-age-adapter-selftest.mjs、gal-age-import-selftest.mjs、gal-age-normal-reader-selftest.mjs、fe-gal-age-normal-reader-selftest.mjs、gal-layout-rules-selftest.mjs、fe-gal-import-presets-selftest.mjs。浏览器证据输出到 .cache/age-normal-reader/browser/。

部署需要更新镜像和统一 tag 包，并重跑 gal-layout 2.64.5；仅导入 tag 包无法更新服务端 adapter。已有诊断覆盖项如显式关闭 nativeInitialization 或指定严格策略，将优先于默认配置。
