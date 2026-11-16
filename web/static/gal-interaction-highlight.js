// Geometry comes from the same animated hit meshes as pointer detection.
export function createInteractionHighlight({parent,layers,slot='interaction'}){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('gal-interaction-highlight');svg.setAttribute('aria-hidden','true');parent.append(svg)
 let areas=[],raf=0,destroyed=false
 const draw=()=>{raf=0;if(destroyed||!areas.length)return;const r=parent.getBoundingClientRect();svg.setAttribute('viewBox',`0 0 ${r.width||1} ${r.height||1}`);svg.replaceChildren();for(const shape of layers.regionShapes(slot,areas))for(const points of shape.polygons){const polygon=document.createElementNS(ns,'polygon');polygon.dataset.region=shape.id;polygon.setAttribute('points',points.map(([x,y])=>`${x-r.left},${y-r.top}`).join(' '));svg.append(polygon)}raf=requestAnimationFrame(draw)}
 return{set(next,{pulse=false}={}){areas=next||[];svg.classList.toggle('is-triggered',pulse);if(raf)cancelAnimationFrame(raf);raf=0;svg.replaceChildren();if(areas.length)draw()},destroy(){destroyed=true;if(raf)cancelAnimationFrame(raf);svg.remove()}}
}
