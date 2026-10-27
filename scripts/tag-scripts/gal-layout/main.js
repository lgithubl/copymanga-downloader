// Gal 布局配置脚本（所有 Gal 游戏合一）：探测目录的实际结构，把条目 config 里的参数调到「真的能读到」，再挑封面、数脚本。
// 引擎和这个脚本之间只通过条目的 config 交互（字段见 web/library/gal/config.mjs）；引擎缺的字段用默认（标准结构 = UViewer 资源包的布局），
// 这里写「实际探测到的 / 表里的规则配置（适配器参数全表、classify / resourceResolve / limits …）/ 你覆盖的」字段。和别的 tag 脚本一样：改了就上传新版本（manifest.version 加一）重跑，不用改镜像。
//
// 架构原则：系统层和适配器都很简单——只读 config、按 config 匹配；每个游戏那些「脏」的知识（路径 / 正则 / 命名规则 / 猜的映射）全部在这个脚本的数据表里，由脚本写进条目 config。
//   哪里不对：改这个脚本（管理员跑的、可信）的表，上传新版本重跑；不用重建镜像。表里所有列表都是数组。
//
// 结构（从上到下）：
//   0. ADAPTER_RULES —— 每个适配器的完整参数表（抄自适配器的 DEFAULT_OPTIONS，字面量数据）+ RULE_DEVIATIONS（有意和适配器默认值不一致的键，现在为空）。漂移守卫：scripts/dev/gal-layout-rules-selftest.mjs。
//   1. LAYOUTS ——「游戏 id → 目录配置」的数据表（只有这一块是每个游戏固定的知识：目录在哪、脚本根 / 资源根是什么、适配器参数模板、分组 / 合并 / 缩略图规则…）。
//      发现某个游戏的目录配置不对：改这张表（或者在选项 layouts 里按 id 覆盖某几个字段），上传新版本、重跑；不用改探测代码，更不用重建镜像。
//      每个游戏除了目录配置，还写它的规则配置：ruleTables（写哪些适配器的全表）/ ruleOverrides（只对这个游戏改的子键）/ engine（classify / resourceResolve / indexSkip / limits / player）；每个游戏块的注释写明哪些是真实数据验证过的、哪些是猜的；pending = 等真实数据的占位（只是文档，不写进 config）。
//      表里所有「列表」都是数组（哪怕现在只有一个元素），以后加候选不用改格式；别名（aster / jaxin / maid / aku / fruits → girlscreation，deepone → uviewer）用 extends，不拷贝。
//   2. 布局引擎 —— 路径模式（* 通配 / 正则段）展开、按表里的候选位置直接 stat（命中就不搜索），都没命中才退回广度优先搜索；表项写坏了不会崩，记日志、退回内置的。
//   3. generateTags —— 分发（config.game.id）、覆盖、写 config，以及「这次运行的改动情况」（和条目现有 config 逐字段对比）。
//   4. 各游戏的探测函数 —— 只做依赖数据的事：数脚本、挑封面、从真实文件里认头像模板 / 菜单按钮图、生成分类节点、抽样判断。
//
// 分发：
//   config.game.id 已经填了（导入时写的）  → 只走那个游戏的探测（id 见 LAYOUTS）。认不出结构：uviewer / deepone 退回通用配置，别的跳过；不认识的 id 跳过
//   没填 game.id                          → 按 LAYOUTS 里的 autoOrder 顺序探测（legeclo → monmusu → angelic → girlscreation → tenkeiprdx → misttrain → minashigo → minashigo_r → artwhirl → kamihime → bokusen → grenze → tsk → otogi → uviewer），
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
//   layouts 与规则表的关系：layouts.<id> 里写的字段整个替换表里同名字段（ruleOverrides / engine / ruleTables 也一样）；只想改某个适配器的某个子键 → layouts.<id>.ruleOverrides = { '<适配器 id>': { 子键: … } }（深度合并在 ADAPTER_RULES 之上）。
//                   overrides[].config 是写完之后的顶层字段替换（写 adapterOptions 会替换整张，含规则表）。合并顺序：ADAPTER_RULES < ruleOverrides < 探测函数写的值（root / aliasFiles / imageDirs …永远赢）。
// 返回的日志里有「本次改动：…」一段：这次运行和条目现有 config 的逐字段对比（新增 / 修改 / 删除 / 未变 / 保留，数组列出增删的项；adapterOptions 按适配器 id 汇总：「+ adapterOptions['bokusen-json']（新增）：10 个键」/「~ …（修改）：2 个键变了：bgm、animation」，不倾倒整张表）；结构化版本在 details.changes。
// 状态 tag：Gal配置: aku / fruits / maid / jaxin / aster / deepone / grenze / tsk / otogi / kamihime / bokusen / uviewer / legeclo / monmusu / girlscreation / tenkeiprdx / misttrain / minashigo / 通用 / 自定义    Gal配置version: <脚本版本>    Gal游戏: <game.id>

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const ADAPTER_OPTIONS_BYTES = 16384   // 引擎 config.mjs 的 ADAPTER_OPTIONS_MAX.perAdapter
const TAG_GROUPS = ['Gal配置', 'Gal配置version', 'Gal游戏']
const SAFE_SEGMENT = /^[^/\\\0]+$/

// ======================================================================
// ADAPTER_RULES：每个适配器的「完整参数表」（规则表）。适配器只读 config.adapterOptions[<适配器 id>]、按配置匹配；
// 所有脏知识（路径模板 / 正则 / 命名规则 / 槽位号 / 猜的摆放）都是这里的数据，写进条目 config 后管理员改这里（或 layouts 选项）、上传新版本、重跑就生效——不用重建镜像。
//   · 内容 = 创作时从各适配器的 DEFAULT_OPTIONS 原样抄来的（main.js 只加载自己、不能 import 适配器）。适配器按子键在自己的默认值上合并，所以写满整张表和不写行为完全一致；
//     想改某一项：改下面这张表（所有用这个适配器的游戏都变），或者只改某个游戏：在它的 LAYOUTS 项里写 ruleOverrides（深度合并在这张表之上，见下）。
//   · 和适配器默认值是否一致由 scripts/dev/gal-layout-rules-selftest.mjs 守着（漂移守卫）：适配器改了默认值而这里没跟上，测试会红；有意不一致的写进 RULE_DEVIATIONS（路径列表）。
//   · 合并顺序（后者覆盖前者，对象逐键递归、数组整个替换）：ADAPTER_RULES[适配器] < 游戏的 ruleOverrides[适配器] < 探测函数写的值（root / aliasFiles / imageDirs …，真实目录里认出来的永远赢）。
//   · 每个适配器的表 ≤ 16 KB（引擎的上限，超了整张被丢掉），合计 ≤ 64 KB；测试里有断言。字段含义见各适配器文件头部 / web/library/gal/README.md 的适配器选项章节。
//   · 只能写数据：数组 / 对象 / 字符串（正则写成源码字符串）/ 数字 / 布尔 / null。
// ======================================================================
export const ADAPTER_RULES = {
  'renpy-legeclo': {
    aliasFiles: ['script/movie.rpy'],
    imageDirs: ['images'],
    composite: { enabled: true },
    aliasPatterns: [
      {
        kind: 'movie',
        re: '^image\\s+(?<name>.+?)\\s*=\\s*Movie\\s*\\([^)]*\\bplay\\s*=\\s*"(?<path>[^"]+)"[^)]*\\)',
      },
      {
        kind: 'movie',
        re: '^image\\s+(?<name>.+?)\\s*=\\s*Movie\\s*\\([^)]*\\bplay\\s*=\\s*\'(?<path>[^\']+)\'[^)]*\\)',
      },
      { kind: 'image', re: '^image\\s+(?<name>.+?)\\s*=\\s*"(?<path>[^"]+)"\\s*$' },
      { kind: 'image', re: '^image\\s+(?<name>.+?)\\s*=\\s*\'(?<path>[^\']+)\'\\s*$' },
    ],
    movieNoLoopRe: '\\bloop\\s*=\\s*False\\b',
    imageIndex: { preferDirs: [], ext: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'], extPriority: false },
    audioCommands: { music: ['music'], voice: ['voice'], se: ['sound', 'audio'], other: 'raw' },
    voiceNoQuote: { variables: {} },
    speakers: {},
    speakerVars: [],
    flow: { menu: 'raw', conditionals: 'linear' },
    transitions: { named: '^(?:dissolve|fade|pixellate|move)', seconds: 0.5 },
    blackRes: ['^black$', '(?:^|_)black\\d*$'],
    sniff: {
      labelRe: '^\\s*label\\s+H_\\w+\\s*:',
      markerRes: ['^\\s*(?:\\$\\s*enable_skip\\s*\\(|play\\s+voice\\s+")'],
    },
    align: { left: 'left', right: 'right', center: 'center', truecenter: 'center' },
    bareVoice: ['voice'],
  },
  'renpy-monmusu': {
    aliasFiles: ['script/movie.rpy'],
    imageDirs: ['images'],
    composite: { enabled: true },
    aliasPatterns: [
      {
        kind: 'movie',
        re: '^image\\s+(?<name>.+?)\\s*=\\s*Movie\\s*\\([^)]*\\bplay\\s*=\\s*"(?<path>[^"]+)"[^)]*\\)',
      },
      {
        kind: 'movie',
        re: '^image\\s+(?<name>.+?)\\s*=\\s*Movie\\s*\\([^)]*\\bplay\\s*=\\s*\'(?<path>[^\']+)\'[^)]*\\)',
      },
      { kind: 'image', re: '^image\\s+(?<name>.+?)\\s*=\\s*"(?<path>[^"]+)"\\s*$' },
      { kind: 'image', re: '^image\\s+(?<name>.+?)\\s*=\\s*\'(?<path>[^\']+)\'\\s*$' },
    ],
    movieNoLoopRe: '\\bloop\\s*=\\s*False\\b',
    imageIndex: { preferDirs: [], ext: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'], extPriority: false },
    audioCommands: { music: ['music'], voice: ['voice'], se: ['sound', 'audio'], other: 'raw' },
    voiceNoQuote: { variables: {} },
    speakers: {},
    speakerVars: [],
    flow: { menu: 'raw', conditionals: 'linear' },
    transitions: { named: '^(?:dissolve|fade|pixellate|move)', seconds: 0.5 },
    blackRes: ['^black$'],
    sniff: {
      labelRe: '^\\s*label\\s+[A-Za-z_]\\w*\\s*:',
      markerRes: ['^\\s*(?:voice\\s+"|scene\\s+\\S|play\\s+(?:music|sound)\\s+")'],
    },
  },
  'renpy-minashigo': {
    aliasFiles: ['game/movie.rpy'],
    standFiles: ['game/script.rpy'],
    imageDirs: ['game/images'],
    aliasPatterns: [
      {
        kind: 'movie',
        re: '^image\\s+(?<name>.+?)\\s*=\\s*Movie\\s*\\([^)]*\\bplay\\s*=\\s*"(?<path>[^"]+)"[^)]*\\)',
      },
      {
        kind: 'movie',
        re: '^image\\s+(?<name>.+?)\\s*=\\s*Movie\\s*\\([^)]*\\bplay\\s*=\\s*\'(?<path>[^\']+)\'[^)]*\\)',
      },
      { kind: 'image', re: '^image\\s+(?<name>.+?)\\s*=\\s*"(?<path>[^"]+)"\\s*$' },
      { kind: 'image', re: '^image\\s+(?<name>.+?)\\s*=\\s*\'(?<path>[^\']+)\'\\s*$' },
    ],
    movieNoLoopRe: '\\bloop\\s*=\\s*False\\b',
    imageIndex: { preferDirs: [], ext: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif'], extPriority: false },
    standTags: ['standimage'],
    cropForms: [
      'im\\.Crop\\(\\s*["\'](?<path>[^"\']+)["\']\\s*,\\s*\\(\\s*(?<x>-?\\d+)\\s*,\\s*(?<y>-?\\d+)\\s*,\\s*(?<w>\\d+)\\s*,\\s*(?<h>\\d+)\\s*\\)\\s*\\)',
    ],
    nameVar: 'name',
    speakers: {},
    speakerVars: ['^[A-Za-z_]\\w*$'],
    audioCommands: { music: ['music'], voice: ['voice*'], se: [], other: 'se' },
    voiceNoQuote: { variables: {} },
    fadeTags: ['black'],
    flash: { counts: { flash: 1, flash2: 2, flash3: 3, flash4: 4 }, seconds: 0.3, color: 'white' },
    flow: { menu: 'raw', conditionals: 'linear' },
    transitions: { named: '^(?:dissolve|fade|pixellate|move)', seconds: 0.5 },
    blackRes: ['^black\\d*$'],
    sniff: { labelRe: '^\\s*label\\s+[A-Za-z_]\\w*\\s*:', markerRes: ['^\\s*(?:\\$\\s*name\\s*=|xyz\\s+["\'])'] },
  },
  'uviewer-csv': {
    commands: {
      aliases: {},
      known: [
        'bg',
        'bgoff',
        'name',
        'msg',
        'playvoice',
        'playse',
        'playbgm',
        'stopbgm',
        'fadeinblack',
        'fadeoutblack',
        'wait',
        'movie',
        'movieoff',
        'clickwait',
        'endwait',
        'select',
        'if',
        'elseif',
        'else',
        'endif',
      ],
      rawHints: [
        'spriteatlas',
        'sprite',
        'spriteoff',
        'flash',
        'endwmsg',
        'anm',
        'mask',
        'imgconf',
        'spine',
        'spineoff',
      ],
    },
    msg: { textArgIndex: 1, singleArgText: false },
    playvoice: { pathArgIndex: 1 },
    bg: { colorPrefix: 'color_' },
    select: { var: 'select', prefixRe: '^(?:選項|选项|選擇|选择|Option)\\s*\\d+[\\s\\u3000:：.、-]*' },
    conditions: { vars: {} },
    sniff: { minKnownRatio: 0.6, minLines: 3, maxLines: 40 },
    sprites: {
      enabled: false,
      stage: { width: 1280, height: 720 },
      yUp: true,
      numbers: { x: 0, y: 1, scale: 2, fade: 3 },
      atlas: { plistExt: '.plist', textureExt: '.png', frameKeys: ['{n}.png', '{name}:{n}.png', '{n}'], baseKeys: [] },
      fit: 'none',
      maskColor: '#000000',
      offAll: ['stand'],
      commands: {
        spriteatlas: 'stand',
        spriteoff: 'off',
        sprite: 'overlay',
        mask: 'rect',
        imgconf: 'layout',
        anm: 'raw',
        shake: 'shake',
        flash: 'flash',
        endwmsg: 'ignore',
      },
      slotRules: [],
    },
  },
  'girlscreation-tag': {
    root: '',
    categoryLabels: {},
    player: { names: ['館長'] },
    dialect: {
      window: 200000,
      headWindow: 8192,
      markers: {
        aku: ['<GROUP>', '<EV_DISPLAY>', '<SPINE_ACTOR_DISPLAY>'],
        display: ['<SPINE_ACTOR_DISPLAY>'],
        branch: ['<LABEL>'],
      },
    },
    stand: { akuOffset: 450, akuDirections: { LEFT: -1, RIGHT: 1, CENTER: 0 }, fruitsDim: 0.6 },
    animation: { maxFrames: 600 },
    line: {
      expressionPrefix: 'ex_',
      imageIdRe: '^[a-z]{2,4}\\d+$',
      objectKind: '^character$',
      jumpAction: 1,
      moveBase: 'offset',
      crossfadeScale: 'bgScale',
    },
    commands: { cgmode: 'actors', asyncjump: 'hop', asyncmoveobject: 'move', crossfade: 'bg' },
    category: { re: '^[A-Za-z]+', other: '其他', unknownSpeaker: '（未识别）' },
    titleLines: ['^title,([^,\\r\\n]+),'],
    speaker: { suffixRe: '（[^）]*）$' },
    dirs: { scenes: 'scenes', audio: 'data/audio', spine: 'data/spine' },
    sceneDirs: {
      images: 'images',
      videos: 'videos',
      voices: 'voices',
      bgvoices: 'bgvoices',
      animations: 'animations',
      spines: 'spines',
    },
    audioKinds: ['bgm', 'se'],
    scenes: {
      script: ['script.txt', 'output_script.txt'],
      lineScript: '^h[ms]r_[^/]+\\.txt$',
      thumb: '^thumbnail\\.(?:png|jpe?g|webp)$',
    },
    sample: {
      files: [
        '/(?:script\\.txt|output_script\\.txt|script_original\\.txt|original_script\\.txt|originial_script\\.txt|h[ms]r_\\d+\\.txt)$',
      ],
    },
  },
  'girlscreation-line': {
    root: '',
    categoryLabels: {},
    player: { names: ['館長'] },
    dialect: {
      window: 200000,
      headWindow: 8192,
      markers: {
        aku: ['<GROUP>', '<EV_DISPLAY>', '<SPINE_ACTOR_DISPLAY>'],
        display: ['<SPINE_ACTOR_DISPLAY>'],
        branch: ['<LABEL>'],
      },
    },
    stand: { akuOffset: 450, akuDirections: { LEFT: -1, RIGHT: 1, CENTER: 0 }, fruitsDim: 0.6 },
    animation: { maxFrames: 600 },
    line: {
      expressionPrefix: 'ex_',
      imageIdRe: '^[a-z]{2,4}\\d+$',
      objectKind: '^character$',
      jumpAction: 1,
      moveBase: 'offset',
      crossfadeScale: 'bgScale',
    },
    commands: { cgmode: 'actors', asyncjump: 'hop', asyncmoveobject: 'move', crossfade: 'bg' },
    category: { re: '^[A-Za-z]+', other: '其他', unknownSpeaker: '（未识别）' },
    titleLines: ['^title,([^,\\r\\n]+),'],
    speaker: { suffixRe: '（[^）]*）$' },
    dirs: { scenes: 'scenes', audio: 'data/audio', spine: 'data/spine' },
    sceneDirs: {
      images: 'images',
      videos: 'videos',
      voices: 'voices',
      bgvoices: 'bgvoices',
      animations: 'animations',
      spines: 'spines',
    },
    audioKinds: ['bgm', 'se'],
    scenes: {
      script: ['script.txt', 'output_script.txt'],
      lineScript: '^h[ms]r_[^/]+\\.txt$',
      thumb: '^thumbnail\\.(?:png|jpe?g|webp)$',
    },
    sample: {
      files: [
        '/(?:script\\.txt|output_script\\.txt|script_original\\.txt|original_script\\.txt|originial_script\\.txt|h[ms]r_\\d+\\.txt)$',
      ],
    },
  },
  'tenkeiprdx-json': {
    root: '',
    unknownName: '플레이어',
    stillPng: 'spine',
    userPlaceholder: '%username%',
    positions: { '0': 0.5, '1': 0.3, '2': 0.7 },
    positionX: {},
    defaultX: 0.5,
    facial: ['idle_normal', 'idle_joy', 'idle_sad', 'idle_angry', 'idle_surprise', 'idle_shy', 'idle_unique'],
    fieldMap: {
      scene: { id: 0, frames: 4 },
      frame: {
        backgroundImage: 3,
        speakerName: 10,
        phraseContents: 12,
        backgroundMusic: 27,
        phraseVoice: 29,
        adventureCharacters: 31,
        soundEffect: null,
        still: null,
        stillAnimation: null,
      },
      character: {
        characterMasterId: 0,
        characterAppearance: 1,
        characterPosition: 2,
        characterAction: 3,
        characterEmotionIcon: 4,
        characterFacialExpression: 5,
      },
      skip: [0, 30],
      master: {
        row: 1,
        char: { id: 0, name: 3, title: 4, minLength: 4 },
        scene: { title: 2, jsonIds: 9, stills: 10, minLength: 11 },
      },
    },
    dirs: {
      masterdata: 'Masterdata',
      spines: 'Spines',
      stills: 'Stills',
      backgrounds: 'Backgrounds',
      bgm: 'BGM',
      scenes: 'scenes',
      icons: 'CharacterIcons',
      thumbs: 'EpisodeThumbnails',
    },
    files: { username: 'username.txt', characters: 'masterdata_4.json', scenarios: 'masterdata_32.json' },
    paths: {
      background: [
        'Backgrounds/adventure/{name}.png',
        'Backgrounds/still/{name}.png',
        'Backgrounds/eventstill/{name}.png',
      ],
      backgroundMissing: [
        { match: '_still_', path: 'Backgrounds/still/{name}.png' },
        { path: 'Backgrounds/adventure/{name}.png' },
      ],
      thumbStill: 'Backgrounds/still/{name}.png',
      bgm: ['BGM/{name}.ogg', 'BGM/{name}_loop.ogg'],
      se: ['Se/{name}.ogg'],
      voice: ['AdventureVoice/{scene}/{name}.ogg'],
    },
    still: {
      backgroundRe: '^(.+)_still_0*(\\d+)$',
      animationRe: '^animation\\d+$',
      animationName: 'animation{n}',
      defaultAnimation: 'animation1',
    },
    hse: {
      stillRe: 'still_0([2-5])',
      effects: {
        '2': [{ op: 'bgse', src: 'BgSe/Hse5.ogg', loop: false }],
        '3': [{ op: 'bgse', src: 'BgSe/Hse2.ogg', loop: true }],
        '4': [
          { op: 'flash', color: 'white', count: 2, seconds: 0.3 },
          { op: 'bgse', src: 'BgSe/Hse4.ogg', loop: false },
        ],
        '5': [{ op: 'wash', color: 'white', seconds: 2 }],
      },
    },
    animations: {
      noLoop: ['animation4'],
      slow: ['animation4'],
      speed: { animation3: 1.5 },
      linked: {
        animation2: { bgse: 'BgSe/Hse2.ogg', loop: true },
        animation3: { bgse: 'BgSe/Hse3.ogg', loop: true },
        animation4: { bgse: 'BgSe/Hse4.ogg', loop: false, flash: true },
      },
      flash: { color: 'white', count: 2, seconds: 0.3 },
      wash: { animation5: { color: 'white', seconds: 1.5 } },
    },
    animationSpeed: { msThreshold: 100, msDivisor: 1000 },
    camera: { durationMs: 2500, maxSeconds: 60 },
    stand: { preferred: '{id}_{appearance}', appearancePad: 2 },
    bgm: { stopRe: '^noBGM(?:\\{([^}]*)\\})?$', fadeRe: 'Fade_([\\d.]+)' },
    kinds: [
      { id: 'event', label: '活动', dir: 'event' },
      { id: 'extra', label: '附加', dir: 'extra' },
      { id: 'special', label: '特别', dir: 'special' },
    ],
    idRules: [
      { kind: 'event', split: '_', segments: [2, 3], prefix: '2', minParts: 4, lastDigit: {}, forms: [''] },
      {
        kind: 'extra',
        split: '_',
        segments: [2, 3],
        prefix: '2',
        minParts: 4,
        lastDigit: { '1': '2' },
        forms: [''],
      },
      {
        kind: 'special',
        split: '_',
        segments: [2, 3],
        prefix: '2',
        minParts: 4,
        lastDigit: {},
        forms: ['', '2', '1'],
      },
    ],
    catalog: {
      thumbPrefix: 'ep_eventstill_',
      thumbStillSuffix: '_still_01',
      charCodeRe: '^\\d{8}',
      charStills: ['{id}_01_still', '{id}_02_still'],
      labels: { chars: '角色', all: '全部剧情', unknownChar: '???' },
    },
  },
  'misttrain-json': {
    root: '',
    showMosaic: false,
    dirs: { spines: 'Spines', backgrounds: 'BackGrounds', sounds: 'Sounds', masterData: 'MasterData' },
    master: {
      scenes: 'MSceneViewModel.json',
      characters: 'MCharacterBaseViewModel.json',
      idKey: 'Id',
      titleKey: 'Title',
      nameKey: 'Name',
    },
    scenes: { dirs: ['UScenes'], stillsDir: 'Stills', collision: 'last' },
    fieldMap: {
      row: {
        speaker: 2,
        text: 3,
        frameImage: 9,
        voice: 10,
        background: 11,
        bgm: 12,
        se: 13,
        soundTag: 14,
        effect: 15,
        backgroundEffectType: 16,
        stand: 17,
        detail: 18,
      },
      detail: { animation: 0, speed: 1, zoom: 2, x: 3, y: 4, seconds: 5, rotation: 6 },
    },
    paths: {
      bgm: 'Sounds/Bgms/Adv/{name}.ogg',
      se: 'Sounds/Se/{name}.ogg',
      bgse: 'Sounds/BgSe/{name}.ogg',
      background: 'BackGrounds/{name}.png',
      voiceFallback: 'Sounds/Voices/Scenarios/Stills/{name}.ogg',
    },
    backgrounds: { ext: ['png', 'jpg'] },
    voice: { dir: 'Sounds/Voices', ext: ['ogg'], preferDirs: [], duplicates: 'first' },
    titleLookup: { trim: 2, tryAsIs: true, tryMinusOne: true },
    still: { defaultAnimation: 'animation1', configFile: 'still_configuration.json' },
    camera: { positionScale: 0.84, zoomAdd: 0.03, zoomEpsilon: 0.0001, zoomUnit: 1.3, maxSeconds: 60 },
    effects: {
      fadeSeconds: 1,
      flashSeconds: 0.3,
      flashCount: 2,
      map: { '1': 'wash', '3': 'flash' },
      oneShotRule: {
        '4': ['animation3'],
        '5': ['animation3'],
        '7': ['animation3', 'animation6'],
        '8': ['animation3', 'animation7'],
      },
      linkedBgSe: {
        '4': { animation3: ['Hse4', 'Hse4'], animation2: ['Hse2', 'Hse3'] },
        '5': { animation5: ['Hse1', 'Hse1'], animation3: ['Hse4', 'Hse4'], animation2: ['Hse2', 'Hse3'] },
        '7': {
          animation3: ['Hse4', 'Hse4'],
          animation6: ['Hse4', 'Hse4'],
          animation2: ['Hse2', 'Hse3'],
          animation5: ['Hse2', 'Hse3'],
        },
        '8': {
          animation3: ['Hse4', 'Hse4'],
          animation7: ['Hse4', 'Hse4'],
          animation2: ['Hse2', 'Hse3'],
          animation6: ['Hse2', 'Hse3'],
        },
      },
      fastSpeed: 2,
      loopExcept: ['Hse4'],
    },
    emoji: { heart01: '♥', heart02: '♥', heart03: '♥', heart04: '♥', smile: '☺', star: '★' },
  },
  'utage-book': {
    root: '',
    screenWidth: 1280,
    standX: { slotBase: 0.5, argIndex: 4 },
    slots: { Chara1: 'Chara1', Chara2: 'Chara2', Chara3: 'Chara3' },
    slotPrefix: 'Chara',
    off: { mode: 'speakerOnly', arg: '^<Off>$' },
    speaker: { source: ['NameText', 'key'], splitOn: '-', pick: 'beforeLast', characterArg: '^<Character=(.*)>$' },
    bgm: { play: 'loop' },
    tween: {
      kinds: {
        MoveBy: { returns: 'action', else: 'moveBy' },
        MoveTo: 'moveTo',
        PunchPosition: 'action',
        ShakePosition: 'action',
        ColorTo: 'raw',
        ScaleTo: 'raw',
        RotateTo: 'raw',
      },
      actions: { x: 2, up: 1, down: 3 },
      returnWhen: 'pingpong',
      targetSlots: true,
    },
    nameOnlyRow: 'show',
    selection: { groupSuffix: '-\\d+$', adjacentGroups: true, singleAsText: true },
    catalog: {
      groups: [
        {
          folder: '^CharaScenario$',
          idRe: '^CharaScenario(\\d{4})\\d{3}$',
          nameFrom: 'masterCharacter',
          charFile: '(?:^|/)ch_{id}',
          fallback: '特别 / 其他',
        },
      ],
    },
    folderLabels: [
      ['^MainScenario$', '主线'],
      ['^CharaScenario$', '角色剧情'],
      ['^StoryEventScenario$', '活动剧情'],
      ['^BossrushEventScenario$', 'Bossrush 活动'],
      ['^HomeEventScenario$', '家园事件'],
      ['^ItemEventScenario$', '道具事件'],
      ['^SpEventScenario$', '特别活动'],
      ['^SubjugationEventScenario$', '讨伐活动'],
    ],
    index: {
      dirs: ['Adventure', 'Characters', 'Stills', 'Sound'],
      master: 'Adventure/Master.chapter.json',
      ext: '\\.(?:skel\\.bytes|png|jpe?g|ogg)$',
      books: ['^Adventure/(?:(?<category>[^/]+)/)?(?:.*/)?(?<stem>[^/]+)\\.book\\.json$'],
    },
    paths: {
      characters: [{ skel: '{dir}/{base}.skel.bytes', atlas: '{dir}/{base}.atlas.txt' }],
      stills: [{ skel: 'Stills/{id}/*.skel.bytes', atlas: 'Stills/{id}/{base}.atlas.txt' }],
      bg: ['{file:png}', 'Adventure/BackGrounds/{name}.png', 'Adventure/BackGrounds/{name}.jpg'],
      voice: ['Sound/Voice/**/{name}.ogg', 'Sound/BgVoice/**/{name}.ogg'],
      bgvoice: ['Sound/BgVoice/**/{name}.ogg', 'Sound/Voice/**/{name}.ogg'],
      se: ['{file:ogg}', 'Sound/Se/{name}.ogg', 'Sound/BgSe/{name}.ogg'],
      bgse: ['{file:ogg}', 'Sound/BgSe/{name}.ogg', 'Sound/Se/{name}.ogg'],
      bgm: ['{file:ogg}'],
      bgmIntro: ['{intro:ogg}'],
      bgmFallback: ['Sound/Bgm/{name}.ogg'],
      skeletonSuffixStrip: ['.asset', '_SkeletonData'],
      charIdStrip: '^ch_',
    },
  },
  'artwhirl-json': {
    root: 'game',
    dirs: ['images', 'audio'],
    standZoom: 1,
    dic: { indexFields: ['bgs', 'bgms', 'charas', 'names', 'colors', 'voices'] },
    assets: [
      { match: '^(?:bg|effect)/', replace: 'images/$&' },
      { match: '^chara/([^/]+)/([^/]+)/*$', replace: 'images/bg/$1_$2' },
      { match: '^chara/(.*)$', replace: 'images/hcg/$1' },
      { match: '^bgm/', replace: 'audio/$&' },
    ],
    extPrefer: { '.mp3': ['.ogg'] },
    others: {
      action: {
        bow: [{ op: 'shake', axis: 'vertical', strength: 0.08, seconds: 0.5 }],
        jump: [{ op: 'shake', axis: 'vertical', strength: 0.12, seconds: 0.4 }],
        swing: [{ op: 'shake', axis: 'horizontal', strength: 0.1, seconds: 0.4 }],
        vibe: [{ op: 'shake', axis: 'horizontal', strength: 0.15, seconds: 0.5 }],
        avoid: [{ op: 'shake', axis: 'horizontal', strength: 0.1, seconds: 0.3 }],
        slideinR: 'raw', slideinL: 'raw', slideinD: 'raw', attackR: 'raw', attackL: 'raw', attackD: 'raw',
        default: 'raw',
      },
      emotion: { shock: 'drop', sweat: 'drop', question: 'drop', donyori: 'drop', exclamation: 'drop', anger: 'drop', paa: 'drop', kirakira: 'drop', default: 'drop' },
    },
    bgChange: { f: { fade: 0.5 }, c: { fade: 0 }, s: { fade: 0.5 }, default: { fade: 0 } },
    audioExtFallback: ['.ogg', '.mp3', '.wav', '.m4a', '.opus', '.flac'],
    stand: {
      clearOnBgChange: true,
      path: 'images/stands/{key}/{body}/{key}_{body}_{brow}_{eye}_{lip}{h}.png',
      fields: {
        key: ['key', 'chara_id'],
        body: ['body', 'body_file'],
        brow: ['brow'],
        eye: ['eye'],
        lip: ['lip'],
        pos: ['pos'],
        h: ['h'],
      },
      defaults: { brow: 'b', eye: 'e', lip: 'r' },
      hSuffix: '_h',
      fallback: [
        ['h->'],
        ['brow->b'],
        ['brow->b', 'h->'],
        ['eye->e'],
        ['eye->e', 'h->'],
        ['brow->b', 'eye->e'],
        ['brow->b', 'eye->e', 'h->'],
      ],
    },
    hcg: { match: '^chara/[^/]+/[^/]+/[^/]+$', imageExts: ['.png', '.jpg', '.webp'] },
    video: { ext: ['webm'], noLoopFrames: ['1', '4'], frameSplit: '@' },
    voice: { dir: 'audio/voice', preferDirs: [], ext: { '.mp3': '.ogg' }, fallback: 'audio/voice/{stem}/{name}', nameFields: ['file', 'name', 'voice'], extFallback: [] },
  },
  'tyrano-ks': {
    root: 'game/dmm',
    resourceDirKey: { from: 'json', field: 'resource_directory', segments: 3 },
    voice: { dirs: ['{rd}'], patterns: [], loopAsBgse: true },
    stand: { slots: { '1': [0.5], '2': [0.25, 0.75], '3+': [0.2, 0.5, 0.8] }, useScriptCoords: false },
    layers: { overlay: ['4'], effect: ['3'], stand: ['3'] },
    effects: {
      quakeMap: { hmax: 'horizontal', vmax: 'vertical' },
      shakeDivisor: 40,
      animHop: { top: 'vertical', left: 'horizontal' },
      sepia: { matchImage: 'sepia' },
      animSlide: 'ignore',
    },
    fallback: { faceToBase: true },
    index: { hashPattern: '^(.+)-[0-9a-f]{40}(\\.[^.]+)?$', stemFallback: true },
    memorial: { enabled: true, imageFade: 0.5, imageStep: true, protagonist: '', placeholder: '{{主人公}}' },
    text: { lineBreakTags: ['r'], clickWaitTags: ['l'], pageTags: ['p'], clearTags: ['cm'] },
    film: { enabled: true, frameRatio: 1.40625, rotate: 90, autoFrames: 16, transitions: { whiteout2s: { op: 'wash', color: 'white', seconds: 2 } } },
  },
  'bokusen-json': {
    root: '',
    resourceDir: 'resource',
    paths: { images: ['{stem}/images/{i}{ext}'], sounds: ['{stem}/sounds/{i}{ext}'], anyExt: true },
    resourceId: { enabled: true, minDigits: 4, maxDigits: 6 },
    image: { ext: ['{entry}'], defaultExt: '.jpg' },
    sound: { ext: ['.wav', '{entry}'], defaultExt: '' },
    slotMap: {
      articles: { index: 0 },
      image: { layer: 15, page: 23, index: 28, x: 16, y: 29 },
      trans: { layer: 2, mode: 3, ms: 6 },
      move: { layer: 2, target: 4 },
      animstart: { id: 0, layer: 2, x: 3, page: 8, frames: 9 },
      animstop: { id: 0 },
      playse: { buffer: 0, loop: 1, index: 2 },
      stopse: { buffer: 0 },
      fadese: { buffer: 0, volume: 2 },
      playbgm: { index: null },
      fadeoutbgm: { ms: 0 },
      wait: { ms: 2 },
    },
    bgm: { patterns: ['/bgm/'], index: 0 },
    voice: { patterns: ['/voice/'], loopAsBgse: true },
    stand: {
      layers: [],
      overlayLayers: [],
      bgLayers: ['base'],
      xScale: 1,
      yScale: 1,
      origin: { x: 0, y: 0 },
      moveMode: 'jump',
    },
    animation: { singleFrameAsStatic: true, multiFrameLayers: ['base'] },
  },
  'grenze-xml': {
    root: '',
    textDir: '',
    resourceDir: '',
    resourceDirs: ['bg', 'bgm', 'sound', 'voice', 'merc/pic'],
    index: { ext: '\\.(?:webp|png|jpe?g|m4a|mp3|ogg|wav)$' },
    exts: {
      bg: ['webp', 'png', 'jpg', 'jpeg'],
      bgm: ['m4a', 'mp3', 'ogg', 'wav'],
      sound: ['m4a', 'mp3', 'ogg', 'wav'],
      voice: ['m4a', 'mp3', 'ogg', 'wav'],
      backVoice: ['m4a', 'mp3', 'ogg', 'wav'],
    },
    paths: {
      bg: ['bg/battlebg/{name}/{name}.{ext}', 'bg/**/{name}.{ext}'],
      bgm: ['bgm/{lower}/{name}.{ext}', 'bgm/**/{name}.{ext}'],
      sound: ['sound/{name}/{name}.{ext}', 'sound/**/{name}.{ext}'],
      voice: ['voice/{pack}/{voice}.{ext}', 'voice/**/{voice}.{ext}'],
      backVoice: ['voice/{pack}/{voice}.{ext}', 'voice/**/{voice}.{ext}'],
      stand: ['merc/pic/{hero}/{file}'],
    },
    duplicates: { bg: 'first', bgm: 'first', sound: 'first', voice: 'skip', backVoice: 'skip', stand: 'first' },
    standFiles: ['body.webp', 'body.png'],
    standPos: { '1': 'left', '2': 'center', '3': 'right', default: 'center' },
    standKeep: 'untilNewHero',
    standFit: 1,
    none: ['non'],
    bgBlack: ['bg_b'],
    bgSound: { mode: 'se', attrs: ['bg_sound1', 'bg_sound2', 'bg_sound3'] },
    soundAttrs: ['sound1', 'sound2', 'sound3'],
    rawAttrs: ['screen_effect', 'pic_action', 'pic_action_val', 'pic_size', 'effect+effect_pos'],
    attrTables: { screen_effect: 'screenEffects', pic_action: 'picActions', effect: 'effects', pic_size: 'picSize' },
    screenEffects: {
      // 名字（<DEFINE> 表里的写法）和数字 id 是同一回事：gal-samples16 的 easy_dialog-2 / 12 / 13 / 14 里 screen_effect 的 DEFINE = 溶暗_白幕 1 / 溶明_白幕 2 / 溶暗_黒幕 3 / 溶明_黒幕 4 /
      //   フラッシュ 5 / フラッシュ2回 6 / 画面シェイク 7 / 速い画面揺れ 8 / 光エフェクト 9 / 回想ON 10 / 回想OFF 11 / …ON 12 / …OFF 13（有的文件直接写数字，没有 DEFINE）。作者的查看器 app.js 对数字的处理一致（1~4 盖白 / 黑再淡出、7 抖、8 快抖、10~13 滤镜）
      '溶暗_白幕': { op: 'fade', to: 'white', seconds: 1, at: 'start' },
      '溶明_白幕': { op: 'wash', color: 'white', seconds: 1 },
      '溶暗_黒幕': { op: 'fade', to: 'black', seconds: 1, at: 'start' },
      '溶明_黒幕': { op: 'fade', to: 'clear', seconds: 1 },
      'フラッシュ': { op: 'flash', color: 'white', count: 1, seconds: 0.3 },
      'フラッシュ2回': { op: 'flash', color: 'white', count: 2, seconds: 0.3 },
      '画面シェイク': { op: 'shake', axis: 'overall', strength: 0.25, seconds: 0.6 },
      '速い画面揺れ': { op: 'shake', axis: 'overall', strength: 0.15, seconds: 0.4 },
      '光エフェクト': { op: 'wash', color: 'white', seconds: 1 },
      '回想ON': { op: 'overlay', slot: 'screenfx', rect: [0, 0, 1280, 720], color: [112, 76, 40], alpha: 0.22 },
      '回想OFF': { op: 'overlayOff', slot: 'screenfx' },
      // 回想（棕褐色滤镜）/ 灰度（12 / 13）没有对应的滤镜指令，用整屏半透明色罩近似（猜的）
      '1': { op: 'fade', to: 'white', seconds: 1, at: 'start' },
      '2': { op: 'wash', color: 'white', seconds: 1 },
      '3': { op: 'fade', to: 'black', seconds: 1, at: 'start' },
      '4': { op: 'fade', to: 'clear', seconds: 1 },
      '5': { op: 'flash', color: 'white', count: 1, seconds: 0.3 },
      '6': { op: 'flash', color: 'white', count: 2, seconds: 0.3 },
      '7': { op: 'shake', axis: 'overall', strength: 0.25, seconds: 0.6 },
      '8': { op: 'shake', axis: 'overall', strength: 0.15, seconds: 0.4 },
      '9': { op: 'wash', color: 'white', seconds: 1 },
      '10': { op: 'overlay', slot: 'screenfx', rect: [0, 0, 1280, 720], color: [112, 76, 40], alpha: 0.22 },
      '11': { op: 'overlayOff', slot: 'screenfx' },
      '12': { op: 'overlay', slot: 'screenfx', rect: [0, 0, 1280, 720], color: [128, 128, 128], alpha: 0.45 },
      '13': { op: 'overlayOff', slot: 'screenfx' },
    },
    picActions: {
      '立ち絵全消え': { op: 'standOff', at: 'stand', suppressStand: true },
      '溶明溶暗': [{ op: 'fade', to: 'black', seconds: 0.4 }, { op: 'fade', to: 'clear', seconds: 0.4 }],
      '下から_全身': null, '右側現れ消え': null, '左側現れ消え': null, 'マスク': null,
      '1': null, '2': null, '3': null, '4': null,
      '5': { op: 'standOff', at: 'stand', suppressStand: true },
      '8': null, '9': null, '10': null,
      '14': { op: 'standOff', at: 'stand', whenNoHero: true },
    },
    effects: {
      'ダメージエフェクト': null, '斬撃1': null, '斬撃2': null, '斬撃3': null, 'ハンマー': null, '波動': null, 'エナジードレイン': null,
      '17': { op: 'shake', axis: 'overall', strength: 0.1, seconds: 0.36 }, '18': { op: 'shake', axis: 'overall', strength: 0.1, seconds: 0.36 }, '19': { op: 'shake', axis: 'overall', strength: 0.1, seconds: 0.36 },
      '20': { op: 'shake', axis: 'overall', strength: 0.1, seconds: 0.36 }, '21': { op: 'shake', axis: 'overall', strength: 0.1, seconds: 0.36 }, '22': { op: 'shake', axis: 'overall', strength: 0.1, seconds: 0.36 },
    },
    effectPos: { '中': 'center', '左': 'left', '右': 'right', '1': 'left', '2': 'center', '3': 'right' },
    picSize: { '拡大': null, '通常': null, '2': null, '立ち絵全消え': null },
    backVoice: { attr: 'back_voice', packAttr: 'back_voice_pack', sep: '#', slot: 'back', volume: 1, onMissing: 'keep' },
    scene: { split: 'chains', forkPolicy: 'merge' },
  },
  'otogi-json': {
    root: '',
    lang: 'jp',
    langs: {
      jp: { normal: ['typeadv/MScenes'], adult: ['json'] },
      cn: { normal: ['typeadv/MScenes_TW'], adult: ['jsoncn'] },
      tw: { normal: ['typeadv/MScenes_TW'], adult: ['jsoncn'] },
    },
    protagonist: '人間',
    idPattern: '^\\d+$',
    data: {
      list: 'list.json',
      monsters: 'MasterData/MMonsters.json',
      episodes: 'VieableEpisodeList',
      main: 'Episode/Main',
    },
    index: {
      dirs: [
        'typeadv',
        'chara/still',
        'othersounds',
        'bgm',
        'json',
        'jsoncn',
        'VieableEpisodeList',
        'Episode/Main',
        'icon/chara/icon/png',
      ],
      ext: '\\.(?:png|jpe?g|webp|m4a|mp3|ogg|wav|json|atlas\\.txt)$',
    },
    paths: {
      bg: ['typeadv/bg/adventure/{name}.{ext}', 'typeadv/bg/{name}.{ext}'],
      bgm: ['bgm/{name}.{ext}'],
      voice: ['typeadv/voice/adventure/voice_adventure_{scene}/{name}.{ext}'],
      se: ['typeadv/voice/adventure/voice_adventure_{scene}/{name}.{ext}'],
      adultVoice: ['othersounds/still/{scene}/{name}.{ext}'],
      stand: ['typeadv/CharaStand/Adventure/{monster}/{name}.{ext}'],
      skel: ['chara/still/{scene}/{scene}.json'],
      atlas: ['chara/still/{scene}/{scene}.atlas.txt'],
      icon: ['icon/chara/icon/png/{monster}.{ext}'],
    },
    exts: { image: ['png', 'webp', 'jpg'], audio: ['m4a', 'mp3', 'ogg', 'wav'] },
    positions: { '1': 'narration', '2': 'left', '3': 'right' },
    emotions: {
      '1': 'idle',
      '2': 'sad',
      '3': 'surprise',
      '4': 'angry',
      '5': 'shy',
      '6': 'joy',
      '7': 'idle',
      '8': 'violent',
    },
    stand: {
      body: 'body',
      layers: ['{emotion}_c', '{emotion}'],
      fit: 1,
      duplicate: 'hideOther',
      dim: 0,
    },
    anim: {
      '1': { anim: 'animation1', loop: true },
      '2': { anim: 'animation2', loop: true },
      '3': { anim: 'animation3', loop: false, speed: 0.5, effect: 'climax' },
      '4': { anim: 'animation4', loop: true },
    },
    motion: { fastAbove: 1, fastFactor: 0.75, zero: 0.01 },
    effects: {
      '1': [],
      '2': [{ op: 'wash', color: 'black', seconds: 0.52 }],
      Flash: [{ op: 'wash', color: 'white', seconds: 1.04 }],
      Damage: [{ op: 'wash', color: 'red', seconds: 1.04 }],
      climax: [{ op: 'flash', color: 'white', count: 1, seconds: 3 }],
    },
    text: { sizeMap: {}, breakPattern: '<br\\s*/?>' },
    arrayScenes: 'first',
    sniff: { bytes: 8192, normal: 'MSceneDetails', adult: 'MAdultDetails' },
  },
}
// 有意和适配器 DEFAULT_OPTIONS 不一致的键：{ <适配器 id>: ['a.b.c', …] }（点路径；整棵子树不一致就写子树的路径）。现在没有——表和默认值逐字节一致。
export const RULE_DEVIATIONS = {}

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
//   ruleTables     数组：写哪些适配器的完整规则表（ADAPTER_RULES[适配器 id]）；ruleOverrides = { <适配器 id>: { 子键: 值 } }：这个游戏自己的差异（深度合并，对象逐键、数组整个替换）
//   engine         { classify, resourceResolve, indexSkip, limits, player }：引擎层通用配置，原样写进 config 顶层（要清掉某个字段就写 [] / {}，引擎的合并是顶层字段整个替换）
//   pending        等真实数据的占位 [{ ref, what, draft }]：只是文档，从不写进 config
//   adapterOptions 适配器参数模板 { <适配器 id>: { <选项>: 值 } }，选项的形状（适配器的契约）不变：
//                    字符串 / 数组 / 数字 = 原样；{ path: [候选…] } = 单个路径字符串（第一个存在的，否则第一个）；
//                    { paths: ['a', '?b'] } = 路径数组（'?' 开头 = 存在才写；不带 ? = 总是写）。路径都相对 base，结果相对条目目录
//   config         固定的引擎字段（scriptExtensions / hiddenDirs / labels / merge / views / groups / dirThumbs / scriptThumbs / scriptIndex / thumbSources（含 forStrip）/ thumbFallback（含 topUp）/ thumbCover / thumbHover / pageSize / namesFiles / thumbsDirs …）
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：uviewer-csv 全表（脚本格式 = UViewer 的 CSV 行，样本验证）；没有 limits / resourceResolve：默认值够用（真实包没出现过超限或扩展名不符）。
    // 头像模板 download/character/{name}?? 在引擎的 dirThumbs 默认值里（config.mjs），这里不重复写，deepone 同理；要改在 config.dirThumbs 里写。
    ruleTables: ['uviewer-csv'], ruleOverrides: {},
    engine: { classify: [] },
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：renpy-legeclo 全表（已验证：label H_<角色>_<编号> / play voice "字面量" / 裸 voice "路径" 语句（39238 行，路径相对 game/ 39/39 存在，bareVoice）；stop voice 忽略）。未验证：变量 / 无引号写法的 voice（没见过）。thumbSources 已在上面 config 里（探测器写，真实目录验证过）。
    ruleTables: ['renpy-legeclo'], ruleOverrides: {},
    engine: { classify: [] },
    // 已解决：真实脚本里那 ×39 其实是裸 voice "路径" 语句（Ren'Py 的 voice 语句，没有 play），由 bareVoice 处理；变量 / 无引号写法没有出现过，voiceNoQuote.variables 不要猜。
    pending: [],
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：renpy-monmusu 全表（已验证：movie.rpy 别名表、hscene / hscene_still 结构）。
    ruleTables: ['renpy-monmusu'], ruleOverrides: {},
    engine: { classify: [] },
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：和 monmusu 同一个适配器、同一张表（别名表文件名不同由探测器的 aliasFiles 写）；angelic 的真实数据只有结构，没有逐项验证。
    ruleTables: ['renpy-monmusu'], ruleOverrides: {},
    engine: { classify: [] },
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：renpy-minashigo 全表（已验证：DynamicCharacter("name")、scene_<编号>.rpy）。缩略图对应关系未知（见 pending）。
    ruleTables: ['renpy-minashigo'], ruleOverrides: {},
    engine: { classify: [] },
    // 缩略图已解决（见下面 config.thumbSources 的注释）
    pending: [],
    // 缩略图（gal-samples7 §C：thumb 1423 个里 1323 个的前 9 位 = 某个 scene_<9 位>）：images/thumb/<场景 id><3 位>_360.jpg ↔ scene_<场景 id>（forStrip 去掉 scene_）；images/cg/<场景 id>/*.jpg 目录名 = 场景 id，最多 5 张接在后面；
    // 角色分组卡片（键 = 6 位角色编号）：images/icon/Character/<6 位>.png + images/stand/<6 位>stand_<a-z>.png（文件名格式已验证；和分组键是同一种 6 位编号，对应关系是猜的）
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
      thumbSources: [
        { dir: 'images/thumb', match: String.raw`^(.+)\d{3}_360\.jpg$`, key: '{1}', for: 'script', forKey: '{stem}', forStrip: '^scene_' },
        { dir: 'images/cg/*', match: String.raw`\.(?:png|jpe?g|webp)$`, key: '{dirname}', for: 'script', forKey: '{stem}', forStrip: '^scene_', limit: 5 },
        { dir: 'images/icon/Character', match: String.raw`^(\d{6})\.png$`, key: '{1}', for: 'dir', forKey: '{name}' },
        { dir: 'images/stand', match: String.raw`^(\d{6})stand_[a-z]\.png$`, key: '{1}', for: 'dir', forKey: '{name}', limit: 3 },
      ],
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：uviewer-csv 全表（脚本是 UViewer 的 CSV 格式，样本验证）+ sprites 立绘 / 叠加层 / 抖动（ruleOverrides 打开）。
    //   已验证（真实样本）：指令形式和数量；plist 帧名是 000.png…010.png + body.png（脚本 body:000 → 000.png）；脚本编号 1<6 位角色编号><2 位序号>（5 个脚本对照过 spriteatlas 的目录）。
    //   猜的（没有真实画面核对）：舞台 1280x720；y 向上为正（Cocos2d）且原图画布中心 = 舞台中心 + (x, y)、画布缩放 = 脚本里的 scale；body.png 是底图（所有 NNN.png 帧大小 / 偏移相同，像表情）→ baseKeys ['{name}.png']；
    //   sprite 的第 5、6 个参数 = 缩放 / 淡入秒；CG（still*）按 contain 铺满。mask / imgconf 在游戏里很可能是「裁剪窗口 + 在窗口里放大的脸」（imgconf 的缩放 2、y -1360 恰好把脸放进 mask 的 1280x200 窗口），画色块会画错 → 保留 raw；
    //   黑底图（sprite black.jpg 的槽位 black* / bg*）也保留 raw（和 mask 成对出现，几乎每个脚本都有，很可能是对话框背景一类的界面件）。想试：去掉对应的 commands / slotRules 项重跑。
    ruleTables: ['uviewer-csv'],
    ruleOverrides: {
      'uviewer-csv': {
        sprites: {
          enabled: true,
          fit: 'contain',
          atlas: { baseKeys: ['{name}.png'] },
          commands: { mask: 'raw', imgconf: 'raw' },
          slotRules: [{ cmds: ['sprite'], match: '^(?:black|bg)\\d*$', as: 'raw' }],
        },
      },
    },
    engine: { classify: [] },
    // groups：按脚本编号的形状分七类（gal-samples12 的 7290 个脚本全部分到了，没有剩下的）：1<6 位角色编号><2 位序号>[N|X…] = 角色剧情（941 张卡）；6<5 位><3 位>[字母] = 6 开头的角色（7 张）；<7 位>[E|N|S] = 主线章节（265 张，难度后缀的几个合成一张）；<4 位><2 位> = 6 位编号（2 张）；ev<活动号>_<段>_<序号>[N|X] = 活动（163 张）；ex<号>_<序号> = 番外；audition* = 试镜（1 张）。卡片标题 = 分组键；名称表 data/resource.json 是加密的，读不了——以后有了名字表在 labels 里加 { 分组键: 名字 } 即可
    // 缩略图（dir 相对资源根 = data/）：脚本 <9 位>.txt ↔ image/episode/story/<9 位>.png（已验证：gal-samples9，5321 个脚本里 1815 个有对应图）；角色头像：脚本名 [1:7] = 6 位角色编号（已验证和 spine/character/<6 位> 一致），
    // 图和编号的对应只验证了「同样是 6 位编号」（猜的）；脚本卡片 = 本集图在前、头像接在后面；角色分组卡片（键 = 6 位编号）= icon → deck → profile → stand
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['txt'], hiddenDirs: [], labels: {}, merge: [], views: [
        { parent: '.', as: 'chars', label: '人物剧情', match: String.raw`^(?:1|6)\d{8}[A-Z]?$`, exclusive: true },
        { parent: '.', as: 'main', label: '主线', match: String.raw`^\d{6,7}[A-Z]?$`, exclusive: true },
        { parent: '.', as: 'events', label: '活动', match: String.raw`^ev\d+_`, exclusive: true },
        { parent: '.', as: 'extras', label: '番外', match: String.raw`^ex\d+_`, exclusive: true },
        { parent: '.', as: 'audition', label: '试镜', match: String.raw`^audition`, exclusive: true },
      ],
      groups: [{ parent: 'chars', pattern: String.raw`^1(\d{6})\d{2}[A-Z]?$` }, { parent: 'chars', pattern: String.raw`^(6\d{5})\d{3}[A-Z]?$` }, { parent: 'main', pattern: String.raw`^(\d{7})[A-Z]?$` }, { parent: 'main', pattern: String.raw`^(\d{4})\d{2}[A-Z]?$` }, { parent: 'events', pattern: String.raw`^(ev\d+)_\d+_\d+[A-Z]?$` }, { parent: 'extras', pattern: String.raw`^(ex\d+)_\d+$` }, { parent: 'audition', pattern: String.raw`^(audition)\d*(?:_.*)?$` }], dirThumbs: [], scriptThumbs: [], thumbSources: [
        { dir: 'image/episode/story', match: String.raw`^(\d{9})\.png$`, key: '{1}', for: 'script', forKey: '{stem}' },
        { dir: 'image/character/icon', match: String.raw`^(\d{6})\.png$`, key: '{1}', for: 'script', forKey: '{stem:1:7}', limit: 1 },
        { dir: 'image/character/deck', match: String.raw`^(\d{6})\.png$`, key: '{1}', for: 'script', forKey: '{stem:1:7}', limit: 1 },
        { dir: 'image/character/icon', match: String.raw`^(\d{6})\.png$`, key: '{1}', for: 'dir', forKey: '{name}' },
        { dir: 'image/character/deck', match: String.raw`^(\d{6})\.png$`, key: '{1}', for: 'dir', forKey: '{name}' },
        { dir: 'image/character/profile', match: String.raw`^(\d{6})\.png$`, key: '{1}', for: 'dir', forKey: '{name}' },
        { dir: 'image/character/stand', match: String.raw`^(\d{6})\d{2}\.png$`, key: '{1}', for: 'dir', forKey: '{name}', limit: 3 },
      ], scriptIndex: [], pageSize: 100 },
    count: [{ dir: 'adv/textfiles/story', ext: '.txt', depth: 2 }],
    avatars: [], expectedDirs: [],
    notes: ['按脚本编号的形状分组（角色 / 主线章节 / 活动 ev / 番外 ex / 试镜），标题暂时是分组键；立绘（spriteatlas 图集）、CG（sprite）、闪屏 / 抖动已渲染；mask / imgconf / 黑底图 / anm 暂未渲染（见上面的注释）'],
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：girlscreation-tag / girlscreation-line 两张全表（标签式 / 行式共用同一份 DEFAULT_OPTIONS）。已验证：Girls Creation R Viewer 的相机常数 1920 / 0 / 900（只在 README，是浏览器里按媒体存的设置，不是 config.player，所以这里不写 player）；aster / jaxin / maid 的常数没读过。
    ruleTables: ['girlscreation-tag', 'girlscreation-line'], ruleOverrides: {},
    engine: {
      classify: [],
      // walkFiles：一个场景几百个文件，适配器自己的上限就是 40 万（girlscreation-tag.contextWalkLimit），这里写同样的值，让它在表里可见、可改。
      // sampleFiles：未验证的猜测——脚本抽样默认 3000，场景数超过它时索引会截断（渲染诊断报 sample-truncated）；放到 ceiling 20000 保证不会悄悄少读（比适配器默认宽，不是逐字节等价）。
      limits: { walkFiles: 400000, sampleFiles: 20000 },
    },
    // 缩略图（g2.log / add.g.3.log 的目录树：每个场景目录 scenes/<场景 id>/ 里有 thumbnail.png|jpg）：键 = 场景目录名；脚本卡片 forKey = 父目录名；topUp：再从脚本里补事件图 / 立绘 / 背景（最多 6 张，规则的图在前）让卡片能悬停轮播
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['txt'], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [],
      thumbSources: [
        { dir: 'scenes/*', match: String.raw`^thumbnail\.(?:png|jpe?g|webp)$`, key: '{dirname}', for: 'script', forKey: '{parent}' },
        { dir: 'scenes/*', match: String.raw`^thumbnail\.(?:png|jpe?g|webp)$`, key: '{dirname}', for: 'dir', forKey: '{name}' },
      ],
      thumbFallback: { topUp: true },
    },
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
  // Aku：角色摆放用原版 spine-widget 的 fitToCanvas（player.cameraMode: 'widget'，常数见 gal-spine.js；原版 preloader.js / spine-widget.js 核对过，gal-samples13）。engine 是整份替换，所以把 girlscreation 的 classify / limits 也写上
  aku: { extends: 'girlscreation', title: 'Aku No Onna Kanbu', engine: { classify: [], limits: { walkFiles: 400000, sampleFiles: 20000 }, player: { cameraMode: 'widget' } } },
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：tenkeiprdx-json 全表（真实数据验证：scenes json / Masterdata / Spines / Stills）。
    ruleTables: ['tenkeiprdx-json'], ruleOverrides: {},
    engine: { classify: [] },
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：misttrain-json 全表（真实数据验证：UScenes / Spines / MasterData）。角色缩略图（Bases/<Id>201.png）未验证（见 pending）。
    ruleTables: ['misttrain-json'], ruleOverrides: {},
    engine: { classify: [] },
    // PENDING（待真实数据，不写进 config，只是文档）：假设「Textures/Characters/Bases/<Id>201.png」= 角色卡片缩略图，还没被数据证实（D 段统计）；确认前不要启用。见 scripts/dev/gal-pending-plan.md §2。
    pending: [{ ref: 'gal-pending-plan.md §2', what: 'misttrain 角色缩略图 = Textures/Characters/Bases/<Id>201.png', draft: { thumbSources: [{ dir: 'Textures/Characters/Bases', match: '^(\\d+)201\\.png$', key: '{1}', for: 'dir' }] } }],
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：utage-book 全表。已验证（真实数据）：语音 Sound/Voice/ImportChara/<charId>/<voice>.ogg、BgVoice 在 Sound/BgVoice/、骨架名去掉 _SkeletonData.asset（paths.skeletonSuffixStrip）、骨架是 Spine 4.0.37（播放器按骨架版本选运行时，不需要配置）。
    // 未验证：<Off> 的含义、立绘 x 参考宽度 1280（表里 screenWidth / standX）。
    ruleTables: ['utage-book'], ruleOverrides: {},
    engine: {
      classify: [],
      limits: { walkFiles: 800000 },   // utage-book.contextWalkLimit：Sound/Voice/ImportChara/<角色>/ 下语音很多
    },
    // Adventure 下的 Master.chapter.json 和图片目录不是剧情，适配器的嗅探把它们挡掉（只认 *.book.json 靠适配器，不靠扩展名）
    // 缩略图：角色分组卡片（目录节点名 '@<4 位角色号>'，forStrip 去掉 @）← Sprites/Chara/Thumb_005|Thumb_006/chara_<7 位>_<n>_<n>.png（真实路径不带 Textures/）；脚本 CharaScenario<7 位> 前 4 位 = 角色号（头像与角色的对应是猜的）
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['json'], hiddenDirs: ['BackGrounds', 'Effects', 'Spine', 'Textures'], labels: {}, merge: [], groups: [], dirThumbs: [], scriptThumbs: [],
      thumbSources: [{ dir: 'Sprites/Chara/Thumb_*', match: String.raw`^chara_(\d{4})\d{3}_.*\.png$`, key: '{1}', for: 'dir', forKey: '{name}', forStrip: '^@', limit: 6 }],
    },
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：artwhirl-json 全表（按官方 json_story_player 的语义写的；others.action 的 bow / jump / swing / vibe / avoid 近似成轻微整屏抖动，slidein* / attack* 记 raw，emotion.* drop（原版 json_story_player 不处理 emotion）；bg_change.val f / c / s → 渐变秒数（猜的）；音频扩展名对不上时按 audioExtFallback 换；voices 字符串 / dic 下标两种写法都认；换场景时收掉上一个场景的立绘）。
    ruleTables: ['artwhirl-json'], ruleOverrides: {},
    engine: { classify: [] },
    // 缩略图（dir 相对资源根 = game/）：episode_scripts/<KEY>_ep<N>/<KEY>_ep<N>_00.json（H 版 _h.json）↔ episode_thumb/<KEY>/<KEY>_episode<N>_thumb.jpg（H 版 …_episode<N>h_thumb.jpg）；目录 / 分组卡片 ← images/icons/<KEY>/icon_m.jpg + icon_s.png；hscripts 的 H 场景没有直接的缩略图，走兜底 + topUp
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['json'], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [], scriptIndex: [], pageSize: 100,
      thumbSources: [
        { dir: 'episode_thumb/*', match: String.raw`^(.+)_episode(\d+)(h?)_thumb\.jpg$`, key: '{1}_{2}{3}', for: 'script', forMatch: String.raw`^(.+)_ep(\d+)_00$`, forKey: '{1}_{2}' },
        { dir: 'episode_thumb/*', match: String.raw`^(.+)_episode(\d+)(h?)_thumb\.jpg$`, key: '{1}_{2}{3}', for: 'script', forMatch: String.raw`^(.+)_ep(\d+)_h$`, forKey: '{1}_{2}h' },
        { dir: 'images/icons/*', match: String.raw`^icon_[ms]\.(?:jpg|png)$`, key: '{dirname}', for: 'dir', forMatch: String.raw`^(.+?)(?:_ep\d+)?$`, forKey: '{1}' },
      ],
      thumbFallback: { topUp: true },
    },
    count: [{ dir: 'episode_scripts', ext: '.json', depth: 3 }, { dir: 'hscripts', ext: '.json', depth: 3 }],
    avatars: [], expectedDirs: ['images/stands', 'audio'],
    notes: ['剧情 JSON 按 官方 json_story_player 的语义解析（背景 / HCG 视频 / BGM / 语音 / 立绘组合）；立绘动作（others 的 action 的 slidein / attack）暂未渲染，统计里会列出；表情特效（emotion）原版就不处理，不记'],
  },
  kamihime: {
    title: 'Kamihime Player（TyranoScript）', kind: 'kamihime', detector: 'kamihime', autoOrder: 100,   // .ks 独有，放在通用 uviewer 之前
    bases: ['', 'game'], searchDepth: 6,
    anchors: ['dmm/raw_scenario'], siblings: [], markers: ['dmm/assets'],   // 没声明：要求有 assets 和至少一个 .ks（detectKamihime）
    scriptRoots: [{ id: 'ks', dir: 'dmm/raw_scenario', label: '日文' }],
    resourceRoots: ['dmm/assets', 'dmm/portrait'],   // 第二个根：角色头像（目录卡片的缩略图，tyrano-ks 的 catalog 按目录名找）
    adapters: ['tyrano-ks'],
    adapterOptions: { 'tyrano-ks': { root: { path: ['dmm'] } } },
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：tyrano-ks 全表。胶片剧情（<id>_harem-character_script.json，开场 .ks 的下一个编号，gal-samples13 / 14 核对：321 段，fps 1 / 8 / 16 / 24，film = 竖排胶片 640×14400 = 16 帧 640×900）→ film 选项，scriptExtensions 要带 json。已验证：hash 命名 / resource_directory 取自同目录 json / 表情缺失退回基础立绘。已验证（脚本里的写法）：layer=3 上的角色 chara_show → anim 滑入 → freeimage 移除（animSlide ignore 吃掉滑入、freeimage 去掉 layer 3 的立绘）。未验证：layer=3 的真实画面（没有对照图，滑入 0.6 秒没有表达）、立绘位置只按出场顺序摆（stand.slots 是猜的）、Memorial 的 mem_img 渐变 / 一图一步的节奏（memorial.imageFade / imageStep 是猜的）。
    ruleTables: ['tyrano-ks'], ruleOverrides: {},
    engine: {
      classify: [],
      // 真实数据：assets 平铺 1.1 万个带 hash 的文件（game/dmm/assets/<stem>-<sha1>.<ext>）+ 5000 多个 <resource_directory> 子目录（无 hash 的 mp3 在 assets/<resource_directory>/）；
      // 无 hash 的表情 png 很多在磁盘上不存在 → 适配器退回基础立绘（fallback.faceToBase）。limits 抄的是 tyrano-ks 自己的 contextWalkLimit / contextSampleLimit（3067 个剧情各一个 json）。
      limits: { walkFiles: 800000, sampleFiles: 20000 },
    },
    // 兜底封面跳过占位图：默认的 black / white / blank（按单词）再加 sepia_filter（回忆滤镜层 [image storage="sepia_filter-<hash>.png" layer=4]）；skip 是整张替换默认值，所以默认那条也要写进来
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['ks', 'json'], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [], scriptIndex: [], pageSize: 100, thumbFallback: { skip: ['(?:^|[^a-z])(?:black|white|blank)(?:[^a-z]|$)', 'sepia_filter'] } },
    count: [{ dir: 'dmm/raw_scenario', ext: '.ks', depth: 6 }],
    avatars: [], expectedDirs: ['dmm/assets'],
    notes: ['列表（类别 → 目录 → 剧情，标题取同目录 json 的 title）由 tyrano-ks 适配器现读；layer 3 的立绘滑入 / 滑出不渲染（anim layer / layopt 静默吃掉，animSlide: raw 可改成记 raw）；Memorial 剧情（mem_img 幻灯片 / mem_voice 语音 + 台词 / memorial 段落）已支持'],
  },
  bokusen: {
    title: 'ぼくらの放課後戦争', kind: 'bokusen', detector: 'bokusen', autoOrder: 110,   // <根>/json/*.json（data.code 编译脚本）+ <根>/resource/<脚本名>/{images,sounds}
    bases: [''], searchDepth: 4,
    anchors: ['json'], siblings: [], markers: ['resource'],   // 没声明：json/ 里还要有脚本开头是 {"data":{"code":{…（detectBokusen）
    scriptRoots: [{ id: 'json', dir: 'json', label: '脚本' }],
    resourceRoots: ['resource'],
    adapters: ['bokusen-json'],
    adapterOptions: { 'bokusen-json': { root: { path: ['.'] }, resourceDir: 'resource' } },
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：bokusen-json 全表。已验证：图片 resource/<脚本名>/images/<i>.<ext>（0 起），声音 resource/<脚本名>/sounds/<i>.wav。未验证：playbgm 曲目选择（bgm.patterns / index 是猜的）、move 不做渐变。
    ruleTables: ['bokusen-json'], ruleOverrides: {},
    engine: {
      classify: [],
      // 真实数据：磁盘上的声音是 .wav，脚本列表里写 .m4a（adapterOptions.sound.ext 先试 .wav；这里再写一条引擎层的扩展名回退，两处冗余但互不冲突，适配器以外的取资源路径也能用上）。
      resourceResolve: { extensionFallbacks: { '.m4a': ['.wav'] } },
      limits: { walkFiles: 1000000 },   // bokusen-json.contextWalkLimit：826 个资源目录 × 几十到几百个文件
    },
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
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：grenze-xml 全表。已验证：资源在 assets/resources/patchres、立绘 merc/pic/<hero_group_id>/body.webp|png、声音按 voice_pack、`non` = 没有。未验证：screen_effect / pic_action / effect 的含义——日文名字的值（速い画面揺れ / 溶明_黒幕 / フラッシュ / 立ち絵全消え …）按名字映射成现有场景指令（秒数 / 强度是猜的），数字 id 和战斗特效名仍是 raw；back_voice（<名>#<音量>）→ bgvoice。
    ruleTables: ['grenze-xml'], ruleOverrides: {},
    engine: {
      classify: [],
      limits: { walkFiles: 2000000 },   // grenze-xml.contextWalkLimit：voice 一个目录十万级文件
    },
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: ['xml'], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [], scriptIndex: [], pageSize: 100 },
    count: [],   // 数 TextAsset 里的 easy_dialog-N.xml（detectGrenze）
    avatars: [], expectedDirs: ['assets/resources/patchres'],
    notes: ['按 next_id 链拆场景（每个文件几百个）；立绘 = merc/pic/<hero_group_id>/body.webp|png 整张；screen_effect / pic_action / effect 含义未知，记为未渲染指令（stats.raw）'],
  },
  otogi: {
    title: 'Otogi Frontier R（离线网页版）', kind: 'otogi', detector: 'otogi', autoOrder: 135,   // <根>/list.json + typeadv/MScenes/<id>（没有扩展名的 JSON）+ json/<id>（成人剧情）
    bases: [''], searchDepth: 4,
    anchors: ['list.json', 'typeadv/MScenes', 'json'], siblings: [], markers: ['typeadv/CharaStand', 'VieableEpisodeList'],   // 没声明：还要有立绘和 VieableEpisodeList，并且 MScenes 里有 MSceneDetails 开头的文件（detectOtogi）
    scriptRoots: [{ id: 'game', dir: '.', label: '游戏目录' }],   // 脚本根 = 游戏目录本身：普通剧情在 typeadv/MScenes、成人剧情在 json，列表（catalog）里的脚本路径相对它（脚本根不同的话 catalog 只认第一个脚本根）
    resourceRoots: ['.'],
    adapters: ['otogi-json'],
    adapterOptions: { 'otogi-json': { root: { path: ['.'] } } },
    // ---- 规则配置（脚本是唯一来源）：ruleTables = 写哪些适配器的全表；ruleOverrides = 只对这个游戏改的子键（深度合并在全表之上，空 = 和全表一致）；engine = 引擎层配置字段，原样写进 config
    // 规则：otogi-json 全表。已验证（游戏自带的 000.js / spine-player.html / list.json + 真实数据样本）：剧情格式和路径（typeadv/MScenes、json、voice_adventure_<MSceneId>、othersounds/still/<Id>、bgm/<名>.m4a、CharaStand/Adventure/<角色>/body.png + 表情）、
    //   CharaAnimation → animation1..4、Motion 的速度公式（> 1 乘 0.75）、Effect Flash / Damage / "2"、list.json data[<Id>]["1"] = {X, Y, Z}、剧情文件没有扩展名（config.scriptExtensions ['']）。
    // 未验证（猜的）：Position 2 / 3 = 左 / 右（000.css 不在手上）、表情叠层和 body 同尺寸、_c 在下 / 表情在上、typeadv/bg 下背景是 adventure/ 子目录还是平铺（两个都试）、旁白行是否收立绘（stand.narration 默认 keep = 原页面的 JS）、
    //   still 的 X / Y / Z 怎么用（spine 指令带 x / y / scale，静态画面层目前不应用）、animation3 → animation4 的接续（spine 指令没有「接续」）、jsoncn / MScenes_TW 对应 cn / tw 的划分。
    ruleTables: ['otogi-json'], ruleOverrides: {},
    engine: {
      classify: [],
      // 真实数据：typeadv/voice 下约 10 万个语音文件、chara/still 几万个、剧情 3395 + 3474 个 MScenes（含 TW）+ 2277 + 2257 个 json / jsoncn；
      // 标题要读 3395 个普通剧情的开头 + 1418 个 VieableEpisodeList，超过引擎默认的 3000（抄的是 otogi-json 自己的 contextWalkLimit / contextSampleLimit）
      limits: { walkFiles: 800000, sampleFiles: 20000 },
    },
    // scriptExtensions ['']：剧情文件没有扩展名；真正的格式判断靠适配器的嗅探（只认 {"Id":N,"Title|Description":…,"MSceneDetails|MAdultDetails":[ 开头）
    config: { namesFiles: [], thumbsDirs: [], scriptExtensions: [''], hiddenDirs: [], labels: {}, merge: [], views: [], groups: [], dirThumbs: [], scriptThumbs: [], scriptIndex: [], pageSize: 100 },
    count: [],   // 数 typeadv/MScenes 和 json 里的剧情文件（detectOtogi）
    cover: [{ dir: 'typeadv/bg/adventure', match: '\\.png$', flags: 'i', pick: 'first' }, { dir: 'typeadv/bg', match: '^bg_adventure_.*\\.png$', flags: 'i', pick: 'first' }, { dir: 'title', match: '\\.png$', flags: 'i', pick: 'first' }],
    avatars: [], expectedDirs: ['typeadv/CharaStand', 'chara/still', 'VieableEpisodeList', 'MasterData'],
    nodes: [['main', 'main'], ['chars', 'chars'], ['all', 'all'], ['adult', 'adult']],
    notes: ['剧情文件没有扩展名（typeadv/MScenes/<id>、json/<id>）；列表（主线 / 角色 / 全部普通 / 全部成人）由 otogi-json 适配器读 list.json / Episode/Main / VieableEpisodeList / MasterData 现建', '语音只有一小部分在本地：找不到的语音不发指令，计入 stats.missing.voice（不算「缺少资源」）；语言切换用 adapterOptions[\'otogi-json\'].lang（jp / cn / tw）'],
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
  // 规则配置：ruleTables = 适配器 id 数组；ruleOverrides = { 适配器 id: 对象 }；engine = { classify / resourceResolve / indexSkip / limits / player }（原样写进 config，写坏的由引擎规整时丢掉并报告）
  if (out.ruleTables !== undefined && !Array.isArray(out.ruleTables)) { bad('ruleTables 不是数组，忽略这个字段'); out.ruleTables = [] }
  out.ruleTables = (out.ruleTables || []).filter((a) => { const ok = typeof a === 'string' && /^[a-z0-9-]{1,40}$/.test(a); if (!ok) bad(`ruleTables 里有不合法的适配器 id：${JSON.stringify(a)}，忽略这一项`); return ok })
  out.ruleOverrides = isPlain(raw.ruleOverrides) ? Object.fromEntries(Object.entries(raw.ruleOverrides).filter(([id, v]) => { const ok = isPlain(v); if (!ok) bad(`ruleOverrides.${id} 不是对象，忽略`); return ok })) : {}
  if (raw.ruleOverrides !== undefined && !isPlain(raw.ruleOverrides)) bad('ruleOverrides 不是对象，忽略这个字段')
  out.engine = isPlain(raw.engine) ? Object.fromEntries(Object.entries(raw.engine).filter(([k]) => { const ok = ENGINE_FIELDS.includes(k); if (!ok) bad(`engine 里不认识的字段 ${k}（可用：${ENGINE_FIELDS.join(' / ')}），忽略`); return ok })) : {}
  if (raw.engine !== undefined && !isPlain(raw.engine)) bad('engine 不是对象，忽略这个字段')
  out.searchDepth = Math.max(0, Math.min(8, Math.floor(Number(raw.searchDepth)) || 6))
  if (!out.bases.length || !out.anchors.length) { bad('没有可用的 bases / anchors，这一项不能用'); return null }
  return out
}
// 引擎层通用配置字段（config.mjs 的 classify / resourceResolve / indexSkip / limits / player）：LAYOUTS 里的 engine 原样写进 config
const ENGINE_FIELDS = ['classify', 'resourceResolve', 'indexSkip', 'limits', 'player']
// 深度合并：对象逐键递归，数组 / 标量整个替换（后者赢）；和适配器自己的 mergeOptions 同一个口径
function deepMerge(a, b) {
  if (!isPlain(a) || !isPlain(b)) return b === undefined ? structuredClone(a) : structuredClone(b)
  const out = structuredClone(a)
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? deepMerge(out[k], v) : structuredClone(v)
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
  // 规则表：ADAPTER_RULES[适配器] < 本游戏的 ruleOverrides < 上面探测出来的值（detector 值赢）
  for (const adapterId of entry.ruleTables || []) {
    const table = deepMerge(Object.prototype.hasOwnProperty.call(ADAPTER_RULES, adapterId) ? ADAPTER_RULES[adapterId] : {}, entry.ruleOverrides?.[adapterId] || {})
    adapterOptions[adapterId] = deepMerge(table, adapterOptions[adapterId] || {})
  }
  if (Object.keys(adapterOptions).length) config.adapterOptions = adapterOptions
  for (const key of ENGINE_FIELDS) if (entry.engine && entry.engine[key] !== undefined) config[key] = structuredClone(entry.engine[key])
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
  otogi: (scope) => detectOtogi(scope),
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

  for (const [adapterId, table] of Object.entries(config.adapterOptions || {})) {
    const size = JSON.stringify(table).length
    if (size > ADAPTER_OPTIONS_BYTES) logs.push(`警告：adapterOptions['${adapterId}'] 序列化后 ${size} 字符，超过引擎的单个适配器上限 ${ADAPTER_OPTIONS_BYTES}，写进去会被整张丢掉——精简 ADAPTER_RULES / ruleOverrides`)
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
    case 'thumbSources': return list((r) => {
      // forStrip：引擎存成正则数组（≤ 4 项，不合法的丢掉），空 = 不存这个键
      const strip = [r.forStrip].flat().filter((x) => typeof x === 'string' && x && (() => { try { new RegExp(x); return true } catch { return false } })()).slice(0, 4)
      const { forStrip: _drop, ...rest } = r
      return { ...rest, ...(strip.length ? { forStrip: strip } : {}), key: r.key || '{1}', for: ['script', 'dir'].includes(r.for) ? r.for : 'both', forKey: r.forKey ?? '', forMatch: r.forMatch ?? '', kind: r.kind === 'video' ? 'video' : 'image', limit: Math.max(1, Math.min(12, Math.floor(Number(r.limit)) || 12)), fallback: Boolean(r.fallback) }
    })
    // thumbFallback / thumbHover：引擎把没写的字段补成默认值（和 web/library/gal/config.mjs 的 DEFAULT_THUMB_FALLBACK / DEFAULT_THUMB_HOVER 一致），数字夹到范围里
    case 'thumbFallback': {
      if (!isPlain(value)) return value
      const num = (x, d, lo, hi) => (x === undefined || x === null || x === '' || typeof x === 'boolean' || !Number.isFinite(Math.floor(Number(x))) ? d : Math.max(lo, Math.min(hi, Math.floor(Number(x)))))
      const prefer = Array.isArray(value.prefer) ? [...new Set(value.prefer.map((k) => (k === 'bgOver' ? 'cg' : k)).filter((k) => ['cg', 'stand', 'bg'].includes(k)))] : []
      return {
        enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
        max: num(value.max, 6, 1, 12),
        prefer: prefer.length ? prefer : ['cg', 'stand', 'bg'],
        skipBlack: typeof value.skipBlack === 'boolean' ? value.skipBlack : true,
        skip: Array.isArray(value.skip) ? value.skip : ['(?:^|[^a-z])(?:black|white|blank)(?:[^a-z]|$)'],
        scanSteps: num(value.scanSteps, 200, 10, 2000),
        topUp: typeof value.topUp === 'boolean' ? value.topUp : false,
      }
    }
    case 'thumbHover': {
      if (!isPlain(value)) return value
      const count = Number.isFinite(Math.floor(Number(value.count))) && value.count !== null && value.count !== '' && typeof value.count !== 'boolean' ? Math.max(1, Math.min(12, Math.floor(Number(value.count)))) : 4
      const range = Array.isArray(value.intervalMs) && value.intervalMs.length === 2 && value.intervalMs.every((x) => typeof x === 'number' && Number.isFinite(x))
        ? [Math.max(100, Math.min(10000, Math.round(Math.min(...value.intervalMs)))), Math.max(100, Math.min(10000, Math.round(Math.max(...value.intervalMs))))]
        : [700, 900]
      return { enabled: typeof value.enabled === 'boolean' ? value.enabled : true, count, order: value.order === 'sequential' ? 'sequential' : 'random', intervalMs: range }
    }
    case 'thumbCover':
      if (['random', 'first', 'last'].includes(value)) return value
      if (isPlain(value) && value.index !== undefined && value.index !== null && value.index !== '' && typeof value.index !== 'boolean' && Number.isFinite(Number(value.index)) && Math.floor(Number(value.index)) >= 0) return { index: Math.min(11, Math.floor(Number(value.index))) }
      return 'random'
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

// adapterOptions 的改动按适配器 id 汇总：新增 → 「N 个键」；修改 → 变了的子键（列几个、每个简短的差别）；删除 → 原 N 个键。返回 { lines, data }
function adapterOptionsSummary(before, after) {
  const lines = []
  const data = { added: {}, changed: {}, removed: [] }
  const keysOf = (v) => (isPlain(v) ? Object.keys(v) : [])
  for (const id of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
    const label = `adapterOptions['${id}']`
    if (!(id in before)) {
      const keys = keysOf(after[id])
      data.added[id] = keys.length
      lines.push(`+ ${label}（新增）：${keys.length} 个键（${clip(keys.slice(0, 6).join('、') + (keys.length > 6 ? '…' : ''), 80)}）`)
    } else if (!(id in after)) {
      data.removed.push(id)
      lines.push(`- ${label}（删除）：原 ${keysOf(before[id]).length} 个键`)
    } else if (canonJson(before[id]) !== canonJson(after[id])) {
      const a = before[id]
      const b = after[id]
      const changed = isPlain(a) && isPlain(b) ? [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => canonJson(a[k]) !== canonJson(b[k])) : []
      data.changed[id] = changed.slice(0, 20)
      const detail = changed.slice(0, 3).map((k) => (!(k in a) ? `${k}：新增` : !(k in b) ? `${k}：删除` : deltaParts(a[k], b[k], k, 1).join('；'))).map((t) => clip(t, 150))
      lines.push(`~ ${label}（修改）：${changed.length} 个键变了：${changed.slice(0, 8).join('、')}${changed.length > 8 ? ` 等 ${changed.length} 个` : ''}${detail.length ? `；${detail.join('；')}` : ''}`)
    }
  }
  return { lines, data }
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
    if (key === 'adapterOptions' && isPlain(after) && (!had || isPlain(existing[key]))) {   // 适配器参数表很大：按适配器 id 汇总，不倾倒整张表
      const summary = adapterOptionsSummary(had ? existing[key] : {}, after)
      changes.adapterOptions = summary.data
      if (!summary.lines.length) { changes.unchanged.push(key); continue }
      ;(had ? changes.changed : changes.added).push({ field: key, info: briefOf(had ? 'changed' : 'added', had ? existing[key] : undefined, after) })
      summary.lines.forEach((line, i) => details.push({ rank: had ? 1 : 0, line }))
      continue
    }
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
  if (size() > 3800 && details.changes.adapterOptions) details.changes.adapterOptions = { added: Object.keys(details.changes.adapterOptions.added || {}), changed: Object.keys(details.changes.adapterOptions.changed || {}), removed: details.changes.adapterOptions.removed || [] }
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
const BOKUSEN_HEAD = /"data"\s*:\s*\{[\s\S]*?"code"\s*:\s*\{\s*"(?:images|sounds|articles|characters|tags|parameters|commands)"\s*:/   // 与 adapters/bokusen-json.mjs 的 HEAD 一致
async function detectBokusen(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  const jsonRel = join(base, 'json')
  if (!declared) {
    // 没声明：要求 json/ 里有脚本头 8KB 内出现 "data":{…"code":{"images|…"（真实文件 {"error":…,"data":{"user":…,"code":…}}，老的紧凑写法也认；只读开头 8KB，最多看 20 个、认到一个即止），并且同级有 resource/
    let hits = 0
    for (const name of (await listNames(path.join(media, ...splitRel(jsonRel)))).filter((n) => n.toLowerCase().endsWith('.json')).slice(0, 20)) {   // 真实目录里有空文件，多看几个，认到一个就够
      if (hits) break
      try {
        const head = (await readFile(path.join(media, ...splitRel(join(jsonRel, name))))).subarray(0, 8192).toString('utf8').replace(/^\uFEFF/, '')
        if (BOKUSEN_HEAD.test(head)) hits++   // 同 bokusen-json.sniff：真实文件的 code 在 data.user 之后
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

// ---- Otogi Frontier R：<根>/list.json + typeadv/MScenes/<id> + json/<id>（都没有扩展名）；列表由 otogi-json 适配器的 catalog 现读
async function detectOtogi(scope) {
  const { media, declared, logs } = scope
  const loc = await locateGame(scope, scope.id)
  if (!loc) return null
  const { entry, base } = loc
  const dirOf = (rel) => path.join(media, ...splitRel(join(base, rel)))
  const idsIn = async (rel) => (await listNames(dirOf(rel))).filter((name) => /^\d+$/.test(name))
  const normal = await idsIn('typeadv/MScenes')
  if (!declared) {
    // 没声明：要求有立绘和 VieableEpisodeList，并且 MScenes 里至少一个文件开头是 {"Id":N,…"MSceneDetails"（只读开头 8KB，最多看 3 个）
    let hits = 0
    for (const name of normal.slice(0, 3)) {
      try {
        const head = (await readFile(path.join(dirOf('typeadv/MScenes'), name))).subarray(0, 8192).toString('utf8').replace(/^\uFEFF/, '')
        if (/^\s*\{\s*"Id"\s*:\s*\d+\s*,[\s\S]*?"MSceneDetails"\s*:\s*\[/.test(head)) hits++
      } catch { /* 读不了就当不是 */ }
    }
    if (!hits || !(await markersOk(media, entry, base, declared))) return null
  }
  announce(logs, scope.id, loc)
  const config = await buildConfig(media, entry, base)
  const adult = await idsIn('json')
  logs.push(`Otogi 游戏根：${base || '.'}；普通剧情 ${normal.length} 个（typeadv/MScenes）、成人剧情 ${adult.length} 个（json）、TW ${(await idsIn('typeadv/MScenes_TW')).length} 个、jsoncn ${(await idsIn('jsoncn')).length} 个`)
  await warnMissing(media, entry, base, logs)
  for (const line of entry.notes) logs.push(line)
  const cover = await coverFromRules(media, entry, base)
  return makeFound(scope, entry, loc, config, {
    cover,
    count: async () => { logs.push(`剧情文件 ${normal.length + adult.length} 个${normal.length + adult.length ? '' : '——结构可能不对'}`); return normal.length + adult.length },
  })
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
