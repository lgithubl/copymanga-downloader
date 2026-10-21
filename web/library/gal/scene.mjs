// 规范场景（gal-scene/1）：所有适配器的输出、前端播放器的输入。
//   { format: 'gal-scene/1', adapter, steps: [{ index, commands: [command] }], stats }
// 一步（step）= 玩家点一下之前要执行的全部指令。指令（op）：
//   bg {src|color:[r,g,b], fade}   bgoff {fade}
//   speaker {segments}             text {segments}        （片段 { text, style?: { outline?, color?, bold?, italic? } }）
//   bgm {src}  bgmStop {fade}      se {src}   voice {src}
//   movie {srcs[], loop}           movieOff {}
//   fade {to: 'black'|'clear', seconds}     wait {seconds}
//   raw {cmd, args}                适配器认得、播放器暂未实现的指令（立绘/特效等）
import { galAdapter } from './adapters/index.mjs'

export const SCENE_FORMAT = 'gal-scene/1'

export function buildScene(adapterId, text) {
  const { steps, stats } = galAdapter(adapterId).parse(text)
  return { format: SCENE_FORMAT, adapter: adapterId, steps, stats }
}

// 脚本里引用到的第一张背景图（导入时拿来当封面候选）
export function firstBackgroundSrc(scene) {
  for (const step of scene?.steps || []) for (const command of step.commands) if (command.op === 'bg' && command.src) return command.src
  return ''
}
