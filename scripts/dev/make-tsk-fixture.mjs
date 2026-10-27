#!/usr/bin/env node
// 造 Twinkle Star Knights X（Unity + Utage）的 Gal 演示 / 测试数据（合成的，名字和台词都是自己编的，没有原作内容）：
//   <根>/Twinkle Star Knights X/Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X/（= SA，真实游戏里的数据根）
//     Adventure/Master.chapter.json（settingList：Character / Texture / Sound / Layer / Param 五张表；Character、Sound 的表头第 0 列是空的，Layer 的不是）
//     Adventure/BackGrounds/*.png  Adventure/<MainScenario|CharaScenario>/*.book.json
//     Characters/ch_<id>/ch_<id>_m0|m1.{skel.bytes,atlas.txt,png}  Stills/st_<id>/st_<id>.{…}（Spine 4.0.37 的 JSON 骨架，存成 .skel.bytes，播放器按内容认格式）
//     Sound/{Bgm,Se,BgSe,BgVoice}/*.ogg  Sound/Voice/ImportChara/<角色号>/*.ogg
//   剧情：MainScenario0001（两个 grid：几乎每种命令一行）、MainScenario0002（最后一个选项分支没有结束标记）、CharaScenario1002001（选项分支：交错写法 + Jump 汇合）、CharaScenario1002002（连续 Selection + EndScenario 结尾）
//   node scripts/dev/make-tsk-fixture.mjs <输出根目录>     需要 ImageMagick
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeSpine } from './make-spine-fixture.mjs'

export const TSK_GAME = 'Twinkle Star Knights X'
export const TSK_SA = `${TSK_GAME}/${TSK_GAME}_Data/StreamingAssets/${TSK_GAME}`
export const TSK_CHARA_ANIMS = ['wait', 'idle_normal', 'idle_joy']
export const TSK_STILL_ANIMS = ['cut_1', 'cut_2_loop', 'cut_3_loop']

const COLUMNS = ['Command', 'Arg1', 'Arg2', 'Arg3', 'Arg4', 'Arg5', 'Arg6', 'Skin', 'SpineAnim', 'SpineSubAnim', 'AnimCompType', 'AnimSpd', 'WaitType', 'Text', 'PageCtrl', 'Voice', 'WindowType']
const KEYS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'skin', 'anim', 'sub', 'comp', 'speed', 'wait', 'text', 'page', 'voice', 'window']
// 一行：strings[0..16] 按列放；o = { a1…a6, skin, anim, sub, speed, wait, text, voice, window }
const strings = (command, o = {}) => [command, ...KEYS.map((key) => String(o[key] ?? ''))]
const header = () => ({ strings: [...COLUMNS] })
export const R = (command, o = {}) => ({ strings: strings(command, o) })
export const comment = (command = '', o = {}) => ({ strings: strings(command, o), isCommentOut: 1 })
export const empty = () => ({ strings: [''], isEmpty: 1 })
// 台词 / 立绘行（Command 为空）
export const T = (o) => R('', o)

const bookJson = (name, grids) => JSON.stringify({
  m_GameObject: { m_FileID: 0, m_PathID: 0 }, m_Enabled: 1, m_Script: { m_FileID: 0, m_PathID: -5320795759588794896 }, m_Name: `${name}.book`, importVersion: 0,
  importGridList: grids.map(([gridName, rows]) => ({
    rows: [header(), ...rows].map((row, i) => ({ rowIndex: i, isEmpty: 0, isCommentOut: 0, ...row })),
    name: `Assets/Adventure/Chapters/${name}.xlsx:${gridName}`, type: 1, textLength: 0, headerRow: 0, entityIndexTbl: [], entityDataList: [],
  })),
  _tsk_zh: 1,
}, null, 2)

// Master 表：cells = { 列号: 值 }
const table = (name, columns, rows, commentRows = 1) => ({
  rows: [
    { rowIndex: 0, strings: (() => { const out = []; for (const [i, c] of Object.entries(columns)) out[Number(i)] = c; return Array.from(out, (v) => v ?? '') })(), isEmpty: 0, isCommentOut: 0 },
    ...Array.from({ length: commentRows }, (_, i) => ({ rowIndex: i + 1, strings: [''], isEmpty: 0, isCommentOut: 1 })),
    ...rows.map((cells, i) => ({ rowIndex: i + 1 + commentRows, strings: (() => { const out = []; for (const [k, v] of Object.entries(cells)) out[Number(k)] = v; return Array.from(out, (v) => v ?? '') })(), isEmpty: 0, isCommentOut: 0 })),
  ],
  name: `Assets/Adventure/Chapters/Master/Master.xls:${name}`, type: 1, textLength: 0, headerRow: 0,
})

export const masterJson = () => JSON.stringify({
  m_GameObject: { m_FileID: 0, m_PathID: 0 }, m_Enabled: 1, m_Script: { m_FileID: 0, m_PathID: -5040942498898396250 }, m_Name: 'Master.chapter', chapterName: '', dataList: [{ m_FileID: 1, m_PathID: -7609209237593861018 }],
  settingList: [
    table('Character', { 1: 'CharacterName', 2: 'NameText', 3: 'Pattern', 5: 'Y', 8: 'Scale', 10: 'FileName', 12: 'FileType' }, [
      { 1: 'ミナ-制服', 2: 'ミナ', 5: '130', 8: '1', 10: 'Characters/ch_1001001/ch_1001001_m0_SkeletonData.asset', 12: 'Spine' },
      { 1: 'ミナ-戦闘服', 2: 'ミナ', 5: '130', 8: '1', 10: 'Characters/ch_1001001/ch_1001001_m1_SkeletonData.asset', 12: 'Spine' },
      { 1: 'ルカ-制服', 2: 'ルカ', 5: '130', 8: '1', 10: 'Characters/ch_1001002/ch_1001002_m0_SkeletonData.asset', 12: 'Spine' },
      { 1: 'ゼロ-制服', 2: 'ゼロ', 5: '130', 8: '1', 10: 'Characters/ch_9999999/ch_9999999_m0_SkeletonData.asset', 12: 'Spine' },   // 磁盘上没有这套骨架
      { 1: 'ノア-制服', 10: 'Characters/ch_1001003/ch_1001003_m0_SkeletonData.asset', 12: 'Spine' },                                           // NameText 空：显示名取 '-' 前面的
    ]),
    table('Texture', { 1: 'Label', 2: 'Type', 7: 'Scale', 9: 'FileName' }, [
      { 1: 'bg_adv_001_1', 2: 'Bg', 7: '1.33', 9: 'Adventure/BackGrounds/bg_adv_001_1.png' },
      { 1: 'bg_adv_003_1', 2: 'Bg', 7: '1.33', 9: 'Adventure/BackGrounds/bg_adv_003_1.png' },
      { 1: 'bg_adv_099_1', 2: 'Bg', 7: '1.33', 9: 'Adventure/BackGrounds/bg_adv_099_1.png' },   // 磁盘上没有
      { 1: 'BE_001', 2: 'Sprite', 9: 'Adventure/BackGrounds/BE_001.png' },
    ]),
    table('Sound', { 1: 'Label', 2: 'Title', 3: 'Type', 4: 'IntroFileName', 5: 'FileName' }, [
      { 1: 'BGM_A001', 3: 'Bgm', 4: 'Sound/Bgm/BGM_A001_intro.ogg', 5: 'Sound/Bgm/BGM_A001_loop.ogg' },
      { 1: 'BGM_A002', 3: 'Bgm', 5: 'Sound/Bgm/BGM_A002_loop.ogg' },
      { 1: 'SE_0001', 3: 'Se', 5: 'Sound/Se/SE_0001.ogg' },
      { 1: 'SE_3022', 3: 'Se', 5: 'Sound/BgSe/SE_3022.ogg' },
    ]),
    table('Layer', { 0: 'LayerName', 1: 'Type', 4: 'Order' }, [{ 0: 'BackGround', 1: 'Bg', 4: '100' }, { 0: 'Chara1', 1: 'Character', 4: '201' }], 0),
    table('Param', { 0: 'Label', 1: 'Type', 2: 'Value' }, [{ 0: 'flag1', 1: 'Bool', 2: 'FALSE' }], 0),
  ],
  _tsk_zh_names: 1,
}, null, 2)

// ---------- 剧情 ----------
const main1 = [
  ['Main000101', [
    R('*main000101'),
    R('Bg', { a1: 'bg_adv_001_1', a6: '0.5' }),
    R('Bgm', { a1: 'BGM_A001' }),
    comment('Bg', { a1: 'bg_adv_003_1' }),
    empty(),
    T({ text: '雨の音だけが聞こえる。' }),                                                                     // 旁白
    T({ a1: 'ミナ-制服', a3: 'Chara1', a6: '0.5', skin: 'face3', anim: 'wait' }),                              // 立绘行：居中，淡入 0.5 秒
    T({ a1: 'ミナ-制服', skin: 'face3', text: '“こんにちは”', voice: 'a001_002_0277' }),                        // 台词（人已在场）+ 语音
    T({ a1: 'ルカ-制服', a3: 'Chara2', a4: '250', a6: '0.5', skin: 'face2', anim: 'wait' }),                    // 右 250
    T({ a1: 'ミナ-戦闘服', a3: 'Chara3', a4: '-250', skin: 'face1', anim: 'wait' }),                            // 左 -250
    T({ a1: 'ルカ-制服', skin: 'face5', text: '‘心の声’' }),                                                      // 表情变了：更新立绘
    T({ a1: 'ゼロ-制服', a2: '<Off>', a3: 'Chara1', a4: '0', a6: '0.5', skin: 'face2', text: '“画面の外から”' }),   // <Off>：只出名字和台词
    T({ a1: 'ノア-制服', a2: '<Off>', text: '“名前は - の前”' }),                                                // NameText 空
    T({ a1: 'ミナ-制服', a2: '<Character=ルカ-制服>', skin: 'face3', text: '“名前だけルカ”' }),                  // 说话人 = 括号里的
    R('Tween', { a1: 'ミナ-制服', a2: 'MoveBy', a3: 'time=.3 y=-30', a4: 'easeOutQuad', a5: 'pingPong=2', wait: 'NoWait' }),   // 下沉（动作 3）
    R('Tween', { a1: 'ルカ-制服', a2: 'MoveBy', a3: 'time=.1 x=30', a4: 'easeOutQuad', a5: 'pingPong=4', wait: 'NoWiat' }),    // 左右抖（动作 2），WaitType 手滑
    R('Tween', { a1: 'ルカ-制服', a2: 'MoveTo', a3: 'x=-250 time=1', wait: 'NoWait' }),                          // 改横向位置
    R('Tween', { a1: 'ミナ-制服', a2: 'ColorTo', a3: 'time=0 alpha=0.8' }),                                       // 没有对应字段 → raw
    R('Shake', { a1: 'Graphics', a3: 'x=30 y=30 time=1', wait: 'NoWite' }),
    R('Shake', { a1: 'ミナ-制服', a3: 'x=15 y=0 time=0.6', wait: 'NoWati' }),
    R('ZoomCamera', { a1: 'SpriteCamera', a2: '2', a4: '200', a6: '0' }),
    R('Se', { a1: 'SE_0001' }),
    R('BgSe', { a1: 'SE_3022' }),
    R('BgVoice', { a1: 'b001_002_0068' }),
    T({ text: '……。', window: 'IF(COUNTA($A12:$P12)>0,"","〇")' }),                                              // WindowType 里是表格公式，忽略
    R('ZoomCamera', { a1: 'SpriteCamera', a2: '1', a6: '0' }),
    R('StopBgSe'), R('StopBgVoice'), R('StopSe'),
    R('Sprite', { a1: 'BE_001', a3: 'EffectF' }), R('SpriteOff', { a1: 'BE_001' }),
    R('FadeOut', { a6: '.7' }),
    R('CharacterOff'),
    R('Bg', { a1: 'bg_adv_003_1' }),
    R('Wait', { a6: '0.5' }),
    R('FadeIn', { a6: '1' }),
    R('HideMessageWindow'),
    R('BgEvent', { a1: 'st_1001001', anim: 'cut_2_loop', speed: '0' }),                                           // 静态画面，循环
    T({ text: '一枚絵の上で。' }),
    R('BgEvent', { a1: 'st_1001001', anim: 'cut_1' }),                                                           // 同一幅换动画，不循环
    T({ text: '次の絵。' }),
    R('ShowMessageWindow'),
    R('BgEventOff'),
    T({ a1: 'ミナ-制服', a3: 'Chara1', a6: '0.5', skin: 'face1', anim: 'wait' }),
    T({ a1: 'ミナ-制服', skin: 'face1', text: '“資源の欠け”', voice: 'zz_missing_voice' }),                       // 缺语音
    R('Bg', { a1: 'bg_adv_099_1' }),                                                                             // 缺背景
    R('Bgm', { a1: 'BGM_A002' }),
    R('FooBar', { a1: 'x' }),                                                                                    // 不认识的命令
    R('Param', { a1: 'flag1=true' }), R('WaitCustom'), R('ImageEffectOff', { a1: 'SpriteCamera', a2: 'Sepia' }), R('ChangeSoundVolume', { a1: 'Bgm', a2: '0.5' }),
    R('StopBgm', { a6: '0.5' }),
    T({ a1: 'ミナ-制服', text: '“<ruby=こえ>声</ruby>と<color=red>色</color>”' }),
    R('EndScenario'),
  ]],
  ['Main000102', [
    R('*main000102'),
    R('Bg', { a1: 'bg_adv_003_1' }),
    T({ text: '二つ目の grid。立絵は持ち越さない。' }),
    R('EndScenario'),
  ]],
]

// 最后一个选项分支没有结束标记
const main2 = [['Main000201', [
  R('*main000201'), R('Bg', { a1: 'bg_adv_001_1' }),
  T({ text: '質問。' }),
  R('Selection', { a1: '*S-m2-1', text: '右' }), R('Selection', { a1: '*S-m2-2', text: '左' }),   // 连续的 Selection = 一次选择（Utage：连着的 Selection 行一起弹）
  R('*S-m2-1'), T({ text: '右の答え。' }),
  R('*S-m2-2'), T({ text: '左の答え（最後の分支、結束なし）。' }),
]]]

// 交错写法 + Jump 汇合；还有一条带 flag 的 Jump（没有运行时变量，当作没跳）
const chara1 = [['Chara100200101', [
  R('*chara1'), R('Bg', { a1: 'bg_adv_001_1' }),
  T({ text: '選んで。' }),
  R('Selection', { a1: '*S-c1-1', text: '一番' }),
  R('*S-c1-1'), T({ text: '一番の答え。' }), R('Jump', { a1: '*S-c1-end' }),
  R('Selection', { a1: '*S-c1-2', text: '二番' }),
  R('*S-c1-2'), T({ text: '二番の答え。' }), R('Jump', { a1: '*S-c1-end', a2: 'flag1' }), T({ text: '二番の続き。' }), R('Jump', { a1: '*S-c1-end' }),
  R('*S-c1-end'),
  T({ text: '合流した後の台詞。' }),
  R('EndScenario'),
]]]

// 连续的 Selection（相邻写法）+ 分支用 EndScenario 收尾
const chara2 = [['Chara100200201', [
  R('*chara2'), R('Bg', { a1: 'bg_adv_001_1' }),
  R('Selection', { a1: '*S-c2-1', text: '甲' }), R('Selection', { a1: '*S-c2-2', text: '乙' }), R('Selection', { a1: '*S-c2-3', text: '丙' }),
  R('*S-c2-1'), T({ text: '甲。' }), R('Jump', { a1: '*S-c2-0' }),
  R('*S-c2-2'), T({ text: '乙。' }), R('Jump', { a1: '*S-c2-0' }),
  R('*S-c2-3'), T({ text: '丙。' }),
  R('*S-c2-0'), T({ text: '全員の後。' }),
  R('EndScenario'),
]]]

export async function buildTskFixture(root) {
  const sa = path.join(root, TSK_SA)
  const at = (...parts) => path.join(sa, ...parts)
  const put = async (rel, content) => { await mkdir(path.dirname(at(rel)), { recursive: true }); await writeFile(at(rel), content) }
  const img = async (rel, size, color) => { await mkdir(path.dirname(at(rel)), { recursive: true }); execFileSync('convert', ['-size', size, `xc:${color}`, at(rel)]) }

  await put('Adventure/Master.chapter.json', masterJson())
  await put('Adventure/MainScenario/MainScenario0001.book.json', bookJson('MainScenario0001', main1))
  await put('Adventure/MainScenario/MainScenario0002.book.json', bookJson('MainScenario0002', main2))
  await put('Adventure/CharaScenario/CharaScenario1002001.book.json', bookJson('CharaScenario1002001', chara1))
  await put('Adventure/CharaScenario/CharaScenario1002002.book.json', bookJson('CharaScenario1002002', chara2))
  await put('Adventure/NAME.txt', 'names')
  for (const [name, color] of [['bg_adv_001_1', 'seagreen'], ['bg_adv_003_1', 'steelblue']]) await img(`Adventure/BackGrounds/${name}.png`, '64x36', color)
  // 骨架：Spine 4.0.37 的 JSON（真实游戏是同版本的二进制），角色一套 m0 / m1，静态画面一套
  await writeSpine(at('Characters/ch_1001001'), 'ch_1001001_m0', { format: 'json', version: '4.0.37', color: 'crimson', animations: TSK_CHARA_ANIMS })
  await writeSpine(at('Characters/ch_1001001'), 'ch_1001001_m1', { format: 'json', version: '4.0.37', color: 'goldenrod', animations: TSK_CHARA_ANIMS })
  await writeSpine(at('Characters/ch_1001002'), 'ch_1001002_m0', { format: 'json', version: '4.0.37', color: 'deepskyblue', animations: TSK_CHARA_ANIMS })
  await writeSpine(at('Characters/ch_1001003'), 'ch_1001003_m0', { format: 'json', version: '4.0.37', color: 'purple', animations: TSK_CHARA_ANIMS })
  await writeSpine(at('Stills/st_1001001'), 'st_1001001', { format: 'json', version: '4.0.37', color: 'forestgreen', animations: TSK_STILL_ANIMS, region: { width: 300, height: 300, y: 150 } })
  const dummy = Buffer.alloc(64)
  for (const rel of ['Sound/Bgm/BGM_A001_intro.ogg', 'Sound/Bgm/BGM_A001_loop.ogg', 'Sound/Bgm/BGM_A002_loop.ogg', 'Sound/Se/SE_0001.ogg', 'Sound/BgSe/SE_3022.ogg', 'Sound/Voice/ImportChara/1001001/a001_002_0277.ogg', 'Sound/Voice/ImportChara/1001001/b001_002_0068.ogg', 'Sound/BgVoice/b001_002_0068.ogg']) await put(rel, dummy)
  await img('Adventure/Effects/AE_0010/Line1.png', '8x8', 'gray')   // 不是剧情的目录
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node scripts/dev/make-tsk-fixture.mjs <输出根目录>'); process.exit(2) }
  await buildTskFixture(path.join(out, 'tsk演示'))
  console.log(`done: ${out}/tsk演示`)
}
