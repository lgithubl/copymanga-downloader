import {structValue} from './rpgmaker-plugins.mjs'
// Native Live2DInterfaceMZ uses PIXI anchor (.5,.5), model scale .2 * scale.
export function prepareRpgLive2d(ctx){
 const plugin=ctx.plugins.find(p=>p.name.split('/').at(-1)==='Live2DInterfaceMZ');if(!plugin)return
 const cfg=plugin.parameters||{},rows=structValue(cfg.Modelcondition||'[]');if(!Array.isArray(rows))throw Error('Live2DInterfaceMZ Modelcondition 不是数组')
 const files=new Map([...ctx.files].map(p=>[p.toLowerCase(),p])),models=new Map(),root=ctx.options.root?ctx.options.root+'/':''
 for(const row of rows){const name=String(row.Modelname||''),folder=String(row.folderpath||'').replace(/^\.\//,'').replace(/\/$/,'');if(!name||/[\\/]/.test(name)||/^(?:\/|[a-z]:)/i.test(folder)||folder.split('/').includes('..'))continue
  const wanted=root+folder+'/'+name+'.model3.json',src=files.get(wanted.toLowerCase());if(!src){ctx.warnings.push('Live2D 模型清单缺失: '+wanted);continue}
  const motions=new Map([...String(row.motiongroupnames||'').matchAll(/<([^:>]+):([^>]+)>/g)].map(m=>[m[1].trim(),m[2].trim()]));models.set(name,{src,motions,index:models.size})
 }
 ctx.rpgLive2d={cfg,models}
}
export function rpgLive2dCommands(ctx,{emit,raw,stage,cg=false}){
 if(!ctx.rpgLive2d)return()=>false
 const {cfg,models}=ctx.rpgLive2d,records=new Map()
 return(action,args={})=>{
  const name=String(args.modelName||''),model=models.get(name);if(!model){raw('live2d-model-missing',name);return true}
  let r=records.get(name);if(!r){r={src:model.src,slot:'rpg-live2d:'+name,stage,x:Number(cfg.middle)||stage[0]/2,y:Number(cfg.vertical)||stage[1]/2,scaleX:.2*(Number(cfg.DefaultScale)||1),scaleY:.2*(Number(cfg.DefaultScale)||1),visible:false};records.set(name,r)}
  const patch={};
  if(action==='show')patch.visible=true
  else if(action==='hide')patch.visible=false
  else if(action==='motion'){const group=model.motions.get(String(args.motionName));if(!group){raw('live2d-motion-alias-missing',{model:name,motion:args.motionName});return true}const match=/^(.*)_(\d+)$/.exec(group);patch.motionGroup=match?match[1]:group;patch.motionIndex=match?Math.max(0,Number(match[2])-1):0;patch.loop=args.loop!=='false';patch.motionToken=(r.motionToken||0)+1}
  else if(action==='expression')patch.expression=String(args.expressionName||'')
  else if(action==='pos'){patch.x=Number(args.x)||0;patch.y=Number(args.y)||0}
  else if(['left','middle','right'].includes(action))patch.x=Number(cfg[action])||stage[0]/2
  else if(action==='scale'){const n=Number(args.scale);if(!Number.isFinite(n)||n<=0){raw('live2d-scale-invalid',args);return true}patch.scaleX=patch.scaleY=.2*n}
  else return false
  if(patch.motionToken)r.motionToken=patch.motionToken
  emit({op:'live2d',src:r.src,slot:r.slot,defaults:{...(cg?{cg:true}:{}),nativeOrder:Number(cfg.pictpriority)>=100?model.index:-model.index,stage:r.stage,x:r.x,y:r.y,scaleX:r.scaleX,scaleY:r.scaleY,visible:false},...patch,patch:true});return true
 }
}
