#!/usr/bin/env bash
# 第二十三轮样本：Aku No Onna Kanbu 的 CG（EV 图）。c32190202 里全是 <EV> 图，第 5 句起「全模糊」：
#   原版 preloader 用 sceneImageData.js 的底图先画底图再叠差分图（已修）；这轮要这些图本身的信息，确认叠上去以后还糊不糊：
#   每张图的 名字 / 大小 / 宽高 / 是否带透明通道（webp / png / jpg 都读头，不复制图片本体），以及 c32190202 的 script_original.json、img.txt 之类的小文本。
#   范围：c32190202、c31000802，加上 sceneImageData.js 里出现过的前 12 个场景（每个场景 images/ 全列）。
# 输出 ./gal-samples23.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples23.sh；目录名不对就 AKU=
BASE="${BASE:-.}"
: "${AKU:=$BASE/Aku No Onna Kanbu - Perigee New Moon Viewer}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
[ -d "$AKU" ] || { echo "没找到目录：AKU = $AKU（用 AKU= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples23.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import os, re, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
root, stage = sys.argv[1], sys.argv[2]
os.makedirs(stage, exist_ok=True)
def info(p):
    try:
        b = open(p, 'rb').read(65536)
        if b[:8] == b'\x89PNG\r\n\x1a\n':
            w, h = struct.unpack('>II', b[16:24]); ct = b[25]
            return '%dx%d png colortype=%d alpha=%s' % (w, h, ct, 'yes' if ct in (4, 6) else 'no(tRNS?)' if b'tRNS' in b else 'no')
        if b[:2] == b'\xff\xd8':
            i = 2
            while i < len(b) - 9:
                if b[i] != 0xFF: i += 1; continue
                if b[i + 1] in (0xC0, 0xC1, 0xC2): h, w = struct.unpack('>HH', b[i + 5:i + 9]); return '%dx%d jpg alpha=no' % (w, h)
                i += 2 + struct.unpack('>H', b[i + 2:i + 4])[0]
        if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
            kind = b[12:16]
            if kind == b'VP8X': return '%dx%d webp VP8X alpha=%s' % (1 + int.from_bytes(b[24:27], 'little'), 1 + int.from_bytes(b[27:30], 'little'), 'yes' if b[20] & 0x10 else 'no')
            if kind == b'VP8 ': w, h = struct.unpack('<HH', b[26:30]); return '%dx%d webp VP8 alpha=no' % (w & 0x3fff, h & 0x3fff)
            if kind == b'VP8L':
                v = int.from_bytes(b[21:25], 'little'); return '%dx%d webp VP8L alpha=%s' % ((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1, 'maybe(lossless)')
    except Exception: pass
    return ''
scenes_dir = None
for cand in (os.path.join(root, 'package.nw', 'scenes'), os.path.join(root, 'scenes')):
    if os.path.isdir(cand): scenes_dir = cand
if not scenes_dir: open(os.path.join(stage, '_note.txt'), 'w').write('没找到 scenes 目录'); sys.exit()
want = ['c32190202', 'c31000802']
for cand in (os.path.join(root, 'package.nw', 'data', 'scripts', 'data', 'sceneImageData.js'), os.path.join(root, 'data', 'scripts', 'data', 'sceneImageData.js')):
    if os.path.isfile(cand):
        for m in re.finditer(r'scenes/([^/"]+)/images/', open(cand, encoding='utf-8', errors='replace').read()):
            if m.group(1) not in want: want.append(m.group(1))
            if len(want) >= 14: break
        break
for sid in want:
    d = os.path.join(scenes_dir, sid)
    if not os.path.isdir(d): continue
    with open(os.path.join(stage, 'scene_%s.tsv' % sid), 'w', encoding='utf-8') as f:
        for dp, ds, fs in os.walk(d):
            for name in sorted(fs):
                p = os.path.join(dp, name)
                f.write('%s\t%d\t%s\n' % (mask(os.path.relpath(p, d)), os.path.getsize(p), info(p)))
    for name in os.listdir(d):
        p = os.path.join(d, name)
        if os.path.isfile(p) and os.path.splitext(name)[1].lower() in ('.txt', '.json') and os.path.getsize(p) <= 3 * 1024 * 1024:
            raw = open(p, 'rb').read()
            for enc in ('utf-8-sig', 'cp932'):
                try: text = raw.decode(enc); break
                except Exception: text = raw.decode('latin-1')
            os.makedirs(os.path.join(stage, 'text', sid), exist_ok=True)
            open(os.path.join(stage, 'text', sid, name), 'w', encoding='utf-8').write(mask(text))
print('  场景 %d 个' % len(want))
PYEOF
echo "收集时间：$(date '+%F %T')    AKU=$AKU" > "$STAGE/_info.txt"
"$PY" "$HELPER" "$AKU" "$STAGE/aku"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)）——把这个文件发给我"
