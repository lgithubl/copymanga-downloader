import sharp from 'sharp'

// SavedMaps contains the resolved Sprite per cell (including autotiles).
// Use those references, never infer MV/MZ autotile IDs from Unite UUIDs.
export async function renderUniteMap(store, location, spec) {
 const root=await store.catalogAsset(location),asset=root.asset,tile=96,width=spec.width*tile,height=spec.height*tile
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width*height>64*1024*1024)throw Error('Unite map image bounds exceeded')
 const layers=[],sprites=new Map(),renderers=new Map()
 for(const o of asset.objects.filter(o=>o.classId===483693784)){const d=await store.decode(o);renderers.set(String(d.m_GameObject.m_PathID),d)}
 for(const o of asset.objects.filter(o=>o.classId===1839735485)){
  const d=await store.decode(o),renderer=renderers.get(String(d.m_GameObject.m_PathID))
  if(d.m_Enabled===0||renderer?.m_Enabled===0||!d.m_Tiles.length)continue
  layers.push({d,order:renderer?.m_SortingOrder||0})
 }
 const overlays=[]
 for(const {d}of layers.sort((a,b)=>a.order-b.order))for(const cell of [...d.m_Tiles].sort((a,b)=>b.first.y-a.first.y||a.first.x-b.first.x)){
  const t=cell.second,ptr=d.m_TileSpriteArray[t.m_TileSpriteIndex]?.m_Data
  if(!ptr||String(ptr.m_PathID)==='0')continue
  const matrix=d.m_TileMatrixArray[t.m_TileMatrixIndex]?.m_Data
  if(matrix&&['00','11','22','33'].some(k=>Math.abs(matrix['e'+k]-1)>1e-6)||matrix&&['01','02','03','10','12','13','20','21','23','30','31','32'].some(k=>Math.abs(matrix['e'+k])>1e-6))throw Error('Unite map contains an unimplemented tile transform: '+spec.id)
  const key=ptr.m_FileID+':'+ptr.m_PathID
  if(!sprites.has(key)){
   const o=await store.ptr(asset,ptr),sprite=await store.decode(o),png=await store.media(o)
   sprites.set(key,{sprite,png})
  }
  const {sprite,png}=sprites.get(key),ppu=sprite.m_PixelsToUnits
  if(!(ppu>0))throw Error('Unite tile Sprite has invalid pixels per unit')
  const w=Math.max(1,Math.round(sprite.m_Rect.width*tile/ppu)),h=Math.max(1,Math.round(sprite.m_Rect.height*tile/ppu)),x=Math.round((cell.first.x+d.m_TileAnchor.x)*tile-sprite.m_Pivot.x*w),y=Math.round((1-cell.first.y-d.m_TileAnchor.y)*tile-(1-sprite.m_Pivot.y)*h)
  const color=d.m_TileColorArray[t.m_TileColorIndex]?.m_Data||{r:1,g:1,b:1,a:1},alpha=color.a*d.m_Color.a
  if(!alpha)continue
  let image=sharp(png).resize(w,h,{kernel:'nearest'}).ensureAlpha()
  if(alpha!==1||color.r*d.m_Color.r!==1||color.g*d.m_Color.g!==1||color.b*d.m_Color.b!==1){const {data,info}=await image.raw().toBuffer({resolveWithObject:true});for(let i=0;i<data.length;i+=4){data[i]*=color.r*d.m_Color.r;data[i+1]*=color.g*d.m_Color.g;data[i+2]*=color.b*d.m_Color.b;data[i+3]*=alpha}image=sharp(data,{raw:info})}
  const left=Math.max(0,x),top=Math.max(0,y),right=Math.min(width,x+w),bottom=Math.min(height,y+h)
  if(right<=left||bottom<=top)continue
  overlays.push({input:await image.extract({left:left-x,top:top-y,width:right-left,height:bottom-top}).png().toBuffer(),left,top})
  if(overlays.length>100000)throw Error('Unite map tile count exceeds rendering budget')
 }
 const image=sharp({create:{width,height,channels:4,background:'#000000'}})
 return (overlays.length?image.composite(overlays):image).png().toBuffer()
}
