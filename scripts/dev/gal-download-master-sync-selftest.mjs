import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { mergeMaster } from '../tag-scripts/gal-download/master-sync.mjs'
import { generateTags } from '../tag-scripts/gal-download/main.js'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'
import * as utage from '../../web/library/gal/adapters/utage-book.mjs'
import { stateAt } from '../../web/static/gal-engine.js'

const table = entries => ({ name: 'Master:Character', headerRow: 0, rows: [{ rowIndex: 0, strings: ['CharacterName', 'NameText', 'FileName', 'FileType'] }, ...entries.map((values, i) => ({ rowIndex: i + 1, strings: values }))] })
const master = entries => ({ settingList: [table(entries)] })
const old = { ...master([['hero', '中文名字', 'Characters/old_SkeletonData.asset', 'Spine'], ['local-alias', '本地别名', 'Characters/local_SkeletonData.asset', 'Spine']]), _tsk_zh_names: { translated: true } }
const fresh = master([['hero', 'Hero', 'Characters/new_SkeletonData.asset', 'Spine'], ['hero-new', 'Hero', 'Characters/new-variant_SkeletonData.asset', 'Spine']])

test('native TSK dryRun plans an existing Master and its dependency without fetching, moving or writing media', async()=>{
 const dir=await mkdtemp('/tmp/master-plan-'),root=path.join(dir,'media'),cache=path.join(dir,'cache'),source=path.join(dir,'catalog.json')
 const ints=(...values)=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeInt32LE(v,i*4));return b}
 const keys=['Assets/Adventure/Master.chapter.asset','master.bundle','dependency.bundle'];let kd=ints(keys.length),bd=ints(keys.length)
 keys.forEach((key,i)=>{const bytes=Buffer.from(key);bd=Buffer.concat([bd,ints(kd.length,1,i)]);kd=Buffer.concat([kd,Buffer.from([0]),ints(bytes.length),bytes])})
 const catalog={m_InternalIds:[keys[0],'0#master.bundle','0#dependency.bundle'],m_InternalIdPrefixes:['https://fixture.test/'],m_KeyDataString:kd.toString('base64'),m_BucketDataString:bd.toString('base64'),m_EntryDataString:Buffer.concat([ints(3),ints(0,0,1,0,-1,0,0),ints(1,0,2,0,-1,1,0),ints(2,0,-1,0,-1,2,0)]).toString('base64')}
 await mkdir(path.join(root,'Adventure'),{recursive:true});await writeFile(source,JSON.stringify(catalog));const target=path.join(root,'Adventure/Master.chapter.json'),bytes=JSON.stringify(old);await writeFile(target,bytes)
 const task={id:'native-master',provider:'tsk',adapters:['utage-book'],dryRun:true,source:{type:'catalog',path:source}}
 const ctx={type:'gal',item:{adapters:['utage-book'],source:{path:root}},cacheDir:cache,script:{options:{tasks:[task]}}}
 const saved=globalThis.fetch;globalThis.fetch=()=>{throw Error('dryRun must not fetch')}
 try{
  const output=await generateTags(ctx);assert.equal(output.details.status,'completed');assert.equal(output.details.results[0].masterSync.candidateFiles,1)
  const plan=JSON.parse(await readFile(output.details.tasks[0].planPath));assert.deepEqual(plan.masterSyncCandidates,['Adventure/Master.chapter.json'])
  assert.equal(output.details.results[0].summary['would-download'],2);assert.equal(await readFile(target,'utf8'),bytes);assert.equal(existsSync(path.join(cache,'metadata-backups')),false)
  task.syncMaster=false;const disabled=await generateTags(ctx);assert.equal(disabled.details.results[0].masterSync.candidateFiles,0);assert.equal(await readFile(target,'utf8'),bytes)
 }finally{globalThis.fetch=saved;await archiveToTmp(dir)}
})

test('official mappings refresh while Chinese names, annotations and local aliases survive; merge is idempotent', () => {
 const result=mergeMaster(JSON.stringify(old),JSON.stringify(fresh)),data=JSON.parse(result.bytes),chars=utage.readMaster(result.bytes).chars
 assert.equal(result.report.addedRows,1);assert.equal(result.report.updatedRows,1);assert.equal(result.report.keptLocalRows,1)
 assert.equal(chars.get('hero').name,'中文名字');assert.equal(chars.get('hero').file,'Characters/new_SkeletonData.asset')
 assert.equal(chars.get('hero-new').name,'中文名字');assert.equal(chars.get('local-alias').name,'本地别名')
 assert.deepEqual(data._tsk_zh_names,old._tsk_zh_names);assert.equal(mergeMaster(result.bytes,JSON.stringify(fresh)).changed,false)
 assert.throws(()=>mergeMaster(JSON.stringify(old),'{}'),/settingList/)
 assert.throws(()=>mergeMaster(JSON.stringify(old),'{broken'),/不是有效 JSON/)
 assert.throws(()=>mergeMaster(JSON.stringify(old),JSON.stringify({settingList:[]})),/没有有效 Character/)
})

test('existing Master is checked, backed up in cache, atomically refreshed, then skips unchanged using cached bytes', async () => {
 const dir=await mkdtemp('/tmp/master-sync-'),root=path.join(dir,'media'),cache=path.join(dir,'cache'),target='Adventure/Master.chapter.json'
 await mkdir(path.join(root,'Adventure'),{recursive:true});const original=JSON.stringify(old);await writeFile(path.join(root,target),original)
 const task={id:'master-sync',provider:'files',adapters:['test'],source:{entries:[{url:'https://fixture.test/master',target}]},dryRun:true}
 const ctx={type:'gal',item:{adapters:['test'],source:{path:root}},cacheDir:cache,script:{options:{tasks:[task]}}}
 const saved=globalThis.fetch;let requests=0
 globalThis.fetch=async url=>{requests++;return new Response(String(url).endsWith('/bad')?'{}':JSON.stringify(fresh))}
 try {
  const dry=await generateTags(ctx);assert.equal(requests,0);assert.equal(await readFile(path.join(root,target),'utf8'),original)
  // A minimal saved native-style Master entry exercises the real task pipeline.
  const plan=JSON.parse(await readFile(dry.details.tasks[0].planPath));plan.entries[0].assets[0].kind='master'
  await writeFile(dry.details.tasks[0].planPath,JSON.stringify(plan));task.dryRun=false
  const output=await generateTags(ctx),result=JSON.parse(await readFile(path.join(output.details.runDir,'result.json'))).results[0]
  assert.equal(result.status,'completed');assert.equal(result.masterSync.updatedFiles,1);assert.equal(requests,1)
  const row=result.entries[0].metadata[0];assert.equal(row.status,'updated');assert.ok(row.backup.startsWith(cache+path.sep));assert.equal(await readFile(row.backup,'utf8'),original)
  assert.equal(utage.readMaster(await readFile(path.join(root,target))).chars.get('hero-new').name,'中文名字')
  const again=await generateTags(ctx),checked=JSON.parse(await readFile(path.join(again.details.runDir,'result.json'))).results[0]
  assert.equal(checked.masterSync.updatedFiles,0);assert.equal(checked.masterSync.unchangedFiles,1);assert.equal(requests,1)
  assert.match(await readFile(again.details.logFile,'utf8'),/master-sync-unchanged/)
  const valid=await readFile(path.join(root,target));plan.entries[0].url='https://fixture.test/bad';await writeFile(dry.details.tasks[0].planPath,JSON.stringify(plan))
  const bad=await generateTags(ctx),failed=JSON.parse(await readFile(path.join(bad.details.runDir,'result.json'))).results[0]
  assert.equal(failed.status,'failed');assert.equal(failed.entries[0].status,'extract-failed');assert.deepEqual(await readFile(path.join(root,target)),valid)
 } finally { globalThis.fetch=saved;await archiveToTmp(dir) }
})

const fixture=path.resolve('.cache/tsk-ch10340034'),hasReal=existsSync(path.join(fixture,'collected-root.txt'))
test('real collected Ch10340034 gains its missing 32 mappings and restores characters at steps 7/14/23/24', {skip:!hasReal}, async()=>{
 const root=(await readFile(path.join(fixture,'collected-root.txt'),'utf8')).trim(),local=await readFile(path.join(root,'Adventure/Master.chapter.json')),official=await readFile(path.join(fixture,'media/Adventure/Master.chapter.json'))
 const result=mergeMaster(local,official);assert.equal(result.report.tables.Character.added.length,32);assert.equal(mergeMaster(result.bytes,official).changed,false)
 const previous=utage.readMaster(local),next=utage.readMaster(result.bytes)
 for(const [key,value]of previous.chars)assert.equal(next.chars.get(key).name,value.name)
 const prefix='Twinkle Star Knights X_Data/StreamingAssets/Twinkle Star Knights X/',files=(await readFile(path.join(fixture,'collected/g01/__listing.tsv'),'utf8')).split('\n').slice(1).map(s=>s.split('\t')[0]).filter(s=>s.startsWith(prefix)).map(s=>s.slice(prefix.length))
 const ctx=utage.prepare({options:{},texts:{'Adventure/Master.chapter.json':result.bytes.toString()},files,toResourcePath:p=>p}),book=await readFile(path.join(root,'Adventure/CharaScenario/CharaScenario1034003.book.json'),'utf8'),scene=utage.parse(book,ctx,{scene:'4',options:{}})
 assert.deepEqual(scene.stats.unresolved,{})
 for(const step of [7,14,23,24])assert.match(stateAt(scene,step-1).spines.Chara1.skel,/ch_1034003_m1/)
})

test('real official Master and dependency bundles pass task download/extract/backup/write with NAS Chinese names', {skip:!hasReal}, async()=>{
 const collected=(await readFile(path.join(fixture,'collected-root.txt'),'utf8')).trim(),original=await readFile(path.join(collected,'Adventure/Master.chapter.json'))
 const sourceEntries=JSON.parse(await readFile(path.join(fixture,'selected-plan.json'))),entry=sourceEntries.find(e=>e.assets.some(a=>a.kind==='master'))
 const dir=await mkdtemp('/tmp/master-bundle-'),root=path.join(dir,'media'),cache=path.join(dir,'cache'),target='Adventure/Master.chapter.json'
 await mkdir(path.join(root,'Adventure'),{recursive:true});await writeFile(path.join(root,target),original)
 const task={id:'real-master',provider:'files',adapters:['test'],dryRun:true,source:{entries:[{url:entry.url,target}]}}
 const ctx={type:'gal',item:{adapters:['test'],source:{path:root}},cacheDir:cache,script:{options:{tasks:[task]}}}
 const saved=globalThis.fetch;let requests=0
 globalThis.fetch=async url=>{requests++;return new Response(await readFile(path.join(fixture,String(url).split('/').at(-1))))}
 try{
  const dry=await generateTags(ctx);assert.equal(requests,0)
  const filename=dry.details.tasks[0].planPath,plan=JSON.parse(await readFile(filename))
  plan.entries=[entry,...entry.dependencies.map(url=>({url,bundle:true,assets:[],dependencies:[]}))];await writeFile(filename,JSON.stringify(plan));task.dryRun=false
  const output=await generateTags(ctx),result=JSON.parse(await readFile(path.join(output.details.runDir,'result.json'))).results[0]
  assert.equal(result.status,'completed');assert.equal(requests,2);assert.equal(result.masterSync.updatedFiles,1)
  assert.equal(result.entries.find(r=>r.metadata?.length).metadata[0].tables.Character.added.length,32)
  assert.equal(utage.readMaster(await readFile(path.join(root,target))).chars.get('カティア-（覚醒）-戦闘服L').name,'卡蒂娅')
  assert.deepEqual(await readFile(result.entries.find(r=>r.metadata?.length).metadata[0].backup),original)
  const again=await generateTags(ctx),second=JSON.parse(await readFile(path.join(again.details.runDir,'result.json'))).results[0]
  assert.equal(second.masterSync.updatedFiles,0);assert.equal(second.masterSync.unchangedFiles,1);assert.equal(requests,2)
 }finally{globalThis.fetch=saved;await archiveToTmp(dir)}
})
