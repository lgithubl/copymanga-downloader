#!/usr/bin/env node
// 造 Girls Creation R Viewer（NW.js 查看器，标签式脚本）的 Gal 演示 / 测试数据（合成的，名字和台词都是自己编的，没有原作内容）：
//   <根>/package.nw/scenes/<场景 id>/{script.txt, script_original.txt|original_script.txt（逗号式，只取 title 行）, thumbnail.png, images/, videos/, voices/, spines/}
//   <根>/package.nw/data/audio/{bgm,se}/*.m4a
//   场景：chmr_*（角色故事）、chsr_*（带视频的），再加一个没有脚本的 PLACEHOLDER 目录（不是场景）
//   node scripts/dev/make-girlscreation-fixture.mjs <输出根目录>     需要 ImageMagick
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSpine } from './make-spine-fixture.mjs'

export const GC_ANIMATIONS = ['loop', 'ex_loop', 'joy', 'ex_joy', 'surprise', 'ex_surprise']

const script1 = [
  '<FADE_OUT2>black,500',
  '<BG>abg0001,NONE,0,1,0,0',
  '<FADE_IN2>black,500',
  '<BGM_PLAY>bgm30010,0,',
  '<SE_PLAY>0,se1020001,FALSE,1,0',
  '<WAIT2>500',
  '<SPINE_ACTOR>1,st4010101,,,,0,0,x=100|y=0,1,skel',
  '<SPINE_ACTOR_PLAY>1,loop,0,true',
  '<SPINE_ACTOR_PLAY>1,ex_loop,1,true',
  '<VOICE_PLAY>vma_40101001_100010',
  '<NAME_PLATE>Hana',
  '"Hello there, first line."',
  '<PAUSE>',
  '<NAME_PLATE>',
  'A narration line.[br]With a second row.',
  '<PAUSE>',
  '<NAME_PLATE>館長',
  '"Who is it?"',
  '<PAUSE>',
  '<SPINE_ACTOR>2,st4010101,,,,0,0,x=-100|y=0,1,skel',
  '<SPINE_ACTOR_PLAY>2,joy,0,true',
  '<SPINE_ACTOR_PLAY>2,ex_joy,1,true',
  '<SPINE_ACTOR_PLAY>2,nope_anim,2,true',
  '<SPINE_ACTOR_MOVE>1,0,0,500,FALSE',
  '<SCREEN_SHAKE>0,300',
  '<BG_SCALE>1.5,100,linear',
  '<EFFECT_BG_BLUR>4',
  '<VOICE_SINGLE_PLAY>vma_40101001_100020',
  '<NAME_PLATE>Hana',
  '"Two actors on screen."',
  '<PAUSE>',
  '<SPINE_ACTOR_OUT>1,0',
  '<BG_OUT>500',
  '<NAME_PLATE>館長',
  '"The end."',
  '<PAUSE>',
  '<SCENARIO_END><FADE_OUT2>black,500',
  '',
].join('\n')

const videoScript = [
  '<FADE_OUT2>black,100',
  '<VIDEO_PLAY>esm_40200133_10,loop,1',
  '<WAIT2>100',
  '<FADE_IN2>black,1000',
  '<BGM_PLAY>bgm30010,0,',
  '<UI_DISP>OFF, 500',
  '<VOICE_PLAY>vsb_40200133_100010',
  '<NAME_PLATE>Hana',
  '"A line over the video."',
  '<PAUSE>',
  '<PAUSE>',
  '<VIDEO_STOP>',
  '<NAME_PLATE>',
  'Back to a still.',
  '<PAUSE>',
  '<SCENARIO_END>',
  '',
].join('\n')

const plain = (speaker, lines) => ['<BG>abg0001,NONE,0,1,0,0', ...lines.flatMap((text) => [`<NAME_PLATE>${speaker}`, `"${text}"`, '<PAUSE>']), '<SCENARIO_END>', ''].join('\n')

export async function buildGirlsCreationFixture(root) {
  const pkg = path.join(root, 'package.nw')
  const at = (rel) => path.join(pkg, rel)
  const put = async (rel, content) => { await mkdir(path.dirname(at(rel)), { recursive: true }); await writeFile(at(rel), content) }
  const img = async (rel, size, color) => { await mkdir(path.dirname(at(rel)), { recursive: true }); execFileSync('convert', ['-size', size, `xc:${color}`, at(rel)]) }

  // 场景：[id, 脚本, 标题文件名, 标题, 有没有视频]
  const scenes = [
    ['chmr_40101001', script1, 'script_original.txt', 'First Meeting', false],
    ['chmr_40101002', plain('Hana', ['Second scene.', 'Another line.']), null, '', false],
    ['chmr_40102001', plain('Rina', ['Rina speaks.']), 'original_script.txt', 'Rina Story', false],
    ['chsr_40200133', videoScript, 'script_original.txt', 'Video Scene', true],
  ]
  // 一套 Spine 骨架（二进制 3.8，同名 .skel / .atlas / .png），每个场景放一份
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'gc-spine-'))
  try {
    await writeSpine(tmp, 'st4010101', { animations: GC_ANIMATIONS, color: 'crimson' })
    for (const [id, text, titleFile, title, video] of scenes) {
      await put(`scenes/${id}/script.txt`, text)
      if (titleFile) await put(`scenes/${id}/${titleFile}`, `fade,out,black,0.5\nbg,abg0001,0,0,1,1\ntitle,${title},\nwindow,on,0.25\nmessage,,original script line,\n`)
      await img(`scenes/${id}/thumbnail.png`, '24x24', 'steelblue')
      await img(`scenes/${id}/images/abg0001.png`, '64x36', 'seagreen')
      await mkdir(at(`scenes/${id}/spines`), { recursive: true })
      await copyFile(path.join(tmp, 'st4010101.skel.bytes'), at(`scenes/${id}/spines/st4010101.skel`))
      await copyFile(path.join(tmp, 'st4010101.atlas.txt'), at(`scenes/${id}/spines/st4010101.atlas`))
      await copyFile(path.join(tmp, 'st4010101.png'), at(`scenes/${id}/spines/st4010101.png`))
      const num = id.split('_')[1]
      await put(`scenes/${id}/voices/${id.startsWith('chsr') ? 'vsb' : 'vma'}_${num}_100010.m4a`, 'm4a')
      await put(`scenes/${id}/voices/vma_${num}_100020.m4a`, 'm4a')
      if (video) {
        const mp4 = at(`scenes/${id}/videos/esm_${num}_10.mp4`)
        await mkdir(path.dirname(mp4), { recursive: true })
        try { execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'color=c=crimson:s=320x180:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4]) } catch { await writeFile(mp4, 'mp4') }
      }
    }
  } finally { await rm(tmp, { recursive: true, force: true }) }
  await img('scenes/PLACEHOLDER/images/x.png', '8x8', 'gray')   // 没有脚本的目录：不是场景
  await put('data/audio/bgm/bgm30010.m4a', 'm4a')
  await put('data/audio/se/se1020001.m4a', 'm4a')
  await put('sceneData.js', 'sceneData = {}\n')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node scripts/dev/make-girlscreation-fixture.mjs <输出根目录>'); process.exit(2) }
  await buildGirlsCreationFixture(path.join(out, 'girlscreation演示'))
  console.log(`done: ${out}/girlscreation演示`)
}
