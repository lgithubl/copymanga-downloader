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
#   GAL_COLLECT_RULES   只收规则名匹配这个正则的文件（规则名见清单里的 rule 列，如 ^chakra:）；默认值 = 本版「这一轮要的」（见下面 ROUND_RULES，随版本变），不再把以前要过的东西每次都重收；GAL_COLLECT_RULES=all 恢复全收；没有任何文件命中的游戏整个跳过（不出分卷）
#   GAL_COLLECT_TSK_LOG 设置正整数 N 即只采最近 N 次 TSK 日志；空值兼容为1次，优先于默认规则及 GAL_COLLECT_RULES；例如 GAL_COLLECT_TSK_LOG=3 bash gal-collect.sh .
#   GAL_COLLECT_BINARIES=1  也收 GameAssembly.dll / UnityPlayer.dll 这类大二进制（给以后逆向用），默认不收
#   GAL_COLLECT_DRYRUN=1    只扫描 + 打包到本地，不上传
#   GAL_COLLECT_OUT     本地输出目录，默认 /tmp/gal-collect-<时间>（传完的分卷会删掉；DRYRUN 保留）
#   GAL_COLLECT_GH      gh 命令，默认 gh（测试时可以换成桩）
# 还原：同一个游戏的分卷按序号 cat 起来再解压：cat gal-collect-<时间>-g01.tar.gz.part-* | tar xzf -
# 退出码：0 全部成功；1 出错（出错日志已打包上传）；2 有分卷上传失败（留在本地输出目录）
set -uo pipefail
# 版本号：每次改采集规则就加一，运行时第一行打印，也写进 info.json / 日志，方便对上「这批数据是哪版脚本采的」
# 1.0 初版；1.1 Artemis(pf8) 按索引只取脚本 / lua / tbl；Unity 补 *.dsm / *.cof / system 小文件 / psm 样本；AGE 补 .aai；启动时打印版本
# 1.52 剩余三作：按已验证索引的精确偏移收少量剧情/资源；约6.7MB，索引SHA256守卫防版本错配；只读、不执行游戏或下载依赖。
# 1.51 仅补采夜勤和国度的有界媒体样本及完整PAC索引，验证CG/立绘/语音；不重收脚本或整个资源包。
# 1.50 五作二轮：AI的sx/存储索引、国度外置文本/PAC头尾、シロクロ元数据/首个bundle/索引、ツヴァイXP3索引/原始剧情样本/原EXE、夜勤script/data及资源索引；每作16MB上限，原目录只读。
# 1.49 定向采五个新游戏的目录/配置/有界EXE及资源包头尾，用于引擎复用分析；AI按完整目录名匹配，不采完整媒体或大二进制。
# 1.48 三作媒体验证样本：按已采剧情/地图引用定向取24个图片/声音/瓦片/人物文件，约8.8MB；封装MV只读原始资源块，不重复脚本数据。
# 1.47 RJ01220265补采封装资源表及data/plugin源码原始块（压缩块原样保留），仅Python标准库、只读；格式不符保留小段头并报告。
# 1.46 本轮仅补采RJ01220265：readme及EXE各256KB头尾，用来识别单文件封装；不收完整1.8GB EXE，不重收两个MZ游戏。
# 1.45 本轮采新RJ游戏（排除已采RJ01482469）：目录清单、data JSON、引擎/插件JS、小配置；不收图片/声音/视频/EXE或运行时库。
# 1.44 GAL_COLLECT_TSK_LOG=N 采最近N次TSK日志，空值兼容1次；无关游戏日志不计入N。
# 1.43 本轮只采 RJ Map002/004 使用的瓦片和人物图，含玩家行走图；不采声音和剧情CG。
# 1.42 GAL_COLLECT_TSK_LOG 存在时，只采最新TSK日志（不选更新的其他游戏日志），覆盖当前默认采集规则。
# 1.41 本轮只采 Ch10340034：Master/CharaScenario1034003 和1034003/3332001/3301001的角色骨架图集贴图；旧日志规则仍可显式指定。
# 1.40 不打包完整 plan，只记录来源/体积；大 result 保留完整汇总及条目状态计数，明示列表取样；大文本明示只收末尾1MB。修复大于64MB的plan导致采集中断。
# 1.39 本轮只采 gal/gal-download（允许软链接）最近运行的日志、result/repairs/error JSON 和关联 plan；不遍历 bundles，不采 APK 或修复备份。
# 1.38 本轮补采 RJ01482469 的 RPG Maker 数据/插件与少量加密媒体样本；TSK 仅采 Ch10380048/1038004 的骨架、图集、贴图及相关剧情 JSON，总量上限128MB。
# 1.37 本轮只采 RJ01482469 目录元数据：路径、大小、mtime、扩展名统计；不读取或打包游戏文件内容。
# 1.36 本轮仅采 TSK 目录元数据：路径、大小、mtime、分类与最近12h统计，不打包任何游戏文件。
# 1.35 之前一轮采 Twinkle Star Knights X：资源分类清单（含最近12h修改、大小、PNG尺寸）、剧情JSON（上限128MB）、每类最新两张PNG及配套骨架（上限128MB）；声音只列清单。原目录只读，不删除文件。
# 1.34 本轮只收一样：友恵的图（规则 chakra:cgs，Data00x 的目录清单照旧）——验证补丁 / 图层规则用：① ch12 s11~s12 缺的 30 张图（背景 + 整图 + 补丁，≈66MB；GAL_TOMOE_CGS 换成别的图号，逗号分隔）② CG 画廊的 144 张 382×215 缩略图（≈22MB；GAL_TOMOE_THUMBS=0 不收）——缩略图是游戏自己合成出来的 CG，拿来对「整图 + 哪些补丁」才是对的
# 1.33 之前一轮只收一样：友恵の探偵物語（TinkerBell / tomoe 引擎）的「图层语义」要看引擎本体——规则 tomoe:core：tomoe.exe（≈4MB，逆向 $204 画图 / #35 / #13 / #29 / #70 / #87 这些指令怎么决定哪层可见、谁在上面）、Arc00~Arc04.dat（小表 + 剧本 + 声音表，Arc04 ≈ 4.8MB）、arc/.stamp.json、几个原始 .tomoe 剧本样本（GAL_TOMOE_RAW 换，逗号分隔、小写相对路径）。合计 ≈ 9MB
# 1.32 之前一轮只收一样：スイートホームメイド 场景 story1020043 里的 Spine 角色 cast001001（iroha_001 的 atlas / json / png，3 个文件 ≈ 600KB；规则 gc:cast，GAL_GC_CASTS 换角色，逗号分隔）——场景本身（帧 / 脚本）1.31 已收到，帧没有黑帧，要在真实环境里复现黑屏就缺这个角色
# 1.31 本轮只收两样：Otogi 222951 的贴图（1.30 的 EXCL 把 png 过滤掉了，只收到 json / atlas：规则 otogi:still 现在放行这个目录里的图）、Girls Creation 系（スイートホームメイド 等）场景 story1020043 的整个场景目录（规则 gc:scene：script.txt + animations/ 帧 + 场景自己的图；声音不收；GAL_GC_SCENES 换场景，逗号分隔）
# 1.30 另：Mahotan（规则 mhp:named：目录清单 + 角色 avt_00004c / cha_20134 的 animation / cg / standing，核对 CG 是不是只有静图、Spine 待机骨架的版本）、Otogi（规则 otogi:still / otogi:list：chara/still/222951/ 整个目录 + json/222951 + jsoncn/222951 + list.json，查骨骼为什么黑屏）；本轮只收 ^(chakra:cgs|mhp:named|otogi:)\n# 1.30 友恵：#35 只是藏起来（层里的内容还在），所以补丁的底图是前面画在 140 层上的整张图——chakra:cgs 只收之前没收到的 44 张底图（约 78MB；以前收过的 99 张不重收）；本轮只收 ^chakra:cgs\n# 1.29 友恵：chakra:cgs 的 CG 图再加 03_21_cg / 04_02_cg 用到的 33 张（声音错位已经从统计里定位，不用再收声音）；本轮只收 ^chakra:cgs\n# 1.28 本轮四件事：Artemis 规则 artemis:named（pf8 里按名字收：3 个 .ogv 视频 CG（黑屏排查）、image/sys + image/sd 全部小图（cinema01 / reco / 白闪图层的尺寸）、bg 的 black / white / bg04a / zbg04a、image/fg 的 kae_1.psb + sat_1.psb（脚本里用得最多的两个 E-mote 模型，采集里一直没有））；Imys 规则 imys:r18（H CG 5 个）/ imys:thumb（memorial 缩略图 + 横幅 + 角色图标样本）/ imys:chars（每个角色每个类别最小的一份剧本，查角色名）/ imys:named（cloth_001_0702 / cloth_030_0603）；友恵 规则 chakra:cgs（Data00x 里每张图的类型 / 宽高 / 标志 + CG 场景用到的 95 张图原样收）；本轮只收 ^(artemis:named|imys:(r18|thumb|chars|named)|chakra:cgs)\n# 1.27 Artemis 找 E-mote 的 PSB 密钥：规则 artemis:exe / artemis:dll（游戏根目录 depth <= 1 的 .exe <= 120MB、.dll <= 60MB，原样收）；本轮只收 ^artemis:(exe|dll)\n# 1.26 Ark Re CG：规则 unity:cg-ctrl（所有 CG 的 .controller / .prefab，Animator 状态机 = BGMotion 的状态名 → 骨架动画的映射，每个 <= 1MB，累计 <= 60MB）、unity:cg-full（A0275 = H153_03 和 A0012 整个目录，单个文件 <= 12MB：骨架 + 图集 + 10MB 主贴图 + 控制器，用来验证渲染）、unity:cg-img（H153_01 / 02 的静态图 A0273 / A0274）；本轮收 ^(artemis:emote|unity:cg-)\n# 1.25 Artemis E-mote：规则 artemis:emote（只对 pf8 档案）：脚本类条目照旧全收（.ast / .ini / .csv …，看 E-mote 的调用和配置），另收 E-mote 相关文件：.psb / .emtbytes / .mtn / .pimg 小的（<= 300KB）最多 40 个 + 大的（<= 40MB）按名字分散最多 4 个整份（模型 + 内置贴图），总量 <= 120MB；本轮只收 ^artemis:emote\n# 1.24 Imys：背景 bundle（bg_avg_003/004/006/009、bg_tra_301）、立绘 bundle（00001 / 00101 / 00102 / 00103 / 00201 / 00301 …）、BGM b1100 的 acb+awb、s0100 音效；本轮只收 ^imys:\n# 1.23 BGI 按图名收：新增规则 bgi:named（GAL_BGI_NAMES 正则，默认 ^osev_m_08[a-d]$ = 両腕が折れた… 手的特写 4 张）：读每个 data*.arc 的 ARC20 索引，命中的图原样收（单张 <= 12MB），不收档案头尾；ROUND_RULES 改成只收它
# 1.22 只收「这一轮要的」：新增 GAL_COLLECT_RULES（规则名正则），默认 = ROUND_RULES（本版只写 ^chakra:）；没命中的游戏整个跳过。以后每个版本只写当次需要的规则，不再重收以前要过的\n# 1.21 修 1.20：TOMOE_USED 的键是字符串（JSON 来的），按文件号 int 取不到 → 没按「脚本用得最多」挑、从头顺序收了\n# 1.20 友恵の探偵物語（chakra）：Data000 / 003 / 004 按 Data00.dat 索引挑脚本用得最多的图（原样不解压），Arc06 出 RIFF 清单 + 样本，存档 / 存档缩略图 / tomoetantei.zip 全收
# 1.19 修 1.18：Imys 的 scenarios 分 6 个子目录（combo / dress / event / favorite / quest / training），1.18 的正则只认第一层、只收到 default_chars 一个：每个子目录抽 12 个 + 最大 2 个（bundle 只有 2~25KB），再加每个子目录 1 个剧情语音 .acb\n# 1.18 Imys 这类剧情在 bundle 里的：content/bundles/scenarios 抽 8 个、textdefine 抽 4 个（.encrypted，≤8MB）
# 1.17 跟着软连接走（游戏根 / 目录 / 文件是软连接都能扫到；按真实路径去重防成环）
# 1.16 修 1.15：剧情表的正则没忽略大小写（Caches / _Data），Imys 的 mAdventures 等没收到
# 1.15 Unity 补：Caches/masterdata 里剧情 / 图鉴 / 单位 / 语音相关的表（名字匹配 Advent / Story / Scenario / Episode / Talk / Dialog / Message / Gallery / Bgm / Voice / Memor / Unit…，每个 ≤ 6MB）；对话 Spine 样本（Hero/<H>/<H>/ 的 skel.asset + atlas.asset + png、_Dialog / Align_Object 的 fbx、几个 anim）、CG Spine 一套、几张 BG png（ArcRecordExport 这类导出的 Unity 资源）
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
VERSION="1.52"
export GAL_COLLECT_VERSION="$VERSION"
# 这一轮要的规则（正则，对规则名）。每个版本只写当时需要的——以前要过的已经分析完的不再收，传的东西才不会越来越大。要全收：GAL_COLLECT_RULES=all
ROUND_RULES='^new-games:remaining$'
export GAL_BGI_NAMES_DEFAULT='^osev_m_08[a-d]$'   # 1.23：BGI 按图名收（不管在哪个 data*.arc 里）
export GAL_COLLECT_RULES_DEFAULT="$ROUND_RULES"
if [ "${GAL_COLLECT_TSK_LOG+x}" = x ]; then export GAL_COLLECT_RULES='^gal-download:latest$'; fi
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

archive_tmp() {
  local f dst
  dst="$(mktemp -d /tmp/gal-collect-archive.XXXXXXXX)" || return 1
  for f in "$@"; do
    [ ! -e "$f" ] && [ ! -L "$f" ] && continue
    mv -- "$f" "$dst/" || return 1
  done
}

ERROR_DONE=0
on_exit() {
  local rc=$?
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$ERROR_DONE" = 0 ]; then
    ERROR_DONE=1
    log "出错（退出码 ${rc}），打包出错日志"
    scrub "$LOG"
    local eb="$OUT/gal-collect-$TS-${HOST_TAG}-ERROR.tar.gz"
    tar -czf "$eb" -C "$OUT" --ignore-failed-read run.log games.tsv manifest.tsv 2>/dev/null || tar -czf "$eb" -C "$OUT" run.log 2>/dev/null
    upload_one "$eb" && archive_tmp "$eb" || log "出错日志没传上去，留在 $eb"
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
_rules = env.get('GAL_COLLECT_RULES') or env.get('GAL_COLLECT_RULES_DEFAULT') or ''
RULES_RE = None if _rules in ('', 'all') else re.compile(_rules)
BGI_NAMES_RE = re.compile(env.get('GAL_BGI_NAMES') or env.get('GAL_BGI_NAMES_DEFAULT') or '^$', re.I)

def say(msg): print(msg, file=sys.stderr, flush=True)

# 一律不收（相对路径，统一用 / 、小写比较）
EXCL = re.compile(r'(^|/)(save|savedata|userdata|backup)(/|$)|\.(sud|sav|lnk|rar|7z|zip|tmp|bak|mp4|mpg|mpeg|wmv|avi|mkv|webm|ogg|mp3|wav|flac|m4a|png|jpg|jpeg|bmp|gif|psm|pdf)$|(^|/)save[^/]*\.(dat|bak|sth|seek)$|(^|/)(unins|uninst|uninstall)[^/]*$', re.I)
TEXT_EXT = ('.txt', '.xml', '.json', '.ini', '.cf', '.cfg', '.gdb', '.edb', '.hvl', '.log', '.info', '.inf', '.csv', '.sig', '.lst', '.aai', '.dsm', '.cof')

MARK = re.compile(r'\.(exe|xp3|arc|xfl|pfs|agf|alf)$|\.pfs\.\d+$', re.I)

def walk_follow(top):
    """os.walk，但跟着软连接（目录 / 文件都算）；按真实路径去重，免得软连接成环或同一个目录被扫两遍。"""
    seen = set()
    for d, ds, fs in os.walk(top, followlinks=True):
        real = os.path.realpath(d)
        if real in seen: ds[:] = []; continue
        seen.add(real)
        yield d, ds, fs

def walk_games():
    """自上而下找「游戏根」：这一层有 exe / xp3 / arc / xfl / pfs / agf / alf 文件，或有 *_Data 目录；找到就不再往下（最浅的算）。"""
    games = []
    for d, ds, fs in walk_follow(root):
        rel = os.path.relpath(d, root)
        depth = 0 if rel == '.' else rel.count(os.sep) + 1
        if depth > 5: ds[:] = []; continue
        hit = any(MARK.search(f) for f in fs) or any(x.lower().endswith('_data') for x in ds) or os.path.isdir(os.path.join(d, 'bundles', 'scenarios')) or ('package.json' in fs and os.path.isdir(os.path.join(d, 'scenes'))) or ('list.json' in fs and os.path.isdir(os.path.join(d, 'typeadv', 'MScenes')))   # 最后一项：Imys 离线图库的 content 目录（没有 exe，bundles/scenarios 里是剧情脚本）
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
    for d, ds, fs in walk_follow(game):
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
    if any(n.startswith('bundles/scenarios/') for n in names): eng.append('imys')   # 1.24：Imys 的 content 目录（没有 exe）
    if 'bgi.gdb' in base or 'sysprg.arc' in base: eng.append('bgi')
    if 'script.arc' in base and ('systeminfo.json' in base or 'fileinfo.xml' in base): eng.append('arcfam')
    if any(n.endswith('.xp3') for n in base): eng.append('krkr')
    if any(re.search(r'\.pfs(\.\d+)?$', n) for n in base): eng.append('artemis')
    if any('/' in n and n.split('/')[0].endswith('_data') and n.rsplit('/', 1)[-1] == 'globalgamemanagers' for n in names) or any(n.endswith('_data/globalgamemanagers') for n in names): eng.append('unity')
    if 'chakracore.dll' in base or any(re.fullmatch(r'arc\d\d\.dat', n) for n in base): eng.append('chakra')
    if any(n.endswith('.mhp') for n in base): eng.append('mhp')
    if 'list.json' in base and any(n.startswith('typeadv/mscenes/') for n in names): eng.append('otogi')   # 1.30：Otogi Frontier R 离线网页版
    if any(re.search(r'(^|/)scenes/[^/]+/script\.txt$', n) for n in names): eng.append('gc')   # 1.31：Girls Creation Viewer 系（NW.js，<根>/scenes/<场景>/script.txt）
    if any(n.endswith('.xfl') for n in base): eng.append('xfl')
    if any(re.search(r'(^|/)data/system\.json$', n) for n in names):
        eng.append('rpgmaker-mz' if any(n.endswith('/rmmz_core.js') for n in names) else 'rpgmaker-mv' if any(n.endswith('/rpg_core.js') for n in names) else 'rpgmaker')
    if any(n.endswith('.agf') for n in base) or 'data2.alf' in base: eng.append('age')
    return eng or ['unknown']

TOMOE_RAW = set(x.strip().lower() for x in (os.environ.get('GAL_TOMOE_RAW') or 'arc/script/arc04/03/03_21_cg.tomoe,arc/script/arc04/04/04_02_cg.tomoe,arc/script/arc04/12/12_20_cg.tomoe,arc/script/arc04/03/03_18.tomoe').split(',') if x.strip())
GC_CASTS = set(x.strip() for x in (os.environ.get('GAL_GC_CASTS') or 'cast001001').split(',') if x.strip())
GC_SCENES = set(x.strip() for x in (os.environ.get('GAL_GC_SCENES') or 'story1020043').split(',') if x.strip())
OTOGI_STILLS = set((os.environ.get('GAL_OTOGI_STILLS') or '222951').split(','))
_imys_taken = collections.Counter()
def imys_take(key, limit):
    """同一个「形状」最多收 limit 个（缩略图每种命名各 2 张，r18 每种各 1 张）。"""
    if _imys_taken[key] >= limit: return False
    _imys_taken[key] += 1; return True

def pick(items, eng):
    """返回 [(Entry, mode, rule)]；mode：full（整个，超过 FULL_MAX 退成 ht）/ ht（头 + 尾）/ head（只要头）。"""
    want = {}
    def add(e, mode, rule):
        if e.rel not in want and not EXCL.search(e.rel.lower()): want[e.rel] = (e, mode, rule)
    def addf(e, mode, rule):   # 1.31：不过 EXCL（EXCL 会过滤 png / jpg / ogg 等；这两条规则就是要图）
        if e.rel not in want: want[e.rel] = (e, mode, rule)
    # 1.28 Imys：每个角色（文件名里的 3 位编号）每个类别（dress / favorite / training）最小的一份剧本（查角色名）
    imys_chars = set()
    if 'imys' in eng:
        best = {}
        for e in items:
            m = re.fullmatch(r'bundles/scenarios/(dress|favorite|training)/(?:cloth|sin|gakuen)_(\d{3})[^/]*\.jp\.encrypted', e.rel.lower())
            if not m or e.size > 64 * 1024: continue
            key = (m.group(1), m.group(2))
            if key not in best or e.size < best[key][0]: best[key] = (e.size, e.rel.lower())
        imys_chars = {v[1] for v in best.values()}
    if any('/streamingassets/twinkle star knights x/' in e.rel.lower() for e in items):
        for e in tsk_audit_picks(items): addf(e, 'inventory', 'tsk:audit')
    for e in items:
        low = e.rel.lower(); base = low.rsplit('/', 1)[-1]; depth = low.count('/')
        if 'otogi' in eng:   # 1.30：先于 common:text（add 先到先得，.json 会被它抢走）
            m = re.match(r'chara/still/(\d+)/', low)
            if m and m.group(1) in OTOGI_STILLS and e.size <= 40 * MB: addf(e, 'full', 'otogi:still')   # 1.31：含 png 贴图
            elif re.fullmatch(r'(json|jsoncn)/(\d+)', low) and low.rsplit('/', 1)[1] in OTOGI_STILLS and e.size <= 8 * MB: add(e, 'full', 'otogi:still')
            elif low == 'list.json' and e.size <= 16 * MB: add(e, 'full', 'otogi:list')
        if 'gc' in eng:   # 1.31：场景目录（script.txt / animations 帧 / 场景自己的图），声音不收
            m = re.search(r'(?:^|/)scenes/([^/]+)/(.*)$', low)
            if m and m.group(1) in GC_SCENES and not re.search(r'\.(ogg|mp3|wav|m4a|flac|mp4|webm)$', low) and e.size <= 40 * MB: addf(e, 'full', 'gc:scene')
        if 'chakra' in eng:   # 1.33：tomoe 引擎本体 + 小表 / 剧本 / 声音表 + 原始 .tomoe 样本（先于 common:exe）
            if depth == 0 and base == 'tomoe.exe' and e.size <= 60 * MB: addf(e, 'full', 'tomoe:core')
            elif depth == 0 and re.fullmatch(r'arc0[0-4]\.dat', base) and e.size <= 40 * MB: addf(e, 'full', 'tomoe:core')
            elif low == 'arc/.stamp.json' or low in TOMOE_RAW: addf(e, 'full', 'tomoe:core')
        if 'gc' in eng:   # 1.32：Spine 角色目录 data/spine/cast/<cast>/（atlas / json / skel / png）
            m = re.search(r'(?:^|/)data/spine/cast/([^/]+)/', low)
            if m and m.group(1) in GC_CASTS and e.size <= 40 * MB: addf(e, 'full', 'gc:cast')
        if 'artemis' in eng and depth <= 1 and base.endswith('.exe') and e.size <= 120 * MB: add(e, 'full', 'artemis:exe')   # 先于 common:exe（add 先到先得）
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
                if depth <= 1 and base.endswith('.exe') and e.size <= 120 * MB: add(e, 'full', 'artemis:exe')
                elif depth <= 1 and base.endswith('.dll') and e.size <= 60 * MB: add(e, 'full', 'artemis:dll')
                if re.search(r'\.pfs(\.\d+)?$', base): add(e, 'pfs', PF8_RULE)   # 索引 + 脚本类条目（不是头尾：.ast 脚本在 8MB 之外）；1.28 起默认 artemis:named（GAL_PF8_MODE=emote 回到 1.25 的 E-mote 小文件）
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
            elif en == 'imys':
                # 1.24：背景 / 立绘 bundle 样本 + CRI 声音样本（原样收，.encrypted 不解）。背景：剧本里出现过的 bg_avg_004 / bg_tra_301 / bg_avg_009 / bg_avg_006 / bg_avg_003 + 3 个别的小的；
                # 立绘：characters/tati 里剧本用过的 001 / 002 / 003 / 102 / 103 的第一套（00101 … ）+ 最小的 3 个；声音：BGM b1100 的 acb + awb、SCENARIO_SE s0100、VOICE 最小的 3 个 acb + 对应 awb
                if re.fullmatch(r'bundles/backgrounds/(bg_avg_00[3469]|bg_tra_301)\.jp\.encrypted', low) and e.size <= 8 * MB: add(e, 'full', 'imys:bg')
                elif re.fullmatch(r'bundles/characters/tati/(00001|00101|00102|00103|00201|00301|10201|10301)\.encrypted', low) and e.size <= 8 * MB: add(e, 'full', 'imys:tati')
                elif re.fullmatch(r'raw/bgm/bgm_1100\.(acb|awb)', low) or re.fullmatch(r'raw/scenario_se/s0100\.acb', low): add(e, 'full', 'imys:snd')
                # 1.28：H CG（backgrounds/r18：剧本里 BGDraw("R18/hcg_0270301")，以前没扫这个子目录）、memorial 缩略图 / 横幅、角色图标（<角色 3 位><衣装 2 位>）、按名字的剧本
                elif re.fullmatch(r'bundles/backgrounds/r18/(hcg_0270301|hcg_0300301|eve_0010101)\.jp\.encrypted', low) and e.size <= 8 * MB: add(e, 'full', 'imys:r18')
                elif re.fullmatch(r'bundles/backgrounds/r18/hcg_\d{3}(le|me)\d{2}\.jp\.encrypted', low) and e.size <= 8 * MB and imys_take('r18:' + base[7:9], 1): add(e, 'full', 'imys:r18')
                elif re.fullmatch(r'bundles/memorial/thumbnails/[^/]+\.encrypted', low) and e.size <= 1 * MB and imys_take('thumb:' + re.sub(r'\d', '#', base), 2): add(e, 'full', 'imys:thumb')
                elif re.fullmatch(r'bundles/memorial/banners/memorialbtn_00[0-2]\.jp\.encrypted', low): add(e, 'full', 'imys:thumb')
                elif re.fullmatch(r'bundles/characters/icon/(02706|016a8|013le|008c8|00101|00000)\.encrypted', low) and e.size <= 4 * MB: add(e, 'full', 'imys:thumb')
                elif low in imys_chars: add(e, 'full', 'imys:chars')
                elif re.fullmatch(r'bundles/scenarios/dress/(cloth_001_0702|cloth_030_0603)\.jp\.encrypted', low): add(e, 'full', 'imys:named')
            elif en == 'chakra':
                if base == 'arc06.dat': add(e, 'tomoe', 'chakra:arc06')   # 1.20：Arc06 = 一串 RIFF WAV（后面跟 Tink 标签）：只要「RIFF 位置 / 大小 / 标签」清单 + 几个样本，不收 428MB
                elif re.fullmatch(r'arc\d\d\.dat', base): add(e, 'full', 'chakra:arc')
                elif low.startswith('resources/') and re.fullmatch(r'data\d{3}\.dat', base): add(e, 'tomoe', 'chakra:cgs')   # 1.28：每个 Data00x 出「每张图的类型 / 宽高 / 标志」清单 + CG 场景用到的图原样收
                elif low.startswith('resources/') and re.fullmatch(r'data\d+\.dat', base) and (e.size > 20 * MB or base == 'data004.dat'): add(e, 'tomoe', 'chakra:resbig')   # 1.20：按 Data00.dat 的索引挑条目（脚本里用得最多的图）
                elif low.startswith('resources/') and base.endswith('.dat') and e.size <= 20 * MB: add(e, 'full', 'chakra:res')
                elif re.fullmatch(r'(g?save\d*|suspend)\.dat', base) or low.startswith('thumbnail/') or base == 'tomoetantei.zip': add(e, 'full', 'chakra:save')   # 1.20：存档（含剧本位置 / 变量）+ 存档缩略图（截图 = 对照画面）
            elif en == 'mhp':
                if base.endswith('.mhp'):
                    if MHP_MODE == 'named': add(e, 'mhp', 'mhp:named')   # 1.30：只收目录清单 + 按名字的条目（MHP_NAMES）
                    else: add(e, 'full' if e.size <= 20 * MB else 'mhp', 'mhp:small' if e.size <= 20 * MB else 'mhp:big')
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
        story = [e for e in items if re.search(r'_data/caches/masterdata/m(?:\w*(?:Advent|Story|Scenario|Episode|Talk|Dialog|Message|Gallery|Bgm|BackgroundImage|Memor|Voice)\w*|Units?|Unit[A-Z]\w*)$', e.rel, re.I) and 1024 <= e.size <= 6 * MB]   # 目录名 / 表名大小写不固定（imys_r_Data/Caches/masterdata/mAdventures）
        for e in story:
            if e.rel not in want: want[e.rel] = (e, 'full', 'unity:masterdata-story')
        ab = [e for e in items if re.search(r'_data/caches/assetbundles/[^/]+$', e.rel.lower()) and 1024 <= e.size <= 6 * MB]
        for e in spread(ab, 3, 7):
            if e.rel not in want: want[e.rel] = (e, 'full', 'unity:bundle-sample')
        for e in items:
            low = e.rel.lower()
            if low.startswith('bepinex/plugins/') and low.endswith('.dll') and e.size <= 2 * MB and e.rel not in want: want[e.rel] = (e, 'full', 'unity:plugin')
            elif '/staticdata/' in '/' + low and e.size <= 20 * MB and e.rel not in want: want[e.rel] = (e, 'full', 'unity:staticdata')
        # 导出的 Unity 资源（ArcRecordExport/Assets/Game/…）：对话角色 Spine 样本 + 一套 CG Spine + 几张 BG（png / wav 平时不收，这里按名字点名收）
        SPINE_HEROES = ('h047', 'h076', 'h090')
        cg_ctrl_total = [0]
        for e in items:
            low = e.rel.lower()
            m = re.search(r'/game/hero/(h\d+)/(.+)$', low)
            if m and m.group(1) in SPINE_HEROES and e.size <= 8 * MB and e.rel not in want:
                rest = m.group(2)
                h = m.group(1)
                if (re.fullmatch(h + r'/' + h + r'\.(skel\.asset|atlas\.asset|png)', rest) or re.fullmatch(h + r'/(00_idle|91_emo_talk|90_emo1_normal)\.anim', rest)
                        or re.fullmatch(h + r'_dialog/' + h + r'_dialog\.fbx', rest) or rest == 'align_object/align_object.fbx'):
                    want[e.rel] = (e, 'full', 'unity:spine-sample')
            elif re.search(r'/game/cg/a0012_unused/', low) and e.size <= 8 * MB and e.rel not in want: want[e.rel] = (e, 'full', 'unity:cg-sample')
            elif re.search(r'/game/cg/(a0275|a0012)/', low) and e.size <= 12 * MB and not low.endswith('.meta') and e.rel not in want: want[e.rel] = (e, 'full', 'unity:cg-full')
            elif re.search(r'/game/cg/a027[34]/img/a027[34]\.png$', low) and e.size <= 4 * MB and e.rel not in want: want[e.rel] = (e, 'full', 'unity:cg-img')
            elif re.search(r'/game/cg/[^/]+/.+\.(controller|prefab)$', low) and e.size <= 1 * MB and cg_ctrl_total[0] + e.size <= 60 * MB and e.rel not in want: cg_ctrl_total[0] += e.size; want[e.rel] = (e, 'full', 'unity:cg-ctrl')
            elif re.search(r'/game/bg/(a0019_dialog\.png|bg_black\.(png|fbx))$', low) and e.rel not in want: want[e.rel] = (e, 'full', 'unity:bg-sample')
    # 剧情脚本在 bundle 里的游戏（Imys：content/bundles/scenarios/<类别>/<advId>.jp.encrypted，6614 个，分 combo / dress / event / favorite / quest / training 六个子目录，本地缓存里没有）：
    # 1.19 起每个子目录均匀抽 12 个 + 最大的 2 个（这些 bundle 只有 2~25KB）；textdefine 抽 4 个；raw/SCENARIO/<类别>/ 的 .acb（剧情语音）每个子目录抽 1 个最小的（≤2MB）看结构
    groups = {}
    for e in items:
        low = e.rel.lower()
        m = re.search(r'(^|/)bundles/scenarios/(?:([^/]+)/)?[^/]+\.encrypted$', low)
        if m and 512 <= e.size <= 4 * MB: groups.setdefault('sc:' + (m.group(2) or '(top)'), []).append(e)
        elif re.search(r'(^|/)bundles/textdefine/[^/]+\.encrypted$', low) and 1024 <= e.size <= 8 * MB: groups.setdefault('textdefine', []).append(e)
        else:
            m = re.search(r'(^|/)raw/scenario/([^/]+)/[^/]+\.acb$', low)
            if m and 1024 <= e.size <= 2 * MB: groups.setdefault('acb:' + m.group(2), []).append(e)
    for key, pool in groups.items():
        pool.sort(key=lambda x: x.rel)
        if key.startswith('acb:'): picked = sorted(pool, key=lambda x: x.size)[:1]
        elif key == 'textdefine': picked = pool[::max(1, len(pool) // 4)][:4]
        else: picked = pool[::max(1, len(pool) // 12)][:12] + sorted(pool, key=lambda x: -x.size)[:2]
        for e in picked:
            if e.rel not in want: want[e.rel] = (e, 'full', 'unity:bundle-script')
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

def bgi_named(items):
    """按图名（GAL_BGI_NAMES，默认 BGI_NAMES_RE）找：读每个 data*.arc 的 ARC20 索引，返回 [Entry]（至少有一个条目名命中的档案）。"""
    out = []
    for e in items:
        if not re.fullmatch(r'(?i)(.*/)?data\d+\.arc', e.rel): continue
        try:
            with open(e.path, 'rb') as f:
                head = f.read(16)
                if head[:12] != b'BURIKO ARC20': continue
                cnt = struct.unpack('<I', head[12:16])[0]
                if cnt <= 0 or cnt > 200000: continue
                idx = f.read(cnt * 0x80)
        except OSError: continue
        for i in range(cnt):
            name = idx[i * 0x80:i * 0x80 + 0x60].split(b'\0', 1)[0].decode('cp932', 'replace')
            if BGI_NAMES_RE.search(name): out.append(e); break
    return out

def bgi_named_pick(path, size):
    """返回 (命中的 [(名字, 偏移, 大小)], 目录清单文本)；索引读不了返回 None。"""
    with open(path, 'rb') as f:
        head = f.read(16)
        if head[:12] != b'BURIKO ARC20': return None
        cnt = struct.unpack('<I', head[12:16])[0]
        idx = f.read(cnt * 0x80); base = 16 + cnt * 0x80; hits = []; lines = ['name\toffset\tsize\n']
        for i in range(cnt):
            rec = idx[i * 0x80:(i + 1) * 0x80]
            name = rec[:0x60].split(b'\0', 1)[0].decode('cp932', 'replace')
            off, sz = struct.unpack('<II', rec[0x60:0x68])
            if BGI_NAMES_RE.search(name) and base + off + sz <= size and sz <= 12 * MB:
                hits.append((name, base + off, sz)); lines.append('%s\t%d\t%d\n' % (name, base + off, sz))
    return hits, ''.join(lines)

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

TOMOE_USED = {int(k): v for k, v in {"4": [1, 2], "0": [2, 65, 44, 100, 38, 9, 197, 195, 52, 196, 46, 227, 154, 83, 36, 42, 10, 43, 225, 37, 7, 67, 207, 41, 103, 45, 98, 155, 181, 107], "3": [520, 536, 548, 71, 513, 518, 97, 528, 533, 398, 450, 544, 21, 514, 519, 292, 305, 348, 408, 509, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 22, 24, 26, 27, 28], "1": [1, 6, 7, 8, 2, 3, 5, 4], "2": [0, 1, 2, 3, 4, 5, 6, 12, 20, 21, 22, 23, 24, 25, 13, 14, 15, 16, 18, 7, 8, 9, 10, 11, 19, 17]}.items()}   # 友恵の探偵物語：脚本里 $204（显示图片）引用最多的 Data 条目序号（按文件号），采集样本优先收这些

TOMOE_CGS = set(int(x) for x in (os.environ.get('GAL_TOMOE_CGS') or '2,5,8,43,65,99,178,179,189,190,225,229,673,677,680,684,695,696,697,698,699,700,701,702,704,705,707,724,773,775').split(',') if x.strip())   # 1.34：ch12 s11~s12 缺的图
TOMOE_THUMBS = os.environ.get('GAL_TOMOE_THUMBS', '1') != '0'   # 1.34：CG 画廊的 382×215 缩略图

def lzss_prefix(src, want):
    """Okumura LZSS（N=4096 F=18 阈值 2，环初值 0，写指针 4078，标志位 LSB 先）：只解开头 want 字节。"""
    ring = bytearray(4096); r = 4078; out = bytearray(); i = 0; flags = 0; n = len(src)
    while i < n and len(out) < want:
        flags >>= 1
        if not (flags & 0x100):
            flags = src[i] | 0xff00; i += 1
            if i >= n: break
        if flags & 1:
            c = src[i]; i += 1; out.append(c); ring[r] = c; r = (r + 1) & 4095
        else:
            if i + 1 >= n: break
            a = src[i]; b = src[i + 1]; i += 2
            pos = a | ((b & 0xf0) << 4); ln = (b & 0x0f) + 2
            for k in range(ln + 1):
                c = ring[(pos + k) & 4095]; out.append(c); ring[r] = c; r = (r + 1) & 4095
    return bytes(out)

def tomoe_meta(f, a, sz, off):
    """一个图条目 → 类型 / 宽 / 高 / 标志（位图 0x61：w@9 h@13 标志@17；JPEG 0x62：FF D8 FF 之后的 SOF；PNG 0x63：头 6 字节之后的 IHDR）。读不出来的字段 = -1。"""
    try:
        f.seek(off); raw = f.read(min(sz, 200000 if a else 80000))
        head = lzss_prefix(raw, 80000) if a else raw
        if not head: return ('empty', -1, -1, -1)
        t = head[0]
        if t == 0x61 and len(head) >= 21:
            return ('bmp', struct.unpack_from('<I', head, 9)[0], struct.unpack_from('<I', head, 13)[0], struct.unpack_from('<I', head, 17)[0])
        if t == 0x63 and len(head) >= 6 + 24 and head[6:14] == b'\x89PNG\r\n\x1a\n':
            return ('png', struct.unpack_from('>I', head, 6 + 16)[0], struct.unpack_from('>I', head, 6 + 20)[0], -1)
        if t == 0x62:
            at = head.find(b'\xff\xd8\xff')
            if at < 0: return ('jpg', -1, -1, -1)
            p = at + 2
            while p + 9 < len(head):
                if head[p] != 0xff: p += 1; continue
                mk = head[p + 1]
                if mk in (0xd8, 0x01) or 0xd0 <= mk <= 0xd7: p += 2; continue
                ln = struct.unpack_from('>H', head, p + 2)[0]
                if 0xc0 <= mk <= 0xcf and mk not in (0xc4, 0xc8, 0xcc): return ('jpg', struct.unpack_from('>H', head, p + 7)[0], struct.unpack_from('>H', head, p + 5)[0], mk)
                p += 2 + ln
            return ('jpg', -1, -1, -1)
        return ('0x%02x' % t, -1, -1, -1)
    except Exception as ex:
        return ('err', -1, -1, -1)

def tomoe_pick(path, size, rule):
    """友恵の探偵物語（tomoe.exe / ChakraCore）：
    chakra:resbig —— Resources/DataNNN.dat 太大，按 Resources/Data00.dat 的索引（u32 文件数；每个文件 3 张表，每表 u32 条数 + 条目 [u32 解压后大小, u32 压缩后大小, u32 偏移, u32 0]）
        挑条目（原样不解压）：脚本引用最多的先收，单个压缩后 <= 14MB，合计 <= 110MB（Data004 小，全收）。
    chakra:arc06 —— 一串 RIFF WAV，每个后面跟 'Tink' 标签：扫出 (偏移, RIFF 大小, 标签 64 字节) 清单 + 开头 12 个 + 均匀 12 个样本。"""
    base = os.path.basename(path)
    if rule == 'chakra:resbig':
        m = re.fullmatch(r'Data(\d+)\.dat', base, re.I)
        idxp = os.path.join(os.path.dirname(path), 'Data00.dat')
        if not m or not os.path.exists(idxp): return None
        fi = int(m.group(1)); d = open(idxp, 'rb').read(); pos = 4; lists = []
        for _ in range(78):
            n = struct.unpack_from('<I', d, pos)[0]; pos += 4
            lists.append([struct.unpack_from('<IIII', d, pos + 16 * i) for i in range(n)]); pos += 16 * n
        ents = lists[3 * fi]
        first = [k for k in TOMOE_USED.get(fi, []) if k < len(ents)]
        order = first + [k for k in range(len(ents)) if k not in set(first)]
        lines = ['k\tdecoded_size\tstored_size\toffset\n'] + ['%d\t%d\t%d\t%d\n' % (k, a, sz, off) for k, (a, sz, off, _b) in enumerate(ents)]
        total = 0; picks = []
        for k in order:
            a, sz, off, _b = ents[k]
            if sz > 14 * MB or off + sz > size or total + sz > 110 * MB: continue
            picks.append(('e%04d_a%d' % (k, a), off, sz)); total += sz
            if len(picks) >= 120: break
        return ''.join(lines), picks
    if rule == 'chakra:cgs':
        m = re.fullmatch(r'Data(\d+)\.dat', base, re.I)
        idxp = os.path.join(os.path.dirname(path), 'Data00.dat')
        if not m or not os.path.exists(idxp): return None
        fi = int(m.group(1)); d = open(idxp, 'rb').read(); pos = 4; lists = []
        for _ in range(78):
            n = struct.unpack_from('<I', d, pos)[0]; pos += 4
            lists.append([struct.unpack_from('<IIII', d, pos + 16 * i) for i in range(n)]); pos += 16 * n
        gbase = sum(len(lists[3 * j]) for j in range(fi)); ents = lists[3 * fi]
        lines = ['global_id\tk\tdecoded_size\tstored_size\toffset\ttype\tw\th\tflag\n']; picks = []; total = 0
        with open(path, 'rb') as f:
            for k, (a, sz, off, _b) in enumerate(ents):
                kind, w, h, fl = tomoe_meta(f, a, sz, off) if off + sz <= size else ('oob', -1, -1, -1)
                lines.append('%d\t%d\t%d\t%d\t%d\t%s\t%d\t%d\t%d\n' % (gbase + k, k, a, sz, off, kind, w, h, fl))
                if ((gbase + k) in TOMOE_CGS or (TOMOE_THUMBS and kind == 'bmp' and w == 382 and h == 215)) and off + sz <= size and total + sz <= 160 * MB: picks.append(('g%04d_e%04d_a%d' % (gbase + k, k, a), off, sz)); total += sz
        return ''.join(lines), picks
    if rule == 'chakra:arc06':
        lines = ['offset\triff_size\ttag64_hex\n']; riffs = []
        with open(path, 'rb') as f:
            carry = b''; base_off = 0
            while True:
                chunk = f.read(16 * MB)
                if not chunk: break
                buf = carry + chunk; start = 0
                while True:
                    i = buf.find(b'RIFF', start)
                    if i < 0 or i + 12 > len(buf): break
                    if buf[i + 8:i + 12] == b'WAVE': riffs.append((base_off + i, struct.unpack_from('<I', buf, i + 4)[0] + 8))
                    start = i + 4
                keep = min(len(buf), 16)
                carry = buf[-keep:]; base_off += len(buf) - keep
            for off, rs in riffs:
                f.seek(off + rs); lines.append('%d\t%d\t%s\n' % (off, rs, f.read(64).hex()))
            sel = riffs[:12] + riffs[::max(1, len(riffs) // 12)][:12]
            picks = []; seen = set(); total = 0
            for off, rs in sel:
                if off in seen or rs > 3 * MB or total + rs > 40 * MB: continue
                seen.add(off); total += rs; picks.append(('w%08d' % off, off, rs + 64))
        return ''.join(lines), picks
    return None

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

PF8_RULE = 'artemis:' + os.environ.get('GAL_PF8_MODE', 'named')
# 1.28：pf8 里按名字收（完整路径，正则，不分大小写，/ 分隔）：GAL_PF8_NAMES 可以改
PF8_NAMES = re.compile(os.environ.get('GAL_PF8_NAMES') or r'^image/(ev/(ev_com_m01/ev_com_m01_03_0102|ev_sat_m08/ev_sat_m08_11_0100|ev_kae_m01/ev_kae_m01_01_0003)\.ogv|sys/[^/]+\.png|sd/.+\.png|bg/(black|white|bg04a|zbg04a)\.png|fg/(kae_1|sat_1)\.psb)$', re.I)
PF8_NAMED_MAX = 200 * MB

def pf8_named(ents, size):
    out = []; total = 0
    for name, off, sz in ents:
        low = name.lower().replace('\\', '/')
        if sz <= 0 or off + sz > size or not PF8_NAMES.search(low) or total + sz > PF8_NAMED_MAX: continue
        out.append((name, off, sz)); total += sz
    return out

EMOTE_EXT = ('.psb', '.emtbytes', '.mtn', '.pimg')
EMOTE_SMALL = 300 * 1024; EMOTE_BIG = 40 * MB; EMOTE_TOTAL = 120 * MB

def pf8_emote(ents, size):
    """E-mote 相关：小的（<= 300KB）最多 40 个（看结构 / 动作），大的（<= 40MB，模型 + 内置贴图）按名字分散最多 4 个整份；总量 <= 120MB。"""
    small = []; big = []
    for name, off, sz in ents:
        low = name.lower().replace('\\', '/')
        if sz <= 0 or off + sz > size or not low.endswith(EMOTE_EXT): continue
        (small if sz <= EMOTE_SMALL else big if sz <= EMOTE_BIG else []).append((name, off, sz))
    small.sort(); big.sort()
    step = max(1, len(big) // 4)
    chosen = small[:40] + big[::step][:4]; out = []; total = 0
    for name, off, sz in chosen:
        if total + sz > EMOTE_TOTAL: continue
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

MHP_MODE = os.environ.get('GAL_MHP_MODE', 'named')
MHP_NAMES = re.compile(os.environ.get('GAL_MHP_NAMES') or r'^images/characters/(avt_00004c|cha_20134)/(animation|cg|standing)/', re.I)   # 1.30：Spine 待机骨架（.json + .atlas + 3 张贴图）+ 同一个角色的 CG / 立绘，核对 CG 是不是只有静图、骨架是哪个 Spine 版本

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
        if MHP_MODE == 'named':
            for i in files:
                if MHP_NAMES.search(i.filename) and 0 < i.file_size <= 16 * MB:
                    try: out.append((i.filename, zf.read(i)))
                    except Exception: pass
            return cat, out
        for i in spread_i(js, 12) + spread_i(other, 6):
            try: out.append((i.filename, zf.read(i)))
            except Exception: pass
    return cat, out


# TSK survey: classifications describe current player usage, not permission to delete.
TSK_PREFIX = 'twinkle star knights x_data/streamingassets/twinkle star knights x/'
TSK_SPRITES = {'recommend':'recommend','skill':'skill','loginbonus':'login-bonus','bg':'home-background',
    'worldraidevent':'world-raid','profile':'profile','trophy':'trophy','subtutorial':'sub-tutorial',
    'specialsite':'special-site','minigame':'mini-game','icon':'common-icon','theme':'theme','ui':'ui',
    'story':'story-ui','stamp':'stamp','campaign':'campaign','home':'home-ui','tutorial':'tutorial',
    'homeshade':'home-shade','mission':'mission','shop':'shop','equip':'equipment','item':'item',
    'startupnotification':'announcement','picturebook':'picturebook','eventquest':'event','gacha':'gacha-ui','banner':'banner'}

def tsk_kind(rel):
    low = rel.lower()
    if not low.startswith(TSK_PREFIX): return 'game-support', 'review', rel
    sub = rel[len(TSK_PREFIX):]; low = sub.lower()
    for prefix, category in [('adventure/backgrounds/','background'),('adventure/','scenario'),
        ('characters/','character'),('stills/','still'),('gachacharaanim/','gacha-animation'),
        ('sound/voice/','voice'),('sound/bgvoice/','bgvoice'),('sound/bgm/','bgm'),
        ('sound/bgse/','se'),('sound/se/','se')]:
        if low.startswith(prefix): return category, 'playback-keep', sub
    if low.startswith('sprites/chara/'):
        if re.search(r'/enemy_[^/]+$', low): return 'enemy-icon', 'ui-candidate', sub
        m = re.match(r'sprites/chara/thumb_(00[1-9])/', low)
        category = 'character-thumb-' + m.group(1) if m else 'character-icon'
        return category, 'gallery-card-keep' if m and m.group(1) in ('005','006') else 'ui-candidate', sub
    if low.startswith('sprites/'):
        category = TSK_SPRITES.get(low.split('/')[1], 'other')
        if category == 'banner' and re.search(r'/m_event_', low): category = 'event'
        if category == 'banner' and re.search(r'/m_gacha_', low): category = 'gacha-ui'
        return category, 'gallery-cover-optional' if category == 'picturebook' else 'review' if category in ('event','home-background','world-raid','other') else 'ui-candidate', sub
    return 'other', 'review', sub

def tsk_audit_picks(items):
    # A metadata-only sentinel enables the existing archive/report path.
    # Its file bytes are never read or packaged.
    return items[:1]

def tsk_reports(items):
    counts = collections.defaultdict(lambda: [0,0,0]); now = time.time()
    rows = ['rel\tcategory\tusage\tsize\tmtime\tmodified_last_12h\tpng_width\tpng_height\n']
    recent = [rows[0]]
    for e in items:
        cat, usage, _sub = tsk_kind(e.rel); is_recent = 0 <= now - e.mtime < 12 * 3600
        counts[(cat,usage)][0] += 1; counts[(cat,usage)][1] += e.size; counts[(cat,usage)][2] += int(is_recent)
        w = h = ''
        if e.rel.lower().endswith('.png'):
            try:
                with open(e.path,'rb') as f: head = f.read(24)
                if len(head) == 24 and head[:8] == b'\x89PNG\r\n\x1a\n': w,h = struct.unpack('>II',head[16:24])
            except OSError: pass
        line = '%s\t%s\t%s\t%d\t%d\t%d\t%s\t%s\n' % (e.rel,cat,usage,e.size,e.mtime,is_recent,w,h)
        rows.append(line)
        if is_recent: recent.append(line)
    summary = ['category\tusage\tfiles\tbytes\tmodified_last_12h\n']
    for (cat,use), (n,b,r) in sorted(counts.items()): summary.append('%s\t%s\t%d\t%d\t%d\n' % (cat,use,n,b,r))
    notes = ('TSK resource audit v1.36\nMetadata only; no game file payloads packaged or moved/deleted.\n'
        'modified_last_12h uses mtime, not birth/creation time. It is evidence of recent writes, not downloader attribution.\n'
        'playback-keep: script/character/CG/background/audio resources supported by player; not proof every file is referenced.\n'
        'gallery-card-keep: Thumb_005 primary / Thumb_006 fallback used by current gal-layout.\n'
        'gallery-cover-optional: PictureBook used by gallery cover.\n'
        'ui-candidate: optional skip candidates for story-only use, not verified unused files.\n'
        'review: event/home/Raid assets need script reference and sample verification.\n'
        'Only path, size, mtime, classifications and PNG header dimensions; no JSON/images/spines/audio payloads.\n')
    return {'__tsk_inventory.tsv': ''.join(rows), '__tsk_recent12h.tsv': ''.join(recent), '__tsk_categories.tsv': ''.join(summary), '__tsk_audit.txt': notes}

def requested_diagnostic_picks(items, is_tsk):
    picks = []
    total = 0
    samples = collections.Counter()
    for e in sorted(items, key=lambda e: (e.size, e.rel)):
        low = e.rel.lower()
        if is_tsk:
            # Accept the reported UI name as well as the on-disk ch_1038004 family.
            wanted = '1038004' in low and low.endswith(('.png', '.atlas.txt', '.skel.bytes', '.json', '.asset', '.bytes'))
            rule = 'tsk:ch10380048'
        else:
            wanted = (low == 'package.json' or low in ('www/index.html', 'www/js/main.js', 'www/js/plugins.js')
                or (low.startswith('www/data/') and low.endswith('.json'))
                or (low.startswith('www/js/') and low.endswith('.js') and '/libs/' not in low)
                or (low.startswith('www/text/') and low.endswith('.txt')))
            parent = low.rsplit('/', 1)[0]
            if not wanted and parent in ('www/img/pictures', 'www/img/parallaxes', 'www/img/characters', 'www/img/faces', 'www/img/system', 'www/audio/bgm', 'www/audio/voice'):
                if low.endswith(('.rpgmvp', '.rpgmvo', '.png', '.ogg')) and 0 < e.size <= 2 * MB and samples[parent] < 2:
                    wanted = True; samples[parent] += 1
            rule = 'rj01482469:core'
        if wanted:
            if e.size > 32 * MB or total + e.size > 128 * MB:
                say('  ! diagnostic size cap, not collected: %s (%d bytes)' % (e.rel, e.size)); continue
            picks.append((e, 'full', rule)); total += e.size
    say('  diagnostic payload: %d files, %.2f MB; library is read-only' % (len(picks), total / MB))
    return picks

def new_rpgmaker_picks(items):
    picks, omitted = [], []
    data_bytes = script_bytes = 0
    # Payload is only structured game data and inspectable source/configuration.
    # Large media and executable/runtime libraries stay in the NAS library.
    for e in sorted(items, key=lambda e: e.rel.lower()):
        low = e.rel.lower().replace('\\', '/')
        if re.search(r'(^|/)(save|savedata|userdata|backup)(/|$)', low): continue
        data = bool(re.search(r'(^|/)data/[^/]+\.json$', low))
        script = bool(re.search(r'(^|/)js/(?:plugins(?:/[^/]+)?|rpg_[^/]+|rmmz_[^/]+|main)\.js$', low))
        config = bool(re.search(r'(^|/)(package\.json|index\.html|game\.ini|rpg_rt\.ini)$', low) or low.endswith(('.rpgproject', '.rmmzproject')))
        if not (data or script or config): continue
        max_file = 16 * MB if data else 4 * MB
        used, cap = (data_bytes, 64 * MB) if data else (script_bytes, 16 * MB)
        if e.size > max_file or used + e.size > cap:
            omitted.append({'path': e.rel, 'bytes': e.size, 'reason': 'per-file or per-game data/source size cap'})
            say('  ! 超过采集上限，仅列目录：%s (%d bytes)' % (e.rel, e.size)); continue
        picks.append((e, 'full', 'rpgmaker:new-rj'))
        if data: data_bytes += e.size
        else: script_bytes += e.size
    roots = sorted(e.rel for e in items if re.search(r'(^|/)data/System\.json$', e.rel, re.I))
    counts = collections.Counter(os.path.splitext(e.rel)[1].lower() or '(no extension)' for e in items)
    audit = {'mode': 'rpgmaker:new-rj', 'systemFiles': roots, 'totalFiles': len(items), 'extensionCounts': dict(counts), 'selectedFiles': len(picks), 'dataBytes': data_bytes, 'sourceConfigBytes': script_bytes, 'omitted': omitted,
             'notes': ['Source directory is read-only. No game JavaScript executed.', 'No images, audio, videos, EXE/DLL/runtime libraries or save payloads.', 'Full relative file/size/mtime inventory is in __listing.tsv; size exclusions are explicit.', 'No MV/MZ System.json means another RPG Maker generation or a packed layout may require a later targeted collection.']}
    if not picks and items: picks = [(items[0], 'inventory', 'rpgmaker:new-rj')]
    say('新RJ采集: %d 个数据/源码/配置文件，%.2fMB，省略%d；不收媒体和运行时' % (audit['selectedFiles'], (data_bytes + script_bytes) / MB, len(omitted)))
    return picks, audit

RPG_MEDIA_SAMPLES = {'RJ01282923': {'map': 'data/Map001.json', 'files': ['img/pictures/Ero_Event/Event02/51_手足陰毛有.png', 'img/pictures/Ero_Event/Left_wipe back.png', 'audio/se/ero_voice/orgasm_yuruoho_01.ogg', 'audio/se/ero_voice/general_ero_02.ogg', 'audio/bgs/ero/粘液系04.ogg', 'img/tilesets/Inside_A5.png', 'img/characters/01_主人公.png']}, 'RJ01402662': {'map': 'data/Map001.json', 'files': ['img/pictures/10_Ero_Scene/CG01/50_Scene_01_01.png', 'img/pictures/10_Ero_Scene/CG01/51_clothes.png', 'audio/se/actor_EroScene_Voice/E01_01.ogg', 'audio/se/actor_EroScene_Voice/E01_02.ogg', 'audio/bgs/Ero_Scene_Loop/eroEve_cat_loop_01.ogg', 'img/tilesets/World_A2.png']}, 'RJ01220265': {'map': 'data/Map001.json', 'files': ['img/pictures/フィオ通常催眠.rpgmvp', 'img/pictures/エリーゼ通常催眠.rpgmvp', 'audio/voice/1080.rpgmvo', 'audio/voice/1082.rpgmvo', 'audio/bgm/01_催眠エッチ.rpgmvo', 'audio/bgs/メリダ喘ぎ.rpgmvo', 'img/tilesets/World_A1.rpgmvp', 'img/tilesets/World_A2.rpgmvp', 'img/tilesets/World_B.rpgmvp', 'img/tilesets/World_C.rpgmvp', 'img/characters/Actor_original_man.rpgmvp']}}

def packed_rpg_payload(entry, pe_head, selection=None):
    """Bounded EVB VFS inspection; never execute PE or load extractor packages.
    Format reference: mos9527/evbunpack (Apache-2.0), const.py and pe_external_tree.
    This reads table metadata and copies selected stored blocks without decompressing.
    """
    result = {'source': entry.rel, 'sourceBytes': entry.size, 'files': [], 'selected': [], 'omitted': [], 'fileTableComplete': False}
    payloads = []
    requested = {p.casefold() for p in selection} if selection is not None else None
    before = os.stat(entry.path)
    with open(entry.path, 'rb') as f:
        try:
            if pe_head[:2] != b'MZ': raise ValueError('not a PE executable')
            pe = struct.unpack_from('<I', pe_head, 60)[0]
            if pe_head[pe:pe+4] != b'PE\0\0': raise ValueError('invalid PE header')
            number = struct.unpack_from('<H', pe_head, pe+6)[0]
            optional = struct.unpack_from('<H', pe_head, pe+20)[0]
            sections = {}
            for i in range(min(number, 128)):
                at = pe+24+optional+i*40
                if at+40 > len(pe_head): raise ValueError('section table outside collected header')
                name = pe_head[at:at+8].rstrip(b'\0').decode('ascii', 'replace')
                size, offset = struct.unpack_from('<II', pe_head, at+16)
                if offset+size > entry.size: raise ValueError('section exceeds executable')
                sections[name] = (offset, size)
            result['sections'] = {k: {'offset': v[0], 'bytes': v[1]} for k,v in sections.items() if k.startswith('.enigma')}
            if '.enigma1' not in sections: raise ValueError('no .enigma1 section')
            start, size = sections['.enigma1']
            for name in ('.enigma1', '.enigma2'):
                if name in sections:
                    off, length = sections[name]; f.seek(off)
                    if selection is None: payloads.append((name.lstrip('.')+'.head.bin', f.read(min(length, MB if name == '.enigma1' else 128*1024))))
            # Find the filesystem marker within the first 16MB of the resource
            # section, never scan or upload the whole multi-GB executable.
            magic = -1; scanned = 0; overlap = b''
            f.seek(start)
            while scanned < min(size, 16*MB):
                chunk = f.read(min(MB, min(size, 16*MB)-scanned))
                if not chunk: break
                hit = (overlap+chunk).find(b'EVB\0')
                if hit >= 0: magic = start+scanned-len(overlap)+hit; break
                scanned += len(chunk); overlap = chunk[-3:]
            if magic < 0: raise ValueError('EVB filesystem marker not found in bounded section scan')
            result['magicOffset'] = magic
            f.seek(magic+64); main = f.read(16)
            if len(main) != 16: raise ValueError('truncated root node')
            length, count = struct.unpack_from('<I', main)[0], struct.unpack_from('<I', main, 12)[0]
            end = magic+68+length
            if length < 12 or end > start+size or end-(magic+79) > 16*MB or count > 200000: raise ValueError('unsupported or oversized VFS table')
            f.seek(magic); table = f.read(end-magic)
            if len(table) != end-magic: raise ValueError('truncated VFS table')
            if selection is None: payloads.append(('vfs-table.bin', table))
            cursor = io.BytesIO(table); cursor.seek(79)
            data_offset = end; nodes = 0
            def take(n):
                b = cursor.read(n)
                if len(b) != n: raise ValueError('truncated filesystem node')
                return b
            def walk(parent, depth):
                nonlocal data_offset, nodes
                nodes += 1
                if nodes > 200000 or depth > 64: raise ValueError('VFS node/depth limit exceeded')
                header = take(16); children = struct.unpack_from('<I', header, 12)[0]
                name = bytearray()
                for _ in range(2048):
                    pair = take(2)
                    if pair == b'\0\0': break
                    name.extend(pair)
                else: raise ValueError('VFS filename length exceeded')
                name = name.decode('utf-16-le'); kind = take(1)[0]
                if not name or name in ('.','..') or any(c in name for c in '/\\:\0'): raise ValueError('invalid VFS node name')
                rel = parent+'/'+name if parent else name
                if kind == 3:
                    take(25)
                    if children > 200000: raise ValueError('VFS child count limit exceeded')
                    for _ in range(children): walk(rel, depth+1)
                elif kind == 2:
                    record = take(53)
                    original, stored = struct.unpack_from('<I', record, 2)[0], struct.unpack_from('<I', record, 49)[0]
                    if data_offset+stored > start+size: raise ValueError('VFS content exceeds resource section')
                    result['files'].append({'path': rel, 'offset': data_offset, 'originalBytes': original, 'storedBytes': stored, 'compressed': stored != original})
                    data_offset += stored
                else: raise ValueError('unsupported VFS node type %d (may require legacy layout)' % kind)
            for _ in range(count): walk('', 0)
            if not result['files']: raise ValueError('empty VFS file table')
            result['fileTableComplete'] = True
            selected_bytes = 0
            for item in result['files']:
                low = item['path'].lower()
                wanted = bool(re.search(r'(^|/)data/[^/]+\.json$', low) or re.search(r'(^|/)js/(?:plugins(?:/[^/]+)?|rpg_[^/]+|rmmz_[^/]+|main)\.js$', low) or re.search(r'(^|/)(package\.json|index\.html)$', low))
                if requested is not None:
                    logical = re.sub(r'^%[^/]+%/', '', item['path'])
                    if logical.lower().startswith('www/'): logical = logical[4:]
                    wanted = logical.casefold() in requested
                if not wanted or re.search(r'(^|/)(save|savedata|userdata|backup)(/|$)', low): continue
                if max(item['originalBytes'], item['storedBytes']) > 16*MB or selected_bytes+item['storedBytes'] > 64*MB:
                    result['omitted'].append({**item, 'reason': 'selected file/total size cap'}); continue
                f.seek(item['offset']); data = f.read(item['storedBytes'])
                if len(data) != item['storedBytes']: raise ValueError('truncated selected resource')
                name = 'stored/'+hashlib.sha256(item['path'].encode('utf-8')).hexdigest()[:24]+'.bin'
                payloads.append((name, data)); selected_bytes += len(data)
                result['selected'].append({**item, 'payload': name, 'sha256': hashlib.sha256(data).hexdigest()})
            result['status'] = 'indexed'; result['selectedBytes'] = selected_bytes
            if selection is not None:
                selected_paths = set()
                for item in result['selected']:
                    logical = re.sub(r'^%[^/]+%/', '', item['path'])
                    if logical.lower().startswith('www/'): logical = logical[4:]
                    selected_paths.add(logical.casefold())
                result['missingRequested'] = [p for p in selection if p.casefold() not in selected_paths]
                say('EVB媒体样本: 选中%d/%d个指定资源块，%.2fMB；缺失或超限: %s' % (len(result['selected']), len(selection), selected_bytes/MB, result['missingRequested']))
            else: say('EVB索引: %d文件；选中%d个事件/插件/配置块，%.2fMB；压缩块保持原样，媒体不采' % (len(result['files']), len(result['selected']), selected_bytes/MB))
        except (ValueError, OSError, UnicodeError, struct.error) as error:
            result['status'] = 'needs-format-analysis'; result['error'] = str(error)
            say('EVB索引暂未解析：%s；保留有界段头/表样本，不采完整EXE' % error)
    after = os.stat(entry.path)
    if (before.st_size,before.st_mtime_ns) != (after.st_size,after.st_mtime_ns): raise RuntimeError('EXE在采集期间变化，请重试')
    payloads.append(('vfs-index.json', json.dumps(result, ensure_ascii=False, indent=2).encode('utf-8')))
    return payloads

def latest_download_logs():
    game = os.path.join(root, 'gal-download')
    runs = os.path.join(game, 'runs')
    if not os.path.isdir(runs): raise RuntimeError('gal/gal-download 必须指向包含 runs/ 的缓存目录；不会扫描 bundles')
    requested = env.get('GAL_COLLECT_TSK_LOG', '').strip() or '1'
    if not re.fullmatch(r'[0-9]+', requested) or int(requested) < 1:
        raise RuntimeError('GAL_COLLECT_TSK_LOG 必须是正整数N（最近N次TSK运行），空值按1次')
    count = int(requested)
    candidates = []
    for entry in os.scandir(runs):
        if not entry.is_dir(): continue
        if 'GAL_COLLECT_TSK_LOG' in env:
            is_tsk = False
            try:
                with open(os.path.join(entry.path, 'progress.json'), encoding='utf-8') as f: progress = json.load(f)
                is_tsk = bool(re.match(r'^tsk(?:$|[-_])', str(progress.get('taskId', '')), re.I))
            except (ValueError, OSError, AttributeError): pass
            if not is_tsk:
                try:
                    with open(os.path.join(entry.path, 'result.json'), 'rb') as f: header = f.read(65536).decode('utf-8', 'replace')
                    match = re.search(r'"root"\s*:\s*("(?:[^"\\]|\\.)*")', header)
                    is_tsk = bool(match and re.search(r'(?:^|[/\\])Twinkle Star Knights X(?:[/\\]|$)', json.loads(match.group(1)), re.I))
                except (ValueError, OSError, TypeError): pass
            if not is_tsk: continue
        reports = [p for p in os.scandir(entry.path) if p.is_file() and p.name.endswith(('.json', '.log', '.txt', '.jsonl'))]
        if reports: candidates.append((max(p.stat().st_mtime for p in reports), entry.path, reports))
    if not candidates: raise RuntimeError('gal-download/runs 下没有运行日志')
    selected = sorted(candidates, key=lambda x: (x[0], x[1]), reverse=True)[:count]
    say('采集最近 %d 次运行（请求 %d 次，符合条件共 %d 次）；不采 bundles/APK/repair-backups；源目录只读' % (len(selected), count, len(candidates)))
    for _mtime, latest, _reports in selected: say('  选中运行: ' + latest)
    selected_names = {os.path.basename(latest) for _mtime, latest, _reports in selected}
    reports = [p for _mtime, _latest, files in selected for p in files]
    paths = {p.path for p in reports}
    plans = os.path.join(game, 'plans')
    if os.path.isdir(plans):
        for task in os.scandir(plans):
            if not task.is_dir(): continue
            current = os.path.join(task.path, 'current.json')
            try:
                with open(current, encoding='utf-8') as f: pointer = json.load(f)
                if os.path.basename(str(pointer.get('runDir', '')).rstrip('/')) not in selected_names: continue
                paths.add(current)
                plan = os.path.join(task.path, 'plan.json')
                if os.path.isfile(plan): paths.add(plan)
            except (ValueError, OSError, AttributeError, TypeError): pass
    for p in reports:
        if p.name != 'result.json': continue
        try:
            with open(p.path, encoding='utf-8') as f: data = json.load(f)
            for row in data.get('results', []):
                # Container absolute paths differ from the NAS mount. Map plans/ only.
                plan = row.get('plan', '')
                if not isinstance(plan, str) or '/plans/' not in plan: continue
                candidate = os.path.join(game, 'plans', plan.split('/plans/', 1)[1])
                if os.path.isfile(candidate) and os.path.commonpath([os.path.realpath(game), os.path.realpath(candidate)]) == os.path.realpath(game): paths.add(candidate)
        except (ValueError, OSError, AttributeError, TypeError): pass
    items = []
    summaries = os.path.join(out, 'download-log-summaries')
    os.makedirs(summaries, exist_ok=True)
    def compact(value):
        if isinstance(value, dict): return {k: compact(v) for k, v in value.items()}
        if isinstance(value, list):
            if len(value) <= 40: return [compact(v) for v in value]
            statuses = collections.Counter(str(v.get('status', '(none)')) for v in value if isinstance(v, dict))
            return {'totalItems': len(value), 'statusCounts': dict(statuses), 'sample': [compact(v) for v in value[:20]], 'sampleOnly': True}
        return value
    for filename in sorted(paths):
        st = os.stat(filename)
        rel = os.path.relpath(filename, game)
        is_plan = rel.startswith('plans' + os.sep) and os.path.basename(filename) == 'plan.json'
        if is_plan or st.st_size > 8 * MB:
            summary = {'source': rel, 'sourceBytes': st.st_size, 'sourceMtime': int(st.st_mtime), 'originalUnchanged': True}
            if is_plan:
                # Download/missing/cache/repair counts are recorded in result.json and
                # repairs.json. Do not load hundreds of MB of catalog data for them.
                summary.update({'omitted': 'Full plan excluded; use each collected run result categoryTotals/categorySummary and repairs.json. A shared saved plan may have changed after older runs; it is not a historical or live directory comparison.'})
            elif filename.endswith('.json'):
                try:
                    with open(filename, encoding='utf-8') as f: summary['data'] = compact(json.load(f))
                except (ValueError, OSError) as error: summary['readError'] = str(error)
            else:
                with open(filename, 'rb') as f:
                    f.seek(max(0, st.st_size - MB)); summary['tail'] = f.read(MB).decode('utf-8', 'replace')
                summary['tailOnly'] = True
            name = hashlib.sha256(rel.encode()).hexdigest()[:12] + '-' + os.path.basename(filename) + '.summary.json'
            filename = os.path.join(summaries, name)
            with open(filename, 'w', encoding='utf-8') as f: json.dump(summary, f, ensure_ascii=False, indent=2)
            say('  摘要代替完整文件: %s (%d bytes)；源文件保留' % (rel, st.st_size))
            rel = '__diagnostics/' + name
            st = os.stat(filename)
        e = Entry(); e.path = filename; e.rel = rel; e.size = st.st_size; e.mtime = int(st.st_mtime)
        items.append(e)
    if sum(e.size for e in items) > 128 * MB: raise RuntimeError('本轮日志超过128MB，未采集其他数据')
    return game, items

NEW_GAME_PATTERNS = [
 ('シロクロv1.1', r'シロクロ(?:\s*v?1\.1)?'),
 ('ツヴァイトリガー', r'ツヴァイトリガー(?:\s+v?[0-9.]+)?'),
 ('AI', r'AI(?:\s+v?[0-9.]+)?'),
 ('夜勤病棟リメイク', r'夜勤病棟\s*リメイク(?:\s+v?[0-9.]+)?'),
 ('How to Build a Magnificent Kingdom v1.05', r'How\s+to\s+Build\s+a\s+Magnificent\s+Kingdom(?:\s+v?1\.05)?'),
]
def new_game_label(name):
    import unicodedata
    name = unicodedata.normalize('NFKC', name).strip()
    name = re.sub(r'^(?:\[[^\]]+\]\s*)+', '', name)
    return next((label for label, pattern in NEW_GAME_PATTERNS if re.fullmatch(pattern, name, re.I)), None)

def new_game_probe_files(items):
    """Yield bounded evidence bytes; never execute code or copy full archives/EXEs."""
    report = {'sourceReadOnly': True, 'partialBinaries': True, 'files': [], 'omitted': [], 'engines': engines_of(items)}
    total = 0; binaries = 0; texts = 0
    for e in sorted(items, key=lambda e: (not bool(re.search(r'(^|/)(system\.json|plugins\.js|package\.json)$',e.rel,re.I)),e.rel.casefold())):
        rel=e.rel.replace('\\','/'); low=rel.lower(); base=low.rsplit('/',1)[-1]
        if re.search(r'(^|/)(save|savedata|userdata|backup|node_modules)(/|$)|(^|/)(save[^/]*\.(dat|bak|sav)|unins[^/]*|setup[^/]*|config\.exe)$',low): continue
        small = bool(re.search(r'(^|/)(system\.json|plugins\.js|package\.json|systeminfo\.json|fileinfo\.xml|bg[i]\.gdb|readme[^/]*\.txt|[^/]*\.(ini|cfg|cf))$',low))
        binary = bool(re.search(r'\.(xp3|arc|pfs|xfl|agf|alf|dat|bin|pak|pack|dsm|mhp)$',low)) or low.endswith('.exe') and rel.count('/')<=1
        core = bool(re.search(r'(^|/)(rmmz_core|rpg_core|tyrano)\.js$',low))
        if not (small or binary or core): continue
        if binary and binaries>=24 or not binary and texts>=24:
            report['omitted'].append({'path':rel,'reason':'sample count limit'});continue
        limit=128*1024
        if small and e.size<=512*1024:
            with open(e.path,'rb') as f: parts=[(rel,f.read(512*1024+1),0)]
        else:
            with open(e.path,'rb') as f:
                head=f.read(limit); offset=max(len(head),e.size-limit); f.seek(offset);tail=f.read(limit)
            parts=[('__engine_probe/files/'+rel+'.head.bin',head,0)]
            if tail: parts.append(('__engine_probe/files/'+rel+'.tail.bin',tail,offset))
        size=sum(len(data) for _name,data,_off in parts)
        if total+size>8*MB:
            report['omitted'].append({'path':rel,'reason':'8MB game evidence limit'});continue
        binaries+=int(binary);texts+=int(not binary);total+=size
        report['files'].append({'path':rel,'sourceBytes':e.size,'parts':[{'name':name,'offset':offset,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data,offset in parts]})
        for name,data,_offset in parts: yield name,data,e.mtime
    report['sampleBytes']=total
    yield '__engine_probe/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode('utf-8'),int(time.time())

def new_game_detail_files(items, label):
    """Focused second pass. Bytes stay raw; no game/EXE/DLL is executed."""
    lookup={e.rel.replace('\\','/').casefold():e for e in items}
    payload=[]; used=0
    report={'game':label,'sourceReadOnly':True,'files':[],'omitted':[],'notes':[],'maxBytes':16*MB}
    def part(rel,offset,length,target=None):
        nonlocal used
        e=lookup.get(rel.casefold())
        if not e:
            report['omitted'].append({'path':rel,'reason':'not found'});return None
        if offset<0 or offset>e.size: raise RuntimeError('Invalid evidence offset '+rel)
        length=min(length,e.size-offset)
        if length>12*MB or used+length>16*MB:
            report['omitted'].append({'path':rel,'reason':'explicit byte limit','requestedBytes':length});return None
        with open(e.path,'rb') as f:f.seek(offset);data=f.read(length)
        if len(data)!=length:raise RuntimeError('Source changed or truncated '+rel)
        name=target or e.rel
        payload.append((name,data,e.mtime));used+=length
        report['files'].append({'path':e.rel,'artifact':name,'offset':offset,'sourceBytes':e.size,'bytes':length,'sha256':hashlib.sha256(data).hexdigest()})
        return data
    def whole(rel,limit=2*MB):
        e=lookup.get(rel.casefold())
        if e and e.size<=limit:return part(rel,0,e.size)
        report['omitted'].append({'path':rel,'reason':'missing or exceeds full-file limit','limit':limit})
    def ends(rel,n=256*1024):
        e=lookup.get(rel.casefold())
        if not e:return
        part(rel,0,min(e.size,n),'__followup/files/'+e.rel+'.head.bin')
        off=max(n,e.size-n)
        if off<e.size:part(rel,off,n,'__followup/files/'+e.rel+'.tail.bin')
    def arcfam_table(rel):
        e=lookup.get(rel.casefold())
        if not e:return
        with open(e.path,'rb') as f:head=f.read(4)
        n=struct.unpack('<I',head)[0] if len(head)==4 else 0
        if 4<=n<=2*MB and n+4<=e.size:part(rel,0,n+4,'__followup/index/'+e.rel+'.table.bin')
        else:report['omitted'].append({'path':rel,'reason':'unrecognized arcfam table header','tableBytes':n})
    def xp3(rel, samples=False):
        nonlocal used
        e=lookup.get(rel.casefold())
        if not e:return
        entries=[];prefix='__followup/xp3/'+os.path.basename(e.rel)
        with open(e.path,'rb') as f:
            if f.read(11)!=b'XP3\r\n \n\x1a\x8b\x67\x01':return
            ptr=11
            for block in range(8):
                if ptr+8>e.size:raise RuntimeError('XP3 pointer outside file')
                f.seek(ptr);at=struct.unpack('<Q',f.read(8))[0]
                if at+9>e.size:raise RuntimeError('XP3 index outside file')
                f.seek(at);flag=f.read(1)[0]
                if flag&7==0:stored=orig=struct.unpack('<Q',f.read(8))[0];head=9
                elif flag&7==1:stored,orig=struct.unpack('<QQ',f.read(16));head=17
                else:report['notes'].append(rel+': unsupported XP3 index codec');break
                if stored>2*MB or orig>8*MB or at+head+stored>e.size:raise RuntimeError('XP3 index exceeds bounds')
                raw=part(rel,at,head+stored,prefix+'/index-%d.bin'%block)
                if raw is None:break
                blob=raw[head:]
                if flag&7==1:
                    z=zlib.decompressobj();decoded=z.decompress(blob,8*MB+1)
                    if len(decoded)>8*MB or not z.eof:raise RuntimeError('XP3 index inflate exceeds bounds')
                else:decoded=blob
                q=0
                while q+12<=len(decoded):
                    tag=decoded[q:q+4];ln=struct.unpack_from('<Q',decoded,q+4)[0];body=decoded[q+12:q+12+ln];q+=12+ln
                    if tag==b'Hxv4' and len(body)==14:
                        off,sz,kind=struct.unpack('<QIH',body)
                        if sz<=2*MB:part(rel,off,sz,prefix+'/hxv4-%d.bin'%block)
                        report['notes'].append({'archive':rel,'hxv4':True,'kind':kind,'offset':off,'stored':sz})
                    if tag!=b'File':continue
                    sub=0;entry={'segments':[]}
                    while sub+12<=len(body):
                        key=body[sub:sub+4];size=struct.unpack_from('<Q',body,sub+4)[0];value=body[sub+12:sub+12+size];sub+=12+size
                        if key==b'info' and len(value)>=22:
                            entry.update(name=value[22:].decode('utf-16le','replace').rstrip('\0'),flags=struct.unpack_from('<I',value)[0],size=struct.unpack_from('<Q',value,4)[0])
                        if key==b'segm' and len(value)%28==0:entry['segments']=[struct.unpack_from('<IQQQ',value,k) for k in range(0,len(value),28)]
                        if key==b'adlr' and len(value)>=4:entry['adler']=struct.unpack_from('<I',value)[0]
                    if entry.get('name'):entries.append(entry)
                if not flag&128:break
                ptr=at+head+stored
        if samples:
            selected=[(i,x) for i,x in enumerate(entries) if re.search(r'\.(tjs|ini|txt\.scn|ks|scn)$',x['name'],re.I) and x.get('size',0)<=256*1024]
            selected=selected[:6]+selected[6:][::max(1,len(selected[6:])//10)][:10]
            if not selected:selected=[(i,x) for i,x in enumerate(entries) if x.get('flags') and 32<x.get('size',0)<=64*1024][:6]
            for i,x in selected:
                for k,(_flag,off,original,stored) in enumerate(x['segments']):
                    if stored<=256*1024:part(rel,off,stored,prefix+'/entries/%06d-%d.bin'%(i,k))
        data=json.dumps({'archive':rel,'entries':entries,'note':'Raw stored bytes only; protected flag retained; no decryption or game execution.'},ensure_ascii=False,indent=2).encode('utf-8')
        if len(data)<=2*MB and used+len(data)<=16*MB:payload.append((prefix+'/entries.json',data,int(time.time())));used+=len(data)
        else:report['omitted'].append({'path':rel,'reason':'entry summary exceeds metadata limit; raw index retained'})
    if label=='AI':
        for e in items:
            if e.rel.lower().endswith('.sx'):whole(e.rel,128*1024)
            elif e.rel.lower().endswith('.sxstorage'):ends(e.rel)
        whole('aiduma.exe',MB);whole('sakanagl.dll',4*MB)
    elif label.startswith('How to Build'):
        whole('data/strlist.txt',256*1024)
        scripts=sorted(e.rel for e in items if re.match(r'^data/(?:AdditionalScript|Script)/[^/]+\.txt$',e.rel,re.I))
        chosen=scripts[:5]+scripts[5:][::max(1,len(scripts[5:])//16)][:16]
        for name in dict.fromkeys(chosen):whole(name,512*1024)
        for name in ['Pac/Game.pac','Pac/Bgm.pac','Pac/Se.pac','Pac/Voice.pac']:ends(name)
    elif label.startswith('シロクロ'):
        for name in ['SHIROKURO_Data/app.info','SHIROKURO_Data/boot.config','SHIROKURO_Data/ScriptingAssemblies.json','SHIROKURO_Data/RuntimeInitializeOnLoads.json','SHIROKURO_Data/globalgamemanagers','SHIROKURO_Data/globalgamemanagers.assets','SHIROKURO_Data/resources.assets']:whole(name,MB)
        whole('SHIROKURO_Data/il2cpp_data/Metadata/global-metadata.dat',12*MB)
        ends('SHIROKURO_Data/sharedassets0.assets',128*1024)
        for e in items:
            if not re.match(r'^Archives/base_div[01]_archive\.arc$',e.rel,re.I):continue
            with open(e.path,'rb') as f:
                h=f.read(256);at=h.find(b'UnityFS\0');q=at+12
                if at<0:continue
                try:
                    for _ in range(2):q=h.index(0,q)+1
                    size=struct.unpack_from('>Q',h,q)[0]
                except (ValueError,struct.error):continue
                if size<=MB:part(e.rel,at,size,'__followup/unity/'+os.path.basename(e.rel)+'.first.bundle')
                f.seek(e.size-8);offset=struct.unpack('<Q',f.read(8))[0]
            if 0<=offset<e.size-8 and e.size-8-offset<=2*MB:part(e.rel,offset,e.size-offset,'__followup/unity/'+os.path.basename(e.rel)+'.index.bin')
            else:report['notes'].append(e.rel+': trailing index offset not recognized')
    elif label=='ツヴァイトリガー':
        original=next((e.rel for e in items if os.path.basename(e.rel)=='ツヴァイトリガー.exe'),None) or next((e.rel for e in items if e.rel=='ツヴァイトリガー.exe.back'),None)
        if original:whole(original,6*MB)
        for rel in ['plugin/KAGParserEx.dll','plugin/psbfile.dll']:whole(rel,MB)
        for rel in ['data.xp3','patch.xp3','bgimage.xp3','evimage.xp3','fgimage.xp3','voice.xp3']:xp3(rel,rel in ('data.xp3','patch.xp3'))
    elif label=='夜勤病棟リメイク':
        whole('script.arc',12*MB);whole('data.arc',MB);whole('systeminfo.json',64*1024)
        for rel in ['image.arc','voice.arc','music.arc','effect.arc']:arcfam_table(rel)
    else:raise RuntimeError('Unrequested detail target '+label)
    report['sampleBytes']=sum(len(data) for _name,data,_mtime in payload)
    if report['sampleBytes']>16*MB:raise RuntimeError('Followup evidence exceeds16MB')
    for row in payload:yield row
    yield '__followup/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode('utf-8'),int(time.time())


def new_game_media_files(items,label):
    """Small real resource evidence for the first two adapters; source read-only."""
    lookup={e.rel.casefold():e for e in items};payload=[];used=0
    report={'game':label,'sourceReadOnly':True,'files':[],'omitted':[],'maxBytes':16*MB}
    def take(e,offset,length,target):
        nonlocal used
        if offset<0 or length<0 or offset+length>e.size:raise RuntimeError('Invalid media range '+e.rel)
        if length>6*MB or used+length>16*MB:
            report['omitted'].append({'path':e.rel,'entry':target,'reason':'explicit media budget','bytes':length});return
        with open(e.path,'rb') as f:f.seek(offset);b=f.read(length)
        if len(b)!=length:raise RuntimeError('Media source changed '+e.rel)
        payload.append((target,b,e.mtime));used+=length
        report['files'].append({'path':e.rel,'artifact':target,'offset':offset,'bytes':length,'sourceBytes':e.size,'sha256':hashlib.sha256(b).hexdigest()})
    if label=='夜勤病棟リメイク':
        wants={'image.arc':{'OP001.PNG','A001_01.PNG','FG_REN04A01L.CHAR','FG_REN04A01L_0.PNG','FG_REN04A01L_FACE.JSON','FG_REN04A01L_FACE.PNG'},'voice.arc':{'VOICE/00_PROLOGUE_001.OGG'}}
        for archive,names in wants.items():
            e=lookup.get(archive)
            if not e:continue
            with open(e.path,'rb') as f:
                h=f.read(4);hs=struct.unpack('<I',h)[0] if len(h)==4 else 0
                if not 4<=hs<=2*MB or hs+4>e.size:raise RuntimeError('Unknown arcfam header '+archive)
                b=f.read(hs);q=0;found=set()
                while q<len(b):
                    n=b[q];q+=1;raw=b[q:q+n];q+=n
                    size,original,off=struct.unpack_from('>III',b,q);q+=12
                    name=''.join(chr((v+n-i)&255) for i,v in enumerate(raw))
                    if name not in names:continue
                    found.add(name)
                    if size!=original:report['omitted'].append({'entry':name,'reason':'compressed resource not silently decoded'});continue
                    take(e,off,size,'__media/'+name)
                for name in sorted(names-found):report['omitted'].append({'entry':name,'reason':'not in archive'})
    elif label.startswith('How to Build'):
        for archive in ['Game','Bgm','Se','Voice']:
            e=lookup.get('pac/'+archive.lower()+'.pac')
            if not e:continue
            with open(e.path,'rb') as f:
                h=f.read(16)
                if len(h)!=16 or h[:4]!=bytes.fromhex('82cf82ad'):raise RuntimeError('Unknown PAC header')
                count,start=struct.unpack_from('<IQ',h,4)
                if count>200000 or start!=16+count*272 or start>6*MB or start>e.size:raise RuntimeError('Invalid PAC index')
                table=f.read(count*272)
                if len(table)!=count*272:raise RuntimeError('PAC table truncated')
            take(e,0,start,'__media/index/'+archive+'.pac.table.bin')
            selected=[]
            for i in range(count):
                rec=table[i*272:(i+1)*272];off,size,n=struct.unpack_from('<QII',rec,256)
                if not 1<=n<=255 or start+off+size>e.size:raise RuntimeError('Invalid PAC entry')
                name=rec[:n].decode('cp932').replace('\\','/')
                if name.startswith('/') or any(v in ('','.','..') for v in name.split('/')):raise RuntimeError('Unsafe PAC name')
                low=name.casefold()
                exact=low in ('data/graphics/bg/0070.png','data/graphics/bu/000_00.png','data/sound/bgm/401.ogg','data/sound/se/000.wav','data/sound/voice/nyan01_0070_00.ogg')
                cg=archive=='Game' and '/cg/' in low and len([x for x in selected if '/CG/' in x[0].upper()])<2
                if exact or cg:selected.append((name,start+off,size))
            for name,off,size in selected:take(e,off,size,'__media/'+name)
    else:raise RuntimeError('Unrequested media target '+label)
    report['sampleBytes']=used
    yield from payload
    yield '__media/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode('utf-8'),int(time.time())


# Compressed DATA only: exact read ranges derived from previously collected indices.
# Decoded plan is included in the collection report; no executable serialized objects.
REMAINING_RANGE_PLAN = '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'
def new_game_remaining_files(items,label):
    plans=json.loads(zlib.decompress(base64.b64decode(REMAINING_RANGE_PLAN)))
    if label not in plans:raise RuntimeError('Unrequested remaining target '+label)
    plan=plans[label];lookup={e.rel.casefold():e for e in items};payload=[];used=0
    def entry(rel):
        e=lookup.get(rel.casefold())
        if not e:raise RuntimeError('Required source missing: '+rel)
        return e
    def read_range(e,off,n):
        if off<0 or n<0 or off+n>e.size or n>8*MB:raise RuntimeError('Invalid/big evidence range '+e.rel)
        with open(e.path,'rb') as f:f.seek(off);b=f.read(n)
        if len(b)!=n:raise RuntimeError('Source changed '+e.rel)
        return b
    for guard in plan['guards']:
        b=read_range(entry(guard['source']),guard['offset'],guard['bytes'])
        if hashlib.sha256(b).hexdigest()!=guard['sha256']:raise RuntimeError('Source index differs from analyzed version; refusing stale offsets: '+guard['source'])
    report={'game':label,'sourceReadOnly':True,'files':[],'guards':plan['guards'],'maxBytes':8*MB,'notes':['Exact original byte ranges; encrypted/partial samples remain raw. Partial rows are marked explicitly. No source writes or game code execution.']}
    for row in plan['ranges']:
        e=entry(row['source']);name=row['artifact']
        if e.size!=row['sourceBytes']:raise RuntimeError('Source size changed: '+e.rel)
        if name.startswith('/') or any(v in ('','.','..') for v in name.split('/')):raise RuntimeError('Invalid output path')
        b=read_range(e,row['offset'],row['bytes']);used+=len(b)
        if used>8*MB:raise RuntimeError('Remaining evidence exceeds8MB budget')
        payload.append((name,b,e.mtime));report['files'].append(dict(row,sha256=hashlib.sha256(b).hexdigest()))
    report['sampleBytes']=used
    for item in payload:yield item
    yield '__remaining/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode('utf-8'),int(time.time())

def main():
    new_games = RULES_RE is not None and RULES_RE.pattern in ('^new-games:probe$','^new-games:detail$','^new-games:media$','^new-games:remaining$')
    new_games_remaining = new_games and RULES_RE.pattern == '^new-games:remaining$'
    new_games_media = new_games and RULES_RE.pattern == '^new-games:media$'
    new_games_detail = new_games and RULES_RE.pattern == '^new-games:detail$'
    download_logs = RULES_RE is not None and RULES_RE.pattern == '^gal-download:latest$'
    tsk_scene = RULES_RE is not None and RULES_RE.pattern == '^tsk:ch10340034$'
    rpg_media = RULES_RE is not None and RULES_RE.pattern == '^rpgmaker:media-samples$'
    rpg_probe = RULES_RE is not None and RULES_RE.pattern == '^rpgmaker:packed-probe$'
    rpg_new = RULES_RE is not None and RULES_RE.pattern == '^rpgmaker:new-rj$'
    rpg_maps = RULES_RE is not None and RULES_RE.pattern == '^rpgmaker:map-sample$'
    rj_inventory = RULES_RE is not None and RULES_RE.pattern == '^rj01482469:inventory'
    requested_diagnostics = RULES_RE is not None and RULES_RE.pattern == '^(rj01482469:core|tsk:ch10380048)$'
    if new_games:
        games=[];found=set()
        for d,ds,_fs in walk_follow(root):
            depth=os.path.relpath(d,root).count(os.sep)
            label=new_game_label(os.path.basename(d))
            if label and new_games_remaining and label not in ('AI','シロクロv1.1','ツヴァイトリガー'):
                ds[:]=[];continue
            if label and new_games_media and label not in ('How to Build a Magnificent Kingdom v1.05','夜勤病棟リメイク'):
                ds[:]=[];continue
            if label and (not ONLY or ONLY.search(os.path.relpath(d,root))):
                games.append(d);found.add(label);ds[:]=[]
            elif any(MARK.search(f) for f in _fs) or any(x.lower().endswith('_data') for x in ds):
                ds[:]=[]  # Other games cannot contain a requested game; avoid scanning their media/runtime trees.
            else:
                ds[:]=sorted(x for x in ds if depth<7 and x.lower() not in ('gal-download','bundles','runs','repair-backups','bundle-backups','node_modules','img','audio','movies') and not EXCL.search(x+'/'))
        missing=[name for name,_pattern in NEW_GAME_PATTERNS if name not in found and (not new_games_remaining or name in ('AI','シロクロv1.1','ツヴァイトリガー')) and (not new_games_media or name in ('How to Build a Magnificent Kingdom v1.05','夜勤病棟リメイク'))]
        say('本轮%s；找到%d个目录；未找到：%s' % ('剩余三作定向剧情/格式验证' if new_games_remaining else '两作定向媒体验证' if new_games_media else '五作引擎探测',len(games),'；'.join(missing) or '无'))
        if not games: raise RuntimeError('未找到指定五作目录；未采其他游戏')
    elif download_logs:
        game, log_items = latest_download_logs()
        games = [game]
    elif rpg_new or rpg_probe or rpg_media:
        games = []
        for d, ds, _fs in walk_follow(root):
            match = re.match(r'^\[?(RJ[0-9]+)(?=$|[^0-9])', os.path.basename(d), re.I)
            if match:
                if match.group(1).upper() != 'RJ01482469' and (not rpg_media or match.group(1).upper() in RPG_MEDIA_SAMPLES) and (not rpg_probe or match.group(1).upper() == 'RJ01220265') and (not ONLY or ONLY.search(os.path.relpath(d, root))): games.append(d)
                ds[:] = []
            else:
                ds[:] = sorted(x for x in ds if x.lower() not in ('gal-download', 'bundles', 'runs', 'repair-backups', 'bundle-backups') and not EXCL.search(x + '/'))
        if not games: raise RuntimeError('未找到新的RJ开头目录（已排除RJ01482469）；未采其他游戏')
        say('本轮新RJ目录：' + '；'.join(os.path.relpath(g, root) for g in games))
    elif rpg_maps:
        games = []
        for d, ds, _fs in walk_follow(root):
            if re.search(r'(?<![A-Za-z0-9])RJ01482469(?![0-9])', os.path.basename(d), re.I):
                games.append(d); ds[:] = []
            else:
                ds[:] = sorted(x for x in ds if x.lower() not in ('gal-download', 'bundles', 'runs', 'repair-backups') and not EXCL.search(x + '/'))
        if not games: raise RuntimeError('未找到 RJ01482469，未采集其他游戏')
    elif tsk_scene:
        games = []
        for d, ds, _fs in walk_follow(root):
            if os.path.basename(d).lower() == 'twinkle star knights x':
                games.append(d); ds[:] = []
            else:
                ds[:] = sorted(x for x in ds if x.lower() not in ('gal-download', 'bundles', 'runs', 'repair-backups') and not EXCL.search(x + '/'))
        if not games: raise RuntimeError('未找到 Twinkle Star Knights X，未采集其他游戏')
    elif requested_diagnostics:
        games = []
        for d, ds, _fs in walk_follow(root):
            if os.path.basename(d).lower() == 'twinkle star knights x' or re.search(r'(?<![A-Za-z0-9])RJ01482469(?![0-9])', os.path.basename(d), re.I):
                games.append(d); ds[:] = []
            else:
                ds[:] = sorted(x for x in ds if not EXCL.search(x + '/'))
        if ONLY: games = [g for g in games if ONLY.search(os.path.relpath(g, root))]
        if not games: raise RuntimeError('未找到 RJ01482469 或 Twinkle Star Knights X，未采集其他游戏')
    elif rj_inventory:
        games = []
        for d, ds, _fs in walk_follow(root):
            if re.search(r'(?<![A-Za-z0-9])RJ01482469(?![0-9])', os.path.basename(d), re.I):
                games.append(d); ds[:] = []
            else:
                ds[:] = sorted(x for x in ds if not EXCL.search(x + '/'))
        if ONLY: games = [g for g in games if ONLY.search(os.path.relpath(g, root))]
        if not games: raise RuntimeError('未找到 RJ01482469 目录，未采集其他游戏')
    elif RULES_RE is not None and RULES_RE.pattern == '^tsk:audit':
        tsk = os.path.join(root, 'Twinkle Star Knights X')
        games = [tsk] if os.path.isdir(tsk) else []
        if not games: say('未找到 Twinkle Star Knights X，未采集其他游戏')
        if ONLY: games = [g for g in games if ONLY.search(os.path.relpath(g, root))]
    else:
        games = [g for g in walk_games() if not ONLY or ONLY.search(os.path.relpath(g, root))]
    say('游戏根 %d 个' % len(games))
    gl = open(os.path.join(out, 'games.tsv'), 'w', encoding='utf-8'); gl.write('gid\trelpath\tengines\tfiles\tpicked\tpicked_bytes\n')
    mf = open(os.path.join(out, 'manifest.tsv'), 'w', encoding='utf-8'); mf.write('gid\trel\tmode\trule\tsize\tstored_bytes\tsha256\n')
    total = 0
    for i, game in enumerate(games, 1):
        gid = 'g%02d' % i; rel_game = os.path.relpath(game, root)
        items = log_items if download_logs else list_files(game); eng = engines_of(items)
        picks = ([] if new_games or tsk_scene or rpg_maps or rpg_new or rpg_probe or rpg_media else [(e, 'full', 'gal-download:latest') for e in items] if download_logs else requested_diagnostic_picks(items, os.path.basename(game).lower() == 'twinkle star knights x') if requested_diagnostics
            else [(e, 'inventory', 'rj01482469:inventory') for e in items[:1]] if rj_inventory else pick(items, eng))
        if new_games and items: picks=[(items[0],'inventory','new-games:remaining' if new_games_remaining else 'new-games:media' if new_games_media else 'new-games:detail' if new_games_detail else 'new-games:probe')]
        if rpg_media:
            sample_id = re.search(r'RJ[0-9]+', os.path.basename(game), re.I).group(0).upper()
            sample = RPG_MEDIA_SAMPLES[sample_id]
            wanted = {p.casefold() for p in sample['files']}
            picks = []
            for e in items:
                logical = e.rel.replace('\\', '/')
                if logical.lower().startswith('www/'): logical = logical[4:]
                if logical.casefold() in wanted:
                    if e.size > 16*MB: say('媒体样本超过16MB，仅列目录: '+e.rel); continue
                    picks.append((e, 'full', 'rpgmaker:media-samples'))
            if sum(e.size for e,_m,_r in picks) > 32*MB: raise RuntimeError('媒体样本超过32MB，未静默截断')
            if not picks and items: picks = [(items[0], 'inventory', 'rpgmaker:media-samples')]
        if rpg_probe:
            picks = [(e, 'full', 'rpgmaker:packed-probe') for e in items if 'readme' in os.path.basename(e.rel).lower() and e.rel.lower().endswith('.txt') and e.size <= 128 * 1024]
            if not picks and items: picks = [(items[0], 'inventory', 'rpgmaker:packed-probe')]
        if rpg_new:
            picks, rpg_audit = new_rpgmaker_picks(items)
        if rpg_maps:
            wanted = {'www/data/system.json', 'www/data/actors.json', 'www/data/tilesets.json', 'www/data/map002.json', 'www/data/map004.json'}
            def read_game(rel):
                with open(os.path.join(game, rel), encoding='utf-8-sig') as f: return json.load(f)
            tilesets = read_game('www/data/Tilesets.json')
            names, characters = set(), set()
            for map_id in (2, 4):
                data = read_game('www/data/Map%03d.json' % map_id)
                names.update(n for n in tilesets[data['tilesetId']].get('tilesetNames', []) if n)
                for event in data.get('events', []):
                    if event:
                        characters.update(p.get('image', {}).get('characterName', '') for p in event.get('pages', []))
            system, actors = read_game('www/data/System.json'), read_game('www/data/Actors.json')
            for actor_id in system.get('partyMembers', [1]):
                if 0 < actor_id < len(actors) and actors[actor_id]: characters.add(actors[actor_id].get('characterName', ''))
            for folder, values in [('tilesets', names), ('characters', characters)]:
                for name in values:
                    if name:
                        for ext in ('.png', '.rpgmvp', '.png_'): wanted.add(('www/img/%s/%s%s' % (folder, name, ext)).lower())
            picks = [(e, 'full', 'rpgmaker:map-sample') for e in items if e.rel.replace('\\', '/').lower() in wanted]
            if sum(e.size for e, _m, _r in picks) > 64 * MB: raise RuntimeError('地图样本超过64MB，未采集其他资料')
            say('RPG地图样本: 仅Map002/004、使用的瓦片/人物图及3份数据，共%d项，%.2fMB；不收声音/剧情CG' % (len(picks), sum(e.size for e, _m, _r in picks) / MB))
        if tsk_scene:
            picks = []
            for e in items:
                rel = e.rel.replace('\\', '/').lower()
                sub = rel.split(TSK_PREFIX, 1)[-1] if TSK_PREFIX in rel else rel
                wanted = sub in ('adventure/master.chapter.json', 'adventure/charascenario/charascenario1034003.book.json')
                wanted = wanted or bool(re.match(r'^characters/ch_(1034003|3332001|3301001)/[^/]+\.(png|atlas\.txt|skel\.bytes)$', sub))
                if wanted: picks.append((e, 'full', 'tsk:ch10340034'))
            if not picks: raise RuntimeError('TSK 目录未发现 Ch10340034 所需的剧情/立绘，未静默采集其他资料')
            if sum(e.size for e, _mode, _rule in picks) > 64 * MB: raise RuntimeError('指定场景诊断文件超过64MB，未采集其他资料')
            say('Ch10340034: 只收剧情、Master及3套引用角色文件，共%d项，%.2fMB；不收声音/CDN缓存，不修改原目录' % (len(picks), sum(e.size for e, _mode, _rule in picks) / MB))
        if 'bgi' in eng and RULES_RE is not None and RULES_RE.search('bgi:named'):
            picks = picks + [(e, 'bginamed', 'bgi:named') for e in bgi_named(items)]
        if RULES_RE is not None:
            picks = [x for x in picks if RULES_RE.search(x[2])]
            if not picks and not rj_inventory:
                say('== %s %s  引擎=%s：没有文件命中 GAL_COLLECT_RULES（%s），跳过' % (gid, rel_game, ','.join(eng), RULES_RE.pattern)); continue
        bgi_forced = bgi_pairs([e for e, _m, r in picks if r == 'bgi:data']) if 'bgi' in eng else {}
        say('== %s %s  引擎=%s 文件=%d 选中=%d' % (gid, rel_game, ','.join(eng), len(items), len(picks)))
        listing = io.BytesIO(('rel\tsize\tmtime\n' + ''.join('%s\t%d\t%d\n' % (e.rel, e.size, e.mtime) for e in items)).encode('utf-8'))
        prefix = os.path.join(out, 'gal-collect-%s-%s-%s.tar.gz' % (ts, host, gid))
        sp = Split(prefix, lambda p: print('PART\t%s' % p, flush=True))
        picked_bytes = 0
        gz = gzip.GzipFile(fileobj=sp, mode='wb', compresslevel=6, mtime=0)
        with tarfile.open(fileobj=gz, mode='w|') as tar:
            ti = tarfile.TarInfo('%s/__listing.tsv' % gid); ti.size = len(listing.getvalue()); ti.mtime = int(time.time()); tar.addfile(ti, io.BytesIO(listing.getvalue()))
            if new_games:
                for name,data,mtime in (new_game_remaining_files(items,new_game_label(os.path.basename(game))) if new_games_remaining else new_game_media_files(items,new_game_label(os.path.basename(game))) if new_games_media else new_game_detail_files(items,new_game_label(os.path.basename(game))) if new_games_detail else new_game_probe_files(items)):
                    if total+len(data)>min(TOTAL_MAX,64*MB): raise RuntimeError('五作探测证据超过64MB总量上限')
                    ti=tarfile.TarInfo(gid+'/'+name);ti.size=len(data);ti.mtime=mtime;tar.addfile(ti,io.BytesIO(data));total+=len(data);picked_bytes+=len(data)
            if rpg_media:
                packed = [e for e in items if e.rel.lower().endswith('.exe')] if sample_id == 'RJ01220265' else []
                selected = [e.rel for e,m,_r in picks if m == 'full']
                for e in packed:
                    with open(e.path, 'rb') as binary: pe_head = binary.read(256*1024)
                    for rel, data in packed_rpg_payload(e, pe_head, sample['files']):
                        if total+len(data) > TOTAL_MAX: raise RuntimeError('媒体样本超过总量上限，未静默截断')
                        name = '%s/__evb_media/%s/%s' % (gid, os.path.basename(e.rel), rel)
                        ti = tarfile.TarInfo(name); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data))
                        picked_bytes += len(data); total += len(data)
                logical_selected = [p[4:] if p.lower().startswith('www/') else p for p in selected]
                plan = {'game': sample_id, 'map': sample['map'], 'requested': sample['files'], 'selectedLoose': selected, 'packed': bool(packed), 'missingLoose': [] if packed else [p for p in sample['files'] if p not in logical_selected], 'note': 'Targeted media verification samples only. Packed files remain stored blocks with index metadata; no game execution or new dependencies.'}
                say('媒体样本 %s: 普通文件%d，封装EXE%d；缺失: %s' % (sample_id, len(selected), len(packed), plan['missingLoose']))
                data = json.dumps(plan, ensure_ascii=False, indent=2).encode('utf-8')
                ti = tarfile.TarInfo('%s/__media_sample_plan.json' % gid); ti.size = len(data); tar.addfile(ti, io.BytesIO(data))
            if rpg_probe:
                probes = []
                for e in items:
                    if not e.rel.lower().endswith('.exe'): continue
                    with open(e.path, 'rb') as binary:
                        head = binary.read(256 * 1024)
                        offset = max(len(head), e.size - 256 * 1024)
                        binary.seek(offset); tail = binary.read(256 * 1024)
                    probe = {'path': e.rel, 'sourceBytes': e.size, 'headBytes': len(head), 'tailOffset': offset, 'tailBytes': len(tail), 'partialOnly': True, 'sourceReadOnly': True}
                    if head[:2] == b'MZ' and len(head) >= 64:
                        pe = struct.unpack_from('<I', head, 60)[0]
                        if pe + 24 <= len(head) and head[pe:pe+4] == b'PE\0\0':
                            sections = struct.unpack_from('<H', head, pe+6)[0]; optional = struct.unpack_from('<H', head, pe+20)[0]
                            table = pe+24+optional; ends = []
                            for index in range(min(sections, 128)):
                                at = table+index*40
                                if at+40 > len(head): break
                                size, start = struct.unpack_from('<II', head, at+16); ends.append(size+start)
                            probe['sections'] = sections
                            if ends: probe['sectionEnd'] = max(ends); probe['overlayBytes'] = max(0, e.size-max(ends))
                    for suffix, data in [('head.bin', head), ('tail.bin', tail)]:
                        name = '%s/__exe_probe/%s.%s' % (gid, os.path.basename(e.rel), suffix)
                        ti = tarfile.TarInfo(name); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data))
                        picked_bytes += len(data); total += len(data)
                    for rel, data in packed_rpg_payload(e, head):
                        if total+len(data) > TOTAL_MAX: raise RuntimeError('封装诊断超过总量上限，未静默截断')
                        name = '%s/__exe_probe/%s/%s' % (gid, os.path.basename(e.rel), rel)
                        ti = tarfile.TarInfo(name); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data))
                        picked_bytes += len(data); total += len(data)
                    probes.append(probe)
                    say('EXE识别样本: %s，源%d bytes；只读头%d+尾%d bytes' % (e.rel, e.size, len(head), len(tail)))
                payload = json.dumps({'probes': probes, 'note': 'Only bounded executable header/footer bytes, not a runnable EXE or full embedded game.'}, ensure_ascii=False, indent=2).encode('utf-8')
                ti = tarfile.TarInfo('%s/__exe_probe/index.json' % gid); ti.size = len(payload); tar.addfile(ti, io.BytesIO(payload))
            if rpg_new:
                payload = json.dumps(rpg_audit, ensure_ascii=False, indent=2).encode('utf-8')
                ti = tarfile.TarInfo('%s/__rpgmaker_audit.json' % gid); ti.size = len(payload); ti.mtime = int(time.time()); tar.addfile(ti, io.BytesIO(payload))
            if rj_inventory:
                counts = collections.defaultdict(lambda: [0, 0])
                for e in items:
                    ext = os.path.splitext(e.rel)[1].lower() or '(no extension)'
                    counts[ext][0] += 1; counts[ext][1] += e.size
                extensions = 'extension\tfiles\tbytes\n' + ''.join('%s\t%d\t%d\n' % (ext, n, b) for ext, (n, b) in sorted(counts.items()))
                dirs = ['rel\n']
                for d, ds, _fs in walk_follow(game):
                    ds[:] = sorted(x for x in ds if not EXCL.search(x + '/'))
                    dirs.append(os.path.relpath(d, game).replace(os.sep, '/') + '\n')
                reports = {'__directories.tsv': ''.join(dirs), '__extensions.tsv': extensions, '__audit.txt': 'RJ01482469 metadata only: paths, sizes, mtimes and extension counts. No game payloads. Save directories excluded.\n'}
                for name, value in reports.items():
                    data = value.encode('utf-8'); ti = tarfile.TarInfo('%s/%s' % (gid, name)); ti.size = len(data); ti.mtime = int(time.time()); tar.addfile(ti, io.BytesIO(data))
            if any(rule == 'tsk:audit' for _e, _m, rule in picks):
                for name, value in tsk_reports(items).items():
                    data = value.encode('utf-8'); ti = tarfile.TarInfo('%s/%s' % (gid,name))
                    ti.size = len(data); ti.mtime = int(time.time()); tar.addfile(ti, io.BytesIO(data))
            for e, mode, rule in picks:
                if total >= TOTAL_MAX: say('  ! 总量达到上限 %d MB，后面的不收' % (TOTAL_MAX // MB)); break
                if mode == 'inventory': continue
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
                                chosen = pf8_named(ents, e.size) if rule == 'artemis:named' else pf8_pick(ents, e.size) + (pf8_emote(ents, e.size) if rule == 'artemis:emote' else pf8_media(ents, e.size))
                                for name, off, sz in chosen:
                                    f.seek(off); data = f.read(sz)
                                    if len(data) != sz: mf.write('%s\t%s\tERROR\t%s\t%d\t0\tshort read %s\n' % (gid, e.rel + ':' + name, rule, sz, name)); continue
                                    ti = tarfile.TarInfo('%s/%s.__entries/%s' % (gid, e.rel, name.replace('\\', '/'))); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data)); stored += len(data)
                                    mf.write('%s\t%s\tpf8entry\t%s\t%d\t%d\t%s\n' % (gid, e.rel + ':' + name, rule, sz, len(data), hashlib.sha256(data).hexdigest()))
                                say('   pf8 %s：索引 %d 条，选中 %d 个脚本类条目' % (e.rel, len(ents), len(chosen)))
                                total += stored; picked_bytes += stored
                                continue
                    if eff == 'bginamed':
                        got = bgi_named_pick(e.path, e.size)
                        if got is None: continue
                        hits, cat = got; cb = cat.encode('utf-8'); stored = 0
                        ti = tarfile.TarInfo('%s/%s.__bgi/__named.tsv' % (gid, e.rel)); ti.size = len(cb); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(cb)); stored += len(cb)
                        with open(e.path, 'rb') as f:
                            for name, off, sz in hits:
                                f.seek(off); data = f.read(sz)
                                if len(data) != sz: continue
                                ti = tarfile.TarInfo('%s/%s.__bgi/%s' % (gid, e.rel, re.sub(r'[\\/:*?"<>|]', '_', name))); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data)); stored += len(data)
                                mf.write('%s\t%s\tbgiimage\t%s\t%d\t%d\t%s\n' % (gid, e.rel + ':' + name, rule, sz, len(data), hashlib.sha256(data).hexdigest()))
                        say('   bgi %s：按名收 %d 张' % (e.rel, len(hits)))
                        total += stored; picked_bytes += stored
                        continue
                    if eff == 'tomoe':
                        got = tomoe_pick(e.path, e.size, rule)
                        if got is None:
                            say('  ! %s 认不出结构，改收头 + 尾' % e.rel); eff = 'ht'
                        else:
                            cat, picked = got; cb = cat.encode('utf-8'); stored = 0
                            ti = tarfile.TarInfo('%s/%s.__tomoe/__catalog.tsv' % (gid, e.rel)); ti.size = len(cb); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(cb)); stored += len(cb)
                            mf.write('%s\t%s\ttomoecatalog\t%s\t%d\t%d\t%s\n' % (gid, e.rel, rule, e.size, len(cb), hashlib.sha256(cb).hexdigest()))
                            with open(e.path, 'rb') as f:
                                for label, off, sz in picked:
                                    f.seek(off); data = f.read(sz)
                                    if len(data) != sz: continue
                                    ti = tarfile.TarInfo('%s/%s.__tomoe/%s' % (gid, e.rel, label)); ti.size = len(data); ti.mtime = e.mtime; tar.addfile(ti, io.BytesIO(data)); stored += len(data)
                                    mf.write('%s\t%s\ttomoeentry\t%s\t%d\t%d\t%s\n' % (gid, e.rel + ':' + label, rule, sz, len(data), hashlib.sha256(data).hexdigest()))
                            say('   tomoe %s：目录 %d 行 + 样本 %d 个' % (e.rel, cat.count(chr(10)) - 1, len(picked)))
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
  if upload_one "$path"; then [ "$DRYRUN" = 1 ] || archive_tmp "$path"; echo "OK $path" >> "$OUT/.uploaded"; else echo "FAIL $path" >> "$OUT/.failed"; fi
done
PYRC=${PIPESTATUS[0]}
[ "$PYRC" -eq 0 ] || { log "采集出错（python 退出码 ${PYRC}）"; exit 1; }

# 元数据包（games.tsv / manifest.tsv / info.json / 日志）
scrub "$LOG"
META="$OUT/gal-collect-$TS-$HOST_TAG-meta.tar.gz"
tar -czf "$META" -C "$OUT" games.tsv manifest.tsv info.json run.log || { log "元数据打包失败"; exit 1; }
if upload_one "$META"; then [ "$DRYRUN" = 1 ] || archive_tmp "$META"; else echo "FAIL $META" >> "$OUT/.failed"; fi

if [ -s "$OUT/.failed" ]; then
  log "有文件上传失败（留在 ${OUT}）："; cat "$OUT/.failed"
  ERROR_DONE=1
  exit 2
fi
if [ "$DRYRUN" = 1 ]; then log "DRYRUN 完成：分卷和元数据留在 ${OUT}，没有上传"; else log "全部完成：$(wc -l < "$OUT/.uploaded" 2>/dev/null || echo 0) 个文件（分卷 + 元数据）已上传到 $REPO release $TAG"; fi
[ "$DRYRUN" = 1 ] || { archive_tmp "$HELPER" "$OUT/games.tsv" "$OUT/manifest.tsv" "$OUT/info.json"; }
ERROR_DONE=1
exit 0
