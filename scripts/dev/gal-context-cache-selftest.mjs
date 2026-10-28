#!/usr/bin/env node
// 自测（纯 node）：文件索引（context）缓存——并发请求只重建一次（单飞）；过了 TTL 但目录没变 = 先用旧的、后台重建（调用方不等）；目录变了（mtime）= 必须等新的
import { mkdir, mkdtemp, rm, writeFile, utimes } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadAdapterContext } from '../../web/library/gal/context.mjs'
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const media = await mkdtemp(path.join(os.tmpdir(), 'ctxc-'))
await mkdir(path.join(media, 'd'), { recursive: true })
await writeFile(path.join(media, 'd', 'a.txt'), 'x')
let builds = 0
const adapter = { id: 'slow', contextDirs: () => ['d'], prepare: async ({ files }) => { builds += 1; const n = builds; await sleep(150); return { n, files: files.length } } }
const config = { adapterOptions: {}, resourceRoots: [''], indexSkip: [], limits: {} }
const load = () => loadAdapterContext({ adapter, mediaDir: media, config })

const first = await Promise.all([load(), load(), load()])
check('冷启动：3 个并发请求只建 1 次索引，拿到同一个结果（单飞）', builds === 1 && first.every((c) => c.n === 1), JSON.stringify([builds, first]))
check('命中缓存：不再重建', (await load()).n === 1 && builds === 1, String(builds))

// 把「现在」拨到 TTL 之后
const realNow = Date.now
Date.now = () => realNow() + 6 * 60 * 1000
const t0 = realNow()
const stale = await load()
const waited = realNow() - t0
check('过了 TTL、目录没变：立刻返回旧索引（不等重建，< 100ms），并在后台重建', stale.n === 1 && waited < 100, JSON.stringify([stale, waited]))
await sleep(300)
check('后台重建完成：下一次请求拿到新索引（n = 2），总共建了 2 次', (await load()).n === 2 && builds === 2, JSON.stringify([builds]))
// 目录变了（子目录 / 文件变动 → mtime 变）：必须等新的
Date.now = realNow
await mkdir(path.join(media, 'd', 'sub'))
await utimes(path.join(media, 'd'), new Date(), new Date(Date.now() + 5000))
const changed = await load()
check('目录变了（mtime 变）：不用旧的，等新索引（n = 3）', changed.n === 3, JSON.stringify([changed, builds]))
await rm(media, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
