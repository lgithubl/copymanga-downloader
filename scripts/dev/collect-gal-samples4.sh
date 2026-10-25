#!/usr/bin/env bash
# 第四轮样本：ぼくら（命令表）/ TSK（台词行内容）/ Kamihime（hash 资源在磁盘上的位置）/ Grenze（对话行 + 资源对应 + 骨架版本）。输出到一个文件（默认 ./gal-samples4.txt），发给我。
#   用法同上一个：BASE=/你的/游戏/父目录 bash collect-gal-samples2.sh（个别目录用变量覆盖：AKU=… FRUITS=… 等）
#   只读；台词 / 标题里连续 3 个以上的中日文字符会被替换成 <N字>。
BASE="${BASE:-.}"
: "${AKU:=$BASE/Aku No Onna Kanbu - Perigee New Moon Viewer}"
: "${FRUITS:=$BASE/Fruits Fulcute!}"
: "${ANGELIC:=$BASE/angelic_py-1.0.2-pc}"
: "${MINASHIGO_R:=$BASE/ミナシゴノシゴトR}"
: "${BOKUSEN:=$BASE/ぼくらの放課後戦争}"
: "${MAGIC:=$BASE/魔法学园的少女们}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
: "${KAMI:=$BASE/Kamihime_Player- 1.0}"
: "${GRENZE:=$BASE/GrenzeViewer}"
OUT="${OUT:-$PWD/gal-samples4.txt}"
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
if os.environ.get('TAGS_ONLY'):
    lines = text.splitlines(); tags = [l for l in lines if l.startswith('<')]
    for l in tags[:limit]: print(mask(l)[:160])
    print('(非标签行 %d 行是台词；标签行共 %d 行)' % (len(lines) - len(tags), len(tags)))
else:
    try: walk(json.loads(text), deep=int(os.environ.get('DEEP', '3')))
    except Exception:
        for n, line in enumerate(text.splitlines()[:limit]): print('%3d| %s' % (n + 1, mask(line)[:160]))
PYEOF
shape() { "$PY" "$SHAPE" "$@"; }
sec() { printf '\n\n########## %s\n' "$*"; }
ls_head() { local n="$1"; shift; ls -1 "$@" 2>/dev/null | head -n "$n" | sed 's/^/  /'; }
first_file() { find "$1" -maxdepth "${3:-1}" -type f -name "$2" 2>/dev/null | sort | head -1; }
first_dir() { find "$1" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | head -1; }
need() { [ -d "$2" ] || { echo "(没找到目录：$1 = $2)"; return 1; }; echo "目录：$2"; }
mask_stream() { "$PY" -c "
import re,sys
CJK=re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
for l in sys.stdin: sys.stdout.write(CJK.sub(lambda m:'<%d字>'%len(m.group(0)),l))"; }

{
echo "收集时间：$(date '+%F %T')    BASE=$BASE"

sec "A. ぼくらの放課後戦争：每种 tag 的参数含义（commands 三元组 = tag 下标 / 参数组下标 / 第三项）"
if need BOKUSEN "$BOKUSEN"; then
  J="$BOKUSEN/json/20013 小春－初H.json"; [ -f "$J" ] || J="$(first_file "$BOKUSEN/json" '*.json')"
  "$PY" - "$J" <<'PYEOF'
import json, re, sys, collections
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))['data']['code']
tags, cmds, params = d['tags'], d['commands'], d['parameters']
print('键:', list(d.keys()))
print('tag 表（下标: 名字）:', {i: (t if isinstance(t, str) else mask(t)) for i, t in enumerate(tags)})
print('命令数', len(cmds), '；参数组数', len(params), '；articles', len(d['articles']))
per = collections.defaultdict(list)
for c in cmds:
    per[int(c[0])].append(c)
for t, lst in sorted(per.items(), key=lambda kv: -len(kv[1])):
    print('--- tag[%d]=%s  共 %d 条；第三项取值（前 12 个不同值）: %s' % (t, tags[t], len(lst), sorted({c[2] for c in lst}, key=lambda x: int(x))[:12]))
    seen = set()
    for c in lst:
        p = params[int(c[1])]
        key = json.dumps(p)
        if key in seen: continue
        seen.add(key)
        if len(seen) > 4: break
        # 只列出不是 nil 的槽：下标=值，方便对出每一位的含义
        print('    参数组 %s: %s' % (c[1], {i: mask(v) for i, v in enumerate(p) if v != 'nil'}))
print('--- 前 30 条命令（tag 名 + 第三项）:', [(tags[int(c[0])], c[2]) for c in cmds[:30]])
print('--- articles 前 6 条（屏蔽）:', [mask(a)[:40] for a in d['articles'][:6]])
print('--- images 前 8 个（只留文件名）:', [x.split('/')[-1] for x in d['images'][:8]])
print('--- sounds 前 8 个:', [x.split('/')[-1] for x in d['sounds'][:8]])
PYEOF
  echo "-- 本地 resource 目录里有没有这些文件（hash 名）："
  H="$("$PY" -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8-sig'))['data']['code']
print(d['images'][0].split('/')[-1].split('.')[0])" "$J" 2>/dev/null)"
  echo "  找 $H："; find "$BOKUSEN" -name "*$H*" 2>/dev/null | head -3 | sed "s#$BOKUSEN/##"
  echo "-- resource 目录结构（前 3 个子目录各 6 项）："; for d in $(find "$BOKUSEN/resource" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -3 | tr ' ' '?'); do echo "  $d"; done
fi

sec "B. Twinkle Star Knights X：book.json 的真实行（表头 + 对话）"
if need TSK "$TSK" ; then
  A="$TSK/Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X/Adventure"
  B="$(find "$A" -type f -name '*.book.json' 2>/dev/null | sort | head -1)"; echo "(${B#$A/})"
  "$PY" - "$B" <<'PYEOF'
import json, re, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))
print('顶层键:', list(d.keys()))
for gi, grid in enumerate(d['importGridList'][:2]):
    print('=== grid %d  name=%s  headerRow=%s  行数=%d' % (gi, mask(grid.get('name', ''))[-60:], grid.get('headerRow'), len(grid['rows'])))
    for row in grid['rows'][:30]:
        cells = row['strings']
        if row.get('isEmpty'): print('  [%d] (空行)' % row['rowIndex']); continue
        print('  [%d]%s %s' % (row['rowIndex'], ' (注释)' if row.get('isCommentOut') else '', json.dumps({i: mask(c)[:40] for i, c in enumerate(cells) if c != ''}, ensure_ascii=False)))
    print('  entityDataList 项数:', len(grid.get('entityDataList', [])))
print('_tsk_zh 类型:', type(d.get('_tsk_zh')).__name__, mask(json.dumps(d.get('_tsk_zh'), ensure_ascii=False))[:300])
PYEOF
  echo "-- 本地化文件（_tsk_zh 之外还有没有别的语言目录）："; ls_head 12 "$TSK/自动新增内容"; ls_head 12 "$TSK/自动新增内容/data"
  echo "-- Master.chapter.json 里 Character 表前 6 行（列名行 + 数据行）："
  M="$(find "$TSK" -type f -name 'Master.chapter.json' 2>/dev/null | head -1)"
  [ -n "$M" ] && "$PY" - "$M" <<'PYEOF'
import json, re, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))
for g in d['settingList']:
    print('=== ', g['name'][-50:], ' 行数', len(g['rows']))
    for row in g['rows'][:4]:
        if not row.get('isEmpty') and not row.get('isCommentOut'): print('   ', json.dumps({i: mask(c)[:30] for i, c in enumerate(row['strings']) if c != ''}, ensure_ascii=False)[:300])
PYEOF
  echo "-- 立绘 / 背景文件的命名样例："; for d in Characters Stills Sprites Backgrounds Sound; do echo "  [$d]"; find "$TSK/Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X/$d" -maxdepth 2 2>/dev/null | head -5 | sed 's#.*/StreamingAssets/Twinkle Star Knights X/##'; done
fi

sec "C. Kamihime：带 hash 的资源在磁盘上哪里"
if need KAMI "$KAMI"; then
  D="$KAMI/game/dmm"
  K="$(find "$D" -type f -name '*_script.ks' 2>/dev/null | sort | head -1)"; echo "(${K#$D/})"
  echo "-- 目录结构（深度 2）："; find "$KAMI" -maxdepth 2 -type d 2>/dev/null | head -40 | sed "s#$KAMI/##"
  echo "-- 这份脚本里引用的资源（去掉 -hash 之后的名字）在磁盘上的位置："
  grep -o -E 'storage="[^"]+"' "$K" | sed 's/storage="//; s/"$//' | sort -u | head -12 | while IFS= read -r f; do
    stem="${f%%-*}"; echo "  [$f]"; find "$KAMI" -name "${stem}*" 2>/dev/null | head -3 | sed "s#$KAMI/#      -> #"
  done
  echo "-- 同目录的 json（元数据）结构："; J="${K%_script.ks}.json"; [ -f "$J" ] && DEEP=2 shape "$J" 30
  echo "-- raw_scenario 目录结构（前 12）："; find "$KAMI/raw_scenario" -maxdepth 2 2>/dev/null | head -12 | sed "s#$KAMI/##"
  echo "-- 这份 .ks 的前 60 行（台词屏蔽）："; shape "$K" 60
  echo "-- chara_new / chara_face / chara_mod 在 .ks 里的完整样例（各 6 条，不同写法）："
  for t in chara_new chara_face chara_mod chara_show; do echo "  [$t]"; grep -h -o -E "\[$t [^]]*\]" "$K" | sort -u | head -6 | cut -c1-200 | mask_stream; done
fi

sec "D. GrenzeViewer：对话行样例 + 资源对应 + 骨架版本"
if need GRENZE "$GRENZE"; then
  X="$GRENZE/TextAsset/easy_dialog-1.xml"; [ -f "$X" ] || X="$(first_file "$GRENZE/TextAsset" 'easy_dialog*.xml')"
  echo "-- 对话行样例（含 background / bgm / voice_pack / screen_effect / pic_action 的各 2 行，文本屏蔽）："
  for a in background bgm voice_pack screen_effect pic_action sound1 effect; do echo "  [$a]"; grep -m2 -E " $a=\"" "$X" | cut -c1-320 | mask_stream; done
  echo "-- 普通对话行 3 行："; grep -m3 -E '<[A-Za-z_]+ [^>]*pic_pos' "$X" | cut -c1-320 | mask_stream
  echo "-- 资源在磁盘上的位置（取样例里的名字去查）："
  for n in bg_101001_1_00 ER1SO_bgm00 hse_000_013 se00_0033 Main11; do echo "  [$n]"; find "$GRENZE" -iname "*$n*" 2>/dev/null | head -3 | sed "s#$GRENZE/#      -> #"; done
  echo "-- 立绘：pic_face / hero_group_id 取值样例，和 patchres 里的立绘目录："
  grep -o -E ' (hero_group_id|pic_face|pic_pos)="[^"]*"' "$X" | sort | uniq -c | sort -rn | head -8
  find "$GRENZE/assets/resources/patchres" -maxdepth 2 -type d \( -iname '*hero*' -o -iname '*chara*' -o -iname '*spine*' -o -iname '*pic*' \) 2>/dev/null | head -8 | sed "s#$GRENZE/##"
  echo "-- 一个 spine 骨架（任选）的文件和头部（版本号）："
  S="$(find "$GRENZE/assets" -type f \( -name '*.skel' -o -name '*.skel.bytes' -o -name '*.skeleton' \) 2>/dev/null | head -1)"; echo "  ${S#$GRENZE/}"
  [ -n "$S" ] && head -c 64 "$S" | od -An -c | head -4
  J="$(find "$GRENZE/assets" -type f -name '*.json' -path '*spine*' 2>/dev/null | head -1)"; [ -n "$J" ] && { echo "  json 骨架：${J#$GRENZE/}"; head -c 200 "$J"; echo; }
  echo "-- 扩展名为 .dat 的文件样例（是什么？）："; D="$(find "$GRENZE/assets" -type f -name '*.dat' 2>/dev/null | head -1)"; echo "  ${D#$GRENZE/}"; [ -n "$D" ] && head -c 32 "$D" | od -An -tx1 | head -2
fi

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1
echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
