// Hit areas follow current deformed vertices, including invisible native hit meshes.
// CubismRaycastable Precision: 0 = bounding box, 1 = triangles.
export function hitModelAreas(model, frame, areas, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return []
  const hits = []
  for (const area of areas || []) {
    const i = area.mesh, v = frame.vertices[i]
    if (!Number.isInteger(i) || !v?.length || frame.artEnabled?.[i] === 0) continue
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity
    for(let p=0;p<v.length;p+=2){left=Math.min(left,v[p]);right=Math.max(right,v[p]);top=Math.min(top,v[p+1]);bottom=Math.max(bottom,v[p+1])}
    if(x<left||x>right||y<top||y>bottom)continue
    let hit=area.precision===0
    if(area.precision===1){const start=model.artIndexStart[i],end=start+model.artIndexCount[i];for(let p=start;p<end;p+=3){const a=model.vertexIndices[p]*2,b=model.vertexIndices[p+1]*2,c=model.vertexIndices[p+2]*2,cross=(u,w)=>(x-v[u])*(v[w+1]-v[u+1])-(y-v[u+1])*(v[w]-v[u]),q=[cross(a,b),cross(b,c),cross(c,a)];if(q.every(n=>n>=0)||q.every(n=>n<=0)){hit=true;break}}}
    if(hit)hits.push(area.id)
    if(hits.length>=4)break
  }
  return hits
}
export function canvasModelPoint(canvas, model, clientX, clientY, spec={}) {
 const r=canvas.getBoundingClientRect();if(!r.width||!r.height||clientX<r.left||clientX>r.right||clientY<r.top||clientY>r.bottom)return null
 let x=(clientX-r.left)/r.width,y=(clientY-r.top)/r.height
 if(spec.nativeOrigin?.scaleX<0)x=1-x;if(spec.nativeOrigin?.scaleY<0)y=1-y
 const c=model.canvas;return[(x*c.width-c.originX)/c.pixelsPerUnit,(y*c.height-c.originY)/c.pixelsPerUnit]
}
