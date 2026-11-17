import assert from'node:assert/strict'
import fs from'node:fs/promises'
import{prepare,catalog,parse}from'../../web/library/gal/adapters/kaiju-script.mjs'
import{createKaijuState}from'../../web/static/gal-kaiju-state.js'
const base=process.env.GAL_KAIJU_FIXTURE||'.cache/kaiju-20261117',raw=await fs.readFile(base+'/context.json','utf8'),ctx=prepare({texts:{'arc/native.json':raw},options:{}}),scripts=JSON.parse(await fs.readFile(base+'/scripts.json')),tree=catalog(ctx)
assert.equal(tree.children[0].children.length,40);assert.equal(tree.children[1].children.length,3)
for(const entry of scripts.filter(s=>s.data.kind==='interaction')){
 const parsed=parse(JSON.stringify(entry.data),ctx),role=parsed.interaction.roles[0],config=role.model.kaiju,state=createKaijuState(config),id=role.tools[0].areas[0].id
 const nativeHair=config.clothing.find(r=>r.SkinID===config.pose+'_Hair_Long');for(const name of nativeHair.OpenSkinName.split(':'))assert.ok(state.frame().skins.includes(name),'native front/back hair part: '+config.pose+' / '+name);assert.ok(role.outfits.length>=6);assert.ok(role.model.initialCommands[0].skins.some(s=>s.includes('Stocking_Lv1')),'native leg/body skins assembled')
 const one=state.action(id);assert.ok(one.voiceId,'native level-zero voice');assert.ok(one.snapshot.values.M>0)
 state.seek('M',.6);const high=state.action(id);assert.equal(high.snapshot.meters.find(m=>m.id==='M').level,3);assert.notEqual(high.frame.emotion.SoundIDs,one.frame.emotion.SoundIDs,'original emotion rules change looping voice pool by stage');assert.ok(one.voiceId.includes('se91'),'native kiss short voice precedes the emotion loop')
 state.seek('M',.199);const crossing=state.action(id);assert.ok(crossing.crossings);assert.equal(crossing.snapshot.flags.climax,true)
 assert.ok(crossing.frame.spreads[1],'original action opens local cut-in')
 const before=crossing.snapshot.values.M;state.action(id);assert.ok(state.snapshot().values.M>before,'one-time seek does not freeze subsequent accumulation')
 state.action(id,false);assert.equal(state.frame().current,undefined)
 for(const tool of role.tools)for(const area of tool.areas){const output=createKaijuState(config).action(area.id);assert.ok(config.modelAnimations.includes(output.frame.anim),area.id+' animation exists')}
 const locked=createKaijuState(config);locked.seek('M',.199);locked.seek('Cum',1);locked.lock('M',true);locked.lock('Cum',true)
 const fixed=locked.snapshot().values;for(let i=0;i<20;i++){const r=locked.action(id);assert.equal(r.snapshot.values.M,fixed.M);assert.equal(r.snapshot.values.Cum,fixed.Cum);assert.equal(r.cum,false)}
 assert.ok(locked.snapshot().values.Smooth>0,'other unlocked meters still accumulate')
 locked.seek('M',.6);assert.equal(locked.snapshot().values.M,config.meters.find(m=>m.id==='M').max*.6)
 const restored=createKaijuState(config,locked.snapshot());assert.equal(restored.snapshot().locks.M,true);assert.equal(restored.action(id).snapshot.values.M,locked.snapshot().values.M)
 restored.lock('M',false);assert.ok(restored.action(id).snapshot.values.M>locked.snapshot().values.M)
 const cover=parse(JSON.stringify(entry.data),ctx,{scene:'cover'});assert.ok(!cover.interaction);assert.ok(cover.steps[0].commands.some(c=>c.op==='spine'))
}
const drama=parse(JSON.stringify(scripts.find(s=>s.data.id==='5011').data),ctx);assert.equal(drama.stats.messages,67);assert.equal(drama.stats.voices,38);assert.ok(drama.steps.some(s=>s.commands.some(c=>c.op==='spine'&&c.slot==='kaiju:cg')))
console.log('PASS Kaiju original tables: 40 specials, three poses, complete body skins, all declared action animations, native cut-ins, stage-driven voice changes, crossing flags, one-time seek and rendered covers')
