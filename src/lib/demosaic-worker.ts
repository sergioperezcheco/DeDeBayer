/**
 * 解拜耳 Web Worker
 * 把耗时的算法搬到 worker 线程，UI 不再卡顿
 */

import { type BayerResult } from './bayer'
import { type DemosaicAlgorithm, demosaic as demosaicSync } from './demosaic'
import { generateAnimationFrame, type AnimationMode } from './animation'

type WorkerRequest =
  | { type: 'demosaic'; id: number; bayer: BayerResult; algorithm: DemosaicAlgorithm }
  | { type: 'animationFrame'; id: number; bayer: BayerResult; algorithm: DemosaicAlgorithm; progress: number; mode: AnimationMode }

type WorkerResponse =
  | { type: 'demosaic'; id: number; data: ArrayBuffer; width: number; height: number }
  | { type: 'animationFrame'; id: number; data: ArrayBuffer; width: number; height: number }
  | { type: 'error'; id: number; error: string }

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  try {
    switch (req.type) {
      case 'demosaic': {
        const result = demosaicSync(req.bayer, req.algorithm)
        const buffer = result.data.buffer
        const resp: WorkerResponse = {
          type: 'demosaic',
          id: req.id,
          data: buffer as ArrayBuffer,
          width: result.width,
          height: result.height,
        }
        self.postMessage(resp, [buffer as ArrayBuffer])
        break
      }
      case 'animationFrame': {
        const result = generateAnimationFrame(req.bayer, req.algorithm, req.progress, req.mode)
        const buffer = result.data.buffer
        const resp: WorkerResponse = {
          type: 'animationFrame',
          id: req.id,
          data: buffer as ArrayBuffer,
          width: result.width,
          height: result.height,
        }
        self.postMessage(resp, [buffer as ArrayBuffer])
        break
      }
    }
  } catch (err) {
    const resp: WorkerResponse = {
      type: 'error',
      id: req.id,
      error: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(resp)
  }
}

export {} // 让 TS 当作 module
