#!/usr/bin/env bash
# 第二十九轮样本：TSK 静态画面（BgEvent）图集图片，核对「atlas 声明 2048×2048、PNG 2048×2003」这种尺寸对不上的情况怎么贴：
#   A st_1091002 的 PNG 原样复制（≈2.7MB）+ atlas / skel（上一轮没带 PNG）
#   B 全部 Stills 里「PNG 尺寸 ≠ atlas 声明尺寸」的目录：列出（目录 / 声明 / 实际），其中前 3 个的 PNG + atlas 也复制（每张 ≤ 6MB）
#   C st_1091002 PNG 的块结构（IHDR / 颜色类型 / 位深 / 有没有 tEXt、pHYs 之类的附加块——判断是不是被工具缩放 / 裁剪过）
# 输出 ./gal-samples29.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples29.sh；目录名不对就 TSK=
BASE="${BASE:-.}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
[ -d "$TSK" ] || { echo "没找到目录：TSK = $TSK（用 TSK= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples29.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import os, re, shutil, struct, sys
root, stage = sys.argv[1], sys.argv[2]
os.makedirs(stage, exist_ok=True)
stills = [d for d, ds, fs in os.walk(root) if os.path.basename(d) == 'Stills' and any(x.startswith('st_') for x in ds)]
if not stills:
    open(os.path.join(stage, '_error.txt'), 'w').write('没找到 Stills 目录\n'); sys.exit(0)
stills = stills[0]
def png_size(p):
    try:
        b = open(p, 'rb').read(64)
        if b[:8] == b'\x89PNG\r\n\x1a\n': return struct.unpack('>II', b[16:24])
    except Exception: pass
    return None
def atlas_size(p):
    try:
        t = open(p, encoding='utf-8', errors='ignore').read()
        m = re.search(r'^size:\s*(\d+)\s*,\s*(\d+)', t, re.M)
        return (int(m.group(1)), int(m.group(2))) if m else None
    except Exception: return None
bad = []
for n in sorted(os.listdir(stills)):
    d = os.path.join(stills, n)
    if not os.path.isdir(d): continue
    for f in sorted(os.listdir(d)):
        if f.endswith('.png'):
            a = atlas_size(os.path.join(d, f[:-4] + '.atlas.txt'))
            s = png_size(os.path.join(d, f))
            if a and s and (a[0], a[1]) != s: bad.append((n, f, a, s))
with open(os.path.join(stage, '_size_mismatch.tsv'), 'w', encoding='utf-8') as f:
    f.write('目录\t文件\tatlas声明\t实际PNG\n')
    for n, fn, a, s in bad: f.write('%s\t%s\t%dx%d\t%dx%d\n' % (n, fn, a[0], a[1], s[0], s[1]))
def copy(n):
    d = os.path.join(stills, n)
    if not os.path.isdir(d): return
    out = os.path.join(stage, 'stills', n); os.makedirs(out, exist_ok=True)
    for f in os.listdir(d):
        p = os.path.join(d, f)
        if os.path.isfile(p) and os.path.getsize(p) <= 6 * 1024 * 1024: shutil.copy2(p, out)
names = ['st_1091002'] + [b[0] for b in bad if b[0] != 'st_1091002'][:3]
for n in names: copy(n)
# PNG 块结构
p = os.path.join(stills, 'st_1091002', 'st_1091002.png')
with open(os.path.join(stage, '_st_1091002_png_chunks.txt'), 'w', encoding='utf-8') as out:
    try:
        b = open(p, 'rb').read()
        i = 8
        while i + 8 <= len(b):
            ln, typ = struct.unpack('>I4s', b[i:i + 8]); typ = typ.decode('latin1')
            body = b[i + 8:i + 8 + ln]
            extra = ''
            if typ == 'IHDR': extra = 'w=%d h=%d depth=%d colortype=%d interlace=%d' % struct.unpack('>IIBBxxB', body[:13])
            elif typ in ('tEXt', 'iTXt', 'zTXt'): extra = body[:120].decode('latin1', 'replace')
            elif typ == 'pHYs': extra = '%d x %d unit=%d' % struct.unpack('>IIB', body[:9])
            if typ != 'IDAT' or 'IDAT' not in out.name: out.write('%s %d %s\n' % (typ, ln, extra))
            i += 12 + ln
    except Exception as e: out.write('读取失败 %r\n' % (e,))
PYEOF
"$PY" -I "$HELPER" "$TSK" "$STAGE"
tar -czf "$OUT" -C "$STAGE" . && echo "已生成：$OUT（$(du -h "$OUT" | cut -f1)）"
