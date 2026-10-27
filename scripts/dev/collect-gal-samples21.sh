#!/usr/bin/env bash
# 第二十一轮样本：TSK 的立绘站位 / 缩放在 Unity 场景和代码里（第 20 轮确认：level2 = 剧情场景，里面有 Chara1~4 这些 RectTransform，坐标是二进制）。
# 这轮把这几个文件原样复制出来（只复制，不脱敏——它们是引擎的场景和程序集，里面没有剧情文本）：
#   <游戏名>_Data/level*（≤ 5MB，剧情场景在里面）、sharedassets*.assets（≤ 5MB）、globalgamemanagers 不要
#   <游戏名>_Data/Managed/ 下的 Assembly-CSharp*.dll、Utage*.dll、spine-unity.dll（≤ 40MB；Mono 打包的，能反编译出站位和缩放的代码）
# 输出 ./gal-samples21.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples21.sh；目录名不对就 TSK=
BASE="${BASE:-.}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
OUTDIR="${OUTDIR:-$PWD}"
[ -d "$TSK" ] || { echo "没找到目录：TSK = $TSK（用 TSK= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples21.tar.gz}"
DATA="$(find "$TSK" -maxdepth 1 -type d -name '*_Data' | head -1)"
[ -n "$DATA" ] || { echo "没找到 *_Data 目录"; exit 1; }
mkdir -p "$STAGE/data" "$STAGE/managed"
n=0
while IFS= read -r f; do cp "$f" "$STAGE/data/" && n=$((n+1)); done < <(find "$DATA" -maxdepth 1 -type f \( -name 'level*' -o -name 'sharedassets*.assets' \) ! -name '*.resS' -size -5120k)
while IFS= read -r f; do cp "$f" "$STAGE/managed/" && n=$((n+1)); done < <(find "$DATA/Managed" -maxdepth 1 -type f \( -name 'Assembly-CSharp*.dll' -o -name 'Utage*.dll' -o -name 'spine-unity.dll' \) -size -40960k 2>/dev/null)
ls -l "$STAGE/data" "$STAGE/managed" > "$STAGE/_files.txt"
echo "复制 $n 个文件"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)）——把这个文件发给我"
