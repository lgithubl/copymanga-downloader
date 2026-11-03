#!/usr/bin/env node
// 压缩包图集导入：「已存在跳过」要说清楚是怎么回事（同一个文件 / 内容相同的另一份 / id 冲突 / 条目指向的 zip 不在了）。纯 node，不需要服务端和 Redis。
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { access } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { computeArchiveId, createArchiveGalleryHandler } from '../../web/library/types/archive-gallery.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  <-- ${detail}`}`) }
const J = JSON.stringify
const work = mkdtempSync(path.join(os.tmpdir(), 'arc-skip-'))
try {
  const input = path.join(work, 'input'); const data = path.join(work, 'data'); const managed = path.join(work, 'managed')
  for (const d of [input, data, managed]) mkdirSync(d, { recursive: true })
  const cfg = { mediaImportSourceRoots: input, archiveCacheDir: path.join(work, 'cache'), mediaImportProfiles: { 'archive-gallery': { managedDir: managed } } }
  const handler = createArchiveGalleryHandler({ type: 'archive', dataDir: data, safeSegment: (v) => String(v).replace(/[^\w.-]/g, '_'), pathExists: (p) => access(p).then(() => true, () => false), getConfig: () => cfg })
  // 1 MB 随机数据的 stored zip（前 512000 字节就是这段随机数据，所以后面追加条目 id 不变、大小变）
  const mk = (file, extra = false) => execFileSync('python3', ['-c', `
import zipfile,sys,os,random
random.seed(1)
with zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_STORED) as z:
    z.writestr('001.png', bytes(random.getrandbits(8) for _ in range(700000)))
    if sys.argv[2]=='1': z.writestr('002.png', b'x'*5000)
`, file, extra ? '1' : '0'])
  mk(path.join(input, 'A.zip'))
  const first = await handler.importFromSource({ sourcePath: input, options: {} })
  check('先真导入 A.zip：导入 1 个（mv 进受管目录）', first.imported === 1 && first.skipped === 0, J(first))
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
  const managedA = walk(managed)[0]
  const idA = await computeArchiveId(managedA)
  // 情形 1：内容相同的另一份（A 的拷贝）
  copyFileSync(managedA, path.join(input, 'A_copy.zip'))
  // 情形 2：id 冲突（前 512000 字节相同、大小不同）
  mk(path.join(input, 'A_v2.zip'), true)
  const dry = await handler.importFromSource({ sourcePath: input, options: { dryRun: true } })
  const reasons = Object.keys(dry.skipReasons)
  check('试运行：两个文件都因为 id 已存在而跳过，不会「将导入」', dry.scanned === 2 && dry.skipped === 2 && dry.imported === 0, J(dry))
  check('原因 1：内容相同的另一个文件（大小一样），示例里有已有条目的路径 / 标题 / 来源', reasons.some((r) => r.startsWith('内容相同的另一个文件')) && dry.skipExamples.some((e) => e.file.endsWith('A_copy.zip') && e.existingPath.startsWith(managed) && e.existingTitle === 'A' && e.id === idA), J(dry.skipExamples))
  check('原因 2：id 冲突（前 512000 字节相同、大小不同），示例里同时给出两边的大小', reasons.some((r) => r.startsWith('id 冲突')) && dry.skipExamples.some((e) => e.file.endsWith('A_v2.zip') && e.size !== e.existingSize), J(dry.skipExamples))
  // 情形 3：同一个文件（条目是外部引用，指向的就是这个路径）
  const ext = path.join(input, 'E.zip'); mk(ext)
  const idE = await computeArchiveId(ext)
  await handler.internals.writeItem(handler.internals.buildItem({ itemId: idE, title: 'E-external', zipPath: ext, external: true, size: statSync(ext).size, mtimeMs: 1, origin: { lrr: { id: idE } } }))
  const dryE = await handler.importFromSource({ sourcePath: ext, options: { dryRun: true } })
  check('原因 3：条目就指向这个路径 = 同一个文件已经导入过；来源标成「迁移自 LANraragi」', dryE.skipped === 1 && dryE.skipExamples[0]?.reason.startsWith('同一个文件') && dryE.skipExamples[0].existingOrigin === '迁移自 LANraragi', J(dryE))
  // 情形 4：条目存在但它指向的 zip 没了
  rmSync(ext)
  mk(path.join(input, 'E2.zip'))
  await handler.internals.writeItem(handler.internals.buildItem({ itemId: await computeArchiveId(path.join(input, 'E2.zip')), title: 'E2-old', zipPath: path.join(work, 'gone.zip'), external: true, size: 1, mtimeMs: 1 }))
  const dryGone = await handler.importFromSource({ sourcePath: path.join(input, 'E2.zip'), options: { dryRun: true } })
  check('原因 4：条目存在但它指向的 zip 已经不在原路径', dryGone.skipExamples[0]?.reason.includes('已经不在原路径'), J(dryGone))
  const limited = await handler.importFromSource({ sourcePath: input, options: { dryRun: true, limit: 1 } })
  check('限量模式也带原因（跳过的不占名额）', limited.skipped >= 1 && Object.keys(limited.skipReasons).length >= 1, J(limited))
} finally { rmSync(work, { recursive: true, force: true }) }
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
