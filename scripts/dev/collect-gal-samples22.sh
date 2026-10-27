#!/usr/bin/env bash
# 第二十二轮样本：ぼくら的原版播放器。目录里的 bokusen_main.exe 是 PyInstaller 打包的 pygame 程序（README：bokusen-pygame），
# 里面是 Python 字节码——能还原出 move / se:N / playbgm 等命令的真实写法（现在这些全是猜的）。
# 只复制这几个文件（原样，不脱敏）：bokusen_main.exe（约 17MB）、README.md、requirements.txt、settings.json、error_list.txt
# 输出 ./gal-samples22.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples22.sh；目录名不对就 BOKUSEN=
BASE="${BASE:-.}"
: "${BOKUSEN:=$BASE/ぼくらの放課後戦争}"
OUTDIR="${OUTDIR:-$PWD}"
[ -d "$BOKUSEN" ] || { echo "没找到目录：BOKUSEN = $BOKUSEN（用 BOKUSEN= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples22.tar.gz}"
n=0
for f in bokusen_main.exe README.md requirements.txt settings.json error_list.txt; do [ -f "$BOKUSEN/$f" ] && cp "$BOKUSEN/$f" "$STAGE/" && n=$((n+1)); done
ls -l "$STAGE" > "$STAGE/_files.txt"
echo "复制 $n 个文件"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)）——把这个文件发给我"
