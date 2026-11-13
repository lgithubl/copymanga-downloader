# 播放故障补采 1.64

默认规则 `^new-games:playback$`，沿用 `gal-collect.sh` 启动流程。只读 RJ01271506、RJ328940、ツヴァイトリガー；不执行游戏 JS/EXE/DLL，不访问会触发容器展开写入的 reader/resource HTTP 接口。

目的：复现实际媒体入口，而不是继续用直接 adapter.parse 或孤立 Live2D 渲染器代替完整浏览链路。

- 从 Gal 根旁的 `../../library-meta/gal` / `../library-meta/gal` 查找已导入条目；可用 `GAL_COLLECT_META_DIR` 指向现有目录。只上传这三作的配置投影、适配器、layout版本、配置警告和阅读进度；容器密钥、token、secret等字段脱敏，不上传其他媒体记录。读取已安装 gal-layout 的 manifest/main/evb，核对实际脚本版本。
- RJ328940 的 EV009 存在大量重名。输出全部候选的地图名称/事件/页/条件/原始命令。正文候选及 Map239/event50 沿 common 调用和唯一自动事件跟踪依赖；地图转移不唯一时明确记录，不凭空选一个事件。
- RJ01271506 收 Map102/event20、Map128/event31 及 Map252/event13/14 的实际源事件/模板、公共事件调用、连续编号 CG 全部差分、TRN声明配音/DLC实体文件和 normal 身体/表情图集。选中地图保留原始 tile data；此前只收到事件投影不能冒充完整地图。
- 图音引用表列出所有逻辑路径、调用位置、物理源。SimpleVoice 使用原插件声明的 voice 文件夹，原生SE走se；不会再把所有SV错误地当se。BGM仅记录引用，避免为排查角色语音上传百余MB背景音乐；BGS/SE/角色语音与CG/立绘等实际依赖保留。
- 以前接收的完整文件和全部事件投影按SHA复用；源改变的事件地图重新输出完整事件投影。模板原始地图及选中依赖地图必须收原始文件，不能以投影SHA相同跳过 tile data。缺失与动态未解析引用显式列出。
- Twi只收实际生成的yn03.krkr、引用缓存、容器stamp和条目配置。已收到的16MB模型与XP3不重复上传。

每RJ最多160MiB、Twi最多8MiB，三作合计336MiB硬限制，按40MiB压缩分卷。超限明确失败，不静默截断正文/CG。按上次真实文件清单估算，排除BGM后RJ328940原始图音/地图/插件全量请求约120.9MiB，RJ01271506约27.9MiB；同SHA复用后会减少，具体以本轮日志为准。

验证：gal-collect-playback-selftest.py 覆盖默认三作路由、真实配置脱敏、所有同名候选、原生地图tile与模板、公共调用、连续CG、DLC/voice目录、SHA复用、BGM引用不复制和源文件不变。旧四作scene-audit和单模型模式继续回归。

运行：

```sh
env -u GAL_COLLECT_TSK_LOG -u GAL_COLLECT_RULES -u GAL_COLLECT_ONLY bash gal-collect.sh .
```

这轮只是采集与证据准备，不宣称动态CG、两RJ完整场景已经修复。采集日志显示“实际配置0条”时，表示应用元数据未找到，不能把它当成已验证用户配置；游戏源数据仍会采集，缺口明确记录。

## 1.65 跟进

实际采集根是gal/[G]/[]，1.64未找到应用元数据；现改为沿最多8级祖先检查固定metadata目录，并测试嵌套根定位。同批1.64图音与完整地图SHA加入复用表，下次不会重复上传本轮样本。
