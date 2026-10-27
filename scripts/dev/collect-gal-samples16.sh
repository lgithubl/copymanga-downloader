#!/usr/bin/env bash
# 第十六轮样本（补第十五轮的缺口，一次跑完；cp 关键脚本 / 小文本工具 / 文件清单，文本脱敏，最后打成 tar.gz）：
#   ぼくら（resource/ 下 502704 的目录）/ Grenze（easy_dialog-2.xml 的 <DEFINE> 节点）/ GC 系列（全部 hmr_* hsr_* 行式脚本的「命令骨架」+ readme / scenesChanged / sceneData）/
#   迷雾列车（cast006001 + story1010063）/ TSK（Adventure 的名称表 / 章节表 / story map，Sprites 目录）/
#   每个游戏根目录的小文本和脚本（.py .bat .cmd .ps1 .sh .md .txt .json .js .html，≤ 300KB，深度 ≤ 2；就是你说的「解析脚本之类」）+ 根目录文件清单
# 输出 ./gal-samples16.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples16.sh
#   个别目录用变量覆盖：KAMIHIME= ANGELIC= ARTWHIRL= BOKUSEN= GRENZE= TSK= TRAIN= DEEPONE=；GC 系列用 GCFAM="目录1:目录2:…"；还要多扫别的目录就 EXTRA="目录1:目录2"。
#   只读原目录；只在这些游戏目录里找（不扫 BASE）；不复制音频、视频、图片（只列文件名 / 大小 / 图片宽高）；文本里连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。单个文件超过 3MB 只取前 3MB。
BASE="${BASE:-.}"
: "${KAMIHIME:=$BASE/Kamihime_Player- 1.0}"
: "${ANGELIC:=$BASE/angelic_py-1.0.2-pc}"
: "${ARTWHIRL:=$BASE/魔法学园的少女们}"
: "${BOKUSEN:=$BASE/ぼくらの放課後戦争}"
: "${GRENZE:=$BASE/GrenzeViewer}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
: "${TRAIN:=$BASE/迷雾列车少女[12.1G]}"
: "${DEEPONE:=$BASE/deeponecgv20260801}"
: "${GCFAM:=$BASE/Angelica Aster R Viewer:$BASE/Girls Creation R Viewer:$BASE/Girls Creation R Viewer 282寝:$BASE/スイートホームメイド:$BASE/邪神戦記ルルイエ少女隊 X　〜クトゥルフ神話TD〜Viewer}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples16.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import collections, json, os, re, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
TEXT = {'.txt', '.json', '.rpy', '.ks', '.csv', '.xml', '.atlas', '.plist', '.js', '.html', '.htm', '.css', '.tsv', '.yaml', '.yml', '.ini', '.cfg', '.py', '.sh', '.bat', '.cmd', '.ps1', '.md', ''}
LIMIT = 3 * 1024 * 1024
SKIP = {'node_modules', 'Python27', 'renpy', 'saves', 'cache', 'locales', 'runtime', 'scenes', 'lib', 'python-packages'}
def dec(raw):
    for enc in ('utf-8-sig', 'utf-16', 'cp932', 'gb18030'):
        try: return raw.decode(enc)
        except Exception: pass
    return raw.decode('latin-1')
def put(src, dst):
    if os.path.splitext(src)[1].lower() not in TEXT: return None
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'w', encoding='utf-8').write(mask(dec(open(src, 'rb').read(LIMIT)))); return 'txt'
def walk(root, skip=SKIP):
    for d, ds, fs in os.walk(root):
        ds[:] = [x for x in ds if x not in skip]
        for f in fs: yield os.path.join(d, f)
def dims(p):
    try:
        b = open(p, 'rb').read(200000)
        if b[:8] == b'\x89PNG\r\n\x1a\n': return struct.unpack('>II', b[16:24])
        if b[:2] == b'\xff\xd8':
            i = 2
            while i < len(b) - 9:
                if b[i] != 0xFF: i += 1; continue
                if b[i + 1] in (0xC0, 0xC1, 0xC2): h, w = struct.unpack('>HH', b[i + 5:i + 9]); return (w, h)
                i += 2 + struct.unpack('>H', b[i + 2:i + 4])[0]
    except Exception: pass
    return None
def listing(root, files, out, with_dims=False, limit=100000):
    n = 0
    with open(out, 'w', encoding='utf-8') as f:
        for p in files:
            wh = dims(p) if with_dims and p.lower().endswith(('.png', '.jpg', '.jpeg')) else None
            f.write('%s\t%d\t%s\n' % (mask(os.path.relpath(p, root)), os.path.getsize(p), ('%dx%d' % wh) if wh else '')); n += 1
            if n >= limit: break
rel = lambda p: os.path.relpath(p, root)
mode, root, stage = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(stage, exist_ok=True)

if mode == 'rootinfo':   # 游戏根目录：顶层清单 + 小文本 / 脚本（解析工具、readme、配置）
    with open(os.path.join(stage, '_top.tsv'), 'w', encoding='utf-8') as f:
        for x in sorted(os.listdir(root)):
            p = os.path.join(root, x); f.write('%s\t%s\t%d\n' % (mask(x), 'dir' if os.path.isdir(p) else 'file', os.path.getsize(p) if os.path.isfile(p) else len(os.listdir(p))))
    n = 0
    for p in walk(root):
        depth = p[len(root):].count(os.sep)   # 1 = 根目录下的文件
        ext = os.path.splitext(p)[1].lower()
        code = ext in ('.py', '.bat', '.cmd', '.ps1', '.sh', '.md', '.js', '.html', '.htm')   # 脚本 / 说明：深度 ≤ 3
        data = ext in ('.txt', '.json', '.xml', '.cfg', '.ini')                                # 数据 / 配置：只要根目录和下一层（别把几千个剧情 json 都拷进来）
        if ((code and depth <= 3) or (data and depth <= 2)) and os.path.getsize(p) <= 300 * 1024 and not os.path.basename(p).startswith('._'):
            if put(p, os.path.join(stage, 'files', rel(p))): n += 1
        if n >= 200: break
    print('  小文本 / 脚本 %d 个' % n)
elif mode == 'bokusen':
    res = os.path.join(root, 'resource')
    if not os.path.isdir(res): open(os.path.join(stage, '_note.txt'), 'w').write('没有 resource 目录'); sys.exit()
    names = sorted(os.listdir(res))
    open(os.path.join(stage, '_resource_dirs.tsv'), 'w', encoding='utf-8').write('资源目录共 %d 个\n' % len(names) + '\n'.join(mask(n) for n in names))
    hits = [n for n in names if '502704' in n]
    open(os.path.join(stage, '_hits_502704.txt'), 'w', encoding='utf-8').write('名字里含 502704 的资源目录：%s\n' % [mask(n) for n in hits])
    for n in hits[:3]:
        d = os.path.join(res, n); listing(root, sorted(p for p in walk(d, set())), os.path.join(stage, '_files_%d.tsv' % hits.index(n)), with_dims=True, limit=3000)
    # 脚本名 → 有没有同名资源目录（全部脚本）
    js = sorted(x[:-5] for x in os.listdir(os.path.join(root, 'json')) if x.endswith('.json')) if os.path.isdir(os.path.join(root, 'json')) else []
    miss = [mask(s) for s in js if s not in names]
    open(os.path.join(stage, '_scripts_without_resource_dir.txt'), 'w', encoding='utf-8').write('脚本 %d 个，没有同名资源目录的 %d 个（前 200）：\n%s\n' % (len(js), len(miss), '\n'.join(miss[:200])))
    # 资源目录里的子目录形状
    shapes = collections.Counter()
    for n in names[:300]:
        d = os.path.join(res, n)
        if os.path.isdir(d): shapes[tuple(sorted(os.listdir(d)))[:6]] += 1
    open(os.path.join(stage, '_resource_dir_shapes.txt'), 'w', encoding='utf-8').write('\n'.join('%5d  %s' % (c, k) for k, c in shapes.most_common(15)))
elif mode == 'grenze':
    xmls = [p for p in walk(root, {'node_modules', 'runtime'}) if re.fullmatch(r'easy_dialog-\d+\.xml', os.path.basename(p))]
    xmls.sort()
    out = open(os.path.join(stage, '_defines.txt'), 'w', encoding='utf-8')
    for p in xmls[:6] + [x for x in xmls if x.endswith('easy_dialog-2.xml')][:1]:
        text = dec(open(p, 'rb').read(LIMIT))
        nodes = re.findall(r'<DEFINE\b[^>]*?/?>', text)
        out.write('## %s  （<DEFINE> %d 个；文件 %d 字节）\n' % (mask(rel(p)), len(nodes), os.path.getsize(p)))
        for nd in nodes[:12]: out.write(mask(nd)[:4000] + '\n')
        out.write('-- 文件开头 1500 字符：\n%s\n\n' % mask(text[:1500]))
    out.close()
    dm = [p for p in xmls if 'easy_dialog-2.xml' in p]
    for p in dm[:1]: put(p, os.path.join(stage, 'xml', rel(p)))
    print('  easy_dialog xml %d 个' % len(xmls))
elif mode == 'gcfam':
    out = open(os.path.join(stage, '_skeleton.tsv'), 'w', encoding='utf-8')
    hist = collections.Counter(); n = 0
    scenes = os.path.join(root, 'package.nw', 'scenes')
    if not os.path.isdir(scenes): scenes = os.path.join(root, 'scenes')
    for d, ds, fs in os.walk(scenes) if os.path.isdir(scenes) else []:
        for f in fs:
            if not re.fullmatch(r'(?:hmr|hsr)_\w+\.txt', f): continue
            lines = dec(open(os.path.join(d, f), 'rb').read(LIMIT)).splitlines(); n += 1
            if n > 500: break
            seq = []; sub = {}; prev = ''
            for i, l in enumerate(lines, 1):
                w = l.strip().lstrip('﻿').split(',')[0].strip()
                if not w: continue
                hist[w] += 1
                if w == 'subimage' and len(l.split(',')) > 1: sub[l.split(',')[1]] = sub.get(l.split(',')[1], 0) + 1
                if w in ('message', 'msgvoicesync', 'voice', 'wait', 'window', 'fade', 'seplay', 'bgmplay', 'bgmstop'):
                    if prev == w: continue   # 连续同类只记一次
                    seq.append(w[:4] if w in ('message', 'msgvoicesync') else w)
                else: seq.append('%s:%s' % (w, mask(','.join(l.strip().split(',')[1:6]))[:60]))
                prev = w
            out.write('%s\tlines=%d\tsubimage_targets=%s\t%s\n' % (mask(os.path.join(os.path.relpath(d, scenes), f)), len(lines), sorted(sub), ' | '.join(seq)[:6000]))
    out.close()
    open(os.path.join(stage, '_command_histogram.txt'), 'w', encoding='utf-8').write('行式脚本 %d 个，命令出现次数：\n' % n + '\n'.join('%7d  %s' % (c, mask(w)) for w, c in hist.most_common(120)))
    for name in ('readme.txt', 'scenesChanged.txt', 'sceneData.js', 'package.json'):
        for base in (os.path.join(root, 'package.nw'), root):
            p = os.path.join(base, name)
            if os.path.isfile(p): put(p, os.path.join(stage, name)); break
    print('  行式脚本 %d 个' % n)
elif mode == 'train':
    for d, ds, fs in os.walk(root):
        if os.path.basename(d) == 'cast006001':
            listing(root, sorted(walk(d, set())), os.path.join(stage, '_cast006001.tsv'), with_dims=True)
            for p in walk(d, set()):
                if p.endswith(('.atlas', '.json', '.txt')) and os.path.getsize(p) < 3 * 1024 * 1024: put(p, os.path.join(stage, rel(p)))
            ds[:] = []
        if os.path.basename(d) == 'story1010063':
            for f in fs:
                if f == 'script.txt': put(os.path.join(d, f), os.path.join(stage, 'script', rel(os.path.join(d, f))))
    casts = [d for d, ds, fs in os.walk(root) if os.path.basename(os.path.dirname(d)) == 'cast']
    open(os.path.join(stage, '_cast_dirs.txt'), 'w', encoding='utf-8').write('cast 目录 %d 个；前 40：%s\n' % (len(casts), [os.path.basename(c) for c in sorted(casts)[:40]]))
    top = sorted(os.listdir(root))[:80]
    open(os.path.join(stage, '_top.txt'), 'w', encoding='utf-8').write('\n'.join(mask(x) for x in top))
elif mode == 'tsk':
    adv = None
    for d, ds, fs in os.walk(root):
        if os.path.basename(d) == 'Adventure' and 'NAME.txt' in fs: adv = d; ds[:] = []
    if adv:
        for name in ('NAME.txt', 'NEW.txt', 'Master.chapter.json', 'event_story_map.tsv', 'main_story_map.tsv'):
            p = os.path.join(adv, name)
            if os.path.isfile(p): put(p, os.path.join(stage, name))
        for sub in ('CharaScenario', 'MainScenario', 'StoryEventScenario', 'HomeEventScenario'):
            d = os.path.join(adv, sub)
            if os.path.isdir(d):
                names = sorted(os.listdir(d)); open(os.path.join(stage, '_%s.txt' % sub), 'w', encoding='utf-8').write('%d 项；前 120：\n%s' % (len(names), '\n'.join(mask(x) for x in names[:120])))
    sp = None
    for d, ds, fs in os.walk(root):
        if os.path.basename(d) == 'Sprites' and 'PictureBook' in ds: sp = d; ds[:] = []
    if sp:
        for sub in ('Story', 'PictureBook', 'Chara'):
            d = os.path.join(sp, sub)
            if os.path.isdir(d): listing(root, sorted(walk(d, set()))[:300], os.path.join(stage, '_Sprites_%s.tsv' % sub), with_dims=True)
PYEOF
echo "收集时间：$(date '+%F %T')    BASE=$BASE" > "$STAGE/_info.txt"
run() { local mode="$1" name="$2" dir="$3"; [ -n "$dir" ] && [ -d "$dir" ] || { echo "(没找到目录：$name = ${dir:-空})"; return; }; echo "== $name：$dir"; "$PY" "$HELPER" "$mode" "$dir" "$STAGE/$name"; }
run bokusen bokusen "$BOKUSEN"
run grenze grenze "$GRENZE"
run train train "$TRAIN"
run tsk tsk "$TSK"
IFS=':' read -r -a GC_DIRS <<< "$GCFAM:$EXTRA"
for g in "${GC_DIRS[@]}"; do
  [ -n "$g" ] && [ -d "$g" ] || { [ -n "$g" ] && echo "(没找到目录：GC 系列 = $g)"; continue; }
  tag="$(basename "$g" | tr -c 'A-Za-z0-9\n' '_')"
  run gcfam "gcfam/$tag" "$g"
done
# 每个游戏根目录的小文本 / 脚本（解析工具、readme、配置）
for pair in "kamihime:$KAMIHIME" "angelic:$ANGELIC" "artwhirl:$ARTWHIRL" "bokusen:$BOKUSEN" "grenze:$GRENZE" "tsk:$TSK" "train:$TRAIN" "deepone:$DEEPONE"; do
  run rootinfo "root/${pair%%:*}" "${pair#*:}"
done
for g in "${GC_DIRS[@]}"; do
  [ -n "$g" ] && [ -d "$g" ] || continue
  tag="$(basename "$g" | tr -c 'A-Za-z0-9\n' '_')"
  run rootinfo "root/gc_$tag" "$g"
done
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)，$(tar -tzf "$OUT" | wc -l) 项）——把这个文件发给我"
