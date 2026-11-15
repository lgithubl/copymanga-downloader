# 六作接入与验证（2026-11-15）

本轮目录采集、原生资源解析、导入入口和阅读器接入。分支 `feat/gal-download`；自动采集分支 `vibe-test-20261008`。更新镜像后，对这六作重跑 `gal-layout` 2.66.0。

## 入口与覆盖范围

| 游戏 | adapter | game.id 示例 | 当前边界 |
| --- | --- | --- | --- |
| RJ01610188／魔法少女ヨルティナ | `naninovel::script`（新增） | `naninovel::RJ01610188` | 174 原生 playlist，配置、人物分层、背景、CG、原始配音；特殊场景按原始 CG 调用归类。个别自定义特效记 raw。 |
| RJ01660877／GirlsClub | `utage::native`（新增） | `utage::RJ01660877` | 163 本体工作簿，保留独立 grid 入口；原生回想表 29 项；图片、声音、A/B/C Cubism 资源与原始曲线。游戏经营界面、部分系统回调/特效不执行，记原行 raw。 |
| RJ01474142／GirlReno | `rpgmaker-unite`（新增） | `unite::RJ01474142` | 344 可读事件入口、77 特殊场景；UUID/字符串参数转换后复用 RPG 编译器；VoiceEvent、原生选项、本地化人物名。没有存档的条件让用户选择；不实现战斗或地图探索。 |
| Night Stroll | `rpgmaker-json`（复用） | `rpgmaker::night-stroll` | 原生回想 42 项；Live2DInterfaceMZ 别名、位置、缩放与多槽位；实际 R018 的 Moc3 v5 几何/动画。 |
| RJ01664771 | `rpgmaker-json`（复用） | `rpgmaker::RJ01664771` | 原生回想 30 项，跟随回想目的地图唯一自动剧情；TRP Skit 单层身体与独立表情图、SimpleVoice。 |
| RJ01687472／Dark Elf Descent into Corruption | `celltalk::native`（新增，静态预览） | `celltalk::RJ01687472` | **不是完整游戏执行器**。已核对构建的 46 个回想控制器静态调用图，其中 44 个有可读正文；按原生 ID 范围/存档条件组织台词，按 CG 预制体/脸部组件引用导出图层，支持原始语音。其余控制器及原生动画/立绘操作见诊断。 |

新增四项全部进入“导入方案 → 刷新 JSON”左侧下拉。两作 MZ 使用现有 RPG Maker 选项，不重复新增。所有入口保留用户的 title；家族 id 的后缀可由用户自己命名。

## 配置示例

```json
{
  "rootDir": "/data/library/gal/RJ01610188",
  "adapters": ["naninovel::script"],
  "defaultMetadataActions": ["gal-layout"],
  "dryRun": false,
  "config": {"game": {"id": "naninovel::RJ01610188", "title": "魔法少女ヨルティナ"}}
}
```

其他游戏按表替换 rootDir、adapters、id、title。布局自动寻找原始 `*_Data`（含 `Game/*_Data`），不要求用户预先导出 UnityPy 文件。不要把这四种原生 Unity 当成 `unity::dsm` 或 UViewer。

## 原始素材与运行方式

- UnityFS 只读取命中的 LZ4 块；大型 textures/audio stream 按需读范围，不在打开列表时导出整批素材。
- Naninovel 的 SerializeReference 命令与配置均严格校验字段尾部；序列化布局作为静态数据随镜像内置。未执行任何采集到的 DLL/插件 JS。
- CellTalk 生产环境只读内置的数据调用图；GameAssembly 和 metadata 的 SHA-256 必须同时匹配。静态提取工具 `gal-celltalk-profile-dev.py` 仅供本地开发，依赖 pefile/capstone；不进入镜像，不运行原生指令。
- PNG 解码使用 Node 和既有 sharp；音频使用已有 FSB5/Vorbis 数据及 ffmpeg。Crunch 使用随镜像内置的约 178 KiB loader+WASM（版本及 SHA 在 vendor/texture2ddecoder/NOTICE.md）。**没有运行时下载、pip/npm 安装、UnityPy 或 Windows 依赖。**
- 小脚本写在游戏 Data 下 arc/script；旧导出移动到 arc/cache/script-backups。原始资源只读，媒体按普通资源缓存路径处理，没有直接删除源文件。
- Live2D 多槽位与 Moc3 v5 是新增路径，旧默认 Live2D 槽位保持兼容；缩略图复用同一个模型解码器，离屏截图才保留帧缓冲。

## 验证

始终区分“解析完成”“组件显示”“原生整段剧情完全执行”。fixture 位于 `.cache/six-games-20261115`，不提交原始 CG、配音、DLL 或游戏脚本。

- `gal-six-unity-selftest.mjs`：原始导入 → layout → 列表 → 真实场景 → PNG/模型 JSON、Ogg 字节；验证标题和配置，另测 sprite 裁边还原、范围与分支、损坏输入边界。
- `gal-six-native-mz-selftest.mjs`：42/30 原生回想、唯一自动事件、安全保留旧行为、真实 R018 v5 可见动态顶点。
- `fe-gal-six-native-selftest.mjs`：真实浏览器显示、音频、动态模型及 Live2D 缩略图，输出在 `.cache/six-games-20261115/browser-verified/`。
- 旧 RPG/Live2D 回归、布局参数漂移守卫、导入下拉覆盖守卫。

采集包含目录索引、剧情数据和指定的媒体样本/字节范围。大 Unity stream 采用稀疏本地验证副本，仅填充明确采集的范围；未采媒体不能因此声称已验证。CellTalk 的其余 CG 只采了 CAB 元数据所在块，并未批量下载全部 CG/声音。

## CellTalk 尚未完整覆盖

已核对的 54 个回想控制器中，10 个未进入可读预览：露出1、軍団長の夜伽5、踊り、母乳イベント、娼館、娼館ピエトロ、娼館手ほどき、レイス凌辱、軍団長の夜伽6、街の支配者。需要继续处理协程子调用、动态选项或反编译缺失的分支；其中两项只有未还原子协程，不作为空场景展示；不会把整张文本表直接拼成假剧情。

已导出控制器内，原生 `Animator`、`Stand*`、部分摄像机/系统调用仍带 native 地址记 raw；因此不承诺这些场景与原游戏演出完全一致。采集表中还存在控制器引用但文本表没有的 ID：はぐれ兵凌辱 的「非処女」「処女」、サキュバス凌辱 的「暗転」，单独记录 missing-text-id，不猜台词替代。存档条件以手动选择呈现。

后续修改 native profile/导出协议需更新 UNITY_NATIVE_VERSION，避免继续读取旧导出。只升级 tag 脚本无法启用此次新增的解析器和 Moc3 v5，必须更新镜像。
