#!/usr/bin/env bash
# 第十一轮样本（补第十轮的缺口，修了第十轮在 Otogi 段中途崩掉的 bug）：angelic 的 MS0101B6UK491.rpy（多行图片定义）/ Otogi Frontier R 的 MScenes 剧情格式 + 播放逻辑里和资源有关的代码段。
# 输出到一个文件（默认 ./gal-samples11.txt），发给我。
#   用法同上一个：BASE=/你的/游戏/父目录 bash collect-gal-samples11.sh（个别目录用变量覆盖：ANGELIC= OTOGI=）
#   只读；不复制、不打包任何资源；台词连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。
BASE="${BASE:-.}"
: "${ANGELIC:=$BASE/angelic_py-1.0.2-pc}"
: "${OTOGI:=$BASE/Otogi Frontier R}"
OUT="${OUT:-$PWD/gal-samples11.txt}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
HELPER="$(mktemp --suffix=.py)"; trap 'rm -f "$HELPER"' EXIT
cat > "$HELPER" <<'PYEOF'
import json, os, re, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), str(s))
def read_text(path, limit=None):
    try: raw = open(path, 'rb').read() if limit is None else open(path, 'rb').read(limit)
    except Exception: return ''
    for enc in ('utf-8-sig', 'utf-16', 'cp932', 'gb18030'):
        try: return raw.decode(enc)
        except Exception: pass
    return raw.decode('latin-1')
def find_files(root, pred, limit=100000):
    out = []
    for d, ds, fs in os.walk(root):
        for f in fs:
            p = os.path.join(d, f)
            if pred(p, f):
                out.append(p)
                if len(out) >= limit: return out
    return out
def shape(v, depth=0, maxd=3, key='', limit=12):
    pad = '  ' * depth
    if isinstance(v, dict):
        print('%s%s{} %d 键' % (pad, key, len(v)))
        if depth >= maxd: return
        for n, (k, x) in enumerate(v.items()):
            if n >= limit: print('%s  …' % pad); break
            shape(x, depth + 1, maxd, mask(k) + ': ', limit)
    elif isinstance(v, list):
        print('%s%s[] %d 项' % (pad, key, len(v)))
        if depth >= maxd: return
        for n, x in enumerate(v[:2]): shape(x, depth + 1, maxd, '[%d] ' % n, limit)
    elif isinstance(v, str): print('%s%s"%s" (%d 字)' % (pad, key, mask(v[:60]), len(v)))
    else: print('%s%s%s' % (pad, key, json.dumps(v, ensure_ascii=False)[:40]))
PYEOF
sec() { printf '\n\n########## %s\n' "$*"; }
need() { [ -d "$2" ] || { echo "(没找到目录：$1 = $2)"; return 1; }; echo "目录：$2"; }
py() { "$PY" - "$@"; }

{
echo "收集时间：$(date '+%F %T')    BASE=$BASE"

sec "A. angelic：MS0101B6UK491.rpy 的多行图片定义（用 renpy-monmusu 适配器）"
if need ANGELIC "$ANGELIC"; then
  py "$HELPER" "$ANGELIC" <<'PYEOF'
import importlib.util, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
fs = h.find_files(root, lambda p, f: f.lower() == 'ms0101b6uk491.rpy')
print('脚本：', [os.path.relpath(p, root) for p in fs])
for p in fs[:1]:
    lines = h.read_text(p).splitlines()
    print('总行数 %d' % len(lines))
    for title, pat, cap in (('含 ms0101b6_st_ 的行', r'ms0101b6_st_', 45), ('以 image 开头的行', r'^\s*image\b', 25), ('缩进括号开头的续行', r'^\s+\(', 15), ('hide / show / scene 行', r'^\s*(hide|show|scene)\b', 15)):
        print('-- %s（前 %d 条，带行号）：' % (title, cap))
        n = 0
        for i, l in enumerate(lines, 1):
            if re.search(pat, l): print('  %4d| %s' % (i, h.mask(l)[:200])); n += 1
            if n >= cap: break
PYEOF
fi

sec "B. Otogi Frontier R：MScenes 剧情格式 + 和资源有关的播放代码"
if need OTOGI "$OTOGI"; then
  py "$HELPER" "$OTOGI" <<'PYEOF'
import collections, importlib.util, json, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
ms = os.path.join(root, 'typeadv', 'MScenes'); names = sorted(os.listdir(ms))
print('typeadv/MScenes %d 项；前 6：%s' % (len(names), names[:6]))
for n in (names[:2] + [x for x in ('210452', '280681') if x in names])[:4]:
    p = os.path.join(ms, n)
    if os.path.isdir(p): print('-- MScenes/%s 是目录：%s' % (n, sorted(os.listdir(p))[:12])); continue
    raw = open(p, 'rb').read()
    print('-- MScenes/%s  %d 字节；开头 420 字节：%s' % (n, len(raw), h.mask(raw[:420].decode('utf-8', 'replace')).replace('\n', '\\n')))
    try: h.shape(json.loads(raw.decode('utf-8-sig')), 0, 4, limit=16)
    except Exception as e: print('   不是 json：', type(e).__name__, str(e)[:60])
tw = os.path.join(root, 'typeadv', 'MScenes_TW')
print('typeadv/MScenes_TW %d 项' % (len(os.listdir(tw)) if os.path.isdir(tw) else 0))
# 字段取值
key = collections.Counter(); vo = []
for n in names[:800]:
    p = os.path.join(ms, n)
    if os.path.isdir(p): continue
    try: d = json.loads(h.read_text(p))
    except Exception: continue
    key[tuple(sorted(d.keys()))] += 1
print('-- MScenes 顶层键组合（前 5）：', key.most_common(5))
# voice 目录和场景 id 的对应
vd = os.path.join(root, 'typeadv', 'voice', 'adventure'); dirs = sorted(os.listdir(vd))
print('-- voice_adventure 目录 %d 个；前 6：%s；是否都是 voice_adventure_<数字>：%s' % (len(dirs), dirs[:6], all(re.fullmatch(r'voice_adventure_\d+', x) for x in dirs)))
ids = {x.split('_')[-1] for x in dirs}
print('   其中和 MScenes 文件名同名的：%d；和 json/ 文件名同名的：%d' % (len(ids & set(names)), len(ids & set(os.listdir(os.path.join(root, 'json'))))))
d0 = os.path.join(vd, dirs[0]); print('   %s 里的文件前 6：%s' % (dirs[0], sorted(os.listdir(d0))[:6]))
# 按“目录名 = 场景 id”规则检查 json 剧情的 Voice
hit = miss = 0; ex = []
jn = sorted(os.listdir(os.path.join(root, 'json')))
for n in jn[:2000]:
    try: d = json.loads(h.read_text(os.path.join(root, 'json', n)))
    except Exception: continue
    sid = str(d.get('Id', n))
    for r in d.get('MAdultDetails', []):
        v = r.get('Voice')
        if not v: continue
        p = os.path.join(vd, 'voice_adventure_' + sid, v + '.m4a')
        if os.path.exists(p): hit += 1
        else:
            miss += 1
            if len(ex) < 4: ex.append((sid, v))
print('-- 剧情里的 Voice 按 voice_adventure_<剧情 Id>/<Voice>.m4a 找：存在 %d，不存在 %d；不存在的例子：%s' % (hit, miss, ex))
# 剧情的 json 里 StillPath / Motion / CharaAnimation 与立绘
cs = os.path.join(root, 'typeadv', 'CharaStand', 'Adventure'); ids = sorted(os.listdir(cs))
print('-- CharaStand/Adventure 角色目录 %d 个；前 6：%s；一个目录的文件：%s' % (len(ids), ids[:6], sorted(os.listdir(os.path.join(cs, ids[0])))[:14]))
hs = os.path.join(root, 'chara', 'homestand'); print('-- chara/homestand %d 项；前 6：%s' % (len(os.listdir(hs)), sorted(os.listdir(hs))[:6]))
st = os.path.join(root, 'chara', 'still'); sd = sorted(os.listdir(st)); print('-- chara/still %d 项；前 6：%s' % (len(sd), sd[:6]))
for n in sd[:2]:
    p = os.path.join(st, n)
    if os.path.isdir(p): print('   chara/still/%s：%s' % (n, [(f, os.path.getsize(os.path.join(p, f))) for f in sorted(os.listdir(p))[:12]]))
# VieableEpisodeList
v = os.path.join(root, 'VieableEpisodeList'); vn = sorted(os.listdir(v))
arr = json.loads(h.read_text(os.path.join(v, vn[0])))
print('-- VieableEpisodeList/%s %d 条；前 2 条：%s' % (vn[0], len(arr), h.mask(json.dumps(arr[:2], ensure_ascii=False))[:520]))
ok1 = ok2 = tot = 0; mon = 0
for nm in vn[:300]:
    try: a = json.loads(h.read_text(os.path.join(v, nm)))
    except Exception: continue
    for e in a:
        tot += 1
        if e.get('MMonsterId') is not None: mon += 1
        if e.get('MSceneId') and os.path.exists(os.path.join(ms, str(e['MSceneId']))): ok1 += 1
        if e.get('MAdultId') and os.path.exists(os.path.join(root, 'json', str(e['MAdultId']))): ok2 += 1
print('-- 抽样 300 个列表文件共 %d 条：MScenes/<MSceneId> 存在 %d；json/<MAdultId> 存在 %d；有 MMonsterId %d' % (tot, ok1, ok2, mon))
# 播放代码里的关键片段（原样，按行号，每段约 14 行）
js = h.read_text(os.path.join(root, '000.js'), 800000).splitlines()
def region(title, pat, before=3, after=12, cap=3):
    n = 0
    for i, l in enumerate(js):
        if re.search(pat, l):
            print('-- 000.js「%s」第 %d 行附近：' % (title, i + 1))
            for j in range(max(0, i - before), min(len(js), i + after)): print('   %5d| %s' % (j + 1, js[j].rstrip()[:180]))
            n += 1
            if n >= cap: break
region('Motion 分支', r'\["Motion"\] != null', 6, 14, 1)
region('CharaAnimation', r'CharaAnimation"\] == "3"', 4, 10, 1)
region('Voice 路径', r'typeadv/voice/adventure/voice_adventure_', 4, 10, 2)
region('Still', r'StillPath', 4, 12, 3)
region('Effect', r'\["Effect"\]', 4, 12, 2)
region('BGM', r'\["BGM"\]', 4, 8, 2)
region('SE', r'\["SE"\]', 4, 8, 2)
region('背景/Name→立绘', r'\["Name"\]', 4, 10, 2)
PYEOF
fi

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1
echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
