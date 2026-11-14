// Bounded read-only execution of AdventureScreen native tokens. Source of opcode
// and buffer semantics: captured AdventureCommandManager/ScreenState*. Never eval.
import{parseRichText}from'./adapters/uviewer-csv.mjs'
const names=['updateView','set','display','pos','zIndex','move','rotation','rotate','scale','scaleAnim','fadeIn','fadeOut','play','stop','wait','click','select','jump','mesDisplay','faceDisplay','load','setMotion','setEmotion','setColorRGB','setColorHSV','alpha','setParticle','mask','blend','filterEffect','blendEffect','colorEffect','screenFilter','screenChange','screenClear','volume','audioFadeIn','audioFadeOut','init','overlayIn','overlayOut','overlayInout','shake','loopShake','stopLoopShake','comicMark','stopLoopComicMark','moveX','moveY','curveX','curveY','mapDisplayCharaGrid','mapDisplayCharaPos','mapDeleteChara','stopEff','eff1','eff2','eff3','eff4','eff5','eff6','eff7','eff8','eff9','eff10','eff11','eff12','eff13','finishIn','finishOut','nameShop','eff14']
const kinds={chara:0,bg:1,still:2,face:3,bgm:4,se:5,vo:6,sprite:8,mask:9,comicMark:10,enemy:11}
const bundles={0:'spineChara',1:'spriteBgCommon',2:'adventure',3:'adventure',4:'audiosBgm',5:'audiosSe',6:'audiosVoice',8:'adventure',9:'adventure',10:'spineComicMark',11:'spineAdventureEnemy'}
export function runMeshi(data,ctx={},cfg={}){
 const tokens=data.json.tokenData,loads=data.json.loadData,events=[],diagnostics={},objects=new Map(),labels=new Map(),last=new Map(),commands=[];let active=2,queue=[],pc=0,executed=0,body='',speaker='',hasText=false,decision=0,pending=null,at=0
 tokens.forEach((t,i)=>{if(t.type===2){if(!labels.has(t.label))labels.set(t.label,i)}})
 const txt=s=>String(s??'').replace(/%name/g,cfg.protagonist||'主人公').replace(/%tavern/g,cfg.tavern||'まんぷく亭')
 const emit=c=>commands.push(c),raw=(t,reason)=>{const cmd='meshi:'+(reason||names[t.commandIdx]||('opcode-'+t.commandIdx));diagnostics[cmd]=(diagnostics[cmd]||0)+1;emit({op:'raw',cmd,args:JSON.stringify({script:data.name,token:t._token??at,line:t.line,command:t.commandIdx,name:names[t.commandIdx],params:t.params})})}
 const load=(kind,id)=>{const n=kinds[kind];return loads.find(x=>x.type===n&&(typeof id==='string'?x.name===id:x.id===id))}
 const asset=(kind,id,t)=>{const a=load(kind,id);if(!a){raw(t,'asset-not-in-loadData:'+kind+':'+id);return null}const prefix={2:'sprite/still/',3:'sprite/face/',8:'sprite/other/',9:'sprite/mask/'}[a.type]||'',b=bundles[a.type],key=b+':'+prefix+a.name;let v=ctx.assets?.get(key)
  if(a.type===10){raw(t,'comic-mark-not-rendered');return null}
  if(a.type===4){v=ctx.assets?.get(b+':'+a.name+'_loop')||v;const intro=ctx.assets?.get(b+':'+a.name+'_intro');if(intro)raw(t,'bgm-intro-transition-not-rendered')}
  if(!v){raw(t,'missing-resource:'+key);return null}return{...v,name:a.name,assetType:a.type}
 }
 const obj=p=>{const key=p[0]+':'+p[1];if(!objects.has(key))objects.set(key,{key,kind:p[0],index:p[1],buffer:1,x:0,y:0,sx:1,sy:1,alpha:0,tracks:{},order:objects.size});return objects.get(key)}
 const reset=()=>{objects.clear();active=2;queue=[];emit({op:'overlayOff',slot:'meshi:screen'})}
 const visual=t=>{const p=t.params||[],o=obj(p);switch(t.commandIdx){
  case 1:{const a=asset(p[2],p[3],t);if(a){o.asset=a;o.buffer=p[4]===2?2:1;o.order=objects.size+at}break}
  case 2:o.alpha=p[2]===1?1:0;if(p.length>3)o.x=Number(p[3]);if(p.length>4)o.y=Number(p[4]);break
  case 3:case 5:o.x=Number(p[2]);o.y=Number(p[3]);break
  case 4:o.order=Number(p[2]);break
  case 6:case 7:if(p[2])raw(t,'rotation-not-rendered');break
  case 8:case 9:o.sx=Number(p[2])/1000;o.sy=Number(p[3])/1000;if(o.sy<0&&!o.asset?.skel)raw(t,'sprite-y-flip-not-rendered');break
  case 10:o.alpha=1;break
  case 11:o.alpha=0;break
  case 21:o.tracks[p[4]]={track:Number(p[4]),anim:p[2],loop:Boolean(p[3])};break
  case 22:{const e=ctx.emotions?.[p[2]];if(!e){raw(t,'missing-emotion:'+p[2]);break}for(const[i,k]of ['cheek','eye_L','eye_R','eyebrow_L','eyebrow_R','mouth'].entries())if(e[k])o.tracks[i+1]={track:i+1,anim:e[k],loop:false};break}
  case 25:o.alpha=Math.max(0,Math.min(1,Number(p[2])/255));break
  case 34:for(const[k,v]of objects)if(v.buffer===(p[0]===1?1:2))objects.delete(k);break
  case 39:emit({op:'overlay',slot:'meshi:screen',rect:[0,0,cfg.stage?.[0]||1170,cfg.stage?.[1]||640],color:`rgb(${p[1]??255},${p[2]??255},${p[3]??255})`,alpha:1,z:999,stage:cfg.stage});break
  case 40:case 41:emit({op:'overlayOff',slot:'meshi:screen'});break
  case 42:emit({op:'shake',seconds:Math.min(2,Number(p[3]||300)/1000),count:2});break
  case 44:break
  case 45:o.tracks[1]={track:1,anim:o.asset?.name||'',loop:Boolean(p[2])};if(!p[2])o.alpha=0;break
  case 46:o.alpha=0;break
  case 47:if(!p[5])o.x+=Number(p[2]);break
  case 48:if(!p[5])o.y+=Number(p[2]);break
  case 49:o.x+=Number(p[2]);raw(t,'curve-transition-not-rendered');break
  case 50:o.y+=Number(p[3]);raw(t,'curve-transition-not-rendered');break
  default:raw(t)
 }}
 const snapshot=()=>{const now=new Map(),frontOpaque=[...objects.values()].some(o=>o.buffer===active&&o.asset&&o.alpha===1&&(o.kind==='bg'||o.kind==='still'&&o.index===0));for(const o of objects.values()){if(!o.asset||o.alpha<=0||o.sx===0||o.sy===0||frontOpaque&&o.buffer!==active)continue;if(o.kind==='face'){continue}const a=o.asset,slot='meshi:'+o.key,stage=cfg.stage||[1170,640];let spec
  if(a.skel){const scale=cfg.spineScale??0.8;spec={op:'spine',slot,kind:'actor',name:a.name,skel:a.skel,atlas:a.atlas,textureMap:a.textureMap,tracks:Object.values(o.tracks),place:{x:o.x,y:o.y,scale,scaleX:o.sx,scaleY:o.sy},stage,order:o.order+(o.buffer===active?1000000:0)};if(o.alpha!==1)spec.opacity=o.alpha}
  else spec={op:'overlay',slot,name:a.name,src:a.src,x:o.x+(a.offset?.[0]||0)*o.sx,y:-o.y-(a.offset?.[1]||0)*o.sy,...(a.crop?{crop:a.crop}:{}),scaleX:Math.abs(o.sx),scaleY:Math.abs(o.sy),flipX:o.sx<0,alpha:o.alpha,stage,anchor:[0.5,0.5],z:(o.kind==='bg'?-10000:o.kind==='still'?10000:0)+o.order+(o.buffer===active?1000000:0),under:o.kind==='bg',cg:o.kind==='still'}
  now.set(slot,spec);if(JSON.stringify(spec)!==JSON.stringify(last.get(slot)))emit(spec)
 }for(const[slot,spec]of last)if(!now.has(slot))emit({op:spec.op==='spine'?'spineOff':'overlayOff',slot});last.clear();for(const pair of now)last.set(...pair)}
 const flush=(force=false)=>{snapshot();if(hasText){emit({op:'ui',visible:true});emit({op:'speaker',segments:parseRichText(txt(speaker))});emit({op:'text',segments:parseRichText(txt(body))})}if(commands.length&&(hasText||force)){if(events.length>=Math.max(1,Math.min(50000,cfg.maxSteps||20000)))throw Error('meshiagirl 文本步数超过上限');events.push({source:at,commands:commands.splice(0)})}hasText=false;body=''}
 const jump=(label,t)=>{if(!labels.has(label)){raw(t,'missing-label:'+label);return}pc=labels.get(label)+1}
 while(pc<tokens.length){if(++executed>Math.max(1,Math.min(2000000,cfg.maxInstructions||200000)))throw Error(data.name+': meshiagirl 指令执行超过上限');at=pc;const t=tokens[pc++];if(t.type===0){if(t.textType===0||t.textType===1){body=String(t.message||'');speaker=t.name??speaker}else body+=String(t.message||'');hasText=true;if(t.rubies?.length)raw(t,'ruby-layout-not-rendered');continue}if(t.type===2){emit({op:'label',name:t.label});continue}if(t.type!==1){raw(t,'token-type-'+t.type);continue}const p=t.params||[];switch(t.commandIdx){
  case 0:for(const q of queue)visual(q);queue=[];break
  case 12:case 36:{if(t.commandIdx===36)raw(t,'audio-fade-transition-not-rendered');const a=asset(p[2],p[3],t);if(!a)break;const kind=p[0];if(kind==='bgm')emit({op:'bgm',src:a.src});else if(kind==='se'||kind==='vo'){if(p[4])emit({op:'bgvoice',slot:'meshi:'+kind+':'+p[1],src:a.src,loop:true,kind:kind==='se'?'se':'voice'});else emit({op:kind==='se'?'se':'voice',src:a.src})}else raw(t,'audio-kind:'+kind);break}
  case 13:case 37:if(p[0]==='bgm')emit({op:'bgmStop'});else if(p[0]==='vo'||p[0]==='se')emit({op:'bgvoiceOff',prefix:'meshi:'+p[0]+':' });else raw(t);break
  case 14:if(p.length===1&&Number.isFinite(p[0]))emit({op:'wait',seconds:Math.min(10,Math.max(0,p[0]/1000))});break
  case 15:flush(true);break
  case 16:{flush();if(!p.length||p.length%3)throw Error(data.name+': invalid select triples');const opts=[];for(let i=0;i<p.length;i+=3)opts.push({value:p[i],label:p[i+1],segments:parseRichText(txt(p[i+2]))});if(new Set(opts.map(x=>x.value)).size!==opts.length)throw Error('meshiagirl duplicate choice values');const choice={key:'meshi:'+data.name+':'+at,source:at,options:opts},selected=cfg.decisions?.[decision++];if(selected===undefined){pending=choice;pc=tokens.length;break}const option=opts.find(x=>x.value===selected);if(!option)throw Error('meshiagirl invalid choice decision');jump(option.label,t);break}
  case 17:jump(p[0],t);break
  case 18:emit({op:'ui',visible:p[0]===1});break
  case 33:active=active===1?2:1;break
  case 38:reset();break
  case 68:case 69:raw(t,'native-finish-button');break
  case 70:raw(t,'shop-name-from-config');break
  case 32:raw(t);break
  default:queue.push({...t,_token:at})
 }}
 if(!pending)flush(true)
 return{events,pending,diagnostics,executed,stateKey:pending?JSON.stringify([pc,at,active,[...objects],queue,speaker,[...last]]):''}
}
