# BGI udeori 小图换幕残留（2026-11-27）

目标：`312_movea02_02_h07`。原始压缩脚本 SHA256：
`7cbf4201d3db6ed94b0cfd3c7d7d2eb70b2f2fcbe9d83c825daf830e5bc74c6e`。
定向采集另含同一游戏 `system.arc` 的 `framework._bs`，不采图音或运行时。

## 实际原因

原始脚本完整解析为 187 句，未截断。第 66 句前 `_DrawSPR` 重建槽 5 的小图；第 76 句前 `_DrawScene` 先切 BLACK 再进入正式 CG。第 86 句又切换 CG，第 100 句没有清层调用。不能按第 86 或 100 句硬编码修补。

该游戏框架的 `_DrawSPR` 调用 `_DrawBS`，使用 `10 + slot` 的槽位；`_DrawScene` 初始化全部立绘槽的计划状态。适配器却把 SPR 独立维护为长期 overlay，换幕只清 busts，漏了旧 SPR 的生命周期。

修复：沿用 `clearBustsOnScene` 控制换幕清理，清除上一批台词提交前已显示的 SPR；保留当前绘图批次新画入的 SPR，因为实际脚本存在先 `_DrawSPR` 后 `_DrawScene` 的合法顺序。配置显式关闭此选项时继续保留图层。

另发现独立漏洞：容器 compactEvent 裁掉参数末尾的 0，但 FadeSPR/FadeBS/FadeBGM 将缺省值当成 1，导致立即清除或停音乐失效。改为按压缩约定恢复 0，兼容已有缓存，不改缓存格式。此漏洞不是该场景第 86 句的小图残留原因，但该场景第 76 句前的 FadeBGM 也受影响。

## 验证

- 新回归 `node --test scripts/dev/gal-bgi-sprite-lifetime-selftest.mjs`：6/6。覆盖真实二进制 ARC → DSC → 容器压缩事件 → 适配器、旧缓存、非零参数保留、同批新图保留、跨幕清理和配置关闭。
- 原有 `node scripts/dev/gal-bgi-selftest.mjs`：58/58。
- 原始 187 句脚本经修复后的适配器输入真实 Chrome 的 gal-engine 与 overlay canvas：52–59 句有 spr5，60 句清除；61 句有 spr9，62 句清除；66–75 句有 spr5，76、86、100 句均无旧图。逐步播放与 stateAt 直接跳转一致，无浏览器脚本异常。第 76 句输出 bgmStop。
- 浏览器测试使用几何色块代替原图，只验证真实脚本的图层生灭和合成器清层，未对照 Windows 原作画面，也不宣称本次补全移动/缩放等其他指令。

## 更新

修改在服务端适配器，需要更新镜像；不需要重跑 gal-layout 或删除已生成的 BGI 容器缓存。刷新/重开场景以请求新的解析结果。
