#!/usr/bin/env bash
# 第三轮样本：只补前两轮没看到、做适配必须的东西（Fruits 立绘 / Aku 帧动画 / Kamihime / Grenze / ぼくら / TSK）。输出到一个文件（默认 ./gal-samples3.txt），发给我。
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
OUT="${OUT:-$PWD/gal-samples3.txt}"
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

sec "A. Fruits：<ACTOR> 完整的行 + 立绘图片命名"
if need FRUITS "$FRUITS"; then
  S="$(find "$FRUITS" -maxdepth 3 -type d -name scenes | head -1)"
  F="$(find "$S" -mindepth 2 -maxdepth 2 -name script.txt -print0 2>/dev/null | xargs -0 grep -l -m1 -E '^<ACTOR>' 2>/dev/null | head -1)"
  echo "($F)"; D="$(dirname "$F")"
  echo "-- 这个脚本里 ACTOR / ACTOR_OUT / ACTOR_COLOR_FILTER / EV 相关行（前 25 行，含上下各 1 行标签）："
  grep -n -E '^<(ACTOR|ACTOR_OUT|ACTOR_COLOR_FILTER|EV|BG|FADE_IN|FADE_OUT)[A-Z_0-9]*>' "$F" | head -25 | cut -c1-220 | mask_stream
  echo "-- 全部脚本里 <ACTOR> 的不同写法（把第 1 项以外数字归一，前 15）："
  find "$S" -mindepth 2 -maxdepth 2 -name script.txt -print0 | xargs -0 cat 2>/dev/null | grep -h -E '^<ACTOR>' | sed -E 's/[0-9]+/N/g' | sort | uniq -c | sort -rn | head -15 | cut -c1-200
  echo "-- 这个场景目录里的文件（前 40）："; ls_head 40 "$D"; ls_head 40 "$D/images"
  echo "-- img.txt（完整结构，深度 4）："; [ -f "$D/img.txt" ] && DEEP=4 shape "$D/img.txt" 30
  echo "-- 所有 img.txt 里 pairList 的元素数分布："
  find "$S" -mindepth 2 -maxdepth 2 -name img.txt 2>/dev/null | head -300 | while IFS= read -r f; do grep -o '"pairList": *\[[^]]*' "$f" | head -1 | grep -o '{' | wc -l; done | sort | uniq -c | sort -rn | head
fi

sec "B. Aku：ANIM_* 帧动画的写法 + 图片命名"
if need AKU "$AKU"; then
  S="$(find "$AKU" -maxdepth 3 -type d -name scenes | head -1)"
  F="$(find "$S" -mindepth 2 -maxdepth 2 -name script.txt -print0 2>/dev/null | xargs -0 grep -l -m1 -E '^<ANIM_PLAY>' 2>/dev/null | head -1)"
  echo "($F)"; D="$(dirname "$F")"
  grep -n -E '^<(ANIM_[A-Z]+|EV|EV_DISPLAY|EV_FADE)>' "$F" | head -30 | cut -c1-200
  echo "-- 场景目录里的文件（前 40）："; ls_head 40 "$D"; ls_head 40 "$D/images"
  echo "-- 全部脚本里 ANIM_LOAD / ANIM_PLAY 写法（数字归一）："
  find "$S" -mindepth 2 -maxdepth 2 -name script.txt -print0 | xargs -0 cat 2>/dev/null | grep -h -E '^<ANIM_(LOAD|PLAY|SPEED)>' | sed -E 's/[0-9]+/N/g' | sort | uniq -c | sort -rn | head -12 | cut -c1-200
fi

sec "C. Kamihime：.ks（TyranoScript）标签直方图 + 资源放哪"
if need KAMI "$KAMI"; then
  D="$KAMI/game/dmm"
  K="$(find "$D" -type f -name '*.ks' 2>/dev/null | sort | head -1)"; echo "(${K#$D/})"
  echo "-- 全部 .ks 的 [标签] 直方图（前 40）："
  find "$D" -type f -name '*.ks' -print0 | xargs -0 cat 2>/dev/null | grep -o -E '\[[a-z_0-9]+' | sort | uniq -c | sort -rn | head -40
  echo "-- 每种标签的一条样例（台词屏蔽，前 40 种）："
  find "$D" -type f -name '*.ks' -print0 | xargs -0 cat 2>/dev/null | grep -E '^\s*\[|^@' | sed -E 's/^\s+//' | awk '{t=$1; sub(/\].*/,"",t); if(!(t in seen)){seen[t]=1; print}}' | head -40 | cut -c1-200 | mask_stream
  echo "-- bg / bgm / se 引用的文件名样例（各 5）："
  for t in bg bgm playbgm playse; do echo "  [$t]"; find "$D" -type f -name '*.ks' -print0 | xargs -0 cat 2>/dev/null | grep -o -E "\[$t [^]]*\]" | sort -u | head -5 | cut -c1-160; done
  echo "-- 这些文件在磁盘上的样子（hash 文件名？）："; find "$KAMI/game" -maxdepth 3 -type f \( -name '*.jpg' -o -name '*.png' -o -name '*.mp3' -o -name '*.ogg' \) 2>/dev/null | head -8 | sed "s#$KAMI/##"
  echo "-- 2_build_rpy.py 150 行之后："; [ -f "$D/2_build_rpy.py" ] && sed -n '150,330p' "$D/2_build_rpy.py" | cut -c1-170 | mask_stream
fi

sec "D. GrenzeViewer：媒体文件对应 + AssetBundle.json + web_viewer"
if need GRENZE "$GRENZE"; then
  P="$GRENZE/assets/resources/patchres"
  echo "-- patchres 下目录 / 文件数："; find "$P" -maxdepth 2 | head -20 | sed "s#$GRENZE/##"; echo "总文件数 $(find "$P" -type f 2>/dev/null | wc -l)"
  echo "-- 扩展名分布："; find "$GRENZE/assets" -type f 2>/dev/null | sed -E 's/.*\.([A-Za-z0-9_.]+)$/\1/' | sort | uniq -c | sort -rn | head -10
  A="$(find "$GRENZE" -name '*.AssetBundle.json' 2>/dev/null | head -1)"; echo "-- AssetBundle.json（${A##*/}）："; [ -n "$A" ] && DEEP=3 shape "$A" 20
  echo "-- web_viewer 的 js 文件："; find "$GRENZE/web_viewer" -maxdepth 2 -name '*.js' 2>/dev/null | head -10 | sed "s#$GRENZE/##"
  J="$(find "$GRENZE/web_viewer" -maxdepth 2 -name '*.js' -size +2k 2>/dev/null | head -1)"; echo "-- ${J##*/} 中含 background / bgm / voice_pack / character1 / next_id 的行（前 40）："
  [ -n "$J" ] && grep -n -E 'background|bgm|voice_pack|character1|next_id|screen_effect' "$J" | head -40 | cut -c1-200
fi

sec "E. ぼくらの放課後戦争：tag / parameters / commands 的对应"
if need BOKUSEN "$BOKUSEN"; then
  J="$BOKUSEN/json/20013 小春－初H.json"; [ -f "$J" ] || J="$(first_file "$BOKUSEN/json" '*.json')"
  "$PY" - "$J" <<'PYEOF'
import json, re, sys, collections
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))['data']['code']
tags, cmds, params = d['tags'], d['commands'], d['parameters']
print('命令数', len(cmds), '；tag 表', len(tags))
# commands 是 (tag 下标, 参数起点, 参数个数) 三元组：按 tag 汇总，列出每种 tag 的 3 条参数样例
per = collections.defaultdict(list)
for i in range(0, len(cmds) - 2, 3):
    t, a, b = cmds[i], cmds[i+1], cmds[i+2]
    per[t].append((a, b))
for t, lst in sorted(per.items(), key=lambda kv: -len(kv[1])):
    name = tags[t] if t < len(tags) else '?'
    print('tag[%d]=%s  次数 %d' % (t, mask(name), len(lst)))
    for a, b in lst[:3]:
        print('    ', [mask(x)[:50] for x in params[a:a+b]] if b < 20 else ('参数 %d 个，起点 %d' % (b, a)))
PYEOF
  echo "-- 同一个 json 里 images / sounds 前 12 个的完整相对路径："; "$PY" -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8-sig'))['data']['code']
print(d['images'][:12]); print(d['sounds'][:12])" "$J"
fi

sec "F. Twinkle Star Knights X：Utage book.json 的列含义"
if need TSK "$TSK" ; then
  A="$TSK/Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X/Adventure"
  B="$(find "$A" -type f -name '*.book.json' 2>/dev/null | sort | head -1)"; echo "(${B#$A/})"
  "$PY" - "$B" <<'PYEOF'
import json, re, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
d = json.load(open(sys.argv[1], encoding='utf-8-sig'))
def walk(v, depth=0, key=''):
    pad = '  ' * depth
    if isinstance(v, dict):
        print('%s%s{} %s' % (pad, key, list(v.keys())[:12]))
        if depth < 3:
            for k, x in list(v.items())[:6]: walk(x, depth + 1, str(k) + ': ')
    elif isinstance(v, list):
        print('%s%s[] %d 项' % (pad, key, len(v)))
        if depth < 4:
            for i, x in enumerate(v[:6]): walk(x, depth + 1, '[%d] ' % i)
    else: print('%s%s%s' % (pad, key, mask(json.dumps(v, ensure_ascii=False))[:90]))
walk(d)
PYEOF
  for f in "Master.chapter.json" "event/main_story_map.tsv"; do P="$(find "$TSK" -type f -path "*$f" 2>/dev/null | head -1)"; echo "-- $f（${P##*/}）前 12 行："; [ -n "$P" ] && shape "$P" 12; done
fi

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1
echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
