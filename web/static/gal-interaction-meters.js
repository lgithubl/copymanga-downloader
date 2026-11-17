// The native rate table is continuous. Seeking changes the value once, never the rate.
export function createInteractionMeter(config={},saved={}){
 const max=Number(config.bars?.girl?.max)||1,finite=(v,f)=>Number.isFinite(Number(v))?Number(v):f,rates=new Map()
 let value=Math.max(0,Math.min(max,finite(saved.value,config.bars?.girl?.value||0))),count=Math.max(0,Math.floor(finite(saved.count,config.highCount||0))),heart=Math.max(0,finite(saved.heart,config.bars?.heart?.value||0)),cooldown=0,zero=0
 return{rate(part,amount,scaled=false){if(Number.isFinite(amount))rates.set(String(part),{amount,scaled})},seek(fraction){value=Math.max(0,Math.min(1,Number(fraction)||0))*max;zero=0},tick(dt,{busy=false,scale=1}={}){
  dt=Math.max(0,Math.min(.25,Number(dt)||0));if(cooldown>0){cooldown=Math.max(0,cooldown-dt);if(!cooldown){heart=Math.min(config.bars?.heart?.max||1,heart+(config.heartAddOnce||0));value=0}return null}
  const rate=rates.size?[...rates.values()].reduce((n,r)=>n+r.amount*(r.scaled?scale:1),0):Number(config.bars?.girl?.rate)||0
  const full=value>=max;value=Math.max(0,value+rate*dt);if((full||value>=max)&&!busy){count++;value=0;cooldown=Math.max(.01,config.highSeconds??3);zero=0;return'iku'}
  if(value<=0&&count>0){zero+=dt;if(zero>=Math.max(.01,config.zeroSeconds??1.5)&&!busy){count--;value=max-Number.EPSILON;zero=0;return'riku'}}else zero=0
  return null
 },snapshot(){return{value:Math.min(value,max),max,count,heart,rate:[...rates.values()].reduce((n,r)=>n+r.amount,0),cooldown}}}
}
