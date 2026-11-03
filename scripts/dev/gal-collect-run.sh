#!/usr/bin/env bash
# Gal 样本采集（实际脚本）：扫描游戏库，按引擎家族挑出分析 / 写适配器需要的文件，分卷打成 tar.gz，用 gh 传到 release。
# 一般不直接跑，由 gal-collect.sh（启动脚本，和 gh、密钥文件放在一起）拉取并执行；也可以单独跑：
#   GH_TOKEN=... GAL_ROOT=/游戏库目录 bash gal-collect-run.sh [GAL_ROOT]
#
# 采集什么（按引擎自动判断，见下面 ENGINES；判断不出来的游戏只收目录清单 + exe + 小文本）：
#   · Unity 资源目录（GameMaterial 等）：*.dsm / *.cof / system 下的小文件、每个目录 3 个小的 .psm 样本
#   · 每个游戏：目录清单（相对路径 / 大小 / 修改时间，不含存档目录）、根目录 exe、≤2MB 的 txt/xml/json/ini 等小文本
#   · BGI：sysprg/system/sysgrp.arc、BGI.*、data*.arc          · 自有 arc 家族：script.arc、data.arc、其余 arc 的头
#   · KiriKiri：scn/patch 的 xp3（整个）、别的 xp3 的头 + 尾（索引）、plugin 下的 dll；Hxv4 加密的 xp3 再按内置密钥包解索引，收剧本用到的图 / bgm / 语音条目（原样，不解密）+ 24 个均匀样本
#   · Artemis：pf8 档案的索引 + 脚本类条目（.ast/.lua/.tbl/.ini/.csv…，不要声音 / 图片 / psb）   · Unity：globalgamemanagers、Managed/Assembly-CSharp、global-metadata.dat、resources / sharedassets、Archives/*.arc
#   · MahotanArchive（Tauri，*.mhp = ZIP + JSON）：≤20MB 的 .mhp 整个收，更大的 .mhp 收 ZIP 目录清单 + 抽样条目；translations/templates.zip、voice-texts/*.json、*.py
#   · Unity 补：*_Data/Caches/masterdata（抽样）、Caches/assetbundles（抽样）、BepInEx/plugins/*.dll、任何层级的 StaticData 目录（整个）
#   · 家族 7（ChakraCore）：Arc*.dat、Resources/*.dat       · XFL：scr.xfl 整个、别的 xfl 的头 + 尾       · AGE：SC*.BIN、ALF 的头 + 尾
# 一律不收：存档（save / savedata / UserData / *.sud / SAVE*.DAT）、视频 / 音频 / 图片、安装包 / 卸载程序、pdf、lnk。
#
# 配置（环境变量，都有默认值）：
#   GAL_ROOT            游戏库目录（也可以作为第一个参数）；必填
#   GAL_COLLECT_REPO    上传到哪个仓库的 release，默认 lgithubl/private-scripts
#   GAL_COLLECT_TAG     release 的 tag，默认 31
#   GAL_COLLECT_PART_MB 每个上传文件（分卷）的大小上限，默认 40
#   GAL_COLLECT_FULL_MAX_MB 单个文件超过它就只收头 + 尾（索引在头或尾），默认 250
#   GAL_COLLECT_HT_MB   头 / 尾各取多少 MB，默认 8
#   GAL_COLLECT_TOTAL_MAX_MB 一次运行最多收多少 MB（原始大小），默认 6000
#   GAL_COLLECT_ONLY    只处理相对路径匹配这个正则的游戏（不区分大小写）
#   GAL_COLLECT_BINARIES=1  也收 GameAssembly.dll / UnityPlayer.dll 这类大二进制（给以后逆向用），默认不收
#   GAL_COLLECT_DRYRUN=1    只扫描 + 打包到本地，不上传
#   GAL_COLLECT_OUT     本地输出目录，默认 /tmp/gal-collect-<时间>（传完的分卷会删掉；DRYRUN 保留）
#   GAL_COLLECT_GH      gh 命令，默认 gh（测试时可以换成桩）
# 还原：同一个游戏的分卷按序号 cat 起来再解压：cat gal-collect-<时间>-g01.tar.gz.part-* | tar xzf -
# 退出码：0 全部成功；1 出错（出错日志已打包上传）；2 有分卷上传失败（留在本地输出目录）
set -uo pipefail
# 版本号：每次改采集规则就加一，运行时第一行打印，也写进 info.json / 日志，方便对上「这批数据是哪版脚本采的」
# 1.0 初版；1.1 Artemis(pf8) 按索引只取脚本 / lua / tbl；Unity 补 *.dsm / *.cof / system 小文件 / psm 样本；AGE 补 .aai；启动时打印版本
# 1.14 MahotanArchive：.mhp（ZIP）小的整收、大的收目录清单 + 抽样条目，加 templates.zip / voices.json / *.py；Unity 补 Caches/masterdata + Caches/assetbundles 抽样、BepInEx/plugins/*.dll、StaticData 目录
# 1.13 KiriKiri：data / patch 的引擎小条目（≤256KB，TJS / KS）单独一份预算，不再被图吃掉（1.12 的 data.xp3 只收到 4 个小条目）；evimage 的预算不再额外叠加 KRKR_MB
# 1.12 KiriKiri 瘦身：每个 xp3 的资源预算 GAL_COLLECT_KRKR_MB 400→40、evimage 的 GAL_COLLECT_KRKR_EV_MB 600→24、Live2D 的 GAL_COLLECT_KRKR_L2D_MB 400→60（够 2 个模型对参数名；g08 的 14 个模型以前收过了）；图 / 语音 / 视频只留抽样，已经验证过的 CG 变体映射 / 立绘分层 / 语音名映射不再需要大量样本；引擎小条目（TJS / KS，GAL_COLLECT_KRKR_SMALL_MB 80）和整个 scn.xp3 不变。名字表加 ev_mv<编号>r.. → ev_cg<编号>.l2d（g07 的 live2d.xp3 里的包叫 ev_cgNNN_NN.l2d，脚本里叫 ev_mvNNN_NNrX 且带 variables）；.l2d 的候选排在最前面，保证 60MB 预算先用在它上面
# 1.11 KiriKiri：data / patch 的 xp3 再收全部 ≤ 256KB 的条目（引擎的 TJS / KS 脚本——立绘位置 / 缩放（leveloffset / zpos）、背景镜头的逻辑在里面；名字是哈希，只能按大小收），上限 GAL_COLLECT_KRKR_SMALL_MB 默认 80\n# 1.10 KiriKiri：Live2D（.l2d，ZIP 模型包，每个约 22MB）单独一份预算 GAL_COLLECT_KRKR_L2D_MB（默认 400，不占 GAL_COLLECT_KRKR_MB 的额度），g08 的 14 个模型能收全\n# 1.9 KiriKiri：名字表加「去扩展名的名字 / 去 ev 前缀的名字」× .pimg / .sinfo / .dpak（立绘的分层图和 CG 的包）；evimage.xp3 再按 id 从头收 ≤ 8MB 的条目（重定向文本 + dpak，上限 GAL_COLLECT_KRKR_EV_MB 默认 600）\n# 1.8 KiriKiri Z（Hxv4）：内置已知密钥包解 xp3 的特殊索引，按剧本里用到的资源名（图 / bgm / 语音 × 常见扩展名的名字哈希）挑条目原样收下，再加 24 个均匀样本；每个 xp3 最多 GAL_COLLECT_KRKR_MB（默认 400）
# 1.7 自有 arc 补收 eomaia_char 立绘的描述文件（.CHAR / .JSON / .STYLE …，小的全收）+ 两套立绘的全部分层 PNG；Artemis 补收小的 .psb 和 image/thumb 缩略图
# 1.6 Artemis（pf8）补收图 / 声音样本（_blog 立绘每角色 2 张、bg / ev / sys、bgm / vo 各几个）；自有 arc 补收 EV 事件 CG 的底图 + 叠加层、几张背景
# 1.5 BGI：按「角色 + 尺寸」把立绘本体和它的 e / o / y 部件配对收（可以跨 data*.arc），核对不同变体里部件的位置
# 1.4 BGI 目录清单加每张图头里 0x18..0x2d 的 22 字节（hdr18），样本图多收 12 个 32 位、宽 ≤1400 的小图（立绘表情 / 嘴 / 眼部件），核对部件位置偏移
# 1.3 自有 arc / XFL：只收头的档案补「条目清单（带每条开头 16 字节）」+ 8 个样本条目；Unity 的 GameAssembly.dll（≤120MB）默认也收（找解密逻辑用）
# 1.2 BGI：太大只收头尾的 data*.arc 再按 ARC20 索引补收样本图（立绘 / 背景 / CompressedBG v2 各挑几张）+ 全部图的目录清单（名字 / 宽 / 高 / 位数 / 版本），用来核对立绘位置和 CBG v2
VERSION="1.14"
export GAL_COLLECT_VERSION="$VERSION"
TS="${GAL_COLLECT_TS:-$(date +%Y%m%d-%H%M%S)}"
HOST_TAG="$(hostname -s 2>/dev/null | tr -c 'A-Za-z0-9' '_' | cut -c1-20)"
ROOT="${1:-${GAL_ROOT:-}}"
REPO="${GAL_COLLECT_REPO:-lgithubl/private-scripts}"
TAG="${GAL_COLLECT_TAG:-31}"
GH="${GAL_COLLECT_GH:-gh}"
OUT="${GAL_COLLECT_OUT:-${TMPDIR:-/tmp}/gal-collect-$TS}"
DRYRUN="${GAL_COLLECT_DRYRUN:-0}"
PY="$(command -v python3 || command -v python || true)"
mkdir -p "$OUT"
LOG="$OUT/run.log"
exec > >(tee -a "$LOG") 2>&1
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

scrub() { # 日志里不能出现令牌
  local f="$1"
  [ -n "${GH_TOKEN:-}" ] && [ -f "$f" ] && sed -i "s/$(printf '%s' "$GH_TOKEN" | sed 's/[][\\.*^$/]/\\&/g')/***/g" "$f" 2>/dev/null
  return 0
}

upload_one() { # upload_one <file>；失败重试 3 次
  local f="$1" n
  [ "$DRYRUN" = 1 ] && { log "DRYRUN 不上传 $(basename "$f")"; return 0; }
  for n in 1 2 3; do
    if "$GH" release upload "$TAG" "$f" --repo "$REPO" --clobber; then return 0; fi
    log "上传失败（第 $n 次）：$(basename "$f")"; sleep $((n * 3))
  done
  return 1
}

ERROR_DONE=0
on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$ERROR_DONE" = 0 ]; then
    ERROR_DONE=1
    log "出错（退出码 $rc），打包出错日志"
    scrub "$LOG"
    local eb="$OUT/gal-collect-$TS-${HOST_TAG}-ERROR.tar.gz"
    tar -czf "$eb" -C "$OUT" --ignore-failed-read run.log games.tsv manifest.tsv 2>/dev/null || tar -czf "$eb" -C "$OUT" run.log 2>/dev/null
    upload_one "$eb" && rm -f "$eb" || log "出错日志没传上去，留在 $eb"
  fi
  exit "$rc"
}
trap on_exit EXIT

log "===== gal-collect-run 版本 v$VERSION ====="
log "gal-collect-run v$VERSION  repo=$REPO tag=$TAG part=${GAL_COLLECT_PART_MB:-40}MB dryrun=$DRYRUN out=$OUT"
[ -n "$PY" ] || { log "需要 python3"; exit 1; }
[ -n "$ROOT" ] || { log "没有指定游戏库目录：用第一个参数或环境变量 GAL_ROOT"; exit 1; }
[ -d "$ROOT" ] || { log "目录不存在：$ROOT"; exit 1; }
if [ "$DRYRUN" != 1 ]; then
  command -v "$GH" >/dev/null 2>&1 || [ -x "$GH" ] || { log "找不到 gh：$GH"; exit 1; }
  [ -n "${GH_TOKEN:-}" ] || { log "没有 GH_TOKEN（启动脚本会从密钥文件读进来）"; exit 1; }
fi

HELPER="$OUT/collect.py"
cat > "$HELPER" <<'PYEOF'
import base64, collections, gzip, hashlib, io, os, re, struct, sys, tarfile, time, json, zlib
root = os.path.abspath(sys.argv[1]); out = sys.argv[2]; ts = sys.argv[3]; host = sys.argv[4]
env = os.environ
MB = 1 << 20
PART = max(1, int(float(env.get('GAL_COLLECT_PART_MB', '40')))) * MB
FULL_MAX = int(float(env.get('GAL_COLLECT_FULL_MAX_MB', '250'))) * MB
HT = int(float(env.get('GAL_COLLECT_HT_MB', '8'))) * MB
TOTAL_MAX = int(float(env.get('GAL_COLLECT_TOTAL_MAX_MB', '6000'))) * MB
ONLY = re.compile(env['GAL_COLLECT_ONLY'], re.I) if env.get('GAL_COLLECT_ONLY') else None
BINARIES = env.get('GAL_COLLECT_BINARIES') == '1'
VERSION = env.get('GAL_COLLECT_VERSION', 'unknown')

def say(msg): print(msg, file=sys.stderr, flush=True)

# 一律不收（相对路径，统一用 / 、小写比较）
EXCL = re.compile(r'(^|/)(save|savedata|userdata|backup)(/|$)|\.(sud|sav|lnk|rar|7z|zip|tmp|bak|mp4|mpg|mpeg|wmv|avi|mkv|webm|ogg|mp3|wav|flac|m4a|png|jpg|jpeg|bmp|gif|psm|pdf)$|(^|/)save[^/]*\.(dat|bak|sth|seek)$|(^|/)(unins|uninst|uninstall)[^/]*$', re.I)
TEXT_EXT = ('.txt', '.xml', '.json', '.ini', '.cf', '.cfg', '.gdb', '.edb', '.hvl', '.log', '.info', '.inf', '.csv', '.sig', '.lst', '.aai', '.dsm', '.cof')

MARK = re.compile(r'\.(exe|xp3|arc|xfl|pfs|agf|alf)$|\.pfs\.\d+$', re.I)

def walk_games():
    """自上而下找「游戏根」：这一层有 exe / xp3 / arc / xfl / pfs / agf / alf 文件，或有 *_Data 目录；找到就不再往下（最浅的算）。"""
    games = []
    for d, ds, fs in os.walk(root):
        rel = os.path.relpath(d, root)
        depth = 0 if rel == '.' else rel.count(os.sep) + 1
        if depth > 5: ds[:] = []; continue
        hit = any(MARK.search(f) for f in fs) or any(x.lower().endswith('_data') for x in ds)
        if hit and rel != '.':
            games.append(d); ds[:] = []
        else:
            ds.sort()
    if not games:
        games = [root]   # 指定的目录本身就是一个游戏
    return games

class Entry:
    __slots__ = ('rel', 'path', 'size', 'mtime')

def list_files(game):
    items = []
    for d, ds, fs in os.walk(game):
        rel_d = os.path.relpath(d, game).replace(os.sep, '/')
        ds[:] = sorted(x for x in ds if not EXCL.search(((rel_d + '/' if rel_d != '.' else '') + x + '/').lower()))
        for f in sorted(fs):
            p = os.path.join(d, f)
            rel = ((rel_d + '/') if rel_d != '.' else '') + f
            try: st = os.stat(p)
            except OSError: continue
            e = Entry(); e.rel = rel; e.path = p; e.size = st.st_size; e.mtime = int(st.st_mtime)
            items.append(e)
    return items

def engines_of(items):
    names = [e.rel.lower() for e in items]
    base = [n.rsplit('/', 1)[-1] for n in names]
    eng = []
    if 'bgi.gdb' in base or 'sysprg.arc' in base: eng.append('bgi')
    if 'script.arc' in base and ('systeminfo.json' in base or 'fileinfo.xml' in base): eng.append('arcfam')
    if any(n.endswith('.xp3') for n in base): eng.append('krkr')
    if any(re.search(r'\.pfs(\.\d+)?$', n) for n in base): eng.append('artemis')
    if any('/' in n and n.split('/')[0].endswith('_data') and n.rsplit('/', 1)[-1] == 'globalgamemanagers' for n in names) or any(n.endswith('_data/globalgamemanagers') for n in names): eng.append('unity')
    if 'chakracore.dll' in base or any(re.fullmatch(r'arc\d\d\.dat', n) for n in base): eng.append('chakra')
    if any(n.endswith('.mhp') for n in base): eng.append('mhp')
    if any(n.endswith('.xfl') for n in base): eng.append('xfl')
    if any(n.endswith('.agf') for n in base) or 'data2.alf' in base: eng.append('age')
    return eng or ['unknown']

def pick(items, eng):
    """返回 [(Entry, mode, rule)]；mode：full（整个，超过 FULL_MAX 退成 ht）/ ht（头 + 尾）/ head（只要头）。"""
    want = {}
    def add(e, mode, rule):
        if e.rel not in want and not EXCL.search(e.rel.lower()): want[e.rel] = (e, mode, rule)
    for e in items:
        low = e.rel.lower(); base = low.rsplit('/', 1)[-1]; depth = low.count('/')
        if depth <= 1 and base.endswith('.exe') and e.size <= 60 * MB: add(e, 'full', 'common:exe')
        if depth <= 3 and low.endswith(TEXT_EXT) and e.size <= 2 * MB: add(e, 'full', 'common:text')
        for en in eng:
            if en == 'bgi':
                if base in ('sysprg.arc', 'system.arc') or base.startswith('bgi.'): add(e, 'full', 'bgi:sys')
                elif base == 'sysgrp.arc': add(e, 'ht', 'bgi:sysgrp')
                elif re.fullmatch(r'data\d+\.arc', base): add(e, 'full' if e.size <= 12 * MB else 'ht', 'bgi:data')
            elif en == 'arcfam':
                if base in ('script.arc', 'data.arc'): add(e, 'full', 'arcfam:main')
                elif base.endswith('.arc'): add(e, 'head', 'arcfam:other')
            elif en == 'krkr':
                if base.endswith('.xp3'):
                    if re.match(r'(scn|patch)', base): add(e, 'full', 'krkr:scn')
                    elif base.startswith('data'): add(e, 'full', 'krkr:data')
                    else: add(e, 'ht', 'krkr:xp3-index')
                elif low.startswith('plugin/') and base.endswith('.dll') and e.size <= 8 * MB: add(e, 'full', 'krkr:plugin')
            elif en == 'artemis':
                if re.search(r'\.pfs(\.\d+)?$', base): add(e, 'pfs', 'artemis:pf8')   # 索引 + 脚本类条目（不是头尾：.ast 脚本在 8MB 之外）
            elif en == 'unity':
                seg = low.split('/')
                if len(seg) >= 2 and seg[0].endswith('_data'):
                    rest = '/'.join(seg[1:])
                    if base in ('globalgamemanagers', 'globalgamemanagers.assets', 'app.info', 'boot.config', 'scriptingassemblies.json', 'runtimeinitializeonloads.json') or re.fullmatch(r'level\d+', base): add(e, 'full' if e.size <= 8 * MB else 'ht', 'unity:core')
                    elif rest.startswith('managed/assembly-csharp'): add(e, 'full', 'unity:managed')
                    elif base == 'global-metadata.dat': add(e, 'full', 'unity:metadata')
                    elif base == 'resources.assets' or re.fullmatch(r'sharedassets\d+\.assets', base): add(e, 'full', 'unity:assets')
                    elif rest.startswith('streamingassets/') and base.endswith(('.json', '.txt', '.csv', '.bytes', '.xml')) and e.size <= 2 * MB: add(e, 'full', 'unity:streaming')
                if low.startswith('archives/') and base.endswith('.arc'): add(e, 'full', 'unity:archives')
                if (base == 'gameassembly.dll' and e.size <= 120 * MB) or (BINARIES and base in ('gameassembly.dll', 'unityplayer.dll') and e.size <= 400 * MB): add(e, 'full', 'unity:binary')
            elif en == 'chakra':
                if re.fullmatch(r'arc\d\d\.dat', base): add(e, 'full', 'chakra:arc')
                elif low.startswith('resources/') and base.endswith('.dat') and e.size <= 20 * MB: add(e, 'full', 'chakra:res')
            elif en == 'mhp':
                if base.endswith('.mhp'): add(e, 'full' if e.size <= 20 * MB else 'mhp', 'mhp:small' if e.size <= 20 * MB else 'mhp:big')
                elif base.endswith('.py') and e.size <= 1 * MB: add(e, 'full', 'mhp:script')
                elif low.endswith('.json') and e.size <= 8 * MB and depth <= 2: add(e, 'full', 'mhp:json')
            elif en == 'xfl':
                if base == 'scr.xfl': add(e, 'full', 'xfl:scr')
                elif base.endswith('.xfl'): add(e, 'ht', 'xfl:index')
            elif en == 'age':
                if base.endswith('.bin') and e.size <= 8 * MB: add(e, 'full', 'age:bin')
                elif base.endswith('.alf'): add(e, 'ht', 'age:alf')
    # Unity 的资源目录（GameMaterial 之类）：*.dsm / *.cof / system 下的小文件 + 每个目录最多 3 个小的 .psm 样本（.psm 平时不收）
    if 'unity' in eng:
        per_dir = collections.Counter()
        for e in sorted(items, key=lambda x: x.size):
            low = e.rel.lower(); base = low.rsplit('/', 1)[-1]
            if low.endswith(('.dsm', '.cof')) and e.size <= 50 * MB and e.rel not in want: want[e.rel] = (e, 'full', 'unity:resdata')
            elif '/system/' in '/' + low and e.size <= 1 * MB and '.' not in base and e.rel not in want: want[e.rel] = (e, 'full', 'unity:system')
            elif low.endswith('.psm') and e.size <= 8 * MB:
                d = low.rsplit('/', 1)[0] if '/' in low else ''
                if per_dir[d] < 3 and e.rel not in want: per_dir[d] += 1; want[e.rel] = (e, 'full', 'unity:psm-sample')
    if 'mhp' in eng:   # .zip 一般不收（EXCL），这个模板包例外
        for e in items:
            if e.rel.lower().endswith('translations/templates.zip') and e.size <= 8 * MB and e.rel not in want: want[e.rel] = (e, 'full', 'mhp:templates')
    if 'unity' in eng:
        def spread(cands, n_small, n_spread):
            cands = sorted(cands, key=lambda x: x.size); out = cands[:n_small]; rest = cands[n_small:]
            if rest and n_spread: step = max(1, len(rest) // n_spread); out += rest[::step][:n_spread]
            return out
        md = [e for e in items if re.search(r'_data/caches/masterdata/[^/]+$', e.rel.lower()) and 1024 <= e.size <= 4 * MB]
        for e in spread(md, 8, 16):
            if e.rel not in want: want[e.rel] = (e, 'full', 'unity:masterdata')
        ab = [e for e in items if re.search(r'_data/caches/assetbundles/[^/]+$', e.rel.lower()) and 1024 <= e.size <= 6 * MB]
        for e in spread(ab, 3, 7):
            if e.rel not in want: want[e.rel] = (e, 'full', 'unity:bundle-sample')
        for e in items:
            low = e.rel.lower()
            if low.startswith('bepinex/plugins/') and low.endswith('.dll') and e.size <= 2 * MB and e.rel not in want: want[e.rel] = (e, 'full', 'unity:plugin')
            elif '/staticdata/' in '/' + low and e.size <= 20 * MB and e.rel not in want: want[e.rel] = (e, 'full', 'unity:staticdata')
    return list(want.values())

class Split:
    """把一个字节流切成 ≤ PART 的几卷；每写满一卷就关掉，并把文件名交给回调（边打包边上传，磁盘只放一卷）。"""
    def __init__(self, prefix, on_part):
        self.prefix = prefix; self.on_part = on_part; self.n = 0; self.f = None; self.size = 0; self.parts = []
    def _open(self):
        path = '%s.part-%03d' % (self.prefix, self.n); self.n += 1; self.f = open(path, 'wb'); self.size = 0; self.cur = path
    def write(self, b):
        mv = memoryview(b); pos = 0
        while pos < len(mv):
            if self.f is None: self._open()
            room = PART - self.size
            chunk = mv[pos:pos + room]; self.f.write(chunk); self.size += len(chunk); pos += len(chunk)
            if self.size >= PART: self._close()
        return len(b)
    def _close(self):
        if self.f: self.f.close(); self.f = None; self.parts.append(self.cur); self.on_part(self.cur)
    def flush(self): pass
    def close(self): self._close()

class Hashing(io.RawIOBase):
    def __init__(self, f): self.f = f; self.h = hashlib.sha256()
    def readable(self): return True
    def readinto(self, b):
        n = self.f.readinto(b)
        if n: self.h.update(memoryview(b)[:n])
        return n

def sha_file_stream(path, limit=None):
    h = hashlib.sha256(); left = limit
    with open(path, 'rb') as f:
        while True:
            n = 1 << 20 if left is None else min(1 << 20, left)
            if n <= 0: break
            b = f.read(n)
            if not b: break
            h.update(b); left = None if left is None else left - len(b)
    return h.hexdigest()

PFS_SCRIPT_EXT = ('.ast', '.lua', '.tbl', '.asb', '.ini', '.ipt', '.sli', '.dat', '.csv', '.txt', '.json', '.xml')
PFS_ENTRY_MAX = 80 * MB   # 一个 pfs 里选中的条目总量上限

def pf8_entries(f, size):
    """pf8 档案：'pf8' + u32 索引大小 + u32 条目数；索引块 = 前 索引大小 + 7 字节；每条 u32 名字长 + 名字(utf-8，\\ 分隔) + u32 0 + u32 偏移 + u32 大小。解析不了返回 None。"""
    f.seek(0); head = f.read(11)
    if len(head) < 11 or head[:3] != b'pf8': return None
    isz, cnt = struct.unpack('<II', head[3:11])
    if isz <= 0 or isz + 7 > size or cnt <= 0 or cnt > 2000000: return None
    f.seek(0); idx = f.read(isz + 7); p = 11; ents = []
    try:
        for _ in range(cnt):
            ln = struct.unpack('<I', idx[p:p + 4])[0]
            if ln <= 0 or ln > 1024: return None
            name = idx[p + 4:p + 4 + ln].decode('utf-8', 'replace'); p += 4 + ln
            _z, off, sz = struct.unpack('<III', idx[p:p + 12]); p += 12
            ents.append((name, off, sz))
    except struct.error:
        return None
    return idx, ents

def pf8_pick(ents, size):
    """脚本类条目：扩展名在 PFS_SCRIPT_EXT 里，csv 不要语音 / 声音目录下的，累计 ≤ PFS_ENTRY_MAX。"""
    out = []; total = 0
    for name, off, sz in ents:
        low = name.lower().replace('\\', '/')
        if not low.endswith(PFS_SCRIPT_EXT): continue
        if low.endswith('.csv') and low.startswith(('sound/', 'voice/')): continue
        if sz <= 0 or off + sz > size or total + sz > PFS_ENTRY_MAX: continue
        out.append((name, off, sz)); total += sz
    return out

BGI_IMG_EACH_MAX = 6 * MB      # 单张样本图上限
BGI_IMG_TOTAL_MAX = 48 * MB    # 一个 data*.arc 里样本图的累计上限

def bgi_samples(f, size, forced=None):
    """BURIKO ARC20（'BURIKO ARC20' + u32 条目数 + 每条 0x80：名字 0x60 + u32 偏移 + u32 大小）：返回 (索引字节, [(名字, 偏移, 大小)], 目录清单文本)；解析不了返回 None。
    CompressedBG 头 0x30：魔数 16 + u16 宽 + u16 高 + u32 位数 + … + u16 版本(0x2e)。挑选：立绘（32 位、不比宽矮）按名字前缀分散（同前缀最多 3 张）10 张、背景（24 位、宽 >= 640）4 张、version 2 的 4 张、32 位小图（宽 <= 256）4 张。"""
    f.seek(0); head = f.read(16)
    if len(head) < 16 or head[:12] != b'BURIKO ARC20': return None
    cnt = struct.unpack('<I', head[12:16])[0]
    if cnt <= 0 or cnt > 200000 or 16 + cnt * 0x80 > size: return None
    f.seek(0); idx = f.read(16 + cnt * 0x80); base = 16 + cnt * 0x80; ents = []
    for i in range(cnt):
        rec = idx[16 + i * 0x80:16 + (i + 1) * 0x80]
        name = rec[:0x60].split(b'\0', 1)[0].decode('cp932', 'replace')
        off, sz = struct.unpack('<II', rec[0x60:0x68])
        if base + off + sz > size: continue
        ents.append((name, base + off, sz))
    imgs = []; lines = ['name\toffset\tsize\twidth\theight\tbpp\tversion\thdr18\n']
    for name, off, sz in ents:
        if sz < 0x30: continue
        f.seek(off); h = f.read(0x30)
        if h[:15] != b'CompressedBG___': continue
        w, hh, bpp = struct.unpack('<HHi', h[0x10:0x18]); ver = struct.unpack('<H', h[0x2e:0x30])[0]
        imgs.append((name, off, sz, w, hh, bpp, ver)); lines.append('%s\t%d\t%d\t%d\t%d\t%d\t%d\t%s\n' % (name, off, sz, w, hh, bpp, ver, h[0x18:0x2e].hex()))   # 末列 = 头里 0x18..0x2d 的 22 字节（立绘部件的位置偏移可能在这里）
    chosen = {}
    def take(cands, limit, key=None):
        seen = {}; n = 0
        for c in cands:
            if n >= limit: break
            if c[0] in chosen or c[2] > BGI_IMG_EACH_MAX: continue
            k = key(c) if key else None
            if k is not None and seen.get(k, 0) >= 3: continue   # 同一个名字前缀最多 3 张
            seen[k] = seen.get(k, 0) + 1; chosen[c[0]] = c; n += 1
    prefix = lambda c: re.sub(r'[\d_].*$', '', c[0].lower())[:6]
    take(sorted((c for c in imgs if c[5] == 32 and c[4] >= c[3] * 0.9 and c[3] > 256), key=lambda c: -c[2]), 10, prefix)
    take(sorted((c for c in imgs if c[5] == 24 and c[3] >= 640), key=lambda c: c[2]), 4, prefix)
    take([c for c in imgs if c[6] >= 2], 4)
    take([c for c in imgs if c[5] == 32 and c[3] <= 256], 4, prefix)
    take([c for c in imgs if c[5] == 32 and 256 < c[3] <= 1400 and c[2] <= BGI_IMG_EACH_MAX], 12, prefix)   # 立绘的表情 / 嘴 / 眼部件（比本体小）
    out = []; total = 0
    for c in chosen.values():
        if total + c[2] > BGI_IMG_TOTAL_MAX: continue
        out.append((c[0], c[1], c[2])); total += c[2]
    have = {o[0] for o in out}
    for c in imgs:   # 跨容器配对挑出来的（本体和部件可能在不同的 data*.arc 里）：不受上面的数量限制
        if forced and c[0] in forced and c[0] not in have: out.append((c[0], c[1], c[2])); have.add(c[0])
    return idx, out, ''.join(lines)

BGI_PAIR_GROUPS = 36        # 一个游戏最多配几组（<角色>_<尺寸>）
BGI_PAIR_EACH_MAX = 4 * MB

def bgi_pairs(entries):
    """entries：这个游戏的 data*.arc（Entry）。读所有 CBG 的头，按「角色(4 位) + 尺寸字母」配对：立绘本体 <角色><2 位>_<尺寸> 和它的部件 <角色>_<尺寸>_<种类>_<编号>
    （同一对可以在不同的 data*.arc 里）。每组取 1 个本体 + e / o / y 各 1 个部件（各取最小的）；每个尺寸字母最多 6 组，总共最多 BGI_PAIR_GROUPS 组。返回 {Entry.rel: {名字…}}。"""
    bodies = {}; parts = {}
    for e in entries:
        try:
            with open(e.path, 'rb') as f:
                f.seek(0); head = f.read(16)
                if head[:12] != b'BURIKO ARC20': continue
                cnt = struct.unpack('<I', head[12:16])[0]
                if cnt <= 0 or cnt > 200000 or 16 + cnt * 0x80 > e.size: continue
                f.seek(0); idx = f.read(16 + cnt * 0x80); base = 16 + cnt * 0x80
                for i in range(cnt):
                    rec = idx[16 + i * 0x80:16 + (i + 1) * 0x80]
                    name = rec[:0x60].split(b'\0')[0].decode('cp932', 'replace'); off, sz = struct.unpack('<II', rec[0x60:0x68])
                    low = name.lower()
                    if sz < 0x30 or sz > BGI_PAIR_EACH_MAX or base + off + sz > e.size: continue
                    mb = re.fullmatch(r'([a-z0-9]{4})[a-z]{2}_([a-z])', low); mp = re.fullmatch(r'([a-z0-9]{4})_([a-z])_([a-z]+)_[a-z0-9_]+', low)
                    if not (mb or mp): continue
                    f.seek(base + off); h = f.read(0x14)
                    if h[:15] != b'CompressedBG___': continue
                    if mb: bodies.setdefault((mb.group(1), mb.group(2)), []).append((sz, e.rel, name))
                    else: parts.setdefault((mp.group(1), mp.group(2)), {}).setdefault(mp.group(3), []).append((sz, e.rel, name))
        except OSError:
            continue
    keys = sorted(k for k in bodies if k in parts and any(kind in parts[k] for kind in ('e', 'o', 'y')))
    per_size = collections.Counter(); chosen = []
    for k in keys[::max(1, len(keys) // (BGI_PAIR_GROUPS * 2))]:
        if per_size[k[1]] >= 6 or len(chosen) >= BGI_PAIR_GROUPS: continue
        per_size[k[1]] += 1; chosen.append(k)
    forced = collections.defaultdict(set)
    for k in chosen:
        sz, rel, name = min(bodies[k]); forced[rel].add(name)
        for kind in ('e', 'o', 'y'):
            if kind in parts[k]:
                sz, rel, name = min(parts[k][kind]); forced[rel].add(name)
    return forced

SAMPLE_EACH_MAX = 3 * MB
SAMPLE_TOTAL_MAX = 24 * MB

def spread_pick(ents, n=8):
    """ents：[(标签, 偏移, 大小)]，取大小在 1KB~SAMPLE_EACH_MAX 之间、沿着条目顺序均匀分布的 n 个，累计 ≤ SAMPLE_TOTAL_MAX。"""
    ok = [e for e in ents if 1024 <= e[2] <= SAMPLE_EACH_MAX]
    if not ok: return []
    step = max(1, len(ok) // n); out = []; total = 0
    for e in ok[::step][:n]:
        if total + e[2] > SAMPLE_TOTAL_MAX: break
        out.append(e); total += e[2]
    return out

def arcfam_samples(f, size):
    """自有 arc：u32 LE 头大小 + 条目 [u8 名字长, 名字(混淆), u32 BE 大小, u32 BE 原大小, u32 BE 偏移]。返回 (目录清单文本, [(标签, 偏移, 大小)])：清单带每个条目开头 16 字节（认格式用）。"""
    f.seek(0); h = f.read(4)
    if len(h) < 4: return None
    hs = struct.unpack('<I', h)[0]
    if hs <= 0 or hs > size or hs > 64 * MB: return None
    f.seek(0); b = f.read(hs + 4); p = 4; ents = []
    try:
        while p < hs + 4:
            n = b[p]; raw = b[p + 1:p + 1 + n]; p += 1 + n
            s1, s2, off = struct.unpack('>III', b[p:p + 12]); p += 12
            ents.append((raw, s1, s2, off))
    except (IndexError, struct.error):
        return None
    if p != hs + 4: return None
    lines = ['rawname_hex\tsize\torig_size\toffset\thead16\n']; picks = []
    for i, (raw, s1, s2, off) in enumerate(ents):
        head = b''
        if off + 16 <= size and s1 >= 0:
            f.seek(off); head = f.read(16)
        lines.append('%s\t%d\t%d\t%d\t%s\n' % (raw.hex(), s1, s2, off, head.hex()))
        if off + s1 <= size: picks.append(('%05d' % i, off, s1))
    # eomaia 的 EV（事件 CG）：底图 EV<nn>S<n>.PNG + 它的叠加层 EV<nn>S_FACE / MOJI / KARADA / EFF…，再加几张背景（BG_*_S.PNG、H*.PNG）：核对叠加层怎么叠
    names = [(''.join(chr((c + len(raw) - i) & 0xff) for i, c in enumerate(raw)), s1, off) for raw, s1, s2, off in ents if off + s1 <= size and s1 == s2]
    extra = []
    bases = sorted(n for n in names if re.fullmatch(r'EV\d+S\d*\.PNG', n[0]) and n[1] <= 6 * MB)
    for base in bases[::max(1, len(bases) // 3)][:3]:
        prefix = re.sub(r'\d*\.PNG$', '', base[0])   # EV02S1.PNG → EV02S
        extra.append(base)
        extra += [n for n in names if re.fullmatch(re.escape(prefix) + r'_(FACE|MOJI|KARADA|EFF)\d+\.PNG', n[0]) and n[1] <= 6 * MB][:4]
    bgs = sorted(n for n in names if re.fullmatch(r'(BG_.*_S|H\d+|BG\d+)\.PNG', n[0]) and n[1] <= 6 * MB)
    extra += bgs[::max(1, len(bgs) // 4)][:4]
    # eomaia_char 立绘：.CHAR / .JSON / .STYLE / .ANMOBJ / .AX / .PCK 这类小的描述文件全收（<= 64KB，累计 <= 6MB）+ 两套立绘的全部分层 PNG（<角色>_ST_nn_<尺寸> 前缀，累计 <= 24MB）
    small = [n for n in names if re.search(r'\.(CHAR|JSON|STYLE|ANMOBJ|AX|PCK)$', n[0]) and 0 < n[1] <= 64 * 1024]
    chars = sorted(n for n in names if n[0].endswith('.CHAR'))
    for c in chars[:2]:
        pre = c[0][:-5]
        extra += [n for n in names if n[0].startswith(pre + '_') and n[0].endswith('.PNG') and n[1] <= 3 * MB][:40]
    total_small = 0
    for n in small:
        if total_small + n[1] > 6 * MB: break
        extra.append(n); total_small += n[1]
    sample = spread_pick(picks)
    taken = {x[1] for x in sample}
    for n in extra:
        if n[2] not in taken: sample.append((n[0], n[2], n[1])); taken.add(n[2])
    return ''.join(lines), sample

def xfl_samples(f, size):
    """XFL（LB）：'LB' 01 00 + u32 表大小 + u32 条目数 + 条目 [name(0x20) + u32 偏移(从表尾起) + u32 大小]。"""
    f.seek(0); h = f.read(12)
    if len(h) < 12 or h[:2] != b'LB': return None
    tbl, cnt = struct.unpack('<II', h[4:12])
    if cnt <= 0 or cnt > 2000000 or tbl != cnt * 0x28 or 12 + tbl > size: return None
    f.seek(12); t = f.read(tbl); base = 12 + tbl
    lines = ['name\toffset\tsize\thead16\n']; picks = []
    for i in range(cnt):
        r = t[i * 0x28:(i + 1) * 0x28]; name = r[:0x20].split(b'\0')[0].decode('cp932', 'replace')
        off, sz = struct.unpack('<II', r[0x20:0x28])
        head = b''
        if base + off + 16 <= size: f.seek(base + off); head = f.read(16)
        lines.append('%s\t%d\t%d\t%s\n' % (name, off, sz, head.hex()))
        if base + off + sz <= size: picks.append((name, base + off, sz))
    return ''.join(lines), spread_pick(picks)

PF8_MEDIA_MAX = 60 * MB

def pf8_media(ents, size):
    """Artemis 的图 / 声音样本（不是全收）：image/fg/_blog 每个角色目录 2 张（立绘用的图）、image/bg 6 张、image/ev 4 张、image/sys 3 张、sound/bgm 2 个、sound/vo 3 个；累计 <= PF8_MEDIA_MAX。"""
    def spread(items, n):
        items = sorted(items)
        if not items: return []
        step = max(1, len(items) // n)
        return items[::step][:n]
    cand = collections.defaultdict(list); out = []; total = 0
    for name, off, sz in ents:
        low = name.lower().replace('\\', '/'); parts = low.split('/')
        if sz <= 0 or off + sz > size: continue
        if low.startswith('image/fg/_blog/') and low.endswith('.png') and sz <= 2 * MB and len(parts) >= 5: cand['blog:' + parts[3]].append((sz, name, off))
        elif low.startswith('image/bg/') and low.endswith('.png') and sz <= 4 * MB: cand['bg'].append((sz, name, off))
        elif low.startswith('image/ev/') and low.endswith('.png') and sz <= 4 * MB: cand['ev'].append((sz, name, off))
        elif low.startswith('image/sys/') and low.endswith('.png') and sz <= 1 * MB: cand['sys'].append((sz, name, off))
        elif low.startswith('sound/bgm/') and low.endswith('.ogg') and sz <= 8 * MB: cand['bgm'].append((sz, name, off))
        elif low.startswith('sound/vo/') and low.endswith('.ogg') and sz <= 1 * MB: cand['vo'].append((sz, name, off))
        elif low.endswith('.psb') and sz <= 200 * 1024: cand['psb'].append((sz, name, off))   # E-mote 的 psb 只收小的（看格式）
        elif low.startswith('image/thumb/') and low.endswith('.png') and sz <= 1 * MB: cand['thumb'].append((sz, name, off))
    for key, items in sorted(cand.items()):
        n = 2 if key.startswith('blog:') else {'bg': 6, 'ev': 4, 'sys': 3, 'bgm': 2, 'vo': 3, 'psb': 2, 'thumb': 6}[key]
        for sz, name, off in spread(items, n):
            if total + sz > PF8_MEDIA_MAX: continue
            out.append((name, off, sz)); total += sz
    return out

# ---- KiriKiri Z（Hxv4）：按「剧本里用到的资源名」挑条目 ----
# xp3 的文件名是哈希；特殊索引（XChaCha20 + zlib）解开后有 名字哈希 → 条目 id。已知的游戏密钥包内置在下面（只含索引用的 key / nonce），
# 剧本用到的资源名（图 / bgm / 语音，来自 g08 / g09 的剧本）× 常见扩展名算出哈希，在索引里命中的条目原样（不解密）收下来。
KRKR_BUNDLES = [{'game': 'g08', 'key': 'a22cea484cfc8ec05c005edc7d2cc5b79e1e25018275bc3f76b40e90e2809021', 'nonce0': '92ba9256b9746f6a5574eda5e1459a1b513c84fd370f41e1', 'nonce1': 'b3a07423abe3129f2f79c0ad2468cd6224efbcee9792f95c'}, {'game': 'g09', 'key': 'c495a62969b7df9dfd831a64ac4b23e9ac4c4143dba4859c76a1c759fde635f2', 'nonce0': '39b33a46e888b7bb6d6fd07a958d5500a089eb1bed793d44', 'nonce1': '1face93e67521ef6d041455d3cd8a62802a097471f04140b'}]
KRKR_NAMES_B64 = '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'
KRKR_IMG_EXT = ['', '.png', '.jpg', '.tlg', '.psb', '.pimg', '.bmp', '.tga', '.jpeg', '.webp', '.tlg5', '.tlg6', '.stand', '.l2d', '.json', '.ks', '.txt', '.mtn']
KRKR_AUDIO_EXT = ['', '.ogg', '.opus', '.wav', '.mp3', '.flac', '.wma', '.m4a']

def _rotl32(x, n): return ((x << n) | (x >> (32 - n))) & 0xffffffff
def _chacha_rounds(s, rounds=20):
    x = list(s)
    def q(a, b, c, d):
        x[a] = (x[a] + x[b]) & 0xffffffff; x[d] = _rotl32(x[d] ^ x[a], 16)
        x[c] = (x[c] + x[d]) & 0xffffffff; x[b] = _rotl32(x[b] ^ x[c], 12)
        x[a] = (x[a] + x[b]) & 0xffffffff; x[d] = _rotl32(x[d] ^ x[a], 8)
        x[c] = (x[c] + x[d]) & 0xffffffff; x[b] = _rotl32(x[b] ^ x[c], 7)
    for _ in range(rounds // 2):
        q(0, 4, 8, 12); q(1, 5, 9, 13); q(2, 6, 10, 14); q(3, 7, 11, 15); q(0, 5, 10, 15); q(1, 6, 11, 12); q(2, 7, 8, 13); q(3, 4, 9, 14)
    return x
_SIGMA = (0x61707865, 0x3320646e, 0x79622d32, 0x6b206574)
def _hchacha20(key, nonce16):
    s = list(_SIGMA) + list(struct.unpack('<8I', key)) + list(struct.unpack('<4I', nonce16))
    x = _chacha_rounds(s)
    return struct.pack('<8I', *(x[0:4] + x[12:16]))
def _xchacha20_xor(key, nonce24, data, counter=1):
    """XChaCha20 流加密（不验 Poly1305 标签：解开后用 zlib + 长度校验）。AEAD 里密文从块计数 1 开始。"""
    sub = _hchacha20(key, nonce24[:16]); k = struct.unpack('<8I', sub); n = struct.unpack('<2I', nonce24[16:24])
    out = bytearray(len(data))
    for bi in range((len(data) + 63) // 64):
        s = list(_SIGMA) + list(k) + [counter + bi, 0, n[0], n[1]]
        x = _chacha_rounds(s)
        ks = struct.pack('<16I', *[(x[i] + s[i]) & 0xffffffff for i in range(16)])
        seg = data[bi * 64:(bi + 1) * 64]
        out[bi * 64:bi * 64 + len(seg)] = bytes(a ^ b for a, b in zip(seg, ks))
    return bytes(out)

def _hx_read(buf):
    pos = [0]
    def take(n):
        if pos[0] + n > len(buf): raise ValueError('truncated')
        s = buf[pos[0]:pos[0] + n]; pos[0] += n; return s
    def cnt(): v = struct.unpack('>i', take(4))[0]; assert v >= 0; return v
    def string(): n = cnt(); take(n * 2); return None
    def obj(depth):
        assert depth < 128
        t = take(1)[0]
        if t in (0, 1): return None
        if t == 2: return string()
        if t == 3: return bytes(take(cnt()))
        if t == 4: return struct.unpack('>q', take(8))[0]
        if t == 5: take(8); return None
        if t == 0x81: return [obj(depth + 1) for _ in range(cnt())]
        if t == 0xc1:
            for _ in range(cnt()): string(); obj(depth + 1)
            return None
        raise ValueError('type %x' % t)
    root = obj(0)
    if pos[0] != len(buf): raise ValueError('trailing')
    return root

def krkr_special(f, hx):
    """试内置的密钥包，解开特殊索引 → {名字哈希（hex 大写）: id}；解不开返回 None"""
    f.seek(hx['offset']); blob = f.read(hx['stored'])
    if len(blob) != hx['stored'] or len(blob) < 21: return None
    for b in KRKR_BUNDLES:
        nonce = bytes.fromhex(b['nonce1'] if hx['kind'] & 1 else b['nonce0'])
        plain = _xchacha20_xor(bytes.fromhex(b['key']), nonce, blob[16:])
        try:
            expected = struct.unpack('<I', plain[:4])[0]
            if expected == 0 or expected > 256 * MB: continue
            inflated = zlib.decompress(plain[4:])
            if len(inflated) != expected: continue
            root = _hx_read(inflated)
        except Exception: continue
        out = {}
        for i in range(0, len(root), 2):
            d = root[i + 1]
            for j in range(0, len(d), 2):
                info = d[j + 1]; packed = info[0] & 0xffffffffffffffff
                if (packed >> 48) == 0: out[d[j].hex().upper()] = packed & 0xffffffff
        return out
    return None

def xp3_index(f, size):
    """→ (hxv4 描述符 或 None, {id: 条目})；条目 = {segments: [(flags, offset, original, archive)], adler, size}；不是 XP3 返回 None"""
    f.seek(0)
    if f.read(11) != b'XP3\r\n \n\x1a\x8b\x67\x01': return None
    ptr = 11; hx = None; ents = {}
    for _ in range(100000):
        f.seek(ptr); rel = struct.unpack('<Q', f.read(8))[0]
        f.seek(rel); flags = f.read(1)[0]
        if flags & 7 == 0:
            n = struct.unpack('<Q', f.read(8))[0]; dec = f.read(n)
        elif flags & 7 == 1:
            stored, orig = struct.unpack('<QQ', f.read(16)); dec = zlib.decompress(f.read(stored))
        else: return None
        nxt = f.tell(); p = 0
        while p + 12 <= len(dec):
            tag = dec[p:p + 4]; ln = struct.unpack('<Q', dec[p + 4:p + 12])[0]; body = dec[p + 12:p + 12 + ln]; p += 12 + ln
            if tag == b'Hxv4' and len(body) == 14 and hx is None:
                hx = {'offset': struct.unpack('<Q', body[:8])[0], 'stored': struct.unpack('<I', body[8:12])[0], 'kind': struct.unpack('<H', body[12:14])[0]}
            elif tag == b'File':
                e = {'segments': [], 'adler': None, 'name': ''}; q = 0
                while q + 12 <= len(body):
                    t = body[q:q + 4]; l2 = struct.unpack('<Q', body[q + 4:q + 12])[0]; c = body[q + 12:q + 12 + l2]; q += 12 + l2
                    if t == b'info' and len(c) >= 22:
                        chars = struct.unpack('<H', c[20:22])[0]; e['name'] = c[22:22 + chars * 2].decode('utf-16le', 'replace'); e['size'] = struct.unpack('<Q', c[4:12])[0]
                    elif t == b'segm' and c and len(c) % 28 == 0:
                        for k in range(0, len(c), 28): e['segments'].append(struct.unpack('<IQQQ', c[k:k + 28]))
                    elif t == b'adlr' and len(c) >= 4: e['adler'] = struct.unpack('<I', c[:4])[0]
                words = [ord(ch) for ch in e['name']]
                if e['segments'] and 0 < len(words) <= 5 and all(0x5000 <= w <= 0x8fff for w in words):
                    eid = 0
                    for i, w in enumerate(words): eid |= (w - 0x5000) << (14 * i)
                    ents[eid] = e
        if not flags & 0x80: break
        ptr = nxt   # 下一个指针紧跟在这块数据后面
    return hx, ents

def krkr_wanted():
    names = json.loads(zlib.decompress(base64.b64decode(KRKR_NAMES_B64)))
    out = []   # [(hash_hex, label, 优先级)]
    def add(n, exts, pri):
        for ext in exts:
            h = hashlib.blake2s((n + ext + 'xp3hnp').encode('utf-16le'), digest_size=32).hexdigest().upper()
            out.append((h, n + ext, pri))
    for kind, exts in (('img', KRKR_IMG_EXT), ('bgm', KRKR_AUDIO_EXT), ('voice', KRKR_AUDIO_EXT), ('other', KRKR_IMG_EXT)):
        for rank, n in enumerate(names.get(kind, [])):
            pri = ({'img': 0, 'bgm': 1, 'voice': 2, 'other': 3}[kind], rank)
            variants = {n}
            if kind in ('img', 'other'):
                stem = n.rsplit('.', 1)[0] if re.search(r'\.[A-Za-z0-9]{1,6}$', n) else n
                variants.add(stem)
                if stem.startswith('ev'): variants.add(stem[2:])   # 事件 CG：脚本里叫 evcg001_03u1，evimage.xp3 里叫 cg001_03u1.tlg
            for v in variants: add(v, exts + (['.pimg', '.sinfo', '.dpak'] if kind in ('img', 'other') else []), pri)
    # Live2D：g07 的脚本里 ev 图层叫 ev_mv001_02r5s（带 variables），live2d.xp3 里的包叫 ev_cg001_02.l2d（按名字哈希对出来的）：把 ev_mv<编号>_<序号> 换成 ev_cg 再加 .l2d，优先级最高
    seen = set()
    for n in names.get('img', []):
        m = re.match(r'^ev_mv(\w+?_\d+)', n)
        if m and m.group(1) not in seen:
            seen.add(m.group(1))
            for suffix in ('', 's', 'h'): add('ev_cg%s%s' % (m.group(1), suffix), ['.l2d'], (-1, len(seen)))
    out.sort(key=lambda t: t[2])
    return out

KRKR_MB = int(float(env.get('GAL_COLLECT_KRKR_MB', '40'))) * MB     # 每个 xp3 最多收多少 MB（按剧本里用到的资源挑的 + 均匀样本）
KRKR_ENTRY_MAX = 64 * MB
KRKR_EV_MB = int(float(env.get('GAL_COLLECT_KRKR_EV_MB', '24'))) * MB   # evimage 的「从头按 id 收」上限（见 krkr_pick）
KRKR_SMALL_MB = int(float(env.get('GAL_COLLECT_KRKR_SMALL_MB', '80'))) * MB   # data / patch 里所有小条目（≤ 256KB，多半是引擎的 TJS / KS 脚本）的预算
KRKR_L2D_MB = int(float(env.get('GAL_COLLECT_KRKR_L2D_MB', '60'))) * MB   # Live2D 模型包（.l2d）单独的预算（每个约 22MB，不占 KRKR_MB；默认 60MB = 2~3 个）
_krkr_wanted_cache = []
def _rd(f, off, n): f.seek(off); return f.read(n)

def krkr_pick(f, size, base=''):
    """→ (说明, [(标签, id, 条目)])；不是 Hxv4 档案 / 索引解不开也返回（只有均匀样本）；不是 XP3 返回 None"""
    r = xp3_index(f, size)
    if not r: return None
    hx, ents = r
    notes = {'entries': len(ents), 'hxv4': hx is not None, 'special': None}
    chosen = []; seen = set()
    sp = krkr_special(f, hx) if hx else None
    if sp is not None:
        notes['special'] = len(sp)
        if not _krkr_wanted_cache: _krkr_wanted_cache.extend(krkr_wanted())
        found = {}
        for h, lab, pri in _krkr_wanted_cache:
            i = sp.get(h)
            if i is not None and i in ents and i not in found: found[i] = (pri, lab)
        for i, (pri, lab) in sorted(found.items(), key=lambda kv: kv[1][0]): chosen.append((lab, i, ents[i])); seen.add(i)
        notes['matched'] = len(chosen)
    # 均匀样本：不管有没有名字，沿着档案（按 id 排序）等距挑 24 个 ≤ 8MB 的，认格式用
    ids = [i for i in sorted(ents) if i not in seen and sum(s[3] for s in ents[i]['segments']) <= 8 * MB]
    if ids:
        step = max(1, len(ids) // 24)
        for i in ids[::step][:24]: chosen.append(('#%d' % i, i, ents[i])); seen.add(i)
    # evimage（事件 CG）：条目名猜不出来（重定向文本 + dpak 包），按 id（= 按名字排序）从头收 ≤ 8MB 的条目，直到 GAL_COLLECT_KRKR_EV_MB：前面的 CG 的重定向和 dpak 都在里面，离线再配对
    if re.match(r'evimage', base, re.I):
        budget = KRKR_EV_MB - sum(sum(sg[3] for sg in ent['segments']) for _l, _i, ent in chosen if _i in seen)
        for i in sorted(ents):
            if i in seen: continue
            segsz = sum(sg[3] for sg in ents[i]['segments'])
            if segsz > 8 * MB or segsz > budget: continue
            chosen.append(('#%d' % i, i, ents[i])); seen.add(i); budget -= segsz
    # data / patch：引擎的 TJS / KS 脚本是小文本、名字是哈希（脚本引用不到）：按大小把所有 ≤ 256KB 的条目收下来，离线再认
    if re.match(r'(data|patch)', base, re.I):
        budget = KRKR_SMALL_MB
        for i in sorted(ents):
            if i in seen: continue
            segsz = sum(sg[3] for sg in ents[i]['segments'])
            if segsz > 256 * 1024 or segsz > budget: continue
            chosen.append(('#%d' % i, i, ents[i])); seen.add(i); budget -= segsz
    return notes, chosen

def mhp_pick(path, size):
    """.mhp = ZIP：返回 (目录清单 tsv, [(条目名, 内容)])。条目：json 类（≤2MB）均匀 12 个 + 其余（≤512KB）均匀 6 个；不是 ZIP 返回 None。"""
    import zipfile
    try: zf = zipfile.ZipFile(path)
    except Exception: return None
    with zf:
        infos = zf.infolist()
        cat = 'name\tcompress_size\tfile_size\tcrc\n' + ''.join('%s\t%d\t%d\t%08x\n' % (i.filename, i.compress_size, i.file_size, i.CRC) for i in infos[:300000])
        files = [i for i in infos if not i.filename.endswith('/')]
        js = [i for i in files if i.filename.lower().endswith('.json') and 0 < i.file_size <= 2 * MB]
        other = [i for i in files if not i.filename.lower().endswith('.json') and 0 < i.file_size <= 512 * 1024]
        def spread_i(L, n):
            if not L: return []
            step = max(1, len(L) // n); return L[::step][:n]
        out = []
        for i in spread_i(js, 12) + spread_i(other, 6):
            try: out.append((i.filename, zf.read(i)))
            except Exception: pass
    return cat, out

def main():
    games = [g for g in walk_games() if not ONLY or ONLY.search(os.path.relpath(g, root))]
    say('游戏根 %d 个' % len(games))
    gl = open(os.path.join(out, 'games.tsv'), 'w', encoding='utf-8'); gl.write('gid\trelpath\tengines\tfiles\tpicked\tpicked_bytes\n')
    mf = open(os.path.join(out, 'manifest.tsv'), 'w', encoding='utf-8'); mf.write('gid\trel\tmode\trule\tsize\tstored_bytes\tsha256\n')
    total = 0
    for i, game in enumerate(games, 1):
        gid = 'g%02d' % i; rel_game = os.path.relpath(game, root)
        items = list_files(game); eng = engines_of(items); picks = pick(items, eng)
        bgi_forced = bgi_pairs([e for e, _m, r in picks if r == 'bgi:data']) if 'bgi' in eng else {}
        say('== %s %s  引擎=%s 文件=%d 选中=%d' % (gid, rel_game, ','.join(eng), len(items), len(picks)))
        listing = io.BytesIO(('rel\tsize\tmtime\n' + ''.join('%s\t%d\t%d\n' % (e.rel, e.size, e.mtime) for e in items)).encode('utf-8'))
        prefix = os.path.join(out, 'gal-collect-%s-%s-%s.tar.gz' % (ts, host, gid))
        sp = Split(prefix, lambda p: print('PART\t%s' % p, flush=True))
        picked_bytes = 0
        gz = gzip.GzipFile(fileobj=sp, mode='wb', compresslevel=6, mtime=0)
        with tarfile.open(fileobj=gz, mode='w|') as tar:
            ti = tarfile.TarInfo('%s/__listing.tsv' % gid); ti.size = len(listing.getvalue()); ti.mtime = int(time.time()); tar.addfile(ti, io.BytesIO(listing.getvalue()))
            for e, mode, rule in picks:
                if total >= TOTAL_MAX: say('  ! 总量达到上限 %d MB，后面的不收' % (TOTAL_MAX // MB)); break
                eff = mode
                if mode == 'full' and e.size > FULL_MAX: eff = 'ht'
                try:
                    if eff == 'pfs':
                        with open(e.path, 'rb') as f:
                            got = pf8_entries(f, e.size)
                            if got is None:
                                say('  ! %s 不是可解析的 pf8，改收头 + 尾' % e.rel); eff = 'ht'
                            else:
                                idx, ents = got; stored = 0
                                ti = tarfile.TarInfo('%s/%s.__pf8index' % (gid, e.rel)); ti.size = len(idx); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(idx)); stored += len(idx)
                                mf.write('%s\t%s\tpf8index\t%s\t%d\t%d\t%s\n' % (gid, e.rel, rule, e.size, len(idx), hashlib.sha256(idx).hexdigest()))
                                chosen = pf8_pick(ents, e.size) + pf8_media(ents, e.size)
                                for name, off, sz in chosen:
                                    f.seek(off); data = f.read(sz)
                                    if len(data) != sz: mf.write('%s\t%s\tERROR\t%s\t%d\t0\tshort read %s\n' % (gid, e.rel + ':' + name, rule, sz, name)); continue
                                    ti = tarfile.TarInfo('%s/%s.__entries/%s' % (gid, e.rel, name.replace('\\', '/'))); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data)); stored += len(data)
                                    mf.write('%s\t%s\tpf8entry\t%s\t%d\t%d\t%s\n' % (gid, e.rel + ':' + name, rule, sz, len(data), hashlib.sha256(data).hexdigest()))
                                say('   pf8 %s：索引 %d 条，选中 %d 个脚本类条目' % (e.rel, len(ents), len(chosen)))
                                total += stored; picked_bytes += stored
                                continue
                    if eff == 'mhp':
                        got = mhp_pick(e.path, e.size)
                        if got is None:
                            say('  ! %s 不是可解析的 ZIP，改收头 + 尾' % e.rel); eff = 'ht'
                        else:
                            cat, ents = got; cb = cat.encode('utf-8'); stored = 0
                            ti = tarfile.TarInfo('%s/%s.__mhp/__catalog.tsv' % (gid, e.rel)); ti.size = len(cb); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(cb)); stored += len(cb)
                            mf.write('%s\t%s\tmhpcatalog\t%s\t%d\t%d\t%s\n' % (gid, e.rel, rule, e.size, len(cb), hashlib.sha256(cb).hexdigest()))
                            for name, data in ents:
                                ti = tarfile.TarInfo('%s/%s.__mhp/%s' % (gid, e.rel, name)); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data)); stored += len(data)
                                mf.write('%s\t%s\tmhpentry\t%s\t%d\t%d\t%s\n' % (gid, e.rel + ':' + name, rule, len(data), len(data), hashlib.sha256(data).hexdigest()))
                            say('   mhp %s：目录 %d 行 + 样本 %d 个' % (e.rel, cat.count(chr(10)) - 1, len(ents)))
                            total += stored; picked_bytes += stored
                            continue
                    if eff == 'full':
                        with open(e.path, 'rb') as f:
                            ti = tarfile.TarInfo('%s/%s' % (gid, e.rel)); ti.size = e.size; ti.mtime = e.mtime
                            hf = Hashing(f); tar.addfile(ti, io.BufferedReader(hf))
                        mf.write('%s\t%s\tfull\t%s\t%d\t%d\t%s\n' % (gid, e.rel, rule, e.size, e.size, hf.h.hexdigest())); stored = e.size
                    else:
                        stored = 0
                        parts = [('head', 0, min(HT, e.size))]
                        if eff == 'ht' and e.size > HT: parts.append(('tail', max(HT, e.size - HT), min(HT, e.size - HT)))
                        with open(e.path, 'rb') as f:
                            for name, off, ln in parts:
                                f.seek(off); data = f.read(ln)
                                ti = tarfile.TarInfo('%s/%s.__%s_at%d_of%d' % (gid, e.rel, name, off, e.size)); ti.size = len(data); ti.mtime = e.mtime
                                tar.addfile(ti, io.BytesIO(data)); stored += len(data)
                                mf.write('%s\t%s\t%s\t%s\t%d\t%d\t%s\n' % (gid, e.rel, name, rule, e.size, len(data), hashlib.sha256(data).hexdigest()))
                            if rule in ('arcfam:other', 'xfl:index'):   # 只收了头（尾）：再补一份「条目清单（含每个条目开头 16 字节）」+ 几个样本条目，认图片 / 声音 / 脚本格式用
                                got = arcfam_samples(f, e.size) if rule == 'arcfam:other' else xfl_samples(f, e.size)
                                if got is not None:
                                    catalog, picked = got; cat = catalog.encode('utf-8')
                                    ti = tarfile.TarInfo('%s/%s.__samples/__catalog.tsv' % (gid, e.rel)); ti.size = len(cat); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(cat)); stored += len(cat)
                                    mf.write('%s\t%s\tcatalog\t%s\t%d\t%d\t%s\n' % (gid, e.rel, rule, e.size, len(cat), hashlib.sha256(cat).hexdigest()))
                                    for label, off, sz in picked:
                                        f.seek(off); data = f.read(sz)
                                        if len(data) != sz: continue
                                        ti = tarfile.TarInfo('%s/%s.__samples/%s' % (gid, e.rel, re.sub(r'[\\/:*?"<>|]', '_', label))); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data)); stored += len(data)
                                        mf.write('%s\t%s\tsample\t%s\t%d\t%d\t%s\n' % (gid, e.rel + ':' + label, rule, sz, len(data), hashlib.sha256(data).hexdigest()))
                                    say('   %s %s：清单 %d 行 + 样本 %d 个' % (rule.split(':')[0], e.rel, catalog.count(chr(10)) - 1, len(picked)))
                            if rule in ('krkr:xp3-index', 'krkr:data', 'krkr:scn') and eff == 'ht':   # KiriKiri：按剧本用到的资源名挑条目（原样不解密）+ 均匀样本
                                try: got = krkr_pick(f, e.size, os.path.basename(e.rel))
                                except Exception as ex: got = None; say('  ! krkr 挑条目失败 %s: %s' % (e.rel, ex))
                                if got is not None:
                                    notes, chosen = got; kstored = 0; l2dstored = 0; smallstored = 0; index = []
                                    is_data = bool(re.match(r'(data|patch)', os.path.basename(e.rel), re.I))
                                    is_ev = bool(re.match(r'evimage', os.path.basename(e.rel), re.I))
                                    for label, eid, ent in chosen:
                                        segsz = sum(sg[3] for sg in ent['segments'])
                                        if segsz > KRKR_ENTRY_MAX: continue
                                        is_l2d = label.lower().endswith('.l2d')
                                        is_small = is_data and label.startswith('#') and segsz <= 256 * 1024   # 引擎的小条目：自己一份预算，不和图抢（1.12 之前图把共用的额度吃完，小条目只收到 4 个）
                                        if is_small:
                                            if smallstored + segsz > KRKR_SMALL_MB: continue
                                        elif is_l2d:
                                            if l2dstored + segsz > KRKR_L2D_MB: continue
                                        elif kstored - l2dstored - smallstored + segsz > (KRKR_EV_MB if is_ev else KRKR_MB): continue
                                        data = b''.join(_rd(f, sg[1], sg[3]) for sg in ent['segments'])
                                        if len(data) != segsz: continue
                                        ti = tarfile.TarInfo('%s/%s.__krkr/%d.seg' % (gid, e.rel, eid)); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data)); kstored += len(data); l2dstored += len(data) if is_l2d else 0; smallstored += len(data) if is_small else 0
                                        index.append({'id': eid, 'label': label, 'size': ent.get('size'), 'adler': ent['adler'], 'segments': [list(sg) for sg in ent['segments']]})
                                        mf.write('%s\t%s\tkrkrentry\t%s\t%d\t%d\t%s\n' % (gid, e.rel + ':' + str(eid), rule, segsz, len(data), hashlib.sha256(data).hexdigest()))
                                    ij = json.dumps({'notes': notes, 'entries': index}, ensure_ascii=False).encode('utf-8')
                                    ti = tarfile.TarInfo('%s/%s.__krkr/index.json' % (gid, e.rel)); ti.size = len(ij); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(ij)); kstored += len(ij)
                                    stored += kstored
                                    say('   krkr %s：索引 %s 条，特殊索引 %s，命中剧本资源 %s，收 %d 条 %.1f MB' % (e.rel, notes['entries'], notes['special'] if notes['special'] is not None else '解不开', notes.get('matched', '-'), len(index), kstored / MB))
                            if rule == 'bgi:data':   # 太大只收了头尾：再按 ARC20 索引补收样本图 + 图的目录清单
                                got = bgi_samples(f, e.size, bgi_forced.get(e.rel))
                                if got is not None:
                                    idx, picked, catalog = got
                                    cat = catalog.encode('utf-8')
                                    ti = tarfile.TarInfo('%s/%s.__bgi/__catalog.tsv' % (gid, e.rel)); ti.size = len(cat); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(cat)); stored += len(cat)
                                    mf.write('%s\t%s\tbgicatalog\t%s\t%d\t%d\t%s\n' % (gid, e.rel, rule, e.size, len(cat), hashlib.sha256(cat).hexdigest()))
                                    for name, off, sz in picked:
                                        f.seek(off); data = f.read(sz)
                                        if len(data) != sz: continue
                                        ti = tarfile.TarInfo('%s/%s.__bgi/%s' % (gid, e.rel, re.sub(r'[\\/:*?"<>|]', '_', name))); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data)); stored += len(data)
                                        mf.write('%s\t%s\tbgiimage\t%s\t%d\t%d\t%s\n' % (gid, e.rel + ':' + name, rule, sz, len(data), hashlib.sha256(data).hexdigest()))
                                    say('   bgi %s：目录清单 + 样本图 %d 张' % (e.rel, len(picked)))
                    total += stored; picked_bytes += stored
                except OSError as ex:
                    say('  ! 读不了 %s: %s' % (e.rel, ex)); mf.write('%s\t%s\tERROR\t%s\t%d\t0\t%s\n' % (gid, e.rel, rule, e.size, ex))
        gz.close(); sp.close()
        gl.write('%s\t%s\t%s\t%d\t%d\t%d\n' % (gid, rel_game, ','.join(eng), len(items), len(picks), picked_bytes)); gl.flush(); mf.flush()
        say('   %s 原始 %.1f MB → %d 卷' % (gid, picked_bytes / MB, len(sp.parts)))
    gl.close(); mf.close()
    # 元数据包：games.tsv / manifest.tsv / 运行信息（日志在最后由 shell 补进去）
    info = {'version': VERSION, 'ts': ts, 'host': host, 'root_name': os.path.basename(root), 'part_mb': PART // MB, 'full_max_mb': FULL_MAX // MB, 'ht_mb': HT // MB, 'total_mb': total // MB, 'games': len(games), 'python': sys.version.split()[0], 'binaries': BINARIES}
    json.dump(info, open(os.path.join(out, 'info.json'), 'w'), ensure_ascii=False, indent=1)

main()
PYEOF

UP_FAIL=0
UP_COUNT=0
log "扫描：$ROOT"
"$PY" "$HELPER" "$ROOT" "$OUT" "$TS" "$HOST_TAG" | while IFS=$'\t' read -r kind path; do
  [ "$kind" = PART ] || continue
  if upload_one "$path"; then [ "$DRYRUN" = 1 ] || rm -f "$path"; echo "OK $path" >> "$OUT/.uploaded"; else echo "FAIL $path" >> "$OUT/.failed"; fi
done
PYRC=${PIPESTATUS[0]}
[ "$PYRC" -eq 0 ] || { log "采集出错（python 退出码 $PYRC）"; exit 1; }

# 元数据包（games.tsv / manifest.tsv / info.json / 日志）
scrub "$LOG"
META="$OUT/gal-collect-$TS-$HOST_TAG-meta.tar.gz"
tar -czf "$META" -C "$OUT" games.tsv manifest.tsv info.json run.log || { log "元数据打包失败"; exit 1; }
if upload_one "$META"; then [ "$DRYRUN" = 1 ] || rm -f "$META"; else echo "FAIL $META" >> "$OUT/.failed"; fi

if [ -s "$OUT/.failed" ]; then
  log "有文件上传失败（留在 $OUT）："; cat "$OUT/.failed"
  ERROR_DONE=1
  exit 2
fi
if [ "$DRYRUN" = 1 ]; then log "DRYRUN 完成：分卷和元数据留在 $OUT，没有上传"; else log "全部完成：$(wc -l < "$OUT/.uploaded" 2>/dev/null || echo 0) 个文件（分卷 + 元数据）已上传到 $REPO release $TAG"; fi
[ "$DRYRUN" = 1 ] || { rm -f "$HELPER" "$OUT/games.tsv" "$OUT/manifest.tsv" "$OUT/info.json"; }
ERROR_DONE=1
exit 0
