// Actual reported scripts/resources, plus app import using the user's custom IDs.
import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile,writeFile,mkdir,mkdtemp,open,readdir}from'node:fs/promises'
import{existsSync}from'node:fs'
import{createHash}from'node:crypto'
import path from'node:path'
import os from'node:os'
import{decodeTextFile}from'../../web/library/text-decode.mjs'
import{parse as pacParse}from'../../web/library/gal/adapters/pac-script.mjs'
import{parse as edoParse}from'../../web/library/gal/adapters/edo-lua.mjs'
import{prepare as rpgPrepare,parse as rpgParse}from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{stateAt,activePath,initialState,applyCommand}from'../../web/static/gal-engine.js'
import{computeMarkers}from'../../web/library/gal/markers.mjs'
import{edoPayload}from'../../web/library/gal/edo.mjs'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags,resolveLayout}from'../tag-scripts/gal-layout/main.js'
import{twiSparse}from'./new-games-sparse-fixtures.mjs'
const sampled='.cache/bugs-073723/extracted',available=existsSync(sampled),output='.cache/reported-scenes-fixtures'
if(available)await mkdir(output,{recursive:true})
test('reported samples match every length and SHA256; native Shiro body/face dimensions agree',{skip:!available},async()=>{
 for(const gid of['g01','g02','g03']){const report=JSON.parse(await readFile(`${sampled}/${gid}/__bugs/index.json`));for(const r of report.files){const b=await readFile(`${sampled}/${gid}/${r.artifact}`);assert.equal(b.length,r.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),r.sha256);if(r.artifact.endsWith('.bytes')){const png=edoPayload(b);assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],r.artifact.includes('/standing-shiro-far/')?[637,2013]:[853,1259]);await writeFile(`${output}/${path.basename(r.artifact).replace('.bytes','.png')}`,png)}}}
})
test('native PAC00_1250 restores BG0723 after each CGOUT, including sentence12',{skip:!available},async()=>{
 const text=decodeTextFile(await readFile(`${sampled}/g01/data/Script/00_1250.txt`)).text,scene=pacParse(text)
 assert.ok(scene.steps.length>=12);assert.ok(stateAt(scene,11).bg?.src.endsWith('/0723.png'))
 const backgrounds=scene.steps.flatMap(s=>s.commands).filter(c=>c.op==='bg');assert.ok(backgrounds.some((c,i)=>c.over?.endsWith('590_02.png')&&c.src.endsWith('0723.png')&&!backgrounds[i+1]?.over&&backgrounds[i+1]?.src.endsWith('0723.png')))
 await writeFile(output+'/pac-scene.json',JSON.stringify(scene))
 const report=JSON.parse(await readFile(`${sampled}/g01/__bugs/index.json`));for(const r of report.files.filter(r=>r.artifact.endsWith('.png')))await writeFile(output+'/'+path.basename(r.artifact),await readFile(`${sampled}/g01/${r.artifact}`))
})
test('native Shiro top-left geometry keeps tall body/head on screen; sentence48 retains face transform; markers match bg',{skip:!available},async()=>{
 for(const name of['05_汎用アダルト_ユニーク部分1_2_昼■','12_エンディング白3■']){
  const text=edoPayload(await readFile(`.cache/new-games-162126/extracted/g02/__remaining/shiro/src/game/${name}.txt`),{text:true}),scene=edoParse(JSON.stringify({format:'edo-lua/1',text})),live=activePath(scene),target=live.find(i=>stateAt(scene,i).text.some(t=>name.startsWith('05')?/透、ご飯食べよ/.test(t.text):/怖くなってきた/.test(t.text))),state=stateAt(scene,target),body=state.overlays.find(x=>x.slot==='edo:C1'),face=state.overlays.find(x=>x.slot==='edo:C2')
  assert.deepEqual([body.x,body.y,body.scaleX,body.anchor],[face.x,face.y,face.scaleX,face.anchor]);assert.deepEqual(body.anchor,[0,0]);assert.equal(body.x,name.startsWith('05')?500-960:550-960);assert.equal(body.y,name.startsWith('05')?30-540:-30-540)
  if(name.startsWith('12')){const entry=resolveLayout('edo'),rules=entry.config.sceneMarkers.map(r=>({...r,re:new RegExp(r.match,'i')}));assert.equal(computeMarkers(scene,rules).length,6)}
  await writeFile(output+'/'+(name.startsWith('05')?'shiro-tall':'shiro-face')+'.json',JSON.stringify({scene,target}))
 }
})
async function walk(root,rel=''){const out=[];for(const e of await readdir(path.join(root,rel),{withFileTypes:true})){const p=path.posix.join(rel,e.name);if(e.isDirectory())out.push(...await walk(root,p));else out.push(p)}return out}
async function rpg(gid,extra=[]){const root=`.cache/new-games-043952/extracted/${gid}`,prefix=gid==='g03'?'www/':'',texts={},files=await walk(root);for(const n of['System','CommonEvents','Actors','MapInfos','Tilesets'])texts[`${prefix}data/${n}.json`]=await readFile(`${root}/${prefix}data/${n}.json`,'utf8');texts[prefix+'js/plugins.js']=await readFile(`.cache/new-games-043202/extracted/${gid}/${prefix}js/plugins.js`,'utf8');const ctx=await rpgPrepare({options:{root:prefix.replace(/\/$/,'')},texts,files,mediaDir:root});for(const [rel,file]of extra)ctx.maps.set(rel,JSON.parse(await readFile(file)));return ctx}
test('native RJ01271506 shop consumes TRN while retaining both original text messages',{skip:!available},async()=>{const ctx=await rpg('g01'),scene=rpgParse('',ctx,{rel:'data/CommonEvents.json',scene:'common-685'}),text=activePath(scene).flatMap(i=>stateAt(scene,i).text).map(t=>t.text).join('\n');assert.ok(!text.includes('TRN'));assert.ok(text.includes('珍藏品'));assert.ok(text.includes('记得常来'));assert.equal(scene.stats.text,2)})
test('native RJ01646655 EP3 asks for missing personality; each choice enters its own48-message original branch',{skip:!available},async()=>{const ctx=await rpg('g02'),scene=rpgParse('',ctx,{rel:'data/CommonEvents.json',scene:'common-511'}),choice=scene.steps.flatMap(s=>s.commands).find(c=>c.op==='choice');assert.deepEqual(choice.options.map(o=>o.segments[0].text),['内気','真面目','高貴']);for(let n=1;n<=3;n++){const selected={[choice.id]:n},live=activePath(scene,selected),textSteps=live.filter(i=>scene.steps[i].commands.some(c=>c.op==='text'&&(!c.when||c.when.every(w=>true))));assert.ok(textSteps.length>=40);const states=live.map(i=>stateAt(scene,i,selected));assert.ok(states.some(s=>s.vars['rpg:s:'+(32+n)]===1));assert.ok(states.some(s=>s.bgvoices&&Object.values(s.bgvoices).some(v=>v.src)));console.log('EP3 native variant',n,'visible steps',live.length)}await writeFile(output+'/rpg-ep3.json',JSON.stringify({scene,choice}))})
test('native RJ328940 EV004 watching branch follows Map081 autorun and includes original dialogue',{skip:!available},async()=>{const ctx=await rpg('g03',[['www/data/Map081.json',`${sampled}/g02/www/data/Map081.json`],['www/data/Map336.json','.cache/new-games-052443/extracted/g03/www/data/Map336.json']]),scene=rpgParse('',ctx,{rel:'www/data/Map336.json',scene:'event-4-1'}),choice=scene.steps.flatMap(s=>s.commands).find(c=>c.op==='choice'),selected={[choice.id]:2},live=activePath(scene,selected),texts=live.flatMap(i=>stateAt(scene,i,selected).text).map(t=>t.text).join('\n');assert.ok(texts.includes('曾是史莱姆的女孩'));assert.ok(live.length>100);assert.ok(!scene.steps.flatMap(s=>s.commands).some(c=>c.op==='raw'&&c.cmd==='map-missing'&&c.args==='81'));await writeFile(output+'/rpg-replay.json',JSON.stringify({scene,choice}));console.log('Map081 replay live steps',live.length)})
test('user custom IDs choose actual Twi/Remastered archive layouts; all adapters honor custom titles on import/reimport',{skip:!available},async()=>{
 const work=await mkdtemp(path.join(os.tmpdir(),'reported-import-')),twi=await twiSparse(path.join(work,'ツヴァイトリガー')),edo=JSON.parse(await readFile('.cache/next-native-fixtures/Remastered.json')).source,dataDir=path.join(work,'data');await mkdir(dataDir);await writeFile(path.join(dataDir,'gal-krkr-keys.json'),JSON.stringify([JSON.parse(await readFile('.cache/new-games-155817/analysis/twiv-key-candidate.json'))]))
 for(const[source,id,adapter]of[[twi,'krkr::zweitrigger','krkr::scn'],[edo,'edo::Remastered','edo::lua']]){const h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})}),title='用户指定 '+id,imp=await h.importFromSource({sourcePath:source,options:{adapters:[adapter],config:{game:{id,title}}}}),item=imp.items[0];assert.equal(item.title,title);const layout=await generateTags({item,script:{version:'2.59.0',options:{}}});assert.ok(layout.itemPatch,layout.logs.join('\n'));assert.equal(layout.itemPatch.gal.config.game.id,id);assert.ok(layout.itemPatch.gal.config.scriptRoots.every(r=>r.dir==='arc/script'||r.dir==='Archives/arc/script'));await h.patchItemMetadata(item.itemId,layout.itemPatch);const home=await h.getReaderContent(item.itemId,'main');assert.ok(home.node.items.length);assert.equal((await h.importFromSource({sourcePath:source,options:{adapters:[adapter],config:{game:{id,title:title+' new'}}}})).items[0].title,title+' new');console.log('native custom id imported',id,home.node.items.length)}
})
