// Live2D Cubism（.moc3）模型层（WebGL）：把 gal-moc3.js 求出来的顶点 / 不透明度 / 绘制顺序 / 颜色画到一块 canvas 上，盖在舞台里（world 的子元素）。
// 数据来自服务端把 .l2d（ZIP：moc3 / model3.json / motion3.json / cdi3.json / KTX 纹理）展开成的虚拟文件（containers.mjs）；纹理是服务端解好的 PNG。
// 约定（真实 g08 的 ev_cg*.l2d 对过）：顶点 y 向下、画布像素 = 位置 × pixelsPerUnit + 画布原点；UV 直接用，纹理按解出来的原样（第一行在上）。
// 剪裁（clipping mask）：先把蒙版网格的纹理 alpha（不乘不透明度——Cubism 里不透明度 0 的蒙版照样剪裁）取并集画进一张离屏的蒙版，再用它乘被剪裁的网格；flags 的 bit3 = 反转（只画蒙版之外）。
// 混合：普通 = 预乘 alpha；加 = (ONE, ONE)；乘 = (DST_COLOR, ONE_MINUS_SRC_ALPHA)。颜色：乘色 / 屏幕色（moc3 4.02 的关键形态颜色，沿变形器链叠）。
// 马赛克：userdata3.json 里标了 mosaic 的 ArtMesh 用马赛克着色器（krkrlive2d.dll 里的原样：到它为止的画面按 16 像素的格子取样）。
// 没做：物理（physics3.json）/ 姿势 / 表情 / 口型 / 眨眼；motion3 的 FadeIn / FadeOut；混合形状参数。
//
// spec（engine 的 state.live2d / scene 的 live2d 指令）：{ src: model3.json 的资源路径, motion?: 名字（动作文件名去掉 .motion3.json，或 r3h 这种「_03h」的简写）, loop?: boolean, variables?: { 参数显示名或 Id: 值 } }
import { createFrame, evaluateMotion, parseMoc3, parseMotion, updateModel } from './gal-moc3.js'

const VERT = `attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;
varying vec2 v_scr;
void main() { v_uv = a_uv; v_scr = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`
const FRAG = `precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_mask;
uniform vec2 u_res;
uniform vec3 u_mul;
uniform vec3 u_scr;
uniform float u_opacity;
uniform int u_maskMode;
void main() {
  vec4 t = texture2D(u_tex, v_uv);
  t.rgb = t.rgb * u_mul;
  t.rgb = (t.rgb + u_scr * t.a) - (t.rgb * u_scr);
  float a = t.a * u_opacity;
  if (u_maskMode > 0) {
    float m = texture2D(u_mask, gl_FragCoord.xy / u_res).r;
    a *= (u_maskMode == 2) ? (1.0 - m) : m;
  }
  gl_FragColor = vec4(t.rgb * a, a);
}`
// 马赛克（userdata3.json 里 Value = "mosaic" 的 ArtMesh）：krkrlive2d.dll 里的着色器原样——把「到这个网格为止已经画好的画面」按格子取样（格 = 画布 / 16 像素；ceil 取格子的右上角），
// 网格的形状 + 剪裁蒙版决定哪里打码，alpha 恒为 1（不看网格的纹理，那块纯绿色只是标记）
const MOSAIC_FRAG = `precision highp float;
varying vec2 v_scr;
uniform sampler2D u_scene;
uniform sampler2D u_mask;
uniform vec2 u_res;
uniform vec2 u_param;
uniform int u_maskMode;
void main() {
  vec2 tc = ceil(v_scr * u_param) / u_param;
  vec4 c = texture2D(u_scene, tc);
  float a = 1.0;
  if (u_maskMode > 0) {
    float m = texture2D(u_mask, gl_FragCoord.xy / u_res).r;
    a = (u_maskMode == 2) ? (1.0 - m) : m;
  }
  gl_FragColor = vec4(c.rgb * a, a);
}`
const MOSAIC_CELL = 16   // krkrlive2d.dll 里的默认格子大小（像素，模型画布上）
const MASK_FRAG = `precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() { float a = texture2D(u_tex, v_uv).a; gl_FragColor = vec4(a, a, a, a); }`

const dirOf = (p) => String(p).replace(/[^/]*$/, '')
// motion 名 → motion3.json 的文件：先找「名字.motion3.json」，再把 r3h 这种简写当成「…_03h」（脚本里的 motion 只有 r0 r1 r2 r3 r3h r5 r5s，对应 ev_mv001_02_00 … _05s）
export function pickMotionFile(files, name) {
  if (!name || !files?.length) return ''
  const base = (f) => String(f).replace(/^.*\//, '').replace(/\.motion3\.json$/i, '')
  const exact = files.find((f) => base(f) === name)
  if (exact) return exact
  // 同一个游戏里各模型包的动作文件前缀不统一（g09 おっぱいスパイ学園：ev_cg001_02 的是 ev_mv001_02r1，ev_cg003_02 的是 mv003_02r1，而脚本里一律叫 ev_mv…）：去掉 ev_ 前缀、不分大小写再对一次
  const plain = (n) => String(n).replace(/^ev_/i, '').toLowerCase()
  const loose = files.find((f) => plain(base(f)) === plain(name))
  if (loose) return loose
  const short = /^r(\d)(.*)$/i.exec(name)
  if (short) return files.find((f) => new RegExp(`_0${short[1]}${short[2]}$`, 'i').test(base(f))) || ''
  return files.find((f) => base(f).endsWith(`_${name}`)) || ''
}
// 参数：model3.json 的 cdi3（显示名 → Id）把脚本里的 variables（键是显示名，也可能直接是 Id）变成参数值
export function applyVariables(model, nameToId, variables, params) {
  let hit = 0
  for (const [key, value] of Object.entries(variables || {})) {
    const id = nameToId.get(key) ?? (model.paramIndex.has(key) ? key : null)
    const index = id === null ? undefined : model.paramIndex.get(id)
    if (index === undefined || !Number.isFinite(Number(value))) continue
    params[index] = Number(value)
    hit += 1
  }
  return hit
}

// Apply the model's declared expression after motion evaluation, as Cubism
// expressions blend parameter values rather than replacing the motion itself.
export function applyExpression(model, expression, params) {
  for (const p of expression?.Parameters || []) {
    const i = model.paramIndex.get(p.Id), value = Number(p.Value)
    if (i === undefined || !Number.isFinite(value)) continue
    if (p.Blend === 'Multiply') params[i] *= value
    else if (p.Blend === 'Overwrite') params[i] = value
    else if (!p.Blend || p.Blend === 'Add') params[i] += value
  }
}

export function createLive2dLayer({ parent, before = null, url, onMissing = () => {}, onUnavailable = () => {} }) {
  const canvas = document.createElement('canvas')
  canvas.className = 'gal-live2d'
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
  canvas.hidden = true
  parent.insertBefore(canvas, before)   // before = 它要排在谁前面（null = 最后）：在背景 / 视频之上、立绘 / 骨骼之下
  let gl = null
  let destroyed = false
  let paused = false
  let raf = 0
  let token = 0   // 每次 set 加一：加载 / 动画回调里对不上就丢掉
  let runtime = null   // 当前在播的：{ model, frame, params, base, motion, loop, t0, spec, gpu }
  const models = new Map()   // src → Promise<{ model, textures: ImageBitmap[], motions: Map(file → motion), cdi, files }>
  let unavailable = false

  function init() {
    if (gl || unavailable) return gl
    const opts = { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: false }
    gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts)
    if (!gl) { unavailable = true; onUnavailable(); return null }
    const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s }
    const program = (frag) => { const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag)); gl.bindAttribLocation(p, 0, 'a_pos'); gl.bindAttribLocation(p, 1, 'a_uv'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p }
    try {
      const main = program(FRAG)
      const mask = program(MASK_FRAG)
      const mosaic = program(MOSAIC_FRAG)
      const loc = (p, n) => gl.getUniformLocation(p, n)
      const minmax = gl.MAX || gl.getExtension('EXT_blend_minmax')?.MAX_EXT
      gl2 = { main, mask, minmax, u: { tex: loc(main, 'u_tex'), mask: loc(main, 'u_mask'), res: loc(main, 'u_res'), mul: loc(main, 'u_mul'), scr: loc(main, 'u_scr'), opacity: loc(main, 'u_opacity'), maskMode: loc(main, 'u_maskMode') }, um: { tex: loc(mask, 'u_tex') }, mosaic, uo: { scene: loc(mosaic, 'u_scene'), mask: loc(mosaic, 'u_mask'), res: loc(mosaic, 'u_res'), param: loc(mosaic, 'u_param'), maskMode: loc(mosaic, 'u_maskMode') }, sceneTex: null, maskTex: null, fbo: null, size: [0, 0] }
    } catch (error) { unavailable = true; onUnavailable(error); gl = null; return null }
    return gl
  }
  let gl2 = null

  async function fetchJson(src) {
    const res = await fetch(url(src))
    if (!res.ok) throw new Error(`${res.status}`)
    return res.json()
  }
  function loadModel(src) {
    if (models.has(src)) return models.get(src)
    const promise = (async () => {
      let json
      try { json = await fetchJson(src) } catch { onMissing(src); throw new Error('model3.json') }
      const refs = json.FileReferences || {}
      const dir = dirOf(src)
      const mocRes = await fetch(url(dir + refs.Moc))
      if (!mocRes.ok) { onMissing(dir + refs.Moc); throw new Error('moc3') }
      const model = parseMoc3(new Uint8Array(await mocRes.arrayBuffer()))
      const textures = []
      for (const t of refs.Textures || []) {
        const res = await fetch(url(dir + t))
        if (!res.ok) { onMissing(dir + t); throw new Error('texture') }
        textures.push(await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      }
      let cdi = null
      if (refs.DisplayInfo) { try { cdi = await fetchJson(dir + refs.DisplayInfo) } catch { /* 没有显示名表：variables 的键要直接是 Id */ } }
      let mosaic = new Set()
      if (refs.UserData) {
        try {
          const ud = await fetchJson(dir + refs.UserData)
          const wanted = new Set((ud.UserData || []).filter((u) => u?.Target === 'ArtMesh' && u.Value === 'mosaic').map((u) => u.Id))
          mosaic = new Set(model.artMeshIds.map((id, i) => (wanted.has(id) ? i : -1)).filter((i) => i >= 0))
        } catch { /* 没有 userdata：没有马赛克网格 */ }
      }
      const files = []
      for (const group of Object.values(json.FileReferences?.Motions || {})) for (const m of group) if (m?.File) files.push(m.File)
      return { model, textures, motions: new Map(), expressions: new Map(), expressionFiles: refs.Expressions || [], cdi, files, dir, mosaic, nameToId: new Map((cdi?.Parameters || []).map((p) => [p.Name, p.Id])) }
    })()
    promise.catch(() => models.delete(src))
    models.set(src, promise)
    return promise
  }

  async function loadMotion(entry, file) {
    if (!file) return null
    if (!entry.motions.has(file)) entry.motions.set(file, fetch(url(entry.dir + file)).then((r) => { if (!r.ok) { onMissing(entry.dir + file); return null } return r.json() }).then((j) => (j ? parseMotion(j) : null)).catch(() => null))
    return entry.motions.get(file)
  }

  // ---- GPU 资源 ----
  function buildGpu(entry) {
    if (entry.gpu) return entry.gpu
    const { model } = entry
    const textures = entry.textures.map((bitmap) => {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
      const pot = (n) => (n & (n - 1)) === 0
      if (pot(bitmap.width) && pot(bitmap.height)) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR) } else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      return tex
    })
    const meshes = []
    for (let i = 0; i < model.counts.artMeshes; i++) {
      const vc = model.artVertexCount[i]
      const ic = model.artIndexCount[i]
      const pos = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, pos)
      gl.bufferData(gl.ARRAY_BUFFER, vc * 8, gl.DYNAMIC_DRAW)
      const uv = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, uv)
      gl.bufferData(gl.ARRAY_BUFFER, model.uvs.slice(model.artUvStart[i], model.artUvStart[i] + vc * 2), gl.STATIC_DRAW)
      const idx = gl.createBuffer()
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, model.vertexIndices.slice(model.artIndexStart[i], model.artIndexStart[i] + ic), gl.STATIC_DRAW)
      meshes.push({ pos, uv, idx, count: ic, vc, scratch: new Float32Array(vc * 2) })
    }
    entry.gpu = { textures, meshes }
    return entry.gpu
  }
  function ensureMask(w, h) {
    if (gl2.fbo && gl2.size[0] === w && gl2.size[1] === h) return
    if (gl2.fbo) { gl.deleteFramebuffer(gl2.fbo); gl.deleteTexture(gl2.maskTex); gl.deleteTexture(gl2.sceneTex) }
    gl2.sceneTex = gl.createTexture()   // 马赛克用：当前画面的拷贝
    gl.bindTexture(gl.TEXTURE_2D, gl2.sceneTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl2.maskTex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, gl2.maskTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl2.fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl2.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl2.maskTex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl2.size = [w, h]
  }

  function draw(entry, frame) {
    const { model } = entry
    const gpu = buildGpu(entry)
    const { pixelsPerUnit: ppu, originX, originY, width: cw, height: ch } = model.canvas
    // 画布分辨率：模型画布大小，但最长边不超过 1920
    const k = Math.min(1, 1920 / Math.max(cw, ch))
    const w = Math.round(cw * k)
    const h = Math.round(ch * k)
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    ensureMask(w, h)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    // 顶点 → 裁剪空间（y 向下的画布像素）
    const sx = (2 * ppu) / cw
    const sy = (-2 * ppu) / ch
    const ox = (2 * originX) / cw - 1
    const oy = 1 - (2 * originY) / ch
    // 顶点要给所有网格上传：不画的网格（不透明度 0 / 被禁用）常被别的网格当遮罩用（遮罩只看形状 / 贴图 alpha，不看不透明度）。
    // 以前只上传 renderOrder 里的网格 → 这些「隐藏的遮罩网格」位置是空的，遮罩等于没有（ev_cg003_02 的 ArtMesh37 = 肚子轮廓，用来把 ちん 被肚子盖住的部分擦掉）
    for (let i = 0; i < gpu.meshes.length; i++) {
      const mesh = gpu.meshes[i]
      if (!mesh || !mesh.vc) continue
      const v = frame.vertices[i]
      for (let n = 0; n < mesh.vc; n++) { mesh.scratch[n * 2] = v[n * 2] * sx + ox; mesh.scratch[n * 2 + 1] = v[n * 2 + 1] * sy + oy }
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mesh.scratch)
    }
    let lastMaskKey = ''
    const bindMesh = (mesh) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx)
    }
    for (const i of frame.renderOrder) {
      const mesh = gpu.meshes[i]
      if (!mesh.count) continue
      const flags = model.artFlags[i]
      const blend = flags & 3
      const inverted = Boolean(flags & 8)
      const maskStart = model.artMaskStart[i]
      const maskList = []
      for (let n = 0; n < model.artMaskCount[i]; n++) { const mi = model.maskIndices[maskStart + n]; if (mi !== 0xffffffff && gpu.meshes[mi]) maskList.push(mi) }
      if (maskList.length) {
        const key = maskList.join(',')
        if (key !== lastMaskKey) {
          lastMaskKey = key
          gl.bindFramebuffer(gl.FRAMEBUFFER, gl2.fbo)
          gl.viewport(0, 0, w, h)
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          gl.useProgram(gl2.mask)
          gl.enable(gl.BLEND)
          gl.blendEquation(gl2.minmax)
          gl.blendFunc(gl.ONE, gl.ONE)
          for (const mi of maskList) {
            const mm = gpu.meshes[mi]
            if (!mm.count) continue
            bindMesh(mm)
            gl.activeTexture(gl.TEXTURE0)
            gl.bindTexture(gl.TEXTURE_2D, gpu.textures[model.artTexture[mi]])
            gl.uniform1i(gl2.um.tex, 0)
            gl.drawElements(gl.TRIANGLES, mm.count, gl.UNSIGNED_SHORT, 0)
          }
          gl.blendEquation(gl.FUNC_ADD)
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.viewport(0, 0, w, h)
        }
      }
      if (entry.mosaic.has(i)) {
        if (!showMosaic) continue   // 「更多 → 显示马赛克层」关着（默认）：着色器马赛克网格不画；烘焙在贴图里的格子去不掉
   // 马赛克网格：先把到现在为止的画面拷下来，再按格子取样画进网格形状里
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, gl2.sceneTex)
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h)
        gl.useProgram(gl2.mosaic)
        gl.enable(gl.BLEND)
        gl.blendEquation(gl.FUNC_ADD)
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        bindMesh(mesh)
        gl.uniform1i(gl2.uo.scene, 0)
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, gl2.maskTex)
        gl.uniform1i(gl2.uo.mask, 1)
        gl.uniform2f(gl2.uo.res, w, h)
        gl.uniform2f(gl2.uo.param, cw / MOSAIC_CELL, ch / MOSAIC_CELL)
        gl.uniform1i(gl2.uo.maskMode, maskList.length ? (inverted ? 2 : 1) : 0)
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0)
        continue
      }
      gl.useProgram(gl2.main)
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      if (blend === 1) gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE)
      else if (blend === 2) gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE)
      else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      bindMesh(mesh)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, gpu.textures[model.artTexture[i]])
      gl.uniform1i(gl2.u.tex, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, gl2.maskTex)
      gl.uniform1i(gl2.u.mask, 1)
      gl.uniform2f(gl2.u.res, w, h)
      gl.uniform3f(gl2.u.mul, frame.colors[i * 6], frame.colors[i * 6 + 1], frame.colors[i * 6 + 2])
      gl.uniform3f(gl2.u.scr, frame.colors[i * 6 + 3], frame.colors[i * 6 + 4], frame.colors[i * 6 + 5])
      gl.uniform1f(gl2.u.opacity, frame.opacities[i])
      gl.uniform1i(gl2.u.maskMode, maskList.length ? (inverted ? 2 : 1) : 0)
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0)
    }
  }

  function renderAt(seconds) {
    const r = runtime
    if (!r || !gl) return
    r.params.set(r.base)
    if (r.motion) evaluateMotion(r.motion, seconds, r.entry.model, r.params, r.frame, r.loop)   // 不循环：停在最后一帧
    applyExpression(r.entry.model, r.expression, r.params)
    updateModel(r.entry.model, r.frame, r.params)
    draw(r.entry, r.frame)
  }
  const MIN_FRAME_MS = 1000 / 30
  function loop(now) {
    raf = 0
    if (destroyed || !runtime || paused) return
    if (!runtime.last || now - runtime.last >= MIN_FRAME_MS) {
      runtime.last = now
      if (!runtime.t0) runtime.t0 = now
      renderAt((now - runtime.t0) / 1000)
    }
    if (runtime.motion || !runtime.drawnOnce) { runtime.drawnOnce = true; raf = requestAnimationFrame(loop) }
  }
  const kick = () => { if (!raf && !paused && runtime) raf = requestAnimationFrame(loop) }

  const sig = (spec) => (spec ? JSON.stringify([spec.src, spec.motion || '', spec.expression || '', Boolean(spec.loop), spec.variables || null]) : '')
  let currentSig = ''
  let showMosaic = false

  return {
    // spec = null → 隐藏并停掉
    async set(spec) {
      if (destroyed) return
      const next = sig(spec)
      if (next === currentSig) return
      currentSig = next
      const mine = ++token
      if (!spec || !spec.src) { canvas.hidden = true; runtime = null; if (raf) { cancelAnimationFrame(raf); raf = 0 } return }
      if (!init()) return
      let entry
      try { entry = await loadModel(spec.src) } catch { return }
      if (destroyed || mine !== token) return
      const file = pickMotionFile(entry.files, spec.motion)
      const motion = await loadMotion(entry, file)
      if (destroyed || mine !== token) return
      let expression = null
      if (spec.expression) {
        const ref = entry.expressionFiles.find(x => x.Name === spec.expression)
        if (ref?.File) {
          if (!entry.expressions.has(ref.File)) entry.expressions.set(ref.File, fetchJson(entry.dir + ref.File).catch(() => { onMissing(entry.dir + ref.File); return null }))
          expression = await entry.expressions.get(ref.File)
        }
      }
      if (destroyed || mine !== token) return
      const frame = createFrame(entry.model)
      const base = Float32Array.from(entry.model.paramDefault)
      applyVariables(entry.model, entry.nameToId, spec.variables, base)
      runtime = { entry, frame, base, params: Float32Array.from(base), motion, expression, loop: Boolean(spec.loop), t0: 0, last: 0, drawnOnce: false, spec }
      canvas.hidden = false
      renderAt(0)
      kick()
    },
    setMosaic(value) { const next = Boolean(value); if (next === showMosaic) return; showMosaic = next; if (runtime) { renderAt(runtime.last ? (runtime.last - runtime.t0) / 1000 : 0); kick() } },
    setPaused(value) { paused = Boolean(value); if (paused) { if (raf) { cancelAnimationFrame(raf); raf = 0 } } else { if (runtime) runtime.last = 0; kick() } },
    info() { return runtime ? [{ src: runtime.spec.src, motion: runtime.spec.motion || '', motionFile: pickMotionFile(runtime.entry.files, runtime.spec.motion), meshes: runtime.entry.model.counts.artMeshes, drawn: runtime.frame.renderOrder.length }] : [] },
    glInfo() { return gl ? [{ renderer: gl.getParameter(gl.RENDERER), lost: gl.isContextLost?.() ?? false, canvas: `${canvas.width}×${canvas.height}` }] : [] },
    destroy() { destroyed = true; if (raf) cancelAnimationFrame(raf); runtime = null; canvas.remove(); try { gl?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* 没有就算了 */ } },
  }
}
