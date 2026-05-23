/**
 * 将 Bayer 数据下采样到适合动画播放的尺寸
 * 保持 Bayer 模式的 2x2 结构
 */

import { type BayerResult } from './bayer'

/**
 * 下采样 Bayer 马赛克到目标最大边长
 * 使用 2x2 块平均以保持 Bayer 模式完整性
 */
export function downsampleBayer(bayer: BayerResult, maxSize: number): BayerResult {
  const { mosaic, width, height, pattern } = bayer

  if (width <= maxSize && height <= maxSize) {
    return bayer // 不需要下采样
  }

  // 计算缩放因子（必须是 2 的倍数以保持 Bayer 模式）
  // 思路：每 blockSize×blockSize 的块下采样为 2x2 Bayer 块（缩小 blockSize/2 倍）
  const rawScale = Math.max(width, height) / maxSize
  // blockSize 是偶数，且 blockSize/2 至少满足缩放比
  const halfBlock = Math.max(1, Math.ceil(rawScale))
  const blockSize = halfBlock * 2

  const dstW = Math.floor(width / blockSize) * 2
  const dstH = Math.floor(height / blockSize) * 2

  if (dstW < 4 || dstH < 4) return bayer

  const dst = new Uint8ClampedArray(dstW * dstH)

  for (let dy = 0; dy < dstH; dy += 2) {
    for (let dx = 0; dx < dstW; dx += 2) {
      const srcBaseY = (dy / 2) * blockSize
      const srcBaseX = (dx / 2) * blockSize

      // 对 2x2 Bayer 块中的每个位置分别取平均
      for (let by = 0; by < 2; by++) {
        for (let bx = 0; bx < 2; bx++) {
          let sum = 0
          let count = 0
          for (let sy = 0; sy < halfBlock; sy++) {
            for (let sx = 0; sx < halfBlock; sx++) {
              const srcY = srcBaseY + by + sy * 2
              const srcX = srcBaseX + bx + sx * 2
              if (srcY < height && srcX < width) {
                sum += mosaic[srcY * width + srcX]!
                count++
              }
            }
          }
          dst[(dy + by) * dstW + (dx + bx)] = count > 0 ? Math.round(sum / count) : 0
        }
      }
    }
  }

  return { mosaic: dst, width: dstW, height: dstH, pattern }
}
