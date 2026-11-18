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
# 例外：显式的 ^directory:ddd$ 完整目录模式保留所有普通文件、隐藏目录及软链接，不应用上述游戏样本筛选；源只读。
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
# 2.22 用户指定 ddd 完整目录：流式全文件/哈希/空目录/软链接，不截成头尾样本，不采其他目录。
# 2.29 三作元数据：MV全事件/插件、Djibril全剧情及菜单索引、死神商館文本bundle/程序集/归档索引；总量256MiB上限。
# 2.28 仅四作引擎探测：RJ01743835 / dennou-djibril / RJ01516248 / RJ01234887；dennou另采有限剧情和角色表样本。
# 2.27 RJ01746557 无人声诊断：仅回想scene4原生人声367KB、当前导出配置/脚本和匹配元数据；源只读。
# 2.26 RJ01746557：仅两种真实画面引用的纹理/音频范围约38.3MiB，源只读，不收完整纹理流。
# 2.25 RJ01746557 Naninovel：仅资源元数据与剧情程序集约47MiB，不收2.8GB纹理流；后续按实际引用补样本。
# 2.24 仅探测 RJ01746557：完整目录清单与至多8MiB引擎证据，不执行程序、不收其他游戏。
# 2.23 只采 ddd 访问诊断：少量无凭据只读请求与状态/响应头，正文最多读取512字节，不重传程序或资源。
VERSION="3.04"
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
# This round uses an overflow collection release; tag31 reached its attachment limit.
if [ "$TAG" = 31 ]; then TAG="gal-collect-20261116-scenes"; fi
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
import base64, collections, gzip, hashlib, io, os, re, stat as statmod, struct, sys, tarfile, time, json, zlib
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

PAIR_ACTIVE_GAMES = ['RJ01435937']
PAIR_GAME_PATTERNS = [(name,pattern) for name,pattern in [('RJ01435937', r'RJ01435937(?:[^0-9].*)?'), ('Kaiju Princess 2', r'Kaiju[ _-]+Princess[ _-]+2(?:[ _-]*(?:ver|v)?[0-9.]+)?'), ('RJ01562637', r'RJ01562637(?:[^0-9].*)?'), ('RJ01375307', r'RJ01375307(?:[^0-9].*)?'), ('future', r'future(?:[ _-]*v?[0-9.]+)?'), ('underworld', r'underworld(?:[ _-]*v?[0-9.]+)?'), ('RJ01743835', r'(?:RJ01743835(?:[^0-9].*)?|OrcX(?:[ _-]*(?:ver|v)?[0-9.]+)?)'), ('RJ01610452', r'RJ01610452(?:[^0-9].*)?'), ('RJ01319586', r'RJ01319586(?:[^0-9].*)?'), ('RJ01007726', r'RJ01007726(?:[^0-9].*)?'), ('dennou-djibril', r'dennou[ _-]+djibril(?:[ _-]*(?:ver|v)?[0-9.]+)?'), ('RJ01516248', r'RJ01516248(?:[^0-9].*)?'), ('RJ01234887', r'RJ01234887(?:[^0-9].*)?'), ('RJ01746557', r'RJ01746557(?:[^0-9].*)?'), ('fuyukuru', r'fuyukuru(?:[ _-]*v?[0-9.]+)?'), ('えどわ～る', r'えどわ[~〜～ー]?る(?:[ _-]*(?:ver|v)?[0-9.]+)?'), ('meshiagirl', r'meshiagirl(?:[ _-]*(?:ver|v)?[0-9.]+)?'), ('RJ01687472', r'RJ01687472(?:[^0-9].*)?'), ('RJ01610188', r'RJ01610188(?:[^0-9].*)?'), ('RJ01660877', r'RJ01660877(?:[^0-9].*)?'), ('RJ01474142', r'RJ01474142(?:[^0-9].*)?'), ('RJ01664771', r'RJ01664771(?:[^0-9].*)?'), ('Night Stroll',r'Night[ _-]+Stroll(?:[ _-]*(?:ver|v)?[0-9.]+)?')] if name in PAIR_ACTIVE_GAMES]

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
    if label=='Kaiju Princess 2'and not json.loads(zlib.decompress(base64.b64decode(PAIR_MEDIA_PLAN))).get(label):
        yield from new_game_probe_files(items)
        report={'sourceReadOnly':True,'files':[]};used=0
        for e in items:
            rel=e.rel.replace('\\','/');base=rel.rsplit('/',1)[-1]
            if not re.search(r'(?:^|/)[^/]+_Data/(?:Managed/Assembly-CSharp[^/]*\.dll|globalgamemanagers(?:\.assets)?|level[0-9]+|(?:sharedassets[0-9]+|resources)\.assets)$',rel,re.I):continue
            if re.search(r'(^|/)(save|savedata|userdata)(/|$)',rel,re.I):continue
            ranges=[(0,e.size)]if e.size<=8*MB and used+e.size<=96*MB else[(0,min(e.size,MB)),(max(0,e.size-40),min(40,e.size))]
            for offset,length in ranges:
                used+=length
                if used>112*MB:raise RuntimeError('Kaiju probe byte limit')
                with open(e.path,'rb')as f:f.seek(offset);data=f.read(length)
                if len(data)!=length:raise RuntimeError('Kaiju source changed')
                name='__kaiju_probe/files/'+rel+(''if length==e.size else'.'+str(offset)+'.range')
                report['files'].append({'path':rel,'sourceBytes':e.size,'offset':offset,'bytes':len(data),'name':name,'sha256':hashlib.sha256(data).hexdigest()})
                yield name,data,e.mtime
        yield '__kaiju_probe/index.json',json.dumps(report,ensure_ascii=False,indent=2).encode(),int(time.time())
        return
    report={'sourceReadOnly':True,'files':[]};used=0
    plan=json.loads(zlib.decompress(base64.b64decode(PAIR_MEDIA_PLAN))).get(label,[])
    if not plan:
        yield from new_game_probe_files(items)
        if label not in ('meshiagirl','dennou-djibril'):return
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
        if used>(192 if label in ('Kaiju Princess 2','RJ01435937')else 256 if label in ('future','underworld')else 128 if label in ('meshiagirl','dennou-djibril','RJ01234887','RJ01562637')else 64)*MB:raise RuntimeError('Pair media byte limit')
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
        if not (label in ('RJ01746557','future','RJ01562637','RJ01375307') and re.search(r'(?:^|/)arc/(?:native\.json|\.unity-stamp\.json|script/replay/scene4\.nani)$',rel,re.I) or re.search(r'(^|/)(EV003(?:_H0[234])?\.png|FK_SCENE_07\.smes|scsg01h\.edo|\.stamp\.json)$',rel,re.I)):continue
        if re.search(r'(^|/)(cache|script-backups|repair-backups|bundles)(/|$)',rel,re.I):continue
        if e.size>16*MB:raise RuntimeError('Pair runtime file exceeds16MiB: '+rel)
        with open(e.path,'rb')as f:b=f.read(e.size+1)
        total+=len(b)
        if len(b)!=e.size:raise RuntimeError('Pair runtime data changed: '+rel)
        if label=='future'and rel.endswith('/arc/native.json'):
            native=json.loads(b);digest=hashlib.sha256(b).hexdigest();locales=native.pop('locales',[])
            native['__collectionProjection']={'originalBytes':e.size,'sourceSha256':digest,'omittedLocales':len(locales),'reason':'native locale books already captured; retain full configs/models/presentation'}
            original_bytes=len(b);b=json.dumps(native,ensure_ascii=False,separators=(',',':')).encode();total+=len(b)-original_bytes
        if total>24*MB:raise RuntimeError('Pair runtime evidence exceeds24MiB: '+rel)
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
                item_id=str(doc.get('itemId',''))
                if re.fullmatch(r'[0-9a-f]{40}',item_id):
                    progress=os.path.normpath(os.path.join(base,'..','..','cache','library','reading-progress','gal',item_id[:2],item_id[2:4],item_id+'.json'))
                    if os.path.isfile(progress):
                        pst=os.stat(progress)
                        if pst.st_size>2*MB:raise RuntimeError('Pair reading progress exceeds2MiB')
                        with open(progress,'rb')as pf:progress_doc=json.load(pf)
                        payload=json.dumps(scrub(progress_doc),ensure_ascii=False,separators=(',',':')).encode();total+=len(payload)
                        if total>24*MB:raise RuntimeError('Pair runtime evidence exceeds24MiB')
                        yield '__pair_runtime/progress/'+aid+'.json',payload,int(pst.st_mtime)
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

def collect_ddd_access():
    """Small unauthenticated network comparison; never run bundled code or read tokens."""
    import urllib.request,urllib.error,socket
    game=root if os.path.basename(root).casefold()=='ddd'else os.path.join(root,'ddd')
    if not os.path.isdir(game):raise RuntimeError('未找到已采集的 ddd 目录；不扫描其他游戏')
    cdn='https://tonofura-r-cdn-resource.deepone-online.com/deep_one/'
    script=cdn+'download_adv/da/04/0b/f0/1cb84c652b90a5f8c968de640347a5d0.txt'
    browser={'User-Agent':'Mozilla/5.0','Referer':'https://tonofura-web-r.deepone-online.com/','Origin':'https://tonofura-web-r.deepone-online.com'}
    tests=[('script-basic',script,{},None),('script-browser',script,browser,None),
      ('voice',cdn+'download_adv/ef/54/7ebc86543b6bd0bd2c4987a9e8291fb1.mp3',{},None),
      ('preview',cdn+'download_game_hd/0b/99/de/0b/990b0bde874c6d019a527ab70ddf8345.png',{},None),
      ('manifest-no-credentials','https://tonofura-web-r.deepone-online.com/deep-one/api/story/getResource',{'Content-Type':'application/json'},b'{"storyIds":"10010204","adult":1}')]
    has_proxy=bool(urllib.request.getproxies().get('https'));routes=[('environment',urllib.request.build_opener())]
    if has_proxy:routes.append(('direct',urllib.request.build_opener(urllib.request.ProxyHandler({}))))
    report={'version':VERSION,'sourceReadOnly':True,'bundledCodeExecuted':False,'accountCredentialsUsed':False,'proxyConfigured':has_proxy,'maxResponseBytes':512,'rows':[],'dns':{}}
    for domain in['tonofura-r-cdn-resource.deepone-online.com','tonofura-web-r.deepone-online.com']:
        try:report['dns'][domain]=sorted({r[4][0]for r in socket.getaddrinfo(domain,443,type=socket.SOCK_STREAM)})
        except OSError as error:report['dns'][domain]={'errorType':type(error).__name__}
    for route,opener in routes:
        for label,url,headers,data in tests:
            req=urllib.request.Request(url,data=data,headers={'Range':'bytes=0-127',**headers}if data is None else headers,method='GET'if data is None else'POST')
            row={'label':label,'route':route,'url':url,'method':req.get_method()}
            try:
                try:response=opener.open(req,timeout=12)
                except urllib.error.HTTPError as error:response=error
                with response:
                    body=response.read(512);row.update(status=response.code,bytesRead=len(body),headers={k.lower():v for k,v in response.headers.items()if k.lower()in('server','content-type','content-length','content-range','x-cache','x-amz-cf-pop','www-authenticate')})
                    found=re.search(rb'<Code>([^<]{1,100})</Code>',body)
                    if found:row['errorCode']=found[1].decode('ascii',errors='replace')
                    elif response.code>=400:row['errorType']='http-error'
                    else:row['prefixHex']=body[:16].hex()
            except Exception as error:row['errorType']=type(error).__name__
            report['rows'].append(row);say('ddd 网络诊断 %s/%s: %s'%(route,label,row.get('status',row.get('errorType'))))
    payload=json.dumps(report,ensure_ascii=False,indent=2).encode()
    split=Split(os.path.join(out,'gal-collect-%s-%s-g01.tar.gz'%(ts,host)),lambda p:print('PART\t%s'%p,flush=True))
    with gzip.GzipFile(fileobj=split,mode='wb',mtime=0)as gz:
        with tarfile.open(fileobj=gz,mode='w|')as archive:
            info=tarfile.TarInfo('g01/__access_probe.json');info.size=len(payload);archive.addfile(info,io.BytesIO(payload))
    split.close()
    for name,data in{'games.tsv':'gid\trelpath\tengines\tfiles\tpicked\tpicked_bytes\ng01\tddd\tnetwork-probe\t0\t1\t%d\n'%len(payload),'manifest.tsv':'gid\trel\tmode\trule\tsize\tstored_bytes\tsha256\ng01\t__access_probe.json\tmetadata\tdirectory:ddd-access\t%d\t%d\t%s\n'%(len(payload),len(payload),hashlib.sha256(payload).hexdigest()),'info.json':json.dumps({'version':VERSION,'games':1,'mode':'ddd-network-probe','sourceReadOnly':True,'requests':len(report['rows'])})}.items():
        with open(os.path.join(out,name),'w',encoding='utf-8')as output:output.write(data)

def collect_ddd_directory():
    """Explicit full-directory request; no game/media/cache/hidden-file exclusions."""
    games=[]
    for directory,dirs,_files in walk_follow(root):
        rel=os.path.relpath(directory,root)
        if os.path.basename(directory).casefold()=='ddd':
            if not ONLY or ONLY.search(rel):games.append(directory)
            dirs[:]=[]
        else:
            depth=0 if rel=='.' else len(rel.split(os.sep))
            dirs[:]=sorted(d for d in dirs if depth<8)
    if not games:raise RuntimeError('未找到 ddd 目录；本轮未采其他目录')
    sources=[];total=0
    for game in games:
        if os.path.commonpath([os.path.realpath(out),os.path.realpath(game)])==os.path.realpath(game):
            raise RuntimeError('采集输出不能位于 ddd 源目录内')
        entries=[]
        def failed(error):raise error
        for directory,dirs,files in os.walk(game,followlinks=False,onerror=failed):
            dirs.sort();files.sort()
            for name in dirs+files:
                file=os.path.join(directory,name);st=os.lstat(file)
                kind='link'if statmod.S_ISLNK(st.st_mode)else'directory'if statmod.S_ISDIR(st.st_mode)else'file'if statmod.S_ISREG(st.st_mode)else'unsupported'
                if kind=='unsupported':raise RuntimeError('ddd 中存在无法完整打包的特殊文件: '+os.path.relpath(file,game))
                entries.append((os.path.relpath(file,game).replace(os.sep,'/'),file,st,kind))
                if kind=='file':total+=st.st_size
        sources.append((game,entries))
    if total>TOTAL_MAX:raise RuntimeError('ddd 完整目录共%.1fMiB，超过总量上限%dMiB；没有截断或退成头尾采样'%(total/MB,TOTAL_MAX//MB))
    say('仅完整采集 ddd：%d 个目录，%d 项，原始%.2fMiB；包含隐藏文件、依赖、缓存和媒体；软链接保留链接本身；源目录只读'%(len(sources),sum(len(v)for _g,v in sources),total/MB))
    class HashedReader:
        def __init__(self,file):self.file=file;self.hash=hashlib.sha256();self.size=0
        def read(self,n=-1):
            data=self.file.read(n);self.hash.update(data);self.size+=len(data);return data
    done=0
    with open(os.path.join(out,'games.tsv'),'w',encoding='utf-8')as gl,open(os.path.join(out,'manifest.tsv'),'w',encoding='utf-8')as mf:
        gl.write('gid\trelpath\tengines\tfiles\tpicked\tpicked_bytes\n');mf.write('gid\trel\tmode\trule\tsize\tstored_bytes\tsha256\n')
        for number,(game,entries)in enumerate(sources,1):
            gid='g%02d'%number;index=[];stored=0
            split=Split(os.path.join(out,'gal-collect-%s-%s-%s.tar.gz'%(ts,host,gid)),lambda p:print('PART\t%s'%p,flush=True))
            with gzip.GzipFile(fileobj=split,mode='wb',compresslevel=6,mtime=0)as gz:
                with tarfile.open(fileobj=gz,mode='w|')as archive:
                    for count,(rel,file,st,kind)in enumerate(entries,1):
                        current=os.lstat(file)
                        if(current.st_ino,current.st_size,current.st_mtime_ns,current.st_mode)!=(st.st_ino,st.st_size,st.st_mtime_ns,st.st_mode):raise RuntimeError('ddd 源文件在采集前改变: '+rel)
                        info=tarfile.TarInfo(gid+'/files/'+rel);info.mode=st.st_mode&0o777;info.mtime=int(st.st_mtime)
                        row={'path':rel,'kind':kind,'size':st.st_size if kind=='file'else 0,'mtimeNs':st.st_mtime_ns,'mode':info.mode}
                        if kind=='directory':info.type=tarfile.DIRTYPE;archive.addfile(info)
                        elif kind=='link':
                            info.type=tarfile.SYMTYPE;info.linkname=os.readlink(file);row['target']=info.linkname;archive.addfile(info)
                        else:
                            info.size=st.st_size
                            with open(file,'rb')as source:
                                reader=HashedReader(source);archive.addfile(info,reader);after=os.fstat(source.fileno())
                            if reader.size!=st.st_size or(after.st_size,after.st_mtime_ns)!=(st.st_size,st.st_mtime_ns):raise RuntimeError('ddd 源文件在采集中改变: '+rel)
                            row['sha256']=reader.hash.hexdigest();stored+=reader.size;done+=reader.size
                        index.append(row);mf.write('%s\t%s\t%s\tdirectory:ddd\t%d\t%d\t%s\n'%(gid,json.dumps(rel,ensure_ascii=False),kind,row['size'],row['size'],row.get('sha256','')))
                        if count%100==0 or count==len(entries):say('ddd %s: %d/%d 项，完整读取%.2f/%.2fMiB'%(gid,count,len(entries),done/MB,total/MB))
                    report={'version':VERSION,'root':os.path.relpath(game,root),'sourceReadOnly':True,'complete':True,'regularFileBytes':stored,'symlinkPolicy':'preserve-links-without-following','entries':index}
                    data=json.dumps(report,ensure_ascii=False,indent=2).encode();info=tarfile.TarInfo(gid+'/__directory-index.json');info.size=len(data);archive.addfile(info,io.BytesIO(data))
            split.close();gl.write('%s\t%s\tfull-directory\t%d\t%d\t%d\n'%(gid,os.path.relpath(game,root),len(entries),len(entries),stored))
    with open(os.path.join(out,'info.json'),'w',encoding='utf-8')as info:json.dump({'version':VERSION,'ts':ts,'host':host,'root_name':os.path.basename(root),'games':len(games),'mode':'full-ddd-directory','complete':True,'sourceReadOnly':True,'totalBytes':total},info,ensure_ascii=False,indent=2)

def main():
    if RULES_RE is not None and RULES_RE.pattern=='^directory:ddd-access$':
        collect_ddd_access();return
    if RULES_RE is not None and RULES_RE.pattern=='^directory:ddd$':
        collect_ddd_directory();return
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
        if 'underworld' in missing:
            for x in os.listdir(root):
                if re.search(r'under|world',x,re.I):
                    p=os.path.join(root,x);say('underworld 候选: '+repr({'name':x,'isDir':os.path.isdir(p),'isFile':os.path.isfile(p),'isLink':os.path.islink(p),'target':os.path.realpath(p)}))
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
                    if total+len(data)>min(TOTAL_MAX,(256 if RULES_RE is not None and RULES_RE.pattern=='^new-games:fuyu-edo$' and PAIR_MEDIA_PLAN else 336 if RULES_RE is not None and RULES_RE.pattern=='^new-games:playback$'else 640 if scene_audit else 32 if new_games_next_verify else 128 if new_games_next_detail or RULES_RE is not None and RULES_RE.pattern=='^new-games:fuyu-edo$' and new_game_label(os.path.basename(game))=='meshiagirl' else 64)*MB): raise RuntimeError('定向证据超过本轮总量上限')
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
