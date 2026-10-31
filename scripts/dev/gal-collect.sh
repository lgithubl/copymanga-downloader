#!/usr/bin/env bash
# Gal 样本采集（启动脚本）：一条命令做完——取实际脚本 → 采集 → 分卷打包 → 用 gh 上传到 release；出错也把日志打包上传。
#
# 用法（和 gh、密钥文件放在同一个目录）：
#   GAL_ROOT=/游戏库目录 bash gal-collect.sh            # 或 bash gal-collect.sh /游戏库目录
# 同目录要有：
#   gh                      GitHub CLI 的 linux/amd64 二进制（或 gh-linux-amd64.tar.gz：没有 gh 时自动解开）
#   github_pat              存令牌的文件（只有这一个文件有令牌；也可以用环境变量 GH_TOKEN_FILE 指到别处）
# 令牌只在这个进程里放进 GH_TOKEN 环境变量给 gh 用，不打印、不写进日志、不进上传的包。
#
# 环境变量（都有默认值）：
#   GH_TOKEN_FILE            令牌文件，默认 <脚本目录>/github_pat
#   GAL_COLLECT_SRC_REPO     实际脚本在哪个仓库，默认 lgithubl/copymanga-downloader
#   GAL_COLLECT_SRC_REF      分支 / tag，默认 vibe-test-20261008
#   GAL_COLLECT_SRC_PATH     脚本路径，默认 scripts/dev/gal-collect-run.sh
#   GAL_COLLECT_SHA256       设了就校验实际脚本的 sha256，对不上就不执行（防止来源被改）
#   其余 GAL_COLLECT_*（REPO / TAG / PART_MB / DRYRUN / ONLY …）原样传给实际脚本，说明见 gal-collect-run.sh 开头
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
LOG="$DIR/gal-collect-bootstrap-$TS.log"
exec > >(tee -a "$LOG") 2>&1
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

GH="$DIR/gh"
TOKEN_FILE="${GH_TOKEN_FILE:-$DIR/github_pat}"
SRC_REPO="${GAL_COLLECT_SRC_REPO:-lgithubl/copymanga-downloader}"
SRC_REF="${GAL_COLLECT_SRC_REF:-vibe-test-20261008}"
SRC_PATH="${GAL_COLLECT_SRC_PATH:-scripts/dev/gal-collect-run.sh}"
TAG="${GAL_COLLECT_TAG:-31}"
REPO="${GAL_COLLECT_REPO:-lgithubl/private-scripts}"
TMP="$(mktemp -d)"
RUN_STARTED=0

upload_error_log() { # 启动阶段的错误：把本脚本的日志压缩上传（实际脚本自己出错会传它自己的出错包）
  [ -x "$GH" ] && [ -n "${GH_TOKEN:-}" ] || { log "没法上传出错日志（缺 gh 或令牌），日志在 $LOG"; return 0; }
  local f="$TMP/gal-collect-bootstrap-$TS-ERROR.log.gz"
  sed "s/$(printf '%s' "$GH_TOKEN" | sed 's/[][\\.*^$/]/\\&/g')/***/g" "$LOG" | gzip -c > "$f"
  "$GH" release upload "$TAG" "$f" --repo "$REPO" --clobber && log "出错日志已上传：$(basename "$f")" || log "出错日志没传上去，日志在 $LOG"
}
on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ]; then
    log "失败（退出码 $rc）"
    # 退出码 2 = 有分卷没传上去（文件留在本地，上传本来就有问题，不再重复传）；其余（含实际脚本自己出错，它已经传过它的出错包）这里再传一份启动脚本的日志
    if [ "$rc" -ne 2 ]; then upload_error_log; fi
  fi
  rm -rf "$TMP"
  exit "$rc"
}
trap on_exit EXIT

log "gal-collect 启动脚本  目录=$DIR"
# 1) gh
if [ ! -x "$GH" ] && [ -f "$DIR/gh-linux-amd64.tar.gz" ]; then
  tar -xzf "$DIR/gh-linux-amd64.tar.gz" -C "$DIR" gh && chmod +x "$GH" && log "已从 gh-linux-amd64.tar.gz 解出 gh"
fi
[ -x "$GH" ] || { log "同目录没有可执行的 gh（也没有 gh-linux-amd64.tar.gz）"; exit 1; }
# 2) 令牌：从文件读进环境变量（不回显）
[ -r "$TOKEN_FILE" ] || { log "读不了令牌文件：$TOKEN_FILE（用 GH_TOKEN_FILE 指定）"; exit 1; }
GH_TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
[ -n "$GH_TOKEN" ] || { log "令牌文件是空的：$TOKEN_FILE"; exit 1; }
export GH_TOKEN GH_PROMPT_DISABLED=1 GH_NO_UPDATE_NOTIFIER=1 GH_NO_EXTENSION_AUTO_INSTALL=1
"$GH" --version | head -1
"$GH" api user --jq .login >/dev/null 2>&1 || { log "令牌不可用（gh api user 失败）"; exit 1; }
# 3) 取实际脚本
log "取实际脚本：$SRC_REPO@$SRC_REF:$SRC_PATH"
"$GH" api -H "Accept: application/vnd.github.raw" "repos/$SRC_REPO/contents/$SRC_PATH?ref=$SRC_REF" > "$TMP/run.sh" || { log "取脚本失败"; exit 1; }
[ -s "$TMP/run.sh" ] || { log "取到的脚本是空的"; exit 1; }
SUM="$(sha256sum "$TMP/run.sh" | cut -d' ' -f1)"
log "实际脚本 sha256=$SUM（$(wc -l < "$TMP/run.sh") 行）"
if [ -n "${GAL_COLLECT_SHA256:-}" ] && [ "$GAL_COLLECT_SHA256" != "$SUM" ]; then log "sha256 对不上（期望 $GAL_COLLECT_SHA256），不执行"; exit 1; fi
head -1 "$TMP/run.sh" | grep -q '^#!.*bash' || { log "实际脚本第一行不是 bash 脚本，不执行"; exit 1; }
# 4) 执行
export GAL_COLLECT_TS="$TS" GAL_COLLECT_TAG="$TAG" GAL_COLLECT_REPO="$REPO" GAL_COLLECT_GH="$GH"
RUN_STARTED=1
bash "$TMP/run.sh" "$@"
exit $?
