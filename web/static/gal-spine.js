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

// 选动画：指定的有就用；没有（名字对不上）→ 站位立绘退到 idle_normal → 名字以 idle 开头的 → 名字里带 idle 的 → 第一个。
// 对不上名字又什么都不播的话，骨架停在「初始姿势」——通常是各个部件散开的样子，看起来完全不是人
export function pickSpineAnimation(data, wanted, kind) {
  const names = (data.animations || []).map((animation) => animation.name)
  if (wanted && data.findAnimation(wanted)) return wanted
  if (kind === 'chara') {
    if (data.findAnimation('idle_normal')) return 'idle_normal'
    const idle = names.find((name) => /^idle/i.test(name)) || names.find((name) => /idle/i.test(name))
    if (idle) return idle
  }
  return names[0] || ''
}

// 皮肤：默认皮肤里一个附件都没有、却有别的皮肤（有的骨架把整套造型放在命名皮肤里）→ 用第一个有内容的命名皮肤，否则初始姿势下什么都画不出来
const skinSize = (skin) => (skin?.attachments || []).reduce((sum, bucket) => sum + Object.keys(bucket || {}).length, 0)
export function pickSpineSkin(data) {
  const skins = data.skins || []
  if (skinSize(data.defaultSkin) > 0 || skins.length < 2) return null
  return skins.find((skin) => skin !== data.defaultSkin && skinSize(skin) > 0) || null
}

// atlas 里每页声明的尺寸（size: w,h）。官方 3.8 运行时有两处拿「实际加载出来的图片尺寸」（texture.getImage().width）当分母：
// TextureAtlas 解析完覆盖页尺寸再算区域 UV，MeshAttachment.updateUVs 里算偏移 / 宽高。而 atlas 里的区域坐标是按声明尺寸写的——
// 图被缩小过（声明 4096、实际 PNG 2048，Unity 提取出来的资源常见）时，UV 整体放大一倍，立绘散成碎片、完全不是人。
// 游戏里的查看器按声明尺寸算，所以让贴图的 getImage() 报声明尺寸：GL 上传仍用真实图片（GLTexture 内部不走 getImage）。
export function declaredPageSizes(atlasText) {
  const sizes = new Map()
  const lines = String(atlasText).split(/\r?\n/).map((line) => line.trim())
  for (let i = 0; i < lines.length; i++) {
    if (!/\.(png|jpe?g|webp)$/i.test(lines[i])) continue
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      const m = /^size:\s*(\d+)\s*,\s*(\d+)/.exec(lines[j])
      if (m) { sizes.set(lines[i], [Number(m[1]), Number(m[2])]); break }
    }
  }
  return sizes
}
export function reportDeclaredSize(texture, size) {
  if (!size) return texture
  const image = texture.getImage()
  if (image && (image.width !== size[0] || image.height !== size[1])) texture.getImage = () => ({ width: size[0], height: size[1] })
  return texture
}

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
  let slowTo = 0.2   // animation4 降速后的倍率（1 = 不降速），播放器设置里改；set() 每次传进来

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
        const declared = declaredPageSizes(atlasText)
        const atlas = new spine.TextureAtlas(atlasText, (page) => reportDeclaredSize(new spine.webgl.GLTexture(gl, images.get(page) || images.get(page.split('/').pop())), declared.get(page)))
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
    return pickSpineAnimation(data, wanted, kind)
  }

  // spec 变了：同一个骨架只换动画 / 颜色 / 位置，不重新加载
  function applySpec(inst, spec, live) {
    inst.spec = spec
    // 多轨道（girlscreation 的角色：轨道 0 身体、轨道 1 表情，同时播）：spec.tracks = [{ track, anim, loop }]；名字对不上的轨道跳过并记下来（诊断面板里看）
    const tracked = Array.isArray(spec.tracks) && spec.tracks.length > 0
    const name = tracked ? (spec.tracks.find((t) => inst.data.findAnimation(t.anim))?.anim || '') : pickAnimation(inst.data, spec.anim, spec.kind)
    let changed = false
    if (tracked) {
      inst.trackSig = inst.trackSig || {}
      inst.missingAnims = []
      for (const t of spec.tracks) {
        if (!inst.data.findAnimation(t.anim)) { inst.missingAnims.push(t.anim); continue }
        const sig = `${t.anim}:${t.loop !== false}`
        if (inst.trackSig[t.track] === sig) continue
        inst.state.setAnimation(t.track, t.anim, t.loop !== false)
        inst.trackSig[t.track] = sig
        changed = true
      }
      inst.anim = name
      inst.loop = true
    } else {
      changed = Boolean(name) && (name !== inst.anim || inst.loop !== (spec.loop !== false))
      if (changed) {
        inst.state.setAnimation(0, name, spec.loop !== false)
        inst.anim = name
        inst.loop = spec.loop !== false
      }
    }
    // 位置（角色）：x / y 变了且这一步在播放（live）、spec.move > 0 → 从原来的位置平滑移到新位置；否则一步到位
    const to = { x: Number(spec.x) || 0, y: Number(spec.y) || 0 }
    if (live && Number(spec.move) > 0 && inst.pos && (inst.pos.x !== to.x || inst.pos.y !== to.y)) inst.moving = { from: { ...inst.pos }, to, began: performance.now(), ms: Number(spec.move) * 1000 }
    else inst.moving = null
    inst.pos = inst.moving ? inst.pos : to
    const speed = Number.isFinite(Number(spec.speed)) && Number(spec.speed) > 0 ? Number(spec.speed) : 1
    inst.state.timeScale = speed
    // 降速（animation4）：和原查看器一样，开始播放后 1 秒内把速度从 speed 渐变到 slowTo；一步到位（后退 / 续播）直接停在 slowTo
    const prevSlow = inst.slow
    inst.slow = null
    if (spec.slow && slowTo < 1) {
      if (!live) inst.state.timeScale = speed * slowTo
      else if (changed) inst.slow = { from: speed, to: speed * slowTo, began: performance.now() }
      else if (prevSlow) inst.slow = prevSlow   // 同一个动画里又来一步：渐变接着走，不重新来
      else inst.state.timeScale = speed * slowTo
    }
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
      const skin = pickSpineSkin(loaded.data)
      if (skin) skeleton.setSkin(skin)
      skeleton.setToSetupPose()
      skeleton.updateWorldTransform()
      const offset = new spine.Vector2()
      const size = new spine.Vector2()
      skeleton.getBounds(offset, size, [])
      const state = new spine.AnimationState(new spine.AnimationStateData(loaded.data))
      Object.assign(current, { skinName: skin?.name || '', data: loaded.data, skeleton, state, bounds: { x: offset.x, y: offset.y, w: size.x || 1, h: size.y || 1 }, anim: '', loop: true })
      applySpec(current, spec, live)
      if (live && Number(spec.fade) > 0) current.fadeIn = { began: performance.now(), ms: Number(spec.fade) * 1000 }
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
  function set(specs, { live = false, slow = slowTo } = {}) {
    slowTo = Number.isFinite(Number(slow)) && Number(slow) > 0 ? Math.min(1, Number(slow)) : 0.2
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
    parent.dataset.spines = JSON.stringify(Object.fromEntries([...instances].map(([slot, inst]) => [slot, inst.anim || inst.spec.anim || inst.spec.tracks?.[0]?.anim || ''])))
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
    } else if (inst.spec.kind === 'actor') {
      // 角色（girlscreation）：骨架包围盒先整个放进舞台（和 still 一样），再乘 spec.scale（绕舞台中心放大）；
      // x / y 是 1920x1080 设计稿里的像素偏移（和 CSS 的 translate 一样：x 向右、y 向下）。单位和锚点是照脚本参数猜的，没有原查看器的对照图
      let pos = inst.pos || { x: Number(inst.spec.x) || 0, y: Number(inst.spec.y) || 0 }
      if (inst.moving) {
        const t = Math.min(1, (performance.now() - inst.moving.began) / inst.moving.ms)
        pos = { x: inst.moving.from.x + (inst.moving.to.x - inst.moving.from.x) * t, y: inst.moving.from.y + (inst.moving.to.y - inst.moving.from.y) * t }
        if (t >= 1) { inst.pos = inst.moving.to; inst.moving = null }
      }
      scale = Math.min(width / w, height / h) * (Number(inst.spec.scale) > 0 ? Number(inst.spec.scale) : 1)
      px = width / 2 + pos.x * (width / 1920) - (x + w / 2) * scale
      py = height / 2 - pos.y * (height / 1080) - (y + h / 2) * scale
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
      if (inst.fadeIn) {
        const t = Math.min(1, (performance.now() - inst.fadeIn.began) / inst.fadeIn.ms)
        const shade = inst.spec.dim ? 0.5 : 1
        inst.skeleton.color.set(shade, shade, shade, t)
        if (t >= 1) inst.fadeIn = null
      }
      if (inst.slow) {
        const t = Math.min(1, (performance.now() - inst.slow.began) / 1000)
        inst.state.timeScale = inst.slow.from + (inst.slow.to - inst.slow.from) * t
        if (t >= 1) inst.slow = null
      }
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
    // 每个站位 / 静图的骨架信息（诊断面板用）：路径、要的动画 / 实际播的动画、骨架里有哪些动画和皮肤、边界、版本
    info: () => [...instances].map(([slot, inst]) => ({
      slot, skel: inst.spec.skel, atlas: inst.spec.atlas, kind: inst.spec.kind,
      requested: inst.spec.anim || (inst.spec.tracks || []).map((t) => `${t.track}:${t.anim}`).join(' '), used: inst.anim || '', loaded: Boolean(inst.skeleton), missingAnimations: inst.missingAnims || [],
      animations: inst.data ? inst.data.animations.map((animation) => animation.name) : [],
      skins: inst.data ? (inst.data.skins || []).map((skin) => `${skin.name}(${skinSize(skin)})`) : [], skin: inst.skinName || '',
      version: inst.data?.version || '', bounds: inst.bounds ? [inst.bounds.x, inst.bounds.y, inst.bounds.w, inst.bounds.h].map((n) => Math.round(n)) : null,
    })),
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
