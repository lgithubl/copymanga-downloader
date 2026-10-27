#!/usr/bin/env bash
# 第十三轮样本（补第十二轮的缺口；cp 关键脚本 / 查看器 JS / 骨骼贴图，文本脱敏，最后打成 tar.gz）：
#   A Kamihime：播放器 Kamihime_Player.py + 四个缺 CG 的剧情所在目录和 resource_directory 的全部文件名（.ks / json 原样复制，脱敏）
#   B Girls Creation：chara_0032_r18_1 的脚本 / 骨骼 / atlas / 文件清单 + 原版查看器的 JS / HTML（package.nw 是目录或 zip 都行）
#   C Aku：c31000802 骨骼的贴图 png（原样复制，只这一个目录）+ 查看器 JS
#   D Fruits：c488E66-100SZML488_R 的视频文件名 / 大小（有 ffprobe 就带时长和帧数）+ 查看器 JS
# 输出 ./gal-samples13.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples13.sh（个别目录用变量覆盖：KAMIHIME= GC= AKU= FRUITS=）
#   GC 没指对也没关系：会在 BASE 下找包含「Girls Creation R Viewer.exe」的目录（最多往下 3 层）。
#   只读原目录；只复制文本脚本 / 查看器 js·html / 骨骼 json·skel·atlas，外加 Aku 那一张骨骼贴图；不复制音频、视频、其它图片（只列文件名和大小）；
#   文本里连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。单个文件超过 3MB 只取前 3MB。
BASE="${BASE:-.}"
: "${KAMIHIME:=$BASE/Kamihime_Player- 1.0}"
: "${AKU:=$BASE/Aku No Onna Kanbu - Perigee New Moon Viewer}"
: "${FRUITS:=$BASE/Fruits Fulcute!}"
if [ -z "$GC" ]; then
  GC="$BASE/Girls Creation"
  [ -d "$GC" ] || GC="$(find "$BASE" -maxdepth 3 -name 'Girls Creation R Viewer.exe' 2>/dev/null | head -1 | xargs -r -d '\n' dirname)"
fi
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples13.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import json, os, re, shutil, subprocess, sys, zipfile
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
TEXT = {'.txt', '.json', '.rpy', '.ks', '.csv', '.xml', '.atlas', '.plist', '.js', '.html', '.htm', '.css', '.tsv', '.yaml', '.yml', '.ini', '.cfg', '.py', '.sh', '.bat', ''}
BIN_KEEP = {'.skel', '.bytes'}
LIMIT = 3 * 1024 * 1024
def dec(raw):
    for enc in ('utf-8-sig', 'utf-16', 'cp932', 'gb18030'):
        try: return raw.decode(enc)
        except Exception: pass
    return raw.decode('latin-1')
def put_bytes(raw, ext, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if ext in BIN_KEEP: open(dst, 'wb').write(raw); return 'bin'
    if ext not in TEXT: return None
    open(dst, 'w', encoding='utf-8').write(mask(dec(raw[:LIMIT]))); return 'txt'
def put(src, dst, force_bin=False):
    ext = os.path.splitext(src)[1].lower()
    if force_bin:
        os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copyfile(src, dst); return 'bin'
    return put_bytes(open(src, 'rb').read(LIMIT + 1), ext, dst)
def walk(root):
    for d, ds, fs in os.walk(root):
        ds[:] = [x for x in ds if x != 'node_modules']
        for f in fs: yield os.path.join(d, f)
def lister(stage, name):
    return open(os.path.join(stage, name), 'w', encoding='utf-8')
def copy_tree(root, stage, sub, listing, force_bin=False, only=None):
    n = 0
    for p in walk(root):
        rel = os.path.relpath(p, sub if sub else root)
        if only and not only(p): continue
        kind = put(p, os.path.join(stage, rel), force_bin)
        listing.write('%s\t%s\t%d\n' % (kind or 'skip', mask(rel), os.path.getsize(p))); n += kind is not None
    return n
def viewer_js(root, stage):   # 原版查看器：package.nw 目录，或者 zip（NW.js 打包）
    out = os.path.join(stage, 'viewer'); os.makedirs(out, exist_ok=True); n = 0
    lst = lister(out, '_files.txt')
    for cand in (os.path.join(root, 'package.nw'), os.path.join(root, 'resources', 'app'), root):
        if os.path.isdir(cand):
            for d, ds, fs in os.walk(cand):
                ds[:] = [x for x in ds if x not in ('node_modules', 'scenes', 'locales', 'Python27')]
                if os.path.abspath(d) != os.path.abspath(cand) and os.path.relpath(d, cand).count(os.sep) > 4: ds[:] = []
                for f in fs:
                    if os.path.splitext(f)[1].lower() in ('.js', '.html', '.htm', '.css') or f in ('package.json',):
                        p = os.path.join(d, f); rel = os.path.relpath(p, root)
                        kind = put(p, os.path.join(out, rel)); lst.write('%s\t%s\t%d\n' % (kind or 'skip', mask(rel), os.path.getsize(p))); n += kind is not None
            if n: break
        elif os.path.isfile(cand) and zipfile.is_zipfile(cand):
            z = zipfile.ZipFile(cand)
            for i in z.infolist():
                ext = os.path.splitext(i.filename)[1].lower()
                if 'node_modules' in i.filename or ext not in ('.js', '.html', '.htm', '.css', '.json') or i.filename.startswith('scenes/'): continue
                kind = put_bytes(z.read(i)[:LIMIT], ext, os.path.join(out, 'package.nw', i.filename)); lst.write('%s\t%s\t%d\n' % (kind or 'skip', mask(i.filename), i.file_size)); n += kind is not None
            if n: break
    lst.close(); print('  查看器 js/html/json：%d 个文件' % n)

mode, root, stage = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(stage, exist_ok=True)
if mode == 'viewer':
    viewer_js(root, stage)
elif mode == 'kamihime':
    # 播放器脚本 + 顶层文件清单
    top = lister(stage, '_top_files.tsv')
    for f in sorted(os.listdir(root)):
        p = os.path.join(root, f); top.write('%s\t%d\n' % (mask(f), os.path.getsize(p) if os.path.isfile(p) else -1))
        if os.path.isfile(p) and f.lower().endswith(('.py', '.sh', '.bat', '.ks', '.xml', '.txt', '.json')) and os.path.getsize(p) < 3 * 1024 * 1024: put(p, os.path.join(stage, f))
    top.close()
    # 不含 Python27 的 game 目录文件清单（名字 + 大小，最多 60000 行）
    gl = lister(stage, '_game_files.tsv'); n = 0
    for p in walk(os.path.join(root, 'game')):
        rel = os.path.relpath(p, root)
        if rel.startswith(os.path.join('Python27', '')): continue
        gl.write('%s\t%d\n' % (mask(rel), os.path.getsize(p))); n += 1
        if n >= 60000: break
    gl.close()
    # 四个标题的 json → resource_directory，找出这些目录并复制其中的文本
    titles = ('2607_harem-character', '21707_harem-character', '1707_harem-character', '12607_harem-character', '感謝の気持ち', '美容にいいモノ')
    hits = []; dirs = set()
    for p in walk(root):
        if p.endswith('.json') and 'harem-character' in os.path.basename(p) and not p.endswith('_script.json'):
            try: d = json.loads(dec(open(p, 'rb').read()))
            except Exception: continue
            if isinstance(d, dict) and d.get('resource_directory'): hits.append((p, d.get('title'), d.get('resource_directory'), d.get('scenario_path'))); dirs.add(d['resource_directory'])
    print('  harem json %d 个，resource_directory %d 个' % (len(hits), len(dirs)))
    ix = lister(stage, '_harem_index.tsv')
    for p, t, rd, sp in hits: ix.write('%s\t%s\t%s\t%s\n' % (mask(os.path.relpath(p, root)), mask(str(t)), rd, sp))
    ix.close()
    want = [h for h in hits if any(k in os.path.basename(h[0]) or k in str(h[1]) for k in titles)]
    wantdirs = {h[2] for h in want} or dirs
    res = lister(stage, '_resource_dirs.tsv'); n = 0
    for p in walk(root):
        parts = p.split(os.sep)
        if any(x in wantdirs for x in parts):
            rel = os.path.relpath(p, root); kind = put(p, os.path.join(stage, 'res', rel)) if p.endswith(('.ks', '.json', '.txt')) else None
            res.write('%s\t%s\t%d\n' % (kind or 'skip', mask(rel), os.path.getsize(p))); n += 1
    res.close(); print('  resource_directory 下 %d 个文件' % n)
    # 同一个标题所在目录里的所有文件（名字 + 大小，文本原样复制）
    for h in want:
        folder = os.path.dirname(h[0])
        for p in sorted(os.listdir(folder)):
            fp = os.path.join(folder, p)
            if os.path.isfile(fp): put(fp, os.path.join(stage, 'title_dirs', os.path.relpath(fp, root)))
elif mode == 'dirs':   # dirs <root> <stage> <目录名> [bin:<子串> ...]：按「目录名」找场景目录，复制文本 + 骨骼；bin: 指定要原样复制的文件
    names = [a for a in sys.argv[4:] if not a.startswith('bin:')]; bins = [a[4:] for a in sys.argv[4:] if a.startswith('bin:')]
    lst = lister(stage, '_files.tsv'); n = 0
    for d, ds, fs in os.walk(root):
        if os.path.basename(d) in names or any(os.path.basename(d) == x for x in names):
            for p in walk(d):
                rel = os.path.relpath(p, root); fb = any(b in p for b in bins) and p.lower().endswith(('.png', '.jpg', '.webp'))
                kind = put(p, os.path.join(stage, rel), fb); lst.write('%s\t%s\t%d\n' % (kind or 'skip', mask(rel), os.path.getsize(p))); n += kind is not None
            ds[:] = []
    lst.close(); print('  复制 %d 个文件（目录名 %s）' % (n, names))
elif mode == 'videos':   # videos <root> <stage> <目录名>：只列视频的名字 / 大小 / ffprobe 信息
    names = sys.argv[4:]; lst = lister(stage, '_videos.tsv'); n = 0
    for d, ds, fs in os.walk(root):
        if os.path.basename(d) in names:
            for p in walk(d):
                if not p.lower().endswith(('.mp4', '.webm', '.mov', '.m4v', '.ogv')): continue
                info = ''
                try: info = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_frames,duration', '-of', 'csv=p=0', p], capture_output=True, text=True, timeout=20).stdout.strip()
                except Exception: info = '(无 ffprobe)'
                lst.write('%s\t%d\t%s\n' % (mask(os.path.relpath(p, root)), os.path.getsize(p), info)); n += 1
            ds[:] = []
    lst.close(); print('  视频 %d 个' % n)
PYEOF
run() { local mode="$1" name="$2" dir="$3"; shift 3; [ -n "$dir" ] && [ -d "$dir" ] || { echo "(没找到目录：$name = ${dir:-空})"; return; }; echo "== $name：$dir"; "$PY" "$HELPER" "$mode" "$dir" "$STAGE/$name" "$@"; }

echo "收集时间：$(date '+%F %T')    BASE=$BASE" > "$STAGE/_info.txt"
run kamihime kamihime "$KAMIHIME"
run dirs girlscreation_scene "$GC" chara_0032_r18_1
run viewer girlscreation_viewer "$GC"
run dirs aku_scene "$AKU" c31000802 bin:spines
run viewer aku_viewer "$AKU"
run videos fruits_videos "$FRUITS" c488E66-100SZML488_R
run viewer fruits_viewer "$FRUITS"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)，$(tar -tzf "$OUT" | wc -l) 项）——把这个文件发给我"
