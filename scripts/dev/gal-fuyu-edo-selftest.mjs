import{test}from'node:test'
import assert from'node:assert/strict'
import{existsSync}from'node:fs'
import{readFile,writeFile}from'node:fs/promises'
import path from'node:path'
import{decodeMes,silkyLzss}from'../../web/library/gal/silky.mjs'
import{readArcfamIndex}from'../../web/library/gal/arcfam.mjs'
import{readEdoIndex,edoPayload}from'../../web/library/gal/edo.mjs'
import{parse as silkyParse}from'../../web/library/gal/adapters/silky-mes.mjs'
import{runSilky}from'../../web/library/gal/silky-vm.mjs'
import{parse as edoParse}from'../../web/library/gal/adapters/edo-ikunyu.mjs'
import{activePath,stateAt,activeCommandsAt}from'../../web/static/gal-engine.js'
import{generateTags}from'../tag-scripts/gal-layout/main.js'
import{normalizeGalConfigWithWarnings}from'../../web/library/gal/config.mjs'
import{ensureContainers}from'../../web/library/gal/containers.mjs'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{makeFuyuEdoFixture}from'./make-fuyu-edo-fixture.mjs'
const captured=existsSync('.cache/fuyu-edo-media/extracted/g02/__pair_media/index.json')
test('MES rejects malformed lengths/opcodes and truncated LZSS instead of silently parsing',()=>{
 assert.throws(()=>silkyLzss(Buffer.from([1]),1),/truncated/)
 const op=Buffer.alloc(9);op[8]=0x99;assert.throws(()=>decodeMes(op,'bad'),/bad @0 unsupported opcode 0x99/)
 const bad=Buffer.alloc(8);bad.writeUInt32LE(100);assert.throws(()=>decodeMes(bad),/offset table/)
})
test('all actual 59 MES decode, 50 story scripts execute; all three native choices cover both branches',{skip:!captured},async()=>{
 const raw=await readFile('.cache/fuyu-edo-detail/extracted/g01/script.arc'),idx=await readArcfamIndex('.cache/fuyu-edo-detail/extracted/g01/script.arc');let lib;const scripts=[]
 for(const e of idx.entries){const b=raw.subarray(e.offset,e.offset+e.size),d=decodeMes(e.size===e.origSize?b:silkyLzss(b,e.origSize),e.name.replace(/\.(MES|LIB)$/i,''));scripts.push(d);if(e.name==='LIBLARY.LIB')lib=d}assert.equal(scripts.length,59)
 let count=0,choices=0;for(const d of scripts.filter(d=>/^FK[0-9_]/.test(d.name))){const r=runSilky(d,lib);for(const e of r.events)for(const c of e.commands)if(c.op==='raw'){const issue=JSON.parse(c.args);assert.equal(issue.script,d.name);assert.ok(Number.isInteger(issue.offset));assert.ok(Number.isInteger(issue.message))};if(r.pending){choices++;assert.deepEqual(r.pending.options.map(x=>x.value),[1,2]);const scene=silkyParse(JSON.stringify(d),{library:lib}),choice=scene.steps.flatMap(s=>s.commands).find(c=>c.op==='choice');for(const option of r.pending.options){const branch=runSilky(d,lib,{decisions:[option.value]});assert.equal(branch.pending,null);assert.ok(branch.events.length);const expected={FK004:['fk004a','fk004b'],FK012:['fk012a','fk012b'],FK028:['fk029','fk029']}[d.name][option.value-1];assert.equal(branch.next,expected);const links=scene.steps.flatMap((_,i)=>activeCommandsAt(scene,i,{[choice.id]:option.value})).filter(c=>c.op==='goto').map(c=>c.script);assert.deepEqual(links.length?links:[scene.next?.script],[expected])}}count++}assert.equal(count,50);assert.equal(choices,3)
 const r=runSilky(scripts.find(d=>d.name==='FK001'),lib);assert.match(r.events.flatMap(e=>e.commands).find(c=>c.op==='text').segments[0].text,/私はキミに電波を発しています/)
})
test('all 348 Edoire narrative scripts retain all 25,368 authored text calls',{skip:!captured},async()=>{
 let scripts=0,messages=0;const raw={}
 const file='.cache/fuyu-edo-detail/extracted/g02/Archives/ver00_s0.arc',index=await readEdoIndex(file),bytes=await readFile(file);for(const entry of index.entries){if(entry.kind!=='script'||!entry.name.startsWith('src/game/'))continue;const text=edoPayload(bytes.subarray(entry.offset,entry.offset+entry.size),{text:true});if(!/\btext\(/.test(text))continue;const result=edoParse(JSON.stringify({format:'edo-lua/1',name:entry.name,text}));scripts++;messages+=result.stats.messages;for(const[k,v]of Object.entries(result.stats.raw))raw[k]=(raw[k]||0)+v}
 assert.equal(scripts,348);assert.equal(messages,25368);assert.deepEqual(Object.keys(raw).sort(),['Shake','allstop_shake','lua-unhandled'].sort())
})
test('actual imports -> user title -> layout -> canonical/special lists -> lazy media and scene state',{skip:!captured},async()=>{
 const fixture=await makeFuyuEdoFixture();const evidence=[]
 for(const[gid,id,adapter,script,firstImage,firstVoice]of[['g01','silky::fuyukuru','silky::mes','FK001','BG21.png','VK0145A.OGG'],['g02','edo::ikunyu','edo::ikunyu','day01m','img/bg/bg91def.png','ogg/voice/w000001mb.ogg']]){
  const media=fixture.roots[gid],title='用户标题-'+gid,patch=await generateTags({item:{itemId:gid,source:{path:media},title:'目录名',adapters:[adapter],config:{game:{id,title}}},script:{version:'2.64.8',options:{}}}),raw=patch.itemPatch?.gal?.config;assert.ok(raw,patch.logs.join('\n'));assert.equal(raw.game.title,title);assert.equal(raw.scriptCount,gid==='g01'?50:348)
  const{config,warnings}=normalizeGalConfigWithWarnings(raw);assert.deepEqual(warnings,[]);await writeFile(path.resolve('.cache/fuyu-edo-fixtures/config-'+gid+'.json'),JSON.stringify(config))
  const expanded=await ensureContainers({mediaDir:media,config});assert.ok(!expanded.error,JSON.stringify(expanded));assert.equal(Object.values(expanded.arcs).reduce((n,x)=>n+(x.scripts||0),0),gid==='g01'?58:384);assert.ok(!Object.values(expanded.arcs).some(x=>x.bad?.length),JSON.stringify(expanded))
  const h=createGalHandler({dataDir:path.resolve('.cache/fuyu-edo-app-data',gid),safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:media}}})})
  const imp=await h.importFromSource({sourcePath:media,options:{adapters:[adapter],config}});const item=imp.items?.[0]||imp.item;assert.ok(item?.itemId,JSON.stringify(imp.report))
  const home=await h.getReaderContent(item.itemId,'main');const special=home.node.items.find(x=>x.title==='特殊场景'),story=home.node.items.find(x=>x.title==='剧情');assert.ok(special);assert.ok(story)
  const cards=await h.getReaderContent(item.itemId,'main',{sectionId:story.node});const card=cards.node.items.find(x=>x.title===script);assert.ok(card,JSON.stringify(cards.node.items.map(x=>x.title)));console.log('Opening actual card',gid,card.node,config.scriptExtensions);const content=await h.getReaderContent(item.itemId,'main',{sectionId:card.node});assert.ok(content.scene?.steps?.length);assert.deepEqual(content.scene.stats.raw,{})
  const paths=activePath(content.scene);assert.ok(paths.length>(gid==='g01'?100:35));const states=paths.map(i=>stateAt(content.scene,i));assert.ok(states.some(s=>s.bg?.src?.toLowerCase().endsWith(firstImage.toLowerCase())||s.overlays?.some(o=>o.src?.toLowerCase().endsWith(firstImage.toLowerCase()))));assert.ok(content.scene.steps.some(s=>s.commands.some(c=>c.op==='voice'&&c.src.toLowerCase().endsWith(firstVoice.toLowerCase()))))
  const image=await h.getResource(item.itemId,firstImage),bytes=await readFile(image.file);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');const voice=await h.getResource(item.itemId,firstVoice);assert.equal((await readFile(voice.file)).subarray(0,4).toString(),'OggS')
  const sc=await h.getReaderContent(item.itemId,'main',{sectionId:special.node});assert.ok(sc.node.items.length>=9);assert.equal(sc.node.total,gid==='g01'?9:119);if(gid==='g02'){const last=await h.getReaderContent(item.itemId,'main',{sectionId:special.node.replace(/#\d+$/,'')+'#2'});assert.equal(last.node.items.length,19)}assert.ok(sc.node.viewRules||sc.viewRules)
  evidence.push({gid,id,adapter,itemId:item.itemId,sceneNode:card.node,steps:content.scene.steps.length,specialCount:sc.node.total});await writeFile(path.join(media,'verified-scene.json'),JSON.stringify(content.scene));if(gid==='g01'){const continuation=await h.getReaderContent(item.itemId,'main',{sectionId:'s:script/FK004A.smes'});assert.equal(continuation.scene.stats.raw['actor-face-without-body'],undefined);const first=stateAt(continuation.scene,activePath(continuation.scene)[0]);assert.ok(first.bg?.src);assert.ok(first.overlays.some(o=>o.slot==='silky:actor:0:body'));const branch=await h.getReaderContent(item.itemId,'main',{sectionId:'s:script/FK004.smes'});const links=branch.scene.steps.flatMap(s=>s.commands).filter(c=>c.op==='goto');assert.deepEqual(links.map(c=>c.script).sort(),['fk004a','fk004b']);assert.ok(links.every(c=>c.node));await writeFile('.cache/fuyu-edo-fixtures/fuyu-continuation.json',JSON.stringify(continuation.scene));const native=await h.getReaderContent(item.itemId,'main',{sectionId:'s:script/FK003.smes'}),at=activePath(native.scene).find(i=>stateAt(native.scene,i).overlays.some(o=>o.slot?.includes('actor:'))),st=stateAt(native.scene,at);assert.equal(at,191);const componentScene={format:'gal-scene/1',adapter:'silky::mes',steps:[{commands:[{op:'bg',src:st.bg.src},...st.overlays.map(o=>({op:'overlay',...o})),{op:'text',segments:st.text}]}]};await writeFile('.cache/fuyu-edo-fixtures/fuyu-actor-state.json',JSON.stringify({at,componentScene}))}if(gid==='g02'){const cg=await h.getReaderContent(item.itemId,'main',{sectionId:'s:ver00_s0/src/game/scma03h.edo'});await writeFile(path.join(media,'verified-cg-scene.json'),JSON.stringify(cg.scene))}
 }
 await writeFile('.cache/fuyu-edo-fixtures/verification.json',JSON.stringify(evidence,null,2));console.log('Actual import evidence',evidence)
})
