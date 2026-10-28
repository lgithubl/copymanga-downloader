#!/usr/bin/env bash
# 第二十八轮样本：魔法学园「没有声音」——手上没有一个「有语音的脚本 + 它的语音目录」的完整对照，没法重现。
#   1) 有语音的脚本原样复制（文本，脱敏）：hscripts/AKUKAGUYA/*.json、episode_scripts/VANESSA_ep5/*.json、episode_scripts/MAY_ep4/*.json
#   2) 对应的语音目录的完整文件名清单：AKUKAGUYA_ca1_00 / AKUKAGUYA_ca1_h2、VANESSA_h、VANESSA_00、MAY_h、MAY_00（名字 / 大小）+ 每个脚本 voices 字段里出现的全部语音名（去重）在磁盘上哪些存在、哪些不存在
#   3) game/audio/voice 下所有名字不带 _ca / _ev 的目录（AMANDA_00 … AMANDA_h 这种）各列前 8 个文件名
# 输出 ./gal-samples28.tar.gz（默认）。用法：BASE=/游戏父目录 bash collect-gal-samples28.sh；目录名不对就 ARTWHIRL=
BASE="${BASE:-.}"
: "${ARTWHIRL:=$BASE/魔法学园的少女们}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
[ -d "$ARTWHIRL" ] || { echo "没找到目录：ARTWHIRL = $ARTWHIRL（用 ARTWHIRL= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUTDIR}/gal-samples28.tar.gz"
cat > "$HELPER" <<'PYEOF'
import json, os, re, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
root, stage = sys.argv[1], sys.argv[2]
game = os.path.join(root, 'game') if os.path.isdir(os.path.join(root, 'game')) else root
os.makedirs(stage, exist_ok=True)
vd = os.path.join(game, 'audio', 'voice')
def dec(raw):
    for enc in ('utf-8-sig', 'cp932'):
        try: return raw.decode(enc)
        except Exception: pass
    return raw.decode('latin-1')
report = open(os.path.join(stage, '_report.txt'), 'w', encoding='utf-8')
picks = []
for sub in ('hscripts/AKUKAGUYA', 'episode_scripts/VANESSA_ep5', 'episode_scripts/MAY_ep4'):
    d = os.path.join(game, *sub.split('/'))
    if os.path.isdir(d): picks += [os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith('.json')]
for p in picks:
    raw = open(p, 'rb').read()
    rel = os.path.relpath(p, game)
    dst = os.path.join(stage, 'scripts', rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'w', encoding='utf-8').write(mask(dec(raw)))
    try: data = json.loads(dec(raw))
    except Exception: continue
    names = sorted({v for v in (data.get('voices') or []) if isinstance(v, str)})
    stem = os.path.splitext(os.path.basename(p))[0]
    report.write('## %s  voices 字段里不同的语音名 %d 个\n' % (rel, len(names)))
    found = 0
    for n in names:
        base = re.sub(r'\.mp3$', '.ogg', n, flags=re.I)
        hits = []
        for d, ds, fs in os.walk(vd):
            if base in fs: hits.append(os.path.relpath(os.path.join(d, base), vd))
        report.write('   %s -> %s\n' % (mask(n), hits[:3] if hits else '磁盘上没有'))
        found += bool(hits)
    report.write('   存在 %d / %d\n\n' % (found, len(names)))
for name in ('AKUKAGUYA_ca1_00', 'AKUKAGUYA_ca1_h2', 'VANESSA_h', 'VANESSA_00', 'MAY_h', 'MAY_00'):
    d = os.path.join(vd, name)
    with open(os.path.join(stage, 'voicedir_%s.tsv' % name), 'w', encoding='utf-8') as f:
        if not os.path.isdir(d): f.write('(目录不存在)\n'); continue
        for n in sorted(os.listdir(d)): f.write('%s\t%d\n' % (mask(n), os.path.getsize(os.path.join(d, n))))
with open(os.path.join(stage, '_other_voice_dirs.txt'), 'w', encoding='utf-8') as f:
    for n in sorted(os.listdir(vd)):
        p = os.path.join(vd, n)
        if os.path.isdir(p) and not re.search(r'_(ca\d+|ev\d+)_', n): f.write('## %s（%d 个）%s\n' % (mask(n), len(os.listdir(p)), mask(', '.join(sorted(os.listdir(p))[:8]))))
report.close()
PYEOF
echo "收集时间：$(date '+%F %T')    ARTWHIRL=$ARTWHIRL" > "$STAGE/_info.txt"
"$PY" "$HELPER" "$ARTWHIRL" "$STAGE/artwhirl"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)）——把这个文件发给我"
