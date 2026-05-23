/**
 * 解拜耳动画引擎
 *
 * 逐行/逐块展示解拜耳过程，从马赛克逐步过渡到完整图像
 */

import { type BayerResult, bayerToColorVisualization } from './bayer'
import { type DemosaicAlgorithm, demosaic } from './demosaic'

export interface AnimationState {
  /** 当前进度 0-1 */
  progress: number
  /** 当前帧的 ImageData */
  frame: ImageData
  /** 是否完成 */
  done: boolean
}

export type AnimationMode = 'scanline' | 'radial' | 'random-blocks'

/**
 * 生成解拜耳动画帧
 * 将马赛克图和解拜耳结果按进度混合
 */
export function generateAnimationFrame(
  bayer: BayerResult,
  algorithm: DemosaicAlgorithm,
  progress: number,
  mode: AnimationMode = 'scanline'
): ImageData {
  const mosaicVis = bayerToColorVisualization(bayer)
  const demosaiced = demosaic(bayer, algorithm)
  const { width, height } = bayer
  const output = new ImageData(width, height)

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const i = (row * width + col) * 4
      const pixelProgress = getPixelProgress(row, col, width, height, progress, mode)

      // 在马赛克和解拜耳结果之间插值
      for (let ch = 0; ch < 3; ch++) {
        output.data[i + ch] = Math.round(
          mosaicVis.data[i + ch]! * (1 - pixelProgress) +
          demosaiced.data[i + ch]! * pixelProgress
        )
      }
      output.data[i + 3] = 255
    }
  }

  return output
}

/**
 * 根据动画模式计算每个像素的局部进度
 */
function getPixelProgress(
  row: number,
  col: number,
  width: number,
  height: number,
  globalProgress: number,
  mode: AnimationMode
): number {
  let localPosition: number

  switch (mode) {
    case 'scanline':
      // 从上到下扫描
      localPosition = row / height
      break

    case 'radial':
      // 从中心向外扩散
      const cx = width / 2
      const cy = height / 2
      const maxDist = Math.sqrt(cx * cx + cy * cy)
      const dist = Math.sqrt((col - cx) ** 2 + (row - cy) ** 2)
      localPosition = dist / maxDist
      break

    case 'random-blocks': {
      // 按 16x16 块随机顺序
      const blockX = Math.floor(col / 16)
      const blockY = Math.floor(row / 16)
      const blocksW = Math.ceil(width / 16)
      const blockIdx = blockY * blocksW + blockX
      // 使用简单哈希产生伪随机顺序
      const hash = ((blockIdx * 2654435761) >>> 0) / 4294967296
      localPosition = hash
      break
    }
  }

  // 使用 smoothstep 过渡，宽度为 0.3
  const edge = globalProgress * 1.3
  const t = Math.max(0, Math.min(1, (edge - localPosition) / 0.3))
  return t * t * (3 - 2 * t) // smoothstep
}

/**
 * 创建动画控制器
 */
export function createAnimationController(
  bayer: BayerResult,
  algorithm: DemosaicAlgorithm,
  mode: AnimationMode,
  durationMs: number = 3000,
  onFrame: (state: AnimationState) => void
) {
  let animationId: number | null = null
  let startTime: number | null = null
  let paused = false
  let pausedProgress = 0

  function tick(timestamp: number) {
    if (paused) return

    if (startTime === null) {
      startTime = timestamp - pausedProgress * durationMs
    }

    const elapsed = timestamp - startTime
    const progress = Math.min(1, elapsed / durationMs)

    const frame = generateAnimationFrame(bayer, algorithm, progress, mode)
    onFrame({ progress, frame, done: progress >= 1 })

    if (progress < 1) {
      animationId = requestAnimationFrame(tick)
    }
  }

  return {
    start() {
      paused = false
      startTime = null
      pausedProgress = 0
      animationId = requestAnimationFrame(tick)
    },
    pause() {
      paused = true
      if (animationId !== null) {
        cancelAnimationFrame(animationId)
        animationId = null
      }
    },
    resume() {
      if (!paused) return
      paused = false
      animationId = requestAnimationFrame(tick)
    },
    stop() {
      paused = true
      if (animationId !== null) {
        cancelAnimationFrame(animationId)
        animationId = null
      }
      startTime = null
      pausedProgress = 0
    },
    setProgress(p: number) {
      pausedProgress = p
      const frame = generateAnimationFrame(bayer, algorithm, p, mode)
      onFrame({ progress: p, frame, done: p >= 1 })
    }
  }
}
