// Assemble the actual collected native files; projections remain explicitly
// identified and are only used for uncollected map event context.
import{readFile,writeFile,mkdir,mkdtemp,cp,readdir,symlink}from'node:fs/promises'
import{existsSync}from'node:fs'
import{createHash}from'node:crypto'
import path from'node:path'
import os from'node:os'
import{createGalHandler}from'../../web/library/types/gal.mjs'
import{generateTags}from'../tag-scripts/gal-layout/main.js'
export async function playbackFixtures(){
 const work=await mkdtemp(path.join(os.tmpdir(),'gal-playback-native-')),games=path.join(work,'games'),dataDir=path.join(work,'data'),fresh='.cache/playback-164/172227/extracted',fixtures=[];await mkdir(games);await mkdir(dataDir)
 await cp('.cache/new-games-033525/export/gal-krkr-keys-twiv.json',path.join(dataDir,'gal-krkr-keys.json'))
 const h=createGalHandler({dataDir,safeSegment:String,pathExists:async p=>existsSync(p),getConfig:()=>({mediaImportProfiles:{'gal-import':{rootDir:games}}})})
 for(const[id,gid,adapter,gameId]of[['RJ01271506','g01','rpgmaker-json','rpgmaker::rj01271506'],['RJ328940','g02','rpgmaker-json','rpgmaker::rj328940'],['ツヴァイトリガー','g03','krkr::scn','krkr::zweitrigger']]){
  const source=path.join(games,id),report=JSON.parse(await readFile(fresh+'/'+gid+'/__playback/index.json'));await mkdir(source)
  if(id.startsWith('RJ')){const old=JSON.parse(await readFile('.cache/scene-audit-161/analysis/'+id+'-fixture.json'));await cp(old.source,source,{recursive:true})}
  else{const old=JSON.parse(await readFile('.cache/scene-audit-161/analysis/twi-source.json'));for(const name of await readdir(old.source))if(name.endsWith('.xp3'))await symlink(path.join(old.source,name),path.join(source,name))}
  for(const row of report.files){const bytes=await readFile(fresh+'/'+gid+'/'+row.artifact);if(createHash('sha256').update(bytes).digest('hex')!==row.sha256||bytes.length!==row.bytes)throw Error('Native evidence SHA mismatch: '+row.artifact)
   if(!row.source)continue
   if(row.artifact===row.source||row.projection){const dest=path.join(source,...row.source.split('/'));await mkdir(path.dirname(dest),{recursive:true});await writeFile(dest,bytes)}
  }
  const item=(await h.importFromSource({sourcePath:source,options:{adapters:[adapter],config:{game:{id:gameId}}}})).items[0],out=await generateTags({item,script:{version:'2.63.0',options:{}}});if(!out.itemPatch)throw Error(out.logs.join('\n'));await h.patchItemMetadata(item.itemId,out.itemPatch)
  fixtures.push({id,source,adapter,gameId,itemId:item.itemId,config:out.itemPatch.gal.config,nativeFullMaps:report.files.filter(r=>r.artifact===r.source&&/Map\d+\.json$/i.test(r.source||'')).map(r=>r.source)})
 }
 const result={work,dataDir,fixtures};await writeFile('.cache/playback-164/fixtures.json',JSON.stringify(result));return{...result,h}
}
if(process.argv[1]?.endsWith('gal-playback-fixtures.mjs')){const{work,fixtures}=await playbackFixtures();console.log('Native imported fixtures retained:',work,fixtures.map(f=>({id:f.id,itemId:f.itemId,scriptRoots:f.config.scriptRoots})))}
