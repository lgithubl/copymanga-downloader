// 卡片封面悬停放大层的尺寸/位置计算。纯函数，不碰 DOM，Node 里直接单测（scripts/dev/hover-preview-selftest.mjs）。

export const HOVER_DELAY_MS = 300
export const HOVER_MAX_HEIGHT_RATIO = 0.8
export const HOVER_MAX_UPSCALE = 1.25
export const HOVER_GAP = 12
export const HOVER_MARGIN = 8

// 放大层里图片的显示尺寸：整图（contain，不裁）、高度不超过视口 80%、宽度不超过视口一半，
// 且相对原图最多放大 1.25 倍——小图硬拉大只会糊。
// maxWidth（可选）：卡片两侧能给的最大宽度，见 sideRoom——放不下就缩，不去压卡片。
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

// 卡片左右两侧较宽的一侧能放多宽（已扣掉间隔和视口边距）
export function sideRoom({ cardRect, viewportWidth }) {
  return Math.max(viewportWidth - cardRect.right - HOVER_GAP - HOVER_MARGIN, cardRect.left - HOVER_GAP - HOVER_MARGIN)
}

// 放大层的位置：优先放卡片右侧，放不下放左侧，两边都放不下取空间大的一侧并夹进视口；
// 垂直方向以卡片中线对齐后夹在视口内。
export function placePopover({ cardRect, width, height, viewportWidth, viewportHeight }) {
  const rightRoom = viewportWidth - cardRect.right - HOVER_GAP - HOVER_MARGIN
  const leftRoom = cardRect.left - HOVER_GAP - HOVER_MARGIN
  let side
  if (rightRoom >= width) side = 'right'
  else if (leftRoom >= width) side = 'left'
  else side = rightRoom >= leftRoom ? 'right' : 'left'
  let left = side === 'right' ? cardRect.right + HOVER_GAP : cardRect.left - HOVER_GAP - width
  left = Math.max(HOVER_MARGIN, Math.min(left, viewportWidth - width - HOVER_MARGIN))
  const mid = cardRect.top + cardRect.height / 2
  let top = mid - height / 2
  top = Math.max(HOVER_MARGIN, Math.min(top, viewportHeight - height - HOVER_MARGIN))
  return { left: Math.round(left), top: Math.round(top), side }
}
