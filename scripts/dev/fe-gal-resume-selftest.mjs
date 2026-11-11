// Actual application entry: stale Gal reading history must recover to the homepage.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { createGalHandler } from '../../web/library/types/gal.mjs'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test')
const dir = await mkdtemp('/tmp/fe-gal-resume-'), media = path.join(dir, 'media'), dataDir = path.join(dir, 'data')
let server, browser, output = ''
try {
  await mkdir(path.join(media, 'arc/script/Arc04/04'), { recursive: true })
  await writeFile(path.join(media, 'arc/script/Arc04/04/04_01_cg.tomoe'), JSON.stringify({ format: 'tomoe-arc04/1', events: [['T','opening'],['#',87]] }))
  const handler = createGalHandler({ dataDir, safeSegment: v => String(v).replace(/[^\w.-]/g, '_'), pathExists: async () => false, getConfig: () => ({ mediaImportProfiles: {} }) })
  const item = (await handler.importFromSource({ sourcePath: media, options: { adapters: ['tomoe::arc04'], defaultMetadataActions: [], config: { scriptRoots: [{ id: 'story', dir: 'arc/script' }], resourceRoots: ['arc/res'], scriptExtensions: ['tomoe'], thumbFallback: { enabled: false } } } })).items[0]
  const old = 's:Arc04/02/02_01_cg.tomoe'
  await handler.saveProgress(item.itemId, { unitId: 'main', sectionId: old, scrollRatio: 0.6 })
  const portProbe = net.createServer(); await new Promise(r => portProbe.listen(0, '127.0.0.1', r)); const port = portProbe.address().port; await new Promise(r => portProbe.close(r))
  const base = `http://127.0.0.1:${port}`
  server = spawn(process.execPath, ['web/server.mjs'], { env: { ...process.env, DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore','pipe','pipe'] })
  server.stdout.on('data', b => { output = (output + b).slice(-6000) }); server.stderr.on('data', b => { output = (output + b).slice(-6000) })
  let ready = false
  for(let i=0;i<80;i++) { try { if((await fetch(base+'/health')).ok){ready=true;break} }catch{} await new Promise(r=>setTimeout(r,250)) }
  assert.ok(ready, output)
  const prefix = `/api/library/items/gal/${item.itemId}`
  const saved = await fetch(base+prefix+'/history', { method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lastUnitId:'main',lastSectionId:old,lastSectionTitle:'old chapter',visit:true}) }); assert.ok(saved.ok,await saved.text())
  browser = await chromium.launch({ headless:true, ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {}) })
  const page = await browser.newPage(), requests = [], errors = []
  page.on('pageerror', e=>errors.push(e.message))
  page.on('request', req=>{const u=new URL(req.url());if(u.pathname===prefix+'/reader/main')requests.push(u.searchParams.get('sectionId')||'')})
  await page.goto(base+`/#/media/gal/${item.itemId}?tab=new`)
  await page.getByText('上次阅读位置已失效，已返回首页，请重新选择章节。原阅读进度保留。', {exact:true}).waitFor()
  assert.deepEqual(requests,[old,''])
  assert.equal(new URL(page.url()).hash,`#/media/gal/${item.itemId}/main?tab=new`)
  const progress = await (await fetch(base+prefix+'/progress')).json()
  assert.equal(progress.lastSectionId,old); assert.equal(progress.lastScrollRatio,0.6)
  assert.equal(progress.nodes[old].ratio,0.6)
  await page.waitForFunction(async url=>(await(await fetch(url)).json()).lastSectionId==='',base+prefix+'/history')
  requests.length=0
  await page.reload(); await page.getByText('Arc04',{exact:true}).first().waitFor()
  assert.deepEqual(requests,[''])
  assert.deepEqual(errors,[])
  console.log('PASS real app: stale resume → homepage notice, URL/history corrected, reading progress retained, reload succeeds')
} catch(error) { console.error(output); throw error }
finally {
  if(browser)await browser.close()
  if(server && server.exitCode===null){const exit=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await exit}
  await archiveToTmp(dir)
}
