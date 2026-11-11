# Gal 数据下载 / 本地采集（纯 Node，v2.2.5）

只请求已生成 plan 中的游戏数据 URL。不安装或下载解释器、依赖、工具、类型数据库或 APK。
dryRun:true 全程无网络请求。服务端、Dockerfile、package.json 无改动，只更新 tag 脚本包。

## 配置：所有下载选项归 task

```json
{
  "scriptTimeoutMs": 7260000,
  "tasks": [
    {
      "id": "tsk",
      "game": "tsk",
      "adapters": ["utage-book"],
      "provider": "tsk",
      "enabled": true,
      "dryRun": true,
      "logPrefix": "tsk-debug",
      "downloadLimit": 3,
      "concurrency": 2,
      "requestIntervalMs": 1000,
      "retryDelayMs": 2000,
      "runTimeoutMs": 7200000,
      "requestTimeoutMs": 180000,
      "skipCategories": ["shop", "equipment", "enemy-icon", "announcement"],
      "actions": ["download", "extract", "verify"],
      "source": {"type": "apk", "path": "/data/packages/base.apk"},
      "include": ["scenario", "image", "spine", "voice"]
    }
  ]
}
```

- tasks 按顺序执行，每项独立管理 dryRun、logPrefix、downloadLimit、concurrency、requestIntervalMs、retryDelayMs、runTimeoutMs、plan、日志和进度。
- adapters 必填且非空，至少一项必须出现在当前媒体的 item.adapters 中；game 若配置也必须匹配 config.game.id。不匹配直接 skip，不扫描、不下载。
- id 应保持不变且唯一，用于寻找本 task 的 plan；省略时使用 task-<数组下标>，调整任务顺序后可能找不到原 plan。
- 上层只保留 tasks 和宿主技术参数 scriptTimeoutMs（默认 1560000）。v1 的顶层 dryRun 等配置需移入各 task，不做静默继承。
- TSK 默认使用 gal-layout 的 config.resourceRoots[0] 作为目标目录，否则使用 source.path；task.targetDir 可指定媒体内相对目录。

## 两阶段流程

1. dryRun:true：解析本地 APK/catalog，按目录快照对比目标文件，保存**完整 plan**。
2. 确认日志后，仅把该 task.dryRun 改为 false：读取本 task 的已有 plan，重新检查目标文件，存在就 skip，缺失才下载、解包、校验、原子写入。

正式执行不再解压 APK 或重新生成资源目录，只检查源文件路径/大小/mtime 和关键配置是否一致。
没有 plan、源文件变化、目标目录/adapters/game/include/source/skipCategories 等关键配置变化时明确报错，要求先重新 dryRun:true。
修改 downloadLimit、concurrency、requestIntervalMs、retryDelayMs、runTimeoutMs、requestTimeoutMs、scriptTimeoutMs、logPrefix、dryRun 不使 plan 失效。
存在的文件一律 skip-existing 并逐路径记入日志，包括本工具以前生成的文件；不会自行覆盖或修复已有文件。需要补某个文件时，先自行将它移动到别处，再执行已有 plan。

- downloadLimit 为本次最多下载的唯一 bundle/文件 URL 数，0 不限。它**不截断 plan**；缓存命中不占额度，依赖未到齐时不导出残缺资源。
- concurrency 为下载并发 1–8；依赖下载结束后逐 bundle 解包。
- requestIntervalMs 为同一 task 内任意两次网络请求启动的最小间隔，所有并发 worker 和重试共用；首个请求立即开始，不阻塞已在传输的请求。默认 0 不等待。
- retryDelayMs 为失败后到下次重试至少等待的毫秒数（最多尝试 3 次）。重试仍遵守 requestIntervalMs；两个限制同时满足才开始请求，不固定相加。默认 0。两个值必须为 0–2147483647 的整数，示例的 1000/2000 分别是一秒/两秒。
- dryRun、缓存命中、已有文件 skip 不等待。等待会记录请求 URL、间隔和重试原因，并可被 task 超时中断；requestTimeoutMs 从实际发起请求开始计时。配置只管理 task 内请求，不额外设置 task 之间的休眠。
- 下载流写 cache/bundles/*.part，校验大小/可选 SHA256/UnityFS 头后 rename 成缓存文件。
- 解包在线程中完成，主任务再次检查目标存在性，在目标目录写临时文件再 rename。已完成的文件在下一次执行时直接 skip，下载缓存可复用。
- plan 保留全量映射，执行结果和完整列表写入本次 result.json；缺依赖/limit 截断为 partial，错误为 failed。
- 错误按阶段拆分：`download-failed`（HTTP/响应体/下载校验）、`extract-failed`（本地解析/解码）、`write-failed`（目标写入/写后校验）。每类分别统计，任务有错误时仍为 failed；单个 bundle 的错误不会阻止后续独立 bundle 继续处理。
- 已下载并验证的 bundle 不因解析失败而移走或重下。修复解码脚本后直接用原 plan 再执行；有效缓存不占 downloadLimit，已有目标文件继续 skip。一个 bundle 的导出仍先在 worker 中完成，再逐文件原子写入；没有写出的文件下次重新导出。
- `run.log` 实时打印上述阶段前缀和解析失败项的缓存位置；分类汇总新增 `downloadFailedBundles` / `extractFailedBundles` / `writeFailedBundles`，保留总 `failedBundles`。
- 运行结束时，失败项分别输出到本次日志目录的 `download-errors.json`、`extract-errors.json`、`write-errors.json`（有该类失败才生成）。系统日志打印路径，`result.json` 中各 task 的 `failureSummary` / `errorFiles` 也给出数量及位置。依赖下载失败单独标记 dependency-skipped，不冒充解析错误。

- 同一媒体独占锁。进程异常终止遗留 lock-* 时，确认无运行任务后将它移动到 /tmp/，不要直接删除。
- 清理临时文件、释放锁和测试目录统一移动到 /tmp/gal-download-archive/，跨文件系统使用已有 mv 命令。

## 按资源分类 skip

skipCategories 放在每个 task 内，默认 []，不擅自跳过任何分类。include 仍是 scenario/image/spine/voice 这四种粗粒度资源类型；skipCategories 是下面的用途分类。

| 分类 id | 含义 / 路径判据 |
| --- | --- |
| scenario | 剧情、Master 表 |
| cutin | Cutin 演出骨架、atlas、纹理；高质量 adult/general 合并到 Cutin/角色号，优先 adult |
| adventure-spine | Adventure/Spine 剧情特效骨架、atlas、纹理 |
| adventure-texture | Adventure/Textures 剧情特效图片、骨架、atlas |
| event-entry | Sprites/EventEntry 活动入口图片；仅在当前 APK catalog 存在时可规划 |
| still | Stills 下的 CG、场景骨架和 atlas |
| character | Characters 下的角色立绘、骨架 |
| background | Adventure/BackGrounds 剧情背景 |
| voice | Sound/Voice 角色语音 |
| bgvoice | Sound/BgVoice 背景语音 |
| bgm | Sound/Bgm 音乐 |
| se | Sound/Se、Sound/BgSe 音效 |
| character-icon | Sprites/Chara 中的其他角色图标、头像 |
| enemy-icon | Sprites/Chara 中 basename 为 enemy_* 的图片，仅凭明确命名识别 |
| picturebook | Sprites/PictureBook 图鉴图片 |
| event | Sprites/EventQuest 和 m_event_* 活动横幅 |
| gacha-animation | GachaCharaAnim 角色动画 |
| gacha-ui | Sprites/Gacha 和 m_gacha_* 抽卡横幅 |
| shop | Sprites/Shop 商品图片 |
| equipment | Sprites/Equip 装备图片 |
| item | Sprites/Item 道具图片 |
| announcement | Sprites/StartupNotification 启动公告 |
| banner | 其他 Sprites/Banner 横幅 |
| recommend | Sprites/Recommend：推荐展示 |
| skill | Sprites/Skill：技能图标 / 按钮 |
| login-bonus | Sprites/LoginBonus：登录奖励图片 |
| home-background | Sprites/Bg：主页背景 / 分层图片 |
| world-raid | Sprites/WorldRaidEvent：世界 Raid 图片 / 背景骨架 |
| profile | Sprites/Profile：个人资料装饰 |
| trophy | Sprites/Trophy：奖杯 / 成就图片 |
| sub-tutorial | Sprites/SubTutorial：子教程图片 |
| special-site | Sprites/SpecialSite：专题页素材 |
| mini-game | Sprites/MiniGame：小游戏素材 |
| common-icon | Sprites/Icon：通用图标 |
| theme | Sprites/Theme：主题图片 |
| ui | Sprites/UI：通用 UI |
| story-ui | Sprites/Story：剧情菜单图片 / 骨架 |
| stamp | Sprites/Stamp：印章图片 |
| campaign | Sprites/Campaign：活动加成图片 |
| home-ui | Sprites/Home：主页按钮 |
| tutorial | Sprites/Tutorial：教程图片 |
| home-shade | Sprites/HomeShade：主页角色阴影 |
| mission | Sprites/Mission：任务界面图片 |
| character-thumb-001 … character-thumb-009 | Sprites/Chara/Thumb_001 … Thumb_009，按原始目录分别筛选，未推测用途 |
| other | 其他已支持但用途未识别的资源，默认保留 |

兼容旧配置：skip `character-icon` 同时排除九组 `character-thumb-*`；skip `other` 同时排除从 other 拆出的上述目录分类。新分类可单独 skip；未知的新目录仍归 other。日志按细分类分别统计。

例如在 task 内按需添加（不是默认跳过清单）：

```json
"skipCategories": ["recommend", "skill", "profile", "trophy", "sub-tutorial", "character-thumb-005"]
```

分类按 catalog 原始路径判断，不下载文件来猜测用途。被跳过的文件不会导出或删除；日志逐项输出 skip-category [分类]，plan.classification 保存文件计数，plan.skippedAssets 保存完整跳过列表。
同一个 bundle 或依赖被其他保留资源需要时，bundle 仍可能下载，但只导出保留资源；仅属于被跳过类别的孤立 bundle/依赖会移出 plan。
分类统计单位是文件，下载上限与候选计数单位是 bundle，不能混为一谈。
修改分类后必须先重新 dryRun:true；false 拒绝执行筛选规则不同的旧 plan。TSK 未知分类名直接报错，避免拼写错误导致下载范围失控。
通用 files provider 也支持 skipCategories，entries[].category 可提供自定义分类，未标记的归 other。

### APK catalog 全量审计（2.2.3）

两个 catalog 的每个条目都必须计入审计，计数不闭合或有未定结果则拒绝生成 plan。日志逐分类打印 `APK分类审计 [分类]`，包括 `other` 的各类 skip 数量；完整条目索引、源 key、分类和原因写入每次运行的 `catalog-audit.json`，并打印路径。dryRun:false 复用 plan 中的审计，不重新解析 APK。

- `mapped`：已映射为候选目标，后续还会做 skipCategories、目录存在检查和 limit 筛选。
- `skip-low-quality`：低清副本。
- `skip-duplicate-target`：多个源指向同一目标，选定优先版本。
- `skip-include`：被 task.include 排除。
- `skip-no-bundle`：没有可用 CDN bundle，同时列入 unresolved。
- `skip-unsupported-format`：未实现导出的 Unity 内部格式，如材质、prefab；不会伪装成已导出的骨架文件。
- `skip-unsupported-path-or-format`：尚未支持的路径或格式，保留完整源 key。
- `skip-catalog-key`：catalog 的 bundle/内部键，不是独立目标文件；相关 bundle 仍可作为已保留资源的依赖下载。

这是 APK 目录的处理覆盖审计，不代表每个资源都能成功解码或当前 APK 包含旧库的所有文件。解码失败仍明确记录 failed，已有文件继续 skip，APK 中不存在的旧资源不会被删除或凭空生成。

真实 APK 01.03.14 中，跳过示例四类会排除 7383 个文件，候选 bundle 从 26976 降为 19593；这不是当前库的实际缺失数。

## 实时日志与进度

默认 cache 是 /data/cache/library/tag-script-cache/gal-download/（/data 由 DATA_DIR 决定）。
每个 task 启动立即打印并创建：

```text
<cache>/runs/<logPrefix>-<时间>-<runId>/run.log
<cache>/runs/<logPrefix>-<时间>-<runId>/progress.json
<cache>/runs/<logPrefix>-<时间>-<runId>/result.json
```

- run.log 实时追加阶段、每 5000 个文件的目录对比进度/当前路径、下载起止、解包、written、逐文件 skip-existing、错误；长阶段每 5 秒有进行中记录。
- progress.json 实时保存阶段、compared/total/current 或下载 completed/total，以及耗时。result.json 在结束时保存结构化结果。
- 系统的任务详情在函数返回后收到摘要和日志位置；运行中直接看 run.log / progress.json。容器 stdout 启动时也会打印日志路径。
- 持久 plan 在 <cache>/plans/<媒体及task标识>/plan.json；同目录 current.json 指向本 task 最新日志。返回系统的日志会打印准确绝对路径。
- 日志和 bundle 缓存不自动删除。

每个 task 的日志末尾和系统返回值均有「分类下载汇总」，无需自己汇总 URL 明细。
result.json / details.results 中的 categorySummary 按分类给出：

| 字段 | 单位与口径 |
| --- | --- |
| missingFiles | 本轮开始时缺失、需要导出的文件数，包含受 limit 限制的文件 |
| downloadBundles | 本轮开始时没有可用缓存、全量需要下载的唯一 bundle URL 数，不受 limit 截断 |
| selectedDownloadBundles | 本次按 limit 选中的计划下载数，缓存不计入 |
| cachedBundles | 所需 bundle 中已有有效缓存的数量 |
| limitedBundles | 本次被 limit 跳过的 bundle 数 |
| existingFiles | 本地已存在并 skip 的文件数 |
| categorySkippedFiles | 被 skipCategories 排除的文件数 |
| downloadedBundles | 实际下载成功数（正式执行时显示） |
| writtenFiles | 实际写入文件数（正式执行时显示） |
| failedBundles | 执行失败的 bundle 数（正式执行时显示） |

分类内的 URL 会去重；一个共享 bundle 可能同时为多个分类服务，各分类数不能直接相加。
categoryTotals 是全局按 URL 去重的总计。依赖跟随需要它的分类计数；已经存在的文件不再引入仅供它使用的依赖。
本版为统计增强，已有 v2.1 plan 可继续使用，配置不需要改变。

查看最新 tsk 日志（容器内）：

```sh
GDL_LOG=$(find /data/cache/library/tag-script-cache/gal-download/runs -path '*/tsk-debug-*/run.log' | sort | tail -n 1)
tail -f "$GDL_LOG"
```

### 超时配置（毫秒）

- `scriptTimeoutMs`：放顶层，整个 tasks 数组共用的宿主时间上限，默认 1560000（26 分钟）。宿主直接读取配置，无需更新镜像。脚本预留最后 10 秒保存结果、日志和释放锁。
- `tasks[].runTimeoutMs`：单个 task 的上限，覆盖规划、对比、下载及解包。未配置时使用整体剩余时间；显式配置超过剩余时间时会被截短。旧配置里若仍有 1500000，仍会在 25 分钟时停止，需修改或移除。
- `tasks[].requestTimeoutMs`：每次 HTTP 请求连同响应体传输的上限，默认 120000（2 分钟），不控制本地解包；失败按重试配置处理。
- 三项均为 1000–2147483647 的整数，0 不表示无限。多个 task 时整体时间需覆盖各 task 的预期耗时。
- 上面的示例为整体 121 分钟、tsk 120 分钟、单次请求 3 分钟。启动日志打印 task 实际可用时间，便于确认是否被整体剩余时间截短。
- task 到时立即停止：正在执行的 URL 标记 `interrupted`，本轮未处理的 URL 标记 `deferred`，不再连发失败日志。结果记为 partial（已有其他真正失败则 failed）。已完成文件与完整 bundle 缓存保留，再执行相同 plan 时跳过已有文件并复用缓存；未写出的资源重新导出。


## 本地输入与采集

TSK 支持 source:{type:"apk",path:"/data/packages/base.apk"} 或 source:{type:"catalog",paths:["/data/catalog.json","/data/catalog_sound.json"]}。
必须使用完整 Addressables JSON；Release tsk 的 URL TSV 不含资源键/依赖映射，不能单独生成 plan。

其他游戏可使用 provider:"files"，source:{entries:[{url:"https://example.com/bg.png",target:"images/bg.png",sha256:"可选完整SHA256",size:1234}]}；也可 source.path 指向 {entries:[...]} 的本地 JSON。

单独本地采集设置 actions:["collect"]，无需 source/plan，不访问网络。默认下载流程不采集。
collectLimit 默认清单最多 100000 项；collectPatterns 选择样本 glob，例如 ["Adventure/Master.chapter.json","Adventure/CharaScenario/*.book.json"]。
collectSampleLimit 默认 10，collectMaxBytes 默认单文件 16 MiB；样本放本次 samples/，跳过符号链接和存档目录，不自动上传。

## 原生解码范围

Node worker 内解码，不阻塞服务端线程；没有运行时安装路径。
辅助模块导入带脚本版本，上传新包不会复用旧模块缓存，无需重启容器；维护时同时更新 manifest.version 和 main.js 的 helper 版本查询参数。
APK 读取使用镜像原有 unzip。FSB5 Vorbis 在 Node 内无损重建 OGG；PCM/MPEG 解封装后使用已有 ffmpeg（只允许 pipe 协议）转 OGG，优先 libvorbis，宿主仅有 libopus 时使用 Ogg Opus。缺少这两个编码器时明确失败并保留缓存，不安装或升级工具。

支持 UnityFS 未压缩/LZ4/LZMA，SerializedFile v17–22 包内 type tree，TextAsset 骨架/atlas，Utage book/master JSON（沿 chapter.dataList 引用读取实际 book，同时兼容 ImportChara 编号与 CharaScenario 对象名关联），Alpha8/RGB24/RGBA32/ARGB32/BGRA32、ASTC 4×4 / 5×5 / 6×6 / 8×8 / 10×10 / 12×12（格式 48–53）、ETC2 RGBA8（格式 47）和非旋转矩形 Sprite → PNG。同一 PNG 容器同时暴露 Texture2D / Sprite 时优先完整 Texture2D，保持 Spine atlas 坐标及页面尺寸。
FSB5 支持单样本 Vorbis、PCM8/16/24/32/float 和 MPEG。Vorbis 完整静态 setup 头部表随包携带，缺少 CRC 时明确报错，不联网补取。图片解码源码和静态表的来源、固定版本与 MIT 许可证见 THIRD_PARTY_NOTICES.txt；无需 Python、UnityPy、WASM、npm install 或修改镜像依赖。
暂不支持 ASTC HDR、其他 ETC/BC 格式、外部 SpriteAtlas/旋转 Sprite、缺少 type tree 的剧情对象，以及 APK 内置 bundle 导出。
活动 banner_id、游戏内 mod、机翻不在范围内；不为这些功能额外联网。

UnityFS/PNG 代码复用仓库实现，公共字符串偏移是 Unity 文件格式常量，不依赖外部项目运行环境。

## 验证

```sh
node --test scripts/dev/gal-download*selftest.mjs
GAL_TSK_APK=/path/to/base.apk GAL_TSK_SAMPLE_BUNDLE=/path/to/sample.bundle node --test scripts/dev/gal-download*selftest.mjs
```

性能回归覆盖缺失目录的实际 fs 调用数；日志回归在下载未完成时读取 run.log 和 progress.json。
本机同一真实 APK 的完整 dryRun 从约 159 秒降到约 9.2 秒；这是本机空目标目录的数据，不代表所有存储设备的耗时。
