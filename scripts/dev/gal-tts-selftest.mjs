// Gal 朗读服务（web/library/gal-tts.mjs）：说话人音色规则 / 缓存 / 去重 / 优先级 / 并发上限 / 同音色合批 / 取消 / 内容错误逐句重试 / skipped / waitMs——用假的 synth
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createGalTts, parseGalTtsRules } from '../../web/library/gal-tts.mjs'
import { toSpokenText } from '../../web/library/epub-tts-text.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => { if (ok) { passed += 1; console.log(`PASS ${name}`) } else { failed += 1; console.log(`FAIL ${name}  <-- ${detail}`) } }
const J = (v) => JSON.stringify(v)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- 规则 ----
{
  const { rules, errors } = parseGalTtsRules([{ match: '^小夜$', speaker_audio: 'sayo.wav', text_language: 'ja' }, { match: '(', speaker_audio: 'x' }, { match: '女', on: 'text', prompt_audio: 'p.wav' }, { match: 'a', on: 'bogus' }, { match: 'b', text_language: 'fr' }, 5])
  check('规则校验：合法的留下（按说话人 / 按台词），坏正则 / on 不对 / 语言不认识 / 不是对象 都报错丢掉', rules.length === 2 && errors.length === 4 && rules[0].on === 'speaker' && rules[1].on === 'text', J([rules.length, errors]))
  check('规则不是数组 = 报错；空 = 没有规则', parseGalTtsRules('x').errors.length === 1 && parseGalTtsRules(undefined).rules.length === 0)
}

// ---- 假 synth ----
const state = { delay: 0, calls: [], inFlight: 0, peak: 0, contentErrorOn: null, failAll: false }
const synth = async ({ speakerAudio, textLanguage, texts }) => {
  state.calls.push({ voice: speakerAudio || '', lang: textLanguage || '', texts: [...texts] })
  state.inFlight += 1
  state.peak = Math.max(state.peak, state.inFlight)
  await sleep(state.delay)
  state.inFlight -= 1
  if (state.failAll) return texts.map((text) => ({ text, error: 'GSV-TTS-Lite 请求失败: down' }))
  if (state.contentErrorOn && texts.length > 1 && texts.includes(state.contentErrorOn)) return texts.map((text) => ({ text, error: 'GSV-TTS-Lite 返回 500: bad' }))
  return texts.map((text) => (text === state.contentErrorOn ? { text, error: 'GSV-TTS-Lite 返回 500: bad' } : { text, buffer: Buffer.from(`WAV:${text}`), subtitle: [{ text }] }))
}
const dir = await mkdtemp(path.join(os.tmpdir(), 'gal-tts-'))
const baseCfg = { galTtsEnabled: true, epubTtsApiBase: 'http://gsv', epubTtsSpeakerAudio: 'default.wav', epubTtsMaxConcurrency: 1, epubTtsBatchMaxSentences: 3, epubTtsBatchMaxChars: 100, galTtsRules: [{ match: '^小夜$', speaker_audio: 'sayo.wav' }] }
const mk = (cfg, name) => createGalTts({ getConfig: () => cfg, cacheDir: path.join(dir, name), synth, spoken: (t) => toSpokenText(t, []) })
const reset = () => { state.delay = 0; state.calls.length = 0; state.peak = 0; state.contentErrorOn = null; state.failAll = false }
const L = (text, speaker = '') => ({ text, speaker })

try {
  // ---- 基本 + 音色 + 合批 + 缓存 ----
  {
    reset()
    const tts = mk({ ...baseCfg }, 'basic')
    const r = await tts.handle({ lines: [L('一', '小夜'), L('二', '小夜'), L('三', '旁白'), L('四', '小夜')], priority: 'now', waitMs: 5000 })
    check('音色：说话人「小夜」命中规则用 sayo.wav，别人用默认；同一音色的句子合批（小夜 3 句一批、其他 1 句一批）', r.status === 200 && r.body.results.every((x) => x.state === 'ok' && /^\/api\/gal\/tts\/[0-9a-f]{40}\.wav$/.test(x.url)) && state.calls.length === 2 && state.calls.some((c) => c.voice === 'sayo.wav' && c.texts.length === 3) && state.calls.some((c) => c.voice === 'default.wav' && c.texts.length === 1), J(state.calls))
    const hash = /([0-9a-f]{40})\.wav/.exec(r.body.results[0].url)[1]
    check('音频落盘：wavPath(hash) 读得到合成的内容；hash 不合法 = null', (await readFile(tts.wavPath(hash))).toString() === 'WAV:一' && tts.wavPath('../x') === null)
    const again = await tts.handle({ lines: [L('一', '小夜')], priority: 'now' })
    check('缓存：同一句同一音色再要 = 不再合成；换一个实例（重启）也命中', again.body.results[0].state === 'ok' && state.calls.length === 2 && (await mk({ ...baseCfg }, 'basic').handle({ lines: [L('一', '小夜')], priority: 'now' })).body.results[0].state === 'ok' && state.calls.length === 2)
    const other = await tts.handle({ lines: [L('一', '旁白')], priority: 'now', waitMs: 3000 })
    check('同一句换音色（说话人不同）= 另一份缓存，重新合成', other.body.results[0].state === 'ok' && state.calls.length === 3)
    const lang = await tts.handle({ lines: [{ text: '一', speaker: '小夜', lang: 'zh' }], priority: 'now', waitMs: 3000 })
    check('lang 覆盖文本语言（读译文用 zh）：传给 GSV 的 text_language = zh，缓存另算', lang.body.results[0].state === 'ok' && state.calls.at(-1).lang === 'zh' && state.calls.length === 4)
  }
  // ---- 批的大小上限 ----
  {
    reset()
    const tts = mk({ ...baseCfg, epubTtsBatchMaxSentences: 3, epubTtsBatchMaxChars: 20 }, 'batch')
    await tts.handle({ lines: ['甲甲甲甲甲甲甲甲甲', '乙乙乙乙乙乙乙乙乙', '丙丙丙丙丙丙丙丙丙', '丁丁丁丁丁丁丁丁丁', '戊戊戊戊戊戊戊戊戊'].map((t) => L(t, '旁白')), priority: 'ahead', waitMs: 5000 })
    check('每批上限：每批最多 3 句、总字数 ≤ 20（配置下限，每句 9 字 → 每批 2 句）→ 3 批（2 / 2 / 1）', J(state.calls.map((c) => c.texts.length)) === J([2, 2, 1]), J(state.calls.map((c) => c.texts)))
  }
  // ---- 并发上限 ----
  for (const limit of [1, 2]) {
    reset()
    state.delay = 60
    const tts = mk({ ...baseCfg, epubTtsMaxConcurrency: limit, epubTtsBatchMaxSentences: 1 }, `conc${limit}`)
    const r = await tts.handle({ lines: Array.from({ length: 8 }, (_, i) => L(`句${i}`, '旁白')), priority: 'ahead', waitMs: 20000 })
    check(`并发上限 ${limit}：8 句、每批 1 句，同时在合成的峰值 = ${limit}（观测 ${state.peak}）`, r.body.results.every((x) => x.state === 'ok') && state.peak === limit && tts.stats().maxRunning === limit, J([state.peak, tts.stats()]))
  }
  // ---- 优先级 ----
  {
    reset()
    state.delay = 80
    const tts = mk({ ...baseCfg, epubTtsBatchMaxSentences: 1 }, 'prio')
    const ahead = tts.handle({ lines: Array.from({ length: 6 }, (_, i) => L(`预加载${i}`, '旁白')), priority: 'ahead', waitMs: 20000 })
    await sleep(30)
    const t0 = Date.now()
    const now = await tts.handle({ lines: [L('马上要听', '旁白')], priority: 'now', waitMs: 20000 })
    const waited = Date.now() - t0
    await ahead
    check('优先级：预加载排着队（6 批）时，马上要听的这一句（now）只等正在合成的那一批，排在第 2 个（不是第 7 个）', now.body.results[0].state === 'ok' && state.calls[1].texts[0] === '马上要听' && waited < 80 * 3 + 100, J([waited, state.calls.map((c) => c.texts[0])]))
  }
  // ---- 去重 / 取消 ----
  {
    reset()
    state.delay = 60
    const tts = mk({ ...baseCfg }, 'dedup')
    const rs = await Promise.all([1, 2, 3].map(() => tts.handle({ lines: [L('同一句', '旁白')], priority: 'now', waitMs: 5000 })))
    check('去重：3 个请求同时要同一句 = 只合成一次', state.calls.length === 1 && rs.every((r) => r.body.results[0].state === 'ok'), J(state.calls.length))
    reset()
    state.delay = 80
    const tts2 = mk({ ...baseCfg, epubTtsBatchMaxSentences: 1 }, 'abort')
    const controller = new AbortController()
    const p = tts2.handle({ lines: Array.from({ length: 6 }, (_, i) => L(`取消${i}`, '旁白')), priority: 'ahead', waitMs: 20000 }, { signal: controller.signal })
    await sleep(30)
    controller.abort()
    await p
    await sleep(200)
    check('取消：预加载请求中途取消，还没开始合成的不再合成（只合成了已经开始的第一句）', state.calls.length === 1 && tts2.stats().queued === 0 && tts2.stats().inflight === 0, J([state.calls.length, tts2.stats()]))
  }
  // ---- 内容错误：逐句重试 ----
  {
    reset()
    state.contentErrorOn = '坏句子'
    const tts = mk({ ...baseCfg }, 'content')
    const r = await tts.handle({ lines: [L('好句一', '旁白'), L('坏句子', '旁白'), L('好句二', '旁白')], priority: 'now', waitMs: 5000 })
    check('整批因为一句话内容有问题失败：逐句重试，只有坏句子 error，好句子照常拿到音频', r.body.results[0].state === 'ok' && r.body.results[1].state === 'error' && r.body.results[2].state === 'ok' && state.calls.length === 4, J([r.body.results.map((x) => x.state), state.calls.length]))
  }
  // ---- 失败 / 负缓存 / skipped / waitMs / 开关 ----
  {
    reset()
    state.failAll = true
    const tts = mk({ ...baseCfg }, 'fail')
    const bad = await tts.handle({ lines: [L('合成失败', '旁白')], priority: 'now', waitMs: 3000 })
    const n = state.calls.length
    const again = await tts.handle({ lines: [L('合成失败', '旁白')], priority: 'now', waitMs: 3000 })
    check('合成失败：回 error；30 秒内再要同一句不再打 GSV（负缓存）', bad.body.results[0].state === 'error' && again.body.results[0].state === 'error' && state.calls.length === n)
    reset()
    const t2 = mk({ ...baseCfg }, 'skip')
    const sk = await t2.handle({ lines: [L('＊＊＊', '旁白'), L('……', ''), L('有字', '旁白')], priority: 'now', waitMs: 3000 })
    check('没有可读内容（只有符号）的句子 = skipped，不发给 GSV；有字的照常', sk.body.results[0].state === 'skipped' && sk.body.results[1].state === 'skipped' && sk.body.results[2].state === 'ok' && state.calls.length === 1 && state.calls[0].texts.length === 1)
    reset()
    state.delay = 300
    const t3 = mk({ ...baseCfg }, 'wait')
    const t0 = Date.now()
    const first = await t3.handle({ lines: [L('慢慢合成', '旁白')], priority: 'now', waitMs: 80 })
    check('waitMs：到点还没好先回 pending（约 80ms），合成继续在后台做', first.body.results[0].state === 'pending' && Date.now() - t0 < 250)
    await sleep(400)
    check('后台做完后再要：直接拿到（缓存）', (await t3.handle({ lines: [L('慢慢合成', '旁白')], priority: 'now' })).body.results[0].state === 'ok' && state.calls.length === 1)
    const off = mk({ ...baseCfg, galTtsEnabled: false }, 'off')
    const noApi = mk({ ...baseCfg, epubTtsApiBase: '' }, 'noapi')
    const v = mk({ ...baseCfg }, 'valid')
    check('没启用 / 没配 TTS 地址 = 503；lines 不对 / 太多 / 太长 = 400', (await off.handle({ lines: [L('a')] })).status === 503 && (await noApi.handle({ lines: [L('a')] })).status === 503 && (await v.handle({ lines: [] })).status === 400 && (await v.handle({ lines: Array.from({ length: 41 }, () => L('a')) })).status === 400 && (await v.handle({ lines: [L('x'.repeat(1001))] })).status === 400)
  }
} finally { await rm(dir, { recursive: true, force: true }) }
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
