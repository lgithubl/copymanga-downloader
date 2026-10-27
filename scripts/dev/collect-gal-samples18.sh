#!/usr/bin/env bash
# 第十八轮样本：Twinkle Star Knights X（TSK）的骨骼渲染（立绘位置 / 缩放 / 骨骼文件）。之前一直没采这块，立绘位置全是推的。
#   1) Adventure/Spine、Characters/ch_*：目录清单 + atlas / json（文本）+ .skel 原样复制（只取 ch_1001001 / ch_1091002 / ch_1002001 + 每种目录形状各 1 个）+ 贴图宽高
#   2) 所有「不是剧情」的 *.book.json（Master / Settings / Character / Layout / Param 表，Utage 的立绘站位和缩放在这里）全文（脱敏）
#   3) 3 个用了立绘的剧情 book.json 全文（CharaScenario1091002 / MainScenario 里最大的 / 最小的各一）+ Adventure、StreamingAssets 根目录的小文本
#   4) 所有包含 pivot / scale / layout / position 字样的小 json / txt / xml（文件名清单 + 全文，≤300KB）
# 输出 ./gal-samples18.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples18.sh        （目录名不对：TSK=/路径/Twinkle\ Star\ Knights\ X）
#   只读原目录；只在 TSK 目录里找；不复制音频、视频、图片（图片只列名字 / 大小 / 宽高）；.skel 骨骼是二进制，原样复制（每个不超过 3MB，最多 12 个）；文本里连续 3 个以上的中日文字符会被替换成 <N字>。
BASE="${BASE:-.}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
[ -d "$TSK" ] || { echo "没找到目录：TSK = $TSK（用 TSK= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples18.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import collections, os, re, shutil, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
TEXT = {'.txt', '.json', '.atlas', '.xml', '.csv', '.tsv', '.yaml', '.yml', '.ini', '.cfg', '.plist', ''}
LIMIT = 3 * 1024 * 1024
def dec(raw):
    for enc in ('utf-8-sig', 'utf-16', 'cp932', 'gb18030'):
        try: return raw.decode(enc)
        except Exception: pass
    return raw.decode('latin-1')
def put(src, dst):
    if os.path.splitext(src)[1].lower() not in TEXT: return None
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'w', encoding='utf-8').write(mask(dec(open(src, 'rb').read(LIMIT)))); return 'txt'
def walk(root):
    for d, ds, fs in os.walk(root):
        for f in fs: yield os.path.join(d, f)
def dims(p):
    try:
        b = open(p, 'rb').read(200000)
        if b[:8] == b'\x89PNG\r\n\x1a\n': return struct.unpack('>II', b[16:24])
    except Exception: pass
    return None
root, stage = sys.argv[1], sys.argv[2]
os.makedirs(stage, exist_ok=True)
rel = lambda p: os.path.relpath(p, root)
def listing(files, out, with_dims=True):
    with open(os.path.join(stage, out), 'w', encoding='utf-8') as f:
        for p in files:
            wh = dims(p) if with_dims and p.lower().endswith('.png') else None
            f.write('%s\t%d\t%s\n' % (mask(rel(p)), os.path.getsize(p), ('%dx%d' % wh) if wh else ''))
adv = [d for d, ds, fs in os.walk(root) if os.path.basename(d) == 'Adventure' and 'NAME.txt' in fs]
adv = adv[0] if adv else None
chars = [d for d, ds, fs in os.walk(root) if os.path.basename(d) == 'Characters' and any(x.startswith('ch_') for x in ds)]
chars = chars[0] if chars else None
print('  Adventure=%s  Characters=%s' % (adv, chars))
bins = 0
def take_dir(d, tag):
    global bins
    for p in sorted(walk(d)):
        if put(p, os.path.join(stage, 'dirs', tag, rel(p))): continue
        if p.lower().endswith(('.skel', '.bytes', '.skeleton')) and os.path.getsize(p) <= LIMIT and bins < 12:
            os.makedirs(os.path.dirname(os.path.join(stage, 'dirs', tag, rel(p))), exist_ok=True); shutil.copyfile(p, os.path.join(stage, 'dirs', tag, rel(p))); bins += 1
# 1) 骨骼目录
if chars:
    names = sorted(x for x in os.listdir(chars) if x.startswith('ch_'))
    open(os.path.join(stage, '_characters_dirs.txt'), 'w', encoding='utf-8').write('%d 个\n%s' % (len(names), '\n'.join(names)))
    shapes = collections.defaultdict(list)
    for n in names: shapes[tuple(sorted(os.path.splitext(f)[1].lower() for f in os.listdir(os.path.join(chars, n))))].append(n)
    pick = [n for n in ('ch_1001001', 'ch_1091002', 'ch_1002001') if n in names] + [v[0] for v in shapes.values()]
    for n in dict.fromkeys(pick):
        d = os.path.join(chars, n); listing(sorted(walk(d)), 'char_%s.tsv' % n); take_dir(d, 'characters/' + n)
if adv:
    sp = os.path.join(adv, 'Spine')
    if os.path.isdir(sp):
        listing(sorted(walk(sp))[:3000], '_adventure_spine.tsv')
        sub = sorted(x for x in os.listdir(sp) if os.path.isdir(os.path.join(sp, x)))
        for n in sub[:6]: take_dir(os.path.join(sp, n), 'adventure_spine/' + n)
    tx = os.path.join(adv, 'Textures')
    if os.path.isdir(tx): listing(sorted(walk(tx))[:3000], '_adventure_textures.tsv')
# 2) 非剧情的 book.json（Master / Settings / Layout …）
scen = ('CharaScenario', 'MainScenario', 'StoryEventScenario', 'HomeEventScenario', 'ItemEventScenario', 'SpEventScenario', 'BossrushEventScenario', 'SubjugationEventScenario')
books = [p for p in walk(root) if p.endswith('.book.json')]
other = [p for p in books if not any(s in p for s in scen)]
listing(sorted(other), '_non_scenario_books.tsv', False)
for p in other:
    if os.path.getsize(p) <= LIMIT: put(p, os.path.join(stage, 'books', rel(p)))
print('  非剧情 book.json %d 个' % len(other))
# 3) 剧情样例
want = [p for p in books if os.path.basename(p) == 'CharaScenario1091002.book.json']
main = sorted((p for p in books if 'MainScenario' in p), key=os.path.getsize)
if main: want += [main[0], main[-1]]
for p in want: put(p, os.path.join(stage, 'scenarios', rel(p)))
if adv:
    for f in os.listdir(adv):
        p = os.path.join(adv, f)
        if os.path.isfile(p) and os.path.getsize(p) <= 300 * 1024: put(p, os.path.join(stage, 'adventure_root', f))
base = os.path.dirname(adv) if adv else root
for f in os.listdir(base):
    p = os.path.join(base, f)
    if os.path.isfile(p) and os.path.getsize(p) <= 300 * 1024: put(p, os.path.join(stage, 'streaming_root', f))
# 4) 含 pivot / scale / layout / position 字样的小文本
hits = open(os.path.join(stage, '_keyword_files.tsv'), 'w', encoding='utf-8'); n = 0
for p in walk(root):
    if os.path.splitext(p)[1].lower() not in ('.json', '.txt', '.xml', '.csv', '.tsv') or p.endswith('.book.json') or os.path.getsize(p) > 300 * 1024: continue
    try: raw = open(p, 'rb').read()
    except Exception: continue
    if re.search(rb'(?i)pivot|layout|scale|position', raw):
        hits.write('%s\t%d\n' % (mask(rel(p)), len(raw))); n += 1
        if n <= 80: put(p, os.path.join(stage, 'keyword_files', rel(p)))
hits.close(); print('  含关键字的小文本 %d 个（前 80 个复制全文）' % n)
PYEOF
echo "收集时间：$(date '+%F %T')    TSK=$TSK" > "$STAGE/_info.txt"
"$PY" "$HELPER" "$TSK" "$STAGE/tsk"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)，$(tar -tzf "$OUT" | wc -l) 项）——把这个文件发给我"
