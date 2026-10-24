// 卡片封面悬停「原位展开」的尺寸/位置计算。纯函数，不碰 DOM，Node 里直接单测（scripts/dev/hover-preview-selftest.mjs）。
// 展开层从封面框的位置出发（和卡片上看到的一模一样），先「提」一下再长到整图大小。

export const HOVER_DELAY_MS = 300
export const HOVER_MAX_HEIGHT_RATIO = 0.8
export const HOVER_MAX_UPSCALE = 1.25
export const HOVER_MAX_COVER_RATIO = 1.8   // 展开后宽度最多是封面框宽度的 1.8 倍（库页「更多」里可以改）：卡窄了，浮层也跟着小
export const HOVER_MARGIN = 8

// 展开后图片的显示尺寸：整图（不裁）、高度不超过视口 80%、宽度不超过 maxWidth 和视口一半，
// 且相对原图最多放大 1.25 倍——小图硬拉大只会糊。
export function fitPreview({ naturalWidth, naturalHeight, viewportWidth, viewportHeight, maxWidth = Infinity }) {
  const w = Number(naturalWidth)
  const h = Number(naturalHeight)
  if (!(w > 0) || !(h > 0)) return null
  const scale = Math.min(
    (viewportHeight * HOVER_MAX_HEIGHT_RATIO) / h,
    Math.min(viewportWidth * 0.5, maxWidth) / w,
    HOVER_MAX_UPSCALE
  )
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

// 展开后的位置：以封面框中心为锚点，夹在视口内。
export function placeExpanded({ coverRect, width, height, viewportWidth, viewportHeight }) {
  const left = coverRect.left + coverRect.width / 2 - width / 2
  const top = coverRect.top + coverRect.height / 2 - height / 2
  return {
    left: Math.round(Math.max(HOVER_MARGIN, Math.min(left, viewportWidth - width - HOVER_MARGIN))),
    top: Math.round(Math.max(HOVER_MARGIN, Math.min(top, viewportHeight - height - HOVER_MARGIN)))
  }
}

// 展开后没有比封面框更大（两个方向都不超过）就没必要展开，比如 40x40 的小图
export function worthExpanding({ width, height }, coverRect) {
  return width > coverRect.width + 1 || height > coverRect.height + 1
}
