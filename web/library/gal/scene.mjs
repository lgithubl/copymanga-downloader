// 规范场景（gal-scene/1）：所有适配器的输出、前端播放器的输入。
//   { format: 'gal-scene/1', adapter, steps: [{ index, commands: [command] }], stats }
// 一步（step）= 玩家点一下之前要执行的全部指令。指令（op）：
//   bg {src|color:[r,g,b], fade}   bgoff {fade}
//   speaker {segments}             text {segments}        （片段 { text, ruby?, style?: { outline?, color?, size?, bold?, italic? } }）
//   choice {id, var, options: [{ value, segments }]}   弹选项（选的序号记进变量 var）；id = 步序号:指令序号，进度里按它存选择
//   bgm {src}  bgmStop {fade}      se {src}   voice {src}
//   movie {srcs[], loop, rate?}    movieOff {}        （rate = 播放速度，缺省 1；Fruits 的 VIDEO_PLAY 带速度）
//   fade {to: 'black'|'clear', seconds}     wait {seconds}
//   任何指令都可以带 when: [{ var, op, value, not? }]（全部成立才执行；变量没设过时一律不成立）——if/elseif/else 分支编译成它
//   spine {slot, kind: 'chara'|'still', skel, atlas, anim, loop, speed, x?, dim?, action?, order?}   Spine 骨骼动画（同 slot 再来一条 = 更新；没有 Spine 运行时的播放器忽略）
//   spineOff {slot?|prefix?}        去掉某个 slot / 某个前缀的全部 / 不写 = 全部
//   camera {from?: [x,y,z,rot?], to: [x,y,z,rot?], seconds}   镜头：位置 + 缩放（z，千分比）+ 可选旋转（第 4 项，度，逆时针为正）；整个画面（背景+视频+Spine）一起动
//   bgse {src, loop}  bgseStop {}    背景音效（独立声道，循环）
//   flash {color, count, seconds}    闪屏 count 次        wash {color, seconds}    整屏纯色渐退成透明
//   ui {visible, seconds}          文本框显示 / 隐藏（看 CG 时）      shake {axis: horizontal|vertical|overall, strength, seconds}   画面抖动（纯装饰）
//   bgvoice {slot, src, volume}    循环的背景人声（多个槽同时播）  bgvoiceOff {slot}
//   bg 可带 over（叠在 src 上面的第二张图，EV 的图 2）；bgScale {scale, seconds, easing} 当前背景缩放；bgBlur {radius} 当前背景模糊（场景像素）——换背景会清掉这两个；
//   bgZoom {scale, x, y}           背景整体缩放 + 平移（ZOOM，场景像素），不跟换背景走
//   stand {parts, slot?, stage?, fade?}   立绘。不带 slot = 整体立绘（旧：part = { src, crop?, zoom, x, y, align?, dim? }，renpy 系用）；带 slot = 按槽位的立绘（同 slot 再来一条 = 替换；多个槽位同时在场，按出现顺序叠）：
//                                  part = { atlas | src, x?, y?, scale?, dim? }；x / y = 原图画布（图集里 = spriteSourceSize 那块）的中心相对舞台中心的偏移，舞台像素、y 向下为正；scale 默认 1，<= 0 = 隐藏；stage = [宽, 高]（x / y / scale 所指的舞台，默认 [1280, 720]）；fade = 槽位第一次出现时淡入的秒数（只在实时播放）
//                                  atlas = { plist, frame | frames, texture?, base? }：Cocos2d plist 图集的一帧——plist / texture 是资源路径（texture 缺省 = plist 换成 .png）；frames = 候选帧名数组（取 plist 里第一个存在的）、frame = 单个帧名；base = 底图帧名数组（存在才画、先画；同一图集的帧共用 spriteSourceSize 画布，各按 spriteOffset 摆放）。播放器拉取并解析 plist（web/static/gal-atlas.js），取不到 / 找不到帧 = 「缺少资源」
//   standOff {slot?, fade?}        去掉某个槽位的立绘；不写 slot = 全部立绘（整体立绘 + 所有槽位）
//   overlay {slot, src?, rect?, color?, alpha?, x?, y?, scaleX?, scaleY?, fit?, fade?, z?, stage?}   叠加层（静态图 / 矩形；TSK Sprite、Girls Creation subimage 等复用）：同 slot 再来一条 = 合并（写了的字段覆盖，没写的保留——只带布局字段的指令就是「改布局」；带 src = 换图、整条替换）。
//                                  src = 图的资源路径，以「舞台中心 + (x, y)」为中心（y 向下为正）画，大小 = 原图 × fit 系数 × (scaleX, scaleY)（默认 1），fit = none | contain | cover（先缩放到舞台大小）；
//                                  rect = [x, y, w, h]（舞台像素、左上角、y 向下；再加 x / y 偏移、宽高乘 scaleX / scaleY）：没有 src 时用 color（默认黑）填这块（rect 缺省 = 整个舞台）；有 src 时 rect 是裁剪窗口；
//                                  alpha 0~1（默认 1）；alpha / scaleX / scaleY <= 0 = 隐藏；z 越大越靠上（同 z 按出现顺序），叠加层整体画在立绘之上；fade = 第一次出现淡入的秒数（只在实时播放）
//   overlayOff {slot?}             去掉某个叠加层；不写 slot = 全部
//   raw {cmd, args}                适配器认得、播放器暂未实现的指令（立绘/特效等）
import { galAdapter } from './adapters/index.mjs'
import { CLASSIFY_AS, CLASSIFY_FROM, CLASSIFY_ON } from './config.mjs'
import { MAX_MATCH_INPUT, compileSafeRegex } from './voice.mjs'

export const SCENE_FORMAT = 'gal-scene/1'

// ctx：适配器的媒体上下文（见 context.mjs；没有就不传）
// meta：{ rel, stem, scene?, options, config } 这份脚本的路径和文件名（有的格式里要用，比如语音目录按场景 id 分）；
//   options = config.adapterOptions[适配器 id]（没有 = {}），config = 引擎配置的只读视图 { classify, resourceResolve, player, limits, indexSkip }（见 config.mjs galConfigView）。
//   没有 prepare 的适配器只能从 meta.options 拿到自己的参数。parse 之后统一过一遍 meta.config.classify（见下）。
export function buildScene(adapterId, text, ctx = null, meta = {}) {
  const { steps, stats, next } = galAdapter(adapterId).parse(text, ctx, meta)
  const after = next?.script ? { next: { script: String(next.script) } } : {}   // 看完这份接着播哪个脚本（适配器给的名字，服务端再补 node）
  const rules = meta?.config?.classify
  if (Array.isArray(rules) && rules.length) {
    const classified = applyClassify(steps, rules)
    return { format: SCENE_FORMAT, adapter: adapterId, steps, stats: { ...(stats || {}), classified }, ...after }
  }
  return { format: SCENE_FORMAT, adapter: adapterId, steps, stats, ...after }
}

// ---------- 音频指令重分类（config.classify）----------
// 规则 { match, on?: 'src'|'speaker'|'text', from?: [op…], as: 'voice'|'se'|'bgm'|'bgse'|'bgvoice'|'drop' }：对每条音频指令，第一条命中的规则生效。
//   on：match 匹配什么——指令的 src（默认）/ 当前说话人（这一步之前最近一条 speaker 指令）/ 这一步第一句有字的台词（台词常在语音之后，所以按整步算）
//   from：只处理这些 op（默认 = 全部音频 op）；as：改成什么，drop = 删掉这条指令
//   改类型时字段保持合理：se / voice / bgm = { src }；bgse 要 loop（原来没有就当循环）；bgvoice 要 slot / volume；指令上的 when 条件一律保留
export const AUDIO_OPS = CLASSIFY_FROM
const plain = (segments) => (Array.isArray(segments) ? segments : []).map((s) => s?.text ?? '').join('').replace(/\s+/g, ' ').trim().slice(0, MAX_MATCH_INPUT)

const classifyCache = new WeakMap()
function compileClassify(rules) {
  if (classifyCache.has(rules)) return classifyCache.get(rules)
  const out = []
  for (const rule of rules) {
    let re = null
    try { re = compileSafeRegex(rule?.match, { flags: 'i', label: 'classify.match' }) } catch { /* 不合格的规则丢掉 */ }
    const on = rule?.on === undefined ? 'src' : rule.on
    if (!re || !CLASSIFY_ON.includes(on) || !CLASSIFY_AS.includes(rule?.as)) continue
    const from = Array.isArray(rule.from) ? rule.from.filter((op) => AUDIO_OPS.includes(op)) : AUDIO_OPS
    if (!from.length) continue
    out.push({ re, on, from, as: rule.as })
  }
  classifyCache.set(rules, out)
  return out
}

function convert(command, as) {
  if (command.op === as) return command
  const base = command.when ? { when: command.when } : {}
  const src = command.src
  if (as === 'bgse') return { op: 'bgse', src, loop: command.loop === undefined ? true : Boolean(command.loop), ...base }
  if (as === 'bgvoice') return { op: 'bgvoice', slot: command.slot ?? 'classified', src, volume: command.volume ?? 1, ...base }
  return { op: as, src, ...base }
}

// 原地改 steps；返回改了几条（改类型 + 删除；命中但类型没变的不算）
export function applyClassify(steps, rules) {
  const compiledRules = compileClassify(rules)
  if (!compiledRules.length) return 0
  let count = 0
  let speaker = ''
  for (const step of steps || []) {
    let stepText = ''
    for (const command of step.commands || []) if (command.op === 'text') { stepText = plain(command.segments); if (stepText) break }
    const next = []
    for (const command of step.commands || []) {
      if (command.op === 'speaker') speaker = plain(command.segments)
      if (!AUDIO_OPS.includes(command.op) || typeof command.src !== 'string' || !command.src) { next.push(command); continue }
      const rule = compiledRules.find((r) => r.from.includes(command.op) && r.re.test(r.on === 'src' ? command.src.slice(0, MAX_MATCH_INPUT) : r.on === 'speaker' ? speaker : stepText))
      if (!rule) { next.push(command); continue }
      if (rule.as === 'drop') { count += 1; continue }
      const converted = convert(command, rule.as)
      if (converted !== command) count += 1
      next.push(converted)
    }
    step.commands = next
  }
  return count
}

// 脚本里引用到的第一张背景图（导入时拿来当封面候选）
export function firstBackgroundSrc(scene) {
  for (const step of scene?.steps || []) for (const command of step.commands) if (command.op === 'bg' && command.src) return command.src
  return ''
}
