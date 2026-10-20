// 够用的 CSS 选择器子集，作用在 parse5 的节点树上（朗读「flag 规则」按它判断一段文字属于哪种内容）。
// 不引入 css-select 及它的一串依赖：这里只需要认书里元素的标记，写不出来的复杂写法直接报错，
// 不会悄悄匹配错。
//
// 支持：
//   * 或 标签名       p  span  *
//   .类名  #id        .koboSpan  #toc-001
//   [attr]  [attr=v]  [attr~=v]  [attr*=v]  [attr^=v]  [attr$=v]   值可带引号
//   :not(简单选择器)  p:not([style*="opacity"])      括号里只能放一个复合选择器，不能再嵌套 :not
//   复合选择器        p.x[a=b]:not(.y)
//   组合符            后代（空格）  子元素（>）
//   逗号分隔多个      rt, rp
// 不支持：兄弟组合符（+ ~）、:nth-*、:first-child 等其它伪类、伪元素。

const IDENT = /[A-Za-z_\u00a0-\uffff][\w\-\u00a0-\uffff]*/y

class Parser {
  constructor(source) {
    this.source = source
    this.pos = 0
  }

  fail(message) {
    throw new Error(`${message}（位置 ${this.pos}）`)
  }

  peek() {
    return this.source[this.pos]
  }

  skipSpace() {
    const start = this.pos
    while (/\s/.test(this.source[this.pos] || '')) this.pos += 1
    return this.pos > start
  }

  ident() {
    IDENT.lastIndex = this.pos
    const match = IDENT.exec(this.source)
    if (!match) this.fail('这里应该是名字')
    this.pos += match[0].length
    return match[0]
  }

  quotedOrBare() {
    const quote = this.peek()
    if (quote === '"' || quote === "'") {
      this.pos += 1
      const end = this.source.indexOf(quote, this.pos)
      if (end < 0) this.fail('引号没有闭合')
      const value = this.source.slice(this.pos, end)
      this.pos = end + 1
      return value
    }
    const start = this.pos
    while (this.pos < this.source.length && !/[\]\s]/.test(this.source[this.pos])) this.pos += 1
    if (this.pos === start) this.fail('属性值为空')
    return this.source.slice(start, this.pos)
  }

  attribute() {
    this.pos += 1   // [
    this.skipSpace()
    const name = this.ident().toLowerCase()
    this.skipSpace()
    let op = ''
    let value = ''
    if (this.peek() !== ']') {
      const two = this.source.slice(this.pos, this.pos + 2)
      if (['~=', '*=', '^=', '$='].includes(two)) { op = two; this.pos += 2 }
      else if (this.peek() === '=') { op = '='; this.pos += 1 }
      else this.fail('不支持的属性运算符')
      this.skipSpace()
      value = this.quotedOrBare()
      this.skipSpace()
    }
    if (this.peek() !== ']') this.fail('属性选择器缺少 ]')
    this.pos += 1
    return { type: 'attr', name, op, value }
  }

  compound(allowNot) {
    const parts = []
    let tag = null
    if (this.peek() === '*') { this.pos += 1; tag = '*' }
    else if (/[A-Za-z_\u00a0-\uffff]/.test(this.peek() || '')) tag = this.ident().toLowerCase()
    for (;;) {
      const ch = this.peek()
      if (ch === '.') { this.pos += 1; parts.push({ type: 'class', name: this.ident() }) }
      else if (ch === '#') { this.pos += 1; parts.push({ type: 'id', name: this.ident() }) }
      else if (ch === '[') parts.push(this.attribute())
      else if (ch === ':') {
        this.pos += 1
        const name = this.ident().toLowerCase()
        if (name !== 'not') this.fail(`不支持伪类 :${name}`)
        if (!allowNot) this.fail(':not() 里不能再嵌套 :not()')
        if (this.peek() !== '(') this.fail(':not 后面需要 (')
        this.pos += 1
        this.skipSpace()
        const inner = this.compound(false)
        this.skipSpace()
        if (this.peek() !== ')') this.fail(':not() 里只能放一个简单选择器（不能有空格、> 或逗号）')
        this.pos += 1
        parts.push({ type: 'not', inner })
      } else break
    }
    if (tag === null && !parts.length) this.fail('这里应该是选择器')
    return { tag, parts }
  }

  complex() {
    this.skipSpace()
    const steps = [{ combinator: '', compound: this.compound(true) }]
    for (;;) {
      const spaced = this.skipSpace()
      const ch = this.peek()
      if (ch === undefined || ch === ',') break
      let combinator = ' '
      if (ch === '>') { combinator = '>'; this.pos += 1; this.skipSpace() }
      else if (ch === '+' || ch === '~') this.fail('不支持兄弟组合符 + ~')
      else if (!spaced) this.fail('选择器之间需要空格或 >')
      steps.push({ combinator, compound: this.compound(true) })
    }
    return steps
  }

  list() {
    const selectors = [this.complex()]
    while (this.peek() === ',') {
      this.pos += 1
      selectors.push(this.complex())
    }
    this.skipSpace()
    if (this.pos < this.source.length) this.fail(`多余的内容 ${this.source.slice(this.pos, this.pos + 8)}`)
    return selectors
  }
}

function attrValue(node, name) {
  const attr = (node.attrs || []).find((item) => item.name === name)
  return attr ? attr.value : null
}

function matchAttr(node, spec) {
  const value = attrValue(node, spec.name)
  if (value === null) return false
  if (!spec.op) return true
  switch (spec.op) {
    case '=': return value === spec.value
    case '~=': return value.split(/\s+/).includes(spec.value)
    case '*=': return spec.value !== '' && value.includes(spec.value)
    case '^=': return spec.value !== '' && value.startsWith(spec.value)
    case '$=': return spec.value !== '' && value.endsWith(spec.value)
    default: return false
  }
}

function matchCompound(node, compound) {
  if (!node || !node.tagName) return false
  if (compound.tag && compound.tag !== '*' && node.tagName.toLowerCase() !== compound.tag) return false
  for (const part of compound.parts) {
    if (part.type === 'class') {
      if (!(attrValue(node, 'class') || '').split(/\s+/).includes(part.name)) return false
    } else if (part.type === 'id') {
      if (attrValue(node, 'id') !== part.name) return false
    } else if (part.type === 'attr') {
      if (!matchAttr(node, part)) return false
    } else if (part.type === 'not') {
      if (matchCompound(node, part.inner)) return false
    }
  }
  return true
}

function matchFrom(node, steps, index) {
  if (!matchCompound(node, steps[index].compound)) return false
  if (index === 0) return true
  const { combinator } = steps[index]
  if (combinator === '>') return matchFrom(node.parentNode, steps, index - 1)
  for (let ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
    if (matchFrom(ancestor, steps, index - 1)) return true
  }
  return false
}

// 编译选择器列表，返回 (element) => boolean。语法错误抛出带位置的 Error。
export function compileSelector(source) {
  const text = String(source || '').trim()
  if (!text) throw new Error('选择器为空')
  const selectors = new Parser(text).list()
  return (element) => selectors.some((steps) => matchFrom(element, steps, steps.length - 1))
}
