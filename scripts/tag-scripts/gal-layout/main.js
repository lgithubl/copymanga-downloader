// Gal 布局配置脚本（所有 Gal 游戏合一）：探测目录的实际结构，把条目 config 里的参数调到「真的能读到」，再挑封面、数脚本。
// 引擎和这个脚本之间只通过条目的 config 交互（字段见 web/library/gal/config.mjs）；引擎缺的字段用默认（标准结构 = UViewer 资源包的布局），
// 这里只写「实际探测到的 / 你覆盖的」字段。和别的 tag 脚本一样：改了就上传新版本（manifest.version 加一）重跑，不用改镜像。
//
// 结构（从上到下）：
//   1. LAYOUTS ——「游戏 id → 目录配置」的数据表（只有这一块是每个游戏固定的知识：目录在哪、脚本根 / 资源根是什么、适配器参数模板、分组 / 合并 / 缩略图规则…）。
//      发现某个游戏的目录配置不对：改这张表（或者在选项 layouts 里按 id 覆盖某几个字段），上传新版本、重跑；不用改探测代码，更不用重建镜像。
//      表里所有「列表」都是数组（哪怕现在只有一个元素），以后加候选不用改格式；别名（aster / jaxin / maid / aku / fruits → girlscreation，deepone → uviewer）用 extends，不拷贝。
//   2. 布局引擎 —— 路径模式（* 通配 / 正则段）展开、按表里的候选位置直接 stat（命中就不搜索），都没命中才退回广度优先搜索；表项写坏了不会崩，记日志、退回内置的。
//   3. generateTags —— 分发（config.game.id）、覆盖、写 config，以及「这次运行的改动情况」（和条目现有 config 逐字段对比）。
//   4. 各游戏的探测函数 —— 只做依赖数据的事：数脚本、挑封面、从真实文件里认头像模板 / 菜单按钮图、生成分类节点、抽样判断。
//
// 分发：
//   config.game.id 已经填了（导入时写的）  → 只走那个游戏的探测（id 见 LAYOUTS）。认不出结构：uviewer / deepone 退回通用配置，别的跳过；不认识的 id 跳过
//   没填 game.id                          → 按 LAYOUTS 里的 autoOrder 顺序探测（legeclo → monmusu → angelic → girlscreation → tenkeiprdx → misttrain → minashigo → minashigo_r → artwhirl → kamihime → bokusen → grenze → tsk → uviewer），
//                                           谁认出来谁认领（把 game.id 写回 config）；都认不出 → 通用配置，不认领。声明了 game.id 就不看 markers（标记 / 门槛）
// 各游戏怎么找目录（解析顺序）：
//   ① 表里的 bases 候选（相对条目目录，可带 * 通配 / 正则段；只 stat，不遍历）依次试，anchors 全在、siblings 至少一个在 = 命中 → 日志「已知布局命中：…」
//   ② 都没命中：在条目目录下广度优先搜索（深度 searchDepth，同样的 anchors / siblings 判据）→ 日志「已知布局没命中，改用搜索：…」（重新打包 / 多套了一层的目录照样认）
// 选项：
//   dryRun          只探测和打日志，不写任何东西（日志里「【dryRun】将要产生的改动」是这次会产生的改动）
//   replace         true = 整体替换 config（默认 false = 合并：只改写了的字段，别的保留）
//   coverScanLimit  挑封面最多看几个脚本（uviewer / 通用，默认 40）
//   countCap        数脚本数的上限（默认 200000）
//   rawIgnore       正则字符串列表：播放器里「N 条指令暂未渲染」跳过匹配的指令（匹配指令名和「指令名,参数…」，不分大小写；匹配 = 我允许了）。
//                   写进每个被认领媒体的 config.rawIgnore；某个媒体要单独的，在 overrides 里写 config: { rawIgnore: [...] }（覆盖这里的全局值）
//   overrides       [{ path, config?, cover?, title? }]：按媒体目录的真实路径给个别媒体单独覆盖。
//                   path 是通配（* 匹配任意字符，包括 /）或 /正则/；按顺序全部命中的依次叠上去（后面的覆盖前面的）。
//                   config 是要覆盖的字段（和探测结果合并，顶层字段整个替换）；cover 是封面路径（相对资源根；~/ 开头 = 相对媒体目录）。
//   layouts         { <game id>: { <LAYOUTS 里的字段>: … } }：不改脚本就覆盖表里某个游戏的某几个字段（整个字段替换）；写坏了的忽略、记日志、用内置的
// 返回的日志里有「本次改动：…」一段：这次运行和条目现有 config 的逐字段对比（新增 / 修改 / 删除 / 未变 / 保留，数组列出增删的项）；结构化版本在 details.changes。
// 状态 tag：Gal配置: aku / fruits / maid / jaxin / aster / deepone / grenze / tsk / kamihime / bokusen / uviewer / legeclo / monmusu / girlscreation / tenkeiprdx / misttrain / minashigo / 通用 / 自定义    Gal配置version: <脚本版本>    Gal游戏: <game.id>

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const TAG_GROUPS = ['Gal配置', 'Gal配置version', 'Gal游戏']
const SAFE_SEGMENT = /^[^/\\\0]+$/

// ======================================================================
// LAYOUTS：游戏 id → 目录配置（固定的知识都在这里；下面的探测函数只做依赖数据的事）
//
// 路径写法（bases / anchors / siblings / markers / scriptRoots.dir / resourceRoots / adapterOptions 里的路径 / count.dir / cover.dir …，都是相对 base 的相对路径）：
//   a/b/c        字面量，只 stat
//   *            通配，只展开一级目录（段内也可以：text* ）；匹配到几个就是几个候选，按名字排序
//   /re/flags    正则段（整段，对这一级的目录项名字匹配）；捕获组可在 scriptRoots 的 id / label 里用 {0}（整个名字）{1}…
//   写成数组     ['TextAsset', '/^easy_dialog-\\d+\\.xml$/i']：每个元素一段（字符串形式里正则段要写成 'TextAsset//re/' 很难看，所以带正则的用数组）
//
// 字段：
//   extends        别名：从另一个 id 继承全部字段，这里写的字段替换继承来的（不要拷贝整份）
//   title / kind   显示名 / 写进 details.kind 的类型名
//   detector       探测函数名（见文件后半 DETECTORS）；autoOrder = 没填 game.id 时的探测顺序（不写 = 只在声明了 game.id 时才走）
//   bases          游戏目录（条目目录）下的候选 base（'' = 条目目录本身），按顺序试；先于搜索
//   searchDepth    都没命中时广度优先搜索的深度
//   anchors        base 下必须全部存在的路径（文件或目录）
//   siblings       base 下至少存在一个的目录（和别的游戏区分用）；空 = 不要求
//   markers        没声明 game.id 时才查：每项必须存在；某一项本身是数组 = 其中任意一个存在就行
//   scriptRoots    脚本根候选 [{ id, dir, label }]：存在的都写（dir 可带通配，一个匹配一个脚本根）；一个都不存在就写第一个
//   resourceRoots  资源根候选：写第一个存在的，都不存在就写第一个（'.' = base 自己）
//   adapters       这个游戏默认的适配器 id（导入时用；条目里的适配器和它们没有交集时日志里提醒）
//   adapterOptions 适配器参数模板 { <适配器 id>: { <选项>: 值 } }，选项的形状（适配器的契约）不变：
//                    字符串 / 数组 / 数字 = 原样；{ path: [候选…] } = 单个路径字符串（第一个存在的，否则第一个）；
//                    { paths: ['a', '?b'] } = 路径数组（'?' 开头 = 存在才写；不带 ? = 总是写）。路径都相对 base，结果相对条目目录
//   config         固定的引擎字段（scriptExtensions / hiddenDirs / labels / merge / views / groups / dirThumbs / scriptThumbs / scriptIndex / thumbSources / pageSize / namesFiles / thumbsDirs …）
//                    namesFiles / thumbsDirs 的路径相对 base（uviewer 相对 base 的上一层，见 detectUviewerGame）
//   count          数脚本数：[{ dir, ext, depth }]（各项相加）
//   cover          封面规则（路径相对 base，要等于资源根）：{ dir, match, flags, pick: 'first' | 'last' } 或 { dir（可带 *）, files: [...] }，第一个有结果的算
//   avatars        头像图（递归找第一个）：[{ dir, match, flags, dirThumb? }]，dirThumb 里 <dir> <ext> 换成找到的目录 / 扩展名，并写进 config.dirThumbs；找到的第一张也是封面
//   scriptIndexScan 菜单按钮图：[{ dir, rules: [{ pattern, key }] }]：在 dir 下扫匹配的文件，每个含匹配文件的目录各生成一条 config.scriptIndex
//   expectedDirs   base 下应该有的目录，缺了日志里提示
//   nodes          默认节点图（auto）：[[节点 id, 适配器目录引用], …]；写了这个字段就生成节点图（tsk / girlscreation 还会加上现读的分类）
//   notes          识别后打的说明日志
// 所有「列表」字段都是数组；探测函数里没有任何写死的目录名（数据依赖的判断除外）。
// ======================================================================
export const LAYOUTS = {
  // ---- UViewer 系：resources/download/adv/text（resource_path 在 user_data/settings.json 里，见 detectUviewerGame）
  uviewer: {
    title: 'UViewer 资源包', kind: 'uviewer', detector: 'uviewer', autoOrder: 140,
    bases: ['resources', ''], searchDepth: 6,
    anchors: ['download/adv/text'], siblings: [], markers: [],
    scriptRoots: [
      { id: 'text', dir: 'download/adv/text', label: 'text' },
      { id: '{0}', dir: ['download', 'adv', '/^text[^|#]+$/'], label: '{0}' },   // 同级 text* 目录 = 另一套文本（text2 …）
    ],
    resourceRoots: ['.'],
    adapters: ['uviewer-csv'], adapterOptions: {},
    config: { namesFiles: ['user_data/character_names.json'], thumbsDirs: ['user_data/thumbnails'] },
    notes: [],
  },
  deepone: { extends: 'uviewer', title: 'deeponecgv（UViewer 系）' },   // 同一套探测，id 独立

  // ---- Ren'Py 播放器：game/script/hscene
  legeclo: {
    title: "legeclo（Ren'Py）", kind: 'legeclo', detector: 'legeclo', autoOrder: 10,
    bases: ['', 'game'], searchDepth: 6,
    anchors: ['script/hscene'], siblings: [], markers: [],   // 和 monmusu 目录相似：靠 options.rpy 里的 legeclo / 旁边的 legeclo_py.* 认（detectLegeclo）
    scriptRoots: [{ id: 'hscene', dir: 'script/hscene', label: '日文' }],   // 直接是 script/hscene：首页就是按角色分组的卡片
    resourceRoots: ['.'],
    adapters: ['renpy-legeclo'],
    adapterOptions: { 'renpy-legeclo': { aliasFiles: { paths: ['?script/movie.rpy'] }, imageDirs: { paths: ['images'] } } },
    config: {
      namesFiles: [], thumbsDirs: [], scriptExtensions: ['rpy'], hiddenDirs: [], labels: {}, merge: [], views: [],
      groups: [{ parent: '.', pattern: '^(.+)_\\d{2}$' }],   // 角色 id 可能带下划线（agnes_boulanger）：去掉末尾的 _<两位编号>
      scriptThumbs: [], dirThumbs: [],
      // 脚本卡片：images/thumbnail/st/hs_<角色>_st_<话 2 位><变体 2 位>[_idle|_hover].png ↔ 脚本 <角色>_<话>（全部变体进数组）；没有就退回整张场景图 images/st（fallback）
      // 角色卡片：images/thumbnail/char/st_<角色>[_idle|_hover].png
      thumbSources: [
        { dir: 'images/thumbnail/st', match: String.raw`^hs_(.+)_st_(\d\d)\d\d(?:_(?:idle|hover))?\.(?:png|webp|jpg)$`, key: '{1}_{2}', for: 'script' },
        { dir: 'images/st', match: String.raw`^hs_(.+)_st_(\d\d)\d\d(?:_(?:idle|hover))?\.(?:png|webp|jpg)$`, key: '{1}_{2}', for: 'script', fallback: true },
        { dir: 'images/thumbnail/char', match: String.raw`^st_(.+?)(?:_(?:idle|hover))?\.(?:png|webp)$`, key: '{1}', for: 'dir' },
      ],
    },
    count: [{ dir: 'script/hscene', ext: '.rpy', depth: 8 }],
    avatars: [{ dir: 'images/thumbnail/char', match: String.raw`^st_.+?(?:_idle)?\.(png)$`, flags: 'i' }],
    expectedDirs: [],
    notes: ['脚本根 script/hscene；按角色分组（<角色>_<编号>）；只读 .rpy（只有 .rpyc 的读不了）；翻译（tl/）暂不叠加', '缩略图：脚本 images/thumbnail/st/hs_<角色>_st_<话><变体>*.png（退回 images/st/）、角色 images/thumbnail/char/st_<角色>*.png；同一张卡片的全部变体都进缩略图数组'],
  },
  monmusu: {
    title: "monmusu（Ren'Py）", kind: 'monmusu', detector: 'monmusu', autoOrder: 20,
    bases: ['', 'game'], searchDepth: 6,
    anchors: ['script/hscene'], siblings: [], markers: ['script/movie.rpy'],   // 没声明又没有视频别名表：不确定是 monmusu
    scriptRoots: [{ id: 'script', dir: 'script', label: '日文' }],
    resourceRoots: ['.'],
    adapters: ['renpy-monmusu'],
    adapterOptions: { 'renpy-monmusu': { aliasFiles: { paths: ['?script/movie.rpy'] }, imageDirs: { paths: ['images'] } } },
    config: {
      namesFiles: [], thumbsDirs: [], scriptExtensions: ['rpy'], hiddenDirs: ['sub_nav', 'tl'],
      // 首页三个入口：动画（hscene，按角色编号分组）/ 事件（hscene_still，一个脚本一个事件，平铺）/ 总览（两个目录合在一起，按角色分组）；hscene_still 不存在就不合并它
      labels: { hscene: '动画', hscene_still: '事件' },
      merge: [],
      views: [{ parent: '.', as: 'overview', label: '总览', dirs: ['hscene', 'hscene_still'], badges: { hscene: 'anim', hscene_still: 'still' } }],
      groups: [{ parent: 'hscene', pattern: '^(\\d{5})[A-Za-z]\\d' }, { parent: 'overview', pattern: '^(\\d{5})[A-Za-z]\\d' }],
      scriptThumbs: [], dirThumbs: [], scriptIndex: [],
    },
    count: [{ dir: 'script/hscene', ext: '.rpy', depth: 8 }, { dir: 'script/hscene_still', ext: '.rpy', depth: 8 }],
    // 头像：images 里找 icon_<编号>_0_idle.*，据此生成目录卡片的头像模板（路径相对游戏根）
    avatars: [{ dir: 'images', match: '^icon_(\\d{3,8})_0_idle\\.(png|webp|jpe?g)$', flags: 'i', dirThumb: { parent: '*', name: '^\\d{3,8}$', paths: ['<dir>/icon_{name}_0_idle.<ext>'] } }],
    // 脚本卡片封面：动画脚本里没有背景图，用游戏菜单按钮的图——script/sub_nav 里 `imagebutton auto "<编号>_01_%s"` 跳到 h<编号>A1、`_02_` 跳 B1；
    // 事件菜单里 `r18_<编号>_stla1_%s` 跳 C1、stlb1 → D1、stlc1 → E1、stld1 → F1。图在 images 里（可能再套一层目录），整棵树扫一遍
    scriptIndexScan: [{
      dir: 'images',
      rules: [
        { pattern: '^(\\d{5})_01_idle\\.(?:png|webp|jpe?g)$', key: '{1}A1' }, { pattern: '^(\\d{5})_02_idle\\.(?:png|webp|jpe?g)$', key: '{1}B1' },
        { pattern: '^r18_(\\d{5})_stla1(?:_idle)?\\.(?:png|webp|jpe?g)$', key: '{1}C1' }, { pattern: '^r18_(\\d{5})_stlb1(?:_idle)?\\.(?:png|webp|jpe?g)$', key: '{1}D1' },
        { pattern: '^r18_(\\d{5})_stlc1(?:_idle)?\\.(?:png|webp|jpe?g)$', key: '{1}E1' }, { pattern: '^r18_(\\d{5})_stld1(?:_idle)?\\.(?:png|webp|jpe?g)$', key: '{1}F1' },
      ],
    }],
    expectedDirs: [],
    notes: ['首页入口：动画 / 事件 / 总览（hscene + hscene_still 合并）；动画和总览按角色编号分组'],
  },
  angelic: {
    title: "angelic_py（Ren'Py）", kind: 'angelic', detector: 'angelic', autoOrder: 30,   // monmusu 之后：没有 movie.rpy 但有 movies.rpy / stills.rpy（复数）的才是它
    bases: ['', 'game'], searchDepth: 6,
    anchors: ['script/hscene'], siblings: [], markers: [['script/movies.rpy', 'script/stills.rpy']],
    scriptRoots: [{ id: 'script', dir: 'script', label: '日文' }],
    resourceRoots: ['.'],
    adapters: ['renpy-monmusu'],
    adapterOptions: { 'renpy-monmusu': { aliasFiles: { paths: ['?script/movies.rpy', '?script/stills.rpy'] }, imageDirs: { paths: ['?images', '?resources'] } } },
    config: {
      namesFiles: [], thumbsDirs: [], scriptExtensions: ['rpy'],
      hiddenDirs: ['sub_nav', 'sub_nav_byname', 'tl'],   // 菜单脚本（sub_*.rpy / byname_*.rpy）不是剧情
      merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [], scriptIndex: [],
    },
    count: [{ dir: 'script/hscene', ext: '.rpy', depth: 8 }],
    avatars: [], expectedDirs: [],
    notes: ['脚本文件名是随机串、没有角色编号：不分组、不配头像 / 封面（卡片显示脚本名）；只有 .rpyc 没有 .rpy 的脚本解析不了，列表页「渲染诊断」里会列出'],
  },
  minashigo: {
    title: "minashigo（Ren'Py，MinashigoViewer）", kind: 'minashigo', detector: 'minashigo', autoOrder: 70,
    bases: [''], searchDepth: 6,
    anchors: ['game/scripts'], siblings: [], markers: [],   // 没声明时靠 game/script.rpy 开头的 DynamicCharacter("name") 认（detectMinashigo）
    scriptRoots: [{ id: 'scripts', dir: 'game/scripts', label: '日文' }],
    resourceRoots: ['game'],
    adapters: ['renpy-minashigo'],
    adapterOptions: { 'renpy-minashigo': { aliasFiles: { paths: ['game/movie.rpy'] }, standFiles: { paths: ['game/script.rpy'] }, imageDirs: { paths: ['game/images'] } } },
    config: {
      namesFiles: [], thumbsDirs: [], scriptExtensions: ['rpy'], hiddenDirs: [], labels: {}, merge: [],
      // 首页分类：角色（scene_<1 位类别><6 位角色编号><2 位序号>，按角色编号分组）/ 活动（scene_ev<活动号>_…，按活动号分组）/ 主线（scene_<7 位数字>，平铺）；视图是独占的
      views: [
        { parent: '.', as: 'chars', label: '角色', match: '^scene_\\d{9}$', exclusive: true },
        { parent: '.', as: 'events', label: '活动', match: '^scene_ev', exclusive: true },
        { parent: '.', as: 'main', label: '主线', match: '^scene_\\d{7}$', exclusive: true },
      ],
      groups: [{ parent: 'chars', pattern: '^scene_\\d(\\d{6})\\d{2}$' }, { parent: 'events', pattern: '^scene_(ev\\d+)_' }],
      dirThumbs: [], scriptThumbs: [],
    },
    count: [{ dir: 'game/scripts', ext: '.rpy', depth: 3 }],
    avatars: [], expectedDirs: [],
    notes: ['按角色编号分组（scene_<类别><6 位角色><序号>）；立绘定义读 game/script.rpy；路径不对用 overrides 覆盖 adapterOptions / resourceRoots'],
  },

  // ---- ミナシゴノシゴトR（cocos2d 网页版官方数据）：data/adv/textfiles/story（uviewer-csv 格式），资源在 data/adv/{image,sound,movie}
  minashigo_r: {
    title: 'ミナシゴノシゴトR', kind: 'minashigo_r', detector: 'minashigo_r', autoOrder: 80,   // 放在通用 uviewer 之前
    bases: ['', 'data'], searchDepth: 6,
    anchors: ['adv/textfiles/story'], siblings: [], markers: ['adv/image', 'adv/sound'],   // 没声明：要求 data 下还有 adv/image 和 adv/sound，免得把别的 adv/textfiles/story 认走
    scriptRoots: [{ id: 'story', dir: 'adv/textfiles/story', label: 'story' }],
    resourceRoots: ['.'],
    adapters: ['uviewer-csv'], adapterOptions: {},
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['txt'], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [], scriptIndex: [], pageSize: 100 },
    count: [{ dir: 'adv/textfiles/story', ext: '.txt', depth: 2 }],
    avatars: [], expectedDirs: [],
    notes: ['文件名是数字编号，不分组：列表每页 100 个，用「更多」里的搜索按编号筛；角色立绘（spriteatlas / sprite）暂未渲染'],
  },

  // ---- Girls Creation 家族（NW.js，标签式脚本）：package.nw/scenes/<场景>/script.txt + data/audio。tenkeiprdx 也有 scenes/，但里面是 json 且旁边有 Backgrounds / Spines 等，不会混
  girlscreation: {
    title: 'Girls Creation R Viewer', kind: 'girlscreation', detector: 'girlscreation', autoOrder: 40,   // 先于 tenkeiprdx
    bases: ['', 'package.nw'], searchDepth: 6,
    anchors: ['scenes'], siblings: [], markers: [['data/audio', 'sceneData.js']],   // 没声明又没有 data/audio / sceneData.js：不确定是这个游戏
    scriptRoots: [{ id: 'scenes', dir: 'scenes', label: 'scenes' }],
    resourceRoots: ['.'],
    adapters: ['girlscreation-tag', 'girlscreation-line'],
    adapterOptions: { 'girlscreation-tag': { root: { path: ['.'] } } },
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['txt'], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [] },
    count: [],   // 数「有 script.txt / output_script.txt / hmr_·hsr_<id>.txt 的场景」（detectGirlsCreation）
    cover: [{ dir: 'scenes/*', files: ['thumbnail.png', 'thumbnail.jpg', 'thumbnail.webp'] }],
    avatars: [], expectedDirs: ['data/audio'],
    nodes: [],   // 分类节点由 detectGirlsCreation 现读（场景 id 开头的字母 chmr / chsr …）
    notes: ['列表由适配器现读：分类（场景 id 前缀 chmr / chsr …）→ 主要说话人 → 场景；标题取自原始脚本里的 title 行，封面 = thumbnail.png'],
  },
  // 家族各游戏一个唯一的 id（探测和 girlscreation 完全一样，只是写回 config.game.id 的值不同；自动探测时仍由 girlscreation 认领）
  aster: { extends: 'girlscreation', title: 'Angelica Aster R Viewer' },
  jaxin: { extends: 'girlscreation', title: 'Jaxin' },
  maid: { extends: 'girlscreation', title: 'Maid' },
  aku: { extends: 'girlscreation', title: 'Aku No Onna Kanbu' },
  fruits: { extends: 'girlscreation', title: 'Fruits Fulcute!' },

  // ---- Unity 剧情查看器素材
  tenkeiprdx: {
    title: 'tenkeiprdx', kind: 'tenkeiprdx', detector: 'tenkeiprdx', autoOrder: 50,
    bases: ['', '*_Data/StreamingAssets/*/*', '*_Data/StreamingAssets/*'], searchDepth: 6,
    anchors: ['scenes'], siblings: ['Backgrounds', 'Spines', 'Stills', 'Masterdata'], markers: [],
    scriptRoots: [{ id: 'scenes', dir: 'scenes', label: 'scenes' }],
    resourceRoots: ['.'],
    adapters: ['tenkeiprdx-json'],
    adapterOptions: { 'tenkeiprdx-json': { root: { path: ['.'] } } },
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['json'], labels: {}, merge: [], groups: [], dirThumbs: [], scriptThumbs: [] },
    count: [{ dir: 'scenes', ext: '.json', depth: 4 }],
    cover: [
      { dir: 'EpisodeThumbnails/event', match: '^ep_eventstill_([^_]+)_([^_]+)', pick: 'last' },
      { dir: 'EpisodeThumbnails/extra', match: '^ep_eventstill_([^_]+)_([^_]+)', pick: 'last' },
    ],
    avatars: [], expectedDirs: ['CharacterIcons', 'Masterdata', 'Backgrounds', 'Spines', 'Stills', 'BGM', 'AdventureVoice'],
    // 列表（活动 / 附加 / 角色 / 全部剧情）由适配器每次从数据文件现读，这里不写列表；节点缺数据时静默跳过
    nodes: [['event', 'event'], ['extra', 'extra'], ['special', 'special'], ['chars', 'chars'], ['all', 'all']],
    notes: [],
  },
  misttrain: {
    title: 'MistTrainGirls X', kind: 'misttrain', detector: 'misttrain', autoOrder: 60,   // UScenes/ 加 Spines|Sounds|MasterData；没有 scenes/，和 tenkeiprdx 不会混
    bases: ['', '*_Data/StreamingAssets/*'], searchDepth: 6,
    anchors: ['UScenes'], siblings: ['Spines', 'Sounds', 'MasterData', 'BackGrounds'], markers: [],
    scriptRoots: [{ id: 'uscenes', dir: 'UScenes', label: 'UScenes' }],
    resourceRoots: ['.'],
    adapters: ['misttrain-json'],
    adapterOptions: { 'misttrain-json': { root: { path: ['.'] } } },
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['json'], labels: {}, merge: [], groups: [], dirThumbs: [], scriptThumbs: [] },
    count: [{ dir: 'UScenes', ext: '.json', depth: 4 }],
    cover: [],
    avatars: [], expectedDirs: ['MasterData', 'Spines', 'Sounds', 'BackGrounds'],
    nodes: [['chars', 'chars'], ['other', 'other'], ['all', 'all']],
    notes: [],
  },
  tsk: {
    title: 'Twinkle Star Knights X（Utage）', kind: 'tsk', detector: 'tsk', autoOrder: 130,
    bases: ['', '*_Data/StreamingAssets/*'], searchDepth: 6,
    anchors: ['Adventure/Master.chapter.json'], siblings: ['Characters', 'Stills', 'Sound'], markers: [],
    scriptRoots: [{ id: 'adventure', dir: 'Adventure', label: 'Adventure' }],
    resourceRoots: ['.'],
    adapters: ['utage-book'],
    adapterOptions: { 'utage-book': { root: { path: ['.'] } } },
    // Adventure 下的 Master.chapter.json 和图片目录不是剧情，适配器的嗅探把它们挡掉（只认 *.book.json 靠适配器，不靠扩展名）
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['json'], hiddenDirs: ['BackGrounds', 'Effects', 'Spine', 'Textures'], labels: {}, merge: [], groups: [], dirThumbs: [], scriptThumbs: [] },
    count: [{ dir: 'Adventure', ext: '.book.json', depth: 3 }],
    cover: [{ dir: 'Adventure/BackGrounds', match: '\\.(png|jpe?g)$', flags: 'i', pick: 'first' }],
    avatars: [], expectedDirs: ['Characters', 'Stills', 'Sound'],
    nodes: [['all', 'all']],   // 前面再加每个含 *.book.json 的剧情文件夹一个节点（detectTsk 现读）
    notes: [],
  },

  // ---- 其它
  artwhirl: {
    title: "魔法学园的少女们（ArtWhirl，Ren'Py + JSON）", kind: 'artwhirl', detector: 'artwhirl', autoOrder: 90,
    bases: ['', 'game'], searchDepth: 6,
    anchors: ['episode_scripts'], siblings: [], markers: ['images/stands', 'audio'],   // 没声明：要求有 images/stands 和 audio（免得认走别的 episode_scripts）
    scriptRoots: [{ id: 'episode', dir: 'episode_scripts', label: '剧情' }, { id: 'hscene', dir: 'hscripts', label: 'H 场景' }],
    resourceRoots: ['.'],
    adapters: ['artwhirl-json'],
    adapterOptions: { 'artwhirl-json': { root: { path: ['.'] } } },
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['json'], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [], scriptIndex: [], pageSize: 100 },
    count: [{ dir: 'episode_scripts', ext: '.json', depth: 3 }, { dir: 'hscripts', ext: '.json', depth: 3 }],
    avatars: [], expectedDirs: ['images/stands', 'audio'],
    notes: ['剧情 JSON 按 官方 json_story_player 的语义解析（背景 / HCG 视频 / BGM / 语音 / 立绘组合）；立绘动作与表情特效（others 的 action / emotion）暂未渲染，统计里会列出'],
  },
  kamihime: {
    title: 'Kamihime Player（TyranoScript）', kind: 'kamihime', detector: 'kamihime', autoOrder: 100,   // .ks 独有，放在通用 uviewer 之前
    bases: ['', 'game'], searchDepth: 6,
    anchors: ['dmm/raw_scenario'], siblings: [], markers: ['dmm/assets'],   // 没声明：要求有 assets 和至少一个 .ks（detectKamihime）
    scriptRoots: [{ id: 'ks', dir: 'dmm/raw_scenario', label: '日文' }],
    resourceRoots: ['dmm/assets'],
    adapters: ['tyrano-ks'],
    adapterOptions: { 'tyrano-ks': { root: { path: ['dmm'] } } },
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['ks'], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [], scriptIndex: [], pageSize: 100 },
    count: [{ dir: 'dmm/raw_scenario', ext: '.ks', depth: 6 }],
    avatars: [], expectedDirs: ['dmm/assets'],
    notes: ['列表（类别 → 目录 → 剧情，标题取同目录 json 的 title）由 tyrano-ks 适配器现读；立绘滑入 / 滑出（anim layer）、layer 3 的 layopt / freeimage 暂未渲染，统计里会列出'],
  },
  bokusen: {
    title: 'ぼくらの放課後戦争', kind: 'bokusen', detector: 'bokusen', autoOrder: 110,   // <根>/json/*.json（data.code 编译脚本）+ <根>/resource/<脚本名>/{images,sounds}
    bases: [''], searchDepth: 4,
    anchors: ['json'], siblings: [], markers: ['resource'],   // 没声明：json/ 里还要有脚本开头是 {"data":{"code":{…（detectBokusen）
    scriptRoots: [{ id: 'json', dir: 'json', label: '脚本' }],
    resourceRoots: ['resource'],
    adapters: ['bokusen-json'],
    adapterOptions: { 'bokusen-json': { root: { path: ['.'] }, resourceDir: 'resource' } },
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['json'], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [], scriptIndex: [], pageSize: 100 },
    count: [{ dir: 'json', ext: '.json', depth: 2 }],
    avatars: [], expectedDirs: ['resource'],
    notes: ['只有一部分脚本有同名资源子目录，没有的脚本只出台词（列表页「渲染诊断」会报缺资源）；打不开的 JSON（解析失败）照样列出来、打开时再报错'],
  },
  grenze: {
    title: 'Grenze（GrenzeViewer）', kind: 'grenze', detector: 'grenze', autoOrder: 120,
    bases: [''], searchDepth: 6,
    anchors: ['assets', ['TextAsset', '/^easy_dialog-\\d+\\.xml$/i']], siblings: [], markers: ['assets/resources/patchres'],   // 没声明：要求同时有 assets/resources/patchres（免得认走别的 TextAsset）
    scriptRoots: [{ id: 'text', dir: 'TextAsset', label: 'TextAsset' }],
    resourceRoots: ['assets/resources/patchres'],
    adapters: ['grenze-xml'],
    adapterOptions: { 'grenze-xml': { root: { path: ['.'] } } },
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['xml'], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [], scriptIndex: [], pageSize: 100 },
    count: [],   // 数 TextAsset 里的 easy_dialog-N.xml（detectGrenze）
    avatars: [], expectedDirs: ['assets/resources/patchres'],
    notes: ['按 next_id 链拆场景（每个文件几百个）；立绘 = merc/pic/<hero_group_id>/body.webp|png 整张；screen_effect / pic_action / effect 含义未知，记为未渲染指令（stats.raw）'],
  },
}

// 认不出的目录：整个目录当脚本根，脚本里的路径按媒体目录解析（再试一次去掉 download/ 前缀）；不认领（不写 game.id）。不是某个游戏，所以不在 LAYOUTS 里
const GENERIC_CONFIG = { scriptRoots: [{ id: '', dir: '', label: '' }], resourceRoots: [''], stripPrefixes: ['download/'], namesFiles: [], thumbsDirs: [], labels: {}, merge: [], dirThumbs: [], scriptThumbs: [] }

// ======================================================================
// 布局引擎：路径模式展开、表项规整（写坏了不崩）、按表候选 stat → 搜索回退
// ======================================================================

// 路径模式 → 段列表。字符串里以 / 开头的段是正则段（/re/flags）；数组 = 每个元素一段
function patternSegments(pattern) {
  if (Array.isArray(pattern)) return pattern.map(String).filter((seg) => seg && seg !== '.')
  const text = String(pattern ?? '')
  const segs = []
  let i = 0
  while (i < text.length) {
    if (text[i] === '/') {
      let close = i + 1
      while (close < text.length && !(text[close] === '/' && text[close - 1] !== '\\')) close++
      let end = close + 1
      while (end < text.length && /[a-z]/.test(text[end])) end++
      segs.push(text.slice(i, end))
      i = text[end] === '/' ? end + 1 : end
    } else {
      const close = text.indexOf('/', i)
      const end = close < 0 ? text.length : close
      segs.push(text.slice(i, end))
      i = end + 1
    }
  }
  return segs.filter((seg) => seg && seg !== '.')
}

const segmentCache = new Map()
function parseSegment(seg) {
  const cached = segmentCache.get(seg)
  if (cached) return cached
  let parsed
  const regexForm = /^\/(.+)\/([a-z]*)$/.exec(seg)
  if (regexForm) parsed = { re: new RegExp(regexForm[1], regexForm[2].replace(/[^gimsuy]/g, '').replace(/g/g, '')), capture: true }
  else if (seg.includes('*')) parsed = { re: new RegExp(`^${seg.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`), capture: false }
  else if (SAFE_SEGMENT.test(seg) && seg !== '..') parsed = { literal: seg }
  else throw new Error(`路径段不合法：${seg}`)
  segmentCache.set(seg, parsed)
  return parsed
}

// 展开路径模式：从 fromRel（相对 media）起，字面量段只拼接、通配 / 正则段读一次目录（只展开一级）；最后 stat 一次。返回 [{ rel（相对 media）, caps }]
async function expand(media, fromRel, pattern, want = 'any', limit = 60) {
  let segs
  try { segs = patternSegments(pattern).map((seg) => ({ seg, ...parseSegment(seg) })) } catch { return [] }
  let level = [{ rel: fromRel, caps: [] }]
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const last = i === segs.length - 1
    const next = []
    for (const cur of level) {
      if (seg.literal !== undefined) { next.push({ rel: join(cur.rel, seg.literal), caps: cur.caps }); continue }
      let entries
      try { entries = await readdir(path.join(media, ...splitRel(cur.rel)), { withFileTypes: true }) } catch { continue }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.')) continue
        if (!last && !entry.isDirectory() && !entry.isSymbolicLink()) continue   // 中间段只能是目录
        const m = seg.re.exec(entry.name)
        if (m) next.push({ rel: join(cur.rel, entry.name), caps: seg.capture ? [...m] : [entry.name] })
      }
    }
    level = next.slice(0, limit)
  }
  const out = []
  for (const cur of level) {
    const abs = path.join(media, ...splitRel(cur.rel))
    if (want === 'dir' ? await isDir(abs) : want === 'file' ? await isFile(abs) : (await isDir(abs)) || (await isFile(abs))) out.push(cur)
  }
  return out
}
const existsAt = async (media, fromRel, pattern, want = 'any') => (await expand(media, fromRel, pattern, want)).length > 0
const fillCaps = (template, caps) => String(template ?? '').replace(/\{(\d+)\}/g, (_, n) => caps[Number(n)] ?? '')
const relFromBase = (base, rel) => (base && rel.startsWith(`${base}/`) ? rel.slice(base.length + 1) : rel)

// ---- 表项规整：任何一项写坏了（类型不对、正则不合法）都丢掉并记下来，不抛错
function validPattern(pattern) {
  try { patternSegments(pattern).forEach(parseSegment); return typeof pattern === 'string' || Array.isArray(pattern) } catch { return false }
}
function normalizeLayout(raw, problems, id) {
  const bad = (what) => problems.push(`布局表「${id}」：${what}`)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { bad('不是对象'); return null }
  const out = { ...raw }
  const list = (key) => {
    if (out[key] === undefined) { out[key] = []; return }
    if (!Array.isArray(out[key])) { bad(`${key} 不是数组，忽略这个字段`); out[key] = [] }
  }
  for (const key of ['bases', 'anchors', 'siblings', 'markers', 'resourceRoots', 'expectedDirs', 'adapters', 'notes', 'scriptRoots', 'count', 'cover', 'avatars', 'scriptIndexScan']) list(key)
  if (raw.nodes !== undefined) { if (Array.isArray(raw.nodes)) out.nodes = raw.nodes.filter((n) => Array.isArray(n) && typeof n[0] === 'string' && typeof n[1] === 'string') ; else { bad('nodes 不是数组，忽略'); delete out.nodes } }
  for (const key of ['bases', 'anchors', 'siblings', 'resourceRoots', 'expectedDirs']) {
    out[key] = out[key].filter((p) => { const ok = key === 'bases' || key === 'resourceRoots' ? (typeof p === 'string' && validPattern(p)) : validPattern(p); if (!ok) bad(`${key} 里有不合法的路径：${JSON.stringify(p)}，忽略这一项`); return ok })
  }
  out.markers = out.markers.filter((m) => { const ok = Array.isArray(m) && m.length && m.every((p) => typeof p === 'string' && validPattern(p)) || (typeof m === 'string' && validPattern(m)); if (!ok) bad(`markers 里有不合法的项：${JSON.stringify(m)}，忽略这一项`); return ok })
  out.adapters = out.adapters.filter((a) => typeof a === 'string' && a)
  out.notes = out.notes.filter((a) => typeof a === 'string' && a)
  out.scriptRoots = out.scriptRoots.filter((r) => { const ok = r && typeof r === 'object' && typeof r.id === 'string' && validPattern(r.dir); if (!ok) bad(`scriptRoots 里有不合法的项：${JSON.stringify(r)?.slice(0, 80)}，忽略这一项`); return ok })
  out.count = out.count.filter((c) => c && typeof c === 'object' && validPattern(c.dir) && typeof c.ext === 'string' && c.ext)
  out.cover = out.cover.filter((c) => c && typeof c === 'object' && validPattern(c.dir) && (Array.isArray(c.files) ? c.files.every((f) => typeof f === 'string') : typeof c.match === 'string' && regexOk(c.match, c.flags)))
  out.avatars = out.avatars.filter((a) => a && typeof a === 'object' && validPattern(a.dir) && typeof a.match === 'string' && regexOk(a.match, a.flags))
  out.scriptIndexScan = out.scriptIndexScan.filter((s) => s && typeof s === 'object' && validPattern(s.dir) && Array.isArray(s.rules) && s.rules.every((r) => r && typeof r.pattern === 'string' && regexOk(r.pattern)))
  out.config = raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config) ? raw.config : {}
  out.adapterOptions = raw.adapterOptions && typeof raw.adapterOptions === 'object' && !Array.isArray(raw.adapterOptions) ? raw.adapterOptions : {}
  out.searchDepth = Math.max(0, Math.min(8, Math.floor(Number(raw.searchDepth)) || 6))
  if (!out.bases.length || !out.anchors.length) { bad('没有可用的 bases / anchors，这一项不能用'); return null }
  return out
}
function regexOk(source, flags) { try { new RegExp(source, String(flags || '').replace(/[^imsu]/g, '')); return true } catch { return false } }

// 解析 id 的布局：沿 extends 往上合并（子项的字段替换父项的），再叠上选项 layouts 里的覆盖；覆盖写坏了退回内置的；内置的也坏了返回 null
export function resolveLayout(id, overrides = {}, problems = []) {
  const table = (key, withOverride) => {
    const base = Object.prototype.hasOwnProperty.call(LAYOUTS, key) ? LAYOUTS[key] : null
    const over = withOverride && overrides && typeof overrides === 'object' ? overrides[key] : undefined
    if (over === undefined) return base
    if (!over || typeof over !== 'object' || Array.isArray(over)) { problems.push(`选项 layouts.${key} 不是对象：忽略`); return base }
    return { ...(base || {}), ...over }
  }
  const build = (withOverride) => {
    const chain = []
    let cur = id
    const seen = new Set()
    while (cur && !seen.has(cur) && chain.length < 6) {
      seen.add(cur)
      const raw = table(cur, withOverride)
      if (!raw || typeof raw !== 'object') { problems.push(`布局表里没有「${cur}」`); return null }
      chain.unshift(raw)
      cur = typeof raw.extends === 'string' ? raw.extends : ''
    }
    const merged = Object.assign({}, ...chain)
    delete merged.extends
    return normalizeLayout(merged, problems, id)
  }
  let entry = build(true)
  if (!entry && overrides && typeof overrides === 'object' && overrides[id] !== undefined) {
    problems.push(`选项 layouts.${id} 写坏了：用内置的布局`)
    entry = build(false)
  }
  return entry
}

// ① 表里的 bases 候选（只 stat）→ ② 广度优先搜索。判据：anchors 全在、siblings 至少一个在
async function matchesAt(media, entry, rel) {
  for (const anchor of entry.anchors) if (!(await existsAt(media, rel, anchor, 'any'))) return false
  if (entry.siblings.length) {
    let any = false
    for (const sibling of entry.siblings) if (await existsAt(media, rel, sibling, 'dir')) { any = true; break }
    if (!any) return false
  }
  return true
}
async function locateBase(media, entry) {
  const tried = new Set()
  for (const pattern of entry.bases) {
    for (const hit of await expand(media, '', pattern, 'dir')) {
      if (tried.has(hit.rel)) continue
      tried.add(hit.rel)
      if (await matchesAt(media, entry, hit.rel)) return { base: hit.rel, via: 'table', pattern }
    }
  }
  const queue = [{ rel: '', depth: 0 }]
  while (queue.length) {
    const { rel, depth } = queue.shift()
    if (!tried.has(rel) && (await matchesAt(media, entry, rel))) return { base: rel, via: 'search', pattern: '' }
    if (depth >= entry.searchDepth) continue
    let entries
    try { entries = await readdir(path.join(media, ...splitRel(rel)), { withFileTypes: true }) } catch { continue }
    for (const entry2 of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry2.isDirectory() && !entry2.name.startsWith('.')) queue.push({ rel: join(rel, entry2.name), depth: depth + 1 })
    }
  }
  return null
}

// 解析布局 + 定位 base；没找到：声明了 game.id 就记一句日志。命中 / 搜索的日志在探测函数确认「就是它」之后才打（announce），免得自动探测时被后面否掉的候选刷屏
async function locateGame(scope, id) {
  const { media, declared, logs } = scope
  const problems = []
  const entry = resolveLayout(id, scope.layouts, problems)
  for (const line of problems) logs.push(line)
  if (!entry) { logs.push(`布局表里「${id}」不可用：不能探测这个游戏`); return null }
  const loc = await locateBase(media, entry)
  if (!loc) {
    if (declared) logs.push(`没找到 ${entry.anchors.map((a) => (Array.isArray(a) ? a.join('/') : a)).join(' + ')}${entry.siblings.length ? `（同级要有 ${entry.siblings.join('|')} 之一）` : ''}`)
    return null
  }
  return { entry, ...loc }
}
const announce = (logs, id, loc) => logs.push(loc.via === 'table' ? `已知布局命中：${id} → ${loc.base || '.'}（bases「${loc.pattern || '.'}」）` : `已知布局没命中，改用搜索：${id} → ${loc.base || '.'}`)

// markers（没声明 game.id 时才查）：每项必须存在，数组项 = 任意一个
async function markersOk(media, entry, base, declared) {
  if (declared) return true
  for (const marker of entry.markers) {
    const options = typeof marker === 'string' ? [marker] : marker
    let any = false
    for (const option of options) if (await existsAt(media, base, option, 'any')) { any = true; break }
    if (!any) return false
  }
  return true
}

// 候选里第一个存在的（都不存在 = 第一个不带通配的候选）；返回相对 media 的路径
const isLiteralPattern = (pattern) => typeof pattern === 'string' && patternSegments(pattern).every((seg) => !seg.includes('*') && !seg.startsWith('/'))
async function firstExisting(media, base, candidates, want = 'any') {
  for (const candidate of candidates) { const hit = (await expand(media, base, candidate, want))[0]; if (hit) return hit.rel }
  const literal = candidates.find(isLiteralPattern)
  return literal === undefined ? null : join(base, patternSegments(literal).join('/'))
}

// 表 → config 骨架：路径类字段相对 base 拼成相对条目目录的路径，其余固定字段原样复制。userBase：namesFiles / thumbsDirs 相对谁（默认 base）
async function buildConfig(media, entry, base, { userBase } = {}) {
  const join2 = (rel) => join(base, patternSegments(rel).join('/'))
  // 脚本根：存在的都写；一个都不存在就写第一个
  const scriptRoots = []
  for (const root of entry.scriptRoots) {
    for (const hit of await expand(media, base, root.dir, 'dir')) {
      if (!scriptRoots.some((r) => r.dir === hit.rel)) scriptRoots.push({ id: fillCaps(root.id, hit.caps), dir: hit.rel, label: fillCaps(root.label ?? root.id, hit.caps) })
    }
  }
  if (!scriptRoots.length && entry.scriptRoots[0]) scriptRoots.push({ id: entry.scriptRoots[0].id, dir: join2(entry.scriptRoots[0].dir), label: entry.scriptRoots[0].label ?? entry.scriptRoots[0].id })
  const resourceRoot = await firstExisting(media, base, entry.resourceRoots, 'dir')
  const config = { scriptRoots, resourceRoots: [resourceRoot ?? base] }
  const template = structuredClone(entry.config)
  for (const key of ['namesFiles', 'thumbsDirs']) if (Array.isArray(template[key])) template[key] = template[key].map((rel) => join(userBase ?? base, patternSegments(rel).join('/')))
  Object.assign(config, template)
  // 适配器参数模板
  const adapterOptions = {}
  for (const [adapterId, options] of Object.entries(entry.adapterOptions)) {
    if (!options || typeof options !== 'object') continue
    const out = {}
    for (const [name, spec] of Object.entries(options)) {
      if (spec && typeof spec === 'object' && !Array.isArray(spec) && Array.isArray(spec.path)) out[name] = (await firstExisting(media, base, spec.path, 'any')) ?? ''
      else if (spec && typeof spec === 'object' && !Array.isArray(spec) && Array.isArray(spec.paths)) {
        const list = []
        for (const item of spec.paths) {
          if (typeof item !== 'string') continue
          const optional = item.startsWith('?')
          const pattern = optional ? item.slice(1) : item
          const hits = await expand(media, base, pattern, 'any')
          if (hits.length) for (const hit of hits) list.push(hit.rel)
          else if (!optional) list.push(join2(pattern))
        }
        out[name] = list
      } else out[name] = structuredClone(spec)
    }
    adapterOptions[adapterId] = out
  }
  if (Object.keys(adapterOptions).length) config.adapterOptions = adapterOptions
  return config
}

// 数脚本：表里 count 的各项相加
async function tableCount(media, entry, base, options) {
  let count = 0
  for (const item of entry.count) {
    for (const hit of await expand(media, base, item.dir, 'dir')) count += await countFiles(path.join(media, ...splitRel(hit.rel)), item.ext, options.countCap, Math.max(0, Math.floor(Number(item.depth)) || 3))
  }
  return count
}

// 封面规则：返回相对 base 的路径（= 相对资源根）
async function coverFromRules(media, entry, base) {
  for (const rule of entry.cover) {
    const dirs = await expand(media, base, rule.dir, 'dir', 400)
    for (const dir of dirs) {
      const dirAbs = path.join(media, ...splitRel(dir.rel))
      if (Array.isArray(rule.files)) {
        for (const file of rule.files) if (await isFile(path.join(dirAbs, file))) return join(relFromBase(base, dir.rel), file)
      } else {
        const re = new RegExp(rule.match, String(rule.flags || '').replace(/[^imsu]/g, ''))
        const names = (await listNames(dirAbs)).filter((name) => re.test(name))
        if (names.length) return join(relFromBase(base, dir.rel), rule.pick === 'last' ? names[names.length - 1] : names[0])
      }
    }
  }
  return ''
}

// 头像：递归找第一张匹配的图；返回 { cover, dirThumb }
async function scanAvatars(media, entry, base) {
  for (const avatar of entry.avatars) {
    for (const dir of await expand(media, base, avatar.dir, 'dir')) {
      const icon = await findFirstFile(path.join(media, ...splitRel(dir.rel)), new RegExp(avatar.match, String(avatar.flags || '').replace(/[^imsu]/g, '')), 30000)
      if (!icon) continue
      const dirRel = icon.dir ? join(relFromBase(base, dir.rel), icon.dir) : relFromBase(base, dir.rel)
      const dirThumb = avatar.dirThumb && typeof avatar.dirThumb === 'object'
        ? { ...structuredClone(avatar.dirThumb), paths: (avatar.dirThumb.paths || []).map((p) => String(p).replace(/<dir>/g, dirRel).replace(/<ext>/g, icon.ext ?? '')) }
        : null
      return { cover: `${dirRel}/${icon.file}`, dirThumb }
    }
  }
  return { cover: '', dirThumb: null }
}

async function warnMissing(media, entry, base, logs) {
  for (const name of entry.expectedDirs) if (!(await existsAt(media, base, name, 'any'))) logs.push(`提示：没有 ${name}/（用到它的内容会缺资源）`)
}

// 探测函数的公共收尾：统一的 found 对象。finish = 数脚本（默认按表 count）
function makeFound(scope, entry, loc, config, { cover = '', nodes, count } = {}) {
  const { media, logs } = scope
  return {
    id: scope.id,
    kind: entry.kind || scope.id,
    note: '',
    config,
    via: loc.via,
    base: loc.base,
    adapters: entry.adapters,
    nodes: nodes || (entry.nodes ? async () => autoNodes(entry.nodes) : undefined),
    async finish(m, _config, options) {
      const n = count ? await count(options) : await tableCount(media, entry, loc.base, options)
      logs.push(`脚本 ${n} 个${n ? '' : '——结构可能不对，可以用 overrides 覆盖 scriptRoots'}`)
      return { count: n, cover }
    },
  }
}

// 默认节点图（config.nodes）：首页下每个适配器目录的顶层项各是一个 auto 节点，用 catalog 引用适配器原来给的那份内容——
// 效果和不用节点图时一模一样，但每一项都可以改 / 挪 / 隐藏、加相关（related）、再接别的目录（dirs / expand）。
// auto: true = 本脚本生成的，重跑会重新生成；你手写的 nodes（home 不带 auto）重跑时原样保留。适配器没有某个目录时（比如没有 Stills）auto 节点静默跳过。
const autoNodes = (entries) => {
  const nodes = { home: { auto: true, children: entries.map(([id]) => id) } }
  for (const [id, catalog] of entries) nodes[id] = { auto: true, catalog }
  return nodes
}

// ======================================================================
// 入口
// ======================================================================
const DETECTORS = {
  legeclo: (scope) => detectLegeclo(scope),
  monmusu: (scope) => detectMonmusu(scope),
  angelic: (scope) => detectAngelic(scope),
  girlscreation: (scope) => detectGirlsCreation(scope),
  tenkeiprdx: (scope) => detectTenkeiprdx(scope),
  misttrain: (scope) => detectMisttrain(scope),
  minashigo: (scope) => detectMinashigo(scope),
  minashigo_r: (scope) => detectMinashigoR(scope),
  artwhirl: (scope) => detectArtwhirl(scope),
  kamihime: (scope) => detectKamihime(scope),
  bokusen: (scope) => detectBokusen(scope),
  grenze: (scope) => detectGrenze(scope),
  tsk: (scope) => detectTsk(scope),
  uviewer: (scope) => detectUviewerGame(scope),
}

// 表里每个 id 一个处理器：detector 沿 extends 往上找；autoOrder 只看自己（别名不写 = 只在声明了 game.id 时才走）
function gameHandlers() {
  const handlers = []
  for (const [id, own] of Object.entries(LAYOUTS)) {
    if (!own || typeof own !== 'object') continue   // 表里写坏的项（不是对象）：跳过，不崩
    let name = ''
    let cur = own
    for (let depth = 0; cur && depth < 6 && !name; depth++) {
      name = typeof cur.detector === 'string' ? cur.detector : ''
      cur = typeof cur.extends === 'string' && Object.prototype.hasOwnProperty.call(LAYOUTS, cur.extends) ? LAYOUTS[cur.extends] : null
    }
    if (DETECTORS[name]) handlers.push({ id, detect: DETECTORS[name], detector: name, autoOrder: Number.isFinite(own.autoOrder) ? own.autoOrder : null })
  }
  return handlers
}

export async function generateTags(ctx) {
  const options = normalizeOptions(ctx.script?.options || {})
  const media = String(ctx.item?.source?.path || '')
  if (!media) throw new Error('条目没有记录来源目录（source.path）')
  const logs = [`探测 Gal 目录：${media}`]
  if (!(await isDir(media))) {
    logs.push('目录不存在或不可读：不改任何配置')
    return keepOwn(ctx, logs, { skipped: true })
  }
  const game = ctx.item?.config?.game
  const handlers = gameHandlers()
  const scopeOf = (handler, declared) => ({ media, logs, layouts: options.layouts, declared, game, id: handler.id, item: ctx.item })

  // 1) 认游戏、探测结构
  let found = null
  if (game?.id) {
    const handler = handlers.find((g) => g.id === game.id)
    if (!handler) {
      logs.push(`这个媒体的 config.game.id 是「${game.id}」，本脚本不认识这个游戏（认识：${handlers.map((g) => g.id).join(' / ')}）：跳过`)
      return keepOwn(ctx, logs, { skipped: true })
    }
    found = await handler.detect(scopeOf(handler, true))
    if (!found && handler.detector === 'uviewer') found = genericLayout()   // 探测不到结构时 UViewer 系退回通用配置
    if (!found) {
      logs.push(`config.game.id 是「${game.id}」，但目录里没认出它的结构：不改任何配置（可以用 overrides 指定路径，或检查 rootDir）`)
      return keepOwn(ctx, logs, { skipped: true })
    }
  } else {
    for (const handler of handlers.filter((g) => g.autoOrder !== null).sort((a, b) => a.autoOrder - b.autoOrder)) {
      found = await handler.detect(scopeOf(handler, false))
      if (found) break
    }
    if (!found) found = genericLayout()
  }
  const config = { ...found.config }
  logs.push(`识别为：${found.kind}${found.note ? `（${found.note}）` : ''}`)
  if (found.id) config.game = { id: found.id, title: game?.title || '' }
  const itemAdapters = (Array.isArray(ctx.item?.adapters) ? ctx.item.adapters : []).map(String)
  if (found.adapters?.length && itemAdapters.length && !found.adapters.some((id) => itemAdapters.includes(id))) {
    logs.push(`提示：条目的适配器（${itemAdapters.join('、')}）和布局表里这个游戏的默认适配器（${found.adapters.join('、')}）没有交集——确认导入时选对了适配器`)
  }

  // 2) 覆盖（按媒体路径匹配）；记下每条覆盖改了哪些字段
  let title = ''
  let coverOverride = ''
  const applied = []
  const appliedFields = []
  options.overrides.forEach((rule, i) => {
    if (!matchesPath(rule.path, media)) return
    applied.push(i + 1)
    const fields = []
    if (rule.config && typeof rule.config === 'object') {
      for (const [key, value] of Object.entries(rule.config)) {
        if (canonJson(config[key]) !== canonJson(value)) fields.push(`config.${key}`)
        config[key] = value
      }
    }
    if (typeof rule.cover === 'string' && rule.cover) { coverOverride = rule.cover; fields.push('cover') }
    if (typeof rule.title === 'string' && rule.title.trim()) { title = rule.title.trim(); fields.push('title') }
    appliedFields.push({ rule: i + 1, fields })
  })
  if (applied.length) logs.push(`命中覆盖项：第 ${applied.join('、')} 条`)

  if (options.rawIgnore.length && config.rawIgnore === undefined) config.rawIgnore = options.rawIgnore.slice()

  // 3) 脚本数、封面
  const result = await (found.finish ? found.finish(media, config, options, logs) : { count: 0, cover: '' })
  config.scriptCount = result.count
  const cover = coverOverride || result.cover
  if (cover) config.cover = cover
  logs.push(cover ? `封面：${cover}` : '没找到合适的封面')

  // 3.5) 默认节点图：没有手写的 nodes 才生成（手写的 = home 不带 auto）；replace 整体替换时手写的 nodes 也带上，不丢
  if (found.nodes) {
    const existing = ctx.item?.config?.nodes
    const handWritten = existing?.home && !existing.home.auto
    if (handWritten) {
      if (options.replace) config.nodes = existing
      logs.push('config.nodes 是手写的（home 不带 auto）：原样保留，不生成默认节点图')
    } else {
      config.nodes = await found.nodes()
      logs.push(`默认节点图：首页下 ${config.nodes.home.children.length} 个节点（${config.nodes.home.children.map((id) => config.nodes[id].catalog).join(' / ')}），引用适配器目录，内容和原来一样`)
    }
  }

  // 4) 记下是谁写的
  const version = String(ctx.script?.version || 'unknown')
  config.script = { id: ctx.script?.id || 'gal-layout', version, ranAt: new Date().toISOString() }

  const state = applied.length ? '自定义' : found.id || found.kind
  const itemTags = [`Gal配置: ${state}`, `Gal配置version: ${version}`, ...(found.id ? [`Gal游戏: ${found.id}`] : [])]

  // 5) 这次运行的改动情况（和条目现有 config / 标签对比）
  const report = changeReport({
    before: ctx.item?.config, patch: config, replace: options.replace, titleBefore: ctx.item?.title, titleAfter: title,
    tagsBefore: ownTags(ctx), tagsAfter: itemTags, gameBefore: game?.id || '', gameAfter: config.game?.id || '', overrides: appliedFields,
    dryRun: options.dryRun, lineBudget: Math.max(8, Math.min(60, 79 - logs.length - (options.dryRun ? 2 : 0))),
  })

  if (options.dryRun) {
    logs.push('【dryRun】只探测，不写配置；用完请关闭 dryRun 选项')
    logs.push(...report.lines)
    logs.push(`将写入：${JSON.stringify(config).slice(0, 1500)}`)
    return keepOwn(ctx, logs, { changes: report.changes })
  }
  logs.push(...report.lines)
  return {
    itemTags,
    unitTags: [],
    unitPatches: [],
    itemPatch: { gal: { config, replace: options.replace }, ...(title ? { title } : {}) },
    logs,
    details: fitDetails({ game: found.id || '', kind: found.kind, scripts: result.count, cover, overrides: applied, version, layout: found.via ? `${found.via}:${found.base || '.'}` : '', changes: report.changes }),
  }
}

// ======================================================================
// 这次运行的改动情况：和条目现有的 raw config 逐字段对比（合并语义：补丁里写了的顶层字段整个替换、没写的保留；replace = 整体替换；null = 删掉）
// 两边都先过一遍「引擎规整会补的默认值」（canonField），免得 views / thumbSources / nodes 里引擎补的空字段被当成改动
// ======================================================================
const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v)
const sortDeep = (v) => (Array.isArray(v) ? v.map(sortDeep) : isPlain(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v)
function canonJson(v) { try { return JSON.stringify(sortDeep(v)) ?? 'undefined' } catch { return String(v) } }
const clip = (text, n = 200) => (text.length > n ? `${text.slice(0, n)}…（共 ${text.length} 字符）` : text)
const showValue = (v, n = 200) => clip(canonJson(v), n)

function canonField(key, value) {
  const list = (fn) => (Array.isArray(value) ? value.map((item) => (isPlain(item) ? fn(item) : item)) : value)
  switch (key) {
    case 'scriptRoots': return list((r) => ({ ...r, id: r.id ?? '', dir: r.dir ?? '', label: r.label || r.id || '' }))
    case 'views': return list((r) => ({ ...r, parent: !r.parent || r.parent === '.' ? '' : r.parent, label: r.label ?? '', dirs: r.dirs ?? [], match: r.match ?? '', exclusive: Boolean(r.exclusive), badges: r.badges ?? {} }))
    case 'merge': return list((r) => ({ ...r, badges: r.badges ?? {} }))
    case 'dirThumbs': return list((r) => ({ ...r, parent: r.parent || '*', name: r.name ?? '' }))
    case 'scriptIndex': return list((r) => ({ ...r, key: r.key || '{1}', badge: r.badge ?? '' }))
    case 'thumbSources': return list((r) => ({ ...r, key: r.key || '{1}', for: ['script', 'dir'].includes(r.for) ? r.for : 'both', forKey: r.forKey ?? '', forMatch: r.forMatch ?? '', kind: r.kind === 'video' ? 'video' : 'image', limit: Math.max(1, Math.min(12, Math.floor(Number(r.limit)) || 12)), fallback: Boolean(r.fallback) }))
    // 引擎规整：空的路径列表退回默认值（relList）——存进去的是默认值，所以写 [] 和存着默认值是同一回事
    case 'namesFiles': return Array.isArray(value) && !value.length ? ['user_data/character_names.json'] : value
    case 'thumbsDirs': return Array.isArray(value) && !value.length ? ['user_data/thumbnails'] : value
    case 'resourceRoots': return Array.isArray(value) && !value.length ? ['resources'] : value
    case 'game': return isPlain(value) ? { ...value, title: value.title ?? '' } : value
    case 'nodes':
      if (!isPlain(value)) return value
      return Object.fromEntries(Object.entries(value).map(([id, spec]) => [id, isPlain(spec)
        ? { title: '', subtitle: '', text: '', badge: '', thumb: '', children: [], related: [], catalog: '', auto: false, dirs: [], match: '', expand: null, ...spec }
        : spec]))
    default: return value
  }
}

// 数组的增删：按「规整后」的深度 JSON 相等比较（条目里没有顺序语义的重复项按个数算），返回的项是原来写的样子（beforeRaw / afterRaw 和 before / after 一一对应）
function arrayDelta(before, after, beforeRaw = before, afterRaw = after) {
  const left = new Map()
  before.forEach((item, i) => { const k = canonJson(item); if (!left.has(k)) left.set(k, []); left.get(k).push(i) })
  const added = []
  after.forEach((item, i) => {
    const slots = left.get(canonJson(item))
    if (slots?.length) slots.shift()
    else added.push(afterRaw[i])
  })
  const removed = [...left.values()].flat().sort((a, b) => a - b).map((i) => beforeRaw[i])
  return { added, removed }
}
const listShow = (items) => `${items.slice(0, 4).map((item) => showValue(item, 120)).join(' ')}${items.length > 4 ? ` …另 ${items.length - 4} 项` : ''}`
const sameLength = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length

// 两个值的差别，返回片段数组（数组：增删的项；对象：改了的键，嵌套最多 3 层；标量：旧 → 新）。ra / rb = 规整前的原值（显示用）
function deltaParts(a, b, prefix = '', depth = 0, ra = a, rb = b) {
  if (canonJson(a) === canonJson(b)) return []
  const tag = (text) => (prefix ? `${prefix}：${text}` : text)
  if (Array.isArray(a) && Array.isArray(b)) {
    const { added, removed } = arrayDelta(a, b, sameLength(a, ra) ? ra : a, sameLength(b, rb) ? rb : b)
    const out = []
    if (added.length) out.push(tag(`新增 ${added.length} 项 ${listShow(added)}`))
    if (removed.length) out.push(tag(`删除 ${removed.length} 项 ${listShow(removed)}`))
    if (!out.length) out.push(tag('内容相同，仅顺序变化'))
    return out
  }
  if (isPlain(a) && isPlain(b) && depth < 3) {
    const out = []
    const rawOf = (obj, k) => (isPlain(obj) && k in obj ? obj[k] : undefined)
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      const p = prefix ? `${prefix}.${k}` : k
      if (!(k in a)) out.push(`${p}：新增 ${showValue(rawOf(rb, k) ?? b[k], 120)}`)
      else if (!(k in b)) out.push(`${p}：删除（原值 ${showValue(rawOf(ra, k) ?? a[k], 120)}）`)
      else out.push(...deltaParts(a[k], b[k], p, depth + 1, rawOf(ra, k) ?? a[k], rawOf(rb, k) ?? b[k]))
    }
    return out
  }
  return [tag(`${showValue(ra)} → ${showValue(rb)}`)]
}

function briefOf(kind, before, after) {
  const size = (v) => (Array.isArray(v) ? `${v.length} 项` : isPlain(v) ? `${Object.keys(v).length} 个键` : showValue(v, 40))
  if (kind === 'added') return `新增（${size(after)}）`
  if (kind === 'removed') return `删除（原 ${size(before)}）`
  if (Array.isArray(before) && Array.isArray(after)) {
    const { added, removed } = arrayDelta(before, after)
    return added.length || removed.length ? `+${added.length} −${removed.length}` : '仅顺序'
  }
  if (isPlain(before) && isPlain(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => canonJson(before[k]) !== canonJson(after[k]))
    return clip(`键 ${keys.slice(0, 5).join('、')}${keys.length > 5 ? ` 等 ${keys.length} 个` : ''}`, 60)
  }
  return clip(`${showValue(before, 28)} → ${showValue(after, 28)}`, 70)
}

const CHANGE_REPORT_BYTES = 8192
function changeReport({ before, patch, replace, titleBefore, titleAfter, tagsBefore, tagsAfter, gameBefore, gameAfter, overrides, dryRun, lineBudget }) {
  const existing = isPlain(before) ? before : {}
  const changes = { added: [], changed: [], removed: [], unchanged: [], kept: [] }
  const details = []   // { rank, line }
  const keys = [...new Set([...Object.keys(patch || {}), ...Object.keys(existing)])].filter((k) => k !== 'script')   // 运行标记（版本 / 运行时间）每次都更新，不算改动
  for (const key of keys) {
    const had = existing[key] !== undefined
    const written = patch && Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined
    if (!written) {
      if (!had) continue
      if (replace) {
        changes.removed.push({ field: key, info: briefOf('removed', canonField(key, existing[key])) })
        details.push({ rank: 2, line: `- ${key}（删除，replace 整体替换）：原值 ${showValue(canonField(key, existing[key]))}` })
      } else changes.kept.push(key)
      continue
    }
    if (patch[key] === null) {
      if (had) {
        changes.removed.push({ field: key, info: briefOf('removed', canonField(key, existing[key])) })
        details.push({ rank: 2, line: `- ${key}（删除，补丁里写了 null）：原值 ${showValue(canonField(key, existing[key]))}` })
      }
      continue
    }
    const after = canonField(key, patch[key])
    if (!had) {
      changes.added.push({ field: key, info: briefOf('added', undefined, after) })
      const raw = patch[key]
      details.push({ rank: 0, line: `+ ${key}（新增）：${Array.isArray(raw) && raw.length ? `${raw.length} 项 ` : ''}${(Array.isArray(raw) && !raw.length) || (isPlain(raw) && !Object.keys(raw).length) ? '（空）' : showValue(raw)}` })
      continue
    }
    const old = canonField(key, existing[key])
    if (canonJson(old) === canonJson(after)) { changes.unchanged.push(key); continue }
    changes.changed.push({ field: key, info: briefOf('changed', old, after) })
    details.push({ rank: 1, line: `~ ${key}（修改）：${deltaParts(old, after, '', 0, existing[key], patch[key]).join('；')}` })
  }
  const counts = { added: changes.added.length, changed: changes.changed.length, removed: changes.removed.length, unchanged: changes.unchanged.length }
  const total = counts.added + counts.changed + counts.removed + counts.unchanged

  const tags = { added: tagsAfter.filter((t) => !tagsBefore.includes(t)), removed: tagsBefore.filter((t) => !tagsAfter.includes(t)), unchanged: tagsAfter.filter((t) => tagsBefore.includes(t)) }
  const tagsChanged = tags.added.length || tags.removed.length
  const titleChanged = Boolean(titleAfter) && titleAfter !== (titleBefore || '')
  const nothing = !counts.added && !counts.changed && !counts.removed && !tagsChanged && !titleChanged
  const summary = nothing
    ? '没有改动'
    : `本次改动：新增 ${counts.added} 项 / 修改 ${counts.changed} 项 / 删除 ${counts.removed} 项 / 未变 ${counts.unchanged} 项（共 ${total} 个字段）`

  // 页脚（短的、一定要看到的）和明细（长的、超出预算就截断）分开
  const foot = []
  if (nothing) foot.push(`本次写入的 ${total} 个字段都和原来一样（config.script 运行标记照常更新，不算改动）`)
  if (changes.unchanged.length && !nothing) foot.push(`未变：${changes.unchanged.join('、')}`)
  if (changes.kept.length) foot.push(`保留（本次没写，原值不动）：${changes.kept.join('、')}`)
  if (tagsChanged || !nothing) foot.push(`标签：${tags.added.length ? `新增 ${tags.added.join('、')}` : '无新增'}；${tags.removed.length ? `删除 ${tags.removed.join('、')}` : '无删除'}；未变 ${tags.unchanged.length} 个`)
  if (titleChanged) foot.push(`标题：${clip(titleBefore || '（空）', 60)} → ${clip(titleAfter, 60)}（覆盖项）`)
  if (gameAfter || gameBefore) {
    foot.push(!gameAfter ? `game.id：本次没认领（原来是「${gameBefore}」，不动）` : !gameBefore ? `game.id：写回「${gameAfter}」（原来没有）` : gameBefore === gameAfter ? `game.id：「${gameAfter}」未变` : `game.id：「${gameBefore}」→「${gameAfter}」`)
  }
  for (const item of overrides) foot.push(`覆盖项第 ${item.rule} 条改了：${item.fields.length ? item.fields.join('、') : '（和探测结果一样，没有实际改动）'}`)

  // 拼日志：标题 / 汇总 / 明细 / 页脚；明细按 新增 → 修改 → 删除 排，预算（行数和字节）用完就截断并写「… 另有 N 项」
  const head = [...(dryRun ? ['【dryRun】将要产生的改动'] : []), summary]
  details.sort((a, b) => a.rank - b.rank)
  const lines = [...head]
  let bytes = [...head, ...foot].reduce((n, line) => n + Buffer.byteLength(line) + 1, 0)
  const room = Math.max(0, lineBudget - head.length - foot.length - 1)
  let shown = 0
  for (const item of details) {
    const line = clip(item.line, 470)
    const size = Buffer.byteLength(line) + 1
    if (shown >= room || bytes + size > CHANGE_REPORT_BYTES - 64) break
    lines.push(line)
    bytes += size
    shown++
  }
  if (shown < details.length) lines.push(`… 另有 ${details.length - shown} 项没列出（共 ${details.length} 项明细；完整的在 details.changes）`)
  lines.push(...foot.map((line) => clip(line, 480)))

  return {
    lines: lines.slice(0, Math.max(head.length + 1, lineBudget)).map((line) => line.replace(/\r?\n/g, ' ')),
    changes: { summary, ...changes, tags, ...(titleChanged ? { title: { from: titleBefore || '', to: titleAfter } } : {}), game: { before: gameBefore, after: gameAfter }, overrides, replace: Boolean(replace), dryRun: Boolean(dryRun) },
  }
}

// details 进 4000 字符的限额（超了服务端会截成字符串）：先把每项说明缩短，再丢说明，最后只留字段名
function fitDetails(details) {
  const size = () => JSON.stringify(details).length
  const infoMap = (fn) => { for (const key of ['added', 'changed', 'removed']) details.changes[key] = details.changes[key].map((item) => fn(item)) }
  if (size() > 3800) infoMap((item) => ({ ...item, info: clip(item.info, 24) }))
  if (size() > 3800) infoMap((item) => ({ field: item.field }))
  if (size() > 3800) { details.changes.overrides = details.changes.overrides.map((o) => ({ rule: o.rule, fields: o.fields.slice(0, 3) })); details.changes.tags = { added: details.changes.tags.added.length, removed: details.changes.tags.removed.length, unchanged: details.changes.tags.unchanged.length } }
  return details
}

// ======================================================================
// 各游戏的探测函数：目录在哪、脚本根 / 资源根是什么都来自 LAYOUTS；这里只做依赖数据的事（标记文件内容、数脚本、挑封面、认头像 / 菜单按钮图、分类节点）
// scope = { media, logs, layouts, declared, game, id, item }
// ======================================================================

// ---- legeclo：目录结构和 monmusu 很像（都有 script/hscene、script/movie.rpy），所以靠名字区分：options.rpy 里写着 legeclo，或者游戏根旁边有 legeclo_py.*（启动器）。声明了 game.id 的不要求这个标记。
async function hasLegecloMarker(media, base) {
  try {
    const text = (await readFile(path.join(media, ...splitRel(join(base, 'options.rpy'))))).subarray(0, 32768).toString('utf8')
    if (/legeclo/i.test(text)) return true
  } catch { /* 没有 options.rpy */ }
  // 游戏根（game 的上一层）里有 legeclo_py.exe / .py / .sh；base 在媒体目录最上层（media 本身就是 game）时看 media 的上一层读不到，所以也看 media 自己
  for (const dir of [join(base ? base.split('/').slice(0, -1).join('/') : '', ''), '']) {
    try { if ((await readdir(path.join(media, ...splitRel(dir)))).some((name) => /^legeclo/i.test(name))) return true } catch { /* 下一个 */ }
  }
  return false
}

async function detectLegeclo(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  if (!declared && !(await hasLegecloMarker(media, base))) return null   // 没声明又没有 legeclo 的标记：多半是 monmusu，让它去认
  if (!(await markersOk(media, entry, base, declared))) return null
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  const hasMovie = (config.adapterOptions?.['renpy-legeclo']?.aliasFiles || []).length > 0
  logs.push(`legeclo 游戏根：${base || '.'}${base ? '（目录里多了一层）' : ''}${hasMovie ? '' : '；没有 script/movie.rpy（视频别名表）'}`)
  for (const line of entry.notes) logs.push(line)
  const avatar = await scanAvatars(media, entry, base)
  if (!avatar.cover) logs.push('没找到 images/thumbnail/char/st_*.png：角色卡片没有头像（脚本卡片仍可用 images/thumbnail/st）')
  return makeFound(scope, entry, loc, config, { cover: avatar.cover })
}

// ---- monmusu（Ren'Py）
async function detectMonmusu(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  if (!(await markersOk(media, entry, base, declared))) return null   // 没声明又没有视频别名表：不确定是 monmusu
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  const hasMovie = (config.adapterOptions?.['renpy-monmusu']?.aliasFiles || []).length > 0
  // 合并视图只收存在的目录（hscene_still 不一定有）
  const mergeDirs = []
  for (const name of config.views?.[0]?.dirs || []) if (await isDir(path.join(media, ...splitRel(join(base, 'script', name))))) mergeDirs.push(name)
  if (config.views?.[0]) config.views[0].dirs = mergeDirs
  logs.push(`monmusu 游戏根：${base || '.'}${base ? '（目录里多了一层）' : ''}${hasMovie ? '' : '；没有 script/movie.rpy（视频别名表）'}`)
  logs.push(`首页入口：动画 / 事件 / 总览（${mergeDirs.join(' + ')} 合并）；动画和总览按角色编号分组`)
  const avatar = await scanAvatars(media, entry, base)
  if (avatar.dirThumb) { config.dirThumbs = [avatar.dirThumb]; logs.push(`头像模板：${avatar.dirThumb.paths[0]}`) }
  else logs.push('没找到 icon_<编号>_0_idle 头像图（images 目录里）：角色卡片没有头像')
  // 脚本卡片封面：菜单按钮图可能分散在 images 的几个子目录里：整棵树扫一遍，每条规则对每个含匹配文件的目录各配一条 scriptIndex
  config.scriptIndex = []
  for (const scan of entry.scriptIndexScan) {
    for (const dir of await expand(media, base, scan.dir, 'dir')) {
      const hits = await findDirsWithFiles(path.join(media, ...splitRel(dir.rel)), scan.rules.map((r) => new RegExp(r.pattern)), 30000)
      scan.rules.forEach((rule, i) => {
        for (const sub of hits[i]) config.scriptIndex.push({ dir: join(dir.rel, sub), pattern: rule.pattern, key: rule.key, badge: '' })
      })
    }
  }
  logs.push(config.scriptIndex.length ? `脚本封面：${config.scriptIndex.length} 条规则（动画 / 静图卡片用菜单按钮图）` : '没找到菜单按钮图（<编号>_01_idle / r18_<编号>_stla1_idle）：动画 / 静图卡片没有封面')
  return makeFound(scope, entry, loc, config, { cover: avatar.cover })
}

// ---- angelic_py（Ren'Py 粉丝播放器，和 monmusu 同一类，视频 / 静图别名表在 script/movies.rpy、script/stills.rpy——注意是复数）
async function detectAngelic(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  if (!(await markersOk(media, entry, base, declared))) return null   // 没声明又没有 movies.rpy / stills.rpy（复数）：不确定是 angelic（monmusu 的是 movie.rpy，它先认）
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  const options = config.adapterOptions?.['renpy-monmusu'] || {}
  logs.push(`angelic 游戏根：${base || '.'}${base ? '（目录里多了一层）' : ''}；别名表：${(options.aliasFiles || []).length ? options.aliasFiles.join('、') : '没有 script/movies.rpy / stills.rpy（视频 / 静图会缺资源）'}；图片目录：${(options.imageDirs || []).join('、') || '没有 images / resources'}`)
  for (const line of entry.notes) logs.push(line)
  return makeFound(scope, entry, loc, config)
}

// ---- Girls Creation R Viewer（NW.js，标签式脚本）：<root>/scenes/<场景 id>/script.txt（每个场景一个目录，资源都在场景目录里）+ <root>/data/audio/{bgm,se}。家族各游戏（aku / fruits / maid …）声明了什么 id 就写回什么
async function detectGirlsCreation(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  const scenesRel = join(base, 'scenes')
  const scenesAbs = path.join(media, ...splitRel(scenesRel))
  const names = (await listNames(scenesAbs)).slice(0, 400)
  let withScript = 0
  for (const name of names) {
    if ((await isFile(path.join(scenesAbs, name, 'script.txt'))) || (await isFile(path.join(scenesAbs, name, 'output_script.txt')))) { withScript += 1; continue }
    if ((await listNames(path.join(scenesAbs, name))).some((file) => /^h[ms]r_[^/]+\.txt$/i.test(file))) withScript += 1   // 只有行式脚本（hmr_ / hsr_<id>.txt）的场景
  }
  if (!withScript) {
    if (declared) logs.push('scenes/ 里没有 <场景>/script.txt')
    return null
  }
  if (!(await markersOk(media, entry, base, declared))) return null
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  const hasAudio = await existsAt(media, base, 'data/audio', 'dir')
  logs.push(`Girls Creation 根（package.nw）：${base || '.'}${base ? '（目录里多了一层）' : ''}；场景 ${withScript}${names.length >= 400 ? '+' : ''} 个${hasAudio ? '' : '；没有 data/audio（BGM / 音效会缺资源）'}`)
  for (const line of entry.notes) logs.push(line)
  const cover = await coverFromRules(media, entry, base)
  if (!cover) logs.push('没找到场景的 thumbnail.*：列表没有封面')
  return makeFound(scope, entry, loc, config, {
    cover,
    // 分类 = 场景 id 开头的字母（chmr / chsr …，数字开头的是「其他」），和适配器的列表一致；每个分类一个节点
    nodes: async () => {
      const categories = new Set()
      for (const name of await listNames(scenesAbs)) {
        const dir = path.join(scenesAbs, name)
        const has = (await isFile(path.join(dir, 'script.txt'))) || (await isFile(path.join(dir, 'output_script.txt'))) || (await listNames(dir)).some((file) => /^h[ms]r_[^/]+\.txt$/i.test(file))
        if (has) categories.add(/^[A-Za-z]+/.exec(name)?.[0] || '其他')
      }
      return autoNodes([...[...categories].sort(sortName).map((category, i) => [`cat${i + 1}`, `c/${category}`]), ...entry.nodes])
    },
    count: async () => { logs.push(`场景（有 script.txt / output_script.txt / hmr_·hsr_<id>.txt）${withScript} 个`); return withScript },
  })
}

// ---- tenkeiprdx（Unity 剧情查看器素材）：列表（活动 / 附加 / 角色 / 全部剧情）由适配器每次从数据文件现读
async function detectTenkeiprdx(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  if (!(await markersOk(media, entry, base, declared))) return null
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  logs.push(`tenkeiprdx 素材根：${base || '.'}${base ? '（目录里多了一层）' : ''}`)
  await warnMissing(media, entry, base, logs)
  const cover = await coverFromRules(media, entry, base)
  return makeFound(scope, entry, loc, config, { cover })
}

// ---- misttrain（MistTrainGirls X，Unity 剧情查看器：UScenes/<id>/<id>.json、UScenes/Stills/<底号>/<id>.json）
async function detectMisttrain(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  if (!(await markersOk(media, entry, base, declared))) return null
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  logs.push(`misttrain 数据根：${base || '.'}${base ? '（目录里多了一层）' : ''}`)
  await warnMissing(media, entry, base, logs)
  return makeFound(scope, entry, loc, config)
}

// ---- minashigo（Ren'Py，MinashigoViewer：game/scripts/scene_*.rpy）：没声明时靠 script.rpy 开头的 DynamicCharacter("name") 认（monmusu 没有 game/scripts，也没有它）
async function detectMinashigo(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  let marker = false
  try { marker = /DynamicCharacter\s*\(\s*["']name["']/.test((await readFile(path.join(media, ...splitRel(join(base, 'game/script.rpy'))))).subarray(0, 16384).toString('utf8')) } catch { /* 没有 script.rpy */ }
  if (!declared && !marker) return null
  if (!(await markersOk(media, entry, base, declared))) return null
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  logs.push(`minashigo 游戏根：${join(base, 'game') || '.'}；脚本 ${config.scriptRoots[0]?.dir || ''}${marker ? '' : '（没有认出 script.rpy 里的 DynamicCharacter("name")）'}`)
  for (const line of entry.notes) logs.push(line)
  return makeFound(scope, entry, loc, config)
}

// ---- ミナシゴノシゴトR：剧情脚本就是 UViewer 的 CSV 格式，用 uviewer-csv 适配器；资源根 = data
async function detectMinashigoR(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  if (!(await markersOk(media, entry, base, declared))) return null
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  logs.push(`ミナシゴノシゴトR 数据根：${base || '.'}${base ? '（目录里多了一层）' : ''}；剧情 ${config.scriptRoots[0]?.dir || ''}（uviewer-csv 格式，资源相对 ${base || '.'}）`)
  for (const line of entry.notes) logs.push(line)
  return makeFound(scope, entry, loc, config)
}

// ---- 魔法学园的少女们（ArtWhirl）：game/episode_scripts/<组>/*.json（主线 / 角色剧情）和 game/hscripts/<组>/*.json（H 场景）
async function detectArtwhirl(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  if (!(await markersOk(media, entry, base, declared))) return null
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  const hasStands = await existsAt(media, base, 'images/stands', 'dir')
  const hasAudio = await existsAt(media, base, 'audio', 'dir')
  logs.push(`魔法学园 游戏根：${base || '.'}；脚本根：${config.scriptRoots.map((r) => r.dir).join('、')}；立绘目录${hasStands ? '有' : '没有'}，音频目录${hasAudio ? '有' : '没有'}`)
  for (const line of entry.notes) logs.push(line)
  return makeFound(scope, entry, loc, config)
}

// ---- Twinkle Star Knights X（Unity + Utage）：<数据根>/Adventure/<剧情文件夹>/*.book.json + Adventure/Master.chapter.json
async function detectTsk(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  if (!(await markersOk(media, entry, base, declared))) return null
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  logs.push(`TSK 数据根：${base || '.'}${base ? '（目录里多了一层）' : ''}`)
  await warnMissing(media, entry, base, logs)
  const cover = await coverFromRules(media, entry, base)
  if (!cover) logs.push('没找到 Adventure/BackGrounds/*：没有封面')
  const adventure = (name = '') => path.join(media, ...splitRel(join(base, 'Adventure', name)))
  return makeFound(scope, entry, loc, config, {
    cover,
    // 适配器的列表：每个含 *.book.json 的剧情文件夹一个节点 + 全部剧情
    nodes: async () => {
      const categories = []
      for (const name of await listNames(adventure())) {
        if (!(await isDir(adventure(name)))) continue
        if ((await listNames(adventure(name))).some((file) => /\.book\.json$/i.test(file))) categories.push(name)
      }
      return autoNodes([...categories.map((name, i) => [`cat${i + 1}`, `c/${name}`]), ...entry.nodes])
    },
  })
}

// ---- Grenze（GrenzeViewer）：<根>/TextAsset/easy_dialog-N.xml（每个文件几百个场景，next_id 串成链），资源在 <根>/assets/resources/patchres；场景列表由适配器从 XML 里现读
async function detectGrenze(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  if (!(await markersOk(media, entry, base, declared))) return null
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  const hasResources = await existsAt(media, base, 'assets/resources/patchres', 'dir')
  const dialogs = (await listNames(path.join(media, ...splitRel(config.scriptRoots[0]?.dir || join(base, 'TextAsset'))))).filter((name) => /^easy_dialog-\d+\.xml$/i.test(name))
  logs.push(`Grenze 游戏根：${base || '.'}；对话 XML ${dialogs.length} 个；资源目录${hasResources ? '有' : '没有（背景 / 声音 / 立绘都会缺）'}`)
  for (const line of entry.notes) logs.push(line)
  return makeFound(scope, entry, loc, config, {
    count: async () => { logs.push(`对话 XML ${dialogs.length} 个${dialogs.length ? '' : '——结构可能不对'}`); return dialogs.length },
  })
}

// ---- ぼくらの放課後戦争（bokusen）：<根>/json/<脚本名>.json（KAG / Tyrano 编译表），资源在 <根>/resource/<脚本名>/images|sounds
async function detectBokusen(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  const jsonRel = join(base, 'json')
  if (!declared) {
    // 没声明：要求 json/ 里有脚本开头是 {"data":{"code":{…（只读开头 8KB，最多看 5 个），并且同级有 resource/
    let hits = 0
    for (const name of (await listNames(path.join(media, ...splitRel(jsonRel)))).filter((n) => n.toLowerCase().endsWith('.json')).slice(0, 5)) {
      try {
        const head = (await readFile(path.join(media, ...splitRel(join(jsonRel, name))))).subarray(0, 8192).toString('utf8').replace(/^\uFEFF/, '')
        if (/^\s*\{\s*"data"\s*:\s*\{\s*"code"\s*:\s*\{/.test(head)) hits++
      } catch { /* 读不了就当不是 */ }
    }
    if (!hits || !(await markersOk(media, entry, base, declared))) return null
  }
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  const hasResource = await existsAt(media, base, 'resource', 'dir')
  logs.push(`bokusen 游戏根：${base || '.'}；脚本根：${jsonRel}；资源根：${join(base, 'resource')}${hasResource ? '' : '（目录不存在：图片 / 声音会缺，台词照常）'}`)
  for (const line of entry.notes) logs.push(line)
  return makeFound(scope, entry, loc, config)
}

// ---- Kamihime Player（TyranoScript）：<根>/game/dmm/raw_scenario/<类别>/<目录>/<id>_script.ks，资源在 game/dmm/assets；列表由 tyrano-ks 适配器的 catalog 每次现读
async function detectKamihime(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  const scriptsAbs = path.join(media, ...splitRel(join(base, 'dmm/raw_scenario')))
  if (!declared && !((await markersOk(media, entry, base, declared)) && (await countFiles(scriptsAbs, '.ks', 1, 6)) > 0)) return null   // 没声明：要求有 assets 和至少一个 .ks（免得认走别的 raw_scenario）
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  const hasAssets = await existsAt(media, base, 'dmm/assets', 'dir')
  logs.push(`Kamihime 数据根：${join(base, 'dmm') || '.'}；脚本根：${join(base, 'dmm/raw_scenario')}；assets 目录${hasAssets ? '有' : '没有（背景 / 立绘 / 语音都会缺资源）'}`)
  for (const line of entry.notes) logs.push(line)
  return makeFound(scope, entry, loc, config)
}

// ---- UViewer（txt 脚本）和通用布局
const UV_EXT = 'txt'

// UViewer 资源包：user_data/settings.json 里的 resource_path（默认 resources，见表里 bases）下有 download/adv/text；
// 多套了一层的（用户传的是外面的目录）由布局引擎搜索。user_data 在资源根的上一层（settings.json 里的 resource_path 是相对条目目录的，那时 user_data 就在条目目录）
async function detectUviewerGame(scope) {
  const { media, declared, game, logs } = scope
  let configured = ''
  try {
    const settings = JSON.parse(await readFile(path.join(media, 'user_data', 'settings.json'), 'utf8'))
    configured = cleanRel(settings?.resource_path)
  } catch { /* 没有 settings.json：用表里的默认 */ }
  const problems = []
  const entry = resolveLayout(scope.id, scope.layouts, problems)
  for (const line of problems) logs.push(line)
  if (!entry) { logs.push(`布局表里「${scope.id}」不可用：不能探测这个游戏`); return null }
  const withSettings = configured && !entry.bases.includes(configured) ? { ...entry, bases: [configured, ...entry.bases] } : entry
  const loc = await locateBase(media, withSettings)
  if (!loc) {
    if (declared) logs.push('没找到 download/adv/text')
    return null
  }
  const fromSettings = Boolean(configured) && loc.via === 'table' && loc.base === configured
  const prefix = fromSettings || !loc.base ? '' : loc.base.split('/').slice(0, -1).join('/')   // 资源根的上一层（user_data 通常在那里）
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, loc.base, { userBase: prefix })
  const found = {
    id: scope.id,
    kind: entry.kind || 'uviewer',
    note: loc.via === 'search' ? `目录里多了一层「${prefix || '.'}」` : '',
    config,
    via: loc.via,
    base: loc.base,
    adapters: entry.adapters,
    finish: uviewerFinish,
  }
  if (declared && game?.id) found.id = game.id   // deepone 等 UViewer 系游戏声明了自己的 id 就保留
  return found
}

function genericLayout() {
  return {
    id: '',
    kind: '通用',
    note: '没有认出已知布局：整个目录当脚本根',
    config: structuredClone(GENERIC_CONFIG),
    finish: uviewerFinish,
  }
}

async function uviewerFinish(media, config, options, logs) {
  const scriptRoot = (config.scriptRoots || [])[0]
  const rootAbs = scriptRoot ? path.join(media, ...splitRel(scriptRoot.dir)) : media
  const walked = await walkScripts(rootAbs, options.countCap)
  logs.push(`脚本根「${scriptRoot?.dir || '.'}」下有 ${walked.count} 个 .${UV_EXT} 文件${walked.capped ? '（达到上限）' : ''}`)
  if (!walked.count) logs.push('警告：脚本根下一个脚本都没有——目录结构可能不对，可以用 overrides 覆盖 scriptRoots')
  const cover = await pickCover(media, config, walked.files.slice(0, options.coverScanLimit))
  if (!cover) logs.push('（脚本里没有存在的背景图，也没有缩略图缓存）')
  return { count: walked.count, cover }
}

async function isDir(p) { try { return (await stat(p)).isDirectory() } catch { return false } }
async function isFile(p) { try { return (await stat(p)).isFile() } catch { return false } }
const splitRel = (rel) => String(rel || '').split('/').filter(Boolean)
const join = (...parts) => parts.filter(Boolean).join('/')
const sortName = (a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true })
function cleanRel(value) {
  const rel = String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
  if (!rel) return ''
  return rel.split('/').some((part) => !SAFE_SEGMENT.test(part) || part === '.' || part === '..') ? '' : rel
}

async function listNames(dirAbs) {
  try { return (await readdir(dirAbs)).filter((name) => !name.startsWith('.')).sort(sortName) } catch { return [] }
}

async function countFiles(rootAbs, ext, cap, maxDepth) {
  let count = 0
  async function walk(dir, depth) {
    if (depth > maxDepth || count >= cap) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || count >= cap) continue
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), depth + 1)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) count++
    }
  }
  await walk(rootAbs, 0)
  return count
}

// 目录下（递归，按名字排序）第一个匹配 re 的文件：返回 { dir（相对 rootAbs）, file, ext }
async function findFirstFile(rootAbs, re, cap) {
  let seen = 0
  async function walk(rel, depth) {
    if (depth > 6 || seen >= cap) return null
    let entries
    try { entries = (await readdir(path.join(rootAbs, ...splitRel(rel)), { withFileTypes: true })).sort(sortName2) } catch { return null }
    for (const entry of entries) {
      seen++
      if (entry.isFile()) {
        const m = re.exec(entry.name)
        if (m) return { dir: rel, file: entry.name, ext: m[2] }
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && SAFE_SEGMENT.test(entry.name)) {
        const hit = await walk(join(rel, entry.name), depth + 1)
        if (hit) return hit
      }
    }
    return null
  }
  return walk('', 0)
}
const sortName2 = (a, b) => sortName(a.name, b.name)

// 在 rootAbs 下（深度 ≤ 4）扫文件名，返回每个正则各自命中的目录（相对 rootAbs，根 = ''）。最多看 cap 个条目
async function findDirsWithFiles(rootAbs, regexes, cap) {
  const hits = regexes.map(() => new Set())
  let seen = 0
  async function walk(rel, depth) {
    if (depth > 4 || seen >= cap) return
    let entries
    try { entries = await readdir(path.join(rootAbs, ...splitRel(rel)), { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (++seen > cap) return
      if (entry.isFile()) regexes.forEach((re, i) => { if (re.test(entry.name)) hits[i].add(rel) })
      else if (entry.isDirectory() && !entry.name.startsWith('.') && SAFE_SEGMENT.test(entry.name)) await walk(join(rel, entry.name), depth + 1)
    }
  }
  await walk('', 0)
  return hits.map((set) => [...set].sort())
}

async function walkScripts(rootAbs, cap) {
  const files = []
  let count = 0
  async function walk(dir, depth) {
    if (depth > 12 || count >= cap) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }))
    for (const entry of entries) {
      if (entry.name.startsWith('.') || count >= cap) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, depth + 1)
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(`.${UV_EXT}`)) { count++; if (files.length < 400) files.push(full) }
    }
  }
  await walk(rootAbs, 0)
  return { count, files, capped: count >= cap }
}

// 封面：前几个脚本里，先看有没有 UViewer 自己生成的缩略图（user_data/thumbnails/<脚本名>.webp），再看脚本里第一张存在的背景图
async function pickCover(media, config, files) {
  const roots = config.resourceRoots?.length ? config.resourceRoots : ['']
  const prefixes = config.stripPrefixes || []
  const exists = async (rel) => {
    for (const root of roots) {
      const candidates = [rel, ...prefixes.filter((p) => rel.startsWith(p)).map((p) => rel.slice(p.length))]
      for (const candidate of candidates) if (await isFile(path.join(media, ...splitRel(root), ...splitRel(candidate)))) return true
    }
    return false
  }
  for (const file of files) {
    const stem = path.basename(file, path.extname(file))
    for (const dir of config.thumbsDirs || []) {
      for (const rel of [`${dir}/${stem}.webp`, `${dir}/scripts/${stem}.webp`]) if (await isFile(path.join(media, ...splitRel(rel)))) return `~/${rel}`
    }
    let text = ''
    try { text = (await readFile(file)).toString('utf8') } catch { continue }
    for (const match of text.matchAll(/^bg,([^,\r\n]+),/gm)) {
      const src = cleanRel(match[1].trim())
      if (!src || /^color_/i.test(src)) continue
      if (await exists(src)) return src
    }
  }
  return ''
}

function matchesPath(pattern, target) {
  const text = String(pattern || '')
  if (!text) return false
  const regexForm = /^\/(.+)\/([a-z]*)$/.exec(text)
  try {
    if (regexForm) return new RegExp(regexForm[1], regexForm[2].replace(/[^gimsuy]/g, '')).test(target)
    const escaped = text.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')
    return new RegExp(`^${escaped}$`).test(target)
  } catch { return false }
}

function normalizeOptions(raw = {}) {
  return {
    dryRun: raw.dryRun === true,
    replace: raw.replace === true,
    coverScanLimit: Math.max(1, Math.min(400, Math.floor(Number(raw.coverScanLimit) || 40))),
    countCap: Math.max(1, Math.floor(Number(raw.countCap) || 200000)),
    rawIgnore: (Array.isArray(raw.rawIgnore) ? raw.rawIgnore : []).map((p) => String(p ?? '').trim()).filter((p) => { if (!p) return false; try { new RegExp(p, 'i'); return true } catch { return false } }).slice(0, 50),
    overrides: (Array.isArray(raw.overrides) ? raw.overrides : []).filter((r) => r && typeof r === 'object' && typeof r.path === 'string'),
    layouts: isPlain(raw.layouts) ? raw.layouts : {},
  }
}

// 条目上现有的本脚本 tag（标签组 Gal配置 / Gal配置version / Gal游戏），名字列表
function ownTags(ctx) {
  return (Array.isArray(ctx.item?.tags) ? ctx.item.tags : [])
    .map((tag) => (typeof tag === 'string' ? tag : String(tag?.name ?? tag?.tag ?? '')).trim())
    .filter((tag) => TAG_GROUPS.includes(tag.slice(0, Math.max(0, tag.indexOf(':'))).trim()))
}

// dryRun / 目录不可读 / 跳过时：服务端会先删掉本脚本上次生成的 tag 再写这次返回的，所以把现有的本脚本 tag 原样回传，保证什么都不变
function keepOwn(ctx, logs, { skipped = false, changes } = {}) {
  if (skipped) logs.push('没有改动（未识别 / 已跳过）')
  const kept = isPlain(ctx.item?.config) ? Object.keys(ctx.item.config).filter((key) => key !== 'script') : []
  return {
    itemTags: ownTags(ctx),
    unitTags: [],
    unitPatches: [],
    logs,
    details: { changes: changes || { summary: '没有改动（未识别 / 已跳过）', added: [], changed: [], removed: [], unchanged: [], kept, skipped: true } },
  }
}
