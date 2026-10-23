#!/usr/bin/env node
// 造「别的游戏」的 Gal 演示 / 测试数据（合成的，只有结构，没有原作内容）：
//   monmusu（Ren'Py 播放器）：<根>/game/script/hscene、hscene_still、movie.rpy、导航界面、images、audio
//   tenkeiprdx（Unity 剧情查看器素材）：见 make-spine-fixture.mjs
//   node scripts/dev/make-gal-games-fixture.mjs <输出根目录>     → <根>/monmusu演示、<根>/tenkeiprdx演示
// 需要 ImageMagick。
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTenkeiFixture } from './make-spine-fixture.mjs'

export { buildTenkeiFixture }

// 演示用：给 tenkeiprdx 演示再加一份位置数组形（游戏原始数据，没有键名）的剧情；不放进共享 fixture，免得测试里的数量对不上
async function addArrayScene(media) {
  const imported = (await import('node:fs')).existsSync(path.join(media, 'scenes')) ? media : path.join(media, 'StreamingAssets', 'Tenkeiprdx X', 'Imported')
  const at = (rel) => path.join(imported, rel)
  // 位置数组形（游戏原始数据，没有键名）的剧情：[[ "<场景 id>", n, n, bool, [帧…], … ]]
  const arrayFrame = (idx, over = {}) => { const f = new Array(33).fill(null); f[0] = idx; f[5] = false; f[15] = false; f[30] = 0; f[31] = []; for (const [k, v] of Object.entries(over)) f[k] = v; return f }
  await writeFile(at('scenes/22000003201.json'), JSON.stringify([['22000003201', 2, 1, true, [
    arrayFrame(0, { 3: 'bg_adventure_001', 27: 'bgm_a' }),
    arrayFrame(3, { 12: '数组形：旁白一句' }),
    arrayFrame(10, { 10: '%username%', 12: '「数组形的台词」\\n第二行', 27: 'bgm_a', 31: [[1001, 0, 1, 0, 0, 2, false, null]] }),
    arrayFrame(11, { 10: 'Alice', 12: '「停掉 BGM」', 27: 'noBGM{Fade_0.5,Delay_0}', 31: [[1001, 0, 1, 4, 0, 2, false, null]] }),
  ], 22000003201, null, null, null]]))
}

export async function buildMonmusuFixture(mm) {
  const game = path.join(mm, 'game')
  const put = async (rel, content) => { await mkdir(path.dirname(path.join(game, rel)), { recursive: true }); await writeFile(path.join(game, rel), content) }
  const png = async (rel, color = 'red') => { await mkdir(path.dirname(path.join(game, rel)), { recursive: true }); execFileSync('convert', ['-size', '8x8', `xc:${color}`, path.join(game, rel)]) }
  const scene = (id, lines) => `label h${id}:\n    scene black\n${lines}    jump hanim\n`
  await put('script/movie.rpy', "image 10001A1-10 = Movie(play = 'images/webm/10001/rev10001_01_10.webm',size = (1920,1080),loop = True)\nimage 10001B1-10 = Movie(play = 'images/webm/10001/rev10001_02_10.webm',size = (1920,1080),loop = True)\nimage 10004A1-10 = Movie(play = 'images/webm/10004/rev10004_01_10.webm',size = (1920,1080),loop = True)\n")
  await put('script/hscene/10001A1.rpy', scene('10001A1', '    play music "audio/bgm/b.mp3" fadein 1.0 fadeout 1.0\n    voice "audio/voice/10001/a1.mp3"\n    scene 10001A1-10 with Dissolve(0.4)\n    "Ann" "first line"\n    "Ann" "second line"\n'))
  await put('script/hscene/10001B1.rpy', scene('10001B1', '    scene 10001B1-10 with Dissolve(0.4)\n    "Ann" "b line"\n'))
  await put('script/hscene/10004A1.rpy', scene('10004A1', '    scene 10004A1-10\n    "Bob" "hello"\n'))
  await put('script/hscene_still/10001C1.rpy', scene('10001C1', '    scene r18_10001_stla1 with Dissolve(0.5)\n    "Ann" "still line"\n    scene missing_image\n    "Ann" "more"\n'))
  await put('script/hscene_still/readme.txt', 'not a script')
  await put('script/sub_nav/sub_10001.rpy', 'screen sub_10001():\n    add "bg"\n')
  await put('script/main_nav.rpy', 'screen vpgrid_test():\n    add "bg_01_0"\n')
  await put('script/viewmode.rpy', 'label hanim:\n    call screen vpgrid_test\n    return\n')
  await png('images/icon/icon_10001_0_idle.png', 'blue')
  await png('images/icon/icon_10001_0_hover.png', 'green')
  await png('images/icon/icon_10004_0_idle.png', 'yellow')
  await png('images/bg/r18_10001_stla1.png', 'red')
  await put('audio/bgm/b.mp3', 'mp3')
  // 有 ffmpeg 就造出别名对应的 webm（演示里能真的播）；没有就留空，播放器会提示缺资源
  for (const [id, name, color] of [['10001', 'rev10001_01_10', 'crimson'], ['10001', 'rev10001_02_10', 'seagreen'], ['10004', 'rev10004_01_10', 'goldenrod']]) {
    const file = path.join(game, 'images', 'webm', id, `${name}.webm`)
    await mkdir(path.dirname(file), { recursive: true })
    try { execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:d=2`, '-c:v', 'libvpx', '-b:v', '200k', file]) } catch { /* 没有 ffmpeg：跳过 */ }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node scripts/dev/make-gal-games-fixture.mjs <输出根目录>'); process.exit(2) }
  await buildMonmusuFixture(path.join(out, 'monmusu演示'))
  const tenkei = await buildTenkeiFixture(path.join(out, 'tenkeiprdx演示'))
  await addArrayScene(tenkei.imported || path.join(out, 'tenkeiprdx演示'))
  console.log(`done: ${out}/monmusu演示, ${out}/tenkeiprdx演示`)
}
