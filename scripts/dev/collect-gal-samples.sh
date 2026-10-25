#!/usr/bin/env bash
# 收集 Gal 新游戏的结构样本，输出到一个文件（默认 ./gal-samples.txt），把它发给我。
#   用法：bash collect-gal-samples.sh
#   目录用变量 + 默认值：游戏文件夹都在同一个父目录下就只改 BASE；个别不在就单独覆盖，例如
#     BASE=/data/games AKU=/other/aku bash collect-gal-samples.sh
#   目录不存在的游戏会跳过（输出里写「没找到」），不影响别的。
#   台词 / 标题里连续 3 个以上的中日文字符会被替换成 <N字>，JSON 只输出结构；只读，不改任何文件。
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
: "${IMYS:=$BASE/ImysOffline-Gallery-Preview-20261013_1}"
OUT="${OUT:-$PWD/gal-samples.txt}"

PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
SHAPE="$(mktemp)"
trap 'rm -f "$SHAPE"' EXIT
cat > "$SHAPE" <<'PYEOF'
import json, os, re, sys
path = sys.argv[1]; limit = int(sys.argv[2]) if len(sys.argv) > 2 else 40
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
raw = open(path, 'rb').read()
text = None
for enc in ('utf-8-sig', 'utf-16', 'cp932', 'gb18030'):
    try: text = raw.decode(enc); break
    except Exception: pass
if text is None: text = raw.decode('latin-1')
print('# %s  %d 字节' % (os.path.basename(path), len(raw)))
def walk(v, i=0, key=''):
    pad = '  ' * i
    if isinstance(v, dict):
        print('%s%s{} %d 键' % (pad, key, len(v)))
        for n, (k, x) in enumerate(v.items()):
            if n >= limit: print('%s  ...' % pad); break
            walk(x, i + 1, '%s: ' % mask(str(k)))
    elif isinstance(v, list):
        print('%s%s[] %d 项' % (pad, key, len(v)))
        for n, x in enumerate(v[:3]): walk(x, i + 1, '[%d] ' % n)
    elif isinstance(v, str): print('%s%s"%s%s" (%d 字)' % (pad, key, mask(v[:60]), '…' if len(v) > 60 else '', len(v)))
    else: print('%s%s%s' % (pad, key, json.dumps(v, ensure_ascii=False)[:40]))
if os.environ.get('TAGS_ONLY'):   # 标签式脚本：只输出 <TAG> 开头的行，其余（台词）只数个数
    lines = text.splitlines()
    tag_lines = [l for l in lines if l.startswith('<')]
    for l in tag_lines[:limit]: print(mask(l)[:140])
    print('(其余非标签行 %d 行是台词；标签行共 %d 行)' % (len(lines) - len(tag_lines), len(tag_lines)))
else:
    try: walk(json.loads(text))
    except Exception:
        for n, line in enumerate(text.splitlines()[:limit]): print('%3d| %s' % (n + 1, mask(line)[:140]))
PYEOF

shape() { "$PY" "$SHAPE" "$@"; }
sec() { printf '\n\n########## %s\n' "$*"; }
ls_head() { local n="$1"; shift; ls -1 "$@" 2>/dev/null | head -n "$n" | sed 's/^/  /'; }   # ls_head 条数 目录
first_file() { find "$1" -maxdepth "${3:-1}" -type f -name "$2" 2>/dev/null | sort | head -1; }   # first_file 目录 通配 [深度]
first_dir() { find "$1" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | head -1; }
need() { [ -d "$2" ] || { echo "(没找到目录：$1 = $2)"; return 1; }; echo "目录：$2"; }

# 标签式 / 行式脚本（Girls Creation 家族）：场景目录结构 + 全部脚本的标签直方图 + 一个脚本的标签行（台词行只数个数）
gc_probe() {
  local root="$1" scenes
  scenes="$(find "$root" -maxdepth 3 -type d -name scenes 2>/dev/null | head -1)"
  [ -z "$scenes" ] && { echo "(没找到 scenes 目录)"; return; }
  echo "scenes：$scenes（场景数 $(ls -1 "$scenes" | wc -l)）"
  echo "-- 根目录："; ls_head 20 "$(dirname "$scenes")"
  echo "-- data："; ls_head 20 "$(dirname "$scenes")/data"
  echo "-- data/audio："; ls_head 10 "$(dirname "$scenes")/data/audio"
  local one; one="$(first_dir "$scenes")"
  echo "-- 第一个场景 $(basename "$one") 里："; ls_head 30 "$one"
  echo "-- 场景根目录下的脚本类文件分布（全部场景，数字归一）："
  find "$scenes" -mindepth 2 -maxdepth 2 -type f \( -name '*.txt' \) -print 2>/dev/null | sed 's#.*/##; s/[0-9][0-9]*/N/g' | sort | uniq -c | sort -rn | head -12
  echo "-- 全部 script.txt 的标签直方图（前 45 个）："
  find "$scenes" -mindepth 2 -maxdepth 2 -name script.txt -print0 2>/dev/null | xargs -0 cat 2>/dev/null | grep -o -E '^<[A-Z_0-9]+>' | sort | uniq -c | sort -rn | head -45
  echo "-- 一个 script.txt 的前 70 行（只保留标签行，台词行只数个数）："
  local sc="$one/script.txt"
  if [ -f "$sc" ]; then
    TAGS_ONLY=1 shape "$sc" 70
  else echo "(没有 script.txt)"; fi
}

{
echo "收集时间：$(date '+%F %T')    python：$("$PY" --version 2>&1)    BASE=$BASE"

sec "1. Aku No Onna Kanbu（NW.js / Girls Creation 家族）"
need AKU "$AKU" && gc_probe "$AKU"

sec "2. Fruits Fulcute!（NW.js，没有 package.nw）"
if need FRUITS "$FRUITS"; then
  gc_probe "$FRUITS"
  S="$(find "$FRUITS" -maxdepth 3 -type d -name scenes | head -1)"; ONE="$(first_dir "$S")"
  echo "-- 场景里的 img.txt 前 15 行："; [ -f "$ONE/img.txt" ] && shape "$ONE/img.txt" 15 || echo "(没有)"
  echo "-- script_original.txt 前 12 行："; [ -f "$ONE/script_original.txt" ] && shape "$ONE/script_original.txt" 12 || echo "(没有)"
fi

sec "3. angelic_py（Ren'Py）"
if need ANGELIC "$ANGELIC"; then
  G="$ANGELIC/game"
  echo "-- game/script："; ls_head 40 "$G/script"
  echo "-- hscene 里 .rpy / .rpyc 的数量："; ls -1 "$G/script/hscene" 2>/dev/null | sed -E 's/.*\.([a-z]+)$/\1/' | sort | uniq -c
  H="$(first_file "$G/script/hscene" '*.rpy')"
  echo "-- 一个 hscene 脚本（${H##*/}）前 80 行："; [ -n "$H" ] && shape "$H" 80 || echo "(hscene 里没有 .rpy)"
  echo "-- movies.rpy 前 20 行："; [ -f "$G/script/movies.rpy" ] && shape "$G/script/movies.rpy" 20 || echo "(没有)"
  echo "-- stills.rpy 前 20 行："; [ -f "$G/script/stills.rpy" ] && shape "$G/script/stills.rpy" 20 || echo "(没有)"
  echo "-- main_nav.rpy 前 40 行："; [ -f "$G/script/main_nav.rpy" ] && shape "$G/script/main_nav.rpy" 40 || echo "(没有)"
  N="$(first_file "$G/script/sub_nav" '*.rpy')"
  echo "-- 一个 sub_nav 脚本（${N##*/}）前 25 行："; [ -n "$N" ] && shape "$N" 25 || echo "(没有)"
  echo "-- game/resources 前 8 个："; ls_head 8 "$G/resources"
  echo "-- game/images："; ls_head 12 "$G/images"
fi

sec "4. ミナシゴノシゴトR（cocos2d 网页版）"
if need MINASHIGO_R "$MINASHIGO_R"; then
  echo "story_json 里文件数：$(ls -1 "$MINASHIGO_R/story_json" 2>/dev/null | wc -l)"
  F="$MINASHIGO_R/story_json/110070221.json"; [ -f "$F" ] || F="$(first_file "$MINASHIGO_R/story_json" '*.json')"
  echo "-- ${F##*/} 的结构："; [ -n "$F" ] && shape "$F" 60
  F2="$(find "$MINASHIGO_R/story_json" -maxdepth 1 -name '*.json' -size +20k 2>/dev/null | sort | head -1)"
  echo "-- 另一个较大的 story_json（${F2##*/}）的结构："; [ -n "$F2" ] && shape "$F2" 40
  for d in data/adv/textfiles data/adv/image data/adv/sound data/adv/movie data/spine/bg data/json; do echo "-- $d："; ls_head 8 "$MINASHIGO_R/$d"; done
  echo "-- data/adv/textfiles 里一个文件的结构："; T="$(first_file "$MINASHIGO_R/data/adv/textfiles" '*')"; [ -n "$T" ] && shape "$T" 40 || echo "(没有)"
fi

sec "5. ぼくらの放課後戦争"
if need BOKUSEN "$BOKUSEN"; then
  echo "json 里文件数：$(ls -1 "$BOKUSEN/json" 2>/dev/null | wc -l)；resource 里目录数：$(ls -1 "$BOKUSEN/resource" 2>/dev/null | wc -l)"
  J="$(first_file "$BOKUSEN/json" '*.json')"
  echo "-- 第一个剧情 json（${J##*/}）的结构："; [ -n "$J" ] && shape "$J" 60
  J2="$(find "$BOKUSEN/json" -maxdepth 1 -name '*.json' -size +30k 2>/dev/null | sort | head -1)"
  echo "-- 一个较大的剧情 json（${J2##*/}）的结构："; [ -n "$J2" ] && shape "$J2" 40
  R="$(first_dir "$BOKUSEN/resource")"
  echo "-- 第一个 resource 目录（${R##*/}）："; ls_head 6 "$R"; echo "   images："; ls_head 8 "$R/images"; echo "   sounds："; ls_head 8 "$R/sounds"
  echo "-- settings.json 结构："; [ -f "$BOKUSEN/settings.json" ] && shape "$BOKUSEN/settings.json" 30
  echo "-- README.md 前 30 行："; [ -f "$BOKUSEN/README.md" ] && shape "$BOKUSEN/README.md" 30
fi

sec "6. 魔法学园的少女们（Ren'Py + JSON）"
if need MAGIC "$MAGIC"; then
  G="$MAGIC/game"
  echo "-- json_story_player.rpy 前 80 行："; [ -f "$G/json_story_player.rpy" ] && shape "$G/json_story_player.rpy" 80 || echo "(没有 .rpy，只有 .rpyc？)"
  E="$(first_dir "$G/episode_scripts")"; echo "-- episode_scripts（共 $(ls -1 "$G/episode_scripts" 2>/dev/null | wc -l) 个）第一个（${E##*/}）："; ls_head 12 "$E"
  EF="$(first_file "$E" '*' 2)"; echo "-- 其中一个文件（${EF##*/}）的结构："; [ -n "$EF" ] && shape "$EF" 50
  H="$(first_dir "$G/hscripts")"; echo "-- hscripts 第一个（${H##*/}）："; ls_head 12 "$H"
  HF="$(first_file "$H" '*' 2)"; echo "-- 其中一个文件（${HF##*/}）的结构："; [ -n "$HF" ] && shape "$HF" 50
  for f in getHsceneList.json getGalleryList.json; do echo "-- masterdata/$f："; [ -f "$G/masterdata/$f" ] && shape "$G/masterdata/$f" 40 || echo "(没有)"; done
  echo "-- game/scripts/main："; ls_head 10 "$G/scripts/main"
fi

sec "7. Twinkle Star Knights X（Unity + BepInEx）"
if need TSK "$TSK" ; then
  SA="$TSK/Twinkle Star Knights X_Data/StreamingAssets"
  echo "-- StreamingAssets："; ls_head 20 "$SA"
  echo "-- StreamingAssets/Twinkle Star Knights X："; ls_head 30 "$SA/Twinkle Star Knights X"
  echo "-- 扩展名分布（StreamingAssets 下，前 10）："; find "$SA" -type f 2>/dev/null | sed -E 's/.*\.([A-Za-z0-9]+)$/\1/' | sort | uniq -c | sort -rn | head -10
  T="$(find "$SA" -type f -name '*.txt' 2>/dev/null | sort | head -1)"; echo "-- 第一个 txt（${T##*/}）前 40 行："; [ -n "$T" ] && shape "$T" 40
  B="$(find "$SA" -type f -name '*.bytes' 2>/dev/null | sort | head -1)"; echo "-- 第一个 bytes（${B##*/}）头 80 字节十六进制："; [ -n "$B" ] && head -c 80 "$B" | od -An -tx1 | head -5
  echo "-- 自动新增内容/data："; ls_head 10 "$TSK/自动新增内容/data"
  echo "-- names.tsv 前 10 行："; [ -f "$TSK/自动新增内容/data/names.tsv" ] && shape "$TSK/自动新增内容/data/names.tsv" 10
  echo "-- 自动新增内容/README.txt 前 25 行："; [ -f "$TSK/自动新增内容/README.txt" ] && shape "$TSK/自动新增内容/README.txt" 25
fi

sec "8. Kamihime_Player（Ren'Py）"
if need KAMI "$KAMI"; then
  G="$KAMI/game"
  echo "-- game："; ls_head 45 "$G"
  echo "-- script.rpy 前 80 行："; [ -f "$G/script.rpy" ] && shape "$G/script.rpy" 80 || echo "(没有 .rpy，只有 .rpyc？)"
  echo "-- dmm："; ls_head 20 "$G/dmm"
  echo "-- backgrounds 前 6 个："; ls_head 6 "$G/backgrounds"
  echo "-- bgm 前 4 个："; ls_head 4 "$G/bgm"
fi

sec "9. GrenzeViewer"
if need GRENZE "$GRENZE"; then
  echo "-- README.md 前 40 行："; [ -f "$GRENZE/README.md" ] && shape "$GRENZE/README.md" 40
  echo "-- TextAsset 文件数：$(ls -1 "$GRENZE/TextAsset" 2>/dev/null | wc -l)；前 12 个："; ls_head 12 "$GRENZE/TextAsset"
  X="$GRENZE/TextAsset/dialog-3.xml"; [ -f "$X" ] || X="$(first_file "$GRENZE/TextAsset" 'dialog*.xml')"
  echo "-- ${X##*/} 前 40 行："; [ -n "$X" ] && shape "$X" 40
  X2="$(first_file "$GRENZE/TextAsset" 'easy_dialog*.xml')"; echo "-- ${X2##*/} 前 30 行："; [ -n "$X2" ] && shape "$X2" 30
  echo "-- web_viewer/data："; ls_head 25 "$GRENZE/web_viewer/data"
  echo "-- web_viewer/README.md 前 25 行："; [ -f "$GRENZE/web_viewer/README.md" ] && shape "$GRENZE/web_viewer/README.md" 25
  echo "-- assets/resources："; ls_head 10 "$GRENZE/assets/resources"
fi

sec "10. ImysOffline Gallery"
if need IMYS "$IMYS"; then
  echo "-- README.md 前 50 行："; [ -f "$IMYS/README.md" ] && shape "$IMYS/README.md" 50
  echo "-- catalog："; ls_head 20 "$IMYS/catalog"
  echo "-- catalog/masters 前 12 个："; ls_head 12 "$IMYS/catalog/masters"
  M="$IMYS/catalog/masters/mAdventures.json"; [ -f "$M" ] || M="$(first_file "$IMYS/catalog/masters" '*.json')"
  echo "-- ${M##*/} 结构："; [ -n "$M" ] && shape "$M" 40
  echo "-- content/api："; ls_head 10 "$IMYS/content/api"
  echo "-- manifests："; ls_head 12 "$IMYS/manifests"
fi

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1

echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
