#!/bin/sh
# 下载 Spine 的官方 Web 运行时（spine-webgl）到 web/static/vendor/，给 Gal 播放器渲染 Spine 骨骼动画用。四个版本，按骨骼文件里的版本号选：
#   spine-webgl-3.6.js   3.6.x （spine-runtimes 3.6 分支固定提交的 spine-ts/build；只有 SkeletonJson，二进制 .skel 由 web/static/gal-spine36-binary.js 转成 JSON 再读）
#   spine-webgl.js       3.8   （spine-runtimes 固定提交的 spine-ts/build）
#   spine-webgl-4.0.js   4.0.x （npm @esotericsoftware/spine-webgl@4.0.31 的 dist/iife）
#   spine-webgl-4.2.js   4.2.x （npm @esotericsoftware/spine-webgl@4.2.100 的 dist/iife）
# 运行时受 Esoteric Software 的许可证约束（Spine Runtimes License），所以不放进仓库，构建镜像 / 本地开发时按固定版本下载并校验哈希。
#   sh scripts/fetch-spine-runtime.sh [目标目录，默认 web/static/vendor]
set -eu
DIR="${1:-$(dirname "$0")/../web/static/vendor}"
mkdir -p "$DIR"

SHA=8b4844bd4b193ba9e54487ed397a777993cbad56
SUM=4b108bad314c152bf0ff7a7f56fce5c98073f05a2bfa53e880d6c24b6f7c3aa5
curl -fsSL --retry 3 -m 120 "https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/$SHA/spine-ts/build/spine-webgl.js" -o "$DIR/spine-webgl.js.tmp"
echo "$SUM  $DIR/spine-webgl.js.tmp" | sha256sum -c - >/dev/null || { rm -f "$DIR/spine-webgl.js.tmp"; echo "spine-webgl.js 校验失败" >&2; exit 1; }
mv "$DIR/spine-webgl.js.tmp" "$DIR/spine-webgl.js"
echo "spine-webgl.js (3.8, $SHA) -> $DIR"

# 3.6：同一个仓库的 3.6 分支（提交 = 分支末端，2019-05-13）。官方 3.6 的 spine-ts 没有 SkeletonBinary（3.7 才有），所以二进制骨骼走 gal-spine36-binary.js
SHA36=654c20e5b0e523040b6366bbd1042510d2645134
SUM36=2883daee81ae60b25f6205b83feb82b76812bf63cfdf0886f04f390b12891794
curl -fsSL --retry 3 -m 120 "https://raw.githubusercontent.com/EsotericSoftware/spine-runtimes/$SHA36/spine-ts/build/spine-webgl.js" -o "$DIR/spine-webgl-3.6.js.tmp"
echo "$SUM36  $DIR/spine-webgl-3.6.js.tmp" | sha256sum -c - >/dev/null || { rm -f "$DIR/spine-webgl-3.6.js.tmp"; echo "spine-webgl-3.6.js 校验失败" >&2; exit 1; }
mv "$DIR/spine-webgl-3.6.js.tmp" "$DIR/spine-webgl-3.6.js"
echo "spine-webgl-3.6.js (3.6, $SHA36) -> $DIR"

# npm 包：下载 tarball，取出 dist/iife/spine-webgl.js，校验哈希
fetch_npm() {
  version="$1"; sum="$2"; out="$3"
  curl -fsSL --retry 3 -m 120 "https://registry.npmjs.org/@esotericsoftware/spine-webgl/-/spine-webgl-$version.tgz" | tar xzO package/dist/iife/spine-webgl.js > "$DIR/$out.tmp"
  echo "$sum  $DIR/$out.tmp" | sha256sum -c - >/dev/null || { rm -f "$DIR/$out.tmp"; echo "$out 校验失败" >&2; exit 1; }
  mv "$DIR/$out.tmp" "$DIR/$out"
  echo "$out ($version) -> $DIR"
}
fetch_npm 4.0.31 d82e2c32d2fbe2d47d461da5b8dd3b9daac1fbfeda74e6476114d5d70619185a spine-webgl-4.0.js
fetch_npm 4.2.100 ed59374359cf9217a87723124f5e87665492b06dae04a7b5e83af0fd18b12db2 spine-webgl-4.2.js
