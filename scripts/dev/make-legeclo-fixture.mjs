#!/usr/bin/env node
// 造 legeclo（Ren'Py 播放器）的 Gal 演示 / 测试数据（合成的，只有结构，台词都是自己编的，没有原作内容）：
//   <根>/legeclo_py.py                                  启动器（探测靠它或 options.rpy 里的名字认出 legeclo，和 monmusu 区分）
//   <根>/game/options.rpy
//   <根>/game/script/movie.rpy                          视频别名（image X = Movie(play=…)）
//   <根>/game/script/hscene/<角色>_<编号>.rpy            剧情（label H_<角色>_<编号>；.rpyc 只有编译产物的读不了）
//   <根>/game/script/nav/sub_nav/*.rpy                  导航界面（不是剧情）
//   <根>/game/images/{bg,sprite,thumbnail/char,mo}      背景 / 整张立绘（表情各一个文件）/ 角色头像 / 视频
//   <根>/game/audio/{bgm,voice}
//   <根>/game/tl/jptoen/script/hscene/*.rpy             翻译（translate 块，暂不叠加）
//   node scripts/dev/make-legeclo-fixture.mjs <输出根目录>     需要 ImageMagick
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export async function buildLegecloFixture(root) {
  const game = path.join(root, 'game')
  const at = (rel) => path.join(game, rel)
  const put = async (rel, content) => { await mkdir(path.dirname(at(rel)), { recursive: true }); await writeFile(at(rel), content) }
  const img = async (rel, size, color) => { await mkdir(path.dirname(at(rel)), { recursive: true }); execFileSync('convert', ['-size', size, `xc:${color}`, at(rel)]) }

  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'legeclo_py.py'), '# launcher\n')
  await put('options.rpy', 'define config.name = "legeclo_py"\ndefine config.version = "1.0"\n')
  await put('script/movie.rpy', "image hs_demo_hero_mo_0202 = Movie(play = 'images/mo/hs_demo_hero_mo_0202.webm', size = (1920,1080), loop = True)\n")
  // 剧情：背景（black 那张不当背景图）、立绘（整张图、表情各一个文件、可以 at left / right）、语音、BGM、旁白（空名字）、\n 换行
  await put('script/hscene/demo_hero_02.rpy', [
    'label H_demo_hero_02:',
    '    $ enable_skip()',
    '    hide screen vpgrid_test',
    '    stop music fadeout (0.5)',
    '    scene ab_997_black with Dissolve (0.5)',
    '    scene ab_007_room with Dissolve(0.5)',
    '    play music "audio/bgm/bgm_demo.mp3"',
    '',
    '    show demo_hero_smile with Dissolve (0.5)',
    '    play voice "audio/voice/demo_hero/voice_demo_0001.mp3"',
    '    "Hero" "First line.\\nSecond row."',
    '',
    '    stop voice',
    '    hide demo_hero_smile with Dissolve (0.5)',
    '    "" "A narration line without a speaker."',
    '    show demo_hero_normal at right with Dissolve (0.5)',
    '    show other_one_normal at left',
    '    "Other" "Two people on screen."',
    '    show missing_sprite',
    '    "Other" "A sprite that is not on disk."',
    '    return',
    '',
  ].join('\n'))
  await put('script/hscene/demo_hero_03.rpy', 'label H_demo_hero_03:\n    $ enable_skip()\n    scene hs_demo_hero_mo_0202 with Dissolve(0.5)\n    play voice "audio/voice/demo_hero/voice_demo_0002.mp3"\n    "Hero" "A video background."\n    return\n')
  await put('script/hscene/other_one_02.rpy', 'label H_other_one_02:\n    $ enable_skip()\n    scene ab_007_room\n    show other_one_normal\n    "Other" "Hello."\n    return\n')
  await put('script/hscene/long_name_with_parts_03.rpy', 'label H_long_name_with_parts_03:\n    $ enable_skip()\n    scene ab_007_room\n    "Someone" "Character ids can contain underscores."\n    return\n')
  await put('script/hscene/compiled_only_02.rpyc', 'RENPY RPC2')   // 只有编译产物的：读不了，列表里不出现
  await put('script/hscene/readme.txt', 'not a script')
  await put('script/nav/sub_nav/sub_demo_hero.rpy', 'screen sub_demo_hero():\n    add "bg"\n')
  await put('script/nav/main_nav.rpy', 'screen vpgrid_test():\n    add "bg_01_0"\n')
  await put('tl/jptoen/script/hscene/demo_hero_02.rpy', 'translate jptoen H_demo_hero_02_abc123:\n    "Hero" "Translated line."\n')
  await img('images/bg/ab_997_black.jpg', '64x36', 'black')
  await img('images/bg/ab_007_room.jpg', '64x36', 'seagreen')
  await img('images/sprite/demo_hero_smile.png', '40x80', 'crimson')
  await img('images/sprite/demo_hero_normal.png', '40x80', 'goldenrod')
  await img('images/sprite/other_one_normal.png', '40x80', 'royalblue')
  await img('images/thumbnail/char/st_demo_hero_idle.png', '24x24', 'crimson')
  await img('images/thumbnail/char/st_other_one.png', '24x24', 'royalblue')   // 名字不统一：有的带 _idle，有的不带
  // 脚本缩略图（thumbSources）：images/thumbnail/st/hs_<角色>_st_<话 2 位><变体 2 位>[_idle|_hover].png ↔ 脚本 <角色>_<话>；没有缩略图的退回 images/st/ 的整张场景图
  await img('images/thumbnail/st/hs_other_one_st_0201.png', '64x36', 'royalblue')
  await img('images/thumbnail/st/hs_other_one_st_0202_idle.png', '64x36', 'navy')
  await img('images/thumbnail/st/hs_other_one_st_0203_hover.png', '64x36', 'skyblue')
  await img('images/thumbnail/st/hs_other_one_st_0301.png', '64x36', 'gray')   // 第 03 话：不属于 other_one_02
  await img('images/st/hs_long_name_with_parts_st_0301.png', '64x36', 'orchid')
  await put('audio/bgm/bgm_demo.mp3', 'mp3')
  await put('audio/voice/demo_hero/voice_demo_0001.mp3', 'mp3')
  await put('audio/voice/demo_hero/voice_demo_0002.mp3', 'mp3')
  const webm = at('images/mo/hs_demo_hero_mo_0202.webm')
  await mkdir(path.dirname(webm), { recursive: true })
  try { execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'color=c=crimson:s=320x180:d=2', '-c:v', 'libvpx', '-b:v', '200k', webm]) } catch { /* 没有 ffmpeg：跳过，播放器会提示缺资源 */ }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node scripts/dev/make-legeclo-fixture.mjs <输出根目录>'); process.exit(2) }
  await buildLegecloFixture(path.join(out, 'legeclo演示'))
  console.log(`done: ${out}/legeclo演示`)
}
