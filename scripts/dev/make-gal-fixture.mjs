#!/usr/bin/env node
// 造 Gal 测试数据：node scripts/dev/make-gal-fixture.mjs <输出根目录> [--example <真实示例脚本路径>]
// 需要 ImageMagick（背景图）和 python3（wav 音频）。目录约定见 web/library/types/gal.mjs。
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] })
// ImageMagick 7 是 magick，6 是 convert（GitHub runner 上是 6）
const magick = (() => { try { execFileSync('magick', ['-version'], { stdio: 'ignore' }); return ['magick'] } catch { return ['convert'] } })()
const bgImage = async (file, label, [c1, c2], w = 1280, h = 720) => {
  await mkdir(path.dirname(file), { recursive: true })
  run(magick[0], ['-size', `${w}x${h}`, `gradient:${c1}-${c2}`, '-fill', 'white', '-gravity', 'center', '-pointsize', '64', '-annotate', '0', label, '-fill', 'none', '-stroke', 'white', '-strokewidth', '3', '-draw', `rectangle 4,4 ${w - 5},${h - 5}`, '-quality', '80', file])
}
const tone = async (file, hz, seconds) => {
  await mkdir(path.dirname(file), { recursive: true })
  run('python3', ['-I', '-c', 'import sys,wave,struct,math\nf,hz,sec=sys.argv[1],float(sys.argv[2]),float(sys.argv[3])\nw=wave.open(f,"wb");w.setnchannels(1);w.setsampwidth(2);w.setframerate(22050)\nw.writeframes(b"".join(struct.pack("<h",int(9000*math.sin(2*math.pi*hz*i/22050))) for i in range(int(22050*sec))));w.close()', file, String(hz), String(seconds)])
}

export async function buildGalFixture(root, { exampleScript = '' } = {}) {
  // —— 作品 A：资源齐全，两个脚本，覆盖基础指令 ——
  const a = path.join(root, '演示作品A')
  await bgImage(path.join(a, 'download/bg/bg_school.jpg'), '教室', ['#2b6cb0', '#1a365d'])
  await bgImage(path.join(a, 'download/bg/bg_night.jpg'), '夜晚', ['#553c9a', '#1a202c'])
  await bgImage(path.join(a, 'download/bg/bg_tall.jpg'), '竖图 600x1000', ['#2f855a', '#1c4532'], 600, 1000)
  await tone(path.join(a, 'download/sound/bgm/bgm_a.wav'), 220, 2)
  await tone(path.join(a, 'download/sound/bgm/bgm_b.wav'), 330, 2)
  await tone(path.join(a, 'download/sound/se/se_1.wav'), 880, 0.3)
  await tone(path.join(a, 'download/sound/voice/v_1.wav'), 440, 0.6)
  await mkdir(path.join(a, 'scenario'), { recursive: true })
  await writeFile(path.join(a, 'scenario/ep01 序章.txt'), [
    'stopbgm,,,,,,,,,,,',
    'fadeinblack,0,,,,,,,,,,',
    'bg,download/bg/bg_school.jpg,0,,,,,,,,',
    'endwait,,,,,,,,,,,',
    'fadeoutblack,0.6,,,,,,,,,,',
    'playbgm,/download/sound/bgm/bgm_a.wav,0,',
    'endwait,,,,,,,,,,,',
    'name,<outline width=2 color=black>小夜</outline>,',
    'msg,0,<outline width=2 color=black>「早上好，今天也是个好天气呢。」</outline>,,,,,,,,,',
    'clickwait,,,,,,,,,,,',
    '',
    'spriteatlas,download/character/1/adv/atlas/stand_a,body:smile,a1,0,-100,0.5,0.5,,,,',
    'anm,tint,a1,150_150_150,0.0001,0',
    'name,<outline width=2 color=black>小夜</outline>,',
    'msg,0,<color=#ffb347>橙色的字</color>、<b>粗体</b>、<i>斜体</i>，还有半角逗号, 和第二行\\n换行了。,,,,,,,,,',
    'playse,/download/sound/se/se_1.wav',
    'clickwait,,,,,,,,,,,',
    '',
    'bg,download/bg/bg_night.jpg,0.8,,,,,,,,',
    'playvoice,0,/download/sound/voice/v_1.wav',
    'name,旁白,',
    'msg,0,夜幕降临了。<script>alert(1)</script><img src=x onerror=alert(2)>,,,,,,,,,',
    'clickwait,,,,,,,,,,,',
    '',
    'wait,0.3',
    'name,,,,,,,,,,,',
    'msg,0,,,,,,,,,,,',
    'fadeinblack,0.5,,,,,,,,,,',
    'endwait,,,,,,,,,,,',
    'bg,color_20_60_40,0,,,,,,,,',
    'fadeoutblack,0.5,,,,,,,,,,',
    'name,小夜,',
    'msg,0,换成了纯色背景。,,,,,,,,,',
    'clickwait,,,,,,,,,,,',
    '',
    'stopbgm,0.3,,,,,,,,,,',
    'playbgm,/download/sound/bgm/bgm_b.wav,0,',
    'bg,download/bg/bg_tall.jpg,0,,,,,,,,',
    'msg,0,这一句很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长。,,,,,,,,,',
    'clickwait,,,,,,,,,,,',
    'bgoff,0.4,,,,,,,,,,',
    'msg,0,最后一句：背景被撤掉了。,,,,,,,,,',
    'clickwait,,,,,,,,,,,',
    '',
  ].join('\n'))
  await writeFile(path.join(a, 'scenario/ep02 终章.txt'), '﻿bg,download/bg/bg_night.jpg,0\nname,小夜,\nmsg,0,第二个脚本（带 BOM）。,,,\nclickwait\nmsg,0,结束。\nclickwait\n')
  await writeFile(path.join(a, 'README.txt'), '这不是剧情脚本，不应该被识别成单元。\n第二行\n第三行\n')

  // —— 作品 B：资源缺失（没封面，播放器要提示缺资源，不能崩） ——
  const b = path.join(root, '演示作品B 缺资源')
  await mkdir(path.join(b, 'script'), { recursive: true })
  await writeFile(path.join(b, 'script/only.txt'), 'bg,download/bg/missing.jpg,0.2\nplaybgm,/download/sound/bgm/none.mp3,0\nname,谁,\nmsg,0,背景和 BGM 都不存在。,,,\nclickwait\nmovie,download/mov/none.mp4,0,1\nmsg,0,视频也不存在。\nclickwait\n')

  // —— 作品 C：超长目录名（卡片/详情的标题处理） ——
  const longName = `演示作品C-${'这是一个非常非常长的作品名'.repeat(3)}-Extraordinarily-Long-Unbroken-${'x'.repeat(40)}`
  const c = path.join(root, longName)
  await mkdir(c, { recursive: true })
  await bgImage(path.join(c, 'bg.jpg'), 'long title', ['#c05621', '#7b341e'], 1600, 400)
  await writeFile(path.join(c, 'a.txt'), 'bg,bg.jpg,0\nname,甲,\nmsg,0,超宽背景 1600x400。\nclickwait\n')

  // —— 无脚本目录：应该被跳过；非脚本内容的 txt 不能被当脚本 ——
  await mkdir(path.join(root, '空目录无脚本'), { recursive: true })
  await writeFile(path.join(root, '空目录无脚本', 'notes.txt'), 'hello\nworld\nthis is not a script\n')
  await mkdir(path.join(root, '.hidden'), { recursive: true })

  // —— 作品 D：带立绘/遮罩/Spine 等「暂未渲染」指令的长脚本（真实示例脚本给了就用它，资源都是占位） ——
  const d = path.join(root, exampleScript ? '演示作品D 真实示例脚本' : '演示作品D 模拟长脚本')
  await mkdir(path.join(d, 'scripts'), { recursive: true })
  await bgImage(path.join(d, 'download/bg/bg_10060200.jpg'), 'bg_10060200 (占位)', ['#744210', '#1a202c'])
  await tone(path.join(d, 'download/sound/bgm/bgm192.mp3'), 262, 3)
  await tone(path.join(d, 'download/sound/bgm/bgm163.mp3'), 392, 3)
  await tone(path.join(d, 'download/sound/se/se_055.mp3'), 988, 0.4)
  if (exampleScript) await copyFile(exampleScript, path.join(d, 'scripts/example.txt'))
  else {
    const lines = ['stopbgm,,,,,,,,,,,', 'fadeinblack,0,,,,,,,,,,', 'bg,download/bg/bg_10060200.jpg,0,,,,,,,,', 'endwait,,,,,,,,,,,', 'fadeoutblack,1.5,,,,,,,,,,', 'endwait,,,,,,,,,,,', 'playbgm,/download/sound/bgm/bgm192.mp3,0,', 'endwait,,,,,,,,,,,', '']
    const talk = [['阿梓', '「喂，你以为我会容忍你这种人吗？」'], ['小蓟', '「黑、蔷薇……你是……」'], ['诺恩', '「喂，你是笨蛋吗！」'], ['阿梓', '「不要啦，被打很痛的，\\n而且身上留下痕迹的话怎么办？」'], ['诺恩', '「要是怕被打就别开这种恶劣的玩笑！」']]
    for (let i = 0; i < 24; i++) {
      const [who, text] = talk[i % talk.length]
      const left = i % 2 === 0
      lines.push(`spriteatlas,download/character/10580${i % 3}/adv/atlas/stand_b,body:${i % 2 ? 'sad' : 'smile'},c${i % 3},${left ? -300 : 300},-90,0.5,0.5,,,,`)
      lines.push(`anm,tint,c${i % 3},150_150_150,0.0001,0`)
      if (i === 6) lines.push('mask,black1,0,0,1280,250,0.5,,,,', 'sprite,download/adv/image/black.jpg,black,0,0,0,0,,,,', 'imgconf,black,black1,0,0,,,0,1,1,0.5')
      if (i === 8) lines.push('spine,download/adv/spine/blow_Blue,em1,default,animation,0,0,0,1,1.0,0', 'playse,/download/sound/se/se_055.mp3', 'wait,0.5', 'spineoff,em1,0')
      if (i === 12) lines.push('stopbgm,0.5,,,,,,,,,,', 'playbgm,/download/sound/bgm/bgm163.mp3,0,')
      lines.push('endwait,,,,,,,,,,,', `name,<outline width=2 color=black>${who}</outline>,`, `msg,0,<outline width=2 color=black>${text}</outline>,,,,,,,,,`, 'clickwait,,,,,,,,,,,', '')
    }
    lines.push('fadeinblack,0.5,,,,,,,,,,', 'endwait,,,,,,,,,,,', 'name,,,,,,,,,,,', 'msg,0,,,,,,,,,,,', 'spriteoff,all,0.5,,,,,,,,,', 'bgoff,1.0,,,,,,,,,,', 'endwait,,,,,,,,,,,')
    await writeFile(path.join(d, 'scripts/long.txt'), lines.join('\n'))
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const out = process.argv[2]
  if (!out) { console.error('用法: make-gal-fixture.mjs <输出根目录> [--example <脚本>]'); process.exit(2) }
  const i = process.argv.indexOf('--example')
  await buildGalFixture(path.resolve(out), { exampleScript: i > 0 ? process.argv[i + 1] : '' })
  console.log('ok', out)
}
