# ddd / DeepOne 采集与下载分析

记录日期：2026-11-15。以下是实际采集、静态分析和接口测试结果；尚未实现正式 DeepOne 清单更新任务，也未执行全量资源下载。

## 结论

`ddd` 是 DeepOneRE 离线剧情播放器和配套资源下载工具。现有资源 JSON 可以转换为我们的 `gal-download` 的 `files` provider 清单，播放侧已有 `deepone` 布局和 `uviewer-csv` adapter，无需引入原工具的 Python、pygame、OpenCV 运行时。

NAS 已通过无登录信息的 CDN 样本下载验证；包内旧 OAuth 凭据未能获取新 JSON。已有清单能用于后续受限下载试验，但不能称为完整、自动更新的资源库。

## 原始采集与清单覆盖

采集目录为 `gal/[G]/[]/ddd`。完整采集了两个源文件，共 72,874,732 字节，逐文件 SHA256 核对通过；没有运行包里的 EXE。

| 源文件 | 字节数 | 内容 |
| --- | ---: | --- |
| `ddd.zip` | 69,741,575 | DeepOne.exe、file_download.exe、json.zip、设置和字体等；未附 do_main.py |
| `allcgr18 scenes HACK.zip` | 3,133,157 | Python 辅助脚本、故事 ID 列表、json.rar 等 |

| 清单统计 | 数量 |
| --- | ---: |
| json.zip 内资源清单 | 944 |
| json.rar 内资源清单 | 1,553 |
| 合并去重清单文件名 | 1,555 |
| 合并唯一 storyId | 1,417 |
| 资源引用 | 82,784 |
| 去重资源 | 76,668 |
| MP3 / JPG / TXT / MP4 | 64,642 / 9,339 / 1,557 / 1,130 |

两份资源包中同名清单一致，未发现同一逻辑文件名对应不同 hash 的冲突。另有三个 `stories` JSON，最大一份含 4,257 个故事 ID；它们是账号故事状态列表，不是包含 CDN 路径的资源清单，也不能证明资源覆盖完整。

这些 JSON 都是静态快照，不会自己更新。清单没有 size，不能仅按文件数估算总下载体积。MP4 资源的存在也不代表每个场景都有动态演出。

## CDN 规则与访问实测

原下载辅助脚本按以下规则构造 URL，扩展名来自 `fileName`：

```text
https://tonofura-r-cdn-resource.deepone-online.com/deep_one/download_adv/{path}/{md5}.{extension}
```

普通资源 GET 未携带 Cookie 或 OAuth。清单中的 `md5` 用作 URL 标识；其是否也是响应内容的 MD5 尚未确认，不能直接当作已验证的内容校验值。

对相同 URL 的配对测试如下（2026-11-15）：

| 样本 | 本地 Mac | TrueNAS |
| --- | --- | --- |
| 剧情 TXT | 403 AccessDenied | 206，返回有效文本片段 |
| 语音 MP3 | 403 AccessDenied | 206，返回有效 MP3 文件头 |
| 预览 PNG | 403 AccessDenied | 206，返回有效 PNG 文件头 |
| 未带鉴权的 getResource | 401 OAuth | 401 OAuth |

NAS 使用小范围 Range 请求，无登录头；测试时未配置环境代理。本地 CloudFront 节点为 LAX54-P7，NAS 为 KIX82-P1。确认了线路 / CDN 节点差异，尚不能据此认定必须使用日本 IP，或所有资源都可以下载。加入浏览器 Origin、Referer 等请求头没有解决本地 403。

## 包内鉴权与获取新 JSON 的测试

辅助脚本中包含应用及账号相关字段 `consumer_key`、`consumer_secret`、`token`、`token_secret`、`user_id`。此 README 不保存其值，原始采集文件保留在本地。

用户授权后，以包内签名逻辑构造 OAuth HMAC-SHA256，只读取一个故事 `10010204` 的资源清单：

```text
POST https://tonofura-web-r.deepone-online.com/deep-one/api/story/getResource
{"storyIds":"10010204","adult":1}
```

| 请求方式 | HTTP | 实际结果 |
| --- | ---: | --- |
| 包内版本头 1.234.0 | 200 | `{"status":99994,"err":"pc update"}`，不是资源清单 |
| 公开示例版本头 1.276.0 | 200 | 同样返回 pc update；该版本也不是已确认的当前版本 |
| 不带版本头，保留 OAuth | 401 | `oauth_problem="token_rejected"` |

实际测试时间为北京时间 2026-11-15 18:00–18:02。没有获取到新的资源 JSON。可以确认测试中的旧 token 被拒绝，但不能仅据此区分过期、撤销或其他会话问题；版本校验的当前要求也尚未确认。后续要使用有效且获授权的游戏会话，并确认当前客户端版本，才能继续验证清单读取。

包内还有调用 `addStory` 的脚本，会修改账号剧情状态；没有执行。没有执行解锁操作，也没有批量枚举接口。

## 可复用方案与验证边界

- 将现有资源清单转换为 `files` provider 的 URL → target 项；`targetDir` 使用 `resources`，target 保留 `download/...` 逻辑路径，避免按场景重复存放共享资源。
- 使用现有 Node 下载器的 plan、dryRun、limit、缓存、重试和原子写入，不沿用辅助脚本的直接写最终文件方式。
- 原辅助脚本仅凭存在就 skip，未设明确超时，失败重试后仍可能打印完成，还附带翻译下载；这些行为不适合作为正式任务直接运行。
- 已生成 76,668 项离线转换草稿；用四类样本跑过现有下载器 dryRun，结果 completed、4 个 would-download、0 次网络请求。该验证不等于实际全量下载或浏览器导入通过。
- 已有 `deepone` 导入预设和 `uviewer-csv` adapter。正式接入时仍需实际下载、目录布局及播放验证，不能只凭转换成功判断可用。

上游参考：[Lisanjin/DeepOneRE](https://github.com/Lisanjin/DeepOneRE)。对比过的上游源码支持可选代理、超时和重试；上面的旧辅助脚本缺陷不应套用到所有上游版本。

## 本地证据位置

以下路径相对仓库根目录，位于本地 `.cache`，未随本 README 纳入版本管理。原始采集含凭据，不要直接上传或复制到公开日志。

| 路径 | 内容 |
| --- | --- |
| `.cache/ddd-analysis/ddd-full.tar.gz` | 完整采集归档 |
| `.cache/ddd-analysis/extracted/g01/files/` | 两个原始 ZIP |
| `.cache/ddd-analysis/expanded/` | 静态展开文件，含原始辅助脚本 |
| `.cache/ddd-analysis/combined-audit.json` | 合并资源统计 |
| `.cache/ddd-analysis/analysis-report.json` | 初步分析；鉴权部分由本 README 及下列 auth-probe 结果补充更新 |
| `.cache/ddd-analysis/files-provider-draft.json` | 全量转换草稿 |
| `.cache/ddd-analysis/files-provider-sample.json` | 四类样本 |
| `.cache/ddd-analysis/plan-dryrun/proof.json` | dryRun 结果 |
| `.cache/ddd-analysis/access-conditions/nas-probe.json` | NAS 访问结果 |
| `.cache/ddd-analysis/access-conditions/conclusion.json` | 本地 / NAS 对照 |
| `.cache/ddd-analysis/auth-probe/results.json` | 脱敏后的三次鉴权测试结果 |

## 相关 Release 清理记录

private-scripts 的采集 Release `31` 曾达到 997 个附件，上传遇到 1,000 个附件限制。已将 181 个旧附件与本地备份逐项 SHA256 核对后移除远端副本，释放 1,283,619,315 字节；本地备份保留在 `.cache/release31-cleanup/archive/`，清理明细在同级 `summary.json`、`cleanup-results.jsonl`。镜像构建 Release 未清理。
