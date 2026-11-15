// Optional real source audit. Point environment variables at collected metadata,
// its original inventory and the read-only media snapshot. Never runs game JS.
import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {readFile,readdir} from 'node:fs/promises'
import path from 'node:path'
import {prepare,parse} from '../../web/library/gal/adapters/rpgmaker-json.mjs'
import {resolveLayout} from '../tag-scripts/gal-layout/main.js'
import {activePath,activeCommandsAt,stateAt} from '../../web/static/gal-engine.js'
const base='.cache/four-new-games-20261115',metadata=process.env.GAL_KOAKUMA_METADATA||base+'/round3/extracted/g03/__packed/files',listing=process.env.GAL_KOAKUMA_LISTING||base+'/round1/extracted/g03/__listing.tsv',assets=process.env.GAL_KOAKUMA_ASSETS||base+'/packed'
if(!existsSync(metadata)||!existsSync(listing)){console.log('SKIP Koakuma real audit: set GAL_KOAKUMA_METADATA, GAL_KOAKUMA_LISTING and GAL_KOAKUMA_ASSETS')}
else{
 const original=(await readFile(listing,'utf8')).split('\n').slice(1).map(l=>l.split('\t')[0]).filter(Boolean),files=[...new Set([...original,...(await readdir(metadata+'/data')).map(f=>'data/'+f),'js/plugins.js'])],texts={}
 for(const rel of['data/System.json','data/Actors.json','data/CommonEvents.json','data/MapInfos.json','data/Tilesets.json','js/plugins.js'])texts[rel]=await readFile(metadata+'/'+rel,'utf8')
 const ctx=await prepare({options:resolveLayout('rpgmaker::RJ01319586').ruleOverrides['rpgmaker-json'],texts,files,mediaDir:path.resolve(metadata),assetDir:path.resolve(assets)}),native=ctx.koakumaAnimation
 assert.equal(native.families.size,8);assert.ok(!ctx.warnings.some(w=>/Koakuma.*(?:incomplete|missing|unmapped)/i.test(w)),ctx.warnings.join('\n'))
 const allFrames=new Set(original.filter(p=>/\/HCG_anime\/\d+_\d+_\d+\.png_$/i.test(p)).map(p=>p.replace(/_$/,'').toLowerCase())),used=new Set()
 for(const family of native.families.values()){
  const scene=parse('',ctx,{rel:'data/CommonEvents.json',scene:'koakuma-animation-'+family.id});assert.equal(scene.steps.length,25)
  for(const step of scene.steps)for(const c of step.commands)for(const src of[c.src,...(c.animation?.frames||[]).map(f=>f.src)].filter(Boolean))if(src.includes('/HCG_anime/')){assert.ok(allFrames.has(src.toLowerCase()),src);used.add(src.toLowerCase())}
 }
 assert.equal(used.size,6480);assert.deepEqual(used,allFrames,'no native actor or background frame omitted')
 let callers=0
 for(const event of ctx.common.filter(e=>e?.list?.some(c=>c.code===122&&c.parameters[0]===400&&c.parameters[3]===0&&native.byMission.has(c.parameters[4])))){
  const scene=parse('',ctx,{rel:'data/CommonEvents.json',scene:'common-'+event.id});assert.ok(scene.steps.length);callers++
 }
 assert.equal(callers,9)
 const normal=parse('',ctx,{rel:'data/CommonEvents.json',scene:'common-1138'}),step=activePath(normal).find(i=>activeCommandsAt(normal,i).some(c=>c.animation));assert.ok(Number.isInteger(step));const state=stateAt(normal,step);assert.equal(state.black,false);assert.equal(state.overlays.find(o=>o.slot==='rpg-picture-51').alpha,0);assert.ok(state.overlays.some(o=>o.animation&&o.src.includes('0025_01_')))
 console.log('PASS real Koakuma: 8 families / 200 action modes / all6480 native frames, 9 native caller scripts and reachable unoccluded original story animation')
}
