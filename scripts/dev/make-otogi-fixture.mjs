#!/usr/bin/env node
// 造 Otogi Frontier R（离线网页版）的 Gal 演示 / 测试数据（合成的，只有结构，台词都是自己编的，没有原作内容）：
//   <根>/list.json（带 BOM）·  MasterData/MMonsters.json · Episode/Main/<章 id> · VieableEpisodeList/<n>（10031 那份超过 24KB，抽样会被截断）
//   <根>/typeadv/MScenes/<id>        普通剧情（**没有扩展名**）：3（主线 1-1，9 行，覆盖背景 / BGM / SE / 语音 / 特效 / 左右立绘 / 重复角色 / 旁白 / 空 Phrase / IsBackgroundOnly / 未知特效）、
//                                    4（带 BOM + 缩进）、210011 / 210021 / 210031（角色剧情）、notes（不是 JSON，不是剧情）
//   <根>/typeadv/MScenes_TW/<id>     台湾语言版：3 是数组（两个场景）、4 是对象、5 只有 TW 有
//   <根>/json/<id> · jsoncn/<id>     成人剧情：1200051（5 行 + 空 Serif，Spine 静态画面 + 语音 + 特效 + 速度）、1200052（压缩成一行，没有 Spine 骨架）；jsoncn/1200051 是中文缩进版
//   <根>/chara/still/1200051/1200051.json（Spine 3.6 JSON，animation1..4）+ .atlas.txt + .png
//   <根>/typeadv/CharaStand/Adventure/<角色>/{body,idle,idle_c,angry,angry_c}.png（body 100×200；idle = 透明底 + 蓝块，idle_c = 透明底 + 黄块，叠起来看顺序）
//   <根>/typeadv/bg/adventure/bg_adventure_0001.png · typeadv/bg/bg_adventure_0002.png（平铺的那种）· bgm/*.m4a · typeadv/voice/adventure/voice_adventure_<场景>/*.m4a · othersounds/still/<id>/*.m4a · icon/chara/icon/png/10011.png
//   node scripts/dev/make-otogi-fixture.mjs <输出根目录>      需要 ImageMagick（convert）
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atlasText, spineJson } from './make-spine-fixture.mjs'

const BOM = '﻿'
// 普通剧情的一行（20 个键，和真实数据一样）
export const row = (over = {}) => ({
  Id: 1, MSceneId: 3, IsAdult: false, ViewOrder: 1, Position: 1, Name: '', Phrase: '', PhraseFontSize: null, IsPhraseCenter: null, SpeechBalloon: null, MMonsterId: null, EmotionId: null,
  FrameImage: null, CharaAnimation: null, VoiceFileName: '', HintImageName: '', BackgroundImage: null, BGM: null, SE: null, Effect: null, ...over,
})
const speech = (position, name, phrase, monster, emotion, over = {}) => row({ Position: position, Name: name, Phrase: phrase, PhraseFontSize: 2, IsPhraseCenter: false, SpeechBalloon: 1, MMonsterId: monster, EmotionId: emotion, FrameImage: '1', ...over })
const adultRow = (order, over = {}) => ({ Order: order, Name: '', Serif: '', Motion: null, Voice: '', StillPath: '', BGM: null, CharaAnimation: null, SE: '', Effect: null, ...over })

export const SCENE_3 = { Id: 3, Title: '1-1 Arrival', MSceneDetails: [
  row({ ViewOrder: 1, Phrase: '%user_name arrives at the little island.', BackgroundImage: 'bg_adventure_0001', BGM: 'bgm_adv_03' }),
  speech(2, 'Alice', 'Hello there.', 10011, 1, { ViewOrder: 2, VoiceFileName: 'm1_001', SE: 'se_adv_09', Effect: 'Flash' }),
  speech(3, 'Bob', 'Hi, %user_name.', 10021, 4, { ViewOrder: 3, VoiceFileName: 'm1_missing' }),
  speech(2, 'Bob', 'Now I stand on the left.', 10021, 4, { ViewOrder: 4 }),
  row({ ViewOrder: 5, Phrase: 'Narration keeps the stands.' }),
  row({ ViewOrder: 6, Phrase: '', BackgroundImage: 'bg_adventure_0002', Effect: 'Damage' }),
  speech(2, 'Alice', 'Back to Alice.', 10011, 8, { ViewOrder: 7 }),
  row({ ViewOrder: 8, Phrase: 'The end<br>second line for %user_name.', IsBackgroundOnly: true }),
  row({ ViewOrder: 9, Phrase: 'Weird effect.', Effect: 'Weird' }),
] }
const simple = (id, title, lines, monster = null) => ({ Id: id, Title: title, MSceneDetails: lines.map((line, i) => (monster ? speech(2, 'Alice', line, monster, 1, { ViewOrder: i + 1, MSceneId: id }) : row({ ViewOrder: i + 1, MSceneId: id, Phrase: line }))) })
export const ADULT_1 = { Id: 1200051, Description: '', MAdultDetails: [
  adultRow(1, { Name: 'Alice', Serif: '%user_name, hello.', Motion: 1, Voice: 'h_v1', BGM: 'bgm_10', CharaAnimation: 1 }),
  adultRow(2, { Name: '', Serif: 'Narration line.', Motion: 2, CharaAnimation: 2, Voice: 'h_missing' }),
  adultRow(3, { Serif: 'Climax.', Motion: 1, CharaAnimation: 3, Effect: '2' }),
  adultRow(4, { Serif: 'Afterglow.', Motion: 0, CharaAnimation: 4 }),
  adultRow(5, { Effect: '1', SE: 'se_x', StillPath: 'c_1_', Serif: null }),
  adultRow(6, { Serif: '' }),
] }
const ADULT_1_CN = { ...ADULT_1, MAdultDetails: ADULT_1.MAdultDetails.map((r) => (r.Serif ? { ...r, Serif: `[CN] ${r.Serif}` } : r)) }
const ADULT_2 = { Id: 1200052, Description: '', MAdultDetails: [adultRow(1, { Name: 'Bob', Serif: 'No skeleton for me.', CharaAnimation: 1, Motion: 1 }), adultRow(2, { Serif: 'Second.' })] }

// 0.3 秒静音 WAV（没有 ffmpeg 也能造）：内容写进 .m4a，浏览器按内容嗅探照样能放（服务端只看扩展名给 audio/mp4），播放器不会因为解码失败把它记成「缺少资源」
function silentWav() {
  const samples = 2205
  const b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(7350, 24); b.writeUInt32LE(14700, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40)
  return b
}

export async function buildOtogiFixture(root) {
  const at = (rel) => path.join(root, ...rel.split('/'))
  const put = async (rel, content) => { await mkdir(path.dirname(at(rel)), { recursive: true }); await writeFile(at(rel), content) }
  const png = async (rel, args) => { await mkdir(path.dirname(at(rel)), { recursive: true }); execFileSync('convert', [...args, at(rel)]) }
  const json = (value, pretty = false, bom = false) => `${bom ? BOM : ''}${JSON.stringify(value, null, pretty ? 2 : 0)}`

  // ---- 目录数据
  await put('list.json', json({
    list: ['1001', '1002', '3', '4'], bgm: ['bgm_adv_03.m4a', 'bgm_10.m4a'], bgimg: ['typeadv/bg/adventure/bg_adventure_0001.png'],
    worldmap: [{ map: 'bg_worldmap.png', data: [{ Id: 1001, Name: '1.Small Island', X: '310', Y: '-120' }, { Id: 1002, Name: '2.Oz', X: '280', Y: '-300' }] }, {}],
    worldbg: { 25001: 'ui/countrymaps/mainstory_chapter2_1.png' },
    chara: { 1001: { name: ['Alice (list)'] }, 1002: { name: ['Bob (list)'] }, 1003: { name: ['Fallback Name'] } },
    data: { 1200051: { 1: { X: 10, Y: -20, Z: 1.25 } }, 1200099: { 1: { X: 0, Y: 20, Z: 0.95 } } },
  }, false, true))
  await put('MasterData/MMonsters.json', json([{ id: 10011, n: 'Alice', rb: 'a', d: 'desc' }, { id: 10021, n: 'Bob', rb: 'b', d: 'desc' }, { id: 99999, n: 'Unused', rb: 'u', d: '' }]))
  await put('Episode/Main/1001', json([
    { MStoryId: 3, Title: '1 Arrival', Viewable: true, RequireCondition: '1-1 clear' },
    { MStoryId: 4, Title: '2 Second', Viewable: true, RequireCondition: '1-2 clear' },
    { MStoryId: 777, Title: '3 Missing file', Viewable: false, RequireCondition: '' },
  ]))
  await put('Episode/Main/25001', json([{ MStoryId: 210011, Title: 'Later chapter', Viewable: true, RequireCondition: '' }]))
  await put('VieableEpisodeList/10011', json([
    { Id: 1, MSceneId: 210011, MAdultId: 1200051, MMonsterId: 10011, Title: 'Alice story one', Description: 'd', IsViewable: true },
    { Id: 2, MSceneId: 999999, MAdultId: null, MMonsterId: 10011, Title: 'Alice missing scene', Description: 'd', IsViewable: true },
  ]))
  await put('VieableEpisodeList/10021', json([{ Id: 3, MSceneId: 210021, MAdultId: 1200052, MMonsterId: 10021, Title: 'Bob story', Description: 'd', IsViewable: true }]))
  const filler = [{ Id: 10, MSceneId: 210031, MAdultId: null, MMonsterId: 10031, Title: 'Big list first', Description: 'd', IsViewable: true }]
  for (let i = 0; i < 300; i++) filler.push({ Id: 100 + i, MSceneId: 300000 + i, MAdultId: null, MMonsterId: 10031, Title: `Filler ${i} ${'x'.repeat(60)}`, Description: 'd', IsViewable: true })
  // 一个文件 = 一个角色的全部形态：数组里的 MMonsterId 是连续的变体（10042 / 10043）；对象写法 { RootMonsterId, Episodes } 的两个文件指向同一个根 = 合成一组
  await put('VieableEpisodeList/10041', json([
    { Id: 20, MSceneId: 210011, MAdultId: null, MMonsterId: 10042, Title: 'Form A', Description: 'd', IsViewable: true },
    { Id: 21, MSceneId: 210021, MAdultId: null, MMonsterId: 10043, Title: 'Form B', Description: 'd', IsViewable: true },
  ]))
  await put('VieableEpisodeList/10051', json({ RootMonsterId: 10051, RootSpiritId: 0, Favorite: false, Episodes: [{ Id: 30, MSceneId: 210011, MAdultId: null, MMonsterId: 10052, Title: 'Root one', Description: 'd', IsViewable: true }] }))
  await put('VieableEpisodeList/10061', json({ RootMonsterId: 10051, RootSpiritId: 0, Favorite: false, Episodes: [{ Id: 31, MSceneId: 210021, MAdultId: null, MMonsterId: 10062, Title: 'Root two', Description: 'd', IsViewable: true }] }))
  await put('VieableEpisodeList/10031', json(filler))   // > 24KB：contextTextFilter 只读开头 24KB，被截断的数组要能容忍

  // ---- 普通剧情（没有扩展名）
  await put('typeadv/MScenes/3', json(SCENE_3))
  await put('typeadv/MScenes/4', json(simple(4, '1-2 Second', ['Second scene, line one.', 'Second scene, line two.']), true, true))
  await put('typeadv/MScenes/210011', json(simple(210011, 'Alice private scene', ['Alice speaks.'], 10011)))
  await put('typeadv/MScenes/210021', json(simple(210021, 'Bob private scene', ['Bob speaks.'], 10021)))
  await put('typeadv/MScenes/210031', json(simple(210031, 'Fallback character scene', ['Someone speaks.'])))
  await put('typeadv/MScenes/notes', 'this is not a scene')
  await put('typeadv/MScenes_TW/3', json([{ ...SCENE_3, Title: '1-1 [TW]', MSceneDetails: SCENE_3.MSceneDetails.slice(0, 2).map((r) => ({ ...r, Phrase: `[TW] ${r.Phrase}` })) }, simple(3, 'second scene in the array', ['Only if arrayScenes is all.'])]))
  await put('typeadv/MScenes_TW/4', json(simple(4, '1-2 [TW]', ['[TW] Second scene.'])))
  await put('typeadv/MScenes_TW/5', json(simple(5, 'TW only scene', ['[TW] Only in the twin directory.'])))

  // ---- 成人剧情
  await put('json/1200051', json(ADULT_1))
  await put('json/1200052', json(ADULT_2))
  await put('jsoncn/1200051', json(ADULT_1_CN, true))
  await mkdir(at('chara/still/1200051'), { recursive: true })
  await writeFile(at('chara/still/1200051/1200051.json'), spineJson({ animations: ['animation1', 'animation2', 'animation3', 'animation4'], version: '3.6.53' }))
  await writeFile(at('chara/still/1200051/1200051.atlas.txt'), atlasText('1200051'))
  execFileSync('convert', ['-size', '64x128', 'xc:seagreen', at('chara/still/1200051/1200051.png')])

  // ---- 立绘 / 背景 / 声音 / 图标
  for (const [id, color, face] of [[10011, 'crimson', 'idle'], [10021, 'royalblue', 'angry']]) {
    const dir = `typeadv/CharaStand/Adventure/${id}`
    await png(`${dir}/body.png`, ['-size', '100x200', `xc:${color}`])
    await png(`${dir}/${face}.png`, ['-size', '100x200', 'xc:none', '-fill', 'blue', '-draw', 'rectangle 10,10 40,40'])
    await png(`${dir}/${face}_c.png`, ['-size', '100x200', 'xc:none', '-fill', 'yellow', '-draw', 'rectangle 10,10 60,60'])
  }
  await png('typeadv/bg/adventure/bg_adventure_0001.png', ['-size', '64x36', 'xc:seagreen'])
  await png('typeadv/bg/bg_adventure_0002.png', ['-size', '64x36', 'xc:navy'])
  await png('icon/chara/icon/png/10011.png', ['-size', '8x8', 'xc:orange'])
  for (const rel of ['bgm/bgm_adv_03.m4a', 'bgm/bgm_10.m4a', 'typeadv/voice/adventure/voice_adventure_3/m1_001.m4a', 'typeadv/voice/adventure/voice_adventure_3/se_adv_09.m4a', 'othersounds/still/1200051/h_v1.m4a']) await put(rel, silentWav())
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node scripts/dev/make-otogi-fixture.mjs <输出根目录>'); process.exit(2) }
  await buildOtogiFixture(path.join(out, 'Otogi演示'))
  console.log(`done: ${out}/Otogi演示`)
}
