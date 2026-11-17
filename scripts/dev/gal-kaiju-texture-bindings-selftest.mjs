// Verify original resource-path bindings without executing any game code.
import assert from'node:assert/strict'
import{UnityStore}from'../../web/library/gal/unity-store.mjs'
import{indexKaiju}from'../../web/library/gal/unity-kaiju.mjs'
const base=process.env.GAL_KAIJU_FIXTURE||'.cache/kaiju-20261117',store=await new UnityStore(base+'/source/Kaiju Princess 2_Data').init({extensionlessBundles:true}),objects=new Map(),api={store,cfg:{dir:'arc'},scripts:[],object:(name,o)=>{objects.set('arc/res/'+name,o);return'arc/res/'+name},add:name=>'arc/res/'+name}
await indexKaiju(api)
let count=0,mapped=0
for(const m of Object.values(api.context.models))for(const[page,src]of Object.entries(m.textureMap)){const info=m.textureBindings[page],d=await store.decode(objects.get(src));assert.ok(d.m_Width>2&&d.m_Height>2,'placeholder: '+m.name+' / '+page);assert.equal(info.name,d.m_Name);if(info.source==='native-table'){assert.equal(info.path.split('/').at(-1).toLowerCase(),d.m_Name.toLowerCase());mapped++}count++}
const actor=api.context.models[api.context.prefabs.spine0116];assert.equal(actor.textureBindings['Type-V_Stand_Lv3.png'].source,'native-table');assert.equal(actor.textureBindings['Type-V_Stand_Lv3.png'].path,'Spine/TypeV3_Stand/Type-V_Stand_Lv3');console.log('PASS original Kaiju metadata:',Object.keys(api.context.models).length,'models,',count,'real texture pages,',mapped,'native table bindings; no white placeholders')

if(process.env.KAIJU_VERIFY_TEXTURE_PIXELS==='1'){const{createRequire}=await import('node:module'),sharp=createRequire(new URL('../../web/package.json',import.meta.url))('sharp'),png=await store.media(objects.get(actor.textureMap['Type-V_Stand_Lv3.png']),{maxTextureSize:1024}),meta=await sharp(png).metadata(),stats=await sharp(png).stats();assert.ok(meta.width<=1024&&meta.height<=1024,'requested size bound also applies to native textures without mipmaps');assert.ok(stats.channels.some(c=>c.stdev>10),'real actor texture must contain color/detail rather than a white square');console.log('PASS real native actor texture pixels:',meta.width,meta.height)}

const place=api.context.prefabPlaces?.spine0116;assert.ok(place,'native standing-pose placement is required');assert.ok(Math.abs(place.scaleX-.5)<1e-6);assert.ok(Math.abs(place.scaleY-.5)<1e-6);assert.equal(place.y,-350);console.log('PASS native Type-V standing pose scale and offset')

const cg=api.context.models[api.context.prefabs.spine0307];assert.ok(Object.values(cg.textureBindings).every(b=>b.maxTextureSize===4096));assert.deepEqual(cg.frame,{x:-1376,y:-1122,w:2752,h:2244});assert.ok(Object.values(actor.textureBindings).every(b=>b.maxTextureSize>=2048));console.log('PASS original source CG frame and high-resolution texture policy')
