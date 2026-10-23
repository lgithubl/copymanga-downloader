#!/usr/bin/env node
// 合成一份仿 MinashigoViewer（Ren'Py）的资源包（没有原作内容）：
//   <根>/MinashigoViewer-1.2/game/{script.rpy（DynamicCharacter + layeredimage standimage）, movie.rpy, scripts/scene_*.rpy, images/{bg,stand,…}, audio/{bgm,voices}}
//   node scripts/dev/make-minashigo-fixture.mjs <输出根目录>
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export async function buildMinashigoFixture(root) {
  const viewer = path.join(root, 'MinashigoViewer-1.2')
  const game = path.join(viewer, 'game')
  const put = async (rel, content) => { await mkdir(path.dirname(path.join(game, rel)), { recursive: true }); await writeFile(path.join(game, rel), content) }
  const convert = async (rel, args) => { const file = path.join(game, rel); await mkdir(path.dirname(file), { recursive: true }); execFileSync('convert', [...args, file]) }

  // 立绘图集：身体 (1,1,1000,900) 红、表情 (1,902,100,95) 黄 / (103,902,100,95) 绿；整张 1300x1000（zoom 0.9 后身体 900x810，约占舞台高度的 3/4）
  const sheet = (rel, body, faceA, faceB) => convert(rel, ['-size', '1300x1000', 'xc:black', '-fill', body, '-draw', 'rectangle 1,1 1000,900', '-fill', faceA, '-draw', 'rectangle 1,902 100,996', '-fill', faceB, '-draw', 'rectangle 103,902 202,996'])
  await sheet('images/stand/302201stand_a.png', 'crimson', 'yellow', 'lime')
  await sheet('images/stand/200801stand_a.png', 'royalblue', 'orange', 'magenta')
  await convert('images/bg/bg5000604.jpg', ['-size', '320x180', 'xc:seagreen'])
  await convert('images/bg/bg0000701.jpg', ['-size', '320x180', 'xc:goldenrod'])
  await convert('images/black1.png', ['-size', '16x16', 'xc:black'])
  await convert('images/slash_1.png', ['-size', '16x16', 'xc:white'])
  for (const rel of ['audio/bgm/bgm_018.mp3', 'audio/bgm/bgm_004.mp3', 'audio/se/slash_1.mp3', 'audio/voices/fav302201/fav302201_02_01.mp3', 'audio/voices/fav302201/fav302201_02_03.mp3']) await put(rel, 'mp3')
  try { execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'color=c=crimson:s=320x180:d=2', '-c:v', 'libvpx', '-b:v', '200k', path.join(game, 'images/ani/700401/700401_01.webm')]) } catch { /* 没有 ffmpeg：视频缺资源，播放器会提示 */ }

  await put('movie.rpy', 'image 700401_01 = Movie(play="images/ani/700401/700401_01.webm",size = (1920,1080),loop = True)\n')
  await put('script.rpy', [
    'init:', '    python:', '            renpy.music.register_channel("voice2", mixer="voice", loop=False)',
    'define flash = Fade(0.25, 0.0, 0.075, color="#fff")',
    'define xyz = DynamicCharacter("name", color="#ffffff", who_outlines=[ (1, "#000000") ], what_outlines=[ (1, "#000000") ])',
    '',
    'layeredimage standimage:',
    '        attribute 302201abody zoom 0.9:',
    '            im.Crop("images/stand/302201stand_a.png",(1,1,1000,900))',
    '        attribute 302201a001 zoom 0.9:',
    '            im.Crop("images/stand/302201stand_a.png",(1,902,100,95))',
    '            xpos 350 ypos 100',
    '        attribute 302201a004 zoom 0.9:',
    '            im.Crop("images/stand/302201stand_a.png",(103,902,100,95))',
    '            xpos 350 ypos 100',
    '',
    '        attribute 200801abody zoom 0.9:',
    '            im.Crop("images/stand/200801stand_a.png",(1,1,1000,900))',
    '        attribute 200801a001 zoom 0.9:',
    '            im.Crop("images/stand/200801stand_a.png",(1,902,100,95))',
    '            xpos 350 ypos 100',
    '',
  ].join('\n'))

  const scene = (id, body) => `label scene_${id}:\n\n    $ name= ""\n${body}    stop music\n    $renpy.end_replay()\n    return\n`
  const full = [
    "    scene bg5000604 with Dissolve(0.5)",
    "    play music 'audio/bgm/bgm_018.mp3'",
    "    play voice2 'audio/voices/fav302201/fav302201_02_01.mp3'",
    '    xyz "旁白第一句。\\n第二行。"',
    '    hide standimage',
    '    show standimage 302201abody',
    '    show standimage 302201a001',
    '    $ name= "ワーテルロー"',
    "    play voice2 'audio/voices/fav302201/fav302201_02_03.mp3'",
    '    xyz "『有立绘的一句』"',
    '    hide standimage',
    '    show standimage 200801abody',
    '    show standimage 200801a001',
    '    $ name= "ナポレオン"',
    '    xyz "『换了一个人』"',
    '    $ name= ""',
    '    scene black1 with Dissolve(1.0)',
    '    show black with Dissolve(0.5)',
    '    hide black',
    '    show slash_1 with Dissolve(0.5)',
    '    hide slash_1',
    "    queue sound 'audio/se/slash_1.mp3'",
    '    with flash',
    '    xyz "……。"',
    "    play music 'audio/bgm/bgm_004.mp3'",
    '    scene bg0000701 with Dissolve(0.5)',
    '    hide standimage',
    '    show standimage 302201abody',
    '    show standimage 302201a004',
    '    $ name= "ワーテルロー"',
    '    xyz "「表情换了」"',
  ].join('\n') + '\n'
  await put('scripts/scene_130220102.rpy', scene('130220102', full))
  await put('scripts/scene_130220101.rpy', scene('130220101', "    scene bg5000604\n    xyz \"同一个角色的另一个脚本\"\n"))
  await put('scripts/scene_110010101.rpy', scene('110010101', "    scene bg0000701\n    $ name= \"Ann\"\n    xyz \"另一个角色\"\n"))
  await put('scripts/scene_2100002.rpy', scene('2100002', "    scene 700401_01\n    xyz \"主线（视频别名）\"\n"))
  await put('scripts/scene_ev059_00_02.rpy', scene('ev059_00_02', "    scene bg0000701\n    xyz \"活动\"\n    scene missing_image\n    xyz \"图片不存在\"\n"))
  await put('scripts/notes.txt', '这不是剧情脚本')
  return { viewer, game }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node scripts/dev/make-minashigo-fixture.mjs <输出根目录>'); process.exit(2) }
  await buildMinashigoFixture(path.join(out, 'minashigo演示'))
  console.log(`done: ${out}/minashigo演示`)
}
