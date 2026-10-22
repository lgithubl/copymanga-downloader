// Gal 播放器的 Spine（3.8）渲染层：一个叠在背景上的 WebGL canvas，画规范场景里 spine 指令描述的骨骼动画（站位立绘、整幅静态画面）。
// 运行时是 Esotericsoftware 官方 spine-webgl 3.8（许可证限制，不进仓库：Dockerfile 构建时按固定提交下载到 /vendor/spine-webgl.js，
// 本地用 scripts/fetch-spine-runtime.sh）；没有运行时就返回 null，播放器只提示、不渲染立绘。
// 骨骼文件两种都认：二进制（.skel.bytes，官方 SkeletonBinary）和 JSON（内容以 { 开头，SkeletonJson）。

let runtimePromise = null
export function loadSpineRuntime() {
  if (!runtimePromise) {
    runtimePromise = new Promise((resolve) => {
      if (globalThis.spine?.webgl) return resolve(globalThis.spine)
      const script = document.createElement('script')
      script.src = '/vendor/spine-webgl.js'
      script.onload = () => resolve(globalThis.spine?.webgl ? globalThis.spine : null)
      script.onerror = () => resolve(null)
      document.head.append(script)
    })
  }
  return runtimePromise
}

// 站位动作（一次性）：位移曲线 → { x, y } 偏移（占舞台高度的比例）
const ACTIONS = {
  1: (t) => ({ x: 0, y: Math.abs(Math.sin(t * Math.PI * 2)) * 0.03 }),   // 跳两下
  2: (t) => ({ x: Math.sin(t * Math.PI * 4) * 0.012, y: 0 }),            // 左右抖
  3: (t) => ({ x: 0, y: -Math.sin(Math.min(1, t) * Math.PI) * 0.07 }),   // 下沉再回来
}
const ACTION_SECONDS = { 1: 0.4, 2: 0.3, 3: 1.3 }

// 一个骨架数据只加载一次（按 skel 路径缓存）。onMissing(src)：文件取不到
export function createSpineLayer({ parent, url, onMissing = () => {}, onUnavailable = () => {} }) {
  const canvas = document.createElement('canvas')
  canvas.className = 'gal-spine'
  parent.append(canvas)
  let spine = null
  let gl = null
  let renderer = null
  let destroyed = false
  let raf = 0
  let last = 0
  let paused = false
  let initState = 'idle'   // idle | loading | ready | failed
  const instances = new Map()   // slot → { spec, key, data, skeleton, state, bounds, anim, dim, action }
  const dataCache = new Map()   // skel → Promise<{ data, atlas } | null>
  let pending = 0
  let waiters = []

  const settle = () => { if (!pending) { const done = waiters; waiters = []; done.forEach((resolve) => resolve()) } }
  const ready = () => (pending ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve())

  let initPromise = null
  const init = () => (initPromise ||= doInit())   // 几条 spine 指令同时来：等同一次初始化
  async function doInit() {
    initState = 'loading'
    spine = await loadSpineRuntime()
    if (!spine || destroyed) { initState = 'failed'; if (!spine) onUnavailable(); return false }
    try {
      const context = new spine.webgl.ManagedWebGLRenderingContext(canvas, { alpha: true, preserveDrawingBuffer: true })
      gl = context.gl
      renderer = new spine.webgl.SceneRenderer(canvas, context)
    } catch {
      initState = 'failed'
      onUnavailable()
      return false
    }
    initState = 'ready'
    return true
  }

  const fetchOk = async (src, as) => {
    const response = await fetch(url(src))
    if (!response.ok) throw new Error(String(response.status))
    return as === 'text' ? response.text() : response.arrayBuffer()
  }
  const loadImage = (src) => new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(src))
    image.src = url(src)
  })

  function loadData(spec) {
    if (dataCache.has(spec.skel)) return dataCache.get(spec.skel)
    const promise = (async () => {
      let stage = spec.skel
      try {
        const [bytes, atlasText] = await Promise.all([fetchOk(spec.skel, 'buffer'), (stage = spec.atlas, fetchOk(spec.atlas, 'text'))])
        const dir = spec.atlas.includes('/') ? spec.atlas.slice(0, spec.atlas.lastIndexOf('/') + 1) : ''
        const pages = atlasText.split(/\r?\n/).map((line) => line.trim()).filter((line) => /\.png$/i.test(line))
        const images = new Map()
        for (const page of pages) { stage = dir + page; images.set(page, await loadImage(dir + page)) }
        const atlas = new spine.TextureAtlas(atlasText, (page) => new spine.webgl.GLTexture(gl, images.get(page) || images.get(page.split('/').pop())))
        const loader = new spine.AtlasAttachmentLoader(atlas)
        const u8 = new Uint8Array(bytes)
        const firstByte = u8.find((b) => b > 32)
        const data = firstByte === 0x7b
          ? new spine.SkeletonJson(loader).readSkeletonData(JSON.parse(new TextDecoder().decode(u8)))
          : new spine.SkeletonBinary(loader).readSkeletonData(u8)
        return { data, atlas }
      } catch {
        onMissing(stage)
        return null
      }
    })()
    dataCache.set(spec.skel, promise)
    return promise
  }

  function pickAnimation(data, wanted, kind) {
    if (wanted && data.findAnimation(wanted)) return wanted
    if (kind === 'chara') return data.findAnimation('idle_normal') ? 'idle_normal' : data.animations[0]?.name || ''
    return data.animations[0]?.name || ''
  }

  // spec 变了：同一个骨架只换动画 / 颜色 / 位置，不重新加载
  function applySpec(inst, spec, live) {
    inst.spec = spec
    const name = pickAnimation(inst.data, spec.anim, spec.kind)
    if (name && (name !== inst.anim || inst.loop !== (spec.loop !== false))) {
      inst.state.setAnimation(0, name, spec.loop !== false)
      inst.anim = name
      inst.loop = spec.loop !== false
    }
    inst.state.timeScale = Number.isFinite(Number(spec.speed)) && Number(spec.speed) > 0 ? Number(spec.speed) : 1
    const shade = spec.dim ? 0.5 : 1
    inst.skeleton.color.set(shade, shade, shade, 1)
    if (live && spec.action && ACTIONS[spec.action]) inst.action = { kind: spec.action, began: performance.now() }
    else if (!live) inst.action = null
  }

  async function create(slot, spec, live, token) {
    pending += 1
    try {
      if (!(await init())) return
      const loaded = await loadData(spec)
      if (!loaded || destroyed) return
      const current = instances.get(slot)
      if (!current || current.token !== token) return   // 已经被新的指令取代
      const skeleton = new spine.Skeleton(loaded.data)
      skeleton.setToSetupPose()
      skeleton.updateWorldTransform()
      const offset = new spine.Vector2()
      const size = new spine.Vector2()
      skeleton.getBounds(offset, size, [])
      const state = new spine.AnimationState(new spine.AnimationStateData(loaded.data))
      Object.assign(current, { data: loaded.data, skeleton, state, bounds: { x: offset.x, y: offset.y, w: size.x || 1, h: size.y || 1 }, anim: '', loop: true })
      applySpec(current, spec, live)
      state.update(0)
      state.apply(skeleton)
      skeleton.updateWorldTransform()
      kick()
    } finally {
      pending -= 1
      settle()
    }
  }

  // specs：{ slot → 指令 }（状态里的 spines）；live = 正在播放这一步（站位动作才会动），false = 一步到位
  function set(specs, { live = false } = {}) {
    const wanted = specs || {}
    for (const slot of [...instances.keys()]) if (!wanted[slot]) instances.delete(slot)
    for (const [slot, spec] of Object.entries(wanted)) {
      const current = instances.get(slot)
      if (current && current.spec.skel === spec.skel && current.skeleton) { applySpec(current, spec, live); continue }
      if (current && current.spec.skel === spec.skel) { current.spec = spec; continue }   // 还在加载：只记最新的
      const token = Symbol(slot)
      instances.set(slot, { spec, token, skeleton: null })
      create(slot, spec, live, token)
    }
    canvas.hidden = instances.size === 0
    parent.dataset.spines = JSON.stringify(Object.fromEntries([...instances].map(([slot, inst]) => [slot, inst.anim || inst.spec.anim || ''])))
    kick()
    return ready()
  }

  function layout(inst, width, height) {
    const { x, y, w, h } = inst.bounds
    let scale
    let px
    let py
    if (inst.spec.kind === 'still') {
      scale = Math.min(width / w, height / h)
      px = width / 2 - (x + w / 2) * scale
      py = height / 2 - (y + h / 2) * scale
    } else {
      scale = (height * 0.95) / h
      px = (inst.spec.x ?? 0.5) * width - (x + w / 2) * scale
      py = -y * scale
    }
    if (inst.action) {
      const t = (performance.now() - inst.action.began) / 1000 / ACTION_SECONDS[inst.action.kind]
      if (t >= 1) inst.action = null
      else { const o = ACTIONS[inst.action.kind](t); px += o.x * height; py += o.y * height }
    }
    inst.skeleton.x = px
    inst.skeleton.y = py
    inst.skeleton.scaleX = scale
    inst.skeleton.scaleY = scale
  }

  function frame(now) {
    raf = 0
    if (destroyed || paused || initState !== 'ready') return
    const dt = Math.min(0.1, (now - (last || now)) / 1000)
    last = now
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr))
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    renderer.camera.position.set(width / 2, height / 2, 0)
    renderer.camera.setViewport(width, height)
    renderer.begin()
    const drawn = [...instances.values()].filter((inst) => inst.skeleton).sort((a, b) => (a.spec.kind === b.spec.kind ? (a.spec.order || 0) - (b.spec.order || 0) : a.spec.kind === 'still' ? -1 : 1))
    for (const inst of drawn) {
      inst.state.update(dt)
      inst.state.apply(inst.skeleton)
      layout(inst, width, height)
      inst.skeleton.updateWorldTransform()
      renderer.drawSkeleton(inst.skeleton, false)
    }
    renderer.end()
    if (drawn.length) kick()
    else last = 0
  }
  function kick() { if (!raf && !destroyed && !paused && initState === 'ready' && instances.size) raf = requestAnimationFrame(frame) }

  return {
    canvas,
    set,
    ready,
    setPaused(value) { paused = Boolean(value); if (paused) { cancelAnimationFrame(raf); raf = 0; last = 0 } else kick() },
    // 已经加载好的骨架数（测试 / 提示用）
    loadedCount: () => [...instances.values()].filter((inst) => inst.skeleton).length,
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      instances.clear()
      try { renderer?.dispose(); gl?.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* 无所谓 */ }
      canvas.remove()
    },
  }
}
