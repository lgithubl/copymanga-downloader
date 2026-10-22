#!/bin/sh
# 下载 Spine 3.8 的官方 Web 运行时（spine-webgl）到 web/static/vendor/，给 Gal 播放器渲染 Spine 骨骼动画用。
# 运行时受 Esoteric Software 的许可证约束（Spine Runtimes License），所以不放进仓库，构建镜像 / 本地开发时按固定提交下载并校验哈希。
#   sh scripts/fetch-spine-runtime.sh [目标目录，默认 web/static/vendor]
set -eu
SHA=8b4844bd4b193ba9e54487ed397a777993cbad56
SUM=4b108bad314c152bf0ff7a7f56fce5c98073f05a2bfa53e880d6c24b6f7c3aa5
DIR="${1:-$(dirname "$0")/../web/static/vendor}"
mkdir -p "$DIR"
curl -fsSL --retry 3 -m 120 "https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/$SHA/spine-ts/build/spine-webgl.js" -o "$DIR/spine-webgl.js.tmp"
echo "$SUM  $DIR/spine-webgl.js.tmp" | sha256sum -c - >/dev/null || { rm -f "$DIR/spine-webgl.js.tmp"; echo "spine-webgl.js 校验失败" >&2; exit 1; }
mv "$DIR/spine-webgl.js.tmp" "$DIR/spine-webgl.js"
echo "spine-webgl.js (3.8, $SHA) -> $DIR"
