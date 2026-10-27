// Gal 播放器的 Spine 渲染层：叠在背景上的 WebGL canvas，画规范场景里 spine 指令描述的骨骼动画（站位立绘、整幅静态画面）。
// 运行时是 Esotericsoftware 官方 spine-webgl，四个版本（许可证限制，不进仓库：Dockerfile 构建时下载到 /vendor/，本地用 scripts/fetch-spine-runtime.sh）：
//   3.6 → spine-webgl-3.6.js    3.8 → spine-webgl.js    4.0 → spine-webgl-4.0.js    4.2 → spine-webgl-4.2.js
// 3.6 的官方 Web 运行时只有 JSON 加载器、没有二进制加载器：二进制的 3.6 骨骼先由 gal-spine36-binary.js 转成 3.6 JSON 结构，再交给官方 SkeletonJson 建数据。
// 每个骨骼先读文件头认出版本（二进制：头里的版本字符串；JSON：skeleton.spine），再选对应的运行时解析和绘制；认不出 / 不支持的版本如实报「版本不支持」，
// 不会冒充成缺资源。每个运行时各用一块 canvas（同一帧里不同版本的骨骼不交叉叠层，各自按顺序画）。没有运行时就只提示、不渲染。
// 骨骼文件两种都认：二进制（.skel / .skel.bytes）和 JSON（内容以 { 开头）。

import { spine36BinaryToJson } from './gal-spine36-binary.js'

export const SPINE_RUNTIMES = { '3.6': '/vendor/spine-webgl-3.6.js', '3.8': '/vendor/spine-webgl.js', '4.0': '/vendor/spine-webgl-4.0.js', '4.2': '/vendor/spine-webgl-4.2.js' }
const runtimePromises = new Map()
// version：SPINE_RUNTIMES 的键。3.8 沿用 <script>（全局 spine）；3.6 和 4.x 的包也是 `var spine = …`，几个都放全局会互相覆盖（3.6 和 3.8 要在同一个页面里共存），
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
        .then((text) => { const sp = new Function(`${text}\nreturn spine`)(); resolve(sp?.SceneRenderer || sp?.webgl?.SceneRenderer ? sp : null) })
        .catch(() => resolve(null))
    }))
  }
  return runtimePromises.get(version)
}

// 从骨骼文件头认版本：二进制 = 头 96 字节里的版本字符串（3.6 / 3.8：先是 hash 字符串再是版本；4.x：8 字节 hash 再是版本）；JSON = skeleton.spine。
// runtime = 对应的运行时键（'3.6' | '3.8' | '4.0' | '4.2'），不支持的版本（3.7 / 4.1 / 4.3 …）是 ''
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

// 分层脸部（maid 的角色：动画名是 eye/eye_001、eyebrow/…、mouse/…、cheek/… 这样一组一组的，脸是靠这些动画把附件一层层打开的；初始姿势里没有眼睛和嘴巴）。
// 脚本里写的是表情预设名（照れ / やれやれ …），原游戏用一张预设表把它展开成每个部件各一条轨道的动画——这张表在加密的 castData 里，我们读不了。
// 兜底：预设名对不上时，每个还没有动画的脸部分层先用一个中性的默认动画顶上（眼 / 眉 / 嘴 / 眼位 / 腮红 / 高光），至少不是没有眼睛和嘴巴；表情本身不对，拿到预设表再做。
const FACE_DEFAULTS = { eyemain: 'eyemain_001', eye: 'eye_001', eyebrow: 'eyebrow_001', eyepos: 'eyepos_normal', mouse: 'mouse_001', mouth: 'mouth_001', cheek: 'cheek_none', highlight: 'highlight_on' }
const FACE_TRACK_BASE = 20   // 默认脸用的轨道号（从 20 起，不和脚本里的轨道撞）
// 表情预设表（maid：脚本里写的是预设名，原游戏用加密的 castData 把它展开成每个部件第几号；这张表我们读不了，所以做成可配置的）。
// 形状：{ <范围>: { <预设名>: { <部件>: <后缀> } } }。范围 = 'default'（所有角色）或 角色目录名（cast009001）或 骨架文件名（nashwa_001），越具体越优先。
// 部件 = eye / eyebrow / mouse / eyemain / eyepos / cheek / highlight / sweat / tear；后缀是数字（3 → 003）或字符串（normal / none / on / off / half），对应动画 <部件>/<部件>_<后缀>，骨架里没有的部件 / 号码跳过（改用该部件的默认动画）。
// 同一范围里别的预设没写的部件，沿用这个范围里「通常」的。
// 内置的初始值只放有把握的：通常 = 各部件 001 / normal / none / on；照れ = 腮红 001；慌て / 大慌て / 苦笑い = 汗 001。其余预设先用通常的脸，在「更多 → 表情」里自己调。
export const DEFAULT_EXPRESSIONS = {
  default: {
    '通常': { eye: '001', eyebrow: '001', mouse: '001', eyemain: '001', eyepos: 'normal', cheek: 'none', highlight: 'on' },
    '照れ': { cheek: '001' },
    '慌て': { sweat: '001' },
    '大慌て': { sweat: '001' },
    '苦笑い': { sweat: '001' },
  },
}
// 合并两张表：范围取并集，同一范围里同一个预设按部件覆盖（后面的优先）
export function mergeExpressions(...tables) {
  const out = {}
  for (const table of tables) {
    for (const [scope, presets] of Object.entries(table || {})) {
      if (!presets || typeof presets !== 'object') continue
      out[scope] = out[scope] || {}
      for (const [preset, spec] of Object.entries(presets)) if (spec && typeof spec === 'object') out[scope][preset] = { ...(out[scope][preset] || {}), ...spec }
    }
  }
  return out
}
const faceSuffix = (token) => (typeof token === 'number' ? String(Math.trunc(token)).padStart(3, '0') : String(token))
// 预设名 → 要播的动画列表（骨架动画全名）；表里没有这个预设返回 null。castKey / skelBase 决定用哪个范围
export function resolveExpression({ table, castKey = '', skelBase = '', preset, names }) {
  const scopes = [castKey, skelBase, 'default'].filter((key, i, list) => key && list.indexOf(key) === i && table?.[key])
  const scope = scopes.find((key) => table[key][preset])
  if (!scope) return null
  const base = preset === '通常' ? {} : (scopes.map((key) => table[key]['通常']).find(Boolean) || {})
  const merged = { ...base, ...table[scope][preset] }
  const anims = []
  for (const [group, token] of Object.entries(merged)) {
    const full = `${group}/${group}_${faceSuffix(token)}`
    if (names.includes(full)) anims.push(full)
  }
  return { anims: [...anims, ...faceDefaultsFor(names, anims)], scope }   // 表里没写 / 骨架里没有的部件用该部件的默认动画
}
// 脚本里的骨架路径 → 角色目录名（cast009001）和骨架文件名（nashwa_001）
export function castKeysOf(skel) {
  const text = String(skel || '')
  return { castKey: /(?:^|\/)(cast\d+)\//.exec(text)?.[1] || '', skelBase: text.split('/').pop().replace(/\.[^.]+$/, '') }
}

// 是不是分层脸骨架（动画名是 eye/eye_001、mouse/… 这样一组一组的）
export const layeredFace = (data) => (data?.animations || []).some((animation) => /^(?:eye|eyebrow|eyemain|eyepos|mouse|mouth|cheek|highlight)\//.test(animation.name))
export function faceDefaultsFor(names, played) {
  const covered = new Set(played.filter((name) => name.includes('/')).map((name) => name.split('/')[0]))
  const out = []
  for (const group of Object.keys(FACE_DEFAULTS)) {
    if (covered.has(group)) continue
    const inGroup = names.filter((name) => name.startsWith(`${group}/`))
    if (!inGroup.length) continue
    const wanted = `${group}/${FACE_DEFAULTS[group]}`
    out.push(inGroup.includes(wanted) ? wanted : inGroup.find((name) => !/none|off/i.test(name)) || inGroup[0])
  }
  return out
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

// ---------- 渲染诊断：骨架「静默」的问题（以前只在控制台或根本没有）----------
// 包围盒怎么来的：setup = 初始姿势；animation = 初始姿势没有可见附件（附件由动画打开），按动画首帧（及之后几个很短的时间点）算；
// header = 动画里也没有，用骨骼文件头里的 width / height 估算；none = 都没有（包围盒为空，画不出东西）
export const BOUNDS_SOURCES = ['setup', 'animation', 'header', 'none']
const slotAttachment = (slot) => (typeof slot.getAttachment === 'function' ? slot.getAttachment() : slot.attachment)
const finiteBox = (offset, size) => [offset.x, offset.y, size.x, size.y].every(Number.isFinite) && size.x > 0 && size.y > 0
const attachedCount = (skeleton) => (skeleton.slots || []).filter((slot) => slotAttachment(slot)).length
const listNames = (names, max = 12) => `${names.slice(0, max).join(', ')}${names.length > max ? ` 等 ${names.length} 个` : ''}`

// 把 info() 的一项（见 info）变成中文问题行；没有问题 = []。纯函数（测试直接喂对象）。
// 覆盖：(a) 要的动画骨架里没有（按轨道）(b) 要的皮肤没有 (c) 多轨道里有轨道没播（写明原因）(d) 图集页 / 贴图缺失 (e) 加载成功但没有可见附件 / 包围盒为空
export function spineProblemLines(item) {
  const lines = []
  if (!item) return lines
  if (item.missingPages?.length) lines.push(`图集贴图缺失：${listNames(item.missingPages)}（atlas 声明 ${item.atlasPages || item.missingPages.length} 页，缺 ${item.missingPages.length} 页）——骨架整个没有加载，画面上没有它`)
  if (!item.loaded) return lines
  const names = item.animations || []
  const tracks = item.requestedTracks || []
  const multi = tracks.length > 1 || (tracks.length === 1 && tracks[0].track !== 0)
  for (const t of tracks) {
    if (t.found) continue
    const where = multi ? `轨道 ${t.track} 要播的动画「${t.anim}」` : `要播的动画「${t.anim}」`
    const fallback = item.faceDefaults?.length ? '，已按表情预设 / 默认脸处理（见表情行）' : !multi && item.used ? `，改播「${item.used}」` : multi ? '，这条轨道没有播' : '，没有播任何动画（骨架停在初始姿势）'
    lines.push(`${where}骨架里没有${fallback}（骨架里有 ${names.length} 个动画：${listNames(names, 8) || '无'}）`)
  }
  if (multi) {
    const applied = tracks.filter((t) => t.found)
    const missing = tracks.filter((t) => !t.found)
    if (missing.length) lines.push(`多轨道：要 ${tracks.map((t) => `${t.track}:${t.anim}`).join(' ')} → 实际应用 ${applied.length ? applied.map((t) => `${t.track}:${t.anim}`).join(' ') : '（无）'}；没应用的轨道原因：动画名在骨架里不存在`)
  }
  if (item.skinRequested && !item.skinFound) lines.push(`要的皮肤「${item.skinRequested}」骨架里没有${item.skin ? `，改用「${item.skin}」` : '，用默认皮肤'}（骨架里的皮肤：${(item.skins || []).map((s) => s.replace(/\(\d+\)$/, '')).join(', ') || '无'}）`)
  if (item.boundsSource === 'animation') lines.push('初始姿势没有可见附件，已按动画首帧计算包围盒')
  else if (item.boundsSource === 'header') lines.push(`初始姿势和动画首帧都没有可见附件，包围盒按骨骼文件头的宽高估算（${item.bounds ? item.bounds.join(' ') : '?'}）——动画 / 皮肤是否选对？可能画不出东西`)
  else if (item.boundsSource === 'none' || item.boundsEmpty) lines.push(`包围盒为空：骨架加载成功，但初始姿势${item.animationsTried ? '和动画首帧' : ''}都没有可见附件（共 ${item.slotCount ?? '?'} 个槽，附件 ${item.attachmentsSetup ?? 0} 个可见），骨骼文件头也没有宽高——画面上不会有东西（检查动画 / 皮肤 / 贴图区域名）`)
  else if (item.slotCount === 0) lines.push('骨架里没有任何槽（slots 为空），没有东西可画')
  return lines
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
  // 放大倍率 + 哪一点放在舞台正中（cx / cy = 0..1，左→右、上→下），静态画面（still）和角色（actor）各一份；播放器「更多」里改，按媒体存
  let views = { still: { zoom: 1, cx: 0.5, cy: 0.5 }, actor: { zoom: 1, cx: 0.5, cy: 0.5 } }
  // 角色（actor）怎么摆：'fit' = 自动（把骨架包围盒放进舞台居中，脚本里的 x / y / 缩放按这个比例算——默认，和以前一样）；
  // 'widget' = Aku 原版查看器的 fitToCanvas（见下面 WIDGET_*）；
  // 'fixed' = 固定相机（Girls Creation R Viewer 的做法：世界窗口宽 width 个骨骼单位、中心在 (cx, cy)，每个单位 = 舞台宽 / width 个像素，原点落在 舞台中心 + (x − cx, −(y + cy)) 个单位，缩放绕原点）。
  // 不同游戏的查看器相机常数不一样（只有 Girls Creation R Viewer 的读过源码：1920 / 0 / 900），所以做成「更多」里可调的，按媒体存
  let camera = { mode: 'fit', width: 1920, cx: 0, cy: 900 }
  // 'widget' = 原版 spine-widget 的 fitToCanvas（Aku 查看器）：常数都是它 spine-widget.js / preloader.js 里写死的
  const WIDGET_WINDOW = 2.2
  const WIDGET_STAGE_W = 1280
  const WIDGET_STAGE_H = 720
  const WIDGET_BOTTOM = 120
  // 混合模式覆盖（有的显卡驱动上 additive / multiply / screen 会画成白屏，见渲染诊断的 WebGL 一行）：
  // 'native' = 骨骼原样（默认）；'noAdditive' = additive 改按普通画（光效变成普通叠加）；'allNormal' = additive / multiply / screen 全按普通画
  let blendOverride = 'native'
  const applyBlendOverride = (data) => {
    for (const slot of data?.slots || []) {
      if (slot.originalBlendMode === undefined) slot.originalBlendMode = slot.blendMode
      const original = slot.originalBlendMode
      slot.blendMode = blendOverride === 'allNormal' && original !== 0 ? 0 : blendOverride === 'noAdditive' && original === 1 ? 0 : original
    }
  }
  let expressionTable = mergeExpressions(DEFAULT_EXPRESSIONS)   // 内置初始值 + 配置 + 这个媒体自己调的（播放器合并好传进来）

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
      if (!detected.runtime) return fail({ kind: 'version', message: `Spine 版本 ${detected.version || '未知'} 不支持（支持 3.6 / 3.8 / 4.0 / 4.2）` })
      const backend = await backendFor(detected.runtime)
      if (!backend || destroyed) return { error: { ...base, kind: 'runtime', message: `Spine ${detected.runtime} 运行时不可用` } }   // onUnavailable 已经提示过
      const { spine, ns } = backend
      const dir = spec.atlas.includes('/') ? spec.atlas.slice(0, spec.atlas.lastIndexOf('/') + 1) : ''
      let atlas = null
      let pageNames
      const legacy = detected.runtime === '3.6' || detected.runtime === '3.8'   // 3.x：TextureAtlas 构造时就要贴图加载器、类在 spine.webgl 下；4.x 的 atlas 先解析、再给每页设贴图
      try {
        if (legacy) pageNames = atlasText.split(/\r?\n/).map((line) => line.trim()).filter((line) => /\.(png|jpe?g|webp)$/i.test(line))
        else { atlas = new spine.TextureAtlas(atlasText); pageNames = atlas.pages.map((page) => page.name) }
      } catch (error) { return fail({ kind: 'parse', message: `atlas 解析失败（Spine ${detected.version}，运行时 ${detected.runtime}）：${String(error?.message || error).slice(0, 200)}` }) }
      if (!pageNames.length) return fail({ kind: 'parse', message: `atlas 里没有找到任何图集页（.png / .jpg / .webp 行）：${spec.atlas}（文件内容不对？）` })
      const images = new Map()
      const missingPages = []
      for (const page of pageNames) {
        try { images.set(page, await loadImage(dir + page)) } catch { onMissing(dir + page); missingPages.push(dir + page) }
      }
      if (missingPages.length) return { error: { ...base, kind: 'missing', message: `取不到图集图片 ${missingPages.join('、')}（atlas 声明 ${pageNames.length} 页，缺 ${missingPages.length} 页）`, missingPages, atlasPages: pageNames.length } }
      try {
        const imageOf = (page) => images.get(page) || images.get(page.split('/').pop())
        // 预乘：图集标记（4.1+ 才有 pma 行）或像素统计认出已经预乘的，原样上传；直通 alpha 的贴图（透明处还带着颜色）让浏览器上传时预乘一次。
        // 之后按预乘方式画（straight 的例外见下）——Screen / Multiply 这类混合直接用 RGB 不看 alpha，直通贴图透明处的颜色会被加上去（整幅白块 / 紫色罩子 / 脸上一块白），预乘之后透明处是 0，不再有这个问题
        const atlasPma = Boolean(atlas?.pages?.some?.((page) => page.pma))
        const detectedPma = [...images.values()].some(detectPremultiplied)
        // 例外：直通贴图 + 骨架里没有 additive / multiply / screen 的槽 = 上传时不预乘（贴图原样），绘制仍按预乘方式（和 Aku 原版查看器一样：preloader.js 里 premultipliedAlpha: true，
        // 贴图直接 gl.texImage2D 上传不预乘；我们上传时预乘一遍会让脸颊 / 腮红发灰，gal-samples12 的 c31000802 对照过）。
        // 要在建 atlas 之前知道有没有这类槽，只能先扫骨架：JSON（含 3.6 二进制转出来的 JSON）扫 slots[].blend；其它二进制读不到，保持预乘（老行为）
        let skeletonJson = null
        if (detected.format === 'json') skeletonJson = JSON.parse(new TextDecoder().decode(u8))
        else if (detected.runtime === '3.6') skeletonJson = spine36BinaryToJson(u8)
        const noFancyBlend = Array.isArray(skeletonJson?.slots) && skeletonJson.slots.every((slot) => !slot?.blend || slot.blend === 'normal')
        const straight = !atlasPma && !detectedPma && noFancyBlend
        const premultiplyOnUpload = !atlasPma && !detectedPma && !straight
        const gl = backend.gl
        if (premultiplyOnUpload) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        try {
          if (legacy) {
            const declared = declaredPageSizes(atlasText)
            atlas = new spine.TextureAtlas(atlasText, (page) => reportDeclaredSize(new ns.GLTexture(backend.gl, imageOf(page)), declared.get(page)))
          } else {
            for (const page of atlas.pages) page.setTexture(new ns.GLTexture(backend.context, imageOf(page.name)))
          }
        } finally { if (premultiplyOnUpload) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false) }
        const loader = new spine.AtlasAttachmentLoader(atlas)
        // 3.6 的官方 Web 运行时没有 SkeletonBinary：二进制先转成 3.6 JSON 结构，再由官方 SkeletonJson 建数据（见 gal-spine36-binary.js）
        const data = detected.format === 'json'
          ? new spine.SkeletonJson(loader).readSkeletonData(skeletonJson)
          : detected.runtime === '3.6'
            ? new spine.SkeletonJson(loader).readSkeletonData(skeletonJson)
            : new spine.SkeletonBinary(loader).readSkeletonData(u8)
        // 预乘 alpha：图集里写了 pma（4.x）或者像素统计认出来就按预乘画。两个来源分开记，渲染诊断里能看到（白块 / 发黑多半是这里猜错了）
        // 混合模式：非 normal 的槽数（additive / multiply / screen）和 clipping 附件数——白块、发黑常常是这几类槽
        const blends = { additive: 0, multiply: 0, screen: 0 }
        for (const slot of data.slots || []) { const mode = slot.blendMode; if (mode === 1) blends.additive += 1; else if (mode === 2) blends.multiply += 1; else if (mode === 3) blends.screen += 1 }
        return { data, atlas, backend, version: data.version || detected.version, runtime: detected.runtime, format: detected.format, pma: true, pmaInfo: { atlas: atlasPma, detected: detectedPma, premultipliedOnUpload: premultiplyOnUpload, straight }, blends }
      } catch (error) {
        return fail({ kind: 'parse', message: `骨骼解析失败（Spine ${detected.version}，运行时 ${detected.runtime}）：${String(error?.message || error).slice(0, 200)}` })
      }
    })()
    dataCache.set(spec.skel, promise)
    return promise
  }

  // 更新世界变换。3.6 的 Skeleton 没有 scaleX / scaleY（3.8 起才有；3.6 只有 flipX / flipY，世界坐标 = 骨骼局部值 + skeleton.x / y），
  // layout() 写进 skeleton.scaleX / scaleY 的缩放在 3.6 里不会生效。所以 3.6 把缩放乘到根骨骼的局部 x / y / scaleX / scaleY 上再更新、更新完还原
  // （动画只覆盖有时间线的属性，不还原的话没动画的属性每帧会被再乘一次）。子骨骼都继承根的缩放，整个骨架等比放大
  function updateWorld(backend, skeleton) {
    if (backend.key !== '3.6') return skeleton.updateWorldTransform(backend.physics)
    const sx = Number.isFinite(skeleton.scaleX) ? skeleton.scaleX : 1
    const sy = Number.isFinite(skeleton.scaleY) ? skeleton.scaleY : 1
    if (sx === 1 && sy === 1) return skeleton.updateWorldTransform()
    const roots = skeleton.bones.filter((bone) => !bone.parent)
    const saved = roots.map((bone) => [bone.x, bone.y, bone.scaleX, bone.scaleY])
    for (const bone of roots) { bone.x *= sx; bone.y *= sy; bone.scaleX *= sx; bone.scaleY *= sy }
    skeleton.updateWorldTransform()
    roots.forEach((bone, i) => { [bone.x, bone.y, bone.scaleX, bone.scaleY] = saved[i] })
  }

  // 皮肤：脚本指定了（spec.skin，utage 的 Skin 列）且骨架里有 = 用它；指定了但没有 = 退回 pickSpineSkin 的选择并记下来（渲染诊断报「要的皮肤没有」）
  function skinFor(data, spec) {
    const requested = typeof spec?.skin === 'string' ? spec.skin : ''
    if (requested) {
      const hit = (data.skins || []).find((skin) => skin.name === requested)
      if (hit) return { skin: hit, requested, found: true }
    }
    return { skin: pickSpineSkin(data), requested, found: !requested }
  }

  // 包围盒（布局用）：初始姿势有可见附件 = 初始姿势；没有（附件由动画打开，比如整个身体 / 脸由 slots 时间线切附件拼出来）= 在一副「临时骨架」上套上要播的动画，
  // 取首帧（再往后几个很短的时间点，防止首个关键帧不在 0 秒）的包围盒；还是空 = 骨骼文件头里的 width / height；都没有 = 空。临时骨架不碰正在播放的那一副
  function measureBounds(inst) {
    const { backend, data } = inst
    const sp = backend.spine
    const make = () => {
      const skeleton = new sp.Skeleton(data)
      const skin = skinFor(data, inst.spec).skin
      if (skin) skeleton.setSkin(skin)
      skeleton.setToSetupPose()
      return skeleton
    }
    const probe = (skeleton) => {
      const offset = new sp.Vector2()
      const size = new sp.Vector2()
      skeleton.getBounds(offset, size, [])
      return finiteBox(offset, size) ? { x: offset.x, y: offset.y, w: size.x, h: size.y } : null
    }
    const base = make()
    updateWorld(backend, base)
    const out = { box: probe(base), source: 'setup', attachmentsSetup: attachedCount(base), slotCount: (data.slots || []).length, animationsTried: false }
    if (out.box) return out
    const plays = Array.isArray(inst.spec.tracks) && inst.spec.tracks.length ? inst.spec.tracks.filter((t) => data.findAnimation(t.anim)).map((t) => ({ track: t.track, anim: t.anim })) : inst.anim ? [{ track: 0, anim: inst.anim }] : []
    if (plays.length) {
      out.animationsTried = true
      const skeleton = make()
      const state = new sp.AnimationState(new sp.AnimationStateData(data))
      for (const play of plays) state.setAnimation(play.track, play.anim, false)   // 不循环：时间越过动画末尾就停在末尾帧（循环会绕回去，只有一个关键帧的动画永远取不到）
      for (const dt of [0, 0.05, 0.2, 0.5, 1, 1000]) {
        state.update(dt)
        state.apply(skeleton)
        updateWorld(backend, skeleton)
        const box = probe(skeleton)
        if (box) return { ...out, box, source: 'animation' }
      }
    }
    const w = Number(data.width)
    const h = Number(data.height)
    if (w > 0 && h > 0) {
      const x = Number.isFinite(Number(data.x)) && data.x !== undefined ? Number(data.x) : -w / 2
      const y = Number.isFinite(Number(data.y)) && data.y !== undefined ? Number(data.y) : 0
      return { ...out, box: { x, y, w, h }, source: 'header' }
    }
    return { ...out, box: null, source: 'none' }
  }
  function refreshBounds(inst) {
    let m
    try { m = measureBounds(inst) } catch { m = { box: null, source: 'none', attachmentsSetup: 0, slotCount: (inst.data.slots || []).length, animationsTried: false } }
    Object.assign(inst, { boundsOk: Boolean(m.box), boundsSource: m.source, attachmentsSetup: m.attachmentsSetup, slotCount: m.slotCount, animationsTried: m.animationsTried })
    inst.boundsAnim = inst.anim
    inst.bounds = m.box ? { x: m.box.x, y: m.box.y, w: m.box.w || 1, h: m.box.h || 1 } : { x: -960, y: -540, w: 1920, h: 1080 }
  }

  function pickAnimation(data, wanted, kind) {
    return pickSpineAnimation(data, wanted, kind)
  }

  // 脸部分层的动画（预设表展开 / 默认脸）：每个动画一条轨道（20 起）；比上次少的轨道清掉。返回有没有变化
  function applyFace(inst, anims, expression) {
    inst.trackSig = inst.trackSig || {}
    inst.faceDefaults = anims
    inst.expression = expression
    let changed = false
    anims.forEach((anim, i) => {
      const sig = `${anim}:true`
      if (inst.trackSig[FACE_TRACK_BASE + i] === sig) return
      inst.state.setAnimation(FACE_TRACK_BASE + i, anim, true)
      inst.trackSig[FACE_TRACK_BASE + i] = sig
      changed = true
    })
    for (let i = anims.length; i < (inst.faceTracks || 0); i++) { inst.state.clearTrack(FACE_TRACK_BASE + i); delete inst.trackSig[FACE_TRACK_BASE + i]; changed = true }
    inst.faceTracks = anims.length
    return changed
  }
  // 预设名 → 脸：先查预设表（角色 / 骨架 / 所有角色），没有就用默认脸。missing = 脚本要的、骨架里没有的名字
  function expressionFor(inst, missing) {
    const names = inst.data.animations.map((animation) => animation.name)
    const { castKey, skelBase } = castKeysOf(inst.spec.skel)
    for (const preset of missing) {
      const hit = resolveExpression({ table: expressionTable, castKey, skelBase, preset, names })
      if (hit) return { anims: hit.anims, expression: { preset, scope: hit.scope, source: 'table' } }
    }
    return { anims: faceDefaultsFor(names, []), expression: { preset: missing[0] || '', scope: '', source: 'default' } }
  }

  // spec 变了：同一个骨架只换动画 / 颜色 / 位置，不重新加载
  function applySpec(inst, spec, live) {
    inst.spec = spec
    if ((typeof spec.skin === 'string' ? spec.skin : '') !== (inst.skinRequested || '')) {   // 脚本换了皮肤
      const pick = skinFor(inst.data, spec)
      inst.skeleton.setSkin(pick.skin)
      Object.assign(inst, { skinName: pick.skin?.name || '', skinRequested: pick.requested, skinFound: pick.found })
    }
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
      // 脚本要的动画骨架里没有（表情预设名）：先查预设表，没有就用默认脸（见 expressionFor / faceDefaultsFor）
      inst.faceDefaults = []
      inst.expression = null
      if (inst.missingAnims.length && layeredFace(inst.data)) {
        const { anims, expression } = expressionFor(inst, inst.missingAnims)
        if (applyFace(inst, anims, expression)) changed = true
      }
    } else if (spec.kind === 'actor' && layeredFace(inst.data) && !(spec.anim && inst.data.findAnimation(spec.anim))) {
      // 分层脸骨架、脚本没给（或给的名字骨架里没有）任何能播的动画：不能退到「第一个动画」（那只是某个部件的一条动画，脸还是空的），查预设表 / 用默认脸
      inst.missingAnims = spec.anim ? [spec.anim] : []
      inst.anim = ''
      inst.loop = true
      const { anims, expression } = expressionFor(inst, inst.missingAnims)
      if (applyFace(inst, anims, expression)) changed = true
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
    // 包围盒不是从初始姿势来的（附件由动画打开）：换了动画 / 皮肤就重新量一次（第一次在 create 里量）
    if (inst.boundsSource && inst.boundsSource !== 'setup' && (changed || inst.boundsAnim !== inst.anim)) { inst.boundsAnim = inst.anim; refreshBounds(inst) }
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
      applyBlendOverride(loaded.data)
      const skeleton = new sp.Skeleton(loaded.data)
      const pick = skinFor(loaded.data, spec)
      if (pick.skin) skeleton.setSkin(pick.skin)
      skeleton.setToSetupPose()
      updateWorld(backend, skeleton)
      const state = new sp.AnimationState(new sp.AnimationStateData(loaded.data))
      Object.assign(current, { backend, pma: Boolean(loaded.pma), pmaInfo: loaded.pmaInfo, blends: loaded.blends, version: loaded.version, runtime: loaded.runtime, error: null, skinName: pick.skin?.name || '', skinRequested: pick.requested, skinFound: pick.found, data: loaded.data, skeleton, state, boundsOk: false, bounds: { x: -960, y: -540, w: 1920, h: 1080 }, anim: '', loop: true })
      applySpec(current, spec, live)
      refreshBounds(current)
      if (live && Number(spec.fade) > 0) current.fadeIn = { began: performance.now(), ms: Number(spec.fade) * 1000 }
      state.update(0)
      state.apply(skeleton)
      updateWorld(backend, skeleton)
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
  const normalizeCamera = (value) => {
    const num = (n, fallback) => (Number.isFinite(Number(n)) && n !== '' && n !== null ? Number(n) : fallback)
    return { mode: value?.mode === 'fixed' ? 'fixed' : value?.mode === 'widget' ? 'widget' : 'fit', width: Math.max(100, Math.min(20000, num(value?.width, 1920))), cx: Math.max(-20000, Math.min(20000, num(value?.cx, 0))), cy: Math.max(-20000, Math.min(20000, num(value?.cy, 900))) }
  }
  function set(specs, { live = false, slow = slowTo, view = null } = {}) {
    if (view) { views = { still: normalizeView(view.still), actor: normalizeView(view.actor) }; if (view.camera) camera = normalizeCamera(view.camera); if (view.expressions) expressionTable = mergeExpressions(DEFAULT_EXPRESSIONS, view.expressions); if (view.blend && view.blend !== blendOverride) { blendOverride = ['noAdditive', 'allNormal'].includes(view.blend) ? view.blend : 'native'; for (const inst of instances.values()) applyBlendOverride(inst.data) } }
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
      if (other.spec?.kind === 'still' && other.bounds && other.boundsOk && (other.spec.order || 0) < (ref.spec.order || 0)) ref = other
    }
    // 起点本身包围盒是空的、别的层有的话，改用序号最小的有包围盒的层
    if (!ref.boundsOk) {
      for (const other of instances.values()) if (other.spec?.kind === 'still' && other.boundsOk && (!ref.boundsOk || (other.spec.order || 0) < (ref.spec.order || 0))) ref = other
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
      const v = views.still
      scale = Math.min(width / rb.w, height / rb.h) * v.zoom
      px = width / 2 - (rb.x + rb.w * v.cx) * scale
      py = height / 2 - (rb.y + rb.h * (1 - v.cy)) * scale
    } else if (inst.spec.kind === 'actor') {
      // 角色（girlscreation）：摆放方式见上面的 camera（自动 / 固定相机），y 为正 = 往下（canvas 的 y 向上，所以减）
      let pos = inst.pos || { x: Number(inst.spec.x) || 0, y: Number(inst.spec.y) || 0 }
      if (inst.moving) {
        const t = Math.min(1, (performance.now() - inst.moving.began) / inst.moving.ms)
        pos = { x: inst.moving.from.x + (inst.moving.to.x - inst.moving.from.x) * t, y: inst.moving.from.y + (inst.moving.to.y - inst.moving.from.y) * t }
        if (t >= 1) { inst.pos = inst.moving.to; inst.moving = null }
      }
      const specScale = Number(inst.spec.scale) > 0 ? Number(inst.spec.scale) : 1
      let unit
      if (camera.mode === 'fixed') {
        unit = width / camera.width
        scale = unit * specScale
        px = width / 2 + (pos.x - camera.cx) * unit
        py = height / 2 - (pos.y + camera.cy) * unit
      } else if (camera.mode === 'widget') {
        // 原版 spine-widget 的 fitToCanvas（Aku 查看器：画布 1280×720，窗口 = 2.2 倍画布，水平以骨架包围盒中心为中心，窗口底边在 y = −2.2×720 + 120 个骨骼单位）：
        // 一个骨骼单位 = 画布宽 / (2.2 × 1280) 个像素，骨骼原点落在距底边 (2.2×720 − 120) 个单位处；脚本里的 x / y / 缩放绕原点（y 为正 = 往下）
        unit = width / (WIDGET_WINDOW * WIDGET_STAGE_W)
        scale = unit * specScale
        px = width / 2 - (x + w / 2) * unit + pos.x * unit
        py = (WIDGET_WINDOW * WIDGET_STAGE_H - WIDGET_BOTTOM) * unit - pos.y * unit
      } else {
        // 自动：骨架包围盒（x, y, w, h）整个放进舞台得到基准比例 fit，包围盒中心在舞台中心时原点所在的位置 + 脚本的 x / y（按 fit 折）；缩放绕骨骼原点
        unit = Math.min(width / w, height / h)
        scale = unit * specScale
        px = width / 2 - (x + w / 2) * unit + pos.x * unit
        py = height / 2 - (y + h / 2) * unit - pos.y * unit
      }
      if (inst.shake) {   // 衰减的来回晃：每秒 8 个来回，幅度线性衰减到 0（骨骼坐标单位）
        const t = (performance.now() - inst.shake.began) / 1000 / inst.shake.seconds
        if (t >= 1) inst.shake = null
        else { const o = Math.sin(t * inst.shake.seconds * 8 * Math.PI * 2) * (1 - t); px += o * inst.shake.x * unit; py += o * inst.shake.y * unit }
      }
      // 「更多」里的放大 / 中心：cx / cy 指的那一点放到舞台正中，再整体放大 zoom 倍（和静态画面同一个意思；canvas 的 y 向上，cy 从上往下数）
      const v = views.actor
      if (v.zoom !== 1 || v.cx !== 0.5 || v.cy !== 0.5) {
        px = width / 2 + v.zoom * (px - v.cx * width)
        py = height / 2 + v.zoom * (py - (1 - v.cy) * height)
        scale *= v.zoom
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
        updateWorld(backend, inst.skeleton)
        renderer.drawSkeleton(inst.skeleton, Boolean(inst.pma))
        drawnCount += 1
      }
      renderer.end()
      // GL 错误只在这里读一次最近的（getError 会清掉）；白屏 / 黑屏时诊断里能看到
      const err = gl.getError()
      if (err) { backend.lastGlError = err; backend.glErrorCount = (backend.glErrorCount || 0) + 1 }
    }
    if (drawnCount) kick()
    else last = 0
  }
  function kick() { if (!raf && !destroyed && !paused && readyBackends.length && instances.size) raf = requestAnimationFrame(frame) }

  return {
    canvas,
    set,
    ready,
    // 改某一类（'still' 静态画面 / 'actor' 角色）的放大 / 中心（选中心时实时预览）
    // 表情预设表（配置 + 这个媒体自己调的）：改了马上用新表重新套一遍当前角色的脸
    setExpressions(table) {
      expressionTable = mergeExpressions(DEFAULT_EXPRESSIONS, table)
      for (const inst of instances.values()) if (inst.skeleton && inst.spec?.kind === 'actor' && inst.faceDefaults?.length) applySpec(inst, inst.spec, false)
      kick()
    },
    // 混合模式覆盖（见 blendOverride）；改了马上重画
    setBlend(mode) { blendOverride = ['noAdditive', 'allNormal'].includes(mode) ? mode : 'native'; for (const inst of instances.values()) applyBlendOverride(inst.data); kick() },
    // 角色摆放方式（见 camera）；改了马上重画
    setCamera(value) { camera = normalizeCamera(value); kick() },
    setView(kind, view) { if (views[kind]) { views = { ...views, [kind]: normalizeView(view) }; kick() } },
    // 当前画面里有哪些类：选中心 / 放大作用在哪一类（有静态画面就是静态画面，否则是角色）
    hasKind: (kind) => [...instances.values()].some((inst) => inst.spec.kind === kind),
    // 选中心时画参考框用：静态画面 = 按「完整放进舞台」（放大 1、中心在正中）时占舞台的矩形；角色 = 整个舞台。没有这一类是 null
    viewRect(kind) {
      const cv = canvases.find((c) => c.clientWidth) || canvas
      const W = cv.clientWidth
      const H = cv.clientHeight
      if (!W || !H) return null
      if (kind === 'actor') return [...instances.values()].some((inst) => inst.spec.kind === 'actor') ? { x: 0, y: 0, w: 1, h: 1 } : null
      const first = [...instances.values()].find((inst) => inst.spec.kind === 'still' && inst.bounds)
      if (!first) return null
      const rb = stillReference(first).bounds
      const fit = Math.min(W / rb.w, H / rb.h)
      const w = (rb.w * fit) / W
      const h = (rb.h * fit) / H
      return { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
    },
    setPaused(value) { paused = Boolean(value); if (paused) { cancelAnimationFrame(raf); raf = 0; last = 0 } else kick() },
    // 每个站位 / 静图的骨架信息（诊断面板用）：路径、要的动画 / 实际播的动画、骨架里有哪些动画和皮肤、边界、版本
    info: () => [...instances].map(([slot, inst]) => {
      const names = inst.data ? inst.data.animations.map((animation) => animation.name) : []
      const requestedTracks = (inst.spec.tracks?.length ? inst.spec.tracks.map((t) => ({ track: t.track, anim: t.anim })) : inst.spec.anim ? [{ track: 0, anim: inst.spec.anim }] : []).map((t) => ({ ...t, found: Boolean(inst.data) && names.includes(t.anim) }))
      const item = {
        slot, skel: inst.spec.skel, atlas: inst.spec.atlas, kind: inst.spec.kind,
        requested: inst.spec.anim || (inst.spec.tracks || []).map((t) => `${t.track}:${t.anim}`).join(' '), requestedNames: inst.spec.tracks?.length ? inst.spec.tracks.map((t) => t.anim) : inst.spec.anim ? [inst.spec.anim] : [], used: inst.anim || '', loaded: Boolean(inst.skeleton), missingAnimations: inst.missingAnims || [],
        requestedTracks,
        faceDefaults: inst.faceDefaults || [], expression: inst.expression || null, missingRequested: inst.missingAnims || [],
        pma: Boolean(inst.pma), pmaInfo: inst.pmaInfo || null, blends: inst.blends || null, blendOverride,
        animations: names,
        skins: inst.data ? (inst.data.skins || []).map((skin) => `${skin.name}(${skinSize(skin)})`) : [], skin: inst.skinName || '', skinRequested: inst.skinRequested || '', skinFound: inst.skinFound !== false,
        version: inst.data?.version || inst.version || '', runtime: inst.runtime || '', error: inst.error?.message || '', errorKind: inst.error?.kind || '', missingPages: inst.error?.missingPages || [], atlasPages: inst.error?.atlasPages || 0,
        boundsEmpty: Boolean(inst.skeleton) && (inst.boundsSource ? inst.boundsSource === 'none' : inst.boundsOk === false), boundsSource: inst.boundsSource || '', bounds: inst.bounds && inst.boundsOk !== false ? [inst.bounds.x, inst.bounds.y, inst.bounds.w, inst.bounds.h].map((n) => Math.round(n)) : null,
        attachmentsSetup: inst.attachmentsSetup ?? null, slotCount: inst.slotCount ?? null, animationsTried: Boolean(inst.animationsTried),
      }
      return { ...item, problems: spineProblemLines(item) }
    }),
    // WebGL 状态（渲染诊断用，白屏 / 黑屏时看这个）：每个运行时一块画布——显卡型号、上下文有没有丢、画布像素尺寸、最大贴图尺寸、最近的 GL 错误
    glInfo: () => readyBackends.map((backend) => {
      const gl = backend.gl
      let renderer = ''
      try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) } catch { renderer = '读不到' }
      const names = { 1280: 'INVALID_ENUM', 1281: 'INVALID_VALUE', 1282: 'INVALID_OPERATION', 1285: 'OUT_OF_MEMORY', 1286: 'INVALID_FRAMEBUFFER_OPERATION', 37442: 'CONTEXT_LOST_WEBGL' }
      let maxTexture = 0
      try { maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) } catch { /* 上下文丢了 */ }
      return { runtime: backend.key, renderer, lost: Boolean(gl.isContextLost?.()), canvas: `${backend.canvas.width}x${backend.canvas.height}（css ${backend.canvas.clientWidth}x${backend.canvas.clientHeight}，dpr ${globalThis.devicePixelRatio || 1}）`, maxTexture, lastError: backend.lastGlError ? `${names[backend.lastGlError] || backend.lastGlError}（共 ${backend.glErrorCount} 次）` : '无' }
    }),
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
