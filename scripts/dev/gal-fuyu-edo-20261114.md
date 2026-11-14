# fuyukuru / えどわ～る：采集、接入与验证

日期：2026-11-14。代码分支：`feat/gal-download`；layout 版本：`2.64.8`。

## 识别与实现

| 用户目录 | 实际格式 | 适配器 | 状态 |
| --- | --- | --- | --- |
| fuyukuru | Silky/Azurite ARC，LZSS 压缩 MES；AKB/AKB+ 图片、Ogg 语音、WAV 音乐 | `silky::mes`，游戏配置 `silky::fuyukuru` | 可导入和阅读；部分原生演出仍有诊断，不能称为完整原生复现 |
| えどわ～る | Unity 中的 Edoire `@ARCH000`；`ver00_s0.arc` 的 Lua 剧情；`DRAW_*` 封装 | `edo::ikunyu` | 独立配置，复用 Edoire 容器；文字、背景、立绘、CG、语音和 MP4 动态 CG 已接入 |

没有把它们硬塞进旧 SCRE/Edoire 的默认规则。旧 `arcfam::scre`、`edo::lua` 的原有布局保持独立。新增引擎/解码器代码需要更新镜像；layout 和下拉入口在统一 tag 包中。

采集按“清单与头尾 → 完整剧本/索引 → 被引用的图音/一个影片 → 浏览器预加载补件”分轮完成。版本 1.74–1.79，脚本推送后主动取 private release `31` 的自动上报。没有运行 Windows EXE/DLL。样本、重建稀疏档案和显示证据留在本地 `.cache/fuyu-edo-*`；不上传游戏素材到公开仓库。源目录只读，运行时没有下载工具、解码器或依赖的新逻辑。

### Silky

- 真实 `script.arc` 共 59 个 MES/LIB 条目：全部完成边界、目标地址、字符串解码检查。排除开发 `_SAMPLE` 后展开 58 个文件。
- 剧情列表 50 个，正式 `FK_SCENE_01`–`09` 共 9 个回想入口。三处原始选择各自测试两个结果；不会自动替用户选择。
- 单独支持压缩 MES、AKB 差分依赖、角色本体/表情、CG 差分、背景、音乐、语音和跨脚本链接。
- 头像与全屏立绘分开：原始 EXE 仅做静态核对，头像使用 AKB 的 `(512,0,1024,1024)` 区域、0.4 缩放，不能把整个 2048 方图当头像缩进舞台。角色移动必须迁移本体和表情的同一个槽位。
- 静态核对地址：`49e0a0` 头像分发，`47e3b0` 缩放，`47ece0` 源矩形；`49ebc0` 角色分发，`46bd30` 角色槽迁移，`46c3e0` 站位表。地址属于本次采集 EXE，不能泛用于别的游戏。

明确限制：部分原生操作 `29/7`、`29/15`，以及 `29/14`、`29/1005`、`29/1007`、`29/111–115`、`29/993` 与输入查询 `12` 尚未完整还原。这些调用保留 `raw` 诊断，含脚本名、字节码偏移及原始 message 编号（从 0 开始），继续阅读；没有把未知调用当成“已支持”。`FK004A` 的继承状态通过 `entryFrom` 指定父剧本和选择结果，在打开时恢复原始变量、背景、BGM、本体及表情；已验证其首句不再缺少本体。三处选择按原生 1/2 返回值续接，FK004、FK012 的 A/B 链接分别验证，FK028 的两项均续接 FK029。随机/输入/计时查询使用有界阅读模式默认值。

这些限制意味着：目前适合按章节阅读及测试，仍需观察诊断，不保证逐场与原生游戏完全相同。尤其没有把所有未知演出静默吞掉后宣称完整支持。

### Edoire DRAW_* 配置

- 384 个脚本条目，348 个含剧情文本。全部编译检查，保留 25,368 个原始 `text()` 调用。
- `DRAW_BG` / `DRAW_CG` / `DRAW_SD`、单人/多人立绘、Cut-in、漫画效果部件、清除、说话人均按本次原始 `SYSTEMEX` 展开，采用 1920×1080 画布。
- `PLAY_MOVIE` 保留原静态 CG 并交给现有 `movie` 播放器播放影片；`clearVideo` / CG 切换停止影片。容器增加 Unity VideoClip（class 329）+ resource 的 MP4 提取。
- 真实 `msg01c.mp4` 解包后经 ffprobe 和 Chrome 验证：1920×1080，H.264/AAC，约 4.85 秒。没有转码或下载运行时；视频 bundle 仍受现有 64 MiB 解码限额约束，超限会报错。
- 119 个 `h$` 脚本通过可配置虚拟“特殊场景”视图汇总（100 + 19，两页），目录匹配用 `**`，覆盖多层 `ver00_s0/src/game`。CG 指令生成卡片中途开始入口；共享“更多”保留匹配/缩略图/标签显示开关。

限制：震屏 `Shake` / `allstop_shake` 未模拟，部分 `FACE_NAME[...]` 赋值和原生鉴赏菜单跳转保留诊断。角色立绘版本目前使用剧情指定文件名，不执行原游戏养成/体型选择系统或任意 Lua。

## 导入示例

从“导入方案 → 刷新 JSON”左侧新增的两个选项生成配置，也可使用：

```json
{
  "rootDir": "/data/library/gal/fuyukuru",
  "adapters": ["silky::mes"],
  "defaultMetadataActions": ["gal-layout"],
  "dryRun": false,
  "config": {"game": {"id": "silky::fuyukuru", "title": "ふゆから、くるる。"}}
}
```

```json
{
  "rootDir": "/data/library/gal/えどわ～る",
  "adapters": ["edo::ikunyu"],
  "defaultMetadataActions": ["gal-layout"],
  "dryRun": false,
  "config": {"game": {"id": "edo::ikunyu", "title": "填写你的标题"}}
}
```

Edoire 示例根目录是包含 `Archives` 的游戏目录。`game.title` 优先于目录名。

## 验证与实测发现

- `gal-collect-fuyu-edo-selftest.py`：限定目标、只读、精确范围、SHA 清单、尺寸变化拒绝采错。
- `gal-fuyu-edo-selftest.mjs`：全部原始 MES、选择分支、全部 Edoire 文本；真实导入 → layout → 列表/特殊场景 → 场景 → PNG/Ogg 资源。
- `fe-gal-fuyu-edo-selftest.mjs`：Chrome 读取真实 PNG/Ogg/PCM/MP4；头像/表情、主舞台角色、Edoire 人物与 CG、上一句和直接进入。
- 下拉覆盖、参数漂移、旧 Edoire、BGI、旧 KiriKiri 布局回归。

实际导入测试发现并修正：新 Edoire 配置丢失 `.edo` 扩展名，以及特殊场景 `*` 不覆盖三层目录。浏览器验证还复现并修复共用“重播置灰”：CFG 在一句内部更新了程序计数器，旧代码用句末变量判断早先的语音条件；现在按各指令执行时的状态判断。对应 `gal-replay-guards-selftest.mjs`，不自动重播、不改变普通模式选择行为。

浏览器证据：`.cache/fuyu-edo-browser/verification.json` 和同目录截图。解析通过、组件显示通过，并不等于整部作品每一个原生场景都已经人工核对。

## 格式参考

- [GARbro ArcAzurite](https://github.com/morkt/GARbro/blob/master/ArcFormats/Silky/ArcAzurite.cs)：ARC 索引与文件名混淆。
- [GARbro ImageAKB](https://github.com/morkt/GARbro/blob/master/ArcFormats/Silky/ImageAKB.cs)：AKB 像素和差分。
- [AI6WINScriptTool](https://github.com/TesterTesterov/AI6WINScriptTool/blob/main/ai6win_mes.py)：基础操作码表；本作头部、选项和原生分发另以实际字节核对。

## 2026-11-14：FK_SCENE_07 绿色差分修复与动态 CG 核对

- 自动采集 1.80 补取 `EV003` 与 H02/H03/H04，仅约 1.2 MiB。第 29–32 句实际叠加 `EV003_H03`。
- 原因：三张差分均为 `0xc00000ff` 的 BGR24 透明图片，有效矩形 `(442,106,320,275)`，外面 833,600 个像素为纯绿色占位。旧解码仅给 BGRA32 保留 alpha，把 BGR24 透明标志遗漏了，结果遮住底图。
- 修复：仅在 BGR24 的透明标志存在时将精确的 `(0,255,0)` 转为透明；普通 BGR24 的绿色和 BGRA32 的原始 alpha 保持不变。Silky 资源缓存版本独立更新，旧 PNG 自动重新生成；不需要删除源素材或重采游戏。
- 真实样本回归：三张差分的透明区域与有效矩形、原生剧情指令、浏览器逐句/直接进入/回退再前进，以及资源容器读取。证据 `.cache/fuyu-green-debug/browser/verification.json`。
- 动态 CG：えどわ～る原始剧情有 74 处 `PLAY_MOVIE` 调用，引用 72 个不同影片（75 的初始粗计数包含一条函数定义）。`scsg01h` 第 15 / 27 / 44 句开始 msg01a / msg01b / msg01c，最后一个已验证原始 MP4 播放。
- fuyukuru 的完整文件清单和已解析档案中没有发现视频、Live2D 或 Spine 资源；当前确认的是静态 CG 与差分/镜头演出，不能把切换差分说成骨骼动态 CG。

本次解码修复需要更新镜像，layout 配置没有变化。

## 2026-11-14：实际部署链路补测（上次验证遗漏）

用户加载的 digest `847e80f932309af530a6d4bd333615edbcbfd1847398535185ad72f0c8c4b0ef` 与 Action 43594090385 完全一致，不能归因于用户未更新。自动采集 1.81/1.82 取回安装中的两个条目配置及指定生成文件；均为正确 adapter、layout 2.64.8、hybrid 模式；fuyukuru 未发现落在游戏目录里的旧 EV003 PNG。

- 绿色问题：真实 HTTP 的资源仍用不带解码版本的 URL，并允许浏览器缓存一小时。回归先在同一 Chrome 缓存旧的不透明绿色 PNG，再切换服务器为已修复 PNG；使用真实配置和实际大小写路径时，新播放器仍拿旧图，确实失败。此前虚拟资源 route / 新浏览器没有覆盖这种升级场景。
- 修复：后端 Silky reader 下发与解码器统一的 `resourceVersion`；播放器 URL 附加 `v`，避开浏览器旧图。不清理浏览器、不删除素材或旧缓存、不改变其他 adapter 的 URL。更新镜像并重新打开场景即可，无需重跑 layout。
- 动态 CG：`PLAY_MOVIE` 原展开把静态 CG 写进 `edo:EV` overlay；canvas 在 z=4，视频在 z=2，导致视频有播放进度却不可见。独立 MP4 测试不带原始 overlay，因此此前通过并不能证明原场景可见。
- 修复：DRAW profile 生成专用 `playVideoCg`，将加载底图放到背景层，然后播放影片。普通旧 Edoire `playVideoEx` 的行为不变。
- 回归 `fe-gal-pair-http-selftest.mjs` 使用采回的实际配置、原始 scsg01h 与 FK_SCENE_07、真实 getReaderContent/getResource 及 HTTP 路由（无资源拦截）。保留升级前浏览器缓存后，FK_SCENE_07 第30句角落 alpha=0；scsg01h 第15/27/44句均无不透明上层遮挡，实际影片前后帧不同、时间推进。记录 `.cache/pair-http-regression/verification.json`。

这次验证覆盖了实际资源接口、升级缓存和原场景叠放，但仍不等于所有剧情的完整原生复现。
