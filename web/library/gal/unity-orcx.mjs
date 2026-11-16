import {readTextObject} from './unity-io.mjs'
// AssetBundle containers provide exact original names. Sprite and Texture2D
// entries share names; prefer Sprite so native crop/pivot metadata is retained.
export async function indexOrcx(api){
 const {store,scripts,object}=api,assets={},locations=new Map(),scenes=[]
 const language=api.cfg.language||'sc';if(!['sc','ja','en','ko','tc'].includes(language))throw Error('OrcX unsupported scenario language: '+language)
 const keys=[...store.files.keys()].filter(k=>/^(?:common|main)\/(?:common|main)dynamic_assets_(?:scenario_(?:sc|ja|en|ko|tc)|sprites[12]?|sounds)\.bundle$/.test(k)).sort()
 const addMedia=(name,o)=>{const old=locations.get(name);if(old){if(old.classId===o.classId)throw Error('OrcX ambiguous resource: '+name);if(old.classId===213)return}locations.set(name,o)}
 for(const key of keys){const scenario=/_scenario_/.test(key);if(scenario&&!key.endsWith('_'+language+'.bundle'))continue
  const pack=key.split('/')[0],b=await store.bundle(key)
  for(const a of b.assets){
   if(scenario){for(const o of a.objects.filter(o=>o.classId===49)){const d=readTextObject(await store.data(o)),bytes=d.bytes,text=bytes[0]===255&&bytes[1]===254?bytes.subarray(2).toString('utf16le'):bytes.toString('utf8').replace(/^\uFEFF/,'');if(!/^\*start/m.test(text))throw Error('OrcX scenario header absent: '+d.name);scripts.push({name:d.name+'.orcx',data:{format:'orcx-script/1',name:d.name,pack,text}});scenes.push({name:d.name,pack,script:api.cfg.dir+'/script/'+d.name+'.orcx'})}continue}
   for(const o of a.objects.filter(o=>o.classId===142)){const d=await store.decode(o);for(const row of d.m_Container){const name=row.first;if(!/\.(?:png|jpe?g|ogg|wav)$/i.test(name))continue;const target=await store.ptr(a,row.second.asset);if([28,83,213].includes(target?.classId))addMedia(pack+'/'+name,target)}}
  }
 }
 for(const[name,o]of locations){const audio=o.classId===83;assets[name]=object((audio?'Audio/':'Images/')+name.replace(/\.[^.]+$/,audio?'.ogg':'.png'),o)}
 api.context={format:'orcx-context/1',assets,language,scenes:scenes.sort((a,b)=>a.name.localeCompare(b.name))}
}
