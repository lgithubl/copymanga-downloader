#!/usr/bin/env bash
# 第二十五轮样本：maid（スイートホームメイド）story1010063 / story1070043 的立绘「粗糙、边缘锯齿」。
#   原因可能是贴图本身分辨率低（cast006001 的图集只声明 961×424），也可能是我们的渲染（缩放 / 过滤 / 预乘）。要真实贴图才能判断：
#   两个场景的 script.txt、脚本里引用的 SPINE_ACTOR 骨架（data/spine/cast/<目录>/ 下 json / atlas / png 原样复制，每个目录 ≤ 8MB）。
# 输出 ./gal-samples25.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples25.sh；目录名不对就 MAID=
BASE="${BASE:-.}"
: "${MAID:=$BASE/スイートホームメイド}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
[ -d "$MAID" ] || { echo "没找到目录：MAID = $MAID（用 MAID= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples25.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import os, re, shutil, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
root, stage = sys.argv[1], sys.argv[2]
os.makedirs(stage, exist_ok=True)
nw = os.path.join(root, 'package.nw') if os.path.isdir(os.path.join(root, 'package.nw')) else root
def dims(p):
    try:
        b = open(p, 'rb').read(64)
        if b[:8] == b'\x89PNG\r\n\x1a\n': return '%dx%d' % struct.unpack('>II', b[16:24])
    except Exception: pass
    return ''
casts = set()
for sid in ('story1010063', 'story1070043'):
    d = os.path.join(nw, 'scenes', sid)
    if not os.path.isdir(d): open(os.path.join(stage, '_missing_%s.txt' % sid), 'w').write('没有这个场景目录'); continue
    raw = open(os.path.join(d, 'script.txt'), 'rb').read()
    for enc in ('utf-8-sig', 'cp932'):
        try: text = raw.decode(enc); break
        except Exception: text = ''
    os.makedirs(os.path.join(stage, sid), exist_ok=True)
    open(os.path.join(stage, sid, 'script.txt'), 'w', encoding='utf-8').write(mask(text))
    for p in os.listdir(d):
        if os.path.isdir(os.path.join(d, p)):
            with open(os.path.join(stage, sid, '_dir_%s.tsv' % p), 'w', encoding='utf-8') as f:
                for q in sorted(os.listdir(os.path.join(d, p))): f.write('%s\t%d\t%s\n' % (mask(q), os.path.getsize(os.path.join(d, p, q)), dims(os.path.join(d, p, q))))
    for m in re.finditer(r'<SPINE_ACTOR>[^,]*,([^,]+),', text): casts.add(m.group(1).strip())
open(os.path.join(stage, '_casts.txt'), 'w', encoding='utf-8').write('\n'.join(sorted(casts)))
for c in sorted(casts):
    base = c.split('/')[0]
    d = os.path.join(nw, 'data', 'spine', 'cast', base)
    if not os.path.isdir(d): d = os.path.join(nw, 'scenes', 'story1010063', 'spines', base)
    if not os.path.isdir(d): continue
    for q in sorted(os.listdir(d)):
        p = os.path.join(d, q)
        if os.path.isfile(p) and os.path.getsize(p) <= 8 * 1024 * 1024:
            dst = os.path.join(stage, 'cast', base, q); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copyfile(p, dst)
PYEOF
echo "收集时间：$(date '+%F %T')    MAID=$MAID" > "$STAGE/_info.txt"
"$PY" "$HELPER" "$MAID" "$STAGE/maid"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)）——把这个文件发给我"
