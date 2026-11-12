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
  assert.ok(cfg,out.logs.join('\n'));assert.equal(cfg.adapterOptions['krkr::scn'].followGraph,false);assert.ok(cfg.containers.rules.some(r=>new RegExp(r.match).test('scn.xp3')&&r.kinds.includes('script')));assert.ok(!cfg.containers.rules.some(r=>new RegExp(r.match).test('data.xp3')&&r.kinds.includes('script')));assert.notEqual(cfg.game.id,'krkr::twiv');if(id==='krkr::old-game')assert.ok(out.logs.some(l=>l.includes('按家族「krkr」')))
  const report=await ensureContainers({mediaDir:dir,config:normalizeGalConfig(cfg)});assert.equal(report.arcs['./scn.xp3'].scripts,1);const decoded=JSON.parse(await readFile(path.join(dir,'arc/script/scn/legacy.krkr')));assert.ok(decoded.scenes[0].steps.some(s=>s.t.includes('Legacy dialogue survives')))
 }
 await mkdir(path.join(dir,'Pac'));await mkdir(path.join(dir,'data/Script'),{recursive:true});const pac=Buffer.alloc(16);Buffer.from([0x82,0xcf,0x82,0xad]).copy(pac);pac.writeBigUInt64LE(16n,8);await writeFile(path.join(dir,'Pac/Game.pac'),pac);await writeFile(path.join(dir,'data/Script/demo.txt'),'#MSG\nA\nDemo\n#END');await mkdir(path.join(dir,'Archives'));for(const n of[0,1])await writeFile(path.join(dir,`Archives/base_div${n}_archive.arc`),'@ARCH000')
 for(const adapters of[undefined,['krkr::scn']]){const out=await generateTags({item:{source:{path:dir},config:{},...(adapters?{adapters}:{})},script:{options:{}}});assert.equal(out.details.kind,'krkr','new PAC/Edo probes must not steal a previously recognized legacy game');assert.equal(out.itemPatch.gal.config.adapterOptions['krkr::scn'].followGraph,false)}
 console.log('Legacy configuration, matching archive collision, stale-ID repair and real Hxv4 script extraction passed; retained:',dir)
})
