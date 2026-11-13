// Resolve static TemplateEvent metadata using the enabled plugin's own map list.
// Game JS, variable-dependent template names and self-variable expressions stay
// diagnosed; original event pages remain available to CALL_ORIGIN_EVENT.
import{structValue}from'./rpgmaker-plugins.mjs'
const on=x=>x===true||x==='true'
const tag=(note,name)=>new RegExp('<'+name+':([^>]+)>','i').exec(String(note||''))?.[1]?.trim()
export function prepareTemplates(ctx){
 const plugin=ctx.plugins.find(p=>p.name.split('/').at(-1)==='TemplateEvent');if(!plugin)return
 const p=plugin.parameters||{},root=ctx.options.root?ctx.options.root+'/':'',key=id=>root+'data/Map'+String(id).padStart(3,'0')+'.json',source=new Map(ctx.maps),list=structValue(p.TemplateMapIdList||'[]'),ids=Array.isArray(list)?list.map(Number).filter(Number.isInteger):[],defaultId=Number(p.TemplateMapId)||0
 ctx.templateOrigins=new Map();ctx.templateMapIds=new Set(ids);ctx.templateStats={resolved:0,unresolved:0};if(defaultId)ctx.templateMapIds.add(defaultId)
 const warn=message=>{ctx.templateStats.unresolved++;if(ctx.templateStats.unresolved<=20)ctx.warnings.push(message)}
 for(const[rel,map]of source){const mapId=Number(/Map(\d+)\.json$/i.exec(rel)?.[1]);let changed=false;const events=map.events.map(event=>{
  if(!event)return event;const name=tag(event.note,'TE');if(!name)return event
  if(/[\\<>]/.test(name)){warn('TemplateEvent 动态名称未执行: '+mapId+':'+event.id);return event}
  let mapTarget=Number(tag(event.note,'TEMap'))||defaultId,target
  if(!/^\d+$/.test(name)&&on(p.SearchAllMapsTE)&&!tag(event.note,'TEMap'))mapTarget=ids.find(id=>source.get(key(id))?.events?.some(e=>e?.name===name))||mapTarget
  const candidates=source.get(key(mapTarget))?.events||[];target=/^\d+$/.test(name)?candidates.find(e=>e?.id===Number(name)):candidates.find(e=>e?.name===name)
  if(!target){warn('TemplateEvent 模板缺失: '+mapId+':'+event.id+' → '+name);return event}
  changed=true;ctx.templateStats.resolved++;ctx.templateOrigins.set(`${mapId}:${event.id}`,event)
  const override=on(p.AutoOverride)||/<(?:TEOverRide|TE上書き)>/i.test(event.note||''),fields=structValue(p.OverrideTarget||'{}')
  const pages=target.pages.map((page,i)=>{const original=event.pages?.[i];if(!override||!original)return page;const copy={...page};if(on(fields.Image))copy.image=original.image;if(on(fields.Trigger))copy.trigger=original.trigger;for(const[type,keys]of[['Move',['moveType','moveSpeed','moveFrequency','moveRoute']],['Priority',['priorityType']],['Option',['walkAnime','stepAnime','directionFix','through']]])if(on(fields[type]))for(const k of keys)copy[k]=original[k];return copy})
  const integrate=Number(tag(event.note,'TEIntegrate')||p.IntegrateNote)||0,note=integrate===2?event.note:integrate===1?String(target.note||'')+String(event.note||''):target.note
  return{...target,id:event.id,name:event.name||target.name,x:event.x,y:event.y,note,pages,template:{map:mapTarget,event:target.id,name:target.name}}
 });if(changed)ctx.maps.set(rel,{...map,events})}
}
