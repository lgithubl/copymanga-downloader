import {monoHeader} from './unity-io.mjs'
import {unityUtageBook,unityUtageChapter} from './unity-utage-data.mjs'
import {indexUnityCubism} from './unity-cubism.mjs'
export function utageRows(grid){const rows=grid.rows.filter(r=>!r.isEmpty&&!r.isCommentOut),head=rows.find(r=>r.strings.includes('Command'))?.strings;if(!head)return[];return rows.filter(r=>r.strings!==head).map(r=>({...Object.fromEntries(head.map((k,i)=>[k,r.strings[i]||'']).filter(([k])=>k)),source:r.rowIndex+1}))}
export function utageTables(chapter){const tables={};for(const g of chapter.settingList){const kind=g.name.split(':').at(-1),rows=g.rows.filter(r=>!r.isEmpty&&!r.isCommentOut),head=rows[0]?.strings||[];tables[kind]=rows.slice(1).map(r=>Object.fromEntries(head.map((k,i)=>[k,r.strings[i]||'']).filter(([k])=>k)))}return tables}
export async function indexUtage(api){
 const{store,object,scripts}=api,books=[],chapters=[]
 for(const file of store.files.keys())if(file.endsWith('.assets')){const a=await store.asset(file);for(const o of a.objects.filter(o=>o.classId===114)){const t=await store.type(o);if(t==='AdvImportBook')books.push(unityUtageBook(await store.data(o)));if(t==='AdvChapterData')chapters.push(unityUtageChapter(await store.data(o)))}}
 if(chapters.length!==1)throw Error('Utage native chapter absent or ambiguous')
 const tables=utageTables(chapters[0]),models=await indexUnityCubism(api),images=new Map(),sounds=new Map()
 for(const e of await store.resourcePaths()){
  if(e.object.classId===28)images.set(e.name,e)
  else if(e.object.classId===83)sounds.set(e.name,e)
 }
 const media={images:{},sounds:{}}
 for(const[name,e]of images)media.images[name]=object('Images/'+name+'.png',e.object)
 for(const[name,e]of sounds)media.sounds[name]=object('Audio/'+name+'.ogg',e.object)
 const grids=new Map(),bookEntries=[]
 for(const book of books){let first='';const ownGrids=[];for(const g of book.importGridList){const rows=utageRows(g),name=g.name.split(':').at(-1);if(!rows.length)continue;if(grids.has(name))throw Error('Duplicate Utage global scenario label: '+name);grids.set(name,rows);ownGrids.push(name);first ||=name}if(first&&!/^Debug/.test(book.name))bookEntries.push({book,first,ownGrids})}
 for(const{book,first,ownGrids}of bookEntries){
  const names=new Set(),visit=name=>{if(names.has(name)||!grids.has(name))return;names.add(name);for(const r of grids.get(name))if(['Jump','JumpSubroutine','Selection'].includes(r.Command)&&r.Arg1.startsWith('*')&&!r.Arg1.startsWith('**'))visit(r.Arg1.slice(1))};for(const name of ownGrids)visit(name)
  scripts.push({name:book.name+'.json',data:{format:'unity-utage/1',name:book.name,entry:first,ownGrids,grids:Object.fromEntries([...names].map(n=>[n,grids.get(n)]))}})
 }
 api.context={format:'unity-utage-context/1',tables,models,media,scenes:scripts.map(s=>({name:s.name,entry:s.data.entry,entries:s.data.ownGrids,script:api.cfg.dir+'/script/'+s.name}))}
}
