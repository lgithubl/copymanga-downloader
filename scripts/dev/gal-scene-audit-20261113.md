# 2026-11-13 场景、动态CG和语音采集核对

## 本轮采集器1.61

默认规则 `^new-games:scene-audit$`，已同步启动分支 `vibe-test-20261008`。仍执行原来的 `bash gal-collect.sh .`，根目录为原有gal目录。只处理下列四作，NAS源文件只读；不执行游戏JS、EXE/DLL，不安装或下载运行时。

| 游戏 | 本轮读取/输出 | 原因与边界 |
| --- | --- | --- |
| ツヴァイトリガー | data/patch/evimage/video.xp3的完整有界索引和特殊索引；data≤128KiB、patch≤256KiB、evimage≤4KiB的小条目；其余条目每段最多1024字节；可直接识别的l2d模型包最多2个、每包≤32MiB | 官方补丁明确存在Live2D CG。旧五份剧本样本未覆盖动态入口，旧采集没有video包索引，不能推断无动态。收脚本/配置与实际资源类型证据，不传整包。大条目前缀记录fullSegment=false；若模型名加密导致本轮未取整包，completeModelPackages=0会明确显示，不能声称已取完整模型。 |
| Remastered | sc0561与global_config/global2/system的精确原生bundle；BG002AAL、CS006AB、EV056AA/AD、EV057AA，合计8,519,019字节 | 必须验证原场景的背景、立绘、CG一起显示。按已核对的档案索引/长度/精确范围读取，索引变更立即拒绝旧偏移。 |
| RJ328940 | 全地图事件投影、全部事件页/条件/指令/调用关系、CommonEvents/MapInfos/System/插件配置版本、SimpleVoice原生改版证据、完整图音引用表；最多3个匹配语音和3个CG样本 | 已知970张Map原文件约89MB；只省略地图格子数组data，不省略正文或事件命令。特殊场景入口必须与真正被调用的事件及媒体对应，不能只打开公共事件片段。 |
| RJ01271506 | 全地图事件投影（含TemplateEvent声明的模板地图）、完整调用及图音引用；voice_list、DLC list/部署配置、Sound/DLC/i18n相关源；最多3个实际存在且匹配引用的语音和3个CG样本 | 已知311张Map原文件约30.5MB。逐个TRN编号同时记录原作voice_list是否声明语音、实体文件是否位于DLC，区分原本无配音与适配遗漏。 |

事件投影放在 `__scene-audit/event-maps/`，完整保留events/pages/conditions/list及其他地图元信息，明确记录唯一省略字段data、原文件SHA和投影SHA。它是分析材料，不冒充完整地图格子资源。

每作有 `__scene-audit/index.json`，另有 `callers.json`、`audio-references.json`、`picture-references.json`。音频引用表保留物理源路径，报告各类型存在/缺失及原生配音声明数量。以前收过且SHA相同的核心文件明确列入reused，不重复上传；变过的完整重收。Twi模型/前缀、投影/原始数据都明确区分。

单原始Map≤16MiB、每作Map读取量≤128MiB；输出每作≤64MiB（Twi≤96MiB）、四作合计≤256MiB原始数据，压缩分卷上传。超过限制报错，不静默截断。分卷日志会显示实际大小。

原 `GAL_COLLECT_TSK_LOG=N` 优先级保留；要明确执行新四作默认轮次，可运行：

```sh
env -u GAL_COLLECT_TSK_LOG -u GAL_COLLECT_RULES bash gal-collect.sh .
```

## Remastered sc0561已实际复现的错误

源脚本有31次EV056/EV057画面设置，原始global_config里IS_USE_HSCENE=1。直接将带`.txt`的源码名称塞入prepare时显示正常，但真实容器输出的name是`src/sys/global_config`，没有扩展名。适配器只接受`.txt`结尾，未读到默认值；后续条件变量按0初始化，整段CG被跳过。

本轮先用实际导入→gal-layout→容器解码→上下文→sc0561阅读接口复现：IS_USE_HSCENE=0，可达CG步骤0；修复后IS_USE_HSCENE=1，237个可达步骤中150个有EV056/EV057。新增回归覆盖真实容器名称，不再只拿手工带扩展名的包装证明通过。显式用户变量仍优先。

BG/EV层级在通用canvas实现里还有需要检查的地方，但sc0561进入CG前明确alldel，不能将它直接归因于背景遮挡。本次已证明的原因是默认配置读取失配；指定场景实际图片仍补采用于完整画面验收，不能只以CG单图能解码当场景正确。

## 两作原生语音遗漏依据

- RJ328940的SimpleVoice重写了AudioManager.playSe：文件名含`_lize`、`_meifa`等角色后缀时调用语音播放。已收CommonEvents中有1541条这类SE语音事件，另有显式SV调用。仅识别SV命令会漏语音语义；SE和语音的音量、停止、重播也需一致处理。
- RJ01271506的Sound.js在setOnTRNHandler里自动触发`unique/<编号>`，voice_list决定哪些TRN本来配音。实际声音位于`dlc/dlc_10000/audio/voice/unique/*.ogg_`，原DLC插件将逻辑路径重定向到DLC。之前只是剥离TRN文本标记，既没有触发这条链，也未完整接通DLC路径。全地图和模板调用是核对场景数、CG初始化和台词/语音关系的必要证据。

上述是源代码证据，不表示每条文本原本都有独立语音；本轮完整引用/文件对照会明确区分。

## 天結いラビリンスマイスター：本轮不补采

1.57数据在 `.cache/age-072229/extracted/g01/`，25份、11,329,945字节全部长度和SHA-256通过：17份脚本（含SN0000/SNINIT/MUINIT/CSINIT/CCINIT/CGINIT等）、6张背景/身体/表情AGF、2份XWM音频。17份脚本全部通过指令边界检查，6张图均已解码。

SN0000有4335条指令，当前有界执行器在首个未支持的0x1f4语义处停止；MUINIT/CSINIT/CCINIT/CGINIT的标量追踪可以结束。当前缺口是引擎语义及真正的播放适配器，**已有数据够继续实现，不是再重复收一遍25份文件**。仍不能宣称AGE已经可导入/完整播放；今后若定位到新的明确资源依赖再按序号补，当前不泛采整包。

## 验证

- gal-collect-scene-audit-selftest.py：四作路由、完整事件投影、TRN/DLC与SE语音、模板ID、同SHA复用、完整模型与前缀区分、旧索引/坏档案拒绝、源文件不变。
- gal-collect-mz-templates-selftest.py / gal-collect-followup-selftest.py / gal-collect-age-link-selftest.py：旧定向模式兼容。
- gal-collect-download-logs-selftest.py：TSK最近N次日志环境变量不受新默认规则影响。
- gal-age-selftest.mjs：真实新收AGE25份数据完整性及当前语义缺口。
- gal-followup-scenes-selftest.mjs：实际Remastered导入/容器/阅读链回归，以及原有场景回归。

原作动态CG的官方依据：[ツヴァイトリガー1.1补丁说明](https://orthrossoft.jp/tweitrigger/special/support.html)，明确修复CG鉴赏中Live2D动画显示/差分问题。现有通用Live2D支持不等于本作动态场景已经验证。
