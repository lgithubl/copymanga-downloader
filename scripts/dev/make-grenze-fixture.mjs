#!/usr/bin/env node
// 造 Grenze（GrenzeViewer）的 Gal 演示 / 测试数据（合成的，只有结构，台词都是自己编的，没有原作内容）：
//   <根>/TextAsset/easy_dialog-{1,2,10}.xml      对话（<easy_dialog-N id next_id name text …/> 行；每个文件几个场景，next_id 串成链）；dialog-3.xml 不是对话（目录里不出现）
//   <根>/assets/resources/patchres/bg/battlebg/<名>/<名>.webp|png    背景（带 #123 的重复文件、没有图的名字都有）
//   <根>/assets/resources/patchres/{bgm,sound,voice}/…               声音（内容是假的，只验证路径）
//   <根>/assets/resources/patchres/merc/pic/<hero_group_id>/body.webp|png + 头像图标 N.webp / <id>.webp（不是立绘，要被忽略）
//   node scripts/dev/make-grenze-fixture.mjs <输出根目录> [大文件行数]     需要 ImageMagick（支持 webp）
// 大文件行数 > 0 时多造一个 easy_dialog-99.xml（几万行，几 MB：验证大文件解析 / 列表的效率，和脚本大小上限无关）。
//
// easy_dialog-1.xml 里的场景（行故意交错 + id 不连续，只能靠 next_id 拆）：
//   110001  旁白 / 说话人 / 转义 / 背景 bg_b（没图 = 黑底）/ bgm / se / voice / 立绘（居中 webp、右 png、没有 body、比画面高）/ non / 换背景清立绘 / 未知指令 raw
//   120001  3 行的小场景
//   130001 / 140001  两条链在 130009 汇合（共用后半段）
//   150001  next_id 指向不存在的行（在那里结束）
//   160001  没人指向的环（160001 → 160002 → 160001）
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\n/g, '&#xA;')
// 一行：属性按给定顺序写（undefined 的不写）
const row = (n, attrs) => `  <easy_dialog-${n} ${Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${k === 'text' || k === 'name' ? esc(v) : v}"`).join(' ')}/>`
const xml = (n, rows) => `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\n<easy_dialog-${n}_list>\n${rows.join('\n')}\n</easy_dialog-${n}_list>\n`

export async function buildGrenzeFixture(root, { bigRows = 0 } = {}) {
  const patch = path.join(root, 'assets', 'resources', 'patchres')
  const at = (rel) => path.join(patch, rel)
  const put = async (rel, content) => { await mkdir(path.dirname(at(rel)), { recursive: true }); await writeFile(at(rel), content) }
  const img = async (rel, size, color) => { await mkdir(path.dirname(at(rel)), { recursive: true }); execFileSync('convert', ['-size', size, `xc:${color}`, ...(rel.endsWith('.webp') ? ['-define', 'webp:lossless=true'] : []), at(rel)]) }
  await mkdir(path.join(root, 'TextAsset'), { recursive: true })

  const L = (n, id, next, rest = {}) => row(n, { id, next_id: next, ...rest })
  const file1 = [
    L(1, 110001, 110002, { name: '-', text: '――Opening.', voice_pack: 'Main11', bg_sound1: 'se_00', background: 'bg_b' }),
    L(1, 120001, 120002, { name: '-', text: 'Second story, first line.' }),
    L(1, 110002, 110003, { name: '-', text: '《俺》Thinking & more <ok>.\nSecond line.', screen_effect: 4, background: 'bg_demo_1', bgm: 'ER2_bgm02', bg_sound1: 'se_378', voice_pack: 'Main11' }),
    L(1, 110003, 110004, { name: 'Alice', text: '「Hello」', hero_group_id: 101011, pic_pos: 2, pic_face: 5, voice_pack: 'Main11', voice: 'MainVoice_00_01_001', sound1: 'se_378', pic_action: 5, effect: 17, effect_pos: 2 }),
    L(1, 120002, 120003, { name: 'Bob', text: 'Second story, second line.', hero_group_id: 701004, pic_pos: 1, pic_face: 1 }),
    L(1, 110004, 110005, { screen_effect: 8 }),
    L(1, 110005, 110006, { name: 'Bob', text: 'Right side.', hero_group_id: 701004, pic_pos: 3, pic_face: 1 }),
    L(1, 110006, 110007, { name: '-', text: 'Narration keeps the stand.' }),
    L(1, 120003, undefined, { name: '-', text: 'Second story ends here.' }),
    L(1, 110007, 110008, { name: 'Carol', text: 'No sprite for me.', hero_group_id: 999, pic_pos: 1, pic_face: 1 }),
    L(1, 110008, 110009, { name: 'Dave', text: 'Tall sprite, music off.', hero_group_id: 101063, pic_pos: 1, pic_face: 1, bgm: 'non', bg_sound1: 'non', sound1: 'non' }),
    L(1, 110009, 110010, { text: 'Background change clears the stand.', background: 'bg_demo_png' }),
    L(1, 110010, undefined, { name: '-', text: 'Missing files are not fatal.', background: 'bg_missing', bgm: 'no_such_bgm', sound1: 'no_such_se', voice: 'NoSuchVoice' }),
    L(1, 130001, 130002, { name: 'Eve', text: 'Branch A start.' }),
    L(1, 140001, 130009, { name: 'Frank', text: 'Branch B start.' }),
    L(1, 130002, 130009, { name: 'Eve', text: 'Branch A second.' }),
    L(1, 130009, 130010, { name: '-', text: 'Shared tail one.' }),
    L(1, 130010, undefined, { name: '-', text: 'Shared tail two.' }),
    L(1, 150001, 150002, { name: '-', text: 'Dangling start.' }),
    L(1, 150002, 999999, { name: '-', text: 'Next id does not exist.' }),
    L(1, 160001, 160002, { name: '-', text: 'Cycle one.' }),
    L(1, 160002, 160001, { name: '-', text: 'Cycle two.' }),
  ]
  await writeFile(path.join(root, 'TextAsset', 'easy_dialog-1.xml'), xml(1, file1))
  await writeFile(path.join(root, 'TextAsset', 'easy_dialog-2.xml'), xml(2, [
    L(2, 210001, 210002, { name: 'Gina', text: 'File two, scene one.' }),
    L(2, 210002, undefined, { name: '-', text: 'End of scene one.' }),
    L(2, 220001, undefined, { name: '-', text: 'File two, scene two.' }),
  ]))
  await writeFile(path.join(root, 'TextAsset', 'easy_dialog-10.xml'), xml(10, [L(10, 1000001, undefined, { name: '-', text: 'File ten (sorts after two).' })]))
  await writeFile(path.join(root, 'TextAsset', 'dialog-3.xml'), '<dialog-3 id="1" text="not an easy_dialog file"/>\n')
  await writeFile(path.join(root, 'TextAsset', 'buff.xml'), '<buff id="1"/>\n')

  if (bigRows > 0) {   // 每 100 行一个场景，带属性的真实比例（立绘 ~60%、声音 ~20%…）
    const rows = []
    for (let i = 0; i < bigRows; i++) {
      const id = 5000000 + i
      const last = i % 100 === 99 || i === bigRows - 1
      const attrs = { id, next_id: last ? undefined : id + 1, name: i % 3 ? 'Name' : '-', text: `Line ${i}. ${'x'.repeat(40 + (i % 50))}` }
      if (i % 5 < 3) Object.assign(attrs, { hero_group_id: 101011, pic_pos: 2, pic_face: 1 + (i % 6) })
      if (i % 5 === 0) attrs.sound1 = 'se_378'
      if (i % 40 === 0) attrs.screen_effect = 3 + (i % 7)
      if (i % 100 === 0) { attrs.background = 'bg_demo_1'; attrs.bgm = 'ER2_bgm02' }
      rows.push(row(99, attrs))
    }
    await writeFile(path.join(root, 'TextAsset', 'easy_dialog-99.xml'), xml(99, rows))
  }

  // 背景：webp > png；带 # 的重复文件（引擎的文件索引会跳过）；bg_demo_png 只有 png；bg_b / bg_missing 没有图
  await img('bg/battlebg/bg_demo_1/bg_demo_1.webp', '64x36', 'seagreen')
  await img('bg/battlebg/bg_demo_1/bg_demo_1 #255174.webp', '64x36', 'red')
  await img('bg/battlebg/bg_demo_png/bg_demo_png.png', '64x36', 'navy')
  await put('bg/battlebg/bg_demo_1/bg_demo_1.AssetBundle.json', '{}')
  // 立绘：整张 body；101011 = webp（居中），701004 = png，101063 = 比画面高；头像图标 / 图集（不是立绘，不能被当成 body）；999 没有 body
  await img('merc/pic/101011/body.webp', '40x80', 'crimson')
  await img('merc/pic/101011/body.png', '40x80', 'black')   // webp 优先
  await img('merc/pic/101011/2.webp', '96x96', 'yellow')
  await img('merc/pic/101011/101011.webp', '128x128', 'magenta')
  await img('merc/pic/701004/body.png', '40x80', 'royalblue')
  await img('merc/pic/101063/body.webp', '300x1500', 'goldenrod')
  await img('merc/pic/999/3.webp', '96x96', 'yellow')
  // 声音：bgm/<名小写>/<名>.m4a、sound/<名>/<名>.m4a、voice/<包小写>/<语音名>.m4a
  await put('bgm/er2_bgm02/ER2_bgm02.m4a', 'm4a')
  await put('bgm/er2_bgm02/bgm_er2_bgm02.AssetBundle.json', '{}')
  await put('sound/se_378/se_378.m4a', 'm4a')
  await put('voice/main11/MainVoice_00_01_001.m4a', 'm4a')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node scripts/dev/make-grenze-fixture.mjs <输出根目录> [大文件行数]'); process.exit(2) }
  await buildGrenzeFixture(path.join(out, 'Grenze演示'), { bigRows: Number(process.argv[3]) || 0 })
  console.log(`done: ${out}/Grenze演示`)
}
