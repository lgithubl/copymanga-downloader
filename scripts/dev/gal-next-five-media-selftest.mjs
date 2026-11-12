// Optional real1.56 evidence. Source fixtures stay read-only; app cache is separate.
import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile,readdir,mkdtemp,cp,mkdir,writeFile,open}from'node:fs/promises'
import{existsSync}from'node:fs'
import{createHash}from'node:crypto'
import path from'node:path'
import os from'node:os'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags}from'../tag-scripts/gal-layout/main.js'
import{prepare,parse}from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{decodeAgeScript,decodeAgeImage}from'../../web/library/gal/age.mjs'
import{edoPayload}from'../../web/library/gal/edo.mjs'
import{prepare as edoPrepare,parse as edoParse}from'../../web/library/gal/adapters/edo-lua.mjs'
import{stateAt}from'../../web/static/gal-engine.js'
const old='.cache/new-games-043952/extracted',probe='.cache/new-games-043202/extracted',media='.cache/new-games-052443/extracted'
async function walk(root,rel=''){const out=[];for(const e of await readdir(path.join(root,rel),{withFileTypes:true})){const p=path.posix.join(rel,e.name);if(e.isDirectory())out.push(...await walk(root,p));else out.push(p)}return out}
for(const[gid,id]of[['g01','RJ01271506'],['g02','RJ01646655'],['g03','RJ328940']])test(id+': every native sampled PNG/Ogg through actual resource and thumbnail endpoints',{skip:!existsSync(media+'/'+gid)},async()=>{
 const work=await mkdtemp(path.join(os.tmpdir(),'next-native-rpg-')),source=path.join(work,id),prefix=gid==='g03'?'www/':'';await cp(old+'/'+gid,source,{recursive:true});await cp(media+'/'+gid,source,{recursive:true});await cp(probe+'/'+gid+'/'+prefix+'js/plugins.js',source+'/'+prefix+'js/plugins.js');const h=createGalHandler({dataDir:path.join(work,'data'),safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})}),imp=await h.importFromSource({sourcePath:source,options:{adapters:['rpgmaker-json']}}),item=imp.items[0],layout=await generateTags({item,script:{version:'2.58.0',options:{}}});assert.equal(layout.itemPatch.gal.config.game.id,'rpgmaker::'+id.toLowerCase());await h.patchItemMetadata(item.itemId,layout.itemPatch);const report=JSON.parse(await readFile(media+'/'+gid+'/__verify/index.json')),resources=report.files.filter(e=>/\.(?:png|png_|rpgmvp|ogg|ogg_|rpgmvo)$/i.test(e.artifact)),results=[];
 for(const e of resources){const rel=e.artifact.replace(/^www\//,'').replace(/\.(?:png_|rpgmvp)$/i,'.png').replace(/\.(?:ogg_|rpgmvo)$/i,'.ogg'),before=await readFile(source+'/'+e.artifact),resource=await h.getResource(item.itemId,rel),b=await readFile(resource.file);if(rel.endsWith('.png')){assert.ok(b.subarray(0,8).toString('hex')==='89504e470d0a1a0a'||b.toString('ascii',8,12)==='WEBP');const thumb=await h.getResource(item.itemId,rel,{width:64});assert.equal(thumb.contentType,'image/webp')}else assert.equal(b.toString('ascii',0,4),'OggS');assert.deepEqual(await readFile(source+'/'+e.artifact),before);results.push({path:rel,file:resource.file,sha256:createHash('sha256').update(b).digest('hex')})}
 if(gid==='g01'){
  const files=await walk(source),texts={};for(const rel of ['data/System.json','data/CommonEvents.json','data/Actors.json','data/MapInfos.json','data/Tilesets.json','js/plugins.js'])texts[rel]=await readFile(source+'/'+rel,'utf8');const ctx=await prepare({options:layout.itemPatch.gal.config.adapterOptions['rpgmaker-json'],texts,files,mediaDir:source}),actor=ctx.skit.actors.get('filo');assert.equal(Object.keys(actor.frames.frames).length,20);assert.deepEqual(actor.sizes.get('normal'),[750,1050]);
  const c=(action,args)=>({code:357,parameters:['thirop/TRP_SkitMZ',action,'',args]}),common=[null,{id:1,name:'native face',list:[c('fadeIn',{name:'filo',position:'5'}),c('expression',{name:'filo',expression:'smile'}),{code:101,parameters:['',0,0,2,'']},{code:401,parameters:['native expression']}]}];ctx.common=common;const scene=parse('',ctx,{rel:'data/CommonEvents.json',scene:'common-1'}),state=stateAt(scene,0),face=state.overlays.find(x=>x.slot==='rpg-skit-face:filo');assert.ok(face);assert.deepEqual(face.crop,Object.values(actor.frames.frames.normal_smile.frame));assert.ok(!scene.stats.raw['skit-atlas-metadata-missing']);await writeFile(path.join(work,'native-scene.json'),JSON.stringify(scene));
 }
 if(gid==='g03'){const home=await h.getReaderContent(item.itemId,'main');assert.ok(home.node.items.some(x=>x.title==='特殊场景'));}
 assert.ok(results.length>=4);await writeFile(path.join(work,'media-results.json'),JSON.stringify(results,null,2));await mkdir('.cache/next-native-fixtures',{recursive:true});await writeFile('.cache/next-native-fixtures/'+id+'.json',JSON.stringify({work,source,itemId:item.itemId}));console.log(id,'actual native resources',results.length,'retained',work)
})

test('Remastered: complete formal scripts plus every sampled native media through import/resource endpoints',{skip:!existsSync(media+'/g04')},async()=>{
 const work=await mkdtemp(path.join(os.tmpdir(),'next-native-edo-')),source=path.join(work,'Remastered');await mkdir(source);
 for(const [dir,reportFile,sourceKey]of[[old+'/g04','__next/index.json','path'],[media+'/g04','__verify/index.json','source']]){
  const report=JSON.parse(await readFile(dir+'/'+reportFile));for(const e of report.files){const target=path.join(source,e[sourceKey]);await mkdir(path.dirname(target),{recursive:true});const f=await open(target,existsSync(target)?'r+':'w');try{await f.truncate(e.sourceBytes);const b=await readFile(dir+'/'+e.artifact);await f.write(b,0,b.length,e.offset)}finally{await f.close()}}
 }
 const report=JSON.parse(await readFile(media+'/g04/__verify/index.json'));let formal=0;
 for(const e of report.files.filter(e=>e.logicalName?.endsWith('.txt'))){const text=edoPayload(await readFile(media+'/g04/'+e.artifact),{text:true});if(!/^src\/game\/sc/i.test(e.logicalName))continue;const scene=edoParse(JSON.stringify({format:'edo-lua/1',name:e.logicalName,text}),edoPrepare({options:{coordinates:'canvas',stage:[1600,900]}}));assert.ok(scene.steps.length,e.logicalName);formal++}assert.ok(formal>250);
 const h=createGalHandler({dataDir:path.join(work,'data'),safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:source}}})}),imp=await h.importFromSource({sourcePath:source,options:{adapters:['edo::lua']}}),item=imp.items[0],layout=await generateTags({item,script:{version:'2.58.0',options:{}}});await h.patchItemMetadata(item.itemId,layout.itemPatch);assert.equal(layout.itemPatch.gal.config.game.id,'edo::parente');
 const home=await h.getReaderContent(item.itemId,'main');assert.ok(home.node.items.some(x=>x.title==='特殊场景'));const results=[];
 for(const e of report.files.filter(e=>e.logicalName&&!e.logicalName.endsWith('.txt'))){let rel=e.logicalName.replace(/\.bytes$/,'.png').replace(/^!app01\//,'ogg/append/');const res=await h.getResource(item.itemId,rel),b=await readFile(res.file);assert.equal(b.subarray(0,4).toString('hex'),rel.endsWith('.ogg')?'4f676753':'89504e47');if(rel.endsWith('.png'))assert.equal((await h.getResource(item.itemId,rel,{width:64})).contentType,'image/webp');results.push({path:rel,file:res.file})}
 await writeFile(path.join(work,'media-results.json'),JSON.stringify(results));await mkdir('.cache/next-native-fixtures',{recursive:true});await writeFile('.cache/next-native-fixtures/Remastered.json',JSON.stringify({work,source,itemId:item.itemId}));console.log('Remastered formal scripts',formal,'native media',results.length,'retained',work)
})

test('AGE native initialization scripts and bounded AGF resources decode without executing the game',{skip:!existsSync(media+'/g05')},async()=>{
 for(const name of['SYSTEM4','SCINIT','CVINIT','SCJUMP']){const r=decodeAgeScript(await readFile(media+'/g05/__verify/age/'+name+'.BIN'));assert.ok(r.instructions.length>100)}
 for(const name of['SO008A','SO008B']){const bytes=await readFile(media+'/g05/__verify/age/'+name+'.AGF'),r=decodeAgeImage(bytes);assert.deepEqual([r.width,r.height],[1600,31]);assert.equal(r.rgba.length,1600*31*4);assert.throws(()=>decodeAgeImage(bytes.subarray(0,100)),/bounds|truncated/);const wrong=Buffer.from(bytes);wrong.writeUInt32LE(0x7fffffff,12);assert.throws(()=>decodeAgeImage(wrong),/bounds/)}
})

test('native Remastered set2 preserves moved geometry and color, while set resets the default position',()=>{
 const text='set(C1,"a.png")\nsetp(C1,500,700)\nsetcolor(C1,"00000080")\ntext("first")\nset2(C1,"b.png")\ntext("second")\nset(C1,"c.png")\ntext("third")',scene=edoParse(JSON.stringify({format:'edo-lua/1',text}),edoPrepare({options:{coordinates:'canvas',stage:[1600,900]}}));const first=stateAt(scene,0).overlays[0],second=stateAt(scene,1).overlays[0],third=stateAt(scene,2).overlays[0];assert.equal(first.x,-300);assert.equal(first.y,250);assert.equal(second.x,first.x);assert.equal(second.y,first.y);assert.deepEqual(second.tint,[0,0,0]);assert.equal(second.alpha,128/255);assert.ok(second.src.endsWith('b.png'));assert.equal(third.x,0);assert.equal(third.y,450)
})
