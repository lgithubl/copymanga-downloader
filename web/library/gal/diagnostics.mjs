// 列表阶段的诊断小工具：「为什么这个文件没有适配器认」要能说清楚，但不能把脚本内容漏出去。
//   maskHeadSnippet(text)  取开头一小段给人看：控制字符去掉、空白折叠、连续 3 个以上的 CJK 字符换成 <N字>（台词 / 人名不外露，结构符号和 ASCII 关键字留着），最多 160 个字符
//   explainRejectedFile({ text, size, maxBytes, adapterIds, options }) → { head, reasons: ['<适配器 id>: <原因>', …] }
//       size 为 0 / 超过上限：直接说是文件本身的问题（不是格式）；否则每个参与嗅探的适配器各一句（适配器实现了 explainSniff(text, options) 就用它的，没有 = 「没有匹配 sniff」）
import { explainSniffGalAdapters } from './adapters/index.mjs'

export const SNIPPET_CHARS = 160
const CJK_RUN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff66-\uff9f]{3,}/g
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g

export function maskHeadSnippet(text, max = SNIPPET_CHARS) {
  const head = String(text ?? '').slice(0, max * 4)   // 先截一截再处理：不对整段长文本做正则
  const clean = head.replace(CONTROL, '').replace(/\s+/g, ' ').trim().replace(CJK_RUN, (run) => `<${[...run].length}字>`)
  const chars = [...clean]
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : clean
}

export const MAX_REASON_CHARS = 140
export function explainRejectedFile({ text = '', size = null, maxBytes = Infinity, adapterIds = null, options = null } = {}) {
  if (size === 0) return { head: '', reasons: ['文件是空的（0 字节）'] }
  if (Number.isFinite(maxBytes) && size > maxBytes) return { head: '', reasons: [`文件 ${(size / 1048576).toFixed(1)} MB，超过脚本大小上限 ${(maxBytes / 1048576).toFixed(1)} MB（config.limits.scriptBytes），没有读`] }
  const reasons = explainSniffGalAdapters(text, adapterIds, options).slice(0, 12).map(({ id, reason }) => `${id}: ${String(reason).replace(/\s+/g, ' ').slice(0, MAX_REASON_CHARS)}`)
  return { head: maskHeadSnippet(text), reasons: reasons.length ? reasons : ['没有可用的适配器（adapters 为空 / 都不认识）'] }
}
