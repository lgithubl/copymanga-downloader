#!/usr/bin/env node
// 造 maid 式（Girls Creation 系列里角色骨架放在 package.nw/data/spine/ 下、脸是分层动画）的演示数据，合成的，不含任何原作内容。给 Gal 演示（gal-demo.yml）用：
//   · 首页「表情」入口：两个全局分层脸骨架（cast001001/c1_001、cast002001/c2_001）+ 脚本里用到的预设名（通常 / 喜 / 照れ / 驚き / 慌て …）
//   · 混合模式开关：scenes/fx_blend/ 里有 additive / screen / multiply 的槽
//   node scripts/dev/make-gal-maid-fixture.mjs <输出目录>      → <输出目录>/maid演示
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSpine } from './make-spine-fixture.mjs'

const FACE_ANIMATIONS = ['eye/eye_001', 'eye/eye_002', 'eye/eye_003', 'eyebrow/eyebrow_001', 'eyebrow/eyebrow_002', 'mouse/mouse_001', 'mouse/mouse_002', 'mouse/mouse_003', 'eyemain/eyemain_001', 'eyepos/eyepos_normal', 'cheek/cheek_none', 'cheek/cheek_001', 'highlight/highlight_on', 'sweat/sweat_001']

// 脚本：一个角色一步一个预设，剧情里夹几句旁白
const script = (lines) => lines.join('\n') + '\n'
const talk = (skel, slot, presets) => script([
  `<SPINE_ACTOR>${slot},${skel},,通常,,0,0,x=0|y=0,1,json`,
  '<NAME_PLATE>主人公', '……今天也是个普通的一天。', '<PAUSE>',
  ...presets.flatMap((preset, i) => [`<SPINE_ACTOR_PLAY>${slot},${preset},0,true`, '<NAME_PLATE>角色', `这是第 ${i + 1} 句，表情预设「${preset}」。`, '<PAUSE>']),
])

export async function buildMaidFixture(root) {
  const pk = path.join(root, 'package.nw')
  const scenes = path.join(pk, 'scenes')
  await rm(root, { recursive: true, force: true })
  for (const dir of ['data/audio/bgm', 'data/audio/se']) await mkdir(path.join(pk, dir), { recursive: true })
  // 全局骨架：data/spine/cast/<角色目录>/<骨架名>.json / .atlas / .png
  for (const [dir, base, color] of [['cast001001', 'c1_001', 'goldenrod'], ['cast002001', 'c2_001', 'deepskyblue']]) {
    const spine = path.join(pk, 'data/spine/cast', dir)
    await writeSpine(spine, base, { format: 'json', color, animations: FACE_ANIMATIONS })
    await rename(path.join(spine, `${base}.skel.bytes`), path.join(spine, `${base}.json`))
    await rename(path.join(spine, `${base}.atlas.txt`), path.join(spine, `${base}.atlas`))
  }
  const files = {
    story_1: talk('cast001001/c1_001', 7, ['通常', '喜', '照れ', '驚き']),
    story_2: talk('cast001001/c1_001', 7, ['哀', '喜', '慌て', '大慌て']),
    story_3: talk('cast002001/c2_001', 8, ['通常', '楽', '怒', '困り', '苦笑い']),
  }
  for (const [id, text] of Object.entries(files)) {
    await mkdir(path.join(scenes, id), { recursive: true })
    await writeFile(path.join(scenes, id, 'script.txt'), text)
  }
  // 白色淡出之后接黑场再淡入（FADE_OUT2,white → FADE_OUT2,black → FADE_IN2,black）：白屏要被取代，骨骼要能看见（以前整个画面一直是白的）
  await mkdir(path.join(scenes, 'fade_white'), { recursive: true })
  await writeFile(path.join(scenes, 'fade_white', 'script.txt'), script([
    '<SPINE_ACTOR>7,cast001001/c1_001,,通常,,0,0,x=0|y=0,1,json', '<NAME_PLATE>主人公', '先出现角色。', '<PAUSE>',
    '<FADE_OUT2>white,400', '<FADE_OUT2>black,800', '<FADE_IN2>black,1300', '<NAME_PLATE>主人公', '白色淡出 → 黑场 → 淡入之后，角色应该还在，画面不是白的。', '<PAUSE>',
  ]))
  // 混合模式：场景自己的骨架，三个槽分别是 additive / screen / multiply（骨架里有非 normal 混合才会出现「更多 → 混合模式」）
  const fx = path.join(scenes, 'fx_blend')
  await mkdir(path.join(fx, 'spines'), { recursive: true })
  await writeSpine(path.join(fx, 'spines'), 'fx', { format: 'json', color: 'crimson', animations: ['Wait'] })
  const file = path.join(fx, 'spines/fx.skel.bytes')
  const json = JSON.parse(await readFile(file, 'utf8'))
  json.slots = [
    { name: 'add', bone: 'root', attachment: 'body', blend: 'additive' },
    { name: 'scr', bone: 'root', attachment: 'body', blend: 'screen' },
    { name: 'mul', bone: 'root', attachment: 'body', blend: 'multiply' },
  ]
  // 皮肤里的附件按槽名挂：三个槽各挂一份同样的区域附件
  const region = json.skins[0].attachments.body.body
  json.skins[0].attachments = Object.fromEntries(json.slots.map((slot) => [slot.name, { body: region }]))
  json.animations = { Wait: { bones: { root: { rotate: [{ time: 0, angle: 0 }, { time: 1, angle: 2 }] } } } }
  await writeFile(file, JSON.stringify(json))
  await rename(file, path.join(fx, 'spines/fx.json'))
  await rename(path.join(fx, 'spines/fx.atlas.txt'), path.join(fx, 'spines/fx.atlas'))
  await writeFile(path.join(fx, 'script.txt'), script(['<SPINE_ACTOR>1,fx,,Wait,,0,0,x=0|y=0,1,json', '<NAME_PLATE>旁白', '三个槽：additive / screen / multiply。「更多 → 混合模式」可以切换。', '<PAUSE>']))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node scripts/dev/make-gal-maid-fixture.mjs <输出目录>'); process.exit(2) }
  await buildMaidFixture(path.join(path.resolve(out), 'maid演示'))
  console.log(`done: ${path.resolve(out)}/maid演示`)
}
