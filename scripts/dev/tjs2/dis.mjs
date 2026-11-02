// TJS2 字节码（KiriKiri 编译过的脚本，'TJS2100'）解析器：DATA（字符串 / 数字表）+ OBJS（函数对象 + 代码）。用法：node scripts/dev/tjs2/dis.mjs <文件> [函数名正则]（反汇编；常量按 CONST 追踪、属性名按 vdata 解出来）。立绘位置 / 缩放就是这样对出来的（README「立绘位置」）。
import { readFileSync } from 'node:fs'
import { parseTjs2 } from './tjs2.mjs'
const OP = ['NOP','CONST','CP','CL','CCL','TT','TF','CEQ','CDEQ','CLT','CGT','SETF','SETNF','LNOT','NF','JF','JNF','JMP','INC','INCPD','INCPI','INCP','DEC','DECPD','DECPI','DECP','LOR','LORPD','LORPI','LORP','LAND','LANDPD','LANDPI','LANDP','BOR','BORPD','BORPI','BORP','BXOR','BXORPD','BXORPI','BXORP','BAND','BANDPD','BANDPI','BANDP','SAR','SARPD','SARPI','SARP','SAL','SALPD','SALPI','SALP','SR','SRPD','SRPI','SRP','ADD','ADDPD','ADDPI','ADDP','SUB','SUBPD','SUBPI','SUBP','MOD','MODPD','MODPI','MODP','DIV','DIVPD','DIVPI','DIVP','IDIV','IDIVPD','IDIVPI','IDIVP','MUL','MULPD','MULPI','MULP','BNOT','TYPEOF','TYPEOFD','TYPEOFI','EVAL','EEXP','CHKINS','ASC','CHR','NUM','CHS','INV','CHKINV','INT','REAL','STR','OCTET','CALL','CALLD','CALLI','NEW','GPD','SPD','SPDE','SPDEH','GPI','SPI','SPIE','GPDS','SPDS','GPIS','SPIS','SETP','GETP','DELD','DELI','SRV','RET','ENTRY','EXTRY','THROW','CHGTHIS','GLOBAL','ADDCI','REGMEMBER','DEBUGGER']
const size = (op, code, i) => {
  const n = OP[op]
  if (['NOP','NF','RET','EXTRY','REGMEMBER','DEBUGGER'].includes(n)) return 1
  if (['CL','TT','TF','SETF','SETNF','LNOT','JF','JNF','JMP','INC','DEC','BNOT','TYPEOF','EVAL','EEXP','ASC','CHR','NUM','CHS','INV','INT','REAL','STR','OCTET','SRV','THROW','GLOBAL'].includes(n)) return 2
  if (['CONST','CP','CCL','CEQ','CDEQ','CLT','CGT','CHKINS','CHKINV','INCP','DECP','SETP','GETP','ENTRY','CHGTHIS','ADDCI'].includes(n)) return 3
  if (n === 'CALL' || n === 'NEW') { const argc = code[i + 3]; return argc === -1 ? 4 : argc === -2 ? 5 + 2 * code[i + 4] : 4 + argc }
  if (n === 'CALLD' || n === 'CALLI') { const argc = code[i + 4]; return argc === -1 ? 5 : argc === -2 ? 6 + 2 * code[i + 5] : 5 + argc }
  if (/P[DI]$/.test(n) && !['GPD','SPD','GPI','SPI'].includes(n) && !/^(INC|DEC)/.test(n) && n !== 'TYPEOFD' && n !== 'TYPEOFI') return 5
  if (/^(INC|DEC)P[DI]$/.test(n)) return 4
  if (/P$/.test(n) && !['INCP','DECP','SETP','GETP'].includes(n)) return 4
  if (['TYPEOFD','TYPEOFI','GPD','SPD','SPDE','SPDEH','GPI','SPI','SPIE','GPDS','SPDS','GPIS','SPIS','DELD','DELI'].includes(n)) return 4
  return 3
}
export function disasm(t, ob) {
  const out = []; const c = ob.code; const consts = new Map()
  const cv = (k) => { const [ty, ix] = ob.vdata[k] || []; return ty === 3 ? JSON.stringify(t.strs[ix]) : ty === 5 ? t.dbls[ix] : ty === 6 ? t.bytes[ix] : ty === 7 ? t.shorts[ix] : ty === 8 ? t.ints[ix] : ty === 9 ? t.longs[ix] : ty === 0 ? 'void' : ty === 1 || ty === 2 ? `obj#${ix}` : `?${ty}:${ix}` }
  const R = (r) => (consts.has(r) ? `r${r}{${consts.get(r)}}` : `r${r}`)
  for (let i = 0; i < c.length;) {
    const op = c[i]; const n = OP[op] || `?${op}`; const sz = size(op, c, i); const a = c.slice(i + 1, i + sz)
    let text
    if (n === 'CONST') { consts.set(a[0], cv(a[1])); text = `r${a[0]} = ${cv(a[1])}` }
    else if (n === 'CP') { consts.delete(a[0]); text = `r${a[0]} = ${R(a[1])}` }
    else if (['JF','JNF','JMP'].includes(n)) text = `${n} -> ${i + a[0]}`
    else if (n === 'CALL') { text = `r${a[0]} = ${R(a[1])}(${a.slice(3).map(R).join(', ')})`; consts.delete(a[0]) }
    else if (n === 'CALLD') { text = `r${a[0]} = ${R(a[1])}.${cv(a[2])}(${a.slice(4).map(R).join(', ')})`; consts.delete(a[0]) }
    else if (n === 'NEW') { text = `r${a[0]} = new ${R(a[1])}(${a.slice(3).map(R).join(', ')})`; consts.delete(a[0]) }
    else if (n === 'GPD' || n === 'GPDS') { text = `r${a[0]} = ${R(a[1])}.${cv(a[2])}`; consts.delete(a[0]) }
    else if (n === 'SPD' || n === 'SPDE' || n === 'SPDS') text = `${R(a[0])}.${cv(a[1])} = ${R(a[2])}`
    else if (/^(INC|DEC|TYPEOF|DEL|[A-Z]+)PD$|^(INC|DEC)PD$/.test(n) || n === 'DELD') text = `${n} ${R(a[0])}, ${R(a[1])}.${cv(a[2])}${a[3] !== undefined ? ', ' + R(a[3]) : ''}`
    else text = `${n} ${a.map(R).join(', ')}`
    out.push(`${String(i).padStart(4)}: ${text}`)
    if (['JF','JNF','JMP'].includes(n)) consts.clear()
    i += sz
  }
  return out
}
if (process.argv[1].endsWith("dis.mjs") && process.argv[2]) {
  const t = parseTjs2(readFileSync(process.argv[2])); const want = process.argv[3]
  for (const ob of t.objs) { const nm = t.strs[ob.name]; if (want && !new RegExp(want).test(nm)) continue; console.log(`\n## obj ${ob.idx} ${nm} (parent ${ob.parent} ${t.strs[t.objs[ob.parent]?.name] ?? ''}) ctx ${ob.contextType} argc ${ob.argc} code ${ob.code.length}`); console.log(disasm(t, ob).join('\n')) }
}
