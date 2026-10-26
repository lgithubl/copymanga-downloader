#!/usr/bin/env bash
# 第九轮样本（补第八轮的缺口）：monmusu（目录名是 モンスター娘TD）/ 魔法学园（voices 的真实形状、action / emotion 的取值）/ Aku（3.6 JSON 骨架结构）/
# Grenze（特效名对应的数据表）/ Otogi Frontier R（剧情文件的格式）/ ミナシゴノシゴトR（plist 帧名、名称表、一个完整脚本）/ TSK（找不到的 Tween 目标上下文、语音存在率）。
# 输出到一个文件（默认 ./gal-samples9.txt），发给我。
#   用法同上一个：BASE=/你的/游戏/父目录 bash collect-gal-samples9.sh（个别目录用变量覆盖：MONMUSU= ARTWHIRL= AKU= GRENZE= OTOGI= MINASHIGO_R= TSK=）
#   只读；不复制、不打包任何资源；台词连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。
BASE="${BASE:-.}"
: "${MONMUSU:=$BASE/モンスター娘TD}"
: "${ARTWHIRL:=$BASE/魔法学园的少女们}"
: "${AKU:=$BASE/Aku No Onna Kanbu - Perigee New Moon Viewer}"
: "${GRENZE:=$BASE/GrenzeViewer}"
: "${OTOGI:=$BASE/Otogi Frontier R}"
: "${MINASHIGO_R:=$BASE/ミナシゴノシゴトR}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
OUT="${OUT:-$PWD/gal-samples9.txt}"
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

sec "A. monmusu：MS0101B6UK491.rpy 的多行图片定义（目录名是 モンスター娘TD）"
if need MONMUSU "$MONMUSU"; then
  py "$HELPER" "$MONMUSU" <<'PYEOF'
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

sec "B. 魔法学园：voices 的真实形状 / action·emotion 的取值 / bg_change 的取值"
if need ARTWHIRL "$ARTWHIRL"; then
  py "$HELPER" "$ARTWHIRL" <<'PYEOF'
import collections, importlib.util, json, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
fs = h.find_files(root, lambda p, f: f.endswith('.json') and os.sep + 'episode_scripts' + os.sep in p or os.sep + 'hscripts' + os.sep in p and f.endswith('.json'))
print('剧情 json 共 %d 个' % len(fs))
one = [p for p in fs if os.path.basename(p) == 'AMRITA_ep6_h.json']
if one:
    d = json.loads(h.read_text(one[0])); dic = d.get('dic') or []
    for k in ('voices', 'effects', 'waits', 'names', 'colors', 'resources', 'chara_keys', 'chara_bodies'):
        v = d.get(k)
        if isinstance(v, list):
            nn = [x for x in v if x is not None]
            print('-- %s：长度 %d，非空 %d，类型 %s；前 6 个非空：%s' % (k, len(v), len(nn), dict(collections.Counter(type(x).__name__ for x in nn)), [h.mask(json.dumps(x, ensure_ascii=False))[:80] for x in nn[:6]]))
        else: print('-- %s：%s' % (k, h.mask(json.dumps(v, ensure_ascii=False))[:200]))
    print('-- dic 长度 %d；类型分布 %s' % (len(dic), dict(collections.Counter(type(x).__name__ for x in dic))))
    vs = d.get('voices') or []
    ints = [x for x in vs if isinstance(x, int)]
    print('-- voices 里整数下标 %d 个；对应 dic 取值（前 8）：%s' % (len(ints), [dic[i] for i in ints[:8] if i < len(dic)]))
act = collections.Counter(); emo = collections.Counter(); bgc = collections.Counter(); tgt = collections.Counter()
for p in fs[:600]:
    try: d = json.loads(h.read_text(p))
    except Exception: continue
    for row in (d.get('others') or []):
        if not isinstance(row, list): continue
        for c in row:
            if not isinstance(c, dict): continue
            v = c.get('val')
            if c.get('cmd') == 'action' and isinstance(v, dict): act[v.get('type')] += 1; tgt[len(v.get('target') or [])] += 1
            elif c.get('cmd') == 'emotion' and isinstance(v, dict): emo[v.get('type')] += 1
            elif c.get('cmd') == 'bg_change': bgc[str(v)] += 1
print('-- 抽样 600 个脚本：action 的 type 取值：%s' % dict(act.most_common(20)))
print('   emotion 的 type 取值：%s' % dict(emo.most_common(20)))
print('   bg_change 的 val 取值：%s' % dict(bgc.most_common(10)))
print('   action 的 target 个数分布：%s' % dict(tgt.most_common(5)))
a = os.path.join(root, 'game', 'audio')
if os.path.isdir(a): print('-- game/audio 一级目录（项数）：', {n: len(os.listdir(os.path.join(a, n))) for n in sorted(os.listdir(a)) if os.path.isdir(os.path.join(a, n))})
PYEOF
fi

sec "C. Aku：Spine 3.6 JSON 骨架的结构 + 全部标签"
if need AKU "$AKU"; then
  py "$HELPER" "$AKU" <<'PYEOF'
import collections, importlib.util, json, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
scripts = h.find_files(root, lambda p, f: f in ('script.txt', 'output_script.txt'))
tags = collections.Counter()
for p in scripts[:600]: tags.update(re.findall(r'<([A-Za-z_0-9]+)>', h.read_text(p, 400000)))
print('脚本 %d 个；全部标签（前 70）：%s' % (len(scripts), '; '.join('%s×%d' % kv for kv in tags.most_common(70))))
sk = h.find_files(root, lambda p, f: f.endswith('.json') and os.sep + 'spines' + os.sep in p, 6)
for p in sk[:2]:
    d = json.loads(h.read_text(p))
    print('--- %s' % os.path.relpath(p, root))
    print('顶层键：', list(d.keys())); print('skeleton：', d.get('skeleton'))
    print('bones %d；slots %d；skins：%s' % (len(d.get('bones', [])), len(d.get('slots', [])), (list(d['skins'].keys()) if isinstance(d.get('skins'), dict) else [s.get('name') for s in d.get('skins', [])])[:6]))
    print('ik %d；transform %d；path %d；events %s' % (len(d.get('ik', [])), len(d.get('transform', [])), len(d.get('path', [])), list((d.get('events') or {}).keys())[:6]))
    an = d.get('animations') or {}
    print('animations %d：%s' % (len(an), list(an.keys())[:40]))
    types = collections.Counter(); blend = collections.Counter()
    for s in d.get('slots', []): blend[s.get('blend', 'normal')] += 1
    sk_ = d.get('skins'); skins = sk_.values() if isinstance(sk_, dict) else [x.get('attachments', {}) for x in (sk_ or [])]
    for skin in skins:
        for slot, atts in skin.items():
            for name, att in atts.items(): types[att.get('type', 'region')] += 1
    print('附件类型：', dict(types), '；slot 混合模式：', dict(blend))
    first = list(an.keys())[:1]
    if first: print('第一个动画 %s 的键：' % first[0], list(an[first[0]].keys()))
    a = os.path.splitext(p)[0] + '.atlas'
    if os.path.exists(a): print('atlas 前 14 行：', h.read_text(a, 1200).splitlines()[:14])
PYEOF
fi

sec "D. Grenze：特效名（日文）对应的数据表在哪"
if need GRENZE "$GRENZE"; then
  py "$HELPER" "$GRENZE" <<'PYEOF'
import importlib.util, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]; ta = os.path.join(root, 'TextAsset')
names = sorted(os.listdir(ta))
print('TextAsset %d 个文件；名字含 effect/screen/action/pic/adv/dialog 的：%s' % (len(names), [n for n in names if re.search(r'effect|screen|action|pic|adv|dialog', n, re.I)][:30]))
keys = ['溶明_黒幕', '速い画面揺れ', '立ち絵全消え', 'ダメージエフェクト', 'フラッシュ2回']
for k in keys:
    hits = []
    for n in names:
        if n.startswith('easy_dialog'): continue
        t = h.read_text(os.path.join(ta, n))
        i = t.find(k)
        if i >= 0: hits.append((n, h.mask(t[max(0, i - 160): i + 120]).replace('\n', ' ')))
    print('-- 含「%s」的非对话表：%s' % (k, [x[0] for x in hits][:6]))
    for n, ctx in hits[:2]: print('     [%s] %s' % (n, ctx))
for n in [x for x in names if re.search(r'^(effect|screen|pic_action|adv)', x, re.I)][:4]:
    t = h.read_text(os.path.join(ta, n), 1500); print('-- %s 开头：%s' % (n, h.mask(t).replace('\n', ' ')[:500]))
PYEOF
fi

sec "E. Otogi Frontier R：剧情文件的格式（json/<id> 和 jsoncn/<id> 没有 .json 扩展名）"
if need OTOGI "$OTOGI"; then
  py "$HELPER" "$OTOGI" <<'PYEOF'
import collections, importlib.util, json, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
for sub in ('json', 'jsoncn'):
    d = os.path.join(root, sub)
    if not os.path.isdir(d): continue
    names = sorted(os.listdir(d))[:3] + ['210011']
    for n in names[:4]:
        p = os.path.join(d, n)
        if os.path.isdir(p): print('-- %s/%s 是目录：%s' % (sub, n, sorted(os.listdir(p))[:8])); continue
        if not os.path.exists(p): continue
        raw = open(p, 'rb').read()
        print('-- %s/%s  %d 字节；开头 400 字节：%s' % (sub, n, len(raw), h.mask(raw[:400].decode('utf-8', 'replace')).replace('\n', '\\n')))
        try: h.shape(json.loads(raw.decode('utf-8-sig')), 0, 4, limit=16)
        except Exception as e: print('   不是 json：', type(e).__name__, str(e)[:60])
ep = os.path.join(root, 'Episode', 'Main')
for n in sorted(os.listdir(ep))[:2]:
    p = os.path.join(ep, n); print('-- Episode/Main/%s：%s' % (n, [(f, os.path.getsize(os.path.join(p, f))) for f in sorted(os.listdir(p))[:10]] if os.path.isdir(p) else '(文件)'))
lst = json.loads(h.read_text(os.path.join(root, 'list.json')))
for k in ('chara', 'data'):
    v = lst.get(k, {}); first = list(v.items())[:2]
    print('-- list.json %s 的前 2 项：%s' % (k, h.mask(json.dumps(first, ensure_ascii=False))[:400]))
print('-- list.json worldmap 前 2 项：', h.mask(json.dumps(lst.get('worldmap', [])[:2], ensure_ascii=False))[:300])
for sub in ('typeadv/MScenes', 'typeadv/CharaStand', 'typeadv/bg', 'typeadv/ico', 'typeadv/richadventure', 'chara/homestand', 'chara/still'):
    d = os.path.join(root, sub)
    if os.path.isdir(d):
        files = h.find_files(d, lambda p, f: True, 4000)
        print('-- %s：%d 个文件；前 6：%s' % (sub, len(files), [os.path.relpath(p, d) for p in files[:6]]))
js = h.read_text(os.path.join(root, '000.js'), 400000)
print('-- 000.js 里和剧情加载有关的行（前 25 条）：')
n = 0
for l in js.splitlines():
    if re.search(r'jsoncn|typeadv|\bjson/|MSceneId|adventure', l): print('   ', l.strip()[:200]); n += 1
    if n >= 25: break
PYEOF
fi

sec "F. ミナシゴノシゴトR：plist 帧名 / 名称表 / 一个完整脚本"
if need MINASHIGO_R "$MINASHIGO_R"; then
  py "$HELPER" "$MINASHIGO_R" <<'PYEOF'
import collections, importlib.util, json, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
pl = h.find_files(root, lambda p, f: f == 'stand_a.plist' and os.sep + '600201' + os.sep in p, 1)
print('600201 的 stand_a.plist：', [os.path.relpath(p, root) for p in pl])
for p in pl[:1]:
    t = h.read_text(p); keys = re.findall(r'<key>([^<]+)</key>', t)
    frames = [k for k in keys if re.search(r'\.png$|^body', k)]
    print('帧名共 %d；前 40：%s' % (len(frames), frames[:40]))
    print('metadata 部分：', re.sub(r'\s+', ' ', t[t.find('<key>metadata</key>'): t.find('<key>metadata</key>') + 500]))
st = h.find_files(root, lambda p, f: f == '130010202.txt', 1)
for p in st[:1]:
    print('-- 130010202.txt 全文（前 70 行，台词屏蔽）：')
    for i, l in enumerate(h.read_text(p).splitlines()[:70], 1): print('  %3d| %s' % (i, h.mask(l)[:180]))
rj = os.path.join(root, 'data', 'resource.json')
if os.path.exists(rj):
    print('-- resource.json %d 字节；开头 300 字节：%s' % (os.path.getsize(rj), h.mask(h.read_text(rj, 400)).replace('\n', ' ')[:300]))
    try:
        d = json.loads(h.read_text(rj)); h.shape(d, 0, 2, limit=20)
    except Exception as e: print('   解析失败：', type(e).__name__, str(e)[:80])
th = os.path.join(root, 'data', 'image', 'character', 'thumb')
print('-- character/thumb：', len(os.listdir(th)) if os.path.isdir(th) else '无', sorted(os.listdir(th))[:6] if os.path.isdir(th) else '')
es = os.path.join(root, 'data', 'image', 'episode', 'story')
if os.path.isdir(es):
    pngs = {f[:-4] for f in os.listdir(es) if re.fullmatch(r'\d{9}\.png', f)}
    ids = {os.path.basename(p)[:-4] for p in h.find_files(root, lambda p, f: re.fullmatch(r'\d{9}\.txt', f))}
    print('-- episode/story 的 9 位 png %d 个；脚本 %d 个；有对应缩略图的脚本 %d 个' % (len(pngs), len(ids), len(pngs & ids)))
PYEOF
fi

sec "G. TSK：找不到的 Tween / Shake 目标的上下文 + 语音存在率"
if need TSK "$TSK"; then
  py "$HELPER" "$TSK" <<'PYEOF'
import collections, glob, importlib.util, json, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
sa = os.path.join(root, 'Twinkle Star Knights X_Data', 'StreamingAssets', 'Twinkle Star Knights X')
cell = lambda r, i: (r['strings'][i] if len(r['strings']) > i else '')
books = sorted(glob.glob(os.path.join(sa, 'Adventure', '**', '*.book.json'), recursive=True))
shown_ex = 0
for f in books[::max(1, len(books) // 120)][:120]:
    if shown_ex >= 6: break
    try: d = json.loads(h.read_text(f))
    except Exception: continue
    for g in d.get('importGridList', []):
        rows = [r for r in g['rows'] if not r.get('isEmpty') and not r.get('isCommentOut')]
        seen = set()
        for i, r in enumerate(rows):
            c0, a1, a3 = cell(r, 0), cell(r, 1), cell(r, 3)
            if c0 == '' and a1 and a3.startswith('Chara'): seen.add(a1)
            elif c0 == 'CharacterOff': seen.clear()
            elif c0 in ('Tween', 'Shake') and a1 and a1 != 'Graphics' and a1 not in seen and shown_ex < 6:
                shown_ex += 1
                print('-- %s：第 %d 行是 %s 目标「%s」，之前 6 行（命令 | Arg1 | Arg2 | Arg3）：' % (os.path.relpath(f, sa), i, c0, h.mask(a1)))
                for j in range(max(0, i - 6), i + 1): print('     %s | %s | %s | %s' % (cell(rows[j], 0), h.mask(cell(rows[j], 1)), h.mask(cell(rows[j], 2)), cell(rows[j], 3)))
                break
vd = os.path.join(sa, 'Sound', 'Voice'); bd = os.path.join(sa, 'Sound', 'BgVoice')
index = {}
for p in h.find_files(os.path.join(sa, 'Sound'), lambda p, f: f.endswith('.ogg')): index[os.path.splitext(os.path.basename(p))[0]] = os.path.relpath(p, sa)
print('-- Sound 下 ogg 共 %d 个' % len(index))
for sc in ('CharaScenario9020038', 'CharaScenario1027004', 'CharaScenario1022003'):
    fs = [p for p in books if os.path.basename(p) == sc + '.book.json']
    if not fs: continue
    d = json.loads(h.read_text(fs[0])); voices = []; bgv = []
    for g in d.get('importGridList', []):
        for r in g['rows']:
            if r.get('isEmpty'): continue
            if cell(r, 15) and cell(r, 15) != 'Voice': voices.append(cell(r, 15))
            if cell(r, 0) == 'BgVoice': bgv.append(cell(r, 1))
    miss = [v for v in voices if v not in index]; bmiss = [v for v in bgv if v not in index]
    print('-- %s：Voice %d 个（找不到 %d；前 5 个找不到：%s）；BgVoice %d 个（找不到 %d；前 5 个：%s）' % (sc, len(voices), len(miss), miss[:5], len(bgv), len(bmiss), bmiss[:5]))
    ex = [v for v in voices if v in index][:3]; print('     找到的例子：', [(v, index[v]) for v in ex])
    pre = collections.Counter(v.rsplit('_', 1)[0] for v in voices); print('     Voice 前缀（去末段）计数：', dict(pre.most_common(5)))
PYEOF
fi

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1
echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
