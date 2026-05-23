/**
 * 解拜耳（Demosaic）算法实现
 *
 * 从 Bayer 马赛克数据恢复完整 RGB 图像
 *
 * 实现的算法：
 *  - nearest:    最近邻 — 教科书最基础算法
 *  - bilinear:   双线性插值 — 标准做法
 *  - smooth-hue: 平滑色调 — 基于色调比率的插值（Kimmel 1999）
 *  - malvar:     Malvar-He-Cutler 2004 — 微软研究院论文
 *  - edge:       边缘导向插值 — 利用梯度方向选择插值方向（Hamilton & Adams 1997）
 */

import { type BayerResult, getChannelAt } from './bayer'

export type DemosaicAlgorithm = 'nearest' | 'bilinear' | 'smooth-hue' | 'malvar' | 'edge'

/**
 * 安全获取马赛克值（边界镜像）
 */
function getMosaicValue(mosaic: Uint8ClampedArray, width: number, height: number, row: number, col: number): number {
  if (row < 0) row = -row
  if (row >= height) row = 2 * height - row - 2
  if (col < 0) col = -col
  if (col >= width) col = 2 * width - col - 2
  return mosaic[row * width + col]!
}

function clamp(value: number, min = 0, max = 255): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * 最近邻解拜耳
 * 缺失通道直接取最近的同色邻居
 */
export function demosaicNearest(bayer: BayerResult): ImageData {
  const { mosaic, width, height, pattern } = bayer
  const output = new ImageData(width, height)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const oi = (row * width + col) * 4
      const currentChannel = getChannelAt(row, col, pattern)
      const rgb = [0, 0, 0]
      rgb[currentChannel] = mosaic[row * width + col]!

      for (let ch = 0; ch < 3; ch++) {
        if (ch === currentChannel) continue
        let found = false
        for (let dist = 1; dist <= 2 && !found; dist++) {
          const neighbors: [number, number][] = [
            [row - dist, col], [row + dist, col],
            [row, col - dist], [row, col + dist],
            [row - dist, col - dist], [row - dist, col + dist],
            [row + dist, col - dist], [row + dist, col + dist],
          ]
          for (const [nr, nc] of neighbors) {
            if (nr >= 0 && nr < height && nc >= 0 && nc < width) {
              if (getChannelAt(nr, nc, pattern) === ch) {
                rgb[ch] = mosaic[nr * width + nc]!
                found = true
                break
              }
            }
          }
        }
      }

      output.data[oi] = rgb[0]!
      output.data[oi + 1] = rgb[1]!
      output.data[oi + 2] = rgb[2]!
      output.data[oi + 3] = 255
    }
  }

  return output
}

/**
 * 双线性插值解拜耳
 * 对缺失通道在 3x3 邻域内取同色像素的平均
 */
export function demosaicBilinear(bayer: BayerResult): ImageData {
  const { mosaic, width, height, pattern } = bayer
  const output = new ImageData(width, height)
  const get = (r: number, c: number) => getMosaicValue(mosaic, width, height, r, c)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const oi = (row * width + col) * 4
      const currentChannel = getChannelAt(row, col, pattern)
      const rgb = [0, 0, 0]
      rgb[currentChannel] = mosaic[row * width + col]!

      for (let ch = 0; ch < 3; ch++) {
        if (ch === currentChannel) continue
        let sum = 0
        let count = 0
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue
            const nr = row + dr
            const nc = col + dc
            if (getChannelAt(nr, nc, pattern) === ch) {
              sum += get(nr, nc)
              count++
            }
          }
        }
        rgb[ch] = count > 0 ? Math.round(sum / count) : 0
      }

      output.data[oi] = rgb[0]!
      output.data[oi + 1] = rgb[1]!
      output.data[oi + 2] = rgb[2]!
      output.data[oi + 3] = 255
    }
  }

  return output
}

/**
 * Malvar-He-Cutler (2004) 高质量线性解拜耳
 *
 * 基于 5x5 卷积核，利用其他颜色通道的高频信息修正插值。
 * 论文中的 4 种核（除以 8）：
 *
 * 1) G at R 或 B (估计 G):           Pattern 1
 *      0  0 -1  0  0
 *      0  0  2  0  0
 *     -1  2  4  2 -1
 *      0  0  2  0  0
 *      0  0 -1  0  0
 *
 * 2) R at G in R-row, 或 B at G in B-row:  Pattern 2 (水平方向)
 *      0  0  1/2  0  0
 *      0 -1  0   -1  0
 *     -1  4  5    4 -1
 *      0 -1  0   -1  0
 *      0  0  1/2  0  0
 *
 * 3) R at G in B-row, 或 B at G in R-row:  Pattern 3 (Pattern 2 的转置)
 *      0  0 -1   0  0
 *      0 -1  4  -1  0
 *     1/2 0  5   0 1/2
 *      0 -1  4  -1  0
 *      0  0 -1   0  0
 *
 * 4) R at B 或 B at R (对角估计):      Pattern 4
 *      0   0  -3/2  0   0
 *      0   2   0    2   0
 *    -3/2  0   6    0 -3/2
 *      0   2   0    2   0
 *      0   0  -3/2  0   0
 */
export function demosaicMalvar(bayer: BayerResult): ImageData {
  const { mosaic, width, height, pattern } = bayer
  const output = new ImageData(width, height)
  const get = (r: number, c: number) => getMosaicValue(mosaic, width, height, r, c)

  // Pattern 1: G at R/B 位置
  function applyKernel_G_at_RB(r: number, c: number): number {
    const v =
      4 * get(r, c)
      + 2 * (get(r - 1, c) + get(r + 1, c) + get(r, c - 1) + get(r, c + 1))
      - 1 * (get(r - 2, c) + get(r + 2, c) + get(r, c - 2) + get(r, c + 2))
    return v / 8
  }

  // Pattern 2: 同行同色估计 (水平相邻是同色)
  // 例如 R at G in R-row: G 像素位于 R 行，左右两侧是 R
  function applyKernel_horizontal(r: number, c: number): number {
    const v =
      5 * get(r, c)
      + 4 * (get(r, c - 1) + get(r, c + 1))
      - 1 * (get(r - 1, c - 1) + get(r - 1, c + 1) + get(r + 1, c - 1) + get(r + 1, c + 1))
      + 0.5 * (get(r, c - 2) + get(r, c + 2))
      - 1 * (get(r - 2, c) + get(r + 2, c))
    return v / 8
  }

  // Pattern 3: 同列同色估计 (垂直相邻是同色)
  function applyKernel_vertical(r: number, c: number): number {
    const v =
      5 * get(r, c)
      + 4 * (get(r - 1, c) + get(r + 1, c))
      - 1 * (get(r - 1, c - 1) + get(r - 1, c + 1) + get(r + 1, c - 1) + get(r + 1, c + 1))
      + 0.5 * (get(r - 2, c) + get(r + 2, c))
      - 1 * (get(r, c - 2) + get(r, c + 2))
    return v / 8
  }

  // Pattern 4: 对角估计 R at B / B at R
  function applyKernel_diagonal(r: number, c: number): number {
    const v =
      6 * get(r, c)
      + 2 * (get(r - 1, c - 1) + get(r - 1, c + 1) + get(r + 1, c - 1) + get(r + 1, c + 1))
      - 1.5 * (get(r - 2, c) + get(r + 2, c) + get(r, c - 2) + get(r, c + 2))
    return v / 8
  }

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const oi = (row * width + col) * 4
      const currentChannel = getChannelAt(row, col, pattern)
      const center = mosaic[row * width + col]!
      const rgb = [0, 0, 0]
      rgb[currentChannel] = center

      if (currentChannel === 1) {
        // 当前是 G 像素，需要估计 R 和 B
        // 判断 G 位于 R 行还是 B 行（看左邻居）
        const leftCh = getChannelAt(row, col - 1, pattern)

        if (leftCh === 0) {
          // G 在 R-row：水平邻居是 R，垂直邻居是 B
          rgb[0] = clamp(Math.round(applyKernel_horizontal(row, col)))
          rgb[2] = clamp(Math.round(applyKernel_vertical(row, col)))
        } else {
          // G 在 B-row：水平邻居是 B，垂直邻居是 R
          rgb[2] = clamp(Math.round(applyKernel_horizontal(row, col)))
          rgb[0] = clamp(Math.round(applyKernel_vertical(row, col)))
        }
      } else {
        // 当前是 R 或 B 像素
        // 估计 G (Pattern 1)
        rgb[1] = clamp(Math.round(applyKernel_G_at_RB(row, col)))
        // 估计对角通道 (Pattern 4)
        const diagChannel = currentChannel === 0 ? 2 : 0
        rgb[diagChannel] = clamp(Math.round(applyKernel_diagonal(row, col)))
      }

      output.data[oi] = rgb[0]!
      output.data[oi + 1] = rgb[1]!
      output.data[oi + 2] = rgb[2]!
      output.data[oi + 3] = 255
    }
  }

  return output
}

/**
 * 平滑色调（Smooth Hue）解拜耳
 *
 * 基于 Kimmel (1999) 的思路：先用双线性插值得到 G 通道，
 * 然后利用色调比率 (R/G, B/G) 在 G 通道基础上恢复 R 和 B。
 * 这利用了自然图像中色调变化比亮度变化更平滑的特性。
 */
export function demosaicSmoothHue(bayer: BayerResult): ImageData {
  const { mosaic, width, height, pattern } = bayer
  const output = new ImageData(width, height)
  const get = (r: number, c: number) => getMosaicValue(mosaic, width, height, r, c)

  // 第一步：用双线性插值得到完整的 G 通道
  const green = new Float32Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const ch = getChannelAt(row, col, pattern)
      if (ch === 1) {
        green[row * width + col] = get(row, col)
      } else {
        // 双线性插值 G
        let sum = 0, count = 0
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (getChannelAt(row + dr, col + dc, pattern) === 1) {
              sum += get(row + dr, col + dc)
              count++
            }
          }
        }
        green[row * width + col] = count > 0 ? sum / count : get(row, col)
      }
    }
  }

  // 第二步：利用色调比率恢复 R 和 B
  // 在 G 太小时回退到色差方法（避免除零）
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = (row * width + col) * 4
      const ch = getChannelAt(row, col, pattern)
      const g = green[row * width + col]!

      output.data[idx + 1] = clamp(Math.round(g))

      for (const targetCh of [0, 2] as const) {
        if (ch === targetCh) {
          output.data[idx + targetCh] = get(row, col)
        } else {
          // 收集邻域同色像素的 (target, neighborG) 对
          let ratioSum = 0, ratioCount = 0
          let diffSum = 0, diffCount = 0
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (getChannelAt(row + dr, col + dc, pattern) === targetCh) {
                const neighborG = green[(row + dr) * width + (col + dc)]!
                const neighborVal = get(row + dr, col + dc)
                // 色差永远可计算
                diffSum += neighborVal - neighborG
                diffCount++
                // 色调比率仅在 G 足够大时计算
                if (neighborG > 8) {
                  ratioSum += neighborVal / neighborG
                  ratioCount++
                }
              }
            }
          }

          // 优先使用比率法，G 过小时回退到色差法
          if (ratioCount > 0 && g > 8) {
            const ratio = ratioSum / ratioCount
            output.data[idx + targetCh] = clamp(Math.round(g * ratio))
          } else if (diffCount > 0) {
            const diff = diffSum / diffCount
            output.data[idx + targetCh] = clamp(Math.round(g + diff))
          } else {
            output.data[idx + targetCh] = clamp(Math.round(g))
          }
        }
      }

      output.data[idx + 3] = 255
    }
  }

  return output
}

/**
 * 边缘导向插值（Edge-Directed）
 *
 * 基于 Hamilton & Adams (1997) 的思路：
 * 在插值 G 通道时，比较水平和垂直方向的梯度，
 * 选择梯度较小的方向进行插值，避免跨越边缘产生伪色。
 */
export function demosaicEdge(bayer: BayerResult): ImageData {
  const { mosaic, width, height, pattern } = bayer
  const output = new ImageData(width, height)
  const get = (r: number, c: number) => getMosaicValue(mosaic, width, height, r, c)

  // 第一步：边缘导向插值 G 通道
  const green = new Float32Array(width * height)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const ch = getChannelAt(row, col, pattern)
      if (ch === 1) {
        green[row * width + col] = get(row, col)
      } else {
        // 水平梯度
        const dH = Math.abs(get(row, col - 1) - get(row, col + 1))
          + Math.abs(2 * get(row, col) - get(row, col - 2) - get(row, col + 2))
        // 垂直梯度
        const dV = Math.abs(get(row - 1, col) - get(row + 1, col))
          + Math.abs(2 * get(row, col) - get(row - 2, col) - get(row + 2, col))

        let g: number
        if (dH < dV) {
          // 水平方向更平滑，用水平邻居
          g = (get(row, col - 1) + get(row, col + 1)) / 2
            + (2 * get(row, col) - get(row, col - 2) - get(row, col + 2)) / 4
        } else if (dV < dH) {
          // 垂直方向更平滑
          g = (get(row - 1, col) + get(row + 1, col)) / 2
            + (2 * get(row, col) - get(row - 2, col) - get(row + 2, col)) / 4
        } else {
          // 梯度相等，取平均
          g = (get(row, col - 1) + get(row, col + 1) + get(row - 1, col) + get(row + 1, col)) / 4
            + (4 * get(row, col) - get(row, col - 2) - get(row, col + 2) - get(row - 2, col) - get(row + 2, col)) / 8
        }
        green[row * width + col] = g
      }
    }
  }

  // 第二步：利用色差 (R-G, B-G) 插值 R 和 B
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = (row * width + col) * 4
      const ch = getChannelAt(row, col, pattern)
      const g = green[row * width + col]!

      output.data[idx + 1] = clamp(Math.round(g))

      for (const targetCh of [0, 2] as const) {
        if (ch === targetCh) {
          output.data[idx + targetCh] = get(row, col)
        } else {
          // 计算邻域中同色像素的色差 (target - G)
          let diffSum = 0, diffCount = 0
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (getChannelAt(row + dr, col + dc, pattern) === targetCh) {
                const nG = green[(row + dr) * width + (col + dc)]!
                diffSum += get(row + dr, col + dc) - nG
                diffCount++
              }
            }
          }
          const diff = diffCount > 0 ? diffSum / diffCount : 0
          output.data[idx + targetCh] = clamp(Math.round(g + diff))
        }
      }

      output.data[idx + 3] = 255
    }
  }

  return output
}

export function demosaic(bayer: BayerResult, algorithm: DemosaicAlgorithm): ImageData {
  switch (algorithm) {
    case 'nearest': return demosaicNearest(bayer)
    case 'bilinear': return demosaicBilinear(bayer)
    case 'smooth-hue': return demosaicSmoothHue(bayer)
    case 'malvar': return demosaicMalvar(bayer)
    case 'edge': return demosaicEdge(bayer)
  }
}
