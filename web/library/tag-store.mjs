import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

let db
let writeTail = Promise.resolve()

export async function initTagStore(dataDir) {
  await mkdir(path.join(dataDir, 'cache', 'library-tags'), { recursive: true })
  db = new DatabaseSync(path.join(dataDir, 'cache', 'library-tags', 'tags.sqlite'))
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS item_tags (
      type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (type, item_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS unit_tags (
      type TEXT NOT NULL,
      item_id TEXT NOT NULL,
      unit_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (type, item_id, unit_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_unit_tags_tag ON unit_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_unit_tags_unit ON unit_tags(type, item_id, unit_id);
  `)
}

export function normalizeTagName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function parseTags(value) {
  const input = Array.isArray(value) ? value : String(value || '').split(/[,\n，#]+/)
  return [...new Set(input.map((item) => String(item || '').trim()).filter(Boolean))]
}

export function listTags() {
  ensureDb()
  return db.prepare('SELECT name, normalized_name AS normalizedName, color FROM tags ORDER BY name COLLATE NOCASE').all()
}

export async function setItemTags({ type, itemId, tags }) {
  return enqueueWrite(() => {
    const normalizedTags = parseTags(tags)
    runTransaction(() => {
      db.prepare('DELETE FROM item_tags WHERE type = ? AND item_id = ?').run(type, itemId)
      for (const tag of normalizedTags) {
        const tagId = ensureTag(tag)
        db.prepare('INSERT OR IGNORE INTO item_tags (type, item_id, tag_id) VALUES (?, ?, ?)').run(type, itemId, tagId)
      }
    })
    return normalizedTags
  })
}

export async function setUnitTags({ type, itemId, unitId, tags }) {
  return enqueueWrite(() => {
    const normalizedTags = parseTags(tags)
    runTransaction(() => {
      db.prepare('DELETE FROM unit_tags WHERE type = ? AND item_id = ? AND unit_id = ?').run(type, itemId, unitId)
      for (const tag of normalizedTags) {
        const tagId = ensureTag(tag)
        db.prepare('INSERT OR IGNORE INTO unit_tags (type, item_id, unit_id, tag_id) VALUES (?, ?, ?, ?)').run(type, itemId, unitId, tagId)
      }
    })
    return normalizedTags
  })
}

export async function syncItemTagIndex(item) {
  if (!item?.type || !item?.itemId) return
  await setItemTags({ type: item.type, itemId: item.itemId, tags: item.tags || [] })
  for (const unit of item.mediaUnits || item.units || []) {
    if (!unit?.unitId) continue
    await setUnitTags({ type: item.type, itemId: item.itemId, unitId: unit.unitId, tags: unit.tags || [] })
  }
}

export function searchItemKeys(query, { type = 'all' } = {}) {
  ensureDb()
  const tokens = parseTagQuery(query)
  if (!tokens.length) return []
  const positive = tokens.filter((item) => !item.exclude)
  const negative = tokens.filter((item) => item.exclude)
  let keys
  for (const token of positive) {
    const set = itemKeySetForTag(token.name, type)
    keys = keys ? intersect(keys, set) : set
  }
  if (!keys) {
    keys = new Set(db.prepare(type === 'all'
      ? 'SELECT DISTINCT type || char(31) || item_id AS key FROM item_tags'
      : 'SELECT DISTINCT type || char(31) || item_id AS key FROM item_tags WHERE type = ?'
    ).all(...(type === 'all' ? [] : [type])).map((row) => row.key))
  }
  for (const token of negative) {
    for (const key of itemKeySetForTag(token.name, type)) keys.delete(key)
  }
  return [...keys].map((key) => {
    const [itemType, itemId] = key.split('\u001f')
    return { type: itemType, itemId }
  })
}

function parseTagQuery(query) {
  return String(query || '')
    .split(/\s+/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const exclude = raw.startsWith('-')
      const body = exclude ? raw.slice(1) : raw
      return { exclude, name: body.replace(/^tag:/i, '') }
    })
    .filter((item) => item.name)
}

function itemKeySetForTag(name, type) {
  const normalized = normalizeTagName(name)
  const rows = db.prepare(`
    SELECT DISTINCT item_tags.type || char(31) || item_tags.item_id AS key
    FROM item_tags
    JOIN tags ON tags.id = item_tags.tag_id
    WHERE tags.normalized_name = ?
    ${type === 'all' ? '' : 'AND item_tags.type = ?'}
  `).all(...(type === 'all' ? [normalized] : [normalized, type]))
  return new Set(rows.map((row) => row.key))
}

function ensureTag(name) {
  const normalized = normalizeTagName(name)
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO tags (name, normalized_name, color, created_at, updated_at)
    VALUES (?, ?, '', ?, ?)
    ON CONFLICT(normalized_name) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
  `).run(name, normalized, now, now)
  return db.prepare('SELECT id FROM tags WHERE normalized_name = ?').get(normalized).id
}

function intersect(left, right) {
  const result = new Set()
  for (const item of left) if (right.has(item)) result.add(item)
  return result
}

function enqueueWrite(work) {
  const next = writeTail.catch(() => {}).then(() => {
    ensureDb()
    return work()
  })
  writeTail = next.then(() => {}, () => {})
  return next
}

function runTransaction(work) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function ensureDb() {
  if (!db) throw new Error('tag store is not initialized')
}
