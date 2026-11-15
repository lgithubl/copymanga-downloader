import{readFile,stat}from'node:fs/promises'
import path from'node:path'
import{createHash}from'node:crypto'
import{parsePlist,atlasFrames}from'../../../static/gal-atlas.js'
import{createOptionsReader,cleanDir}from'./options-merge.mjs'
export const ADAPTER_ID='djibril-json'
export const DEFAULT_OPTIONS={root:'',stage:[1280,720],maxCommands:200000}
const optionsOf=createOptionsReader(DEFAULT_OPTIONS),join=(...parts)=>parts.filter(Boolean).join('/'),json=s=>JSON.parse(String(s).replace(/^\uFEFF/,'')),tables=['Bg','Bgm','Character','Se','Effect']
export const contextFiles=o=>[...tables.map(n=>'res/json/adv/common/'+n+'.json'),'list.json'].map(p=>join(cleanDir(o?.root),p))
export const contextDirs=o=>['res/pc','res/json/adv/script','序章/res/json/adv'].map(p=>join(cleanDir(o?.root),p))
export const contextTextFilter=()=>()=>false
export function sniff(text){const head=String(text).trim().slice(0,8192);return head.startsWith('[')&&/"command"\s*:\s*"(?:Block|Bg|Character|Title)"/.test(head)&&/"resorce_id"|"title_option"/.test(head)}
export async function prepare({options,texts={},files=[],toResourcePath=x=>x,mediaDir,truncated}){
 const o=optionsOf(options),root=cleanDir(o.root),ctx={options:o,characters:new Map(),backgrounds:new Map(),bgms:new Map(),sounds:new Map(),files:new Map(files.map(f=>[f.toLowerCase(),toResourcePath(f)])),scenes:[],warnings:[]}
 if(truncated)throw Error('Djibril resource index truncated; increase walkFiles before importing')
 for(const name of tables){const rel=join(root,'res/json/adv/common/'+name+'.json');if(!texts[rel])throw Error('Djibril table missing: '+rel);const rows=json(texts[rel]);if(!Array.isArray(rows))throw Error('Djibril table must be an array: '+rel)
  for(const row of rows){const id=Number(row.resorce_id);if(!Number.isFinite(id))continue;if(name==='Character'){if(!ctx.characters.has(id))ctx.characters.set(id,{...row,bodies:new Map()});const c=ctx.characters.get(id);if(row.type==='body')c.bodies.set(Number(row.body),row)}else if(name==='Bg')ctx.backgrounds.set(id,row);else if(name==='Bgm')ctx.bgms.set(id,row);else if(name==='Se')ctx.sounds.set(id,row)}
 }
 ctx.placements=new Map();if(mediaDir)for(const[id,c]of ctx.characters)for(const[n,body]of c.bodies){const rel=join(root,'res/pc/character/'+c.character_id+'/'+body.file+'.plist');try{const info=await stat(path.join(mediaDir,rel));if(info.size>4*1024*1024)throw Error('Djibril atlas exceeds4MiB');const frame=atlasFrames(parsePlist(await readFile(path.join(mediaDir,rel),'utf8'))).frames.get('chara_'+id+'_body_'+String(n).padStart(2,'0')+'.png');if(frame)ctx.placements.set(id+':'+n,[-frame.offset[0],frame.offset[1]+frame.size[1]/2-320])}catch(e){if(e.code!=='ENOENT')throw e}}
 ctx.resource=rel=>ctx.files.get(join(root,rel).toLowerCase())||''
 const listed=files.filter(f=>f.startsWith(join(root,'res/json/adv/script')+'/')&&/\.json$/i.test(f)||f.startsWith(join(root,'序章/res/json/adv/script')+'/')&&/\.json$/i.test(f));let cursor=0;const records=Array(listed.length)
 await Promise.all(Array.from({length:8},async()=>{for(;;){const i=cursor++;if(i>=listed.length)return;const rel=listed[i];if(!mediaDir)continue;const info=await stat(path.join(mediaDir,rel));if(info.size>4*1024*1024)throw Error('Djibril script exceeds4MiB: '+rel);const source=await readFile(path.join(mediaDir,rel),'utf8'),commands=flatten(json(source),o.maxCommands),title=commands.find(c=>c.command==='Title')?.title_option||{},id=Number(path.basename(rel,'.json')),actorId=Math.floor((id-20000000)/10),actor=ctx.characters.get(actorId),prologue=/(?:^|\/)序章\//.test(rel)||actor?.name==='序章',special=commands.some(c=>c.command==='Bg'&&ctx.backgrounds.get(Number(c.resorce_id))?.type==='still'),character=actor?.name||title.sub_text||'',icon=actor?ctx.resource('res/pc/character/'+actor.character_id+'/thum.png'):'',part=id%10,thumb=actor?ctx.resource('res/pc/images/thum/episode/character/'+actor.character_id+'/chr_'+actorId+'_0'+part+'_thum.png'):'';records[i]={fingerprint:createHash('sha256').update(source).digest('hex'),id:rel,script:rel,title:title.main_text||path.basename(rel,'.json'),character,actorId,icon,prologue,special,...(thumb?{thumb}:{}),viewName:path.basename(rel,'.json')}}}))
 const seenIntro=new Set();ctx.scenes=records.filter(Boolean).sort((a,b)=>Number(/(?:^|\/)序章\//.test(a.script))-Number(/(?:^|\/)序章\//.test(b.script))).filter(s=>{if(!s.prologue)return true;if(seenIntro.has(s.fingerprint))return false;seenIntro.add(s.fingerprint);return true});ctx.catalogTree=buildCatalog(ctx);return ctx
}
function buildCatalog(ctx){
 const roles=new Map(),specials=[],main=[],other=[],all=[]
 for(const s of ctx.scenes){const card={id:s.id,script:s.script,title:s.title,...(s.thumb?{thumb:s.thumb}:{}),viewName:s.viewName};all.push(card)
  if(s.prologue){main.push(card);continue}if(!s.character){other.push(card);continue}
  if(!roles.has(s.character))roles.set(s.character,{id:'character/'+s.character,title:s.character,costumes:new Map(),...(s.icon?{thumb:s.icon}:{})});const role=roles.get(s.character),key=String(s.actorId)
  if(!role.costumes.has(key))role.costumes.set(key,{id:'costume/'+key,title:(s.actorId%100===0?'通常衣装':'衣装')+' · '+key,...(s.icon?{thumb:s.icon}:{}),children:[]})
  role.costumes.get(key).children.push(card);if(s.special)specials.push({...card,id:'special/'+s.id,subtitle:s.character+' · '+s.actorId})
 }
 const sort=xs=>xs.sort((a,b)=>a.title.localeCompare(b.title,'ja',{numeric:true})),characters=sort([...roles.values()].map(({costumes,...role})=>({...role,children:[...costumes.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(c=>({...c,children:sort(c.children)}))})))
 return{title:'電脳天使ジブリール',children:[{id:'characters',title:'角色',children:characters},{id:'special',title:'特殊场景',children:sort(specials)},{id:'main',title:'主线 / 序章',children:sort(main)},{id:'other',title:'其他 / 未归类',children:sort(other)},{id:'all',title:'全部剧情',children:sort(all)}]}
}
export const catalog=ctx=>ctx.catalogTree
function flatten(rows,max,depth=0,out=[]){if(!Array.isArray(rows)||depth>16)throw Error('Djibril invalid command block');for(const c of rows){if(!c||typeof c.command!=='string')throw Error('Djibril malformed command');if(c.command==='Block')flatten(c.list,max,depth+1,out);else out.push(c);if(out.length>max)throw Error('Djibril command limit exceeded')}return out}
const segments=s=>[{text:String(s??'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/?(?:color|size|b|i)(?:=[^>]*)?>/gi,'')}]
export function parse(text,ctx,meta={}){
 if(!ctx)throw Error('Djibril context missing; run gal-layout')
 const commands=flatten(json(text),ctx.options.maxCommands),steps=[],stats={messages:0,voices:0,raw:{},unresolved:{}},actors=new Map(),stage=ctx.options.stage;let pending=[],bg=null
 const emit=(...cs)=>pending.push(...cs),flush=()=>{if(pending.length){steps.push({index:steps.length,commands:pending});pending=[]}},raw=(c,why=c.command)=>{stats.raw[why]=(stats.raw[why]||0)+1;emit({op:'raw',cmd:why,args:[meta.rel,c.command_id,c]})},resource=(rel,c)=>{const src=ctx.resource(rel);if(!src){stats.unresolved[rel]=(stats.unresolved[rel]||0)+1;raw(c,'missing:'+rel)}return src}
 for(const c of commands){const type=c.command,option=c.command_option,id=Number(c.resorce_id),seconds=Math.max(0,Number(c.command_time)||0)
  if(type==='Title'){emit({op:'label',name:'djibril-title:'+c.title_option?.main_text});continue}
  if(type==='Text'){
   if(option==='Off'){emit({op:'ui',visible:false});continue}if(!c.text_option){raw(c);continue}
   const t=c.text_option;emit({op:'voiceStop'},{op:'ui',visible:true},{op:'speaker',segments:segments(t.character_name==='<res>'?'主人公':t.character_name)},{op:'text',segments:segments(t.character_text)})
   if(t.voice){const actor=ctx.characters.get(id),src=actor?resource('res/pc/character/'+actor.character_id+'/voice/'+t.voice+'.mp3',c):'';if(src){emit({op:'voice',src});stats.voices++}else if(!actor)raw(c,'voice-character-missing:'+id)}stats.messages++;flush();continue
  }
  if(type==='Bg'){
   if(option==='Off'){bg=null;emit({op:'overlayOff',slot:'djibril-bg'});continue}
   const row=ctx.backgrounds.get(id),p=c.bg_option||{};if(!row){raw(c,'background-id-missing:'+id);continue}
   const src=resource('res/pc/bg/'+(row.type==='still'?'still/'+row.character_id:'adv')+'/'+row.file+'.png',c);if(!src)continue
   const previous=option!=='On'&&bg?.src===src?bg:{},pick=(key,field,fallback)=>p[key]===null||p[key]===undefined?previous[field]??fallback:Number(p[key]);
   bg={op:'overlay',slot:'djibril-bg',src,kind:row.type==='still'?'still':'background',cg:row.type==='still',under:row.type!=='still',fit:'contain',stage,anchor:[.5,.5],x:pick('position_x','x',0),y:p.position_y===null||p.position_y===undefined?previous.y??0:-Number(p.position_y),scaleX:pick('scale','scaleX',1),scaleY:pick('scale','scaleY',1),z:-1000,fade:seconds};emit(bg);continue
  }
  if(type==='Character'){
   // The supplied viewer treats an empty Character option as its clear sentinel.
   if(option==='OffAll'||option==null){actors.clear();emit({op:'standOff'});continue}if(option==='Off'){actors.delete(id);emit({op:'standOff',slot:'djibril:'+id});continue}
   if(!['On','Move','Zoom'].includes(option)){raw(c);continue}const row=ctx.characters.get(id);if(!row){raw(c,'character-id-missing:'+id);continue}
   const p=c.character_option||{},old=actors.get(id)||{body:1,face:1,x:0,y:0,scale:1},state={...old};for(const[k,from]of[['body','body_variation'],['face','face_variation'],['x','position_x'],['y','position_y'],['scale','scale']])if(p[from]!==null&&p[from]!==undefined)state[k]=Number(p[from]);actors.set(id,state)
   const body=row.bodies.get(state.body),file=body?.file||'adv_face_pattern'+(state.body>1?'_'+String(state.body).padStart(2,'0'):''),plist=resource('res/pc/character/'+row.character_id+'/'+file+'.plist',c);if(!plist)continue
   const prefix='chara_'+id,bodyFrame=prefix+'_body_'+String(state.body).padStart(2,'0')+'.png',faceFrame=prefix+'_face_'+String(state.body).padStart(2,'0')+'_'+String(state.face).padStart(2,'0')+'.png'
   const origin=ctx.placements.get(id+':'+state.body)||[0,180];
   emit({op:'stand',slot:'djibril:'+id,stage,fade:seconds,parts:[bodyFrame,faceFrame].map(frame=>({atlas:{plist,frame},x:state.x+origin[0]*(state.scale||1),y:-state.y+origin[1]*(state.scale||1),scale:state.scale||1}))});continue
  }
  if(type==='Bgm'||type==='Se'){
   if(option==='Off'){emit(type==='Bgm'?{op:'bgmStop'}:{op:'bgvoiceOff',prefix:'djibril-se:'});continue}
   const row=(type==='Bgm'?ctx.bgms:ctx.sounds).get(id);if(!row){raw(c,'sound-id-missing:'+id);continue}const src=resource('res/pc/sounds/'+(type==='Bgm'?'bgm/':'se/scenario/')+row.file+'.mp3',c);if(src)emit(type==='Bgm'?{op:'bgm',src,loop:true}:option==='Loop'?{op:'bgvoice',slot:'djibril-se:'+id,src,kind:'bgse',loop:true}:{op:'se',src});continue
  }
  if(type==='Transition'){emit({op:'fade',to:option==='In'?'clear':id===1?'white':'black',seconds});continue}
  if(type==='Wait'){emit({op:'wait',seconds});continue}
  if(type==='Flash'){emit({op:'flash',color:id===0?'#000':'#fff',count:Math.max(1,Number(option)||1),seconds:seconds||.2});continue}
  if(type==='Shake'){emit({op:'shake',axis:'overall',strength:Number(option)||.2,seconds:seconds||.3});continue}
  if(type==='End'||type==='END')break
  raw(c)
 }
 flush();return{steps,stats}
}
export const djibrilJsonAdapter={id:ADAPTER_ID,label:'電脳天使ジブリール JSON',sniff,parse,prepare,contextFiles,contextDirs,contextTextFilter,catalog,sceneThumbs:true,sceneInPath:true}
