#!/usr/bin/env bash
# 第十七轮样本（补第十六轮的缺口，一次跑完；文本脱敏，最后打成 tar.gz）：
#   GC 行式脚本（Girls Creation R / 282寝）：每种命令的完整参数样例 + 6 个命令种类最多的完整脚本（subimage / asyncmoveobject / CrossFade / emote… 的真实写法）
#   Grenze：全部 easy_dialog-N.xml 的属性 / 取值统计（screen_effect / effect / pic_action / pic_pos / pic_size …各有哪些值）+ 每个文件的编码（有的不是 UTF-8）
#   GC 系列各游戏（每个 id 一个变量）：maid 里 cast006001 / story1010063（粗糙的立绘）、各游戏的 scenes 数量和命令形式（行式 / 标签式）
#   ぼくら：resource 目录里 1 个有 se / images 的完整样例的文件清单 + 脚本里 move / se 命令的全部写法
# 输出 ./gal-samples17.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples17.sh
#   每个游戏一个变量（= 一个 id），目录名不对就覆盖：ASTER= GC= GC282= MAID= JAXIN= AKU= FRUITS= GRENZE= BOKUSEN=；还要多扫别的目录就 EXTRA="目录1:目录2"。
#   只读原目录；只在这些游戏目录里找（不扫 BASE）；不复制音频、视频、图片；文本里连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。单个文件超过 3MB 只取前 3MB。
BASE="${BASE:-.}"
: "${ASTER:=$BASE/Angelica Aster R Viewer}"
: "${GC:=$BASE/Girls Creation R Viewer}"
: "${GC282:=$BASE/Girls Creation R Viewer 282寝}"
: "${MAID:=$BASE/スイートホームメイド}"
: "${JAXIN:=$BASE/邪神戦記ルルイエ少女隊 X　〜クトゥルフ神話TD〜Viewer}"
: "${AKU:=$BASE/Aku No Onna Kanbu - Perigee New Moon Viewer}"
: "${FRUITS:=$BASE/Fruits Fulcute!}"
: "${GRENZE:=$BASE/GrenzeViewer}"
: "${BOKUSEN:=$BASE/ぼくらの放課後戦争}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples17.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import collections, json, os, re, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
TEXT = {'.txt', '.json', '.rpy', '.ks', '.csv', '.xml', '.atlas', '.plist', '.js', '.html', '.htm', '.css', '.tsv', '.md', ''}
LIMIT = 3 * 1024 * 1024
SKIP = {'node_modules', 'runtime', 'locales', 'Python27', 'renpy'}
def dec(raw):
    for enc in ('utf-8-sig', 'cp932', 'gb18030'):
        try: return raw.decode(enc), enc
        except Exception: pass
    return raw.decode('utf-8', 'replace'), 'utf-8(replace)'
def put(src, dst):
    if os.path.splitext(src)[1].lower() not in TEXT: return None
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    open(dst, 'w', encoding='utf-8').write(mask(dec(open(src, 'rb').read(LIMIT))[0])); return 'txt'
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

if mode == 'gcline':   # 行式脚本：hmr_*.txt / hsr_*.txt
    scenes = os.path.join(root, 'package.nw', 'scenes')
    if not os.path.isdir(scenes): scenes = os.path.join(root, 'scenes')
    scripts = [p for p in walk(scenes, set()) if re.fullmatch(r'(?:hmr|hsr)_\w+\.txt', os.path.basename(p))] if os.path.isdir(scenes) else []
    cmds = collections.defaultdict(collections.Counter); variety = []
    for p in scripts:
        lines = dec(open(p, 'rb').read(LIMIT))[0].splitlines(); seen = set()
        for l in lines:
            l = l.strip().lstrip('﻿')
            if not l: continue
            w = l.split(',')[0].strip(); seen.add(w); cmds[w][mask(l)[:300]] += 1
        variety.append((len(seen), p))
    with open(os.path.join(stage, '_arg_examples.txt'), 'w', encoding='utf-8') as f:
        f.write('行式脚本 %d 个\n' % len(scripts))
        for w, c in sorted(cmds.items(), key=lambda kv: -sum(kv[1].values())):
            if w in ('message', 'voice', 'msgvoicesync'): continue
            f.write('\n## %s  （%d 次，%d 种写法；前 40 种）\n' % (mask(w), sum(c.values()), len(c)))
            for line, n in c.most_common(40): f.write('%5d  %s\n' % (n, line))
    for _, p in sorted(variety, reverse=True)[:6]: put(p, os.path.join(stage, 'full', rel(p)))
    top = os.path.join(root, 'package.nw', 'data')
    print('  行式脚本 %d 个' % len(scripts))
elif mode == 'gcinfo':   # 每个 GC 系游戏：scenes 数量 + 脚本形式 + cast006001 / story1010063
    scenes = os.path.join(root, 'package.nw', 'scenes')
    if not os.path.isdir(scenes): scenes = os.path.join(root, 'scenes')
    kinds = collections.Counter(); n = 0
    for d in sorted(os.listdir(scenes)) if os.path.isdir(scenes) else []:
        fs = os.listdir(os.path.join(scenes, d)); n += 1
        kinds[tuple(sorted(f for f in fs if f.endswith('.txt')))[:3]] += 1
    open(os.path.join(stage, '_scenes.txt'), 'w', encoding='utf-8').write('场景目录 %d 个；里面的 .txt 组合（前 3 个文件名）：\n' % n + '\n'.join('%5d  %s' % (c, mask(str(k))) for k, c in kinds.most_common(12)))
    for d, ds, fs in os.walk(root):
        ds[:] = [x for x in ds if x not in SKIP]
        b = os.path.basename(d)
        if b == 'cast006001':
            with open(os.path.join(stage, '_cast006001.tsv'), 'w', encoding='utf-8') as f:
                for p in sorted(walk(d, set())):
                    wh = dims(p) if p.endswith('.png') else None
                    f.write('%s\t%d\t%s\n' % (mask(rel(p)), os.path.getsize(p), ('%dx%d' % wh) if wh else ''))
            for p in walk(d, set()):
                if p.endswith(('.atlas', '.json')) and os.path.getsize(p) < 3 * 1024 * 1024: put(p, os.path.join(stage, rel(p)))
        if b == 'story1010063' and 'script.txt' in fs: put(os.path.join(d, 'script.txt'), os.path.join(stage, 'script', rel(os.path.join(d, 'script.txt'))))
    for p in walk(root):
        if os.path.basename(p) in ('castData.js', 'castData.json', 'sceneData.js') and os.path.getsize(p) < 3 * 1024 * 1024: put(p, os.path.join(stage, 'data', os.path.basename(p)))
elif mode == 'grenzexml':
    xs = sorted(p for p in walk(root) if re.fullmatch(r'easy_dialog-\d+\.xml', os.path.basename(p)))
    attr_names = collections.Counter(); vals = collections.defaultdict(collections.Counter); enc = []
    for p in xs:
        raw = open(p, 'rb').read(); text, e = dec(raw); enc.append('%s\t%s\t%d' % (mask(rel(p)), e, len(raw)))
        for m in re.finditer(r'<[\w-]+\s([^>]*?)/?>', text):
            for k, v in re.findall(r'([\w]+)="([^"]*)"', m.group(1)):
                attr_names[k] += 1
                if k in ('screen_effect', 'effect', 'effect_pos', 'pic_action', 'pic_pos', 'pic_size', 'pic_face', 'pic_pos2', 'pic_action2', 'pic_face2', 'pic_size2', 'bg_sound1', 'sound1', 'voice_pack', 'transition', 'bgm', 'background', 'hero_group_id', 'name') or k.startswith(('pic_', 'effect', 'screen_')): vals[k][v if len(v) < 60 else v[:60]] += 1
    with open(os.path.join(stage, '_xml_stats.txt'), 'w', encoding='utf-8') as f:
        f.write('xml %d 个\n\n## 编码（解码成功的第一种）\n' % len(xs) + '\n'.join(enc) + '\n\n## 属性名出现次数\n' + '\n'.join('%8d  %s' % (c, k) for k, c in attr_names.most_common(80)))
        for k in sorted(vals):
            top = 60 if k in ('screen_effect', 'effect', 'effect_pos', 'pic_action', 'pic_pos', 'pic_size', 'pic_face', 'transition') else 12
            f.write('\n\n## %s 的取值（前 %d）\n' % (k, top) + '\n'.join('%8d  %s' % (c, mask(v)) for v, c in vals[k].most_common(top)))
elif mode == 'bokusen':
    res = os.path.join(root, 'resource')
    cmdstats = collections.defaultdict(collections.Counter)
    js = [p for p in walk(os.path.join(root, 'json'), set()) if p.endswith('.json')]
    for p in js[:400]:
        try: d = json.loads(dec(open(p, 'rb').read())[0])
        except Exception: continue
        code = (d.get('data') or {}).get('code') or {}
        for c in code.get('commands') or []:
            if isinstance(c, list) and c and isinstance(c[0], (str, int)): cmdstats[str(c[0])][json.dumps(c[1:], ensure_ascii=False)[:100]] += 1
    with open(os.path.join(stage, '_command_examples.txt'), 'w', encoding='utf-8') as f:
        f.write('脚本 %d 个（读前 400 个）；命令 → 参数样例（前 12 种）\n' % len(js))
        for k, c in sorted(cmdstats.items(), key=lambda kv: -sum(kv[1].values()))[:60]:
            f.write('\n## %s （%d 次）\n' % (mask(k), sum(c.values()))); f.write('\n'.join('%5d  %s' % (n, mask(v)) for v, n in c.most_common(12)))
    # 一个有 sounds 的完整资源目录样例
    if os.path.isdir(res):
        for n in sorted(os.listdir(res))[:400]:
            d = os.path.join(res, n)
            if os.path.isdir(os.path.join(d, 'sounds')) and len(os.listdir(os.path.join(d, 'sounds'))) > 5:
                with open(os.path.join(stage, '_sample_resource_dir.tsv'), 'w', encoding='utf-8') as f:
                    for p in sorted(walk(d, set()))[:300]:
                        wh = dims(p) if p.endswith('.png') else None
                        f.write('%s\t%d\t%s\n' % (mask(rel(p)), os.path.getsize(p), ('%dx%d' % wh) if wh else ''))
                break
PYEOF
echo "收集时间：$(date '+%F %T')    BASE=$BASE" > "$STAGE/_info.txt"
run() { local mode="$1" name="$2" dir="$3"; [ -n "$dir" ] && [ -d "$dir" ] || { echo "(没找到目录：$name = ${dir:-空})"; return; }; echo "== $name：$dir"; "$PY" "$HELPER" "$mode" "$dir" "$STAGE/$name"; }
run gcline gc_R "$GC"
run gcline gc_282 "$GC282"
for pair in "aster:$ASTER" "gc:$GC" "gc282:$GC282" "maid:$MAID" "jaxin:$JAXIN" "aku:$AKU" "fruits:$FRUITS"; do run gcinfo "gcinfo/${pair%%:*}" "${pair#*:}"; done
IFS=':' read -r -a EXTRA_DIRS <<< "$EXTRA"
for g in "${EXTRA_DIRS[@]}"; do [ -n "$g" ] && [ -d "$g" ] && run gcinfo "gcinfo/extra_$(basename "$g" | tr -c 'A-Za-z0-9\n' '_')" "$g"; done
run grenzexml grenze "$GRENZE"
run bokusen bokusen "$BOKUSEN"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)，$(tar -tzf "$OUT" | wc -l) 项）——把这个文件发给我"
