const handlers = new Map()

export function registerLibraryHandler(handler) {
  if (!handler?.type) throw new Error('library handler type is required')
  handlers.set(handler.type, handler)
}

export function libraryHandler(type) {
  const handler = handlers.get(type)
  if (!handler) throw new Error(`Unsupported library type: ${type}`)
  return handler
}

export function libraryTypes() {
  return [...handlers.values()].map((handler) => ({
    type: handler.type,
    label: handler.label || handler.type,
    importable: Boolean(handler.importItem),
    sampleable: Boolean(handler.createSampleItem),
  }))
}

export async function scanLibraryItems({ type = 'all' } = {}) {
  const selected = type === 'all' ? [...handlers.values()] : [libraryHandler(type)]
  const items = []
  for (const handler of selected) {
    // 不能 push(...list)：V8 一次调用的参数个数上限约 12 万，42 万条的库展开即 RangeError
    for (const item of await handler.scanItems()) items.push(item)
  }
  return items.sort(compareLibraryImportOrder)
}

function compareLibraryImportOrder(a, b) {
  return String(b.createdAt || b.updatedAt || '').localeCompare(String(a.createdAt || a.updatedAt || ''))
}
