#!/usr/bin/env bash
# 第八轮样本：ぼくら（真实 JSON 头）/ monmusu（多行图片定义）/ 魔法学园（others 指令、换场景、声音）/ Aku（多轨 Spine）/ Kamihime（layer=3、Memorial）/
# ミナシゴノシゴトR（plist 图集、特效指令、编号分布）/ Grenze（特效取值）/ TSK（<Off> 证据、语音、分类、Sprite）/ Girls Creation（asyncjump 等）/
# Otogi Frontier R（新游戏的整体结构）/ legeclo（裸 voice 行能不能在磁盘上找到）/ 缩略图候选目录清单。输出到一个文件（默认 ./gal-samples8.txt），发给我。
#   用法同上一个：BASE=/你的/游戏/父目录 bash collect-gal-samples8.sh（个别目录用变量覆盖：BOKUSEN= MONMUSU= ARTWHIRL= AKU= KAMI= MINASHIGO_R= GRENZE= TSK= GC= OTOGI= LEGECLO= ANGELIC= 魔法学园 用 ARTWHIRL）
#   只读；不复制、不打包任何资源；台词 / 标题里连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。
BASE="${BASE:-.}"
: "${BOKUSEN:=$BASE/ぼくらの放課後戦争}"
: "${MONMUSU:=$BASE/monmusuTD}"
: "${ARTWHIRL:=$BASE/魔法学园的少女们}"
: "${AKU:=$BASE/Aku No Onna Kanbu - Perigee New Moon Viewer}"
: "${KAMI:=$BASE/Kamihime_Player- 1.0}"
: "${MINASHIGO_R:=$BASE/ミナシゴノシゴトR}"
: "${GRENZE:=$BASE/GrenzeViewer}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
: "${GC:=$BASE/Girls Creation R Viewer}"
: "${OTOGI:=$BASE/Otogi Frontier R}"
: "${LEGECLO:=$BASE/legeclo_py-1.1 (6-22-2026)}"
: "${ANGELIC:=$BASE/angelic_py-1.0.2-pc}"
OUT="${OUT:-$PWD/gal-samples8.txt}"
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
py() { PYTHONPATH="$(dirname "$HELPER")" "$PY" - "$@"; }

{
echo "收集时间：$(date '+%F %T')    BASE=$BASE"

sec "A. ぼくら：真实 JSON 的开头（为什么 1898 个文件都没被 bokusen-json 认出来）"
if need BOKUSEN "$BOKUSEN"; then
  py "$HELPER" "$BOKUSEN" <<'PYEOF'
import glob, json, os, re, sys, importlib.util
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
fs = sorted(glob.glob(os.path.join(root, 'json', '*.json')))
HEAD = re.compile(r'^\s*\{\s*"data"\s*:\s*\{\s*"code"\s*:\s*\{\s*"(?:images|sounds|articles|characters|tags|parameters|commands)"\s*:')
RELAX = re.compile(r'"data"\s*:\s*\{.*?"code"\s*:\s*\{', re.S)
print('json 共 %d 个' % len(fs))
ok = relax = bom = fail = 0; why = {}
for f in fs:
    raw = open(f, 'rb').read(8192)
    if raw[:3] == b'\xef\xbb\xbf': bom += 1
    t = raw.decode('utf-8', 'replace').lstrip('﻿')
    if HEAD.match(t): ok += 1
    if RELAX.search(t): relax += 1
print('现行 HEAD 正则命中 %d；有 BOM %d；放宽（出现 "data":{…"code":{）命中 %d' % (ok, bom, relax))
pick = [fs[0], fs[len(fs) // 2], fs[-1]] if fs else []
for f in pick:
    raw = open(f, 'rb').read()
    print('--- %s  %d 字节' % (os.path.basename(f), len(raw)))
    print('开头 320 字节：', h.mask(raw[:320].decode('utf-8', 'replace')).replace('\n', '\\n'))
    try:
        d = json.loads(raw.decode('utf-8-sig'))
        print('顶层键顺序：', list(d.keys())); print('data 键顺序：', list(d['data'].keys()) if isinstance(d.get('data'), dict) else type(d.get('data')).__name__)
        print('code 键顺序：', list(d['data']['code'].keys()))
    except Exception as e: print('解析失败：', type(e).__name__, str(e)[:100])
bad = []
for f in fs:
    try: json.loads(open(f, 'rb').read().decode('utf-8-sig'))
    except Exception as e: bad.append((os.path.basename(f), type(e).__name__, str(e)[:60]))
print('解析失败的文件 %d 个：' % len(bad), bad[:10])
PYEOF
fi

sec "B. monmusu：MS0101B6UK491.rpy 的多行图片定义"
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
    print('-- 含 ms0101b6_st_ 的行（前 45 条，带行号）：')
    n = 0
    for i, l in enumerate(lines, 1):
        if 'ms0101b6_st_' in l:
            print('  %4d| %s' % (i, h.mask(l)[:200])); n += 1
            if n >= 45: break
    print('-- 以 image 开头的行（前 25 条）：')
    n = 0
    for i, l in enumerate(lines, 1):
        if re.match(r'^\s*image\b', l): print('  %4d| %s' % (i, h.mask(l)[:200])); n += 1
        if n >= 25: break
    print('-- 以 ( 或缩进括号开头的续行（前 15 条）：')
    n = 0
    for i, l in enumerate(lines, 1):
        if re.match(r'^\s+\(', l): print('  %4d| %s' % (i, h.mask(l)[:200])); n += 1
        if n >= 15: break
    print('-- hide / show / scene 行（前 15 条）：')
    n = 0
    for i, l in enumerate(lines, 1):
        if re.match(r'^\s*(hide|show|scene)\b', l): print('  %4d| %s' % (i, h.mask(l)[:200])); n += 1
        if n >= 15: break
PYEOF
fi

sec "C. 魔法学园：AMRITA_ep6_h 的 others 指令 / 换场景 / 声音"
if need ARTWHIRL "$ARTWHIRL"; then
  py "$HELPER" "$ARTWHIRL" <<'PYEOF'
import collections, importlib.util, json, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
fs = h.find_files(root, lambda p, f: f == 'AMRITA_ep6_h.json')
print('脚本：', [os.path.relpath(p, root) for p in fs])
if fs:
    d = json.loads(h.read_text(fs[0]))
    print('顶层键：', list(d.keys()))
    dic = d.get('dic') or []
    n = max((len(v) for v in d.values() if isinstance(v, list)), default=0)
    print('行数（最长的并行数组）：', n)
    def at(k, i):
        v = d.get(k)
        return v[i] if isinstance(v, list) and i < len(v) else None
    forms = collections.Counter(); ex = {}
    for i in range(n):
        o = at('others', i)
        if isinstance(o, list):
            for c in o:
                if isinstance(c, dict):
                    k = (c.get('cmd'), tuple(sorted(x for x in c if x != 'cmd')))
                    forms[k] += 1; ex.setdefault(k, h.mask(json.dumps(c, ensure_ascii=False))[:260])
    print('-- others 里各指令的形状（出现次数）：')
    for k, c in forms.most_common(14): print('  %4d  %s  例: %s' % (c, k, ex[k]))
    print('-- 前 45 行概览（行号: 有台词? bg下标 charas数 others指令 voice? bgm下标）：')
    for i in range(min(n, 45)):
        o = at('others', i); oc = [c.get('cmd') for c in o if isinstance(c, dict)] if isinstance(o, list) else []
        ch = at('charas', i)
        print('  %3d: text=%s bg=%s charas=%s others=%s voice=%s bgm=%s' % (i, 'Y' if at('texts', i) else '-', at('bgs', i), (len(ch) if isinstance(ch, list) else ch), oc, 'Y' if at('voices', i) else '-', at('bgms', i)))
    print('-- 出现 bg_change 的行附近（前 3 处，各前后 2 行的 charas / others）：')
    shown = 0
    for i in range(n):
        o = at('others', i)
        if isinstance(o, list) and any(isinstance(c, dict) and c.get('cmd') == 'bg_change' for c in o):
            print('  行 %d：' % i, [(j, (len(at('charas', j)) if isinstance(at('charas', j), list) else at('charas', j))) for j in range(max(0, i - 2), min(n, i + 3))])
            shown += 1
            if shown >= 3: break
    # 声音：voices / bgms 名字能不能在 game 下按文件名找到
    exts = ('.ogg', '.mp3', '.wav', '.m4a', '.flac')
    index = collections.defaultdict(list)
    for p in h.find_files(os.path.join(root, 'game'), lambda p, f: f.lower().endswith(exts)):
        index[os.path.splitext(os.path.basename(p))[0].lower()].append(os.path.relpath(p, root))
    print('-- game 下音频文件 %d 个（按去扩展名的名字）；一级目录分布：' % sum(len(v) for v in index.values()), dict(collections.Counter(v[0].split(os.sep)[1] if len(v[0].split(os.sep)) > 1 else '' for v in index.values()).most_common(6)))
    vs = [x for x in (d.get('voices') or []) if isinstance(x, str) and x]
    print('voices：非空 %d 个；前 5 个：%s' % (len(vs), vs[:5]))
    miss = [v for v in vs if os.path.splitext(v)[0].lower() not in index]
    print('  按文件名找不到的：%d / %d；前 5 个：%s' % (len(miss), len(vs), miss[:5]))
    print('  找到的例子（名字 → 路径）：', [(v, index[os.path.splitext(v)[0].lower()][:1]) for v in vs[:3] if os.path.splitext(v)[0].lower() in index])
    bg = [dic[i] for i in (d.get('bgms') or []) if isinstance(i, int) and i < len(dic) and isinstance(dic[i], str)]
    print('bgms：%d 个引用；去重前 6：%s' % (len(bg), sorted(set(bg))[:6]))
    mb = [b for b in set(bg) if os.path.splitext(os.path.basename(b))[0].lower() not in index]
    print('  按文件名找不到的 bgm：%d；前 5 个：%s' % (len(mb), mb[:5]))
PYEOF
fi

sec "D. Aku：多轨 Spine（身体 + 表情）的写法和骨架文件"
if need AKU "$AKU"; then
  py "$HELPER" "$AKU" <<'PYEOF'
import collections, importlib.util, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
scripts = h.find_files(root, lambda p, f: f in ('script.txt', 'output_script.txt'))
use = [p for p in scripts if 'SPINE_ACTOR' in h.read_text(p, 400000)][:3]
print('脚本共 %d 个；含 SPINE_ACTOR 的前 3 个：' % len(scripts), [os.path.relpath(p, root) for p in use])
for p in use:
    t = h.read_text(p)
    tags = collections.Counter(re.findall(r'<([A-Za-z_0-9]+)>', t))
    print('--- %s：标签 %s' % (os.path.relpath(p, root), dict(tags.most_common(25))))
    seen = []
    for l in t.splitlines():
        if re.search(r'SPINE_ACTOR|ACTOR_FACE|FACE|EXPRESSION', l) and l not in seen:
            seen.append(l)
            if len(seen) >= 14: break
    for l in seen: print('   ', h.mask(l)[:200])
    d = os.path.join(os.path.dirname(p), 'spines')
    if os.path.isdir(d):
        for f in sorted(os.listdir(d))[:14]:
            fp = os.path.join(d, f); b = open(fp, 'rb').read(80) if f.endswith(('.skel', '.json')) else b''
            ver = re.findall(rb'\d\.\d\.\d+', b)
            print('   spines/%s  %d 字节  版本 %s' % (f, os.path.getsize(fp), [v.decode() for v in ver[:2]]))
        a = [f for f in os.listdir(d) if f.endswith('.atlas')][:1]
        for f in a: print('   atlas 前 6 行：', h.read_text(os.path.join(d, f), 600).splitlines()[:6])
PYEOF
fi

sec "E. Kamihime：layer=3 上放什么 + Memorial 剧情的全部标签 + 缩略图候选"
if need KAMI "$KAMI"; then
  py "$HELPER" "$KAMI" <<'PYEOF'
import collections, importlib.util, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
ks = h.find_files(os.path.join(root, 'game'), lambda p, f: f.endswith('_script.ks'))
print('.ks 共 %d 个' % len(ks))
one = [p for p in ks if os.path.basename(p) == '576_harem-character_script.ks']
mem = [p for p in ks if os.path.basename(p) == '1022_harem-memorial_script.ks']
print('576 脚本：', [os.path.relpath(p, root) for p in one]); print('1022 Memorial：', [os.path.relpath(p, root) for p in mem])
for p in one[:1]:
    lines = h.read_text(p).splitlines(); hits = [i for i, l in enumerate(lines) if 'layer=3' in l][:8]
    print('-- 576：layer=3 的行及前后各 2 行（标签行原样，文字行屏蔽）：')
    for i in hits:
        for j in range(max(0, i - 2), min(len(lines), i + 3)): print('  %4d| %s' % (j + 1, h.mask(lines[j])[:200]))
        print('  ----')
for p in mem[:1]:
    lines = h.read_text(p).splitlines()
    print('-- 1022 Memorial：全部以 [ 开头的行（前 70 条）：')
    n = 0
    for i, l in enumerate(lines, 1):
        if l.startswith('['):
            print('  %4d| %s' % (i, h.mask(l)[:230])); n += 1
            if n >= 70: break
sample = ks[::max(1, len(ks) // 400)][:400]
mt = collections.Counter(); l3 = collections.Counter(); ex = {}
for p in sample:
    for l in h.read_text(p).splitlines():
        m = re.match(r'^\[(mem_[a-z_]+|memorial)\b([^\]]*)\]', l)
        if m:
            k = m.group(1) + ' ' + ' '.join(sorted(re.findall(r'(\w+)=', m.group(2)))); mt[k] += 1; ex.setdefault(k, h.mask(l)[:200])
        m = re.match(r'^\[(\w+)\b[^\]]*\blayer=3\b', l)
        if m: l3[m.group(1)] += 1
print('-- 抽样 %d 个脚本里 mem_* / memorial 标签的形状：' % len(sample))
for k, c in mt.most_common(12): print('  %5d  %s    例: %s' % (c, k, ex[k]))
print('-- layer=3 出现在哪些标签上：', dict(l3.most_common(10)))
print('-- game 下一级目录（含项数）：')
for n in sorted(os.listdir(os.path.join(root, 'game'))):
    p = os.path.join(root, 'game', n)
    if os.path.isdir(p): print('   %s  %d 项' % (n, len(os.listdir(p))))
for pyf in ('4_download_characters_img.py', '5_download_characters_portrait.py', '6_download_characters_img_med.py'):
    fs = h.find_files(os.path.join(root, 'game'), lambda p, f: f == pyf, 1)
    if fs:
        print('-- %s 里和目录有关的行：' % pyf)
        n = 0
        for l in h.read_text(fs[0]).splitlines():
            if re.search(r'makedirs|open\(|os\.path|\.png|\.jpg|url', l): print('   ', l.strip()[:160]); n += 1
            if n >= 10: break
PYEOF
fi

sec "F. ミナシゴノシゴトR：plist 图集 / 特效指令 / 编号分布 / 缩略图候选"
if need MINASHIGO_R "$MINASHIGO_R"; then
  py "$HELPER" "$MINASHIGO_R" <<'PYEOF'
import collections, importlib.util, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
stories = h.find_files(root, lambda p, f: f.endswith('.txt') and re.fullmatch(r'\d{9}\.txt', f) and os.sep + 'story' + os.sep in p)
print('story 脚本 %d 个；目录：%s' % (len(stories), sorted({os.path.relpath(os.path.dirname(p), root) for p in stories})[:3]))
ids = [os.path.basename(p)[:-4] for p in stories]
for k in (1, 2, 3, 5, 6):
    print('  编号前 %d 位分布（前 14）：%s' % (k, dict(collections.Counter(i[:k] for i in ids).most_common(14))))
cmds = collections.defaultdict(collections.Counter); ex = {}
for p in stories[:1500]:
    for l in h.read_text(p).splitlines():
        c = l.split(',', 1)[0].strip()
        if c in ('spriteatlas', 'mask', 'imgconf', 'sprite', 'shake', 'anm', 'flash', 'spine', 'endwmsg', 'spriteoff'):
            k = re.sub(r'-?\d+(\.\d+)?', 'N', l)[:80]; cmds[c][k] += 1; ex.setdefault(k, h.mask(l)[:200])
for c, cn in cmds.items():
    print('-- %s（共 %d 条）：' % (c, sum(cn.values())))
    for k, n in cn.most_common(5): print('   %5d  %s   例: %s' % (n, k, ex[k]))
pl = h.find_files(root, lambda p, f: f == 'stand_a.plist', 1)
print('-- plist 数量：', len(h.find_files(root, lambda p, f: f.endswith('.plist'))))
if pl:
    print('-- 一个 stand_a.plist（%s）的前 60 行：' % os.path.relpath(pl[0], root))
    for l in h.read_text(pl[0], 6000).splitlines()[:60]: print('   ', l[:160])
print('-- 含 50 个以上 png 的目录（前 8 个，附前 4 个名字）：')
cnt = collections.defaultdict(list)
for p in h.find_files(root, lambda p, f: f.endswith('.png')): cnt[os.path.dirname(p)].append(os.path.basename(p))
for d, v in sorted(cnt.items(), key=lambda kv: -len(kv[1]))[:8]: print('   %s  %d 个  %s' % (os.path.relpath(d, root), len(v), sorted(v)[:4]))
print('-- data 下前两层的 json（名称表候选，前 12 个）：')
n = 0
for d, ds, fs in os.walk(os.path.join(root, 'data')):
    if d.count(os.sep) - os.path.join(root, 'data').count(os.sep) > 2: continue
    for f in fs:
        if f.endswith('.json'): print('   %s  %d 字节' % (os.path.relpath(os.path.join(d, f), root), os.path.getsize(os.path.join(d, f)))); n += 1
    if n >= 12: break
print('-- 5 个脚本：编号 → 里面出现的角色目录编号：')
for p in stories[:5]:
    t = h.read_text(p)
    print('   ', os.path.basename(p)[:-4], sorted(set(re.findall(r'character/(\d+)/', t)))[:6])
PYEOF
fi

sec "G. Grenze：特效相关取值 / 候选目录"
if need GRENZE "$GRENZE"; then
  py "$HELPER" "$GRENZE" <<'PYEOF'
import collections, importlib.util, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
xs = [os.path.join(root, 'TextAsset', f) for f in sorted(os.listdir(os.path.join(root, 'TextAsset'))) if re.fullmatch(r'easy_dialog-\d+\.xml', f)]
print('easy_dialog xml 共 %d 个' % len(xs))
cnt = {k: collections.Counter() for k in ('screen_effect', 'pic_action', 'effect', 'effect_pos', 'pic_action_val', 'pic_size', 'back_voice')}
rows = {}
for p in xs[:12]:
    for l in h.read_text(p).splitlines():
        for k in cnt:
            m = re.search(r' %s="([^"]*)"' % k, l)
            if m:
                cnt[k][m.group(1)] += 1
                if (k, m.group(1)) not in rows: rows[(k, m.group(1))] = re.sub(r' text="[^"]*"', ' text="…"', h.mask(l.strip()))[:260]
for k, c in cnt.items(): print('%s（前 12 个取值）：%s' % (k, dict(c.most_common(12))))
print('-- 每个 screen_effect / pic_action / effect 取值各一行（text 已省略）：')
for (k, v), l in sorted(rows.items())[:36]: print('  [%s=%s] %s' % (k, v, l))
pr = os.path.join(root, 'assets', 'resources', 'patchres')
print('-- patchres 一级目录（项数）：', {n: len(os.listdir(os.path.join(pr, n))) for n in sorted(os.listdir(pr)) if os.path.isdir(os.path.join(pr, n))})
for sub in ('icon', 'banner', 'skill', 'atlas'):
    d = os.path.join(pr, sub)
    if os.path.isdir(d): print('-- %s 前 14 个：%s' % (sub, sorted(os.listdir(d))[:14]))
print('-- 名字含 effect / flash / screen / fx 的目录（前 20 个）：', [os.path.relpath(p, pr) for p in h.find_files(pr, lambda p, f: re.search(r'effect|flash|screen|fx', f, re.I) is not None, 20)])
PYEOF
fi

sec "H. TSK：<Off> 的证据 / 语音位置 / 剧情分类 / Sprite"
if need TSK "$TSK"; then
  SA="$TSK/Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X"
  echo "-- a0274_038 / b0274_038 在磁盘上的位置："; find "$TSK" \( -iname '*a0274_038*' -o -iname '*b0274_038*' \) 2>/dev/null | head -5 | sed "s#$TSK/#  -> #"
  echo "-- Sound/Voice 的一级项（前 40 个）和个数："; ls -1 "$SA/Sound/Voice" 2>/dev/null | head -40 | tr '\n' ' '; echo; echo "  总数：$(ls -1 "$SA/Sound/Voice" 2>/dev/null | wc -l)；ImportChara 下 $(ls -1 "$SA/Sound/Voice/ImportChara" 2>/dev/null | wc -l) 个目录；BgVoice $(ls -1 "$SA/Sound/BgVoice" 2>/dev/null | wc -l) 个文件"
  py "$HELPER" "$SA" <<'PYEOF'
import collections, glob, importlib.util, json, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
sa = sys.argv[2]
books = sorted(glob.glob(os.path.join(sa, 'Adventure', '**', '*.book.json'), recursive=True))
print('book.json 共 %d 个' % len(books))
cell = lambda r, i: (r['strings'][i] if len(r['strings']) > i else '')
stat = collections.Counter()
for f in books[::max(1, len(books) // 120)][:120]:
    try: d = json.loads(h.read_text(f))
    except Exception: continue
    for g in d.get('importGridList', []):
        shown, offonly = set(), set()
        for r in g['rows']:
            if r.get('isEmpty') or r.get('isCommentOut'): continue
            c0, a1, a2, a3 = cell(r, 0), cell(r, 1), cell(r, 2), cell(r, 3)
            if c0 == '' and a1 and a3.startswith('Chara'):
                (offonly if a2 == '<Off>' else shown).add(a1)
                if a2 != '<Off>': offonly.discard(a1)
            elif c0 == 'CharacterOff': shown.clear(); offonly.clear()
            elif c0 in ('Tween', 'Shake'):
                if a1 == 'Graphics' or not a1: stat[c0 + ':非角色'] += 1
                elif a1 in shown: stat[c0 + ':目标在“显示”集合'] += 1
                elif a1 in offonly: stat[c0 + ':目标只在 <Off> 行出现过'] += 1
                else: stat[c0 + ':目标从未出现过'] += 1
print('-- Tween / Shake 的目标在场情况（抽样 120 个文件）：')
for k, n in sorted(stat.items()): print('   %5d  %s' % (n, k))
cs = sorted(glob.glob(os.path.join(sa, 'Adventure', 'CharaScenario', '*.book.json')))
ids = [re.search(r'CharaScenario(\d+)', f).group(1) for f in cs]
print('-- CharaScenario %d 个；首位分布 %s；前 4 位个数 %d；9 开头的前 8 个 %s' % (len(ids), dict(collections.Counter(i[0] for i in ids)), len({i[:4] for i in ids}), [i for i in ids if i.startswith('9')][:8]))
mp = os.path.join(sa, 'Adventure', 'Master.chapter.json')
m = json.loads(h.read_text(mp)); chars = {}; tex = {}
for g in m['settingList']:
    nm = g['name'].split(':')[-1]
    rows = [r for r in g['rows'] if not r.get('isEmpty') and not r.get('isCommentOut')]
    if nm == 'Character':
        for r in rows[1:]:
            mm = re.search(r'ch_(\d{7})', cell(r, 10))
            if mm: chars.setdefault(mm.group(1)[:4], set()).add((h.mask(cell(r, 1)).split('-')[0], h.mask(cell(r, 2))))
    if nm == 'Texture':
        for r in rows[1:]: tex[cell(r, 1)] = (cell(r, 2), cell(r, 9))
print('-- 前 4 位 → 角色名（前 10 个人物剧情的 4 位）：', {k: sorted(chars.get(k, []))[:2] for k in sorted({i[:4] for i in ids})[:10]})
print('-- 9 开头的 4 位在 Character 表里有吗：', {k: bool(chars.get(k)) for k in sorted({i[:4] for i in ids if i.startswith('9')})[:6]})
sp = collections.Counter(); first = {}
for f in books[::max(1, len(books) // 80)][:80]:
    try: d = json.loads(h.read_text(f))
    except Exception: continue
    for g in d.get('importGridList', []):
        for r in g['rows']:
            if not r.get('isEmpty') and cell(r, 0) == 'Sprite': sp[cell(r, 1)] += 1; first.setdefault(cell(r, 1), h.mask(json.dumps({i: c for i, c in enumerate(r['strings']) if c}, ensure_ascii=False))[:200])
print('-- Sprite 的 Arg1 标签（前 22 个）→ 在 Texture 表里是什么 → 文件在不在：')
for k, n in sp.most_common(22):
    t = tex.get(k); ok = os.path.exists(os.path.join(sa, t[1])) if t and t[1] else None
    print('   %5d  %-16s %s 文件存在=%s   行例: %s' % (n, k, t, ok, first[k]))
td = os.path.join(sa, 'Textures', 'Sprites', 'Chara')
if os.path.isdir(td):
    for sub in sorted(os.listdir(td))[:4]: print('-- Textures/Sprites/Chara/%s：%d 个，前 4 个 %s' % (sub, len(os.listdir(os.path.join(td, sub))), sorted(os.listdir(os.path.join(td, sub)))[:4]))
PYEOF
fi

sec "I. Girls Creation：asyncjump / asyncmoveobject / cgmode / CrossFade 的上下文"
if need GC "$GC"; then
  py "$HELPER" "$GC" <<'PYEOF'
import collections, importlib.util, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
fs = h.find_files(root, lambda p, f: f.startswith('hmr_') and f.endswith('.txt'))
print('hmr_*.txt 共 %d 个' % len(fs))
t = [p for p in fs if os.path.basename(p) == 'hmr_40101113.txt']
print('hmr_40101113：', [os.path.relpath(p, root) for p in t])
for p in t[:1]:
    lines = h.read_text(p).splitlines()
    hits = [i for i, l in enumerate(lines) if re.search(r'asyncjump|asyncmoveobject|cgmode|CrossFade', l, re.I)][:8]
    for i in hits:
        for j in range(max(0, i - 2), min(len(lines), i + 3)): print('  %4d| %s' % (j + 1, h.mask(lines[j])[:200]))
        print('  ----')
forms = collections.Counter(); ex = {}
for p in fs:
    for l in h.read_text(p).splitlines():
        if l.lower().startswith('asyncjump'):
            k = re.sub(r'-?\d+(\.\d+)?', 'N', l)[:70]; forms[k] += 1; ex.setdefault(k, l[:160])
print('-- asyncjump 的写法（前 8）：')
for k, n in forms.most_common(8): print('   %5d  %s   例: %s' % (n, k, ex[k]))
cmds = collections.Counter()
for p in fs[:300]:
    for l in h.read_text(p).splitlines(): cmds[l.split(',', 1)[0].strip()] += 1
print('-- 行式脚本命令直方图（前 40）：', '; '.join('%s×%d' % kv for kv in cmds.most_common(40)))
PYEOF
fi

sec "J. Otogi Frontier R：新游戏的整体结构"
if need OTOGI "$OTOGI"; then
  py "$HELPER" "$OTOGI" <<'PYEOF'
import collections, importlib.util, json, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
print('-- 一级项（目录带项数）：')
for n in sorted(os.listdir(root)):
    p = os.path.join(root, n)
    print('   %s%s' % (n, ('/  %d 项' % len(os.listdir(p))) if os.path.isdir(p) else '  %d 字节' % os.path.getsize(p)))
ep = os.path.join(root, 'Episode', 'Main')
if os.path.isdir(ep):
    ds = sorted(os.listdir(ep)); print('-- Episode/Main：%d 个，前 6：%s，后 3：%s' % (len(ds), ds[:6], ds[-3:]))
    d1 = os.path.join(ep, ds[0])
    for dp, dn, fn in os.walk(d1):
        for f in sorted(fn)[:30]: print('   %s  %d 字节' % (os.path.relpath(os.path.join(dp, f), root), os.path.getsize(os.path.join(dp, f))))
    files = h.find_files(d1, lambda p, f: True, 3)
    for p in files[:3]:
        t = h.read_text(p, 4000)
        print('-- %s 开头：' % os.path.relpath(p, root), h.mask(t[:500]).replace('\n', '\\n'))
        try: h.shape(json.loads(h.read_text(p)), 0, 3)
        except Exception: pass
for rel in ('list.json', 'userdata.json', 'MasterData/MMonsters.json', 'MasterData/MSpirits.json'):
    p = os.path.join(root, rel)
    if os.path.exists(p):
        try: print('-- %s：' % rel); h.shape(json.loads(h.read_text(p)), 0, 2)
        except Exception as e: print('   解析失败', str(e)[:80])
v = os.path.join(root, 'VieableEpisodeList')
if os.path.isdir(v):
    f = sorted(os.listdir(v))[0]; t = h.read_text(os.path.join(v, f), 600)
    print('-- VieableEpisodeList/%s：%s' % (f, h.mask(t).replace('\n', '\\n')[:300]))
for sub in ('json', 'jsoncn', 'typeadv', 'chara', 'bgm', 'othersounds', 'title', 'icon'):
    d = os.path.join(root, sub)
    if os.path.isdir(d):
        names = sorted(os.listdir(d)); print('-- %s：%d 项，前 12：%s' % (sub, len(names), names[:12]))
for sub in ('json', 'jsoncn'):
    d = os.path.join(root, sub)
    if os.path.isdir(d):
        fs = [f for f in sorted(os.listdir(d)) if f.endswith('.json')][:1]
        for f in fs:
            print('-- %s/%s 的结构：' % (sub, f))
            try: h.shape(json.loads(h.read_text(os.path.join(d, f))), 0, 3)
            except Exception as e: print('   解析失败', str(e)[:80])
sk = h.find_files(os.path.join(root, 'chara'), lambda p, f: f.endswith('.json'), 400)
vers = collections.Counter();
for p in sk:
    m = re.search(r'"spine"\s*:\s*"([^"]+)"', h.read_text(p, 600))
    if m: vers[m.group(1)] += 1
print('-- chara 下的 json 骨架：%d 个；spine 版本分布 %s' % (len(sk), dict(vers.most_common(6))))
js = [os.path.join(root, f) for f in ('spine-player.js', '00spine-player.js', 'spine-webgl.js') if os.path.exists(os.path.join(root, f))]
for p in js: print('-- %s 版本线索：' % os.path.basename(p), re.findall(r'(?:version|Version)["\':= ]{1,4}([0-9.]{3,10})', h.read_text(p, 200000))[:4])
st = h.find_files(os.path.join(root, 'typeadv'), lambda p, f: True, 30)
print('-- typeadv 前 30 个文件：', [os.path.relpath(p, root) for p in st[:30]])
PYEOF
fi

sec "K. legeclo：裸 voice 行指向的文件在磁盘上存在吗 + tl 目录"
if need LEGECLO "$LEGECLO"; then
  py "$HELPER" "$LEGECLO" <<'PYEOF'
import collections, importlib.util, os, re, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
root = sys.argv[2]
g = os.path.join(root, 'game')
fs = h.find_files(os.path.join(g, 'script'), lambda p, f: f == 'artemis_halloween_03.rpy')
print('脚本（game/script 下）：', [os.path.relpath(p, root) for p in fs])
for p in fs[:1]:
    ps = [m.group(1) for m in re.finditer(r'^\s*voice\s+"([^"]+)"', h.read_text(p), re.M)]
    ex = [x for x in ps if os.path.exists(os.path.join(g, x))]
    print('voice 行 %d 条；以 game/ 为根能找到 %d 条；找不到的前 4 条：%s' % (len(ps), len(ex), [x for x in ps if x not in ex][:4]))
    print('前 3 条：', ps[:3])
print('game 下一级目录：', sorted(n for n in os.listdir(g) if os.path.isdir(os.path.join(g, n)))[:20])
vd = os.path.join(g, 'audio', 'voice')
if os.path.isdir(vd): print('audio/voice：%d 项；前 6：%s' % (len(os.listdir(vd)), sorted(os.listdir(vd))[:6]))
print('rpy 数量：game/script %d，game/tl %d' % (len(h.find_files(os.path.join(g, 'script'), lambda p, f: f.endswith('.rpy'))), len(h.find_files(os.path.join(g, 'tl'), lambda p, f: f.endswith('.rpy')))))
PYEOF
fi

sec "L. 缩略图候选：魔法学园 / angelic / Aster 家族"
py "$HELPER" "$ARTWHIRL" "$ANGELIC" "$BASE" <<'PYEOF'
import collections, importlib.util, os, sys
spec = importlib.util.spec_from_file_location('h', sys.argv[1]); h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
art, ang, base = sys.argv[2], sys.argv[3], sys.argv[4]
def top(d, depth=2):
    if not os.path.isdir(d): print('   (没有 %s)' % d); return
    for n in sorted(os.listdir(d)):
        p = os.path.join(d, n)
        if os.path.isdir(p):
            files = h.find_files(p, lambda q, f: f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')), 5000)
            print('   %s/  图片 %d 个；前 4：%s' % (os.path.relpath(p, d), len(files), sorted(os.path.basename(x) for x in files)[:4]))
print('-- 魔法学园 game/images 一级目录：'); top(os.path.join(art, 'game', 'images'))
print('-- angelic game/images 一级目录：'); top(os.path.join(ang, 'game', 'images'))
print('-- angelic game 一级目录：', sorted(os.listdir(os.path.join(ang, 'game')))[:20] if os.path.isdir(os.path.join(ang, 'game')) else '(无)')
for n in ('Angelica Aster R Viewer', 'Girls Creation R Viewer', 'maid', 'jaxin'):
    d = os.path.join(base, n)
    if not os.path.isdir(d): continue
    scenes = h.find_files(d, lambda p, f: f in ('script.txt', 'output_script.txt'))
    th = h.find_files(d, lambda p, f: f.startswith('thumbnail.'))
    print('-- %s：场景脚本 %d 个，thumbnail.* %d 个' % (n, len(scenes), len(th)))
PYEOF

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1
echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
