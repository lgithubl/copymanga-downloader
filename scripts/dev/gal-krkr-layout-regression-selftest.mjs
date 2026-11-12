import{test}from'node:test'
import assert from'node:assert/strict'
import{mkdtemp,mkdir,writeFile,readFile}from'node:fs/promises'
import path from'node:path'
import os from'node:os'
import{generateTags}from'../tag-scripts/gal-layout/main.js'
import{buildHxv4Xp3,buildPsb,makeBundle}from'./make-krkr-fixture.mjs'
import{ensureContainers,setKeysFile}from'../../web/library/gal/containers.mjs'
import{normalizeGalConfig}from'../../web/library/gal/config.mjs'
test('legacy scn layout wins even with all Twi archive names; custom IDs and stale misidentified IDs recover actual scripts',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'krkr-layout-regression-')),bundle=makeBundle('legacy-layout'),keys=path.join(dir,'keys.json');await writeFile(keys,JSON.stringify([bundle]));setKeysFile(keys)
 const root={name:'legacy.txt',scenes:[{label:'*start',title:'',nexts:[],lines:[['startline','name','A','text',1],1],texts:[['A',[[null,'Legacy dialogue survives',20]],null,192,{data:[]}]]}]}
 for(const name of['scn','data','fgimage','evimage'])await writeFile(path.join(dir,name+'.xp3'),buildHxv4Xp3([['/',name==='scn'?'legacy.txt.scn':'resource.bin',name==='scn'?buildPsb(root):Buffer.from('resource only')]],bundle))
 for(const id of[null,'krkr::old-game','krkr::twiv']){
  const item={source:{path:dir},title:'Old game',adapters:['krkr::scn'],config:id?{game:{id}}:{},itemId:'legacy'},out=await generateTags({item,script:{version:'test',options:{}}}),cfg=out.itemPatch?.gal?.config
  assert.ok(cfg,out.logs.join('\n'));assert.equal(cfg.adapterOptions['krkr::scn'].followGraph,false);assert.ok(cfg.containers.rules.some(r=>new RegExp(r.match).test('scn.xp3')&&r.kinds.includes('script')));assert.ok(!cfg.containers.rules.some(r=>new RegExp(r.match).test('data.xp3')&&r.kinds.includes('script')));assert.notEqual(cfg.game.id,'krkr::twiv')
  const report=await ensureContainers({mediaDir:dir,config:normalizeGalConfig(cfg)});assert.equal(report.arcs['./scn.xp3'].scripts,1);const decoded=JSON.parse(await readFile(path.join(dir,'arc/script/scn/legacy.krkr')));assert.ok(decoded.scenes[0].steps.some(s=>s.t.includes('Legacy dialogue survives')))
 }
 console.log('Legacy configuration, matching archive collision, stale-ID repair and real Hxv4 script extraction passed; retained:',dir)
})
