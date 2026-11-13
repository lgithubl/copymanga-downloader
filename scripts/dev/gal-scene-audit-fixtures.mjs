// Assemble local fixtures from verified collections; originals are never modified.
import{cp,readdir,mkdir,readFile,mkdtemp}from'node:fs/promises'
import path from'node:path'
import os from'node:os'
export const sceneAuditRoot='.cache/scene-audit-161/161723/extracted'
export async function auditRpgFixture(id){
 const g=id==='RJ01271506'?'g01':'g03',fresh=id==='RJ01271506'?'g01':'g02',prefix=g==='g03'?'www/':'',work=await mkdtemp(path.join(os.tmpdir(),'audit-rpg-')),source=path.join(work,id)
 await cp('.cache/new-games-043952/extracted/'+g,source,{recursive:true});await cp('.cache/new-games-052443/extracted/'+g,source,{recursive:true});if(g==='g01')await cp('.cache/followup-083838/extracted/g02',source,{recursive:true})
 await cp('.cache/new-games-043202/extracted/'+g+'/'+prefix+'js/plugins.js',source+'/'+prefix+'js/plugins.js')
 for(const entry of await readdir(sceneAuditRoot+'/'+fresh,{withFileTypes:true})){if(entry.name.startsWith('__'))continue;await cp(sceneAuditRoot+'/'+fresh+'/'+entry.name,source+'/'+entry.name,{recursive:true})}
 await cp(sceneAuditRoot+'/'+fresh+'/__scene-audit/event-maps/'+(prefix||'data'),source+'/'+(prefix||'data'),{recursive:true})
 const files=[];async function walk(dir,rel){for(const e of await readdir(dir,{withFileTypes:true})){const child=path.posix.join(rel,e.name);if(e.isDirectory())await walk(path.join(dir,e.name),child);else files.push(child)}}
 for(const dir of['data','img','audio','js','dlc']){try{await walk(path.join(source,prefix,dir),prefix+dir)}catch(e){if(e.code!=='ENOENT')throw e}}
 const texts={};for(const rel of['data/CommonEvents.json','data/System.json','data/Actors.json','data/MapInfos.json','data/Tilesets.json','js/plugins.js','audio/voice/voice_list.json']){try{texts[prefix+rel]=await readFile(path.join(source,prefix,rel),'utf8')}catch(e){if(e.code!=='ENOENT')throw e}}
 return{work,source,files,texts,root:prefix.replace(/\/$/,''),audit:JSON.parse(await readFile(sceneAuditRoot+'/'+fresh+'/__scene-audit/index.json'))}
}
