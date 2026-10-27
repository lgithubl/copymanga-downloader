#!/usr/bin/env node
// 自测：第 12–14 轮样本（gal-samples12 / 13 / 14）定位出来的修复。一组一个块：
//   1. Fruits VIDEO_PLAY = 名字,速度,循环(1/0)（原版查看器 scene.js）；Girls Creation = 名字,loop|once|wait,速度
//   2a. Girls Creation（tag）：VIDEO_PLAY 时台上的 spine 角色先收起来（原版 scene.js），不是换背景；换背景不收
//   2. Otogi Frontier R：角色卡按 VieableEpisodeList 的文件分组（同一角色的形态变体不再拆成几张卡）——测试在 gal-otogi-selftest.mjs，这里不重复
//   3. ミナシゴノシゴトR：按脚本编号形状分组（gal-layout LAYOUTS.minashigo_r.config.groups）
//   node scripts/dev/gal-r12-fixes-selftest.mjs
import { stateAt } from '../../web/static/gal-engine.js'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify

// ---- 1. VIDEO_PLAY ----
{
  const gc = await import('../../web/library/gal/adapters/girlscreation-tag.mjs')
  const ctx = gc.prepare({ options: { root: 'pk' }, texts: {}, files: ['pk/scenes/c_1/script.txt', 'pk/scenes/c_1/videos/v-1.mp4', 'pk/scenes/c_1/videos/v-2.mp4', 'pk/scenes/c_1/videos/v-3.mp4', 'pk/scenes/c_1/videos/v-4.mp4'], toResourcePath: (r) => r })
  const movies = (text) => gc.parse(text, ctx, { rel: 'c_1/script.txt' }).steps.flatMap((st) => st.commands).filter((c) => c.op === 'movie')
  const fruits = movies(['<VIDEO_PLAY>v-1,1,1', '<NAME_PLATE>A', 'a', '<PAUSE>', '<VIDEO_PLAY>v-2,0.5,1', '<NAME_PLATE>A', 'b', '<PAUSE>', '<VIDEO_PLAY>v-3,1,0', '<NAME_PLATE>A', 'c', '<PAUSE>', ''].join('\n'))
  check('Fruits：VIDEO_PLAY 名,速度,循环 —— 第 3 项 1 = 循环，0 = 不循环；第 2 项是速度（不是循环）', fruits.length === 3 && fruits[0].loop === true && fruits[1].loop === true && fruits[2].loop === false, J(fruits))
  check('Fruits：速度不是 1 才带 rate（0.5 → rate 0.5；1 不写）', fruits[1].rate === 0.5 && !('rate' in fruits[0]) && !('rate' in fruits[2]), J(fruits))
  const gcs = movies(['<VIDEO_PLAY>v-1,loop,1', '<NAME_PLATE>A', 'a', '<PAUSE>', '<VIDEO_PLAY>v-2,once,2', '<NAME_PLATE>A', 'b', '<PAUSE>', '<VIDEO_PLAY>v-3,wait,1', '<NAME_PLATE>A', 'c', '<PAUSE>', '<VIDEO_PLAY>v-4', '<NAME_PLATE>A', 'd', '<PAUSE>', ''].join('\n'))
  check('Girls Creation / Aku：VIDEO_PLAY 名,loop|once|wait,速度 —— loop 循环，once / wait 不循环，第 3 项是速度；没写默认循环', gcs.length === 4 && gcs[0].loop === true && gcs[1].loop === false && gcs[1].rate === 2 && gcs[2].loop === false && gcs[3].loop === true, J(gcs))
  check('引擎：movie 的 rate 记进 state.movie（没有 rate 就没有这个字段）', J(stateAt({ steps: [{ index: 0, commands: [{ op: 'movie', srcs: ['a.mp4'], loop: true, rate: 0.5 }] }] }, 0, {}).movie) === J({ srcs: ['a.mp4'], loop: true, rate: 0.5 }) && J(stateAt({ steps: [{ index: 0, commands: [{ op: 'movie', srcs: ['a.mp4'], loop: true }] }] }, 0, {}).movie) === J({ srcs: ['a.mp4'], loop: true }))
}

// ---- 2a. Girls Creation：VIDEO_PLAY 收角色，换背景不收 ----
{
  const gc = await import('../../web/library/gal/adapters/girlscreation-tag.mjs')
  const ctx = gc.prepare({ options: { root: 'pk' }, texts: {}, files: ['pk/scenes/c_1/script.txt', 'pk/scenes/c_1/videos/v.mp4', 'pk/scenes/c_1/images/bg1.png', 'pk/scenes/c_1/images/bg2.png', 'pk/scenes/c_1/spines/ch.skel', 'pk/scenes/c_1/spines/ch.atlas'], toResourcePath: (r) => r })
  const run = (lines) => gc.parse(lines.join('\n') + '\n', ctx, { rel: 'c_1/script.txt' }).steps.map((st) => st.commands.map((c) => c.op))
  const A = ['<SPINE_ACTOR>0,ch,,,,0,0,x=0|y=0,1,skel']
  const bgChange = run([...A, '<BG>bg1,NONE,0', '<NAME_PLATE>甲', 'a', '<PAUSE>', '<BG>bg2,NONE,0', '<NAME_PLATE>甲', 'b', '<PAUSE>']).flat()
  check('GC（tag）：换背景（BG）不收台上的角色（原版 BG 不碰 actors）', !bgChange.includes('spineOff') && bgChange.filter((o) => o === 'spine').length >= 1, J(bgChange))
  const video = run([...A, '<NAME_PLATE>甲', 'a', '<PAUSE>', '<VIDEO_PLAY>v,loop,1', '<NAME_PLATE>甲', 'b', '<PAUSE>'])
  const flat = video.flat()
  check('GC（tag）：VIDEO_PLAY 时台上的 spine 角色先 spineOff 再放视频（原版：视频播放时还亮着的角色一律藏起来）', flat.indexOf('spineOff') >= 0 && flat.indexOf('spineOff') < flat.indexOf('movie'), J(video))
  const again = run([...A, '<NAME_PLATE>甲', 'a', '<PAUSE>', '<VIDEO_PLAY>v,loop,1', '<NAME_PLATE>甲', 'b', '<PAUSE>', '<VIDEO_STOP>', ...A, '<NAME_PLATE>甲', 'c', '<PAUSE>']).flat()
  check('GC（tag）：视频之后同一个角色再 SPINE_ACTOR → 重新出现（spine 指令又发一次）', again.filter((o) => o === 'spine').length === 2, J(again))
  const none = run(['<VIDEO_PLAY>v,loop,1', '<NAME_PLATE>甲', 'a', '<PAUSE>']).flat()
  check('GC（tag）：台上没有角色时 VIDEO_PLAY 不发 spineOff', !none.includes('spineOff') && none.includes('movie'), J(none))
}

// ---- 2b. GC 行式脚本：cgmode,on 收起角色，cgmode,off 摆回来 ----
{
  const { parseLine } = await import('../../web/library/gal/adapters/girlscreation-line.mjs')
  const gcTag = await import('../../web/library/gal/adapters/girlscreation-tag.mjs')
  const files = ['pk/scenes/chmr_1/hmr_1.txt', 'pk/scenes/chmr_1/images/abg1.png', 'pk/scenes/chmr_1/images/abg2.png', 'pk/scenes/chmr_1/spines/st1.skel', 'pk/scenes/chmr_1/spines/st1.atlas', 'pk/scenes/chmr_1/videos/v.mp4']
  const run = (text, options) => parseLine(text, gcTag.prepare({ options: { root: 'pk', ...(options || {}) }, texts: {}, files, toResourcePath: (r) => r }), { rel: 'chmr_1/hmr_1.txt', stem: 'hmr_1', options }).steps.map((st) => st.commands.map((c) => c.op + (c.slot ? `:${c.slot}` : '')))
  const script = ['bg,abg1,0,0,1,1', 'chara,st1,chara_1,0,0,10,1,1,1,on', 'charamotion,chara_1,loop,on', 'message,甲,a,x', 'cgmode,on', 'playmovie,v,loop', 'charamotion,chara_1,joy,on', 'message,甲,b,x', 'stopmovie', 'cgmode,off', 'message,甲,c,x', ''].join('\n')
  const flat = run(script).flat()
  const seq = flat.filter((o) => o.startsWith('spine'))
  check('行式 cgmode,on → 台上的角色 spineOff；CG 期间的 charamotion 只记状态不画；cgmode,off → 角色摆回来（spine 又发一次）；不再动文本框（没有 ui 指令）', J(seq) === J(['spine:Actor1', 'spine:Actor1', 'spineOff:Actor1', 'spine:Actor1']) && !flat.includes('ui'), J(run(script)))
  const old = run(script, { commands: { cgmode: 'ui' } }).flat()
  check("commands.cgmode = 'ui'：旧行为（on 隐藏文本框、off 显示），不动角色", old.filter((o) => o === 'ui').length === 2 && !old.some((o) => o.startsWith('spineOff')), J(old))
  const none = run(['bg,abg1,0,0,1,1', 'cgmode,on', 'cgmode,off', 'message,甲,a,x', ''].join('\n')).flat()
  check('台上没有角色时 cgmode 不发任何指令', !none.some((o) => o.startsWith('spine')), J(none))
}

// ---- 3. ミナシゴノシゴトR 分组 ----
{
  const { LAYOUTS } = await import('../../scripts/tag-scripts/gal-layout/main.js')
  const rules = LAYOUTS.minashigo_r.config.groups.map((g) => new RegExp(g.pattern))
  const keyOf = (name) => { for (const re of rules) { const m = re.exec(name); if (m) return m[1] } return null }
  const cases = { 120090312: '200903', '120090312N': '200903', 630150102: '630150', '630150102N': '630150', 2100002: '2100002', '2100002E': '2100002', '2100002N': '2100002', 100021: '1000', ev001_01_01: 'ev001', ev002_01_03N: 'ev002', ev002_01_03X: 'ev002', ex006_10: 'ex006', audition00: 'audition', audition2_00: 'audition', audition4001_1M: 'audition' }
  const wrong = Object.entries(cases).filter(([n, k]) => keyOf(n) !== k).map(([n, k]) => `${n}: want ${k} got ${keyOf(n)}`)
  check('ミナシゴノシゴトR：角色 / 6 开头角色 / 主线章节（难度后缀合成一张）/ 6 位编号 / 活动 ev（N / X 后缀）/ 番外 ex / 试镜 都能分到组', wrong.length === 0, wrong.join('; '))
  check('ミナシゴノシゴトR：规则是数组（七条），不是单条', Array.isArray(LAYOUTS.minashigo_r.config.groups) && LAYOUTS.minashigo_r.config.groups.length === 7)
}

// ---- 3b. ぼくら：资源目录按数字 id 找（脚本名 <角色> 【标题】<id>，资源目录 <id> 【标题】<角色>）----
{
  const bk = await import('../../web/library/gal/adapters/bokusen-json.mjs')
  const { compileBokusen } = await import('./make-bokusen-fixture.mjs')
  const text = JSON.stringify(compileBokusen({ images: ['a.jpg'], sounds: [], articles: ['台詞'], script: [['image', { 15: 'base', 16: 0, 23: 'fore', 28: 0, 29: 0 }], ['articles', { 0: 0 }], ['p']] }))
  const files = ['resource/502704 【花嫁】みやび/images/0.jpg', 'resource/502704 【花嫁】みやび/sounds/0.wav', 'resource/4733 【体育祭25】コニー/images/0.jpg', 'resource/1111 A/images/0.jpg', 'resource/1111 B/images/0.jpg']
  const ctx = bk.prepare({ options: {}, files, toResourcePath: (r) => r })
  const bgOf = (stem, options) => bk.parse(text, bk.prepare({ options: options || {}, files, toResourcePath: (r) => r }), { stem, options }).steps.flatMap((st) => st.commands).filter((c) => c.op === 'bg' || c.op === 'stand')
  const srcs = (stem, options) => J(bgOf(stem, options)).match(/resource\/[^"]+|[0-9]{4,6} [^"]+\/images\/0\.jpg/g) || []
  check('ぼくら：脚本名 みやび 【花嫁】502704（id 在最后）→ 资源目录 502704 【花嫁】みやび（id 在最前），按数字 id 找到图', J(bgOf('みやび 【花嫁】502704')).includes('502704 【花嫁】みやび/images/0.jpg'), J(bgOf('みやび 【花嫁】502704')))
  check('ぼくら：年份那种两位数字（【体育祭25】）不算 id；4 位 id 4733 也能找到', J(bgOf('コニー 【体育祭25】4733')).includes('4733 【体育祭25】コニー/images/0.jpg'), J(bgOf('コニー 【体育祭25】4733')))
  check('ぼくら：同一个 id 对应多个目录（1111 A / 1111 B）→ 不猜，回到按脚本名（找不到）；同名目录有就直接用；resourceId.enabled = false → 不按 id 找', !J(bgOf('x 1111')).includes('images/0.jpg') && J(bgOf('502704 【花嫁】みやび')).includes('502704 【花嫁】みやび/images/0.jpg') && !J(bgOf('みやび 【花嫁】502704', { resourceId: { enabled: false } })).includes('images/0.jpg'), J(bgOf('x 1111')))
  check('prepare：资源目录第一层名字收进 topDirs', ctx.topDirs.size === 4 && ctx.topDirs.has('502704 【花嫁】みやび'), J([...ctx.topDirs]))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
