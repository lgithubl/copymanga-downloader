import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile, readdir, mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as rpg from '../../web/library/gal/adapters/rpgmaker-json.mjs'
import { stateAt, activePath } from '../../web/static/gal-engine.js'
import { computeMarkers } from '../../web/library/gal/markers.mjs'
import { collectFallbackImages } from '../../web/library/gal/fallback-thumbs.mjs'
import { decryptRpgMaker, createRpgMakerResourceCache } from '../../web/library/gal/rpgmaker.mjs'
import { generateTags } from '../tag-scripts/gal-layout/main.js'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'
const C = (code, parameters = [], indent = 0) => ({ code, parameters, indent })
const message = text => [C(101, ['',0,0,2,'Alice']), C(401,[text])]
const common = list => [null, {id:1,name:'回想 CG',list}, {id:2,name:'helper',list:message('helper text')}]
const prep = async (events, options = {}, extra = {}) => rpg.prepare({ options, texts: { 'data/CommonEvents.json':JSON.stringify(events), 'data/System.json':JSON.stringify({gameTitle:'generic fixture'}), ...extra }, files:[], ...extra })
const commands = scene => scene.steps.flatMap(s=>s.commands)

test('generic event flow: inline common calls, choices, variables and branch-entry snapshots survive seek',async()=>{
 const events=common([C(121,[1,1,0]),C(102,[['Yes','No'],-1,0,2,0]),C(402,[0,'Yes']),C(111,[0,1,0],1),C(121,[1,1,1],2),...message('yes branch').map(c=>({...c,indent:2})),C(411,[],1),...message('wrong else').map(c=>({...c,indent:2})),C(412,[],1),C(117,[2],1),C(402,[1,'No']),...message('no branch').map(c=>({...c,indent:1})),C(404),C(122,[4,4,0,0,42]),...message('value=\\V[4]')])
 const ctx=await prep(events),scene=rpg.parse(JSON.stringify(events),ctx,{scene:'common-1'})
 const choice=commands(scene).find(c=>c.op==='choice'),picked={[choice.id]:1}
 const texts=activePath(scene,picked).map(i=>stateAt(scene,i,picked).text.map(s=>s.text).join(''))
 assert.ok(texts.includes('yes branch'));assert.ok(texts.includes('helper text'));assert.ok(!texts.includes('wrong else'));assert.ok(!texts.includes('no branch'))
 assert.equal(stateAt(scene,scene.steps.length-1,picked).text.map(s=>s.text).join(''),'value=42')
 assert.ok(!activePath(scene,{[choice.id]:2}).some(i=>stateAt(scene,i,{[choice.id]:2}).text.map(s=>s.text).join('')==='yes branch'))
})

test('pictures use MV event and literal script argument layouts; arbitrary JS is diagnosed without executing',async()=>{
 const events=common([...message('intro'),C(355,['$gameScreen.showPicture(10, "cg_example", 0, 0, 0, 100, 100, 255, 0);']),...message('cg line'),C(232,[10,0,1,0,400,300,50,50,255,0,30,true]),...message('move'),C(355,['globalThis.RPG_BAD = 1;']),...message('end')])
 const ctx=await prep(events),scene=rpg.parse(JSON.stringify(events),ctx,{scene:'common-1'})
 const pic=commands(scene).find(c=>c.op==='overlay'&&c.src)
 assert.deepEqual(pic.anchor,[0,0]);assert.equal(pic.scaleX,1);assert.equal(pic.x,-408);assert.equal(pic.y,-312);assert.equal(pic.cg,true)
 assert.equal(globalThis.RPG_BAD,undefined);assert.ok(scene.stats.raw['script-unhandled'])
 const moved=commands(scene).find(c=>c.op==='overlay'&&!c.src);assert.deepEqual(moved.anchor,[0.5,0.5]);assert.equal(moved.x,-8);assert.equal(moved.y,-12)
 const thumbs=collectFallbackImages(scene,{prefer:['cg','bg'],only:['cg_example'],scanSteps:100,overlays:false})
 assert.ok(JSON.stringify(thumbs).includes('cg_example.png'))
 assert.ok(!JSON.stringify(collectFallbackImages(scene,{skip:['cg_example'],scanSteps:100})).includes('cg_example.png'))
 const markers=computeMarkers(scene,[{kind:'cmd',op:'overlay',re:/cg_example/,label:'CG',pick:'each',max:4}]);assert.ok(markers.length)
 const state=stateAt(scene,markers[0].step);assert.equal(state.overlays[0].src,'img/pictures/cg_example.png')
})

test('catalog is configurable across games: matching specials preserves normal entries; recursive calls are bounded',async()=>{
 const events=common([...message('intro'),C(117,[2]),...message('end')]);events[2].list.push(C(117,[1]))
 const ctx=await prep(events,{special:{minText:2}})
 const special=ctx.catalogTree.children.find(n=>n.id==='special'),all=ctx.catalogTree.children.find(n=>n.id==='common')
 assert.ok(special.children.some(n=>n.script.endsWith('::common-1')));assert.ok(all.children.some(n=>n.script.endsWith('::common-1')))
 const disabled=await prep(events,{special:{enabled:false}});assert.ok(!disabled.catalogTree.children.some(n=>n.id==='special'))
 assert.ok(rpg.parse(JSON.stringify(events),ctx,{scene:'common-1'}).stats.raw['common-event-cycle-or-depth'])
})

test('mid-scene markers carry the choices needed to restore a guarded CG, rather than skipping that branch', async () => {
 const events=common([...message('intro'),C(102,[['A','B'],-1,0,2,0]),C(402,[0,'A']),...message('A').map(c=>({...c,indent:1})),C(402,[1,'B']),C(231,[1,'cg_branch',0,0,0,0,100,100,255,0],1),...message('B').map(c=>({...c,indent:1})),C(404),...message('after'),...message('end')])
 const ctx=await prep(events),scene=rpg.parse(JSON.stringify(events),ctx,{scene:'common-1'})
 const marks=computeMarkers(scene,[{kind:'cmd',op:'overlay',re:/cg_branch/,label:'CG',pick:'each',max:4}])
 assert.equal(marks.length,1);assert.equal(Object.values(marks[0].choices)[0],2)
 assert.ok(stateAt(scene,marks[0].step,marks[0].choices).overlays.some(p=>p.src==='img/pictures/cg_branch.png'))
 assert.ok(!stateAt(scene,marks[0].step,{}).overlays.length)
})

test('conditional event exit stops that invocation while its caller can continue', async () => {
 const events=common([C(121,[1,1,0]),C(117,[2]),...message('caller resumes')])
 events[2].list=[C(111,[0,1,0]),C(115,[],1),C(412),...message('must not run')]
 const ctx=await prep(events),scene=rpg.parse(JSON.stringify(events),ctx,{scene:'common-1'})
 const text=activePath(scene).map(i=>stateAt(scene,i).text.map(s=>s.text).join(''))
 assert.ok(text.includes('caller resumes'));assert.ok(!text.includes('must not run'))
})

const real=path.resolve('.cache/diagnostics-138/extracted/g01')
test('real RJ01482469: layout, plugin metadata, map catalog and media samples', {skip:!existsSync(real+'/www/data/System.json')},async()=>{
 const manifest=JSON.parse(await readFile('scripts/tag-scripts/gal-layout/manifest.json'))
 const output=await generateTags({type:'gal',item:{source:{path:real},config:{}},script:{version:manifest.version,options:{}},tags:[]})
 const config=output.itemPatch.gal.config, options=config.adapterOptions['rpgmaker-json'], texts={},files=[]
 async function walk(d){for(const e of await readdir(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await walk(p);else files.push(path.relative(real,p).split(path.sep).join('/'))}}
 await walk(real);for(const f of rpg.contextFiles(options))texts[f]=await readFile(path.join(real,f),'utf8')
 const ctx=await rpg.prepare({options,texts,files,toResourcePath:r=>r.replace(/^www\//,''),mediaDir:real})
 assert.equal(output.details.game,'rpgmaker::rj01482469');assert.deepEqual(ctx.stage,[1280,720]);assert.equal(ctx.maps.size,38);assert.equal(ctx.standing.size,179)
 assert.ok(ctx.catalogTree.children.find(n=>n.id==='special').children.length>10)
 for(const event of ctx.common.filter(e=>e?.list?.length)) {
  const scene=rpg.parse(texts['www/data/CommonEvents.json'],ctx,{rel:'CommonEvents.json',scene:`common-${event.id}`,options})
  assert.ok(scene.steps.length>0);assert.ok(scene.steps.length<100000)
 }
 const unique=new Set()
 async function checkCatalog(node){
  if(node.script&&!unique.has(node.script)){
   unique.add(node.script);const [rel,scene]=node.script.split('::')
   const data=rel.endsWith('CommonEvents.json')?texts[rel]:JSON.stringify(ctx.maps.get(rel))
   assert.ok(rpg.sniff(data),rel)
   assert.ok(rpg.parse(data,ctx,{rel,scene,options}).steps.length>0,node.script)
  }
  for(const child of node.children||[])await checkCatalog(child)
 }
 await checkCatalog(ctx.catalogTree)
 const tmp=await mkdtemp('/tmp/rpg-media-')
 try {
  const cache=createRpgMakerResourceCache(tmp), key=ctx.system.encryptionKey
  for(const f of files.filter(f=>/\.(rpgmvp|rpgmvo)$/.test(f))) {
   const bytes=decryptRpgMaker(await readFile(path.join(real,f)),key)
   const materialized=await cache(path.join(real,f),real,options)
   assert.deepEqual(await readFile(materialized),bytes)
   assert.equal(await cache(path.join(real,f),real,options),materialized)
  }
 } finally {await archiveToTmp(tmp)}
})
