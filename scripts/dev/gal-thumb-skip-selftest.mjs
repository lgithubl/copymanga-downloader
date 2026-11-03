// 缩略图黑名单 thumbSkip：配置校验 + 提取引擎里按大小 / 路径 / 尺寸跳过
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { normalizeGalConfigWithWarnings } from '../../web/library/gal/config.mjs'
import { createThumbEngine, imageSizeOf } from '../../web/library/gal/thumbs.mjs'
import { encodePng } from '../../web/library/gal/bgi.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = (v) => JSON.stringify(v)

// ---- 配置校验 ----
{
  const { config, warnings } = normalizeGalConfigWithWarnings({ thumbSkip: [{ minMB: 1.3 }, { match: 'cha', maxWidth: 800 }, { minMB: -1 }, { match: '(' }, { bogus: 1, minHeight: 100 }, 5, {}] })
  check('thumbSkip 校验：合法的规则留下（minMB / match + maxWidth / minHeight），负数 / 坏正则 / 不是对象 / 空规则丢掉并报告', J(config.thumbSkip) === J([{ minMB: 1.3 }, { match: 'cha', maxWidth: 800 }, { minHeight: 100 }]) && warnings.length >= 4, J([config.thumbSkip, warnings.map((w) => w.message || w)]))
  check('thumbSkip 默认空；不是数组 = 报告并不过滤；超过 10 条截掉', normalizeGalConfigWithWarnings({}).config.thumbSkip.length === 0 && normalizeGalConfigWithWarnings({ thumbSkip: 'x' }).config.thumbSkip.length === 0 && normalizeGalConfigWithWarnings({ thumbSkip: Array.from({ length: 12 }, () => ({ minMB: 1 })) }).config.thumbSkip.length === 10)
}

// ---- 引擎：真实文件 ----
const work = await mkdtemp(path.join(os.tmpdir(), 'thumb-skip-'))
try {
  const media = path.join(work, 'Game')
  await mkdir(path.join(media, 'img'), { recursive: true })
  const png = (w, h) => encodePng(w, h, 4, Buffer.alloc(w * h * 4, 7))
  const big = Buffer.concat([png(100, 50), Buffer.alloc(2 * 1024 * 1024)])   // PNG 头 + 垫到 2MB（尾巴是多余数据，解码器不管）
  await writeFile(path.join(media, 'img/big_bg.png'), big)
  await writeFile(path.join(media, 'img/small_bg.png'), png(40, 30))
  await writeFile(path.join(media, 'img/cha_wide.png'), png(900, 20))
  await writeFile(path.join(media, 'img/cha_narrow.png'), png(300, 20))
  const resolveAsset = async (rel) => { const abs = path.join(media, ...rel.split('/')); await stat(abs); return abs }
  const run = async (thumbSkip, files) => {
    const { config } = normalizeGalConfigWithWarnings({ thumbSkip })
    const engine = createThumbEngine({ mediaDir: media, config, resolveAsset })
    const out = new Map()
    const why = []
    await engine.addPaths(out, files, 'test', why)
    return { names: [...out.values()].map((p) => p.split('/').pop()), why }
  }
  const all = ['img/big_bg.png', 'img/small_bg.png', 'img/cha_wide.png', 'img/cha_narrow.png']
  check('不配 = 全留', J((await run([], all)).names) === J(['big_bg.png', 'small_bg.png', 'cha_wide.png', 'cha_narrow.png']))
  const r1 = await run([{ minMB: 1.3 }], all)
  check('minMB 1.3：小于 1.3MB 的丢掉（只剩 2MB 的那张）；诊断里写了原因（大小 / 阈值）', J(r1.names) === J(['big_bg.png']) && r1.why.some((w) => /small_bg\.png.*0\.00MB < 1\.3MB/.test(w)), J(r1))
  check('maxMB：大于它的丢掉', J((await run([{ maxMB: 1 }], all)).names) === J(['small_bg.png', 'cha_wide.png', 'cha_narrow.png']))
  check('路径 + 尺寸要同时满足（AND）：路径带 cha 且宽 < 800（minWidth）才丢，big_bg / small_bg 路径不匹配所以留着', J((await run([{ match: 'cha', minWidth: 800 }], all)).names) === J(['big_bg.png', 'small_bg.png', 'cha_wide.png']))
  check('规则之间是 OR：再加一条 minMB 1.3 = 小文件全丢，只剩 2MB 的', J((await run([{ match: 'cha', minWidth: 800 }, { minMB: 1.3 }], all)).names) === J(['big_bg.png']))
  check('尺寸条件：minWidth（宽 < 它丢）/ maxHeight（高 > 它丢）；读不出尺寸的文件这些条件不命中', J((await run([{ minWidth: 100 }], all)).names) === J(['big_bg.png', 'cha_wide.png', 'cha_narrow.png']) && J((await run([{ maxHeight: 25 }], all)).names) === J(['cha_wide.png', 'cha_narrow.png']))
  // 容器里还没解压的图：resolveAsset 只给「将来落盘的路径」（磁盘上没有）；以前 stat 失败 = 不过滤（thumbSkip 对这类图一律不生效），现在先 materialize 再量
  {
    const store = new Map([['virt/big.png', big], ['virt/small.png', png(40, 30)]])
    const calls = []
    const virtualResolve = async (rel) => path.join(work, 'cache', ...rel.split('/'))   // 路径在、文件不在
    const materialize = async (rel) => { calls.push(rel); const file = path.join(work, 'cache', ...rel.split('/')); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, store.get(rel)); return file }
    const { config } = normalizeGalConfigWithWarnings({ thumbSkip: [{ minMB: 1.3 }] })
    const out = new Map(); const why = []
    await createThumbEngine({ mediaDir: media, config, resolveAsset: virtualResolve, materialize }).addPaths(out, ['virt/big.png', 'virt/small.png'], 'test', why)
    check('容器里没解压的图：先取出来再量——小的被 minMB 丢掉、大的留下，诊断里有原因', J([...out.values()]) === J(['virt/big.png']) && why.some((w) => /virt\/small\.png.*MB < 1\.3MB/.test(w)) && calls.length === 2, J([[...out.values()], why, calls]))
    const out2 = new Map(); const calls2 = []
    await createThumbEngine({ mediaDir: media, config: normalizeGalConfigWithWarnings({}).config, resolveAsset: virtualResolve, materialize: async (r) => { calls2.push(r); return '' } }).addPaths(out2, ['virt/big.png', 'virt/small.png'], 'test', [])
    check('没配 thumbSkip 的游戏：不解压任何图（没有额外开销），图都留着', calls2.length === 0 && out2.size === 2, J([calls2, out2.size]))
    const out3 = new Map()
    await createThumbEngine({ mediaDir: media, config, resolveAsset: async (rel) => path.join(work, 'cache-none', ...rel.split('/')), materialize: async () => { throw new Error('取不出来') } }).addPaths(out3, ['virt/big.png', 'virt/small.png'], 'test', [])
    check('取不出来（解压失败）= 量不出来、不过滤，不报错', out3.size === 2)
  }
  const sz = await imageSizeOf(path.join(media, 'img/cha_wide.png'))
  check('imageSizeOf：PNG 宽高（只读文件头）；不是图 = null', sz.width === 900 && sz.height === 20 && (await imageSizeOf(path.join(work, 'nope'))) === null)
} finally { await rm(work, { recursive: true, force: true }) }

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
