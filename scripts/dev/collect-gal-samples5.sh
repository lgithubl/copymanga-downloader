#!/usr/bin/env bash
# 第五轮样本（补缺口，内容很小）：ぼくら（槽位含义 + 图片文件对应）/ TSK（Master 完整行 + 命令直方图 + 骨架版本）/ Kamihime（不带 hash 的文件在哪）/ Grenze（立绘目录对应 + full_ani 骨架）。输出到一个文件（默认 ./gal-samples5.txt），发给我。
#   用法同上一个：BASE=/你的/游戏/父目录 bash collect-gal-samples5.sh（个别目录用变量覆盖：BOKUSEN=… TSK=… KAMI=… GRENZE=…）
#   只读；不复制、不打包任何资源；台词 / 标题里连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。
BASE="${BASE:-.}"
: "${BOKUSEN:=$BASE/ぼくらの放課後戦争}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
: "${KAMI:=$BASE/Kamihime_Player- 1.0}"
: "${GRENZE:=$BASE/GrenzeViewer}"
OUT="${OUT:-$PWD/gal-samples5.txt}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
SHAPE="$(mktemp)"; trap 'rm -f "$SHAPE"' EXIT
cat > "$SHAPE" <<'PYEOF'
import json, os, re, sys
path = sys.argv[1]; limit = int(sys.argv[2]) if len(sys.argv) > 2 else 40
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
raw = open(path, 'rb').read(); text = None
for enc in ('utf-8-sig', 'utf-16', 'cp932', 'gb18030'):
    try: text = raw.decode(enc); break
    except Exception: pass
if text is None: text = raw.decode('latin-1')
print('# %s  %d 字节' % (os.path.basename(path), len(raw)))
def walk(v, i=0, key='', deep=3):
    pad = '  ' * i
    if isinstance(v, dict):
        print('%s%s{} %d 键' % (pad, key, len(v)))
        for n, (k, x) in enumerate(v.items()):
            if n >= limit: print('%s  ...' % pad); break
            walk(x, i + 1, '%s: ' % mask(str(k)), deep)
    elif isinstance(v, list):
        print('%s%s[] %d 项' % (pad, key, len(v)))
        for n, x in enumerate(v[:deep]): walk(x, i + 1, '[%d] ' % n, deep)
    elif isinstance(v, str): print('%s%s"%s%s" (%d 字)' % (pad, key, mask(v[:60]), '…' if len(v) > 60 else '', len(v)))
    else: print('%s%s%s' % (pad, key, json.dumps(v, ensure_ascii=False)[:40]))
try: walk(json.loads(text), deep=int(os.environ.get('DEEP', '3')))
except Exception:
    for n, line in enumerate(text.splitlines()[:limit]): print('%3d| %s' % (n + 1, mask(line)[:160]))
PYEOF
shape() { "$PY" "$SHAPE" "$@"; }
sec() { printf '\n\n########## %s\n' "$*"; }
first_file() { find "$1" -maxdepth "${3:-1}" -type f -name "$2" 2>/dev/null | sort | head -1; }
need() { [ -d "$2" ] || { echo "(没找到目录：$1 = $2)"; return 1; }; echo "目录：$2"; }
mask_stream() { "$PY" -c "
import re,sys
CJK=re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
for l in sys.stdin: sys.stdout.write(CJK.sub(lambda m:'<%d字>'%len(m.group(0)),l))"; }

{
echo "收集时间：$(date '+%F %T')    BASE=$BASE"

sec "A. ぼくらの放課後戦争：参数槽位的含义 + images[] 和磁盘文件的对应"
if need BOKUSEN "$BOKUSEN"; then
  J="$BOKUSEN/json/20013 小春－初H.json"; [ -f "$J" ] || J="$(first_file "$BOKUSEN/json" '*.json')"
  echo "json：${J#$BOKUSEN/}"
  "$PY" - "$J" "$BOKUSEN/resource" <<'PYEOF'
import collections, json, os, re, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
J, RES = sys.argv[1], sys.argv[2]
d = json.load(open(J, encoding='utf-8-sig'))['data']['code']
tags, cmds, params, images, sounds = d['tags'], d['commands'], d['parameters'], d['images'], d['sounds']
ext = lambda lst: dict(collections.Counter(os.path.splitext(x)[1].lower() for x in lst))
print('images 共 %d 个，扩展名 %s；sounds 共 %d 个，扩展名 %s' % (len(images), ext(images), len(sounds), ext(sounds)))
cnt = collections.Counter(tags[int(c[0])] for c in cmds)
print('命令数：image=%d playse=%d fadese=%d animstart=%d playbgm=%d' % (cnt['image'], cnt['playse'], cnt['fadese'], cnt['animstart'], cnt['playbgm']))
print('参数组每组的长度（前 5 组）:', [len(p) for p in params[:5]])
print('-- 每种 tag 用到的槽位（槽位: 出现次数；取值不超过 6 种的槽位把取值列出来）：')
per = collections.defaultdict(list)
for c in cmds: per[tags[int(c[0])]].append(params[int(c[1])])
for t, ps in sorted(per.items(), key=lambda kv: -len(kv[1])):
    slots = collections.defaultdict(collections.Counter)
    for p in ps:
        for i, v in enumerate(p):
            if v != 'nil': slots[i][v] += 1
    out = {}
    for i, c in sorted(slots.items()):
        out[i] = '%d次 %s' % (sum(c.values()), sorted(mask(k) for k in c)) if len(c) <= 6 else '%d次 %d种取值' % (sum(c.values()), len(c))
    print('  %s(%d 条): %s' % (t, len(ps), out))
print('-- 前 10 条 image 命令（顺序号 / 非 nil 槽位）：')
n = 0
for c in cmds:
    if tags[int(c[0])] != 'image': continue
    print('  order=%s  %s' % (c[2], {i: mask(v) for i, v in enumerate(params[int(c[1])]) if v != 'nil'}))
    n += 1
    if n >= 10: break
print('-- images[] 前 12 个（下标: 文件名）:', {i: x.split('/')[-1] for i, x in enumerate(images[:12])})
base = os.path.splitext(os.path.basename(J))[0]
dirs = os.listdir(RES) if os.path.isdir(RES) else []
tail = re.search(r'(\d+)$', base)
cand = [x for x in dirs if x == base] or [x for x in dirs if x.split(' ')[0] == base.split(' ')[0]] or ([x for x in dirs if x.endswith(tail.group(1))] if tail else [])
print('-- resource 里和这个 json 对应的目录：', cand[:3])
if cand:
    rd = os.path.join(RES, cand[0])
    for sub in sorted(os.listdir(rd)):
        p = os.path.join(rd, sub)
        if not os.path.isdir(p): print('  [文件] %s  %d 字节' % (sub, os.path.getsize(p))); continue
        names = sorted(os.listdir(p), key=lambda s: [int(x) if x.isdigit() else x for x in re.split(r'(\d+)', s)])
        print('  [%s] %d 个，扩展名 %s' % (sub, len(names), dict(collections.Counter(os.path.splitext(x)[1].lower() for x in names))))
        print('      前 30 个:', names[:30])
        nums = sorted(int(m.group(1)) for m in (re.match(r'(\d+)\.', x) for x in names) if m)
        if nums: print('      数字序号范围 %d..%d，缺的序号:' % (nums[0], nums[-1]), [i for i in range(nums[0], nums[-1] + 1) if i not in nums][:30])
PYEOF
fi

sec "B. Twinkle Star Knights X：Master 完整行 + 命令直方图 + 骨架版本"
if need TSK "$TSK"; then
  SA="$TSK/Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X"
  M="$(find "$TSK" -type f -name 'Master.chapter.json' 2>/dev/null | head -1)"
  echo "Master：${M#$TSK/}"
  [ -n "$M" ] && "$PY" - "$M" <<'PYEOF'
import collections, json, re, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))
def rows(g): return [r for r in g['rows'] if not r.get('isEmpty') and not r.get('isCommentOut')]
def cells(r): return {i: mask(c)[:90] for i, c in enumerate(r['strings']) if c != ''}
for g in d['settingList']:
    name = g['name'].split(':')[-1]
    rs = rows(g)
    if name not in ('Character', 'Texture', 'Sound', 'Layer'): continue
    print('=== %s  有效行 %d' % (name, len(rs)))
    print('  表头:', cells(rs[0]))
    if name == 'Character':
        print('  FileType 取值:', dict(collections.Counter(r['strings'][12] if len(r['strings']) > 12 else '' for r in rs[1:])))
        for r in rs[1:4]: print('  ', cells(r))
        seen = set()
        for r in rs[1:]:
            s = r['strings']; k = (s[12] if len(s) > 12 else '', bool(s[3]) if len(s) > 3 else False, bool(s[11]) if len(s) > 11 else False)
            if k not in seen: seen.add(k); print('   [不同写法 FileType/有Pattern/有SubFileName=%s]' % (k,), cells(r))
            if len(seen) >= 6: break
    else:
        col = 2 if name == 'Texture' else 3
        by = collections.defaultdict(list)
        for r in rs[1:]:
            s = r['strings']; by[s[col] if len(s) > col else ''].append(r)
        for t, lst in by.items(): print('  Type=%s 共 %d 行；例:' % (t, len(lst)), cells(lst[0]))
PYEOF
  echo "-- 全部 book.json 的命令直方图（Command 列；空 = 台词 / 立绘行）："
  "$PY" - "$TSK" <<'PYEOF'
import collections, glob, json, os, re, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
files = sorted(glob.glob(os.path.join(sys.argv[1], '**', '*.book.json'), recursive=True))
print('book.json 共 %d 个；统计前 300 个' % len(files))
cmd, wait, page, win, arg2 = (collections.Counter() for _ in range(5)); ex = {}; off = []; tween = {}
for f in files[:300]:
    try: d = json.load(open(f, encoding='utf-8-sig'))
    except Exception: continue
    for g in d.get('importGridList', []):
        for r in g['rows']:
            if r.get('isEmpty') or r.get('isCommentOut'): continue
            s = r['strings'] + [''] * (17 - len(r['strings']))
            c = s[0] or ('(空命令·有Text)' if s[13] else '(空命令·无Text)')
            cmd[c] += 1; wait[s[12]] += 1; page[s[14]] += 1; win[s[16]] += 1
            if s[2]: arg2[s[2]] += 1
            ex.setdefault(c, {i: mask(v)[:50] for i, v in enumerate(s) if v != ''})
            if s[2] == '<Off>' and len(off) < 4: off.append({i: mask(v)[:50] for i, v in enumerate(s) if v != ''})
            if s[0] == 'Tween': tween.setdefault(s[2], {i: mask(v)[:50] for i, v in enumerate(s) if v != ''})
for c, n in cmd.most_common(40): print('  %-22s %6d   例: %s' % (c, n, ex[c]))
print('WaitType 取值:', dict(wait.most_common(10)))
print('PageCtrl 取值:', dict(page.most_common(10)))
print('WindowType 取值:', dict(win.most_common(10)))
print('Arg2 取值（前 20）:', dict(arg2.most_common(20)))
print('Arg2=<Off> 的行:', off)
print('Tween 的 Arg2 各一例:', tween)
PYEOF
  echo "-- 骨架文件头（版本号）："
  for d in Characters Stills; do
    S="$(find "$SA/$d" -type f \( -name '*.skel.bytes' -o -name '*.skel' -o -name '*.skeleton' \) 2>/dev/null | sort | head -1)"
    if [ -n "$S" ]; then echo "  [$d] ${S#$SA/}  $(wc -c < "$S") 字节"; head -c 64 "$S" | od -An -c | head -4
    else J2="$(find "$SA/$d" -type f -name '*.json' 2>/dev/null | head -1)"; echo "  [$d] 没有二进制骨架；json：${J2#$SA/}"; [ -n "$J2" ] && head -c 200 "$J2" | mask_stream; echo; fi
  done
  echo "-- Characters 里一个角色目录的全部文件（含大小）："
  CD="$(find "$SA/Characters" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | head -1)"; echo "  ${CD#$SA/}"; ls -l "$CD" 2>/dev/null | tail -n +2 | awk '{print "    " $5 "  " $9}' | head -20
  echo "-- Characters / Stills 各有多少个目录："; for d in Characters Stills; do echo "  $d: $(find "$SA/$d" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"; done
fi

sec "C. Kamihime：不带 hash 的文件在哪"
if need KAMI "$KAMI"; then
  A="$KAMI/game/dmm/assets"
  echo "-- assets 平铺层：总文件数 / 名字带 -<sha1> 的 / 不带的："
  echo "  $(find "$A" -maxdepth 1 -type f 2>/dev/null | wc -l) / $(find "$A" -maxdepth 1 -type f 2>/dev/null | grep -c -E -- '-[0-9a-f]{40}\.') / $(find "$A" -maxdepth 1 -type f 2>/dev/null | grep -v -c -E -- '-[0-9a-f]{40}\.')"
  echo "  不带 hash 的前 8 个："; find "$A" -maxdepth 1 -type f 2>/dev/null | grep -v -E -- '-[0-9a-f]{40}\.' | sort | head -8 | sed "s#$A/#    #"
  echo "  子目录个数（48 位十六进制名）："; echo "    $(find "$A" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
  K="$(find "$KAMI/game/dmm/raw_scenario" -type f -name '*_script.ks' 2>/dev/null | sort | head -1)"; echo "样例脚本：${K#$KAMI/}"
  echo "-- 样例脚本里不带 hash 的 storage= 引用，逐个在整个游戏目录里找（前缀匹配，不要求扩展名）："
  grep -o -E 'storage="[^"]+"' "$K" | sed 's/storage="//; s/"$//' | sort -u | grep -v -E -- '-[0-9a-f]{40}\.' | head -14 | while IFS= read -r f; do
    stem="${f%.*}"; echo "  [$f]"; find "$KAMI" \( -name "${stem}.*" -o -name "${stem}-*" \) -not -path '*/__pycache__/*' 2>/dev/null | head -3 | sed "s#$KAMI/#      -> #"
  done
  echo "-- 同目录 json 里的 resource_directory 在磁盘上的位置，及其内容："
  RD="$("$PY" -c "import json,sys; print(json.load(open(sys.argv[1],encoding='utf-8-sig')).get('resource_directory',''))" "${K%_script.ks}.json" 2>/dev/null)"; echo "  resource_directory=$RD"
  [ -n "$RD" ] && find "$KAMI" -type d -name "$RD" 2>/dev/null | head -3 | while IFS= read -r d; do echo "  ${d#$KAMI/}  ($(ls -1 "$d" | wc -l) 个)"; ls -1 "$d" | head -10 | sed 's/^/      /'; done
  echo "-- 样例脚本里的 playse / playbgm / voice 相关写法（各 5 条）："
  for t in playse playbgm stopbgm voice; do echo "  [$t]"; grep -h -o -E "\[$t [^]]*\]" "$K" | sort -u | head -5 | cut -c1-200; done
  echo "-- chara_show / chara_hide / chara_move 里出现过的属性（出现次数）："
  grep -h -o -E '\[chara_(show|hide|move)[^]]*\]' "$K" | grep -o -E ' [a-z_]+=' | sort | uniq -c | sort -rn | head -12
  echo "-- 全部 .ks 的标签直方图（前 300 个文件，前 45 个标签）："
  find "$KAMI/game/dmm/raw_scenario" -type f -name '*_script.ks' 2>/dev/null | sort | head -300 | xargs -d '\n' cat 2>/dev/null | grep -o -E '^\[[a-z_0-9]+' | sort | uniq -c | sort -rn | head -45 | tr '\n' ';'; echo
fi

sec "D. GrenzeViewer：立绘目录对应 + full_ani 骨架 + 对话取值"
if need GRENZE "$GRENZE"; then
  X="$GRENZE/TextAsset/easy_dialog-1.xml"; [ -f "$X" ] || X="$(first_file "$GRENZE/TextAsset" 'easy_dialog*.xml')"
  P="$GRENZE/assets/resources/patchres/merc"
  echo "-- 对话里 hero_group_id 出现最多的 10 个，在 merc/pic 和 merc/full_ani 下有没有同名目录："
  grep -o -E ' hero_group_id="[^"]*"' "$X" | sort | uniq -c | sort -rn | head -10 | while read -r n v; do
    id="${v#hero_group_id=\"}"; id="${id%\"}"
    echo "  $id (出现 $n 次): pic=$([ -d "$P/pic/$id" ] && echo 有 || echo 无)  full_ani=$([ -d "$P/full_ani/$id" ] && echo 有 || echo 无)  其他匹配: $(find "$P" -maxdepth 2 -name "*$id*" 2>/dev/null | head -3 | sed "s#$P/##" | tr '\n' ' ')"
  done
  echo "-- merc/pic 目录个数 + 前 12 个名字；merc/full_ani 目录个数 + 前 12 个名字："
  echo "  pic: $(find "$P/pic" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)  $(find "$P/pic" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | head -12 | sed 's#.*/##' | tr '\n' ' ')"
  echo "  full_ani: $(find "$P/full_ani" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)  $(find "$P/full_ani" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | head -12 | sed 's#.*/##' | tr '\n' ' ')"
  PD="$P/pic/101011"; [ -d "$PD" ] || PD="$(find "$P/pic" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | head -1)"
  echo "-- 一个 pic 目录的全部文件（含大小）：${PD#$GRENZE/}"; ls -l "$PD" 2>/dev/null | tail -n +2 | awk '{print "    " $5 "  " $9}' | head -20
  PJ="$(find "$PD" -maxdepth 1 -type f -name '*.json' ! -name '*AssetBundle*' ! -name '*MonoScript*' 2>/dev/null | head -1)"; echo "-- 它的 json（${PJ#$GRENZE/}）结构："; [ -n "$PJ" ] && DEEP=3 shape "$PJ" 40
  echo "-- webp 尺寸（头 30 字节）："; for w in "$PD"/*.webp; do [ -f "$w" ] && { echo "  ${w##*/}"; head -c 30 "$w" | od -An -c | head -2; }; done 2>/dev/null | head -8
  echo "-- full_ani：骨架文件个数（按扩展名）："
  for e in 'skel.bytes' 'skel.asset' 'atlas.txt' 'atlas.asset' 'json'; do echo "  *.$e: $(find "$P/full_ani" -type f -name "*.$e" 2>/dev/null | wc -l)"; done
  FD="$(find "$P/full_ani" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | head -1)"; echo "-- 一个 full_ani 目录的全部文件（含大小）：${FD#$GRENZE/}"; ls -l "$FD" 2>/dev/null | tail -n +2 | awk '{print "    " $5 "  " $9}' | head -20
  SK="$(find "$FD" -maxdepth 1 -type f \( -name '*.skel.bytes' -o -name '*.skel.asset' \) 2>/dev/null | head -1)"; echo "-- 骨架文件头（${SK#$GRENZE/}）："; [ -n "$SK" ] && head -c 96 "$SK" | od -An -c | head -6
  AT="$(find "$FD" -maxdepth 1 -type f \( -name '*.atlas.txt' -o -name '*.atlas.asset' \) 2>/dev/null | head -1)"; echo "-- atlas 前 12 行（${AT#$GRENZE/}）："; [ -n "$AT" ] && head -c 800 "$AT" | head -12
  echo "-- 对话里各取值的出现次数（pic_pos / pic_face / screen_effect / pic_action / effect / effect_pos）："
  for a in pic_pos pic_face screen_effect pic_action effect effect_pos; do echo "  $a: $(grep -o -E " $a=\"[^\"]*\"" "$X" | sort | uniq -c | sort -rn | head -12 | awk '{printf "%s×%s  ", $2, $1}')"; done
  echo "-- 带立绘的普通对话行 3 条（文本屏蔽）："; grep -m3 -E 'hero_group_id=.* pic_pos=' "$X" | cut -c1-360 | mask_stream
  echo "-- voice 目录一个例子："; VD="$(find "$GRENZE/assets/resources/patchres/voice" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | head -1)"; echo "  ${VD#$GRENZE/}  ($(ls -1 "$VD" 2>/dev/null | wc -l) 个)"; ls -1 "$VD" 2>/dev/null | head -6 | sed 's/^/    /'
fi

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1
echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
