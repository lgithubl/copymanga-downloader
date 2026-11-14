// Original game fonts, served through the same bounded local resource API as
// images. Only the supplied private-use range changes; normal text keeps its
// existing UI font. Font objects are released when the scene is destroyed.
let sequence = 0
export function mountSceneFonts(target, fonts, resourceUrl, onError = () => {}) {
  const faces = [], original = target.style.fontFamily, fallback = getComputedStyle(target).fontFamily || 'sans-serif'
  let destroyed = false
  for (const row of (Array.isArray(fonts) ? fonts : []).slice(0, 2)) {
    if (typeof row?.src !== 'string' || row.src.length > 1024 || row.src.includes('\\') || row.src.includes(':') || row.src.startsWith('/') || row.src.split('/').some(p => !p || p === '.' || p === '..') || row.unicodeRange !== 'U+E000-E004') continue
    const name = 'GalPrivateFont' + (++sequence)
    const face = new FontFace(name, `url(${JSON.stringify(resourceUrl(row.src))})`, { unicodeRange: row.unicodeRange })
    faces.push(face)
    target.dataset.nativeFont = 'loading'
    face.load().then(() => {
      if (destroyed) return
      document.fonts.add(face)
      target.style.fontFamily = faces.map(f => JSON.stringify(f.family)).join(',') + ',' + fallback
      target.dataset.nativeFont = 'ready'
    }).catch(error => { if (!destroyed) { target.dataset.nativeFont = 'failed'; onError(row.src, error) } })
  }
  return () => { destroyed = true; for (const face of faces) document.fonts.delete(face); target.style.fontFamily = original; delete target.dataset.nativeFont }
}
