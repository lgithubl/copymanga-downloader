import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile}from'node:fs/promises'
import{generateTags,resolveLayout}from'../tag-scripts/gal-layout/main.js'
import{prepare}from'../../web/library/gal/adapters/rpgmaker-json.mjs'
const f=JSON.parse(await readFile('.cache/scene-audit-161/analysis/RJ01271506-fixture.json'))
const item=id=>({source:{path:f.source},adapters:['rpgmaker-json'],config:{game:{id,title:'我的标题'}}})
const layout=async i=>generateTags({item:i,script:{version:'2.64.4',options:{}}})
test('uppercase RPG Maker ID hits the same full profile through generateTags, preserving user ID and title',async()=>{
 const lower=await layout(item('rpgmaker::rj01271506')),upper=await layout(item('rpgmaker::RJ01271506')),a=lower.itemPatch.gal.config,b=upper.itemPatch.gal.config
 assert.deepEqual(b.adapterOptions,a.adapterOptions,'case variant must retain memory/TRN/DLC/Skit profile instead of generic defaults')
 assert.deepEqual(b.resourceRoots,a.resourceRoots);assert.equal(b.game.id,'rpgmaker::RJ01271506');assert.equal(b.game.title,'我的标题')
 const ctx=await prepare({options:{...b.adapterOptions['rpgmaker-json'],maps:{enabled:false}},files:f.files,texts:f.texts,mediaDir:f.source})
 assert.equal(ctx.memoryReplays.size,198);assert.equal(ctx.catalogTree.children.find(n=>n.id==='special').children.length,478)
})
test('known RPG case variants preserve their profiles; custom IDs and other families retain matching semantics',()=>{
 for(const id of['rj01271506','rj328940','rj01646655','rj01482469'])assert.deepEqual(resolveLayout('rpgmaker::'+id.toUpperCase()).ruleOverrides,resolveLayout('rpgmaker::'+id).ruleOverrides)
 assert.deepEqual(resolveLayout('rpgmaker::MY_RJ01271506_COPY').ruleOverrides,resolveLayout('rpgmaker').ruleOverrides)
 assert.deepEqual(resolveLayout('krkr::ZWEITRIGGER').ruleOverrides,resolveLayout('krkr').ruleOverrides)
 const entry=resolveLayout('rpgmaker::RJ01271506',{'rpgmaker::rj01271506':{searchDepth:1},'rpgmaker::RJ01271506':{searchDepth:2}})
 assert.equal(entry.searchDepth,2);assert.equal(entry.ruleOverrides['rpgmaker-json'].plugins.memoryReplay,true)
})
test('rerunning layout repairs the already-saved generic 2.64.3 config without changing the custom ID/title',async()=>{
 const old=await layout(item('rpgmaker::custom')),legacy=old.itemPatch.gal.config;legacy.game={id:'rpgmaker::RJ01271506',title:'我的标题'}
 assert.equal(legacy.adapterOptions['rpgmaker-json'].plugins.memoryReplay,false)
 const out=await layout({...item(legacy.game.id),config:legacy,tags:['Gal配置version: 2.64.3']})
 const c=out.itemPatch.gal.config;assert.equal(c.adapterOptions['rpgmaker-json'].plugins.memoryReplay,true);assert.equal(c.adapterOptions['rpgmaker-json'].plugins.trnVoice.enabled,true);assert.deepEqual(c.adapterOptions['rpgmaker-json'].extraDirs,['dlc/dlc_10000']);assert.deepEqual(c.game,legacy.game)
 assert.ok(out.logs.some(x=>x.includes('忽略大小写')));assert.ok(out.itemTags.includes('Gal配置version: 2.64.4'))
})
