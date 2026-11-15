import assert from'node:assert/strict'
import{prepare,parse}from'../../web/library/gal/adapters/rpgmaker-json.mjs'
import{resolveLayout}from'../tag-scripts/gal-layout/main.js'
const say=text=>[{code:101,parameters:['',0,0,2]},{code:401,parameters:[text]}],common=[null,{id:1,name:'场景正文',list:[...say('Before'),{code:117,parameters:[2]},...say('After')]},{id:2,name:'睡到第二天',list:[...say('Gameplay'),...say('Next day')]}],files=['data/CommonEvents.json'],texts={'data/CommonEvents.json':JSON.stringify(common)}
const old=await prepare({options:{},texts,files}),full=parse('',old,{rel:files[0],scene:'common-1'});assert.equal(full.stats.text,4,'default keeps existing engine behavior')
const profile=resolveLayout('rpgmaker::RJ01234887').ruleOverrides['rpgmaker-json'],ctx=await prepare({options:profile,texts,files}),scene=parse('',ctx,{rel:files[0],scene:'common-1'});assert.equal(scene.stats.text,2);assert.equal(scene.stats.raw['common-event-skipped-by-config'],1);assert.ok(scene.steps.flatMap(s=>s.commands).some(c=>c.op==='raw'&&c.args.includes('睡到第二天')))
const catalog=ctx.catalogTree.children.find(n=>n.id==='common');assert.equal(catalog.children.length,1);assert.equal(catalog.children[0].subtitle,'2 文本行','gallery evidence excludes the configured gameplay helper too')
assert.equal(resolveLayout('rpgmaker::custom').ruleOverrides?.['rpgmaker-json']?.plugins?.skipCommonEventNames,undefined)
console.log('PASS configured gameplay helpers: native scene before/after retained, calls diagnosed, catalog counts consistent, existing RPG defaults unchanged')
