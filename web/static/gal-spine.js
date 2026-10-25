// Gal 播放器的 Spine 渲染层：叠在背景上的 WebGL canvas，画规范场景里 spine 指令描述的骨骼动画（站位立绘、整幅静态画面）。
// 运行时是 Esotericsoftware 官方 spine-webgl，三个版本（许可证限制，不进仓库：Dockerfile 构建时下载到 /vendor/，本地用 scripts/fetch-spine-runtime.sh）：
//   3.8 → spine-webgl.js    4.0 → spine-webgl-4.0.js    4.2 → spine-webgl-4.2.js
// 每个骨骼先读文件头认出版本（二进制：头里的版本字符串；JSON：skeleton.spine），再选对应的运行时解析和绘制；认不出 / 不支持的版本如实报「版本不支持」，
// 不会冒充成缺资源。每个运行时各用一块 canvas（同一帧里不同版本的骨骼不交叉叠层，各自按顺序画）。没有运行时就只提示、不渲染。
// 骨骼文件两种都认：二进制（.skel / .skel.bytes）和 JSON（内容以 { 开头）。

export const SPINE_RUNTIMES = { '3.8': '/vendor/spine-webgl.js', '4.0': '/vendor/spine-webgl-4.0.js', '4.2': '/vendor/spine-webgl-4.2.js' }
const runtimePromises = new Map()
// version：SPINE_RUNTIMES 的键。3.8 沿用 <script>（全局 spine）；4.x 的包也是 `var spine = …`，几个都放全局会互相覆盖，
// 所以取文本、包进函数里执行，各自拿到自己的 spine 对象
export function loadSpineRuntime(version = '3.8') {
  if (!runtimePromises.has(version)) {
    runtimePromises.set(version, new Promise((resolve) => {
      const src = SPINE_RUNTIMES[version]
      if (!src) return resolve(null)
      if (version === '3.8') {
        if (globalThis.spine?.webgl) return resolve(globalThis.spine)
        const script = document.createElement('script')
        script.src = src
        script.onload = () => resolve(globalThis.spine?.webgl ? globalThis.spine : null)
        script.onerror = () => resolve(null)
        document.head.append(script)
        return
      }
      fetch(src)
        .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
        .then((text) => { const sp = new Function(`${text}\nreturn spine`)(); resolve(sp?.SceneRenderer ? sp : null) })
        .catch(() => resolve(null))
    }))
  }
  return runtimePromises.get(version)
}

// 从骨骼文件头认版本：二进制 = 头 96 字节里的版本字符串（3.8：先是 hash 字符串再是版本；4.x：8 字节 hash 再是版本）；JSON = skeleton.spine。
// runtime = 对应的运行时键（'3.8' | '4.0' | '4.2'），不支持的版本（3.7 / 4.1 / 4.3 …）是 ''
export function detectSpineVersion(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const format = u8.find((b) => b > 32) === 0x7b ? 'json' : 'binary'
  const head = String.fromCharCode(...u8.subarray(0, format === 'json' ? 2048 : 96))
  const version = format === 'json' ? /"spine"\s*:\s*"([^"]+)"/.exec(head)?.[1] || '' : /(\d{1,2}\.\d{1,2}\.\d{1,3})/.exec(head)?.[1] || ''
  const m = /^(\d+)\.(\d+)/.exec(version)
  const key = m ? `${m[1]}.${m[2]}` : ''
  return { format, version, runtime: SPINE_RUNTIMES[key] ? key : '' }
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

// 贴图是不是预乘 alpha（Spine 导出时勾了 Premultiply Alpha）：预乘贴图里半透明像素的 RGB 都不会超过 alpha，普通（直通）贴图的半透明边缘 RGB 常常比 alpha 大。
// 预乘贴图按普通贴图画，半透明的地方（脸颊腮红的渐变、关节接缝）就会发黑；所以要认出来，画的时候走预乘混合。
// 必须按原始尺寸检测：缩小会把边缘像素平均掉，预乘贴图也会出现大量「RGB > alpha」，被误判成直通（真实的 4096 图实测 7.8% 误判）。
// rgba = ImageData 的 data（浏览器取出来时已还原成直通值，近似即可）
export function countPremultiplied(rgba, acc = { semi: 0, bad: 0 }) {
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]
    if (a === 0 || a === 255) continue
    acc.semi += 1
    if (Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > a + 16) acc.bad += 1
  }
  return acc
}
export const isPremultipliedCount = ({ semi, bad }) => semi >= 50 && bad / semi < 0.002
export function premultipliedPixels(rgba) { return isPremultipliedCount(countPremultiplied(rgba)) }
// 一条一条（每条 ≤ 400 万像素）读，不一次开个 64MB 的 canvas；明显是直通就提前停
export function detectPremultipliedImage(image) { return detectPremultiplied(image) }   // 给测试用
function detectPremultiplied(image) {
  try {
    const w = image.naturalWidth || 1
    const h = image.naturalHeight || 1
    const band = Math.max(1, Math.min(h, Math.floor(4000000 / w)))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = band
    const g = canvas.getContext('2d', { willReadFrequently: true })
    const acc = { semi: 0, bad: 0 }
    for (let y = 0; y < h; y += band) {
      const rows = Math.min(band, h - y)
      g.clearRect(0, 0, w, band)
      g.drawImage(image, 0, y, w, rows, 0, 0, w, rows)
      countPremultiplied(g.getImageData(0, 0, w, rows).data, acc)
      if (acc.semi > 5000 && acc.bad / acc.semi > 0.05) break
    }
    return isPremultipliedCount(acc)
  } catch { return false }
}

// onMissing(src)：文件取不到（骨骼 / atlas / 图集）；onUnavailable(version)：这个版本的运行时没有；
// onError({ src, kind, version, runtime, message })：文件都取到了但不能用——kind: 'version'（版本不支持）| 'parse'（解析失败）
export function createSpineLayer({ parent, url, onMissing = () => {}, onUnavailable = () => {}, onError = () => {} }) {
  const canvases = []
  const makeCanvas = () => {
    const c = document.createElement('canvas')
    c.className = 'gal-spine'
    parent.append(c)
    canvases.push(c)
    return c
  }
  const canvas = makeCanvas()   // 第一块（给第一个用到的运行时）；别的版本的骨骼来了才再建
  const backends = new Map()    // 运行时版本 → Promise<后端 | null>
  const readyBackends = []      // 已经建好的后端：{ key, spine, ns, canvas, context, gl, renderer, physics }
  let destroyed = false
  let raf = 0
  let last = 0
  let paused = false
  const instances = new Map()   // slot → { spec, token, backend, data, skeleton, state, bounds, anim, dim, action, version, runtime, error }
  const dataCache = new Map()   // skel → Promise<{ data, atlas, backend, pma, version, runtime } | { error }>
  let pending = 0
  let waiters = []
  let slowTo = 0.2   // animation4 降速后的倍率（1 = 不降速），播放器设置里改；set() 每次传进来
  let stillView = { zoom: 1, cx: 0.5, cy: 0.5 }   // 静态画面的放大倍率 + 画面里哪一点放在舞台正中（cx / cy = 0..1，左→右、上→下）；播放器「更多」里改

  const settle = () => { if (!pending) { const done = waiters; waiters = []; done.forEach((resolve) => resolve()) } }
  const ready = () => (pending ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve())

  // 某个版本的运行时 + 它自己的 canvas / GL 上下文 / 渲染器
  function backendFor(key) {
    if (!backends.has(key)) {
      backends.set(key, (async () => {
        const spine = await loadSpineRuntime(key)
        if (destroyed) return null
        if (!spine) { onUnavailable(key); return null }
        try {
          const ns = spine.webgl?.SceneRenderer ? spine.webgl : spine   // 3.8 的类在 spine.webgl 下，4.x 是扁平的
          const cv = canvases.find((c) => !c.dataset.runtime) || makeCanvas()
          cv.dataset.runtime = key
          const context = new ns.ManagedWebGLRenderingContext(cv, { alpha: true, preserveDrawingBuffer: true })
          const backend = { key, spine, ns, canvas: cv, context, gl: context.gl, renderer: new ns.SceneRenderer(cv, context), physics: spine.Physics?.update }   // 4.2 的 updateWorldTransform 要传物理参数
          readyBackends.push(backend)
          return backend
        } catch {
          onUnavailable(key)
          return null
        }
      })())
    }
    return backends.get(key)
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

  // 一个骨架数据只加载一次（按 skel 路径缓存）。顺序：取骨骼 / atlas 文件 → 读版本、选运行时 → 取图集 → 解析。
  // 每一步失败都报对应的原因：取不到文件 = onMissing（缺资源）；版本不支持 / 解析失败 = onError（带识别出的版本），不再冒充缺资源
  function loadData(spec) {
    if (dataCache.has(spec.skel)) return dataCache.get(spec.skel)
    const promise = (async () => {
      let bytes
      let atlasText
      try { bytes = await fetchOk(spec.skel, 'buffer') } catch { onMissing(spec.skel); return { error: { kind: 'missing', message: `取不到骨骼文件 ${spec.skel}` } } }
      try { atlasText = await fetchOk(spec.atlas, 'text') } catch { onMissing(spec.atlas); return { error: { kind: 'missing', message: `取不到 atlas 文件 ${spec.atlas}` } } }
      const u8 = new Uint8Array(bytes)
      const detected = detectSpineVersion(u8)
      const base = { version: detected.version, runtime: detected.runtime, format: detected.format }
      console.info(`[gal-spine] ${spec.skel}：识别为 Spine ${detected.version || '未知版本'}（${detected.format === 'json' ? 'JSON' : '二进制'}）→ ${detected.runtime ? `运行时 ${detected.runtime}` : '没有对应的运行时'}`)
      const fail = (error) => { onError({ src: spec.skel, ...base, ...error }); return { error: { ...base, ...error } } }
      if (!detected.runtime) return fail({ kind: 'version', message: `Spine 版本 ${detected.version || '未知'} 不支持（支持 3.8 / 4.0 / 4.2）` })
      const backend = await backendFor(detected.runtime)
      if (!backend || destroyed) return { error: { ...base, kind: 'runtime', message: `Spine ${detected.runtime} 运行时不可用` } }   // onUnavailable 已经提示过
      const { spine, ns } = backend
      const dir = spec.atlas.includes('/') ? spec.atlas.slice(0, spec.atlas.lastIndexOf('/') + 1) : ''
      let atlas = null
      let pageNames
      try {
        if (detected.runtime === '3.8') pageNames = atlasText.split(/\r?\n/).map((line) => line.trim()).filter((line) => /\.(png|jpe?g|webp)$/i.test(line))
        else { atlas = new spine.TextureAtlas(atlasText); pageNames = atlas.pages.map((page) => page.name) }
      } catch (error) { return fail({ kind: 'parse', message: `atlas 解析失败（Spine ${detected.version}，运行时 ${detected.runtime}）：${String(error?.message || error).slice(0, 200)}` }) }
      const images = new Map()
      for (const page of pageNames) {
        try { images.set(page, await loadImage(dir + page)) } catch { onMissing(dir + page); return { error: { ...base, kind: 'missing', message: `取不到图集图片 ${dir + page}` } } }
      }
      try {
        const imageOf = (page) => images.get(page) || images.get(page.split('/').pop())
        if (detected.runtime === '3.8') {
          const declared = declaredPageSizes(atlasText)
          atlas = new spine.TextureAtlas(atlasText, (page) => reportDeclaredSize(new ns.GLTexture(backend.gl, imageOf(page)), declared.get(page)))
        } else {
          for (const page of atlas.pages) page.setTexture(new ns.GLTexture(backend.context, imageOf(page.name)))
        }
        const loader = new spine.AtlasAttachmentLoader(atlas)
        const data = detected.format === 'json'
          ? new spine.SkeletonJson(loader).readSkeletonData(JSON.parse(new TextDecoder().decode(u8)))
          : new spine.SkeletonBinary(loader).readSkeletonData(u8)
        return { data, atlas, backend, version: data.version || detected.version, runtime: detected.runtime, format: detected.format, pma: Boolean(atlas.pages?.some?.((page) => page.pma)) || [...images.values()].some(detectPremultiplied) }
      } catch (error) {
        return fail({ kind: 'parse', message: `骨骼解析失败（Spine ${detected.version}，运行时 ${detected.runtime}）：${String(error?.message || error).slice(0, 200)}` })
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
    // 角色抖动（SPINE_ACTOR_SHAKE）：同一个 id 只在播放中抖一次；一步到位（后退 / 续播）只记下 id，不补抖
    if (spec.shake && spec.shake.id !== inst.shakeId) {
      inst.shakeId = spec.shake.id
      inst.shake = live ? { x: Number(spec.shake.x) || 0, y: Number(spec.shake.y) || 0, seconds: Math.max(0.05, Number(spec.shake.seconds) || 1), began: performance.now() } : null
    }
    if (live && spec.action && ACTIONS[spec.action]) inst.action = { kind: spec.action, began: performance.now() }
    else if (!live) inst.action = null
  }

  async function create(slot, spec, live, token) {
    pending += 1
    try {
      const loaded = await loadData(spec)
      if (destroyed) return
      const current = instances.get(slot)
      if (!current || current.token !== token) return   // 已经被新的指令取代
      if (loaded.error) {   // 加载 / 解析失败：留在列表里，诊断面板能看到原因和识别出的版本
        Object.assign(current, { error: loaded.error, version: loaded.error.version || '', runtime: loaded.error.runtime || '' })
        return
      }
      const { backend } = loaded
      const sp = backend.spine
      const skeleton = new sp.Skeleton(loaded.data)
      const skin = pickSpineSkin(loaded.data)
      if (skin) skeleton.setSkin(skin)
      skeleton.setToSetupPose()
      skeleton.updateWorldTransform(backend.physics)
      const offset = new sp.Vector2()
      const size = new sp.Vector2()
      skeleton.getBounds(offset, size, [])
      const state = new sp.AnimationState(new sp.AnimationStateData(loaded.data))
      Object.assign(current, { backend, pma: Boolean(loaded.pma), version: loaded.version, runtime: loaded.runtime, error: null, skinName: skin?.name || '', data: loaded.data, skeleton, state, bounds: { x: offset.x, y: offset.y, w: size.x || 1, h: size.y || 1 }, anim: '', loop: true })
      applySpec(current, spec, live)
      if (live && Number(spec.fade) > 0) current.fadeIn = { began: performance.now(), ms: Number(spec.fade) * 1000 }
      state.update(0)
      state.apply(skeleton)
      skeleton.updateWorldTransform(backend.physics)
      kick()
    } finally {
      pending -= 1
      settle()
    }
  }

  // specs：{ slot → 指令 }（状态里的 spines）；live = 正在播放这一步（站位动作才会动），false = 一步到位
  const normalizeView = (view) => {
    const zoom = Number(view?.zoom)
    const unit = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0.5)
    return { zoom: Number.isFinite(zoom) && zoom > 0 ? Math.min(8, zoom) : 1, cx: unit(view?.cx), cy: unit(view?.cy) }
  }
  function set(specs, { live = false, slow = slowTo, view = stillView } = {}) {
    stillView = normalizeView(view)
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
    for (const cv of canvases) cv.hidden = instances.size === 0
    parent.dataset.spines = JSON.stringify(Object.fromEntries([...instances].map(([slot, inst]) => [slot, inst.anim || inst.spec.anim || inst.spec.tracks?.[0]?.anim || ''])))
    kick()
    return ready()
  }

  // 静态画面共用的参照层：序号最小的那层（底图）
  function stillReference(inst) {
    let ref = inst
    for (const other of instances.values()) {
      if (other.spec?.kind === 'still' && other.bounds && (other.spec.order || 0) < (ref.spec.order || 0)) ref = other
    }
    return ref
  }

  function layout(inst, width, height) {
    const { x, y, w, h } = inst.bounds
    let scale
    let px
    let py
    if (inst.spec.kind === 'still') {
      // 静态画面的各层共用同一套变换（它们在游戏里是同一个原点、同一个缩放叠在一起）：以最底下那一层（序号最小，底图）的包围盒放进舞台，
      // 其它层（人物、特效，包围盒不一样）按同一个缩放和原点画——不能各按各的包围盒缩放居中，不然小的层会被放大、错位；
      // 也不能按面积最大的层，比底图还大的特效层会把整幅画面缩小
      const rb = stillReference(inst).bounds
      // 放大倍率 × 完整放进舞台的比例；cx / cy 指的那一点放在舞台正中（边缘裁掉）。spine 坐标 y 向上，cy 从上往下数，所以取 1 - cy
      scale = Math.min(width / rb.w, height / rb.h) * stillView.zoom
      px = width / 2 - (rb.x + rb.w * stillView.cx) * scale
      py = height / 2 - (rb.y + rb.h * (1 - stillView.cy)) * scale
    } else if (inst.spec.kind === 'actor') {
      // 角色（girlscreation，照原查看器 scene.js 的 setSpineActorPos）：x / y 是骨骼坐标系的单位（skeleton.x = x，skeleton.y = -y：y 为正 = 往下），
      // 缩放（角色缩放 × 全局 ZOOM）绕骨骼原点，不是绕包围盒中心。骨架包围盒（x, y, w, h）按 still 的方式整个放进舞台得到基准比例 fit，
      // 原点的位置 = 包围盒中心在舞台中心时原点所在的位置
      let pos = inst.pos || { x: Number(inst.spec.x) || 0, y: Number(inst.spec.y) || 0 }
      if (inst.moving) {
        const t = Math.min(1, (performance.now() - inst.moving.began) / inst.moving.ms)
        pos = { x: inst.moving.from.x + (inst.moving.to.x - inst.moving.from.x) * t, y: inst.moving.from.y + (inst.moving.to.y - inst.moving.from.y) * t }
        if (t >= 1) { inst.pos = inst.moving.to; inst.moving = null }
      }
      const fit = Math.min(width / w, height / h)
      scale = fit * (Number(inst.spec.scale) > 0 ? Number(inst.spec.scale) : 1)
      px = width / 2 - (x + w / 2) * fit + pos.x * fit
      py = height / 2 - (y + h / 2) * fit - pos.y * fit
      if (inst.shake) {   // 衰减的来回晃：每秒 8 个来回，幅度线性衰减到 0（骨骼坐标单位 × fit）
        const t = (performance.now() - inst.shake.began) / 1000 / inst.shake.seconds
        if (t >= 1) inst.shake = null
        else { const o = Math.sin(t * inst.shake.seconds * 8 * Math.PI * 2) * (1 - t); px += o * inst.shake.x * fit; py += o * inst.shake.y * fit }
      }
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
    if (destroyed || paused || !readyBackends.length) return
    const dt = Math.min(0.1, (now - (last || now)) / 1000)
    last = now
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1)
    const sorted = [...instances.values()].filter((inst) => inst.skeleton).sort((a, b) => (a.spec.kind === b.spec.kind ? (a.spec.order || 0) - (b.spec.order || 0) : a.spec.kind === 'still' ? -1 : 1))
    let drawnCount = 0
    for (const backend of readyBackends) {   // 每个运行时一块 canvas：各画各的
      const { canvas: cv, gl, renderer } = backend
      const width = Math.max(1, Math.round(cv.clientWidth * dpr))
      const height = Math.max(1, Math.round(cv.clientHeight * dpr))
      if (cv.width !== width || cv.height !== height) { cv.width = width; cv.height = height }
      gl.viewport(0, 0, width, height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      const mine = sorted.filter((inst) => inst.backend === backend)
      if (!mine.length) continue
      renderer.camera.position.set(width / 2, height / 2, 0)
      renderer.camera.setViewport(width, height)
      renderer.begin()
      for (const inst of mine) {
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
        inst.skeleton.updateWorldTransform(backend.physics)
        renderer.drawSkeleton(inst.skeleton, Boolean(inst.pma))
        drawnCount += 1
      }
      renderer.end()
    }
    if (drawnCount) kick()
    else last = 0
  }
  function kick() { if (!raf && !destroyed && !paused && readyBackends.length && instances.size) raf = requestAnimationFrame(frame) }

  return {
    canvas,
    set,
    ready,
    // 只改静态画面的放大 / 中心（拖动选择时实时预览）；没有静态画面就什么也不做
    setStillView(view) { stillView = normalizeView(view); kick() },
    // 按「完整放进舞台」（放大 1、中心在正中）时静态画面占舞台的矩形（占舞台宽 / 高的比例），选中心时用来画参考框；没有静态画面是 null
    stillRect() {
      const cv = canvases.find((c) => c.clientWidth) || canvas
      const W = cv.clientWidth
      const H = cv.clientHeight
      const first = [...instances.values()].find((inst) => inst.spec.kind === 'still' && inst.bounds)
      if (!first || !W || !H) return null
      const rb = stillReference(first).bounds
      const fit = Math.min(W / rb.w, H / rb.h)
      const w = (rb.w * fit) / W
      const h = (rb.h * fit) / H
      return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
    },
    setPaused(value) { paused = Boolean(value); if (paused) { cancelAnimationFrame(raf); raf = 0; last = 0 } else kick() },
    // 每个站位 / 静图的骨架信息（诊断面板用）：路径、要的动画 / 实际播的动画、骨架里有哪些动画和皮肤、边界、版本
    info: () => [...instances].map(([slot, inst]) => ({
      slot, skel: inst.spec.skel, atlas: inst.spec.atlas, kind: inst.spec.kind,
      requested: inst.spec.anim || (inst.spec.tracks || []).map((t) => `${t.track}:${t.anim}`).join(' '), used: inst.anim || '', loaded: Boolean(inst.skeleton), missingAnimations: inst.missingAnims || [],
      animations: inst.data ? inst.data.animations.map((animation) => animation.name) : [],
      skins: inst.data ? (inst.data.skins || []).map((skin) => `${skin.name}(${skinSize(skin)})`) : [], skin: inst.skinName || '',
      version: inst.data?.version || inst.version || '', runtime: inst.runtime || '', error: inst.error?.message || '', errorKind: inst.error?.kind || '', bounds: inst.bounds ? [inst.bounds.x, inst.bounds.y, inst.bounds.w, inst.bounds.h].map((n) => Math.round(n)) : null,
    })),
    // 已经加载好的骨架数（测试 / 提示用）
    loadedCount: () => [...instances.values()].filter((inst) => inst.skeleton).length,
    destroy() {
      destroyed = true
      cancelAnimationFrame(raf)
      instances.clear()
      for (const backend of readyBackends) { try { backend.renderer.dispose(); backend.gl.getExtension('WEBGL_lose_context')?.loseContext() } catch { /* 无所谓 */ } }
      for (const cv of canvases) cv.remove()
    },
  }
}
