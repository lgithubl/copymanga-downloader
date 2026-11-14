import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile}from'node:fs/promises'
import{prepare,parse}from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{resolveLayout}from'../tag-scripts/gal-layout/main.js'
import{activePath,stateAt,initialState,condMet,applyCommand}from'../../web/static/gal-engine.js'
const f=JSON.parse(await readFile('.cache/scene-audit-161/analysis/RJ01271506-fixture.json'))
const options={...resolveLayout('rpgmaker::rj01271506').ruleOverrides['rpgmaker-json'],root:f.root,maps:{enabled:false}}
const ctx=await prepare({options,files:f.files,texts:f.texts,mediaDir:f.source})
const special=ctx.catalogTree.children.find(n=>n.id==='special')
test('native recollection menus expose individual authored routes even without a CG',()=>{
 const entries=special.children.filter(n=>/-replay-/.test(n.script));assert.equal(entries.length,198)
 assert.ok(entries.some(n=>n.script.startsWith('data/Map052.json::event-46-2-replay-')&&n.title.includes('与她的相遇')))
})
test('native memory entrance continues across quest pages with real standing and declared voices',()=>{
 const n=special.children.find(n=>n.script.startsWith('data/Map052.json::event-46-2-replay-')&&n.title.includes('照料花朵'));assert.ok(n)
 const[rel,scene]=n.script.split('::'),out=parse('',ctx,{rel,scene}),choices=Object.fromEntries(out.steps.flatMap(s=>s.commands).filter(c=>c.op==='choice').map(c=>[c.id,c.options[0].value])),live=activePath(out,choices),states=live.map(i=>stateAt(out,i,choices)),texts=states.map(s=>s.text.map(x=>x.text).join(''))
 const active=initialState(),voices=[];for(const step of out.steps)for(const c of step.commands)if(condMet(c.when,active.vars)){if(c.op==='voice')voices.push(c.src);applyCommand(active,c,choices)}
 assert.ok(voices.some(src=>src.endsWith('/6719.ogg')))
 assert.ok(states.some(s=>s.overlays.some(o=>o.src?.includes('/bisty/'))),'actual heroine standing survives the entrance')
 assert.ok(texts.filter(Boolean).length>30,'quest pages continue rather than stopping at the menu or first page')
 assert.ok(!out.stats.raw['map-autorun-ambiguous']);assert.ok(!out.stats.raw['memory-route-unresolved'])
 console.log('Native memory route',n.title,'active steps',live.length,'text states',texts.filter(Boolean).length)
})
test('all 198 authored routes compile and their default choices avoid missing dispatches and cycles',()=>{
 const entries=special.children.filter(n=>/-replay-/.test(n.script));let voiced=0,short=0
 for(const n of entries){const[rel,scene]=n.script.split('::'),out=parse('',ctx,{rel,scene}),choices=Object.fromEntries(out.steps.flatMap(s=>s.commands).filter(c=>c.op==='choice').map(c=>[c.id,c.options[0].value])),state=initialState();let voices=0,text=0
  for(const step of out.steps)for(const c of step.commands)if(condMet(c.when,state.vars)){
   assert.ok(c.op!=='raw'||!['memory-route-unresolved','memory-map-cycle','common-event-cycle-or-depth'].includes(c.cmd),n.title+': '+c.cmd+' '+c.args)
   if(c.op==='voice')voices++;if(c.op==='text')text++;applyCommand(state,c,choices)
  }
  if(voices)voiced++;if(text<5)short++
 }
 assert.equal(voiced,105);assert.equal(short,55);console.log('Native authored replay audit:',entries.length,'routes;',voiced,'with declared voice;',short,'short/summary routes')
})
