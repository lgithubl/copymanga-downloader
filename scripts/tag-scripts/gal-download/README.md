# Gal 数据下载 / 本地采集（纯 Node，v2.0.1）

只请求已生成 plan 中的游戏数据 URL。不安装或下载解释器、依赖、工具、类型数据库或 APK。
dryRun:true 全程无网络请求。服务端、Dockerfile、package.json 无改动，只更新 tag 脚本包。

## 配置：所有下载选项归 task

```json
{
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
      "actions": ["download", "extract", "verify"],
      "source": {"type": "apk", "path": "/data/packages/base.apk"},
      "include": ["scenario", "image", "spine", "voice"]
    }
  ]
}
```

- tasks 按顺序执行，每项独立管理 dryRun、logPrefix、downloadLimit、concurrency、runTimeoutMs、plan、日志和进度。
- adapters 必填且非空，至少一项必须出现在当前媒体的 item.adapters 中；game 若配置也必须匹配 config.game.id。不匹配直接 skip，不扫描、不下载。
- id 应保持不变且唯一，用于寻找本 task 的 plan；省略时使用 task-<数组下标>，调整任务顺序后可能找不到原 plan。
- 上层只保留 tasks 和宿主技术参数 scriptTimeoutMs（默认 1560000）。v1 的顶层 dryRun 等配置需移入各 task，不做静默继承。
- TSK 默认使用 gal-layout 的 config.resourceRoots[0] 作为目标目录，否则使用 source.path；task.targetDir 可指定媒体内相对目录。

## 两阶段流程

1. dryRun:true：解析本地 APK/catalog，按目录快照对比目标文件，保存**完整 plan**。
2. 确认日志后，仅把该 task.dryRun 改为 false：读取本 task 的已有 plan，重新检查目标文件，存在就 skip，缺失才下载、解包、校验、原子写入。

正式执行不再解压 APK 或重新生成资源目录，只检查源文件路径/大小/mtime 和关键配置是否一致。
没有 plan、源文件变化、目标目录/adapters/game/include/source 等关键配置变化时明确报错，要求先重新 dryRun:true。
修改 downloadLimit、concurrency、logPrefix、dryRun 不使 plan 失效。
存在的文件一律 skip-existing 并逐路径记入日志，包括本工具以前生成的文件；不会自行覆盖或修复已有文件。需要补某个文件时，先自行将它移动到别处，再执行已有 plan。

- downloadLimit 为本次最多下载的唯一 bundle/文件 URL 数，0 不限。它**不截断 plan**；缓存命中不占额度，依赖未到齐时不导出残缺资源。
- concurrency 为下载并发 1–8；依赖下载结束后逐 bundle 解包。
- 下载流写 cache/bundles/*.part，校验大小/可选 SHA256/UnityFS 头后 rename 成缓存文件。
- 解包在线程中完成，主任务再次检查目标存在性，在目标目录写临时文件再 rename。已完成的文件在下一次执行时直接 skip，下载缓存可复用。
- plan 保留全量映射，执行结果和完整列表写入本次 result.json；缺依赖/limit 截断为 partial，错误为 failed。
- 同一媒体独占锁。进程异常终止遗留 lock-* 时，确认无运行任务后将它移动到 /tmp/，不要直接删除。
- 清理临时文件、释放锁和测试目录统一移动到 /tmp/gal-download-archive/，跨文件系统使用已有 mv 命令。

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

查看最新 tsk 日志（容器内）：

```sh
GDL_LOG=$(find /data/cache/library/tag-script-cache/gal-download/runs -path '*/tsk-debug-*/run.log' | sort | tail -n 1)
tail -f "$GDL_LOG"
```

runTimeoutMs 每 task 默认 1500000；总运行时间受宿主 scriptTimeoutMs 限制，临近总截止时不再启动后续 task。

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
APK 读取使用镜像原有 unzip，非 OGG 音频使用原有 ffmpeg（只允许 pipe 协议）。缺工具或不支持格式时失败并保留缓存。

支持 UnityFS 未压缩/LZ4/LZMA，SerializedFile v17–22 包内 type tree，TextAsset 骨架/atlas，Utage book/master JSON，Alpha8/RGB24/RGBA32/ARGB32/BGRA32 和非旋转矩形 Sprite → PNG。
暂不支持 ASTC/ETC/BC 压缩纹理、外部 SpriteAtlas/旋转 Sprite、缺少 type tree 的剧情对象，以及 APK 内置 bundle 导出。
活动 banner_id、游戏内 mod、机翻不在范围内；不为这些功能额外联网。

UnityFS/PNG 代码复用仓库实现，公共字符串偏移是 Unity 文件格式常量，不依赖外部项目运行环境。

## 验证

```sh
node --test scripts/dev/gal-download*selftest.mjs
GAL_TSK_APK=/path/to/base.apk GAL_TSK_SAMPLE_BUNDLE=/path/to/sample.bundle node --test scripts/dev/gal-download*selftest.mjs
```

性能回归覆盖缺失目录的实际 fs 调用数；日志回归在下载未完成时读取 run.log 和 progress.json。
本机同一真实 APK 的完整 dryRun 从约 159 秒降到约 9.2 秒；这是本机空目标目录的数据，不代表所有存储设备的耗时。
