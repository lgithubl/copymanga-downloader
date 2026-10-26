#!/usr/bin/env node
// 合成一份仿ミナシゴノシゴトR（cocos2d 网页版）的资源包（没有原作内容）：
//   <根>/data/adv/textfiles/story/*.txt（uviewer-csv 格式；编号 1<6 位角色><2 位序号>）、data/adv/image/{bg,ef,character/<角色>/{atlas,image}}、data/adv/sound/…
//   图集 stand_a.plist + stand_a.png（160x100 的贴图，画布 200x200）：
//     body.png  60x80 红，画布中心下 20（spriteOffset {0,-20}）；000.png 20x16 绿（脸，画布中心上 40）；001.png 30x10 旋转存放（左半蓝、右半黄；贴图里顺时针转了 90°：上半蓝、下半黄），同样在画布中心上 40
//   node scripts/dev/make-minashigo-r-fixture.mjs <输出根目录>
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, crc32 } from 'node:zlib'

// 最小 PNG 编码：RGBA，不过滤
function png(width, height, paint) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [r, g, b, a] = paint(x, y)
    const at = y * (width * 4 + 1) + 1 + x * 4
    raw[at] = r; raw[at + 1] = g; raw[at + 2] = b; raw[at + 3] = a
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const head = Buffer.alloc(13)
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export const ATLAS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
    <dict>
        <key>frames</key>
        <dict>
            <key>000.png</key>
            <dict>
                <key>aliases</key><array/>
                <key>spriteOffset</key><string>{0,40}</string>
                <key>spriteSize</key><string>{20,16}</string>
                <key>spriteSourceSize</key><string>{200,200}</string>
                <key>textureRect</key><string>{{70,1},{20,16}}</string>
                <key>textureRotated</key><false/>
            </dict>
            <key>001.png</key>
            <dict>
                <key>aliases</key><array/>
                <key>spriteOffset</key><string>{0,40}</string>
                <key>spriteSize</key><string>{30,10}</string>
                <key>spriteSourceSize</key><string>{200,200}</string>
                <key>textureRect</key><string>{{95,1},{30,10}}</string>
                <key>textureRotated</key><true/>
            </dict>
            <key>body.png</key>
            <dict>
                <key>aliases</key><array/>
                <key>spriteOffset</key><string>{0,-20}</string>
                <key>spriteSize</key><string>{60,80}</string>
                <key>spriteSourceSize</key><string>{200,200}</string>
                <key>textureRect</key><string>{{1,1},{60,80}}</string>
                <key>textureRotated</key><false/>
            </dict>
        </dict>
        <key>metadata</key>
        <dict>
            <key>format</key><integer>3</integer>
            <key>pixelFormat</key><string>RGBA8888</string>
            <key>premultiplyAlpha</key><false/>
            <key>realTextureFileName</key><string>stand_a.png</string>
            <key>size</key><string>{160,100}</string>
            <key>textureFileName</key><string>stand_a.png</string>
        </dict>
    </dict>
</plist>
`

export const atlasTexture = () => png(160, 100, (x, y) => {
  const inside = (x0, y0, w, h) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h
  if (inside(1, 1, 60, 80)) return [255, 0, 0, 255]
  if (inside(70, 1, 20, 16)) return [0, 255, 0, 255]
  if (inside(95, 1, 10, 30)) return y < 16 ? [0, 0, 255, 255] : [255, 255, 0, 255]
  return [0, 0, 0, 0]
})

const line = (...f) => f.join(',')
// 一个脚本 = 若干「步」（每步一组指令，末尾 clickwait）
export const script = (steps) => steps.map((cmds) => [...cmds, 'clickwait,,,,,,,,,,,'].join('\n')).join('\n') + '\n'

export async function buildMinashigoRFixture(root, { stories } = {}) {
  const data = path.join(root, 'data')
  const put = async (rel, content) => { await mkdir(path.dirname(path.join(data, rel)), { recursive: true }); await writeFile(path.join(data, rel), content) }
  await put('adv/image/character/600201/atlas/stand_a.plist', ATLAS_PLIST)
  await put('adv/image/character/600201/atlas/stand_a.png', atlasTexture())
  const convert = async (rel, args) => { const file = path.join(data, rel); await mkdir(path.dirname(file), { recursive: true }); execFileSync('convert', [...args, file]) }
  await convert('adv/image/character/200903/image/201.jpg', ['-size', '64x36', 'xc:orange'])
  await convert('adv/image/bg/bg0000702.jpg', ['-size', '64x36', 'xc:steelblue'])
  await convert('adv/image/ef/black.jpg', ['-size', '16x16', 'xc:black'])
  await put('adv/sound/bgm/bgm_065.mp3', 'mp3')
  const say = (who, text) => [line('name', who, ''), line('msg', '1', text, '', '', '', '', '', '', '', '')]
  const defaults = {
    // 角色 200903（分组 200903）：4 步立绘 / CG / 清场 + 1 步缺图集
    '120090301': script([
      ['bg,adv/image/bg/bg0000702.jpg,0', ...say('', '第一步：立绘 dan（身体 + 表情 000）'), line('spriteatlas', 'adv/image/character/600201/atlas/stand_a', 'body:000', 'dan', 0, 0, 1, 0, '', '', '', '')],
      [...say('', '第二步：第二个槽位，旋转帧 001（放大 2 倍，x=200 y=100）'), line('spriteatlas', 'adv/image/character/600201/atlas/stand_a', 'body:001', 'dan2', 200, 100, 2, 0, '', '', '', '')],
      [...say('', '第三步：去掉 dan，CG still1 盖满舞台'), line('spriteoff', 'dan', 0), line('sprite', 'adv/image/character/200903/image/201.jpg', 'still1', 0, 0, 1, 0.5)],
      [...say('', '第四步：全部清掉；抖动 + 闪屏'), line('spriteoff', 'still1', 0), line('spriteoff', 'all', 0.2, '', '', '', '', '', '', '', '', ''), line('shake', 0.1, 3, 10, 10), line('flash', 255, 255, 255, 1, 0.1, 1.0)],
      [...say('', '第五步：图集不存在'), line('spriteatlas', 'adv/image/character/999999/atlas/stand_a', 'body:000', 'gone', 0, 0, 1, 0, '', '', '', '')],
    ]),
    '120090302': script([[...say('', '同一个角色的第二个脚本')]]),
    '100042': script([[...say('', '编号不匹配分组规则的脚本')]]),
  }
  for (const [id, text] of Object.entries(stories || defaults)) await put(`adv/textfiles/story/${id}.txt`, text)
  await put('adv/sound/voice/x.mp3', 'mp3')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2]
  if (!out) { console.error('用法：node make-minashigo-r-fixture.mjs <输出根目录>'); process.exit(2) }
  await buildMinashigoRFixture(path.resolve(out))
  console.log(`已生成 ${path.resolve(out)}`)
}
