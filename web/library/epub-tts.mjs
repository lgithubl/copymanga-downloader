// GSV-TTS-Lite 是参考音频克隆音色（speaker_audio/prompt_audio），不是挑 voice 枚举。
// 用的是 docker/web_app.py（Dockerfile.web 唯一真实跑的入口，CMD 写死
// uvicorn docker.web_app:app）的 /tts/batched（disable-auto-download 分支
// 新加的）。统一走这一个接口，单句也传长度为 1 的 texts：查过底层 infer_batched
// 的实现，单条场景就是把文本包成长度 1 的 list 走同一套流程，没有会被拖慢的
// 结构性原因，不必为了"可能更快"去维护单句 /api/tts 这另一条路径——而且统一
// 用批量还白捡一个好处：所有句子（包括当前正在读的这句）都能拿到 subtitle
// 时间戳，不用退化成 currentTime/duration 的百分比估算。
// 参考：GSV-TTS-Lite 仓库 docker/web_app.py + gsv_tts/TTS.py（disable-auto-download 分支）

const REQUEST_TIMEOUT_MS = 60000

async function fetchWithTimeout(url, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('request timeout')), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// 返回 [{ text, buffer, subtitle, error }]，和入参 texts 一一对应，顺序不变。
// /tts/batched 是整批成功或整批报错（没有"这批里哪句失败了"的细粒度信息），
// 失败就把这批里每一句都标 error，调用方据此逐句跳过，不中断整体朗读。
export async function callGsvTtsBatched({ apiBase, speakerAudio, promptAudio, promptText, texts }) {
  if (!texts.length) return []
  const base = String(apiBase || '').replace(/\/+$/, '')
  let response
  try {
    response = await fetchWithTimeout(`${base}/tts/batched`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts,
        // speaker_audio/prompt_audio/prompt_text 都允许留空——GSV-TTS-Lite
        // 的 /tts/batched（docker/web_app.py）本来就支持这三个留空时落回
        // 它自己的 DEFAULT_SPEAKER_AUDIO/DEFAULT_PROMPT_AUDIO/
        // DEFAULT_PROMPT_TEXT 环境变量。之前这里对 speakerAudio/
        // promptAudio 做了硬性拦截，哪怕服务端已经配好了默认参考音频也会
        // 被挡在请求之前，现在统一成和 promptText 一样"留空就不传这个
        // 字段"，具体能不能用交给服务端自己判断（服务端两边都没配的话
        // 会返回 400，照样会体现成这批文本的 error）。
        speaker_audio: speakerAudio || undefined,
        prompt_audio: promptAudio || undefined,
        prompt_text: promptText || undefined,
        return_subtitles: true,
      }),
    })
  } catch (error) {
    const message = `GSV-TTS-Lite 请求失败: ${error.message}`
    return texts.map((text) => ({ text, error: message }))
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    const message = `GSV-TTS-Lite 返回 ${response.status}: ${raw.slice(0, 200)}`
    return texts.map((text) => ({ text, error: message }))
  }
  const payload = await response.json()
  if (!payload.success || !Array.isArray(payload.filenames)) {
    return texts.map((text) => ({ text, error: `GSV-TTS-Lite 响应格式异常: ${JSON.stringify(payload).slice(0, 200)}` }))
  }
  const results = []
  for (let i = 0; i < texts.length; i++) {
    const filename = payload.filenames[i]
    if (!filename) {
      results.push({ text: texts[i], error: '未返回对应的音频文件名' })
      continue
    }
    try {
      const audioRes = await fetchWithTimeout(`${base}/audio/${filename}`, { method: 'GET' })
      if (!audioRes.ok) throw new Error(`取音频文件失败 ${audioRes.status}`)
      const buffer = Buffer.from(await audioRes.arrayBuffer())
      results.push({ text: texts[i], buffer, subtitle: payload.subtitles?.[i] || null })
    } catch (error) {
      results.push({ text: texts[i], error: error.message })
    }
  }
  return results
}



