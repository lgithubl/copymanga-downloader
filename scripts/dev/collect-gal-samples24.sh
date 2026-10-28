#!/usr/bin/env bash
# 第二十四轮样本：TSK 的静态画面（BgEvent）和剩下的几处缺口：
#   A Stills/<id>/ 目录：全部 st_* 目录的文件清单（名字 / 大小 / 图片宽高）；st_1091002 和另外 6 个目录的 atlas / skel.bytes（原样复制，skel 是二进制）
#      —— CharaScenario1091002 第 250 步左右的 BgEvent（st_1091002，cut_1 / cut_2_loop …）骨骼渲染不对，原版 ProcessBgEventAnimation 只读 Stills/<id>/<id> 这一个骨架，要核对目录里到底有几个
#   B 缺的背景人声 b0912_033_000075 ~ 77：在整个 TSK 目录里按文件名找（有没有、在哪个目录），再列 Sound/BgVoice 下的目录名和个数
#   C 背景图层素材：bg_adv_019_1_front / bg_adv_019_2_front（Sprite 命令，BgParts 层）和 BE_001 的文件名 / 大小 / 宽高
# 输出 ./gal-samples24.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples24.sh；目录名不对就 TSK=
BASE="${BASE:-.}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
[ -d "$TSK" ] || { echo "没找到目录：TSK = $TSK（用 TSK= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples24.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import os, re, shutil, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
root, stage = sys.argv[1], sys.argv[2]
os.makedirs(stage, exist_ok=True)
rel = lambda p: os.path.relpath(p, root)
def dims(p):
    try:
        b = open(p, 'rb').read(200000)
        if b[:8] == b'\x89PNG\r\n\x1a\n': return '%dx%d' % struct.unpack('>II', b[16:24])
    except Exception: pass
    return ''
def walk(top):
    for d, ds, fs in os.walk(top):
        for f in fs: yield os.path.join(d, f)
stills = [d for d, ds, fs in os.walk(root) if os.path.basename(d) == 'Stills' and any(x.startswith('st_') for x in ds)]
stills = stills[0] if stills else None
if stills:
    names = sorted(x for x in os.listdir(stills) if os.path.isdir(os.path.join(stills, x)))
    with open(os.path.join(stage, '_stills.tsv'), 'w', encoding='utf-8') as f:
        for n in names:
            for p in sorted(walk(os.path.join(stills, n))): f.write('%s\t%d\t%s\n' % (mask(rel(p)), os.path.getsize(p), dims(p)))
    pick = (['st_1091002'] if 'st_1091002' in names else []) + [n for n in names if n != 'st_1091002'][:6]
    for n in pick:
        for p in walk(os.path.join(stills, n)):
            if p.endswith(('.atlas.txt', '.skel.bytes')) and os.path.getsize(p) <= 3 * 1024 * 1024:
                dst = os.path.join(stage, 'stills', n, os.path.basename(p)); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copyfile(p, dst)
hits = [rel(p) for p in walk(root) if re.search(r'b0912_033_0000(?:7[0-9])', os.path.basename(p))]
open(os.path.join(stage, '_bgvoice_b0912.txt'), 'w', encoding='utf-8').write('b0912_033_0000[70-79] 在 TSK 目录里的位置：\n' + '\n'.join(mask(h) for h in hits) + ('' if hits else '（一个都没找到）') + '\n')
for d, ds, fs in os.walk(root):
    if d.replace(os.sep, '/').endswith('Sound/BgVoice'):
        with open(os.path.join(stage, '_bgvoice_dirs.txt'), 'w', encoding='utf-8') as f:
            for x in sorted(ds): f.write('%s\t%d\n' % (mask(x), len(os.listdir(os.path.join(d, x)))))
            f.write('根下文件 %d 个，前 40：%s\n' % (len(fs), ', '.join(mask(x) for x in sorted(fs)[:40])))
with open(os.path.join(stage, '_bg_parts.tsv'), 'w', encoding='utf-8') as f:
    for p in sorted(walk(root)):
        b = os.path.basename(p)
        if re.match(r'(?:bg_adv_019_[12]|BE_00[123])', b): f.write('%s\t%d\t%s\n' % (mask(rel(p)), os.path.getsize(p), dims(p)))
PYEOF
echo "收集时间：$(date '+%F %T')    TSK=$TSK" > "$STAGE/_info.txt"
"$PY" "$HELPER" "$TSK" "$STAGE/tsk"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)）——把这个文件发给我"
