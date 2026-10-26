#!/usr/bin/env node
// 造 ぼくらの放課後戦争（bokusen，编译脚本 JSON）的 Gal 演示 / 测试数据（合成的，台词和名字都是自己编的，没有原作内容；不需要 ImageMagick）：
//   <根>/json/<脚本名>.json                          {data:{code:{images,sounds,articles,characters,tags,parameters,commands}}}
//   <根>/resource/<脚本名>/images/<序号>.<扩展名>     sounds/<序号>.wav（列表里写 .m4a，磁盘上是 .wav）
//   脚本：1001（有资源目录，带 BOM；开场交叉淡入背景 / 立绘层 + move / 多帧动画 / 循环声 / 【说话人】+「台词」）、
//        1002（没有资源目录：资源缺失也不能炸）、1003（被截断的 JSON：解析失败也不能炸）
//   node scripts/dev/make-bokusen-fixture.mjs <输出根目录>
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

// 一张纯色 PNG（不用外部工具）
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}
export function solidPng(width, height, [r, g, b]) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
// 0.1 秒静音 WAV
export function silentWav() {
  const samples = 800
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + samples * 2, 4); head.write('WAVEfmt ', 8); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22)
  head.writeUInt32LE(8000, 24); head.writeUInt32LE(16000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(samples * 2, 40)
  return Buffer.concat([head, Buffer.alloc(samples * 2)])
}

// 按「标签名 + 槽位对象」写命令：标签表按出现顺序现建（每个文件自己的顺序，适配器不能假定固定下标），参数组按槽位排成数组，没设的写 'nil'
export function compileBokusen({ images = [], sounds = [], articles = [], script }) {
  const tags = []
  const parameters = []
  const commands = []
  script.forEach(([tag, slots = {}], order) => {
    let tagIdx = tags.indexOf(tag)
    if (tagIdx < 0) { tagIdx = tags.length; tags.push(tag) }
    const width = Math.max(-1, ...Object.keys(slots).map(Number)) + 1
    const group = Array.from({ length: width }, (_, i) => (slots[i] === undefined ? 'nil' : String(slots[i])))
    commands.push([tagIdx, parameters.push(group) - 1, order])
  })
  return { data: { code: { images, sounds, articles, characters: [], tags, parameters, commands } } }
}

const IMAGES = ['bg0000.jpg', 'bg0001.jpg', 'sprite0002.png', 'sprite0003.png', 'frame0004.png', 'frame0005.png', 'frame0006.png']
const SOUNDS = ['https://x.invalid/sound/script/bgm/m4a/b0.m4a', 'https://x.invalid/sound/script/voice/0001/m4a/v1.m4a', 'se2.m4a', 'loop3.m4a']
const ARTICLES = ['ナレーション。', '【小春】', '「こんにちは」', '「続きです」', '地の文', '【李】', '「やあ」', '最後の一行']

// 脚本 1001：覆盖适配器的每条路径（见 fe-gal-bokusen-selftest.mjs）
export const SCRIPT_1001 = [
  ['bgmopt', { 1: 20 }], ['playbgm', { 0: 'true', 1: 0 }],
  ['image', { 15: 'base', 16: 0, 23: 'fore', 28: 0, 29: 0 }],            // 开场：前台 0 号背景
  ['image', { 15: 'base', 16: 0, 23: 'back', 28: 1, 29: 0 }],            // 后台 1 号背景
  ['trans', { 2: 'base', 3: 'cross', 6: 1000 }], ['wt'],                 // 交叉淡入 1 秒
  ['articles', { 0: 0 }], ['r'], ['p'], ['cm'],
  ['image', { 15: 0, 16: 240, 22: 0, 23: 'fore', 28: 2, 29: -10 }],      // 数字层 0 = 立绘（右偏 240）
  ['move', { 2: 0, 4: '(0 -10 255)', 6: 300 }], ['wm'],                  // 移到正中
  ['articles', { 0: 1 }], ['r'], ['articles', { 0: 2 }], ['r'], ['p'], ['cm'],
  ['playse', { 0: 3, 1: 'false', 2: 1 }],                                // 语音（路径带 /voice/）→ voice
  ['playse', { 0: 4, 1: 'false', 2: 2 }],                                // 普通 se
  ['animstart', { 0: 1, 1: 15, 2: 'base', 3: 0, 4: 1, 5: 'true', 6: 0, 7: 255, 8: 'fore', 9: '4 5 6 ', 10: 0, 11: 30 }],   // 3 帧，第 6 号图磁盘上没有
  ['articles', { 0: 3 }], ['r'], ['p'], ['cm'],
  ['playse', { 0: 5, 1: 'true', 2: 3 }], ['wait', { 2: 500 }], ['stopse', { 0: 5 }],   // 循环声 → bgse / bgseStop
  ['animstart', { 0: 2, 1: 15, 2: 3, 3: 145, 4: 4, 5: 'true', 6: 0, 7: 255, 8: 'fore', 9: '3 ', 10: 20, 11: 38 }],   // 单帧：数字层 3 显示 3 号图
  ['animstop', { 0: 2 }],
  ['image', { 15: 0, 16: 0, 23: 'back', 28: 3, 29: -10 }], ['trans', { 2: 0, 3: 'cross', 6: 200 }],   // 立绘层 0 换图
  ['move', { 2: 0, 4: '(0 0 0)', 6: 100 }],                              // 不透明度 0 = 去掉
  ['articles', { 0: 4 }], ['r'], ['articles', { 0: 5 }], ['r'], ['articles', { 0: 6 }], ['r'], ['p'], ['cm'],   // 一页里中途换说话人
  ['image', { 15: 'base', 16: 0, 23: 'fore', 28: 99, 29: 0 }],           // 下标越界：记 raw，不炸
  ['mystery', { 0: 1 }],                                                 // 没见过的标签：计入 raw，不炸
  ['fadeoutbgm', { 0: 1000 }], ['articles', { 0: 7 }], ['wb'],
]
export const SCRIPT_1002 = [['image', { 15: 'base', 16: 0, 23: 'fore', 28: 0, 29: 0 }], ['playse', { 0: 1, 1: 'false', 2: 0 }], ['articles', { 0: 5 }], ['articles', { 0: 6 }], ['p']]

export async function buildBokusenFixture(root) {
  const put = async (rel, data) => { const abs = path.join(root, ...rel.split('/')); await mkdir(path.dirname(abs), { recursive: true }); await writeFile(abs, data) }
  const first = { images: IMAGES, sounds: SOUNDS, articles: ARTICLES, script: SCRIPT_1001 }
  await put('json/1001 テスト－初H.json', `﻿${JSON.stringify(compileBokusen(first))}`)   // BOM
  await put('json/1002 リソースなし.json', JSON.stringify(compileBokusen({ images: IMAGES, sounds: SOUNDS, articles: ARTICLES, script: SCRIPT_1002 })))
  await put('json/1003 壊れた.json', JSON.stringify(compileBokusen(first)).slice(0, 120))   // 截断：解析失败
  const colors = [[40, 120, 80], [60, 60, 160], [200, 80, 80], [220, 160, 60], [90, 200, 200], [200, 200, 90]]
  for (const [i, name] of IMAGES.slice(0, 6).entries()) await put(`resource/1001 テスト－初H/images/${i}${path.extname(name)}`, solidPng(64, 36, colors[i]))   // 第 6 张（6.png）故意不放
  for (let i = 0; i < SOUNDS.length; i++) await put(`resource/1001 テスト－初H/sounds/${i}.wav`, silentWav())
  await put('base_back.png', solidPng(8, 8, [0, 0, 0]))   // 游戏根里的杂文件
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node scripts/dev/make-bokusen-fixture.mjs <输出根目录>'); process.exit(2) }
  await buildBokusenFixture(path.join(out, 'ぼくらの放課後戦争演示'))
  console.log(`done: ${out}/ぼくらの放課後戦争演示`)
}
