#!/usr/bin/env bash
# 第六轮样本：Grenze（立绘目录完整内容 / 图片尺寸 / merc/ani / TextAsset）、TSK（Voice 与各命令完整行）、Kamihime（特效标签写法 / 缺失文件统计）、ぼくら（槽位假设的反例检查）。输出到一个文件（默认 ./gal-samples6.txt），发给我。
#   用法同上一个：BASE=/你的/游戏/父目录 bash collect-gal-samples6.sh（个别目录用变量覆盖：BOKUSEN=… TSK=… KAMI=… GRENZE=…）
#   只读；不复制、不打包任何资源；台词 / 标题里连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。
BASE="${BASE:-.}"
: "${BOKUSEN:=$BASE/ぼくらの放課後戦争}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
: "${KAMI:=$BASE/Kamihime_Player- 1.0}"
: "${GRENZE:=$BASE/GrenzeViewer}"
OUT="${OUT:-$PWD/gal-samples6.txt}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
HELPER="$(mktemp)"; trap 'rm -f "$HELPER"' EXIT
cat > "$HELPER" <<'PYEOF'
import json, os, re, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
def img_size(path):
    """png / webp(VP8, VP8L, VP8X) 的宽高；认不出来返回 None"""
    try:
        with open(path, 'rb') as f: b = f.read(64)
    except Exception: return None
    if b[:8] == b'\x89PNG\r\n\x1a\n': return struct.unpack('>II', b[16:24])
    if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
        k = b[12:16]
        if k == b'VP8L' and b[20] == 0x2f:
            v = struct.unpack('<I', b[21:25])[0]; return ((v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1)
        if k == b'VP8X': return (int.from_bytes(b[24:27], 'little') + 1, int.from_bytes(b[27:30], 'little') + 1)
        if k == b'VP8 ': return (struct.unpack('<H', b[26:28])[0] & 0x3fff, struct.unpack('<H', b[28:30])[0] & 0x3fff)
    return None
def listing(d, limit=200):
    for n in sorted(os.listdir(d))[:limit]:
        p = os.path.join(d, n)
        if os.path.isdir(p): print('    [目录] %s  (%d 项)' % (n, len(os.listdir(p)))); continue
        s = img_size(p) if n.lower().endswith(('.png', '.webp')) else None
        print('    %8d  %s%s' % (os.path.getsize(p), n, '  %dx%d' % s if s else ''))
PYEOF
sec() { printf '\n\n########## %s\n' "$*"; }
need() { [ -d "$2" ] || { echo "(没找到目录：$1 = $2)"; return 1; }; echo "目录：$2"; }

{
echo "收集时间：$(date '+%F %T')    BASE=$BASE"

sec "D. GrenzeViewer：立绘（merc/pic）完整内容、尺寸、merc/ani、TextAsset"
if need GRENZE "$GRENZE"; then
  P="$GRENZE/assets/resources/patchres"
  echo "-- patchres 一级目录（项数）："; for d in "$P"/*/; do echo "  $(basename "$d"): $(find "$d" -mindepth 1 -maxdepth 1 | wc -l)"; done
  echo "-- merc 下的目录（项数）："; for d in "$P"/merc/*/; do echo "  $(basename "$d"): $(find "$d" -mindepth 1 -maxdepth 1 | wc -l)"; done
  echo "-- pic/101011 的完整列表（含尺寸，不截断）："
  "$PY" - "$HELPER" "$P/merc/pic/101011" <<'PYEOF'
import os, sys
exec(open(sys.argv[1]).read())
d = sys.argv[2]
if os.path.isdir(d): listing(d)
else: print('  (没有这个目录)')
PYEOF
  echo "-- 其他 pic 目录：取 4 个不同形态的（有 body.webp / 名字带 card / 名字 8 位 / 名字 7 位 701xxx）各列完整内容："
  for pat in 'body.webp' ; do :; done
  "$PY" - "$HELPER" "$P/merc/pic" <<'PYEOF'
import os, re, sys
exec(open(sys.argv[1]).read())
root = sys.argv[2]
names = sorted(os.listdir(root)) if os.path.isdir(root) else []
picks, seen = [], set()
def add(tag, n):
    if n and tag not in seen: seen.add(tag); picks.append((tag, n))
for n in names:
    p = os.path.join(root, n)
    if not os.path.isdir(p): continue
    fs = os.listdir(p)
    if 'body.webp' in fs: add('有 body.webp', n)
    if n.startswith('card'): add('card 开头', n)
    if re.fullmatch(r'\d{8}', n): add('8 位数字', n)
    if re.fullmatch(r'701\d{3}', n): add('701xxx', n)
    if re.fullmatch(r'\d{1,3}', n): add('1~3 位数字', n)
print('  pic 目录名长度分布:', {k: sum(1 for n in names if len(n) == k) for k in sorted({len(n) for n in names})})
for tag, n in picks:
    print('  [%s] %s' % (tag, n)); listing(os.path.join(root, n), 40)
PYEOF
  echo "-- pic/101011 里 Sprite 相关 json（若有）的结构；没有的话列出 pic/101011 里所有 .json 文件名："
  S="$(find "$P/merc/pic/101011" -maxdepth 1 -type f -iname 'sprite*' 2>/dev/null | head -1)"
  if [ -n "$S" ]; then echo "  ${S#$GRENZE/}"; "$PY" - "$S" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))
print(json.dumps(d, ensure_ascii=False)[:1200])
PYEOF
  else find "$P/merc/pic/101011" -maxdepth 1 -name '*.json' 2>/dev/null | sed 's#.*/#    #'; fi
  echo "-- merc/ani：目录个数、前 10 个名字、一个目录的完整内容："
  AD="$P/merc/ani"; echo "  个数: $(find "$AD" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)  前 10: $(find "$AD" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | head -10 | sed 's#.*/##' | tr '\n' ' ')"
  "$PY" - "$HELPER" "$AD/101032" <<'PYEOF'
import os, sys
exec(open(sys.argv[1]).read())
d = sys.argv[2]
if os.path.isdir(d): print('  [ani/101032]'); listing(d, 40)
PYEOF
  F="$(find "$AD/101032" -maxdepth 1 -type f \( -name '*.skel.*' -o -name '*.skeleton*' \) 2>/dev/null | head -1)"; [ -n "$F" ] && { echo "  骨架头（${F#$GRENZE/}）："; head -c 64 "$F" | od -An -c | head -3; }
  echo "-- hero_group_id=104 这种短 id 在 pic 下的目录："; ls -1 "$P/merc/pic/104" 2>/dev/null | head -12 | sed 's/^/    /'
  echo "-- TextAsset 目录里的文件（含大小，前 50 个）："; ls -l "$GRENZE/TextAsset" 2>/dev/null | tail -n +2 | awk '{print "    " $5 "  " $9}' | head -50
  X="$GRENZE/TextAsset/easy_dialog-1.xml"
  echo "-- easy_dialog-1.xml 里出现过的全部属性名（出现次数）："; grep -o -E ' [a-z_0-9]+="' "$X" 2>/dev/null | sort | uniq -c | sort -rn | head -30 | awk '{printf "%s%s  ", $2, $1}'; echo
fi

sec "B. Twinkle Star Knights X：Voice 与各命令的完整行"
if need TSK "$TSK"; then
  SA="$TSK/Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X"
  "$PY" - "$TSK" "$SA" <<'PYEOF'
import collections, glob, json, os, re, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
root, sa = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(root, '**', '*.book.json'), recursive=True))[:300]
show = lambda s: {i: mask(v)[:60] for i, v in enumerate(s) if v != ''}
want = {'Selection': 4, 'Jump': 2, 'BgEvent': 6, 'Shake': 3, 'ZoomCamera': 3, 'Param': 2, 'BgVoice': 3, 'BgSe': 2, 'Se': 2, 'Sprite': 5, 'SpriteOff': 2, 'WaitCustom': 2, 'ImageEffectOff': 2, 'ChangeSoundVolume': 2}
ex = collections.defaultdict(list); voice = []; pattern_rows = 0; nxt = {}
argtypes = collections.Counter(); bgevent_anim = collections.Counter()
for f in files:
    try: d = json.load(open(f, encoding='utf-8-sig'))
    except Exception: continue
    for g in d.get('importGridList', []):
        rows = [r for r in g['rows'] if not r.get('isEmpty') and not r.get('isCommentOut')]
        for i, r in enumerate(rows):
            s = r['strings'] + [''] * (17 - len(r['strings']))
            if s[15] and len(voice) < 8 and s[15] != 'Voice': voice.append(s[15])
            c = s[0]
            if c in want and len(ex[c]) < want[c]: ex[c].append(show(s))
            if c == 'BgEvent': bgevent_anim[s[8]] += 1
            if s[0] == '' and s[2].startswith('<Character='): argtypes['<Character=..>'] += 1
            if c == 'Selection' and len(ex['Selection+next']) < 2: ex['Selection+next'].append([show((rows[j]['strings'] + [''] * 17)) for j in range(i, min(i + 4, len(rows)))])
print('-- Voice 列样例:', voice)
for c, lst in ex.items():
    print('-- %s 完整行:' % c)
    for x in lst: print('    ', x)
print('-- BgEvent 的 SpineAnim 取值:', dict(bgevent_anim.most_common(8)))
print('-- 台词行 Arg2 为 <Character=…> 的行数:', argtypes['<Character=..>'])
for e in ('Sound/Se', 'Sound/BgSe', 'Sound/Voice', 'Sound/BgVoice', 'Sound'):
    p = os.path.join(sa, e)
    if os.path.isdir(p): print('-- %s 下前 6 项:' % e, sorted(os.listdir(p))[:6])
PYEOF
  echo "-- Voice 样例对应的文件（按第一个 Voice 值在 StreamingAssets 下找）："
  V="$("$PY" - "$TSK" <<'PYEOF'
import glob, json, os, sys
for f in sorted(glob.glob(os.path.join(sys.argv[1], '**', '*.book.json'), recursive=True))[:50]:
    try: d = json.load(open(f, encoding='utf-8-sig'))
    except Exception: continue
    for g in d.get('importGridList', []):
        for r in g['rows']:
            s = r['strings']
            if len(s) > 15 and s[15] and s[15] != 'Voice': print(s[15]); sys.exit()
PYEOF
)"; echo "  Voice=$V"; [ -n "$V" ] && find "$TSK" -iname "*$V*" 2>/dev/null | head -4 | sed "s#$TSK/#    -> #"
  echo "-- BgVoice 样例 b001_002_0068 / SE_3002 在磁盘上的位置："; for n in b001_002_0068 SE_3002; do echo "  [$n]"; find "$TSK" -iname "*$n*" 2>/dev/null | head -3 | sed "s#$TSK/#    -> #"; done
fi

sec "C. Kamihime：特效标签写法 + 缺失文件统计"
if need KAMI "$KAMI"; then
  R="$KAMI/game/dmm/raw_scenario"
  echo "-- 各特效标签的完整写法（去重后各 6 条）："
  for t in anim quake layopt image frame kanim freeimage wait wa chara_hide bg; do
    echo "  [$t]"; find "$R" -type f -name '*_script.ks' 2>/dev/null | sort | head -300 | xargs -d '\n' grep -h -o -E "^\[$t( [^]]*)?\]" 2>/dev/null | sed -E 's/-[0-9a-f]{40}/-<hash>/g' | sort | uniq -c | sort -rn | head -6 | cut -c1-220
  done
  echo "-- 台词行 / 说话人行的写法（取 1 个脚本里 #name 行后面的 3 行，屏蔽）："
  K="$(find "$R" -type f -name '*_script.ks' 2>/dev/null | sort | head -1)"; grep -n -m3 -A3 '^#' "$K" 2>/dev/null | cut -c1-200 | "$PY" -c "
import re,sys
CJK=re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
for l in sys.stdin: sys.stdout.write(CJK.sub(lambda m:'<%d字>'%len(m.group(0)),l))"
  echo "-- 40 个脚本里：storage= 引用总数 / 能在 assets 找到的 / 找不到的（不带 hash 的按名字前缀匹配；带 hash 的按全名；再查 resource_directory）："
  "$PY" - "$KAMI/game/dmm" <<'PYEOF'
import collections, glob, json, os, re, sys
dmm = sys.argv[1]; A = os.path.join(dmm, 'assets')
flat = set(); stems = set(); dirs = {}
for n in os.listdir(A):
    p = os.path.join(A, n)
    if os.path.isdir(p): dirs[n] = set(os.listdir(p))
    else:
        flat.add(n); stems.add(re.sub(r'-[0-9a-f]{40}(?=\.)', '', n))
files = sorted(glob.glob(os.path.join(dmm, 'raw_scenario', '**', '*_script.ks'), recursive=True))
step = max(1, len(files) // 40); picked = files[::step][:40]
tot = ok = 0; miss = collections.Counter(); kinds = collections.Counter()
for f in picked:
    text = open(f, encoding='utf-8-sig', errors='replace').read()
    rd = ''
    try: rd = json.load(open(f[:-len('_script.ks')] + '.json', encoding='utf-8-sig')).get('resource_directory', '')
    except Exception: pass
    for s in set(re.findall(r'storage="([^"]+)"', text)):
        if s.endswith(('.ks',)): continue
        tot += 1
        hashed = re.search(r'-[0-9a-f]{40}\.', s) is not None
        found = (s in flat) if hashed else ((s in stems) or (s in dirs.get(rd, ())))
        kind = ('带hash' if hashed else '不带hash') + os.path.splitext(s)[1]
        kinds[(kind, found)] += 1
        if found: ok += 1
        elif len(miss) < 12: miss[s] += 1
print('  脚本 %d 个（共 %d 个），引用 %d，找到 %d，找不到 %d' % (len(picked), len(files), tot, ok, tot - ok))
for (k, f), n in sorted(kinds.items()): print('   %-14s %s %d' % (k, '找到' if f else '找不到', n))
print('  找不到的前 12 个:', list(miss))
PYEOF
fi

sec "A. ぼくら：槽位假设的反例检查（全部 json）"
if need BOKUSEN "$BOKUSEN"; then
  "$PY" - "$BOKUSEN" <<'PYEOF'
import collections, glob, json, os, re, sys
root = sys.argv[1]
bad = collections.Counter(); n = 0; anim = []; ids = collections.Counter(); sevar = collections.Counter(); resmiss = 0; resok = 0
for f in sorted(glob.glob(os.path.join(root, 'json', '*.json'))):
    try: d = json.load(open(f, encoding='utf-8-sig'))['data']['code']
    except Exception: bad['解析失败'] += 1; continue
    n += 1
    tags, cmds, params, imgs, snds = d['tags'], d['commands'], d['parameters'], d['images'], d['sounds']
    last = -1
    for c in cmds:
        t = tags[int(c[0])]; p = params[int(c[1])]; o = int(c[2])
        if o < last: bad['顺序号不单调'] += 1
        last = o
        if t == 'image':
            v = p[28] if len(p) > 28 else 'nil'
            if v == 'nil' or not v.isdigit() or int(v) >= len(imgs): bad['image 槽28 不是 images 下标'] += 1
        if t == 'playse':
            v = p[2] if len(p) > 2 else 'nil'
            if v == 'nil' or not v.isdigit() or int(v) >= len(snds): bad['playse 槽2 不是 sounds 下标'] += 1
        if t == 'articles':
            v = p[0]
            if v == 'nil' or not v.isdigit() or int(v) >= len(d['articles']): bad['articles 槽0 不是下标'] += 1
        if t == 'animstart':
            fr = p[9].split() if len(p) > 9 and p[9] != 'nil' else []
            if any((not x.isdigit()) or int(x) >= len(imgs) for x in fr): bad['animstart 槽9 帧不是下标'] += 1
            if len(anim) < 8: anim.append({i: v for i, v in enumerate(p) if v != 'nil' and i != 9} | {'帧数': len(fr), '帧头': fr[:4]})
        if t == 'image':
            for i in (16, 22):
                if len(p) > i and p[i] != 'nil': ids[(i, p[i])] += 1
    base = os.path.splitext(os.path.basename(f))[0]
    res = os.path.join(root, 'resource', base)
    if os.path.isdir(res):
        resok += 1
        im = os.path.join(res, 'images')
        for i, x in enumerate(imgs):
            if not os.path.exists(os.path.join(im, '%d%s' % (i, os.path.splitext(x)[1]))): bad['images/<i>.<ext> 不存在'] += 1; break
    else: resmiss += 1
print('json %d 个；resource 同名目录 找到 %d / 找不到 %d' % (n, resok, resmiss))
print('反例统计（空 = 没有反例）:', dict(bad))
print('image 槽16 / 槽22 的取值统计:', dict(ids))
print('animstart 样例（除帧列表外的槽）:')
for a in anim: print('   ', a)
PYEOF
fi

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1
echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
