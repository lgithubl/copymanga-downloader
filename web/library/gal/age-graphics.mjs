// Data-only AGE drawing primitives used by the native image-placement helper.
// Unsupported operations return false; callers must stop, never silently skip.
// Placement/query meanings are cross-checked against SC0000's native helper.
export function createAgeGraphics({ loadImage, maxBytes = 128 * 1024 * 1024, maxObjects = 2048, metadataOnly = false } = {}) {
 if (!Number.isInteger(maxBytes) || maxBytes < 16 || maxBytes > 512 * 1024 * 1024 || !Number.isInteger(maxObjects) || maxObjects < 1 || maxObjects > 8192) throw Error('AGE graphics budget invalid')
 const textures = new Map(), objects = new Map(), referenced = new Set()
 let bytes = 0
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
   case 0x1f9: {
    const ordinal = id(n(0)), target = id(n(1)), mode = n(2)
    // Only the native helper's full image load mode has been verified.
    if (mode !== -1) return false
    referenced.add(ordinal)
    const image = loadImage?.(ordinal)
    if (!image) throw Error('AGE image resource missing: ' + ordinal)
    setTexture(target, { ...image, ordinal }); return true
   }
   case 0x1fa: { const key = id(n(0)); bytes -= textures.get(key)?.byteLength || 0; textures.delete(key); return true }
   case 0x208: { const t = texture(n(0)); put(1, t.width); put(2, t.height); return true }
   case 0x215: put(0, objects.get(id(n(1)))?.texture ?? -1); return true
   case 0x216: put(0, textures.get(id(n(1)))?.ordinal ?? -1); return true
   case 0x217: object(n(0)).pivot = [n(1), n(2), n(3)]; return true
   case 0x218: { const pivot = objects.get(id(n(0)))?.pivot || [0, 0, 0]; for (let k = 0; k < 3; k++) put(k + 1, pivot[k]); return true }
   case 0x21a: { const o = objects.get(id(n(0))); put(1, o?.x || 0); put(2, o?.y || 0); put(3, o?.z || 0); return true }
   case 0x1fb: {
    const target = id(n(0)), key = id(n(1)), t = texture(key), crop = [n(2), n(3), n(4), n(5)], x = n(6), y = n(7)
    if (crop.some(v => !Number.isInteger(v)) || crop[0] < 0 || crop[1] < 0 || crop[2] < 1 || crop[3] < 1 || crop[0] + crop[2] > t.width || crop[1] + crop[3] > t.height) throw Error('AGE draw rectangle outside texture')
    Object.assign(object(target), { texture: key, ordinal: t.ordinal, crop, x, y }); return true
   }
   default: return false
  }
 }
 return { instruction, textures, objects, referenced, get bytes() { return bytes } }
}
