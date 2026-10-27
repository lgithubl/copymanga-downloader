#!/usr/bin/env bash
# 第二十轮样本（只补第 18 / 19 轮之后仍然缺的两块；文本脱敏，最后打成 tar.gz）：
#   A deepone：人物缩略图——user_data 目录树 + 缩略图目录的文件名 + character_names.json（匹配逻辑有问题，上次只采到了文本目录）
#   B TSK：Utage 的立绘站位（Chara1/2/3 的横坐标、缩放、Spine 的单位比例）不在剧情表里，在 Unity 资源里——
#      1) 在 *_Data 下的 .assets / .resS / .bundle 等文件里按字节搜 Chara1 / Chara3 / LayoutSetting / StandX 等关键字，导出前后文
#      2) 装了 UnityPy（pip install UnityPy）的话，另外把名字带 Layout / Setting / Character / Param 的 TextAsset / MonoBehaviour 导成 json
# 输出 ./gal-samples20.tar.gz（默认），发给我。
#   用法：BASE=/你的/游戏/父目录 bash collect-gal-samples20.sh；目录名不对就覆盖：DEEPONE= TSK=
#   只读原目录；不复制音频、视频、图片；文本里连续 3 个以上的中日文字符会被替换成 <N字>。
BASE="${BASE:-.}"
: "${DEEPONE:=$BASE/deeponecgv20260801}"
: "${TSK:=$BASE/Twinkle Star Knights X}"
OUTDIR="${OUTDIR:-$PWD}"
PY="$(command -v python3 || command -v python)"
[ -z "$PY" ] && { echo "需要 python3"; exit 1; }
STAGE="$(mktemp -d)"; HELPER="$(mktemp --suffix=.py)"; trap 'rm -rf "$STAGE" "$HELPER"' EXIT
OUT="${OUT:-$OUTDIR/gal-samples20.tar.gz}"
cat > "$HELPER" <<'PYEOF'
import collections, json, os, re, struct, sys
CJK = re.compile(r'[぀-ヿ㐀-鿿＀-￯]{3,}')
mask = lambda s: CJK.sub(lambda m: '<%d字>' % len(m.group(0)), s)
LIMIT = 3 * 1024 * 1024
def dec(raw):
    for enc in ('utf-8-sig', 'utf-16', 'cp932', 'gb18030'):
        try: return raw.decode(enc)
        except Exception: pass
    return raw.decode('latin-1')
def walk(root, skip=()):
    for d, ds, fs in os.walk(root):
        ds[:] = [x for x in ds if x not in skip]
        for f in fs: yield os.path.join(d, f)
def dims(p):
    try:
        b = open(p, 'rb').read(200000)
        if b[:8] == b'\x89PNG\r\n\x1a\n': return struct.unpack('>II', b[16:24])
    except Exception: pass
    return None
mode, root, stage = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(stage, exist_ok=True)
rel = lambda p: os.path.relpath(p, root)
if mode == 'deepone':
    ud = os.path.join(root, 'user_data')
    with open(os.path.join(stage, '_user_data_tree.tsv'), 'w', encoding='utf-8') as f:
        for p in sorted(walk(ud))[:20000]:
            wh = dims(p) if p.lower().endswith('.png') else None
            f.write('%s\t%d\t%s\n' % (mask(rel(p)), os.path.getsize(p), ('%dx%d' % wh) if wh else ''))
    for p in walk(ud):
        if p.lower().endswith(('.json', '.txt', '.csv')) and os.path.getsize(p) <= LIMIT:
            dst = os.path.join(stage, 'user_data', rel(p)); os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst, 'w', encoding='utf-8').write(mask(dec(open(p, 'rb').read(LIMIT))))
    # resources 里所有非 text / voice 的目录（图片类），每个目录前 12 个文件名
    res = os.path.join(root, 'resources')
    dirs = collections.defaultdict(list)
    for d, ds, fs in os.walk(res):
        if fs and not re.search(r'adv[\\/](?:text|voice)', d): dirs[rel(d)] += sorted(fs)
    with open(os.path.join(stage, '_resource_dirs_nontext.txt'), 'w', encoding='utf-8') as f:
        for d, fs in sorted(dirs.items())[:3000]: f.write('## %s （%d 个）  前 12：%s\n' % (mask(d), len(fs), mask(', '.join(fs[:12]))))
elif mode == 'tsk':
    data = [os.path.join(root, d) for d in os.listdir(root) if d.endswith('_Data')]
    data = data[0] if data else root
    keys = [k.encode() for k in ('Chara1', 'Chara2', 'Chara3', 'LayoutSetting', 'StandX', 'standX', 'SpineScale', 'PositionX', 'Utage')]
    out = open(os.path.join(stage, '_hits.txt'), 'w', encoding='utf-8'); lst = open(os.path.join(stage, '_scanned.tsv'), 'w', encoding='utf-8')
    for p in walk(data, {'StreamingAssets'}):
        size = os.path.getsize(p)
        if size > 800 * 1024 * 1024 or p.lower().endswith(('.png', '.jpg', '.ogg', '.mp3', '.wav', '.mp4')): continue
        per = collections.Counter()
        try:
            with open(p, 'rb') as f:
                tail = b''; offset = 0
                while True:
                    chunk = f.read(8 * 1024 * 1024)
                    if not chunk: break
                    buf = tail + chunk
                    for k in keys:
                        pos = buf.find(k)
                        while pos >= 0:
                            per[k.decode()] += 1
                            if per[k.decode()] <= 4:
                                ctx = buf[max(0, pos - 200):pos + 400].decode('utf-8', 'replace')
                                out.write('=== %s  %s  @%d\n%s\n\n' % (mask(rel(p)), k.decode(), offset - len(tail) + pos, mask(re.sub(r'[\x00-\x08\x0b-\x1f]', '.', ctx))))
                            pos = buf.find(k, pos + len(k))
                    tail = buf[-32:]; offset += len(chunk)
        except Exception: continue
        if per: lst.write('%s\t%d\t%s\n' % (mask(rel(p)), size, dict(per)))
    out.close(); lst.close()
    try:
        import UnityPy
    except Exception:
        open(os.path.join(stage, '_unitypy.txt'), 'w').write('没装 UnityPy，跳过（pip install UnityPy 之后可以再跑一次）')
    else:
        want = re.compile(r'(?i)layout|setting|character|param|utage|stand|chara')
        n = 0; os.makedirs(os.path.join(stage, 'objects'), exist_ok=True)
        files = [p for p in walk(data, {'StreamingAssets'}) if p.endswith(('.assets', '.resource', '.bundle')) or os.path.basename(p).startswith(('level', 'sharedassets', 'globalgamemanagers'))]
        for p in files:
            try: env = UnityPy.load(p)
            except Exception: continue
            for obj in env.objects:
                if obj.type.name not in ('TextAsset', 'MonoBehaviour'): continue
                try:
                    d = obj.read()
                    name = getattr(d, 'name', '') or getattr(d, 'm_Name', '')
                    if not want.search(name): continue
                    body = d.text if obj.type.name == 'TextAsset' else json.dumps(obj.read_typetree(), ensure_ascii=False, default=str)
                    open(os.path.join(stage, 'objects', '%03d_%s_%s.txt' % (n, obj.type.name, re.sub(r'[^\w.-]', '_', name)[:60])), 'w', encoding='utf-8').write(mask(body[:LIMIT])); n += 1
                except Exception: pass
                if n >= 120: break
            if n >= 120: break
        print('  UnityPy 导出 %d 个对象' % n)
PYEOF
echo "收集时间：$(date '+%F %T')    BASE=$BASE" > "$STAGE/_info.txt"
run() { local mode="$1" name="$2" dir="$3"; [ -n "$dir" ] && [ -d "$dir" ] || { echo "(没找到目录：$name = ${dir:-空})"; return; }; echo "== $name：$dir"; "$PY" "$HELPER" "$mode" "$dir" "$STAGE/$name"; }
run deepone deepone "$DEEPONE"
run tsk tsk "$TSK"
tar -C "$STAGE" -czf "$OUT" . && echo "完成：$OUT（$(du -h "$OUT" | cut -f1)，$(tar -tzf "$OUT" | wc -l) 项）——把这个文件发给我"
