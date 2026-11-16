# OrcX、RJ01375307、future、RJ01562637 接入记录

日期：2026-11-16。布局脚本版本：2.73.0。需要更新统一镜像；仅替换 tag 脚本不能提供这些新增解析器。

## 导入配置

在“导入方案 → 刷新 JSON”左侧可选 OrcX、CatPaw future、Unity Spine 原生 CG 动作预览；RJ01375307 继续用现有 RPG Maker 选项。每个游戏分别建立方案，修改 rootDir 和 title。

| 目录 | adapters | config.game.id | 当前范围 |
| --- | --- | --- | --- |
| RJ01743835/OrcX | `["orcx::script"]` | `orcx::RJ01743835` | 原生剧情、背景、立绘、CG、声音；部分演出标签待核对 |
| RJ01375307 | `["rpgmaker-json"]` | `rpgmaker::rj01375307` | 复用 RPG Maker MZ，增加原生 Hakubox 插件命令、配音及 Spine 多皮肤支持 |
| future | `["catpaw::script"]` | `catpaw::future` | 本地主线、回想、Live2D、声音；部分摆放和控制器演出尚未还原 |
| RJ01562637 | `["unityspine::gallery"]` | `unityspine::RJ01562637` | 原生 CG／动作预览；未执行经营、触摸或剧情控制器 |

```json
{
  "rootDir": "/data/library/gal/RJ01743835/OrcX",
  "adapters": ["orcx::script"],
  "defaultMetadataActions": ["gal-layout"],
  "dryRun": false,
  "config": {
    "game": {
      "id": "orcx::RJ01743835",
      "title": "自己设置的标题"
    }
  }
}
```

其他游戏按上表替换三个字段。用户提供的标题保留。新增家族均有缩略图候选、特殊场景汇总及中途开始标记；标记只覆盖已解析的画面/动作切换，不代表原生所有控制流均已实现。

## 采集事实与验证

原始数据、样本和测试报告仅放本地 `.cache/five-new-games-20261116/`，未提交游戏素材。源目录只读，未执行游戏 EXE、DLL 或 JS。稀疏样本只保证明确采集的字节区间有效，不拿空洞作为真实素材验证。

### OrcX

- Unity 6000.3.19 IL2CPP；866 个原生剧本，11,875 个作用域资源。Common/Main 同名文件分开索引。
- 866 个剧本全部解析，无抛错，共生成 23,214 步和 7,774 条语音指令；这不是每段完整原生演出均通过验证的声明。
- 导入、layout、列表、资源读取通过。`00_op_000` 样本 39 步、6 条语音、4 个中途标记；`50_ap_001_02_02_00` 样本 85 步、34 条语音。
- 浏览器实测背景、人物叠放及 CG；切换 CG 时人物正确清除。真实声音解码为 8.605 秒 PCM，RMS 0.240。
- 未核对的 CG 变体、调查控制流、计数和演出效果保留原脚本及行号诊断，不猜测资源后缀含义。

### RJ01375307

- RPG Maker MZ，原生 Hakubox 插件。只在原生 Hakubox_Core 启用时接入，其他 RPG Maker 不触发这些命令。
- 原生图片层、CV 目录、循环背景帧、多皮肤组合、服装/表情切换及显隐命令已接入。atlas 中文页名按原生预加载表映射至实际文件。
- 252 个公共事件解析通过。common-131 样本为 272 步、104 条语音指令（包含分支/调用展开，不等同原版一次游玩的句数）。
- 真实浏览器 Spine 显示、皮肤组合加载通过；`audio/cv/kana/cv_kana_184.ogg` 实际播放，10.897 秒，RMS 0.0908。
- 未执行好感度、日记、玩法计数、部分自定义 JS 与控制器逻辑，保留原始事件诊断。

### future

- 原生目录确实叫 `futrue_Data`。SENS 独立 RC4 块按需读取，footer/逻辑尺寸/边界校验，源文件不变。
- 4,945 条原始 talk 数据；31 个主线、24 个回想、31 个模型。55 个场景解析无抛错，共 5,655 步、3,192 条语音指令；存在分组复用，不作为去重台词数。
- Animator 状态通过实际 controller → AnimationClip → ResourceManager 引用解析原始 motion3，不按编号猜动作。
- `replay/100006` 导入得到 53 步、33 条语音引用；实际浏览器显示 119 个网格、106 个绘制网格，两张 8192 图集均成功读取，连续帧变化、暂停稳定。
- `talk100003` 实播 3.242 秒、RMS 0.0463；`alose_scene0` 实播 10 秒、RMS 0.00379。浏览器 Audio.currentTime 正常推进。
- 普通立绘精确位置、头像面板、部分非回想工具及事件控制器尚未还原，保留源行诊断；不能称为整段原生游戏逻辑完整复现。

### RJ01562637

- Fox Sex Farm，Unity 2021.3.45f2。目录里的 Utage 示例不是主游戏剧情，未错误套用 Utage。
- BuildSettings 有 32 个场景，其中 28 个原生 CG 房间。沿实际 level → Main SkeletonGraphic → SkeletonDataAsset → atlas/material/Texture2D 引用读取。
- 全部 28 个 CG 骨架及动作表解析通过；每个含 14–137 个动作，总计 2,092 个动作预览步骤。
- 实际导入列表有“特殊场景”和“角色CG”。`Ch02_Hcg01_黃毛正常位` 的 `z.premix/sex_lv1` 用真实 4096 图集在浏览器播放，Spine 4.2.43，无缺页/缺动作；连续帧变化、暂停稳定。
- 当前是 CG 资源/动作预览，未接经营、触摸、配音调度、剧情控制器。界面选项、列表和 raw 诊断均注明这一范围。

### underworld 阻塞原因

入口是失效软链接：

```text
/mnt/s1/nas/k8s/manga-image-translator/copymanga/data/library/gal/[G]/[]/underworld
  -> /mnt/s1/nas/k8s/manga-image-translator/copymanga/data/library/gal/[G]/Cat Paw Game/underworld
```

目标不存在，入口 isLink=true、isDir=false、isFile=false，因此没有游戏数据可采。未凭目录名猜测引擎或宣布支持。修复链接或放回目标后再采集。

## 依赖及兼容性

- 没有新增 npm/Python 运行时依赖，没有镜像正常运行时下载。
- Spine 元数据只复用镜像现有、固定 SHA256 的官方 Spine 4.2 JS 解析器，vm 中不暴露文件/模块/网络，仅传骨架和 atlas 数据；不执行游戏脚本。生产镜像的构建步骤本来已打包此文件。
- LZMA 解码复用已有 gal-download 的纯 Node 实现；SENS 用 Node 内建能力。
- Unity 2021 类布局来自 AssetRipper/TypeTreeDumps 的 2021.3.45f2；Animator 类布局来自 2022.3.0f1。SpineAtlasAsset/AtlasAssetBase 的字段结构与官方 spine-runtimes 4.2 源码及实际序列化字节核对。
- 参数漂移守卫通过：42 个注册适配器、64 个布局配置；导入下拉浏览器测试通过。旧 krkr 布局、BGI、RPG Maker、Djibril、RexEX、Utage、Naninovel、Unity Unite/CellTalk 回归通过。
- 真实浏览器报告：`browser-report.json`、`future-browser-report.json`、`fox-browser-report.json`；静态场景扫描报告：`all-scenes-report.json`、`rpg-audit.json`。这些报告留在上述本地 cache。
