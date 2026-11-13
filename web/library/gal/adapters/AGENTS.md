新增或接入 Gal adapter 时，必须同时处理用户入口，不能只注册解析器：

- 在 `web/static/gal-import-presets.js` 增加通用家族配置选项，让“导入方案 → 刷新 JSON”左侧下拉可以生成配置。游戏 id 和 title 由用户修改；开发中的支持要明确标注状态。
- 同步 `scripts/tag-scripts/gal-layout/main.js` 中的家族布局、默认参数表及必要的容器格式配置，并更新参数漂移守卫。不得为了新游戏改变旧家族的匹配范围。
- 验证导入、执行 layout、进入列表及资源读取；运行 `scripts/dev/fe-gal-import-presets-selftest.mjs`，检查下拉覆盖所有已注册 adapter、刷新保留现有其他配置且不会提交保存。
- 明确区分“原始文件成功解析”“组件能显示”和“整段原生剧情能正确播放”。未支持指令需有脚本、偏移和操作码诊断，不能静默忽略后宣称支持完成。
