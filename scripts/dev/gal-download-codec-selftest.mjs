import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { decodeASTC } from '../tag-scripts/gal-download/vendor/astc.mjs'
import { decodeETC2RGBA8 } from '../tag-scripts/gal-download/vendor/etc2.mjs'
import { unpackFsb5 } from '../tag-scripts/gal-download/fsb5.mjs'
import { nativeTask } from '../tag-scripts/gal-download/worker-runner.mjs'
import { parse } from '../../web/library/gal/adapters/utage-book.mjs'

test('compressed textures preserve RGBA channels and crop edge blocks', () => {
  const astc = Buffer.alloc(16); astc[0] = 0xfc; astc[1] = 1
  astc[9] = 11; astc[11] = 22; astc[13] = 33; astc[15] = 44
  const pixels = decodeASTC(astc, 5, 3, 6, 6)
  assert.equal(pixels.length, 5 * 3 * 4)
  for (let p = 0; p < pixels.length; p += 4) assert.deepEqual([...pixels.subarray(p, p + 4)], [11, 22, 33, 44])
  const etc = Buffer.alloc(16); etc[0] = 123
  const rgba = decodeETC2RGBA8(etc, 3, 2)
  assert.equal(rgba.length, 3 * 2 * 4)
  for (let p = 0; p < rgba.length; p += 4) assert.deepEqual([...rgba.subarray(p, p + 4)], [2, 2, 2, 123])
  assert.throws(() => decodeETC2RGBA8(etc.subarray(0, 15), 4, 4), /截断/)
})

function fsb(mode, payload, crc) {
  const chunks = crc === undefined ? 0 : 8, head = Buffer.alloc(68 + chunks)
  head.write('FSB5'); head.writeUInt32LE(1, 4); head.writeUInt32LE(1, 8)
  head.writeUInt32LE(8 + chunks, 12); head.writeUInt32LE(payload.length, 20); head.writeUInt32LE(mode, 24)
  head.writeBigUInt64LE(4n << 34n | 8n << 1n | BigInt(chunks ? 1 : 0), 60)
  if (chunks) { head.writeUInt32LE(11 << 25 | 4 << 1, 68); head.writeUInt32LE(crc, 72) }
  return Buffer.concat([head, payload])
}

test('FSB5 PCM is unpacked with sample count, sample rate and bit depth; malformed input fails', () => {
  const pcm = Buffer.from([0, 0, 255, 127, 0, 128, 42, 0])
  const wav = unpackFsb5(fsb(2, pcm))
  assert.equal(wav.format, 'wav'); assert.equal(wav.samples, 4); assert.equal(wav.frequency, 44100)
  assert.equal(wav.bytes.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.bytes.readUInt16LE(34), 16)
  assert.deepEqual(wav.bytes.subarray(44), pcm)
  const pcm8 = unpackFsb5(fsb(1, Buffer.from([0, 127, 128, 255])))
  assert.deepEqual([...pcm8.bytes.subarray(44)], [128, 255, 0, 127])
  assert.throws(() => unpackFsb5(fsb(2, pcm).subarray(0, 70)), /范围|截断/)
  assert.throws(() => unpackFsb5(fsb(15, Buffer.from([0, 0]), 0xffffffff)), /缺少静态头部 CRC=4294967295/)
  assert.throws(() => unpackFsb5(fsb(99, pcm)), /尚未支持 FSB5 编码 99/)
})

test('real cached samples: ImportChara book, ASTC/ETC2 PNG and FSB5 Ogg export through the worker', { skip: !process.env.GAL_TSK_AUDIT_DIR }, async () => {
  const root = process.env.GAL_TSK_AUDIT_DIR
  const plans = await readdir(path.join(root, 'cache/plans'))
  const plan = JSON.parse(await readFile(path.join(root, 'cache/plans', plans[0], 'plan.json')))
  const targets = [
    'Adventure/CharaScenario/CharaScenario1158001.book.json',
    'Characters/ch_3396004/ch_3396004_m1.png',
    'Stills/st_1158001/st_1158001.png',
    'Sound/Voice/3374001/vo_m3374001_9999.ogg',
    'Sound/Bgm/BGM_B907_loop.ogg'
  ]
  const cached = (url) => path.join(root, 'cache/bundles', createHash('sha256').update(url).digest('hex'))
  for (const target of targets) {
    const entry = plan.entries.find(e => e.assets.some(a => a.target === target))
    assert.ok(entry, `missing fixture ${target}`)
    const out = await nativeTask('extract', { bundle: cached(entry.url), dependencies: entry.dependencies.map(cached), assets: entry.assets.filter(a => a.target === target) })
    const bytes = Buffer.from(out.exports[0].data)
    if (target.endsWith('.png')) assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    else if (target.endsWith('.ogg')) assert.equal(bytes.toString('ascii', 0, 4), 'OggS')
    else assert.ok(parse(bytes.toString()).steps.length > 0)
  }
})
