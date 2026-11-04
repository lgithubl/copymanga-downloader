// 对拍用：给一个 moc3 生成随机参数组（默认值 / 少数参数动 / 全随机 / 全端点）→ JSON
//   node fuzz-gen.mjs <moc3> <out.json> [seed] [n]
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const { parseMoc3 } = await import(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/static/gal-moc3.js'))
const [mocFile, outFile, seed = '1', count = '40'] = process.argv.slice(2)
const m = parseMoc3(readFileSync(mocFile))
let s = Number(seed)
const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296 }
const cases = []
for (let k = 0; k < Number(count); k++) {
  const mode = k % 4
  const params = Array.from(m.paramDefault, (d, i) => {
    const lo = m.paramMin[i]; const hi = m.paramMax[i]
    if (mode === 0) return d
    if (mode === 1) return rnd() < 0.15 ? lo + (hi - lo) * rnd() : d
    if (mode === 2) return lo + (hi - lo) * rnd()
    return rnd() < 0.5 ? lo : hi
  })
  cases.push({ moc: mocFile, params, name: `#${k}` })
}
writeFileSync(outFile, JSON.stringify(cases))
