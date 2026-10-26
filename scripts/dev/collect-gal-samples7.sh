#!/usr/bin/env bash
# 第七轮样本（缩略图映射 + 未渲染指令）：legeclo（voice 的写法 / 脚本和 thumbnail 的对应）、Girls Creation（subimage / cgmode / asyncmoveobject / CrossFade 原始行）、minashigo（scene 和 thumb 的对应）、train（Bases 和 MasterData 的对应）、deepone（角色目录的全部变体）。输出到一个文件（默认 ./gal-samples7.txt），发给我。
#   用法同上一个：BASE=/你的/游戏/父目录 bash collect-gal-samples7.sh（个别目录用变量覆盖：LEGECLO=… GC=… MINASHIGO=… TRAIN=… DEEP=…）
#   只读；不复制、不打包任何资源；台词连续 3 个以上的中日文字符会被替换成 <N字>（目录名、文件名不屏蔽）。
BASE="${BASE:-.}"
: "${LEGECLO:=$BASE/legeclo_py-1.1 (6-22-2026)}"
: "${GC:=$BASE/Girls Creation R Viewer}"
: "${MINASHIGO:=$BASE/MinashigoViewer-1.2-20250405}"
: "${TRAIN:=$BASE/train}"
: "${DEEP:=$BASE/deeponecgv20260801}"
OUT="${OUT:-$PWD/gal-samples7.txt}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
sec() { printf '\n\n########## %s\n' "$*"; }
need() { [ -d "$2" ] || { echo "(没找到目录：$1 = $2)"; return 1; }; echo "目录：$2"; }

{
echo "收集时间：$(date '+%F %T')    BASE=$BASE"

sec "A. legeclo：voice 的写法（未渲染的 voice ×39）+ 脚本和 thumbnail 的对应"
if need LEGECLO "$LEGECLO"; then
  "$PY" - "$LEGECLO" <<'PYEOF'
import collections, os, re, sys
root = sys.argv[1]
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
PATH_RE = re.compile(r'^(?:play|queue)\s+(music|sound|audio|voice)\s+(?:\[[^\]]*\]|"((?:[^"\\]|\\.)*)")')
scripts = []
for d, _, fs in os.walk(root):
    for f in fs:
        if f.endswith('.rpy'): scripts.append(os.path.join(d, f))
print('rpy 脚本共 %d 个' % len(scripts))
def read(p):
    b = open(p, 'rb').read()
    for enc in ('utf-8-sig', 'cp932', 'gb18030'):
        try: return b.decode(enc)
        except Exception: pass
    return b.decode('latin-1')
target = [p for p in scripts if os.path.basename(p).startswith('artemis_halloween_03')]
print('-- artemis_halloween_03 脚本：', [os.path.relpath(p, root) for p in target])
def voice_lines(text):
    out = []
    for ln in text.splitlines():
        s = ln.strip()
        if re.match(r'^(play|queue)\s+voice\b', s) or re.search(r'\bvoice\b', s) and not s.startswith('#'):
            m = PATH_RE.match(s)
            out.append((s, bool(m and m.group(2) is not None)))
    return out
for p in target[:1]:
    vl = voice_lines(read(p))
    print('   含 voice 的行 %d 条；其中适配器认得的 %d 条；认不得的前 15 条：' % (len(vl), sum(1 for _, ok in vl if ok)))
    for s, ok in [x for x in vl if not x[1]][:15]: print('     ', mask(s)[:200])
    print('   认得的前 3 条：', [mask(s)[:120] for s, ok in vl if ok][:3])
print('-- 全部脚本里认不得的 voice 行，按写法归类（数字、引号内文字归一）：')
pat = collections.Counter(); ex = {}
for p in scripts:
    for s, ok in voice_lines(read(p)):
        if ok: continue
        k = re.sub(r'"[^"]*"', '"…"', re.sub(r'\d+', 'N', mask(s)))[:120]
        pat[k] += 1; ex.setdefault(k, mask(s)[:200])
for k, n in pat.most_common(12): print('   %5d  %s    例: %s' % (n, k, ex[k]))
# thumbnail 对应
thumbs = []
for d, _, fs in os.walk(os.path.join(root, 'game', 'images', 'thumbnail', 'st')):
    thumbs += fs
print('-- game/images/thumbnail/st 共 %d 个文件；前 12 个：' % len(thumbs), sorted(thumbs)[:12])
rx = re.compile(r'^hs_(.+)_st_(\d\d)(\d\d)(?:_(idle|hover))?\.png$')
by = collections.defaultdict(list)
for f in thumbs:
    m = rx.match(f)
    if m: by['%s_%s' % (m.group(1), m.group(2))].append(f)
print('   regex 命中 %d 个文件，聚成 %d 个 key' % (sum(len(v) for v in by.values()), len(by)))
stems = sorted({os.path.splitext(os.path.basename(p))[0] for p in scripts})
hit = [s for s in stems if s in by]
print('   脚本 %d 个，key 命中 %d 个；没命中的前 12 个：%s' % (len(stems), len(hit), [s for s in stems if s not in by][:12]))
print('   命中例子（前 5 个）：', [(s, by[s]) for s in hit[:5]])
print('   key 里 NN 之后的两位（variant）取值：', dict(collections.Counter(rx.match(f).group(3) for f in thumbs if rx.match(f)).most_common(8)))
PYEOF
fi

sec "B. Girls Creation：subimage / cgmode / asyncmoveobject / CrossFade 的原始行"
if need GC "$GC"; then
  "$PY" - "$GC" <<'PYEOF'
import collections, os, re, sys
root = sys.argv[1]
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
scripts = []
for d, _, fs in os.walk(root):
    for f in fs:
        if f.lower().endswith('.txt') and f.startswith(('hmr_', 'chmr', 'scene', 'script')) or f == 'script.txt': scripts.append(os.path.join(d, f))
def read(p):
    b = open(p, 'rb').read()
    for enc in ('utf-8-sig', 'cp932', 'gb18030'):
        try: return b.decode(enc)
        except Exception: pass
    return b.decode('latin-1')
print('候选脚本 %d 个' % len(scripts))
want = re.compile(r'subimage|cgmode|asyncmoveobject|crossfade', re.I)
tgt = [p for p in scripts if 'hmr_40101123' in p]
print('-- hmr_40101123：', [os.path.relpath(p, root) for p in tgt])
for p in tgt[:1]:
    for n, ln in enumerate(read(p).splitlines(), 1):
        if want.search(ln): print('  %4d| %s' % (n, mask(ln)[:220]))
print('-- 全部脚本里这几种指令的写法（归一后，前 10 种，各 2 个例子）：')
pat = collections.Counter(); ex = collections.defaultdict(list)
for p in scripts:
    for ln in read(p).splitlines():
        if want.search(ln):
            k = re.sub(r'-?\d+(\.\d+)?', 'N', mask(ln.strip()))[:90]
            pat[k] += 1
            if len(ex[k]) < 2: ex[k].append(mask(ln.strip())[:200])
for k, n in pat.most_common(10): print('  %5d  %s' % (n, k)); [print('         例:', e) for e in ex[k]]
print('-- 脚本里所有标签（<NAME>）出现次数，前 60：')
tags = collections.Counter()
for p in scripts[:400]:
    tags.update(re.findall(r'<([A-Za-z_0-9]+)>', read(p)))
print('  ', '; '.join('%s×%d' % kv for kv in tags.most_common(60)))
PYEOF
fi

sec "C. minashigo：scene_<9位> 和 images/thumb/<12位>_360.jpg 的对应"
if need MINASHIGO "$MINASHIGO"; then
  "$PY" - "$MINASHIGO" <<'PYEOF'
import collections, os, re, sys
root = sys.argv[1]
thumbs = []; scenes = {}
for d, _, fs in os.walk(root):
    for f in fs:
        if d.replace('\\', '/').endswith('/images/thumb'): thumbs.append(f)
        m = re.match(r'^scene_(\d+)\.rpyc?$', f)
        if m: scenes[m.group(1)] = os.path.join(d, f)
print('thumb %d 个；scene 脚本 %d 个' % (len(thumbs), len(scenes)))
print('thumb 前 15:', sorted(thumbs)[:15]); print('scene 前 15:', sorted(scenes)[:15])
ids = set(scenes)
for k in (9, 8, 7, 6, 5):
    n = sum(1 for t in thumbs if re.match(r'^\d{%d}' % k, t) and re.match(r'^(\d{%d})' % k, t).group(1) in {s[:k] for s in ids})
    print('  thumb 的前 %d 位 能对上某个 scene 前 %d 位：%d / %d' % (k, k, n, len(thumbs)))
print('-- 抽 6 个 scene，把脚本里出现的 9/12 位数字和同前缀的 thumb 一起列出：')
for sid in sorted(scenes)[:6]:
    try: text = open(scenes[sid], 'rb').read().decode('utf-8', 'replace')
    except Exception: text = ''
    nums = sorted(set(re.findall(r'(?<!\d)\d{9,12}(?!\d)', text)))[:8]
    print('  scene_%s  脚本里的长数字：%s  同前 8 位的 thumb：%s' % (sid, nums, [t for t in thumbs if t.startswith(sid[:8])][:5]))
PYEOF
fi

sec "D. train（MistTrainGirls X）：Textures/Characters/Bases 和 MasterData 角色底号的对应"
if need TRAIN "$TRAIN"; then
  "$PY" - "$TRAIN" <<'PYEOF'
import collections, json, os, re, sys
root = sys.argv[1]
bases_dir = None; master = None; skel_dirs = []
for d, ds, fs in os.walk(root):
    dn = d.replace('\\', '/')
    if dn.endswith('Textures/Characters/Bases'): bases_dir = d
    if 'MCharacterBaseViewModel.json' in fs: master = os.path.join(d, 'MCharacterBaseViewModel.json')
files = sorted(os.listdir(bases_dir)) if bases_dir else []
print('Bases 目录：', bases_dir, '；文件数', len(files))
print('前 12:', files[:12]); print('文件名末三位分布:', dict(collections.Counter(os.path.splitext(f)[0][-3:] for f in files).most_common(6)))
print('扩展名:', dict(collections.Counter(os.path.splitext(f)[1] for f in files)))
rows = []
if master:
    b = open(master, 'rb').read()
    for enc in ('utf-8-sig', 'utf-16'):
        try: rows = json.loads(b.decode(enc)); break
        except Exception: pass
print('MCharacterBaseViewModel：', master, '；行数', len(rows) if isinstance(rows, list) else type(rows))
if isinstance(rows, list) and rows:
    print('键:', list(rows[0].keys())[:20]); print('前 3 行的 Id / Name：', [(r.get('Id'), str(r.get('Name'))[:12]) for r in rows[:3]])
    ids = {str(r.get('Id')) for r in rows}
    stems = {os.path.splitext(f)[0] for f in files}
    for suf in ('201', '101', '001', '', '200', '301'):
        print('  Bases 文件名 = <Id>%s 的：%d / %d（Id 总数 %d）' % (suf or '(无后缀)', sum(1 for i in ids if i + suf in stems), len(files), len(ids)))
    print('  Bases 文件名去掉末三位后能对上 Id 的：%d / %d' % (sum(1 for s in stems if s[:-3] in ids), len(stems)))
    print('  不能对上 Id 的 Bases 前 10 个：', [s for s in sorted(stems) if s[:-3] not in ids][:10])
# 骨架目录的底号
skel = collections.Counter()
for d, ds, fs in os.walk(root):
    for f in fs:
        if f.endswith('.skel.bytes'):
            m = re.match(r'^(\d+)', f)
            if m: skel[m.group(1)] += 1
print('骨架底号（*.skel.bytes 文件名数字前缀）共 %d 种，前 12：%s' % (len(skel), sorted(skel)[:12]))
PYEOF
fi

sec "E. deepone：character 目录的全部变体"
if need DEEP "$DEEP"; then
  "$PY" - "$DEEP" <<'PYEOF'
import collections, os, re, sys
root = sys.argv[1]
four = collections.defaultdict(set); six = {}
for d, ds, fs in os.walk(root):
    parts = d.replace('\\', '/').split('/')
    if len(parts) >= 2 and parts[-2] == 'character':
        n = parts[-1]
        if re.fullmatch(r'\d{4}', n): four[n].add(os.path.relpath(d, root))
        elif re.fullmatch(r'\d{6}', n):
            img = os.path.join(d, 'adv', 'image')
            six[n] = {'dir': os.path.relpath(d, root), 'png': os.path.exists(os.path.join(img, n + '.png')), 'png100': os.path.exists(os.path.join(img, n + '_100.png'))}
print('4 位目录（脚本）%d 个；6 位目录（资源）%d 个；其中有 <id>.png %d 个，有 <id>_100.png %d 个' % (len(four), len(six), sum(v['png'] for v in six.values()), sum(v['png100'] for v in six.values())))
var = collections.defaultdict(list)
for n in six: var[n[:4]].append(n)
print('规则 {name}00 命中：', sum(1 for c in four if c + '00' in six), '/', len(four))
print('任一变体存在：', sum(1 for c in four if var.get(c)), '/', len(four))
nothing = sorted(c for c in four if not var.get(c))
print('完全没有 6 位资源目录的 4 位角色：%d 个，前 15：%s' % (len(nothing), nothing[:15]))
print('变体后两位取值分布：', dict(collections.Counter(n[4:] for n in six).most_common(12)))
print('4 位角色 → 变体（前 25 个）：', {c: sorted(var[c]) for c in sorted(four)[:25] if var.get(c)})
print('4 位目录出现在哪些位置（前 4 个）：', sorted({p for v in four.values() for p in v})[:4])
PYEOF
fi

printf '\n\n########## 完成\n'
} > "$OUT" 2>&1
echo "完成：$OUT（$(wc -c < "$OUT") 字节，$(wc -l < "$OUT") 行）——把这个文件发给我"
