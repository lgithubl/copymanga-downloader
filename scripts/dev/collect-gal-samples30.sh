#!/usr/bin/env bash
# 第三十轮样本：魔法学园 episode_scripts 的语音（MAY_ep4_h_SELES_001.mp3 这种）到底在不在磁盘上：
#   上一轮只查了「脚本名 / 名字前缀」两个候选目录，不能说明整个游戏里没有。这里按文件名全盘找：
#   1) game/episode_scripts/*/*.json 里 voices 字段的全部语音名（去重、不带目录），在整个游戏目录（所有扩展名）里按「文件名去扩展名」精确查找 → 找到的路径 / 没找到
#   2) 游戏目录里文件名带 _ep<数字>_ 的所有文件（按目录统计个数 + 前 5 个名字）
#   3) game/audio 下一级目录名和个数（看有没有 voice 以外放语音的目录）
# 输出 ./gal-samples30.tar.gz（默认）。用法：BASE=/游戏父目录 bash collect-gal-samples30.sh；目录名不对就 ARTWHIRL=
BASE="${BASE:-.}"
: "${ARTWHIRL:=$BASE/魔法学园的少女们}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
[ -d "$ARTWHIRL" ] || { echo "没找到目录：ARTWHIRL = $ARTWHIRL（用 ARTWHIRL= 指定）"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUTDIR}/gal-samples30.tar.gz"
cat > "$HELPER" <<'PYEOF'
import json, os, re, sys, collections
root, stage = sys.argv[1], sys.argv[2]
game = os.path.join(root, 'game') if os.path.isdir(os.path.join(root, 'game')) else root
os.makedirs(stage, exist_ok=True)
def dec(raw):
    for enc in ('utf-8-sig', 'cp932'):
        try: return raw.decode(enc)
        except Exception: pass
    return raw.decode('utf-8', 'replace')
# 全盘文件名索引：去扩展名的名字 → [相对路径]
byname = collections.defaultdict(list)
epfiles = collections.defaultdict(list)
for d, ds, fs in os.walk(game):
    for f in fs:
        stem = os.path.splitext(f)[0]
        rel = os.path.relpath(os.path.join(d, f), game)
        byname[stem].append(rel)
        if re.search(r'_ep\d+_', f): epfiles[os.path.relpath(d, game)].append(f)
names = set()
per = {}
epdir = os.path.join(game, 'episode_scripts')
for d, ds, fs in os.walk(epdir):
    for f in fs:
        if not f.endswith('.json'): continue
        try: data = json.loads(dec(open(os.path.join(d, f), 'rb').read()))
        except Exception: continue
        dic = data.get('dic') or []
        vs = []
        for v in data.get('voices') or []:
            if isinstance(v, int) and 0 <= v < len(dic): v = dic[v]
            if isinstance(v, dict): v = next((v[k] for k in ('file', 'name', 'voice') if isinstance(v.get(k), str)), None)
            if isinstance(v, str) and v: vs.append(v)
        if vs: per[f] = vs; names.update(vs)
with open(os.path.join(stage, 'episode_voice_lookup.tsv'), 'w', encoding='utf-8') as out:
    out.write('脚本\t语音名\t全盘找到的路径（空 = 没有）\n')
    found = 0
    for f, vs in sorted(per.items()):
        for v in vs:
            hit = byname.get(os.path.splitext(v)[0], [])
            found += 1 if hit else 0
            out.write('%s\t%s\t%s\n' % (f, v, ' | '.join(hit[:3])))
    out.write('# 共 %d 个语音名（去重 %d），有文件的 %d\n' % (sum(len(v) for v in per.values()), len(names), found))
with open(os.path.join(stage, 'ep_named_files.txt'), 'w', encoding='utf-8') as out:
    for d, fs in sorted(epfiles.items()): out.write('## %s（%d 个）%s\n' % (d, len(fs), ', '.join(sorted(fs)[:5])))
with open(os.path.join(stage, 'audio_top_dirs.txt'), 'w', encoding='utf-8') as out:
    a = os.path.join(game, 'audio')
    for n in sorted(os.listdir(a)) if os.path.isdir(a) else []:
        p = os.path.join(a, n)
        cnt = sum(len(fs) for _, _, fs in os.walk(p)) if os.path.isdir(p) else 1
        out.write('%s\t%d\n' % (n, cnt))
PYEOF
"$PY" -I "$HELPER" "$ARTWHIRL" "$STAGE"
tar -czf "$OUT" -C "$STAGE" . && echo "已生成：$OUT（$(du -h "$OUT" | cut -f1)）"
