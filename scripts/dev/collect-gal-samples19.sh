#!/usr/bin/env bash
# 第十九轮样本（只采「还没有数据」的几块；文本脱敏，最后打成 tar.gz）：
#   A 魔法学园（artwhirl）：没有声音——voice 目录里的文件名、h 脚本的 voices 字段样例、游戏里处理 voice 的 rpy 代码
#   B ぼくら：脚本里引用的 https://resource-asw.bokusen.net/… 图片（hash 文件名）在本地到底有没有 / 在哪
#   C GC 行式脚本（Girls Creation R / 282寝 / Aku / Fruits）：subimage / asyncmoveobject / asyncjump / CrossFade 的原版实现——在所有文件（含 exe / dll / pak / 快照等二进制）里按字节搜关键字，导出前后文
#   D 迷雾列车（MistTrainGirls X，Unity）：骨骼 / atlas / 贴图的位置、Textures/Characters/Bases、缩略图目录、几个骨骼样例
#   E deepone：人物缩略图的目录和文件名、缺的语音（adu105705_03_23 ~ 25）在不在别处
# 输出 ./gal-samples19.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples19.sh；目录名不对就覆盖：ARTWHIRL= BOKUSEN= TRAIN= DEEPONE= GC= GC282= AKU= FRUITS=
#   只读原目录；只在这些游戏目录里找（不扫 BASE）；不复制音频、视频、图片（只列名字 / 大小 / 宽高）；文本里连续 3 个以上的中日文字符会被替换成 <N字>。单个文件超过 3MB 只取前 3MB。
BASE="${BASE:-.}"
: "${ARTWHIRL:=$BASE/魔法学园的少女们}"
: "${BOKUSEN:=$BASE/ぼくらの放課後戦争}"
: "${TRAIN:=$BASE/迷雾列车少女[12.1G]}"
: "${DEEPONE:=$BASE/deeponecgv20260801}"
: "${GC:=$BASE/Girls Creation R Viewer}"
: "${GC282:=$BASE/Girls Creation R Viewer 282寝}"
: "${AKU:=$BASE/Aku No Onna Kanbu - Perigee New Moon Viewer}"
: "${FRUITS:=$BASE/Fruits Fulcute!}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples19.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import collections, json, os, re, shutil, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
TEXT = {'.txt', '.json', '.rpy', '.ks', '.csv', '.xml', '.atlas', '.plist', '.js', '.html', '.htm', '.css', '.tsv', '.yaml', '.yml', '.ini', '.cfg', '.py', '.md', ''}
LIMIT = 3 * 1024 * 1024
SKIP = {'node_modules', 'renpy', 'Python27', 'saves', 'cache', 'locales'}
def dec(raw):
    for enc in ('utf-8-sig', 'utf-16', 'cp932', 'gb18030'):
        try: return raw.decode(enc)
        except Exception: pass
    return raw.decode('latin-1')
def put(src, dst, raw_ok=False):
    ext = os.path.splitext(src)[1].lower()
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if raw_ok and ext in ('.skel', '.bytes') and os.path.getsize(src) <= LIMIT: shutil.copyfile(src, dst); return 'bin'
    if ext not in TEXT: return None
    open(dst, 'w', encoding='utf-8').write(mask(dec(open(src, 'rb').read(LIMIT)))); return 'txt'
def walk(root, skip=SKIP):
    for d, ds, fs in os.walk(root):
        ds[:] = [x for x in ds if x not in skip]
        for f in fs: yield os.path.join(d, f)
def dims(p):
    try:
        b = open(p, 'rb').read(200000)
        if b[:8] == b'\x89PNG\r\n\x1a\n': return struct.unpack('>II', b[16:24])
    except Exception: pass
    return None
mode, root, stage = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(stage, exist_ok=True)
rel = lambda p: os.path.relpath(p, root)
def listing(files, out, with_dims=True, limit=100000):
    with open(os.path.join(stage, out), 'w', encoding='utf-8') as f:
        for n, p in enumerate(files):
            if n >= limit: break
            wh = dims(p) if with_dims and p.lower().endswith('.png') else None
            f.write('%s\t%d\t%s\n' % (mask(rel(p)), os.path.getsize(p), ('%dx%d' % wh) if wh else ''))

if mode == 'artwhirl':
    game = os.path.join(root, 'game'); vd = os.path.join(game, 'audio', 'voice')
    if os.path.isdir(vd):
        dirs = sorted(x for x in os.listdir(vd) if os.path.isdir(os.path.join(vd, x)))
        pick = [x for x in dirs if re.search(r'(?:REN_ep4|ROLA_ep5|YUNI_ep7|AMRITA_ep6)', x)][:8] + dirs[:6]
        for x in dict.fromkeys(pick): listing(sorted(walk(os.path.join(vd, x))), 'voice_dir_%s.tsv' % x, False, 80)
        loose = [f for f in os.listdir(vd) if os.path.isfile(os.path.join(vd, f))]
        open(os.path.join(stage, '_voice_root_files.txt'), 'w', encoding='utf-8').write('voice 根目录下的文件 %d 个；前 60：\n%s' % (len(loose), '\n'.join(mask(x) for x in sorted(loose)[:60])))
    # voices 字段：有值的和全空的各几个
    full, empty = [], []
    for p in walk(game):
        if not p.endswith('.json') or ('episode_scripts' not in p and 'hscripts' not in p): continue
        try: d = json.loads(dec(open(p, 'rb').read()))
        except Exception: continue
        vs = d.get('voices') if isinstance(d, dict) else None
        if not isinstance(vs, list): continue
        (full if any(vs) else empty).append((p, vs, d))
    out = open(os.path.join(stage, '_voices_samples.txt'), 'w', encoding='utf-8')
    for tag, lst in (('有 voices', full[:6]), ('voices 全空', empty[:6])):
        for p, vs, d in lst:
            out.write('## %s  %s  keys=%s\n  voices[:30]=%s\n' % (tag, mask(rel(p)), sorted(d.keys()), mask(json.dumps(vs[:30], ensure_ascii=False)[:1200])))
    out.close()
    # 处理 voice 的 rpy / py
    hits = open(os.path.join(stage, '_voice_code.txt'), 'w', encoding='utf-8')
    for p in walk(game):
        if not p.endswith(('.rpy', '.py')): continue
        lines = dec(open(p, 'rb').read(LIMIT)).splitlines()
        for i, l in enumerate(lines):
            if re.search(r'voice', l, re.I):
                hits.write('%s:%d\n%s\n' % (rel(p), i + 1, '\n'.join('   ' + mask(x[:200]) for x in lines[max(0, i - 2):i + 4])))
    hits.close()
    for p in walk(game):
        if os.path.basename(p) in ('json_story_player.rpy',): put(p, os.path.join(stage, 'code', rel(p)))
elif mode == 'bokurl':
    hashes = ['6bbf4ccf6870e1e41966cae9dd9cf9061d61e8cc', '970c960629763337eceb788a7b189dba369e4467', '19fb930e07fb7dafdc95c83d981d0d47a6c3328b', 'c4befabc949b09e3b166d7a69722a28b4db5ef64', 'a1fa2b4ff23d8d94da1b6edc3a22fc7a8d608d91']
    found = collections.defaultdict(list); hexfiles = collections.Counter(); sample = []
    for p in walk(root):
        b = os.path.basename(p)
        for h in hashes:
            if h in b: found[h].append(rel(p))
        if re.fullmatch(r'[0-9a-f]{40}(?:\.\w+)?', b):
            hexfiles[os.path.dirname(rel(p))] += 1
            if len(sample) < 30: sample.append(rel(p))
    open(os.path.join(stage, '_hash_files.txt'), 'w', encoding='utf-8').write('脚本里引用的 5 个 hash 文件在本地的位置：\n%s\n\n文件名是 40 位 hex 的文件，按目录计数（前 40）：\n%s\n\n样例：\n%s\n' % (json.dumps(found, ensure_ascii=False, indent=1), '\n'.join('%6d  %s' % (c, mask(d)) for d, c in hexfiles.most_common(40)), '\n'.join(mask(x) for x in sample)))
    top = []
    for x in sorted(os.listdir(root)):
        p = os.path.join(root, x); top.append('%s\t%s\t%d' % (mask(x), 'dir' if os.path.isdir(p) else 'file', len(os.listdir(p)) if os.path.isdir(p) else os.path.getsize(p)))
    open(os.path.join(stage, '_top.tsv'), 'w', encoding='utf-8').write('\n'.join(top))
    # 502704 脚本里所有 URL 的种类（域名 + 路径前 3 段）
    kinds = collections.Counter()
    for p in walk(os.path.join(root, 'json')):
        if '502704' in p:
            for m in re.finditer(r'https?://[^"\\\s]+', dec(open(p, 'rb').read(LIMIT))): kinds[re.sub(r'[0-9a-f]{40}', '<hash>', m.group(0))[:140]] += 1
    open(os.path.join(stage, '_url_kinds_502704.txt'), 'w', encoding='utf-8').write('\n'.join('%6d  %s' % (c, u) for u, c in kinds.most_common(60)))
elif mode == 'binscan':
    keys = [k.encode() for k in ('asyncmoveobject', 'asyncjump', 'subimage', 'CrossFadeReady', 'CrossFade', 'cgmode', 'charamotion', 'msgvoicesync')]
    SKIPEXT = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.ogg', '.wav', '.mp4', '.webm', '.m4a', '.flac', '.skel', '.atlas', '.ttf', '.otf', '.woff', '.woff2', '.mov'}
    out = open(os.path.join(stage, '_hits.txt'), 'w', encoding='utf-8'); lst = open(os.path.join(stage, '_scanned.tsv'), 'w', encoding='utf-8'); total = 0
    for p in walk(root, SKIP | {'scenes'}):
        ext = os.path.splitext(p)[1].lower(); size = os.path.getsize(p)
        if ext in SKIPEXT or size > 600 * 1024 * 1024: continue
        per = collections.Counter(); first = {}
        try:
            with open(p, 'rb') as f:
                tail = b''; offset = 0
                while True:
                    chunk = f.read(8 * 1024 * 1024)
                    if not chunk: break
                    data = tail + chunk
                    for k in keys:
                        pos = data.find(k)
                        while pos >= 0:
                            per[k.decode()] += 1
                            if per[k.decode()] <= 3:
                                s = max(0, pos - 200); ctx = data[s:pos + 700].decode('utf-8', 'replace')
                                out.write('=== %s  %s  @%d\n%s\n\n' % (mask(rel(p)), k.decode(), offset - len(tail) + pos, mask(re.sub(r'[\x00-\x08\x0b-\x1f]', '.', ctx))))
                            pos = data.find(k, pos + len(k))
                    tail = data[-32:]; offset += len(chunk)
        except Exception: continue
        if per: lst.write('%s\t%d\t%s\n' % (mask(rel(p)), size, dict(per))); total += 1
    out.close(); lst.close(); print('  含关键字的文件 %d 个' % total)
elif mode == 'unity':
    data = [os.path.join(root, d) for d in os.listdir(root) if d.endswith('_Data')]
    data = data[0] if data else root
    skel = [p for p in walk(data) if p.lower().endswith(('.skel', '.atlas', '.skeleton')) or p.endswith(('.skel.bytes', '.atlas.txt', '.skel.txt'))]
    listing(sorted(skel)[:3000], '_spine_files.tsv', False)
    dirs = collections.Counter(os.path.dirname(rel(p)) for p in skel)
    open(os.path.join(stage, '_spine_dirs.txt'), 'w', encoding='utf-8').write('含骨骼 / atlas 的目录 %d 个：\n%s' % (len(dirs), '\n'.join('%5d  %s' % (c, mask(d)) for d, c in dirs.most_common(80))))
    tree = collections.Counter()
    for p in walk(data):
        tree['/'.join(rel(p).split(os.sep)[:4])] += 1
    open(os.path.join(stage, '_tree_depth4.txt'), 'w', encoding='utf-8').write('\n'.join('%6d  %s' % (c, mask(d)) for d, c in sorted(tree.items())[:1500]))
    for key in ('Bases', 'Thumb', 'thumb', 'Icon', 'icon', 'Characters'):
        ds = sorted({os.path.dirname(p) for p in walk(data) if os.sep + key in p})[:60]
        files = []
        for d in ds[:12]: files += sorted(os.path.join(d, f) for f in os.listdir(d))[:25]
        if files: listing(files, '_dir_%s.tsv' % key, True, 400)
    picked = 0
    for d in [d for d, c in dirs.most_common(12)][:4]:
        for p in sorted(walk(os.path.join(data, d)))[:30]:
            if put(p, os.path.join(stage, 'spine_samples', rel(p)), True): picked += 1
    print('  骨骼 / atlas 文件 %d 个，样例 %d 个' % (len(skel), picked))
elif mode == 'deepone':
    cand = collections.defaultdict(list)
    for d, ds, fs in os.walk(root):
        low = d.lower()
        if any(k in low for k in ('thumb', 'icon', 'face', 'portrait', 'character')) and fs:
            cand[rel(d)] = sorted(fs)
    with open(os.path.join(stage, '_thumb_dirs.txt'), 'w', encoding='utf-8') as f:
        for d, fs in sorted(cand.items())[:200]: f.write('## %s （%d 个）  前 12：%s\n' % (mask(d), len(fs), mask(', '.join(fs[:12]))))
    miss = [rel(p) for p in walk(root) if re.search(r'adu105705_03_2[3-5]', os.path.basename(p))]
    open(os.path.join(stage, '_missing_voices.txt'), 'w', encoding='utf-8').write('adu105705_03_23 ~ 25 在本地的位置：%s\n' % miss)
    vd = [d for d, ds, fs in os.walk(root) if d.replace(os.sep, '/').endswith('adv/voice/character/1057')]
    if vd: listing(sorted(walk(vd[0])), '_voice_1057_all.tsv', False)
    for p in walk(root):
        if os.path.basename(p) == '10570506.txt': put(p, os.path.join(stage, 'script', rel(p)))
PYEOF
echo "收集时间：$(date '+%F %T')    BASE=$BASE" > "$STAGE/_info.txt"
run() { local mode="$1" name="$2" dir="$3"; [ -n "$dir" ] && [ -d "$dir" ] || { echo "(没找到目录：$name = ${dir:-空})"; return; }; echo "== $name：$dir"; "$PY" "$HELPER" "$mode" "$dir" "$STAGE/$name"; }
run artwhirl artwhirl "$ARTWHIRL"
run bokurl bokusen "$BOKUSEN"
for pair in "gc:$GC" "gc282:$GC282" "aku:$AKU" "fruits:$FRUITS"; do run binscan "binscan/${pair%%:*}" "${pair#*:}"; done
run unity train "$TRAIN"
run deepone deepone "$DEEPONE"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)，$(tar -tzf "$OUT" | wc -l) 项）——把这个文件发给我"
