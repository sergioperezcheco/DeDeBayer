/**
 * Bayer CFA (Color Filter Array) 相关算法
 *
 * Bayer 模式 (RGGB):
 *   R G R G ...
 *   G B G B ...
 *   R G R G ...
 *   G B G B ...
 *
 * 本模块实现：
 * 1. 将 RGB 图像"反解"为 Bayer 马赛克（模拟传感器原始数据）
 * 2. 多种解拜耳（demosaic）算法：最近邻、双线性、Malvar-He-Cutler
 */

export type BayerPattern = 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG'

export interface BayerResult {
  /** 单通道 Bayer 马赛克数据 (width * height) */
  mosaic: Uint8ClampedArray
  /** 宽度 */
  width: number
  /** 高度 */
  height: number
  /** Bayer 模式 */
  pattern: BayerPattern
}

/**
 * 获取 Bayer 模式中 (row, col) 位置的颜色通道
 * 返回 0=R, 1=G, 2=B
 */
export function getChannelAt(row: number, col: number, pattern: BayerPattern): number {
  const r = ((row % 2) + 2) % 2
  const c = ((col % 2) + 2) % 2
  const pos = r * 2 + c // 0,1,2,3 对应 2x2 块中的位置

  switch (pattern) {
    case 'RGGB': return [0, 1, 1, 2][pos]!
    case 'BGGR': return [2, 1, 1, 0][pos]!
    case 'GRBG': return [1, 0, 2, 1][pos]!
    case 'GBRG': return [1, 2, 0, 1][pos]!
  }
}

/**
 * 将 RGB 图像转换为 Bayer 马赛克
 * 模拟传感器只采集单一颜色通道的过程
 */
export function rgbToBayer(
  imageData: ImageData,
  pattern: BayerPattern = 'RGGB'
): BayerResult {
  const { width, height, data } = imageData
  const mosaic = new Uint8ClampedArray(width * height)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = (row * width + col) * 4
      const channel = getChannelAt(row, col, pattern)
      mosaic[row * width + col] = data[idx + channel]!
    }
  }

  return { mosaic, width, height, pattern }
}

/**
 * 将 Bayer 马赛克渲染为彩色可视化（每个像素显示其对应的滤色片颜色）
 */
export function bayerToColorVisualization(bayer: BayerResult): ImageData {
  const { mosaic, width, height, pattern } = bayer
  const output = new ImageData(width, height)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const oi = i * 4
      const value = mosaic[i]!
      const channel = getChannelAt(row, col, pattern)

      output.data[oi] = channel === 0 ? value : 0     // R
      output.data[oi + 1] = channel === 1 ? value : 0 // G
      output.data[oi + 2] = channel === 2 ? value : 0 // B
      output.data[oi + 3] = 255                        // A
    }
  }

  return output
}

/**
 * 将 Bayer 马赛克渲染为灰度图（原始传感器数据的样子）
 */
export function bayerToGrayscale(bayer: BayerResult): ImageData {
  const { mosaic, width, height } = bayer
  const output = new ImageData(width, height)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const oi = i * 4
      const value = mosaic[i]!

      output.data[oi] = value
      output.data[oi + 1] = value
      output.data[oi + 2] = value
      output.data[oi + 3] = 255
    }
  }

  return output
}
