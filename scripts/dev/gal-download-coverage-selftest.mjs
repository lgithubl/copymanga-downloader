import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {destination,planTsk} from '../tag-scripts/gal-download/tsk.mjs'
import {generateTags} from '../tag-scripts/gal-download/main.js'
import {archiveToTmp} from '../tag-scripts/gal-download/archive.mjs'
const ints=(...v)=>{const b=Buffer.alloc(v.length*4);v.forEach((x,i)=>b.writeInt32LE(x,i*4));return b}
function catalog(assets){
 const keys=[...assets,'dependency.bundle'];let kd=ints(keys.length),bd=ints(keys.length)
 keys.forEach((k,i)=>{const b=Buffer.from(k);bd=Buffer.concat([bd,ints(kd.length,1,i)]);kd=Buffer.concat([kd,Buffer.from([0]),ints(b.length),b])})
 return {m_InternalIds:keys.map((k,i)=>i===assets.length?'https://cdn.example/dependency.bundle':k),m_KeyDataString:kd.toString('base64'),m_BucketDataString:bd.toString('base64'),m_EntryDataString:Buffer.concat([ints(keys.length),...keys.map((k,i)=>ints(i,0,i===assets.length?-1:assets.length,0,-1,i,0))]).toString('base64')}
}
const cutin=(quality,mode,ext)=>`Assets/AssetBundles/Cutin/Characters/${quality}/${mode}/1001005/bc_1001005.${ext}`
test('new skeleton families normalize to the existing library and preserve triplets',()=>{
 for(const ext of ['png','atlas.txt','skel.bytes']) assert.equal(destination(cutin('HighQuality','adult',ext)).target,`Cutin/1001005/bc_1001005.${ext}`)
 assert.equal(destination(cutin('LowQuality','adult','png')),null)
 for(const folder of ['Spine','Textures']) assert.equal(destination(`Assets/AssetBundles/Adventure/${folder}/AE_0200/a.skel.bytes`).target,`Adventure/${folder}/AE_0200/a.skel.bytes`)
})
test('multi-page adventure atlas retains every texture page in the plan',async()=>{
 const base=await mkdtemp('/tmp/gdl-pages-')
 try{
 const source=path.join(base,'catalog.json'),prefix='Assets/AssetBundles/Adventure/Spine/AE_0202/'
 const names=['AE_0202.atlas.txt','AE_0202.skel.bytes','AE_0202.png','AE_0202_2.png']
 await writeFile(source,JSON.stringify(catalog(names.map(n=>prefix+n))))
 const plan=await planTsk({source:{type:'catalog',path:source}})
 assert.deepEqual(plan.entries.flatMap(e=>e.assets.map(a=>a.target)).sort(),names.map(n=>'Adventure/Spine/AE_0202/'+n).sort())
 assert.equal(plan.catalogAudit.mappedAssets,4)
 }finally{await archiveToTmp(base)}
})
test('every catalog entry is accounted for, rejected other assets are visible, and higher quality wins',async()=>{
 const base=await mkdtemp('/tmp/gdl-coverage-');const source=path.join(base,'catalog.json')
 try{
 const keys=[cutin('HighQuality','general','png'),cutin('HighQuality','adult','png'),cutin('LowQuality','adult','png'),'Assets/AssetBundles/Adventure/Spine/AE_0200/a.skel.bytes','Assets/AssetBundles/UnknownNewFamily/a.png','Assets/AssetBundles/UnknownNewFamily/a.prefab']
 await writeFile(source,JSON.stringify(catalog(keys)))
 const plan=await planTsk({source:{type:'catalog',path:source}}),audit=plan.catalogAudit
 assert.equal(audit.totalEntries,keys.length+1)
 assert.equal(audit.mappedAssets,2)
 assert.equal(Object.values(audit.byCategory).flatMap(Object.values).reduce((a,b)=>a+b,0),audit.totalEntries)
 assert.equal(audit.byCategory.cutin['skip-duplicate-target'],1)
 assert.equal(audit.byCategory.cutin['skip-low-quality'],1)
 assert.equal(audit.byCategory.other['skip-unsupported-path-or-format'],1)
 assert.equal(audit.byCategory.other['skip-unsupported-format'],1)
 assert.equal(audit.byCategory.other['skip-catalog-key'],1)
 assert.ok(audit.skipped.some(r=>r.source===keys[4]))
 assert.equal(plan.entries.flatMap(e=>e.assets).find(a=>a.target.startsWith('Cutin/')).source,keys[1])
 const root=path.join(base,'media');await mkdir(root)
 const result=await generateTags({type:'gal',item:{adapters:['utage-book'],source:{path:root},config:{game:{id:'tsk'}}},cacheDir:path.join(base,'cache'),script:{options:{tasks:[{id:'tsk',game:'tsk',adapters:['utage-book'],provider:'tsk',dryRun:true,skipCategories:['cutin'],source:{type:'catalog',path:source}}]}}})
 assert.equal(result.details.status,'completed')
 assert.match(await readFile(result.details.logFile,'utf8'),/APK分类审计 \[other\].*skip-unsupported/)
 const task=result.details.results[0];const saved=JSON.parse(await readFile(task.catalogAudit.path))
 assert.equal(saved.totalEntries,keys.length+1)
 assert.equal(task.classification.cutin.skipped,1)
 }finally{await archiveToTmp(base)}
})
