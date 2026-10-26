// 造 Spine 3.8 测试数据 + tenkeiprdx 素材目录（合成的，不含任何原作内容）。
//   spineBinary / spineJson：最小骨架（一根骨骼、一个插槽、一张 200×400 的区域附件，每个动画一条骨骼旋转时间线）
//   spineBinary36：Spine 3.6 的二进制（见函数上的注释）
//   writeSpine(dir, base, { format: 'binary' | 'json' | 'binary36', color, animations }) 写 <base>.skel.bytes / .atlas.txt / .png
//   buildTenkeiFixture(root, { wrapper }) 造出 StreamingAssets/…/Imported 的样子
// 二进制是照官方 3.8 SkeletonBinary 的读取顺序手写的：selftest 里用官方运行时再读一遍，确认结构对。
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

class Writer {
  constructor() { this.bytes = [] }
  byte(value) { this.bytes.push(value & 0xff) }
  bool(value) { this.byte(value ? 1 : 0) }
  int32(value) { const b = Buffer.alloc(4); b.writeInt32BE(value | 0); this.bytes.push(...b) }
  float(value) { const b = Buffer.alloc(4); b.writeFloatBE(value); this.bytes.push(...b) }
  varint(value) { let v = value >>> 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; this.byte(b) } while (v) }
  string(text) { if (text === null) return this.varint(0); const data = Buffer.from(text, 'utf8'); this.varint(data.length + 1); this.bytes.push(...data) }
  done() { return Buffer.from(this.bytes) }
}

export const REGION = { name: 'body', width: 200, height: 400, y: 200 }
export const DEFAULT_ANIMATIONS = ['idle_normal', 'idle_joy', 'idle_sad']

export function spineBinary({ animations = DEFAULT_ANIMATIONS, hash = 'testhash' } = {}) {
  const w = new Writer()
  w.string(hash)
  w.string('3.8.99')
  w.float(-100); w.float(0); w.float(200); w.float(400)
  w.bool(false)                       // nonessential
  w.varint(1); w.string(REGION.name)  // 字符串表：1 = body
  w.varint(1)                         // 骨骼
  w.string('root')
  for (const v of [0, 0, 0, 1, 1, 0, 0, 0]) w.float(v)   // rotation x y scaleX scaleY shearX shearY length
  w.varint(0); w.bool(false)          // transformMode, skinRequired
  w.varint(1)                         // 插槽
  w.string('body'); w.varint(0); w.int32(-1); w.int32(-1); w.varint(1); w.varint(0)
  w.varint(0); w.varint(0); w.varint(0)   // ik / transform / path
  w.varint(1)                         // 默认皮肤：1 个插槽
  w.varint(0); w.varint(1)            // 插槽 0，1 个附件
  w.varint(1)                         // 附件名（字符串表 1）
  w.varint(1); w.byte(0)              // name ref, type = region
  w.varint(1)                         // path ref
  for (const v of [0, 0, REGION.y, 1, 1, REGION.width, REGION.height]) w.float(v)   // rotation x y scaleX scaleY width height
  w.int32(-1)                         // color
  w.varint(0)                         // 其它皮肤
  w.varint(0)                         // 事件
  w.varint(animations.length)
  for (const name of animations) {
    w.string(name)
    w.varint(0)                       // 插槽时间线
    w.varint(1); w.varint(0); w.varint(1)   // 骨骼时间线：1 根骨骼（0），1 条
    w.byte(0); w.varint(2)            // BONE_ROTATE，2 帧
    w.float(0); w.float(0); w.byte(0) // 帧 0 + 线性曲线
    w.float(1); w.float(2)            // 帧 1
    w.varint(0); w.varint(0); w.varint(0); w.varint(0); w.varint(0); w.varint(0)   // ik transform path deform drawOrder events
  }
  return w.done()
}

// Spine 3.6 二进制（GrenzeViewer 那种）：照 3.6 分支 libgdx 版 SkeletonBinary 的读取顺序手写。和 3.8 的区别：字符串是行内的（没有字符串表）、
// 骨骼没有 skinRequired、插槽颜色后面跟暗色 int（-1 = 没有）、附件类型是 byte 不是 varint、曲线是 byte(0 线性 / 1 阶梯 / 2 贝塞尔 + 4 个浮点)。
// 头：hash 字符串（~28 字符，Grenze 的真实文件就是这样）+ 版本字符串。
// animations：名字 → { angle（骨骼固定转角，单帧，设置后立刻生效）} 或 名字（转角 0）；每个动画还带一条带曲线的颜色时间线（线性 + 贝塞尔 + 阶梯各一帧），把曲线分支也走一遍
export function spineBinary36({ animations = DEFAULT_ANIMATIONS, hash = 'FrNJhva2RVZ1bbIjdNspNttett4=', version = '3.6.38', nonessential = false } = {}) {
  const w = new Writer()
  w.string(hash)
  w.string(version)
  w.float(200); w.float(400)          // width height（3.6 没有 x / y）
  w.bool(nonessential)
  if (nonessential) { w.float(30); w.string('./images/') }
  w.varint(1)                          // 骨骼
  w.string('root')
  for (const v of [0, 0, 0, 1, 1, 0, 0, 0]) w.float(v)   // rotation x y scaleX scaleY shearX shearY length
  w.varint(0)                          // transformMode
  if (nonessential) w.int32(-1)
  w.varint(1)                          // 插槽
  w.string('body'); w.varint(0); w.int32(-1); w.int32(-1); w.string('body'); w.varint(0)   // 名字、骨骼、颜色、暗色(-1)、附件名、混合模式
  w.varint(0); w.varint(0); w.varint(0)   // ik / transform / path
  w.varint(1)                          // 默认皮肤：1 个插槽
  w.varint(0); w.varint(1)             // 插槽 0，1 个附件
  w.string('body')                     // 附件名
  w.string(null); w.byte(0)            // 附件自己的名字（null = 同名）、类型 region
  w.string(null)                       // path（null = 附件名）
  for (const v of [0, 0, REGION.y, 1, 1, REGION.width, REGION.height]) w.float(v)   // rotation x y scaleX scaleY width height
  w.int32(-1)                          // color
  w.varint(0)                          // 其它皮肤
  w.varint(0)                          // 事件
  w.varint(animations.length)
  for (const entry of animations) {
    const { name, angle = 0 } = typeof entry === 'string' ? { name: entry } : entry
    w.string(name)
    w.varint(1); w.varint(0); w.varint(1)   // 插槽时间线：1 个插槽（0），1 条
    w.byte(1); w.varint(3)               // SLOT_COLOR，3 帧
    w.float(0); w.int32(-1); w.byte(2); for (const v of [0.25, 0, 0.75, 1]) w.float(v)   // 帧 0 + 贝塞尔
    w.float(0.5); w.int32(-1); w.byte(1) // 帧 1 + 阶梯
    w.float(1); w.int32(-1)              // 帧 2（最后一帧没有曲线）
    w.varint(1); w.varint(0); w.varint(1)   // 骨骼时间线：1 根骨骼（0），1 条
    w.byte(0); w.varint(1)               // BONE_ROTATE，1 帧
    w.float(0); w.float(angle)
    w.varint(0); w.varint(0); w.varint(0); w.varint(0); w.varint(0); w.varint(0)   // ik transform path deform drawOrder events
  }
  return w.done()
}

export function spineJson({ animations = DEFAULT_ANIMATIONS, region = REGION, version = '3.8.99' } = {}) {
  return Buffer.from(JSON.stringify({
    skeleton: { hash: 'testjson', spine: version, x: -100, y: 0, width: 200, height: 400 },
    bones: [{ name: 'root' }],
    slots: [{ name: 'body', bone: 'root', attachment: 'body' }],
    // 3.6 的 JSON：皮肤是对象 { 皮肤名: { 插槽: { 附件: … } } }；3.8 以后是数组 [{ name, attachments }]
    skins: /^3\.6\./.test(version) ? { default: { body: { body: { x: 0, y: region.y, width: region.width, height: region.height } } } } : [{ name: 'default', attachments: { body: { body: { x: 0, y: region.y, width: region.width, height: region.height } } } }],
    animations: Object.fromEntries(animations.map((name) => [name, { bones: { root: { rotate: [{ time: 0, angle: 0, value: 0 }, { time: 1, angle: 2, value: 2 }] } } }])),
  }))
}

export const atlasText = (base) => `${base}.png\nsize: 64,128\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n${REGION.name}\n  rotate: false\n  xy: 0, 0\n  size: 64, 128\n  orig: 64, 128\n  offset: 0, 0\n  index: -1\n`

// region：只对 JSON 骨架有效，换一个比 200×400 小（或大）的附件，用来造「各层包围盒不一样」的静态画面
// version：只对 JSON 骨架有效（写进 skeleton.spine），用来造 3.8 / 4.0 / 4.2 / 不支持版本的骨架
export async function writeSpine(dir, base, { format = 'binary', color = 'red', animations = DEFAULT_ANIMATIONS, region = REGION, version = '3.8.99' } = {}) {
  await mkdir(dir, { recursive: true })
  // format: 'binary'（3.8）| 'json' | 'binary36'（3.6 二进制，version 默认 3.6.38）
  await writeFile(path.join(dir, `${base}.skel.bytes`), format === 'json' ? spineJson({ animations, region, version }) : format === 'binary36' ? spineBinary36({ animations, ...(version === '3.8.99' ? {} : { version }) }) : spineBinary({ animations }))
  await writeFile(path.join(dir, `${base}.atlas.txt`), atlasText(base))
  // 64×128（和 200×400 的区域同比例）：底色 + 头（白圆）+ 眼睛两点，方便肉眼看方向有没有反
  execFileSync('convert', ['-size', '64x128', `xc:${color}`, '-fill', 'white', '-draw', 'circle 32,26 32,10', '-fill', 'black', '-draw', 'circle 26,22 26,19', '-draw', 'circle 38,22 38,19', path.join(dir, `${base}.png`)])
}

const png = (file, color, size = '64x36') => execFileSync('convert', ['-size', size, `xc:${color}`, file])
// 没有 ffmpeg 时退而求其次：写一段 0.3 秒的静音 WAV（浏览器按内容嗅探，改名 .ogg 也能放；服务端只看扩展名给 audio/ogg）
function silentWav() {
  const samples = 2205
  const b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(7350, 24); b.writeUInt32LE(14700, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(samples * 2, 40)
  return b
}
async function ogg(file) {
  try { execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', '0.3', '-c:a', 'libvorbis', file]) } catch { await writeFile(file, silentWav()) }
}

const frame = (over = {}) => ({ sceneOrder: 1, sceneFrameOrder: 1, speakerName: '', phraseContents: '', phraseVoice: '', backgroundMusic: '', soundEffect: '', backgroundImage: '', frameEffect: '', still: '', stillAnimation: '', animationSpeed: null, sceneCameraStartPositionX: null, sceneCameraStartPositionY: null, sceneCameraStartPositionZ: null, sceneCameraEndPositionX: null, sceneCameraEndPositionY: null, sceneCameraEndPositionZ: null, sceneCameraActionDuration: null, adventureCharacters: null, ...over })
const chara = (id, position, face, action = 0, appearance = 1) => ({ characterMasterId: id, characterAppearance: appearance, characterPosition: position, characterAction: action, characterEmotionIcon: -1, characterFacialExpression: face })
const sceneFile = (assetId, frames) => JSON.stringify({ result: { sceneDetails: [{ assetId: String(assetId), sceneFrameDetails: frames.map((f, i) => ({ ...f, sceneFrameOrder: i + 1 })) }] } })

// root：放 scenes/ 的那一层（Imported）。wrapper = true 时外面再套 StreamingAssets/Tenkeiprdx X/（模拟用户传的是外层目录），返回 { media, imported }
export async function buildTenkeiFixture(media, { wrapper = true } = {}) {
  const imported = wrapper ? path.join(media, 'StreamingAssets', 'Tenkeiprdx X', 'Imported') : media
  const at = (...parts) => path.join(imported, ...parts)
  for (const dir of ['CharacterIcons', 'scenes', 'Backgrounds/adventure', 'Backgrounds/still', 'BGM', 'Se', 'BgSe', 'AdventureVoice/10010101', 'EpisodeThumbnails/event', 'EpisodeThumbnails/extra', 'Masterdata']) await mkdir(at(dir), { recursive: true })
  png(at('Backgrounds/adventure/bg_adventure_001.png'), 'navy', '160x90')
  png(at('Backgrounds/adventure/bg_adventure_002.png'), 'teal', '160x90')
  png(at('Backgrounds/still/bg_still_03.png'), 'maroon', '160x90')
  png(at('EpisodeThumbnails/event/ep_eventstill_001_0001.png'), 'orange')
  png(at('EpisodeThumbnails/extra/ep_eventstill_301_0001.png'), 'purple')
  png(at('CharacterIcons/10010001.png'), 'crimson', '48x48')
  png(at('CharacterIcons/10020001.png'), 'seagreen', '48x48')
  png(at('Backgrounds/still/10010001_01_still_01.png'), 'sienna', '160x90')
  await ogg(at('BGM/bgm_a_loop.ogg'))
  await ogg(at('Se/se_click.ogg'))
  for (const name of ['Hse2', 'Hse3', 'Hse4', 'Hse5']) await ogg(at(`BgSe/${name}.ogg`))
  await ogg(at('AdventureVoice/10010101/v002.ogg'))
  await writeFile(at('Masterdata/username.txt'), 'Tester\n')
  // 名称表：masterdata_4 = [?, [角色号, ?, ?, 名字, 称号, ?, ?, ?, ?, ?, 分组号, ?]]；masterdata_32 = [?, [?, ?, 标题, ?, ?, ?, ?, ?, ?, [剧情 id], [still 键…], ?]]
  const pad = (n) => Array(n).fill(0)
  await writeFile(at('Masterdata/masterdata_4.json'), JSON.stringify([[0, [10010001, 0, 0, 'Alice', 'Heroine', ...pad(5), 5, 0]], [0, [10020001, 0, 0, 'Bob', 'Rival', ...pad(5), 6, 0]]]))
  await writeFile(at('Masterdata/masterdata_32.json'), JSON.stringify([
    [0, [0, 0, 'The First Event', ...pad(6), ['20010001'], ['001_0001_still_01'], 0]],
    [0, [0, 0, 'An Extra Story', ...pad(6), ['23010002'], ['301_0001_still_01'], 0]],
    [0, [0, 0, 'Alice EX', ...pad(6), ['10010101'], ['10010001_01_still_01'], 0]],
  ]))
  await writeSpine(at('Spines/1001'), '1001_01', { format: 'binary', color: 'crimson', animations: ['idle_normal', 'idle_joy', 'idle_sad'] })
  await writeSpine(at('Spines/1002'), '1002_01', { format: 'json', color: 'seagreen', animations: ['idle_normal', 'idle_angry'] })
  await writeSpine(at('Stills/h_still_01'), '1_base', { format: 'binary', color: 'goldenrod', animations: ['animation1', 'animation2', 'animation3', 'animation4', 'animation5'] })
  await writeSpine(at('Stills/h_still_01'), '2_over', { format: 'json', color: 'deepskyblue', animations: ['animation1', 'animation2', 'animation3', 'animation4', 'animation5'] })

  await writeFile(at('scenes/10010101.json'), sceneFile(10010101, [
    frame({ backgroundImage: 'bg_adventure_001', backgroundMusic: 'bgm_a', speakerName: 'Alice', phraseContents: 'Hello there', adventureCharacters: [chara(1001, 1, 1, 1)] }),
    frame({ speakerName: '%username%', phraseContents: 'Line one\\nline two', phraseVoice: 'v002', adventureCharacters: [chara(1001, 1, 2), chara(1002, 2, 0, 2)] }),
    frame({ speakerName: 'Alice', phraseContents: 'Gone', soundEffect: 'se_click', adventureCharacters: [] }),
    frame({ backgroundImage: 'bg_adventure_002', phraseContents: 'Narration only' }),
  ]))
  await writeFile(at('scenes/20010001.json'), sceneFile(20010001, [
    frame({ still: 'h_still_01', stillAnimation: 'animation1', animationSpeed: 1000, sceneCameraStartPositionX: 0, sceneCameraStartPositionY: 0, sceneCameraStartPositionZ: 0, sceneCameraEndPositionX: 100, sceneCameraEndPositionY: 50, sceneCameraEndPositionZ: 200, sceneCameraActionDuration: 2000, speakerName: 'Alice', phraseContents: 'Still one' }),
    frame({ still: 'h_still_01', stillAnimation: 'animation2', phraseContents: 'Still two' }),
    frame({ stillAnimation: 'animation4', phraseContents: 'Still three' }),
    frame({ backgroundImage: 'bg_adventure_001', phraseContents: 'Back to a background' }),
  ]))
  await writeFile(at('scenes/23010002.json'), sceneFile(23010002, [
    frame({ backgroundImage: 'bg_still_03', speakerName: 'Bob', phraseContents: 'Extra scene', frameEffect: 'shake' }),
  ]))
  return { media, imported }
}
