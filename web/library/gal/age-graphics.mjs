// Data-only AGE drawing primitives used by the native image-placement helper.
// Unsupported operations return false; callers must stop, never silently skip.
// Placement/query meanings are cross-checked against SC0000's native helper.
export function createAgeGraphics({ loadImage, maxBytes = 128 * 1024 * 1024, maxObjects = 2048, metadataOnly = false, now = () => 0 } = {}) {
 if (!Number.isInteger(maxBytes) || maxBytes < 16 || maxBytes > 512 * 1024 * 1024 || !Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 8192) throw Error('AGE graphics budget invalid')
 const textures = new Map(), objects = new Map(), auxiliary = new Map(), referenced = new Set()
 let bytes = 0, motionSequence = 0
 const id = value => { if (!Number.isInteger(value) || value < 0 || value >= 0x1000000) throw Error('AGE graphics id invalid'); return value }
 const dimensions = (w, h) => { if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > 4 * 1024 * 1024) throw Error('AGE graphics dimensions invalid') }
 const object = key => {
  id(key)
  if (!objects.has(key)) { if (objects.size >= maxObjects) throw Error('AGE graphics object limit'); objects.set(key, { id: key, texture: -1, x: 0, y: 0, z: 0, pivot: [0, 0, 0], visible: true }) }
  return objects.get(key)
 }
 const texture = key => { const value = textures.get(id(key)); if (!value) throw Error('AGE texture is not initialized: ' + key); return value }
 const setTexture = (key, value) => {
  id(key); dimensions(value.width, value.height)
  if (!metadataOnly && (!Buffer.isBuffer(value.rgba) || value.rgba.length !== value.width * value.height * 4)) throw Error('AGE texture RGBA length invalid')
  const size = bytes - (textures.get(key)?.byteLength || 0) + value.width * value.height * 4
  if (size > maxBytes || textures.size >= 2048 && !textures.has(key)) throw Error('AGE texture memory limit')
  textures.set(key, { ...value, byteLength: value.width * value.height * 4, ...(metadataOnly ? {} : { rgba: Buffer.from(value.rgba) }) }); bytes = size
 }
 function instruction(i, { read, write }) {
  const a = i.args, n = k => read(a[k]), put = (k, value) => write(a[k], value)
  switch (i.opcode) {
   case 0x1f7: {
    // 422270 selects single-object erase (49b060) for count <= 1,
    // otherwise 49b230 erases the half-open id range [start,start+count).
    // Neither operation frees the separately indexed texture resources.
    const start = id(n(0)), count = n(1), size = Math.max(1, count)
    if (!Number.isInteger(count) || start + size > 0x1000000) throw Error('AGE object erase range invalid')
    for (const key of objects.keys()) if (key >= start && key < start + size) objects.delete(key)
    return true
   }
   case 0x224: {
    // 419c60 -> 499a80 -> 4994e0 clears ONLY the +418 tree. Persistent
    // draw records live at +408 (49a350). Auxiliary producers such as
    // 0x223/49d2d0 remain unsupported; therefore this tree is empty on all
    // currently accepted paths. Do not clear images, textures or motion.
    auxiliary.clear(); return true
   }
   case 0x1f9: {
    const ordinal = n(0), target = id(n(1)), mode = n(2)
    if(!Number.isInteger(ordinal)||ordinal<0||ordinal>=0x41000000)throw Error('AGE archive resource id invalid')
    // Only the native helper's full image load mode has been verified.
    if (mode !== -1) return false
    referenced.add(ordinal)
    const image = loadImage?.(ordinal)
    if (!image) throw Error('AGE image resource missing: ' + ordinal)
    setTexture(target, { ...image, ordinal }); return true
   }
   case 0x1fa: { const key = id(n(0)); bytes -= textures.get(key)?.byteLength || 0; textures.delete(key); return true }
   case 0x207: {
    // SP's EVINIT supplies opaque difference rectangles: source texture,
    // destination texture, source rectangle, destination x/y. Keep each copy
    // in texture coordinates until the native draw-texture presents it.
    const source=texture(n(0)),target=texture(n(1)),[sx,sy,w,h,dx,dy]=[2,3,4,5,6,7].map(n)
    if(source===target||!source.opaque||source.parts?.length)return false
    if([sx,sy,w,h,dx,dy].some(v=>!Number.isInteger(v))||w<1||h<1||sx<0||sy<0||dx<0||dy<0||sx+w>source.width||sy+h>source.height||dx+w>target.width||dy+h>target.height)throw Error('AGE texture copy rectangle outside texture')
    if((target.parts?.length||0)>=1024)throw Error('AGE texture copy layer limit')
    target.parts=(target.parts||[]).filter(p=>!(p.x>=dx&&p.y>=dy&&p.x+p.crop[2]<=dx+w&&p.y+p.crop[3]<=dy+h))
    target.parts.push({src:source.src,crop:[sx,sy,w,h],x:dx,y:dy})
    if(!metadataOnly)for(let y=0;y<h;y++)source.rgba.copy(target.rgba,((dy+y)*target.width+dx)*4,((sy+y)*source.width+sx)*4,((sy+y)*source.width+sx+w)*4)
    return true
   }
   case 0x208: { const t = texture(n(0)); put(1, t.width); put(2, t.height); return true }
   case 0x215: put(0, objects.get(id(n(1)))?.texture ?? -1); return true
   case 0x216: put(0, textures.get(id(n(1)))?.ordinal ?? -1); return true
   case 0x217: object(n(0)).pivot = [n(1), n(2), n(3)]; return true
   case 0x218: { const pivot = objects.get(id(n(0)))?.pivot || [0, 0, 0]; for (let k = 0; k < 3; k++) put(k + 1, pivot[k]); return true }
   case 0x21a: {
    const o = objects.get(id(n(0)))
    if (o?.motion && now() < o.motion.started + o.motion.delay + o.motion.duration) return false
    put(1, (o?.x || 0) + (o?.motion?.to[0] || 0)); put(2, (o?.y || 0) + (o?.motion?.to[1] || 0)); put(3, o?.z || 0); return true
   }
   case 0x220: {
    // 423460 -> 49c990: delayed linear interpolation of the translation
    // matrix (delay +44, duration +58, target +1ac). 48c2bf..48c641 blends
    // matrix elements; 48c659 commits the target. Only planar translation is
    // supported here, with integer/variable scalar operands already decoded.
    const o = object(n(0)), delay = n(1), duration = n(2), to = [n(3), n(4), n(5)]
    if (!o.crop || ![delay, duration, ...to].every(Number.isFinite) || delay < 0 || duration < 0 || delay + duration > 120000 || to[2] !== 0) return false
    if (o.motion && now() < o.motion.started + o.motion.delay + o.motion.duration) return false
    const from = o.motion?.to || [0, 0, 0]
    o.motion = { token: ++motionSequence, from: [...from], to, started: now(), delay, duration }
    return true
   }
   case 0x242: {
    // 4247c0 -> 49cf70 writes +2d0 in the draw record. Its consumers
    // 48b94f/48c854 use bit 0 during timed property updates; this is NOT
    // object visibility. Static draws have no pending interpolation. Preserve
    // the flag without changing the image. Timed update opcodes still fail
    // closed, so their behavior cannot be silently flattened by this subset.
    const policy = n(1)
    if (policy !== 0 && policy !== 1) return false
    object(n(0)).updatePolicy = policy; return true
   }
   case 0x1fb: {
    const target = id(n(0)), key = id(n(1)), t = texture(key), crop = [n(2), n(3), n(4), n(5)], x = n(6), y = n(7)
    if (crop.some(v => !Number.isInteger(v)) || crop[0] < 0 || crop[1] < 0 || crop[2] < 1 || crop[3] < 1 || crop[0] + crop[2] > t.width || crop[1] + crop[3] > t.height) throw Error('AGE draw rectangle outside texture')
    const o = object(target)
    if (o.motion && now() < o.motion.started + o.motion.delay + o.motion.duration) return false
    delete o.motion
    Object.assign(o, { texture: key, ordinal: t.ordinal, crop, x, y }); return true
   }
   default: return false
  }
 }
 return { instruction, textures, objects, referenced, get bytes() { return bytes },
  get blockingMs() { return Math.max(0, ...[...objects.values()].filter(o => o.motion && o.updatePolicy !== 1).map(o => o.motion.started + o.motion.delay + o.motion.duration - now())) } }
}
