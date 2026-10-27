#!/usr/bin/env bash
# 第十四轮样本（补第十三轮的缺口；cp 关键脚本 / 查看器 JS，文本脱敏，最后打成 tar.gz）：
#   A Kamihime：游戏自己的 Ren'Py 脚本（script.rpy / Zoomable.rpy / screens.rpy / options.rpy，里面有 film + talk 剧情怎么播）+
#      「*_harem-character_script.json」（film 剧情）所对应的资源目录的文件清单（名字 / 大小 / 图片宽高）+ 每个标题目录下的全部文件
#   B Girls Creation：在 BASE 下找名叫 chara_0032_r18_1 的场景目录（第十三轮只在查看器目录里找，没找到）：脚本 / 骨骼 / atlas / 文件清单
#   C 在 BASE 下找带 asyncmoveobject / subimage / cgmode 字样的查看器文件（hmr_40101123 那种 Utage 风格脚本用的是另一个查看器），原样（脱敏）复制
# 输出 ./gal-samples14.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples14.sh（个别目录用变量覆盖：KAMIHIME=）
#   只读原目录；不复制音频、视频、图片（只列文件名 / 大小 / 图片宽高）；文本里连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。单个文件超过 3MB 只取前 3MB。
BASE="${BASE:-.}"
: "${KAMIHIME:=$BASE/Kamihime_Player- 1.0}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples14.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import json, os, re, shutil, struct, sys
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
def put(src, dst):
    ext = os.path.splitext(src)[1].lower()
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if ext in BIN_KEEP: shutil.copyfile(src, dst); return 'bin'
    if ext not in TEXT: return None
    open(dst, 'w', encoding='utf-8').write(mask(dec(open(src, 'rb').read(LIMIT)))); return 'txt'
def walk(root):
    for d, ds, fs in os.walk(root):
        ds[:] = [x for x in ds if x not in ('node_modules', 'Python27', 'renpy', 'saves', 'cache', 'locales')]
        for f in fs: yield os.path.join(d, f)
def dims(p):   # png / jpg 宽高（不依赖 PIL）
    try:
        b = open(p, 'rb').read(200000)
        if b[:8] == b'\x89PNG\r\n\x1a\n': return struct.unpack('>II', b[16:24])
        if b[:2] == b'\xff\xd8':
            i = 2
            while i < len(b) - 9:
                if b[i] != 0xFF: i += 1; continue
                m = b[i + 1]
                if m in (0xC0, 0xC1, 0xC2): h, w = struct.unpack('>HH', b[i + 5:i + 9]); return (w, h)
                i += 2 + struct.unpack('>H', b[i + 2:i + 4])[0]
    except Exception: pass
    return None
mode, root, stage = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(stage, exist_ok=True)
if mode == 'kamihime':
    for rel in ('game/script.rpy', 'game/Zoomable.rpy', 'game/screens.rpy', 'game/options.rpy', 'game/gui.rpy', 'game/script_version.txt', 'Kamihime_Player.py'):
        p = os.path.join(root, rel)
        if os.path.isfile(p): put(p, os.path.join(stage, rel))
    # film 剧情：*_harem-character_script.json ← 同名 *_harem-character.json 里的 resource_directory
    assets = os.path.join(root, 'game', 'dmm', 'assets'); raw = os.path.join(root, 'game', 'dmm', 'raw_scenario')
    keys = ('2607', '21707', '1707', '12607', '22607', '11707', '8111', '8113')   # 先从这几个标题的编号来（再加上每个标题目录里的全部 _script.json）
    cands = [p for p in walk(raw) if os.path.basename(p).endswith(('_harem-character_script.json', '_harem-summon_script.json'))]
    near = lambda p: any(os.path.exists(os.path.join(os.path.dirname(p), k + '_harem-character_script.ks')) for k in keys)
    cands.sort(key=lambda p: (not near(p), p))   # 这几个标题所在目录的 film 剧情排前面，再补一些别的
    out = open(os.path.join(stage, '_film_resources.tsv'), 'w', encoding='utf-8'); n = 0
    for p in cands[:40]:
        b = os.path.basename(p); folder = os.path.dirname(p)
        meta = os.path.join(folder, b.replace('_script.json', '.json'))
        rd = None
        try: rd = json.loads(dec(open(meta, 'rb').read())).get('resource_directory')
        except Exception: pass
        put(p, os.path.join(stage, 'film_scripts', os.path.relpath(p, root)))
        out.write('## %s\tresource_directory=%s\n' % (mask(os.path.relpath(p, root)), rd))
        d = os.path.join(assets, rd) if rd else None
        if d and os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                fp = os.path.join(d, f); wh = dims(fp) if f.lower().endswith(('.jpg', '.jpeg', '.png')) else None
                out.write('  %s\t%d\t%s\n' % (mask(f), os.path.getsize(fp), ('%dx%d' % wh) if wh else ''))
        else: out.write('  (assets 下没有这个目录)\n')
        n += 1
    out.close(); print('  film 剧情 %d 个' % n)
    # 标题目录下的全部文件
    for k in keys:
        for p in walk(raw):
            if os.path.basename(p).startswith(k + '_harem-character') : put(p, os.path.join(stage, 'title_files', os.path.relpath(p, root)))
elif mode == 'findscene':
    names = sys.argv[4:]; lst = open(os.path.join(stage, '_files.tsv'), 'w', encoding='utf-8'); n = 0
    for d, ds, fs in os.walk(root):
        if os.path.basename(d) in names:
            for p in walk(d):
                rel = os.path.relpath(p, root); kind = put(p, os.path.join(stage, rel)); lst.write('%s\t%s\t%d\n' % (kind or 'skip', mask(rel), os.path.getsize(p))); n += kind is not None
            print('  找到：%s' % d); ds[:] = []
    lst.close(); print('  复制 %d 个文件' % n)
elif mode == 'grep':   # 带关键字的文本文件（查看器 js / html）
    pats = [a.encode() for a in sys.argv[4:]]; lst = open(os.path.join(stage, '_files.tsv'), 'w', encoding='utf-8'); n = 0
    for d, ds, fs in os.walk(root):
        ds[:] = [x for x in ds if x not in ('node_modules', 'Python27', 'renpy', 'saves', 'cache', 'locales', 'scenes')]
        if d.count(os.sep) - root.count(os.sep) > 8: ds[:] = []; continue
        for f in fs:
            if os.path.splitext(f)[1].lower() not in ('.js', '.html', '.htm', '.txt', '.json', '.rpy', '.py') or 'gal-samples' in d: continue
            p = os.path.join(d, f)
            try:
                if os.path.getsize(p) > 5 * 1024 * 1024: continue
                raw = open(p, 'rb').read()
            except Exception: continue
            if any(x in raw for x in pats):
                rel = os.path.relpath(p, root); kind = put(p, os.path.join(stage, rel)); lst.write('%s\t%s\t%d\n' % (kind or 'skip', mask(rel), len(raw))); n += 1
    lst.close(); print('  带关键字的文件 %d 个' % n)
PYEOF
echo "收集时间：$(date '+%F %T')    BASE=$BASE" > "$STAGE/_info.txt"
[ -d "$KAMIHIME" ] && { echo "== kamihime：$KAMIHIME"; "$PY" "$HELPER" kamihime "$KAMIHIME" "$STAGE/kamihime"; } || echo "(没找到目录：KAMIHIME = $KAMIHIME)"
echo "== 在 $BASE 下找场景目录 chara_0032_r18_1"; "$PY" "$HELPER" findscene "$BASE" "$STAGE/gc_scene" chara_0032_r18_1
echo "== 在 $BASE 下找带 asyncmoveobject / subimage / cgmode 的文件"; "$PY" "$HELPER" grep "$BASE" "$STAGE/utage_viewer" asyncmoveobject subimage cgmode
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)，$(tar -tzf "$OUT" | wc -l) 项）——把这个文件发给我"
