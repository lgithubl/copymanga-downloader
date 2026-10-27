#!/usr/bin/env bash
# 第十五轮样本（补第十四轮的缺口，一次跑完；cp 关键脚本 / 查看器 JS / 文件清单，文本脱敏，最后打成 tar.gz）：
#   Kamihime（ウィン・ウィン / 16912 所在目录 + 全部标题的 json 与脚本对应统计）/ angelic（371IH42Z15.rpy 和图片定义）/ 魔法学园（ROLA_ep5_h + voices 统计）/
#   ぼくら（全部脚本名 + 502704 的资源目录）/ Grenze（图片目录结构 + web_viewer 源码）/ GC 系列各查看器（带 msgvoicesync / CrossFadeReady / cgmode 的 JS）/
#   TSK（CharaScenario1091002 全文 + 角色定义）/ 迷雾列车（estefania_001 的 atlas / 贴图尺寸）/ deepone（character/1057 的语音文件名）
# 输出 ./gal-samples15.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples15.sh
#   个别目录用变量覆盖：KAMIHIME= ANGELIC= ARTWHIRL= BOKUSEN= GRENZE= TSK= TRAIN= DEEPONE=；GC 系列的几个查看器目录用 GCFAM="目录1:目录2:…" 覆盖（默认：Angelica Aster R Viewer / Girls Creation R Viewer / Girls Creation R Viewer 282寝 / maid / jaxin），还要多扫别的目录就 EXTRA="目录1:目录2"。
#   只读原目录；只在这些游戏目录里找（不扫 BASE）；不复制音频、视频、图片（只列文件名 / 大小 / 图片宽高）；文本里连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。单个文件超过 3MB 只取前 3MB。
BASE="${BASE:-.}"
: "${KAMIHIME:=$BASE/Kamihime_Player- 1.0}"
: "${ANGELIC:=$BASE/angelic_py-1.0.2-pc}"
: "${ARTWHIRL:=$BASE/魔法学园的少女们}"
: "${BOKUSEN:=$BASE/ぼくらの放課後戦争}"
: "${GRENZE:=$BASE/GrenzeViewer}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
: "${TRAIN:=$BASE/train}"
: "${DEEPONE:=$BASE/deeponecgv20260801}"
: "${GCFAM:=$BASE/Angelica Aster R Viewer:$BASE/Girls Creation R Viewer:$BASE/Girls Creation R Viewer 282寝:$BASE/maid:$BASE/jaxin}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples15.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import collections, json, os, re, shutil, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
TEXT = {'.txt', '.json', '.rpy', '.ks', '.csv', '.xml', '.atlas', '.plist', '.js', '.html', '.htm', '.css', '.tsv', '.yaml', '.yml', '.ini', '.cfg', '.py', '.sh', '.bat', '.cmd', '.ps1', '.md', ''}
LIMIT = 3 * 1024 * 1024
SKIPDIRS = {'node_modules', 'Python27', 'renpy', 'saves', 'cache', 'locales', 'runtime'}
def dec(raw):
    for enc in ('utf-8-sig', 'utf-16', 'cp932', 'gb18030'):
        try: return raw.decode(enc)
        except Exception: pass
    return raw.decode('latin-1')
def put(src, dst):
    ext = os.path.splitext(src)[1].lower()
    if ext not in TEXT: return None
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'w', encoding='utf-8').write(mask(dec(open(src, 'rb').read(LIMIT)))); return 'txt'
def walk(root, skip=SKIPDIRS):
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
        if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
            if b[12:16] == b'VP8X': return (1 + int.from_bytes(b[24:27], 'little'), 1 + int.from_bytes(b[27:30], 'little'))
    except Exception: pass
    return None
def listing(root, files, out, with_dims=False, limit=100000):
    n = 0
    with open(out, 'w', encoding='utf-8') as f:
        for p in files:
            wh = dims(p) if with_dims and p.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')) else None
            f.write('%s\t%d\t%s\n' % (mask(os.path.relpath(p, root)), os.path.getsize(p), ('%dx%d' % wh) if wh else '')); n += 1
            if n >= limit: break
    return n
def find_files(root, pred):
    return [p for p in walk(root) if pred(p, os.path.basename(p))]
mode, root, stage = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(stage, exist_ok=True)
rel = lambda p: os.path.relpath(p, root)

if mode == 'kamihime':
    raw = os.path.join(root, 'game', 'dmm', 'raw_scenario'); assets = os.path.join(root, 'game', 'dmm', 'assets')
    # 1) 目标标题所在目录：目录名含「ウィン・ウィン」，或里面有 16912_harem*
    folders = set()
    for p in walk(raw):
        if 'ウィン・ウィン' in os.path.dirname(p) or os.path.basename(p).startswith('16912_harem'): folders.add(os.path.dirname(p))
    for n, fo in enumerate(sorted(folders), 1):
        files = sorted(os.path.join(fo, f) for f in os.listdir(fo))
        listing(root, files, os.path.join(stage, 'title_%d.tsv' % n))   # 第 n 个目录的文件清单（目录名在每行的路径里）
        for p in files: put(p, os.path.join(stage, 'title_files', rel(p)))
        # 这些标题的 json → resource_directory → assets 里的文件名
        for p in files:
            if p.endswith('.json') and not p.endswith('_script.json'):
                try: rd = json.loads(dec(open(p, 'rb').read())).get('resource_directory')
                except Exception: rd = None
                d = os.path.join(assets, rd) if rd else None
                if d and os.path.isdir(d): listing(root, sorted(os.path.join(d, f) for f in os.listdir(d)), os.path.join(stage, 'rd_%s.tsv' % os.path.basename(p)[:-5]), with_dims=True)
    # 2) 全部标题：元数据 json 和脚本的对应统计
    kinds = collections.Counter(); lacking = []
    metas = [p for p in walk(raw) if re.search(r'_harem-[a-z]+\.json$', p)]
    for p in metas:
        stem = p[:-5]
        k = ('ks' if os.path.exists(stem + '_script.ks') else '') + ('+json' if os.path.exists(stem + '_script.json') else '')
        kinds[k or 'none'] += 1
        if not k and len(lacking) < 300: lacking.append(mask(rel(p)))
    with open(os.path.join(stage, '_script_kinds.txt'), 'w', encoding='utf-8') as f:
        f.write('元数据 json %d 个；对应的脚本种类（ks / json / 都有 / none）：%s\n没有任何脚本的（前 300）：\n%s\n' % (len(metas), dict(kinds), '\n'.join(lacking)))
    other = collections.Counter(re.sub(r'\d+', 'N', os.path.basename(p)) for p in walk(raw))
    with open(os.path.join(stage, '_filename_shapes.txt'), 'w', encoding='utf-8') as f: f.write('raw_scenario 下文件名形状计数：\n' + '\n'.join('%6d  %s' % (n, mask(s)) for s, n in other.most_common(60)))
elif mode == 'angelic':
    game = os.path.join(root, 'game'); scripts = find_files(game, lambda p, f: f.endswith('.rpy') and os.sep + 'hscene' + os.sep in p)
    listing(root, sorted(scripts), os.path.join(stage, '_hscene_scripts.tsv'))
    for p in scripts:
        if os.path.basename(p).startswith('371'): put(p, os.path.join(stage, 'scripts', rel(p)))
    # 图片定义：含 371lid_st_s_ 的行（带前后 3 行）+ 含这些行的整个文件（< 300KB）
    hits = []; whole = set()
    for p in find_files(game, lambda p, f: f.endswith('.rpy')):
        lines = dec(open(p, 'rb').read(LIMIT)).splitlines()
        for i, l in enumerate(lines):
            if '371lid_st_s_' in l or re.match(r'\s*image\s+371', l):
                hits.append('%s:%d' % (rel(p), i + 1)); hits.extend('   %s' % mask(x[:200]) for x in lines[max(0, i - 2):i + 4]); whole.add(p)
                if len(hits) > 400: break
    open(os.path.join(stage, '_image_defs.txt'), 'w', encoding='utf-8').write('\n'.join(hits))
    for p in whole:
        if os.path.getsize(p) < 300 * 1024: put(p, os.path.join(stage, 'defs_files', rel(p)))
    names = find_files(os.path.join(game, 'images'), lambda p, f: f.startswith('371'))
    listing(root, sorted(names), os.path.join(stage, '_images_371.tsv'), with_dims=True, limit=400)
    for p in sorted(scripts)[:6]:
        open(os.path.join(stage, 'head_' + os.path.basename(p)), 'w', encoding='utf-8').write(mask('\n'.join(dec(open(p, 'rb').read(60000)).splitlines()[:60])))
elif mode == 'artwhirl':
    game = os.path.join(root, 'game')
    for p in find_files(game, lambda p, f: re.fullmatch(r'ROLA_ep5_(?:00|h)\.json', f)): put(p, os.path.join(stage, 'scripts', rel(p)))
    total = withv = 0; per = []
    for p in find_files(game, lambda p, f: f.endswith('.json') and (os.sep + 'episode_scripts' + os.sep in p or os.sep + 'hscripts' + os.sep in p)):
        try: d = json.loads(dec(open(p, 'rb').read()))
        except Exception: continue
        vs = d.get('voices') if isinstance(d, dict) else None
        n = sum(1 for x in (vs or []) if x not in (None, '', 0)); total += 1
        if n: withv += 1
        per.append('%s\t%d\t%d' % (rel(p), n, len(vs or [])))
    open(os.path.join(stage, '_voices_per_script.tsv'), 'w', encoding='utf-8').write('脚本\t非空 voices 数\tvoices 长度\n总计 %d 个脚本，voices 非空的 %d 个\n' % (total, withv) + '\n'.join(mask(x) for x in per))
    vd = os.path.join(game, 'audio', 'voice')
    if os.path.isdir(vd): open(os.path.join(stage, '_voice_dirs.tsv'), 'w', encoding='utf-8').write('\n'.join('%s\t%d' % (mask(x), len(os.listdir(os.path.join(vd, x)))) for x in sorted(os.listdir(vd)) if os.path.isdir(os.path.join(vd, x))))
    listing(root, sorted(find_files(os.path.join(game, 'hscripts'), lambda p, f: f.endswith('.json'))), os.path.join(stage, '_hscripts.tsv'), limit=3000)
elif mode == 'bokusen':
    js = find_files(os.path.join(root, 'json'), lambda p, f: f.endswith('.json')); listing(root, sorted(js), os.path.join(stage, '_all_scripts.tsv'))
    for p in find_files(root, lambda p, f: f in ('README.md', 'error_list.txt') and os.path.dirname(p) == root): put(p, os.path.join(stage, os.path.basename(p)))
    for p in js:
        if '502704' in p:
            put(p, os.path.join(stage, 'script', rel(p)))
            stem = os.path.splitext(os.path.basename(p))[0]; rd = os.path.join(root, 'resource', stem)
            if os.path.isdir(rd): listing(root, sorted(find_files(rd, lambda q, f: True)), os.path.join(stage, '_resource_502704.tsv'), with_dims=True, limit=2000)
            else: open(os.path.join(stage, '_resource_502704.tsv'), 'w').write('(没找到资源目录 resource/%s)' % mask(stem))
elif mode == 'grenze':
    res = os.path.join(root, 'assets', 'resources'); cnt = collections.Counter(); sample = collections.defaultdict(list)
    for p in find_files(res, lambda p, f: f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp'))):
        key = '/'.join(os.path.relpath(p, res).split('/')[:3]); cnt[key] += 1
        if len(sample[key]) < 6: sample[key].append(os.path.basename(p))
    open(os.path.join(stage, '_image_dirs.txt'), 'w', encoding='utf-8').write('\n'.join('%5d  %s   例：%s' % (n, mask(k), mask(', '.join(sample[k]))) for k, n in sorted(cnt.items())))
    for sub in ('web_viewer',):
        for p in walk(os.path.join(root, sub)): put(p, os.path.join(stage, rel(p)))
    for f in ('README.md', 'Launch-GrenzeViewer.cmd', 'Launch-GrenzeViewer.ps1'):
        if os.path.exists(os.path.join(root, f)): put(os.path.join(root, f), os.path.join(stage, f))
elif mode == 'gcfam':   # gcfam <root=游戏目录> <stage> ：带这些关键字的查看器文件
    keys = [k.encode() for k in ('msgvoicesync', 'CrossFadeReady', 'cgmode', 'subimage', 'asyncmoveobject', 'charamotion')]
    lst = open(os.path.join(stage, '_files.tsv'), 'w', encoding='utf-8'); n = 0
    for d, ds, fs in os.walk(root):
        ds[:] = [x for x in ds if x not in SKIPDIRS | {'scenes'}]
        if d.count(os.sep) - root.count(os.sep) > 8: ds[:] = []; continue
        for f in fs:
            p = os.path.join(d, f)
            if os.path.splitext(f)[1].lower() not in ('.js', '.html', '.htm', '.json') or 'gal-samples' in d: continue
            try:
                if os.path.getsize(p) > 5 * 1024 * 1024: continue
                b = open(p, 'rb').read()
            except Exception: continue
            hit = [k.decode() for k in keys if k in b]
            if hit: put(p, os.path.join(stage, rel(p))); lst.write('%s\t%d\t%s\n' % (mask(rel(p)), len(b), ','.join(hit))); n += 1
    lst.close()
    top = os.path.join(root, 'package.nw')
    if os.path.isdir(top): open(os.path.join(stage, '_package_nw_top.txt'), 'w', encoding='utf-8').write('\n'.join(mask(x) for x in sorted(os.listdir(top))))
    print('  带关键字的文件 %d 个' % n)
elif mode == 'tsk':
    for p in find_files(root, lambda p, f: f == 'CharaScenario1091002.book.json'): put(p, os.path.join(stage, 'script', rel(p)))
    sa = find_files(root, lambda p, f: f.endswith('.book.json'))
    listing(root, sorted(p for p in sa if 'CharaScenario109' in p), os.path.join(stage, '_book_1091xxx.tsv'))
    for sub in ('Sprites', 'Characters', 'Adventure'):
        for d, ds, fs in os.walk(root):
            if os.path.basename(d) == sub:
                names = sorted(os.listdir(d))[:300]
                open(os.path.join(stage, '_dir_%s.txt' % sub), 'a', encoding='utf-8').write('## %s\n%s\n' % (mask(rel(d)), '\n'.join(mask(x) for x in names)))
    th = find_files(root, lambda p, f: os.sep + 'Thumb_' in p and f.endswith('.png'))
    listing(root, sorted(th)[:60], os.path.join(stage, '_thumbs_sample.tsv'), with_dims=True)
    cs = find_files(root, lambda p, f: re.match(r'ch_1091\d*', f))
    listing(root, sorted(cs)[:200], os.path.join(stage, '_ch_1091.tsv'), with_dims=True)
elif mode == 'train':
    for d, ds, fs in os.walk(root):
        if os.path.basename(d) == 'cast006001':
            listing(root, sorted(find_files(d, lambda p, f: True)), os.path.join(stage, '_cast006001.tsv'), with_dims=True)
            for p in find_files(d, lambda p, f: f.endswith(('.atlas', '.json', '.txt')) and os.path.getsize(p) < 3 * 1024 * 1024): put(p, os.path.join(stage, rel(p)))
            ds[:] = []
    for p in find_files(root, lambda p, f: f == 'script.txt' and os.path.basename(os.path.dirname(p)) == 'story1010063'): put(p, os.path.join(stage, 'script', rel(p)))
elif mode == 'deepone':
    vd = [d for d, ds, fs in os.walk(root) if d.replace(os.sep, '/').endswith('adv/voice/character/1057')]
    for d in vd[:1]: listing(root, sorted(find_files(d, lambda p, f: True)), os.path.join(stage, '_voice_1057.tsv'))
    if not vd: open(os.path.join(stage, '_voice_1057.tsv'), 'w').write('(没找到 adv/voice/character/1057 目录)')
    for p in find_files(root, lambda p, f: f == '10570506.txt'): put(p, os.path.join(stage, 'script', rel(p)))
PYEOF
echo "收集时间：$(date '+%F %T')    BASE=$BASE" > "$STAGE/_info.txt"
run() { local mode="$1" name="$2" dir="$3"; [ -n "$dir" ] && [ -d "$dir" ] || { echo "(没找到目录：$name = ${dir:-空})"; return; }; echo "== $name：$dir"; "$PY" "$HELPER" "$mode" "$dir" "$STAGE/$name"; }
run kamihime kamihime "$KAMIHIME"
run angelic angelic "$ANGELIC"
run artwhirl artwhirl "$ARTWHIRL"
run bokusen bokusen "$BOKUSEN"
run grenze grenze "$GRENZE"
run tsk tsk "$TSK"
run train train "$TRAIN"
run deepone deepone "$DEEPONE"
IFS=':' read -r -a GC_DIRS <<< "$GCFAM:$EXTRA"
for g in "${GC_DIRS[@]}"; do
  [ -n "$g" ] && [ -d "$g" ] || continue
  tag="$(basename "$g" | tr -c 'A-Za-z0-9\n' '_')"
  run gcfam "gcfam/$tag" "$g"
done
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)，$(tar -tzf "$OUT" | wc -l) 项）——把这个文件发给我"
