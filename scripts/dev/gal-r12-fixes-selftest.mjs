#!/usr/bin/env node
// 自测：第 12–14 轮样本（gal-samples12 / 13 / 14）定位出来的修复。一组一个块：
//   1. Fruits VIDEO_PLAY = 名字,速度,循环(1/0)（原版查看器 scene.js）；Girls Creation = 名字,loop|once|wait,速度
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

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
