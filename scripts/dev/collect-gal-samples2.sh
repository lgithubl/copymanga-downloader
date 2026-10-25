#!/usr/bin/env bash
# 第二轮样本：只补上一轮没看到的、做适配必须的东西。输出到一个文件（默认 ./gal-samples2.txt），发给我。
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
OUT="${OUT:-$PWD/gal-samples2.txt}"
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

sec "A. Aku：SELECT / LABEL / JUMP / EV_FADE / ANIM_* / SPINE_ACTOR_* 的写法和位置取值"
if need AKU "$AKU"; then
  S="$(find "$AKU" -maxdepth 3 -type d -name scenes | head -1)"
  ALL="$(mktemp)"; find "$S" -mindepth 2 -maxdepth 2 -name script.txt -print0 | xargs -0 cat > "$ALL" 2>/dev/null
  echo "-- SPINE_ACTOR 第 4、5 项（纵向 / 横向）取值分布："
  grep -h -E '^<SPINE_ACTOR>' "$ALL" | awk -F',' '{gsub(/ /,"",$4); gsub(/ /,"",$5); print $4","$5}' | sort | uniq -c | sort -rn | head -15
  echo "-- SPINE_ACTOR 第 6、7 项："; grep -h -E '^<SPINE_ACTOR>' "$ALL" | awk -F',' '{gsub(/ /,"",$6); gsub(/ /,"",$7); print $6","$7}' | sort | uniq -c | sort -rn | head -8
  for tag in SELECT LABEL JUMP EV_FADE ANIM_PLAY ANIM_LOAD ANIM_STOP ANIM_SPEED SPINE_ACTOR_FADE SPINE_ACTOR_MOVE WAIT SE_PLAY; do
    echo "-- <$tag> 前 6 条原文（台词屏蔽）："; grep -h -E "^<$tag>" "$ALL" | sort -u | head -6 | cut -c1-200 | mask_stream
  done
  echo "-- 一个带 SELECT 的脚本里 SELECT 前后各 8 行（只留标签行）："
  F="$(find "$S" -mindepth 2 -maxdepth 2 -name script.txt -print0 2>/dev/null | xargs -0 grep -l -m1 -E '^<SELECT>' 2>/dev/null | head -1)"   # 路径里有空格：必须 -print0 | xargs -0
  echo "($F)"; [ -n "$F" ] && grep -n -E '^<' "$F" | grep -B8 -A8 -m1 -E '<SELECT>' | cut -c1-200 | mask_stream
  echo "-- 同一个脚本里的 LABEL / JUMP："; [ -n "$F" ] && grep -n -E '^<(LABEL|JUMP|SELECT)>' "$F" | head -14 | cut -c1-200 | mask_stream
  echo "-- script_original.json 结构："; O="$(first_file "$S/$(basename "$(first_dir "$S")")" 'script_original.json')"; [ -n "$O" ] && DEEP=2 shape "$O" 30
  rm -f "$ALL"
fi

sec "B. Fruits：ACTOR 的参数 / img.txt / EV"
if need FRUITS "$FRUITS"; then
  S="$(find "$FRUITS" -maxdepth 3 -type d -name scenes | head -1)"
  ALL="$(mktemp)"; find "$S" -mindepth 2 -maxdepth 2 -name script.txt -print0 | xargs -0 cat > "$ALL" 2>/dev/null
  echo "-- ACTOR 位置（第 3、4 项）取值分布："; grep -h -E '^<ACTOR>' "$ALL" | awk -F',' '{print $3","$4}' | sort | uniq -c | sort -rn | head -12
  echo "-- ACTOR_COLOR_FILTER / ACTOR_OUT / EV / VIDEO_PLAY / BG 的不同写法（前 8 条）："
  for tag in ACTOR_COLOR_FILTER ACTOR_OUT EV VIDEO_PLAY BG; do echo "  <$tag>"; grep -h -E "^<$tag>" "$ALL" | sort -u | head -8 | cut -c1-200 | sed 's/^/    /'; done
  ONE="$(first_dir "$S")"
  echo "-- 第一个场景的 images（前 20）和 videos："; ls_head 20 "$ONE/images"; ls_head 5 "$ONE/videos"
  echo "-- 找一个 img.txt 里 pairList 不为空的："
  find "$S" -mindepth 2 -maxdepth 2 -name img.txt 2>/dev/null | head -400 | while IFS= read -r f; do
    if grep -q -E '"pairList": *\[ *\{' "$f" 2>/dev/null; then echo "($f)"; shape "$f" 20; break; fi
  done
  rm -f "$ALL"
fi

sec "C. angelic_py：hscene 脚本里都有哪些语句（第一个单词的直方图）"
if need ANGELIC "$ANGELIC"; then
  H="$ANGELIC/game/script/hscene"
  find "$H" -maxdepth 1 -name '*.rpy' -print0 | xargs -0 cat 2>/dev/null | sed -E 's/^[ \t]+//' | awk 'NF{print $1}' | sed -E 's/[":,(].*$//' | sort | uniq -c | sort -rn | head -30
  echo "-- show 语句的几种写法（前 10）："; find "$H" -maxdepth 1 -name '*.rpy' -print0 | xargs -0 cat 2>/dev/null | grep -h -E '^\s+show ' | sed -E 's/[0-9]+/N/g' | sort | uniq -c | sort -rn | head -10
  echo "-- with / pause / window 的写法（前 8）："; find "$H" -maxdepth 1 -name '*.rpy' -print0 | xargs -0 cat 2>/dev/null | grep -h -E '^\s+(with|pause|window|queue|stop)' | sort | uniq -c | sort -rn | head -8
fi

sec "D. ミナシゴノシゴトR：剧情脚本 data/adv/textfiles/story/*.txt"
if need MINASHIGO_R "$MINASHIGO_R"; then
  D="$MINASHIGO_R/data/adv/textfiles/story"
  echo "文件数：$(ls -1 "$D" 2>/dev/null | wc -l)"; ls_head 6 "$D"
  F="$D/100042.txt"; [ -f "$F" ] || F="$(first_file "$D" '*.txt')"
  echo "-- ${F##*/} 前 80 行："; [ -n "$F" ] && shape "$F" 80
  F2="$(find "$D" -maxdepth 1 -name '*.txt' -size +20k 2>/dev/null | sort | head -1)"
  echo "-- 一个较大的（${F2##*/}）前 60 行："; [ -n "$F2" ] && shape "$F2" 60
  echo "-- 指令词直方图（每行第一个词，前 30）："; find "$D" -maxdepth 1 -name '*.txt' -print0 | head -c 20000000 | xargs -0 cat 2>/dev/null | awk 'NF{print $1}' | sed -E 's/[:,=].*$//' | sort | uniq -c | sort -rn | head -30
fi

sec "E. ぼくらの放課後戦争：命令表的含义"
if need BOKUSEN "$BOKUSEN"; then
  J="$BOKUSEN/json/20013 小春－初H.json"; [ -f "$J" ] || J="$(first_file "$BOKUSEN/json" '*.json')"
  "$PY" - "$J" <<'PYEOF'
import json, re, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))['data']['code']
print('# 文件:', sys.argv[1].split('/')[-1][:30])
print('tags（全部）:', d['tags'])
print('parameters 共', len(d['parameters']), '项；commands 共', len(d['commands']), '项；articles 共', len(d['articles']), '项；images', len(d['images']), '；sounds', len(d['sounds']))
print('--- 前 60 条 commands（每条三个数）:'); print(d['commands'][:60])
print('--- 前 40 条 parameters:'); [print(i, p) for i, p in enumerate(d['parameters'][:40])]
print('--- 前 14 条 articles（台词屏蔽）:'); [print(i, mask(a)) for i, a in enumerate(d['articles'][:14])]
print('--- images 前 6（只留路径末尾）:', [x.split('/')[-1] for x in d['images'][:6]])
print('--- sounds 前 6:', [x.split('/')[-1] for x in d['sounds'][:6]])
PYEOF
  R="$(first_dir "$BOKUSEN/resource")"; echo "-- 第一个 resource 目录里 images / sounds 文件数："; echo "  $(ls -1 "$R/images" 2>/dev/null | wc -l) / $(ls -1 "$R/sounds" 2>/dev/null | wc -l)"
fi

sec "F. 魔法学园：json_story_player.rpy（官方解释器 = 规格书）+ others 指令"
if need MAGIC "$MAGIC"; then
  G="$MAGIC/game"
  echo "-- json_story_player.rpy 第 80 行之后（全部，台词无关）："; [ -f "$G/json_story_player.rpy" ] && sed -n '80,420p' "$G/json_story_player.rpy" | cut -c1-170 || echo "(没有 .rpy)"
  E="$(first_dir "$G/episode_scripts")"; EF="$(first_file "$E" '*.json' 2)"
  "$PY" - "$EF" <<'PYEOF'
import json, re, sys, collections
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))
print('# ', sys.argv[1].split('/')[-1], ' 键:', list(d.keys()))
cmds = collections.Counter()
for row in d.get('others', []):
    for c in (row or []): cmds[(c or {}).get('cmd')] += 1
print('others 里 cmd 直方图:', dict(cmds))
shown = set()
for row in d.get('others', []):
    for c in (row or []):
        k = (c or {}).get('cmd')
        if k and k not in shown: shown.add(k); print('  样例', k, json.dumps(c, ensure_ascii=False)[:200])
for key in ('effects', 'waits', 'colors', 'names', 'charas'):
    vals = [v for v in d.get(key, []) if v not in (None, 0, -2)]
    print(key, '非空样例:', json.dumps(vals[:6], ensure_ascii=False)[:200])
print('dic 前 14:', [CJK.sub('<字>', str(x))[:40] for x in d['dic'][:14]])
PYEOF
  for f in getHsceneList.json getGalleryList.json; do echo "-- masterdata/$f（深度 4）："; [ -f "$G/masterdata/$f" ] && DEEP=2 shape "$G/masterdata/$f" 12 | tail -40; done
fi

sec "G. Twinkle Star Knights X：Adventure 剧情"
if need TSK "$TSK"; then
  A="$TSK/Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X/Adventure"
  echo "-- Adventure："; ls_head 20 "$A"; echo "文件数：$(find "$A" -type f 2>/dev/null | wc -l)"
  echo "-- 扩展名："; find "$A" -type f 2>/dev/null | sed -E 's/.*\.([A-Za-z0-9]+)$/\1/' | sort | uniq -c | sort -rn | head
  for ext in txt json bytes; do F="$(find "$A" -type f -name "*.$ext" 2>/dev/null | sort | head -1)"; [ -n "$F" ] && { echo "-- 第一个 .$ext（${F#$A/}）："; shape "$F" 40; }; done
  echo "-- Characters / Stills / Sprites / Cutin / Sound 各自前 6 个："; for d in Characters Stills Sprites Cutin Sound; do echo "  [$d]"; ls_head 6 "$TSK/Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X/$d"; done
fi

sec "H. Kamihime：dmm 的 json / ks 和 2_build_rpy.py（把它们转成 rpy 的脚本 = 规格书）"
if need KAMI "$KAMI"; then
  D="$KAMI/game/dmm"
  echo "-- dmm 下的目录："; find "$D" -maxdepth 1 -mindepth 1 -type d | head -10 | sed 's/^/  /'
  J="$(find "$D" -type f -name '*.json' -size +2k 2>/dev/null | sort | head -1)"; echo "-- 一个 json（${J#$D/}）："; [ -n "$J" ] && DEEP=2 shape "$J" 30
  K="$(find "$D" -type f -name '*.ks' 2>/dev/null | sort | head -1)"; echo "-- 一个 .ks（${K#$D/}）前 70 行："; [ -n "$K" ] && shape "$K" 70
  echo "-- 2_build_rpy.py 前 150 行："; [ -f "$D/2_build_rpy.py" ] && shape "$D/2_build_rpy.py" 150 || echo "(没有)"
fi

sec "I. GrenzeViewer：对话 XML 的属性清单和资源对应"
if need GRENZE "$GRENZE"; then
  X="$GRENZE/TextAsset/easy_dialog-1.xml"; [ -f "$X" ] || X="$(first_file "$GRENZE/TextAsset" 'easy_dialog*.xml')"
  echo "-- ${X##*/} 里所有属性名直方图："; grep -o -E ' [a-z_0-9]+="' "$X" | tr -d '="' | sort | uniq -c | sort -rn | head -30
  echo "-- 每个属性的取值样例（各 3 个，文本屏蔽）："
  for a in background bgm bg_sound1 voice_pack screen_effect character1 pos1 next_id; do echo "  $a:"; grep -o -E " $a=\"[^\"]*\"" "$X" | sort -u | head -3 | sed 's/^/    /'; done
  echo "-- dialog-3.xml 全文（DEFINE 表，枚举含义）："; [ -f "$GRENZE/TextAsset/dialog-3.xml" ] && shape "$GRENZE/TextAsset/dialog-3.xml" 40
  echo "-- assets/resources/patchres 前 12："; ls_head 12 "$GRENZE/assets/resources/patchres"
  echo "-- 背景 / BGM / 语音文件的命名样例："; find "$GRENZE/assets/resources" -type f \( -name 'bg_*' -o -name 'bgm*' -o -name '*voice*' \) 2>/dev/null | head -8 | sed "s#$GRENZE/##"
fi

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1
echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
