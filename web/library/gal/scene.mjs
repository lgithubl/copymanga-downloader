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
//   raw {cmd, args}                适配器认得、播放器暂未实现的指令（立绘/特效等）
import { galAdapter } from './adapters/index.mjs'

export const SCENE_FORMAT = 'gal-scene/1'

// ctx：适配器的媒体上下文（见 context.mjs；没有就不传）
export function buildScene(adapterId, text, ctx = null) {
  const { steps, stats } = galAdapter(adapterId).parse(text, ctx)
  return { format: SCENE_FORMAT, adapter: adapterId, steps, stats }
}

// 脚本里引用到的第一张背景图（导入时拿来当封面候选）
export function firstBackgroundSrc(scene) {
  for (const step of scene?.steps || []) for (const command of step.commands) if (command.op === 'bg' && command.src) return command.src
  return ''
}
