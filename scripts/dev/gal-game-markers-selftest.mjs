import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { LAYOUTS, generateTags } from '../tag-scripts/gal-layout/main.js'
import { computeMarkers } from '../../web/library/gal/markers.mjs'
import { initialState, applyCommand, stateAt, adjacentSceneMarker } from '../../web/static/gal-engine.js'
import * as artemis from '../../web/library/gal/adapters/artemis-ast.mjs'
import * as tomoe from '../../web/library/gal/adapters/tomoe-arc04.mjs'
import { decodeArc, parseDrawImageKeys, parseSoundTable, splitChapters } from '../../web/library/gal/tomoe.mjs'
import { archiveToTmp } from '../tag-scripts/gal-download/archive.mjs'
const compile = rules => rules.map(r => ({ ...r, re: r.match ? new RegExp(r.match, 'i') : null }))
const artemisRules = LAYOUTS.artemis.sceneMarkersByArchive['yugamase.pfs']

test('yugamase layout adds jump buttons without changing other Artemis games or explicit marker overrides', async () => {
  const root = await mkdtemp('/tmp/gal-marker-layout-')
  try {
    const run = async (name, options = {}) => {
      const dir = path.join(root, name); await mkdir(dir); await writeFile(path.join(dir, name+'.pfs'), 'pf8')
      return generateTags({ item: { source: { path: dir }, adapters: ['artemis::ast'], config: { game: { id: 'artemis::'+name } } }, script: { id: 'gal-layout', version: '2.48.0', options } })
    }
    assert.deepEqual((await run('yugamase')).itemPatch.gal.config.sceneMarkers, artemisRules)
    assert.equal((await run('other')).itemPatch.gal.config.sceneMarkers, undefined)
    const dir = path.join(root,'yugamase')
    const custom = [{label:'custom',kind:'cmd',op:'bgmStop',pick:'first',max:1}]
    const out = await generateTags({ item: { source: { path: dir }, adapters: ['artemis::ast'], config: { game: { id: 'artemis::yugamase' } } }, script: { id:'gal-layout', version:'2.48.0', options:{ layouts:{artemis:{config:{sceneMarkers:custom}}} } } })
    assert.deepEqual(out.itemPatch.gal.config.sceneMarkers, custom)
  } finally { await archiveToTmp(root) }
})

function checkJumpState(scene, markers) {
  const continuous = initialState()
  const byStep = new Set(markers.map(m => m.step))
  for (let i=0;i<scene.steps.length;i++) {
    for(const command of scene.steps[i].commands) applyCommand(continuous,command)
    if(byStep.has(i)) assert.deepEqual(stateAt(scene,i),continuous,`seek state at ${i}`)
  }
}
const troot='.cache/tomoe-analysis/core/g14/'
test('real Tomoe opening: card rules locate background voice and later music changes, with seek state restored', {skip:!existsSync(troot+'Arc04.dat')},()=>{
  const script=readFileSync(troot+'Arc04.dat'),index=decodeArc(readFileSync(troot+'Arc01.dat')),keys=parseDrawImageKeys(index,script),files=keys.map((_,i)=>`arc/res/img/native/${i}.png`),counters={j:0,k:0,u:0}
  for(const snd of parseSoundTable(decodeArc(readFileSync(troot+'Arc03.dat'))))if(counters[snd.type]!==undefined)files.push(`arc/res/snd/${({j:'voice',k:'se',u:'bgm'})[snd.type]}/${counters[snd.type]++}.ogg`)
  const ctx=tomoe.prepare({files,toResourcePath:r=>r.replace(/^arc\/res\//,'')})
  const chapter=splitChapters(script,{indexTable:index}).chapters[0],events=chapter.scenes[0].events
  const scene=tomoe.parse(JSON.stringify({format:'tomoe-arc04/1',imageDir:'img/native',events}),ctx),markers=computeMarkers(scene,compile(LAYOUTS.tomoe.config.sceneMarkers))
  assert.equal(markers.find(m=>m.label==='背景人声开始').step,67)
  assert.ok(markers.some(m=>m.step===211&&m.label.startsWith('BGM 切换')))
  assert.ok(markers.some(m=>m.step===216&&m.label==='BGM 停止'))
  assert.ok(stateAt(scene,67).bgse)
  checkJumpState(scene,markers)
})

const aroot='.cache/gal-marker-samples/yugamase/g13/'
test('real yugamase scripts expose CG, movie and music markers using their archive resource names', {skip:!existsSync(aroot+'decoded/01_共通_03.ast')},()=>{
  const files=[]
  for(const name of readdirSync(aroot).filter(n=>n.endsWith('__pf8index'))){const b=readFileSync(aroot+name);let p=11;for(let i=0;i<b.readUInt32LE(7);i++){const n=b.readUInt32LE(p);p+=4;const rel=b.toString('utf8',p,p+n).replaceAll('\\','/');p+=n+12;files.push('arc/res/'+rel);if(rel.endsWith('.ogv'))files.push('arc/res/'+rel.slice(0,-4)+'.mp4')}}
  const ctx=artemis.prepare({files,toResourcePath:r=>r.replace(/^arc\/res\//,'')})
  let total=0,withButtons=0,movieMarkers=0
  for(const name of readdirSync(aroot+'decoded').filter(n=>n.endsWith('.ast'))){const scene=artemis.parse(readFileSync(aroot+'decoded/'+name,'utf8'),ctx),markers=computeMarkers(scene,compile(artemisRules));total++;if(markers.length)withButtons++;movieMarkers+=markers.filter(m=>m.label==='视频开始').length
    assert.ok(markers.length<=12)
    if(name==='01_共通_03.ast'){assert.equal(markers.find(m=>m.label==='CG 开始').step,96);checkJumpState(scene,markers)}
  }
  assert.equal(total,83);assert.equal(withButtons,50);assert.ok(movieMarkers>0)
})

test('previous/next markers are strict, sorted, handle boundaries and absent markers',()=>{
 const markers=[{step:8,label:'B'},{step:2,label:'A'}]
 assert.equal(adjacentSceneMarker(markers,0,-1),null)
 assert.equal(adjacentSceneMarker(markers,0,1).step,2)
 assert.equal(adjacentSceneMarker(markers,2,-1),null)
 assert.equal(adjacentSceneMarker(markers,2,1).step,8)
 assert.equal(adjacentSceneMarker(markers,8,-1).step,2)
 assert.equal(adjacentSceneMarker(markers,8,1),null)
 assert.equal(adjacentSceneMarker(markers,9,-1).step,8)
 assert.equal(adjacentSceneMarker([],0,1),null)
})
test('BGI, arcfam and AdvHD layouts declare generic card markers',()=>{
 const scene={steps:Array.from({length:10},(_,index)=>({index,commands:[{op:'text',segments:[{text:String(index)}]}]}))}
 scene.steps[2].commands.unshift({op:'overlay',src:'EV_01.png'})
 scene.steps[3].commands.unshift({op:'bg',src:'EV_01.png'})
 scene.steps[4].commands.unshift({op:'bgm',src:'track.ogg'})
 scene.steps[5].commands.unshift({op:'bgmStop'})
 for(const id of ['bgi','arcfam','advhd']){
  const markers=computeMarkers(scene,compile(LAYOUTS[id].config.sceneMarkers))
  assert.ok(markers.some(m=>m.step===4),id)
  assert.ok(markers.some(m=>m.step===(id==='bgi'?2:3)),id)
  assert.ok(markers.some(m=>m.step===5),id)
 }
})
