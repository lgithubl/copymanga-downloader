#!/usr/bin/env node
// Ren'Py 三个适配器（monmusu / legeclo / minashigo）+ uviewer-csv 的选项自测（只用 node，不需要浏览器 / 服务）：
// 每个选项：默认（不传 / 显式写默认值）结果不变，覆盖后结果按文档变；每个适配器一条经 config.adapterOptions + loadAdapterContext 的端到端。
//   node scripts/dev/gal-adapter-options-c-selftest.mjs
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_OPTIONS as LEG_DEFAULTS, parse as legParse, prepare as legPrepare, sniff as legSniff } from '../../web/library/gal/adapters/renpy-legeclo.mjs'
import { DEFAULT_OPTIONS as MG_DEFAULTS, parse as mgParse, prepare as mgPrepare, sniff as mgSniff } from '../../web/library/gal/adapters/renpy-minashigo.mjs'
import { DEFAULT_OPTIONS as MM_DEFAULTS, opts as mmOpts, parse as mmParse, prepare as mmPrepare, sniff as mmSniff } from '../../web/library/gal/adapters/renpy-monmusu.mjs'
import { DEFAULT_OPTIONS as UV_DEFAULTS, parse as uvParse, sniff as uvSniff } from '../../web/library/gal/adapters/uviewer-csv.mjs'
import { galAdapter, sniffGalAdapter } from '../../web/library/gal/adapters/index.mjs'
import { galConfigView, normalizeGalConfig } from '../../web/library/gal/config.mjs'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
import { buildScene } from '../../web/library/gal/scene.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const ops = (r) => r.steps.map((s) => s.commands.map((c) => c.op).join(',')).join(' | ')
const all = (r) => r.steps.flatMap((s) => s.commands)
const speakers = (r) => all(r).filter((c) => c.op === 'speaker').map((c) => c.segments.map((x) => x.text).join(''))
const texts = (r) => all(r).filter((c) => c.op === 'text').map((c) => c.segments.map((x) => x.text).join(''))
const meta = (options) => ({ options })
const dropMeta = (r) => J({ steps: r.steps, stats: r.stats })

// ================= 公共：默认值都能编译 =================
{
  const dropped = (compiled, key, expected) => compiled[key].length === expected
  const mm = mmOpts({})
  check('默认选项全部编译成功（没有被安全检查丢掉的默认正则）', mm.aliasPatterns.length === MM_DEFAULTS.aliasPatterns.length && mm.sniff.labelRe && mm.sniff.markerRes.length === 1 && dropped(mm, 'blackRes', 1) && mm.transitions.named && mm.movieNoLoopRe)
  const invalid = mmOpts({ blackRes: ['(a+)+', '^ok$'], aliasPatterns: [{ kind: 'x', re: 'a' }, { kind: 'image', re: '(' }], flow: { menu: 'nope' }, audioCommands: { other: 'weird' } })
  check('非法项丢掉 / 回默认，不抛：嵌套量词的正则、未知 kind、坏正则、未知枚举值', invalid.blackRes.length === 1 && invalid.aliasPatterns.length === 0 && invalid.flow.menu === 'raw' && invalid.audioCommands.other === 'raw')
}

// ================= monmusu =================
const MM_FILES = ['game/images/bg/a.png', 'game/images/alt/a.webp', 'game/images/bg/b.jpg']
const mmCtx = mmPrepare({ texts: { s: 'image mov = Movie(play="v/m.webm", loop=False)\nimage logo = "images/logo.png"' }, files: MM_FILES, toResourcePath: (r) => r.replace(/^game\//, '') })
const MM_SCRIPT = 'label h1:\n    scene black\n    play music "a/b.mp3"\n    play audio "a/s.ogg"\n    voice "v/1.ogg"\n    scene a with Dissolve(0.4)\n    "Ann" "hi"\n    "narration"\n    e "variable line"\n    menu:\n        "Yes":\n            "in menu" "x"\n    if flag:\n        "Bob" "in if"\n    else:\n        "Cat" "in else"\n    stop music fadeout 1.0\n'
{
  const base = mmParse(MM_SCRIPT, mmCtx)
  check('monmusu 默认：显式写出 DEFAULT_OPTIONS 和不传选项结果一模一样', dropMeta(mmParse(MM_SCRIPT, mmCtx, meta(MM_DEFAULTS))) === dropMeta(base) && dropMeta(mmParse(MM_SCRIPT, mmCtx, meta({}))) === dropMeta(base))
  check('monmusu 默认：变量写法 e "…" 记 raw、menu / if 记 raw、各分支线性读', base.stats.raw.e === 1 && base.stats.raw.menu === 1 && base.stats.raw.if === 1 && base.stats.raw.else === 1 && texts(base).includes('x') && texts(base).includes('in if') && texts(base).includes('in else'), J(base.stats.raw))
  check('monmusu 默认：play audio → se，voice 语句 → voice，视频 / 图片别名', base.steps[0].commands.some((c) => c.op === 'se') && base.steps[0].commands.some((c) => c.op === 'voice'))

  const sp = mmParse(MM_SCRIPT, mmCtx, meta({ speakers: { e: 'Eileen' } }))
  check('monmusu speakers：e "…" → speaker Eileen（不再记 raw）；其它不变', speakers(sp).includes('Eileen') && !sp.stats.raw.e && texts(sp).includes('variable line'), J(speakers(sp)))
  const sv = mmParse(MM_SCRIPT, mmCtx, meta({ speakerVars: ['^[a-z]$'] }))
  check('monmusu speakerVars：变量名命中正则、表里没有 → 说话人用变量名', speakers(sv).includes('e') && !sv.stats.raw.e)
  const kw = mmParse('label a:\n    voice "x/1.ogg"\n    scene black\n    "t"\n', null, meta({ speakerVars: ['^\\w+$'] }))
  check('monmusu speakerVars 很宽也不会吞掉关键字语句（voice / scene …）', kw.steps[0].commands.some((c) => c.op === 'voice') && kw.steps[0].commands.some((c) => c.op === 'bg'))
  const narr = mmParse('label a:\n    e "x"\n', null, meta({ speakers: { e: '' } }))
  check('monmusu speakers 值为空 = 旁白（说话人不变，不发 speaker）', speakers(narr).length === 0 && texts(narr)[0] === 'x' && narr.stats.raw.e === undefined, J(all(narr)))

  const lin = mmParse(MM_SCRIPT, mmCtx, meta({ flow: { menu: 'linear' } }))
  check('monmusu flow.menu = linear：menu: 和 "选项文字": 行静默跳过，正文照读', !lin.stats.raw.menu && !('"Yes":' in lin.stats.raw) && texts(lin).includes('x') && lin.stats.raw.if === 1, J(lin.stats.raw))
  check('monmusu flow.menu 默认 raw：选项行记进 raw', Object.keys(base.stats.raw).some((k) => k.startsWith('"Yes"')), J(base.stats.raw))
  const ign = mmParse(MM_SCRIPT, mmCtx, meta({ flow: { conditionals: 'ignore' } }))
  check('monmusu flow.conditionals = ignore：if / else 块整块跳过（头行记 raw），块外正文照读', !texts(ign).includes('in if') && !texts(ign).includes('in else') && texts(ign).includes('x') && ign.stats.raw.if === 1 && ign.stats.raw.else === 1 && all(ign).some((c) => c.op === 'bgmStop'), J(texts(ign)))

  const noAud = mmParse(MM_SCRIPT, mmCtx, meta({ audioCommands: { se: [], other: 'raw' } }))
  check('monmusu audioCommands.se = []：play audio 变 raw', !noAud.steps[0].commands.some((c) => c.op === 'se') && noAud.stats.raw['play audio'] === 1)
  const bgmAlias = mmParse('label a:\n    play bgmx "m/1.mp3"\n    play voice2 "v/1.ogg"\n    play weird "w.ogg"\n    "t"\n', null, meta({ audioCommands: { music: ['music', 'bgmx'], voice: ['voice*'], other: 'ignore' } }))
  check('monmusu audioCommands：自定义声道名 / 通配 voice* / other=ignore', ops(bgmAlias) === 'bgm,voice,text' && Object.keys(bgmAlias.stats.raw).length === 0, ops(bgmAlias))
  const other = mmParse('label a:\n    play weird "w.ogg"\n    "t"\n', null, meta({ audioCommands: { other: 'se' } }))
  check('monmusu audioCommands.other = se：没列的声道当音效；默认 raw', other.steps[0].commands[0].op === 'se' && mmParse('label a:\n    play weird "w.ogg"\n').stats.raw['play weird'] === 1)
  const stopCh = mmParse('label a:\n    "t"\n    stop bgmx fadeout 2\n', null, meta({ audioCommands: { music: ['bgmx'] } }))
  check('monmusu stop <声道> 跟着 audioCommands.music 走', all(stopCh).some((c) => c.op === 'bgmStop' && c.fade === 2))

  const vq = 'label a:\n    play voice [vid]\n    play voice "v/[n].ogg"\n    play voice vname\n    voice [vid]\n    "t"\n'
  const vqDefault = mmParse(vq)
  check('monmusu voiceNoQuote 默认（空表）：[变量] / 裸变量记 raw，带 [n] 的路径原样', vqDefault.stats.raw['play voice'] === 2 && all(vqDefault).filter((c) => c.op === 'voice').map((c) => c.src).join() === 'v/[n].ogg', J(vqDefault.stats.raw))
  const vqSet = mmParse(vq, null, meta({ voiceNoQuote: { variables: { vid: 'voice/03/39.ogg', n: '07', vname: 'voice/x.ogg' } } }))
  check('monmusu voiceNoQuote.variables：[vid] / [n] / 裸变量名按表替换成路径，voice 语句同样', all(vqSet).filter((c) => c.op === 'voice').map((c) => c.src).join() === 'voice/03/39.ogg,v/07.ogg,voice/x.ogg,voice/03/39.ogg' && !vqSet.stats.raw['play voice'], J(all(vqSet)))

  const tr = mmParse('label a:\n    "t"\n    with dissolve\n    with Dissolve(0.2)\n', null, meta({ transitions: { seconds: 0.9 } }))
  check('monmusu transitions.seconds：命名转场的秒数；Dissolve(n) 不受影响', all(tr).filter((c) => c.op === 'fade').map((c) => c.seconds).join() === '0.9,0.2')
  check('monmusu transitions.named：改正则 → 不认的转场名 = 0 秒', !all(mmParse('label a:\n    "t"\n    with dissolve\n', null, meta({ transitions: { named: '^zzz' } }))).some((c) => c.op === 'fade'))
  const bl = mmParse('label a:\n    scene black2\n', null, meta({ blackRes: ['^black\\d*$'] }))
  check('monmusu blackRes：默认只认 black；配了正则 black2 也是黑底', mmParse('label a:\n    scene black2\n').steps[0].commands[0].op === 'raw' && bl.steps[0].commands[0].color?.join() === '0,0,0')
  check('monmusu sniff 选项：labelRe / markerRes 可改（sniff(text, options)）', mmSniff('label h1:\n    scene black\n') && !mmSniff('label h1:\n    scene black\n', { sniff: { markerRes: ['^\\s*zzz'] } }) && mmSniff('label h1:\n    zzz\n', { sniff: { markerRes: ['^\\s*zzz'] } }) && !mmSniff('label h1:\n    scene black\n', { sniff: { labelRe: '^\\s*label\\s+H_' } }))
  check('sniffGalAdapter 第 3 参数把 adapterOptions 交给 sniff', sniffGalAdapter('label h1:\n    zzz\n', ['renpy-monmusu']) === '' && sniffGalAdapter('label h1:\n    zzz\n', ['renpy-monmusu'], { 'renpy-monmusu': { sniff: { markerRes: ['^\\s*zzz'] } } }) === 'renpy-monmusu')
}
{
  // 别名 / 图片索引
  const prep = (options, extra = {}) => mmPrepare({ options, texts: { s: 'image mov = Movie(play="v/m.webm", loop=False)\nimage logo = "images/Logo.png"\nimage multi = Composite((1,1),\n    (0,0), "images/bg/c.png")' }, files: MM_FILES.concat(['game/images/logo.png', 'game/images/bg/c.png']), toResourcePath: (r) => r.replace(/^game\//, ''), ...extra })
  const d = prep(undefined)
  check('monmusu prepare 默认：视频别名（loop=False）、image X = "…"、目录按文件名；同名文件取路径序第一个（alt/a.webp 在 bg/a.png 之前）', d.movies.get('mov').loop === false && d.images.get('logo') === 'images/logo.png' && d.images.get('a') === 'images/alt/a.webp' && !d.images.has('multi'), J([...d.images]))
  check('monmusu aliasPatterns：scope=text 的跨行 Composite 形式经配置加入', prep({ aliasPatterns: [...MM_DEFAULTS.aliasPatterns, { kind: 'image', scope: 'text', re: 'image\\s+(?<name>\\w+)\\s*=\\s*Composite\\([^"]*"(?<path>[^"]+)"' }] }).images.get('multi') === 'images/bg/c.png')
  check('monmusu aliasPatterns = []：别名表为空（目录自动命名仍在）', prep({ aliasPatterns: [] }).movies.size === 0 && !prep({ aliasPatterns: [] }).images.has('multi') && prep({ aliasPatterns: [] }).images.has('b'))
  check('monmusu movieNoLoopRe 可改：默认 loop=False 不循环；改成别的写法', prep({ movieNoLoopRe: 'zzz' }).movies.get('mov').loop === true)
  check('monmusu imageIndex.preferDirs：同名文件按目录顺序挑', prep({ imageIndex: { preferDirs: ['images/bg'] } }).images.get('a') === 'images/bg/a.png')
  check('monmusu imageIndex.ext：只认列出的扩展名；extPriority 按 ext 顺序挑同名', !prep({ imageIndex: { ext: ['png'] } }).images.has('b') && prep({ imageIndex: { ext: ['png'] } }).images.get('a') === 'images/bg/a.png' && prep({ imageIndex: { ext: ['webp', 'png'], extPriority: true } }).images.get('a') === 'images/alt/a.webp' && prep({ imageIndex: { ext: ['png', 'webp'], extPriority: true } }).images.get('a') === 'images/bg/a.png')
  // 别名路径经 createIndexResolver 核对：大小写 / 扩展名规则
  check('monmusu 别名路径走 createIndexResolver：脚本写 images/Logo.png、磁盘是 logo.png → 取索引里的真实路径（默认 caseInsensitive）；索引里没有的路径原样', d.images.get('logo') === 'images/logo.png' && mmPrepare({ texts: { s: 'image q = "images/Q.png"' }, files: [], toResourcePath: (r) => r }).images.get('q') === 'images/Q.png')
  const fb = mmPrepare({ texts: { s: 'image bgx = "images/bg/zz.jpg"' }, files: ['game/images/bg/zz.webp'], toResourcePath: (r) => r.replace(/^game\//, ''), resourceResolve: { extensionFallbacks: { '.jpg': ['.webp'] } } })
  check('monmusu 别名路径 + config.resourceResolve.extensionFallbacks：.jpg 写法 → 索引里的 .webp；没有规则 = 原样', fb.images.get('bgx') === 'images/bg/zz.webp' && mmPrepare({ texts: { s: 'image bgx = "images/bg/zz.jpg"' }, files: ['game/images/bg/zz.webp'], toResourcePath: (r) => r.replace(/^game\//, '') }).images.get('bgx') === 'images/bg/zz.jpg')
}

// ================= legeclo =================
const LEG_SCRIPT = 'label H_a_01:\n    $ enable_skip()\n    scene bg1\n    show spr at pos_left\n    show spr2 at right\n    "narr"\n    e "var line"\n    play voice "v/1.ogg"\n    play sound "s.ogg"\n    stop music fadeout (2)\n'
const legCtx = legPrepare({ texts: {}, files: ['game/images/bg1.png', 'game/images/sprite/spr.png', 'game/images/sprite/spr2.png'], toResourcePath: (r) => r.replace(/^game\//, '') })
{
  const base = legParse(LEG_SCRIPT, legCtx)
  const stands = (r) => all(r).filter((c) => c.op === 'stand').map((c) => c.parts.map((p) => `${p.src}:${p.align ?? ''}`).join('+'))
  check('legeclo 默认：显式写出 DEFAULT_OPTIONS 结果不变；at right → right，未知变换名（pos_left）→ 不写 align', dropMeta(legParse(LEG_SCRIPT, legCtx, meta(LEG_DEFAULTS))) === dropMeta(base) && stands(base).join() === 'images/sprite/spr.png:+images/sprite/spr2.png:right', J(stands(base)))
  const al = legParse(LEG_SCRIPT, legCtx, meta({ align: { ...LEG_DEFAULTS.align, pos_left: 'left' } }))
  check('legeclo align：表里加 pos_left → left，立绘部件带 align', stands(al).join() === 'images/sprite/spr.png:left+images/sprite/spr2.png:right')
  check('legeclo align = {}：全部不写 align；非法值（带空格 / 空）被丢弃', stands(legParse(LEG_SCRIPT, legCtx, meta({ align: {} }))).join() === 'images/sprite/spr.png:+images/sprite/spr2.png:' && stands(legParse(LEG_SCRIPT, legCtx, meta({ align: { right: 'a b' } }))).join() === 'images/sprite/spr.png:+images/sprite/spr2.png:')
  check('legeclo 默认：变量写法 e "…" 记 raw；speakers 配了 → speaker', base.stats.raw.e === 1 && speakers(legParse(LEG_SCRIPT, legCtx, meta({ speakers: { e: 'Eve' } }))).includes('Eve'))
  check('legeclo audioCommands / stop：music 声道可配，stop 跟着', all(legParse('label H_x:\n    play bgm "b.mp3"\n    "t"\n    stop bgm\n', null, meta({ audioCommands: { music: ['bgm'] } }))).map((c) => c.op).join() === 'bgm,text,bgmStop')
  check('legeclo voiceNoQuote：[变量] 按表替换；默认 raw', all(legParse('label H_x:\n    play voice [v]\n    "t"\n', null, meta({ voiceNoQuote: { variables: { v: 'vo/1.ogg' } } }))).some((c) => c.op === 'voice' && c.src === 'vo/1.ogg') && legParse('label H_x:\n    play voice [v]\n').stats.raw['play voice'] === 1)
  check('legeclo blackRes 默认认 black / x_black1；配了别的正则覆盖', all(legParse('label H_x:\n    scene bg_black2\n')).some((c) => c.color) && !all(legParse('label H_x:\n    scene bg_black2\n', null, meta({ blackRes: ['^black$'] }))).some((c) => c.color))
  check('legeclo flow.conditionals = ignore 同样生效', texts(legParse('label H_x:\n    if a:\n        "A" "in"\n    "B" "out"\n', null, meta({ flow: { conditionals: 'ignore' } }))).join() === 'out')
  const legText = 'label H_x:\n    $ enable_skip()\n'
  check('legeclo sniff 选项：labelRe 可改；markerRes 可改', legSniff(legText) && !legSniff(legText, { sniff: { labelRe: '^\\s*label\\s+G_' } }) && legSniff('label G_x:\n    $ enable_skip()\n', { sniff: { labelRe: '^\\s*label\\s+G_\\w+\\s*:' } }) && !legSniff(legText, { sniff: { markerRes: ['^\\s*zzz'] } }))
  check('legeclo 上下文选项：aliasFiles / imageDirs 默认同 monmusu；imageIndex 通过 legeclo 自己的 options 生效', legPrepare({ options: { imageIndex: { ext: ['webp'] } }, texts: {}, files: ['game/images/a.png', 'game/images/b.webp'], toResourcePath: (r) => r }).images.size === 1)
}

// ================= minashigo =================
const MG_STAND = 'layeredimage standimage:\n    attribute a:\n        im.Crop("images/stand/x.png",(0,0,10,20))\n    attribute b:\n        im.Atlas("images/stand/x.png",(1,2,3,4))\n'
const mgCtx = () => mgPrepare({ texts: { s: MG_STAND }, files: ['game/images/bg1.png'], toResourcePath: (r) => r.replace(/^game\//, '') })
const MG_SCRIPT = 'label scene_1:\n    $ name= "Nana"\n    scene bg1 with Dissolve(0.5)\n    show standimage a\n    xyz "line one"\n    e2 "line two"\n    "Zed" "named"\n    play voice2 \'v/1.ogg\'\n    play bgm "weird" "x"\n    play movie "m.ogg"\n    with flash2\n    show black with Dissolve(1)\n    hide black\n    "end"\n'
{
  const ctx = mgCtx()
  const base = mgParse(MG_SCRIPT, ctx)
  check('minashigo 默认：显式写出 DEFAULT_OPTIONS 结果不变；$ name= 设说话人，变量写法沿用它，"名字" "台词" 用字面名', dropMeta(mgParse(MG_SCRIPT, ctx, meta(MG_DEFAULTS))) === dropMeta(base) && speakers(base).join() === 'Nana,Nana,Zed,Nana', J(speakers(base)))
  check('minashigo 默认：voice2 → voice，其它声道 → se，flash2 → flash count 2，立绘按 crop 裁剪', all(base).some((c) => c.op === 'voice') && all(base).filter((c) => c.op === 'se').length === 2 && all(base).some((c) => c.op === 'flash' && c.count === 2 && c.color === 'white') && all(base).find((c) => c.op === 'stand').parts[0].crop.join() === '0,0,10,20', ops(base))
  const sp = mgParse(MG_SCRIPT, ctx, meta({ speakers: { xyz: 'X-Name' } }))
  check('minashigo speakers 表：变量 xyz 用表里的名字，其它变量仍用 $ name', speakers(sp).includes('X-Name') && speakers(sp)[1] === 'Nana', J(speakers(sp)))
  const svNone = mgParse(MG_SCRIPT, ctx, meta({ speakerVars: ['^xyz$'] }))
  check('minashigo speakerVars：只认 xyz；e2 "…" 不再当台词（记 raw）', texts(svNone).includes('line one') && !texts(svNone).includes('line two') && svNone.stats.raw.e2 === 1)
  const nv = mgParse(MG_SCRIPT, ctx, meta({ nameVar: '' }))
  check('minashigo nameVar = ""：$ name= 不再设说话人，单字符串台词是旁白', speakers(nv)[0] === '' && !speakers(nv).includes('Nana'))
  const nv2 = mgParse('label a:\n    $ who = "W"\n    xyz "t"\n', null, meta({ nameVar: 'who' }))
  check('minashigo nameVar = who：$ who = "…" 设说话人', speakers(nv2).join() === 'W')
  const tags = mgParse('label a:\n    show spr a\n    "t"\n', mgPrepare({ options: { standTags: ['spr'] }, texts: { s: MG_STAND.replace('standimage', 'spr') }, files: [], toResourcePath: (r) => r }), meta({ standTags: ['spr'] }))
  check('minashigo standTags：换 tag 名（layeredimage spr）立绘照出；默认 tag 下 spr 记 raw', all(tags).some((c) => c.op === 'stand') && mgParse('label a:\n    show spr a\n    "t"\n').stats.raw['show spr'] === 1)
  const atlas = mgPrepare({ options: { cropForms: ['im\\.Atlas\\(\\s*"(?<path>[^"]+)"\\s*,\\s*\\(\\s*(?<x>-?\\d+)\\s*,\\s*(?<y>-?\\d+)\\s*,\\s*(?<w>\\d+)\\s*,\\s*(?<h>\\d+)\\s*\\)\\s*\\)'] }, texts: { s: MG_STAND }, files: [], toResourcePath: (r) => r })
  check('minashigo cropForms：默认认 im.Crop（b 属性的 im.Atlas 当没有图）；配了 im.Atlas 才认', !mgCtx().stands.get('standimage').has('b') && mgCtx().stands.get('standimage').get('a').crop.join() === '0,0,10,20' && atlas.stands.get('standimage').get('b').crop.join() === '1,2,3,4' && !atlas.stands.get('standimage').has('a'))
  const ac = mgParse(MG_SCRIPT, ctx, meta({ audioCommands: { se: ['movie'], other: 'raw' } }))
  check('minashigo audioCommands：other=raw 后 play bgm "weird" "x" 记 raw，play movie 在 se 表里 → se', ac.stats.raw['play bgm'] === 1 && all(ac).filter((c) => c.op === 'se').length === 1)
  const fl = mgParse(MG_SCRIPT, ctx, meta({ flash: { counts: { flash2: 7 }, seconds: 0.1, color: '#fff' } }))
  check('minashigo flash：次数表 / 秒数 / 颜色可配', all(fl).some((c) => c.op === 'flash' && c.count === 7 && c.seconds === 0.1 && c.color === '#fff'))
  const ft = mgParse(MG_SCRIPT, ctx, meta({ fadeTags: [] }))
  check('minashigo fadeTags：默认 black → fade；配成空后 show black 记 raw', all(base).some((c) => c.op === 'fade' && c.to === 'black') && !all(ft).some((c) => c.op === 'fade') && ft.stats.raw['show black'] === 1)
  check('minashigo blackRes：默认 ^black\\d*$；改正则', all(mgParse('label a:\n    scene black2\n')).some((c) => c.color) && !all(mgParse('label a:\n    scene black2\n', null, meta({ blackRes: ['^dark$'] }))).some((c) => c.color))
  check('minashigo flow.menu = linear / conditionals = ignore', texts(mgParse('label a:\n    menu:\n        "Yes":\n            xyz "a"\n    if x:\n        xyz "b"\n    xyz "c"\n', null, meta({ flow: { menu: 'linear', conditionals: 'ignore' } }))).join() === 'a,c')
  check('minashigo sniff 选项：markerRes 可改', mgSniff('label s:\n    $ name= "x"\n') && !mgSniff('label s:\n    $ name= "x"\n', { sniff: { markerRes: ['^\\s*zzz'] } }))
  check('minashigo voiceNoQuote：play voice2 [v]', all(mgParse('label a:\n    play voice2 [v]\n    xyz "t"\n', null, meta({ voiceNoQuote: { variables: { v: 'a/b.ogg' } } }))).some((c) => c.op === 'voice' && c.src === 'a/b.ogg'))
}

// ================= uviewer-csv =================
{
  const SCRIPT = 'bg,images/a.png,0.5\nbg,color_10_20_30,0\nname,Ann\nmsg,0,hello, world\nplayvoice,0,voice/1.ogg\nselect,選項1　Yes,選項2　No\nif,select_===_1\nmsg,0,picked yes\nendif\nif,route_===_a\nmsg,0,route a\nendif\nclickwait\n'
  const base = uvParse(SCRIPT)
  const msgs = (r) => all(r).filter((c) => c.op === 'text').map((c) => c.segments.map((s) => s.text).join(''))
  check('uviewer 默认：显式 DEFAULT_OPTIONS 结果不变；台词取第一个逗号后的整段；未知变量 route 的块带 when 条件（不可见）', dropMeta(uvParse(SCRIPT, null, meta(UV_DEFAULTS))) === dropMeta(base) && msgs(base).includes('hello, world') && all(base).find((c) => c.op === 'text' && c.segments[0].text === 'route a').when[0].var === 'route', J(msgs(base)))
  check('uviewer 默认：playvoice 取第二个参数；bg color_ → 纯色；选项前缀「選項N」去掉；choice.var = select', all(base).find((c) => c.op === 'voice').src === 'voice/1.ogg' && all(base).find((c) => c.op === 'bg' && c.color).color.join() === '10,20,30' && all(base).find((c) => c.op === 'choice').options.map((o) => o.segments[0].text).join() === 'Yes,No' && all(base).find((c) => c.op === 'choice').var === 'select')

  check('uviewer msg.textArgIndex：2 → 取第二个逗号之后', msgs(uvParse('msg,a,b,c\n', null, meta({ msg: { textArgIndex: 2 } }))).join() === 'c' && msgs(uvParse('msg,a,b,c\n')).join() === 'b,c')
  check('uviewer msg.singleArgText：msg,<text> 单参数形式默认空，开启后取整段', msgs(uvParse('msg,hello\n')).join() === '' && msgs(uvParse('msg,hello\n', null, meta({ msg: { singleArgText: true } }))).join() === 'hello' && msgs(uvParse('msg,0,two\n', null, meta({ msg: { singleArgText: true } }))).join() === 'two')
  check('uviewer playvoice.pathArgIndex：0 → 第一个参数；2 → 第三个，不够时取第一个', all(uvParse('playvoice,a.ogg,b.ogg,c.ogg\n', null, meta({ playvoice: { pathArgIndex: 0 } })))[0].src === 'a.ogg' && all(uvParse('playvoice,a.ogg,b.ogg,c.ogg\n', null, meta({ playvoice: { pathArgIndex: 2 } })))[0].src === 'c.ogg' && all(uvParse('playvoice,a.ogg\n', null, meta({ playvoice: { pathArgIndex: 2 } })))[0].src === 'a.ogg' && all(uvParse('playvoice,a.ogg,b.ogg\n'))[0].src === 'b.ogg')
  check('uviewer bg.colorPrefix：改前缀 / 清空 = 没有纯色写法', all(uvParse('bg,solid_1_2_3,0\n', null, meta({ bg: { colorPrefix: 'solid_' } })))[0].color.join() === '1,2,3' && all(uvParse('bg,color_1_2_3,0\n', null, meta({ bg: { colorPrefix: '' } })))[0].src === 'color_1_2_3')
  check('uviewer select.prefixRe：默认去「選項N」；清空后保留；自定义前缀', all(uvParse('select,選項1　Yes\n', null, meta({ select: { prefixRe: '' } })))[0].options[0].segments[0].text.includes('選項1') && all(uvParse('select,A) Yes,B) No\n', null, meta({ select: { prefixRe: '^[A-Z]\\)\\s*' } })))[0].options.map((o) => o.segments[0].text).join() === 'Yes,No')
  check('uviewer select.var：choice 指令的变量名可配', all(uvParse('select,a,b\n', null, meta({ select: { var: 'pick' } })))[0].var === 'pick')

  const seeded = uvParse(SCRIPT, null, meta({ conditions: { vars: { route: 'a' } } }))
  check('uviewer conditions.vars：route=a → route a 块的条件在解析时判定成立（无 when）；select 的条件不受影响', msgs(seeded).includes('route a') && !all(seeded).find((c) => c.op === 'text' && c.segments[0].text === 'route a').when && all(seeded).find((c) => c.op === 'text' && c.segments[0].text === 'picked yes').when[0].var === 'select')
  const seeded2 = uvParse(SCRIPT, null, meta({ conditions: { vars: { route: 'b' } } }))
  check('uviewer conditions.vars：route=b → 不成立的块不输出；else / 取反分支按值判定', !msgs(seeded2).includes('route a') && msgs(uvParse('if,route_===_a\nmsg,0,A\nelse\nmsg,0,B\nendif\n', null, meta({ conditions: { vars: { route: 'b' } } }))).join() === 'B' && msgs(uvParse('if,route_===_a\nmsg,0,A\nelse\nmsg,0,B\nendif\n', null, meta({ conditions: { vars: { route: 'a' } } }))).join() === 'A' && msgs(uvParse('if,lv_>=_3\nmsg,0,hi\nendif\n', null, meta({ conditions: { vars: { lv: 5 } } }))).join() === 'hi')

  const AL = 'bgx,images/a.png,0\nsay,0,hello\nclickwait\n'
  const alias = { commands: { aliases: { bgx: 'bg', say: 'msg' } } }
  check('uviewer commands.aliases：别名按规范指令处理（默认 = 原样 raw）；嗅探认别名', all(uvParse(AL, null, meta(alias)))[0].op === 'bg' && msgs(uvParse(AL, null, meta(alias))).join() === 'hello' && all(uvParse(AL))[0].op === 'raw' && !uvSniff(AL) && uvSniff(AL, alias))
  check('uviewer commands.known / rawHints：嗅探用的名字表（整体替换）', uvSniff('foo,1\nbar,2\nbaz,3\n', { commands: { known: ['foo', 'bar', 'baz'] } }) && !uvSniff('foo,1\nbar,2\nbaz,3\n') && uvSniff('foo,1\nbar,2\nbaz,3\n', { commands: { rawHints: ['foo', 'bar', 'baz'] } }) && !uvSniff('bg,a,0\nmsg,0,x\nwait,1\n', { commands: { known: ['zzz'], rawHints: [] } }))
  check('uviewer sniff.minLines / minKnownRatio / maxLines', uvSniff('bg,a,0\nmsg,0,x\nwait,1\n') && !uvSniff('bg,a,0\nmsg,0,x\n') && uvSniff('bg,a,0\nmsg,0,x\n', { sniff: { minLines: 2 } }) && !uvSniff('bg,a,0\nmsg,0,x\nzzz,1\nyyy,1\n') && uvSniff('bg,a,0\nmsg,0,x\nzzz,1\nyyy,1\n', { sniff: { minKnownRatio: 0.5 } }) && uvSniff('bg,a,0\nmsg,0,x\nwait,1\nzzz,1\nyyy,1\nxxx,1\n', { sniff: { maxLines: 3 } }) && !uvSniff('bg,a,0\nmsg,0,x\nwait,1\nzzz,1\nyyy,1\nxxx,1\n'))
  check('uviewer 默认 sniff 不变：非指令行（不是字母数字下划线开头）直接否决；非法选项值回到默认', !uvSniff('{"a":1}\nx\ny\n') && uvSniff('bg,a,0\nmsg,0,x\nwait,1\n', { sniff: { minLines: -1, minKnownRatio: 7 }, msg: { textArgIndex: 'x' } }))
}

// ================= 端到端：config.adapterOptions → loadAdapterContext → buildScene =================
const work = await mkdtemp(path.join(os.tmpdir(), 'gal-opt-c-'))
const put = async (rel, content = 'x') => { const abs = path.join(work, rel); await mkdir(path.dirname(abs), { recursive: true }); await writeFile(abs, content) }
const endToEnd = async (id, adapterOptions, media, text, extra = {}) => {
  const config = normalizeGalConfig({ adapterOptions: { [id]: adapterOptions }, resourceRoots: ['game'], ...extra })
  const ctx = await loadAdapterContext({ adapter: galAdapter(id), mediaDir: media, config })
  return buildScene(id, text, ctx, { options: config.adapterOptions[id] || {}, config: galConfigView(config) })
}
try {
  await put('mm/game/script/aliases.rpy', 'image intro = Movie(play="video/i.webm")\nimage bgalias = "art/bg/Case.png"\n')
  await put('mm/game/art/bg/case.png')
  await put('mm/game/art/alt/room.png')
  await put('mm/game/art/bg/room.png')
  const mmText = 'label h1:\n    scene intro\n    scene bgalias\n    scene room\n    e "hi"\n    play voice [vid]\n'
  const mmOptions = { aliasFiles: ['game/script/aliases.rpy'], imageDirs: ['game/art'], imageIndex: { preferDirs: ['art/bg'] }, speakers: { e: 'Eve' }, voiceNoQuote: { variables: { vid: 'voice/9.ogg' } } }
  const mmDefault = await endToEnd('renpy-monmusu', {}, path.join(work, 'mm'), mmText)
  const mmScene = await endToEnd('renpy-monmusu', mmOptions, path.join(work, 'mm'), mmText)
  check('端到端 monmusu：默认（路径没配）→ 全是 raw；配了别名文件 / 图片目录 / preferDirs / speakers / voiceNoQuote → 视频、背景（取 art/bg 下的 room）、说话人、语音', mmDefault.stats.unresolved.intro === 1 && all(mmScene)[0].op === 'movie' && all(mmScene).filter((c) => c.op === 'bg').map((c) => c.src).join() === 'art/bg/case.png,art/bg/room.png' && speakers(mmScene).join() === 'Eve' && all(mmScene).some((c) => c.op === 'voice' && c.src === 'voice/9.ogg'), J(all(mmScene)))

  await put('leg/game/images/bg1.png')
  await put('leg/game/images/sprite/s.png')
  const legText = 'label H_x:\n    $ enable_skip()\n    scene bg1\n    show s at pos_r\n    "n"\n'
  const legBase = await endToEnd('renpy-legeclo', { imageDirs: ['game/images'] }, path.join(work, 'leg'), legText)
  const legCfg = await endToEnd('renpy-legeclo', { imageDirs: ['game/images'], align: { pos_r: 'right' } }, path.join(work, 'leg'), legText)
  check('端到端 legeclo：config.adapterOptions[…].align 把 pos_r 映射成 right（默认没有 align）', all(legBase).find((c) => c.op === 'stand').parts[0].align === undefined && all(legCfg).find((c) => c.op === 'stand').parts[0].align === 'right', J(all(legCfg)))

  await put('mg/game/script.rpy', 'layeredimage standimage:\n    attribute a:\n        "images/stand/a.png"\n')
  await put('mg/game/images/bg1.png')
  const mgText = 'label s:\n    $ name= "N"\n    scene bg1\n    show standimage a\n    zed "hi"\n    play voice9 "v/1.ogg"\n'
  const mgBase = await endToEnd('renpy-minashigo', {}, path.join(work, 'mg'), mgText)
  const mgCfg = await endToEnd('renpy-minashigo', { speakers: { zed: 'Zed' }, audioCommands: { voice: ['voice9'], other: 'raw' } }, path.join(work, 'mg'), mgText)
  check('端到端 minashigo：默认 voice9 → voice（voice* 通配）、zed 沿用 $ name；配 speakers / audioCommands 后 zed → Zed', speakers(mgBase).includes('N') && all(mgBase).some((c) => c.op === 'voice') && speakers(mgCfg).includes('Zed') && all(mgCfg).some((c) => c.op === 'voice') && all(mgCfg).find((c) => c.op === 'stand'), J(all(mgCfg)))

  const uvText = 'name,Ann\nsay,0,hi\nif,route_===_a\nmsg,0,A\nendif\nclickwait\n'
  const uvBase = await endToEnd('uviewer-csv', {}, work, uvText)
  const uvCfg = await endToEnd('uviewer-csv', { commands: { aliases: { say: 'msg' } }, conditions: { vars: { route: 'a' } } }, work, uvText)
  check('端到端 uviewer-csv：默认 say 记 raw、route 块不可见；配了别名和变量 → 台词都在、块无条件', uvBase.stats.raw.say === 1 && all(uvBase).find((c) => c.segments?.[0]?.text === 'A').when && texts(uvCfg).join() === 'hi,A' && !all(uvCfg).find((c) => c.segments?.[0]?.text === 'A').when, J(all(uvCfg)))
} finally {
  await rm(work, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
