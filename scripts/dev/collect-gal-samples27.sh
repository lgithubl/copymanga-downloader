#!/usr/bin/env bash
# 第二十七轮样本：Otogi 的角色头像到底在哪（第 26 轮的清单只列到两层）。
#   icon/chara/icon、icon/chara/standimage、chara/homestand/<前 3 个>、chara/still/<前 3 个 + 210011>、typeadv/CharaStand/Adventure、ui/home、ui/still 的目录结构（最多再往下 3 层）
#   每个目录：文件数 + 前 25 个 名字 / 大小 / 宽高（读文件头，不复制图片）；另外 list.json 里 "list" 前 3 项、"bgimg" 前 3 项的原样（脱敏）
# 输出 ./gal-samples27.tar.gz（默认）。用法：BASE=/游戏父目录 bash collect-gal-samples27.sh；目录名不对就 OTOGI=
BASE="${BASE:-.}"
: "${OTOGI:=$BASE/Otogi Frontier R}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
[ -d "$OTOGI" ] || { echo "没找到目录：OTOGI = $OTOGI（用 OTOGI= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples27.tar.gz}"
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
    except Exception: pass
    return ''
out = open(os.path.join(stage, '_dirs.txt'), 'w', encoding='utf-8')
def scan(d, depth, pick=3):
    if not os.path.isdir(d): out.write('## %s  （不存在）\n' % mask(os.path.relpath(d, root))); return
    names = sorted(os.listdir(d))
    files = [n for n in names if os.path.isfile(os.path.join(d, n))]
    subs = [n for n in names if os.path.isdir(os.path.join(d, n))]
    out.write('## %s  （文件 %d 个，子目录 %d 个）\n' % (mask(os.path.relpath(d, root)), len(files), len(subs)))
    for n in files[:25]: out.write('   %s\t%d\t%s\n' % (mask(n), os.path.getsize(os.path.join(d, n)), dims(os.path.join(d, n))))
    if subs: out.write('   子目录前 12：%s\n' % mask(', '.join(subs[:12])))
    if depth < 3:
        for n in subs[:pick]: scan(os.path.join(d, n), depth + 1, pick)
for rel in ('icon/chara/icon', 'icon/chara/standimage', 'chara/homestand', 'chara/still', 'typeadv/CharaStand/Adventure', 'ui/home', 'ui/still'):
    scan(os.path.join(root, rel), 0)
for rel in ('chara/still/210011', 'chara/still/1200051', 'chara/homestand/106411'):
    scan(os.path.join(root, rel), 1)
out.close()
lj = os.path.join(root, 'list.json')
try:
    d = json.load(open(lj, encoding='utf-8'))
    with open(os.path.join(stage, '_list_json.txt'), 'w', encoding='utf-8') as f:
        for k in ('list', 'bgimg'):
            v = d.get(k)
            items = list(v.items())[:3] if isinstance(v, dict) else (v or [])[:3]
            f.write('## %s\n' % k)
            for it in items: f.write('   %s\n' % mask(json.dumps(it, ensure_ascii=False)[:500]))
except Exception as e: open(os.path.join(stage, '_list_json.txt'), 'w').write(str(e))
PYEOF
echo "收集时间：$(date '+%F %T')    OTOGI=$OTOGI" > "$STAGE/_info.txt"
"$PY" "$HELPER" "$OTOGI" "$STAGE/otogi"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)）——把这个文件发给我"
