import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, readdir } from 'node:fs/promises'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'
import path from 'node:path'
import os from 'node:os'
import { catalogEntries, destination, planTsk } from '../tag-scripts/gal-download/tsk.mjs'
import { decodeTree, serializedObjects } from '../tag-scripts/gal-download/unity.mjs'
import { nativeTask } from '../tag-scripts/gal-download/worker-runner.mjs'
import { lzmaBlock } from '../tag-scripts/gal-download/lzma.mjs'
import { generateTags } from '../tag-scripts/gal-download/main.js'

const ints = (...a) => { const b = Buffer.alloc(a.length * 4); a.forEach((n, i) => b.writeInt32LE(n, i * 4)); return b }
test('Unity LZMA range decoding and truncation detection need no external executable', () => {
  const compressed = Buffer.from('5d00008000002a14c576163e1b85f63a5d0ef5163f16642daec2b14cb455eabe590743cb89d6664d246f60e81a5758d6a3229f86ef7316669415675ca065e1a50489acf3fffec8e000', 'hex')
  const expected = Buffer.from('TSK catalog: ' + 'abc 123\n'.repeat(1000))
  assert.deepEqual(lzmaBlock(compressed, expected.length), expected)
  assert.throws(() => lzmaBlock(compressed.subarray(0, 25), expected.length), /截断|无效/)
})
function fixtureCatalog() {
  const keys = ['Assets/AssetBundles/Stills/st_1/st_1.png', 'hash.bundle', 'dep.bundle']
  let kd = ints(keys.length), bd = ints(keys.length)
  keys.forEach((key, index) => { const bytes = Buffer.from(key); bd = Buffer.concat([bd, ints(kd.length, 1, index)]); kd = Buffer.concat([kd, Buffer.from([0]), ints(bytes.length), bytes]) })
  return { m_InternalIds: [keys[0], '0#hash.bundle', '0#dep.bundle'], m_InternalIdPrefixes: ['https://cdn.example/'], m_KeyDataString: kd.toString('base64'), m_BucketDataString: bd.toString('base64'), m_EntryDataString: Buffer.concat([ints(3), ints(0, 0, 1, 0, -1, 0, 0), ints(1, 0, 2, 0, -1, 1, 0), ints(2, 0, -1, 0, -1, 2, 0)]).toString('base64') }
}
const align = (b) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4)])
const str = (text) => align(Buffer.concat([ints(Buffer.byteLength(text)), Buffer.from(text)]))
function rawBundle() {
  const payload = Buffer.concat([str('test.atlas'), str('atlas contents')])
  const metaPrefix = Buffer.concat([Buffer.from('2022.3.0f1\0'), ints(19), Buffer.from([0]), ints(1), ints(49), Buffer.alloc(3 + 16), ints(1)])
  const objectTable = Buffer.alloc(24)
  objectTable.writeBigInt64LE(9007199254740993n, 0)
  objectTable.writeUInt32LE(payload.length, 16)
  const meta = Buffer.concat([align(metaPrefix), objectTable])
  const dataOffset = 48 + meta.length
  const header = Buffer.alloc(48)
  header.writeUInt32BE(22, 8)
  header.writeUInt32BE(meta.length, 20)
  header.writeBigUInt64BE(BigInt(dataOffset + payload.length), 24)
  header.writeBigUInt64BE(BigInt(dataOffset), 32)
  const serialized = Buffer.concat([header, meta, payload])
  const be32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
  const block = Buffer.alloc(10); block.writeUInt32BE(serialized.length); block.writeUInt32BE(serialized.length, 4)
  const directory = Buffer.alloc(20); directory.writeBigUInt64BE(BigInt(serialized.length), 8)
  const info = Buffer.concat([Buffer.alloc(16), be32(1), block, be32(1), directory, Buffer.from('CAB-test\0')])
  const prefix = Buffer.concat([Buffer.from('UnityFS\0'), be32(6), Buffer.from('2022.3\0test\0')])
  const sizes = Buffer.alloc(20); sizes.writeBigUInt64BE(BigInt(prefix.length + 20 + info.length + serialized.length)); sizes.writeUInt32BE(info.length, 8); sizes.writeUInt32BE(info.length, 12)
  return { serialized, bundle: Buffer.concat([prefix, sizes, info, serialized]) }
}

test('catalog decode, dependency closure, dryRun has no network calls', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gal-native-'))
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = () => { requests++; throw new Error('Unexpected network access') }
  try {
    const source = path.join(dir, 'catalog.json'); await writeFile(source, JSON.stringify(fixtureCatalog()))
    const entries = catalogEntries(fixtureCatalog())
    assert.equal(entries[1].internal, 'https://cdn.example/hash.bundle')
    const plan = await planTsk({ source: { type: 'catalog', path: source } })
    assert.deepEqual(plan.entries[0].dependencies, ['https://cdn.example/dep.bundle'])
    const root = path.join(dir, 'media'); await mkdir(root)
    const out = await generateTags({ type: 'gal', item: { source: { path: root }, config: { game: { id: 'tsk' } } }, cacheDir: path.join(dir, 'cache'), script: { options: { dryRun: true, downloadLimit: 1, tasks: [{ game: 'tsk', source: { type: 'catalog', path: source } }] } } })
    assert.equal(out.details.status, 'completed')
    const result = JSON.parse(await readFile(path.join(out.details.runDir, 'result.json')))
    assert.deepEqual(result.results[0].summary, { 'would-download': 1, limited: 1 })
    assert.equal(requests, 0)
    assert.equal(destination('Assets/Adventure/ImportChara/1001001.chapter.asset').target, 'Adventure/CharaScenario/CharaScenario1001001.book.json')
    assert.equal(destination('Assets/AssetBundles/Characters/LowQuality/general/ch_1/a.png'), null)
  } finally { globalThis.fetch = originalFetch; await archiveToTmp(dir) }
})

test('native UnityFS/TextAsset extraction without type database or interpreter', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gal-native-raw-'))
  try {
    const fixture = rawBundle()
    assert.equal(serializedObjects(fixture.serialized)[0].pathId, '9007199254740993')
    const file = path.join(dir, 'raw.bundle'); await writeFile(file, fixture.bundle)
    const out = await nativeTask('extract', { bundle: file, assets: [{ source: 'Assets/AssetBundles/Stills/test.atlas.txt', target: 'Stills/test.atlas.txt', kind: 'raw' }] })
    assert.equal(Buffer.from(out.exports[0].data).toString(), 'atlas contents')
    assert.throws(() => decodeTree(Buffer.alloc(0), null), /禁止隐式下载/)
  } finally { await archiveToTmp(dir) }
})

test('package has no external module imports or runtime installer/network path outside explicit downloader', async () => {
  const root = new URL('../tag-scripts/gal-download/', import.meta.url)
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root)))
  assert.equal(manifest.options.allowRuntimeSetup, undefined)
  let fetches = 0
  for (const file of await readdir(root)) {
    assert.ok(!file.endsWith('.py') && !file.endsWith('.pyc'))
    if (!/\.(mjs|js)$/.test(file)) continue
    const source = await readFile(new URL(file, root), 'utf8')
    assert.doesNotMatch(source, /astral\.sh|pip install|uv venv|pythonRuntime|UnityPy==/)
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) assert.ok(match[1].startsWith('node:') || match[1].startsWith('./'), `${file} imports external package ${match[1]}`)
    const calls = [...source.matchAll(/\bfetch\s*\(/g)].length
    if (file !== 'main.js') assert.equal(calls, 0, `${file} must not request network resources`)
    fetches += calls
  }
  assert.equal(fetches, 1, 'only the explicitly configured data downloader can request network resources')
})

test('Utage nested grid fields decode locally into playback JSON', () => {
  const node = (type, name, children = [], flags = 0) => ({ type, name, children, flags })
  const array = (name, item) => node('vector', name, [node('Array', 'Array', [node('int', 'size'), item])])
  const tree = node('MonoBehaviour', 'Base', [node('string', 'm_Name'), array('importGridList', node('Grid', 'data', [node('string', 'name'), array('rows', node('Row', 'data', [array('strings', node('string', 'data'))]))]))])
  const bytes = Buffer.concat([str('MainScenario0001.book'), ints(1), str('Main00101'), ints(1), ints(2), str('Bg'), str('bg_adv_01')])
  const decoded = JSON.parse(JSON.stringify(decodeTree(bytes, tree)))
  assert.deepEqual(decoded, { m_Name: 'MainScenario0001.book', importGridList: [{ name: 'Main00101', rows: [{ strings: ['Bg', 'bg_adv_01'] }] }] })
})

test('local real TSK image fixture', { skip: !process.env.GAL_TSK_SAMPLE_BUNDLE }, async () => {
  const out = await nativeTask('extract', { bundle: process.env.GAL_TSK_SAMPLE_BUNDLE, assets: [{ source: 'Assets/AssetBundles/Sprites/Gacha/Bg/page_bg_0177_back.png', target: 'Sprites/Gacha/Bg/page_bg_0177_back.png', kind: 'png' }] })
  const bytes = Buffer.from(out.exports[0].data)
  assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a')
  assert.equal(bytes.readUInt32BE(16), 1500)
  assert.equal(bytes.readUInt32BE(20), 1124)
})

test('local real APK catalogs decode with no external database or downloads', { skip: !process.env.GAL_TSK_APK }, async () => {
  const plan = await nativeTask('plan', { source: { type: 'apk', path: process.env.GAL_TSK_APK } })
  assert.ok(plan.entries.length > 20000)
  assert.ok(plan.entries.reduce((n, e) => n + e.assets.length, 0) > 200000)
  assert.equal(plan.unresolved.length, 0)
})
