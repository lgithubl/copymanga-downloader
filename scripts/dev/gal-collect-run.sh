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
#   GAL_COLLECT_META_DIR 可选，指定现有 library-meta/gal 目录；播放故障轮次默认从 gal 根旁的数据目录查找，只上传命中游戏的脱敏配置
#   GAL_COLLECT_TSK_LOG 设置正整数 N 即只采最近 N 次 TSK 日志；空值兼容为1次，优先于默认规则及 GAL_COLLECT_RULES；例如 GAL_COLLECT_TSK_LOG=3 bash gal-collect.sh .
#   GAL_COLLECT_BINARIES=1  也收 GameAssembly.dll / UnityPlayer.dll 这类大二进制（给以后逆向用），默认不收
#   GAL_COLLECT_DRYRUN=1    只扫描 + 打包到本地，不上传
#   GAL_COLLECT_OUT     本地输出目录，默认 /tmp/gal-collect-<时间>（传完的分卷移入归档；DRYRUN 原地保留）
#   GAL_COLLECT_GH      gh 命令，默认 gh（测试时可以换成桩）
#   GAL_COLLECT_UPLOAD_TIMEOUT 单次上传超时秒数，默认600；失败保留分卷
#   GAL_COLLECT_STOP_GRACE_SECONDS 上传超时后等待退出秒数，默认15
#   GAL_COLLECT_ARCHIVE_DIR 已完成临时文件的归档目录，默认 <OUT>/archive
# 还原：同一个游戏的分卷按序号 cat 起来再解压：cat gal-collect-<时间>-g01.tar.gz.part-* | tar xzf -
# 退出码：0 全部成功；1 出错（出错日志已打包上传）；2 有分卷上传失败（留在本地输出目录）
set -uo pipefail
# 版本号：每次改采集规则就加一，运行时第一行打印，也写进 info.json / 日志，方便对上「这批数据是哪版脚本采的」
# 1.0 初版；1.1 Artemis(pf8) 按索引只取脚本 / lua / tbl；Unity 补 *.dsm / *.cof / system 小文件 / psm 样本；AGE 补 .aai；启动时打印版本
# 1.62 修正全事件数据的容量预算：两RJ各192MiB、四作合计640MiB（均为压缩前）；保留全部事件，不改变40MiB压缩分卷。
# 1.61 Twi动态CG索引/小脚本、Remastered sc0561完整叠层图、两RJ全地图事件投影与语音/DLC映射；不重采天結已收到的25份数据。
# 1.60 默认仅采 RJ01271506 的 TemplateEvent 配置指定的8张模板地图（约5MiB），源只读。
# 1.59 仅补国度30_8021及引用图、RJ01271506指定剧情地图/立绘、RJ328940远景CG、Remastered三张指定图；不重采其他G/运行时。
# 1.58 仅国度00_1250/该场景背景、シロクロ指定立绘与预制体、RJ328940目标地图；只读有界采样，不重采AGE/运行时。
# 1.57 仅AGE序章伴随文件/映射表及按原索引选出的少量图音，25项约11MiB；不重收其他游戏，不采EXE/DLL，不执行源游戏。
# 1.56 只补五作验证素材/映射表；AGE仅取明确列出的EXE/DLL做本地静态分析，不执行；每作16MiB，总32MiB，档案索引哈希守卫。
# 1.55 下一批已识别：只补MV/MZ剧情JSON/插件源码、ARCH000完整索引与文本条目、AGE脚本/AAI；不重采EXE/运行时/媒体。
# 1.54 下一批五作只采目录/引擎配置/有界头尾：天結いラビリンスマイスター、Remastered、RJ01646655、RJ328940、RJ01271506；不重采上一批。
# 1.53 正文验证后仅补AI的11个配置及ツヴァイ的完整立绘定义/流程表；不重收正文或媒体样本，索引守卫保持。
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
# 1.74 仅探测 fuyukuru / えどわ～る：目录清单、配置、有限脚本与档案头尾；不执行游戏。
# 1.72 仅两个追加包的原始BIN及两张CG底图约10.5MiB，索引哈希守卫；验证追加剧情与跨包映射。
# 1.70 仅 SP0023 执行路径引用的 EV130/EV131 及差分，共16图约8.2MiB；用于真实画面验证。
# 1.69 天結 SP0023 等场景故障：仅 SP 原脚本及初始化表约10MiB；不采 EXE/DLL/完整档案或媒体。
# 1.68 仅补天結开场EV901A/EV902A两张CG约12.2MiB，索引哈希及档案大小守卫，不重采脚本/引擎。
# 1.67 上传独立超时可配置；启动器缓存目录内保留归档，供循环重传与排查。
# 1.66 仅天結い原版AGE.EXE.org（约4.23MiB）静态分析；不执行、不收其他游戏/档案/媒体。
# 1.65 嵌套采集根向上查固定元数据目录，已收到的图音按SHA复用。
# 1.64 两RJ播放故障：实际Gal配置/进度、原始事件页及图音依赖；所有EV009同名候选，MZ模板/编号CG/DLC配音；同SHA复用，Twi只收已生成脚本/引用/报告，不重收档案或模型。
# 1.79 两作验证最后补件：Edoire预加载图音与Silky主舞台本体/表情；范围及大小守卫，源目录只读。
VERSION="1.94"
export GAL_COLLECT_VERSION="$VERSION"
# 这一轮要的规则（正则，对规则名）。每个版本只写当时需要的——以前要过的已经分析完的不再收，传的东西才不会越来越大。要全收：GAL_COLLECT_RULES=all
ROUND_RULES='^new-games:fuyu-edo$'
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
    if "$PY" - "$GH" release upload "$TAG" "$f" --repo "$REPO" --clobber <<'UPLOAD_TIMEOUT'
import math, os, subprocess, sys
try:
    timeout=float(os.environ.get('GAL_COLLECT_UPLOAD_TIMEOUT','600'))
    grace=float(os.environ.get('GAL_COLLECT_STOP_GRACE_SECONDS','15'))
    if not all(math.isfinite(v) and v>0 for v in (timeout,grace)):raise ValueError()
except ValueError:
    print('上传超时/退出等待必须是正数秒数',file=sys.stderr);sys.exit(2)
# Keep the CLI in the collector's process group so its outer watchdog also stops it.
p=subprocess.Popen(sys.argv[1:])
try:sys.exit(p.wait(timeout=timeout))
except subprocess.TimeoutExpired:
    print('上传超时（%s秒），保留分卷等待重传'%timeout,file=sys.stderr,flush=True)
    p.terminate()
    try:p.wait(timeout=grace)
    except subprocess.TimeoutExpired:p.kill();p.wait()
    sys.exit(124)
UPLOAD_TIMEOUT
    then return 0; fi
    log "上传失败（第 $n 次）：$(basename "$f")"; sleep $((n * 3))
  done
  return 1
}

archive_tmp() {
  local f dst
  local base="${GAL_COLLECT_ARCHIVE_DIR:-$OUT/archive}"
  mkdir -p "$base" || return 1
  dst="$(mktemp -d "$base/archive.XXXXXXXX")" || return 1
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
    bootstrap_cache = os.path.realpath(env['GAL_COLLECT_CACHE_DIR']) if env.get('GAL_COLLECT_CACHE_DIR') else None
    for d, ds, fs in os.walk(top, followlinks=True):
        real = os.path.realpath(d)
        if bootstrap_cache and (real == bootstrap_cache or real.startswith(bootstrap_cache + os.sep)):
            ds[:] = []; continue  # Never recursively collect the supervisor's own cached outputs.
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
KRKR_NAMES_B64 = 'eNp9fU1vJD2O5n+p87uNCJL6iD3OpYEF+jTAXgaLRNpOO92VaXsy7XLXLPa/L+L7eUjVXOwURVEkJZGUQsH4vz9ery8//ud//Di9/fr6eDp+nn789WP78fr2+vnjrx9vp+8ff/14eLn++OvH8+vlcvgakZ6ux/vPFfL0468f38cJ+/55vH1eXt9GAr+eL8eXkcLxOhY/T/8aMa6n+/fr2+fvjxH2dHo+fl1G8MfxZQQ8vH+ef/z14+V4Pf3X+/vY5+10P40In7evEeHx+PZ4utx/vn78+OvHP1/fXi6nqdtD14+1l9fHn0vl6e34cDmNvD0fL/cR6+399Px8ehypnX5Nf05vY+Hx5bAS+Hy9rvRkr5EFpDtIF5DtIFtAaQelBZR3UF5AZQeVBVR3UF1Aww4aZlDfbaDp5/i/30H9Atq57xfu+537fuG+37mffj68XA//9vd/zPKOepj1dnl//5h+nN6ebqfH98vl9Pj5+v42jub95f35eWo6j/48ipfj48+Z9PZzGrfj1+f79f1pVvHx+flwG7FPL69v66A9HR5eru/j6FyOv0+3nal+U8XabpoZy7wb/329fb5eVsq398sFGizFz9vx7T4LsnT4dJrg58vx4XQ5TNN36jMtat5/PZ6PXdf/7f55fBsn1eP5eDs+fk4sPh8fT7Myvl9HrZyuMwLijzjLolkl6nfCsiPeTm8L+uHz+rEQgvqP22kV4+l0Of6+fY34vy791PH7MjCPH91Kfvn1sU7M9dfHOvzrr491Bq6/PtYZv/76WOfV+uujzxsgz002wPTre5qk3+fXyaY8vhzWn6sSFjIbb9OvhxeRVf/rr0mfBfWPxXXqJkDOjAzFBSExQgoIlRGqR+g7QnDFbggEI0S4iSsaFzU0twABnI/VWKy/PvqyAcZf//l1/DnZ5slQP7xIv2m9nwZPp0kly0RZfn09vKyTa/358LKO+/LrW3UikOZ18Xg+vk2m4Xuaat8yzq9vm+es6EZ+7m9d68uvbytTm6nlxPe3Tr8nIv30V4Z59m1TejHH7x/Lv1XUUUfWe60BZJ1JwyzWsIk1/rq+/zrMpu7j92G2U6OJ2Qpr45HJyTQcJ7tzfzx0h49b18HEnyQo0GbWowDOtOgeXrZlOTLKEwSK38vCmU3nAWywKy4E1z5sNTFMWZSLYaI1IBIgNBk3gzT/Gut5BQovbwkrFhEWSFi02OpjnUnrr49uA8y/xga8ymWgona+gwiRYBiAyLek6e80b/thGeTjttCmn6fTZObWuTGO+9Pz69vz+/jj/ef78+l2PLwuGP/+jzU4oarViT2eT9NQr+XTxMY6BZfVuvybJ1i/ObsFMHMxz8TJpH7386LeEdPkdGbrLZuZWWavbtZ7+vVx/Px8fRuXzRwsTB7q8+vz/fZ6XLw0lO6PBzncP9f10L/tNultBukO0hX0CLDHN5jfdbYxC9oR0Kbf35IXkya7SRNgQ5Y1+LavnjeonhUmy+KrG/V5iclmPqZfayNbuQFm5um52edutnmzPlcDvPwa8R/2ptvPdcTKxupsX/ptOPpVD3vraVznzhZRN2zSwyyhogmb58BMYQ4pui0+mNv+fnucKM/OAMlt7mJeHmkZ7bSPT0I1L+rMM4ebOqZfp+saIyy/1kaT89C6Q+aIefndw29o1S9GV/YBl3k+adpmdQItTCtj9pc2a1A34aZfK+Fl6LpFLjt0XX/o+mn9//oepn9Px7frFACefj2+zPWLaFj+uBx//3p/fVyj83E5zTuqFTrGnod/+/v/PhwP90PvAeIByoCrb3Kdmuw83AJXN2rx7Ek8LyQIoAy4TE0en96/39b/j5f74r9XwaBHCTyMkPO8aTlvu5bz9fivUTPzP8DW0D4w5KS20MJYT7MIW73nkMhJUOIMOf06XH95DAZhWSKK+MFT10ZjG49iESXIKr7NudHo7FspKyEFJSRHNt0j2QmGgBxxMndUQkfF0SiNjibYxv/LMr7fM+mvz1e3mEdpXx/Hwkxq+73jyBH5AofbZcchaUrDdJkh16/L5+vh+nx7f/s8fHf914zVAkNLCbQk0pI2rQU8t/teozos+wb3PxC6O640cKXYlbiuaDnpV9DPV89jJzwOZyoqDYtf6bbzYU7kuQxm485GwMLA2c0hSEAQRtCAoIwQ+J0gezEoZ4aA+OfZdTHUSCl+qSaqDGImnJ/316fTOA8vNBMQCu0kUJJASZqUxFHSQEkjpXub1N3RskDLWFk8oRLpzq9tMk456C7zFMlBJZmnSA6SZp4iObCfeYp481ioMjBYmMESGCzMYAkMFmawBAaL028i/WqH+l13JlSmNSkeoNTcC7hAoCgBQRhBA0KIJ1yfFloYi3ieIlhYk7IFjGMTceHhUh7PkXzwJz74E7JWgHEF8yUh1hOI9YSiQwIodxJoSqDp2Lr4FhpaqG8h3MJCC0ME+fKCyVfv2RYPUCLhCXhdM3bQJEVzEgO+Nsq5gXN2SBJxxKM06MiZJbj4yeGULGFYKJKcy/fYj949WacpC2QNW8xxGKyJLe4SiLtk2ll2hCm0ejz3xIWG8dKWR7s1PdqNKUmgJIwQOGk5qmZXE9S7rjbm3XFloVOnZWHdTebIlIBKCvUUacVZUChGQhIiIeFISEIkJBwJSYiEhCOhqZgCQmKEHBAySzxb5f1oh6uNFOJ7o75SUEhihaSgkMQKSUEhiRWSgkISKyQFhcwQEGgODWU7Vpp+7fWJBPbay1QZBM4scA4CZxY4B4EzC5yDwJkFLq66UGVgsDCDJTBYmMESGCzMYAkMUqAjHOgIBTriAh3ZAh2huIYAQs29gBToSAh0hAMdCYGOQKAjjUBHQqCzQaCYAkJiHZzhxG2fiNNZ2reB+pQCJHUBkm4BkvoASX2ApP50TBv7Ow0BkkKApP48TX1goT5i0saJm4aISSFiUn/iphRCEUA8QLkTDZ0QgueBWJSgB4pdNIY3TRSJKOJQNKI47V28fi+HgOE71nOD7JkltCChOSp2j1TszlRSoJKQuRceN/LCirGOQqwzn8IzptBCcAckCgck2rAV6qIjxehIQ3S0QaAoAYHJh+mmPN30K1D4chKeqagksB8so8rAvjH7Ftg3Zt8C+8bsW5guM+Q7D4yWAlpisVhKIyl940SVQcrEUqYgZWIpU5AysZQpSIkBhoYAQ12AoXxwohRPqIsnFOMJDfGEcjyhIZ5Qjic0xBPK8YSGeEI5nlAXTyjGExriiQ3ij2ef2qe2T0xLAi1hBA0I2jiObXc2gcMJ7R9w744zCx2zjsIcKG4OJJoDGPOoi3mW8l7wKqaIRkNEs0HIdyq30NBCmb95KwR7S6PAYyyxvd0g460df/Zi/pjKGsdU5oIZ24IZ88GM+WDGfDBjPjQxf5hjPjSxxkMuC/HPBoGiBATxJEMfwiQ0kKAWL46nr9Dll9Ps1et+lhNGc/OzBn7WCEdoxH2fJIIENQmrSYKa5OYoaEBQRrCAYIjg21NrDQwqBmeMwSAsS0QRj3Ju4JyZl8AqnivN5XukonemYoGK8awRHs4zFZVG19MizVpQnvHoWhhdu4UZ6QBuVUBEb40zTwshiXFIYiEk2SAgM6vASAXJNU5UGVSwQuYCPjaD8lIQVylMWgJph6ABQRnBAgILbix4IsGza5ypMgieeexzYD8z+8VVF6oM5AuTL4F8ceSDdgprpwTtFDYczn+b89/G/tvIf5vz34b+24L/NvbfFvy38YmEBXe9QaBoAcGY3/N6rwoe6Cdy6cm537S53+Tdb/LuNzWeCKTgOhMcHSQfIiSyEtBAAgmHoAFBPUnXx8WzaYGEeTapU88TeACsRQCUnJvZQKDI6yEAnKovHuPiWAyKo4OGuXyPjMjdIzVwHIo7WkjuaCEF153c0UJqHC0kd7SQwiOtBI+0UnxukjDGSRDjJMIRWgJ+MtFE0TCfNQ6cayGhhTBC6JGn79HPVg2qVDBmUzEFhMRaEtbAmYpKCvGdUVcWFIJhQQphQeJThhRcemKXnoJLT/zEI4XzhcRPPFJ44pHcE4+0Xw4pBDXSg++EukhBD4n1kIIeEushBT0k1kMKeiAPn9jDJ/LwyXn4hB4+BQ+f2MOn4OETe/gUjhkSHzOkcMyQ+JghuRghYYyQQoyQOEZIIUZIHCOkECMkjhFSiBGSe2yROARIFAIkFwIkDAFSCAEShwAphACJQ4AUQoDkduxp8fBLMZNjz86x582xZ+/Ys3fsueHYc3Dsed8TT6abMRgERK+HABAPUEdVIlXX5uKpXg4Bw1PVSDWgnBs4Z1aKBaWYo+J83A7b2oijIVQZ9I6b7By8fuZNdg6b7Myb7Bw8dYa7CTn62Iw+NoOPzYQjNBvdSX2Gk/rsw8LsT45y4+QoO7+d0W/n4Lczn+Xn4KYBMhdwb7eVATf0fnP9W0AwQvgO/X8LU0iBQkIGxTEoPGTCw8G2Qml0PKs8hS2ua3NL3+IiNQwZ5/K5gUPLyYJWzS1K82ckOwzaBHnQrGc+Ecjk9bPz+hm9/lgI83iG7MUw79LNIUhAEEbQgKCMYAHBGCHIcGMpODzaIKAS1lAiDfnGmSqDAjIrIAcFZFZADgrIrIDiqgtVhv4L919C/4X7L6H/4voPA1B4AEoYADpbyEtgcbpK2t7yoXqMNLKLNDJGGjlEGpkjjRwijcyRRg6RRnaRRuZIo1CkUVykUbZIo/hIo/hIozQijRIijQJhRPFhRPFhRGlsyko4UygQRBQfRBQfRJTGrqyEY4jCdwtKiA4KHDIUfixeos0u6GYLuNlCOEJD4YUUqgx6xUiihEiicCRRQiRROJIowc0XcPPF3+Yp3u+XxsFLcW6+rG5+Mv5YiwAonUP9mYgHndDx/1y+BxozDAESccSjnBs4jpsg7M3J4/1fcc8ISrhjUNwdg7IEAw8vagRVmkp+6hpVBrUZTyULU8l4KlkQ1XgqWVg85MULe/FCXrw4L17Qi5fgpAs76RKcdGEnXYKTLuykS3DShZ10CU66sJMuwUkX56QLO+lCTro4J72UYZE5gwnvLpbGBfcS/PoGgRYXT/PiaV48TQk0hRE0ICgjWEAgNRdXXagyyFR4HpTAYGEGS2CwMIMlMFjcNE7zc/eKQPT/xfn/gv6/BP9f2P+X4P8L+/8S/H9x/r9sdwOGHVgpCqguCqhbFFB9FFB9FFAbUUANUUCFKKD6KKD6KKA2ooAaooDKTxZqcOkVnixUHxVU/6C/Ni4T1BAFVH5rYyqmgJCQJG2/K8YFFeKCSjhCg+NO0TfIXvTVVBmGAgOHGgKHyoFDDYFDhfuNNYY+lberlVxTdRHBUt4oPftZ8OxngQZxlGcW274azgo2CLRwswAebNfGg+0afH3lE4TqHHBFB1yDA65uS17jrr2JIhFFPMq5gXMOSC1KZ2GWNbCsjo4Lbqrb3NcQFlQXFlQOCyqFBdWFBRXDghrCgsphQQ1hQeWwoIawoHJYUENYUDksqCEsqO5qYWWvX8nrV+f1K27Na3DhlbfmNfjjyv64Bn9c2R9X527r6m7XwSxxThY3J4t/GWyH7UQDm8VN2+Kfc+4waKOBijoqGokElAa76ti10JE5KtZg1xy7KVDhiZFoYmAIUV0IUTGEqCGEqBxC1BBCVA4hagghKt9XqOG+QuUXJmp4YaK6FyYqH0IMFH4MLvwYtvBj8OHH4MOPoRF+DCH8GCD8GBpvlQ4huBg4uBhCcDFAcDH4i4lD452JIcQSA5woDOHS4BD8/gBPzwe/Hx/8fnzw5/BD477G4GKHga4+DP5mRKx2JmGAmxGDD7kGH3INjZBrCPHI4C4wDI2LEIO/CDHE1zIG9y7o0LgIMbiLEEN4vDK4ixBD4yLE4C5CTAMXZMJd/YBh4QBh4ZQxqO8JU2jpaJgk+kXq9NOWFoqGhYIPWoYQPA18H2IIkdAA9yGGGBwO60ubA8GURPIKN6oMHBtzbIFjY44tcIyHF0OIUga+wTCEGwwD32AYwg2Gwd1gGNajrY9+y3DZV6o30ojvLvkl3XsACZSCztLNtbh4M3HxlsWt0hTUnFjNKag53RxXFhCMEYLcrOYU1Jycmo29TiKt+saZKoPOMs+zHBSQWQE5KCCzAnJQQGYFFFddqDIwWJjBEhgszGAJDBZmsAQGi2MwjBCFNQOHNQOFNYMLawYMa4YQ1gwc1gwhrBk4rBlCWDNwWDOEsGaDfFtmtBTQEot13hKs7W9g9B2GOVMJyKzlMUurC3MAIB6gRO8WKEJA7jAYBEQhEprrJRAV3yIAlAH4NuPS6bnByNm3UtdKY6PQkzD3GrgPRBus7E5/LlugYo4KO32AQZsUqCTk/oX1iCdFE/YaEqz5MLffU1JJwhWaaH4ESUUSZs0KmQtwd2IvA24gfnPkNSAokhdH3rW20NoQwROnBaFBNAhn5qIEBGGE0MHNdWEBwXgozlRUGhnfmGSzwL4x+xbYN2bfAvvG7Ftg3xz7yuwbse8ndKLKwH5i9lNgPzH7KbCfmP0U2E88PVJYc3gCMwnE8iWSL7vGmSqDfJnly0G+zPLlIF9m+XKQL7N85cvzUL7Inj97N0KPZKcGngBVBhkLy1iCjIVlLF8B4Us8Q8pjQEMCQcJUYmp7kDAVPLsYJMxFCQjCCBoQlNnZuZMeXfpUovHYIQ/jb3TrBBAPUKLpKTL29RAA4gFM7xYo3hyJyyEAhElIICG+hetUQwuHYAHBkCS6Q1lzWe5FoXHw7BH3EhSAaR4kZjZto0hEEYeiEUU9yrmBc2Z2LbBrjgpHHwCDNilQSaxfYYWyfpX06wdTkdKzn5PPfk4++zmpYUj05khcDgEgHuBoSqApjBDEuDkKFhCM+7x7JtCYSU/+Uyhjpbg0nmt5LwSdgPuXkJhTODGnhMScwok5JSTmFE7MORdTQEgs0L7XmXNk65ZkXCtiSoeiS8d0paNKL7p0JLp0XnTpSHTpvOjSkejSedGlI9Gl86IvECjmgJBZYhh7yowoLjPiWn4Yf6HbJoB4gBK9W6B4cySuhwAQD3A0JdB0LS6e5uUQMBxNDTQdggUEQ5LkCYQ9AaXQE5cDcS0vVlLcgfYK2Do6eqWvvpkAPVN0rmMDQZurp3r1VK+BauT05ohcDgEQiJwbVM6+FY2GhOEiH9ZIoQgwaGOBihtT4UHkMVUaUz7k3iF70VdTZVgosCuUkA5ROB2ihHSIOwSKFhCMBWL5jOTzjY0qA/vG7Ftg35h9C+wbs2+BfXQLIUvhDgGBSD60/eJsv6Dtl2D7hW2/BNsvbPsl2H5h2y/B9gvbfgm2X9j2S7D94my/sO2npG/ikr6t5Yfxl9siqDdD2tgihBxvOwSKEhCIJDgH9c6Bs9AAADLNScjPtkOgxcV3cvGdXLxkFmga6+LqlXN1JL6CciC5uCg7EMpLJi6pnGBSOQlJ5XYIcdNzi0Dw5vi/HAJAPcDR1EBTGcECAmmRXConLhNKXCYu75pg3jUJedeE865JyLsmnHdNQt414bxrc9ECgpNGmH2WxkgaTwu2VliLACg5b698MUs0XMwS5YtZS/ncwDkTm0EreONqKd8jFfDDIefbDgHlkK7QcKsz3IqGW4PhVjbcGgy3suHWYLiVDbcGw61suDUY7g0CAoF8lBNLXP6qtfww/nJ22XyQbj5IbyTIkpCMaodAi+shAMQDHE0JNF2Li6d5OQQMR1MDTYdgAcFYW45vMjHGRpdSVYlLVbWWaSACgLiToGa59Z479YCeSQQebq5Tp9Wj1+rRa1WCVuXmECwgGCtRWGusRCUl+s7AXJh72aZR7SybS6YlMZmWuGRa0kimJS6ZloRkWuKSaUkjmZa4ZFoSkmntEFAO68pIV/wFkh2yF301VYb5hjF5SK+1Q6CoAUEZIXDg5DOSDy23OcttaLktWG5jy23BchtbbguW29hyW7DcxpbbguU2Z7ltsdwPLwrna5QBSVwGpLX8MP5yBjx5Q9LIgCQhA9IOgRbXQwAIk5BAQnwL16mGFootyJQmNqWUEUdcriNJGL+mYCgTvQ0gIQ3RDgHuL4cAUA9wNDXQpBbPnsRzJGGBhLGKhHXCKlJSkTtPSHyekPxbeDtkL/pqqgxKVlayBiVjSByyDO0QEIjlM5LP6wpi2ORD3FjtHAEnCZKQJEiSC3Dn8j0SgRuawqmEGETlcwPnzNwEcW9eImtwM8FAg6RQtKbJWdOE1jQFa5rYmqZgTRNb0xSsaWJrmoI1TWxNU7CmyVnTtFjT9Qude1I5odwz4nLPrOWH8Zczqdmb1EbuGQm5Z3YItLgeAkA8wNGUQFMYQQOCIkkyqZlNKiVAEZfjRTKdKWd/phyr3XrK7tlijqe92T1bzPHZYgYjmr1hzt4w59YJcW48jszucWRIMLNDsIVbXzsM9E3jw3fbdwiMAA+I0oD4waXJoWHCofkN2WN2CBRDBzfXhQUEY36ZfSP2LUhvX7QCnv0KgMO4HF9zmylIoElCeY6NKoPOjHVmQWczBEQkidGAZmdAMxrQHAxoZgOagwHNbEBzMKCZDWgOBjSzAc3BgGY+Ac7hBHiDQLEEhMIqAQ1RIg5xiTjW8sP4y5nd4s1uIxGHhEQcOwRaXA8BIB7gaEqgKYygAUGRJJndwmaXEmKIS4ghmBBDQkIM4YQYEhJi7BAQ73IIAPUAR1MDTWUECwjGCCkgJNaQsEpYQ0oa8twQLxo0pKwhDRpSHk4N4urNdWEBwZhfZt+Ifd8Y3ErxcWqsdn61uKPYEo9ii4tUS+Motrij2JDuQoqLU0vjKLa4o9iQE0NcTgzhlBBSyIIWZ0ELWtASLGhhC1qCBS1sQUuwoIUtaAkWtLAFLcGCFragY/ErMPnVs8SgAMpRIC5HwVp+GH85A1m9gaz+UX5tPM4KSQt2CLUQD3A0rx7jGjFcrxJ6dSQuh94DhEloIKG+hXILCy0MW5CdrmynKUGBuPwDUin+rT48jtVuGVc4u63eL1V/mFtb9ydqjKgrWP/qrX/11r+2wuXauFCxw3bhw2DQ/YnauD9R3f2JGvxIhfOOmHNBOOeCUM4FcTkX1vJeCNMe3URIoLBDoBg6uLkuLCAY88vsG7HvGxtVBvaN2bfAvjH7Ftg3Zt8C++bYN2IfLXd1lrui5a7Bcle23DVY7sqWuwbLXdly12C5K1vuGix3Zctdg+WuznJXttz0ere417vX8sP4y1nuwVvuxuvdEl7v3iHQ4noIAPEAR1MCTWrx7Pl89nyCrR/8s73G29cS3irfIdDicgiAnklYIGG+hes0hRYJW5DxX99N/tZMQKEh9sqjDiWMF4bq4ZXvHQLDdfEDejkEDGWaGmgqS8lMfgUmv8J4K6uAJ72SRnzvxJwGjShrRING0OaG9653CBQtIBjzy+wbse8bQ+w9+NA8VjufPrjQfIih+eBC86ERmg8uNA8vc8vgQvOhEZoPLjQPb3zvEFAO6QoN/OAM/IAGfggGfmADPwQDP7CBH4KBH9jAD8HAD2zgh2C/B2e/B7LfSu+tqntvdS0/jL/Yfmvn7Lc23lvV8N7qDoEW10MAiAc4mhJouhYXT/NyCBiOpgaaii3QUOr6xubpur7Vv/za64XU6hkWqgw6Apup4UVM5RcxNbyIuUOgaAHBWDxh9nmSKEnjO9tXIdUiAEpsMLTjywfahcsH2vHlA+WXNxlE5XMD50ySBL0oHHgv5Xuksr9/M5dToJJYf6xOI3XyEfEO2Qbn2a+7Z7/u9t3pBrj6JhBMzH1I6JUmldeMUWWYs8Zz1sKcNZ6zFuaswXNP5dc3tUNDPJW48W6Ip4LnDg3xXJSAIIygAUEZwQKCMUIKCIkRckDILPE2Vy28fwiQ8TdOkw1w9IB13hCGeoD4JkpseCa25UK1BNipXw8BIB6gTPEWad4ckYsncvFSweS38JLjDsE++LE2wBCgEcezz1YIYNC3BW7MUbEGN7sVmsspUEmohRfWPZp8W1+6/LbdcBm912Tuvaa1vDAkfuxlG3vxYy9+7KU19hLHXmDspZFJwiR8hwRA2CYQEU/k3KByJmWQiTBxYz+X75HKHo9aeCMKIDtz2xLF12mg2POIrUz+q+PVupX3wi1U3xyCBARhBA0IyggWEIwRUkBYpmA+zOVdIHECCQokQSBhgSQIJCyQBIE2yMIO61cdOworgmsRAKVzqD8zwi1S8ClQ7z6L6t1nOA3f8bvvS2aleW70w4Ky5pQs5lq+Rypy37UHr2OMRbyi/S/3ieGtPH/9+f3j4/h6+F5jywicId8rCSwycm1RqBvaz9f73ZMB2Ax4Pt2OnhmAESA3kDJ/LufqP6gz20VisbcG3xOQeEwNvhOp+BaUDB8FdzKxahNXJagyrjKoKlxVmBkJzAjPD5guiaZLctMltaZL3xpsehAOj3WKP/vLHoO/gERKlobiBdQgrAYhOW5BErBaKegpOT2tt0Sf3n++jzMMErX2B+O0jQsASudQvydFHEt3TIi1AgD7HtovK74cOjDfU614doTYkcCOEDvi2RFmRwI7wuwIs6OeHSV2NLCjxI56dpTZ0cCOMjvK7Jhnx4gdC+wYsWOeHWN2LLBjzI4xO8mzk4idFNhZIfQ1V/yWnuMvMX8p8JeYv8T8Zc9fJv5y4C/v/OUGf9nzl5m/HPjLzF9m/ornrxB/JfBXaDiLZ6cwOyWwU5idwuxUz04ldmpgpxI71bNTmZ0a2KnMTmV2Bs/OQOwMgZ2B2Bk8OwOzMwR2BmZnIHb6zrGzAiCV0ZUT3VlIc2ec5I5m11R95/RDyDDXE2RmeMsSd3881MmyJsiwOJbYTqeOKjnD4gaBogQEYQQNCMoIFhCM+d3Yvz+enjZvfnqijcpe5FgntwKgEElpiAFKKwYo2PPN9w0R0cP758kHEgAjgDaQ1CNJA0mIG/HcTNVP/+P59W2pWX+jLp1uZdOtsG6lFSdJS0fiY5zciHEydnPzHS1zbC2JrxbH9CjE9XT/fn27vB+fxsIUUuwn5FQ+/TrMM62T+98u8rStniZ0BfqJ7r95EbIyzZC8d6jNDhG6gKSJKBHRmogWEVMTMUXE0RdFRIQuoPHeXkRE6AIaE9dHRIQuoKHJ4xB4nDIQejwEzpDpfdJAj6AzaDrDCogEXUDSRBSPOJ8+eESGHj8+Dg8vy4/r+6/91+E6N3LFh5d5A/Jy+D5eLh3aWOuma/Qv18O//f0f6wH34/nYmf7t/nl8m7jg4nfuqJepvc15Q3udS8vxkBzun5Pde3jRKdf41PVJ1sk//zr9Wj9Pupycnl5eD//8ffy5pqP34D9gawA/npfz63lXgJ9t3cqhhbSAkfbP3+8N/kYo6td/wGeDrFaFbQyaH1d1o0p1lUqVZ197bjKKvnQxQFuT9eyXARONrutTQdzkUBPTzYibPd2MdEtGRv/5+vJ+wJDBfzm35y/n9uHDuD187B5ojqr8TgSfjknipNvB0gZrAC+TLgClBYzNw7zaoNKE0iDyA7YdsheDfoyHy33EtueP2PYhbXrPadP7Q5cDhcwUSkAoDiF0QXm/Kfdb53K/reU9dSRZkwZY2mClHnwsKxzLSohlFwgTXsc2QiPuMo0iqmNMQ7+UPHFbQwwRJmKBiLG+RwNyOf4+3Q4Pl+Pjz3kmSttcS9suS9uKSxA5ACMmLBKJigwEtIm62swxODp03W6XdsBe6n11T9Xiq4Wrz6H+TAh69wh6X5ke7WJi7IBM1RaIGRIbSHPbBGGIwAmYuy2wQ7YmzvBJ05xJNFwRCl/zoDxfncvztZb3THO8aOIMCkANQLQHrcm993zrPS+32DEsd2kud/nTyg5pyTpOS9aFtGQ7ZKOLS/8PI+uXvrilL3ghoJODdn4mLBAoSkCQMNLRXKCXfHjpF9+s7Sba9s3a9s3amqLa8s3a8s3anMza9M36J98cUo/tkK1ZMKTatpjasK/zSa8zVDuAW3kt4CrZ24knFLsP+vBmWNsWV70V2wGbctwWWTHK1WDmlMycTjHqgDxsiwGwQ3OuPof6MyGk0H/C/ktq6VgDU4JSa5gkeK22WzNo7bnbGvbJJdZay4020gZrAO8mNEqzd8JGUcEoxskHOBJaxb7WmQZIGppps5lwMwvNKNfbNk9A43OimOk7WY8fvW7fVELpvWVUtowaPgezQY7jqUvTzFnbzFnLnlnLnlnLnlnTnlnTntmf7FlI2bVDGoy7dim0S9guGDxrB5QW4hfjVTU/b3JG0dAoWmMRAdI5NDsTgvj6yLAfDGcHLCyMnZh66krV5qstkAzj6+2z/SkAMf8q8Q7ZO0QDaGQAp21DcfwGbdqZ+8uhv4wI7lt0xt+is/Bxe6O0OnNRAwLJ7L5HZ/w9upDXq+O8XmMxBYTECO67Xcbf7bLw3a4NshgkSsXVuVRca3nPGcdRsbVMurWi4tZS3Lu49b7TW+wBAt3GPIvQnruQ0IXjQQMC0cXw11ruNqQR2yGga3q6HEK01LZYqW2xUisGSy1jkVrGIjVXdmqu7BQ1vkHRZKaW30gtv5Gih5gfmDsDm2h7nLyhTLQ9Tt7S7YDYpVIjDP8ShX9p3Ln0zAGeiQJkvRXgrV1Ca5eCtUtk7ab+pAQVN7XZN0WL0DidOD5YpijlkupcLqm1vOdO84dhqR0RpnZEGKfq3g2bhAQmIbUsUWoZndTcO6emSUl/cl0hI1bHGbG6kBFrh2x0t/FjSM9ELBAxHplze/yQWQ1k6OvH2V/C3yH7Q2gfOOb2NMrt/XFuzc/csgu5ZRdycybnZjyZ/xRPTkJJEJOaBXOa2zY5N+b0fHVmesiwr+IdsJd6Xx2JBim97c3tXe9MT3wHzB6eFAJk1wnP3A2y4+NRIkAmvsbTvw6ZRFeQY/S8tA8EqdpChwYdShe14iePc375D7vFkEiq40RSXUgktUOgmAJC2uVJfoYkmiHJz5C0u7q5JL5aqFp9tXL1OdSfCcEpO7Gy05AJO3lkljQFYgmIZSHFubg08/dkp2IKCAkRSjBkBV0ZZfXqXFavtbxnm/M+K7d9Vm47vj/PMe/KMriy3Iqfc8uVRfsZgMqdSug00gevmJteMf/JK4YsZjtka4YRc25FzCHT2Q6BMUR7pQF/gTy89PI2z7XSNuOlHVqXti8ordC6tKxLadmh0nJ3pWnzS9Pmlz8pvoQTjwInHqXhwOd7lfAuBwP2kvhqoWr11cSUO2ncIDs6mhqATFx3nQzMDFougEDjQI3ZSYGdRO1TYCcBO9oNqFGMv8sfVl0JzqDw4/AStvMbJJDtQ+890smBTm7Q4V3whCShmSBCCQLQo3JK89W5NF9rec9HxyF6aRm78ofz35AlrOMsYV3IErZDmCzYuNK0cf/NUvM2roCNK388MA/px3ZIox2R88fFZQ/6S/NxZ4lx8dqlBiZoJ1DCGfMGaRiS+YpLprey/DahtrcJtb1NqK35Xlt2s7a2CbW5TajNbUJtqq62/URt+4na9hO15Sdqy0/Ulp+oTZdQmy6h/mmehgRcOwSKKSAkpOtsTEiDtUOgmAJCpLk8gaWWLqrmJFdzMQWExAg5IGREcJa28sHpVJSAsDq86gP3SoF79YF7pcC9+sC9UuC+lM6h/kwIuO8CyKTcrkt9ZuyATNUWiBkSE9uxsxc8k+DZC55J8OwFzyR4ZscOECjeAwLwmrsOR7GEYS48zPyJ6B2yGFhKf9a59Gdrec+x58P+2t471Jb/qy3/V//g/0KutY5zrXUh19oOYbLg/2rT//03dsX7vwr+r/7xgltI4rZDtnbe0VUK9IdwSjXAKdXQNtxD23APbcM9tAz30DLcQ8twD03DPTQN99A+vxn8SfdAJ92DP+ke6KR78CfdAz3TG/wzvYGuJAzhEdrgH6ENwWkMeIg9hEPsgQ6xBzyrGcLh0BDC6qEVDwyteGD4U4Qb8ojtkK1oYV5Zo7M4r0JYM/zxEHYIF2cHvjg7BPc0wEZgaIU7QzOwGWJgs6wnyvrVuaxfa3lPR8eWamhZquEPliokDdsh3MqPlbdfA9ivoWmphj9ZqpB2rOO0Y11IO7ZDmC6G5EPTUg1bSL68JOcNUQBLG6wBvM17B5QWMDbfDZGHShNKFGBxImQxN9M7LWisALCXxFdza/XVytX3UH9f+ek6KZWwzSMbV59D/ZkRQm+GvQ342mNXaHLtEChaQNiPsXpK/dS71E9rec/s5qIM7ZpRhnbNaatdY0lr137U1odMUzsktFJuJaFV5Gt/Oq9dKyTR7g+Xq/qQwKrnBFZ9SGC1Qza6cAKpblLDyPArr878B7C0wRrAfjWzF3PA2Dys5rjJ7zu/ySfIw4su79VI7x5GASC8JtB8d0CJkHhCQtXqq7m1+Wrj1vfQ/L6y1HXdwNiw0BGyF1Mgl4Bcv29MJbxauUOgqAGBXpDgibJ8b5yeEwJgL/W+uqdq8dVMHFUmpLLxhn63Xvdf254DtTMhWCBnSG4Y2lfa6ba4e1QhYbYHYM9fZO/DF9n70IpWg/sQPUFiszaxdaKqHzOlMVM/Zkpjpn7MdkC8T8pd4kgqjaROqhfu4hz6OBOCBXIG5Pop4SffVeXvXfMgxvvsy9cuWVc7oHHxq2+DmVjvifVULb5aqBp1aKRDm1aDMbFzoHYmBAvkDMkNPX/nsw/f+XQIEhD4Y7dkQBi83+mcvqtIWk80Q5PXYyI9Jq/HRHpMQfBEgqdJj5NW90r12MrV51B/5s9KWvispBGFFPhJyM/A32TkqZuaqz/9yZSkkJE6wWe80x/sVg5SZEwW57+vRhB+nEt7JffNNYJAUQPCOgB5im9hruyAvdT76p6qxVcLVeNcAcgk1Ri893dCV4/NrOJcyfTwbymm0F3C7moNGo0P63H8Gs9lVvmKX0mFVlLxK6nQSip+aRRaGiUYrEIGa0pAtd6yWOrMIxtXn0P9mT96ZeGjV0whBXYSsrO+br+8hA+f/OjDR0B6RgifXlnfQp8+qkFTtNIUrX6KVpqi1U/RSlO0+v0lQqYjya7TnrHRLQBkL1ogZ0hO6n1KbrC0Gby5HtBJDu1j5KE9fYfW9B3arx4s/fS+Y64WXy1UjZobaH4OmweEtudA7UwIFsgZkOv7zB9GsPBhhG1/Y8v8mLKZo3oBsKePJoVp13AT2thpRahSp73vtKdq8dVtmtwIFI6QqdloEJgDUDhCIA28hcTwRhQs9GfYH2WmdiEOJj/fihIQhBFC+vXVV1nvRhIBWy5kTMbhgdICMvXeU++pWnx1JLlOgwjtm1DhLMcashwzgzD+BJlKXa/UNb6KuDJ8DiKcCcFCB4YdpKjuLUrfs/p6W2N+p2u00zW/0zXa6Zrf6RrtdC3sdAkylWR2lczh/iKqhe0vQagVvJJgYVNMkKXnfkAa25gwRCjNsVBianE5lKWta2kJqC1gT9RvPvG1uCzUblrLHw7uLeyydwgUNSD8Ye4ot7PQzlhne0J90yX/2jgifsOOgLHQ3G2a38cjgFrtxkZbxkabxsYfAyCA2oDd+NPLplNb1qqi3QinBwSZStI3uqb1Gw4VEAKdWmDDiIIFNgzZmD84srLhnq/YmlH04SX1q59PXA8LR93C0cOfhCRVuuWgFKvOxUD21h445WYamjkECwgW1CEs7pmTic9zfv4NsxcBe0l8tVC1+mqlavPVxq3vofn++Ff6zKxYwDbCdknKj5x1+8ipvEPWcvfxSz5prOGAyz2ApuTW0kh4HZCsgbRnjf58/fn1EPI3E5Qv/e3puKzDlFZriDv9PHPN2eU17u6Ae2fcPS2WiOzZZIzy1FgHFWeuoRzGnc9hvHUt3LXsXU9uUvOW8wC71r1r5a6VulbftULXyl3r3vVkdsr+Djd2bXvXxl0bdW2+a4Oujbu2vWubDO+wvfqHXae968RdJ+o6+a4TdJ2467R3Pd4p661ur2gYvYliHVScuQav3LuuM3Sdueu8dz0eP81R5JLVt8PL1oYVZ66h7MGdzx68dV2467J3XcDyTBl86TabdVBx5hrKFNz5TMFb15W7rnvXdZJ62G7IYNfD3vXAXQ/U9eC7HqDrgbse9q4nC1qH7RE3dL2W1p9nrjljft/O5/ddu8ZKLM7Py6VP5u1j37CPfXiOEF7q9ke0jZQRbOTx0VNtH5i0LiaPOSr/1z+6JYOkbRkkt3y/94/J6fyfCfXH//yPH/+8dkvD9f8U84//++X/Wp+W/0v9lLPyfjqcj9fT1taWuqVtp8v/BT5lA7nvXXVLdV3Kaxd5Jv1xfP2vDRdh/fz7/vt4n+rvp8Pl/fN1hU8sKfxG/PX36zuhjxz+c2O8X4T7/fWwUf359fYKrQFhYWFMvbuyO50u3K8r/sPX/ZN+L03G4Vvh028Zx+bX++vjaRydJeVj1/V7/seuE3hwzDWKNYI1hjWKNQlrDGsy1iSsKVioiJaxZoBC3yEaEuh7rKlYQ5IOUOg7REN5epS0R+30KGmP2ulRUqZWsMb2V2m6/Z1XKCQsFByFCjXTZZwNbYjUBKkRAUE0RWqEpsiBIjXFTmVPeOe4tj1FSbcnx4KCAIGFA+o0IQHqR5EaEaBOCU1RbEN5DMU2FE6RmiEHhqQNOUjYT8I2CTulmowcJOSA5EmonYxoCQlkbJOxn4K8UU1FeYhR4q0gB0StIIGMBaqpyFvBQkV2BqwZoGZdtIaFhNQSUktIIIU2PS2ZioUBCn2HBVynvaBCsNOepjJRI7NBtorQcM31aFSlA9KsEFpmpLce0ZADQfsmaBx6XCU9Ttie1lzGQsECCidoE4WWDNp4oalcsTBAYRW7onAVhauoxIryVJRn7hRFYNK0zKhQsFCxQPKgmxJSyICd0qzC9UNuSqmAI6ckdsHB0v0Amz0Gz+uEaOg+elynTA0ned9jDU5YpTbUD/p6NawpWEC9KREYoMCqyliDvPWCBeStRw5ohig5cYoCqB+KAlAEjgIq1mDw0+PcURIbYxfBSIhWsHVIGqkZxkiCOhBsI6gqRkNVCapKcEgEFSKoA0GxBUdOkQNFDhQ5oIlE04UmBQ29IgeKHChyQHoz5MCQA0MODDkw5MCQA0MODDkw5CAhBwk5SMhBQg4ScpCQg4QcJOQgIQcJOcjIQUYOMnKQkYOMHGTkICMHGTnIyEFGDgpyUJCDghwU5KAgBwU5KMhBQQ4KclCQg4ocVOSgIgcVOajIQUWzYehpDT2goYE0aoM20dB9GNoDw7W9zp09DN8KggXFgmEhYSFjoWChYmGAQo8c9MhBjxz0yEGPHPTIQY8c9MhBjxz0yIEgB4IcCHIgyIEgB4IcCHIg5AEx9u9xL9PjFoEDJgy22Ttj3NtjyLaGeYpRjQXS0sMN5I4KggXFNlSDXItiTUIOcDfVG9y9pc3d6hsVOdCwHVsdpYbd1OooNewBe9zYcFBS4d5pR6HugDWCBcUC7rP2zI5+oybEKO5lBDsV6ge5FhoFFI5J00YgY5BFgRltOHCXI7jLkR4ug9IxgwjWUEGxYFjA3aEQWkaucXfY49ZqHZKMEzaHo4k9CxGwQ7v3jIrPKE8OO3HB7b8YopF6KaDFs5oeN9/rkCQcuYxjWlAHBedoQbELKr6gpHSGUlBvBY/cShBhTzXiN+xCnVaswW2sEAc0q0ij1Ckem/R4RMXbMdwmcQ1thnDXJrgdE9zpiezXCrd5XVGEiuqtqN4aTn5YBDzj6qkGj2dWKzbErVXBGsECka5YQ/2QQnC7vHCwFPB4RpC3RW8LGm7Ll1FYCsN+n40PF/d373YRtAMlahdOv3h8cLssRJocMnp0QY+u6NEVPboiAUWPrujRFT26okdXjKsS7YwwSkt4eix4LCy4BxTc9gnu9AQ3d4JbOMUtHG3lEx7BK0aQCYPGhEFjQg6URCBJkR0lasQbCqcYj2bcYmfkOiOjGTnI2E9GrjORRkYzhroZQ92CHJQePW3BAprbHm0iHegX5HraVjzhkfUTHlk/4eH8U9f3WDNgTYc1GQsFCzVE64prQXEtGK4FwzaGa8FwLRiuBcO1YLgWDONr2mMUHLmCI1dw5AqOXCECOHIVR66SPSDvjAfGgsebghxUjIiFHDLZRAy2BbmuaIjZA1I/FBpiVCN4OikYx7MIJClZS7LXpIMB2SGuiTeKLYkddB+sHTwnZ66pgFuR9dhR0FYZoikqceaN+sEwQnFMFXc5FB4rPvJR3DxQrCy4SRFUiKJDZsXT+OBOQnFWkR2tFDBRG4zSBHcFirGyYuStNN8w3FcM3RUfAiiexzNpjLwVI2Lqh0njVFacfCSP4jM9poaxsmIopRiyKYYEPKYkD85exQCQSdOSoQJFG3g4Lxh18sLASIhqWAQkrRhXkd+uRADXwpoLeIgKwVWiuOoVd4fkgwfcb9MjhQE3UIqWYsCpPOCOn9EwtqS4io4qK7qP6ezpiZ/GLtQyOj1Br0loBZ2roA8mtIpoJA94mb7rsNBjQbCg6J2pxtA745MuxQBdqQZnouJDdUVnpDjf1qGvMPRLDU5Ymv5Gk29ANHxuZmj5FB9uGc5rwx2Y4Zoz6pSEw52EoStQMqr4BFfRsSg+3GJXQC4HqZHLMfQYZK8ND+O4UyTNBPAZv6F5Mlxmiu6D9UbykKrQFRi6NiaAe3TFXTUZB8OHdYyGx0CGXsbwtMjIxlOn6J0NrbLhjl/RAxr6EkN2jPwPkaYxRZ9lZCDRDLKqSFJcTEbDiCGboUkzdG08JOhpDR81G1kXjKIThuEJw/CEpjNhGJ6IANlRDMPXjVrFw56MuxwNJ/XrFk7DsX2mvSbuT5X6yXj4i6QzSppR0oySZpQ0o6SZqNFGjTaeJAIdjiQ8aUQRrEMRSOyK8hQs4IFxj+e9fY8cIDt9hwTwXLmnk1PaeNKBZEU0PM3r8RiVN6t0VEltcFL0pAMa0wGVSOdVBU9xErTp6eSH2uD+NOP+tOD+tKAS6W6e4Vk01+CsKnjuYorU8DSPCRgOCU7LQgV8dNHjQ4BV14IaTWEYezyy7vHslo8DUfGs0YIikKR47mL4iISuJBoeLjI7JCk+C624MOjBaMUxpaekFWO+gQYYn58OaBwKWcuMBdxwGAVm5FgMazCMMAzD2YmTYyG/gI9vyLUldGAJY/KEu112H+Tr0bUl9LQJfUnCzaphvGPo3vE0r8eLLD09YmQd4N7MiAAGtD35RgpKSASMVBOGEQkj1YR7DMMgmNw7RQHsafFExjBKM4zSaBQS6iBhlJaQdMKNTcKhTxShkBJxT2u4bzSM4yn0SPg8y6hTPBhIOEcpkEmK44MzvqdhxMUkiIYbzx4vFvR43tvj0WuPZ3Z93d6rhDNIxRsDijcGFG8MKN4YoDiEQg9Fj6F4SUDxkoDiJQFFK6Z4SUDxkoDiJQHFSwKKlwQULwkoXhJQvCSg+ExC8ZKA4iUBxUsCipcEFK86KT7UUHyoofhQQ/GhhuJDDcXNt+JDDcWHGhRFj6804bNd2fa0BWsyFmosCBJQLBhSI9KKpAULRCBhP4oFQzSSp2A/hqQNCSRsUxGNagYo9B2STljISIAKBTvNWChIGkehJ1UVpFaRQN3iA1kfDi8FwYJiwbCQsJCxULBA/QxQgAhF1phiKSAHPXIAhkvwLRLBAxXBJ56CT0k9mmENzp2eptgABbjNvbOTcRQUO9U4eysWBmQnITVcGPtH04HRPszeHucO3J7xkuLKAgMpaJUFrbKgVRa0yts8EIWJJAULAxYUppgoTDEpWDPEAqEp1hhSM0SjmoQ1CQlQIWObjG0yohUsVGxTsM0eBAs+eBO8Jid4TU7wJrPgxlPwPRbBm1eCV5D2GovTnyTdTwCdCYCbcYIvUQneixa87y/4vozgeyx7zQATtu/CaoQQVPCRqeCORfBFMrcWesUaQ3YMVUWMJqwhrhWVKFhjWEOmBidF32FNxcIABULrccnArRZniHtSomEBrXJPky+jqnCKweU+j5axpmANFVC4Hke7p/Gh6VKxgDXwfongZTjBV0oE3yYSvKwo+P7PRqDvsI3GQkE0KlS0sOhPewwjeowCeowC+gHNLQU/VCNQA2+E7G0KarRim0m90qFCyPpXlAeDEumQa/QlQp1i8MMcUA1GNVzIOD40XQxraGGg3RG0fDR7hXSgiEYE0B70OMmFplhBDkgh1A/NnQFE4OWME4nsm1A/OD40ySmm6DtEEyygEerRrJN61+miwbqwqtDGC0YocIPI+QUl94ExH7ODcaJgACjETkGu0Sr3ZHtJuIQ1xBsaBxp6RfOkhsIRGoU4FZVIgcyANUQ6w/js33sAAkMYRiFXgPEbzUTFiSTUKS4zwSWjuMwEVWU0wGjjDR2ykQ/G6WLIgdGaQ4PPNpFEyOiQKZgjeQpQE9xakTOSitQoACQdoP9hy4doihZWaDFhoLke5GpcwTiReDWiQYEL6duk6LtoKWhfgqaGzfqWgXWPBvu45gQ30rRoBTdDvGhxoyaK/QgW9iuw7mCAzLqQY8kwCoKbLrgB7oPgjJ3i3IGnFYLXc91hguCmizyGkJ/DUwJZbuBJOA+ZVtZT12usydhGUB4qEG9UMJQU942SsIYUUrCA4crKjoXjmX6+AdGnWDNAQTBcWRWyB84bAVI87kJFcLBwAYpigdrgcu6JALXBOHEdkhx2U6sOSqwp2AY3D4ImbbIhG5oiNcE5WrBA5mmAQo+mRjuswRnf46IVmpZ4QCQYEfdkrzFSFTwgEgwwaC0o7iiVwhU8r+KRo/mGelMygxSckhFK2Cl6QMPYkryMUuSANl7RHRpGG+RLhCa5AaNkkRQjO0MTLej4FYNTuGzlzCAFC8woKYS4xmmpOA8U41FFX5/QSbCkOCkUHZhQAeMqirwVp1iiNrgvETw+U9Ionpgp2h2KvAU3d4KOX/OYkub983y6jSlpLqdfp8v78/P99Pnjrx//9fE+Jkz6r/f367+W/79//PXj9wz+1/zv1+v91/HydZoz4/z468fz6+Vy+Prx14+vp+vx/nOFPI0peF7fXi6nKXvT9Of0NnZzuY+gy/v7x/TjPpMaf30eXybsp8PDy/V9bHM5/j7dfvz14/M29diPuTn/Me7ez8fb8fFzqns+Po511/vL9+v4ge332+vL69vv7dcoy+k6FZ+mBqfr++fr+4j6fX79HNu+/zrdHt8v72Pt+8fx8fVzbP55fHk7Xsf6z9fp339+HX+O/2/vn8ep3f3z/WMFXt9/HWYxPn4fZu6f/3Z/PHSHj9t0Fe48C37eJH843k9/W4V+eBnH9jwSeHp+fXt+p/b9WpLDknvodBWCcUmpZFRKVJpTWX/PedKfjm/X0xvVVyoNWJqM8V4iHnvipyd++o2f8eHcmi/y8en9+239/3i5e5yzAywpNr/n5GBfn69vHsG30KMHeAzzGOYxksdIDkO7owcQxpo3kgAeQzyGeAz1GOoxzGOYx0geIzkMJ4t4WdTLol4W9bKol0W9LOplUS+LelnUy6JeFvWyqJfFvCzmZTEvi3lZzMtiXhbzspiXxbws5mUxL4t5WZKXJXlZkpcleVmSlyV5WZKXJXlZkpcleVmSlyV5WbKXJXtZspcle1mylyV7WbKXJXtZspcle1mylyV7WYqXpXhZipeleFmKl6V4WYqXpXhZipeleFmKl6V4WaqXpXpZqpelelmql6V6WaqXpXpZqpelelmql6V6WQYvy+BlGbwsg5dl8LIMXpbByzJ4WQYvy+BlGbwsg5NljPlIlgngMcRjiMdQj6EewzyGeYzkMZLDYFkmAGJI72QRHwdI72QR7/fF+33xfl+83xfv96VfPo5JAMLwXl28Vxfv1cV7dfFeXbxXF+/VxXt1Ec+peE69zxbvs8X7bPE+W7zPFu+zxfts8T5b1HOqnlPvkcV7ZPEeWbxHFu+RxXtk8R5ZvEcW85ya59T7W/H+Vry/Fe9vxftb8f5WvL8V728leU6T59R7U/HeVLw3Fe9NxXtT8d5UvDcV700le06z59T7SvG+UryvFO8rxftK8b5SvK8U7yuleE6L59R7QvGeULwnFO8JxXtC8Z5QvCcU7wmlek6r59T7OfF+TryfE+/nxPs58X5OvJ8T7+dk8JwOjlP1Xky9F1PvxdR7MfVeTL0XU+/F1Hsx7Ryn2jlOzbsk867AyBWsX0ggQMBQDyBbuAIII3mM1QY9vf98H7MRj9vz5Tjjerp/v759/v44QX2C3wK/FX5vG/fiN+XF72SL3w4Wv6cqfmNSfHRffIhcfJxZfLBWfMRTJ07TPoorADDuj6enRX1P73+/HX//++NxOrc6Pv3z6/759+P1egzYob0EnOWrJMsXDib9jKdHo3anb27cpul4S9Of+46rGy4BxAPUAywAzh4y9XMbT25uMzMTC9NHMW6TTNPHPm42/wSmxpG5z9+rYUgfIBIh5wDSCFl6m5P4I22AzJ/v+PiYz9rGH+tZ239+ne6fh+txPOrr++Wg8PL+60QnWGU+NRI+pBF/ajOv8un48fBwOT7+5IMQ8Scj4k9GxJ83zBjn63E8j/w1/4MtvPg9vfg9vfidsvidsvj9p/j9p/hdnfhdnfi9kvi9kvgdiPgdiPi43tlMHwubj4XNR6nmo1TzUapRlIofoiEze/RmFhftkk////1/hnKiQQ=='
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
NEXT_GAME_PATTERNS = [
 ('天結いラビリンスマイスター', r'天結いラビリンスマイスター(?:\s+v?[0-9.]+)?'),
 ('Remastered', r'Remastered(?:\s+v?[0-9.]+)?'),
 ('RJ01646655', r'RJ01646655'),
 ('RJ328940', r'RJ328940'),
 ('RJ01271506', r'RJ01271506'),
]
def next_game_label(name):
    import unicodedata
    name=unicodedata.normalize('NFKC',name).strip()
    # Keep bracketed RJ identifiers before removing publisher decoration.
    for label,_ in NEXT_GAME_PATTERNS:
        if label.startswith('RJ') and re.match(r'^(?:\[[^\]]+\]\s*)*\[?'+re.escape(label)+r'(?=$|[^0-9])',name,re.I):return label
    name=re.sub(r'^(?:\[[^\]]+\]\s*)+','',name)
    return next((label for label,pattern in NEXT_GAME_PATTERNS if re.fullmatch(pattern,name,re.I)),None)

PAIR_ACTIVE_GAMES = ['RJ01687472','RJ01610188','RJ01660877','RJ01474142','Night Stroll','RJ01664771']
PAIR_GAME_PATTERNS = [(name,pattern) for name,pattern in [('fuyukuru', r'fuyukuru(?:[ _-]*v?[0-9.]+)?'), ('えどわ～る', r'えどわ[~〜～ー]?る(?:[ _-]*(?:ver|v)?[0-9.]+)?'), ('meshiagirl', r'meshiagirl(?:[ _-]*(?:ver|v)?[0-9.]+)?'), ('RJ01687472', r'RJ01687472(?:[^0-9].*)?'), ('RJ01610188', r'RJ01610188(?:[^0-9].*)?'), ('RJ01660877', r'RJ01660877(?:[^0-9].*)?'), ('RJ01474142', r'RJ01474142(?:[^0-9].*)?'), ('RJ01664771', r'RJ01664771(?:[^0-9].*)?'), ('Night Stroll',r'Night[ _-]+Stroll(?:[ _-]*(?:ver|v)?[0-9.]+)?')] if name in PAIR_ACTIVE_GAMES]

def new_game_label(name):
    import unicodedata
    name = unicodedata.normalize('NFKC', name).strip()
    patterns = PAIR_GAME_PATTERNS if RULES_RE is not None and RULES_RE.pattern=='^new-games:fuyu-edo$' else NEW_GAME_PATTERNS
    for label,_pattern in patterns:
        if label.startswith('RJ') and re.search(r'(?<![A-Za-z0-9])'+re.escape(label)+r'(?![0-9])',name,re.I):return label
    name = re.sub(r'^(?:\[[^\]]+\]\s*)+', '', name)
    return next((label for label, pattern in patterns if re.fullmatch(pattern, name, re.I)), None)

# Exact read-only verification ranges derived from the received native indices.
NEXT_VERIFY_PLAN = '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'
AGE_LINK_PLAN = 'eJyl1s1OGzEQB/B32XME9oztsbktgaSRSEAk/VKF0CZsKBIFKUAlhHIo6QNU6r0nLvRa9VCpUh9mVfU16kDJepPYVJgTYjbRj5n1f3yV/L65/fP9U/HhYzG5LSafi8nXYvKtuP5RTL4U1zfTX65/FZOfydpVcniRjQ7OkrU3V8nZ6cVokCdrSfd1V7Q6rZX1ViepJafD4Vl+nqyxWtK/PM/ts0KhRl1Lzt5mIJX9gMxRC8yzAWRcocDhIO8rnjE8yAkPpNFSs75SAw0iQ4B+P+vz3PQJB7nipCkZ79WSUXZymM9JNtJeylfSrYZ13P9x/Z7ADWdKSaWgBApSEpiUMydn9hnrzEbnR8NsYB9J9vff56Oj4eVqdpivdjvM/vz7N49PD48G2XEne3fXArd0Ojo4OsmO7ReiGdeeyuNacUXSMFEChRAhnh1Cz8NzSjMegFE8FsiMUeWkDQv0r/3cC6yUKkAWCZRgSDkdRBVoYb3pFVZKrlDqKCEoZQw6wulQVIDY9RO7HiJBHJGMkRJmRFuHwJjrdb+w7hNi7JiZEeVBAYbgBzb9LWz6Wigp9qCQ4uBEjQoJG6lXWClVTkpsCxWhKEMb7SOBrNnxZ82Or4VRYai5jWubsTOg1IF30KtbakMmomLG2qTdS05QcwQW1oGXB0t8GBUyUiOBmEbzQ+944OWbGpppe9MLdIrufJmI7KFNGnfZIapADzvbLza3lhLdSmXGUSmogRNyLI8wkNAB37RJ3V6668mZuWrFGRU1hEoTYDlrJB46yc/a2xvLR+1WXB+POsfWZxcKlecYhAhduupNL7BSqgijTgshCUnMudUICF27NnvtzfZ2a3d5Gs5VXSbEXL7seRYgeTlmoblh6HeuN5kUabqSNhsLymptZqSIN1GQsW8KoXM3tPd6wx8FboWEW/NE+24/3WgvX9qAJGctcwkykI31LmOQero4V3SyMSJ5ptcvre4mO1sunGymh5E8hORLkFwJLWPGTRJs7syUpBAD8Vhv3PVqe7mxWiyNMWtakLY7SjpCMKElPUVw3+s4V3SEi6MWS4XS2NhjcrriHoRAkkG5ACWiDOROo5XaLqmVVy/bi5fESs3RLSbOf+sQ7C2iXCuKy8d1FNDRog7He+PxXx1w6tY='
BUG_CASE_PLAN = 'eJy1lF1uozAUhbcS+bkE/5vbt3YB3cCoiq7BJpYIqTCJVEW8dNYzmsdZUDYypplKVFVGahJ4AP9cDud8tjmQ49uf489fx7ff6b5nS0buFwdS77CrYmr+OJC43XWlS23y0JXrsHcxtxjdqgp7usLT0DI9yd2CbL2Prk+1jBpRaGDA06h97d0oBkxIlfpxjVzpUZEXoJxl3DGloPIgpK6U9tYA54Xl1lng4LkBWSL1pZWGoYRKAaDimnEyPCe9DtvaXeD2VPv4z91oGTRVwnwKooUENgnBJZepi10fPJZjCVmt7K6OeVyHbpu/eJujrUb9ZluHEpsn3Lwb+pgZ7hYz+KTKGCq5LiZehWa6gP+5DZs67zF9zeWxx7YKbZ29z2Qeu1PNaCujYnkS/Rrr2xJz5S8YSxtFTPKzdNEr46f3AjYZ5VnchMZRfg2Ic2KzIdFUa4DpllDaKHEZk9alHG02WVJ6AYzzKjNR0FSmw8E/HWIDqrgewsdyiiyW2LmKsit5nBWcD02R/rVqioYpoW6HRmcvGFq/a27G5qvi8DwMfwH1AzeV'
FOLLOWUP_PLAN = 'eJyVUk1rIzEM/SvB59JItiXbvW1/QA+9LiHIX9NAswFPEihh/vt62mWZJSVkQQdZepbfe/JFvZa9jMfSSlZPq4saTtLy2NOfFzUeTi2VnqsfLb3tzmVcn0sDyPgoLamHlTrUOpZjRyA4y2jZhF6NH8cyjyBvtO3n8U008TzHUEy5Qo7OREyWsimaNCGkyslCjBSD8ZRjTGJDLuKKBQHbm9WHymp6WN3gBd/xMo7JBFjy0qj5H15SI8f+vEFmSikEFm+h+lgYdGWQArVq9pBNmBvVMrheNTXrhKmqadPnNfk1lLu9+0I8/+H0aaDTgc2SvkZCDhZowd46xjDbLO24q5JmnNpu42kY1+3vMte7/bBOYw8gL+Xx63a/9X4YdkneX2T/ye5b2G2X/0sBgnXWGzLLBaD3xhLfpaGceyCxyE0NV7A7f8qVBuPRddOXGliTDaQNLiRo9EzuvjXEOQAw3pZwBZs20/QbF9YXHQ=='
def bug_case_files(items,label,followup=False):
    """Only evidence for reported scenes; never execute or write source files."""
    lookup={e.rel.replace('\\','/').casefold():e for e in items}
    report={'game':label,'sourceReadOnly':True,'files':[],'notes':[]};used=0
    def read(rel,offset,length,expected=None):
        e=lookup.get(rel.casefold())
        if not e:raise RuntimeError('Missing scene evidence: '+rel)
        if expected is not None and e.size!=expected:raise RuntimeError('Scene evidence source size changed: '+rel)
        if offset<0 or length<0 or length>8*MB or offset+length>e.size:raise RuntimeError('Scene evidence bounds: '+rel)
        with open(e.path,'rb') as f:f.seek(offset);b=f.read(length)
        if len(b)!=length:raise RuntimeError('Scene evidence truncated: '+rel)
        return e,b
    def part(rel,offset,length,artifact=None,expected=None):
        nonlocal used
        e,b=read(rel,offset,length,expected);name=artifact or e.rel;used+=len(b)
        if used>16*MB:raise RuntimeError('Scene evidence exceeds16MiB/game')
        if name.startswith('/') or '\\' in name or any(x in ('','.','..') for x in name.split('/')):raise RuntimeError('Invalid scene artifact')
        report['files'].append(dict(source=e.rel,sourceBytes=e.size,offset=offset,bytes=len(b),artifact=name,sha256=hashlib.sha256(b).hexdigest()))
        return name,b,e.mtime
    if RULES_RE is not None and RULES_RE.pattern == '^new-games:mz-templates$':
        if label!='RJ01271506':raise RuntimeError('Template round may only collect RJ01271506')
        for map_id in (93,94,95,96,97,98,251,252):
            e=lookup.get('data/map%03d.json'%map_id)
            if not e or e.size>8*MB:raise RuntimeError('Plugin-declared template map missing/oversize: %d'%map_id)
            yield part(e.rel,0,e.size)
        report['notes'].append('Only the eight maps declared by the enabled TemplateEvent plugin; no media, runtime, saves or other games. These contain the CG initialization/caller templates missing from ordinary story maps.')
    elif label=='シロクロv1.1' or followup and label=='Remastered':
        plan=json.loads(zlib.decompress(base64.b64decode(FOLLOWUP_PLAN if followup else BUG_CASE_PLAN)))[label]
        for guard in plan['guards']:
            _e,b=read(guard['source'],guard['offset'],guard['bytes'])
            if hashlib.sha256(b).hexdigest()!=guard['sha256']:raise RuntimeError('Scene index version mismatch; refusing stale offsets')
        for r in plan['ranges']:yield part(r['source'],r['offset'],r['bytes'],r['artifact'],r['sourceBytes'])
    elif label.startswith('How to Build'):
        e=lookup.get('data/script/'+('30_8021' if followup else '00_1250')+'.txt')
        if not e or e.size>128*1024:raise RuntimeError('Requested PAC scene missing or exceeds128KiB')
        row=part(e.rel,0,e.size);yield row
        # Command names/numeric IDs are ASCII; preserve text bytes unchanged and
        # do not require Japanese/translated dialogue to share one encoding.
        text=row[1].decode('latin1')
        ids={int(m[1]) for m in re.finditer(r'^\s*#BGSET\s*,\s*(\d+)',text,re.M)}
        e,header=read('Pac/Game.pac',0,16)
        if header[:4]!=b'\x82\xcf\x82\xad':raise RuntimeError('Unrecognized PAC header')
        count,start=struct.unpack_from('<IQ',header,4)
        if count>200000 or start!=16+count*272 or start>e.size or start>8*MB:raise RuntimeError('PAC table bounds')
        _e,table=read(e.rel,16,count*272)
        wanted={'data/graphics/bg/%04d.png'%i for i in ids};matched=set()
        if followup:
            cgs=list(dict.fromkeys((int(m[1]),int(m[2])) for m in re.finditer(r'^\s*#CG\s*,\s*(\d+)\s*,\s*(\d+)',text,re.M)))
            report['notes'].append({'sceneCGs':cgs,'sampleLimit':4});wanted.update('data/graphics/cg/%03d_%02d.png'%p for p in cgs[:4])
        for at in range(0,len(table),272):
            n=struct.unpack_from('<I',table,at+268)[0]
            if not 1<=n<=255:raise RuntimeError('PAC filename bounds')
            name=table[at:at+n].decode('cp932').replace('\\','/');key=name.casefold()
            if key not in wanted:continue
            if key in matched:raise RuntimeError('Duplicate scene background')
            off,size=struct.unpack_from('<QI',table,at+256)
            yield part(e.rel,start+off,size,'__bugs/pac/'+name);matched.add(key)
        report['notes'].append({'sceneBackgroundIds':sorted(ids),'backgroundsNotInArchive':sorted(wanted-matched)})
    elif followup and label=='RJ01271506':
        for map_id in (16,62,72,82,116):
            e=lookup.get('data/map%03d.json'%map_id)
            if not e or e.size>2*MB:raise RuntimeError('Requested MZ map missing/oversize: %d'%map_id)
            yield part(e.rel,0,e.size)
        for rel in ('img/pictures/busts/bisty/normal.png_','img/pictures/busts/bisty/texture.png_','img/pictures/busts/bisty/texture.json'):
            e=lookup.get(rel)
            if not e:raise RuntimeError('Requested native actor asset missing: '+rel)
            yield part(e.rel,0,e.size)
        report['notes'].append('Five native Bisty story/caller maps and one complete body/atlas pair; existing CommonEvents/plugin source/still samples are not recollected.')
    elif followup and label=='RJ328940':
        for cell in (0,1):
            stem='www/img/parallaxes/_lize_scenea_%02d'%cell
            e=next((lookup.get(stem+ext) for ext in ('.rpgmvp','.png_','.png') if lookup.get(stem+ext)),None)
            if not e:raise RuntimeError('Requested native parallax missing: '+stem)
            yield part(e.rel,0,e.size)
        report['notes'].append('Actual CG background and its next variant for the Map081 continuation, not unrelated sample images.')
    elif label=='RJ328940':
        e=lookup.get('www/data/map081.json') or lookup.get('data/map081.json')
        if not e or e.size>2*MB:raise RuntimeError('Target Map081 missing or exceeds2MiB')
        yield part(e.rel,0,e.size)
        report['notes'].append('EV004 replay transfers to Map081; read target pages/automatic event conditions before choosing the continuation. No saves or game execution.')
    else:raise RuntimeError('Unrequested scene evidence '+label)
    report['sampleBytes']=used
    yield '__bugs/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode('utf-8'),int(time.time())

AGE_CODE_PLAN = 'eJxtjsFKw0AQht9lziHNZjebbW4WiuSSSy+KlDK72cRANbBJhRJyMOsDCN499VKv4kEQfJil+BpG1IPF2zDf/898HRx2+4+Xe3d75+ze2Qdnn5x9dsOrs49u2H0Nw7uzb5B0UG7Q5A0kFx009cYoDQkszhcszVJ/lmbgQV0UjW4hCTyQ21aPWcapoMKD5hLDiI+FSFPBqEYVIuGU0UJpyQkGNNcxzaOpiEQgOVciZEjDUEqURE9lTJXmJBYx9EsPDF6X+sjk5HTuz8/mfm3K0eR7PfuRYJRwwv/1+0Vo2qpANUJYrW60qYrtBEs9+Xt2XZeVwnWGV8cv+2XffwIV3nMb'

AGE_DISPLAY_PLAN = 'eJytl89rHDcUx/8VM+QYHL0f0pNy2/U6xVBMIFAoJRjNSOMa0hrWTiGYPdTbP6DQe0+5pNfSQ6GQP2Yo/Teq3djbmW1nNVDdtKs3o89839NXT3fVn+8//PXbj933P3TrD936p279S7f+tbv/vVv/3N2/3wzuP3brP6rnR3fV5Vu/DDdp+NVddXP9dtnENK5effmKz87Pjudn59XTo+q6bW/ibZpQ6Uf97jZuHmBDlmz64+Zrj9psHtORLFP0DXowxNQ2sTbgFYUoFLSz2qramMYie0Ksa19DdLVQEw2IlWr19KiPMXv58vR8oeB4Njsb5QClHQwwXNtGDsFbx23QTajr1kjjUXTtgjfBKQACtiYt2oQWRAetICiPhkLdNiMYeBhD0rcPMHzwxBBYMxM5UzdpDa6DisGLBwfKeCGljAYxEmOjo8TWNw3VLdWNVdXqdXrf0n97Gf+VoH+U+fzFBunTzPyBxbJC7RD7rKJYtDG6h0xAyLCJ8svbq7T0Jq66uPguLq/ad8/8ZXz2BJ6cfpHeNjuefbZd6M315VXj35z7b7Ycw/nR9E2GJEFU0tfVOZBJiBezFxnIx4gCmAYRzBAzJXQa5jyLOS+FaRGQsZ9y1mj1JM55LuePEf+fk8EqRzyQ0+qJcp5k5TwphYlWiR1gWoUTi3ORxVyUwiSxVpk+pgbF0zBPs5inpTBZ6NOeqXdh5JAmcZ5ki/PkUHHif3OCFmeItpW3AwV0Cd4YO9hGSNq6g6iYQLSiUdDBfAFMQuOEdL88AVHs4fp8oDjgSnsRRUgtKiAzIKXkVNNIRzf8XkQRUsdJ136RiuZtu5EHHTfQvYgSoKQIBdww+QB2mqSj5rQXUYQUNFuSfieptJhpyR/f93sRRUi1UUbBQFPlMoa/U2zUSfciipAaC3prnTtNAU2mtXvkWGQ1XZTTlJVjoEEXatile8EEVM6AcjlMES0yKFIwWk2jzHopl/RSSQVpYUjK2kw5mzjrpVzSS62yqSMduL4Td/i8f8TIeSmX9FILyTkHNQp6c4mbJmnGS7mkl1oUo2XQmRhBpsMd/gNILvfFMs/gON25+/aUToFtJeT1zLnTLmL1erX6G+9AvAU='

AGE_SCENE_PLAN = 'eJydzs1Kw0AQB/B3mXNod3eS/cgtxQ8K0ktFEClld7uJhWohaYVScrDxAQTvnnqpV/EgCD7MIr6GCZUqgh68DTP/mfkt4W29eX+69dc3vtr46s5XD7569KtnX9371bopVq++eoF4Cdlc56MC4rMlFNN5bh3E0D/th91et9Xp9iCAaZoWbgYxCcAsZq7OhhwlygCKc80iXi9EDmWITlumKccQU+sMp5rgyAkcRUpGkhjOrWShRsaM0YY6ZQRax6mQAspBALm+zNwPyV5ynLBWcnRQO7bNzpZACRVIkEn6BWRSREiR75xSRhSVCEDns3GqbZ2B4fDK5eN00daZa++fKEKTVnLY3J9Ms7HVk56+aD5/G5XBf0WSIuVK7kCoOKGK/A1iv4M+R+WgLD8AueCckw=='

def next_game_verify_files(items,label,age_link=False):
    age_display=RULES_RE.pattern=='^new-games:age-display$'
    age_scene=RULES_RE.pattern=='^new-games:age-scene$'
    age_code=RULES_RE.pattern=='^new-games:age-code$'
    plan=json.loads(zlib.decompress(base64.b64decode(AGE_DISPLAY_PLAN if age_display else AGE_SCENE_PLAN if age_scene else AGE_CODE_PLAN if age_code else AGE_LINK_PLAN if age_link else NEXT_VERIFY_PLAN)))[label]
    lookup={e.rel.replace('\\','/').casefold():e for e in items};report={'game':label,'sourceReadOnly':True,'files':[],'guards':plan['guards'],'notes':['Append playback: only23 traced EV402/EV503/EV504 CG images/differences, about16.7MiB; no scripts/audio/EXE/DLL/whole archives.' if age_display else 'Original backup engine for static opcode analysis only. Never execute or install; no archives/media/other games.' if age_code else 'Only EV901A/EV902A original prologue images, about 12.2MiB; no EXE/DLL/scripts/other games.' if age_scene else 'Exact prologue dependencies and sampled image/voice assets; no EXE/DLL/save payloads.' if age_link else 'Only explicitly selected verification media/definitions. AGE EXE/DLL are static analysis input; never execute them.']};used=0
    def read(source,offset,length,expected=None):
        e=lookup.get(source.casefold())
        if not e:raise RuntimeError('Missing requested verification source: '+source)
        if expected is not None and e.size!=expected:raise RuntimeError('Verification source size changed: '+source)
        if offset<0 or length<0 or offset+length>e.size or length>(16 if age_scene else 8)*MB:raise RuntimeError('Verification range invalid: '+source)
        with open(e.path,'rb') as f:f.seek(offset);b=f.read(length)
        if len(b)!=length:raise RuntimeError('Verification source truncated: '+source)
        return e,b
    for guard in plan['guards']:
        _e,b=read(guard['source'],guard['offset'],guard['bytes'])
        if hashlib.sha256(b).hexdigest()!=guard['sha256']:raise RuntimeError('Version guard mismatch; refusing stale offsets: '+guard['source'])
    for row in plan['ranges']:
        e,b=read(row['source'],row['offset'],row['bytes'],row['sourceBytes']);name=row['artifact']
        if name.startswith('/') or '\\' in name or any(x in ('','.','..') for x in name.split('/')):raise RuntimeError('Verification artifact path invalid')
        used+=len(b)
        if used>(24 if age_display else 16)*MB:raise RuntimeError('Verification evidence exceeds per-game limit')
        report['files'].append(dict(row,sha256=hashlib.sha256(b).hexdigest()))
        yield name,b,e.mtime
    report['sampleBytes']=used
    yield '__verify/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode('utf-8'),int(time.time())

def next_game_detail_files(items, label):
    """Read bounded story/config evidence from the five already identified games."""
    lookup={e.rel.replace('\\','/').casefold():e for e in items}
    report={'game':label,'sourceReadOnly':True,'files':[],'omitted':[],'maxBytes':56*MB}
    used=0
    def part(e,offset,length,name):
        nonlocal used
        if offset<0 or length<0 or offset+length>e.size:raise RuntimeError('Invalid source range: '+e.rel)
        if used+length>report['maxBytes']:raise RuntimeError('Detail evidence exceeds56MB: '+label)
        with open(e.path,'rb') as f:f.seek(offset);data=f.read(length)
        if len(data)!=length:raise RuntimeError('Source truncated: '+e.rel)
        used+=length;report['files'].append({'path':e.rel,'artifact':name,'offset':offset,'sourceBytes':e.size,'bytes':length,'sha256':hashlib.sha256(data).hexdigest()})
        return name,data,e.mtime
    if label.startswith('RJ'):
        # Exclude MTool and all save trees; main game roots have System.json.
        roots=[key[:-len('data/system.json')] for key in lookup if key in ('data/system.json','www/data/system.json')]
        if not roots:raise RuntimeError('Main MV/MZ System.json missing: '+label)
        for prefix in roots:
            selected=set(prefix+'data/'+n.lower()+'.json' for n in ('System','MapInfos','Actors','Tilesets','CommonEvents'))
            maps=sorted([key for key,e in lookup.items() if re.fullmatch(re.escape(prefix)+r'data/map[0-9]+\.json',key) and e.size<=2*MB])
            for candidates in (maps,sorted(maps,key=lambda k:lookup[k].size)):
                if candidates:
                    for i in (0,len(candidates)//2,len(candidates)-1):selected.add(candidates[i])
            # Plugin source is inspected as text only; nested plugin paths matter.
            plugins=[key for key,e in lookup.items() if key.startswith(prefix+'js/plugins/') and key.endswith('.js') and e.size<=512*1024]
            source_used=0
            for key in sorted(plugins):
                if source_used+lookup[key].size>8*MB:
                    report['omitted'].append({'path':lookup[key].rel,'reason':'8MB plugin source budget'});continue
                selected.add(key);source_used+=lookup[key].size
            for key in sorted(selected):
                e=lookup.get(key)
                if not e:report['omitted'].append({'path':key,'reason':'missing'});continue
                if e.size>40*MB:raise RuntimeError('Required JSON exceeds40MB: '+e.rel)
                yield part(e,0,e.size,e.rel)
    elif label=='Remastered':
        for key,e in sorted(lookup.items()):
            if not(key.startswith('archives/') and key.endswith('.arc')):continue
            with open(e.path,'rb') as f:
                if f.read(8)!=b'@ARCH000':raise RuntimeError('ARCH000 changed: '+e.rel)
                f.seek(e.size-8);at=struct.unpack('<Q',f.read(8))[0]
            length=e.size-8-at
            if at<23 or not 4<=length<=4*MB:raise RuntimeError('ARCH000 index bounds: '+e.rel)
            yield part(e,0,23,'__next/files/'+e.rel+'.head.bin')
            record=part(e,at,length+8,'__next/files/'+e.rel+'.index.bin');yield record
            b=record[1][:-8];count=struct.unpack_from('<I',b)[0];p=4
            if count>100000:raise RuntimeError('ARCH000 entry count')
            def string():
                nonlocal p
                n=0
                for shift in range(0,35,7):
                    if p>=len(b):raise RuntimeError('ARCH000 string truncated')
                    v=b[p];p+=1;n|=(v&127)<<shift
                    if v<128:break
                else:raise RuntimeError('ARCH000 string length')
                if n>4096 or p+n>len(b):raise RuntimeError('ARCH000 string bounds')
                result=b[p:p+n].decode('utf-8');p+=n;return result
            rows=[]
            for i in range(count):
                leaf=string()
                if p+17>len(b):raise RuntimeError('ARCH000 record truncated')
                off,size,flag=struct.unpack_from('<QQB',b,p);p+=17;directory=string();name=(directory.strip('/')+'/'+leaf).strip('/')
                if any(x in ('','.','..') for x in name.split('/')) or '\\' in name or flag!=78 or off<23 or off+size>at:raise RuntimeError('ARCH000 entry range/path')
                rows.append({'name':name,'offset':off,'bytes':size})
            if p!=len(b):raise RuntimeError('ARCH000 index trailing data')
            table=json.dumps({'path':e.rel,'entries':rows},ensure_ascii=False).encode('utf-8')
            yield '__next/index/'+e.rel+'.json',table,e.mtime
            selected=[row for row in rows if row['name'].lower().endswith(('.txt','.lua')) and row['bytes']<=512*1024]
            selected.sort(key=lambda row:(not bool(re.search(r'(^|/)(src|game|scenario)(/|$)|sc[0-9]',row['name'],re.I)),row['name']))
            for i,row in enumerate(selected):
                if i>=120 or used+row['bytes']>48*MB:
                    report['omitted'].append({'path':row['name'],'reason':'script sample budget'});continue
                yield part(e,row['offset'],row['bytes'],'__next/entries/'+e.rel+'/'+str(i)+'.bin')
                report['files'][-1]['logicalName']=row['name']
    elif label=='天結いラビリンスマイスター':
        wanted={'sc0000.bin','sc0010.bin','sc1000.bin','sc6690.bin','$1$sc6870.bin','$1$scjump.bin','$1$scinit.bin','sys4ini.bin','evinit.bin','viinit.bin'}
        for key,e in sorted(lookup.items()):
            if '/' in key:continue
            if key in wanted or key.endswith('.aai'):
                if e.size>2*MB:raise RuntimeError('AGE sample exceeds2MB: '+e.rel)
                yield part(e,0,e.size,e.rel)
            elif key.endswith('.alf'):
                for suffix,off,n in [('head',0,min(e.size,128*1024)),('tail',max(128*1024,e.size-128*1024),min(e.size,128*1024))]:
                    if off<e.size:yield part(e,off,min(n,e.size-off),'__next/files/'+e.rel+'.'+suffix+'.bin')
    report['sampleBytes']=used
    yield '__next/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode('utf-8'),int(time.time())

PAIR_MEDIA_PLAN='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'
def fuyu_edo_detail_files(items,label):
    """Bounded scripts and original archive indexes; no engine execution."""
    report={'sourceReadOnly':True,'files':[]};used=0
    plan=json.loads(zlib.decompress(base64.b64decode(PAIR_MEDIA_PLAN))).get(label,[])
    if not plan:
        yield from new_game_probe_files(items)
        if label!='meshiagirl':return
        samples=[];sample_bytes=0
        candidates=[e for e in items if re.search(r'\.(json|csv|tsv|yaml|yml|atlas|txt)$',e.rel,re.I) and not re.search(r'(^|/)(save|savedata|userdata|node_modules)(/|$)',e.rel,re.I)]
        for e in sorted(candidates,key=lambda e:(not bool(re.search(r'scenario|story|adventure|script|master',e.rel,re.I)),e.rel.casefold()))[:8]:
            length=min(e.size,1024*1024)if e.size<=1024*1024 else min(e.size,128*1024)
            with open(e.path,'rb')as f:b=f.read(length)
            sample_bytes+=len(b)
            if len(b)!=length or sample_bytes>8*MB:raise RuntimeError('Meshi probe bounds')
            name='__meshi_probe/files/'+e.rel+(''if length==e.size else'.head.bin')
            samples.append({'path':e.rel,'sourceBytes':e.size,'offset':0,'bytes':len(b),'name':name,'sha256':hashlib.sha256(b).hexdigest()})
            yield name,b,e.mtime
        yield '__meshi_probe/index.json',json.dumps({'sourceReadOnly':True,'files':samples},ensure_ascii=False,indent=2).encode(),int(time.time())
        return
    lookup={e.rel.replace('\\','/'):e for e in items}
    for r in plan:
        e=lookup.get(r['path'])
        if not e or e.size!=r['sourceBytes']:raise RuntimeError('Pair media source changed '+r['path'])
        if r['offset']<0 or r['offset']+r['bytes']>e.size:raise RuntimeError('Pair range invalid')
        used+=r['bytes']
        if used>(128 if label=='meshiagirl'else 64)*MB:raise RuntimeError('Pair media byte limit')
        with open(e.path,'rb')as f:f.seek(r['offset']);data=f.read(r['bytes'])
        if len(data)!=r['bytes']:raise RuntimeError('Pair media truncated')
        report['files'].append({**r,'sha256':hashlib.sha256(data).hexdigest()})
        yield r['name'],data,e.mtime
    yield '__pair_media/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode(),int(time.time())

    # Installed configuration and previously materialized assets, strictly read-only.
    def scrub(v):
        if isinstance(v,dict):return {k:('[redacted]'if re.search(r'key|token|password|secret|cookie|authorization',k,re.I)else scrub(x))for k,x in v.items()}
        if isinstance(v,list):return [scrub(x)for x in v]
        return v
    runtime={'game':label,'sourceReadOnly':True,'metadataRoots':[],'files':[]};total=0
    for e in items:
        rel=e.rel.replace('\\','/')
        if not (re.search(r'(^|/)(EV003(?:_H0[234])?\.png|FK_SCENE_07\.smes|scsg01h\.edo|\.stamp\.json)$',rel,re.I)):continue
        if e.size>4*MB:raise RuntimeError('Pair runtime file exceeds4MiB: '+rel)
        with open(e.path,'rb')as f:b=f.read(4*MB+1)
        total+=len(b)
        if len(b)!=e.size or total>24*MB:raise RuntimeError('Pair runtime data changed/exceeded24MiB')
        runtime['files'].append({'path':rel,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
        yield '__pair_runtime/files/'+rel,b,e.mtime
    ancestors=[];ancestor=os.path.realpath(root)
    for _ in range(8):
        ancestors.append(ancestor);parent=os.path.dirname(ancestor)
        if parent==ancestor:break
        ancestor=parent
    candidates=[env['GAL_COLLECT_META_DIR']]if env.get('GAL_COLLECT_META_DIR')else[p for a in ancestors for p in [os.path.join(a,'library-meta','gal'),os.path.join(a,'cache','library-meta','gal')]]
    seen=set();read_bytes=0
    for candidate in candidates:
        base=os.path.realpath(candidate)
        if base in seen or not os.path.isdir(base):continue
        seen.add(base);runtime['metadataRoots'].append(base)
        for d,ds,fs in os.walk(base):
            depth=os.path.relpath(d,base).count(os.sep)+(d!=base);ds[:]=sorted(ds)if depth<2 else[]
            for name in sorted(fs):
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}\.json',name):continue
                file=os.path.join(d,name);st=os.stat(file)
                if st.st_size>2*MB:continue
                read_bytes+=st.st_size
                if read_bytes>64*MB:raise RuntimeError('Pair metadata scan exceeds64MiB')
                try:
                    with open(file,'rb')as f:doc=json.load(f)
                except(ValueError,UnicodeError):continue
                match=' '.join(str(doc.get(k,''))for k in ['title','source'])+' '+str(doc.get('config',{}).get('game',{}))
                if label.casefold()not in match.casefold()and not(label=='fuyukuru'and 'silky::fuyukuru'in match):continue
                projection={k:doc[k]for k in ['itemId','title','source','adapters','config','configWarnings','updatedAt']if k in doc}
                b=json.dumps(scrub(projection),ensure_ascii=False,indent=2).encode();total+=len(b)
                if total>24*MB:raise RuntimeError('Pair runtime evidence exceeds24MiB')
                aid=hashlib.sha256(file.encode()).hexdigest()[:20]
                yield '__pair_runtime/items/'+aid+'.json',b,int(st.st_mtime)
    yield '__pair_runtime/index.json',json.dumps(runtime,ensure_ascii=False,indent=2).encode(),int(time.time())

def new_game_probe_files(items):
    """Yield bounded evidence bytes; never execute code or copy full archives/EXEs."""
    report = {'sourceReadOnly': True, 'partialBinaries': True, 'files': [], 'omitted': [], 'engines': engines_of(items)}
    total = 0; binaries = 0; texts = 0
    for e in sorted(items, key=lambda e: (not bool(re.search(r'(^|/)(system\.json|plugins\.js|package\.json)$',e.rel,re.I)),e.rel.casefold())):
        rel=e.rel.replace('\\','/'); low=rel.lower(); base=low.rsplit('/',1)[-1]
        if re.search(r'(^|/)(save|savedata|userdata|backup|node_modules)(/|$)|(^|/)(save[^/]*\.(dat|bak|sav)|unins[^/]*|setup[^/]*|config\.exe)$',low): continue
        small = bool(re.search(r'(^|/)(system\.json|plugins\.js|package\.json|systeminfo\.json|fileinfo\.xml|bg[i]\.gdb|readme[^/]*\.txt|[^/]*\.(ini|cfg|cf))$',low))
        binary = bool(re.search(r'\.(xp3|arc|pfs|xfl|agf|alf|dat|bin|pak|pack|dsm|mhp|wolf|ldb|lmt|rgssad|rgss2a|rgss3a|asar|rpa|rpyc|mes|mjo|pck|int|scn|ws2|lua|ks)$',low)) or low.endswith('.exe') and rel.count('/')<=1
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

SCENE_AUDIT_PLAN = 'eJy1lE1u2zAQRq8SaN1GM5zhkOyuPUAX3RZBwF/HgB0DkhI0CHz3Uk4bSLWapo0K0ABN0Z/fEznz2HzJe98Pucup+XDx2GzufJf6Ov362PSHuy7mOm8+dvFme5/79j53AAkufRebdxfNoZQ+D3UHgiEjmhzU1fAw5DFCK1RSv/c3XmkZc3wJEiAEQhEdo3PiLUOxIQuoIuAzlKLEQiI3PigsYOoqlaQixtIc3128wIVLXCzIQm7KZUnxjIt0iKlACoYCRtaJstJKI8QikSuwDo6sTiFEzy5lbzKDB64Pi3VF/sBFC1yITrQ2MuESiyB2BpaBKbOyJmDVdyWLN4GSd0EbjJrrSizKpeTBRrLCCq0twQtWEU6qOV7VvM7fbvKrD/Vpx6cfUOPJWjQaZcov7NCA01N8UsJMVFd2h802+t1nvz/90Xa/acM4AJT3u8unH9R9vhu2xccxsLm+7mO+ze/9XdoObfd8K6d07XLSKy/FmReLUU5odi4a6is0oKZeyFpgWSv2dQCID/9khc9WZ0ErShl0p9s2lUK2tTDUslW+rwO0eP9Gq7OgNa0UaWFLMLMyyp5q/SWrtJZV+g9WhAC1kGlq5diw1S9ambXOyrzyrOh3VrXns9ROMCsri9oBzMoKtSJz7tRXnE2dt32srxgvh2/DXyqdyNqlnFWNqErJqV0/NwrnFrrfCNI/9O1mdwh+p94k9GvOukIKjHU8FTKw0PfmINfxcFu2m5W0pmnrymkmVrOqUrjU1X/y1M+Q92/WmsQcr47H763r6AA='
SCENE_AUDIT_REUSED = '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'

TWI_MODEL_PLAN = 'eJyNkk1uGzEMha9izDrjkBRFSV32AL1AUBiURLkG/FN4xmmNwHevJkUAe9MG2oiUyPfpiW/D9qLnOg1fVi9vw3S6nIv1/VB11vXvn254Wg2n1iabexZ6kK+zLbeFezD9UPKy3E/UtFhKLZLk2Ix8JTW0Gn0A855ia0xFs8V+xNkCcwyQKIB6VBxuT6v/6pO7A0gP+kW0JazSfJSSem/INWJUYhBAi8IZq2pqUBsrikoKUplbq05Typ/ST+yIiBnvMLoAuwcUy46zgqt9JfS+eM/FRdecOuCCJThVrdhI0CVIklNEn4s1gxLUfRYFg0OUOxROjvwDiqoYo3g0ylGdL8UCZCiSJGJu3Y3MVJtQg5JzEQTgsNiRg5VYwnD73vud9bi1f07I3+zXj5/pNrFw5HvgiE4iUKQ74E4m4F3oqf1puyu6/6aH9+b2urlejt3E9Z7qomDH+Xxd7IblhXqed33elr7DZjMVO9qol7qbn+dfu/FwqrZ//uAb30vHXjhOtj30aIR13h37225/APq92kA='

PLAYBACK_REUSED = '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'

def playback_audit_files(items,label):
    """Read-only evidence of native scene dependencies and installed Gal metadata."""
    lookup={e.rel.replace('\\','/').casefold():e for e in items};known=json.loads(zlib.decompress(base64.b64decode(PLAYBACK_REUSED))).get(label,{})
    report={'game':label,'sourceReadOnly':True,'files':[],'reused':[],'missing':[],'unresolved':[],'notes':[]};used=0;emitted=set();limit=(8 if label=='ツヴァイトリガー'else 160)*MB
    def read(e):
        if e.size>32*MB:raise RuntimeError('Playback source exceeds32MiB: '+e.rel)
        with open(e.path,'rb')as f:b=f.read(32*MB+1)
        if len(b)!=e.size:raise RuntimeError('Playback source changed while reading: '+e.rel)
        return b
    def artifact(name,b,e=None,**fields):
        nonlocal used
        if name.startswith('/')or'\\'in name or any(p in ('','.','..')for p in name.split('/')):raise RuntimeError('Unsafe playback artifact path')
        used+=len(b)
        if used>limit:raise RuntimeError('Playback evidence exceeds%dMiB for %s; no silent truncation'%(limit//MB,label))
        report['files'].append(dict(artifact=name,bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),**({'source':e.rel,'sourceBytes':e.size}if e else {}),**fields))
        return name,b,e.mtime if e else int(time.time())
    def full(rel,required=False):
        key=rel.casefold()
        if key in emitted:return None
        emitted.add(key);e=lookup.get(key)
        if not e:
            report['missing'].append({'source':rel,'required':required})
            if required:raise RuntimeError('Required playback source missing: '+rel)
            return None
        b=read(e);sha=hashlib.sha256(b).hexdigest();old=known.get(key,{})
        if old.get('sha256')==sha and not old.get('projection'):
            report['reused'].append(dict(source=e.rel,bytes=len(b),sha256=sha,reason='Exact full source already collected'))
            return None
        return artifact(e.rel,b,e)
    def json_file(rel):
        e=lookup.get(rel.casefold())
        if not e:raise RuntimeError('Required playback JSON missing: '+rel)
        return json.loads(read(e))
    # Metadata is read directly. Do not call reader/resource HTTP endpoints here:
    # their normal container materialization can write to the game directory.
    def scrub(value):
        if isinstance(value,dict):return {k:('[redacted]'if re.search(r'key|token|password|secret|cookie|authorization',k,re.I)else scrub(v))for k,v in value.items()}
        if isinstance(value,list):return [scrub(v)for v in value]
        return value
    # The supplied root can be gal/[G]/[] rather than gal itself. Check only
    # fixed metadata paths on bounded ancestors, never scan the NAS root.
    ancestors=[];ancestor=os.path.realpath(root)
    for _ in range(8):
        ancestors.append(ancestor);parent=os.path.dirname(ancestor)
        if parent==ancestor:break
        ancestor=parent
    meta_candidates=[env['GAL_COLLECT_META_DIR']]if env.get('GAL_COLLECT_META_DIR')else[p for ancestor in ancestors for p in [os.path.join(ancestor,'library-meta','gal'),os.path.join(ancestor,'cache','library-meta','gal')]]
    meta_roots=[];meta_items=[];meta_read=0;meta_seen=set()
    for candidate in meta_candidates:
        if not candidate:continue
        base=os.path.realpath(candidate)
        if base in meta_roots or not os.path.isdir(base):continue
        meta_roots.append(base)
        for d,ds,fs in os.walk(base):
            depth=os.path.relpath(d,base).count(os.sep)+(d!=base);ds[:]=sorted(ds)if depth<2 else[]
            for name in sorted(fs):
                if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}\.json',name):continue
                p=os.path.join(d,name);st=os.stat(p)
                if st.st_size>2*MB:raise RuntimeError('Gal metadata exceeds2MiB: '+name)
                meta_read+=st.st_size
                if meta_read>64*MB:raise RuntimeError('Gal metadata search exceeds64MiB; set GAL_COLLECT_META_DIR to the exact Gal metadata directory')
                try:
                    with open(p,'rb')as f:doc=json.load(f)
                except(ValueError,UnicodeError):continue
                text=' '.join([str(doc.get('title','')),str(doc.get('source',{}).get('path','')),str(doc.get('config',{}).get('game',{}).get('id',''))])
                match=(bool(re.search('zweitrigger|twiv|ツヴァイトリガー',text,re.I))if label=='ツヴァイトリガー'else label.casefold()in text.casefold())
                if not match:continue
                item_id=str(doc.get('itemId',name[:-5]));sig=(base,item_id)
                if sig in meta_seen:continue
                meta_seen.add(sig);cfg=doc.get('config',{})
                projection={k:doc[k]for k in ['itemId','title','source','adapters','configWarnings','createdAt','updatedAt']if k in doc};projection['config']=scrub({k:cfg[k]for k in ['game','scriptRoots','resourceRoots','scriptExtensions','adapterOptions','containers','limits','views','groups','nodes','sceneMarkers','scriptCount','resourceResolve','stripPrefixes']if k in cfg});projection['config']['script']={k:cfg.get('script',{}).get(k)for k in ['id','version','ranAt']}
                if 'configWarnings'in projection:projection['configWarnings']=[{k:w[k]for k in ['field','reason']if k in w}for w in projection['configWarnings']if isinstance(w,dict)]
                artifact_id=hashlib.sha256((base+'/'+item_id).encode()).hexdigest()[:20];meta_items.append({'itemId':item_id,'artifactId':artifact_id,'metadataRoot':base,'source':doc.get('source',{}),'scriptVersion':cfg.get('script',{}).get('version')})
                yield artifact('__playback/runtime/items/'+artifact_id+'.json',json.dumps(projection,ensure_ascii=False,indent=2).encode())
                progress_root=os.path.normpath(os.path.join(base,'..','..','cache','library','reading-progress','gal'))
                if re.fullmatch(r'[0-9a-f]{40}',item_id):
                    progress=os.path.join(progress_root,item_id[:2],item_id[2:4],item_id+'.json')
                    if os.path.isfile(progress):
                        if os.stat(progress).st_size>2*MB:raise RuntimeError('Gal reading progress exceeds2MiB')
                        with open(progress,'rb')as f:progress_doc=json.load(f)
                        yield artifact('__playback/runtime/progress/'+artifact_id+'.json',json.dumps(scrub(progress_doc),ensure_ascii=False,separators=(',',':')).encode())
        data_dir=os.path.dirname(os.path.dirname(base))
        for part in ['manifest.json','main.js','evb.mjs']:
            p=os.path.join(data_dir,'tag-scripts','gal-layout',part)
            if os.path.isfile(p):
                if os.stat(p).st_size>2*MB:raise RuntimeError('Installed layout source exceeds2MiB')
                with open(p,'rb')as f:b=f.read()
                name='__playback/runtime/layout-'+hashlib.sha256(base.encode()).hexdigest()[:12]+'/'+part
                yield artifact(name,b)
    report['runtime']={'metadataRoots':meta_roots,'matchingItems':meta_items,'browserStateCollected':False,'httpEndpointsCalled':False}
    if not meta_items:report['notes'].append('No matching installed library-meta/gal item found; actual saved adapter config/selector could not be captured. GAL_COLLECT_META_DIR may specify that existing directory; no unrelated metadata is uploaded.')
    if label=='ツヴァイトリガー':
        for rel in ['arc/.stamp.json','arc/refs/data/names.json','arc/refs/patch/names.json','arc/script/data/yn03.krkr']:
            row=full(rel)
            if row:yield row
        report['notes'].append('Only installed config, generated yn03 script/reference cache and container stamp. Complete ev_yuna03.l2d already received; no XP3/model/runtime copied again.')
    else:
        prefix=''if label=='RJ01271506'else'www/';core=lambda p:prefix+p
        common=json_file(core('data/CommonEvents.json'));info=json_file(core('data/MapInfos.json'));tiles=json_file(core('data/Tilesets.json'))
        plugin_e=lookup.get(core('js/plugins.js').casefold())
        if not plugin_e:raise RuntimeError('Missing native plugins.js')
        match=re.search(r'\$plugins\s*=\s*(\[[\s\S]*\])\s*;?\s*$',read(plugin_e).decode('utf-8-sig'))
        if not match:raise RuntimeError('Native plugins.js is not a JSON plugin configuration')
        plugins=json.loads(match[1]);enabled=[p for p in plugins if p.get('status')is True];template=next((p for p in enabled if p.get('name','').split('/')[-1]=='TemplateEvent'),None)
        template_ids=[]
        if template:
            p=template.get('parameters',{});template_ids=list(dict.fromkeys(int(n)for n in json.loads(p.get('TemplateMapIdList','[]'))+[p.get('TemplateMapId',0)]if int(n)>0))
        voice=next((p for p in enabled if p.get('name','').split('/')[-1]=='SimpleVoice'),{}).get('parameters',{});voice_folder='audio/'+str(voice.get('FolderName',voice.get('フォルダ名','voice'))).strip('/')
        declared=set(json_file('audio/voice/voice_list.json').get('uniqueIds',[]))if label=='RJ01271506'else set()
        for rel in ['data/System.json','data/Actors.json','data/MapInfos.json','data/CommonEvents.json','data/Tilesets.json','js/plugins.js','package.json','index.html']+(['audio/voice/voice_list.json']if label=='RJ01271506'else[]):
            row=full(core(rel),required=rel in ['data/System.json','data/MapInfos.json','data/CommonEvents.json','data/Tilesets.json','js/plugins.js','audio/voice/voice_list.json'])
            if row:yield row
        engine='rmmz'if label=='RJ01271506'else'rpg'
        for rel in ['js/'+engine+'_'+x+'.js'for x in ['objects','windows','scenes','managers']]+['js/plugins/'+p.get('name','')+'.js'for p in enabled]:
            row=full(core(rel))
            if row:yield row
        documents={};ev009=[];map_paths={}
        for key,e in sorted(lookup.items()):
            if not re.fullmatch(re.escape(prefix)+r'data/map\d+\.json',key):continue
            mid=int(re.search(r'map(\d+)\.json$',key)[1]);map_paths[mid]=e.rel;raw=read(e);doc=json.loads(raw);sha=hashlib.sha256(raw).hexdigest();old=known.get(key,{})
            if label=='RJ328940':
                for event in doc.get('events',[]):
                    if event and event.get('name')=='EV009':
                        for pi,page in enumerate(event.get('pages',[]),1):ev009.append({'map':mid,'mapName':info[mid].get('name','')if mid<len(info)and info[mid]else'', 'event':event['id'],'page':pi,'textLines':sum(c.get('code')==401 for c in page.get('list',[])),'list':page.get('list',[]),'conditions':page.get('conditions',{})})
            if old.get('sha256')==sha:report['reused'].append({'source':e.rel,'bytes':len(raw),'sha256':sha,'projectionOnly':bool(old.get('projection')),'reason':'All event/page commands already collected; full tiles requested separately for selected maps'})
            else:
                doc.pop('data',None);yield artifact('__playback/changed-event-maps/'+e.rel,json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode(),e,sourceSha256=sha,projection={'omittedFields':['data'],'allEventsAndCommandsPreserved':True})
        def map_doc(mid):
            if mid not in documents:
                if mid not in map_paths:raise RuntimeError('Referenced map missing: '+str(mid))
                documents[mid]=json_file(map_paths[mid])
            return documents[mid]
        def event_of(mid,eid):return next((e for e in map_doc(mid).get('events',[])if e and e['id']==eid),None)
        seeds=[(102,20),(128,31),(252,13),(252,14)]if label=='RJ01271506'else[(239,50)]+list(dict.fromkeys((r['map'],r['event'])for r in ev009 if r['textLines']>=2))
        queue=[('event',mid,eid)for mid,eid in seeds];seen=set();dependencies=[];media={};unvoiced=set();full_maps=set(mid for mid,_ in seeds);tile_maps={102,128}if label=='RJ01271506'else{239,402,459}
        def want(folder,name,kind,where):
            name=str(name or '').replace('\\','/')
            if not name:return
            if name.startswith('/')or'..'in name.split('/')or re.search(r'\\[A-Za-z]|\$|[<>]',name):report['unresolved'].append({'kind':kind,'folder':folder,'name':name,'where':where});return
            stem=prefix+folder+'/'+re.sub(r'\.(png|ogg)$','',name,flags=re.I);key=stem.casefold()
            if key not in media:media[key]={'logical':stem,'kind':kind,'where':[]}
            if where not in media[key]['where']:media[key]['where'].append(where)
        while queue:
            kind,mid,eid=queue.pop(0);key=(kind,mid,eid)
            if key in seen:continue
            seen.add(key)
            if len(seen)>1024:raise RuntimeError('Playback scene dependency graph exceeds1024 nodes')
            if kind=='common':event=common[eid]if 0<=eid<len(common)else None;pages=[{'list':event.get('list',[])}]if event else[]
            else:
                event=event_of(mid,eid);pages=event.get('pages',[])if event else[];full_maps.add(mid)
                note=event.get('note','')if event else'';tag=re.search(r'<TE:([^>]+)>',note,re.I)
                if tag:
                    name=tag[1];tp=template.get('parameters',{})if template else{};explicit=re.search(r'<TEMap:(\d+)>',note,re.I);search=[int(explicit[1])]if explicit else template_ids;found=None
                    for target in search:
                        if target not in map_paths:continue
                        found=next((e for e in map_doc(target).get('events',[])if e and(str(e['id'])==name if name.isdigit()else e.get('name')==name)),None)
                        if found:queue.append(('event',target,found['id']));break
                    if not found:report['unresolved'].append({'kind':'template','map':mid,'event':eid,'name':name})
            if not event:report['missing'].append({'node':list(key)});continue
            dependencies.append({'kind':kind,'map':mid,'event':eid,'name':event.get('name'),'pages':len(pages)})
            for pi,page in enumerate(pages,1):
                where={'kind':kind,'map':mid,'event':eid,'page':pi};pending_cells=0
                for c in page.get('list',[]):
                    code=c.get('code');p=c.get('parameters',[])
                    if code==117 and p:queue.append(('common',mid,int(p[0])))
                    if code==201 and len(p)>1 and p[0]==0 and int(p[1])in map_paths:
                        target=map_doc(int(p[1]));auto=[e for e in target.get('events',[])if e and any(pg.get('trigger')==3 for pg in e.get('pages',[]))]
                        if len(auto)==1:queue.append(('event',int(p[1]),auto[0]['id']))
                        else:report['unresolved'].append({'kind':'map-transfer-page-selection','targetMap':p[1],'where':where})
                    if code==401 and p and label=='RJ01271506':
                        for n in re.findall(r'\\TRN\[(\d+)\]',str(p[0])):
                            if int(n)in declared:want('audio/voice/unique',n,'trn-voice',where)
                            else:unvoiced.add(int(n))
                    if code in (241,245,249,250)and p and isinstance(p[0],dict):want('audio/'+{241:'bgm',245:'bgs',249:'me',250:'se'}[code],p[0].get('name'),{241:'bgm',245:'bgs',249:'me',250:'se'}[code],where)
                    if code==356 and p:
                        m=re.match(r'SV_(?:ボイスの演奏|PLAY_VOICE|ボイスのループ演奏|PLAY_LOOP_VOICE)\s+(\S+)',str(p[0]))
                        if m:want(voice_folder,m[1],'explicit-voice',where)
                    if code==357 and len(p)>=4:
                        plugin,action,args=str(p[0]).split('/')[-1],p[1],p[3]or{}
                        if plugin=='PictureAnimation'and action=='INIT':pending_cells=int(args.get('cellNumber',0))if args.get('direction')=='number'else 0
                        if plugin in ('SimpleVoice','VisuMZ_2_VoiceActControl')and action in ('PLAY_VOICE','SoundPlayAsVoiceLine'):want(voice_folder if plugin=='SimpleVoice'else'audio/se',args.get('name',args.get('name:str')),'plugin-voice',where)
                    if code==231 and len(p)>1:
                        want('img/pictures',p[1],'picture',where)
                        if 0<pending_cells<=256:
                            width=len(str(pending_cells));name=str(p[1]);pending_cells_count=pending_cells;pending_cells=0
                            for n in range(pending_cells_count):want('img/pictures',name[:-width]+str(n).zfill(width),'picture-animation-cell',where)
                    if code==284 and p:want('img/parallaxes',p[0],'parallax',where)
                    if code in (355,655)and p:
                        for m in re.finditer(r'\$gameScreen\.showPicture\(\s*\d+\s*,\s*["\']([^"\']+)["\']',str(p[0])):want('img/pictures',m[1],'script-picture',where)
        for mid in sorted(full_maps):
            row=full(map_paths[mid],required=True)
            if row:yield row
            doc=map_doc(mid);want('img/parallaxes',doc.get('parallaxName'),'map-parallax',{'map':mid})
            if mid not in tile_maps:continue
            tid=int(doc.get('tilesetId',0));ts=tiles[tid]if tid<len(tiles)else None
            for name in (ts or{}).get('tilesetNames',[]):want('img/tilesets',name,'tileset',{'map':mid})
            for event in doc.get('events',[]):
                if event:
                    for page in event.get('pages',[]):want('img/characters',page.get('image',{}).get('characterName'),'map-character',{'map':mid})
        # Resource inventory includes every file. Only exact scene dependencies
        # and the two actors' normal body/expression atlases are copied.
        for key,e in sorted(lookup.items()):
            if label=='RJ01271506'and re.fullmatch(r'img/pictures/busts/(bisty|filo)/(normal|texture)(?:[^/]*)\.(png_|png|json)',key):
                row=full(e.rel)
                if row:yield row
        inventory={}
        for key,e in sorted(lookup.items()):
            logical=re.sub(r'^dlc/[^/]+/','',key)if label=='RJ01271506'else key
            stem=re.sub(r'\.(png_|rpgmvp|png|ogg_|rpgmvo|ogg|m4a)$','',logical)
            inventory.setdefault(stem,[]).append(e.rel)
        media_rows=[]
        for key,wanted in sorted(media.items()):
            sources=inventory.get(key,[]);media_rows.append(dict(**wanted,physicalSources=sources,collection='reference-only-bgm'if wanted['kind']=='bgm'else'full-or-sha-reused'))
            if not sources:report['missing'].append({'logical':wanted['logical'],'kind':wanted['kind']});continue
            if wanted['kind']=='bgm':continue  # Track names remain in the report; music is not evidence of missing character voice/CG.
            for rel in sources:
                row=full(rel)
                if row:yield row
        report['sceneSeeds']=[{'map':mid,'event':eid}for mid,eid in seeds];report['dependencies']=dependencies;report['fullMapCount']=len(full_maps);report['templateMapIds']=template_ids;report['voiceFolder']=voice_folder;report['unvoicedTrnIds']=sorted(unvoiced);report['mediaReferences']=len(media_rows)
        if label=='RJ328940':yield artifact('__playback/ev009-candidates.json',json.dumps(ev009,ensure_ascii=False,separators=(',',':')).encode())
        yield artifact('__playback/media-references.json',json.dumps(media_rows,ensure_ascii=False,separators=(',',':')).encode())
        report['notes'].append('Unchanged map event projections and complete files are SHA-reused; selected maps include original tile cells. All non-BGM media for the selected dependency graph are requested; BGM paths are reference-only, and absent or dynamic references stay explicit. Native scripts are never executed.')
    report['sampleBytes']=used;report['outputLimitBytes']=limit
    say('播放故障采集 %s：新数据%.1fMiB，复用%d项，缺失%d项，动态未解析%d项，实际配置%d条'%(label,used/MB,len(report['reused']),len(report['missing']),len(report['unresolved']),len(meta_items)))
    yield '__playback/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode(),int(time.time())


def scene_audit_files(items,label):
    """Scene call trees, native voice routing, and bounded dynamic-CG evidence."""
    if RULES_RE.pattern=='^new-games:playback$':
        yield from playback_audit_files(items,label);return
    lookup={e.rel.replace('\\','/').casefold():e for e in items}
    report={'game':label,'sourceReadOnly':True,'files':[],'reused':[],'notes':[],'missing':[]};used=0
    output_limit=(192 if label in ('RJ01271506','RJ328940')else 96 if label=='ツヴァイトリガー'else 64)*MB
    report['outputLimitBytes']=output_limit
    say('场景采集 %s：原始输出上限%dMiB，按压缩后的%dMiB分卷；不截断事件/正文' % (label,output_limit//MB,PART//MB))
    plan=json.loads(zlib.decompress(base64.b64decode(SCENE_AUDIT_PLAN)))
    reused=json.loads(zlib.decompress(base64.b64decode(SCENE_AUDIT_REUSED))).get(label,{})
    def read(e,off=0,n=None):
        n=e.size if n is None else n
        if off<0 or n<0 or off+n>e.size or n>32*MB:raise RuntimeError('Scene audit read bounds: '+e.rel)
        with open(e.path,'rb')as f:f.seek(off);b=f.read(n)
        if len(b)!=n:raise RuntimeError('Scene audit truncated: '+e.rel)
        return b
    def artifact(name,b,e=None,**fields):
        nonlocal used
        if name.startswith('/')or'\\'in name or any(x in ('','.','..')for x in name.split('/')):raise RuntimeError('Scene audit artifact path invalid')
        used+=len(b)
        if used>output_limit:raise RuntimeError('Scene audit per-game byte limit exceeded: %s; attempted %.1fMiB, limit %dMiB'%(label,used/MB,output_limit//MB))
        report['files'].append(dict(artifact=name,bytes=len(b),sha256=hashlib.sha256(b).hexdigest(),**({'source':e.rel,'sourceBytes':e.size}if e else {}),**fields))
        return name,b,e.mtime if e else int(time.time())
    def full(key,required=True):
        e=lookup.get(key.casefold())
        if not e:
            report['missing'].append(key)
            if required:raise RuntimeError('Required scene audit source missing: '+key)
            return None
        b=read(e);sha=hashlib.sha256(b).hexdigest()
        if reused.get(e.rel.casefold())==sha:
            report['reused'].append(dict(source=e.rel,bytes=len(b),sha256=sha,reason='Previously collected exact source; local SHA matches'))
            return None
        return artifact(e.rel,b,e,offset=0)
    if RULES_RE.pattern=='^new-games:twi-model$':
        if label!='ツヴァイトリガー':raise RuntimeError('Twi model round may only collect Twi')
        model_plan=json.loads(zlib.decompress(base64.b64decode(TWI_MODEL_PLAN)))
        for guard in model_plan['guards']:
            e=lookup.get(guard['source'].casefold())
            if not e or hashlib.sha256(read(e,guard['offset'],guard['bytes'])).hexdigest()!=guard['sha256']:raise RuntimeError('Twi archive index changed; refusing stale model offsets')
        for row in model_plan['ranges']:
            e=lookup.get(row['source'].casefold())
            if not e or e.size!=row['sourceBytes']:raise RuntimeError('Twi archive source size changed')
            yield artifact(row['artifact'],read(e,row['offset'],row['bytes']),e,offset=row['offset'],logicalName=row['logicalName'],entry=row['entry'],fullSegment=True)
        report['notes'].append('Exactly one complete encrypted ev_yuna03.l2d model package for actual yn03 playback validation; indexes/scripts already collected, no other games or full XP3.')
    elif label=='Remastered':
        rows=plan[label]
        for guard in rows['guards']:
            e=lookup.get(guard['source'].casefold())
            if not e or hashlib.sha256(read(e,guard['offset'],guard['bytes'])).hexdigest()!=guard['sha256']:raise RuntimeError('Remastered index changed; refusing stale scene offsets')
        for row in rows['ranges']:
            e=lookup.get(row['source'].casefold())
            if not e or e.size!=row['sourceBytes']:raise RuntimeError('Remastered source size changed')
            yield artifact(row['artifact'],read(e,row['offset'],row['bytes']),e,offset=row['offset'],logicalName=row['logicalName'])
        report['notes'].append('sc0561 native script/system defaults plus BG002AAL, CS006AB, EV056AA/AD and EV057AA: validate the actual layered scene, not an isolated CG.')
    elif label=='ツヴァイトリガー':
        model_count=0;small_count=0;header_count=0
        for archive in ('data.xp3','patch.xp3','evimage.xp3','video.xp3'):
            e=lookup.get(archive)
            if not e:raise RuntimeError('Required Twi archive missing: '+archive)
            prefix='__scene-audit/xp3/'+archive;head=read(e,0,min(64,e.size))
            if not head.startswith(b'XP3\r\n \n\x1a\x8b\x67\x01'):raise RuntimeError('Twi XP3 signature changed: '+archive)
            yield artifact(prefix+'/header.bin',head,e,offset=0)
            ptr=11;entries=[];seen=set()
            for block in range(16):
                if ptr in seen:raise RuntimeError('XP3 index pointer cycle')
                seen.add(ptr);pointer=read(e,ptr,8);at=struct.unpack('<Q',pointer)[0];flag=read(e,at,1)[0]
                yield artifact(prefix+'/pointer-%d.bin'%block,pointer,e,offset=ptr)
                if flag&7==0:stored=original=struct.unpack('<Q',read(e,at+1,8))[0];header=9
                elif flag&7==1:stored,original=struct.unpack('<QQ',read(e,at+1,16));header=17
                else:raise RuntimeError('Unsupported XP3 index codec')
                if stored>4*MB or original>16*MB:raise RuntimeError('XP3 index exceeds audit bounds')
                raw=read(e,at,header+stored);yield artifact(prefix+'/index-%d.bin'%block,raw,e,offset=at)
                if flag&7==1:
                    z=zlib.decompressobj();decoded=z.decompress(raw[header:],16*MB+1)
                    if not z.eof or len(decoded)!=original:raise RuntimeError('XP3 index inflate bounds/length')
                else:decoded=raw[header:]
                pos=0
                while pos<len(decoded):
                    if pos+12>len(decoded):raise RuntimeError('XP3 truncated chunk')
                    tag=decoded[pos:pos+4];length=struct.unpack_from('<Q',decoded,pos+4)[0];body=decoded[pos+12:pos+12+length];pos+=12+length
                    if len(body)!=length:raise RuntimeError('XP3 chunk bounds')
                    if tag==b'Hxv4':
                        if length!=14:raise RuntimeError('XP3 special descriptor bounds')
                        off,size,kind=struct.unpack('<QIH',body)
                        if size>4*MB:raise RuntimeError('XP3 special index exceeds audit bounds')
                        yield artifact(prefix+'/hxv4-%d.bin'%block,read(e,off,size),e,offset=off)
                    if tag!=b'File':continue
                    entry={'segments':[]};sub=0
                    while sub<len(body):
                        if sub+12>len(body):raise RuntimeError('XP3 file chunk truncated')
                        key=body[sub:sub+4];size=struct.unpack_from('<Q',body,sub+4)[0];value=body[sub+12:sub+12+size];sub+=12+size
                        if len(value)!=size:raise RuntimeError('XP3 file chunk bounds')
                        if key==b'info'and len(value)>=22:
                            chars=struct.unpack_from('<H',value,20)[0]
                            if 22+chars*2>len(value):raise RuntimeError('XP3 filename bounds')
                            entry.update(name=value[22:22+chars*2].decode('utf-16le'),size=struct.unpack_from('<Q',value,4)[0])
                        elif key==b'segm':
                            if len(value)%28:raise RuntimeError('XP3 segment shape')
                            entry['segments']=[struct.unpack_from('<IQQQ',value,k)for k in range(0,len(value),28)]
                        elif key==b'adlr'and len(value)==4:entry['adler']=struct.unpack('<I',value)[0]
                    for flags,off,original,stored in entry['segments']:
                        if off<0 or off+stored>e.size:raise RuntimeError('XP3 entry segment outside archive')
                    if entry.get('name'):entries.append(entry)
                if not flag&128:break
                ptr=at+header+stored
            else:raise RuntimeError('XP3 index chain exceeds audit limit')
            if len(entries)>20000:raise RuntimeError('Twi entry count exceeds audit limit')
            for i,entry in enumerate(entries):
                size=entry.get('size',0);stored=sum(sg[3]for sg in entry['segments'])
                small=(archive=='data.xp3'and size<=128*1024 or archive=='patch.xp3'and size<=256*1024 or archive=='evimage.xp3'and size<=4096)and stored<=512*1024
                model=bool(re.search(r'(?:\.l2d$|(?:live2d|cubism|model)[^/]*\.zip$)',entry['name'],re.I))and model_count<2 and stored<=32*MB
                if model:model_count+=1
                if small:small_count+=1
                for si,sg in enumerate(entry['segments']):
                    flags,off,original,stored=sg
                    # Unknown/encrypted payloads need only a bounded prefix to
                    # identify their real codec/model type locally after decryption.
                    n=stored if small or model else min(1024,stored)
                    if not n:continue
                    header_count+=not(small or model)
                    yield artifact(prefix+'/entry-%d-segment-%d.bin'%(i,si),read(e,off,n),e,offset=off,entry=i,segment=si,fullSegment=n==stored)
            yield artifact(prefix+'/entries.json',json.dumps(entries,ensure_ascii=False,separators=(',',':')).encode())
        report['notes'].append(dict(fullSmallEntries=small_count,completeModelPackages=model_count,prefixSegments=header_count,modelLimit=2,modelPackageLimitBytes=32*MB))
        report['notes'].append('All archive indexes include video.xp3; bounded script/config entries identify native Live2D setup and H-scene callers. Encrypted/unidentified large entries are prefixes only, explicitly marked; no complete model is claimed when completeModelPackages=0. No EXE/DLL or full XP3 copied.')
    elif label in ('RJ01271506','RJ328940'):
        prefix=''if label=='RJ01271506'else'www/'
        common=lookup.get(prefix+'data/commonevents.json');info=lookup.get(prefix+'data/mapinfos.json')
        if not common or not info:raise RuntimeError('RPG core scene sources missing')
        core=json.loads(read(common));map_info=json.loads(read(info));voice_hints=[]
        extra=['js/plugins.js','data/System.json','data/MapInfos.json','data/CommonEvents.json']
        if label=='RJ01271506':extra+=['audio/voice/voice_list.json','js/plugins/inazuma/Sound.js','js/plugins/inazuma/dlc/DLC.js','js/plugins/inazuma/i18n/i18n.js','js/plugins/inazuma/core/text/EscapeCharacterEx.js','js/plugins/triacontane/TemplateEvent.js']
        else:extra+=['js/plugins/SimpleVoice.js']
        for rel in extra:
            result=full(prefix+rel,required=rel in ('js/plugins.js','data/System.json','data/MapInfos.json','data/CommonEvents.json','audio/voice/voice_list.json','js/plugins/SimpleVoice.js'))
            if result:yield result
        if label=='RJ01271506':
            for key,e in sorted(lookup.items()):
                if re.fullmatch(r'dlc/[^/]+/list\.json',key)or re.fullmatch(r'data/[^/]*deploy[^/]*\.json',key):
                    result=full(key)
                    if result:yield result
        else:
            source=lookup.get(prefix+'js/plugins/simplevoice.js')
            voice_hints=re.findall(r'se\.name\.includes\("([^"\n]+)"\)',read(source).decode('utf-8-sig'))
        totals=collections.Counter();catalog=[];trn=set();audio=[];pictures=[]
        def commands_of(event_list,where):
            counts=collections.Counter();calls=[]
            for command in event_list or []:
                code=command.get('code');p=command.get('parameters',[]);totals[str(code)]+=1
                if code==401 and p:
                    counts['textLines']+=1;trn.update(int(n)for n in re.findall(r'\\TRN\[(\d+)\]',str(p[0])))
                if code==117 and p:calls.append(p[0])
                if code==231 and len(p)>1 and p[1]:pictures.append(dict(name=p[1],folder='img/pictures',where=where))
                if code==284 and p and p[0]:pictures.append(dict(name=p[0],folder='img/parallaxes',where=where))
                if code==250 and p and isinstance(p[0],dict)and any(h in str(p[0].get('name',''))for h in voice_hints):
                    counts['seVoice']+=1;audio.append(dict(name=p[0]['name'],folder='audio/se',where=where,kind='native-se-voice'))
                if code==356 and p:
                    m=re.match(r'SV_(?:ボイスの演奏|PLAY_VOICE|ボイスのループ演奏|PLAY_LOOP_VOICE)\s+(\S+)',str(p[0]))
                    if m:counts['explicitVoice']+=1;audio.append(dict(name=m[1],folder='audio/se',where=where,kind='plugin-voice'))
            return dict(counts=dict(counts),calls=calls)
        for ce in core:
            if ce:catalog.append(dict(common=ce['id'],name=ce.get('name',''),**commands_of(ce.get('list',[]),{'common':ce['id']})))
        map_bytes=0;map_count=0
        for key,e in sorted(lookup.items()):
            if not re.fullmatch(re.escape(prefix)+r'data/map\d+\.json',key):continue
            if e.size>16*MB:raise RuntimeError('RPG map exceeds16MiB: '+e.rel)
            map_bytes+=e.size
            if map_bytes>128*MB:raise RuntimeError('RPG original maps exceed128MiB read budget')
            raw=read(e);document=json.loads(raw);map_id=int(re.search(r'map(\d+)\.json$',key)[1]);map_count+=1
            for event in document.get('events',[]):
                if not event:continue
                for pi,page in enumerate(event.get('pages',[]),1):
                    where={'map':map_id,'event':event['id'],'page':pi};catalog.append(dict(**where,name=event.get('name',''),note=event.get('note',''),conditions=page.get('conditions',{}),**commands_of(page.get('list',[]),where)))
            # Explicit projection: retain every event/page/condition/command and
            # map metadata. Tile cells are omitted, never event commands/text.
            omitted=['data']if'data'in document else[];document.pop('data',None)
            payload=json.dumps(document,ensure_ascii=False,separators=(',',':')).encode()
            yield artifact('__scene-audit/event-maps/'+e.rel,payload,e,sourceSha256=hashlib.sha256(raw).hexdigest(),projection={'omittedFields':omitted,'allEventsAndCommandsPreserved':True})
        declared=None
        if label=='RJ01271506':
            voice_list=json.loads(read(lookup['audio/voice/voice_list.json']))
            if not isinstance(voice_list.get('uniqueIds'),list):raise RuntimeError('Native voice list lacks uniqueIds')
            declared=set(int(n)for n in voice_list['uniqueIds'])
            # Read the actual enabled plugin's template list, rather than assume
            # that collecting arbitrary dialogue maps covers the CG callers.
            plugin_text=read(lookup['js/plugins.js']).decode('utf-8-sig')
            match=re.search(r'\$plugins\s*=\s*(\[[\s\S]*\])\s*;?\s*$',plugin_text)
            if not match:raise RuntimeError('Cannot read native RPG plugin configuration as JSON data')
            plugins=json.loads(match[1]);templates=[]
            for plugin in plugins:
                if plugin.get('status')is True and plugin.get('name','').split('/')[-1]=='TemplateEvent':
                    params=plugin.get('parameters',{});ids=json.loads(params.get('TemplateMapIdList','[]'))+[params.get('TemplateMapId',0)]
                    templates=sorted(set(int(n)for n in ids if int(n)>0))
            report['templateMapIds']=templates
            for n in templates:
                if 'data/map%03d.json'%n not in lookup:raise RuntimeError('Plugin-declared CG template map missing: %d'%n)
        for n in sorted(trn):audio.append(dict(name='unique/'+str(n),folder='audio/voice',where={'TRN':n},kind='trn-auto-voice',nativeDeclared=n in declared if declared is not None else None))
        audio_index={};coverage=collections.Counter();candidates=[]
        for key,e in sorted(lookup.items()):
            logical=re.sub(r'^dlc/[^/]+/','',key)if label=='RJ01271506'else key
            if not re.search(r'\.(?:ogg_|rpgmvo|ogg)$',logical):continue
            stem=re.sub(r'\.(?:ogg_|rpgmvo|ogg)$','',logical);audio_index.setdefault(stem,[]).append(e.rel)
        for row in audio:
            sources=audio_index.get((prefix+row['folder']+'/'+row['name']).casefold(),[]);row['physicalSources']=sources
            coverage[row['kind']+(':present'if sources else':absent')]+=1
            if sources and len(candidates)<3 and row.get('nativeDeclared')is not False:
                for rel in sources:
                    if rel not in candidates:candidates.append(rel);break
        report['sceneCoverage']={'maps':map_count,'originalMapBytesRead':map_bytes,'pagesAndCommon':len(catalog),'commandCodes':dict(totals),'trnIds':len(trn),'nativeSeVoiceHints':voice_hints,'audioReferences':dict(coverage),'declaredTrnVoiceIds':len(trn&declared)if declared is not None else None}
        yield artifact('__scene-audit/callers.json',json.dumps(catalog,ensure_ascii=False,separators=(',',':')).encode())
        yield artifact('__scene-audit/audio-references.json',json.dumps(audio,ensure_ascii=False,separators=(',',':')).encode())
        yield artifact('__scene-audit/picture-references.json',json.dumps(pictures,ensure_ascii=False,separators=(',',':')).encode())
        for rel in candidates:
            result=full(rel)
            if result:yield result
        images=[]
        for row in pictures:
            name=str(row['name'])
            if not re.search(r'(?:^|/)(?:still/.*?/h/|_?[^/]*scene)',name,re.I):continue
            stem=prefix+row['folder']+'/'+name
            hit=next((lookup.get((stem+ext).casefold())for ext in('.png_','.rpgmvp','.png')if lookup.get((stem+ext).casefold())),None)
            if hit and hit.rel not in images and hit.size<=8*MB:images.append(hit.rel)
            if len(images)==3:break
        for rel in images:
            result=full(rel)
            if result:yield result
        report['notes'].append(dict(nativeAudioSampleSources=candidates,nativeImageSampleSources=images))
        report['notes'].append('All map event/page/caller trees retained; only map tile-cell arrays excluded explicitly. Complete native voice and CG references plus DLC manifests distinguish missing playback support from resources absent in the original installation. Three reference-matched audio and up to three CG samples, not bulk media.')
    else:raise RuntimeError('Unexpected scene-audit game: '+label)
    report['sampleBytes']=used
    yield '__scene-audit/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode(),int(time.time())

def main():
    new_games = RULES_RE is not None and RULES_RE.pattern in ('^new-games:playback$','^new-games:twi-model$','^new-games:scene-audit$','^new-games:mz-templates$','^new-games:followup$','^new-games:bug-cases$','^new-games:probe$','^new-games:detail$','^new-games:media$','^new-games:remaining$','^new-games:next$','^new-games:next-detail$','^new-games:next-verify$','^new-games:age-link$','^new-games:age-code$','^new-games:age-scene$','^new-games:age-display$','^new-games:fuyu-edo$')
    scene_audit = RULES_RE is not None and RULES_RE.pattern in ('^new-games:playback$','^new-games:scene-audit$','^new-games:twi-model$')
    twi_model = scene_audit and RULES_RE.pattern=='^new-games:twi-model$'
    mz_templates = RULES_RE is not None and RULES_RE.pattern == '^new-games:mz-templates$'
    followup = RULES_RE is not None and RULES_RE.pattern == '^new-games:followup$'
    bug_cases = scene_audit or mz_templates or RULES_RE is not None and RULES_RE.pattern in ('^new-games:bug-cases$','^new-games:followup$')
    bug_labels = {'How to Build a Magnificent Kingdom v1.05','Remastered','RJ01271506','RJ328940'} if followup else {'How to Build a Magnificent Kingdom v1.05','シロクロv1.1','RJ328940'}
    if mz_templates:bug_labels={'RJ01271506'}
    if scene_audit:bug_labels={'ツヴァイトリガー','Remastered','RJ01271506','RJ328940'}
    if twi_model:bug_labels={'ツヴァイトリガー'}
    if scene_audit and RULES_RE.pattern=='^new-games:playback$':bug_labels={'RJ01271506','RJ328940','ツヴァイトリガー'}
    new_games_next = new_games and RULES_RE.pattern in ('^new-games:next$','^new-games:next-detail$','^new-games:next-verify$','^new-games:age-link$','^new-games:age-code$','^new-games:age-scene$','^new-games:age-display$')
    age_link = new_games_next and RULES_RE.pattern in ('^new-games:age-link$','^new-games:age-code$','^new-games:age-scene$','^new-games:age-display$')
    new_games_next_verify = new_games_next and RULES_RE.pattern in ('^new-games:next-verify$','^new-games:age-link$','^new-games:age-code$','^new-games:age-scene$','^new-games:age-display$')
    new_games_next_detail = new_games_next and RULES_RE.pattern == '^new-games:next-detail$'
    new_games_remaining = new_games and RULES_RE.pattern == '^new-games:remaining$'
    remaining_labels=set(json.loads(zlib.decompress(base64.b64decode(REMAINING_RANGE_PLAN)))) if new_games_remaining else set()
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
            label=(next_game_label(os.path.basename(d)) or new_game_label(os.path.basename(d))) if bug_cases else (next_game_label if new_games_next else new_game_label)(os.path.basename(d))
            if label and bug_cases and label not in bug_labels:
                ds[:]=[];continue
            if label and age_link and label!='天結いラビリンスマイスター':
                ds[:]=[];continue
            if label and new_games_remaining and label not in remaining_labels:
                ds[:]=[];continue
            if label and new_games_media and label not in ('How to Build a Magnificent Kingdom v1.05','夜勤病棟リメイク'):
                ds[:]=[];continue
            if label and (not ONLY or ONLY.search(os.path.relpath(d,root))):
                games.append(d);found.add(label);ds[:]=[]
            elif any(MARK.search(f) for f in _fs) or any(x.lower().endswith('_data') for x in ds):
                ds[:]=[]  # Other games cannot contain a requested game; avoid scanning their media/runtime trees.
            else:
                ds[:]=sorted(x for x in ds if depth<7 and x.lower() not in ('gal-download','bundles','runs','repair-backups','bundle-backups','node_modules','img','audio','movies') and not EXCL.search(x+'/'))
        missing=sorted(bug_labels-found) if bug_cases else [name for name,_pattern in (NEXT_GAME_PATTERNS if new_games_next else PAIR_GAME_PATTERNS if RULES_RE.pattern=='^new-games:fuyu-edo$' else NEW_GAME_PATTERNS) if name not in found and (not age_link or name=='天結いラビリンスマイスター') and (not new_games_remaining or name in remaining_labels) and (not new_games_media or name in ('How to Build a Magnificent Kingdom v1.05','夜勤病棟リメイク'))]
        say('本轮%s；找到%d个目录；未找到：%s' % ('指定游戏引擎定向探测' if RULES_RE.pattern=='^new-games:fuyu-edo$' else '指定场景故障定向采集' if bug_cases else 'AGE SP剧情及初始化表诊断采集' if RULES_RE.pattern=='^new-games:age-display$' else 'AGE开场两张CG定向采集' if RULES_RE.pattern=='^new-games:age-scene$' else 'AGE原版备份引擎静态分析采集' if RULES_RE.pattern=='^new-games:age-code$' else 'AGE序章依赖定向采集' if age_link else '下一批五作引擎探测' if new_games_next else '两作缺失定义验证' if new_games_remaining else '两作定向媒体验证' if new_games_media else '五作引擎探测',len(games),'；'.join(missing) or '无'))
        if not games: raise RuntimeError('未找到本轮指定目录；未采其他游戏')
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
    read_failures = 0
    for i, game in enumerate(games, 1):
        gid = 'g%02d' % i; rel_game = os.path.relpath(game, root)
        items = log_items if download_logs else list_files(game); eng = engines_of(items)
        picks = ([] if new_games or tsk_scene or rpg_maps or rpg_new or rpg_probe or rpg_media else [(e, 'full', 'gal-download:latest') for e in items] if download_logs else requested_diagnostic_picks(items, os.path.basename(game).lower() == 'twinkle star knights x') if requested_diagnostics
            else [(e, 'inventory', 'rj01482469:inventory') for e in items[:1]] if rj_inventory else pick(items, eng))
        if new_games and items: picks=[(items[0],'inventory','new-games:fuyu-edo' if RULES_RE.pattern=='^new-games:fuyu-edo$' else 'new-games:playback' if RULES_RE.pattern=='^new-games:playback$' else 'new-games:twi-model' if twi_model else 'new-games:scene-audit' if scene_audit else 'new-games:mz-templates' if mz_templates else 'new-games:followup' if followup else 'new-games:bug-cases' if bug_cases else 'new-games:age-display' if RULES_RE.pattern=='^new-games:age-display$' else 'new-games:age-scene' if RULES_RE.pattern=='^new-games:age-scene$' else 'new-games:age-code' if RULES_RE.pattern=='^new-games:age-code$' else 'new-games:age-link' if age_link else 'new-games:next-verify' if new_games_next_verify else 'new-games:next-detail' if new_games_next_detail else 'new-games:next' if new_games_next else 'new-games:remaining' if new_games_remaining else 'new-games:media' if new_games_media else 'new-games:detail' if new_games_detail else 'new-games:probe')]
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
                for name,data,mtime in (scene_audit_files(items,next_game_label(os.path.basename(game)) or new_game_label(os.path.basename(game))) if scene_audit else bug_case_files(items,next_game_label(os.path.basename(game)) or new_game_label(os.path.basename(game)),followup=followup) if bug_cases else next_game_verify_files(items,next_game_label(os.path.basename(game)),age_link=age_link) if new_games_next_verify else next_game_detail_files(items,next_game_label(os.path.basename(game))) if new_games_next_detail else new_game_remaining_files(items,new_game_label(os.path.basename(game))) if new_games_remaining else new_game_media_files(items,new_game_label(os.path.basename(game))) if new_games_media else new_game_detail_files(items,new_game_label(os.path.basename(game))) if new_games_detail else fuyu_edo_detail_files(items,new_game_label(os.path.basename(game))) if RULES_RE.pattern=='^new-games:fuyu-edo$' else new_game_probe_files(items)):
                    if total+len(data)>min(TOTAL_MAX,(336 if RULES_RE is not None and RULES_RE.pattern=='^new-games:playback$'else 640 if scene_audit else 32 if new_games_next_verify else 128 if new_games_next_detail or RULES_RE is not None and RULES_RE.pattern=='^new-games:fuyu-edo$' and new_game_label(os.path.basename(game))=='meshiagirl' else 64)*MB): raise RuntimeError('五作证据超过本轮总量上限')
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
                    read_failures += 1
                    say('  ! 读不了 %s: %s' % (e.rel, ex)); mf.write('%s\t%s\tERROR\t%s\t%d\t0\t%s\n' % (gid, e.rel, rule, e.size, ex))
        gz.close(); sp.close()
        gl.write('%s\t%s\t%s\t%d\t%d\t%d\n' % (gid, rel_game, ','.join(eng), len(items), len(picks), picked_bytes)); gl.flush(); mf.flush()
        say('   %s 原始 %.1f MB → %d 卷' % (gid, picked_bytes / MB, len(sp.parts)))
    gl.close(); mf.close()
    # 元数据包：games.tsv / manifest.tsv / 运行信息（日志在最后由 shell 补进去）
    info = {'version': VERSION, 'ts': ts, 'host': host, 'root_name': os.path.basename(root), 'part_mb': PART // MB, 'full_max_mb': FULL_MAX // MB, 'ht_mb': HT // MB, 'total_mb': total // MB, 'games': len(games), 'python': sys.version.split()[0], 'binaries': BINARIES}
    json.dump(info, open(os.path.join(out, 'info.json'), 'w'), ensure_ascii=False, indent=1)
    if read_failures:
        raise RuntimeError('有%d个采集文件读取失败，本轮不能记为成功；详见manifest.tsv' % read_failures)

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
