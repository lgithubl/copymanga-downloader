# 下一批五作：1.54目录/引擎证据分析

来源：`gal-collect-20261112-043202`，采集版本1.54。五作全部找到，本地位于 `.cache/new-games-043202/`。原始证据约23MiB；探测报告中的232个文件范围均通过长度及SHA-256校验。本轮没有取得完整剧情，不宣称已导入成功。

| 目录 | 已核实证据 | 复用判断 | 缺失数据 |
| --- | --- | --- | --- |
| RJ01271506 | package窗口标题「フォレスティア」；rmmz_core；System媒体加密标志；163个启用插件 | MZ基础可复用`rpgmaker-json`，但inazuma自定义事件/图集/TRP_Skit/i18n需检查实际调用，不能当成普通MZ直接验收 | CommonEvents、若干Map、插件源码（特别Encrypt、Game_InterpreterEx、MessageImage、TRP_Skit） |
| RJ01646655 | 「痴漢願望シンドローム製品版_Ver1.0.0」；MZ根data；SimpleVoice/PictureGrouping/ParallelBgs | 复用现有RPG适配器；SimpleVoice已有支持，组合图片及事件参数要用正文核验 | CommonEvents为38,344,643字节，须完整读取，不能走旧16MiB上限；地图和相关插件 |
| RJ328940 | 「カルティベーター」/中文「耕拓者」；www/js/rpg_core；媒体.rpgmvp/.rpgmvo；204个启用插件 | MV基础与媒体解密可复用；检查SimpleVoice及自定义_Mu事件逻辑 | CommonEvents约5.84MB；地图抽样/索引与相关插件；www/package叫rmmz-game不代表实际核心是MZ |
| Remastered | README明确「闇夜のPARENTE 幻燐の姫将軍Remastered」；5个@ARCH000包 | 可复用Edoire容器、Unity文本/媒体基础；剧情方言还需完整文本确认 | ver00d3索引681,060字节，而本轮尾部仅131,072字节；需完整索引与文本条目，另需处理Append的!app01路径 |
| 天結いラビリンスマイスター | AGE.EXE；SYS4485 BIN；7个ALF、2个AAI；独立SC*.BIN剧情 | 当前没有AGE适配器，需要新增静态脚本及资源解码；不能只配成Edoire/RPG适配器 | SC正文、初始化/回想定义、AAI，DATA1..5与APPEND的有界头尾；不需要整包EXE或数GB档案 |

## Remastered已做的索引验证

只把采集范围写入本地稀疏文件，然后调用现有`readEdoIndex`：ver00d0/d1/d2分别1353/1503/1321条，Append ver00x1为545条，均完整消费索引。ver00d3的报错来自采集尾部不足，未把稀疏缺失字节当作有效索引。

Append包含44个.txt、221个.bytes和279个.ogg，资源位于`!app01/`。现有读取器按`src/`、`img/`分类，需要取得实际追加剧情文本再确定引用/覆盖规则。同样的ARCH000封装不意味着已经验证了相同剧情方言。

## 1.55定向补采

命令仍为 `bash gal-collect.sh .`；默认规则`^new-games:next-detail$`，bootstrap仍读取`vibe-test-20261008`。

- 三个RJ：主游戏根或www下的System/MapInfos/Actors/Tilesets/CommonEvents完整JSON；按路径及大小分散选至多6张Map；嵌套插件源码最多8MiB/作。CommonEvents允许完整40MiB，缺失/超限明确记录或拒绝，不静默截断。排除MTool、存档和媒体。
- Remastered：只读原包尾指针，完整索引（最多4MiB/包）；校验条目路径和范围，再取文本条目（每包至多120个，单条最多512KiB，明确记录省略）；不收图片/音频/视频/EXE。
- AGE：指定SC0000/SC0010/SC1000/SC6690、追加SC及流程/初始化BIN、AAI完整文件；所有ALF仅头尾各128KiB，避免探测时24文件计数先被前面的BIN占满而漏DATA包。
- 单作56MiB，总计128MiB硬限制；源目录只读，不执行游戏JS/EXE，不安装运行时。媒体显示验证须待正文引用明确后再定向取少量样本。

验证：默认五作路由、旧一轮探测规则、>16MiB公共事件完整读取、嵌套插件、ARCH000精确文本范围、AGE AAI/BIN、原目录哈希未变及最近N次TSK日志回归均通过。
