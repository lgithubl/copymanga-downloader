// 把 AniDB 的罗马字人名/社团名换成日文原名，走 UDP API。
//
// 为什么要 UDP：HTTP 的 anime XML 里 <creators>/<seiyuu>/<character> 全是罗马字
// （实测 139 个 <name> 一个日文都没有），日文名只有 UDP 的 CREATOR / CHARACTER 有。
//
// 这些都是实测确认的，不是照文档写的（adbb 的字段表是过时的）：
//   - 命令是 CREATOR + creatorid，不是 PRODUCER + pid。PRODUCER 查任何 id 都返回
//     "0||||||"，是废弃的空表；crid / characterid 这些参数名会返回 505
//   - anime XML 里 <name id=> 和 <seiyuu id=> 就是 creatorid，同一套 ID 空间，直接可用
//   - 245 CREATOR   creatorid|日文名|罗马字|type|图片|url英|url日|wiki英|wiki日|更新时间
//   - 235 CHARACTER charid|日文名|罗马字|图片|anime关联|?|更新时间|type|性别
//   - 日文名在第 2 字段（adbb 说的 othername 是错的）
//
// 连接谁开谁关：服务端不给脚本任何生命周期钩子，只能自治。socket 和 session 放模块级
// （同版本的 module 会被 import 缓存复用），懒登录、空闲自动登出。放函数局部的话，
// scriptTimeoutMs 超时只是让上层 reject，generateTags 还在后台跑，socket 就泄漏了。

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import dgram from 'node:dgram'
import path from 'node:path'

// —— 熔断 ——
// 维度是脚本全局：AniDB 按 client+IP 封，和 aid 无关，记在 item tag 上拦不住下一条。
// 内存只当快路径——module 实例跨条目跨 job 都在，但服务端一重启就没了，
// 而封禁按小时算，重启后立刻恢复猛敲正是最该避免的。所以真相落盘。
// 落在 ctx.cacheDir（服务端按脚本 id 给的目录），不用 options.cacheDir：后者用户可配，
// 指向 mock 时熔断状态会跟着环境漂。文件名带目标主机，打 mock 不会挡住真实请求。
// 带凭据指纹：改了账号密码说明是配错了不是被封，旧熔断作废，不用干等。
const BAN_CODES = new Set(['555', '601', '602', '604'])
let breaker = null

function fingerprint(options) {
  return createHash('sha256')
    .update(`${options.user}\u0000${options.pass}\u0000${options.client}\u0000${options.clientVer}`)
    .digest('hex').slice(0, 12)
}

function breakerFile(ctx, options) {
  const dir = String(ctx?.cacheDir || '')
  if (!dir) return ''
  return path.join(dir, `ban-${options.udpHost.replace(/[^\w.-]/g, '_')}.json`)
}

// 以文件为准，内存只在没有落盘位置时兜底。冷却时长是猜的，所以"删掉文件立即解封"
// 必须真的管用；内存优先的话要等重启才生效。每个条目多读一个几十字节的 JSON，可以忽略。
async function readBreaker(ctx, options) {
  const fp = fingerprint(options)
  const valid = (rec) => rec && rec.host === options.udpHost && rec.fingerprint === fp && rec.until > Date.now()
  const file = breakerFile(ctx, options)
  if (!file) return valid(breaker) ? breaker : null
  try {
    const rec = JSON.parse(await readFile(file, 'utf8'))
    breaker = rec
    return valid(rec) ? rec : null
  } catch {
    breaker = null          // 文件被删 / 读坏了，内存里的也作废
    return null
  }
}

async function tripBreaker(ctx, options, reason, logs) {
  const rec = {
    until: Date.now() + options.banCooldownMs,
    reason: String(reason).slice(0, 200),
    host: options.udpHost,
    fingerprint: fingerprint(options),
  }
  breaker = rec
  logs.push(`触发熔断，冷却 ${Math.round(options.banCooldownMs / 60000)} 分钟：${rec.reason}`)
  const file = breakerFile(ctx, options)
  if (!file) {
    logs.push('没有 ctx.cacheDir，熔断只在内存生效，重启后失效')
    return
  }
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(rec), 'utf8')
  } catch (error) {
    logs.push(`熔断状态落盘失败（仅内存生效）：${error.message}`)
  }
}

// —— 模块级连接状态。跨条目复用，不是每个条目都重新登录 ——
let sock = null
let session = ''
let idleTimer = null
let lastSentAt = 0
let pending = null

export async function generateTags(ctx) {
  const logs = []
  const options = requireOptions(ctx.script?.options || {})
  const item = ctx.item || {}

  const fullRun = !Array.isArray(ctx.selectedUnitIds) || !ctx.selectedUnitIds.length
  if (!fullRun) {
    logs.push('选中了部分章节，本脚本只在合集维度产出，本次不写')
    return empty(logs, { scope: 'unit' })
  }
  if (!options.enabled) {
    logs.push('enabled=false，不做任何事')
    return empty(logs, { skipped: 'disabled', status: '未触发' }, [statusTag(options, '未触发')])
  }

  const aid = aidFromTags(item.tags)
  if (!aid) {
    logs.push('条目上没有 "AniDB: <aid>" tag，先跑 AniDB v1')
    return empty(logs, { skipped: 'no-aid', status: '缺前置' }, [statusTag(options, '缺前置')])
  }

  // id 来自 anidb-v1 缓存的 anime XML，本脚本不自己打 HTTP
  const xmlPath = path.join(options.animeXmlDir, `${aid}.xml`)
  let xml
  try {
    xml = await readFile(xmlPath, 'utf8')
  } catch {
    logs.push(`找不到 ${xmlPath}；先让 AniDB v1 开 apiEnabled 把 XML 拉下来`)
    return empty(logs, { skipped: 'no-xml', aid, status: '缺前置' }, [statusTag(options, '缺前置')])
  }

  const targets = collectTargets(xml, options, logs)
  if (!targets.length) {
    logs.push('白名单过滤后没有要查的对象')
    return empty(logs, { aid, targets: 0, status: '无对象' }, [statusTag(options, '无对象')])
  }

  // 熔断只挡"要发包"的对象：全命中缓存时照常产出，没理由因为被封就不给 tag
  const ban = await readBreaker(ctx, options)
  if (ban) {
    logs.push(`处于熔断冷却中（还剩 ${Math.ceil((ban.until - Date.now()) / 60000)} 分钟），本次不发包：${ban.reason}`)
  }

  const itemTags = []
  let attempted = 0
  let fetched = 0
  let cached = 0
  let failed = 0
  // 拿到明确答复的 target 数（有日文名、或确认 AniDB 就是没录）。
  // 没答复的 = 查询失败 + 撞上限没轮到的，这两种重跑才可能补上。
  let answered = 0
  let blocked = 0        // 因熔断没发包的对象
  let banHit = false     // 本次是否撞上服务端拒绝
  for (const target of targets) {
    // 按"发了几次"算上限，不是"成功几次"：全失败时 fetched 永远是 0，上限形同虚设，
    // 12 个 target × (4s 间隔 + 8s 超时) 会干等 144s 才收场
    if (attempted >= options.maxRequestsPerItem) {
      // 撞 scriptTimeoutMs 被硬杀的话这一轮产出会整个丢掉，不如自己停下、下次接着跑
      logs.push(`本条目已发 ${attempted} 次请求，到达上限 ${options.maxRequestsPerItem}，剩余 ${targets.length - attempted - cached} 个下次再跑`)
      break
    }
    let row
    let fromCache = false
    try {
      const hit = await readCache(options, target)
      if (hit !== null) {
        row = hit
        fromCache = true
        cached += 1
      } else if (ban) {
        blocked += 1
        continue
      } else {
        attempted += 1
        row = await fetchRow(options, target, logs)
        const stored = await writeCache(options, target, row)   // 先落盘原始响应，再解析
        if (!stored) {
          await appendErrLog(options, target, { aid }, `响应解析后是空行，没有写入缓存，原始响应：${JSON.stringify(row)}`)
          logs.push(`${target.kind} ${target.id} 响应为空行，未写缓存（详见 ${target.id}.err.log）`)
        }
        fetched += 1
      }
      answered += 1
    } catch (error) {
      failed += 1
      logs.push(`${target.kind} ${target.id} 查询失败：${error.message}`)
      await appendErrLog(options, target, { aid }, error.message)
      // 一个包都没回就别再试剩下的了。两种情况：登录就没通；或者 session 还在、
      // 跑到一半链路断了（这种 ensureSession 会直接返回，不走 loginFailed）。
      // 不收场的话每个 target 都要等满一个 udpTimeoutMs，12 个能干等 144s。
      if (error.banned) {
        await tripBreaker(ctx, options, error.message, logs)
        logs.push(`服务端拒绝，剩余 ${targets.length - cached - failed} 个对象本次不再尝试`)
        banHit = true
        break
      }
      if (error.loginFailed || error.timedOut) {
        logs.push(`${error.loginFailed ? '登录未成功' : '请求无响应'}，剩余 ${targets.length - cached - failed} 个对象本次不再尝试`)
        break
      }
      continue
    }
    const name = japaneseName(row)
    if (!name) {
      logs.push(`${target.kind} ${target.id}（${target.romaji}）没有日文名，跳过`)
      // 这条最容易误判成"AniDB 没录日文名"，实际也可能是缓存里存着查无此人的结果。
      // 把来源写清楚，省得下次又要去翻缓存文件。
      await appendErrLog(options, target, { aid },
        `没有日文名（来源：${fromCache ? '缓存' : '本次查询'}），原始行：${JSON.stringify(row)}`)
      continue
    }
    await clearErrLog(options, target)   // 拿到名字就把历史错误清掉：有文件 = 现在还没解决
    itemTags.push(`${options.tagPrefix}${target.label}: ${name}`)
  }

  const unresolved = targets.length - answered
  // 被封优先于失败：两者都是"没拿到"，但前者要你别再跑，后者可以重试
  const status = unresolved === 0
    ? '成功'
    : ((banHit || blocked) ? '被封' : (itemTags.length ? '部分失败' : '失败'))
  logs.push(`命中缓存 ${cached}，发出请求 ${attempted}（成功 ${fetched}），失败 ${failed}`
    + (blocked ? `，熔断拦下 ${blocked}` : '')
    + `；${targets.length} 个对象里 ${answered} 个有明确答复 → ${status}`)
  return {
    itemTags: [...new Set([...itemTags, statusTag(options, status)])],
    unitTags: [], unitPatches: [], logs,
    details: { aid, targets: targets.length, cached, attempted, fetched, failed, blocked, answered, status },
  }
}

// —— 从 anime XML 里按白名单挑出要查的 id ——
function collectTargets(xml, options, logs) {
  const out = []
  const seen = new Set()
  const add = (kind, id, label, romaji) => {
    const key = `${kind}:${id}`
    if (!id || seen.has(key)) return
    seen.add(key)
    out.push({ kind, id, label, romaji })
  }

  const creators = /<creators>([\s\S]*?)<\/creators>/.exec(xml)?.[1] || ''
  for (const m of creators.matchAll(/<name\b([^>]*)>([\s\S]*?)<\/name>/g)) {
    const type = /type="([^"]*)"/.exec(m[1])?.[1] || ''
    const label = options.creatorTypes[type]
    if (!label) continue                     // 白名单：没配的类型一概不查
    add('creator', /id="(\d+)"/.exec(m[1])?.[1] || '', label, decodeXml(m[2]).trim())
  }

  const chars = /<characters>([\s\S]*?)<\/characters>/.exec(xml)?.[1] || ''
  for (const m of chars.matchAll(/<character\b([^>]*)>([\s\S]*?)<\/character>/g)) {
    const type = /type="([^"]*)"/.exec(m[1])?.[1] || ''
    if (!options.characterTypes.includes(type)) continue
    if (options.fetchCharacterName) {
      const nameEl = /<name>([\s\S]*?)<\/name>/.exec(m[2])?.[1] || ''
      add('character', /id="(\d+)"/.exec(m[1])?.[1] || '', options.characterLabel, decodeXml(nameEl).trim())
    }
    if (options.fetchSeiyuu) {
      // 声优就是 creator，同一套 ID，不用另一个命令
      const sm = /<seiyuu\b([^>]*)>([\s\S]*?)<\/seiyuu>/.exec(m[2])
      if (sm) add('creator', /id="(\d+)"/.exec(sm[1])?.[1] || '', options.seiyuuLabel, decodeXml(sm[2]).trim())
    }
  }
  logs.push(`白名单命中 ${out.length} 个：` + out.map((t) => `${t.label}/${t.romaji}`).join('、'))
  return out
}

// 第 2 字段就是日文名。为空说明 AniDB 没录（实测存在这种），不编一个出来。
function japaneseName(row) {
  const fields = String(row || '').split('|')
  if (!fields[0] || fields[0] === '0') return ''     // "0|||..." = 查无此 id
  return (fields[1] || '').trim()
}

// —— 缓存：先存原始响应行，再解析。存的是服务端原话，解析逻辑改了也不用重新拉 ——
function cacheFile(options, target) {
  return path.join(options.cacheDir, target.kind, `${target.id}.txt`)
}
function errLogFile(options, target) {
  return path.join(options.cacheDir, target.kind, `${target.id}.err.log`)
}
async function readCache(options, target) {
  try {
    const raw = await readFile(cacheFile(options, target), 'utf8')
    // 空内容按未命中处理。readFile 对空文件返回 ''，不是 null——当成命中的话这个 id
    // 就再也查不回来了，日志还只说"没有日文名"，根本看不出是缓存坏了。
    return raw.trim() ? raw : null
  } catch {
    return null
  }
}
async function writeCache(options, target, row) {
  // 不把空行写进缓存，免得下次自己把自己坑了（245 却没有第二行、或写一半被杀）
  if (!String(row || '').trim()) return false
  const file = cacheFile(options, target)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, row, 'utf8')
  return true
}

// 查这个 id 出了什么问题，就近记在 <id>.err.log，和 <id>.txt 放一起。
// 成功之后删掉——文件存在就代表"现在还没解决"，不用再去比时间戳。
const ERR_LOG_MAX_LINES = 50
async function appendErrLog(options, target, context, message) {
  const file = errLogFile(options, target)
  const line = `[${new Date().toISOString()}] aid=${context.aid} ${target.kind}=${target.id}`
    + ` label=${target.label} romaji=${target.romaji || '-'}`
    + ` host=${options.udpHost}:${options.udpPort} | ${String(message).replace(/\s+/g, ' ').trim()}`
  try {
    let prev = ''
    try { prev = await readFile(file, 'utf8') } catch { /* 第一次写，没有就没有 */ }
    const kept = [...prev.split('\n').filter(Boolean), line].slice(-ERR_LOG_MAX_LINES)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${kept.join('\n')}\n`, 'utf8')
  } catch { /* 写日志失败绝不能影响 tag 产出 */ }
}
async function clearErrLog(options, target) {
  try { await rm(errLogFile(options, target)) } catch { /* 本来就没有 */ }
}

// —— UDP ——
async function fetchRow(options, target, logs) {
  const cmd = target.kind === 'creator' ? 'CREATOR' : 'CHARACTER'
  const key = target.kind === 'creator' ? 'creatorid' : 'charid'
  let resp = await request(options, `${cmd} ${key}=${target.id}`, logs)
  let code = resp.split(/[\s\n]/, 1)[0]
  // session 服务端会过期。只重登一次——密码错的话无限重试会把账号打进黑名单。
  if (code === '501' || code === '506') {
    logs.push('session 失效，重新登录一次')
    session = ''
    resp = await request(options, `${cmd} ${key}=${target.id}`, logs)
    code = resp.split(/[\s\n]/, 1)[0]
  }
  if (code === '245' || code === '235') return resp.split('\n')[1] || ''
  if (code === '340') return '0|||||||||'          // NO SUCH CHARACTER，当作查无此人缓存起来
  const error = new Error(resp.slice(0, 120))
  // 555 BANNED / 601 OUT OF SERVICE / 602 SERVER BUSY / 604 TIMEOUT-RESUBMIT：
  // 都是"服务端在拒绝你"，继续发只会更糟。原来这些走的是普通失败分支，
  // 实测单条目会顶着 555 把 12 个对象全发一遍。
  if (BAN_CODES.has(code)) error.banned = true
  throw error
}

async function request(options, body, logs) {
  await ensureSession(options, logs)
  return await send(options, `${body}&s=${session}`)
}

async function ensureSession(options, logs) {
  if (session) return
  const auth = `AUTH user=${options.user}&pass=${options.pass}&protover=3`
    + `&client=${options.client}&clientver=${options.clientVer}&enc=UTF8`
  let resp
  try {
    resp = await send(options, auth)
  } catch (error) {
    // 这里区分出来很重要：之前登录超时和查询超时打出来的日志一模一样，
    // 只能靠"有没有「已登录」那行"反推，排查一次要翻半天
    const e = new Error(`登录 ${options.udpHost}:${options.udpPort} 没有回应（${error.message}）。`
      + '包已经发出去了，是没收到回复——检查本机到该端口的 UDP 出站是否被挡')
    e.loginFailed = true
    throw e
  }
  const m = /^20[01] (\S+) /.exec(resp)
  if (!m) {
    const e = new Error(`登录被拒：${resp.slice(0, 120)}`)
    e.loginFailed = true
    // 凭据不对的话重试一百次也还是不对，而每个条目都会重来一次 AUTH——
    // 实测 3 个条目 3 次 AUTH，这正是把临时限制升级成封禁的典型路径
    e.banned = true
    throw e
  }
  session = m[1]
  logs.push('已登录 AniDB UDP')
}

function send(options, payload) {
  return new Promise((resolve, reject) => {
    // 限流只能自己控：AniDB 不返回任何限流信息，被封之前收不到预警
    const wait = Math.max(0, options.udpIntervalMs - (Date.now() - lastSentAt))
    setTimeout(() => {
      if (!sock) {
        sock = dgram.createSocket('udp4')
        // 不 unref 的话这个 socket 会一直占着 event loop
        sock.unref()
        sock.on('message', (buf) => {
          const handler = pending
          pending = null
          handler?.resolve(buf.toString('utf8').trim())
        })
        sock.on('error', (err) => {
          const handler = pending
          pending = null
          handler?.reject(err)
        })
      }
      if (pending) { reject(new Error('上一个请求还没回来')); return }
      const timer = setTimeout(() => {
        pending = null
        // 标记出来：一个包都没回，说明是链路问题，后面的 target 基本不用再试了
        const e = new Error('UDP 超时')
        e.timedOut = true
        reject(e)
      }, options.udpTimeoutMs)
      pending = {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      }
      lastSentAt = Date.now()
      scheduleIdleLogout(options)
      sock.send(Buffer.from(payload, 'utf8'), options.udpPort, options.udpHost, (err) => {
        if (err) { const h = pending; pending = null; h?.reject(err) }
      })
    }, wait)
  })
}

// 没人替脚本关连接，只能靠空闲计时自己退
function scheduleIdleLogout(options) {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (session && sock) {
      try { sock.send(Buffer.from(`LOGOUT s=${session}`, 'utf8'), options.udpPort, options.udpHost, () => {}) } catch { /* 关就关了 */ }
    }
    session = ''
    try { sock?.close() } catch { /* 同上 */ }
    sock = null
    pending = null
  }, options.udpIdleLogoutMs)
  idleTimer.unref?.()
}

function aidFromTags(tags) {
  for (const tag of tags || []) {
    const m = /^AniDB:\s*(\d+)\s*$/.exec(String(tag))
    if (m) return Number(m[1])
  }
  return 0
}

function decodeXml(value) {
  return String(value)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

// 状态 tag。失败路径原本什么都不产出，在库里和"从没跑过"长得一模一样，
// 没法筛出待处理的条目。tagPrefix 复用同一个前缀（默认 AniDBU），
// manifest 里把 AniDBU 声明为 exclusive group，所以同时只会有一个状态。
function statusTag(options, state) {
  return `${options.tagPrefix}: ${state}`
}

function empty(logs, details, statusTags = []) {
  return { itemTags: statusTags, unitTags: [], unitPatches: [], logs, details }
}

function requireOptions(raw) {
  const num = (key, fallback) => {
    const v = raw[key]
    if (v === null || v === undefined || v === '') return fallback
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} 不是合法数值：${JSON.stringify(v)}`)
    return n
  }
  const enabled = raw.enabled === true
  const str = (key) => {
    const v = String(raw[key] ?? '').trim()
    // 关着的时候不校验凭据——没配账号也该能安静地什么都不做
    if (!v && enabled) throw new Error(`${key} 未配置`)
    return v
  }
  const types = raw.creatorTypes && typeof raw.creatorTypes === 'object' && !Array.isArray(raw.creatorTypes)
    ? raw.creatorTypes
    : {}
  return {
    enabled,
    udpHost: String(raw.udpHost || 'api.anidb.net').trim(),
    udpPort: num('udpPort', 9000),
    user: str('user'),
    pass: str('pass'),
    client: str('client'),
    clientVer: String(raw.clientVer ?? '1').trim() || '1',
    animeXmlDir: String(raw.animeXmlDir || '/data/cache/anidb-api').trim(),
    cacheDir: String(raw.cacheDir || '/data/cache/anidb-udp').trim(),
    tagPrefix: String(raw.tagPrefix ?? 'AniDBU'),
    // 白名单：key 是 AniDB 的 creator type，value 是 tag 里的中文标签。
    // 没列进来的类型一概不查——这里同时决定了"查什么"和"叫什么"。
    creatorTypes: types,
    characterTypes: Array.isArray(raw.characterTypes) ? raw.characterTypes.map(String) : [],
    seiyuuLabel: String(raw.seiyuuLabel ?? '声优'),
    characterLabel: String(raw.characterLabel ?? '角色'),
    fetchSeiyuu: raw.fetchSeiyuu === true,
    fetchCharacterName: raw.fetchCharacterName === true,
    udpIntervalMs: num('udpIntervalMs', 4000),
    udpTimeoutMs: num('udpTimeoutMs', 15000),
    udpIdleLogoutMs: num('udpIdleLogoutMs', 300000),
    // 单条目请求上限。撞 scriptTimeoutMs 被硬杀的话整轮产出会丢，不如自己先停。
    maxRequestsPerItem: num('maxRequestsPerItem', 12),
    // AniDB 不返回 Retry-After，冷却时长只能自己定。30 分钟是保守猜测，不是实测值。
    banCooldownMs: num('banCooldownMs', 1800000),
  }
}
