import{test}from'node:test'
import assert from'node:assert/strict'
import{mkdtemp,mkdir,readFile,writeFile,open,readdir}from'node:fs/promises'
import{existsSync}from'node:fs'
import path from'node:path'
import os from'node:os'
import{parse}from'../../web/library/gal/adapters/edo-lua.mjs'
import{activePath,stateAt,choicesForCommand}from'../../web/static/gal-engine.js'
import{readEdoIndex,edoPayload}from'../../web/library/gal/edo.mjs'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags}from'../tag-scripts/gal-layout/main.js'
import{readUnityFS}from'../../web/library/gal/unity-bundle.mjs'
const scene=text=>parse(JSON.stringify({format:'edo-lua/1',name:'src/game/test',text}))
const texts=(s,c={})=>activePath(s,c).map(i=>stateAt(s,i,c).text.map(x=>x.text).join('')).filter(Boolean)
test('Lua choices follow labels without reading unselected branches; marker reconstructs choice',()=>{
 const s=scene('item={}\nitem[1]="A"\nitem[2]="B"\nsel("",item)\nr=get_sel_result()\nif r==1 then goto a end\ngoto b\n::a::\ntext("A")\ngoto finish\n::b::\ntext("B")\n::finish::\ntext("end")\nend')
 const first=s.steps[0].commands.find(c=>c.op==='choice');assert.ok(first);assert.deepEqual(texts(s),[])
 assert.deepEqual(texts(s,{[first.id]:1}),['A','end']);assert.deepEqual(texts(s,{[first.id]:2}),['B','end'])
 const i=s.steps.findIndex(s=>s.commands.some(c=>c.op==='text'&&c.segments[0].text==='B')),k=s.steps[i].commands.findIndex(c=>c.op==='text');assert.deepEqual(choicesForCommand(s,i,k),{[first.id]:2})
})
test('Lua if/elseif/else, loops and partial BG geometry preserve state',()=>{
 for(const [v,want]of[[1,'a'],[2,'b'],[3,'c']]){const s=scene(`x=${v}\nif x==1 then\ntext("a")\nelseif x==2 then\ntext("b")\nelse\ntext("c")\nend\ntext("end")\nend`);assert.deepEqual(texts(s),[want,'end'])}
 const s=scene('x=0\nwhile x<2 do\nx=x+1\ntext("loop")\nend\nsets(BG,1.5,1.5)\nsetp(BG,-300,-400)\ntext("done")\nend');assert.deepEqual(texts(s),['loop','loop','done']);const st=stateAt(s,s.steps.length-1);assert.deepEqual(st.bgZoom,{scale:1.5,x:-200,y:-400*720/1080})
})
const root='.cache/new-games-162126/extracted/g02',old='.cache/new-games-085514/extracted/g03'
test('real141 Lua scripts decode and compile with bounded graph',{skip:!existsSync(root)},async()=>{const items=JSON.parse(await readFile(root+'/__remaining/index.json','utf8')).files.filter(x=>x.name?.startsWith('/src/'));let count=0,messages=0;for(const x of items){const text=edoPayload(await readFile(root+'/'+x.artifact),{text:true}),s=scene(text);assert.ok(s.steps.length);count++;messages+=s.stats.messages}assert.equal(count,141);assert.ok(messages>24000)})
test('actual ARCH000 imports scripts and lazily reads PNG/Vorbis through application',{skip:!existsSync(root)},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'edo-real-app-')),media=path.join(dir,'シロクロv1.1'),archives=path.join(media,'Archives');await mkdir(archives,{recursive:true})
 const report=JSON.parse(await readFile(root+'/__remaining/index.json','utf8')),prev=JSON.parse(await readFile(old+'/__followup/index.json','utf8'))
 for(const n of[0,1]){const name=`base_div${n}_archive.arc`,idx=prev.files.find(x=>x.artifact===`__followup/unity/${name}.index.bin`);assert.ok(idx);const f=await open(path.join(archives,name),'w');try{await f.truncate(idx.sourceBytes);await f.write(Buffer.from('@ARCH000'),0,8,0);const b=await readFile(old+'/'+idx.artifact);await f.write(b,0,b.length,idx.offset);const tail=Buffer.alloc(8);tail.writeBigUInt64LE(BigInt(idx.offset));await f.write(tail,0,8,idx.sourceBytes-8);for(const x of report.files.filter(x=>x.source.endsWith('/'+name))){const b=await readFile(root+'/'+x.artifact);await f.write(b,0,b.length,x.offset)}if(n===1){const rows=JSON.parse(await readFile('.cache/new-games-155817/analysis/'+name+'.index.bin.json','utf8')),e=rows.find(x=>x.dir.startsWith('/ogg/'));const b=await readFile(old+`/__followup/unity/${name}.first.bundle`);assert.equal(e.size,b.length);await f.write(b,0,b.length,e.offset)}}finally{await f.close()}}
 const idx=await readEdoIndex(path.join(archives,'base_div0_archive.arc'));assert.equal(idx.entries.length,1513)
 const h=createGalHandler({dataDir:path.join(dir,'data'),safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:media}}})}),imp=await h.importFromSource({sourcePath:media,options:{adapters:['edo::lua']}}),item=imp.items[0];assert.ok(item);const layout=await generateTags({item,script:{version:'2.55.0',options:{}}});assert.equal(layout.itemPatch.gal.config.containers.format,'edo');await h.patchItemMetadata(item.itemId,layout.itemPatch)
 const home=await h.getReaderContent(item.itemId,'main');assert.ok(home.node.items.length);const story=home.node.items.find(x=>x.title==='剧情'),cards=await h.getReaderContent(item.itemId,'main',{sectionId:story.node});assert.ok(cards.node.items.length>50);const first=cards.node.items.find(x=>x.title.includes('00_導入'));assert.ok(first);const reader=await h.getReaderContent(item.itemId,'main',{sectionId:first.node});assert.equal(reader.scene.adapter,'edo::lua');assert.ok(reader.scene.stats.messages>800);assert.ok(reader.scene.steps.flatMap(x=>x.commands).some(c=>c.op==='bg'&&c.src.includes('view_001')));console.log('Edo imported cards',home.node.items.map(x=>x.title));
 const image=await h.getResource(item.itemId,'img/bg/black.png');assert.equal((await readFile(image.file)).subarray(0,8).toString('hex'),'89504e470d0a1a0a')
 const rows=JSON.parse(await readFile('.cache/new-games-155817/analysis/base_div1_archive.arc.index.bin.json','utf8')),voice=rows.find(x=>x.dir.startsWith('/ogg/')),sound=await h.getResource(item.itemId,voice.dir.replace(/^\//,'')+'/'+voice.name);assert.equal((await readFile(sound.file)).toString('ascii',0,4),'OggS')
 console.log('Edo actual app retained:',dir)
})

test('phone text preserves literal icon speaker and static movement accumulates',()=>{const s=scene('seticon("黒")\ntextl("left")\ntextr("right")\nsetEx2(1,"body.png","face.png","non.png",1,100,20)\nsetmsEx(1,0.2,30,40)\ntext("done")\nend');assert.equal(stateAt(s,0).speaker[0].text,'黒');assert.equal(stateAt(s,1).speaker[0].text,'我');const state=stateAt(s,s.steps.length-1);assert.equal(state.overlays.find(x=>x.slot==='edo:C1').x,130);assert.equal(state.overlays.find(x=>x.slot==='edo:C1').y,60)})
