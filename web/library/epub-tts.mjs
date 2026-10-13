// GSV-TTS-Lite 是参考音频克隆音色（speaker_audio/prompt_audio），不是挑 voice 枚举。
// 只用它的批量推理接口：一次请求可以带多句文本，减少请求开销，
// 也不需要流式接口——朗读是整句整句播放，不是实时对话。
// 参考：https://github.com/lgithubl/GSV-TTS-Lite API/PERSONAL_API.md

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
// 单句失败不中断整批——GSV-TTS-Lite 的 batched 接口本身是整批成功或整批报错，
// 这里统一按整批处理：失败就把这批里每一句都标 error，调用方据此跳过。
//
// 注：/tts/batched 的 TTSBatchedRequest 没有 media_type 字段，接口内部写死
// filename = f"tts_{uuid}.wav"——media_type 只在 /tts、/tts/stream 的请求模型里
// 才存在。之前以为三个接口都认这个参数，实测直接查了 GSV-TTS-Lite 源码才发现
// 传了也没用，一直都是 wav，所以这里干脆不传、也不在上层搞一个假装能选格式的配置项。
export async function callGsvTtsBatched({ apiBase, speakerAudio, promptAudio, promptText, texts }) {
  if (!texts.length) return []
  if (!speakerAudio || !promptAudio) {
    return texts.map((text) => ({ text, error: '未配置参考音频（speakerAudio/promptAudio）' }))
  }
  const base = String(apiBase || '').replace(/\/+$/, '')
  let response
  try {
    response = await fetchWithTimeout(`${base}/tts/batched`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts,
        speaker_audio: speakerAudio,
        prompt_audio: promptAudio,
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
