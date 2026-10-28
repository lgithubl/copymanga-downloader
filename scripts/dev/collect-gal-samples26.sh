#!/usr/bin/env bash
# 第二十六轮样本：Otogi Frontier R 的图片目录（角色卡片 / 脚本卡片完全没有缩略图——目录里有什么图、叫什么、多大，现在没有任何清单）。
#   游戏根目录的顶层清单 + 每个子目录（typeadv/* 、*/image* 等，最多两层）的文件数、前 30 个文件的 名字 / 大小 / 宽高（png / jpg / webp 读文件头，不复制图片）
#   + list.json 的结构摘要（每个键的类型和前 3 项）
# 输出 ./gal-samples26.tar.gz（默认），发给我。用法：BASE=/游戏父目录 bash collect-gal-samples26.sh；目录名不对就 OTOGI=
BASE="${BASE:-.}"
: "${OTOGI:=$BASE/Otogi Frontier R}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
[ -d "$OTOGI" ] || { echo "没找到目录：OTOGI = $OTOGI（用 OTOGI= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples26.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import json, os, re, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
root, stage = sys.argv[1], sys.argv[2]
os.makedirs(stage, exist_ok=True)
def dims(p):
    try:
        b = open(p, 'rb').read(65536)
        if b[:8] == b'\x89PNG\r\n\x1a\n': return '%dx%d png' % struct.unpack('>II', b[16:24])
        if b[:2] == b'\xff\xd8':
            i = 2
            while i < len(b) - 9:
                if b[i] != 0xFF: i += 1; continue
                if b[i + 1] in (0xC0, 0xC1, 0xC2): h, w = struct.unpack('>HH', b[i + 5:i + 9]); return '%dx%d jpg' % (w, h)
                i += 2 + struct.unpack('>H', b[i + 2:i + 4])[0]
        if b[:4] == b'RIFF' and b[8:12] == b'WEBP' and b[12:16] == b'VP8X': return '%dx%d webp' % (1 + int.from_bytes(b[24:27], 'little'), 1 + int.from_bytes(b[27:30], 'little'))
    except Exception: pass
    return ''
with open(os.path.join(stage, '_top.tsv'), 'w', encoding='utf-8') as f:
    for x in sorted(os.listdir(root)):
        p = os.path.join(root, x); f.write('%s\t%s\t%d\n' % (mask(x), 'dir' if os.path.isdir(p) else 'file', len(os.listdir(p)) if os.path.isdir(p) else os.path.getsize(p)))
out = open(os.path.join(stage, '_dirs.txt'), 'w', encoding='utf-8')
def scan(d, depth):
    names = sorted(os.listdir(d))
    files = [n for n in names if os.path.isfile(os.path.join(d, n))]
    subs = [n for n in names if os.path.isdir(os.path.join(d, n))]
    out.write('## %s  （文件 %d 个，子目录 %d 个）\n' % (mask(os.path.relpath(d, root)), len(files), len(subs)))
    for n in files[:30]: out.write('   %s\t%d\t%s\n' % (mask(n), os.path.getsize(os.path.join(d, n)), dims(os.path.join(d, n))))
    if subs: out.write('   子目录前 15：%s\n' % mask(', '.join(subs[:15])))
    if depth < 2:
        for n in subs[:25]: scan(os.path.join(d, n), depth + 1)
scan(root, 0)
out.close()
lj = os.path.join(root, 'list.json')
if os.path.isfile(lj):
    try:
        d = json.load(open(lj, encoding='utf-8'))
        with open(os.path.join(stage, '_list_json.txt'), 'w', encoding='utf-8') as f:
            for k, v in d.items():
                f.write('## %s  %s  %s\n' % (k, type(v).__name__, len(v) if hasattr(v, '__len__') else ''))
                items = list(v.items())[:3] if isinstance(v, dict) else v[:3] if isinstance(v, list) else [v]
                for it in items: f.write('   %s\n' % mask(json.dumps(it, ensure_ascii=False)[:400]))
    except Exception as e: open(os.path.join(stage, '_list_json.txt'), 'w').write(str(e))
PYEOF
echo "收集时间：$(date '+%F %T')    OTOGI=$OTOGI" > "$STAGE/_info.txt"
"$PY" "$HELPER" "$OTOGI" "$STAGE/otogi"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)）——把这个文件发给我"
