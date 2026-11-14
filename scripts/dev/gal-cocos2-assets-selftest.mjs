import{test}from'node:test'
import assert from'node:assert/strict'
import{readFile,readdir}from'node:fs/promises'
import{existsSync}from'node:fs'
import{cocosUuid,cocosJsonAsset,cocosBundleAssets}from'../../web/library/gal/cocos2-assets.mjs'
const base='.cache/meshiagirl/probe/extracted/g01/__meshi_probe/files/resource/webdata/d2m562cev3ue8x.cloudfront.net/1/bin/assets/adventure'
test('Cocos UUID and paths reject malformed metadata',()=>{assert.equal(cocosUuid('00BJ6wl01B3bq+LM4toZEl'),'00049eb0-974d-41dd-babe-2cce2da19125');assert.throws(()=>cocosUuid('../../unsafe'));assert.throws(()=>cocosBundleAssets({types:[],uuids:[],paths:{0:['../escape',0]}}));assert.throws(()=>cocosJsonAsset('[1,2]'))})
test('real Cocos bundles identify exactly1459 native scenario JsonAssets',{skip:!existsSync(base)},async()=>{const c=JSON.parse(await readFile(base+'/config.a215a.json')),entries=cocosBundleAssets(c,'assets/adventure'),scenes=entries.filter(x=>x.type==='cc.JsonAsset');assert.equal(scenes.length,1459);assert.equal(scenes[0].import,'assets/adventure/import/00/00049eb0-974d-41dd-babe-2cce2da19125.92067.json');for(const name of await readdir(base+'/import/00')){const text=await readFile(base+'/import/00/'+name,'utf8');if(text.includes('cc.JsonAsset')){const d=cocosJsonAsset(text);assert.ok(d.name);assert.ok(Array.isArray(d.json.tokenData));assert.ok(Array.isArray(d.json.loadData))}else assert.throws(()=>cocosJsonAsset(text))}})
