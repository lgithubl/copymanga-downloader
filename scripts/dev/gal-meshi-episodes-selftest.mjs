import{test}from'node:test'
import assert from'node:assert/strict'
import{mergeMeshiEpisodes,groupMeshiEpisodes}from'../../web/library/gal/meshiagirl-episodes.mjs'
import{runMeshi}from'../../web/library/gal/meshiagirl-vm.mjs'
test('native parts keep scoped asset IDs and labels, do not lose orphan suffixes',()=>{
 const card=(name)=>({name:'json/'+name,import:name+'.json'}),groups=groupMeshiEpisodes(['1001003_dekoEP_H','1001003_dekoEP_H2','1001003_dekoEP_H3','1001003_dekoEP_N','solo_charaEP_H2'].map(card));assert.equal(groups.length,3);assert.deepEqual(groups.find(g=>g.name==='1001003_dekoEP_H').parts.map(p=>p.name.split('/').at(-1)),['1001003_dekoEP_H','1001003_dekoEP_H2','1001003_dekoEP_H3']);assert.ok(groups.some(g=>g.name==='solo_charaEP_H2'))
 const parts=['前篇','主体','后篇'].map((name,i)=>({name,json:{loadData:[{type:1,id:1,name:'bg'+i}],tokenData:[{type:1,commandIdx:1,params:['bg',0,'bg',1]},{type:1,commandIdx:2,params:['bg',0,1]},{type:1,commandIdx:0,params:[]},{type:2,label:'s1'},{type:0,textType:0,name:'A',message:name},{type:1,commandIdx:15,params:[]}]}}));const d=mergeMeshiEpisodes(parts),r=runMeshi(d,{assets:new Map([0,1,2].map(i=>['spriteBgCommon:bg'+i,{src:'bg'+i+'.png'}]))});const pages=r.events.filter(e=>e.commands.some(c=>c.op==='text'));assert.equal(pages.length,3);assert.deepEqual(pages.map(e=>e.commands.find(c=>c.op==='overlay').src),['bg0.png','bg1.png','bg2.png']);assert.deepEqual(d.json.tokenData.filter(t=>t.type===2&&!t.part).map(t=>t.label),['part0:s1','part1:s1','part2:s1'])
})
