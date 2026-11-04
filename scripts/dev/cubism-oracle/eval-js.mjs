// 对拍用：用 web/static/gal-moc3.js 算一批参数 → 顶点 / 绘制顺序 / 不透明度，写 JSON（oracle.py 再拿真正的 Cubism Core 的结果比）
//   node eval-js.mjs <in.json> <out.json>     in = [{ moc: 'xxx.moc3', params: [...] }]
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const lib = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/static/gal-moc3.js')
const { createFrame, parseMoc3, updateModel } = await import(lib)
const cases = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const mocs = {}
for (const cs of cases) {
  const m = (mocs[cs.moc] ||= parseMoc3(readFileSync(cs.moc)))
  const frame = createFrame(m)
  updateModel(m, frame, Float32Array.from(cs.params))
  cs.verts = frame.vertices.map((v) => Array.from(v)); cs.order = Array.from(frame.renderOrder); cs.opac = Array.from(frame.opacities)
}
writeFileSync(process.argv[3], JSON.stringify(cases))
