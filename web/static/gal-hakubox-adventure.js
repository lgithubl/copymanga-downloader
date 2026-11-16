// Closed native presentation grammar: never eval game JS or execute plugin code.
const PREFIX='rpg-hakubox:adventure:',literal=s=>s==='true'?true:s==='false'?false:/^-?\d+(?:\.\d+)?$/.test(s)?Number(s):/^(['"])[^'"\\]*\1$/.test(s)?s.slice(1,-1):undefined
// Split only at balanced statement boundaries; preserve strings and nested callbacks.
function statements(text){
 const out=[];let at=0,start=0,quote='',depth=0,brace=0
 for(;at<text.length;at++){const c=text[at];if(quote){if(c==='\\')at++;else if(c===quote)quote='';continue}if(c==='"'||c==="'"){quote=c;continue}if(c==='/'&&text[at+1]==='/'){at=text.indexOf('\n',at);if(at<0){at=text.length;break}continue}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;if(c==='{')brace++;if(c==='}')brace--;if(depth<0||brace<0)throw Error('Hakubox presentation statement unbalanced');if(!depth&&!brace&&(c===';'||c==='}')){out.push(text.slice(start,at+1).replace(/^\s*(?:\/\/[^\n]*\n\s*)*/,'').trim());start=at+1}}
 if(quote||depth||brace)throw Error('Hakubox presentation statement truncated');if(text.slice(start).trim())out.push(text.slice(start).trim());return out.filter(Boolean)
}
export function hakuboxAdventure({enabled,emit,raw,resource,stage}){
 const state={Direction:'front',Face:'01',FaceAtta:'',IsNude:false,IsBroken:false,IsWet:false,IsWound:false,IsClimax:false,IsReached:true,SkirtState:'normal',PantState:'normal',SexState:''};let serial=0,effect=null,action=null
 const layer=(name,slot,z,extra={})=>{const src=resource('img/pictures','adventure/tachie/'+name);if(src)return{op:'overlay',slot:PREFIX+slot,kind:'actor',src,stage,anchor:[0,0],x:stage[0]/2-427,y:-stage[1]/2,fit:'none',z,...extra,...(effect?{cycle:effect}:{})}}
 const paint=()=>{
  emit({op:'overlayOff',prefix:PREFIX+'base:'});const paths=[],dir=state.Direction==='front'?'front':state.IsReached?'back_reached':'back',variant=state.IsBroken&&state.IsWet?'04':state.IsWet?'03':state.IsBroken?'02':'01'
  paths.push('body_'+dir);if(state.SexState==='01')paths.push('sex/01/base');if(state.IsWound)paths.push('wound/'+(state.Direction==='front'?'front':'back'));if(state.IsClimax)paths.push('sex/06/05')
  if(state.PantState==='normal'){paths.push('pants/'+variant);if(state.SkirtState==='half')paths.push('pants/05')}else if(state.PantState==='half')paths.push('pants/s_'+variant)
  if(!state.IsNude){if(state.SkirtState==='normal')paths.push('skirt/'+variant+(['01','03'].includes(variant)&&state.PantState==='normal'?'_1':''));paths.push('clothes/'+(state.SkirtState==='half'?'s_':'')+dir+'_'+variant);if(state.SkirtState==='half')paths.push('skirt/s_'+variant)}
  paths.push('hair/hair_'+(state.Direction==='front'?'front':'back'));if(state.IsWet)paths.push('wet/'+(state.Direction==='front'?'front':'back'));if(state.Direction==='back'){paths.push('face/'+state.Face);if(state.FaceAtta)paths.push('face/'+state.FaceAtta)}
  paths.forEach((p,i)=>{const c=layer(p,'base:'+i,100+i);if(c)emit(c)});if(action)emit({...action,...(effect?{cycle:effect}:{cycle:null})})
 }
 const show=id=>{
  if(id)state.SexState=id;id=state.SexState;emit({op:'overlayOff',slot:PREFIX+'action'});action=null;if(!id)return
  let frames=[],end=0,hold=false;const alternating=(dir,a,b,framesTotal,interval=30)=>{end=framesTotal;frames=Array.from({length:Math.floor(framesTotal/interval)+1},(_,i)=>[i*interval,dir+'/'+(i%2?b:a)])}
  if(id==='01'){end=20;frames=[[0,'01/01'],[5,'01/02'],[10,'01/03'],[15,'01/04']]}
  else if(id==='02')alternating('02','01','02',180)
  else if(id==='03')alternating('03',state.IsNude?'03':'01',state.IsNude?'04':'02',180)
  else if(id==='04')alternating('04',state.SkirtState==='normal'?'01':'03',state.SkirtState==='normal'?'02':'04',180)
  else if(id==='05'){end=180;frames=[[0,'05/01'],[10,'05/02'],[20,'05/01'],[30,'05/02'],[40,'05/03'],[100,'05/01'],[110,'05/02'],[120,'05/01'],[130,'05/02'],[140,'05/03']]}
  else if(id==='05_fast')alternating('05','01','02',100,20)
  else if(id==='06_1'){alternating('06','01','02',100,20);hold=true}
  else if(id==='06_2'||id==='06_3'){alternating('06','03','04',140,20);hold=id==='06_2'}
  else if(id==='07_1'){end=140;hold=true;frames=[[0,'07/01'],...Array.from({length:7},(_,i)=>[(i+1)*20,'07/'+(i%2?'03':'02')])]}
  else if(id==='07_2'){end=150;frames=[[0,'07/01'],[30,'07/04'],[50,'07/05'],[100,'07/06']]}
  else{raw('hakubox-adventure-action-not-lifted',id);return}
  frames=frames.filter(([n])=>n<end||hold);const timeline=frames.map(([n,name],i)=>({src:resource('img/pictures','adventure/tachie/sex/'+name),seconds:Math.max(1,(frames[i+1]?.[0]??end)-n)/60}));if(!hold)timeline.push({src:'',seconds:1/60})
  action=layer('sex/'+frames[0][1],'action',190,{animation:{key:'hakubox-adventure-action:'+serial++,loop:false,frames:timeline}});if(action)emit(action)
 }
 const condition=(text,active=true)=>{
  if(!enabled)return undefined;const m=/^(?:_scene|SceneManager\._scene)\.tachie([A-Za-z]+)\s*(===|!==|==|!=|=)\s*('[^'\\]*'|"[^"\\]*"|true|false)\s*;?$/.exec(String(text).trim());if(!m||!Object.hasOwn(state,m[1]))return undefined;if(!active)return false;const value=literal(m[3]);if(m[2]==='='){state[m[1]]=value;return Boolean(value)}return ['===','=='].includes(m[2])?state[m[1]]===value:state[m[1]]!==value
 }
 const run=(text,depth=0)=>{
  if(text.length>65536||depth>12)throw Error('Hakubox presentation script bounds exceeded')
  for(const stmt of statements(text)){
   if(/^const\s+_scene\s*=\s*SceneManager\._scene\s*;?$/.test(stmt))continue
   let m=/^_scene\.tachie([A-Za-z]+)\s*=\s*('[^'\\]*'|"[^"\\]*"|true|false)\s*;?$/.exec(stmt);if(m&&Object.hasOwn(state,m[1])){state[m[1]]=literal(m[2]);continue}
   if(/^_scene\.updateTachie\((?:true|false)?\)\s*;?$/.test(stmt)){paint();continue}
   m=/^_scene\.showSexAction\((?:['"]([0-9]{2}(?:_[0-9a-z]+)?)['"])?\)\s*;?$/.exec(stmt);if(m){show(m[1]);continue}
   m=/^if\s*\(([\s\S]*?)\)\s*\{([\s\S]*)\}$/.exec(stmt);if(m){const yes=condition(m[1]);if(yes!==undefined){if(yes)run(m[2],depth+1)}else raw('hakubox-adventure-gameplay-not-simulated',stmt);continue}
   m=/^Utils_Tachie\.startAction\(['"](rumble|shake)['"],\s*_scene\.tachieContainer,\s*\{([^{}]*)\}\s*(?:,\s*\(\)\s*=>\s*\{([\s\S]*)\})?\s*\)\s*;?$/.exec(stmt)
   if(m){const config={};let valid=true;for(const entry of m[2].split(',').map(x=>x.trim()).filter(Boolean)){const pair=/^(duration|loop|power|frequency|dir|easingType|inout)\s*:\s*(.+)$/.exec(entry);if(!pair||literal(pair[2])===undefined){valid=false;break}config[pair[1]]=literal(pair[2])}if(!valid){raw('hakubox-adventure-script-not-lifted',stmt);continue}effect={key:'hakubox-adventure-effect:'+serial++,offset:{kind:m[1],duration:Math.max(1,Math.min(3600,Number(config.duration)||50))/60,loops:Math.max(1,Math.min(16,Number(config.loop)||1)),power:Number(config.power)||12,frequency:Number(config.frequency)||1,dir:config.dir||'horizontal'}};paint();if(m[3]){raw('hakubox-adventure-parallel-callback-serialized',stmt);emit({op:'wait',seconds:effect.offset.duration*effect.offset.loops});effect=null;run(m[3],depth+1)}continue}
   raw(/^(?:Utils_(?:Favor|Time|State)|\$gameVariables)/.test(stmt)?'hakubox-adventure-gameplay-not-simulated':'hakubox-adventure-script-not-lifted',stmt)
  }
 }
 const script=(text,active=true)=>{if(!enabled||!/(?:_scene\.tachie|_scene\.(?:updateTachie|showSexAction)|Utils_Tachie\.startAction)/.test(text))return false;if(active)run(text);return true};script.condition=condition;return script
}
