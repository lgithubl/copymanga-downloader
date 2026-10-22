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

// 造一个「UViewer 资源包」形状的 Gal 媒体目录（目录方案见 web/library/gal/profiles/uviewer.mjs）：
//   <根>/UViewer.exe  start.bat  *.txt（根上的说明文件，不是脚本）
//   <根>/user_data/{settings.json,character_names.json,thumbnails/}
//   <根>/resources/download/adv/text/{cabin,character/<角色id>/{adultr,extra},event/<id>,quest/<id>,room,memorial,other/9000/adultr,gacha/adultr,tutorial/adultr}/*.txt
//   <根>/resources/download/adv/text---日文20251102/…   另一套文本（同结构）
//   <根>/resources/download/{bg,sound/bgm,character/<6 位>/adv/{image,sound}}        资源
// 脚本是我们自己写的（指令形状和真实脚本一致：select/if/elseif/endif、<size>、<ruby>、立绘/Spine 等），不含任何游戏原文。
// many：room 下再造 N 个小脚本，用来测翻页（默认 28，加上 2 个特殊的共 30，超过一页 25 条）
export async function buildGalFixture(root, { exampleScript = '', many = 28 } = {}) {
  const d = (...p) => path.join(root, ...p)
  const R = (...p) => d('resources', 'download', ...p)
  const T = (...p) => R('adv', 'text', ...p)
  // —— 根上的东西 ——
  await mkdir(root, { recursive: true })
  await writeFile(d('UViewer.exe'), 'MZ')
  await writeFile(d('start.bat'), '@echo off\nset DEV_MODE=1\nstart UViewer.exe\n')
  await writeFile(d('use start.bat.txt'), 'use start.bat\nsecond line\nthird line\n')
  await mkdir(d('user_data/thumbnails'), { recursive: true })
  await writeFile(d('user_data/settings.json'), JSON.stringify({ resource_path: './resources', script_language: 'zh', text_size: 18 }))
  await writeFile(d('user_data/character_names.json'), JSON.stringify({ 1003: '卡蒂娅', 1010: '小夜' }))
  // —— 资源（所有脚本共用 download/） ——
  await bgImage(R('bg/bg_school.jpg'), '教室', ['#2b6cb0', '#1a365d'])
  await bgImage(R('bg/bg_night.jpg'), '夜晚', ['#553c9a', '#1a202c'])
  await bgImage(R('bg/bg_tall.jpg'), '竖图 600x1000', ['#2f855a', '#1c4532'], 600, 1000)
  await bgImage(R('bg/bg_wide.jpg'), 'wide 1600x400', ['#c05621', '#7b341e'], 1600, 400)
  await bgImage(R('bg/bg_10060200.jpg'), 'bg_10060200 (占位)', ['#744210', '#1a202c'])
  await tone(R('sound/bgm/bgm_a.wav'), 220, 2)
  await tone(R('sound/bgm/bgm_b.wav'), 330, 2)
  await tone(R('sound/bgm/bgm192.mp3'), 262, 3)       // 扩展名 .mp3 的 wav 数据：浏览器按内容解码
  await tone(R('sound/bgm/bgm163.mp3'), 392, 3)
  await tone(R('sound/se/se_1.wav'), 880, 0.3)
  await tone(R('sound/se/se_055.mp3'), 988, 0.4)
  await tone(R('character/100300/adv/sound/fav100300_01_01.mp3'), 440, 0.6)
  await mkdir(R('character/100300/adv/image'), { recursive: true })
  run(magick[0], ['-size', '256x256', 'gradient:#d53f8c-#702459', '-quality', '80', R('character/100300/adv/image/100300.png')])   // 角色 1003 的头像
  run(magick[0], ['-size', '320x180', 'gradient:#38a169-#1c4532', '-quality', '80', d('user_data/thumbnails/600130.webp')])        // UViewer 自己生成的脚本缩略图

  // —— cabin：资源齐全，覆盖基础指令 + 带 BOM 的第二个脚本 + 一个不是脚本的 txt ——
  await mkdir(T('cabin/adultr'), { recursive: true })
  await writeFile(T('cabin/adultr/600130.txt'), [
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
    'spriteatlas,download/character/100301/adv/atlas/stand_a,body:smile,a1,0,-100,0.5,0.5,,,,',
    'anm,tint,a1,150_150_150,0.0001,0',
    'name,<outline width=2 color=black>小夜</outline>,',
    'msg,0,<color=#ffb347>橙色的字</color>、<b>粗体</b>、<i>斜体</i>，还有半角逗号, 和第二行\\n换行了。,,,,,,,,,',
    'playse,/download/sound/se/se_1.wav',
    'clickwait,,,,,,,,,,,',
    '',
    'bg,download/bg/bg_night.jpg,0.8,,,,,,,,',
    'playvoice,0,/download/character/100300/adv/sound/fav100300_01_01.mp3',
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
  await writeFile(T('cabin/adultr/600230.txt'), '﻿bg,download/bg/bg_night.jpg,0\nname,小夜,\nmsg,0,第二个脚本（带 BOM）。,,,\nclickwait\nmsg,0,结束。\nclickwait\n')
  await writeFile(T('cabin/adultr/notes.txt'), '这不是剧情脚本，不应该出现在列表里。\n第二行\n第三行\n')

  // —— character/1003：带分支的脚本（select / if / elseif / endif、<size>、<ruby>、多余的 endif）+ 普通脚本 + _old + extra ——
  await mkdir(T('character/1003/adultr'), { recursive: true })
  await mkdir(T('character/1003/extra'), { recursive: true })
  await writeFile(T('character/1003/adultr/100300.txt'), [
    'name,', 'stopbgm,,,,,,,,,,,', 'fadeinblack,0,,,,,,,,,,', 'endwait,,,,,,,,,,,', 'bg,download/bg/bg_school.jpg,0.0,,,,,,,,,', 'endwait,,,,,,,,,,,', 'fadeoutblack,0.3,,,,,,,,,,', 'endwait,,,,,,,,,,,',
    'playbgm,/download/sound/bgm/bgm_a.wav,0.5,,,', 'endwait',
    'spriteatlas,download/character/100301/adv/atlas/stand_a,body:surprise,catia,30,-40,0.5,0.5,,,,', 'endwait,,,,,,,,,,,',
    'spine,download/adv/spine/Mark11,em1,default,animation,0,170,70,0.65,0.8,0', 'endwait,,',
    'name,<size=27><outline width=2 color=black>卡蒂娅</outline></size>,,,,,,,,,,',
    'msg,1,<size=30><outline width=2 color=black>「你想听听我的事情……吗？」</outline></size>,,,,,,,,,,',
    'playvoice,1,/download/character/100300/adv/sound/fav100300_01_01.mp3',
    'clickwait,,,,,,,,,,,',
    'spineoff,em1,0,,,,,,,,,', 'endwait',
    'msg,1,<size=30>「<ruby>幻夢境|げんむきょう</ruby>的事，要从头说起。」</size>,,,,,,,,,,',
    'clickwait,,,,,,,,,,,',
    'select,選項1　「想听」,選項2　「不想听」',
    'if,select_===_1,,,,,,,,,,',
    'name,<size=27><outline width=2 color=black>卡蒂娅</outline></size>,,,,,,,,,,',
    'msg,1,<size=30>「那么，请听我说。」</size>,,,,,,,,,,',
    'clickwait,,,,,,,,,,,',
    'msg,1,<size=30>「（分支 1 的第二句）」</size>,,,,,,,,,,',
    'clickwait,,,,,,,,,,,',
    'elseif,select_===_2,,,,,,,,,,',
    'name,<size=27><outline width=2 color=black>卡蒂娅</outline></size>,,,,,,,,,,',
    'msg,1,<size=30>「……是吗。那下次吧。」</size>,,,,,,,,,,',
    'clickwait,,,,,,,,,,,',
    'endif,,,,,,,,,,,',
    'msg,1,<size=30>「（两条分支汇合后的句子）」</size>,,,,,,,,,,',
    'clickwait,,,,,,,,,,,',
    'fadeinblack,0.2,,,,,,,,,,', 'endwait,,,,,,,,,,,',
    'endif,,,,,,,,,,,',   // 没有对应 if 的多余 endif：解析要容忍
    'name,,,,,,,,,,,', 'msg,0,,,,,,,,,,,', 'spriteoff,all,0.5,,,,,,,,,', 'endwait,,,,,,,,,,,', 'bgoff,0.2,,,,,,,,,,', 'endwait,,,,,,,,,,,',
  ].join('\n'))
  const tiny = (who, text, bg = 'school') => `bg,download/bg/bg_${bg}.jpg,0\nname,${who},\nmsg,0,${text}\nclickwait\nmsg,0,（${text}的第二句）\nclickwait\n`
  await writeFile(T('character/1003/adultr/10030304.txt'), tiny('卡蒂娅', '10030304 普通脚本'))
  await writeFile(T('character/1003/adultr/10030305.txt'), tiny('卡蒂娅', '10030305 普通脚本', 'night'))
  await writeFile(T('character/1003/adultr/10030305_old.txt'), tiny('卡蒂娅', '10030305 旧版本'))
  await writeFile(T('character/1003/extra/10030302.txt'), tiny('卡蒂娅', 'extra 里的脚本'))
  // —— character/1010：长脚本（立绘/遮罩/Spine 等暂未渲染的指令；真实示例脚本给了就用它）——
  await mkdir(T('character/1010/adultr'), { recursive: true })
  if (exampleScript) await copyFile(exampleScript, T('character/1010/adultr/10100204.txt'))
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
    await writeFile(T('character/1010/adultr/10100204.txt'), lines.join('\n'))
  }
  // —— character/2001：没有名称、没有头像 ——
  await mkdir(T('character/2001/adultr'), { recursive: true })
  await writeFile(T('character/2001/adultr/20010404.txt'), 'bg,download/bg/bg_tall.jpg,0\nmsg,0,没有头像、没有名字的角色。\nclickwait\n')

  // —— 其它目录：event/<id>、quest/<id>（没有 adultr 这一层）、memorial（平铺）、other/9000/adultr、gacha/adultr、tutorial/adultr ——
  for (const [dir, files] of [
    ['event/20023', ['1011001', '1011002', '1011003']], ['event/20036', ['1012301']], ['quest/10001', ['100101001', '100101002']],
    ['memorial', ['600222', '600312']], ['other/9000/adultr', ['90500800']], ['gacha/adultr', ['600830']], ['tutorial/adultr', ['600010001']],
  ]) {
    await mkdir(T(dir), { recursive: true })
    for (const f of files) await writeFile(T(dir, `${f}.txt`), tiny('旁白', `${dir}/${f}`))
  }
  // —— room：资源缺失 + 超宽背景 + 超长文件名 + 很多小脚本（翻页） ——
  await mkdir(T('room'), { recursive: true })
  await writeFile(T('room/100101027.txt'), 'bg,download/bg/missing.jpg,0.2\nplaybgm,/download/sound/bgm/none.mp3,0\nname,谁,\nmsg,0,背景和 BGM 都不存在。,,,\nclickwait\nmovie,download/mov/none.mp4,0,1\nmsg,0,视频也不存在。\nclickwait\n')
  await writeFile(T('room/100102015.txt'), 'bg,download/bg/bg_wide.jpg,0\nname,甲,\nmsg,0,超宽背景 1600x400。\nclickwait\n')
  for (let i = 1; i <= many; i++) {
    const n = String(i).padStart(2, '0')
    await writeFile(T(`room/1001130${n}.txt`), tiny('房间', `第 ${n} 个房间脚本`, i % 2 ? 'school' : 'night'))
  }
  await writeFile(T('room', `超长文件名-${'这是一个非常非常长的脚本名'.repeat(3)}-Extraordinarily-Long-Unbroken-${'x'.repeat(40)}.txt`), 'bg,download/bg/bg_wide.jpg,0\nname,甲,\nmsg,0,超长文件名。\nclickwait\n')

  // —— 另一套文本（用户换汉化文本时留下的备份目录，同结构） ——
  await mkdir(R('adv/text---日文20251102/cabin/adultr'), { recursive: true })
  await mkdir(R('adv/text---日文20251102/character/1003/adultr'), { recursive: true })
  await writeFile(R('adv/text---日文20251102/cabin/adultr/600131.txt'), tiny('サヨ', '日本語版のスクリプト'))
  await writeFile(R('adv/text---日文20251102/character/1003/adultr/10030304.txt'), tiny('カティア', '日本語版 10030304'))
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const out = process.argv[2]
  if (!out) { console.error('用法: make-gal-fixture.mjs <输出根目录> [--example <脚本>]'); process.exit(2) }
  const i = process.argv.indexOf('--example')
  await buildGalFixture(path.resolve(out), { exampleScript: i > 0 ? process.argv[i + 1] : '' })
  console.log('ok', out)
}
