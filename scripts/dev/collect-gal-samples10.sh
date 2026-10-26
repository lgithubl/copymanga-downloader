#!/usr/bin/env bash
# 第十轮样本（Otogi Frontier R 的资源对应 + Grenze 数字编号对应 + monmusu 脚本位置）。输出到一个文件（默认 ./gal-samples10.txt），发给我。
#   用法同上一个：BASE=/你的/游戏/父目录 bash collect-gal-samples10.sh（个别目录用变量覆盖：OTOGI= GRENZE=）
#   只读；不复制、不打包任何资源；台词连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。
BASE="${BASE:-.}"
: "${OTOGI:=$BASE/Otogi Frontier R}"
: "${GRENZE:=$BASE/GrenzeViewer}"
OUT="${OUT:-$PWD/gal-samples10.txt}"
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

sec "A. Otogi Frontier R：脚本里的 Voice / StillPath / BGM / SE 怎么对应到文件"
if need OTOGI "$OTOGI"; then
  py "$HELPER" "$OTOGI" <<'PYEOF'
import collections, importlib.util, json, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
# 000.js 里怎么拼 URL（最直接的证据）
js = h.read_text(os.path.join(root, '000.js'), 600000).splitlines()
pat = re.compile(r'StillPath|\.Voice|\.BGM|\.SE\b|\bMotion\b|CharaAnimation|typeadv/voice|chara/still|CharaStand|homestand|MScenes|\.Effect|\.Name\b')
print('-- 000.js 中相关行（前 60 条，带行号）：')
n = 0
for i, l in enumerate(js, 1):
    if pat.search(l): print('  %5d| %s' % (i, l.strip()[:220])); n += 1
    if n >= 60: break
ep = os.path.join(root, 'Episode', 'Main')
p = os.path.join(ep, sorted(os.listdir(ep))[0])
t = h.read_text(p, 3000)
print('-- Episode/Main/%s 开头：%s' % (os.path.basename(p), h.mask(t[:500]).replace('\n', '\\n')))
try: h.shape(json.loads(h.read_text(p)), 0, 3, limit=14)
except Exception as e: print('   不是 json：', str(e)[:60])
# 全部剧情的字段取值
files = [os.path.join(root, 'json', n) for n in sorted(os.listdir(os.path.join(root, 'json')))]
motion = collections.Counter(); anim = collections.Counter(); eff = collections.Counter(); se = collections.Counter(); still = collections.Counter(); nvoice = nbgm = 0
vnames = []; bgms = set(); ses = set(); stills = set()
for f in files[:1500]:
    try: d = json.loads(h.read_text(f))
    except Exception: continue
    for r in d.get('MAdultDetails', []):
        motion[r.get('Motion')] += 1; anim[r.get('CharaAnimation')] += 1
        if r.get('Effect'): eff[json.dumps(r['Effect'], ensure_ascii=False)[:60]] += 1
        if r.get('SE'): se[r['SE']] += 1; ses.add(r['SE'])
        if r.get('StillPath'): still[r['StillPath']] += 1; stills.add(r['StillPath'])
        if r.get('Voice'): vnames.append(r['Voice'])
        if r.get('BGM'): bgms.add(r['BGM'])
print('-- Motion：%s；CharaAnimation：%s' % (dict(motion.most_common(10)), dict(anim.most_common(10))))
print('-- Effect 非空的取值（前 8）：', dict(eff.most_common(8)))
print('-- SE 取值（前 10）：', dict(se.most_common(10)), '；StillPath 取值数 %d，前 8：%s' % (len(still), dict(still.most_common(8))))
# 文件查找：Voice
allv = h.find_files(os.path.join(root, 'typeadv', 'voice'), lambda p, f: True, 400000)
vidx = {os.path.splitext(os.path.basename(p))[0]: os.path.relpath(p, root) for p in allv}
print('-- typeadv/voice 下文件 %d 个；一级目录前 8：%s' % (len(vidx), sorted(os.listdir(os.path.join(root, 'typeadv', 'voice')))[:8]))
print('   一级以下：', sorted(os.listdir(os.path.join(root, 'typeadv', 'voice', 'adventure')))[:8] if os.path.isdir(os.path.join(root, 'typeadv', 'voice', 'adventure')) else '(无 adventure)')
hit = [v for v in set(vnames) if v in vidx]
print('-- 剧情里 Voice 名 %d 个（去重）；能按文件名找到 %d 个；前 4 个找到：%s' % (len(set(vnames)), len(hit), [(v, vidx[v]) for v in hit[:4]]))
print('   找不到的前 6 个：', [v for v in set(vnames) if v not in vidx][:6])
# BGM / SE
bg = os.path.join(root, 'bgm'); bnames = set(os.listdir(bg)) if os.path.isdir(bg) else set()
print('-- BGM 名 %d 个；bgm/<名>.m4a 存在 %d 个；不存在的前 4 个：%s' % (len(bgms), sum(1 for b in bgms if b + '.m4a' in bnames), [b for b in bgms if b + '.m4a' not in bnames][:4]))
sfx = h.find_files(root, lambda p, f: re.fullmatch(r'(se|SE)[^/]*\.(m4a|mp3|ogg|wav)', f) is not None, 3000)
print('-- 名字像 SE 的音频文件 %d 个；前 6：%s' % (len(sfx), [os.path.relpath(p, root) for p in sfx[:6]]))
print('   othersounds：', [os.path.relpath(p, root) for p in h.find_files(os.path.join(root, 'othersounds'), lambda p, f: True, 8)])
# 静图：StillPath 值在哪些文件名里
for sp in sorted(stills)[:3]:
    hits = h.find_files(root, lambda p, f, sp=sp: sp in f, 12)
    print('-- StillPath=%s 相关文件：%s' % (sp, [os.path.relpath(p, root) for p in hits]))
# MScenes / CharaStand / still 目录
ms = os.path.join(root, 'typeadv', 'MScenes')
for n in sorted(os.listdir(ms))[:3]:
    p = os.path.join(ms, n)
    print('-- typeadv/MScenes/%s：%s' % (n, ('目录 ' + str(sorted(os.listdir(p))[:12])) if os.path.isdir(p) else '文件 %d 字节，开头 %s' % (os.path.getsize(p), h.mask(h.read_text(p, 300)).replace('\n', '\\n')[:200])))
cs = os.path.join(root, 'typeadv', 'CharaStand', 'Adventure')
if os.path.isdir(cs):
    ids = sorted(os.listdir(cs)); print('-- CharaStand/Adventure 角色 %d 个；前 6：%s；其中一个的文件：%s' % (len(ids), ids[:6], sorted(os.listdir(os.path.join(cs, ids[0])))[:14]))
st = os.path.join(root, 'chara', 'still')
if os.path.isdir(st):
    ids = sorted(os.listdir(st)); print('-- chara/still 目录 %d 个；前 6：%s；一个目录的文件：%s' % (len(ids), ids[:6], sorted(os.listdir(os.path.join(st, ids[0])))[:14]))
# VieableEpisodeList：条目和剧情的对应
v = os.path.join(root, 'VieableEpisodeList'); names = sorted(os.listdir(v))
arr = json.loads(h.read_text(os.path.join(v, names[0])))
print('-- VieableEpisodeList/%s：%d 条；前 2 条（Title 屏蔽）：%s' % (names[0], len(arr), h.mask(json.dumps(arr[:2], ensure_ascii=False))[:520]))
sc = ad = ok1 = ok2 = tot = 0; mon = collections.Counter()
for nm in names[:300]:
    try: a = json.loads(h.read_text(os.path.join(v, nm)))
    except Exception: continue
    for e in a:
        tot += 1; mon[e.get('MMonsterId') is not None] += 1
        if e.get('MSceneId') and os.path.exists(os.path.join(root, 'json', str(e['MSceneId']))): ok1 += 1
        if e.get('MAdultId') and os.path.exists(os.path.join(root, 'json', str(e['MAdultId']))): ok2 += 1
print('-- 抽样 300 个列表文件共 %d 条：json/<MSceneId> 存在 %d；json/<MAdultId> 存在 %d；有 MMonsterId 的 %d' % (tot, ok1, ok2, mon.get(True, 0)))
PYEOF
fi

sec "B. Grenze：数字编号 ↔ 日文名（同一个 id 在不同文件里的取值配对）"
if need GRENZE "$GRENZE"; then
  py "$HELPER" "$GRENZE" <<'PYEOF'
import collections, importlib.util, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]; ta = os.path.join(root, 'TextAsset')
xs = sorted(f for f in os.listdir(ta) if re.fullmatch(r'easy_dialog-\d+\.xml', f))
rows = collections.defaultdict(list)
for f in xs:
    for l in h.read_text(os.path.join(ta, f)).splitlines():
        m = re.search(r' id="(\d+)"', l)
        if not m: continue
        rows[m.group(1)].append((f, {k: v for k, v in re.findall(r' (screen_effect|pic_action|effect|effect_pos|pic_size)="([^"]*)"', l)}))
multi = {k: v for k, v in rows.items() if len(v) > 1}
print('xml %d 个；行 id %d 个；出现在多个文件里的 id：%d' % (len(xs), len(rows), len(multi)))
pairs = collections.defaultdict(collections.Counter)
for k, v in multi.items():
    for attr in ('screen_effect', 'pic_action', 'effect', 'effect_pos', 'pic_size'):
        vals = {e.get(attr) for _, e in v if e.get(attr)}
        nums = [x for x in vals if re.fullmatch(r'\d+', x)]; names = [x for x in vals if not re.fullmatch(r'\d+', x)]
        for a in nums:
            for b in names: pairs[attr][(a, b)] += 1
for attr, c in pairs.items():
    print('-- %s：数字 ↔ 名字（同一行 id，前 14）：%s' % (attr, [('%s=%s' % k, n) for k, n in c.most_common(14)]))
kinds = collections.Counter()
for f in xs:
    t = h.read_text(os.path.join(ta, f), 200000)
    kinds[f] = (len(re.findall(r'screen_effect="\d+"', t)), len(re.findall(r'screen_effect="[^\d"][^"]*"', t)))
print('-- 每个文件 screen_effect 为 (数字个数, 名字个数)（前 14）：', list(kinds.items())[:14])
PYEOF
fi

sec "C. monmusu：MS0101B6UK491 到底在哪个目录"
find "$BASE" -maxdepth 7 \( -iname 'MS0101B6UK491.rpy' -o -iname 'MS0101B6UK491.rpyc' \) 2>/dev/null | head -5 | sed "s#^#  #"

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1
echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
