import { describe, it, expect } from 'vitest'
import {
  getChannelAt,
  rgbToBayer,
  bayerToColorVisualization,
  bayerToGrayscale,
  type BayerPattern,
} from '../bayer'

describe('getChannelAt', () => {
  it('RGGB pattern at canonical positions', () => {
    expect(getChannelAt(0, 0, 'RGGB')).toBe(0) // R
    expect(getChannelAt(0, 1, 'RGGB')).toBe(1) // G
    expect(getChannelAt(1, 0, 'RGGB')).toBe(1) // G
    expect(getChannelAt(1, 1, 'RGGB')).toBe(2) // B
  })

  it('RGGB pattern repeats every 2 pixels', () => {
    expect(getChannelAt(2, 0, 'RGGB')).toBe(0)
    expect(getChannelAt(0, 2, 'RGGB')).toBe(0)
    expect(getChannelAt(100, 100, 'RGGB')).toBe(0)
    expect(getChannelAt(101, 101, 'RGGB')).toBe(2)
  })

  it('handles negative coordinates correctly', () => {
    // 关键回归测试：JS 的 % 对负数返回负数，导致数组索引错误
    expect(getChannelAt(-1, 0, 'RGGB')).toBe(1)
    expect(getChannelAt(-1, -1, 'RGGB')).toBe(2)
    expect(getChannelAt(-2, -2, 'RGGB')).toBe(0)
    expect(getChannelAt(0, -1, 'RGGB')).toBe(1)
  })

  it('all 4 patterns at (0,0)', () => {
    expect(getChannelAt(0, 0, 'RGGB')).toBe(0)
    expect(getChannelAt(0, 0, 'BGGR')).toBe(2)
    expect(getChannelAt(0, 0, 'GRBG')).toBe(1)
    expect(getChannelAt(0, 0, 'GBRG')).toBe(1)
  })
})

describe('rgbToBayer', () => {
  // 创建纯红、纯绿、纯蓝测试图
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

  it('pure red image: only R pixels have non-zero values in RGGB', () => {
    const img = makeImageData(4, 4, 255, 0, 0)
    const bayer = rgbToBayer(img, 'RGGB')

    // RGGB pattern: (0,0)=R, (0,1)=G, (1,0)=G, (1,1)=B
    expect(bayer.mosaic[0]).toBe(255) // R
    expect(bayer.mosaic[1]).toBe(0)   // G - 没有红色信息
    expect(bayer.mosaic[4]).toBe(0)   // G
    expect(bayer.mosaic[5]).toBe(0)   // B - 没有红色信息
  })

  it('pure green image: only G pixels capture data', () => {
    const img = makeImageData(4, 4, 0, 255, 0)
    const bayer = rgbToBayer(img, 'RGGB')
    expect(bayer.mosaic[0]).toBe(0)   // R 位置
    expect(bayer.mosaic[1]).toBe(255) // G 位置
    expect(bayer.mosaic[4]).toBe(255) // G 位置
    expect(bayer.mosaic[5]).toBe(0)   // B 位置
  })

  it('preserves dimensions', () => {
    const img = makeImageData(8, 6, 100, 100, 100)
    const bayer = rgbToBayer(img, 'RGGB')
    expect(bayer.width).toBe(8)
    expect(bayer.height).toBe(6)
    expect(bayer.mosaic.length).toBe(48)
    expect(bayer.pattern).toBe('RGGB')
  })

  it('all bayer patterns produce correct mosaic', () => {
    const patterns: BayerPattern[] = ['RGGB', 'BGGR', 'GRBG', 'GBRG']
    for (const p of patterns) {
      // 每个像素 RGB 值 = (r=10, g=20, b=30)
      const img = makeImageData(2, 2, 10, 20, 30)
      const bayer = rgbToBayer(img, p)
      // 验证 (0,0) 取的是该 pattern 在 (0,0) 的通道值
      const ch00 = getChannelAt(0, 0, p)
      const expected = [10, 20, 30][ch00]
      expect(bayer.mosaic[0]).toBe(expected)
    }
  })
})

describe('bayerToColorVisualization', () => {
  it('puts R value only in red channel for R pixels', () => {
    const mosaic = new Uint8ClampedArray([100, 50, 50, 80])
    const bayer = { mosaic, width: 2, height: 2, pattern: 'RGGB' as BayerPattern }
    const viz = bayerToColorVisualization(bayer)

    // (0,0) is R pixel: R=100, G=0, B=0
    expect(viz.data[0]).toBe(100)
    expect(viz.data[1]).toBe(0)
    expect(viz.data[2]).toBe(0)

    // (0,1) is G pixel: R=0, G=50, B=0
    expect(viz.data[4]).toBe(0)
    expect(viz.data[5]).toBe(50)
    expect(viz.data[6]).toBe(0)

    // (1,1) is B pixel: R=0, G=0, B=80
    expect(viz.data[12]).toBe(0)
    expect(viz.data[13]).toBe(0)
    expect(viz.data[14]).toBe(80)
  })
})

describe('bayerToGrayscale', () => {
  it('produces grayscale where each channel = mosaic value', () => {
    const mosaic = new Uint8ClampedArray([42, 100, 200, 50])
    const bayer = { mosaic, width: 2, height: 2, pattern: 'RGGB' as BayerPattern }
    const gray = bayerToGrayscale(bayer)

    expect(gray.data[0]).toBe(42)
    expect(gray.data[1]).toBe(42)
    expect(gray.data[2]).toBe(42)
    expect(gray.data[3]).toBe(255)
  })
})
