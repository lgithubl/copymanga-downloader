#!/usr/bin/env bash
# 第十二轮样本（cp 关键脚本 / 骨骼 / 目录清单到一个目录，文本脱敏，最后打成 tar.gz）：
#   Aku（骨骼 c31000802）/ Fruits（动画只动一帧 c488E66-100SZML488_）/ 魔法学园（YUNI_ep7_h）/ Kamihime（缺 CG：美容にいいモノ、2607_harem-character、感謝の気持ち、1707_harem-charact）/
#   ミナシゴノシゴトR（剧情分类）/ Otogi Frontier R（角色分类）/ Girls Creation（chara_0032_r18_1 的骨骼不动）
# 输出 ./gal-samples12.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples12.sh（个别目录用变量覆盖：AKU= FRUITS= ARTWHIRL= KAMIHIME= MINASHIGO_R= OTOGI= GC=）
#   只读原目录；只复制「文本脚本 / 骨骼 json·skel / atlas / plist / 清单」，不复制图片、音频、视频（只列文件名和大小）；
#   文本里连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。单个文件超过 2MB 只取前 2MB。
BASE="${BASE:-.}"
: "${AKU:=$BASE/Aku No Onna Kanbu - Perigee New Moon Viewer}"
: "${FRUITS:=$BASE/Fruits Fulcute!}"
: "${ARTWHIRL:=$BASE/魔法学园的少女们}"
: "${KAMIHIME:=$BASE/Kamihime_Player- 1.0}"
: "${MINASHIGO_R:=$BASE/ミナシゴノシゴトR}"
: "${OTOGI:=$BASE/Otogi Frontier R}"
: "${GC:=$BASE/Girls Creation}"
OUTDIR="${OUTDIR:-$PWD}"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples12.tar.gz}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
HELPER="$(mktemp --suffix=.py)"
cat > "$HELPER" <<'PYEOF'
import os, re, sys, fnmatch, shutil
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
TEXT = {'.txt', '.json', '.rpy', '.ks', '.csv', '.xml', '.atlas', '.plist', '.js', '.html', '.book', '.tsv', '.yaml', '.yml', '.ini', '.cfg', ''}
BIN_KEEP = {'.skel', '.bytes'}          # 骨骼二进制：原样复制（没有台词）
MEDIA = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.ogg', '.mp3', '.wav', '.m4a', '.mp4', '.webm', '.ico', '.ttf', '.otf', '.dll', '.exe', '.pak', '.unity3d', '.assetbundle'}
LIMIT = 2 * 1024 * 1024
def dec(raw):
    for enc in ('utf-8-sig', 'utf-16', 'cp932', 'gb18030'):
        try: return raw.decode(enc)
        except Exception: pass
    return raw.decode('latin-1')
def put(src, dst):
    ext = os.path.splitext(src)[1].lower()
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if ext in BIN_KEEP:
        shutil.copyfile(src, dst); return 'bin'
    if ext in MEDIA: return None
    if ext not in TEXT: return None
    raw = open(src, 'rb').read(LIMIT)
    open(dst, 'w', encoding='utf-8').write(mask(dec(raw)))
    return 'txt'
def walk(root):
    for d, ds, fs in os.walk(root):
        for f in fs: yield os.path.join(d, f)
# 用法：helper.py <root> <stage/子目录> <模式...>   模式 = 文件名或路径里的子串（大小写不敏感）；以 re: 开头 = 正则；以 dir: 开头 = 整个目录（只取文本 / 骨骼）
def main():
    root, stage, pats = sys.argv[1], sys.argv[2], sys.argv[3:]
    n = 0; seen = set()
    listing = open(os.path.join(stage, '_files.txt'), 'w', encoding='utf-8')
    for p in walk(root):
        rel = os.path.relpath(p, root)
        for pat in pats:
            low = rel.lower()
            if pat.startswith('re:'): ok = re.search(pat[3:], rel) is not None
            elif pat.startswith('dir:'): ok = low.startswith(pat[4:].lower().rstrip('/') + os.sep.lower()) or ('/' + pat[4:].lower().rstrip('/') + '/') in ('/' + low.replace(os.sep, '/'))
            else: ok = pat.lower() in low
            if ok:
                if rel in seen: break
                seen.add(rel)
                kind = put(p, os.path.join(stage, rel))
                listing.write('%s\t%s\t%d\n' % (kind or 'skip', mask(rel), os.path.getsize(p)))
                n += kind is not None
                break
    listing.close()
    print('  复制 %d 个文件，清单 %d 行（%s）' % (n, len(seen), os.path.join(stage, '_files.txt')))
main()
PYEOF
tree_of() {   # 目录树（只到 depth 层，不含文件内容）
  (cd "$1" && find . -maxdepth "$2" | sed 's#^\./##' | sort | head -400) > "$3" 2>/dev/null
}
grab() {   # grab <名字> <目录> <模式...>
  local name="$1" dir="$2"; shift 2
  [ -d "$dir" ] || { echo "(没找到目录：$name = $dir)"; return; }
  echo "== $name：$dir"
  mkdir -p "$STAGE/$name"
  tree_of "$dir" 3 "$STAGE/$name/_tree_depth3.txt"
  "$PY" "$HELPER" "$dir" "$STAGE/$name" "$@"
}

{ echo "收集时间：$(date '+%F %T')    BASE=$BASE"; } > "$STAGE/_info.txt"

# Aku：骨骼 c31000802（json / skel / atlas）+ 引用它的脚本（script.txt）
grab aku "$AKU" 'c31000802' 're:(^|/)(script|output_script)\.txt$'
# Fruits：c488E66-100SZML488_ 的骨骼 / atlas / 动画文件，加引用它的脚本
grab fruits "$FRUITS" 'c488E66-100SZML488_' 're:(^|/)script\.txt$'
# 魔法学园：YUNI_ep7_h 的脚本（含 dic / others / charas）+ 图标目录名清单
grab artwhirl "$ARTWHIRL" 'YUNI_ep7' 're:(^|/)json_story_player\.rpyc?$' 're:game/(script|options|screens)\.rpy$'
# Kamihime：三个剧情脚本 + 同名 hash 映射 + 全部 .ks 的文件名清单
grab kamihime "$KAMIHIME" '美容にいいモノ' '2607_harem-character' '感謝の気持ち' '1707_harem-charact' 're:(^|/)(hash|files|resource|index)[^/]*\.(txt|json|csv)$'
# ミナシゴノシゴトR：剧情 / 章节 / 名称表（不含图片）
grab minashigo_r "$MINASHIGO_R" 're:data/resource\.json$' 're:data/(story|episode|chapter|scenario|master)[^/]*\.(json|txt|csv)$' 're:(^|/)130010202\.txt$' 'dir:data/script'
# Otogi：列表 / 角色表 / 章节表 / 000.js 里的分类代码
grab otogi "$OTOGI" 're:^list\.json$' 're:^VieableEpisodeList/' 're:^000\.js$' 're:^(json|jsoncn|typeadv/MScenes)/(210011|280681|210452)$' 're:^Episode/' 're:^chara/(list|data)[^/]*\.json$'
# Girls Creation：chara_0032_r18_1 的脚本 + 骨骼 + atlas
grab girlscreation "$GC" 'chara_0032_r18_1'

# 每个游戏的「脚本目录清单」（文件名 + 大小，不含内容）
for pair in "aku:$AKU" "fruits:$FRUITS" "artwhirl:$ARTWHIRL" "kamihime:$KAMIHIME" "minashigo_r:$MINASHIGO_R" "otogi:$OTOGI" "girlscreation:$GC"; do
  n="${pair%%:*}"; d="${pair#*:}"
  [ -d "$d" ] && (cd "$d" && find . -type f \( -name '*.txt' -o -name '*.json' -o -name '*.ks' -o -name '*.rpy*' -o -name '*.skel' -o -name '*.atlas' \) -printf '%P\t%s\n' 2>/dev/null | sort | head -20000) > "$STAGE/${n}_script_files.tsv"
done

tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)，$(tar -tzf "$OUT" | wc -l) 项）——把这个文件发给我"
