#!/usr/bin/env node
// 造一个「很大」的 UViewer 资源包（只有脚本，没有图片 / 音频），压测 Gal 浏览 / 脚本的目录读取：
//   node scripts/dev/make-gal-big-fixture.mjs <输出目录> [角色数=300] [每个角色的脚本数=12] [房间里的脚本数=1000]
//   <输出>/resources/download/adv/text/character/<编号>/{adultr,extra}/<编号><nn>.txt、room/（一个目录里一堆脚本）、cabin、
//   user_data/character_names.json
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export async function buildBigGalFixture(root, { characters = 300, perCharacter = 12, room = 1000 } = {}) {
  const text = path.join(root, 'resources', 'download', 'adv', 'text')
  const script = (id) => [
    'bg,download/bg/a.jpg,0.5', `name,角色${id},`, `msg,0,第一句台词 ${id},,,,,,,,,`, 'clickwait', `msg,0,第二句台词 ${id},,,,,,,,,`, 'clickwait', 'playbgm,download/bgm/a.mp3', `msg,0,第三句台词 ${id}`, 'clickwait',
  ].join('\n')
  const names = {}
  for (let c = 0; c < characters; c++) {
    const id = String(1000 + c)
    names[id] = `角色名${id}`
    for (const dir of ['adultr', 'extra']) {
      const folder = path.join(text, 'character', id, dir)
      await mkdir(folder, { recursive: true })
      const count = dir === 'adultr' ? Math.ceil(perCharacter * 0.7) : Math.floor(perCharacter * 0.3)
      for (let k = 0; k < count; k++) await writeFile(path.join(folder, `${id}${String(k).padStart(2, '0')}${dir === 'adultr' ? '04' : '05'}.txt`), script(`${id}-${k}`))
    }
  }
  await mkdir(path.join(text, 'room'), { recursive: true })
  for (let k = 0; k < room; k++) await writeFile(path.join(text, 'room', `room${String(k).padStart(4, '0')}.txt`), script(`room-${k}`))
  await mkdir(path.join(text, 'cabin', 'adultr'), { recursive: true })
  for (let k = 0; k < 30; k++) await writeFile(path.join(text, 'cabin', 'adultr', `cabin${k}.txt`), script(`cabin-${k}`))
  await mkdir(path.join(root, 'user_data'), { recursive: true })
  await writeFile(path.join(root, 'user_data', 'character_names.json'), JSON.stringify(names))
  return { characters, files: characters * perCharacter + room + 30 }
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (!process.argv[2]) { console.error('用法：make-gal-big-fixture.mjs <输出目录> [角色数] [每个角色的脚本数] [房间里的脚本数]'); process.exit(2) }
  const result = await buildBigGalFixture(process.argv[2], { characters: Number(process.argv[3] || 300), perCharacter: Number(process.argv[4] || 12), room: Number(process.argv[5] || 1000) })
  console.log(`done: ${result.files} 个脚本 → ${process.argv[2]}`)
}
