/**
 * Web Worker 客户端：在主线程调用解拜耳算法但实际在 worker 中执行
 */

import { type BayerResult } from './bayer'
import { type DemosaicAlgorithm } from './demosaic'
import { type AnimationMode } from './animation'

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (img: ImageData) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./demosaic-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const { type, id, data, width, height, error } = e.data
      const handlers = pending.get(id)
      if (!handlers) return
      pending.delete(id)
      if (type === 'error') {
        handlers.reject(new Error(error))
      } else {
        const arr = new Uint8ClampedArray(data)
        handlers.resolve(new ImageData(arr, width, height))
      }
    }
  }
  return worker
}

/**
 * Bayer 数据要发送给 Worker，但 Uint8ClampedArray 跨 thread 拷贝代价高，
 * 如果只发送 buffer 引用又会丢失主线程的数据。我们这里克隆一份 mosaic（不可避免）。
 */
function cloneBayer(bayer: BayerResult): BayerResult {
  return {
    mosaic: new Uint8ClampedArray(bayer.mosaic),
    width: bayer.width,
    height: bayer.height,
    pattern: bayer.pattern,
  }
}

export function demosaicAsync(bayer: BayerResult, algorithm: DemosaicAlgorithm): Promise<ImageData> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({
      type: 'demosaic',
      id,
      bayer: cloneBayer(bayer),
      algorithm,
    })
  })
}

export function animationFrameAsync(
  bayer: BayerResult,
  algorithm: DemosaicAlgorithm,
  progress: number,
  mode: AnimationMode
): Promise<ImageData> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    getWorker().postMessage({
      type: 'animationFrame',
      id,
      bayer: cloneBayer(bayer),
      algorithm,
      progress,
      mode,
    })
  })
}

/** 关闭 Worker（清理） */
export function disposeWorker() {
  if (worker) {
    worker.terminate()
    worker = null
    pending.clear()
  }
}
