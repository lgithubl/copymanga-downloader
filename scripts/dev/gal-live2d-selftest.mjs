// Live2D（.l2d）：BC7 / KTX / ZIP 解码、moc3 读取和求值（合成的小模型）、motion3 曲线、动作名 / 参数名映射
import { decodeBc7 } from '../../web/library/gal/bc7.mjs'
import { extractZipMember, ktxToRgba, parseZipCentral, parseZipEnd } from '../../web/library/gal/l2d-zip.mjs'
import { createFrame, evaluateMotion, parseMoc3, parseMotion, updateModel } from '../../web/static/gal-moc3.js'
import { applyVariables, pickMotionFile } from '../../web/static/gal-live2d.js'
import { buildKtx, buildTinyMoc3, buildZip } from './make-moc3-fixture.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = (v) => JSON.stringify(v)
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps

// ---- BC7：模式 6（单子集，RGBA 各 7 位 + P 位，4 位索引）手搓一个块 ----
function bitWriter() {
  const bits = []
  return { write(value, n) { for (let i = 0; i < n; i++) bits.push((value >> i) & 1) }, bytes() { const out = Buffer.alloc(16); bits.forEach((b, i) => { if (b) out[i >> 3] |= 1 << (i & 7) }); return out } }
}
{
  const w = bitWriter()
  w.write(0b1000000, 7)       // 模式 6：低位起 6 个 0 再一个 1
  for (const ch of [0, 1, 2]) { w.write(0, 7); w.write(127, 7); void ch }   // R / G / B：端点 0 = 0，端点 1 = 127
  w.write(0, 7); w.write(127, 7)   // A
  w.write(0, 1); w.write(1, 1)     // P 位：端点 0 = 0、端点 1 = 1 → 0 和 255
  const idx = new Array(16).fill(0)
  idx[1] = 8; idx[2] = 15
  idx.forEach((v, i) => w.write(v, i === 0 ? 3 : 4))
  const block = w.bytes()
  const out = decodeBc7(block, 4, 4)
  const px = (i) => [...out.subarray(i * 4, i * 4 + 4)]
  // 索引 0 → 端点 0 = 0；索引 8 → 权重 34：(0 × 30 + 255 × 34 + 32) >> 6 = 135；索引 15 → 255
  check('BC7（模式 6）：端点 + P 位 + 索引插值（0 / 135 / 255）、alpha 同样插值', J(px(0)) === J([0, 0, 0, 0]) && J(px(1)) === J([135, 135, 135, 135]) && J(px(2)) === J([255, 255, 255, 255]) && J(px(3)) === J([0, 0, 0, 0]), J([px(0), px(1), px(2)]))
  check('BC7：宽高不是 4 的倍数时裁掉多余的块边缘；数据不够报错', decodeBc7(block, 3, 2).length === 3 * 2 * 4 && (() => { try { decodeBc7(block.subarray(0, 8), 4, 4); return false } catch { return true } })())
}

// ---- ZIP / KTX ----
{
  const files = [['a.model3.json', Buffer.from('{"Version":3}'), 8], ['motions/m.motion3.json', Buffer.from('x'.repeat(500)), 8], ['t.4096/texture_00.ktx', Buffer.from('rawbytes'), 0], ['dir/', Buffer.alloc(0), 0]]
  const zip = buildZip(files)
  const end = parseZipEnd(zip.subarray(zip.length - 40))
  const list = parseZipCentral(zip.subarray(end.cdOffset, end.cdOffset + end.cdSize), end.count)
  check('ZIP：读尾部目录（EOCD → 中央目录），目录项跳过；成员名 / 压缩方式 / 大小', end.count === 4 && list.length === 3 && list[0].name === 'a.model3.json' && list[0].method === 8 && list[2].method === 0 && list[1].usize === 500, J(list))
  check('ZIP：取成员（deflate 解压 / stored 原样）', extractZipMember(zip, list[0]).toString() === '{"Version":3}' && extractZipMember(zip, list[1]).length === 500 && extractZipMember(zip, list[2]).toString() === 'rawbytes')
  const rgba = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])
  const raw = ktxToRgba(buildKtx(2, 2, 0x8058, 0x1908, rgba))
  check('KTX 1.1：未压缩 RGBA8 原样取出；BC7 走 BC7 解码；别的格式报错', raw.width === 2 && raw.height === 2 && raw.data.equals(rgba) && (() => { try { ktxToRgba(buildKtx(4, 4, 0x93b0, 0, Buffer.alloc(16))); return false } catch (e) { return /不支持/.test(e.message) } })())
}

// ---- moc3（合成的小模型）----
{
  const moc = buildTinyMoc3()
  const m = parseMoc3(moc)
  check('moc3：头 / 计数 / 画布 / 参数 / 变形器 / 网格都读得出来', m.version === 3 && m.counts.artMeshes === 2 && m.counts.deformers === 2 && m.paramIds[0] === 'ParamA' && m.artMeshIds[1] === 'Mesh1' && m.canvas.pixelsPerUnit === 1000 && m.canvas.width === 1000 && J(Array.from(m.keys)) === J([-1, 0, 1]), J([m.counts, m.canvas]))
  check('moc3：不是 MOC3 / 版本不支持报错', (() => { try { parseMoc3(Buffer.alloc(200)); return false } catch (e) { return /不是 moc3/.test(e.message) } })() && (() => { const b = Buffer.from(moc); b[4] = 9; try { parseMoc3(b); return false } catch (e) { return /版本/.test(e.message) } })())
  const frame = createFrame(m)
  const eval1 = (v) => { const params = Float32Array.from([v]); updateModel(m, frame, params); return frame }
  let f = eval1(1)
  const v0 = Array.from(f.vertices[0])
  // 参数 = 1：旋转 90°：(1,0) → (0,1)；(0,1) → (-1,0)；(-1,0) → (0,-1)
  check('求值：旋转变形器（角度关键形态 -90 / 0 / 90）在参数 1 = 90°，网格顶点跟着转', near(v0[0], 0) && near(v0[1], 1) && near(v0[2], -1) && near(v0[3], 0) && near(v0[4], 0) && near(v0[5], -1), J(v0))
  f = eval1(0.5)
  const a = Math.PI / 4
  check('求值：参数 0.5 = 两个关键点之间线性插值（45°）', near(f.vertices[0][0], Math.cos(a)) && near(f.vertices[0][1], Math.sin(a)), J(Array.from(f.vertices[0])))
  f = eval1(-1)
  check('求值：参数 -1 = -90°；超出范围的值夹到 [min, max]', near(f.vertices[0][0], 0) && near(f.vertices[0][1], -1) && near(eval1(7).vertices[0][1], 1), J(Array.from(f.vertices[0])))
  f = eval1(0)
  const v1 = Array.from(f.vertices[1])
  // 弯曲变形器 1×1，格点放大 2 倍（双线性）：局部 (0.5,0.5) → (1,1)；(0.25,0.25) → (0.5,0.5)；(0.75,0.25) → (1.5,0.5)
  check('求值：弯曲变形器（1×1，格点放大 2 倍，双线性）把子网格的局部坐标映射出去', near(v1[0], 1) && near(v1[1], 1) && near(v1[2], 0.5) && near(v1[3], 0.5) && near(v1[4], 1.5) && near(v1[5], 0.5), J(v1))
  check('求值：不透明度 / 颜色（没有 4.02 颜色 = 乘 1 / 屏幕 0）；绘制顺序：同一组里按 draw order、相同按对象序号 → 渲染 [0, 1]', J(f.renderOrder) === J([0, 1]) && f.opacities[0] === 1 && J(Array.from(f.colors.subarray(0, 6))) === J([1, 1, 1, 0, 0, 0]), J([f.renderOrder, f.opacities]))
}

// ---- motion3 ----
{
  const motion = parseMotion({ Meta: { Duration: 2, Loop: true, AreBeziersRestricted: true }, Curves: [
    { Target: 'Parameter', Id: 'ParamA', Segments: [0, 0, 0, 1, 1, 0, 2, 0] },   // 线性：0 → 1（t=1）→ 0（t=2）
    { Target: 'Parameter', Id: 'ParamB', Segments: [0, 0, 2, 1, 5, 3, 2, 7] },   // 阶梯（类型 2）：t<1 保持 0；反向阶梯（类型 3）：1<t<2 取下一个点的值 7
    { Target: 'Parameter', Id: 'ParamC', Segments: [0, 0, 1, 0.5, 0, 0.5, 10, 1, 10] },   // 贝塞尔（限制模式：u = 时间比例）
  ] })
  const fake = { paramIndex: new Map([['ParamA', 0], ['ParamB', 1], ['ParamC', 2]]), partIndex: new Map() }
  const p = new Float32Array(3)
  evaluateMotion(motion, 0.5, fake, p, null)
  check('motion3：线性段插值；阶梯段在到下一个点之前保持；贝塞尔（限制模式，u = 时间比例）', near(p[0], 0.5) && p[1] === 0 && near(p[2], 5, 1e-3), J(Array.from(p)))
  evaluateMotion(motion, 1.5, fake, p, null)
  check('motion3：t = 1.5 时线性回落到 0.5；反向阶梯段取下一个点的值（7）；贝塞尔段过了终点保持终点值', near(p[0], 0.5) && p[1] === 7 && p[2] === 10, J(Array.from(p)))
  evaluateMotion(motion, 2.5, fake, p, null)
  check('motion3：循环 = 时间取模（2.5 → 0.5）；loop = false 停在最后一帧', near(p[0], 0.5) && (evaluateMotion(motion, 9, fake, p, null, false), near(p[0], 0)), J(Array.from(p)))
}

// ---- 动作名 / 参数名 ----
{
  const files = ['motions/ev_mv001_02_00.motion3.json', 'motions/ev_mv001_02_01.motion3.json', 'motions/ev_mv001_02_03.motion3.json', 'motions/ev_mv001_02_03h.motion3.json', 'motions/ev_mv001_02_05s.motion3.json']
  check('动作名：文件名去掉 .motion3.json 直接对；r1 / r3h / r5s 这种简写 = 「…_01」「…_03h」「…_05s」；找不到 = 空', pickMotionFile(files, 'ev_mv001_02_01') === files[1] && pickMotionFile(files, 'r3h') === files[3] && pickMotionFile(files, 'r3') === files[2] && pickMotionFile(files, 'r5s') === files[4] && pickMotionFile(files, 'r0') === files[0] && pickMotionFile(files, 'r9') === '' && pickMotionFile(files, '') === '')
  const m = parseMoc3(buildTinyMoc3())
  const params = Float32Array.from(m.paramDefault)
  const hit = applyVariables(m, new Map([['甲', 'ParamA']]), { 甲: 1, ParamA: 0.25, 没有: 3 }, params)
  check('参数名：variables 的键是显示名（cdi3 的 Name）或直接是 Id；认不出的忽略', hit === 2 && params[0] === 0.25, J([hit, Array.from(params)]))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
