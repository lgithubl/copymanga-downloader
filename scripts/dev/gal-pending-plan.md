# Gal 待办方案（需要第七轮数据才能继续的部分）

先跑 `scripts/dev/collect-gal-samples7.sh`（用法见脚本头），把 `gal-samples7.txt` 发回来，下面每一项按对应小节的数据落地。已经能做的部分（缩略图数组 / 悬停轮播 / deepone 与 legeclo 的缩略图 / 随机语音 / 播放器 UI / 媒体库页面）不在这里，见各自的提交和 `web/library/gal/README.md`。

## 1. minashigo 缩略图（采集脚本 C 段）

- 现状：`game/images/thumb/<12 位>_360.jpg` 存在，gal-layout 的 minashigo 检测没配 `thumbsDirs` / `thumbSources`；脚本是 `scene_<9 位>.rpy(c)`，两者的对应关系看不出来。
- 数据看什么：C 段会打印「thumb 前 N 位能对上 scene 前 N 位」的命中数，以及抽样 scene 脚本里出现的长数字（可能脚本里直接写了 12 位的缩略图编号）。
- 落地：对应关系确定后，写成一条 `thumbSources`（`dir: game/images/thumb`，`match: ^(\d{N})\d*_360\.jpg$`，`key: {1}`，`forKey` 由 scene 编号截取），并让同一个 key 的多张图（不同服装 / 阶段）成为轮播数组。若脚本里直接引用了编号，改由适配器 catalog 给出 `thumb`。

## 2. train（MistTrainGirls X）缩略图（D 段）

- 现状：`misttrain-json` 适配器只读骨架和 `MasterData`，从没用过 `Textures/Characters/Bases`（约 250 个 `<底号>201.png`）。
- 假设：Bases 文件名 = `MCharacterBaseViewModel.json` 的 `Id` + `201`。D 段会统计 `Id + 201 / 101 / 001 / 无后缀` 各自的命中数，以及 Bases 里对不上 Id 的文件。
- 落地：假设成立 → 角色卡片的缩略图 = `Textures/Characters/Bases/<Id>201.png`（在适配器 catalog 里给 `thumb`，或用 `thumbSources`）；剧情卡片沿用「场景里第一张背景」。不成立 → 按 D 段的统计换规则。

## 3. legeclo 未渲染的 `voice ×39`（A 段）

- 现状：`renpy-legeclo` 只在 `play|queue voice "字面量"` 时生成 `voice` 指令（`PATH_RE`）；`play voice [变量]`、没引号的写法、`$ renpy.play(...)` 一律记成 raw。
- 数据看什么：A 段会打印 `artemis_halloween_03.rpy` 里认不得的 voice 行，以及全部脚本里按写法归类的计数。
- 落地：按真实写法补 `PATH_RE` / 变量展开（如果是 Ren'Py 变量，需要读脚本里的赋值；如果只是路径里带插值 `"[x]"`，按已知变量替换）。补完后这个脚本的 `stats.raw` 应降到 0。

## 4. Girls Creation 未渲染指令（B 段）

- 现状：`subimage`、`cgmode`、`asyncmoveobject`、`CrossFade(缩放/位移)` 没实现，输出 raw（例：`hmr_40101123.txt` 各 2 条）。
- 数据看什么：B 段会打印这些指令的原始行、全部脚本里的写法归类，以及前 400 个脚本的标签直方图。
- 落地：按参数含义映射到现有指令（`subimage` ≈ 叠图 / 差分；`asyncmoveobject` ≈ 立绘位移；`CrossFade` ≈ 背景交叉淡入并带缩放位移的 `camera`/`bgScale`）；做不到的保持 raw 并放进 `rawIgnore` 的建议列表。

## 5. 骨骼转缩略图（不依赖数据，等你确认再做）

- 视频缩略图已经由缩略图任务用 ffmpeg + 缓存目录处理；骨骼不行（没有 ffmpeg 能渲染 Spine）。
- 方案：在浏览器里用现有 `gal-spine.js` 渲染骨骼的第一帧（或指定动画的指定时间）到离屏 canvas，`toBlob` 后 `PUT` 到服务端缓存目录 `DATA_DIR/cache/gal-thumbs/`（键 = 骨骼文件路径 + mtime + size + 参数的哈希）；之后卡片直接请求缓存里的 JPEG。
- 触发：卡片滚入视口且没有缓存时才排队生成（并发 ≤ 2，单个超时 5 s，失败写入失败标记避免重试风暴）。
- 要点：3.6 / 3.8 / 4.0 / 4.2 运行时按骨骼版本选择（已有）；3.6 没有真实文件，先用合成骨架验证；上传接口只接受同源、大小有限的 JPEG/PNG，路径键由服务端按资源路径重新计算，不信任客户端给的路径。

## 6. 之前几轮遗留（需要真实数据验证，不是采集）

- Kamihime：`anim layer=3 left="±=640"` 滑入滑出没渲染；立绘位置只按出场顺序摆。
- TSK：`Skin`（face1…）已写进 `spine` 指令但播放器不认；`<Off>` 的含义是假设；立绘 x 参考宽度 1280 是猜的。
- ぼくら：`playbgm` 曲目是猜的；`move` 不做渐变；数字层多帧动画只显示第一帧。
- Grenze：`screen_effect` / `pic_action` 的日文名字已按名字映射成现有指令（shake / fade / flash / wash / standOff，秒数强度是猜的）；数字 id、`effect`（战斗特效）、`pic_size`、`マスク` / 立绘进出场等仍是 raw；`back_voice` → `bgvoice`（循环、缺省沿用是推测）。
- 魔法学园：`others.action` 的 bow / jump / swing / vibe / avoid 近似成整屏轻抖（立绘没有单部件动作，数值是猜的）；`bg_change.val` f / c / s = fade / cut / slide 是猜的；emotion 全部 raw。
- 上述各项的处理方式都在 `web/library/gal/README.md` 对应游戏的小节里。
