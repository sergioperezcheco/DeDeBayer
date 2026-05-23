import { describe, it, expect } from 'vitest'
import { rgbToBayer, type BayerPattern } from '../bayer'
import { demosaic, type DemosaicAlgorithm } from '../demosaic'

/** 创建纯色图 */
function makeImageData(w: number, h: number, r: number, g: number, b: number): ImageData {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return new ImageData(data, w, h)
}

/** 计算图像每个通道的平均值 */
function avgChannels(imgData: ImageData): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0
  const n = imgData.width * imgData.height
  for (let i = 0; i < n; i++) {
    r += imgData.data[i * 4]!
    g += imgData.data[i * 4 + 1]!
    b += imgData.data[i * 4 + 2]!
  }
  return { r: r / n, g: g / n, b: b / n }
}

const ALGORITHMS: DemosaicAlgorithm[] = ['nearest', 'bilinear', 'smooth-hue', 'malvar', 'edge']

describe('demosaic algorithms - solid color reconstruction', () => {
  // 关键测试：纯色图经过 RGB→Bayer→Demosaic 后，各通道平均值应接近原始
  // 这是检测算法正确性的最基本测试，如果算法把 R 当成 G，平均值会完全错

  for (const algo of ALGORITHMS) {
    describe(algo, () => {
      it('pure red image stays predominantly red', () => {
        const img = makeImageData(32, 32, 200, 0, 0)
        const bayer = rgbToBayer(img, 'RGGB')
        const result = demosaic(bayer, algo)
        const { r, g, b } = avgChannels(result)

        // R 通道应该明显高于 G 和 B
        expect(r).toBeGreaterThan(g + 50)
        expect(r).toBeGreaterThan(b + 50)
        // R 应该接近原值（允许边缘像素插值误差）
        expect(r).toBeGreaterThan(150)
      })

      it('pure green image stays predominantly green', () => {
        const img = makeImageData(32, 32, 0, 200, 0)
        const bayer = rgbToBayer(img, 'RGGB')
        const result = demosaic(bayer, algo)
        const { r, g, b } = avgChannels(result)

        expect(g).toBeGreaterThan(r + 50)
        expect(g).toBeGreaterThan(b + 50)
        expect(g).toBeGreaterThan(150)
      })

      it('pure blue image stays predominantly blue', () => {
        const img = makeImageData(32, 32, 0, 0, 200)
        const bayer = rgbToBayer(img, 'RGGB')
        const result = demosaic(bayer, algo)
        const { r, g, b } = avgChannels(result)

        expect(b).toBeGreaterThan(r + 50)
        expect(b).toBeGreaterThan(g + 50)
        expect(b).toBeGreaterThan(150)
      })

      it('output dimensions match input', () => {
        const img = makeImageData(20, 16, 128, 64, 32)
        const bayer = rgbToBayer(img, 'RGGB')
        const result = demosaic(bayer, algo)
        expect(result.width).toBe(20)
        expect(result.height).toBe(16)
      })

      it('all channel values are in [0, 255]', () => {
        const img = makeImageData(16, 16, 250, 200, 150)
        const bayer = rgbToBayer(img, 'RGGB')
        const result = demosaic(bayer, algo)

        for (let i = 0; i < result.data.length; i++) {
          expect(result.data[i]).toBeGreaterThanOrEqual(0)
          expect(result.data[i]).toBeLessThanOrEqual(255)
        }
      })
    })
  }
})

describe('demosaic - all Bayer patterns produce correct colors', () => {
  // 关键回归测试：验证不同 Bayer 模式都正确处理
  const patterns: BayerPattern[] = ['RGGB', 'BGGR', 'GRBG', 'GBRG']

  for (const pattern of patterns) {
    for (const algo of ALGORITHMS) {
      it(`${pattern} + ${algo}: pure red image stays red`, () => {
        const img = makeImageData(32, 32, 220, 0, 0)
        const bayer = rgbToBayer(img, pattern)
        const result = demosaic(bayer, algo)
        const { r, g, b } = avgChannels(result)

        expect(r).toBeGreaterThan(g)
        expect(r).toBeGreaterThan(b)
      })
    }
  }
})

describe('demosaic - gray image stays gray', () => {
  // 灰度图：R=G=B，解拜耳后应该仍然 R≈G≈B
  for (const algo of ALGORITHMS) {
    it(`${algo}: gray (128,128,128) stays gray`, () => {
      const img = makeImageData(32, 32, 128, 128, 128)
      const bayer = rgbToBayer(img, 'RGGB')
      const result = demosaic(bayer, algo)
      const { r, g, b } = avgChannels(result)

      // R, G, B 应该非常接近
      expect(Math.abs(r - g)).toBeLessThan(5)
      expect(Math.abs(g - b)).toBeLessThan(5)
      expect(Math.abs(r - 128)).toBeLessThan(5)
    })
  }
})

describe('demosaic - identity for known pixel positions', () => {
  // 关键回归测试：原本就有的颜色通道值应该保持不变
  it('R pixel keeps its R value after demosaic (RGGB, all algorithms)', () => {
    // 创建一个简单的 4x4 测试图
    const data = new Uint8ClampedArray(16 * 4)
    for (let i = 0; i < 16; i++) {
      data[i * 4] = 100 + i * 5
      data[i * 4 + 1] = 50
      data[i * 4 + 2] = 200
      data[i * 4 + 3] = 255
    }
    const img = new ImageData(data, 4, 4)
    const bayer = rgbToBayer(img, 'RGGB')

    for (const algo of ALGORITHMS) {
      const result = demosaic(bayer, algo)
      // (0,0) 是 R 像素，其 R 值应该等于原图的 R 值
      expect(result.data[0]).toBe(100)
    }
  })
})
