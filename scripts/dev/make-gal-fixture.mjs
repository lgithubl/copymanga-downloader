#!/usr/bin/env node
// 造 Gal 测试数据：node scripts/dev/make-gal-fixture.mjs <输出根目录> [--example <真实示例脚本路径>]
// 需要 ImageMagick（背景图）和 python3（wav 音频）。目录约定见 web/library/types/gal.mjs。
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] })
// ImageMagick 7 是 magick，6 是 convert（GitHub runner 上是 6）
const magick = (() => { try { execFileSync('magick', ['-version'], { stdio: 'ignore' }); return ['magick'] } catch { return ['convert'] } })()
// 背景图上的文字用哪个字体：不能不指定——ImageMagick 默认找 helvetica，GitHub runner 上没装，convert 直接报错退出。
// 从 -list font 里挑一个（优先中日文字体，其次 DejaVu，再随便一个）；一个字体都没有就不画文字，
// 文字这一步万一仍然失败（字体文件坏了之类）就退回「只有渐变和边框」重画一次——背景图本身才是夹具要的东西。
const pickFont = () => {
  try {
    const out = execFileSync(magick[0], ['-list', 'font'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    const names = [...out.matchAll(/^\s*Font:\s*(\S+)/gm)].map((m) => m[1])
    return names.find((n) => /CJK|WenQuanYi|Noto.*(SC|JP|Sans)/i.test(n)) || names.find((n) => /^DejaVu-Sans$/i.test(n)) || names.find((n) => /DejaVu/i.test(n)) || names[0] || ''
  } catch {
    return ''
  }
}
const font = pickFont()
const bgImage = async (file, label, [c1, c2], w = 1280, h = 720) => {
  await mkdir(path.dirname(file), { recursive: true })
  const frame = ['-fill', 'none', '-stroke', 'white', '-strokewidth', '3', '-draw', `rectangle 4,4 ${w - 5},${h - 5}`, '-quality', '80', file]
  const base = ['-size', `${w}x${h}`, `gradient:${c1}-${c2}`]
  const text = font ? ['-font', font, '-fill', 'white', '-gravity', 'center', '-pointsize', '64', '-annotate', '0', label] : []
  try {
    run(magick[0], [...base, ...text, ...frame])
  } catch (error) {
    if (!text.length) throw error
    console.warn(`背景图文字渲染失败（字体 ${font}），退回无文字：${path.basename(file)}`)
    run(magick[0], [...base, ...frame])
  }
}
const tone = async (file, hz, seconds) => {
  await mkdir(path.dirname(file), { recursive: true })
  run('python3', ['-I', '-c', 'import sys,wave,struct,math\nf,hz,sec=sys.argv[1],float(sys.argv[2]),float(sys.argv[3])\nw=wave.open(f,"wb");w.setnchannels(1);w.setsampwidth(2);w.setframerate(22050)\nw.writeframes(b"".join(struct.pack("<h",int(9000*math.sin(2*math.pi*hz*i/22050))) for i in range(int(22050*sec))));w.close()', file, String(hz), String(seconds)])
}

// 目录约定见 web/library/gal/browse.mjs：<根>/{cabin,character/<id>,room,other}/*.txt，资源在 <根>/download/…
// 整个根目录 = 一个 Gal 媒体。many：room 下再造 N 个小脚本，用来测翻页（默认 28，超过一页 25 条）
export async function buildGalFixture(root, { exampleScript = '', many = 28 } = {}) {
  const d = (...p) => path.join(root, ...p)
  // —— 资源（所有脚本共用 download/） ——
  await bgImage(d('download/bg/bg_school.jpg'), '教室', ['#2b6cb0', '#1a365d'])
  await bgImage(d('download/bg/bg_night.jpg'), '夜晚', ['#553c9a', '#1a202c'])
  await bgImage(d('download/bg/bg_tall.jpg'), '竖图 600x1000', ['#2f855a', '#1c4532'], 600, 1000)
  await bgImage(d('download/bg/bg_wide.jpg'), 'wide 1600x400', ['#c05621', '#7b341e'], 1600, 400)
  await bgImage(d('download/bg/bg_10060200.jpg'), 'bg_10060200 (占位)', ['#744210', '#1a202c'])
  await tone(d('download/sound/bgm/bgm_a.wav'), 220, 2)
  await tone(d('download/sound/bgm/bgm_b.wav'), 330, 2)
  await tone(d('download/sound/bgm/bgm192.mp3'), 262, 3)
  await tone(d('download/sound/bgm/bgm163.mp3'), 392, 3)
  await tone(d('download/sound/se/se_1.wav'), 880, 0.3)
  await tone(d('download/sound/se/se_055.mp3'), 988, 0.4)
  await tone(d('download/sound/voice/v_1.wav'), 440, 0.6)
  await mkdir(d('cabin'), { recursive: true })
  await mkdir(d('room'), { recursive: true })
  await mkdir(d('other'), { recursive: true })

  // —— 纪念馆：资源齐全，覆盖基础指令（A）+ 带 BOM 的第二个脚本 ——
  await writeFile(d('cabin/ep01 序章.txt'), [
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
  await writeFile(d('cabin/ep02 终章.txt'), '﻿bg,download/bg/bg_night.jpg,0\nname,小夜,\nmsg,0,第二个脚本（带 BOM）。,,,\nclickwait\nmsg,0,结束。\nclickwait\n')
  await writeFile(d('cabin/README.txt'), '这不是剧情脚本，不应该出现在列表里。\n第二行\n第三行\n')

  // —— 家具：资源缺失（播放器要提示缺资源，不能崩）+ 超宽背景 + 很多小脚本（翻页） ——
  await writeFile(d('room/缺资源.txt'), 'bg,download/bg/missing.jpg,0.2\nplaybgm,/download/sound/bgm/none.mp3,0\nname,谁,\nmsg,0,背景和 BGM 都不存在。,,,\nclickwait\nmovie,download/mov/none.mp4,0,1\nmsg,0,视频也不存在。\nclickwait\n')
  await writeFile(d('room/超宽背景.txt'), 'bg,download/bg/bg_wide.jpg,0\nname,甲,\nmsg,0,超宽背景 1600x400。\nclickwait\n')
  for (let i = 1; i <= many; i++) {
    const n = String(i).padStart(2, '0')
    await writeFile(d(`room/家具${n}.txt`), `bg,download/bg/bg_${i % 2 ? 'school' : 'night'}.jpg,0\nname,家具,\nmsg,0,第 ${n} 个家具脚本。\nclickwait\nmsg,0,第 ${n} 个的第二句。\nclickwait\n`)
  }

  // —— 复刻：超长文件名（卡片/列表标题处理） ——
  const longName = `超长标题-${'这是一个非常非常长的脚本名'.repeat(3)}-Extraordinarily-Long-Unbroken-${'x'.repeat(40)}`
  await writeFile(d('other', `${longName}.txt`), 'bg,download/bg/bg_wide.jpg,0\nname,甲,\nmsg,0,超长文件名。\nclickwait\n')

  // —— 角色：1010（有头像、有图片/视频两个变体、有单变体）、10580（立绘/特效等长脚本）、2001（没头像没名字） ——
  await writeFile(d('character_names.json'), JSON.stringify({ 1010: '小夜', 10580: '阿梓' }))
  await mkdir(d('character/1010'), { recursive: true })
  run(magick[0], ['-size', '256x256', 'gradient:#d53f8c-#702459', '-quality', '80', d('character/1010/icon.png')])
  await writeFile(d('character/1010/story01_image.txt'), 'bg,download/bg/bg_school.jpg,0\nname,小夜,\nmsg,0,故事一·图片版。\nclickwait\nmsg,0,图片版第二句。\nclickwait\n')
  await writeFile(d('character/1010/story01_video.txt'), 'movie,download/mov/story01.mp4,0,0\nname,小夜,\nmsg,0,故事一·视频版（视频文件不存在，应该提示而不是崩）。\nclickwait\n')
  await writeFile(d('character/1010/story02.txt'), 'bg,download/bg/bg_night.jpg,0\nname,小夜,\nmsg,0,故事二（只有一个版本）。\nclickwait\n')
  await mkdir(d('character/2001'), { recursive: true })
  await writeFile(d('character/2001/only.txt'), 'bg,download/bg/bg_tall.jpg,0\nmsg,0,没有头像、没有名字的角色。\nclickwait\n')
  await mkdir(d('character/10580/adv'), { recursive: true })
  if (exampleScript) await copyFile(exampleScript, d('character/10580/example.txt'))
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
    await writeFile(d('character/10580/long.txt'), lines.join('\n'))
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const out = process.argv[2]
  if (!out) { console.error('用法: make-gal-fixture.mjs <输出根目录> [--example <脚本>]'); process.exit(2) }
  const i = process.argv.indexOf('--example')
  await buildGalFixture(path.resolve(out), { exampleScript: i > 0 ? process.argv[i + 1] : '' })
  console.log('ok', out)
}
