# 2026-11-13 场景、动态CG和语音采集核对

## 本轮采集器1.62

默认规则 `^new-games:scene-audit$`，已同步启动分支 `vibe-test-20261008`。仍执行原来的 `bash gal-collect.sh .`，根目录为原有gal目录。只处理下列四作，NAS源文件只读；不执行游戏JS、EXE/DLL，不安装或下载运行时。

| 游戏 | 本轮读取/输出 | 原因与边界 |
| --- | --- | --- |
| ツヴァイトリガー | data/patch/evimage/video.xp3的完整有界索引和特殊索引；data≤128KiB、patch≤256KiB、evimage≤4KiB的小条目；其余条目每段最多1024字节；可直接识别的l2d模型包最多2个、每包≤32MiB | 官方补丁明确存在Live2D CG。旧五份剧本样本未覆盖动态入口，旧采集没有video包索引，不能推断无动态。收脚本/配置与实际资源类型证据，不传整包。大条目前缀记录fullSegment=false；若模型名加密导致本轮未取整包，completeModelPackages=0会明确显示，不能声称已取完整模型。 |
| Remastered | sc0561与global_config/global2/system的精确原生bundle；BG002AAL、CS006AB、EV056AA/AD、EV057AA，合计8,519,019字节 | 必须验证原场景的背景、立绘、CG一起显示。按已核对的档案索引/长度/精确范围读取，索引变更立即拒绝旧偏移。 |
| RJ328940 | 全地图事件投影、全部事件页/条件/指令/调用关系、CommonEvents/MapInfos/System/插件配置版本、SimpleVoice原生改版证据、完整图音引用表；最多3个匹配语音和3个CG样本 | 已知970张Map原文件约89MB；只省略地图格子数组data，不省略正文或事件命令。特殊场景入口必须与真正被调用的事件及媒体对应，不能只打开公共事件片段。 |
| RJ01271506 | 全地图事件投影（含TemplateEvent声明的模板地图）、完整调用及图音引用；voice_list、DLC list/部署配置、Sound/DLC/i18n相关源；最多3个实际存在且匹配引用的语音和3个CG样本 | 已知311张Map原文件约30.5MB。逐个TRN编号同时记录原作voice_list是否声明语音、实体文件是否位于DLC，区分原本无配音与适配遗漏。 |

事件投影放在 `__scene-audit/event-maps/`，完整保留events/pages/conditions/list及其他地图元信息，明确记录唯一省略字段data、原文件SHA和投影SHA。它是分析材料，不冒充完整地图格子资源。

每作有 `__scene-audit/index.json`，另有 `callers.json`、`audio-references.json`、`picture-references.json`。音频引用表保留物理源路径，报告各类型存在/缺失及原生配音声明数量。以前收过且SHA相同的核心文件明确列入reused，不重复上传；变过的完整重收。Twi模型/前缀、投影/原始数据都明确区分。

单原始Map≤16MiB、每作Map读取量≤128MiB；输出两RJ各≤192MiB、Twi≤96MiB、Remastered≤64MiB，四作合计≤640MiB原始数据，压缩分卷上传。超过限制报错，不静默截断。分卷日志会显示实际大小。

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


## 1.62容量回归

1.61在RJ328940完整事件投影超过64MiB时中止；原先只用小路由夹具验证，未覆盖实际数据量。新增970张地图、约84MiB事件投影的真实采集流程回归：旧版复现相同错误，新版完整保留首尾正文、全部970份投影及SHA/长度，源文件不变。预算按压缩前数据计算，40MiB压缩分卷不变；单游戏及总量预算同时修正，避免过了单游戏限制后又被旧总量限制卡住。RJ01271506已成功上传的20261112-161118/g01无需重采。

## 2.62.0：本轮接收、实现和实测

收到20261112-161723四作数据和20261112-162717单模型补采；逐文件长度和SHA-256核对通过。后者仅包含ev_yuna03.l2d的完整加密段16,560,537字节，未上传整份data.xp3。模型解密后ZIP校验通过，含原生moc3、3张KTX纹理、5段motion3和3种expression。

- **ツヴァイトリガー**：原生PSB实际使用eventx/evx，旧压缩解码器把该类图层过滤掉，资源名也因此未进入懒加载索引。现在保留eventx，只有本作配置eventClasses=[event,eventx]才播放它；旧家族默认仍是[event]。本作特殊场景汇总同步识别eventx。Krkr解码缓存增加独立指纹，更新后重解脚本并重建模型引用，不需要用户删除源包。Live2D增加原生exp3的Add/Multiply/Overwrite表情参数混合。原生导入→layout→分页卡片→yn03阅读接口→懒加载模型全部通过；Chromium实际WebGL绘制141个网格，002.motion3连续两帧像素不同。模型、动作、表情、纹理均来自本次数据，没有增加SDK或运行时下载。只实测这一个完整模型，不代表21个模型和全部动态效果逐个验收。
- **Remastered sc0561**：补齐原场景图片后，经实际导入/阅读接口，完整画面状态先出现BG002AAL+CS006AB，再进入EV056AA。浏览器验证保留原场景所有视觉命令，没有剥离背景只显示CG。IS_USE_HSCENE原生默认值修复已在2.61.1发布，本轮是补足目标场景的实图验证。
- **RJ01271506**：按已启用TemplateEvent的原生地图清单解析静态模板引用，452个引用全部命中；保留原始事件给CALL_ORIGIN_EVENT，支持固定页和当前条件页的CALL_MAP_EVENT。Map102/event20原先只有一页，实际继承Map252/event13的七页；第5页可以进入真正的CG剧情。PictureAnimation的number编号模式按原插件SET_CELL0递增、正数从1计数更新图片，不再永远留在H001_00。特殊场景去重保留设置图片后的完整地图调用入口，公共事件仍可在调试目录查看。原生目录有148个地图组、280个特殊条目（包含模板/实际事件页，不等于280段独立游戏CG）。Sound原生TRN钩子按voice_list触发，DLC资源根读取真实加密ogg_。5949/5950/5951实际资源解密头为OggS，实际CG页的H001_01经导入/资源/浏览器验证。311张地图没有一个消息窗口含多个TRN；按原生101/401窗口分组，不拆台词。引用的53,528个unique编号中12,882有配音声明和实体文件，其余42,646原本没有对应语音文件，不能承诺每句有配音。
- **RJ328940**：全部970张地图投影保留事件页/指令，配置可调maps.maxBytes默认128MiB，解决旧64MiB上下文丢尾部地图。原版约89MB未超过新上限。SimpleVoice修改版通过AudioManager.playSe播放角色语音；角色前缀匹配放本作配置，适配器将匹配项标为voice并从audio/se读取，普通音效仍是SE，显式SV仍使用原插件配置的voice目录。原生Map016/event11中的_Meifa_SceneA_27经导入/资源/浏览器验证；全部特殊场景和语音时序未逐条人工验收。
- **封面覆盖**：显式cover原已保存且优先于coverExe，旧固定URL允许浏览器缓存24小时。现在URL携带封面/裁切/layout运行版本，封面端点使用must-revalidate；实际HTTP验证不同路径换图、同路径换文件、ETag304均通过。这部分需要新镜像。

验证：gal-scene-routing-selftest（7项）、RPG/旧KK/Edo回归合计36项、gal-followup-scenes-selftest（9项）、gal-layout-rules-selftest（8项）、gal-live2d-selftest及gal-cover-refresh-selftest通过。fe-gal-scene-audit-selftest覆盖上面四作真实资源与Chromium；证据日志保留在.cache/scene-audit-161/analysis。采集器单模型与四作模式回归均通过，NAS源文件只读。没有新增依赖。

使用：更新统一Release镜像、重新导入统一tag脚本包，执行gal-layout 2.62.0，再刷新列表；无需重新下载游戏或删除bundles。旧KK布局回归继续通过。天結いラビリンスマイスター的AGE执行语义仍未完成，已有采集足够继续分析，不列为本次已支持。
