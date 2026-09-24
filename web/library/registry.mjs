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
    items.push(...await handler.scanItems())
  }
  return items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}
