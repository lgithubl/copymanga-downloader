# 常驻采集启动器2.0

更新本机 `gal-collect.sh` 一次，原来的同目录 `gh`、`github_pat` 和命令继续使用：

```bash
bash gal-collect.sh .
```

默认检查远端 `vibe-test-20261008` 的 `scripts/dev/gal-collect-run.sh`，下载并校验脚本类型、VERSION、内容SHA256及bash语法。最后成功的内容SHA未改变则跳过；内容改变即执行，包含忘记增加VERSION的修改。每轮完成/失败后休息180秒，再检查最新版。正在执行的任务结束或超时后才开始下一轮。

## 本地offset与输出

默认位于**启动脚本旁边**的 `cache/gal-collect/`，不依赖当前工作目录，不放/tmp：

```text
cache/gal-collect/
  logs/bootstrap-<启动时间>.log
  tasks/<任务ID>/
    offset.json          最后全部成功的版本/SHA/时间
    pending.json         上传失败待重传的分卷
    last-attempt.json    最近一次检查结果
    last-fetch.sh        最近校验成功的核心脚本
    runs/<唯一执行ID>/   脚本快照、独立日志、采集输出、归档
    errors/              启动/执行错误日志
```

只有核心脚本返回0，或本地待上传分卷全部重传成功，才原子更新offset。采集失败、获取失败、校验失败、超时都保留旧offset，下轮重试；重启仍读取原offset。任务ID区分来源、真实游戏根目录及有效采集参数；令牌和参数原文不写入状态，只保存配置摘要。改变轮询/超时参数不触发重采。

退出码2且有完整失败分卷清单时，下轮优先重传这些文件，不重扫游戏。已有更新的远端脚本时执行新版本，旧文件仍保留本地。若待传文件被手动移走，下轮重新采集，不把不存在的文件记为成功。

同一来源/游戏根目录有本地进程锁；不会并行运行两套循环。Ctrl+C/SIGTERM终止当前命令及其子进程组，不推进offset。没有新增运行时：使用原本采集就需要的python3标准库、bash与已有gh。

## 配置

```bash
GAL_COLLECT_POLL_SECONDS=180 \
GAL_COLLECT_FETCH_TIMEOUT=120 \
GAL_COLLECT_RUN_TIMEOUT=3600 \
GAL_COLLECT_UPLOAD_TIMEOUT=600 \
GAL_COLLECT_STOP_GRACE_SECONDS=15 \
bash gal-collect.sh .
```

全部单位为秒，需大于0。`RUN_TIMEOUT`包括采集、打包、上传的总时间，超时先TERM，等待宽限后KILL；单次上传另有独立超时。获取/执行/上传错误会记录本地并尝试有超时限制的错误日志上传，随后继续循环。core1.67的真实文件读取错误也返回失败，不推进offset。

- `GAL_COLLECT_CACHE_DIR=/本地持久目录`：改变cache位置；保留该目录才能跨重启继续。
- `GAL_COLLECT_ONCE=1`：只检查/执行一轮，仍遵守已有offset。
- `GAL_COLLECT_FORCE=1`：即使版本完成过也强制执行一次，成功后恢复正常跳过；失败继续重试。
- 原有 `GAL_COLLECT_TSK_LOG`、`GAL_COLLECT_RULES` 等继续传给核心脚本。TSK日志开关仍优先于规则。
- `GAL_COLLECT_OUT`、`GAL_COLLECT_TS` 由启动器按每轮唯一目录生成，避免循环覆盖前一轮文件。
- 令牌文件每轮重新读入；轮换令牌无需重启循环。

例如手动重新采一次相同版本的最近3次TSK日志：

```bash
GAL_COLLECT_ONCE=1 GAL_COLLECT_FORCE=1 GAL_COLLECT_TSK_LOG=3 bash gal-collect.sh .
```

不直接删除文件；成功分卷和临时文件移入本轮cache归档。offset、失败分卷和日志保留本地。启动器缺失必要参数、配置值无效、cache无法建立或同任务已运行，会明确退出；运行期间的采集/网络失败继续循环。
