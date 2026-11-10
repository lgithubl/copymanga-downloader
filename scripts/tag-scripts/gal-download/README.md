# Gal 数据下载 / 本地采集（纯 Node）

只在 download 操作中请求用户配置的游戏数据 URL（files 清单或本地 APK/catalog 中的 bundle URL）。
**不安装或下载 Python、UnityPy、uv、npm 包、解码器、类型数据库、APK 或其他工具。dryRun 不发起网络请求。**
无需改服务端、Dockerfile 或 package.json。解码在 Node worker 中完成，避免阻塞服务器；媒体写入统一由主任务校验并原子 rename。
APK 读取使用镜像原有 unzip，非 OGG 音频转换使用镜像原有 ffmpeg；缺少工具或不支持格式时明确报错，不自动补装。

## 安装及配置

```sh
tar --exclude='__pycache__' -czf /tmp/gal-download-1.1.0.tgz -C scripts/tag-scripts gal-download
```

上传脚本包，在元数据脚本设置中配置 options，对 Gal 媒体执行。仅支持条目级执行。

```json
{
  "dryRun": true,
  "logPrefix": "debug-tsk",
  "downloadLimit": 3,
  "concurrency": 2,
  "tasks": [
    {
      "game": "tsk",
      "provider": "tsk",
      "actions": ["collect", "download", "extract", "verify"],
      "source": {"type": "apk", "path": "/data/packages/tsk.apk"},
      "include": ["scenario", "image", "spine", "voice"]
    }
  ]
}
```

- tasks 按顺序执行；game 必须匹配当前条目的 config.game.id，enabled:false 跳过。
- TSK 也支持 source:{type:"catalog",paths:["/data/catalog.json","/data/catalog_sound.json"]}，必须是本地完整 Addressables JSON。Release tsk 的 URL TSV 不含资源键及依赖映射，不能单独用它计算差集。
- TSK 优先使用 gal-layout 写入的 config.resourceRoots[0] 作为目标目录；其他情况使用条目的 source.path。task.targetDir 可指定媒体内部相对目录。
- 全局或 task.dryRun:true：读取本地输入，写 cache 中的计划和日志，不请求资源，不修改媒体数据。
- downloadLimit：每个 task 本次最多下载多少个唯一 bundle/文件 URL，0 不限。缓存命中不占额度；顺序固定；依赖未到齐时不解包、不写残缺文件。
- concurrency：下载并发 1–8；依赖下载结束后再解包。
- 下载到 cache/bundles/*.part，校验后 rename 成缓存文件。校验大小、已提供的 SHA256、UnityFS 文件头；没有上游 SHA 时，本地摘要只检测缓存损坏。
- 解包全部成功后才把该 bundle 的结果交给主任务；每个目标文件在自身目录写临时文件再 rename。已有非本工具管理的文件默认 preserved，避免无意义下载和覆盖；overwriteExisting:true 才替换。
- 管理过的文件按来源指纹和文件 SHA 判定 unchanged。force:true 从缓存重新导出；refreshDownloads:true 重新请求清单中已配置的 URL，并计入 limit。不会自动删除媒体文件。
- 同一媒体独占锁；异常退出遗留 lock-* 时需确认无运行任务后手动移除。runTimeoutMs 默认 25 分钟，scriptTimeoutMs 必须至少多 5 秒；截止时取消请求和解码线程。
- 不生成永久状态标签，因此每次主动执行都会重新检查，不受宿主的同版本 tag 跳过影响。

## 本地采集和日志

actions:["collect"] 可单独采集，不要求 source，也不访问网络。
文件清单默认最多 100000 项（collectLimit），跳过符号链接和存档目录。
collectPatterns 配置样本 glob，例如 ["Adventure/Master.chapter.json","Adventure/CharaScenario/*.book.json"]；默认不复制资源。
collectSampleLimit 默认 10，collectMaxBytes 默认单文件 16 MiB；样本写入本次 cache 的 samples/。`**` 匹配至少一层目录。不自动上传。

ctx.cacheDir/runs/<logPrefix>-<时间>-<runId>/ 保存 run.log、result.json、各任务的 plan.json / inventory.json / samples/。
返回系统的日志包含摘要、前 30 项及完整日志绝对路径；更多条目在 result.json 和 plan.json。
日志路径是服务器/容器内路径。日志不自动清理；保留 bundles 可避免重复下载。
清理失败临时文件、释放锁和测试目录时统一移动到 /tmp/gal-download-archive/，不直接删除；跨文件系统使用现有 mv 命令。
同步结果在 details.status 区分 completed / partial / failed；limit、缺依赖或未解析资源为 partial。
宿主任务的完成状态表示脚本已经返回，具体结果以摘要和 result.json 为准。

## 其他游戏

通用 files provider 不需要 Unity 解码，可使用本地 JSON 清单或内联 entries：

```json
{
  "game": "another-game",
  "provider": "files",
  "source": {"entries": [{"url": "https://example.com/bg.png", "target": "images/bg.png"}]}
}
```

entries 中可提供 sha256 和 size。也可 source.path 指向 {entries:[...]} 的本地文件。
游戏专有协议通过增加本地 provider 扩展，不能借此下载或安装运行环境。

## TSK 原生解码范围

- UnityFS：未压缩 / LZ4 / LZMA（包括 APK 内 catalog）；SerializedFile v17–22；读取包内 type tree，不获取外部数据库。
- 剧情：MonoBehaviour 中的 importGridList / settingList → book/master JSON。
- 骨架和 atlas：TextAsset 原始字节导出。
- 图片：Alpha8 / RGB24 / RGBA32 / ARGB32 / BGRA32，及非旋转矩形 Sprite 裁剪 → PNG，编码使用 Node zlib。
- 音频：原始 OGG 直接导出，其他格式交给现有 ffmpeg；它不能解码的 FSB 变体会失败并保留缓存。
- 尚未支持：压缩纹理（ASTC/ETC/BC 等）、外部 SpriteAtlas/旋转 Sprite、缺失 type tree 的剧情对象，以及 APK 内置 bundle 导出。不把这些情况记为成功，也不会联网补工具。
- 活动 banner_id 映射、游戏内 mod、机翻不在此脚本范围；保留已有文件。

UnityFS / PNG 编码复用仓库 unity-bundle.mjs / tomoe.mjs 的实现；公共字符串偏移是 Unity 文件格式常量（亦见 AssetStudio/CommonString.cs），不依赖这些项目的运行环境。

## 验证

```sh
node --test scripts/dev/gal-download-selftest.mjs scripts/dev/gal-download-native-selftest.mjs
# 使用已有本地样本，不下载测试资源：
GAL_TSK_SAMPLE_BUNDLE=/path/to/0000d4b46602cbae91e473ef0e25bbe1.bundle node --test scripts/dev/gal-download-native-selftest.mjs
GAL_TSK_APK=/path/to/twinklestarknightsx-01.03.14-206.apk node --test scripts/dev/gal-download-native-selftest.mjs
```
