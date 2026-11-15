# dennou-djibril：context missing / 角色服装列表消失（2026-11-15）

用户配置：djibril-json，game.id=djibril::dennou，title=电脑天使；运行端Gal配置version2.67.0。

## 根因和复现

已读取实际安装元数据：脚本根为dennou-djibril/res/json/adv/script、资源根和adapterOptions.root均为dennou-djibril，配置位置正确。原始错误被browse.contextOf的catch吞掉并变为null，列表退回文件夹平铺，场景最终只显示Djibril context missing。

定向采集全部JSON及207份plist（共约26MiB原始元数据，未采全量图像/音频，源只读）。其中6份plist文件以1f8b开头，实际是gzip压缩的XML，文件后缀仍为.plist。旧版直接readFile(...,'utf8')交给XML解析器，报plist是空的，直接中断全游戏context。HEAD518d707的原始adapter配合本次真实采集数据已复现这一异常。

触发context失败的主资源：

`dennou-djibril/res/pc/character/322b2b3ee135cfa93c2c54c812a596547efe4967b6444fbb14b456ef3efcec63/adv_face_pattern.plist`

其余5份同类文件在序章资源中。文件有效；问题是未处理保存了HTTP压缩体的文件。

## 修复

- 按文件签名使用Node内置zlib解gzip，再读取图集定位；输入和解压输出均限制4MiB。
- Djibril资源接口也按需解同类plist，原子写入应用cache/gal-djibril-res后返回XML给现有浏览器图集组件。原文件不变，无新增运行时依赖或下载。
- 独立角色的可选图集失败保留具体路径和原因，不使全部角色/剧情失去context；必需表格失败仍明确报错。
- 浏览层保留context建立的原始异常，列表诊断显示adapter-context-failed；Djibril场景错误带原始原因。
- gal-layout保留用户填写的djibril::dennou等家族内game.id和title，版本2.70.0。导入下拉已有djibril-json，无新增adapter。

## 验证

- 新采全部207份图集解码成功，包含6份gzip；context警告0。
- 真实目录恢复116个角色、134套服装、769个剧情（含5个去重序章）。从首页角色实际逐层进入アルナイル→4套服装→各自5/5/6/6个场景，读取真实场景成功。
- 资源接口返回cache中的有效XML，原始gzip字节不变。原始数据和审计证据留在.cache/four-games-20261115/round13及denno-verified/gzip-audit.json。
- 回归覆盖：有效gzip原生定位和输出上限、gzip资源缓存、无关图集损坏后的角色/服装/剧情导航、必需表损坏的原始错误和修复后恢复、用户JSON原id/title保留。
- 浏览器使用本次原始gzip图集及其原始PNG，经真实getResource接口读取缓存XML，完成身体/表情两层合成，4套原生服装头像显示，无缺资源/页面错误。证据：denno-verified/gzip-browser.json、gzip-render.png。
- 参数漂移守卫、导入下拉、13项RPG回归、已新增配音分组、动态图和RexEX回归通过。
- 之前的验证素材只有未压缩图集，没有覆盖这一类压缩体；现已加入固定回归，不能只凭少数场景成功便认为所有元数据都可加载。

## 使用

原导入JSON保持不变。更新统一Release镜像和tag脚本后，重跑gal-layout2.70.0并刷新浏览。新的layout运行时间也会更新资源版本，避开浏览器里原gzip响应的旧缓存。
