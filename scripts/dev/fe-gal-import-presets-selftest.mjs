// Actual import UI: every preset refreshes the JSON without submitting/saving.
import assert from 'node:assert/strict'
import {mkdtemp,writeFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {spawn} from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {galAdapterIds} from '../../web/library/gal/adapters/index.mjs'
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH||'@playwright/test')
const work=await mkdtemp(path.join(os.tmpdir(),'gal-import-presets-')),probe=net.createServer()
await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const base=`http://127.0.0.1:${port}`,logs=[],errors=[],writes=[],server=spawn(process.execPath,['web/server.mjs'],{env:{...process.env,DATA_DIR:work+'/data',HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']})
server.stdout.on('data',b=>logs.push(String(b)));server.stderr.on('data',b=>logs.push(String(b)));let browser
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,logs.join(''))
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForLoadState('networkidle');await page.click('[data-view="media-import-view"]');await page.selectOption('#media-import-profile','gal-import');
 const options=await page.locator('#gal-preset option').evaluateAll(xs=>xs.map(x=>({value:x.value,label:x.textContent})));for(const key of ['pac','edo','sakana'])assert.ok(options.some(o=>o.value===key),`Missing generic import preset: ${key}`)
 page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.method()+' '+r.url())})
 const adapters=new Set();for(const option of options){await page.selectOption('#gal-preset',option.value);const original={rootDir:'/read-only/games',dryRun:true,limit:3,defaultMetadataActions:['gal-layout'],config:{game:{id:'old',title:'old'},thumbSkip:[{match:'ui'}],player:{fontScale:1.2},adapterOptions:{custom:{keep:true}}}};await page.fill('#media-import-profile-config',JSON.stringify(original));await page.click('#gal-preset-refresh');const actual=JSON.parse(await page.inputValue('#media-import-profile-config'));assert.deepEqual({...actual,adapters:undefined,config:undefined},{...original,adapters:undefined,config:undefined});assert.deepEqual({...actual.config,game:undefined},{...original.config,game:undefined});assert.ok(actual.config.game.id);assert.ok(actual.adapters.length);for(const id of actual.adapters){assert.ok(galAdapterIds().includes(id),'Unknown adapter '+id);adapters.add(id)}if(['pac','edo','sakana','rpgmaker'].includes(option.value)){assert.equal(actual.config.game.id,option.value+'::game');assert.equal(actual.config.game.title,'')}}
 assert.deepEqual([...adapters].sort(),galAdapterIds().sort(),'Every registered playback adapter has an import preset');assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);console.log(`PASS import dropdown: ${options.length} presets cover all ${adapters.size} registered adapters; refresh preserves existing options and never saves/submits. Artifacts: ${work}`)
}finally{await browser?.close();server.kill('SIGTERM');await writeFile(work+'/server.log',logs.join(''))}
