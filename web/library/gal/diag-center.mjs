// 诊断中心（服务端）：每个诊断是一条注册项 { id, title, description, scope, cost, params, run(ctx, params) }。
//   · 列出来（list）不算任何东西；只有用户在诊断窗口里点了某一项才 run（列表页的小按钮只负责打开窗口）
//   · scope：card（某张卡片，要带 node）/ item（整个游戏条目）/ global（整个库）；cost：light / medium / heavy（界面上标出来，heavy 会先确认）
//   · 结果统一成 { summary, sections: [{ title, columns, rows }], notes }：界面只写一份渲染（表格 + 复制成文本 + 下载 JSON），新增诊断不用改界面
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const MB = 1024 * 1024
const fmtBytes = (n) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n >= MB ? `${(n / MB).toFixed(2)}MB` : n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`)

// 目录总大小（递归；文件数上限，超了标「≥」）
async function dirSize(dir, limit = 200000) {
  let bytes = 0
  let files = 0
  let capped = false
  const walk = async (d) => {
    let entries
    try { entries = await readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (files >= limit) { capped = true; return }
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) { try { bytes += (await stat(p)).size; files += 1 } catch { /* 读不了的跳过 */ } }
    }
  }
  await walk(dir)
  return { bytes, files, capped }
}

export const DIAGNOSTICS = [
  {
    id: 'thumbs',
    title: '缩略图候选与过滤',
    description: '这张卡片的缩略图是怎么选出来的：每个候选图来自哪条规则、容器里的原始大小、转换后的大小、宽高、被 thumbSkip 哪条规则丢掉还是留下。会把候选图从容器里解压出来量大小，所以有点慢。',
    scope: 'card',
    cost: 'medium',
    params: [{ key: 'limit', label: '最多看几个候选', type: 'number', default: 30, min: 1, max: 200 }],
    async run(ctx, params) {
      const card = ctx.card
      if (!card || card.type !== 'script') {
        return { summary: '目录 / 分组卡片暂时不支持逐张诊断', sections: [{ title: '当前缩略图规则', columns: ['规则', '值'], rows: [['thumbSkip', JSON.stringify(ctx.config.thumbSkip || [])], ['dirThumbs', JSON.stringify(ctx.config.dirThumbs || [])], ['thumbSources', `${(ctx.config.thumbSources || []).length} 条`]] }], notes: ['脚本卡片（单个脚本）才有逐张候选；目录卡片的图来自 dirThumbs / thumbSources，可以先看上面的规则。'] }
      }
      const r = await ctx.provider.diagnoseThumbs({ scriptRel: card.id, limit: params.limit })
      const kept = r.rows.filter((x) => x.kept).length
      const sections = [{
        title: `候选图（共 ${r.total} 个，显示前 ${r.rows.length} 个）`,
        columns: ['来源', '路径', '容器内大小', '转换后大小', '宽×高', '结果', '原因'],
        rows: r.rows.map((x) => [x.from, x.candidate, fmtBytes(x.stored), fmtBytes(x.size), x.dims ? `${x.dims.width}×${x.dims.height}` : '—', x.kept ? '留下' : '丢掉', x.reason || '']),
      }]
      sections.push({ title: '当前 thumbSkip 规则', columns: ['#', '规则'], rows: (r.skipRules || []).length ? r.skipRules.map((rule, i) => [String(i + 1), JSON.stringify(rule)]) : [['—', '没有配置（不过滤）']] })
      if (r.thumbs.length) sections.push({ title: '最后给卡片的缩略图', columns: ['#', '路径'], rows: r.thumbs.map((t, i) => [String(i + 1), t]) })
      return { summary: `适配器 ${r.adapterId || '—'}；候选 ${r.total} 个，留下 ${kept} 个、丢掉 ${r.rows.length - kept} 个（只统计显示的）；卡片最终 ${r.thumbs.length} 张`, sections, notes: r.why.length ? r.why : [] }
    },
  },
  {
    id: 'config',
    title: '配置检查',
    description: '这个条目的配置里被丢掉 / 报警的内容（写错的字段、坏正则、超限），以及和缩略图、容器相关的几项当前值。只读配置，不碰文件。',
    scope: 'item',
    cost: 'light',
    params: [],
    async run(ctx) {
      const warnings = [...(ctx.config.warnings || []), ...(ctx.extraWarnings || [])]
      const c = ctx.config
      const rows = [
        ['适配器', (ctx.item.adapters || []).join('、') || '—'],
        ['game.id', c.game?.id || '—'],
        ['容器', c.containers?.enabled ? `开（${c.containers.mode || 'hybrid'}，目录 ${c.containers.dir || '—'}）` : '关'],
        ['thumbSkip', JSON.stringify(c.thumbSkip || [])],
        ['thumbFallback.max', String(c.thumbFallback?.max ?? '—')],
        ['脚本根', (c.scriptRoots || []).map((r) => r.dir).join('、') || '—'],
      ]
      return {
        summary: warnings.length ? `${warnings.length} 条配置警告` : '没有配置警告',
        sections: [
          { title: '配置警告', columns: ['字段', '原因', '片段'], rows: warnings.length ? warnings.map((w) => [String(w.field ?? ''), String(w.reason ?? ''), String(w.snippet ?? '').slice(0, 200)]) : [['—', '没有', '']] },
          { title: '当前关键配置', columns: ['项', '值'], rows },
        ],
        notes: [],
      }
    },
  },
  {
    id: 'cache',
    title: '缓存占用',
    description: '图片缩略图、容器解压出来的原图、视频缩略图、渲染缩略图、exe 图标这几个缓存目录各占多少空间（遍历目录，文件很多时会花几秒）。',
    scope: 'global',
    cost: 'medium',
    params: [],
    async run(ctx) {
      const dirs = [
        ['gal-img-thumbs', '卡片 / 画廊的图片缩略图（WebP）'],
        ['gal-arc-res', '容器里解出来的原图 / 原音频（有总量上限，LRU）'],
        ['gal-thumbs', '视频缩略图（JPEG 一帧）'],
        ['gal-render-thumbs', '播放器渲染回传的合成缩略图'],
        ['gal-exe-icons', 'exe 图标封面'],
      ]
      const rows = []
      let total = 0
      for (const [name, what] of dirs) {
        const r = await dirSize(path.join(ctx.dataDir, 'cache', name))
        total += r.bytes
        rows.push([name, what, fmtBytes(r.bytes), `${r.files}${r.capped ? '+' : ''}`])
      }
      return { summary: `合计 ${fmtBytes(total)}（${ctx.dataDir}/cache/ 下）`, sections: [{ title: '缓存目录', columns: ['目录', '内容', '大小', '文件数'], rows }], notes: ['gal-arc-res 的上限由环境变量 GAL_ARC_CACHE_MB 控制（默认 2048）。'] }
    },
  },
]

// 某个范围能做哪些诊断（不执行任何诊断）
export function listDiagnostics(scope) {
  const rank = { card: 0, item: 1, global: 2 }
  return DIAGNOSTICS.filter((d) => rank[d.scope] >= (rank[scope] ?? 0)).map(({ run, ...rest }) => rest)
}

export function findDiagnostic(id) {
  return DIAGNOSTICS.find((d) => d.id === id) || null
}

// 参数按定义规整（数字夹范围，不认识的丢掉）
export function normalizeParams(def, raw) {
  const out = {}
  for (const p of def.params || []) {
    if (p.type === 'number') {
      const n = Number(raw?.[p.key])
      out[p.key] = Number.isFinite(n) ? Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, Math.floor(n))) : p.default
    } else out[p.key] = raw?.[p.key] ?? p.default
  }
  return out
}

// 把结果渲染成纯文本（给「复制」用；界面也用它）
export function diagnosticText(title, result) {
  const lines = [`# ${title}`, result.summary || '']
  for (const section of result.sections || []) {
    lines.push('', `## ${section.title}`, section.columns.join(' | '))
    for (const row of section.rows) lines.push(row.join(' | '))
  }
  if (result.notes?.length) lines.push('', '## 备注', ...result.notes.map((n) => `- ${n}`))
  return lines.join('\n')
}
