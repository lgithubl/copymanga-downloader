// 规范场景（gal-scene/1）：所有适配器的输出、前端播放器的输入。
//   { format: 'gal-scene/1', adapter, steps: [{ index, commands: [command] }], stats }
// 一步（step）= 玩家点一下之前要执行的全部指令。指令（op）：
//   bg {src|color:[r,g,b], fade}   bgoff {fade}
//   speaker {segments}             text {segments}        （片段 { text, ruby?, style?: { outline?, color?, size?, bold?, italic? } }）
//   choice {id, var, options: [{ value, segments }]}   弹选项（选的序号记进变量 var）；id = 步序号:指令序号，进度里按它存选择
//   bgm {src}  bgmStop {fade}      se {src}   voice {src}
//   movie {srcs[], loop}           movieOff {}
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
//   raw {cmd, args}                适配器认得、播放器暂未实现的指令（立绘/特效等）
import { galAdapter } from './adapters/index.mjs'

export const SCENE_FORMAT = 'gal-scene/1'

// ctx：适配器的媒体上下文（见 context.mjs；没有就不传）
// meta：{ rel, stem } 这份脚本的路径和文件名（有的格式里要用，比如语音目录按场景 id 分）
export function buildScene(adapterId, text, ctx = null, meta = {}) {
  const { steps, stats } = galAdapter(adapterId).parse(text, ctx, meta)
  return { format: SCENE_FORMAT, adapter: adapterId, steps, stats }
}

// 脚本里引用到的第一张背景图（导入时拿来当封面候选）
export function firstBackgroundSrc(scene) {
  for (const step of scene?.steps || []) for (const command of step.commands) if (command.op === 'bg' && command.src) return command.src
  return ''
}
