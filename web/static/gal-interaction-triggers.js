export const TRIGGER_MODES=['single','repeat','hold']
export const TRIGGER_LABELS={single:'单次点击',repeat:'定时重复',hold:'按住重复'}
const number=(v,f,min,max)=>typeof v==='boolean'||v==null||v===''||!Number.isFinite(Number(v))?f:Math.max(min,Math.min(max,Number(v)))
export function interactionPreferences(raw={},defaults={}){
 raw=raw&&typeof raw==='object'?raw:{}
 const modes=value=>Object.fromEntries(Object.entries(value&&typeof value==='object'?value:{}).filter(([,v])=>TRIGGER_MODES.includes(v)).slice(0,2000))
 return{interval:number(raw.interval,1500,200,10000),waitVoice:raw.waitVoice!==false,textOpacity:number(raw.textOpacity,defaults.textOpacity??.74,0,1),fontScale:number(raw.fontScale,defaults.fontScale??1,.6,2),voiceVolume:number(raw.voiceVolume,defaults.voiceVolume??.8,0,1),sfxVolume:number(raw.sfxVolume,defaults.sfxVolume??.8,0,1),toolModes:modes(raw.toolModes),areaModes:modes(raw.areaModes)}
}
export const toolModeKey=(role,tool)=>JSON.stringify([role,tool])
export const areaModeKey=(role,tool,area)=>JSON.stringify([role,tool,area])
export function interactionTriggerMode(p,role,tool,area){return(area!==undefined&&p.areaModes[areaModeKey(role,tool,area)])||p.toolModes[toolModeKey(role,tool)]||'single'}

// Each target owns a timer; a bounded FIFO serializes queued requests when voice
// or model loading blocks playback. Cancellation also removes delayed requests.
export function createInteractionTriggers({fire,blocked,interval,onChange=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 const jobs=new Map(),queue=new Map();let destroyed=false,flushing=false
 function notify(){if(destroyed||flushing)return;flushing=true;try{while(queue.size&&!blocked()){const[key,payload]=queue.entries().next().value;queue.delete(key);fire(payload)}}finally{flushing=false;onChange()}}
 function request(key,payload){if(destroyed)return;queue.set(key,payload);notify()}
 function schedule(key,job){job.timer=setTimer(()=>{if(destroyed||jobs.get(key)!==job)return;request(key,job.payload);if(jobs.get(key)===job)schedule(key,job)},Math.max(200,interval()))}
 function stop(key){const job=jobs.get(key);if(job)clearTimer(job.timer);jobs.delete(key);queue.delete(key);onChange()}
 function start(key,payload,mode){stop(key);if(destroyed)return;const job={payload,mode,timer:null};jobs.set(key,job);request(key,payload);if(jobs.get(key)===job)schedule(key,job)}
 return{request,notify,start,stop,toggle(key,payload){if(jobs.has(key))stop(key);else start(key,payload,'repeat')},stopHolds(){for(const[key,job]of jobs)if(job.mode==='hold')stop(key)},stopAll(){for(const key of new Set([...jobs.keys(),...queue.keys()]))stop(key)},reschedule(){for(const[key,job]of jobs){clearTimer(job.timer);schedule(key,job)}notify()},has:key=>jobs.has(key),active:()=>[...jobs.entries()].map(([key,job])=>({key,...job.payload})),get size(){return jobs.size},get pending(){return queue.size},destroy(){this.stopAll();destroyed=true}}
}

export function bindInteractionTrigger(element,{resolve,mode,controller}){
 let skipClick=false,heldKey=null
 const release=()=>{if(heldKey)controller.stop(heldKey);heldKey=null}
 const begin=payload=>{heldKey=payload.key;controller.start(payload.key,payload,'hold')}
 const down=e=>{if(e.button!==undefined&&e.button!==0)return;skipClick=false;const p=resolve(e);if(!p)return;if(mode(p)==='hold'){skipClick=true;begin(p)}}
 const click=e=>{if(skipClick){skipClick=false;return}const p=resolve(e);if(!p)return;if(mode(p)==='repeat')controller.toggle(p.key,p);else controller.request(p.key,p)}
 const keydown=e=>{if(![' ','Enter'].includes(e.key)||e.repeat)return;const p=resolve(e);if(p&&mode(p)==='hold'){e.preventDefault();skipClick=true;begin(p)}}
 const keyup=e=>{if([' ','Enter'].includes(e.key)&&heldKey){e.preventDefault();release()}}
 const context=e=>{if(heldKey)e.preventDefault()}
 for(const[type,fn]of[['pointerdown',down],['click',click],['pointerup',release],['pointerleave',release],['pointercancel',release],['keydown',keydown],['keyup',keyup],['contextmenu',context]])element.addEventListener(type,fn)
 return()=>{release();for(const[type,fn]of[['pointerdown',down],['click',click],['pointerup',release],['pointerleave',release],['pointercancel',release],['keydown',keydown],['keyup',keyup],['contextmenu',context]])element.removeEventListener(type,fn)}
}
