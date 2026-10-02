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

export function listTags({ limit = 0, offset = 0, keyword = '' } = {}) {
  ensureDb()
  const pageLimit = Math.max(0, Math.min(1000, Math.floor(Number(limit) || 0)))
  const pageOffset = Math.max(0, Math.floor(Number(offset) || 0))
  const normalizedKeyword = normalizeTagName(keyword)
  const where = normalizedKeyword ? 'WHERE tags.normalized_name LIKE ?' : ''
  const params = normalizedKeyword ? [`%${normalizedKeyword}%`] : []
  const rows = db.prepare(`
    WITH item_counts AS (
      SELECT tag_id, COUNT(*) AS itemCount
      FROM item_tags
      GROUP BY tag_id
    ),
    unit_counts AS (
      SELECT tag_id, COUNT(*) AS unitCount
      FROM unit_tags
      GROUP BY tag_id
    )
    SELECT
      tags.name,
      tags.normalized_name AS normalizedName,
      tags.color,
      COALESCE(item_counts.itemCount, 0) AS itemCount,
      COALESCE(unit_counts.unitCount, 0) AS unitCount
    FROM tags
    LEFT JOIN item_counts ON item_counts.tag_id = tags.id
    LEFT JOIN unit_counts ON unit_counts.tag_id = tags.id
    ${where}
    ORDER BY (itemCount + unitCount) DESC, name COLLATE NOCASE
    ${pageLimit ? 'LIMIT ? OFFSET ?' : ''}
  `).all(...(pageLimit ? [...params, pageLimit, pageOffset] : params))
  if (!pageLimit) return rows
  const total = db.prepare(`SELECT COUNT(*) AS total FROM tags ${where}`).get(...params).total
  return {
    items: rows,
    total,
    limit: pageLimit,
    offset: pageOffset,
  }
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
    const set = itemKeySetForTag(token.name, type, token.unitOnly)
    keys = keys ? intersect(keys, set) : set
  }
  if (!keys) {
    keys = new Set(db.prepare(type === 'all'
      ? 'SELECT DISTINCT type || char(31) || item_id AS key FROM item_tags'
      : 'SELECT DISTINCT type || char(31) || item_id AS key FROM item_tags WHERE type = ?'
    ).all(...(type === 'all' ? [] : [type])).map((row) => row.key))
  }
  for (const token of negative) {
    for (const key of itemKeySetForTag(token.name, type, token.unitOnly)) keys.delete(key)
  }
  return [...keys].map((key) => {
    const [itemType, itemId] = key.split('\u001f')
    return { type: itemType, itemId }
  })
}

function parseTagQuery(query) {
  const input = String(query || '').trim()
  if (/^-?(?:tag|unitTag):/i.test(input) && !/\s-?(?:tag|unitTag):/i.test(input)) {
    return [parseTagToken(input)].filter((item) => item.name)
  }
  return [...input.matchAll(/-?(?:tag|unitTag):"[^"]+"|-?(?:tag|unitTag):\S+|-\S+|\S+/gi)]
    .map((match) => match[0])
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map(parseTagToken)
    .filter((item) => item.name)
}

function parseTagToken(raw) {
  const exclude = raw.startsWith('-')
  let body = exclude ? raw.slice(1) : raw
  const unitOnly = /^unitTag:/i.test(body)
  body = body.replace(/^(?:tag|unitTag):/i, '')
  body = body.replace(/^"|"$/g, '')
  return { exclude, unitOnly, name: body }
}

function itemKeySetForTag(name, type, unitOnly = false) {
  const normalized = normalizeTagName(name)
  const rows = unitOnly ? [] : db.prepare(`
    SELECT DISTINCT item_tags.type || char(31) || item_tags.item_id AS key
    FROM item_tags
    JOIN tags ON tags.id = item_tags.tag_id
    WHERE tags.normalized_name = ?
    ${type === 'all' ? '' : 'AND item_tags.type = ?'}
  `).all(...(type === 'all' ? [normalized] : [normalized, type]))
  const unitRows = db.prepare(`
    SELECT DISTINCT unit_tags.type || char(31) || unit_tags.item_id AS key
    FROM unit_tags
    JOIN tags ON tags.id = unit_tags.tag_id
    WHERE tags.normalized_name = ?
    ${type === 'all' ? '' : 'AND unit_tags.type = ?'}
  `).all(...(type === 'all' ? [normalized] : [normalized, type]))
  return new Set([...rows, ...unitRows].map((row) => row.key))
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
