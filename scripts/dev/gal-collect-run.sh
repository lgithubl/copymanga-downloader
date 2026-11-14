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
VERSION="1.85"
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

PAIR_ACTIVE_GAMES = ['meshiagirl']
PAIR_GAME_PATTERNS = [(name,pattern) for name,pattern in [('fuyukuru', r'fuyukuru(?:[ _-]*v?[0-9.]+)?'), ('えどわ～る', r'えどわ[~〜～ー]?る(?:[ _-]*(?:ver|v)?[0-9.]+)?'), ('meshiagirl', r'meshiagirl(?:[ _-]*(?:ver|v)?[0-9.]+)?')] if name in PAIR_ACTIVE_GAMES]

def new_game_label(name):
    import unicodedata
    name = unicodedata.normalize('NFKC', name).strip()
    name = re.sub(r'^(?:\[[^\]]+\]\s*)+', '', name)
    patterns = PAIR_GAME_PATTERNS if RULES_RE is not None and RULES_RE.pattern=='^new-games:fuyu-edo$' else NEW_GAME_PATTERNS
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
    if label=='meshiagirl' and not plan:
        yield from new_game_probe_files(items)
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
                    if total+len(data)>min(TOTAL_MAX,(336 if RULES_RE is not None and RULES_RE.pattern=='^new-games:playback$'else 640 if scene_audit else 32 if new_games_next_verify else 128 if new_games_next_detail else 64)*MB): raise RuntimeError('五作证据超过本轮总量上限')
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
