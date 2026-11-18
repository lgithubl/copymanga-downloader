// A suspended story keeps its player/state alive; only the child interaction is replaced.
const key=view=>'copymanga.gal.interaction-return.'+view
export function saveInteractionReturn(view,frame){try{sessionStorage.setItem(key(view),JSON.stringify(frame))}catch{}}
export function loadInteractionReturn(view,node,scene){try{const f=JSON.parse(sessionStorage.getItem(key(view))||'null');return f?.node===node&&Number.isInteger(f.step)&&f.step>=0&&scene?.steps?.[f.step]?.commands?.some(c=>c.op==='interaction')&&f.choices&&typeof f.choices==='object'&&!Array.isArray(f.choices)?f:null}catch{return null}}
export function clearInteractionReturn(view,node){try{const f=JSON.parse(sessionStorage.getItem(key(view))||'null');if(!node||f?.node===node)sessionStorage.removeItem(key(view))}catch{}}
export function createInteractionCall({container,node,load,render,chapter,viewKey,onEscape,onDetails,onToggleImmersive,immersive=false,onError=()=>{}}){
 const host=document.createElement('div');host.className='gal-interaction-call';host.style.width='100%';container.append(host)
 let active=true,serial=0,child=null,resolve
 const done=new Promise(r=>{resolve=r}),close=completed=>{if(!active)return;active=false;serial++;child?.destroy();child=null;host.remove();resolve(completed)}
 async function mount(target){
  const mine=++serial;child?.destroy();child=null;host.replaceChildren()
  const message=document.createElement('p'),leave=document.createElement('button');message.textContent='加载互动…';leave.className='gal-btn';leave.textContent='结束互动，返回剧情';leave.onclick=()=>close(true);host.append(message,leave)
  try{const reader=await load(target);if(!active||mine!==serial)return;if(reader?.scene?.interaction?.format!=='gal-interaction/1')throw Error('目标不是互动场景：'+target)
   child=render({container:host,reader,viewKey,onEscape,onDetails,onToggleImmersive,chapter:{...chapter,select:mount,finishInteraction:()=>close(true)}});child.setImmersive?.(immersive)
  }catch(e){if(!active||mine!==serial)return;message.textContent='互动加载失败：'+e.message;onError(e);const retry=document.createElement('button');retry.className='gal-btn';retry.textContent='重试';retry.onclick=()=>mount(target);host.append(retry)}
 }
 mount(node)
 return{done,destroy:()=>close(false),setImmersive(v){immersive=!!v;child?.setImmersive?.(immersive)}}
}
