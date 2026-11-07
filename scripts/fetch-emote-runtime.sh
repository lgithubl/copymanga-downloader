#!/bin/sh
# 下载 FreeMote SDK 的 WebGL 引擎（E-mote 3.9 编成 WebGL）到 web/static/vendor/，给 Gal 播放器播放 E-mote 立绘用（Artemis「妹(姉)は兄(弟)の性癖を歪ませたい！」这类 image/fg/*.psb）。
#   FreeMoteDriver.js  引擎（emscripten）    emoteplayer.js  JS 封装（EmotePlayer 类）
# 来源：https://github.com/Project-AZUSA/FreeMote-SDK （固定提交，校验哈希）。许可证：二进制 / js 是 CC BY-NC-SA 4.0（非商用），源码 LGPLv3——所以不放进仓库，构建镜像 / 本地开发时下载。
#   商用 / 对外分发前请自己确认许可证；只在内网自用时不涉及。没下载到 = 播放器自动用静态立绘（config / 「更多」里的 E-mote 开关不起作用）。
#   sh scripts/fetch-emote-runtime.sh [目标目录，默认 web/static/vendor]
set -eu
DIR="${1:-$(dirname "$0")/../web/static/vendor}"
mkdir -p "$DIR"
SHA=4340e8fc2138f013157d5b9cd40ba17d01347093
fetch() {
  name="$1"; sum="$2"
  curl -fsSL --retry 3 -m 120 "https://raw.githubusercontent.com/Project-AZUSA/FreeMote-SDK/$SHA/WebGL/driver/$name" -o "$DIR/$name.tmp"
  echo "$sum  $DIR/$name.tmp" | sha256sum -c - >/dev/null || { rm -f "$DIR/$name.tmp"; echo "$name 校验失败" >&2; exit 1; }
  mv "$DIR/$name.tmp" "$DIR/$name"
  echo "$name (FreeMote-SDK $SHA) -> $DIR"
}
fetch FreeMoteDriver.js 64a38cbc4722ee90d58a7d0d464fe121d1a6453acda21c3fca99712c220d0641
fetch emoteplayer.js 807e5c6a4d58d99c1e876f4155dd73d096ef92a5650c1c2a314be665dfdb9eba
