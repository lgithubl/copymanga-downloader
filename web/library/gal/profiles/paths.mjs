// 媒体目录里的路径一律是相对路径、不许 ..、不许绝对路径、不许空段
export function safeRelPath(value) {
  const rel = String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
  if (!rel) return ''
  const parts = rel.split('/')
  return parts.some((part) => !part || part === '.' || part === '..') ? null : rel
}

