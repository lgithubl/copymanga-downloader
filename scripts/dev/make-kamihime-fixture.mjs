#!/usr/bin/env node
// 造 Kamihime Player（TyranoScript .ks）的 Gal 演示 / 测试数据（合成的，名字和台词都是自己编的，没有原作内容）：
//   <根>/game/dmm/raw_scenario/<类别>/<目录>/<id>_script.ks + <id>.json（{ is_r18, resource_directory, scenario_path, summary, title }）
//   <根>/game/dmm/assets/<stem>-<sha1 40 位十六进制>.<扩展名>   平铺（带 hash 的图 / BGM）
//   <根>/game/dmm/assets/<48 位十六进制 resource_directory>/*.mp3   不带 hash 的语音（两个剧情各一个目录，里面有同名文件，用来验证「按本剧情的目录找」）
//   故意缺的：一个表情图（不带 hash，磁盘上没有）、一个表情图（带 hash，磁盘上没有）、一个语音
//   node scripts/dev/make-kamihime-fixture.mjs <输出根目录>     需要 ImageMagick
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const RD1 = '7d50197aadcf8824ffccb80119ff19ba6447ef431f09db8d'
export const RD2 = '09dc2e61c4b6a8f30d7e1b5a9c2f4e6d8a0b3c5e7f1d2a4b'
// 合成的 sha1：把名字重复补到 40 位十六进制
export const sha = (name) => [...Buffer.from(name)].map((b) => b.toString(16).padStart(2, '0')).join('').padEnd(40, 'a').slice(0, 40)
export const hashed = (stem, ext) => `${stem}-${sha(stem)}.${ext}`

export const head = (extra = []) => [
  '*start',
  '[position height=160 top=600]',
  '[ptext name="chara_name_area" layer=message0 width="200" color=white x=10 y=560 size=26] ',
  '[chara_config ptext="chara_name_area"]',
  '[call target=*start storage="tyrano.ks"]',
  `[chara_new name="hana" storage="${hashed('hana_00', 'png')}" jname="花"]`,
  `[chara_face name="hana" face="no" storage="${hashed('hana_00', 'png')}"]`,
  '[chara_face name="hana" face="ki" storage="hana_01.png"]',   // 不带 hash，磁盘上是 hana_01-<sha1>.png
  '[chara_face name="hana" face="do" storage="hana_03.png"]',   // 不带 hash，磁盘上没有 → 退回基础立绘
  `[chara_face name="hana" face="ai" storage="${hashed('hana_02', 'png')}"]`,   // 带 hash，磁盘上没有 → 退回基础立绘
  `[chara_new name="rina" storage="${hashed('rina_00', 'png')}" jname="凛"]`,
  `[chara_face name="rina" face="no" storage="${hashed('rina_00', 'png')}"]`,
  ...extra,
]

const script1 = [
  ...head(),
  `[bg storage="${hashed('black', 'png')}"  time=1000 wait=true]`,
  `[playbgm storage="${hashed('bgm_talk_001', 'mp3')}" loop=true]`,
  `[bg storage="${hashed('story-bg_beach_00', 'jpg')}"  time=500 wait=true]`,
  '#hana',
  '[chara_show name="hana" top=-0 time=0]',
  '[chara_mod name="hana" face="ki" time=0]',
  '[playse storage="voice_a_01.mp3" loop=false clear=true ]',
  '第一句台词。[r]换行的第二行。[l][r]',
  '后面接着的一行。[l][cm]',
  '[stopse]',
  '#rina',
  '[chara_show name="rina" top=-0 time=0]',
  '[chara_mod name="rina" face="no" time=0]',
  '[playse storage="voice_a_99.mp3" loop=false clear=true ]',   // 磁盘上没有：静默跳过
  '两个角色同时在场。[l][cm]',
  '[chara_mod name="hana" face="do" time=0]',   // 缺 → 退回基础立绘
  '[chara_mod name="hana" face="ai" time=0]',   // 缺（带 hash）→ 退回基础立绘
  '[anim layer=3 left="+=640" time=0]',
  '[layopt layer=3 visible=true]',
  '[anim layer=3 left="-=640" time=600 ]',
  '[wa]',
  '[freeimage layer=3]',
  '表情缺失也照常显示。[l][cm]',
  '[anim name="hana" left="+=20" time=100][anim name="hana" left="-=20" time=100][wa]',
  '[quake count=5 time=300 hmax=5]',
  '[playse storage="bgm_se_heartbeat.mp3" loop=true clear=true ]',
  '[wait time=800]',
  '抖动和地震之后。[l][cm]',
  '[stopse]',
  `[image storage="${hashed('sepia_filter', 'png')}" layer=4 time=300 wait=true]`,
  '[layopt layer=4 visible=true]',
  '回想（棕褐色滤镜）。[l][cm]',
  '[freeimage layer=4 time=500]',
  '[chara_hide name="hana" top=-0 time=0]',
  '[foo_bar x=1 y="a]b"]',   // 没见过的标签：raw，不炸
  '[iscript]',
  'f.foo = 1; // 里面的 JS 不是剧情 [l]',
  '[endscript]',
  '[stopse',   // 没有 ] 的标签
  '[stopbgm[[playbgm storage="' + hashed('bgm_talk_001', 'mp3') + '" loop=true]',
  '#',
  '旁白一行。[l][cm]',
  `[bg storage="${hashed('missing_bg', 'jpg')}" time=100 wait=true]`,   // 缺背景：记 unresolved
  '最后一句。[l][cm]',
  '[stopbgm]',
  '',
].join('\n')

const script2 = [
  ...head(),
  `[bg storage="${hashed('story-bg_beach_00', 'jpg')}"  time=500 wait=true]`,
  '#hana',
  '[chara_show name="hana" top=-0 time=0]',
  '[playse storage="voice_a_01.mp3" loop=false clear=true ]',   // 和第一个剧情同名：要取 RD2 里的
  '第二个剧情。[l][cm]',
  '',
].join('\n')

export async function buildKamihimeFixture(root) {
  const dmm = path.join(root, 'game', 'dmm')
  const put = async (rel, content) => { await mkdir(path.dirname(path.join(dmm, rel)), { recursive: true }); await writeFile(path.join(dmm, rel), content) }
  const img = async (rel, size, color) => { await mkdir(path.dirname(path.join(dmm, rel)), { recursive: true }); execFileSync('convert', ['-size', size, `xc:${color}`, path.join(dmm, rel)]) }
  // 平铺层（带 hash）
  await img(`assets/${hashed('story-bg_beach_00', 'jpg')}`, '64x36', 'seagreen')
  await img(`assets/${hashed('black', 'png')}`, '8x8', 'black')
  await img(`assets/${hashed('sepia_filter', 'png')}`, '64x36', 'sienna')
  await img(`assets/${hashed('hana_00', 'png')}`, '40x120', 'crimson')
  await img(`assets/${hashed('hana_01', 'png')}`, '40x120', 'orange')   // 脚本里写 hana_01.png（不带 hash）
  await img(`assets/${hashed('rina_00', 'png')}`, '40x120', 'royalblue')
  await put(`assets/${hashed('bgm_talk_001', 'mp3')}`, 'mp3')
  await put('assets/bgm_se_heartbeat.mp3', 'mp3')   // 不带 hash、在平铺层
  // resource_directory：两个剧情各一个，里面有同名的 voice_a_01.mp3
  await put(`assets/${RD1}/voice_a_01.mp3`, 'rd1')
  await put(`assets/${RD2}/voice_a_01.mp3`, 'rd2')
  // 剧情：类别 / 目录 / <id>_script.ks + <id>.json
  const scenes = [
    ['eidolon/MB01_花/9101_harem-summon', script1, RD1, '花的初次相遇', false],
    ['eidolon/MB01_花/9102_harem-summon', script2, RD2, '花的第二次', true],
  ]
  for (const [rel, text, rd, title, r18] of scenes) {
    await put(`raw_scenario/${rel}_script.ks`, text)
    await put(`raw_scenario/${rel}.json`, JSON.stringify({ is_r18: r18, resource_directory: rd, scenario_path: `09d/b8d/${rd}/scenario`, summary: '合成的摘要', title }))
  }
  await put('raw_scenario/soul/XX_无json/0001_x_script.ks', head().join('\n') + '\n#hana\n没有 json 的剧情。[l]\n')   // 没有同目录 json：标题用脚本名
}

// 追加的两个剧情（不进 buildKamihimeFixture：基础 fixture 的剧情数 / 步数被别的测试钉住）：
//   MEMORIAL：Memorial 剧情（真实写法：[memorial name= auto_next= random_voice=] 段落标记、每段 4 张 [mem_img]、[mem_voice storage= text="…\\n…{{主人公}}…"]）
//   LAYER3：layer 3 上的角色（[chara_show layer=3] → anim 跳到屏外 → layopt true → anim 0.6 秒滑入 → … → [freeimage layer=3] + [layopt layer=3 visible=false]）；另一个角色在 layer 0 不受影响
export const RD3 = '5b3c9f0a1d2e4f6a8b0c2d4e6f8a1b3c5d7e9f0a2b4c6d8e'
export const MEMORIAL_REL = 'soul/[Memorial0012]メモ/1022_harem-memorial_script.ks'
export const LAYER3_REL = 'eidolon/MB01_花/9103_harem-layer3_script.ks'
export const memIntro = (i) => hashed(`intro_mypage-memorial_item_0014_${i}`, 'png')
export const memMain = (i) => hashed(`mypage-memorial_item_0014_${i}`, 'png')
export const MEMORIAL = [
  ...head(),
  `[playbgm storage="${hashed('bgm_talk_001', 'mp3')}" loop=true]`,
  `[bg storage="${hashed('story-bg_beach_00', 'jpg')}"  time=1000 wait=true]`,
  '#hana',
  '[chara_show name="hana" top=-0 time=0]',
  '[playse storage="intro_mem_v1.mp3" loop=false clear=true ]',
  '前置きの台詞。[l][cm]',
  '[chara_hide name="hana" top=-0 time=0]',
  '[memorial name="intro" auto_next=true]',
  ...[0, 1, 2, 3].map((i) => `[mem_img for="intro" storage="${memIntro(i)}" play_count=1]`),
  '[mem_voice for="intro" storage="intro_mem_v1.mp3" text="一行目。\\n二行目、{{主人公}}さん。"]',
  '[memorial name="main" random_voice=false auto_next=false]',
  ...[0, 1, 2, 3].map((i) => `[mem_img for="main" storage="${memMain(i)}" play_count=1]`),
  '[mem_voice for="main" storage="gone_voice.mp3" text="音声ファイルなし。"]',
  '[mem_voice for="main" storage="intro_mem_v1.mp3"]',
  `[mem_img for="main" storage="${hashed('mem_gone', 'png')}" play_count=1]`,
  '#hana',
  '後ろの台詞。[l][cm]',
  '',
].join('\n')
export const LAYER3 = [
  ...head(),
  `[bg storage="${hashed('story-bg_beach_00', 'jpg')}"  time=500 wait=true]`,
  '#hana',
  '[chara_show name="hana" top=-0 time=0]',
  '[chara_mod name="hana" face="no" time=0]',
  '一人目だけ。[l][cm]',
  '#rina',
  '[chara_show name="rina" layer=3 top=-0 time=0]',
  '[chara_mod name="rina" face="no" time=0]',
  '[anim layer=3 left="+=640" time=0]',
  '[layopt layer=3 visible=true]',
  '[anim layer=3 left="-=640" time=600 ]',
  '[wa]',
  '二人そろった。[l][cm]',
  '[freeimage layer=3]',
  '[layopt layer=3 visible=false]',
  '凛だけ消えた。[l][cm]',
  '[chara_show name="rina" layer=3 top=-0 time=0]',
  '凛が戻った。[l][cm]',
  '[chara_hide name="hana" top=-0 time=0]',
  '[freeimage layer=3]',
  '誰もいない。[l][cm]',
  '',
].join('\n')

export async function buildKamihimeExtraFixture(root) {
  const dmm = path.join(root, 'game', 'dmm')
  const put = async (rel, content) => { await mkdir(path.dirname(path.join(dmm, rel)), { recursive: true }); await writeFile(path.join(dmm, rel), content) }
  const img = async (rel, size, color) => { await mkdir(path.dirname(path.join(dmm, rel)), { recursive: true }); execFileSync('convert', ['-size', size, `xc:${color}`, path.join(dmm, rel)]) }
  for (let i = 0; i < 4; i++) { await img(`assets/${memIntro(i)}`, '64x36', 'plum'); await img(`assets/${memMain(i)}`, '64x36', 'khaki') }
  await put(`assets/${RD3}/intro_mem_v1.mp3`, 'rd3')
  await put(`raw_scenario/${MEMORIAL_REL.replace(/_script\.ks$/, '')}_script.ks`, MEMORIAL)
  await put(`raw_scenario/${MEMORIAL_REL.replace(/_script\.ks$/, '.json')}`, JSON.stringify({ is_r18: false, resource_directory: RD3, scenario_path: `aa/bb/${RD3}/scenario`, summary: '合成', title: 'Memorial 合成' }))
  await put(`raw_scenario/${LAYER3_REL}`, LAYER3)
  await put(`raw_scenario/${LAYER3_REL.replace(/_script\.ks$/, '.json')}`, JSON.stringify({ is_r18: false, resource_directory: RD1, scenario_path: `aa/bb/${RD1}/scenario`, summary: '合成', title: 'layer3 合成' }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node scripts/dev/make-kamihime-fixture.mjs <输出根目录>'); process.exit(2) }
  await buildKamihimeFixture(path.join(out, 'kamihime演示'))
  console.log(`done: ${out}/kamihime演示`)
}
